import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./ibkr-line-usage.ts", import.meta.url),
  "utf8",
);

function functionSource(name: string): string {
  const start = source.indexOf(`function ${name}`);
  const asyncStart = source.indexOf(`async function ${name}`);
  const offset = start >= 0 ? start : asyncStart;
  assert.notEqual(offset, -1, `Missing ${name}`);
  const nextFunction = source.indexOf("\nfunction ", offset + 1);
  const nextAsyncFunction = source.indexOf("\nasync function ", offset + 1);
  const nextExport = source.indexOf("\nexport ", offset + 1);
  const next = [nextFunction, nextAsyncFunction, nextExport]
    .filter((index) => index > offset)
    .sort((left, right) => left - right)[0];
  return source.slice(offset, next ?? source.length);
}

test("async sidecar generation apply uses a short fallback deadline", () => {
  assert.match(
    source,
    /DEFAULT_ASYNC_SIDECAR_GENERATION_APPLY_TIMEOUT_MS\s*=\s*2_500/,
  );

  const body = functionSource("applyAsyncSidecarMarketDataGeneration");
  assert.match(body, /const timeoutMs = asyncSidecarGenerationApplyTimeoutMs\(\)/);
  assert.match(body, /resolveMarketDataGenerationApplyWithin\([\s\S]*timeoutMs,[\s\S]*"ib-async-sidecar"/);
  assert.doesNotMatch(
    body,
    /resolveMarketDataGenerationApplyWithin\([\s\S]*marketDataGenerationApplyTimeoutMs\(\),[\s\S]*"ib-async-sidecar"/,
  );
});

test("async sidecar generation apply does not fall back to bridge generation", () => {
  const body = functionSource("applyMarketDataGeneration");

  assert.match(
    body,
    /input\.routeToAsyncSidecar\s*\?\s*await applyAsyncSidecarMarketDataGeneration\(input\)\s*:\s*await applyBridgeMarketDataGeneration\(input\)/,
  );
  assert.doesNotMatch(
    body,
    /input\.routeToAsyncSidecar\s*&&\s*result\.error/,
  );
  assert.doesNotMatch(
    body,
    /Async sidecar apply failed:[\s\S]*bridge fallback failed/,
  );
});

test("pending async sidecar generation reuses last target status", () => {
  const scheduleBody = functionSource("scheduleMarketDataGenerationApply");
  const readBody = functionSource("readMarketDataGenerationApplyState");

  assert.match(
    source,
    /latestMarketDataGenerationStatusByTarget/,
  );
  assert.match(
    source,
    /function rememberMarketDataGenerationStatus\(result: GenerationApplyResult\)/,
  );
  assert.match(
    scheduleBody,
    /rememberMarketDataGenerationStatus\(result\)/,
  );
  assert.match(
    scheduleBody,
    /status: latestMarketDataGenerationStatusForTarget\(\s*marketDataGenerationApplyInFlight\.target,\s*\)/,
  );
  assert.match(
    scheduleBody,
    /status: latestMarketDataGenerationStatusForTarget\(target\)/,
  );
  assert.match(
    readBody,
    /status: latestMarketDataGenerationStatusForTarget\(\s*marketDataGenerationApplyInFlight\.target,\s*\)/,
  );
  assert.match(
    readBody,
    /status: latestMarketDataGenerationStatusForTarget\(target\)/,
  );
});

test("desired generation lines count as bridge-owned for drift", () => {
  const helperBody = functionSource("isGenerationLineBridgeOwned");
  const subscriptionsBody = functionSource("buildSubscriptionsFromGenerationStatus");
  const comparisonBody = functionSource("buildSidecarGenerationComparison");

  assert.match(helperBody, /line\.state === "desired"/);
  assert.match(helperBody, /line\.state === "subscribing"/);
  assert.match(helperBody, /line\.state === "live"/);
  assert.match(subscriptionsBody, /filter\(isGenerationLineBridgeOwned\)/);
  assert.match(comparisonBody, /filter\(isGenerationLineBridgeOwned\)/);
});

test("pending generation drift is classified as settling until persistent", () => {
  const classifyBody = functionSource("classifyLineDrift");
  const reconciliationBody = functionSource("buildLineDriftReconciliation");
  const readApplyBody = functionSource("readMarketDataGenerationApplyState");
  const auditBody = functionSource("buildLineUtilizationAudit");

  assert.match(classifyBody, /\|\s*"settling"/);
  assert.match(classifyBody, /input\.settling/);
  assert.match(classifyBody, /input\.persistentApiOnlyCount === 0/);
  assert.match(classifyBody, /input\.persistentBridgeOnlyCount === 0/);
  assert.match(reconciliationBody, /settling\?: boolean/);
  assert.match(reconciliationBody, /settling: input\.settling/);
  assert.match(readApplyBody, /pending: true/);
  assert.match(auditBody, /status === "settling"[\s\S]*\? "generation-settling"/);
});

test("line generation coordinator is nudged by lease changes", () => {
  const startBody = functionSource("startIbkrLineUsageGenerationCoordinator");
  const stopBody = functionSource("stopIbkrLineUsageGenerationCoordinator");

  assert.match(source, /subscribeMarketDataLeaseChanges/);
  assert.match(
    source,
    /LINE_USAGE_GENERATION_COORDINATOR_LEASE_CHANGE_DEBOUNCE_MS\s*=\s*50/,
  );
  assert.match(startBody, /lineUsageGenerationCoordinatorRerunRequested = true/);
  assert.match(startBody, /subscribeMarketDataLeaseChanges\(\(event\) =>/);
  assert.match(startBody, /event\.lease\.lineIds\.length === 0/);
  assert.match(
    startBody,
    /requestRun\(LINE_USAGE_GENERATION_COORDINATOR_LEASE_CHANGE_DEBOUNCE_MS\)/,
  );
  assert.match(stopBody, /lineUsageGenerationCoordinatorUnsubscribe\(\)/);
  assert.match(stopBody, /clearTimeout\(lineUsageGenerationCoordinatorRequestedTimer\)/);
});
