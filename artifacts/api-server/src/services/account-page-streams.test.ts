import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ACCOUNT_PAGE_BENCHMARK_EQUITY_CACHE_TTL_MS,
  ACCOUNT_PAGE_CACHE_JITTER_MS,
  ACCOUNT_PAGE_CRITICAL_LIVE_CACHE_TTL_MS,
  ACCOUNT_PAGE_DERIVED_BOOT_DELAY_MS,
  ACCOUNT_PAGE_LIVE_BOOT_DELAY_MS,
  getAccountPageStreamDiagnostics,
} from "./account-page-streams";

test("account page stream starts live and derived work immediately after critical", () => {
  assert.equal(ACCOUNT_PAGE_LIVE_BOOT_DELAY_MS, 0);
  assert.equal(ACCOUNT_PAGE_DERIVED_BOOT_DELAY_MS, 0);
});

test("account page stream cache defaults reduce stampedes without slowing derived cadence", () => {
  assert.equal(ACCOUNT_PAGE_CRITICAL_LIVE_CACHE_TTL_MS, 2_000);
  assert.equal(ACCOUNT_PAGE_CACHE_JITTER_MS, 250);
  assert.equal(ACCOUNT_PAGE_BENCHMARK_EQUITY_CACHE_TTL_MS, 5 * 60_000);
});

test("account page stream diagnostics expose cache and timing fields", () => {
  const diagnostics = getAccountPageStreamDiagnostics();

  assert.equal(diagnostics.timings.criticalMs, null);
  assert.equal(diagnostics.timings.liveMs, null);
  assert.equal(diagnostics.timings.derivedMs, null);
  assert.equal(diagnostics.timings.firstCriticalWriteMs, null);
  assert.equal(diagnostics.timings.firstDerivedWriteMs, null);
  assert.equal(diagnostics.cache.criticalHit, null);
  assert.equal(diagnostics.cache.liveHit, null);
  assert.equal(diagnostics.cache.derivedHit, null);
  assert.equal(diagnostics.cache.benchmarkHit, null);
});

test("account page stream records write timing and benchmark cache sources", () => {
  const source = readFileSync(new URL("./account-page-streams.ts", import.meta.url), "utf8");
  const routeSource = readFileSync(new URL("../routes/platform.ts", import.meta.url), "utf8");

  assert.match(source, /accountPageBenchmarkEquityCache/);
  assert.match(source, /fetchAccountPageBenchmarkEquityHistory/);
  assert.match(source, /recordAccountPageCache\("benchmarkHit", true\)/);
  assert.match(routeSource, /recordAccountPageStreamWrite\("critical", streamStartedAt\)/);
  assert.match(routeSource, /recordAccountPageStreamWrite\("derived", writeStartedAt\)/);
});

test("shadow account page critical payload uses cached positions and fast risk", () => {
  const source = readFileSync(new URL("./account-page-streams.ts", import.meta.url), "utf8");
  const criticalBody = source.match(
    /export async function fetchAccountPageCriticalPayload\([\s\S]*?\nasync function fetchAccountPageBenchmarkEquityHistory/,
  )?.[0];

  assert.ok(criticalBody);
  assert.match(criticalBody, /const isShadow = isShadowAccountId\(normalized\.accountId\);/);
  assert.match(criticalBody, /if \(isShadow\) \{/);
  assert.match(criticalBody, /liveQuotes: false/);
  assert.match(source, /function deferredShadowClosedTrades\(accountId: string\)/);
  assert.match(source, /function deferredShadowOrders\(accountId: string, tab: OrderTab\)/);
  assert.doesNotMatch(
    criticalBody.match(/if \(isShadow\) \{[\s\S]*?\n      \} else \{/)?.[0] ?? "",
    /getAccountClosedTrades\(common\)/,
  );
  assert.doesNotMatch(
    criticalBody.match(/if \(isShadow\) \{[\s\S]*?\n      \} else \{/)?.[0] ?? "",
    /getAccountOrders\(/,
  );
  assert.match(criticalBody, /getShadowAccountSummaryFromPositions\(\{/);
  assert.match(criticalBody, /getShadowAccountAllocationFromPositions\(\{/);
  assert.doesNotMatch(
    criticalBody.match(/if \(isShadow\) \{[\s\S]*?\n      \} else \{/)?.[0] ?? "",
    /getAccountSummary\(common\)|getAccountAllocation\(common\)/,
  );
  assert.match(
    criticalBody,
    /getShadowAccountRisk\(\{\s*positionsResponse:[\s\S]*shadowPositions as NonNullable<ShadowRiskInput\["positionsResponse"\]>/,
  );
  assert.match(criticalBody, /closedTrades: deferredShadowClosedTrades\(normalized\.accountId\)/);
  assert.match(criticalBody, /detail: "fast"/);
  assert.match(criticalBody, /orders = deferredShadowOrders\(normalized\.accountId, normalized\.orderTab\)/);
  assert.match(criticalBody, /risk = await getAccountRisk\(common\)/);
});

test("shadow account page live payload refreshes deferred orders after critical", () => {
  const source = readFileSync(new URL("./account-page-streams.ts", import.meta.url), "utf8");
  const liveBody = source.match(
    /export async function fetchAccountPageLivePayload\([\s\S]*?\nexport async function fetchAccountPageCriticalPayload/,
  )?.[0];

  assert.ok(liveBody);
  assert.match(liveBody, /const isShadow = isShadowAccountId\(normalized\.accountId\);/);
  assert.match(liveBody, /isShadow\s*\?\s*getAccountOrders\(\{ \.\.\.common, tab: normalized\.orderTab \}\)/);
  assert.match(liveBody, /orders: shadowOrders \?\? critical\.orders/);
});
