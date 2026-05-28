import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const platformSource = readFileSync(new URL("./platform.ts", import.meta.url), "utf8");

test("flow universe liquidity uses platform quote routing instead of direct IBKR snapshots", () => {
  const managerBlock = platformSource.match(
    /const flowUniverseManager = createFlowUniverseManager\(\{[\s\S]*?\n\}\);/,
  )?.[0];

  assert.ok(managerBlock);
  assert.match(managerBlock, /fetchLiquiditySnapshots:\s*async \(symbols\) => \{/);
  assert.match(managerBlock, /await getQuoteSnapshots\(\{/);
  assert.match(managerBlock, /source:\s*[\s\S]*snapshot\.source/);
  assert.doesNotMatch(managerBlock, /fetchBridgeQuoteSnapshots/);
});

test("option flow scanner injects Massive stock spot before IBKR option-chain metadata", () => {
  assert.match(platformSource, /async function fetchMassiveStockSpotPrice/);
  assert.match(
    platformSource,
    /const stockSpotPrice = await fetchMassiveStockSpotPrice\(input\.underlying\);/,
  );
  assert.match(
    platformSource,
    /underlyingSpotPrice,\s*\n\s*quoteHydration: "metadata"/,
  );
  assert.match(platformSource, /underlyingSpotSource = "massive"/);
});

test("background options-flow scanner respects bridge backoff and uses seed-expanded phases", () => {
  const scannerBlock = platformSource.match(
    /const optionsFlowScanner = createOptionsFlowScanner<unknown>\(\{[\s\S]*?\n\}\);/,
  )?.[0];
  const uncachedBlock = platformSource.match(
    /async function listFlowEventsUncached\([\s\S]*?\n}\n\ntype FlowScannerBenchmarkLineUsage/,
  )?.[0];

  assert.ok(scannerBlock);
  assert.match(scannerBlock, /scanPhase: phase/);
  assert.match(scannerBlock, /bypassBridgeBackoff: false/);
  assert.match(scannerBlock, /request\.phase === "seed"/);
  assert.match(scannerBlock, /buildOptionsFlowExpandedScannerRequest/);

  assert.ok(uncachedBlock);
  assert.doesNotMatch(uncachedBlock, /bypassBridgeBackoff: true/);
  assert.match(uncachedBlock, /bypassBridgeBackoff: input\.bypassBridgeBackoff === true/);
  assert.match(uncachedBlock, /scannerPhase: scanPhase/);
});

test("broker position display equity quotes use Massive-primary quote routing", () => {
  const enrichBlock = platformSource.match(
    /async function enrichBrokerPositionsForDisplay\([\s\S]*?\n  const optionPositionsByUnderlying/,
  )?.[0];

  assert.ok(enrichBlock);
  assert.match(enrichBlock, /await getQuoteSnapshots\(\{/);
  assert.doesNotMatch(enrichBlock, /fetchBridgeQuoteSnapshots/);
});

test("Massive full-universe stock stream uses raw flow sources before IBKR lane caps", () => {
  const universeBlock = platformSource.match(
    /function resolveMassiveStockUniverseSymbols\(\)[\s\S]*?\n}\n/,
  )?.[0];
  const refreshBlock = platformSource.match(
    /function refreshMassiveStockUniverseStreams\([\s\S]*?\n}\n\nexport function startMassiveStockUniverseStreams/,
  )?.[0];

  assert.ok(universeBlock);
  assert.match(universeBlock, /getOptionsFlowLaneSourceSymbols\(\)/);
  assert.match(universeBlock, /\.\.\.sources\.builtInSymbols/);
  assert.match(universeBlock, /\.\.\.sources\.watchlistSymbols/);
  assert.match(universeBlock, /\.\.\.sources\.flowUniverseSymbols/);
  assert.doesNotMatch(universeBlock, /resolveIbkrLaneSymbols/);

  assert.ok(refreshBlock);
  assert.match(refreshBlock, /subscribeMassiveStockQuoteSnapshots/);
  assert.match(refreshBlock, /subscribeStockMinuteAggregates/);
});

test("Massive historical synthesis checks are recency-aware", () => {
  const synthesisBlock = platformSource.match(
    /function isHistoricalSynthesisBar\([\s\S]*?\n}\n\nfunction restrictHistoricalSynthesisToBrokerBackfill/,
  )?.[0];

  assert.ok(synthesisBlock);
  assert.match(synthesisBlock, /const massiveDelayed =/);
  assert.match(synthesisBlock, /bar\.freshness === "delayed"/);
  assert.match(synthesisBlock, /!isMassiveStocksRealtimeConfigured\(\)/);
  assert.doesNotMatch(synthesisBlock, /source === "massive-history"/);
});
