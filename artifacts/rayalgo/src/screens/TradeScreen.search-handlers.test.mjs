import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./TradeScreen.jsx", import.meta.url), "utf8");
const chromeSource = readFileSync(
  new URL("../features/trade/TradeWorkspaceChrome.jsx", import.meta.url),
  "utf8",
);
const indexCssSource = readFileSync(new URL("../index.css", import.meta.url), "utf8");
const platformSource = readFileSync(
  new URL("../features/platform/PlatformApp.jsx", import.meta.url),
  "utf8",
);

test("TradeScreen search handlers use the current ticker-search anchor names", () => {
  assert.doesNotMatch(source, /\b(toggleUniverseSearch|openUniverseSearch)\b/);
  assert.match(source, /const toggleTabSearch = useCallback/);
  assert.match(source, /const openEquitySearch = useCallback/);
  assert.match(source, /onAddNew=\{toggleTabSearch\}/);
  assert.match(source, /onOpenSearch=\{openEquitySearch\}/);
});

test("TradeScreen chart ticker search selects market search results directly", () => {
  assert.doesNotMatch(source, /strictTradeResolution/);
  assert.doesNotMatch(source, /mode:\s*"trade-resolve"/);
  assert.doesNotMatch(source, /strictTrade:\s*true/);
  assert.doesNotMatch(source, /findExactIbkrTradeResolutionRow/);
  assert.match(source, /onSelectTicker=\{handleSelectUniverseTicker\}/);
  assert.match(source, /focusTicker\(nextTicker,\s*result\?\.name \|\| nextTicker\)/);
});

test("TradeScreen lets pending symbol handoffs beat persisted trade state", () => {
  assert.match(source, /export const resolveInitialTradeTicker/);
  assert.match(source, /Number\(symPing\.n\) > 0/);
  assert.match(
    source,
    /pingSymbol\s*\|\|\s*\n\s*normalizeTradeTickerSymbol\(sym\)\s*\|\|\s*\n\s*normalizeTradeTickerSymbol\(persistedActive\)/,
  );
});

