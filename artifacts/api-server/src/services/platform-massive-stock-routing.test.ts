import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const platformSource = readFileSync(
  new URL("./platform.ts", import.meta.url),
  "utf8",
);

test("flow universe liquidity uses platform quote routing instead of direct IBKR snapshots", () => {
  const managerBlock = platformSource.match(
    /const flowUniverseManager = createFlowUniverseManager\(\{[\s\S]*?\n\}\);/,
  )?.[0];

  assert.ok(managerBlock);
  assert.match(
    managerBlock,
    /fetchLiquiditySnapshots:\s*async \(symbols\) => \{/,
  );
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
  assert.match(
    uncachedBlock,
    /bypassBridgeBackoff: input\.bypassBridgeBackoff === true/,
  );
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

test("Massive stock universe stream honors configurable symbol cap before IBKR lane caps", () => {
  const universeBlock = platformSource.match(
    /function resolveMassiveStockUniverseSymbols\(\)[\s\S]*?\n}\n/,
  )?.[0];
  const refreshBlock = platformSource.match(
    /function refreshMassiveStockUniverseStreams\([\s\S]*?\n}\n\nexport function startMassiveStockUniverseStreams/,
  )?.[0];

  assert.ok(universeBlock);
  assert.match(universeBlock, /getOptionsFlowLaneSourceSymbols\(\)/);
  assert.match(universeBlock, /massiveStockUniverseStreamSymbolCap\(\)/);
  assert.match(universeBlock, /\.\.\.sources\.candidateBuiltInSymbols/);
  assert.match(universeBlock, /\.\.\.sources\.candidateWatchlistSymbols/);
  assert.match(universeBlock, /\.\.\.sources\.candidatePrioritySymbols/);
  assert.match(universeBlock, /\.\.\.sources\.flowUniverseSymbols/);
  assert.match(universeBlock, /\.slice\(0, symbolCap\)\s*\.sort\(\)/);
  assert.doesNotMatch(universeBlock, /resolveIbkrLaneSymbols/);

  assert.ok(refreshBlock);
  assert.match(
    refreshBlock,
    /const resourcePressure = getApiResourcePressureSnapshot\(\)/,
  );
  assert.match(refreshBlock, /resourcePressure\.level === "critical"/);
  assert.doesNotMatch(refreshBlock, /resourcePressure\.level === "high"/);
  assert.match(
    refreshBlock,
    /closeMassiveStockUniverseStreams\("resource_pressure"\)/,
  );
  assert.doesNotMatch(refreshBlock, /subscribeMassiveStockQuoteSnapshots/);
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

test("visible chart bars do not force full broker-history recovery", () => {
  const constantsBlock = platformSource.match(
    /const BARS_BROKER_LIVE_EDGE_MIN_PRIORITY[\s\S]*?const OPTION_HISTORY_REFERENCE_PROVIDER_FRESH_MS/,
  )?.[0];
  const liveEdgeBlock = platformSource.match(
    /function shouldAttemptBrokerLiveEdgeHistory\([\s\S]*?\n}\n\nfunction delayBarsRetry/,
  )?.[0];
  const fullRecoveryBlock = platformSource.match(
    /function shouldAttemptFullBrokerHistoryRecovery\([\s\S]*?\n}\n\nfunction shouldAttemptBrokerLiveEdgeHistory/,
  )?.[0];
  const priorityBucketBlock = platformSource.match(
    /function resolveBarsPriorityBucket\([\s\S]*?\n}\n\nfunction incrementBarsBreakdown/,
  )?.[0];
  const fetchBrokerHistoryBlock = platformSource.match(
    /const fetchBrokerHistory = async \([\s\S]*?\n  };\n\n  if \(isBrokerHistoryTimeframe\)/,
  )?.[0];

  assert.ok(constantsBlock);
  assert.ok(liveEdgeBlock);
  assert.ok(fullRecoveryBlock);
  assert.ok(priorityBucketBlock);
  assert.ok(fetchBrokerHistoryBlock);
  assert.match(constantsBlock, /const BARS_BROKER_LIVE_EDGE_MIN_PRIORITY = 6;/);
  assert.match(
    constantsBlock,
    /const BARS_FULL_BROKER_RECOVERY_MIN_PRIORITY = 10;/,
  );
  assert.match(liveEdgeBlock, /priority >= BARS_BROKER_LIVE_EDGE_MIN_PRIORITY/);
  assert.match(
    fullRecoveryBlock,
    /priority >= BARS_FULL_BROKER_RECOVERY_MIN_PRIORITY/,
  );
  assert.match(
    priorityBucketBlock,
    /priority as number\) >= BARS_BROKER_LIVE_EDGE_MIN_PRIORITY/,
  );
  assert.doesNotMatch(liveEdgeBlock, /BARS_FULL_BROKER_RECOVERY_MIN_PRIORITY/);
  assert.match(
    fetchBrokerHistoryBlock,
    /recoveryMode\?: "live-edge" \| "full"/,
  );
  assert.match(
    fetchBrokerHistoryBlock,
    /const recoveryMode = brokerHistoryOptions\.recoveryMode \?\? "live-edge";/,
  );
  assert.match(fetchBrokerHistoryBlock, /recoveryMode === "full" &&/);
  assert.match(
    fetchBrokerHistoryBlock,
    /fullBrokerRecovery\s*\?\s*BARS_BROKER_BACKFILL_BUDGET_MS\s*:\s*BARS_PROVIDER_BUDGET_MS/,
  );
  assert.match(
    fetchBrokerHistoryBlock,
    /fullBrokerRecovery \|\| !brokerHistoryMayBeRecentLimited/,
  );
  assert.match(
    fetchBrokerHistoryBlock,
    /fullBrokerRecovery &&\s*\n\s*bars\.length === 0/,
  );
  assert.match(
    platformSource,
    /fetchBrokerHistory\(brokerHistoryInput,\s*\{\s*recoveryMode: "live-edge",\s*\}\)/,
  );
  assert.match(
    platformSource,
    /fetchBrokerHistory\(input,\s*\{\s*recoveryMode: "full",\s*\}\)/,
  );
});
