import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./AccountScreen.jsx", import.meta.url), "utf8");

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
    "Positions REST polling must use the stream freshness fallback gate instead of staying always-on.",
  );
});

test("SnapTrade account positions enable live Massive quote hydration", () => {
  assert.match(
    source,
    /const accountLiveOptionQuotesEnabled = Boolean\(\s*\(genericAccountQueriesEnabled \|\| snapTradeAccountPanelsEnabled\) &&\s*accountPrimaryReady,?\s*\);/,
    "SnapTrade account tabs must enable the shared positions quote hydrator",
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
    /const positionsAtDateQueryForDisplay = snapTradeAccountPanelsEnabled\s*\?\s*buildIdleAccountQuery\(snapTradePanelData\?\.positionsAtDate\)\s*:\s*positionsAtDateQuery;/,
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
    /history: snapTradeHistoryQuery\.data/,
    "SnapTrade panel data must receive backend activity and balance history",
  );
  assert.match(
    source,
    /const tradesQueryForDisplay = tradesQuery;/,
    "SnapTrade trading analysis must use the generic closed-trades endpoint",
  );
  assert.match(
    source,
    /const performanceCalendarTradesQueryForDisplay = performanceCalendarTradesQuery;/,
    "SnapTrade returns calendar must use the generic closed-trades endpoint",
  );
  assert.match(
    source,
    /const performanceCalendarEquityQueryForDisplay = performanceCalendarEquityQuery;/,
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
  assert.match(source, /const positionManagementGatewayReady = Boolean\(!shadowMode && gatewayTradingReady\);/);
  assert.match(
    source,
    /const positionManagementGatewayMessage = shadowMode\s*\?\s*"Shadow positions cannot be managed with live broker orders\."\s*:\s*gatewayTradingMessage;/,
  );

  const positionsPanel = source.match(
    /<PositionsPanel[\s\S]*?\/>/,
  )?.[0] ?? "";

  assert.match(positionsPanel, /accountId=\{positionManagementAccountId\}/);
  assert.match(positionsPanel, /environment=\{modeParams\.mode\}/);
  assert.match(positionsPanel, /gatewayTradingReady=\{positionManagementGatewayReady\}/);
  assert.match(positionsPanel, /gatewayTradingMessage=\{positionManagementGatewayMessage\}/);
});
