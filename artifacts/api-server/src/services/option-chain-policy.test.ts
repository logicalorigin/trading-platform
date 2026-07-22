import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { afterEach } from "node:test";

import { HttpError } from "../lib/errors";
import {
  __platformOptionBackoffTestInternals as optionBackoff,
  __resetOptionChainCachesForTests,
  resetOptionsFlowRuntimeOverrides,
  setOptionsFlowRuntimeOverrides,
} from "./platform";

const platformSource = readFileSync(new URL("./platform.ts", import.meta.url), "utf8");
const platformRouteSource = readFileSync(
  new URL("../routes/platform.ts", import.meta.url),
  "utf8",
);
const bridgeStreamsSource = readFileSync(
  new URL("./bridge-streams.ts", import.meta.url),
  "utf8",
);
const optionQuoteStreamSource = readFileSync(
  new URL("./massive-option-quote-stream.ts", import.meta.url),
  "utf8",
);

afterEach(() => {
  resetOptionsFlowRuntimeOverrides();
  __resetOptionChainCachesForTests({ resetFlowScanner: false });
});

test("public option-chain metadata policy bounds non-visible batch pressure", () => {
  assert.match(
    platformSource,
    /export const OPTION_CHAIN_PUBLIC_METADATA_TIMEOUT_MS = readPositiveIntegerEnv\(/,
  );
  assert.match(
    platformSource,
    /const OPTION_CHAIN_BATCH_CONCURRENCY = readPositiveIntegerEnv\(\s*"OPTION_CHAIN_BATCH_CONCURRENCY",\s*1,\s*\);/,
  );
  // Owner directive 2026-07-07: option-chain batches never yield to resource
  // pressure (the yield starved entries and position marks). Guard against the
  // gate being reintroduced.
  assert.doesNotMatch(
    platformSource,
    /shouldYieldOptionChainBatchForPressure/,
  );
  assert.doesNotMatch(
    platformSource,
    /options_batch_deferred_pressure/,
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
    /Boolean\(options\.historicalSynthesisAvailable\) &&\s*input\.assetClass !== "option"/,
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

test("flow scanner quote snapshots do not retain live polling demand", () => {
  const start = platformSource.indexOf(
    "async function hydrateFlowScannerContractsFromLiveQuotes",
  );
  const end = platformSource.indexOf(
    "type FlowEventsTimeWindow",
    start,
  );
  assert.notEqual(start, -1, "missing flow-scanner quote hydration helper");
  assert.notEqual(end, -1, "missing flow-scanner quote hydration boundary");
  const block = platformSource.slice(start, end);

  assert.doesNotMatch(block, /releaseLeasesOnComplete:\s*false/);
  assert.doesNotMatch(block, /releaseLeasesOnAbort:\s*false/);
});

test("option-chain streams fetch metadata rows without delayed quote hydration", () => {
  assert.match(bridgeStreamsSource, /quoteHydration: "metadata"/);
  assert.match(bridgeStreamsSource, /allowDelayedSnapshotHydration: false/);
  assert.match(bridgeStreamsSource, /timeoutMs: OPTION_CHAIN_PUBLIC_METADATA_TIMEOUT_MS/);
  assert.match(bridgeStreamsSource, /emptyRetryDelaysMs: \[\]/);
});

test("public Trade option-chain routes retain the service-owned empty confirmation policy", () => {
  const chainStart = platformRouteSource.indexOf(
    'router.get("/options/chains"',
  );
  const batchStart = platformRouteSource.indexOf(
    'router.post("/options/chains/batch"',
  );
  const expirationStart = platformRouteSource.indexOf(
    'router.get("/options/expirations"',
  );
  assert.notEqual(chainStart, -1);
  assert.notEqual(batchStart, -1);
  assert.notEqual(expirationStart, -1);

  const chainHandler = platformRouteSource.slice(chainStart, batchStart);
  const batchHandler = platformRouteSource.slice(batchStart, expirationStart);
  assert.doesNotMatch(chainHandler, /emptyRetryDelaysMs:/);
  assert.doesNotMatch(batchHandler, /emptyRetryDelaysMs:/);
});

test("local option metadata timeout backs off only after consecutive stalls", () => {
  setOptionsFlowRuntimeOverrides({ optionUpstreamBackoffMs: 60_000 });
  const key = "chain:local-timeout";
  const error = new HttpError(
    504,
    "Option metadata request timed out after 1000ms.",
    {
      code: "massive_options_request_timeout",
    },
  );

  assert.equal(optionBackoff.isTransientOptionUpstreamError(error), true);
  assert.equal(optionBackoff.shouldBackOffOptionUpstream(error), false);

  optionBackoff.recordOptionUpstreamBackoff("chain", key, error);
  optionBackoff.recordOptionUpstreamBackoff("chain", key, error);

  assert.equal(optionBackoff.getOptionUpstreamBackoffRemainingMs("chain", key), 0);

  optionBackoff.recordOptionUpstreamBackoff("chain", key, error);

  assert.ok(optionBackoff.getOptionUpstreamBackoffRemainingMs("chain", key) > 0);
});

test("upstream 500 and 429 option errors set backoff", () => {
  setOptionsFlowRuntimeOverrides({ optionUpstreamBackoffMs: 60_000 });

  for (const statusCode of [500, 429]) {
    const key = `expiration:upstream-http-${statusCode}`;
    const error = new HttpError(statusCode, `HTTP ${statusCode}`, {
      code: "upstream_http_error",
    });

    assert.equal(optionBackoff.isTransientOptionUpstreamError(error), true);
    assert.equal(optionBackoff.shouldBackOffOptionUpstream(error), true);

    optionBackoff.recordOptionUpstreamBackoff("expiration", key, error);

    assert.ok(
      optionBackoff.getOptionUpstreamBackoffRemainingMs("expiration", key) > 0,
    );
  }
});

test("successful option fetch clears existing backoff for the key", () => {
  setOptionsFlowRuntimeOverrides({ optionUpstreamBackoffMs: 60_000 });
  const key = "chain:successful-refresh";
  const error = new HttpError(500, "HTTP 500", {
    code: "upstream_http_error",
  });

  optionBackoff.recordOptionUpstreamBackoff("chain", key, error);
  assert.ok(optionBackoff.getOptionUpstreamBackoffRemainingMs("chain", key) > 0);

  optionBackoff.clearOptionUpstreamBackoff("chain", key);

  assert.equal(optionBackoff.getOptionUpstreamBackoffRemainingMs("chain", key), 0);
});

test("successful option fetch resets consecutive local timeout count", () => {
  setOptionsFlowRuntimeOverrides({ optionUpstreamBackoffMs: 60_000 });
  const key = "chain:successful-after-timeouts";
  const error = new HttpError(504, "Local metadata budget exceeded.", {
    code: "massive_options_request_timeout",
  });

  optionBackoff.recordOptionUpstreamBackoff("chain", key, error);
  optionBackoff.recordOptionUpstreamBackoff("chain", key, error);
  assert.equal(optionBackoff.getOptionUpstreamBackoffRemainingMs("chain", key), 0);

  optionBackoff.clearOptionUpstreamBackoff("chain", key);
  optionBackoff.recordOptionUpstreamBackoff("chain", key, error);

  assert.equal(optionBackoff.getOptionUpstreamBackoffRemainingMs("chain", key), 0);
});

test("cache fallback predicate stays broad for transient local timeouts", () => {
  const localTimeout = new HttpError(504, "Local metadata budget exceeded.", {
    code: "massive_options_request_timeout",
  });
  const bridgeTimeout = new HttpError(504, "Retired bridge request timed out.", {
    code: "ibkr_bridge_request_timeout",
  });

  assert.equal(optionBackoff.isTransientOptionUpstreamError(localTimeout), true);
  assert.equal(optionBackoff.isTransientOptionUpstreamError(bridgeTimeout), true);
  assert.equal(optionBackoff.shouldBackOffOptionUpstream(localTimeout), false);
  assert.equal(optionBackoff.shouldBackOffOptionUpstream(bridgeTimeout), false);
});
