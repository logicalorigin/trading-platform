import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const platformSource = readFileSync(new URL("./platform.ts", import.meta.url), "utf8");
const bridgeStreamsSource = readFileSync(
  new URL("./bridge-streams.ts", import.meta.url),
  "utf8",
);
const optionQuoteStreamSource = readFileSync(
  new URL("./bridge-option-quote-stream.ts", import.meta.url),
  "utf8",
);

test("public option-chain metadata policy bounds non-visible batch pressure", () => {
  assert.match(
    platformSource,
    /export const OPTION_CHAIN_PUBLIC_METADATA_TIMEOUT_MS = readPositiveIntegerEnv\(/,
  );
  assert.match(
    platformSource,
    /const OPTION_CHAIN_BATCH_CONCURRENCY = readPositiveIntegerEnv\(\s*"OPTION_CHAIN_BATCH_CONCURRENCY",\s*1,\s*\);/,
  );
  assert.match(
    platformSource,
    /function shouldYieldOptionChainBatchForPressure\(\)/,
  );
  assert.match(
    platformSource,
    /reason: "options_batch_deferred_pressure"/,
  );
  assert.match(
    platformSource,
    /emptyRetryDelaysMs\?: readonly number\[\];/,
  );
  assert.match(
    platformSource,
    /input\.emptyRetryDelaysMs \?\? OPTION_CHAIN_EMPTY_RETRY_DELAYS_MS/,
  );
  assert.match(
    platformSource,
    /Math\.max\(1, getOptionsFlowRuntimeConfig\(\)\.optionChainBatchConcurrency\)/,
  );
  assert.doesNotMatch(
    platformSource,
    /Math\.min\(1, getOptionsFlowRuntimeConfig\(\)\.optionChainBatchConcurrency\)/,
  );
});

test("option market data uses Massive instead of broker option-chain upstreams", () => {
  assert.match(platformSource, /getMassiveClient\(\)\.getOptionChain/);
  assert.match(platformSource, /getMassiveClient\(\)\.getHistoricalOptionContracts/);
  assert.match(platformSource, /source: "massive"/);
  assert.match(platformSource, /preferredTransport: "massive"/);
  assert.match(
    platformSource,
    /input\.assetClass !== "option" && !historicalSynthesisAvailable/,
  );
  assert.match(platformSource, /getOptionChartBarsWithDebug/);
  assert.match(platformSource, /getMassiveClient\(\)\.getOptionTradePrints/);
  assert.doesNotMatch(platformSource, /getIbkrClient\(\)\.getOptionChain/);
  assert.doesNotMatch(
    platformSource,
    /getIbkrClient\(\)\.getOptionExpirations/,
  );
  assert.doesNotMatch(platformSource, /OPTION_BROKER_LIVE_EDGE_MS/);
  assert.doesNotMatch(platformSource, /mergeIbkrAndMassiveOptionBars/);
  assert.doesNotMatch(platformSource, /shouldFetchMassiveOptionBarsForIbkrResult/);
  assert.doesNotMatch(platformSource, /family: "option-chart-bars"/);
  assert.doesNotMatch(platformSource, /preferredTransport: "tws"/);
  assert.doesNotMatch(platformSource, /getIbkrClient\(\)\s*\.getHealth\(\)/);
  assert.match(platformSource, /code: "option_market_depth_unavailable"/);
});

test("option quote snapshots use Massive OPRA snapshots instead of broker quote requests", () => {
  assert.match(optionQuoteStreamSource, /getOptionContractSnapshot/);
  assert.match(optionQuoteStreamSource, /normalizeOpraOptionTicker/);
  assert.doesNotMatch(
    optionQuoteStreamSource,
    /runBridgeWork\([\s\S]*getOptionQuoteSnapshots/,
  );
  assert.doesNotMatch(
    optionQuoteStreamSource,
    /bridgeClient\.streamOptionQuoteSnapshots/,
  );
});

test("option-chain streams fetch metadata rows without delayed quote hydration", () => {
  assert.match(bridgeStreamsSource, /quoteHydration: "metadata"/);
  assert.match(bridgeStreamsSource, /allowDelayedSnapshotHydration: false/);
  assert.match(bridgeStreamsSource, /timeoutMs: OPTION_CHAIN_PUBLIC_METADATA_TIMEOUT_MS/);
  assert.match(bridgeStreamsSource, /emptyRetryDelaysMs: \[\]/);
  assert.match(bridgeStreamsSource, /option_historical_bar_stream_uses_massive/);
  assert.match(bridgeStreamsSource, /option_market_depth_unavailable/);
});
