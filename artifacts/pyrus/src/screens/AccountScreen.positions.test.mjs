import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { livePositionsDayPnlMetric } from "./AccountScreen.jsx";

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

test("real account positions queries request live quote snapshots", () => {
  assert.equal(
    (source.match(/liveQuotes:\s*true/g) || []).length,
    2,
    "active positions query and account-switch prefetch must request live quotes",
  );
  assert.doesNotMatch(
    source,
    /liveQuotes:\s*false/,
    "AccountScreen must not rely on quote-free positions for visible real-account rows",
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

test("Account stream gates REST directly without fallback-ready state", () => {
  assert.doesNotMatch(source, /FallbackReady/);
  assert.doesNotMatch(source, /rest-fallback/);
});

test("enabled Account page stream owns generic demand without boot or inactive REST fanout", () => {
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
  assert.doesNotMatch(restGateBlock, /accountPageStreamFreshness/);
  for (const gate of [
    "primaryAccountRestQueriesEnabled",
    "liveAccountQueriesEnabled",
    "derivedAccountQueriesEnabled",
    "performanceCalendarQueriesEnabled",
    "tradingAnalysisQueriesEnabled",
  ]) {
    assert.match(
      restGateBlock,
      new RegExp(
        `const ${gate} = Boolean\\(\\s*genericAccountQueriesEnabled &&\\s*!accountPageStreamEnabled,?\\s*\\);`,
      ),
      `${gate} must stay off whenever the generic Account stream is enabled`,
    );
  }

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

test("SnapTrade account history query does not override generic derived surfaces", () => {
  assert.match(
    source,
    /useGetSnapTradeAccountHistory/,
    "AccountScreen must import the generated SnapTrade history hook",
  );
  assert.match(
    source,
    /const snapTradeHistoryQuery = useGetSnapTradeAccountHistory\(/,
    "SnapTrade account tabs must request the read-only history endpoint",
  );
  assert.match(
    source,
    /history: snapTradeHistoryQueryForDisplay\.data/,
    "SnapTrade panel data must receive backend activity and balance history",
  );
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

// Owner ruling 2026-07-09: the account hero Day P&L means the positions-table
// number (open positions' day change). The calendar has a separate whole-account
// contract so realized exits and transfer-adjusted NAV remain continuous at midnight.
test("hero pill day P&L reads the positions-table day change, not the equity metric", () => {
  assert.match(
    source,
    /const heroSummaryData = useMemo\(/,
    "Missing heroSummaryData override in AccountScreen",
  );
  assert.match(
    source,
    /openDayPnl = finiteAccountNumber\(\s*livePositionsDayPnl\?\.openPositionsDayPnl/,
    "Pill override must source livePositionsDayPnl.openPositionsDayPnl",
  );
  assert.match(
    source,
    /summary=\{heroSummaryData\}/,
    "AccountHeroBlock must receive the overridden summary",
  );
});

test("P&L calendar does not receive the open-position hero metric", () => {
  const returnsPanel = source.match(/<AccountReturnsPanel[\s\S]*?\/>/)?.[0] ?? "";

  assert.ok(returnsPanel, "Missing AccountReturnsPanel in AccountScreen");
  assert.doesNotMatch(returnsPanel, /dailyPnl=/);
  assert.match(returnsPanel, /equityPoints=\{returnsCalendarEquityPoints\}/);
});

test("hero position Day percent uses summed prior-close bases", () => {
  const metric = livePositionsDayPnlMetric({
    positionsResponse: {
      currency: "USD",
      positions: [
        {
          quantity: 1,
          marketValue: 1_200,
          dayChange: 200,
          dayChangePercent: 20,
        },
        {
          quantity: -1,
          marketValue: -800,
          dayChange: -100,
          dayChangePercent: -10,
        },
      ],
    },
    fallbackMetric: null,
    tradesResponse: null,
    currency: "USD",
  });

  assert.equal(metric.openPositionsDayPnl, 100);
  assert.equal(metric.openPositionsDayPnlPercent, 5);
});
