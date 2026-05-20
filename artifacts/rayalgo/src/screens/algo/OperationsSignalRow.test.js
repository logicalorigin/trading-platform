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

test("signal row hero merges underlying and signal columns with earned flair", () => {
  const rowSource = readSource("./OperationsSignalRow.jsx");

  assert.match(rowSource, /\{ key: "signalHero", label: "Signal", width: 250 \}/);
  assert.doesNotMatch(rowSource, /ScoreBar/);
  assert.match(rowSource, /BigDirectionGlyph/);
  assert.match(rowSource, /SignalDots/);
  assert.match(rowSource, /ConfluenceChip/);
  assert.match(rowSource, /VerdictGlyph/);
  assert.match(rowSource, /SpreadGauge/);
  assert.match(rowSource, /components\/platform\/signal-language/);
  assert.match(rowSource, /ra-signal-row-glow/);
  assert.match(rowSource, /ra-signal-row-focus/);
  assert.match(rowSource, /useValueFlash\(liveUnderlyingPrice\)/);
});

test("algo signal table builds matrix and runtime ticker snapshots once per table", () => {
  const tableSource = readSource("./OperationsSignalTable.jsx");
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
  assert.match(tableSource, /buildSignalMatrixBySymbol\(signalMatrixStates\)/);
  assert.match(tableSource, /useRuntimeTickerSnapshots\(rowSymbols\)/);
  assert.match(tableSource, /tfMatrix=\{signalMatrixBySymbol/);
  assert.match(livePageSource, /signalMatrixStates = \[\]/);
  assert.match(livePageSource, /signalMatrixStates=\{signalMatrixStates\}/);
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
