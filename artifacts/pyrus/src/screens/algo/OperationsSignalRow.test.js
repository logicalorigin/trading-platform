import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  resolveSpreadWidthFraction,
  spreadGaugeTone,
} from "../../components/platform/signal-language/SpreadGauge.jsx";
import { resolveSignalVerdict } from "../../components/platform/signal-language/VerdictGlyph.jsx";
import {
  buildAlgoSignalMatrixHydrationRequest,
  classifySignal,
  sortRows,
} from "./OperationsSignalTable.jsx";
import { buildAlgoPipelinePhases } from "./AlgoOperationsPrimitives.jsx";
import { AlgoLivePage } from "./AlgoLivePage.jsx";
import { resolveOperationsStatus } from "./OperationsStatusOrb.jsx";
import {
  ALWAYS_VISIBLE_SIGNAL_COLUMN_IDS,
  DEFAULT_SIGNAL_COLUMN_ORDER,
  DEFAULT_SIGNAL_VISIBLE_COLUMNS,
  OperationsSignalRow,
  formatSpreadWidth,
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

const matrixState = (symbol, timeframe) => ({
  symbol,
  timeframe,
  latestBarAt: "2026-06-01T21:15:00.000Z",
  status: "ok",
});

test("algo signal table requests matrix hydration for visible STA rows", () => {
  const rows = [
    { signal: { symbol: "USO" } },
    { signal: { symbol: "ASML" } },
    { signal: { symbol: "USO" } },
    { signal: { symbol: "" } },
  ];
  const pageRows = [rows[1], rows[0]];

  const request = buildAlgoSignalMatrixHydrationRequest({
    rows,
    pageRows,
    currentStates: ["1m", "2m", "5m", "15m", "1h"].map((timeframe) =>
      matrixState("USO", timeframe),
    ),
  });

  assert.deepEqual(request, {
    symbols: ["ASML", "USO"],
    prioritySymbols: ["ASML"],
    missingSymbols: ["ASML"],
    requestSymbols: ["ASML"],
    timeframes: ["1m", "2m", "5m", "15m", "1h"],
    reason: "algo-signal-table",
  });
});

test("algo signal table skips matrix hydration when rows are already hydrated", () => {
  const rows = [
    { signal: { symbol: "USO" } },
    { signal: { symbol: "ASML" } },
  ];
  const currentStates = ["USO", "ASML"].flatMap((symbol) =>
    ["1m", "2m", "5m", "15m", "1h"].map((timeframe) =>
      matrixState(symbol, timeframe),
    ),
  );

  assert.equal(
    buildAlgoSignalMatrixHydrationRequest({
      rows,
      pageRows: rows,
      currentStates,
    }),
    null,
  );
});

test("algo status stays attention for non-critical market-session warnings", () => {
  assert.equal(
    resolveOperationsStatus({
      gatewayReady: true,
      scanOn: true,
      deploymentEnabled: true,
      attentionSeverity: "warning",
    }),
    "attention",
  );
  assert.equal(
    resolveOperationsStatus({
      gatewayReady: true,
      scanOn: true,
      deploymentEnabled: true,
      attentionSeverity: "critical",
    }),
    "critical",
  );
  assert.equal(
    resolveOperationsStatus({
      gatewayReady: false,
      scanOn: true,
      deploymentEnabled: true,
      attentionSeverity: null,
    }),
    "critical",
  );
});

test("algo pipeline overview groups redundant stage counts into phases", () => {
  const phases = buildAlgoPipelinePhases([
    { id: "scan_universe", status: "healthy", count: 90 },
    { id: "signal_detected", status: "healthy", count: 7 },
    { id: "action_mapped", status: "healthy", count: 7 },
    { id: "contract_selected", status: "attention", count: 0 },
    { id: "liquidity_risk_gate", status: "healthy", count: 0 },
    { id: "order_shadow", status: "healthy", count: 0 },
    { id: "position_managed", status: "healthy", count: 0 },
    { id: "exit_close", status: "healthy", count: 0 },
  ]);

  assert.deepEqual(
    phases.map((phase) => phase.label),
    ["Signal Cycle", "Entry Path", "Orders", "Management"],
  );
  assert.equal(phases[0].detail, "90 symbols -> 7 signals");
  assert.equal(phases[1].detail, "7 actions -> 0 contracts");
  assert.equal(phases[1].status, "attention");
  assert.equal(phases[1].selectStageId, "contract_selected");
});

test("algo live page upper area suppresses empty duplicate status strips", () => {
  const previousReact = globalThis.React;
  globalThis.React = React;
  let html = "";
  try {
    html = renderToStaticMarkup(
      React.createElement(AlgoLivePage, {
        deployments: [{ id: "dep-1", enabled: true, name: "Paper" }],
        candidateDrafts: [],
        cockpitKpis: {
          dailyRealizedPnl: 0,
          openUnrealizedPnl: 0,
          openPositions: 0,
          openPremium: 0,
          dailyLossRemaining: 1000,
          openSymbols: 0,
          maxOpenSymbols: 10,
        },
        cockpitRisk: { dailyHaltActive: false, openSymbols: 0, maxOpenSymbols: 10 },
        cockpitTradePath: { gatewayBlocks: [] },
        cockpitStageItems: [
          { id: "scan_universe", status: "healthy", count: 90 },
          { id: "signal_detected", status: "healthy", count: 7 },
          { id: "action_mapped", status: "healthy", count: 7 },
          { id: "contract_selected", status: "attention", count: 0 },
          { id: "liquidity_risk_gate", status: "healthy", count: 0 },
          { id: "order_shadow", status: "healthy", count: 0 },
          { id: "position_managed", status: "healthy", count: 0 },
          { id: "exit_close", status: "healthy", count: 0 },
        ],
        selectedStage: null,
        setSelectedPipelineStageId: () => {},
        cockpitAttentionItems: [],
        signalOptionsRuleAdherence: [],
        gatewayReady: true,
        transitions: [],
        visibleSignalRows: [],
        signalOptionsCandidates: [],
        selectedCandidate: null,
        signalOptionsPositions: [],
        signalOptionsLedgerPositionsQuery: { data: { positions: [] } },
        symbolIndex: {},
        events: [],
        strategySettingsDraft: {
          signalTimeframe: "5m",
          timeHorizon: 8,
          bosConfirmation: "wicks",
        },
        signalOptionsPerformanceSummary: { closedTrades: 0 },
        activitySummary: {
          segments: [
            { kind: "prefix", tone: "muted", text: "Since 14:43:" },
            { kind: "noop", tone: "dim", text: "no change" },
          ],
        },
        focusedDeployment: { id: "dep-1", enabled: true },
        handleToggleDeployment: () => {},
        handleRunShadowScan: () => {},
        enableDeploymentMutation: {},
        pauseDeploymentMutation: {},
        runShadowScanMutation: {},
        algoIsPhone: false,
        algoIsNarrow: false,
        algoLayoutWidth: 960,
        rightRail: null,
      }),
    );
  } finally {
    globalThis.React = previousReact;
  }

  assert.match(html, /Pyrus Signal-Options/);
  assert.match(html, /data-testid="algo-operations-header-wave-badge"/);
  assert.match(html, /role="status"/);
  assert.match(html, /data-testid="algo-operations-header-wave"/);
  assert.match(html, /aria-label="Signal-options running"/);
  assert.match(html, /data-ibkr-wave-state="healthy"/);
  assert.match(html, />running<\/span>/);
  assert.doesNotMatch(html, /data-testid="algo-operations-status-orb"/);
  assert.match(html, /data-testid="algo-operations-header-actions"/);
  assert.match(html, /aria-label="Signal-options scan controls"/);
  assert.match(html, /Signal Cycle/);
  assert.match(html, /90 symbols -&gt; 7 signals/);
  assert.match(html, /Entry Path/);
  assert.doesNotMatch(html, /Pyrus Signals Shadow/);
  assert.match(html, /aria-label="Scan now"/);
  assert.doesNotMatch(html, />Event</);
  assert.doesNotMatch(html, />Signals</);
  assert.doesNotMatch(html, />Flow</);
  assert.doesNotMatch(html, /Since 14:43/);
  assert.doesNotMatch(html, /no change/);
  assert.doesNotMatch(html, /Last 60s/);
  assert.doesNotMatch(html, /Awaiting next scan/);
});

test("signal table sorting honors column key and direction", () => {
  const rows = [
    {
      signal: {
        symbol: "MSFT",
        signalAt: "2026-05-22T19:10:00.000Z",
        barsSinceSignal: 7,
        signalPrice: 100,
      },
      candidate: {
        underlyingPrice: 102,
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

test("signal table classifies only unblocked candidates as ready", () => {
  assert.equal(
    classifySignal(
      {
        symbol: "LMT",
        status: "ok",
        actionEligible: false,
        actionBlocker: "signal_too_old",
      },
      null,
    ),
    "blocked",
  );
  assert.equal(
    classifySignal({ symbol: "CCJ", status: "ok", actionEligible: true }, null),
    "blocked",
  );
  assert.equal(
    classifySignal(
      { symbol: "NVDA", status: "ok", actionEligible: true },
      { symbol: "NVDA", status: "candidate" },
    ),
    "ready",
  );
  assert.equal(
    classifySignal(
      { symbol: "SPY", status: "ok", actionEligible: true },
      { symbol: "SPY", status: "skipped", reason: "no_contract_for_strike_slot" },
    ),
    "blocked",
  );
  assert.equal(classifySignal({ symbol: "TSLA", status: "unavailable" }, null), "unavailable");
});

test("signal row spread display treats missing quote data as empty", () => {
  assert.equal(formatSpreadWidth(null), "—");
  assert.equal(formatSpreadWidth(undefined), "—");
  assert.equal(formatSpreadWidth(""), "—");
  assert.equal(formatSpreadWidth(Number.NaN), "—");
  assert.equal(formatSpreadWidth(0.0123), "1.2%");
});

test("signal row labels STA option columns when blocked before contract selection", () => {
  const previousReact = globalThis.React;
  globalThis.React = React;
  let html = "";
  try {
    html = renderToStaticMarkup(
      React.createElement(OperationsSignalRow, {
        signal: {
          symbol: "CIEN",
          direction: "buy",
          signalAt: "2026-06-01T21:25:00.000Z",
          actionEligible: true,
          fresh: true,
        },
        candidate: {
          symbol: "CIEN",
          direction: "buy",
          status: "skipped",
          actionStatus: "skipped",
          reason: "greek_selector_no_candidates",
          selectedContract: null,
          quote: null,
          liquidity: null,
        },
        columns: ["contract", "quote", "spread", "greeks"],
        scanActive: true,
      }),
    );
  } finally {
    globalThis.React = previousReact;
  }

  assert.match(html, /Not selected/);
  assert.match(html, /Not requested/);
  assert.match(html, /Not priced/);
  assert.match(html, /Not tested/);
  assert.match(html, /Greek Selector No Candidates/);
  assert.doesNotMatch(html, />Selecting</);
});

test("signal row plan cell leads with token-colored contract intent", () => {
  const previousReact = globalThis.React;
  globalThis.React = React;
  let html = "";
  try {
    html = renderToStaticMarkup(
      React.createElement(OperationsSignalRow, {
        signal: {
          symbol: "AAPL",
          direction: "sell",
          signalAt: "2026-06-01T21:25:00.000Z",
          actionEligible: true,
          fresh: true,
        },
        candidate: {
          symbol: "AAPL",
          direction: "sell",
          actionStatus: "ready",
          action: { optionAction: "buy_put" },
          orderPlan: {
            quantity: 1,
            entryLimitPrice: 2.12,
            premiumAtRisk: 212,
          },
        },
        columns: ["action"],
        scanActive: false,
      }),
    );
  } finally {
    globalThis.React = previousReact;
  }

  assert.match(html, /data-testid="algo-signal-plan-cell"/);
  assert.match(html, /data-testid="algo-signal-plan-intent"/);
  assert.match(
    html,
    /data-testid="algo-signal-plan-token-BUY"[^>]*style="[^"]*color:var\(--ra-green-500\)/,
  );
  assert.match(
    html,
    /data-testid="algo-signal-plan-token-PUT"[^>]*style="[^"]*color:var\(--ra-red-500\)/,
  );
  assert.match(html, /1ct @ \$2\.12/);
  assert(html.indexOf(">BUY<") < html.indexOf(">PUT<"));
  assert(html.indexOf(">PUT<") < html.indexOf('data-testid="algo-signal-plan-detail"'));
});

test("signal row presents dense customizable signal action columns", () => {
  const rowSource = readSource("./OperationsSignalRow.jsx");

  assert.deepEqual(ALWAYS_VISIBLE_SIGNAL_COLUMN_IDS, [
    "signal",
    "since",
    "decision",
    "rowAction",
  ]);
  assert.deepEqual(DEFAULT_SIGNAL_COLUMN_ORDER.slice(0, 5), [
    "signal",
    "since",
    "move",
    "action",
    "gate",
  ]);
  assert.deepEqual(DEFAULT_SIGNAL_VISIBLE_COLUMNS, [
    "signal",
    "since",
    "move",
    "action",
    "gate",
    "contract",
    "quote",
    "spread",
    "greeks",
    "score",
    "decision",
    "rowAction",
  ]);
  assert(!DEFAULT_SIGNAL_VISIBLE_COLUMNS.includes("process"));
  assert(!DEFAULT_SIGNAL_VISIBLE_COLUMNS.includes("sync"));
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
  assert.match(rowSource, /key: "move"[\s\S]*?label: "Move"[\s\S]*?track: "64px"/);
  assert.match(rowSource, /key: "action"[\s\S]*?label: "Plan"[\s\S]*?track: "minmax\(84px, 0\.58fr\)"/);
  assert.match(rowSource, /key: "action"[\s\S]*?label: "Plan"[\s\S]*?key: "gate"/);
  assert.match(rowSource, /key: "contract"[\s\S]*?label: "Contract"/);
  assert.match(rowSource, /key: "quote"[\s\S]*?label: "Quote"/);
  assert.match(rowSource, /key: "spread"[\s\S]*?label: "Spread"/);
  assert.match(rowSource, /key: "greeks"[\s\S]*?label: "Greeks"/);
  assert.match(rowSource, /key: "sync"[\s\S]*?label: "Sync"/);
  assert.match(rowSource, /key: "since"[\s\S]*?label: "Age"/);
  assert.match(rowSource, /key: "action"[\s\S]*?label: "Plan"/);
  assert.match(rowSource, /key: "score"[\s\S]*?label: "Score"/);
  assert.match(rowSource, /key: "decision"[\s\S]*?label: "Latest"/);
  assert.match(rowSource, /key: "rowAction"[\s\S]*?label: "Act"[\s\S]*?width: 42/);
  assert.match(rowSource, /signalColumnTemplate/);
  assert.match(rowSource, /signalTableMinWidth/);
  assert.match(rowSource, /columns = DEFAULT_SIGNAL_VISIBLE_COLUMNS/);
  assert.match(rowSource, /visibleColumns\.map\(\(column\)/);
  assert.match(rowSource, /label: "Age"/);
  assert.match(rowSource, /export const SIGNAL_TABLE_ROW_HEIGHT = 32/);
  assert.match(rowSource, /export const SIGNAL_TABLE_HEADER_HEIGHT = 22/);
  assert.match(rowSource, /const SIGNAL_TABLE_CELL_PADDING = "0 3px"/);
  assert.match(rowSource, /const SIGNAL_TABLE_ACTION_CELL_PADDING = "0 1px"/);
  assert.match(rowSource, /height: dim\(SIGNAL_TABLE_ROW_HEIGHT\)/);
  assert.match(rowSource, /height: dim\(SIGNAL_TABLE_HEADER_HEIGHT\)/);
  assert.match(rowSource, /textTransform: "none"/);
  assert.match(rowSource, /role="row"/);
  assert.match(rowSource, /role="cell"/);
  assert.match(rowSource, /ra-position-table-row--alt/);
  assert.doesNotMatch(rowSource, /TableExpandableRow/);
  assert.doesNotMatch(rowSource, /MobileMetricChip/);
  assert.doesNotMatch(rowSource, /mobileMetricCells/);
  assert.doesNotMatch(rowSource, /mobileAgeValue/);
  assert.doesNotMatch(rowSource, /data-testid="algo-signal-mobile-metrics"/);
  assert.doesNotMatch(rowSource, /rowHeight=\{algoIsPhone \? 84 : 56\}/);
  assert.match(rowSource, /const CompactSignalMetric/);
  assert.match(rowSource, /compact = false/);
  assert.match(rowSource, /if \(compact\)/);
  assert.match(rowSource, /data-testid="algo-signal-compact-metrics"/);
  assert.match(rowSource, /data-algo-pocket-grid="two"/);
  assert.match(rowSource, /data-testid="algo-signal-compact-decision"/);
  assert.match(rowSource, /key: "process"[\s\S]*?toggleLabel: "Audit progression"/);
  assert.match(rowSource, /const ProcessTrailCell/);
  assert.match(rowSource, /data-testid="algo-signal-process-cell"/);
  assert.match(rowSource, /auditProgression = null/);
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
  assert.match(rowSource, /signalActionBlockerLabel/);
  assert.match(rowSource, /signalAgeBlocked/);
  assert.match(rowSource, /signalAgeTone/);
  assert.match(rowSource, /actionEligible !== false/);
  assert.match(rowSource, /resolveDecisionDetailMeta/);
  assert.match(rowSource, /decisionDetailText/);
  assert.match(rowSource, /DECISION_DETAIL_META/);
  assert.doesNotMatch(rowSource, /ReasonChip/);
  assert.doesNotMatch(rowSource, /resolveReasonChipMeta/);
  assert.doesNotMatch(rowSource, /REASON_ICON_META/);
  assert.match(rowSource, /compactQuoteText/);
  assert.match(rowSource, /formatQuoteAge/);
  assert.match(rowSource, /formatSpreadWidth/);
  assert.match(rowSource, /if \(widthPct == null \|\| widthPct === ""\) return MISSING_VALUE/);
  assert.doesNotMatch(rowSource, /not in action queue/);
  assert.doesNotMatch(rowSource, /monitor signal only/);
  assert.doesNotMatch(rowSource, /blocked before quote/);
  assert.match(rowSource, /signalRecord\.contractPreview/);
  assert.match(rowSource, /contractIsPreview/);
  assert.match(rowSource, /compactJoin\(\["Preview", rawContract\.detail\]\)/);
  assert.match(rowSource, /hasQuote && !contractIsPreview/);
  assert.match(rowSource, /main: action/);
  assert.match(rowSource, /detail: detail\.length \? detail\.join\(" · "\) : MISSING_VALUE/);
  assert.match(rowSource, /const hasDetail = hasDisplayValue\(detail\) \|\| Boolean\(detailExtra\)/);
  assert.match(rowSource, /showSignalMove=\{!hasMoveColumn\}/);
  assert.match(rowSource, /const PlanCell/);
  assert.match(rowSource, /data-testid="algo-signal-plan-cell"/);
  assert.match(rowSource, /actionIntentTokenTone/);
  assert.match(rowSource, /sync\?\.label === "Mismatch" \|\| sync\?\.label === "Event only"/);
  assert.match(rowSource, /value=\{gate\.category === "clear" \? MISSING_VALUE : gate\.label\}/);
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
  assert.doesNotMatch(rowSource, /scanIndex = 0/);
  assert.doesNotMatch(rowSource, /ra-signal-row-scan/);
  assert.doesNotMatch(rowSource, /--ra-signal-scan-accent/);
  assert.doesNotMatch(rowSource, /--ra-signal-scan-delay/);
  assert.match(rowSource, /signalCellClassName/);
  assert.match(rowSource, /ra-signal-cell-motion/);
  assert.match(rowSource, /isCandidateContractSelectionPending/);
  assert.match(rowSource, /candidateContractSelectionPending/);
  assert.match(rowSource, /candidateActionStatusValue\(candidate\) === "candidate"/);
  assert.match(rowSource, /quoteEvaluating/);
  assert.match(rowSource, /spreadEvaluating/);
  assert.match(rowSource, /greeksEvaluating/);
  assert.match(rowSource, /gateMotionState/);
  assert.match(rowSource, /syncMotionState/);
  assert.match(rowSource, /decisionMotionState/);
  assert.match(rowSource, /rowActionMotionState/);
  assert.match(rowSource, /useValueFlash\(liveUnderlyingPrice\)/);
  assert.match(rowSource, /ageFlashClassName/);
  assert.match(rowSource, /signalMoveFlashClassName/);
  assert.match(rowSource, /quoteFlashClassName/);
  assert.match(rowSource, /spreadFlashClassName/);
  assert.match(rowSource, /scoreFlashClassName/);
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
  const cssSource = readFileSync(new URL("../../index.css", import.meta.url), "utf8");
  const appSource = readFileSync(
    new URL("../../features/platform/PlatformApp.jsx", import.meta.url),
    "utf8",
  );

  assert.match(tableSource, /signalMatrixStates = \[\]/);
  assert.match(tableSource, /onRequestSignalMatrixHydration/);
  assert.match(tableSource, /buildAlgoSignalMatrixHydrationRequest/);
  assert.match(tableSource, /reason: "algo-signal-table"/);
  assert.match(tableSource, /events = \[\]/);
  assert.match(tableSource, /buildSignalAuditProgressions/);
  assert.match(tableSource, /signalAuditRowKey\(signal, candidate\)/);
  assert.match(tableSource, /auditProgression: auditProgressions\.get\(row\.auditKey\) \|\| null/);
  assert.match(tableSource, /signalContractPreview/);
  assert.match(tableSource, /rowMetricCandidate/);
  assert.match(tableSource, /optionProviderContractId\(\s*asRecord\(signalContractPreview\(signal\)\.selectedContract\),/);
  assert.match(tableSource, /key: "newest",\s*direction: defaultSortDirection\("newest"\)/);
  assert.match(tableSource, /toggleSortDirection\(current\.direction\)/);
  assert.match(tableSource, /compareTimestampValues\(\s*signalTimestampMs\(a\.signal\),\s*signalTimestampMs\(b\.signal\),\s*sortDirection,/);
  assert.match(tableSource, /sortKey=\{sortKey\}/);
  assert.match(tableSource, /sortDirection=\{sortDirection\}/);
  assert.match(tableSource, /onSortChange=\{handleSortChange\}/);
  assert.match(tableSource, /aria-label="Filter signals"/);
  assert.match(tableSource, /Symbol or strategy/);
  assert.match(tableSource, /mobileStatusLine/);
  assert.match(livePageSource, /streamStateTokenVar/);
  assert.match(livePageSource, /const resolveHeaderScanWaveMotion = \(status\) =>/);
  assert.match(livePageSource, /state === "healthy"\) return "fast"/);
  assert.match(livePageSource, /state === "checking" \|\| state === "capacity-limited" \|\| state === "reconnecting"/);
  assert.match(livePageSource, /return "flat"/);
  assert.match(livePageSource, /dataTestId="algo-operations-header-wave"/);
  assert.match(livePageSource, /data-testid="algo-operations-header-wave-badge"/);
  assert.match(livePageSource, /badgeLabel/);
  assert.match(livePageSource, /label: `Signal-options \$\{badgeLabel\}`/);
  assert.doesNotMatch(livePageSource, /<OperationsStatusOrb/);
  assert.doesNotMatch(livePageSource, /label: focusedDeployment\?\.\enabled \? "running" : "paused"/);
  assert.match(tableSource, /import \{ IbkrStatusWave \} from "\.\.\/\.\.\/features\/platform\/IbkrConnectionStatus"/);
  assert.match(tableSource, /const resolveSignalScanWave = \(freshness\) =>/);
  assert.match(tableSource, /const signalScanWave = resolveSignalScanWave\(freshness\)/);
  assert.match(tableSource, /dataTestId="algo-signal-scan-wave"/);
  assert.match(tableSource, /status=\{signalScanWave\.status\}/);
  assert.match(tableSource, /wave=\{signalScanWave\.wave\}/);
  assert.match(tableSource, /COMPACT_SORT_OPTIONS/);
  assert.match(tableSource, /aria-label="Sort signals"/);
  assert.match(tableSource, /handleCompactSortChange/);
  assert.match(tableSource, /const signalTableCompact = Boolean\(algoIsPhone\)/);
  assert.match(tableSource, /safeQaMode = false/);
  assert.match(tableSource, /enabled: Boolean\(rowSymbolsKey && !safeQaMode\)/);
  assert.match(tableSource, /placeholder=\{algoIsPhone \? "Search" : "Symbol or strategy"\}/);
  assert.match(tableSource, /padding: algoIsPhone \? sp\("4px 6px"\) : sp\("6px 10px"\)/);
  assert.doesNotMatch(tableSource, /<span>Sort<\/span>/);
  assert.match(rowSource, /key: "signal"[\s\S]*?sortKey: "symbol"/);
  assert.match(rowSource, /key: "since"[\s\S]*?sortKey: "bars"/);
  assert.match(rowSource, /key: "move"[\s\S]*?sortKey: "move"/);
  assert.match(rowSource, /key: "process"[\s\S]*?label: "Process"/);
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
  assert.match(tableSource, /Bar \$\{formatRelativeTimeShort\(freshness\.latestBarAt\)\}/);
  assert.match(tableSource, /formatCompactStatusValue\(freshness\.sourcePolicy\)/);
  assert.match(tableSource, /pressureLevelBlocksActionWork/);
  assert.match(tableSource, /pressureBlocksWork \? pressureLevel : null/);
  assert.match(tableSource, /Signal action scan is queued by resource pressure\./);
  assert.match(tableSource, /Action scan queued/);
  assert.doesNotMatch(tableSource, /Fresh signal state is current; heavy action work is deferred\./);
  assert.doesNotMatch(tableSource, /Heavy deferred/);
  assert.match(tableSource, /<AlertTriangle/);
  assert.match(tableSource, /scanStageRecord\.detail/);
  assert.match(tableSource, /freshness\.scanDetail/);
  assert.match(tableSource, /pageRows\.map\(\(\{ signal, candidate, scoreBreakdown, auditProgression \}, rowIndex\)/);
  assert.match(tableSource, /alt=\{rowIndex % 2 === 1\}/);
  assert.match(tableSource, /auditProgression=\{auditProgression\}/);
  assert.match(tableSource, /scanActive=\{freshness\.scanRunning\}/);
  assert.doesNotMatch(tableSource, /scanIndex=\{index\}/);
  assert.match(tableSource, /buildSignalMatrixBySymbol\(signalMatrixStates\)/);
  assert.match(tableSource, /useGetQuoteSnapshots\(/);
  assert.match(tableSource, /applyRuntimeQuoteSnapshots\(rowQuotesQuery\.data\?\.quotes \|\| \[\]\)/);
  assert.match(tableSource, /queryKey: \["algo-signal-row-sparklines", rowSymbolsKey\]/);
  assert.match(tableSource, /getBarsRequest\(/);
  assert.match(tableSource, /SIGNAL_TABLE_SPARKLINE_HISTORY_TIMEFRAME = "1m"/);
  assert.match(tableSource, /SIGNAL_TABLE_SPARKLINE_HISTORY_LIMIT = 120/);
  assert.match(tableSource, /thinBarsForSignalSparkline/);
  assert.match(tableSource, /publishRuntimeTickerSnapshot\(symbol, symbol, \{ sparkBars \}\)/);
  assert.match(tableSource, /useRuntimeTickerSnapshots\(rowSymbols\)/);
  assert.match(tableSource, /SIGNALS_PAGE_SIZE = 30/);
  assert.match(tableSource, /dataTestId="algo-signals-pagination"/);
  assert.match(tableSource, /pageRows\.map/);
  assert.match(tableSource, /tfMatrix=\{signalMatrixBySymbol/);
  assert.match(tableSource, /columns=\{visibleColumns\}/);
  assert.match(tableSource, /scoreBreakdown: resolveSignalScoreBreakdown\(\{ signal, candidate \}\)/);
  assert.match(tableSource, /compareFiniteValues\(\s*scoreSortValue\(a\.scoreBreakdown\),\s*scoreSortValue\(b\.scoreBreakdown\),\s*sortDirection,/);
  assert.match(rowSource, /resolveSignalMove\(signalRecord,\s*tickerSnapshot,\s*candidate\)/);
  assert.match(tableSource, /resolveSignalMove\(row\.signal,\s*null,\s*row\.candidate\)/);
  assert.match(tableSource, /signalMoveSortValue\(a\)/);
  assert.match(tableSource, /quoteAgeSortValue\(rowMetricCandidate\(a\)\)/);
  assert.match(tableSource, /spreadSortValue\(rowMetricCandidate\(a\)\)/);
  assert.match(tableSource, /rowActivityTimestampMs\(a\)/);
  assert.match(tableSource, /OperationsSignalColumnDrawer/);
  assert.match(tableSource, /data-testid="algo-signal-column-drawer"/);
  assert.match(tableSource, /from "@dnd-kit\/core"/);
  assert.match(tableSource, /from "@dnd-kit\/sortable"/);
  assert.match(tableSource, /DndContext/);
  assert.match(tableSource, /SortableContext/);
  assert.match(tableSource, /useSortable/);
  assert.match(tableSource, /sortableKeyboardCoordinates/);
  assert.match(tableSource, /verticalListSortingStrategy/);
  assert.match(tableSource, /arrayMove/);
  assert.match(tableSource, /data-testid="algo-signal-column-sortable-list"/);
  assert.match(tableSource, /data-testid=\{`algo-signal-column-drag-\$\{columnId\}`\}/);
  assert.match(tableSource, /onReorder=\{reorderColumn\}/);
  assert.match(tableSource, /algoSignalColumnOrder/);
  assert.match(tableSource, /algoSignalVisibleColumns/);
  assert.match(tableSource, /SIGNAL_COLUMN_VISIBILITY_VERSION = 6/);
  assert.match(tableSource, /LEGACY_DEFAULT_SIGNAL_VISIBLE_COLUMNS/);
  assert.match(tableSource, /PREVIOUS_DEFAULT_SIGNAL_VISIBLE_COLUMNS/);
  assert.match(tableSource, /PRIOR_GATE_FIRST_SIGNAL_COLUMN_ORDER/);
  assert.match(tableSource, /PRIOR_COMPACT_SIGNAL_COLUMN_ORDER/);
  assert.match(tableSource, /PRIOR_GATE_FIRST_COMPACT_SIGNAL_COLUMN_ORDER/);
  assert.match(tableSource, /resolveInitialSignalColumnOrder/);
  assert.match(tableSource, /algoSignalColumnVisibilityVersion/);
  assert.match(tableSource, /Signals to Actions/);
  assert.match(tableSource, /Columns3/);
  assert.match(tableSource, /data-testid="algo-signal-table-scroll"/);
  assert.match(tableSource, /className="ra-dense-table-scroll"/);
  assert.match(
    tableSource,
    /data-testid="algo-signal-table-scroll"[\s\S]*?overflowX: "auto"/,
  );
  assert.match(
    tableSource,
    /data-testid="algo-signal-table-scroll"[\s\S]*?overflowY: signalTableCompact \? "visible" : "auto"/,
  );
  assert.match(tableSource, /data-testid="algo-signal-table-rail"/);
  assert.match(tableSource, /data-testid="algo-signal-table-body"/);
  assert.match(
    tableSource,
    /data-testid="algo-signal-table-rail"[\s\S]*?!signalTableCompact \? \([\s\S]*?<OperationsSignalTableHeader/,
  );
  assert.match(tableSource, /minWidth: signalTableCompact \? 0 : tableMinWidth/);
  assert.match(
    tableSource,
    /data-testid="algo-signal-table-scroll"[\s\S]*?maxHeight: signalTableCompact \? "none" : 520/,
  );
  assert.doesNotMatch(
    tableSource,
    /data-testid="algo-signal-table-body"[\s\S]*?overflowY: signalTableCompact \? "visible" : "auto"/,
  );
  assert.match(tableSource, /compact=\{signalTableCompact\}/);
  assert.doesNotMatch(tableSource, /BottomSheet/);
  assert.doesNotMatch(tableSource, /renderDrill/);
  assert.doesNotMatch(tableSource, /algoFocusStore/);
  assert.doesNotMatch(tableSource, /setAlgoFocus/);
  assert.doesNotMatch(tableSource, /clearAlgoFocus/);
  assert.doesNotMatch(tableSource, /algo-signal-drill-sheet/);
  assert.match(
    cssSource,
    /\[data-testid="algo-screen"\]\[data-layout="phone"\] \[style\*="min-width"\]:not\(\.ra-dense-table-scroll\):not\(\.ra-dense-table-scroll \*\)/,
  );
  assert.doesNotMatch(tableSource, /overflowX: "hidden"/);
  assert.doesNotMatch(tableSource, /a\.signal\.score/);
  assert.doesNotMatch(algoScreenSource, /visibleSignalRows[\s\S]*?\.slice\(0,\s*algoIsPhone \? 8 : 20\)/);
  assert.match(livePageSource, /signalMatrixStates = \[\]/);
  assert.match(livePageSource, /signalMatrixStates=\{signalMatrixStates\}/);
  assert.match(livePageSource, /onRequestSignalMatrixHydration = null/);
  assert.match(livePageSource, /onRequestSignalMatrixHydration=\{onRequestSignalMatrixHydration\}/);
  assert.match(livePageSource, /cockpitGeneratedAt=\{cockpitGeneratedAt\}/);
  assert.match(livePageSource, /cockpitStageItems=\{cockpitStageItems\}/);
  assert.match(livePageSource, /events=\{events\}/);
  assert.match(livePageSource, /safeQaMode = false/);
  assert.match(livePageSource, /safeQaMode=\{safeQaMode\}/);
  assert.doesNotMatch(livePageSource, /auditPanel/);
  assert.doesNotMatch(algoScreenSource, /LazyAlgoAuditPanel/);
  assert.doesNotMatch(algoScreenSource, /auditPanel=\{/);
  assert.doesNotMatch(livePageSource, /LazyOperationsSignalDrill/);
  assert.doesNotMatch(livePageSource, /OperationsSignalDrill/);
  assert.match(livePageSource, /data-testid="algo-settings-drawer-open"[\s\S]*?fill: false/);
  assert.match(livePageSource, /padding: algoIsPhone \? sp\("6px 6px"\) : sp\("8px 10px"\)/);
  assert.match(livePageSource, /fontSize: fs\(algoIsPhone \? 11 : 13\)/);
  assert.match(algoScreenSource, /signalMatrixStates = \[\]/);
  assert.match(algoScreenSource, /signalMatrixStates=\{signalMatrixStates\}/);
  assert.match(algoScreenSource, /onRequestSignalMatrixHydration/);
  assert.match(algoScreenSource, /safeQaMode = false/);
  assert.match(
    algoScreenSource,
    /enabled: Boolean\(\s*algoCriticalQueriesEnabled && focusedDeployment\?\.id && !safeQaMode,\s*\)/,
  );
  assert.match(routerSource, /<MemoAlgoScreen[\s\S]*safeQaMode=\{safeQaMode\}/);
  assert.match(routerSource, /<MemoAlgoScreen[\s\S]*onRequestSignalMatrixHydration=\{onRequestSignalMatrixHydration\}/);
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
  assert.match(signalDotsSource, /const state = statesByTimeframe\?\.\[timeframe\]/);
  assert.doesNotMatch(signalDotsSource, /fallbackState/);
  assert.match(rowSource, /testId="algo-signal-dots"/);
  assert.doesNotMatch(rowSource, /fallbackState=\{/);
  assert.match(compatibilitySource, /signal-language\/SignalDots/);
  assert.doesNotMatch(watchlistSource, /const WatchlistSignalDots/);
  assert.match(watchlistSource, /components\/platform\/signal-language/);
  assert.match(watchlistSource, /<SignalDots/);
  assert.match(watchlistSource, /buildSignalsRows/);
  assert.match(watchlistSource, /SIGNALS_ROW_STATUS/);
  assert.match(watchlistSource, /const signalsRowsBySymbol = useMemo/);
  assert.match(watchlistSource, /states: signalStates/);
  assert.match(watchlistSource, /matrixStates: signalMatrixStates/);
  assert.match(watchlistSource, /signalsRow=\{signalsRowsBySymbol\.get\(item\.sym\) \|\| null\}/);
  assert.match(watchlistSource, /const sparklineSignalDirection = signalsRow\?\.direction/);
  assert.match(watchlistSource, /buildSignalSparklinePointColors/);
  assert.match(watchlistSource, /extractSparklinePoints/);
  assert.match(watchlistSource, /SIGNALS_PAGE_ACTIVE_STATUSES\.has\(signalsRow\?\.status\)/);
  assert.doesNotMatch(watchlistSource, /const sparklineSignalColor = hasSignal \? signalColor : null/);
  assert.equal(
    (watchlistSource.match(/color=\{sparklineColor\}/g) || []).length,
    2,
  );
  assert.equal(
    (watchlistSource.match(/pointColors=\{sparklinePointColors\}/g) || []).length,
    2,
  );
  assert.doesNotMatch(watchlistSource, /fallbackState=\{/);
});

test("signal row motion classes respect reduced-motion settings", () => {
  const cssSource = readFileSync(new URL("../../index.css", import.meta.url), "utf8");

  assert.match(cssSource, /@keyframes raSignalHotGlow/);
  assert.match(cssSource, /@keyframes raSignalGlyphFresh/);
  assert.match(cssSource, /@keyframes raSignalCellEvaluating/);
  assert.match(cssSource, /@keyframes raSignalCellReveal/);
  assert.match(cssSource, /@keyframes raSignalStatusPop/);
  assert.match(cssSource, /@keyframes raSignalBlockedEmphasis/);
  assert.match(cssSource, /@keyframes raSignalActionIn/);
  assert.match(cssSource, /\.ra-signal-row-focus:focus-visible/);
  assert.match(cssSource, /\.ra-signal-cell-evaluating/);
  assert.match(cssSource, /\.ra-signal-decision-pill-try/);
  assert.match(cssSource, /\.ra-signal-action-button/);
  assert.match(cssSource, /\.ra-spread-gauge-marker/);
  assert.doesNotMatch(cssSource, /@keyframes raSignalRowScan/);
  assert.doesNotMatch(cssSource, /\.ra-signal-row-scan/);
  assert.match(
    cssSource,
    /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.ra-signal-row-glow[\s\S]*?\.ra-signal-cell-evaluating[\s\S]*?\.ra-signal-action-button[\s\S]*?animation: none/,
  );
  assert.match(
    cssSource,
    /html\[data-pyrus-reduced-motion="on"\] \.ra-signal-row-glow[\s\S]*?html\[data-pyrus-reduced-motion="on"\] \.ra-signal-cell-evaluating[\s\S]*?animation: none/,
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
