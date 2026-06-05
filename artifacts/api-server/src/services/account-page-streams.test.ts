import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ACCOUNT_PAGE_BENCHMARK_EQUITY_CACHE_TTL_MS,
  ACCOUNT_PAGE_DERIVED_BOOT_DELAY_MS,
  ACCOUNT_PAGE_LIVE_BOOT_DELAY_MS,
  ACCOUNT_PAGE_SHADOW_CRITICAL_CACHE_TTL_MS,
  getAccountPageStreamDiagnostics,
} from "./account-page-streams";

test("account page stream starts live and derived work immediately after critical", () => {
  assert.equal(ACCOUNT_PAGE_LIVE_BOOT_DELAY_MS, 0);
  assert.equal(ACCOUNT_PAGE_DERIVED_BOOT_DELAY_MS, 0);
});

test("account page stream only caches derived benchmark overlays and shadow critical reads", () => {
  assert.equal(ACCOUNT_PAGE_BENCHMARK_EQUITY_CACHE_TTL_MS, 5 * 60_000);
  assert.equal(ACCOUNT_PAGE_SHADOW_CRITICAL_CACHE_TTL_MS, 2_000);
  const source = readFileSync(new URL("./account-page-streams.ts", import.meta.url), "utf8");

  assert.match(source, /accountPageShadowCriticalCache/);
  assert.doesNotMatch(source, /accountPageLiveCache/);
  assert.doesNotMatch(source, /accountPageSnapshotCache = new Map/);
  assert.doesNotMatch(source, /ACCOUNT_PAGE_CACHE_JITTER_MS/);
  assert.match(source, /accountPageShadowCriticalCache\.clear\(\)/);
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
  assert.match(criticalBody, /risk = await getAccountRisk\(\{ \.\.\.common, detail: "fast" \}\)/);
  assert.match(criticalBody, /accountPageShadowCriticalCache\.get\(cacheKey\)/);
  assert.match(criticalBody, /accountPageShadowCriticalCache\.set\(cacheKey/);
  assert.match(criticalBody, /recordAccountPageCache\("criticalHit", true\)/);
  assert.match(
    criticalBody,
    /recordAccountPageCache\("criticalHit", false\);\s*const inFlight = accountPageCriticalInflight\.get\(cacheKey\)/,
  );
});

test("shadow account page live payload refreshes deferred orders after critical", () => {
  const source = readFileSync(new URL("./account-page-streams.ts", import.meta.url), "utf8");
  const liveBody = source.match(
    /export async function fetchAccountPageLivePayload\([\s\S]*?\nexport async function fetchAccountPageCriticalPayload/,
  )?.[0];

  assert.ok(liveBody);
  assert.match(liveBody, /const isShadow = isShadowAccountId\(normalized\.accountId\);/);
  assert.match(liveBody, /isShadow\s*\?\s*getAccountOrders\(\{ \.\.\.common, tab: normalized\.orderTab \}\)/);
  assert.match(liveBody, /isShadow\s*\?\s*getAccountPositions\(\{[\s\S]*liveQuotes: true,/);
  assert.match(liveBody, /const positions = livePositions \?\? critical\.positions/);
  assert.match(liveBody, /getShadowAccountSummaryFromPositions\(\{/);
  assert.match(liveBody, /getShadowAccountAllocationFromPositions\(\{/);
  assert.match(liveBody, /getShadowAccountRisk\(\{/);
  assert.match(liveBody, /orders: shadowOrders \?\? critical\.orders/);
});

test("shadow account page derived payload serializes expensive reads", () => {
  const source = readFileSync(new URL("./account-page-streams.ts", import.meta.url), "utf8");
  const derivedBody = source.match(
    /export async function fetchAccountPageDerivedPayload\([\s\S]*?\nexport async function fetchAccountPageSnapshotPayload/,
  )?.[0];
  const shadowBranch = derivedBody?.match(/if \(isShadow\) \{[\s\S]*?\n      \} else \{/)?.[0];

  assert.ok(derivedBody);
  assert.ok(shadowBranch);
  assert.match(derivedBody, /const isShadow = isShadowAccountId\(normalized\.accountId\);/);
  assert.match(shadowBranch, /equityHistory = await getAccountEquityHistory/);
  assert.match(shadowBranch, /for \(const benchmark of benchmarkSymbols\)/);
  assert.match(shadowBranch, /cashActivity = await getAccountCashActivity\(common\)/);
  assert.match(shadowBranch, /flexHealth = null/);
  assert.doesNotMatch(shadowBranch, /Promise\.all/);
});

test("shadow account page bootstrap waits for live before derived", () => {
  const source = readFileSync(new URL("./account-page-streams.ts", import.meta.url), "utf8");
  const snapshotBody = source.match(
    /export async function fetchAccountPageSnapshotPayload\([\s\S]*?\nexport function subscribeAccountPageSnapshots/,
  )?.[0];

  assert.ok(snapshotBody);
  assert.match(
    snapshotBody,
    /if \(isShadowAccountId\(normalized\.accountId\)\) \{[\s\S]*live = await fetchAccountPageLivePayload\(normalized\);[\s\S]*derived = await fetchAccountPageDerivedPayload\(normalized\);/,
  );
  assert.match(
    snapshotBody,
    /else \{[\s\S]*\[live, derived\] = await Promise\.all\(\[/,
  );
});

test("shadow account page ignores mark refresh for immediate derived reticks", () => {
  const source = readFileSync(new URL("./account-page-streams.ts", import.meta.url), "utf8");
  const subscriptionBody = source.match(
    /const unsubscribeShadowChanges = isShadowAccountId\(input\.accountId\)[\s\S]*?\n\s*:\s*\(\) => undefined;/,
  )?.[0];
  const markRefreshBranch = subscriptionBody?.match(
    /if \(change\.reason === "mark_refresh"\) \{[\s\S]*?\n\s*\}/,
  )?.[0];

  assert.ok(subscriptionBody);
  assert.ok(markRefreshBranch);
  assert.match(subscriptionBody, /subscribeShadowAccountChanges\(\(change\) =>/);
  assert.match(markRefreshBranch, /return;/);
  assert.ok(
    subscriptionBody.indexOf('change.reason === "mark_refresh"') <
      subscriptionBody.indexOf("clearAccountPageSnapshotCache();"),
  );
  assert.ok(
    subscriptionBody.indexOf('change.reason === "mark_refresh"') <
      subscriptionBody.indexOf("void tickDerived();"),
  );
});
