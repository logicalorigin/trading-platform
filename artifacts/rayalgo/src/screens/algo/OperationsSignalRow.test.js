import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { T } from "../../lib/uiTokens.jsx";
import {
  resolveSpreadWidthFraction,
  spreadGaugeTone,
} from "../../components/platform/signal-language/SpreadGauge.jsx";
import { resolveSignalVerdict } from "../../components/platform/signal-language/VerdictGlyph.jsx";

const readSource = (relativeUrl) =>
  readFileSync(new URL(relativeUrl, import.meta.url), "utf8");

test("signal row presents compact signal action decision columns", () => {
  const rowSource = readSource("./OperationsSignalRow.jsx");

  assert.match(rowSource, /COMPACT_COLUMNS/);
  assert.match(rowSource, /\{ key: "signal", label: "Signal", track: "minmax\(0, 1fr\)" \}/);
  assert.match(rowSource, /\{ key: "since", label: "Since", track: "minmax\(0, 0\.42fr\)" \}/);
  assert.match(rowSource, /\{ key: "action", label: "Action", track: "minmax\(0, 1fr\)" \}/);
  assert.match(rowSource, /\{ key: "execution", label: "Execution", track: "minmax\(0, 0\.92fr\)" \}/);
  assert.match(rowSource, /\{ key: "decision", label: "Decision", track: "minmax\(0, 1\.08fr\)" \}/);
  assert.match(rowSource, /\{ key: "rowAction", label: "Act", width: 48 \}/);
  assert.match(rowSource, /COMPACT_COLUMN_TEMPLATE/);
  assert.match(rowSource, /signalSinceDisplay/);
  assert.doesNotMatch(rowSource, /\{ key: "contract", label: "Contract", width:/);
  assert.doesNotMatch(rowSource, /\{ key: "quote", label: "Option quote", width:/);
  assert.doesNotMatch(rowSource, /ScoreBar/);
  assert.doesNotMatch(rowSource, /ScorePill/);
  assert.match(rowSource, /resolveSignalScoreBreakdown/);
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
  assert.match(rowSource, /BigDirectionGlyph/);
  assert.match(rowSource, /SignalDots/);
  assert.doesNotMatch(rowSource, /ConfluenceChip/);
  assert.match(rowSource, /VerdictGlyph/);
  assert.match(rowSource, /RowActionButton/);
  assert.match(rowSource, /SpreadGauge/);
  assert.match(rowSource, /components\/platform\/signal-language/);
  assert.match(rowSource, /ra-signal-row-glow/);
  assert.match(rowSource, /ra-signal-row-focus/);
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
  assert.match(tableSource, /useState\("newest"\)/);
  assert.match(tableSource, /signalTimestampMs\(b\.signal\) - signalTimestampMs\(a\.signal\)/);
  assert.match(tableSource, /sortKey=\{sortKey\}/);
  assert.match(tableSource, /onSortChange=\{setSortKey\}/);
  assert.match(tableSource, /aria-label="Filter signals"/);
  assert.match(tableSource, /Symbol or strategy/);
  assert.doesNotMatch(tableSource, /<span>Sort<\/span>/);
  assert.match(rowSource, /COMPACT_COLUMN_SORTS/);
  assert.match(rowSource, /signal: \{ sortKey: "symbol"/);
  assert.match(rowSource, /since: \{ sortKey: "newest"/);
  assert.match(rowSource, /decision: \{ sortKey: "score"/);
  assert.match(rowSource, /aria-pressed=\{active\}/);
  assert.match(rowSource, /onSortChange\?\.\(sort\.sortKey\)/);
  assert.match(rowSource, /ChevronDown/);
  assert.match(tableSource, /Scan running/);
  assert.match(tableSource, /buildSignalMatrixBySymbol\(signalMatrixStates\)/);
  assert.match(tableSource, /useRuntimeTickerSnapshots\(rowSymbols\)/);
  assert.match(tableSource, /SIGNALS_PAGE_SIZE = 30/);
  assert.match(tableSource, /dataTestId="algo-signals-pagination"/);
  assert.match(tableSource, /pageRows\.map/);
  assert.match(tableSource, /tfMatrix=\{signalMatrixBySymbol/);
  assert.match(tableSource, /scoreBreakdown: resolveSignalScoreBreakdown\(\{ signal, candidate \}\)/);
  assert.match(tableSource, /scoreSortValue\(b\.scoreBreakdown\) - scoreSortValue\(a\.scoreBreakdown\)/);
  assert.match(tableSource, /overflowX: "hidden"/);
  assert.doesNotMatch(tableSource, /overflowX: "auto"/);
  assert.doesNotMatch(tableSource, /a\.signal\.score/);
  assert.doesNotMatch(algoScreenSource, /visibleSignalRows[\s\S]*?\.slice\(0,\s*algoIsPhone \? 8 : 20\)/);
  assert.match(livePageSource, /signalMatrixStates = \[\]/);
  assert.match(livePageSource, /signalMatrixStates=\{signalMatrixStates\}/);
  assert.match(livePageSource, /cockpitGeneratedAt=\{cockpitGeneratedAt\}/);
  assert.match(livePageSource, /cockpitStageItems=\{cockpitStageItems\}/);
  assert.match(algoScreenSource, /signalMatrixStates = \[\]/);
  assert.match(algoScreenSource, /signalMatrixStates=\{signalMatrixStates\}/);
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
  assert.match(cssSource, /\.ra-signal-row-focus:focus-visible/);
  assert.match(
    cssSource,
    /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.ra-signal-row-glow[\s\S]*?animation: none/,
  );
  assert.match(
    cssSource,
    /html\[data-pyrus-reduced-motion="on"\] \.ra-signal-row-glow[\s\S]*?animation: none/,
  );
  assert.match(
    cssSource,
    /html\[data-rayalgo-reduced-motion="on"\] \.ra-signal-row-glow[\s\S]*?animation: none/,
  );
});


test("verdict buckets follow the fresh score seven actionability rule", () => {
  assert.equal(
    resolveSignalVerdict({
      signal: { fresh: true },
      signalRecord: { score: 7 },
      blocker: "—",
      statusMeta: { tone: T.green, label: "Ready" },
    }).bucket,
    "try",
  );
  assert.equal(
    resolveSignalVerdict({
      signal: { fresh: true },
      signalRecord: { score: 6.9 },
      blocker: "—",
      statusMeta: { tone: T.green, label: "Ready" },
    }).bucket,
    "wait",
  );
  assert.equal(
    resolveSignalVerdict({
      signal: { fresh: true },
      signalRecord: { score: 8.2 },
      blocker: "Missing bid/ask quote",
      statusMeta: { tone: T.red, label: "Blocked" },
    }).bucket,
    "pass",
  );
});

test("spread gauge classifies tight medium and wide option spreads", () => {
  assert.ok(
    Math.abs(resolveSpreadWidthFraction({ bid: 0.99, ask: 1.01, mid: 1 }) - 0.02) <
      0.000001,
  );
  assert.equal(spreadGaugeTone(0.009), T.green);
  assert.equal(spreadGaugeTone(0.02), T.amber);
  assert.equal(spreadGaugeTone(0.031), T.red);
});
