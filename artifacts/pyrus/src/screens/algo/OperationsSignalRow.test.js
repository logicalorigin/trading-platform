import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  resolveSpreadWidthFraction,
  spreadGaugeTone,
} from "../../components/platform/signal-language/SpreadGauge.jsx";
import { resolveSignalVerdict } from "../../components/platform/signal-language/VerdictGlyph.jsx";
import { sortRows } from "./OperationsSignalTable.jsx";
import {
  ALWAYS_VISIBLE_SIGNAL_COLUMN_IDS,
  DEFAULT_SIGNAL_VISIBLE_COLUMNS,
  normalizeSignalColumnOrder,
  normalizeSignalVisibleColumns,
} from "./OperationsSignalRow.jsx";

const readSource = (relativeUrl) =>
  readFileSync(new URL(relativeUrl, import.meta.url), "utf8");

const CSS_COLOR = {
  green: "var(--ra-green-500)",
  amber: "var(--ra-amber-500)",
  red: "var(--ra-red-500)",
};

test("signal table sorting honors column key and direction", () => {
  const rows = [
    {
      signal: {
        symbol: "MSFT",
        signalAt: "2026-05-22T19:10:00.000Z",
        barsSinceSignal: 7,
        signalPrice: 100,
        currentPrice: 102,
      },
      candidate: {
        updatedAt: "2026-05-22T19:11:00.000Z",
        quote: { ageMs: 5000 },
        liquidity: { spreadPctOfMid: 4 },
      },
      scoreBreakdown: { score: 55 },
    },
    {
      signal: {
        symbol: "AAPL",
        signalAt: "2026-05-22T19:00:00.000Z",
        barsSinceSignal: 12,
        signalPrice: 200,
        currentPrice: 198,
      },
      candidate: {
        updatedAt: "2026-05-22T19:30:00.000Z",
        quote: { ageMs: 1000 },
        liquidity: { spreadPctOfMid: 1 },
      },
      scoreBreakdown: { score: 72 },
    },
    {
      signal: {
        symbol: "TSLA",
        signalAt: "2026-05-22T19:20:00.000Z",
        barsSinceSignal: 1,
        signalPrice: 50,
        currentPrice: 52.5,
      },
      candidate: {
        updatedAt: "2026-05-22T19:25:00.000Z",
        quote: { ageMs: 3000 },
        liquidity: { spreadPctOfMid: 2 },
      },
      scoreBreakdown: { score: 44 },
    },
  ];
  const rowsWithMissingBars = [
    rows[0],
    {
      signal: { symbol: "NVDA", signalAt: "2026-05-22T19:15:00.000Z" },
      scoreBreakdown: {},
    },
    rows[2],
  ];

  assert.deepEqual(
    sortRows(rows, "symbol", null, "asc").map((row) => row.signal.symbol),
    ["AAPL", "MSFT", "TSLA"],
  );
  assert.deepEqual(
    sortRows(rows, "symbol", null, "desc").map((row) => row.signal.symbol),
    ["TSLA", "MSFT", "AAPL"],
  );
  assert.deepEqual(
    sortRows(rows, "bars", null, "asc").map((row) => row.signal.symbol),
    ["TSLA", "MSFT", "AAPL"],
  );
  assert.deepEqual(
    sortRows(rows, "move", null, "desc").map((row) => row.signal.symbol),
    ["TSLA", "MSFT", "AAPL"],
  );
  assert.deepEqual(
    sortRows(rows, "quoteAge", null, "asc").map((row) => row.signal.symbol),
    ["AAPL", "TSLA", "MSFT"],
  );
  assert.deepEqual(
    sortRows(rows, "spread", null, "asc").map((row) => row.signal.symbol),
    ["AAPL", "TSLA", "MSFT"],
  );
  assert.deepEqual(
    sortRows(rowsWithMissingBars, "bars", null, "desc").map(
      (row) => row.signal.symbol,
    ),
    ["MSFT", "TSLA", "NVDA"],
  );
  assert.deepEqual(
    sortRows(rows, "score", null, "desc").map((row) => row.signal.symbol),
    ["AAPL", "MSFT", "TSLA"],
  );
  assert.deepEqual(
    sortRows(rows, "newest", null, "asc").map((row) => row.signal.symbol),
    ["AAPL", "MSFT", "TSLA"],
  );
  assert.deepEqual(
    sortRows(rows, "latest", null, "desc").map((row) => row.signal.symbol),
    ["AAPL", "TSLA", "MSFT"],
  );
  assert.equal(sortRows(rows, "bars", "AAPL", "asc")[0].signal.symbol, "AAPL");
});

