import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./platform.ts", import.meta.url), "utf8");
const searchStart = source.indexOf(
  "export async function searchUniverseTickers(",
);
const searchEnd = source.indexOf("\ntype NativeBarTimeframe", searchStart);
const searchSource = source.slice(searchStart, searchEnd);

test("non-strict universe ticker search returns Massive-only output before IBKR", () => {
  assert.doesNotMatch(
    searchSource,
    /shouldUseUniverseCatalogImmediateResponse|shouldUseUniverseCatalogResponse/,
  );

  const nonStrictStart = searchSource.indexOf("if (!strictTradeResolve) {");
  const nonStrictEnd = searchSource.indexOf(
    "\n  let flight = universeSearchInFlight",
    nonStrictStart,
  );
  assert.ok(nonStrictStart > -1, "missing non-strict search branch");
  assert.ok(nonStrictEnd > nonStrictStart, "missing IBKR flight boundary");

  const nonStrictSource = searchSource.slice(nonStrictStart, nonStrictEnd);
  assert.match(nonStrictSource, /runMassiveForegroundUniverseSearch/);
  assert.match(nonStrictSource, /finalizeMassiveOnlyUniverseSearchResponse/);
  assert.match(
    nonStrictSource,
    /cacheUniverseSearchResponse\(cacheKey, mergedResponse, \{ allowEmpty: true \}\);/,
  );
  assert.match(nonStrictSource, /return mergedResponse;/);
  assert.doesNotMatch(
    nonStrictSource,
    /runInteractiveUniverseSearch|getIbkrClient|enqueueUniverseCatalogIbkrHydrationRows/,
  );
});

test("Massive-only ticker normalization strips broker fields", () => {
  const helperStart = source.indexOf("function toMassiveOnlyUniverseTicker(");
  const helperEnd = source.indexOf(
    "\nfunction normalizeUniverseLogoSymbols",
    helperStart,
  );
  assert.ok(helperStart > -1, "missing Massive-only normalizer");
  assert.ok(helperEnd > helperStart, "missing normalizer boundary");

  const helperSource = source.slice(helperStart, helperEnd);
  assert.match(helperSource, /providers: \["massive"\]/);
  assert.match(helperSource, /provider: "massive"/);
  assert.match(helperSource, /tradeProvider: null/);
  assert.match(helperSource, /dataProviderPreference: "massive"/);
  assert.match(helperSource, /providerContractId: null/);
});

test("foreground Massive ticker search covers identifier lookups", () => {
  const foregroundStart = source.indexOf(
    "async function runMassiveForegroundUniverseSearch(",
  );
  const foregroundEnd = source.indexOf(
    "\nfunction observeAbandonedUniverseSearchFlight",
    foregroundStart,
  );
  assert.ok(foregroundStart > -1, "missing Massive foreground search");
  assert.ok(foregroundEnd > foregroundStart, "missing foreground boundary");

  const foregroundSource = source.slice(foregroundStart, foregroundEnd);
  assert.match(foregroundSource, /deriveCusipCandidates/);
  assert.match(
    foregroundSource,
    /massiveClient\.searchUniverseTickers\(\{\s*market,/,
  );
  assert.match(foregroundSource, /cusip,/);
});