test("TradeScreen applies watchlist handoffs before painting stale ticker content", () => {
  assert.match(source, /useLayoutEffect\(\(\) => \{\n\s*if \(!symPing \|\| symPing\.n === 0\) return;/);
  assert.match(source, /const normalizedSym = normalizeTradeTickerSymbol\(symPing\.sym\)/);
  assert.match(source, /focusTicker\(normalizedSym\)/);
});

test("TradeScreen keeps more than eight recent ticker tabs", () => {
  assert.match(source, /export const TRADE_RECENT_TICKER_LIMIT = 16/);
  assert.match(source, /slice\(-TRADE_RECENT_TICKER_LIMIT\)/);
  assert.doesNotMatch(source, /slice\(-8\)/);
});

test("TradeScreen keeps bounded inactive ticker runtimes warm", () => {
  assert.match(source, /export const TRADE_TRACKED_TICKER_LIMIT = 8/);
  assert.match(source, /buildTrackedTradeTickers\(\{ recentTickers, activeTicker \}\)/);
  assert.match(source, /const backgroundTradeRuntimeModels = useMemo/);
  assert.match(source, /const trackedQuoteSymbols = useMemo/);
  assert.match(source, /tradeLiveStreamsEnabled \? trackedTradeTickers : \[activeTicker\]/);
  assert.match(source, /symbols=\{trackedQuoteSymbols\}/);
  assert.match(source, /"trade:tracked-ticker-runtimes"/);
  assert.match(source, /backgroundTradeRuntimeModels\.map/);
  assert.match(source, /<TradeOptionChainRuntime[\s\S]*?ticker=\{model\.ticker\}[\s\S]*?background/);
  assert.match(source, /<TradeFlowRuntime[\s\S]*?ticker=\{model\.ticker\}[\s\S]*?background/);
});

test("Trade tab labels show live price before hiding percent on phone", () => {
  assert.match(chromeSource, /formatQuotePrice\(info\?\.price\)/);
  assert.match(chromeSource, /className="ra-trade-tab-pct"/);
  assert.match(chromeSource, /--ra-pnl-positive/);
  assert.match(chromeSource, /--ra-pnl-negative/);
  assert.match(indexCssSource, /\.ra-trade-tab-pct\s*\{\s*display: inline-flex;/);
  assert.match(indexCssSource, /@media \(max-width: 767px\)[\s\S]*?\.ra-trade-tab-pct\s*\{\s*display: none;/);
});

test("Trade spot chart adds the GEX zero-gamma reference line", () => {
  assert.match(source, /useGexZeroGamma\(activeTicker,\s*\{\s*enabled:\s*tradeLiveStreamsEnabled/);
  assert.match(source, /useGexZeroGammaReferenceLine\(gexZeroGamma\)/);
  assert.match(source, /const equityReferenceLines = useMemo/);
  assert.match(source, /gexZeroGammaReferenceLine[\s\S]*\?\s*\[\.\.\.workspaceReferenceLines,\s*gexZeroGammaReferenceLine\]/);
  assert.match(source, /referenceLines=\{equityReferenceLines\}/);
});

test("TradeScreen option price chart lets the chart surface own empty state", () => {
  assert.match(source, /const optionChartEmptyState = useMemo/);
  assert.match(source, /emptyState=\{optionChartEmptyState\}/);
  assert.doesNotMatch(source, /aria-label="Contract chart empty state"/);
});

test("TradeScreen hydrates option charts from complete option identity without waiting for broker id", () => {
  assert.doesNotMatch(source, /requireProviderContractId:\s*true/);
  assert.doesNotMatch(source, /requireMarketIdentifier:\s*true/);
});

test("TradeScreen keeps option chain snapshots warm while hidden", () => {
  assert.doesNotMatch(
    source,
    /if \(isVisible\) \{\s*return;\s*\}[\s\S]*?clearTradeOptionChainSnapshot\(activeTicker\);/,
  );
});

test("TradeScreen queues active and tracked ticker flow refreshes through the scanner", () => {
  assert.match(source, /const TRADE_FLOW_REFRESH_MS = 5_000/);
  assert.match(source, /const TRADE_FLOW_HISTORY_REFRESH_MS = 15_000/);
  assert.match(source, /const tradeFlowRefreshMs = background/);
  assert.match(source, /const tradeFlowHistoryRefreshMs = background/);
  assert.match(source, /detail:\s*`\$\{Math\.round\(tradeFlowRefreshMs \/ 1000\)\}s`/);
  assert.match(source, /refetchInterval:\s*flowEnabled \? tradeFlowRefreshMs : false/);
  assert.match(source, /refetchInterval:\s*flowEnabled \? tradeFlowHistoryRefreshMs : false/);
  assert.match(source, /flowEnabled && !background/);
  assert.match(
    source,
    /listFlowEventsRequest\(\{\s*underlying:\s*ticker,\s*limit:\s*TRADE_FLOW_LIVE_LIMIT,\s*blocking:\s*false,\s*queueRefresh:\s*true,/,
  );
  assert.doesNotMatch(
    source,
    /listFlowEventsRequest\(\{\s*underlying:\s*ticker,\s*limit:\s*TRADE_FLOW_LIVE_LIMIT,\s*blocking:\s*true,/,
  );
});

test("TradeScreen phone layout uses tabs plus ticket sheet and L2 drawer", () => {
  assert.match(source, /const TRADE_PHONE_PANELS = \[/);
  assert.match(source, /id:\s*"chart"/);
  assert.match(source, /id:\s*"chain"/);
  assert.match(source, /id:\s*"ticket"/);
  assert.match(source, /id:\s*"positions"/);
  assert.match(source, /data-testid="trade-mobile-tabs"/);
  assert.match(source, /testId="trade-mobile-ticket-sheet"/);
  assert.match(source, /testId="trade-mobile-l2-drawer"/);
  assert.match(source, /activeTradePhonePanel === "chart"/);
  assert.match(source, /const handleTradePhonePanelSelect = useCallback/);
  assert.match(source, /const openPhoneTicketSheet = useCallback/);
  assert.match(source, /const renderInlinePhoneTicket =/);
  assert.match(source, /activeTradePhonePanel === "ticket" && !phoneTicketSheetOpen/);
  assert.match(source, /onClick=\{openPhoneTicketSheet\}/);
  assert.doesNotMatch(source, /activeTradePhonePanel === "ticket" \? \(/);
});

test("Platform does not passively reset Trade to the first active watchlist item", () => {
  assert.doesNotMatch(platformSource, /activeWatchlist\.items\.some\(\(item\) => item\.symbol === sym\)/);
  assert.doesNotMatch(platformSource, /activeWatchlist\.items\[0\]\?\.symbol/);
});
