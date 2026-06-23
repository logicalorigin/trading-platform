import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import * as ts from "typescript";

const source = readFileSync(new URL("./account-page-streams.ts", import.meta.url), "utf8");
const sourceFile = ts.createSourceFile(
  "account-page-streams.ts",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS,
);

function propertyNameText(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return null;
}

function findFunctionDeclaration(name: string): ts.FunctionDeclaration {
  for (const statement of sourceFile.statements) {
    if (
      ts.isFunctionDeclaration(statement) &&
      statement.name?.text === name
    ) {
      return statement;
    }
  }
  throw new Error(`Missing ${name}`);
}

function functionSource(name: string): string {
  const target = findFunctionDeclaration(name);
  return source.slice(target.pos, target.end);
}

function getAccountPositionLiveQuoteFlags(functionName: string): string[] {
  const target = findFunctionDeclaration(functionName);
  const flags: string[] = [];

  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "getAccountPositions"
    ) {
      const [input] = node.arguments;
      if (input && ts.isObjectLiteralExpression(input)) {
        for (const property of input.properties) {
          if (
            ts.isPropertyAssignment(property) &&
            propertyNameText(property.name) === "liveQuotes"
          ) {
            flags.push(property.initializer.kind === ts.SyntaxKind.TrueKeyword ? "true" : "false");
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(target);
  return flags;
}

test("shadow account-page live positions keep quote hydration", () => {
  const flags = getAccountPositionLiveQuoteFlags("fetchAccountPageLivePayload");
  assert.ok(
    flags.includes("true"),
    "fetchAccountPageLivePayload must request liveQuotes:true for shadow account positions",
  );
  assert.ok(
    !flags.includes("false"),
    "fetchAccountPageLivePayload must not disable live quotes for shadow account positions",
  );
});

test("real account-page live positions use fast live quote hydration", () => {
  const body = functionSource("fetchAccountPageLivePayload");
  assert.match(
    body,
    /const \[primary,\s*livePositions,\s*intradayEquity\] = await Promise\.all\(\[[\s\S]*?fetchAccountPagePrimaryPayload\(normalized\)[\s\S]*?getAccountPositions\(\{[\s\S]*?detail:\s*"fast"[\s\S]*?liveQuotes:\s*true[\s\S]*?\}\)[\s\S]*?\]\);[\s\S]*?positions:\s*livePositions/,
    "real account live payload must refresh positions with liveQuotes:true instead of reusing primary.positions",
  );
  assert.doesNotMatch(
    body,
    /positions:\s*primary\.positions/,
    "real account live payload must not publish quote-free primary positions",
  );
});

test("real account-page primary positions use fast quote-free first paint", () => {
  const body = functionSource("fetchAccountPagePrimaryPayload");
  assert.match(
    body,
    /getAccountPositions\(\{[\s\S]*?detail:\s*"fast"[\s\S]*?liveQuotes:\s*false[\s\S]*?\}\)/,
  );
  assert.match(
    body,
    /isShadow[\s\S]*?getAccountPositions\(\{[\s\S]*?liveQuotes:\s*true[\s\S]*?\}\)/,
  );
});

test("live polling retains the last-known payload for cache-first serves", () => {
  const body = functionSource("subscribeAccountPageSnapshots");
  // Every successful live poll must record the payload so a later
  // reconnect/re-navigation can paint it immediately.
  assert.match(body, /writeCachedAccountPageLivePayload\(input,\s*snapshot\)/);
  // The retain must happen unconditionally, before the change check — otherwise
  // an unchanged poll (signature equal) would skip caching and the cache-first
  // path would only ever see the first emit.
  const writeIdx = body.indexOf("writeCachedAccountPageLivePayload(input");
  const changedIdx = body.indexOf("const changed =");
  assert.ok(writeIdx !== -1 && changedIdx !== -1);
  assert.ok(
    writeIdx < changedIdx,
    "writeCachedAccountPageLivePayload must run before the change check, not inside the changed branch",
  );
});

test("subscribe paints a cached live payload first, tagged refreshing", () => {
  const body = functionSource("subscribeAccountPageSnapshots");
  // Only when the caller didn't seed an initial payload — otherwise the seed wins.
  assert.match(
    body,
    /if\s*\(!options\.initialLivePayload\s*&&\s*!options\.initialPayload\)/,
  );
  // Deferred to a microtask so subscribe() returns before the first emit.
  assert.match(body, /queueMicrotask\(/);
  assert.match(body, /readCachedAccountPageLivePayload\(input\)/);
  // The immediate paint must be tagged refreshing so the UI shows the spinner
  // until the live poll replaces it.
  assert.match(
    body,
    /onLive\(\{\s*\.\.\.cachedLivePayload,\s*refreshing:\s*true\s*\}\)/,
  );
});

test("clearing the snapshot cache also clears the last-live cache", () => {
  const body = functionSource("clearAccountPageSnapshotCache");
  assert.match(body, /accountPageLastLiveCache\.clear\(\)/);
});

test("the last-live cache is bounded by TTL and a max-entry cap", () => {
  // Module-level bounds must exist so the retain map can't grow unbounded.
  assert.match(source, /const ACCOUNT_PAGE_LAST_LIVE_TTL_MS\s*=/);
  assert.match(source, /const ACCOUNT_PAGE_LAST_LIVE_MAX_ENTRIES\s*=/);
  // Reads past the TTL evict and return null instead of serving stale data.
  const readBody = functionSource("readCachedAccountPageLivePayload");
  assert.match(
    readBody,
    /Date\.now\(\)\s*-\s*entry\.at\s*>\s*ACCOUNT_PAGE_LAST_LIVE_TTL_MS[\s\S]*?delete\(key\)[\s\S]*?return null/,
  );
  // Writes evict the oldest entry once the cap is exceeded.
  const writeBody = functionSource("writeCachedAccountPageLivePayload");
  assert.match(
    writeBody,
    /while\s*\(accountPageLastLiveCache\.size\s*>\s*ACCOUNT_PAGE_LAST_LIVE_MAX_ENTRIES\)/,
  );
});
