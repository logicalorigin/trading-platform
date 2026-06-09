import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./account.ts", import.meta.url), "utf8");

function functionSource(name: string): string {
  const offset = source.indexOf(`async function ${name}`);
  assert.notEqual(offset, -1, `Missing ${name}`);
  const nextFunction = source.indexOf("\nasync function ", offset + 1);
  const nextType = source.indexOf("\ntype ", offset + 1);
  const nextConst = source.indexOf("\nconst ", offset + 1);
  const candidates = [nextFunction, nextType, nextConst].filter((index) => index > offset);
  const end = candidates.length ? Math.min(...candidates) : source.length;
  return source.slice(offset, end);
}

test("account equity position quote hydration uses IBKR bridge snapshots", () => {
  const body = functionSource("fetchEquityQuoteSnapshotsForPositions");

  assert.match(body, /fetchBridgeQuoteSnapshots\(symbols,\s*\{/);
  assert.match(body, /providerContractIdsBySymbol/);
  assert.match(body, /fallbackProvider:\s*"none"/);
  assert.doesNotMatch(body, /getQuoteSnapshots\(/);
  assert.doesNotMatch(body, /allowMassiveFallback/);
  assert.doesNotMatch(body, /admissionFallbackProvider:\s*"massive"/);
});

test("account equity position quote hydration infers numeric position conids", () => {
  assert.match(
    source,
    /function equityProviderContractIdFromPosition\([\s\S]*\/\^\[1-9\]\\d\+\$\/\.test\(idTail\)/,
  );
});
