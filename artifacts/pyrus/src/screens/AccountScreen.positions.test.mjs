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

test("SnapTrade account positions enable live Massive quote hydration", () => {
  assert.match(
    source,
    /const accountLiveOptionQuotesEnabled = Boolean\(\s*\(genericAccountQueriesEnabled \|\| snapTradeAccountPanelsEnabled\) &&\s*accountPrimaryReady,?\s*\);/,
    "SnapTrade account tabs must enable the shared positions quote hydrator",
  );
});

test("SnapTrade account equity inspector uses provider-normalized positions", () => {
  assert.match(
    source,
    /const positionsAtDateQueryForDisplay = snapTradeAccountPanelsEnabled\s*\?\s*buildIdleAccountQuery\(snapTradePanelData\?\.positionsAtDate\)\s*:\s*positionsAtDateQuery;/,
    "SnapTrade equity chart inspector must not receive an empty positions placeholder",
  );
});

test("SnapTrade account history query feeds closed trades and equity history", () => {
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
    /const tradesQueryForDisplay = snapTradeAccountPanelsEnabled\s*\?\s*buildProviderAccountQuery\(snapTradeHistoryQuery, snapTradePanelData\?\.closedTrades\)\s*:\s*tradesQuery;/,
    "SnapTrade trading analysis must use history-backed closed trades",
  );
  assert.match(
    source,
    /const performanceCalendarTradesQueryForDisplay = snapTradeAccountPanelsEnabled\s*\?\s*buildProviderAccountQuery\(snapTradeHistoryQuery, snapTradePanelData\?\.closedTrades\)\s*:\s*performanceCalendarTradesQuery;/,
    "SnapTrade returns calendar must use history-backed closed trades",
  );
  assert.match(
    source,
    /const performanceCalendarEquityQueryForDisplay = snapTradeAccountPanelsEnabled\s*\?\s*buildProviderAccountQuery\(snapTradeHistoryQuery, snapTradePanelData\?\.equityHistory\)\s*:\s*performanceCalendarEquityQuery;/,
    "SnapTrade returns calendar must use history-backed equity points",
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