test("signal row presents dense customizable signal action columns", () => {
  const rowSource = readSource("./OperationsSignalRow.jsx");

  assert.deepEqual(ALWAYS_VISIBLE_SIGNAL_COLUMN_IDS, [
    "signal",
    "since",
    "decision",
    "rowAction",
  ]);
  assert.deepEqual(DEFAULT_SIGNAL_VISIBLE_COLUMNS, [
    "signal",
    "since",
    "move",
    "action",
    "contract",
    "quote",
    "spread",
    "greeks",
    "gate",
    "sync",
    "score",
    "decision",
    "rowAction",
  ]);
  assert.deepEqual(
    normalizeSignalColumnOrder(["score", "signal", "score", "unknown"]).slice(0, 2),
    ["score", "signal"],
  );
  assert.deepEqual(normalizeSignalVisibleColumns(["move"]), [
    "signal",
    "since",
    "move",
    "decision",
    "rowAction",
  ]);
  assert.match(rowSource, /SIGNAL_TABLE_COLUMNS/);
  assert.match(rowSource, /key: "signal"[\s\S]*?label: "Signal"/);
  assert.match(rowSource, /key: "move"[\s\S]*?label: "Move"/);
  assert.match(rowSource, /key: "contract"[\s\S]*?label: "Contract"/);
  assert.match(rowSource, /key: "quote"[\s\S]*?label: "Quote"/);
  assert.match(rowSource, /key: "spread"[\s\S]*?label: "Spread"/);
  assert.match(rowSource, /key: "greeks"[\s\S]*?label: "Greeks"/);
  assert.match(rowSource, /key: "gate"[\s\S]*?label: "Gate"/);
  assert.match(rowSource, /key: "sync"[\s\S]*?label: "Sync"/);
  assert.match(rowSource, /key: "since"[\s\S]*?label: "Age"/);
  assert.match(rowSource, /key: "action"[\s\S]*?label: "Plan"/);
  assert.match(rowSource, /key: "score"[\s\S]*?label: "Quality"/);
  assert.match(rowSource, /key: "decision"[\s\S]*?label: "Decision"/);
  assert.match(rowSource, /key: "rowAction"[\s\S]*?label: "Act"[\s\S]*?width: 48/);
  assert.match(rowSource, /signalColumnTemplate/);
  assert.match(rowSource, /signalTableMinWidth/);
  assert.match(rowSource, /columns = DEFAULT_SIGNAL_VISIBLE_COLUMNS/);
  assert.match(rowSource, /visibleColumns\.map\(\(column\)/);
  assert.match(rowSource, /MobileMetricChip/);
  assert.match(rowSource, /mobileMetricCells/);
  assert.match(rowSource, /mobileAgeValue/);
  assert.match(rowSource, /label: "Age"/);
  assert.match(rowSource, /label: "Q"/);
  assert.match(rowSource, /data-testid="algo-signal-mobile-metrics"/);
  assert.match(rowSource, /rowHeight=\{algoIsPhone \? 84 : 56\}/);
  assert.match(rowSource, /signalSinceDisplay/);
  assert.doesNotMatch(rowSource, /ScoreBar/);
  assert.doesNotMatch(rowSource, /ScorePill/);
  assert.match(rowSource, /resolveSignalScoreBreakdown/);
  assert.doesNotMatch(rowSource, /resolveSignalActionStageStates/);
  assert.doesNotMatch(rowSource, /StageColumnCell/);
  assert.doesNotMatch(rowSource, /data-stage-state/);
  assert.match(rowSource, /actionabilitySignalRecord/);
  assert.doesNotMatch(rowSource, /Number\(signalRecord\.score\)/);
  assert.match(rowSource, /resolveCandidateGateDisplay/);
  assert.match(rowSource, /resolveCandidateSyncDisplay/);
  assert.match(rowSource, /resolveDecisionDetailMeta/);
  assert.match(rowSource, /decisionDetailText/);
  assert.match(rowSource, /DECISION_DETAIL_META/);
  assert.doesNotMatch(rowSource, /ReasonChip/);
  assert.doesNotMatch(rowSource, /resolveReasonChipMeta/);
  assert.doesNotMatch(rowSource, /REASON_ICON_META/);
  assert.match(rowSource, /compactQuoteText/);
  assert.match(rowSource, /formatQuoteAge/);
  assert.match(rowSource, /formatSpreadWidth/);
  assert.match(rowSource, /scoreTone/);
  assert.match(rowSource, /BigDirectionGlyph/);
  assert.match(rowSource, /SignalDots/);
  assert.doesNotMatch(rowSource, /ConfluenceChip/);
  assert.match(rowSource, /VerdictGlyph/);
  assert.match(rowSource, /RowActionButton/);
  assert.match(rowSource, /SpreadGauge/);
  assert.match(rowSource, /components\/platform\/signal-language/);
  assert.match(rowSource, /ra-signal-row-glow/);
  assert.match(rowSource, /ra-signal-row-focus/);
  assert.match(rowSource, /scanActive = false/);
  assert.match(rowSource, /scanIndex = 0/);
  assert.match(rowSource, /ra-signal-row-scan/);
  assert.match(rowSource, /--ra-signal-scan-accent/);
  assert.match(rowSource, /--ra-signal-scan-delay/);
  assert.match(rowSource, /useValueFlash\(liveUnderlyingPrice\)/);
});

test("algo signal table builds matrix and runtime ticker snapshots once per table", () => {
  const tableSource = readSource("./OperationsSignalTable.jsx");
  const rowSource = readSource("./OperationsSignalRow.jsx");
  const livePageSource = readSource("./AlgoLivePage.jsx");
  const algoScreenSource = readSource("../AlgoScreen.jsx");
  const routerSource = readFileSync(
    new URL("../../features/platform/PlatformScreenRouter.jsx", import.meta.url),
    "utf8",
  );
  const appSource = readFileSync(
    new URL("../../features/platform/PlatformApp.jsx", import.meta.url),
    "utf8",
  );

  assert.match(tableSource, /signalMatrixStates = \[\]/);
  assert.match(tableSource, /key: "newest",\s*direction: defaultSortDirection\("newest"\)/);
  assert.match(tableSource, /toggleSortDirection\(current\.direction\)/);
  assert.match(tableSource, /compareTimestampValues\(\s*signalTimestampMs\(a\.signal\),\s*signalTimestampMs\(b\.signal\),\s*sortDirection,/);
  assert.match(tableSource, /sortKey=\{sortKey\}/);
  assert.match(tableSource, /sortDirection=\{sortDirection\}/);
  assert.match(tableSource, /onSortChange=\{handleSortChange\}/);
  assert.match(tableSource, /aria-label="Filter signals"/);
  assert.match(tableSource, /Symbol or strategy/);
  assert.match(tableSource, /mobileStatusLine/);
  assert.match(tableSource, /placeholder=\{algoIsPhone \? "Search" : "Symbol or strategy"\}/);
  assert.match(tableSource, /padding: algoIsPhone \? sp\("4px 6px"\) : sp\("6px 10px"\)/);
  assert.doesNotMatch(tableSource, /<span>Sort<\/span>/);
  assert.match(rowSource, /key: "signal"[\s\S]*?sortKey: "symbol"/);
  assert.match(rowSource, /key: "since"[\s\S]*?sortKey: "bars"/);
  assert.match(rowSource, /key: "move"[\s\S]*?sortKey: "move"/);
  assert.match(rowSource, /key: "quote"[\s\S]*?sortKey: "quoteAge"/);
  assert.match(rowSource, /key: "spread"[\s\S]*?sortKey: "spread"/);
  assert.match(rowSource, /key: "score"[\s\S]*?sortKey: "score"/);
  assert.match(rowSource, /key: "decision"[\s\S]*?sortKey: "latest"/);
  assert.match(rowSource, /aria-sort=\{sort \? ariaSort : undefined\}/);
  assert.match(rowSource, /aria-pressed=\{active\}/);
  assert.match(rowSource, /currently \$\{ariaSort\}/);
  assert.match(rowSource, /onSortChange\?\.\(sort\.sortKey\)/);
  assert.match(rowSource, /sortDirection === "asc" \? "rotate\(180deg\)" : "none"/);
  assert.match(rowSource, /ChevronDown/);
  assert.match(tableSource, /Scan running/);
  assert.match(tableSource, /scanStageRecord\.detail/);
  assert.match(tableSource, /freshness\.scanDetail/);
  assert.match(tableSource, /pageRows\.map\(\(\{ signal, candidate, scoreBreakdown \}, index\)/);
  assert.match(tableSource, /scanActive=\{freshness\.scanRunning\}/);
  assert.match(tableSource, /scanIndex=\{index\}/);
  assert.match(tableSource, /buildSignalMatrixBySymbol\(signalMatrixStates\)/);
  assert.match(tableSource, /useRuntimeTickerSnapshots\(rowSymbols\)/);
  assert.match(tableSource, /SIGNALS_PAGE_SIZE = 30/);
  assert.match(tableSource, /dataTestId="algo-signals-pagination"/);
  assert.match(tableSource, /pageRows\.map/);
  assert.match(tableSource, /tfMatrix=\{signalMatrixBySymbol/);
  assert.match(tableSource, /columns=\{visibleColumns\}/);
  assert.match(tableSource, /scoreBreakdown: resolveSignalScoreBreakdown\(\{ signal, candidate \}\)/);
  assert.match(tableSource, /compareFiniteValues\(\s*scoreSortValue\(a\.scoreBreakdown\),\s*scoreSortValue\(b\.scoreBreakdown\),\s*sortDirection,/);
  assert.match(tableSource, /signalMoveSortValue\(a\)/);
  assert.match(tableSource, /quoteAgeSortValue\(a\.candidate\)/);
  assert.match(tableSource, /spreadSortValue\(a\.candidate\)/);
  assert.match(tableSource, /rowActivityTimestampMs\(a\)/);
  assert.match(tableSource, /OperationsSignalColumnDrawer/);
  assert.match(tableSource, /data-testid="algo-signal-column-drawer"/);
  assert.match(tableSource, /algoSignalColumnOrder/);
  assert.match(tableSource, /algoSignalVisibleColumns/);
  assert.match(tableSource, /Columns3/);
  assert.match(tableSource, /overflowX: "auto"/);
  assert.doesNotMatch(tableSource, /overflowX: "hidden"/);
  assert.doesNotMatch(tableSource, /a\.signal\.score/);
  assert.doesNotMatch(algoScreenSource, /visibleSignalRows[\s\S]*?\.slice\(0,\s*algoIsPhone \? 8 : 20\)/);
  assert.match(livePageSource, /signalMatrixStates = \[\]/);
  assert.match(livePageSource, /signalMatrixStates=\{signalMatrixStates\}/);
  assert.match(livePageSource, /cockpitGeneratedAt=\{cockpitGeneratedAt\}/);
  assert.match(livePageSource, /cockpitStageItems=\{cockpitStageItems\}/);
  assert.match(livePageSource, /data-testid="algo-settings-drawer-open"[\s\S]*?fill: false/);
  assert.match(livePageSource, /padding: algoIsPhone \? sp\("4px 6px"\) : sp\("6px 10px"\)/);
  assert.match(livePageSource, /fontSize: fs\(algoIsPhone \? 11 : 13\)/);
  assert.match(algoScreenSource, /signalMatrixStates = \[\]/);
  assert.match(algoScreenSource, /signalMatrixStates=\{signalMatrixStates\}/);
  assert.match(algoScreenSource, /padding: sp\(algoIsPhone \? "6px 6px 14px" : "16px 24px 20px"\)/);
  assert.match(algoScreenSource, /gap: sp\(algoIsPhone \? 5 : 10\)/);
  assert.match(routerSource, /signalMatrixStates,/);
  assert.match(routerSource, /signalMatrixStates=\{signalMatrixStates\}/);
  assert.match(appSource, /signalMatrixStates=\{signalMatrixSnapshot\.states\}/);
});

test("shared signal dots preserve watchlist behavior after extraction", () => {
  const signalDotsSource = readFileSync(
    new URL("../../components/platform/signal-language/SignalDots.jsx", import.meta.url),
    "utf8",
  );
  const compatibilitySource = readFileSync(
    new URL("../../components/platform/SignalDots.jsx", import.meta.url),
    "utf8",
  );
  const watchlistSource = readFileSync(
    new URL("../../features/platform/PlatformWatchlist.jsx", import.meta.url),
    "utf8",
  );
  const rowSource = readSource("./OperationsSignalRow.jsx");

  assert.match(signalDotsSource, /timeframes = SIGNAL_TIMEFRAMES/);
  assert.doesNotMatch(signalDotsSource, /watchlistModel/);
  assert.match(signalDotsSource, /showLabels = false/);
  assert.match(signalDotsSource, /testId = "watchlist-signal-dots"/);
  assert.match(signalDotsSource, /data-testid=\{testId\}/);
  assert.match(signalDotsSource, /fallbackState\.timeframe \|\| "5m"/);
  assert.match(rowSource, /testId="algo-signal-dots"/);
  assert.match(compatibilitySource, /signal-language\/SignalDots/);
  assert.doesNotMatch(watchlistSource, /const WatchlistSignalDots/);
  assert.match(watchlistSource, /components\/platform\/signal-language/);
  assert.match(watchlistSource, /<SignalDots/);
});

test("signal row motion classes respect reduced-motion settings", () => {
  const cssSource = readFileSync(new URL("../../index.css", import.meta.url), "utf8");

  assert.match(cssSource, /@keyframes raSignalHotGlow/);
  assert.match(cssSource, /@keyframes raSignalGlyphFresh/);
  assert.match(cssSource, /@keyframes raSignalRowScan/);
  assert.match(cssSource, /\.ra-signal-row-focus:focus-visible/);
  assert.match(cssSource, /\.ra-signal-row-scan::after/);
  assert.match(
    cssSource,
    /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.ra-signal-row-glow[\s\S]*?\.ra-signal-row-scan::after[\s\S]*?animation: none/,
  );
  assert.match(
    cssSource,
    /html\[data-pyrus-reduced-motion="on"\] \.ra-signal-row-glow[\s\S]*?html\[data-pyrus-reduced-motion="on"\] \.ra-signal-row-scan::after[\s\S]*?animation: none/,
  );
  assert.match(
    cssSource,
    /html\[data-pyrus-reduced-motion="on"\] \.ra-signal-row-scan::after[\s\S]*?animation: none/,
  );
});


test("verdict buckets follow the fresh score seven actionability rule", () => {
  assert.equal(
    resolveSignalVerdict({
      signal: { fresh: true },
      signalRecord: { score: 7 },
      blocker: "—",
      statusMeta: { tone: CSS_COLOR.green, label: "Ready" },
    }).bucket,
    "try",
  );
  assert.equal(
    resolveSignalVerdict({
      signal: { fresh: true },
      signalRecord: { score: 6.9 },
      blocker: "—",
      statusMeta: { tone: CSS_COLOR.green, label: "Ready" },
    }).bucket,
    "wait",
  );
  assert.equal(
    resolveSignalVerdict({
      signal: { fresh: true },
      signalRecord: { score: 8.2 },
      blocker: "Missing bid/ask quote",
      statusMeta: { tone: CSS_COLOR.red, label: "Blocked" },
    }).bucket,
    "pass",
  );
});

test("spread gauge classifies tight medium and wide option spreads", () => {
  assert.ok(
    Math.abs(resolveSpreadWidthFraction({ bid: 0.99, ask: 1.01, mid: 1 }) - 0.02) <
      0.000001,
  );
  assert.equal(spreadGaugeTone(0.009), CSS_COLOR.green);
  assert.equal(spreadGaugeTone(0.02), CSS_COLOR.amber);
  assert.equal(spreadGaugeTone(0.031), CSS_COLOR.red);
});
