import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  applyAccountPageCriticalPayloadToCache,
  applyAccountPageDerivedPayloadToCache,
  applyAccountPageLivePayloadToCache,
  applyAccountPagePayloadToCache,
  applyIbkrAccountPayloadToCache,
  applyShadowAccountPayloadToCache,
  flushAccountPagePayloadQueue,
  getAccountPerformanceCalendarEquityQueryKey,
  getAccountPositionRowSnapshot,
  getAccountPageStreamUrl,
  getAlgoCockpitStreamUrl,
  getShadowAccountStreamUrl,
  getOptionChainContractExpirationKey,
  groupOptionChainContractsByExpiration,
  invalidateVisibleAccountDerivedQueries,
  isQuoteSnapshotAtLeastAsFresh,
  mergeOptionQuoteSnapshotForCache,
  mergeOptionChainContracts,
  mergeQuotesIntoCache,
  patchOptionQuotesIntoContracts,
  queueAccountPagePayloadToCache,
} from "./live-streams";

const optionQuote = (
  providerContractId: string,
  expirationDate: string,
  strike = 700,
) => ({
  contract: {
    ticker: providerContractId,
    underlying: "SPY",
    expirationDate,
    strike,
    right: "call" as const,
    multiplier: 100,
    sharesPerContract: 100,
    providerContractId,
  },
  bid: 1,
  ask: 1.1,
  last: 1.05,
  mark: 1.075,
  impliedVolatility: 0.2,
  delta: 0.5,
  gamma: 0.01,
  theta: -0.03,
  vega: 0.08,
  openInterest: 100,
  volume: 25,
  updatedAt: "2026-04-25T00:00:00.000Z",
});

test("getOptionChainContractExpirationKey normalizes API datetime strings", () => {
  assert.equal(
    getOptionChainContractExpirationKey(
      optionQuote("SPY-20260427-C700", "2026-04-27T00:00:00.000Z"),
    ),
    "2026-04-27",
  );
});

test("shadow account stream URL does not require query params", () => {
  assert.equal(getShadowAccountStreamUrl(), "/api/streams/accounts/shadow");
});

test("account page stream URL carries visible account page inputs", () => {
  assert.equal(
    getAccountPageStreamUrl({
      accountId: "combined",
      mode: "paper",
      range: "1D",
      orderTab: "working",
      assetClass: "Options",
      tradeFilters: {
        symbol: "SPY",
        assetClass: "Options",
        from: "2026-05-01T00:00:00.000Z",
      },
      performanceCalendarFrom: "2025-04-01T00:00:00.000Z",
    }),
    "/api/streams/accounts/page?accountId=combined&mode=paper&range=1D&orderTab=working&assetClass=Options&from=2026-05-01T00%3A00%3A00.000Z&symbol=SPY&tradeAssetClass=Options&performanceCalendarFrom=2025-04-01T00%3A00%3A00.000Z",
  );
});

test("algo cockpit stream URL carries mode and focused deployment", () => {
  assert.equal(
    getAlgoCockpitStreamUrl({
      deploymentId: "dep-123",
      mode: "live",
      eventLimit: 20,
    }),
    "/api/streams/algo/cockpit?deploymentId=dep-123&mode=live&eventLimit=20",
  );
});

