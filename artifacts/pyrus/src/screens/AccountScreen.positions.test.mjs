import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  equityQueryWithLivePositionsTerminal,
} from "./AccountScreen.jsx";

const source = readFileSync(
  new URL("./AccountScreen.jsx", import.meta.url),
  "utf8",
);
const accountTabsSource = readFileSync(
  new URL("./account/AccountTabs.jsx", import.meta.url),
  "utf8",
);

test("positions source selector is wired to live state, not pinned to all", () => {
  assert.match(
    source,
    /const \[sourceFilter, setSourceFilter\] = useState\(/,
    "Missing sourceFilter state in AccountScreen",
  );

  const positionsPanel = source.match(/<PositionsPanel[\s\S]*?\/>/)?.[0];
  assert.ok(positionsPanel, "Missing PositionsPanel render");
  // The selector must receive the live state + change handler so it can filter.
  assert.match(positionsPanel, /sourceFilter=\{sourceFilter\}/);
  assert.match(positionsPanel, /onSourceFilterChange=\{setSourceFilter\}/);
  // It must NOT be hardcoded to "all" (the original inert bug).
  assert.doesNotMatch(positionsPanel, /sourceFilter="all"/);
});

test("real account positions queries keep the initial snapshot structural", () => {
  assert.equal(
    (source.match(/liveQuotes:\s*false/g) || []).length,
    2,
    "active positions query and account-switch prefetch must skip blocking quote hydration",
  );
  assert.doesNotMatch(
    source,
    /liveQuotes:\s*true/,
    "AccountScreen must let its existing position quote streams hydrate visible rows",
  );
});

test("account positions REST polling yields to the live account-page stream", () => {
  assert.match(
    source,
    /const positionsRestQueriesEnabled = Boolean\(liveAccountQueriesEnabled\);/,
    "Positions REST polling must use the generic stream gate instead of staying always-on.",
  );
});

test("SnapTrade account positions enable live Massive quote hydration", () => {
  assert.match(
    source,
    /const accountLiveOptionQuotesEnabled = Boolean\(\s*genericAccountQueriesEnabled \|\| snapTradeAccountPanelsEnabled,?\s*\);/,
    "SnapTrade account tabs must enable the shared positions quote hydrator",
  );
});

test("generic stream freshness cannot disable direct SnapTrade refresh", () => {
  assert.match(
    source,
    /const snapTradeRefreshInterval = snapTradeAccountPanelsEnabled\s*\? ACCOUNT_REFRESH_INTERVALS\.primaryFallback\s*: false;/,
  );
  const portfolioQuery = source.match(
    /const snapTradePortfolioQuery = useGetSnapTradeAccountPortfolio[\s\S]*?\n  \);/,
  )?.[0];
  const recentOrdersQuery = source.match(
    /const snapTradeRecentOrdersQuery = useGetSnapTradeRecentOrders[\s\S]*?\n  \);/,
  )?.[0];
  assert.match(portfolioQuery || "", /refetchInterval: snapTradeRefreshInterval/);
  assert.match(
    recentOrdersQuery || "",
    /refetchInterval:\s*activatedAccountPanels\.orders && effectiveOrderTab === "working"\s*\? snapTradeRefreshInterval\s*: false/,
  );
  assert.doesNotMatch(recentOrdersQuery || "", /accountPageStreamFresh/);
});

