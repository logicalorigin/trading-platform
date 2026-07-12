import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import * as ts from "typescript";

const sourceFiles = [
  "./platform.ts",
  "./account.ts",
  "./shadow-account.ts",
  "./overnight-spot-execution.ts",
].map((relativePath) => {
  const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
  return {
    relativePath,
    sourceFile: ts.createSourceFile(
      relativePath,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    ),
  };
});

const removedAdmissionProperties = new Set([
  "admissionOwner",
  "admissionIntent",
  "admissionFallbackProvider",
  "ttlMs",
]);

test("stock quote snapshots no longer expose broker line-admission options", () => {
  const platform = sourceFiles.find(
    ({ relativePath }) => relativePath === "./platform.ts",
  )?.sourceFile;
  assert.ok(platform);

  const inputType = platform.statements.find(
    (statement): statement is ts.TypeAliasDeclaration =>
      ts.isTypeAliasDeclaration(statement) &&
      statement.name.text === "GetQuoteSnapshotsInput",
  );
  assert.ok(inputType && ts.isTypeLiteralNode(inputType.type));

  const propertyNames = inputType.type.members.flatMap((member) =>
    ts.isPropertySignature(member) && member.name
      ? [member.name.getText(platform)]
      : [],
  );
  removedAdmissionProperties.forEach((property) => {
    assert.ok(
      !propertyNames.includes(property),
      `GetQuoteSnapshotsInput still exposes ${property}`,
    );
  });
});

test("stock quote snapshot callers do not pass broker line-admission options", () => {
  const violations: string[] = [];

  sourceFiles.forEach(({ relativePath, sourceFile }) => {
    function visit(node: ts.Node): void {
      if (
        ts.isCallExpression(node) &&
        node.expression.getText(sourceFile) === "getQuoteSnapshots" &&
        node.arguments.length > 0 &&
        ts.isObjectLiteralExpression(node.arguments[0])
      ) {
        node.arguments[0].properties.forEach((property) => {
          if (
            ts.isPropertyAssignment(property) &&
            removedAdmissionProperties.has(property.name.getText(sourceFile))
          ) {
            const line = sourceFile.getLineAndCharacterOfPosition(
              property.getStart(sourceFile),
            ).line + 1;
            violations.push(
              `${relativePath}:${line}:${property.name.getText(sourceFile)}`,
            );
          }
        });
      }
      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
  });

  assert.deepEqual(violations, []);
});

test("platform has no IBKR watchlist quote-data prewarm graph", () => {
  const platform = sourceFiles.find(
    ({ relativePath }) => relativePath === "./platform.ts",
  )?.sourceFile;
  assert.ok(platform);
  const source = platform.getFullText();

  assert.doesNotMatch(
    source,
    /IbkrWatchlistPrewarm|WatchlistPrewarm|WATCHLIST_PREWARM|watchlist-prewarm/,
  );
  assert.doesNotMatch(source, /subscribeMarketDataLeaseChanges/);

  assert.match(
    source,
    /function rememberOptionsFlowWatchlistSymbols[\s\S]*latestOptionsFlowWatchlistSymbols/,
    "Massive options-flow planning must retain watchlist symbols without broker leases",
  );
  assert.match(
    source,
    /function getOptionsFlowLaneSourceSymbols[\s\S]*candidateWatchlistSymbols\s*=\s*latestOptionsFlowWatchlistSymbols/,
    "options-flow planning must consume the provider-neutral watchlist symbol feed",
  );
  assert.match(
    source,
    /function startOptionsFlowScanner[\s\S]*startOptionsFlowWatchlistSymbolRefreshRuntime\(\)/,
    "Massive options-flow startup must start recoverable watchlist hydration without broker leases",
  );
  assert.match(
    source,
    /function startOptionsFlowWatchlistSymbolRefreshRuntime[\s\S]*setInterval/,
    "transient startup DB failures must be retried without reviving IBKR prewarm",
  );
});