test("account page stream is owned by the visible account screen", () => {
  const platformAppSource = readFileSync(new URL("./PlatformApp.jsx", import.meta.url), "utf8");
  const accountScreenSource = readFileSync(
    new URL("../../screens/AccountScreen.jsx", import.meta.url),
    "utf8",
  );

  assert.match(accountScreenSource, /useAccountPageSnapshotStream/);
  assert.ok(
    (accountScreenSource.match(/useAccountPageSnapshotStream\(\{/g) || []).length >= 2,
    "AccountScreen should subscribe to active and inactive account-page streams",
  );
  assert.doesNotMatch(platformAppSource, /useShadowAccountSnapshotStream/);
  assert.doesNotMatch(accountScreenSource, /useShadowAccountSnapshotStream/);
  assert.match(platformAppSource, /enabled:\s*workSchedule\.streams\.accountRealtime/);
  assert.match(
    accountScreenSource,
    /enabled:\s*accountPageStreamEnabled/,
  );
  assert.match(accountScreenSource, /isVisible && accountQueriesEnabled/);
  assert.match(accountScreenSource, /accountId:\s*inactiveAccountPageRequest\?\.accountId/);
  assert.match(accountScreenSource, /const inactiveAccountPageStreamEnabled = Boolean/);
  assert.match(
    accountScreenSource,
    /accountPageStreamEnabled &&[\s\S]*accountPageStreamFreshness\.accountCriticalFresh &&[\s\S]*inactiveAccountPageRequest/,
  );
  assert.match(accountScreenSource, /enabled:\s*inactiveAccountPageStreamEnabled/);
  assert.match(accountScreenSource, /accountPageStreamFresh:\s*accountPageStreamFreshness\.accountCriticalFresh/);
  assert.match(accountScreenSource, /const criticalAccountQueriesEnabled = Boolean/);
  assert.match(accountScreenSource, /const liveAccountQueriesEnabled = Boolean/);
  assert.match(accountScreenSource, /const derivedAccountQueriesEnabled = Boolean/);
  assert.match(accountScreenSource, /const equityHistoryQueriesEnabled = Boolean\(derivedAccountQueriesEnabled\)/);
  assert.match(accountScreenSource, /const secondaryAccountQueriesEnabled = Boolean\(derivedAccountQueriesEnabled\)/);
  assert.match(accountScreenSource, /const ACCOUNT_DERIVED_STALE_MS = 120_000/);
  assert.match(accountScreenSource, /placeholderData:\s*retainPreviousData/);
});

test("account page real requests follow the frame selected account", () => {
  const accountScreenSource = readFileSync(
    new URL("../../screens/AccountScreen.jsx", import.meta.url),
    "utf8",
  );
  const platformRouterSource = readFileSync(
    new URL("./PlatformScreenRouter.jsx", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(accountScreenSource, /accountViewId/);
  assert.match(
    accountScreenSource,
    /const activeAccountId = selectedAccountId \|\| "combined";/,
  );
  assert.match(
    accountScreenSource,
    /const accountRequestId = shadowMode \? SHADOW_ACCOUNT_ID : activeAccountId;/,
  );
  assert.match(platformRouterSource, /selectedAccountId=\{primaryAccountId\}/);
  assert.doesNotMatch(platformRouterSource, /onSelectTradingAccount/);
});

test("account page owns one account-monitor option quote stream for positions surfaces", () => {
  const accountScreenSource = readFileSync(
    new URL("../../screens/AccountScreen.jsx", import.meta.url),
    "utf8",
  );
  const todaySource = readFileSync(
    new URL("../../screens/account/TodaySnapshotPanel.jsx", import.meta.url),
    "utf8",
  );
  const positionsSource = readFileSync(
    new URL("../../screens/account/PositionsPanel.jsx", import.meta.url),
    "utf8",
  );
  const quoteStreamsSource = readFileSync(
    new URL("../../screens/account/PositionOptionQuoteStreams.jsx", import.meta.url),
    "utf8",
  );

  assert.match(accountScreenSource, /buildPositionOptionQuoteGroups/);
  assert.match(accountScreenSource, /buildPositionOptionQuoteGroups\(openAccountPositions\)/);
  assert.match(accountScreenSource, /accountQueriesEnabled && accountCriticalReady/);
  assert.doesNotMatch(accountScreenSource, /!shadowMode && accountQueriesEnabled && accountCriticalReady/);
  assert.match(accountScreenSource, /currentPositionsCount=\{openAccountPositions\.length\}/);
  assert.match(accountScreenSource, /<PositionOptionQuoteStreams/);
  assert.match(accountScreenSource, /groups=\{accountOptionQuoteGroups\}/);
  assert.match(accountScreenSource, /enabled=\{accountLiveOptionQuotesEnabled\}/);
  assert.match(accountScreenSource, /streamLiveOptionQuotes=\{false\}/);
  assert.match(todaySource, /getOpenPositionRows\(positionsQuery\?\.data\?\.positions \|\| \[\]\)/);
  assert.match(todaySource, /streamLiveOptionQuotes = true/);
  assert.match(positionsSource, /streamLiveOptionQuotes = true/);
  assert.match(positionsSource, /useRegisterPositionMarketDataSymbols\(\s*`positions:\$\{surfaceId\}`,\s*positionUnderlyingSymbols,\s*liveOptionQuotesEnabled,\s*\)/);
  assert.match(quoteStreamsSource, /intent: "account-monitor-live"/);
});

test("option quote REST fallback preserves websocket owner and intent", () => {
  const source = readFileSync(new URL("./live-streams.ts", import.meta.url), "utf8");
  const fallbackCall = source.match(
    /getOptionQuoteSnapshots\(\{[\s\S]*?providerContractIds: fallbackProviderContractIds,[\s\S]*?\}\)/,
  )?.[0] ?? "";

  assert.match(fallbackCall, /owner: normalizedOwner \|\| undefined/);
  assert.match(fallbackCall, /intent,/);
  assert.match(fallbackCall, /requiresGreeks,/);
});

test("account critical queries stay mounted after page readiness", () => {
  const accountScreenSource = readFileSync(
    new URL("../../screens/AccountScreen.jsx", import.meta.url),
    "utf8",
  );
  const criticalGate = accountScreenSource.match(
    /const criticalAccountQueriesEnabled = Boolean\([\s\S]*?\n  \);/,
  )?.[0] ?? "";

  assert.match(criticalGate, /accountQueriesEnabled && accountCriticalReady/);
  assert.doesNotMatch(criticalGate, /accountCriticalFallbackReady/);
  assert.doesNotMatch(criticalGate, /accountPageStreamFreshness\.accountCriticalFresh/);
});

test("broker account and order streams refresh freshness on readiness and poll success", () => {
  const source = readFileSync(new URL("./live-streams.ts", import.meta.url), "utf8");

  assert.match(source, /source\.addEventListener\("ready", handleReady as EventListener\)/);
  assert.match(
    source,
    /source\.addEventListener\("freshness", handleFreshness as EventListener\)/,
  );
  assert.match(source, /markBrokerStreamEvent\("account"\)/);
  assert.match(source, /markBrokerStreamEvent\("order"\)/);
});

test("stock quote stream batches React Query cache writes", () => {
  const source = readFileSync(new URL("./live-streams.ts", import.meta.url), "utf8");
  const hookSource = source.match(
    /const useQuoteSnapshotStream = \([\s\S]*?\nexport const useIbkrAccountSnapshotStream/,
  )?.[0];

  assert.match(source, /QUOTE_STREAM_CACHE_FLUSH_MS\s*=\s*100/);
  assert.match(hookSource ?? "", /pendingQuoteStreamSnapshotsRef/);
  assert.match(
    hookSource ?? "",
    /setTimeout\(\s*flushQuoteStreamSnapshots,\s*QUOTE_STREAM_CACHE_FLUSH_MS/,
  );
  assert.match(hookSource ?? "", /queryClient\.setQueryData/);
  assert.match(hookSource ?? "", /flushQuoteStreamSnapshots\(\)/);
  assert.match(source, /streamPath: "\/api\/streams\/quotes"/);
  assert.match(source, /streamPath: "\/api\/streams\/position-quotes"/);
});

test("shadow account stream refreshes freshness on readiness and poll success", () => {
  const source = readFileSync(new URL("./live-streams.ts", import.meta.url), "utf8");

  assert.match(source, /markShadowAccountStreamEvent\(\)/);
  assert.match(source, /payload\.stream !== "shadow-accounts"/);
  assert.match(source, /source\.addEventListener\("ready", handleReady as EventListener\)/);
  assert.match(
    source,
    /source\.addEventListener\("freshness", handleFreshness as EventListener\)/,
  );
});

test("account page stream refreshes freshness on page snapshots", () => {
  const source = readFileSync(new URL("./live-streams.ts", import.meta.url), "utf8");
  const accountPageHook = source.match(
    /export const useAccountPageSnapshotStream = \([\s\S]*?\nexport const applyAlgoCockpitPayloadToCache/,
  )?.[0];

  assert.match(source, /source\.addEventListener\("bootstrap", handleBootstrap as EventListener\)/);
  assert.match(source, /source\.addEventListener\("critical", handleCritical as EventListener\)/);
  assert.match(source, /source\.addEventListener\("live", handleLive as EventListener\)/);
  assert.match(source, /source\.addEventListener\("derived", handleDerived as EventListener\)/);
  assert.match(source, /queueAccountPagePayloadToCache\(queryClient, "bootstrap", payload\)/);
  assert.match(source, /queueAccountPagePayloadToCache\(queryClient, "critical", payload\)/);
  assert.match(source, /queueAccountPagePayloadToCache\(queryClient, "live", payload\)/);
  assert.match(source, /queueAccountPagePayloadToCache\(queryClient, "derived", payload\)/);
  assert.match(source, /requestAnimationFrame/);
  assert.match(source, /tradeFilters\?\.from,\s*tradeFilters\?\.assetClass,/);
  assert.match(source, /payload\.stream !== "account-page-bootstrap"/);
  assert.match(source, /payload\.stream !== "account-page-critical"/);
  assert.match(source, /payload\.stream !== "account-page-live"/);
  assert.match(source, /payload\.stream !== "account-page-derived"/);
  assert.match(source, /export const useAccountPositionRow/);
  assert.match(source, /export const useAccountSummaryField/);
  assert.match(source, /export const useBrokerFreshnessFor/);
  assert.ok(accountPageHook);
  assert.doesNotMatch(accountPageHook, /addEventListener\("ready", markFresh/);
});

test("account page derived freshness stays slow while Account UI fallback is short", () => {
  const source = readFileSync(new URL("./live-streams.ts", import.meta.url), "utf8");
  const accountScreenSource = readFileSync(
    new URL("../../screens/AccountScreen.jsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /const ACCOUNT_PAGE_DERIVED_STREAM_FRESH_MS = 35_000;/);
  assert.match(
    source,
    /accountDerivedFresh:[\s\S]*ACCOUNT_PAGE_DERIVED_STREAM_FRESH_MS/,
  );
  assert.match(
    accountScreenSource,
    /const ACCOUNT_DERIVED_FALLBACK_DELAY_MS = 6_000;/,
  );
});

test("algo cockpit stream hydrates query caches and gates fallback polling", () => {
  const liveStreamsSource = readFileSync(new URL("./live-streams.ts", import.meta.url), "utf8");
  const algoScreenSource = readFileSync(
    new URL("../../screens/AlgoScreen.jsx", import.meta.url),
    "utf8",
  );

  assert.match(liveStreamsSource, /export const useAlgoCockpitStream/);
  assert.match(liveStreamsSource, /getListAlgoDeploymentsQueryKey\(\)/);
  assert.match(liveStreamsSource, /getListExecutionEventsQueryKey/);
  assert.match(liveStreamsSource, /getGetAlgoDeploymentCockpitQueryKey/);
  assert.match(liveStreamsSource, /getGetSignalOptionsAutomationStateQueryKey/);
  assert.match(liveStreamsSource, /getGetSignalOptionsPerformanceQueryKey/);
  assert.match(liveStreamsSource, /getGetSignalMonitorProfileQueryKey/);
  assert.match(liveStreamsSource, /phase\?: "critical" \| "full" \| null/);
  assert.match(liveStreamsSource, /if \(payload\.phase === "full"\)[\s\S]*markFresh\("full"\)/);
  assert.match(liveStreamsSource, /else if \(payload\.phase === "critical"\)[\s\S]*markFresh\("critical"\)/);
  assert.match(algoScreenSource, /useAlgoCockpitStream/);
  assert.match(algoScreenSource, /algoRoutineRefetchInterval/);
  assert.match(algoScreenSource, /algoCriticalQueriesEnabled/);
  assert.match(algoScreenSource, /algoDerivedQueriesEnabled/);
  assert.match(algoScreenSource, /algoDerivedFallbackReady[\s\S]*!algoCockpitStreamFreshness\.algoFullFresh/);
  assert.match(algoScreenSource, /algoPostCriticalQueriesEnabled[\s\S]*!shadowAccountStreamFreshness\.accountFresh/);
  assert.match(algoScreenSource, /signalOptionsLedgerPositionsRefetchInterval[\s\S]*60_000/);
  assert.match(algoScreenSource, /algoCockpitStreamFreshness\.algoCriticalFresh/);
  assert.match(algoScreenSource, /algoCockpitStreamFreshness\.algoFullFresh/);
  assert.match(algoScreenSource, /deploymentSignalOptionsProfile/);
  assert.match(algoScreenSource, /controlBaselineReady/);
  assert.match(
    algoScreenSource,
    /signalOptionsState\?\.profile \|\|[\s\S]*deploymentSignalOptionsProfile \|\|[\s\S]*SIGNAL_OPTIONS_DEFAULT_PROFILE/,
  );
});

test("algo cockpit stream exposes live event callback without replaying bootstrap", () => {
  const liveStreamsSource = readFileSync(new URL("./live-streams.ts", import.meta.url), "utf8");
  const bootstrapHandler =
    liveStreamsSource.match(/const handleBootstrap =[\s\S]*?};/)?.[0] ?? "";

  assert.match(liveStreamsSource, /onLiveEvents\?:/);
  assert.match(liveStreamsSource, /const onLiveEventsRef = useRef\(onLiveEvents\)/);
  assert.match(liveStreamsSource, /onLiveEventsRef\.current = onLiveEvents/);
  assert.match(
    liveStreamsSource,
    /if \(expectedStream === "algo-cockpit-live"\) \{[\s\S]*onLiveEventsRef\.current\?\.\(payload\.events\?\.events \?\? \[\], \{[\s\S]*phase: payload\.phase \?\? null/,
  );
  assert.doesNotMatch(bootstrapHandler, /onLiveEvents/);
});

test("platform root subscribes only to coarse broker stream freshness", () => {
  const platformAppSource = readFileSync(new URL("./PlatformApp.jsx", import.meta.url), "utf8");
  const liveStreamsSource = readFileSync(new URL("./live-streams.ts", import.meta.url), "utf8");

  assert.match(platformAppSource, /useBrokerStreamFreshnessStatus/);
  assert.doesNotMatch(platformAppSource, /useBrokerStreamFreshnessSnapshot/);
  assert.match(liveStreamsSource, /getBrokerStreamFreshnessStatusToken/);
});

test("groupOptionChainContractsByExpiration keeps stream contracts scoped to their expirations", () => {
  const grouped = groupOptionChainContractsByExpiration([
    optionQuote("SPY-20260427-C700", "2026-04-27T00:00:00.000Z"),
    optionQuote("SPY-20260427-P700", "2026-04-27T00:00:00.000Z"),
    optionQuote("SPY-20260501-C700", "2026-05-01T00:00:00.000Z"),
  ]);

  assert.deepEqual([...grouped.keys()], ["2026-04-27", "2026-05-01"]);
  assert.deepEqual(
    grouped.get("2026-04-27")?.map((quote) => quote.contract.providerContractId),
    ["SPY-20260427-C700", "SPY-20260427-P700"],
  );
  assert.deepEqual(
    grouped.get("2026-05-01")?.map((quote) => quote.contract.providerContractId),
    ["SPY-20260501-C700"],
  );
});

test("mergeOptionChainContracts preserves full metadata rows when a narrow update arrives", () => {
  const current = [
    optionQuote("SPY-20260427-C695", "2026-04-27T00:00:00.000Z", 695),
    optionQuote("SPY-20260427-C700", "2026-04-27T00:00:00.000Z", 700),
    optionQuote("SPY-20260427-C705", "2026-04-27T00:00:00.000Z", 705),
  ];
  const narrow = [
    {
      ...optionQuote("SPY-20260427-C700", "2026-04-27T00:00:00.000Z", 700),
      bid: 1.5,
      updatedAt: "2026-04-25T00:00:01.000Z",
    },
  ];

  const merged = mergeOptionChainContracts(current, narrow);

  assert.deepEqual(
    merged.map((quote) => quote.contract.providerContractId),
    ["SPY-20260427-C695", "SPY-20260427-C700", "SPY-20260427-C705"],
  );
  assert.equal(
    merged.find(
      (quote) => quote.contract.providerContractId === "SPY-20260427-C700",
    )?.bid,
    1.5,
  );
});

test("mergeOptionChainContracts keeps expiration sorting deterministic with malformed dates", () => {
  const merged = mergeOptionChainContracts(undefined, [
    optionQuote("SPY-invalid-C700", "not-a-date", 700),
    optionQuote("SPY-20260501-C700", "2026-05-01", 700),
    optionQuote("SPY-20260427-C700", "2026-04-27T00:00:00.000Z", 700),
  ]);

  assert.deepEqual(
    merged.map((quote) => quote.contract.providerContractId),
    ["SPY-20260427-C700", "SPY-20260501-C700", "SPY-invalid-C700"],
  );
});

test("patchOptionQuotesIntoContracts marks metadata contracts as hydrated when live quotes arrive", () => {
  const metadataContract = {
    ...optionQuote("SPY-20260427-C700", "2026-04-27T00:00:00.000Z", 700),
    bid: null,
    ask: null,
    last: null,
    mark: null,
    volume: null,
    openInterest: null,
    quoteFreshness: "metadata" as const,
    marketDataMode: null,
    quoteUpdatedAt: null,
    dataUpdatedAt: null,
  };
  const patched = patchOptionQuotesIntoContracts([metadataContract], [
    {
      symbol: "SPY",
      price: 1.18,
      bid: 1.15,
      ask: 1.2,
      bidSize: 10,
      askSize: 12,
      change: 0.05,
      changePercent: 4.4,
      open: null,
      high: null,
      low: null,
      prevClose: null,
      volume: 80,
      openInterest: 250,
      impliedVolatility: 0.24,
      delta: 0.52,
      gamma: 0.02,
      theta: -0.04,
      vega: 0.09,
      providerContractId: "SPY-20260427-C700",
      source: "ibkr",
      transport: "tws",
      delayed: false,
      freshness: "live",
      marketDataMode: "live",
      dataUpdatedAt: "2026-04-28T14:30:00.000Z",
      ageMs: 12,
      cacheAgeMs: 12,
      latency: null,
      updatedAt: "2026-04-28T14:30:00.000Z",
    },
  ]);

  assert.equal(patched[0]?.bid, 1.15);
  assert.equal(patched[0]?.ask, 1.2);
  assert.equal(patched[0]?.last, 1.18);
  assert.equal(patched[0]?.mark, 1.1749999999999998);
  assert.equal(patched[0]?.volume, 80);
  assert.equal(patched[0]?.openInterest, 250);
  assert.equal(patched[0]?.quoteFreshness, "live");
  assert.equal(patched[0]?.marketDataMode, "live");
  assert.equal(patched[0]?.quoteUpdatedAt, "2026-04-28T14:30:00.000Z");
  assert.equal(patched[0]?.dataUpdatedAt, "2026-04-28T14:30:00.000Z");
  assert.equal(patched[0]?.ageMs, 12);
});

test("patchOptionQuotesIntoContracts does not zero prices from partial quote snapshots", () => {
  const currentContract = optionQuote(
    "SPY-20260427-C700",
    "2026-04-27T00:00:00.000Z",
    700,
  );
  const patched = patchOptionQuotesIntoContracts([currentContract], [
    {
      symbol: "SPY",
      price: 0,
      bid: 0,
      ask: 0,
      bidSize: 0,
      askSize: 0,
      change: 0,
      changePercent: 0,
      open: null,
      high: null,
      low: null,
      prevClose: null,
      volume: 80,
      openInterest: 250,
      impliedVolatility: 0.24,
      delta: 0.52,
      gamma: 0.02,
      theta: -0.04,
      vega: 0.09,
      providerContractId: "SPY-20260427-C700",
      source: "ibkr",
      transport: "tws",
      delayed: false,
      freshness: "live",
      marketDataMode: "live",
      dataUpdatedAt: "2026-04-28T14:30:00.000Z",
      ageMs: 12,
      cacheAgeMs: 12,
      latency: null,
      updatedAt: "2026-04-28T14:30:00.000Z",
    },
  ]);

  assert.equal(patched[0]?.bid, currentContract.bid);
  assert.equal(patched[0]?.ask, currentContract.ask);
  assert.equal(patched[0]?.last, currentContract.last);
  assert.equal(patched[0]?.mark, currentContract.mark);
  assert.equal(patched[0]?.openInterest, 250);
  assert.equal(patched[0]?.delta, 0.52);
});

test("option quote cache merge preserves usable prices from partial zero snapshots", () => {
  const currentQuote = {
    symbol: "SPY",
    price: 1.05,
    bid: 1,
    ask: 1.1,
    bidSize: 10,
    askSize: 10,
    change: 0,
    changePercent: 1.25,
    open: null,
    high: null,
    low: null,
    prevClose: null,
    volume: 25,
    openInterest: 100,
    impliedVolatility: 0.2,
    delta: 0.5,
    gamma: 0.01,
    theta: -0.03,
    vega: 0.08,
    providerContractId: "SPY-20260427-C700",
    source: "ibkr",
    transport: "tws",
    delayed: false,
    freshness: "live",
    marketDataMode: "live",
    dataUpdatedAt: "2026-04-28T14:29:00.000Z",
    ageMs: 20,
    cacheAgeMs: 20,
    latency: null,
    updatedAt: "2026-04-28T14:29:00.000Z",
  };
  const merged = mergeOptionQuoteSnapshotForCache(
    currentQuote,
    {
      ...currentQuote,
      price: 0,
      bid: 0,
      ask: 0,
      change: -1.05,
      changePercent: -100,
      volume: 80,
      openInterest: 250,
      delta: 0.52,
      dataUpdatedAt: "2026-04-28T14:30:00.000Z",
      ageMs: 12,
      cacheAgeMs: 12,
      updatedAt: "2026-04-28T14:30:00.000Z",
    },
    "SPY-20260427-C700",
  );

  assert.equal(merged.price, 1.05);
  assert.equal(merged.bid, 1);
  assert.equal(merged.ask, 1.1);
  assert.equal(merged.change, 0);
  assert.equal(merged.changePercent, 1.25);
  assert.equal(merged.volume, 80);
  assert.equal(merged.openInterest, 250);
  assert.equal(merged.delta, 0.52);
  assert.equal(merged.updatedAt, "2026-04-28T14:30:00.000Z");
});

const stockQuote = (
  symbol: string,
  price: number,
  updatedAt: string,
  dataUpdatedAt = updatedAt,
) => ({
  symbol,
  price,
  bid: price - 0.01,
  ask: price + 0.01,
  bidSize: 100,
  askSize: 100,
  change: 1,
  changePercent: 1,
  open: price - 1,
  high: price + 1,
  low: price - 2,
  prevClose: price - 1,
  volume: 1_000,
  providerContractId: `${symbol}-conid`,
  source: "ibkr" as const,
  transport: "tws" as const,
  delayed: false,
  updatedAt,
  dataUpdatedAt,
});

test("isQuoteSnapshotAtLeastAsFresh rejects older quote snapshots", () => {
  const current = stockQuote("SPY", 502, "2026-04-28T14:30:02.000Z");
  const older = stockQuote("SPY", 499, "2026-04-28T14:29:58.000Z");
  const newer = stockQuote("SPY", 503, "2026-04-28T14:30:03.000Z");

  assert.equal(isQuoteSnapshotAtLeastAsFresh(older, current), false);
  assert.equal(isQuoteSnapshotAtLeastAsFresh(newer, current), true);
});

test("isQuoteSnapshotAtLeastAsFresh compares dataUpdatedAt before wrapper updatedAt", () => {
  const current = stockQuote(
    "SPY",
    502,
    "2026-04-28T14:30:05.000Z",
    "2026-04-28T14:30:02.000Z",
  );
  const staleRewrapped = stockQuote(
    "SPY",
    499,
    "2026-04-28T14:31:00.000Z",
    "2026-04-28T14:29:58.000Z",
  );

  assert.equal(isQuoteSnapshotAtLeastAsFresh(staleRewrapped, current), false);
});

test("isQuoteSnapshotAtLeastAsFresh accepts newer same-data-time quote events", () => {
  const current = {
    ...stockQuote(
      "SPY",
      502,
      "2026-04-28T14:30:02.000Z",
      "2026-04-28T14:30:02.000Z",
    ),
    latency: {
      apiServerReceivedAt: "2026-04-28T14:30:02.100Z",
      apiServerEmittedAt: "2026-04-28T14:30:02.200Z",
    },
  };
  const incoming = {
    ...stockQuote(
      "SPY",
      503,
      "2026-04-28T14:30:02.000Z",
      "2026-04-28T14:30:02.000Z",
    ),
    latency: {
      apiServerReceivedAt: "2026-04-28T14:30:02.300Z",
      apiServerEmittedAt: "2026-04-28T14:30:02.400Z",
    },
  };

  assert.equal(isQuoteSnapshotAtLeastAsFresh(incoming, current), true);
});

test("mergeQuotesIntoCache keeps canonical quote when incoming snapshot is older", () => {
  const current = {
    quotes: [stockQuote("SPY", 502, "2026-04-28T14:30:02.000Z")],
    transport: "tws" as const,
    delayed: false,
    fallbackUsed: false,
  };
  const merged = mergeQuotesIntoCache(
    current,
    [stockQuote("SPY", 499, "2026-04-28T14:29:58.000Z")],
    ["SPY"],
  );

  assert.equal(merged?.quotes[0]?.price, 502);
});

test("mergeQuotesIntoCache keeps canonical quote when same-timestamp values conflict", () => {
  const current = {
    quotes: [stockQuote("SPY", 502, "2026-04-28T14:30:02.000Z")],
    transport: "tws" as const,
    delayed: false,
    fallbackUsed: false,
  };
  const conflicting = {
    ...stockQuote("SPY", 499, "2026-04-28T14:30:02.000Z"),
    latency: {
      apiServerReceivedAt: "2026-04-28T14:30:05.000Z",
      apiServerEmittedAt: "2026-04-28T14:30:05.100Z",
    },
  };
  const merged = mergeQuotesIntoCache(current, [conflicting], ["SPY"]);

  assert.equal(merged?.quotes[0]?.price, 502);
});

test("mergeQuotesIntoCache accepts same-timestamp quote with newer receive time", () => {
  const current = {
    quotes: [
      {
        ...stockQuote("SPY", 502, "2026-04-28T14:30:02.000Z"),
        latency: {
          apiServerReceivedAt: "2026-04-28T14:30:02.100Z",
          apiServerEmittedAt: "2026-04-28T14:30:02.200Z",
        },
      },
    ],
    transport: "tws" as const,
    delayed: false,
    fallbackUsed: false,
  };
  const incoming = {
    ...stockQuote("SPY", 503, "2026-04-28T14:30:02.000Z"),
    latency: {
      apiServerReceivedAt: "2026-04-28T14:30:02.300Z",
      apiServerEmittedAt: "2026-04-28T14:30:02.400Z",
    },
  };
  const merged = mergeQuotesIntoCache(current, [incoming], ["SPY"]);

  assert.equal(merged?.quotes[0]?.price, 503);
});

const createMockQueryClient = (
  queryKeys: unknown[][],
  initialData: Map<string, unknown> = new Map(),
) => {
  const queries = queryKeys.map((queryKey) => ({ queryKey }));
  const writes = new Map(initialData);
  const invalidated: unknown[][] = [];
  return {
    writes,
    invalidated,
    queryClient: {
      getQueryCache: () => ({
        findAll: ({ queryKey, predicate }: any = {}) =>
          queries.filter((query) => {
            if (queryKey) {
              const requested = JSON.stringify(queryKey);
              if (!JSON.stringify(query.queryKey).startsWith(requested.slice(0, -1))) {
                return false;
              }
            }
            return predicate ? predicate(query) : true;
          }),
      }),
      setQueryData: (queryKey: unknown[], value: unknown) => {
        const key = JSON.stringify(queryKey);
        const previous = writes.get(key);
        const next =
          typeof value === "function"
            ? (value as (current: unknown) => unknown)(previous)
            : value;
        if (next !== undefined) {
          writes.set(key, next);
        }
      },
      invalidateQueries: ({ predicate }: any = {}) => {
        queries.forEach((query) => {
          if (!predicate || predicate(query)) {
            invalidated.push(query.queryKey);
          }
        });
      },
    },
  };
};

test("applyShadowAccountPayloadToCache patches shadow account caches without invalidating derived views", () => {
  const summary = { accountId: "shadow", metrics: { netLiquidation: { value: 100_500 } } };
  const positions = {
    accountId: "shadow",
    positions: [
      { id: "stock", accountId: "shadow", assetClass: "Stocks", symbol: "SPY" },
      { id: "option", accountId: "shadow", assetClass: "Options", symbol: "SPY" },
    ],
  };
  const workingOrders = {
    accountId: "shadow",
    tab: "working",
    orders: [{ id: "working", accountId: "shadow", status: "submitted" }],
  };
  const historyOrders = {
    accountId: "shadow",
    tab: "history",
    orders: [{ id: "filled", accountId: "shadow", status: "filled" }],
  };
  const allocation = { accountId: "shadow", assetClass: [{ label: "Cash" }] };
  const risk = { accountId: "shadow", margin: { marginAvailable: 100_000 } };
  const { queryClient, writes, invalidated } = createMockQueryClient([
    ["/api/accounts/shadow/summary", { mode: "paper" }],
    ["/api/accounts/shadow/summary", { mode: "paper", source: "signal_options_replay" }],
    ["/api/accounts/shadow/positions", { mode: "paper", assetClass: "Options" }],
    [
      "/api/accounts/shadow/positions",
      { mode: "paper", assetClass: "Options", source: "signal_options_replay" },
    ],
    ["/api/accounts/shadow/orders", { mode: "paper", tab: "history" }],
    [
      "/api/accounts/shadow/orders",
      { mode: "paper", tab: "history", source: "signal_options_replay" },
    ],
    ["/api/accounts/shadow/allocation", { mode: "paper" }],
    ["/api/accounts/shadow/risk", { mode: "paper" }],
    ["/api/accounts/shadow/equity-history", { mode: "paper", range: "ALL" }],
    ["/api/accounts/shadow/closed-trades", { mode: "paper" }],
    ["/api/accounts/shadow/cash-activity", { mode: "paper" }],
    ["/api/accounts/U1/summary", { mode: "paper" }],
  ]);

  applyShadowAccountPayloadToCache(queryClient as any, {
    summary,
    positions,
    workingOrders,
    historyOrders,
    allocation,
    risk,
    updatedAt: "2026-04-30T00:00:00.000Z",
  } as any);

  assert.equal(
    (writes.get(JSON.stringify(["/api/accounts/shadow/summary", { mode: "paper" }])) as any)
      ?.metrics.netLiquidation.value,
    100_500,
  );
  assert.deepEqual(
    (
      writes.get(
        JSON.stringify([
          "/api/accounts/shadow/positions",
          { mode: "paper", assetClass: "Options" },
        ]),
      ) as any
    )?.positions.map((position: any) => position.id),
    ["option"],
  );
  assert.deepEqual(
    (
      writes.get(
        JSON.stringify([
          "/api/accounts/shadow/orders",
          { mode: "paper", tab: "history" },
        ]),
      ) as any
    )?.orders.map((order: any) => order.id),
    ["filled"],
  );
  assert.equal(
    (writes.get(JSON.stringify(["/api/accounts/shadow/allocation", { mode: "paper" }])) as any)
      ?.assetClass[0].label,
    "Cash",
  );
  assert.equal(
    writes.get(
      JSON.stringify([
        "/api/accounts/shadow/summary",
        { mode: "paper", source: "signal_options_replay" },
      ]),
    ),
    undefined,
  );
  assert.equal(
    writes.get(
      JSON.stringify([
        "/api/accounts/shadow/positions",
        { mode: "paper", assetClass: "Options", source: "signal_options_replay" },
      ]),
    ),
    undefined,
  );
  assert.equal(
    writes.get(
      JSON.stringify([
        "/api/accounts/shadow/orders",
        { mode: "paper", tab: "history", source: "signal_options_replay" },
      ]),
    ),
    undefined,
  );
  assert.equal(invalidated.length, 0);
});

test("applyShadowAccountPayloadToCache keeps good shadow values over degraded stream fallback", () => {
  const summaryKey = ["/api/accounts/shadow/summary", { mode: "paper" }];
  const initialData = new Map<string, unknown>([
    [
      JSON.stringify(summaryKey),
      {
        accountId: "shadow",
        degraded: false,
        metrics: { netLiquidation: { value: 177_800, source: "SHADOW_LEDGER" } },
      },
    ],
  ]);
  const { queryClient, writes } = createMockQueryClient(
    [summaryKey as unknown as unknown[]],
    initialData,
  );

  applyShadowAccountPayloadToCache(queryClient as any, {
    summary: {
      accountId: "shadow",
      degraded: true,
      metrics: { netLiquidation: { value: 25_000, source: "SHADOW_RUNTIME_FALLBACK" } },
    },
    positions: { accountId: "shadow", positions: [] },
    workingOrders: { accountId: "shadow", tab: "working", orders: [] },
    historyOrders: { accountId: "shadow", tab: "history", orders: [] },
    allocation: { accountId: "shadow", degraded: true, assetClass: [] },
    risk: { accountId: "shadow", degraded: true, margin: {} },
    updatedAt: "2026-05-27T15:30:00.000Z",
  } as any);

  const patched = writes.get(JSON.stringify(summaryKey)) as any;
  assert.equal(patched.degraded, false);
  assert.equal(patched.metrics.netLiquidation.value, 177_800);
  assert.equal(patched.metrics.netLiquidation.source, "SHADOW_LEDGER");
});

test("applyAccountPagePayloadToCache seeds visible account page query caches", () => {
  const summaryKey = ["/api/accounts/combined/summary", { mode: "paper" }];
  const positionsKey = [
    "/api/accounts/combined/positions",
    { mode: "paper", assetClass: "Options" },
  ];
  const ordersKey = [
    "/api/accounts/combined/orders",
    { mode: "paper", tab: "working" },
  ];
  const tradesKey = [
    "/api/accounts/combined/closed-trades",
    {
      mode: "paper",
      symbol: "SPY",
      assetClass: "Options",
      pnlSign: "winner",
      from: "2026-05-01T00:00:00.000Z",
    },
  ];
  const calendarTradesKey = [
    "/api/accounts/combined/closed-trades",
    { mode: "paper", from: "2025-04-01T00:00:00.000Z" },
  ];
  const equityKey = [
    "/api/accounts/combined/equity-history",
    { mode: "paper", range: "1D" },
  ];
  const benchmarkKey = [
    "/api/accounts/combined/equity-history",
    { mode: "paper", range: "1D", benchmark: "SPY" },
  ];
  const calendarEquityKey = getAccountPerformanceCalendarEquityQueryKey(
    "combined",
    { mode: "paper" },
  );
  const selectedOneYearEquityKey = [
    "/api/accounts/combined/equity-history",
    { mode: "paper", range: "1Y" },
  ];
  const sourceScopedPositionsKey = [
    "/api/accounts/combined/positions",
    { mode: "paper", assetClass: "Options", source: "signal_options_replay" },
  ];
  const sourceScopedTradesKey = [
    "/api/accounts/combined/closed-trades",
    { mode: "paper", source: "signal_options_replay" },
  ];
  const sourceScopedEquityKey = [
    "/api/accounts/combined/equity-history",
    { mode: "paper", range: "1D", source: "signal_options_replay" },
  ];
  const healthKey = ["/api/accounts/flex/health"];
  const { queryClient, writes } = createMockQueryClient([
    summaryKey,
    positionsKey,
    ordersKey,
    tradesKey,
    calendarTradesKey,
    equityKey,
    benchmarkKey,
    calendarEquityKey as unknown as unknown[],
    sourceScopedPositionsKey,
    sourceScopedTradesKey,
    sourceScopedEquityKey,
    healthKey,
  ]);

  applyAccountPagePayloadToCache(queryClient as any, {
    stream: "account-page-bootstrap",
    accountId: "combined",
    mode: "paper",
    range: "1D",
    orderTab: "working",
    assetClass: "Options",
    tradeFilters: {
      from: "2026-05-01T00:00:00.000Z",
      to: null,
      symbol: "SPY",
      assetClass: "Options",
      pnlSign: "winner",
      holdDuration: null,
    },
    performanceCalendarFrom: "2025-04-01T00:00:00.000Z",
    updatedAt: "2026-05-12T00:00:00.000Z",
    summary: { accountId: "combined", metrics: { netLiquidation: { value: 1 } } },
    positions: { accountId: "combined", positions: [{ id: "position" }] },
    orders: { accountId: "combined", orders: [{ id: "order" }], tab: "working" },
    allocation: { accountId: "combined", assetClass: [] },
    risk: { accountId: "combined", margin: {} },
    cashActivity: { accountId: "combined", activities: [{ id: "cash" }] },
    closedTrades: { accountId: "combined", trades: [{ id: "trade" }] },
    performanceCalendarTrades: {
      accountId: "combined",
      trades: [{ id: "calendar-trade" }],
    },
    equityHistory: { accountId: "combined", range: "1D", points: [{ timestamp: "a" }] },
    intradayEquity: { accountId: "combined", range: "1D", points: [{ timestamp: "b" }] },
    benchmarkEquityHistory: {
      SPY: { accountId: "combined", range: "1D", points: [{ timestamp: "spy" }] },
    },
    performanceCalendarEquity: {
      accountId: "combined",
      range: "1Y",
      points: [{ timestamp: "calendar" }],
    },
    flexHealth: { flexConfigured: true },
  } as any);

  assert.equal(
    (writes.get(JSON.stringify(summaryKey)) as any)?.metrics.netLiquidation.value,
    1,
  );
  assert.equal((writes.get(JSON.stringify(positionsKey)) as any)?.positions[0].id, "position");
  assert.equal((writes.get(JSON.stringify(ordersKey)) as any)?.orders[0].id, "order");
  assert.equal((writes.get(JSON.stringify(tradesKey)) as any)?.trades[0].id, "trade");
  assert.equal(
    (writes.get(JSON.stringify(calendarTradesKey)) as any)?.trades[0].id,
    "calendar-trade",
  );
  assert.equal((writes.get(JSON.stringify(equityKey)) as any)?.points[0].timestamp, "b");
  assert.equal(
    (writes.get(JSON.stringify(benchmarkKey)) as any)?.points[0].timestamp,
    "spy",
  );
  assert.equal(
    (writes.get(JSON.stringify(calendarEquityKey)) as any)?.points[0].timestamp,
    "calendar",
  );
  assert.equal(writes.get(JSON.stringify(selectedOneYearEquityKey)), undefined);
  assert.equal(writes.get(JSON.stringify(sourceScopedPositionsKey)), undefined);
  assert.equal(writes.get(JSON.stringify(sourceScopedTradesKey)), undefined);
  assert.equal(writes.get(JSON.stringify(sourceScopedEquityKey)), undefined);
  assert.equal((writes.get(JSON.stringify(healthKey)) as any)?.flexConfigured, true);
});

test("applyAccountPageDerivedPayloadToCache keeps selected 1Y and calendar equity caches separate", () => {
  const selectedOneYearEquityKey = [
    "/api/accounts/shadow/equity-history",
    { mode: "paper", range: "1Y" },
  ];
  const calendarEquityKey = getAccountPerformanceCalendarEquityQueryKey(
    "shadow",
    { mode: "paper" },
  );
  const { queryClient, writes } = createMockQueryClient([
    selectedOneYearEquityKey,
    calendarEquityKey as unknown as unknown[],
  ]);

  applyAccountPageDerivedPayloadToCache(queryClient as any, {
    stream: "account-page-derived",
    accountId: "shadow",
    mode: "paper",
    range: "1Y",
    tradeFilters: {
      from: null,
      to: null,
      symbol: null,
      assetClass: null,
      pnlSign: null,
      holdDuration: null,
    },
    performanceCalendarFrom: "2025-04-01T00:00:00.000Z",
    updatedAt: "2026-05-13T15:03:12.357Z",
    equityHistory: {
      accountId: "shadow",
      range: "1Y",
      points: [{ timestamp: "selected-1y" }],
    },
    benchmarkEquityHistory: {},
    performanceCalendarEquity: {
      accountId: "shadow",
      range: "1Y",
      points: [{ timestamp: "calendar-1y" }],
    },
    performanceCalendarTrades: { accountId: "shadow", trades: [] },
    closedTrades: { accountId: "shadow", trades: [] },
    cashActivity: { accountId: "shadow", activities: [] },
    flexHealth: null,
  } as any);

  assert.equal(
    (writes.get(JSON.stringify(selectedOneYearEquityKey)) as any)?.points[0]
      .timestamp,
    "selected-1y",
  );
  assert.equal(
    (writes.get(JSON.stringify(calendarEquityKey)) as any)?.points[0].timestamp,
    "calendar-1y",
  );
});

test("queueAccountPagePayloadToCache coalesces account page live writes until frame flush", () => {
  const summaryKey = ["/api/accounts/combined/summary", { mode: "paper" }];
  const positionsKey = [
    "/api/accounts/combined/positions",
    { mode: "paper", assetClass: "Options" },
  ];
  const ordersKey = [
    "/api/accounts/combined/orders",
    { mode: "paper", tab: "working" },
  ];
  const { queryClient, writes } = createMockQueryClient([
    summaryKey,
    positionsKey,
    ordersKey,
    ["/api/accounts/combined/allocation", { mode: "paper" }],
    ["/api/accounts/combined/risk", { mode: "paper" }],
    ["/api/accounts/combined/equity-history", { mode: "paper", range: "1D" }],
  ]);
  const livePayload = (netLiquidation: number) => ({
    stream: "account-page-live",
    accountId: "combined",
    mode: "paper",
    orderTab: "working",
    assetClass: "Options",
    updatedAt: "2026-05-12T00:00:00.000Z",
    summary: {
      accountId: "combined",
      metrics: { netLiquidation: { value: netLiquidation } },
    },
    positions: {
      accountId: "combined",
      positions: [{ id: "P1", symbol: "SPY", mark: 5 }],
    },
    orders: {
      accountId: "combined",
      tab: "working",
      orders: [{ id: "O1", symbol: "SPY", status: "working" }],
    },
    allocation: { accountId: "combined", assetClass: [] },
    risk: { accountId: "combined", margin: {} },
    intradayEquity: {
      accountId: "combined",
      range: "1D",
      points: [{ timestamp: "live" }],
    },
  });

  queueAccountPagePayloadToCache(queryClient as any, "live", livePayload(1) as any);
  queueAccountPagePayloadToCache(queryClient as any, "live", livePayload(2) as any);

  assert.equal(writes.get(JSON.stringify(summaryKey)), undefined);

  flushAccountPagePayloadQueue();

  assert.equal(
    (writes.get(JSON.stringify(summaryKey)) as any)?.metrics.netLiquidation.value,
    2,
  );
  assert.equal((writes.get(JSON.stringify(positionsKey)) as any)?.positions[0].id, "P1");
  assert.equal((writes.get(JSON.stringify(ordersKey)) as any)?.orders[0].id, "O1");

  const firstSnapshot = getAccountPositionRowSnapshot({
    accountId: "combined",
    mode: "paper",
    rowId: "P1",
  });
  queueAccountPagePayloadToCache(queryClient as any, "live", livePayload(3) as any);
  flushAccountPagePayloadQueue();
  assert.equal(
    getAccountPositionRowSnapshot({
      accountId: "combined",
      mode: "paper",
      rowId: "P1",
    }),
    firstSnapshot,
  );
});

test("applyAccountPageCriticalPayloadToCache seeds account operational queries", () => {
  const summaryKey = ["/api/accounts/combined/summary", { mode: "paper" }];
  const positionsKey = [
    "/api/accounts/combined/positions",
    { mode: "paper", assetClass: "Options" },
  ];
  const ordersKey = [
    "/api/accounts/combined/orders",
    { mode: "paper", tab: "working" },
  ];
  const { queryClient, writes } = createMockQueryClient([
    summaryKey,
    positionsKey,
    ordersKey,
    ["/api/accounts/combined/allocation", { mode: "paper" }],
    ["/api/accounts/combined/risk", { mode: "paper" }],
  ]);

  applyAccountPageCriticalPayloadToCache(queryClient as any, {
    stream: "account-page-critical",
    accountId: "combined",
    mode: "paper",
    orderTab: "working",
    assetClass: "Options",
    updatedAt: "2026-05-12T00:00:00.000Z",
    summary: {
      accountId: "combined",
      metrics: { netLiquidation: { value: 4 } },
    },
    positions: {
      accountId: "combined",
      positions: [{ id: "P1", symbol: "SPY", mark: 5 }],
    },
    orders: {
      accountId: "combined",
      tab: "working",
      orders: [{ id: "O1", symbol: "SPY", status: "working" }],
    },
    allocation: { accountId: "combined", assetClass: [] },
    risk: { accountId: "combined", margin: {} },
  } as any);

  assert.equal(
    (writes.get(JSON.stringify(summaryKey)) as any)?.metrics.netLiquidation.value,
    4,
  );
  assert.equal((writes.get(JSON.stringify(positionsKey)) as any)?.positions[0].id, "P1");
  assert.equal((writes.get(JSON.stringify(ordersKey)) as any)?.orders[0].id, "O1");
});

test("applyAccountPageLivePayloadToCache patches performance-calendar equity ranges from live summary", () => {
  const equityKey = getAccountPerformanceCalendarEquityQueryKey(
    "shadow",
    { mode: "paper" },
  );
  const initialData = new Map<string, unknown>([
    [
      JSON.stringify(equityKey),
      {
        accountId: "shadow",
        range: "1Y",
        currency: "USD",
        flexConfigured: true,
        lastFlexRefreshAt: null,
        benchmark: null,
        asOf: "2026-05-12T20:00:00.000Z",
        latestSnapshotAt: "2026-05-12T20:00:00.000Z",
        isStale: false,
        staleReason: null,
        terminalPointSource: "shadow_ledger",
        liveTerminalIncluded: false,
        points: [
          {
            timestamp: "2026-05-12T20:00:00.000Z",
            netLiquidation: 30_000,
            currency: "USD",
            source: "SHADOW_LEDGER",
            deposits: 0,
            withdrawals: 0,
            dividends: 0,
            fees: 0,
            returnPercent: 0,
            benchmarkPercent: null,
          },
        ],
        events: [],
      },
    ],
  ]);
  const { queryClient, writes } = createMockQueryClient(
    [equityKey as unknown as unknown[]],
    initialData,
  );

  applyAccountPageLivePayloadToCache(queryClient as any, {
    stream: "account-page-live",
    accountId: "shadow",
    mode: "paper",
    orderTab: "history",
    assetClass: null,
    updatedAt: "2026-05-13T15:03:12.357Z",
    summary: {
      accountId: "shadow",
      isCombined: false,
      mode: "paper",
      currency: "USD",
      accounts: [],
      updatedAt: "2026-05-13T15:03:12.357Z",
      fx: { baseCurrency: "USD", timestamp: null, rates: {}, warning: null },
      badges: {},
      metrics: {
        netLiquidation: {
          value: 30_112.14,
          currency: "USD",
          source: "SHADOW_LEDGER",
          field: "netLiquidation",
          updatedAt: "2026-05-13T15:03:12.357Z",
        },
      },
    },
    intradayEquity: {
      accountId: "shadow",
      range: "1D",
      currency: "USD",
      points: [],
      events: [],
    },
    allocation: { accountId: "shadow", assetClass: [] },
    positions: { accountId: "shadow", positions: [] },
    orders: { accountId: "shadow", tab: "history", orders: [] },
    risk: { accountId: "shadow", margin: {} },
  } as any);

  const patched = writes.get(JSON.stringify(equityKey)) as any;
  assert.equal(patched.points.length, 2);
  assert.equal(patched.points[1].timestamp, "2026-05-13T15:03:12.357Z");
  assert.equal(patched.points[1].netLiquidation, 30_112.14);
  assert.equal(patched.points[1].source, "SHADOW_LEDGER");
  assert.equal(patched.liveTerminalIncluded, true);
  assert.equal(patched.terminalPointSource, "shadow_ledger");
  assert.equal(Number(patched.points[1].returnPercent.toFixed(4)), 0.3738);
});

test("derived account page snapshots preserve newer calendar live terminal returns", () => {
  const calendarEquityKey = getAccountPerformanceCalendarEquityQueryKey(
    "shadow",
    { mode: "paper" },
  );
  const initialData = new Map<string, unknown>([
    [
      JSON.stringify(calendarEquityKey),
      {
        accountId: "shadow",
        range: "1Y",
        currency: "USD",
        flexConfigured: true,
        lastFlexRefreshAt: null,
        benchmark: null,
        asOf: "2026-05-12T20:00:00.000Z",
        latestSnapshotAt: "2026-05-12T20:00:00.000Z",
        isStale: false,
        staleReason: null,
        terminalPointSource: "shadow_ledger",
        liveTerminalIncluded: false,
        points: [
          {
            timestamp: "2026-05-12T20:00:00.000Z",
            netLiquidation: 30_000,
            currency: "USD",
            source: "SHADOW_LEDGER",
            deposits: 0,
            withdrawals: 0,
            dividends: 0,
            fees: 0,
            returnPercent: 0,
            benchmarkPercent: null,
          },
        ],
        events: [],
      },
    ],
  ]);
  const { queryClient, writes } = createMockQueryClient(
    [calendarEquityKey as unknown as unknown[]],
    initialData,
  );

  applyAccountPageLivePayloadToCache(queryClient as any, {
    stream: "account-page-live",
    accountId: "shadow",
    mode: "paper",
    orderTab: "history",
    assetClass: null,
    updatedAt: "2026-05-13T15:03:12.357Z",
    summary: {
      accountId: "shadow",
      isCombined: false,
      mode: "paper",
      currency: "USD",
      accounts: [],
      updatedAt: "2026-05-13T15:03:12.357Z",
      fx: { baseCurrency: "USD", timestamp: null, rates: {}, warning: null },
      badges: {},
      metrics: {
        netLiquidation: {
          value: 30_112.14,
          currency: "USD",
          source: "SHADOW_LEDGER",
          field: "netLiquidation",
          updatedAt: "2026-05-13T15:03:12.357Z",
        },
      },
    },
    intradayEquity: {
      accountId: "shadow",
      range: "1D",
      currency: "USD",
      points: [],
      events: [],
    },
    allocation: { accountId: "shadow", assetClass: [] },
    positions: { accountId: "shadow", positions: [] },
    orders: { accountId: "shadow", tab: "history", orders: [] },
    risk: { accountId: "shadow", margin: {} },
  } as any);

  const afterLive = writes.get(JSON.stringify(calendarEquityKey)) as any;
  assert.equal(afterLive.points.length, 2);
  assert.equal(Number(afterLive.points[1].returnPercent.toFixed(4)), 0.3738);

  applyAccountPageDerivedPayloadToCache(queryClient as any, {
    stream: "account-page-derived",
    accountId: "shadow",
    mode: "paper",
    range: "ALL",
    tradeFilters: {
      from: null,
      to: null,
      symbol: null,
      assetClass: null,
      pnlSign: null,
      holdDuration: null,
    },
    performanceCalendarFrom: "2025-04-01T00:00:00.000Z",
    updatedAt: "2026-05-13T15:03:30.000Z",
    equityHistory: {
      accountId: "shadow",
      range: "ALL",
      points: [],
    },
    benchmarkEquityHistory: {},
    performanceCalendarEquity: {
      accountId: "shadow",
      range: "1Y",
      currency: "USD",
      points: [
        {
          timestamp: "2026-05-12T20:00:00.000Z",
          netLiquidation: 30_000,
          currency: "USD",
          source: "SHADOW_LEDGER",
          deposits: 0,
          withdrawals: 0,
          dividends: 0,
          fees: 0,
          returnPercent: 0,
          benchmarkPercent: null,
        },
      ],
      events: [],
    },
    performanceCalendarTrades: { accountId: "shadow", trades: [] },
    closedTrades: { accountId: "shadow", trades: [] },
    cashActivity: { accountId: "shadow", activities: [] },
    flexHealth: null,
  } as any);

  const afterDerived = writes.get(JSON.stringify(calendarEquityKey)) as any;
  assert.equal(afterDerived.points.length, 2);
  assert.equal(afterDerived.points[1].timestamp, "2026-05-13T15:03:12.357Z");
  assert.equal(afterDerived.points[1].netLiquidation, 30_112.14);
  assert.equal(afterDerived.liveTerminalIncluded, true);
  assert.equal(afterDerived.terminalPointSource, "shadow_ledger");
  assert.equal(Number(afterDerived.points[1].returnPercent.toFixed(4)), 0.3738);
});

test("applyAccountPageLivePayloadToCache preserves 1D benchmark overlays", () => {
  const benchmarkKey = [
    "/api/accounts/combined/equity-history",
    { mode: "paper", range: "1D", benchmark: "SPY" },
  ];
  const initialData = new Map<string, unknown>([
    [
      JSON.stringify(benchmarkKey),
      {
        accountId: "combined",
        range: "1D",
        currency: "USD",
        flexConfigured: true,
        lastFlexRefreshAt: null,
        benchmark: "SPY",
        asOf: "2026-05-13T14:00:00.000Z",
        latestSnapshotAt: "2026-05-13T14:00:00.000Z",
        isStale: false,
        staleReason: null,
        terminalPointSource: "live_account_summary",
        liveTerminalIncluded: false,
        points: [
          {
            timestamp: "2026-05-13T14:00:00.000Z",
            netLiquidation: 100_000,
            currency: "USD",
            source: "IBKR_ACCOUNT_SUMMARY",
            deposits: 0,
            withdrawals: 0,
            dividends: 0,
            fees: 0,
            returnPercent: 0,
            benchmarkPercent: 0,
          },
        ],
        events: [],
      },
    ],
  ]);
  const { queryClient, writes } = createMockQueryClient([benchmarkKey], initialData);

  applyAccountPageLivePayloadToCache(queryClient as any, {
    stream: "account-page-live",
    accountId: "combined",
    mode: "paper",
    orderTab: "working",
    assetClass: null,
    updatedAt: "2026-05-13T14:00:05.000Z",
    summary: {
      accountId: "combined",
      isCombined: true,
      mode: "paper",
      currency: "USD",
      accounts: [],
      updatedAt: "2026-05-13T14:00:05.000Z",
      fx: { baseCurrency: "USD", timestamp: null, rates: {}, warning: null },
      badges: {},
      metrics: {
        netLiquidation: {
          value: 101_250,
          currency: "USD",
          source: "IBKR_ACCOUNT_SUMMARY",
          field: "netLiquidation",
          updatedAt: "2026-05-13T14:00:05.000Z",
        },
      },
    },
    intradayEquity: {
      accountId: "combined",
      range: "1D",
      currency: "USD",
      benchmark: null,
      points: [{ timestamp: "intraday-replacement" }],
      events: [],
    },
    allocation: { accountId: "combined", assetClass: [] },
    positions: { accountId: "combined", positions: [] },
    orders: { accountId: "combined", tab: "working", orders: [] },
    risk: { accountId: "combined", margin: {} },
  } as any);

  const patched = writes.get(JSON.stringify(benchmarkKey)) as any;
  assert.equal(patched.benchmark, "SPY");
  assert.equal(patched.points.length, 1);
  assert.equal(patched.points[0].benchmarkPercent, 0);
  assert.notEqual(patched.points[0].timestamp, "intraday-replacement");
});

test("applyIbkrAccountPayloadToCache patches scoped account positions from stream", () => {
  const positionsKey = [
    "/api/accounts/U1/positions",
    { mode: "live", assetClass: "Options" },
  ];
  const initialData = new Map<string, unknown>([
    [
      JSON.stringify(positionsKey),
      {
        accountId: "U1",
        currency: "USD",
        totals: {},
        updatedAt: "2026-04-30T14:00:00.000Z",
        positions: [
          {
            id: "P1",
            accountId: "U1",
            accounts: ["U1"],
            symbol: "SPY",
            description: "SPY 2026-05-01 500 call",
            assetClass: "Options",
            optionContract: null,
            sector: "ETF",
            quantity: 1,
            averageCost: 2,
            mark: 2.5,
            dayChange: 10,
            dayChangePercent: 1,
            unrealizedPnl: 50,
            unrealizedPnlPercent: 25,
            marketValue: 250,
            weightPercent: 0.25,
            betaWeightedDelta: null,
            lots: [],
            openOrders: [],
            source: "IBKR_POSITIONS",
          },
        ],
      },
    ],
  ]);
  const { queryClient, writes, invalidated } = createMockQueryClient(
    [positionsKey],
    initialData,
  );

  applyIbkrAccountPayloadToCache(
    queryClient as any,
    {
      accounts: [
        {
          id: "U1",
          providerAccountId: "U1",
          provider: "ibkr",
          mode: "live",
          displayName: "IBKR U1",
          currency: "USD",
          cash: 10_000,
          buyingPower: 50_000,
          netLiquidation: 100_000,
          updatedAt: "2026-04-30T14:00:03.000Z",
        },
      ],
      positions: [
        {
          id: "P1",
          accountId: "U1",
          symbol: "SPY",
          assetClass: "option",
          quantity: 2,
          averagePrice: 2,
          marketPrice: 3,
          marketValue: 600,
          unrealizedPnl: 200,
          unrealizedPnlPercent: 50,
          optionContract: null,
        },
        {
          id: "P2",
          accountId: "U1",
          symbol: "AAPL",
          assetClass: "stock",
          quantity: 5,
          averagePrice: 100,
          marketPrice: 101,
          marketValue: 505,
          unrealizedPnl: 5,
          unrealizedPnlPercent: 1,
          optionContract: null,
        },
      ],
    } as any,
    { accountId: "U1", mode: "live" },
  );

  const patched = writes.get(JSON.stringify(positionsKey)) as any;
  assert.deepEqual(
    patched.positions.map((position: any) => position.id),
    ["P1"],
  );
  assert.equal(patched.positions[0].quantity, 2);
  assert.equal(patched.positions[0].mark, 3);
  assert.equal(patched.positions[0].marketValue, 600);
  assert.equal(patched.positions[0].weightPercent, 0.6);
  assert.equal(invalidated.length, 0);
});

test("applyIbkrAccountPayloadToCache seeds scoped account positions from stream before REST data", () => {
  const positionsKey = [
    "/api/accounts/U1/positions",
    { mode: "live", assetClass: "Stocks" },
  ];
  const { queryClient, writes } = createMockQueryClient([positionsKey]);

  applyIbkrAccountPayloadToCache(
    queryClient as any,
    {
      accounts: [
        {
          id: "U1",
          providerAccountId: "U1",
          provider: "ibkr",
          mode: "live",
          displayName: "IBKR U1",
          currency: "USD",
          cash: 10_000,
          buyingPower: 50_000,
          netLiquidation: 100_000,
          updatedAt: "2026-04-30T14:00:03.000Z",
        },
      ],
      positions: [
        {
          id: "P1",
          accountId: "U1",
          symbol: "AAPL",
          assetClass: "stock",
          quantity: 5,
          averagePrice: 100,
          marketPrice: 101,
          marketValue: 505,
          unrealizedPnl: 5,
          unrealizedPnlPercent: 1,
          optionContract: null,
        },
        {
          id: "P2",
          accountId: "U2",
          symbol: "MSFT",
          assetClass: "stock",
          quantity: 2,
          averagePrice: 200,
          marketPrice: 201,
          marketValue: 402,
          unrealizedPnl: 2,
          unrealizedPnlPercent: 0.5,
          optionContract: null,
        },
      ],
    } as any,
    { accountId: "U1", mode: "live" },
  );

  const seeded = writes.get(JSON.stringify(positionsKey)) as any;
  assert.equal(seeded.accountId, "U1");
  assert.equal(seeded.currency, "USD");
  assert.equal(seeded.updatedAt.length > 0, true);
  assert.deepEqual(
    seeded.positions.map((position: any) => position.id),
    ["P1"],
  );
  assert.equal(seeded.positions[0].mark, 101);
  assert.equal(seeded.totals.netLiquidation, 100_000);
  assert.equal(seeded.totals.netExposure, 505);
});

test("applyIbkrAccountPayloadToCache seeds combined account positions from stream before REST data", () => {
  const positionsKey = [
    "/api/accounts/combined/positions",
    { mode: "live", assetClass: "Stocks" },
  ];
  const { queryClient, writes } = createMockQueryClient([positionsKey]);

  applyIbkrAccountPayloadToCache(
    queryClient as any,
    {
      accounts: [
        {
          id: "U1",
          providerAccountId: "U1",
          provider: "ibkr",
          mode: "live",
          displayName: "IBKR U1",
          currency: "USD",
          cash: 10_000,
          buyingPower: 50_000,
          netLiquidation: 100_000,
          updatedAt: "2026-04-30T14:00:03.000Z",
        },
        {
          id: "U2",
          providerAccountId: "U2",
          provider: "ibkr",
          mode: "live",
          displayName: "IBKR U2",
          currency: "USD",
          cash: 20_000,
          buyingPower: 100_000,
          netLiquidation: 200_000,
          updatedAt: "2026-04-30T14:00:04.000Z",
        },
      ],
      positions: [
        {
          id: "P1",
          accountId: "U1",
          symbol: "AAPL",
          assetClass: "stock",
          quantity: 5,
          averagePrice: 100,
          marketPrice: 101,
          marketValue: 505,
          unrealizedPnl: 5,
          unrealizedPnlPercent: 1,
          optionContract: null,
        },
        {
          id: "P2",
          accountId: "U2",
          symbol: "AAPL",
          assetClass: "stock",
          quantity: 2,
          averagePrice: 100,
          marketPrice: 102,
          marketValue: 204,
          unrealizedPnl: 4,
          unrealizedPnlPercent: 2,
          optionContract: null,
        },
      ],
    } as any,
    { accountId: "combined", mode: "live" },
  );

  const seeded = writes.get(JSON.stringify(positionsKey)) as any;
  assert.equal(seeded.accountId, "combined");
  assert.equal(seeded.totals.cash, 30_000);
  assert.equal(seeded.totals.buyingPower, 150_000);
  assert.equal(seeded.totals.netLiquidation, 300_000);
  assert.equal(seeded.totals.netExposure, 709);
  assert.deepEqual(
    seeded.positions.map((position: any) => position.id),
    ["equity:AAPL"],
  );
  assert.deepEqual(seeded.positions[0].accounts, ["U1", "U2"]);
  assert.equal(seeded.positions[0].quantity, 7);
  assert.equal(seeded.positions[0].marketValue, 709);
  assert.equal(seeded.positions[0].unrealizedPnl, 9);
  assert.equal(Number(seeded.positions[0].mark.toFixed(4)), 101.2857);
});

test("applyIbkrAccountPayloadToCache does not seed scoped positions from cost-basis stream rows", () => {
  const positionsKey = [
    "/api/accounts/U1/positions",
    { mode: "live", assetClass: "Stocks" },
  ];
  const { queryClient, writes } = createMockQueryClient([positionsKey]);

  applyIbkrAccountPayloadToCache(
    queryClient as any,
    {
      accounts: [
        {
          id: "U1",
          providerAccountId: "U1",
          provider: "ibkr",
          mode: "live",
          displayName: "IBKR U1",
          currency: "USD",
          cash: 10_000,
          buyingPower: 50_000,
          netLiquidation: 100_000,
          updatedAt: "2026-04-30T14:00:03.000Z",
        },
      ],
      positions: [
        {
          id: "P1",
          accountId: "U1",
          symbol: "AAPL",
          assetClass: "stock",
          quantity: 5,
          averagePrice: 100,
          marketPrice: 100,
          marketValue: 500,
          unrealizedPnl: 0,
          unrealizedPnlPercent: 0,
          optionContract: null,
        },
        {
          id: "P2",
          accountId: "U1",
          symbol: "MSFT",
          assetClass: "stock",
          quantity: 2,
          averagePrice: 200,
          marketPrice: 0,
          marketValue: 0,
          unrealizedPnl: -400,
          unrealizedPnlPercent: -100,
          optionContract: null,
        },
      ],
    } as any,
    { accountId: "U1", mode: "live" },
  );

  assert.equal(writes.has(JSON.stringify(positionsKey)), false);
});

test("applyIbkrAccountPayloadToCache preserves hydrated marks when stream only reports cost basis", () => {
  const positionsKey = [
    "/api/accounts/U1/positions",
    { mode: "live", assetClass: "Stocks" },
  ];
  const initialData = new Map<string, unknown>([
    [
      JSON.stringify(positionsKey),
      {
        accountId: "U1",
        currency: "USD",
        totals: {
          weightPercent: 0.52,
          unrealizedPnl: 20,
          grossLong: 520,
          grossShort: 0,
          netExposure: 520,
          cash: 10_000,
          totalCash: 10_000,
          buyingPower: 50_000,
          netLiquidation: 100_000,
        },
        updatedAt: "2026-04-30T14:00:00.000Z",
        positions: [
          {
            id: "P1",
            accountId: "U1",
            accounts: ["U1"],
            symbol: "AAPL",
            description: "AAPL",
            assetClass: "Stocks",
            optionContract: null,
            sector: "Technology",
            quantity: 5,
            averageCost: 100,
            mark: 104,
            dayChange: 1,
            dayChangePercent: 0.97,
            unrealizedPnl: 20,
            unrealizedPnlPercent: 4,
            marketValue: 520,
            weightPercent: 0.52,
            betaWeightedDelta: null,
            lots: [],
            openOrders: [],
            source: "IBKR_POSITIONS",
          },
        ],
      },
    ],
  ]);
  const { queryClient, writes } = createMockQueryClient(
    [positionsKey],
    initialData,
  );

  applyIbkrAccountPayloadToCache(
    queryClient as any,
    {
      accounts: [
        {
          id: "U1",
          providerAccountId: "U1",
          provider: "ibkr",
          mode: "live",
          displayName: "IBKR U1",
          currency: "USD",
          cash: 10_000,
          buyingPower: 50_000,
          netLiquidation: 100_000,
          updatedAt: "2026-04-30T14:00:03.000Z",
        },
      ],
      positions: [
        {
          id: "P1",
          accountId: "U1",
          symbol: "AAPL",
          assetClass: "stock",
          quantity: 5,
          averagePrice: 100,
          marketPrice: 100,
          marketValue: 500,
          unrealizedPnl: 0,
          unrealizedPnlPercent: 0,
          optionContract: null,
        },
      ],
    } as any,
    { accountId: "U1", mode: "live" },
  );

  const patched = writes.get(JSON.stringify(positionsKey)) as any;
  assert.equal(patched.positions[0].quantity, 5);
  assert.equal(patched.positions[0].averageCost, 100);
  assert.equal(patched.positions[0].mark, 104);
  assert.equal(patched.positions[0].marketValue, 520);
  assert.equal(patched.positions[0].unrealizedPnl, 20);
  assert.equal(patched.positions[0].unrealizedPnlPercent, 4);
  assert.equal(patched.positions[0].weightPercent, 0.52);
  assert.equal(patched.totals.netExposure, 520);
  assert.equal(patched.totals.unrealizedPnl, 20);
});

test("applyIbkrAccountPayloadToCache does not overwrite Shadow account positions", () => {
  const shadowPositionsKey = [
    "/api/accounts/shadow/positions",
    { mode: "paper" },
  ];
  const shadowPositions = {
    accountId: "shadow",
    currency: "USD",
    totals: {},
    updatedAt: "2026-05-20T17:50:00.000Z",
    positions: [
      {
        id: "shadow-aaoi",
        accountId: "shadow",
        accounts: ["shadow"],
        symbol: "AAOI",
        description: "AAOI",
        assetClass: "Options",
        quantity: 1,
        averageCost: 12.37,
        mark: 11.2,
        dayChange: -117,
        dayChangePercent: -9.46,
        unrealizedPnl: -117,
        marketValue: 1120,
        optionQuote: { dayChange: -1.17, dayChangePercent: -9.46 },
        source: "SHADOW_LEDGER",
        sourceType: "automation",
        strategyLabel: "Signal Options",
      },
    ],
  };
  const initialData = new Map<string, unknown>([
    [JSON.stringify(shadowPositionsKey), shadowPositions],
  ]);
  const { queryClient, writes } = createMockQueryClient(
    [shadowPositionsKey],
    initialData,
  );

  applyIbkrAccountPayloadToCache(
    queryClient as any,
    {
      accounts: [],
      positions: [
        {
          id: "broker-aaoi",
          accountId: "shadow",
          symbol: "AAOI",
          assetClass: "option",
          quantity: 1,
          averagePrice: 12.37,
          marketPrice: 0,
          marketValue: 0,
          unrealizedPnl: -1237,
          unrealizedPnlPercent: -100,
          optionContract: null,
        },
      ],
    } as any,
    { accountId: null, mode: "paper" },
  );

  assert.strictEqual(
    writes.get(JSON.stringify(shadowPositionsKey)),
    shadowPositions,
  );
});

test("invalidateVisibleAccountDerivedQueries targets scoped real account views", () => {
  const { queryClient, invalidated } = createMockQueryClient([
    ["/api/accounts/U1/summary", { mode: "live" }],
    ["/api/accounts/U1/positions", { mode: "live" }],
    ["/api/accounts/U1/equity-history", { mode: "paper" }],
    ["/api/accounts/U2/summary", { mode: "live" }],
    ["/api/positions", { mode: "live", accountId: "U1" }],
  ]);

  invalidateVisibleAccountDerivedQueries(queryClient as any, ["U1"], "live");

  assert.deepEqual(
    invalidated.map((queryKey) => queryKey[0]),
    ["/api/accounts/U1/summary", "/api/accounts/U1/positions"],
  );
});

test("applyIbkrAccountPayloadToCache appends one live terminal point to matching equity ranges", () => {
  const equityKey = ["/api/accounts/U1/equity-history", { mode: "live", range: "1D" }];
  const mismatchedRangeKey = [
    "/api/accounts/U1/equity-history",
    { mode: "live", range: "1D", benchmark: "DIA" },
  ];
  const benchmarkKey = [
    "/api/accounts/U1/equity-history",
    { mode: "live", range: "1D", benchmark: "SPY" },
  ];
  const summaryKey = ["/api/accounts/U1/summary", { mode: "live" }];
  const initialData = new Map<string, unknown>([
    [
      JSON.stringify(equityKey),
      {
        accountId: "U1",
        range: "1D",
        currency: "USD",
        flexConfigured: true,
        lastFlexRefreshAt: null,
        benchmark: null,
        points: [
          {
            timestamp: "2026-04-30T14:00:00.000Z",
            netLiquidation: 100_000,
            currency: "USD",
            source: "LOCAL_LEDGER",
            deposits: 0,
            withdrawals: 0,
            dividends: 0,
            fees: 0,
            returnPercent: 0,
            benchmarkPercent: null,
          },
        ],
        events: [],
      },
    ],
    [
      JSON.stringify(mismatchedRangeKey),
      {
        accountId: "U1",
        range: "1W",
        currency: "USD",
        flexConfigured: true,
        lastFlexRefreshAt: null,
        benchmark: null,
        points: [],
        events: [],
      },
    ],
    [
      JSON.stringify(benchmarkKey),
      {
        accountId: "U1",
        range: "1D",
        currency: "USD",
        flexConfigured: true,
        lastFlexRefreshAt: null,
        benchmark: "SPY",
        points: [
          {
            timestamp: "2026-04-30T14:00:00.000Z",
            netLiquidation: 100_000,
            currency: "USD",
            source: "LOCAL_LEDGER",
            deposits: 0,
            withdrawals: 0,
            dividends: 0,
            fees: 0,
            returnPercent: 0,
            benchmarkPercent: 0,
          },
        ],
        events: [],
      },
    ],
    [
      JSON.stringify(summaryKey),
      {
        accountId: "U1",
        isCombined: false,
        mode: "live",
        currency: "USD",
        accounts: [],
        updatedAt: "2026-04-30T14:00:00.000Z",
        fx: { baseCurrency: "USD", timestamp: null, rates: {}, warning: null },
        badges: {},
        metrics: {
          netLiquidation: {
            value: 100_000,
            currency: "USD",
            source: "LOCAL_LEDGER",
            field: "netLiquidation",
            updatedAt: "2026-04-30T14:00:00.000Z",
          },
        },
      },
    ],
  ]);
  const { queryClient, writes, invalidated } = createMockQueryClient(
    [equityKey, mismatchedRangeKey, benchmarkKey, summaryKey],
    initialData,
  );

  applyIbkrAccountPayloadToCache(
    queryClient as any,
    {
      accounts: [
        {
          id: "U1",
          providerAccountId: "U1",
          provider: "ibkr",
          mode: "live",
          displayName: "IBKR U1",
          currency: "USD",
          cash: 10_000,
          buyingPower: 50_000,
          netLiquidation: 101_250,
          updatedAt: "2026-04-30T14:00:03.000Z",
        },
      ],
      positions: [],
    } as any,
    { accountId: "U1", mode: "live" },
  );

  const patched = writes.get(JSON.stringify(equityKey)) as any;
  assert.equal(patched.points.length, 2);
  assert.equal(patched.points[1].source, "IBKR_ACCOUNT_SUMMARY");
  assert.equal(patched.points[1].netLiquidation, 101_250);
  assert.equal(patched.liveTerminalIncluded, true);
  assert.equal(patched.terminalPointSource, "live_account_summary");
  assert.equal(patched.points[1].returnPercent, 1.25);

  const patchedBenchmark = writes.get(JSON.stringify(benchmarkKey)) as any;
  assert.equal(patchedBenchmark.points.length, 2);
  assert.equal(patchedBenchmark.points[1].benchmarkPercent, null);

  const mismatchedRange = writes.get(JSON.stringify(mismatchedRangeKey)) as any;
  assert.deepEqual(mismatchedRange.points, []);

  const summary = writes.get(JSON.stringify(summaryKey)) as any;
  assert.equal(summary.metrics.netLiquidation.value, 101_250);
  assert.equal(summary.metrics.buyingPower.value, 50_000);
  assert.equal(
    invalidated.some((queryKey) => queryKey[0] === "/api/accounts/U1/equity-history"),
    false,
  );
});

test("applyIbkrAccountPayloadToCache keeps live equity returns transfer-adjusted", () => {
  const equityKey = ["/api/accounts/U1/equity-history", { mode: "live", range: "YTD" }];
  const initialData = new Map<string, unknown>([
    [
      JSON.stringify(equityKey),
      {
        accountId: "U1",
        range: "YTD",
        currency: "USD",
        flexConfigured: true,
        lastFlexRefreshAt: null,
        benchmark: null,
        points: [
          {
            timestamp: "2026-01-01T00:00:00.000Z",
            netLiquidation: 110_000,
            currency: "USD",
            source: "FLEX",
            deposits: 10_000,
            withdrawals: 0,
            dividends: 0,
            fees: 0,
            returnPercent: 0,
            benchmarkPercent: null,
          },
        ],
        events: [],
      },
    ],
  ]);
  const { queryClient, writes } = createMockQueryClient([equityKey], initialData);

  applyIbkrAccountPayloadToCache(
    queryClient as any,
    {
      accounts: [
        {
          id: "U1",
          providerAccountId: "U1",
          provider: "ibkr",
          mode: "live",
          displayName: "IBKR U1",
          currency: "USD",
          cash: 10_000,
          buyingPower: 50_000,
          netLiquidation: 115_000,
          updatedAt: "2026-04-30T14:00:03.000Z",
        },
      ],
      positions: [],
    } as any,
    { accountId: "U1", mode: "live" },
  );

  const patched = writes.get(JSON.stringify(equityKey)) as any;
  assert.equal(patched.points.length, 2);
  assert.equal(patched.points[0].returnPercent, 0);
  assert.equal(patched.points[1].returnPercent, 100 * (5_000 / 110_000));
});

test("applyIbkrAccountPayloadToCache replaces the prior live equity terminal point", () => {
  const equityKey = ["/api/accounts/U1/equity-history", { mode: "live", range: "1D" }];
  const initialData = new Map<string, unknown>([
    [
      JSON.stringify(equityKey),
      {
        accountId: "U1",
        range: "1D",
        currency: "USD",
        flexConfigured: true,
        lastFlexRefreshAt: null,
        benchmark: null,
        points: [
          {
            timestamp: "2026-04-30T14:00:00.000Z",
            netLiquidation: 100_000,
            currency: "USD",
            source: "LOCAL_LEDGER",
            deposits: 0,
            withdrawals: 0,
            dividends: 0,
            fees: 0,
            returnPercent: 0,
            benchmarkPercent: null,
          },
          {
            timestamp: "2026-04-30T14:00:03.000Z",
            netLiquidation: 101_000,
            currency: "USD",
            source: "IBKR_ACCOUNT_SUMMARY",
            deposits: 0,
            withdrawals: 0,
            dividends: 0,
            fees: 0,
            returnPercent: 1,
            benchmarkPercent: null,
          },
        ],
        events: [],
      },
    ],
  ]);
  const { queryClient, writes } = createMockQueryClient([equityKey], initialData);

  applyIbkrAccountPayloadToCache(
    queryClient as any,
    {
      accounts: [
        {
          id: "U1",
          providerAccountId: "U1",
          provider: "ibkr",
          mode: "live",
          displayName: "IBKR U1",
          currency: "USD",
          cash: 10_000,
          buyingPower: 50_000,
          netLiquidation: 101_500,
          updatedAt: "2026-04-30T14:00:06.000Z",
        },
      ],
      positions: [],
    } as any,
    { accountId: "U1", mode: "live" },
  );

  const patched = writes.get(JSON.stringify(equityKey)) as any;
  assert.equal(patched.points.length, 2);
  assert.equal(patched.points[1].timestamp, "2026-04-30T14:00:06.000Z");
  assert.equal(patched.points[1].netLiquidation, 101_500);
});

test("applyIbkrAccountPayloadToCache sums live terminal value for combined account charts", () => {
  const equityKey = [
    "/api/accounts/combined/equity-history",
    { mode: "paper", range: "1D" },
  ];
  const initialData = new Map<string, unknown>([
    [
      JSON.stringify(equityKey),
      {
        accountId: "combined",
        range: "1D",
        currency: "USD",
        flexConfigured: true,
        lastFlexRefreshAt: null,
        benchmark: null,
        points: [
          {
            timestamp: "2026-04-30T14:00:00.000Z",
            netLiquidation: 200_000,
            currency: "USD",
            source: "LOCAL_LEDGER",
            deposits: 0,
            withdrawals: 0,
            dividends: 0,
            fees: 0,
            returnPercent: 0,
            benchmarkPercent: null,
          },
        ],
        events: [],
      },
    ],
  ]);
  const { queryClient, writes } = createMockQueryClient([equityKey], initialData);

  applyIbkrAccountPayloadToCache(
    queryClient as any,
    {
      accounts: [
        {
          id: "U1",
          providerAccountId: "U1",
          provider: "ibkr",
          mode: "paper",
          displayName: "IBKR U1",
          currency: "USD",
          cash: 10_000,
          buyingPower: 50_000,
          netLiquidation: 101_000,
          updatedAt: "2026-04-30T14:00:03.000Z",
        },
        {
          id: "U2",
          providerAccountId: "U2",
          provider: "ibkr",
          mode: "paper",
          displayName: "IBKR U2",
          currency: "USD",
          cash: 20_000,
          buyingPower: 70_000,
          netLiquidation: 102_000,
          updatedAt: "2026-04-30T14:00:04.000Z",
        },
      ],
      positions: [],
    } as any,
    { accountId: "combined", mode: "paper" },
  );

  const patched = writes.get(JSON.stringify(equityKey)) as any;
  assert.equal(patched.points[1].timestamp, "2026-04-30T14:00:04.000Z");
  assert.equal(patched.points[1].netLiquidation, 203_000);
});