test("Account stream uses freshness-specific REST fallback gates", () => {
  assert.match(source, /buildAccountPageRestFallback\(\{/);
  assert.match(source, /accountPageStreamFreshness\.accountBootstrapping/);
  assert.match(source, /accountPageRestFallback\.primary/);
  assert.match(source, /accountPageRestFallback\.live/);
  assert.match(source, /accountPageRestFallback\.derived/);
});

test("enabled Account page stream owns generic demand while fresh", () => {
  assert.equal(
    (source.match(/\buseAccountPageSnapshotStream\s*\(\{/g) || []).length,
    1,
    "AccountScreen must open exactly one Account page snapshot stream",
  );
  assert.doesNotMatch(source, /inactiveAccount(?:Tab|Page|Prewarm)/);
  assert.doesNotMatch(source, /ACCOUNT_SWITCH_KEEP_WARM_MS/);
  assert.doesNotMatch(
    source,
    /\bprefetchAccountTabLiveQueries\(/,
    "Account tab REST prefetch must not run from a mount effect or timer",
  );

  const restGateBlock = source.slice(
    source.indexOf("const primaryAccountRestQueriesEnabled"),
    source.indexOf('useRuntimeWorkloadFlag("account:live"'),
  );
  assert.match(
    restGateBlock,
    /const primaryAccountRestQueriesEnabled = Boolean\(\s*genericAccountQueriesEnabled && accountPageRestFallback\.primary/,
  );
  assert.match(
    restGateBlock,
    /const liveAccountQueriesEnabled = Boolean\(\s*genericAccountQueriesEnabled && accountPageRestFallback\.live/,
  );
  assert.match(
    restGateBlock,
    /const derivedAccountQueriesEnabled = Boolean\(\s*genericAccountQueriesEnabled && accountPageRestFallback\.derived/,
  );

  assert.match(
    source,
    /<AccountTabs[\s\S]*?onTabIntent=\{prefetchAccountTabLiveQueries\}[\s\S]*?\/>/,
  );
  assert.match(accountTabsSource, /onMouseEnter=\{\(\) => onIntent\?\.\(id\)\}/);
  assert.match(accountTabsSource, /onFocus=\{\(\) => onIntent\?\.\(id\)\}/);
});

test("Accounts and Algo current-position tables share the generic account positions source", () => {
  assert.match(
    source,
    /const positionsQueryForDisplay = withoutFailedQueryData\(positionsQuery\);/,
    "Current positions must use the canonical generic account endpoint on every account tab.",
  );
  assert.doesNotMatch(
    source,
    /const positionsQueryForDisplay = snapTradeAccountPanelsEnabled[\s\S]*?snapTradePanelData\?\.positions/,
    "SnapTrade current positions must not bypass the canonical account positions endpoint.",
  );
});

test("real account tabs request live mode even when the workspace is shadow", () => {
  assert.match(
    source,
    /const resolveAccountMode = \(\{ shadowMode = false, environment \} = \{\}\) => \{\s*if \(shadowMode\) \{\s*return "shadow";\s*\}\s*return "live";\s*\};/,
    "Only the Shadow account tab may use shadow mode; real brokerage tabs are live-mode entities.",
  );
});

test("account tabs render above the account summary hero", () => {
  const tabsIndex = source.indexOf("<AccountTabs");
  const heroIndex = source.indexOf("<AccountHeroBlock");
  assert.ok(tabsIndex >= 0, "Missing AccountTabs render");
  assert.ok(heroIndex >= 0, "Missing AccountHeroBlock render");
  assert.ok(
    tabsIndex < heroIndex,
    "Account tab selection should appear before the account info/KPI hero.",
  );
});

test("SnapTrade account equity inspector uses provider-normalized positions", () => {
  assert.match(
    source,
    /const positionsAtDateQueryForDisplay = snapTradeAccountPanelsEnabled\s*\?\s*buildIdleAccountQuery\(snapTradePanelData\?\.positionsAtDate\)\s*:\s*withoutFailedQueryData\(positionsAtDateQuery\);/,
    "SnapTrade equity chart inspector must not receive an empty positions placeholder",
  );
});

test("live equity inspector only reports a current-position count from an authoritative array", () => {
  assert.match(
    source,
    /const openAccountPositionCount = Array\.isArray\(\s*positionsQueryForDisplay\.data\?\.positions,?\s*\)\s*\? openAccountPositions\.length\s*:\s*null;/,
  );
  assert.match(
    source,
    /currentPositionsCount=\{openAccountPositionCount\}/,
  );
});

test("Account page currency requires agreement and never falls back to USD", () => {
  assert.match(source, /resolveCompleteAccountCurrency\(currencyAuthorities\)/);
  assert.doesNotMatch(
    source,
    /const currency =\s*[\s\S]*?\|\|\s*["']USD["'];/,
  );
});

test("nested Account work is gated by the selected Today and analysis detail", () => {
  assert.match(
    source,
    /enabled:\s*Boolean\(\s*todayPanelQueriesEnabled && todayView === "intraday"\s*\)/,
  );
  assert.match(
    source,
    /const analysisOrderHistoryNeeded = Boolean\([\s\S]*?tradingAnalysisView === "trades"[\s\S]*?selectedAccountTradeId/,
  );
  assert.match(
    source,
    /includeIntraday:\s*Boolean\(\s*activatedAccountPanels\.today\s*&&\s*todayView === "intraday",?\s*\)/,
  );
  assert.match(source, /onActiveViewChange=\{setTradingAnalysisView\}/);
});

test("SnapTrade derived surfaces use the canonical generic routes without a dead history query", () => {
  assert.doesNotMatch(source, /useGetSnapTradeAccountHistory/);
  assert.doesNotMatch(source, /snapTradeHistoryQuery/);
  assert.match(
    source,
    /const tradesQueryForDisplay = withoutFailedQueryData\(tradesQuery\);/,
    "SnapTrade trading analysis must use the generic closed-trades endpoint",
  );
  assert.match(
    source,
    /const performanceCalendarTradesQueryForDisplay =\s*withoutFailedQueryData\(\s*performanceCalendarTradesQuery,?\s*\);/,
    "SnapTrade returns calendar must use the generic closed-trades endpoint",
  );
  assert.match(
    source,
    /const performanceCalendarEquityQueryForDisplay =\s*withoutFailedQueryData\(\s*performanceCalendarEquityQuery,?\s*\);/,
    "SnapTrade returns calendar must use the generic true-NAV equity endpoint",
  );
  assert.doesNotMatch(
    source,
    /buildProviderAccountQuery\(snapTradeHistoryQuery, snapTradePanelData\?\.equityHistory\)/,
    "SnapTrade activity-ledger equity reconstruction must not drive the displayed curve",
  );
});

test("account positions trading actions use broker-safe account context", () => {
  // Shadow and the "All"/"combined" aggregate have no single manageable broker
  // account, so live trading actions must receive null for both.
  assert.match(
    source,
    /const positionManagementAccountId =\s*shadowMode \|\| activeAccountId === "combined" \? null : activeAccountId;/,
  );
  assert.match(
    source,
    /const positionManagementGatewayReady = Boolean\(\s*!shadowMode && gatewayTradingReady,?\s*\);/,
  );
  assert.match(
    source,
    /const positionManagementGatewayMessage = shadowMode\s*\?\s*"Shadow positions cannot be managed with live broker orders\."\s*:\s*gatewayTradingMessage;/,
  );

  const positionsPanel = source.match(/<PositionsPanel[\s\S]*?\/>/)?.[0] ?? "";

  assert.match(positionsPanel, /accountId=\{positionManagementAccountId\}/);
  assert.match(positionsPanel, /environment=\{modeParams\.mode\}/);
  assert.match(
    positionsPanel,
    /gatewayTradingReady=\{positionManagementGatewayReady\}/,
  );
  assert.match(
    positionsPanel,
    /gatewayTradingMessage=\{positionManagementGatewayMessage\}/,
  );
});

test("hero pill keeps the authoritative whole-account summary", () => {
  assert.match(
    source,
    /summary=\{displaySummaryData\}/,
    "AccountHeroBlock must not replace whole-account P&L with open positions",
  );
  assert.doesNotMatch(source, /field: "OpenPositionsDayChange"/);
});

test("P&L calendar does not receive the open-position hero metric", () => {
  const returnsPanel = source.match(/<AccountReturnsPanel[\s\S]*?\/>/)?.[0] ?? "";

  assert.ok(returnsPanel, "Missing AccountReturnsPanel in AccountScreen");
  assert.doesNotMatch(returnsPanel, /dailyPnl=/);
  assert.match(returnsPanel, /equityPoints=\{returnsCalendarEquityPoints\}/);
});

test("a later live NAV terminal keeps uncovered cash events and returns unknown", () => {
  const result = equityQueryWithLivePositionsTerminal({
    query: {
      data: {
        currency: "USD",
        points: [
          {
            timestamp: "2026-07-17T20:00:00.000Z",
            netLiquidation: 1_100,
            deposits: 100,
            withdrawals: 0,
            dividends: 5,
            fees: 1,
          },
        ],
      },
    },
    netLiquidation: 1_110,
    currency: "USD",
    updatedAt: "2026-07-17T21:00:00.000Z",
  });

  assert.deepEqual(
    result.data.points.map((point) => ({
      timestamp: point.timestamp,
      deposits: point.deposits,
      withdrawals: point.withdrawals,
      dividends: point.dividends,
      fees: point.fees,
    })),
    [
      {
        timestamp: "2026-07-17T20:00:00.000Z",
        deposits: 100,
        withdrawals: 0,
        dividends: 5,
        fees: 1,
      },
      {
        timestamp: "2026-07-17T21:00:00.000Z",
        deposits: null,
        withdrawals: null,
        dividends: null,
        fees: null,
      },
    ],
  );
  assert.equal(result.data.points.at(-1).returnPercent, null);
});

test("a live NAV terminal requires authoritative timestamp and currency agreement", () => {
  const query = {
    data: {
      currency: "USD",
      points: [],
    },
  };

  assert.equal(
    equityQueryWithLivePositionsTerminal({
      query,
      netLiquidation: 1_000,
      currency: "CAD",
      updatedAt: "2026-07-17T21:00:00.000Z",
    }),
    query,
  );
  assert.equal(
    equityQueryWithLivePositionsTerminal({
      query,
      netLiquidation: 1_000,
      currency: "USD",
      updatedAt: null,
    }),
    query,
  );
});
