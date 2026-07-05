import { useMemo, useState } from "react";
import type { PineScriptRecord } from "@workspace/api-client-react";
// @ts-expect-error JSX module imported into TypeScript context
import { FONT_WEIGHTS, RADII } from "../../lib/uiTokens.jsx";
import {
  ResearchChartFrame,
  ResearchChartWidgetFooter,
  ResearchChartWidgetHeader,
  ResearchChartWidgetSidebar,
} from "./ResearchChartFrame";
import { TradingViewWidgetReference } from "./TradingViewWidgetReference";
import { buildChartParityModel, chartParityScenarios, getChartParityScenario } from "./chartFixtures";
import {
  createPyrusSignalsPineRuntimeAdapter,
  DEFAULT_PYRUS_SIGNALS_SETTINGS,
  PYRUS_SIGNALS_PINE_SCRIPT_KEY,
} from "./pyrusSignalsPineAdapter";
import { defaultIndicatorRegistry } from "./indicators";
import { PyrusSignalsSettingsMenu } from "./PyrusSignalsSettingsMenu";
import { useDrawingHistory } from "./useDrawingHistory";
import type { ChartModel } from "./types";
import { FONT_CSS_VAR, TYPE_CSS_VAR } from "../../lib/typography";

type DrawMode = "horizontal" | "vertical" | "box";
type ResearchDrawing = {
  type?: DrawMode;
  price?: number;
  time?: number;
  fromTime?: number;
  toTime?: number;
  top?: number;
  bottom?: number;
};

type LayoutMode = "desktop" | "narrow";

const THEME = {
  bg0: "#16151A",
  bg1: "#1E1D22",
  bg2: "#26252B",
  bg3: "#2F2E35",
  bg4: "#3A3940",
  border: "#2F2E35",
  text: "#F2EFE9",
  textSec: "#B8B4AC",
  textDim: "#86837D",
  textMuted: "#605C57",
  accent: "#E08F76",
  accentDim: "#3F2A22",
  green: "#4FB286",
  red: "#EA5E5B",
  amber: "#D9A864",
  purple: "#A189CF",
  mono: FONT_CSS_VAR.data,
  sans: FONT_CSS_VAR.sans,
  display: FONT_CSS_VAR.display,
};

const BUTTON_BASE = {
  padding: "4px 9px",
  borderRadius: RADII.xs,
  border: `1px solid ${THEME.border}`,
  background: THEME.bg3,
  color: THEME.textDim,
  fontSize: TYPE_CSS_VAR.bodyStrong,
  fontFamily: THEME.mono,
  cursor: "pointer",
} as const;

const FRAME_TIMEFRAMES = [
  { value: "1m", label: "1m" },
  { value: "5m", label: "5m" },
  { value: "15m", label: "15m" },
  { value: "1h", label: "1h" },
  { value: "1D", label: "1D" },
];

const PARITY_PYRUS_SIGNALS_SCRIPT = {
  id: "parity-pyrus-signals",
  scriptKey: PYRUS_SIGNALS_PINE_SCRIPT_KEY,
  name: "Pyrus Signals",
  status: "ready",
  chartAccessEnabled: true,
  defaultPaneType: "price",
} as PineScriptRecord;

const buildReferenceCard = ({
  label,
  description,
  layout,
  interval,
}: {
  label: string;
  description: string;
  layout: LayoutMode;
  interval: string;
}) => (
  <div
    data-testid="parity-reference-card"
    style={{
      background: THEME.bg2,
      border: `1px solid ${THEME.border}`,
      borderRadius: RADII.sm,
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
      height: "100%",
      minHeight: 0,
    }}
  >
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        padding: "6px 10px",
        borderBottom: `1px solid ${THEME.border}`,
      }}
    >
      <div>
        <div style={{ fontSize: TYPE_CSS_VAR.bodyStrong, fontWeight: FONT_WEIGHTS.regular, fontFamily: THEME.mono, color: THEME.text }}>{label}</div>
        <div style={{ fontSize: TYPE_CSS_VAR.body, color: THEME.textDim, fontFamily: THEME.sans }}>{description}</div>
      </div>
      <span style={{ fontSize: TYPE_CSS_VAR.body, color: THEME.textMuted, fontFamily: THEME.mono }}>
        {layout === "desktop" ? "reference desktop" : "reference narrow"}
      </span>
    </div>
    <div style={{ flex: 1, minHeight: 0 }}>
      <TradingViewWidgetReference
        symbol="NASDAQ:AAPL"
        interval={interval}
        theme="dark"
        dataTestId="parity-reference-surface"
      />
    </div>
  </div>
);

const countIndicatorEvents = (
  model: ChartModel,
  predicate: (event: ChartModel["indicatorEvents"][number]) => boolean,
): number => model.indicatorEvents.filter(predicate).length;

const countIndicatorZones = (
  model: ChartModel,
  zoneType: string,
): number => model.indicatorZones.filter((zone) => zone.zoneType === zoneType).length;

const buildPyrusSignalsDiagnostics = (model: ChartModel) => [
  {
    id: "badges",
    label: "Badges",
    value: countIndicatorEvents(
      model,
      (event) => event.meta?.overlay === "badge",
    ),
  },
  {
    id: "dots",
    label: "Break Dots",
    value: countIndicatorEvents(model, (event) => event.meta?.overlay === "dot"),
  },
  {
    id: "dashboard",
    label: "Dashboard",
    value: countIndicatorEvents(
      model,
      (event) => event.eventType === "pyrus_signals_dashboard",
    ),
  },
  {
    id: "order-blocks",
    label: "Order Blocks",
    value: countIndicatorZones(model, "order-block"),
  },
  {
    id: "key-levels",
    label: "Key Levels",
    value: countIndicatorZones(model, "key-level"),
  },
  {
    id: "tp-sl",
    label: "TP/SL",
    value: countIndicatorZones(model, "tp-sl"),
  },
  {
    id: "windows",
    label: "Regime Windows",
    value: model.indicatorWindows.length,
  },
  {
    id: "studies",
    label: "Study Lines",
    value: model.studySpecs.length,
  },
];

function useLabFrameState(initialIndicators: string[], initialTimeframe: string) {
  const [drawMode, setDrawMode] = useState<DrawMode | null>(null);
  const [selectedIndicators, setSelectedIndicators] = useState(initialIndicators);
  const [timeframe, setTimeframe] = useState(initialTimeframe);
  const {
    drawings,
    addDrawing,
    clearDrawings,
    undo,
    redo,
    canUndo,
    canRedo,
    resetDrawings,
  } = useDrawingHistory<ResearchDrawing>();

  return {
    drawings,
    drawMode,
    selectedIndicators,
    timeframe,
    setTimeframe,
    setDrawMode,
    undo,
    redo,
    canUndo,
    canRedo,
    clearDrawings: () => {
      clearDrawings();
      setDrawMode(null);
    },
    addDrawing,
    toggleIndicator: (indicatorId: string) => setSelectedIndicators((current) => (
      current.includes(indicatorId)
        ? current.filter((value) => value !== indicatorId)
        : [...current, indicatorId]
    )),
    resetState: (nextIndicators: string[], nextTimeframe: string) => {
      setSelectedIndicators(nextIndicators);
      setTimeframe(nextTimeframe);
      resetDrawings([]);
      setDrawMode(null);
    },
  };
}

export const ChartParityLab = () => {
  const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  const requestedScenario = params.get("scenario");
  const requestedLayout = params.get("layout");
  const initialViewportLayout: LayoutMode =
    typeof window !== "undefined" && window.innerWidth < 900 ? "narrow" : "desktop";
  const [scenarioId, setScenarioId] = useState(requestedScenario || "core");
  const [layout, setLayout] = useState<LayoutMode>(
    requestedLayout === "narrow"
      ? "narrow"
      : requestedLayout === "desktop"
        ? "desktop"
        : initialViewportLayout,
  );
  const [pyrusSignalsSettings, setPyrusSignalsSettings] = useState(() => ({
    ...DEFAULT_PYRUS_SIGNALS_SETTINGS,
  }));
  const scenario = useMemo(() => getChartParityScenario(scenarioId), [scenarioId]);
  const appPrimary = useLabFrameState(scenario.selectedIndicators, scenario.timeframe);
  const appSecondary = useLabFrameState(scenario.selectedIndicators, scenario.timeframe);
  const isPyrusSignalsScenario = scenario.id === "pyrus-signals";
  const parityIndicatorRegistry = useMemo(
    () => ({
      ...defaultIndicatorRegistry,
      [PYRUS_SIGNALS_PINE_SCRIPT_KEY]:
        createPyrusSignalsPineRuntimeAdapter(PARITY_PYRUS_SIGNALS_SCRIPT),
    }),
    [],
  );
  const pyrusSignalsIndicatorSettings = useMemo(
    () => ({
      [PYRUS_SIGNALS_PINE_SCRIPT_KEY]: pyrusSignalsSettings,
    }),
    [pyrusSignalsSettings],
  );
  const scenarioStudies = useMemo(
    () =>
      scenario.selectedIndicators.map((indicator) => ({
        id: indicator,
        label: indicator === PYRUS_SIGNALS_PINE_SCRIPT_KEY ? "Pyrus Signals" : indicator,
      })),
    [scenario.selectedIndicators],
  );

  const primaryModel = useMemo(
    () => buildChartParityModel(scenario, {
      timeframe: appPrimary.timeframe,
      selectedIndicators: appPrimary.selectedIndicators,
      indicatorSettings: isPyrusSignalsScenario ? pyrusSignalsIndicatorSettings : undefined,
      indicatorRegistry: isPyrusSignalsScenario ? parityIndicatorRegistry : undefined,
    }),
    [
      appPrimary.selectedIndicators,
      appPrimary.timeframe,
      isPyrusSignalsScenario,
      parityIndicatorRegistry,
      pyrusSignalsIndicatorSettings,
      scenario,
    ],
  );
  const secondaryModel = useMemo(
    () => buildChartParityModel(scenario, {
      timeframe: appSecondary.timeframe,
      selectedIndicators: appSecondary.selectedIndicators,
      indicatorSettings: isPyrusSignalsScenario ? pyrusSignalsIndicatorSettings : undefined,
      indicatorRegistry: isPyrusSignalsScenario ? parityIndicatorRegistry : undefined,
    }),
    [
      appSecondary.selectedIndicators,
      appSecondary.timeframe,
      isPyrusSignalsScenario,
      parityIndicatorRegistry,
      pyrusSignalsIndicatorSettings,
      scenario,
    ],
  );
  const primaryLastBar = primaryModel.chartBars[primaryModel.chartBars.length - 1];
  const secondaryLastBar = secondaryModel.chartBars[secondaryModel.chartBars.length - 1];
  const pyrusSignalsDiagnostics = useMemo(
    () => buildPyrusSignalsDiagnostics(primaryModel),
    [primaryModel],
  );
  const shellWidth = layout === "desktop" ? 1280 : 760;
  const comparisonGridColumns = layout === "desktop" ? "1.5fr 1.5fr 1.2fr" : "1fr";

  return (
    <div
      data-testid="parity-root"
      style={{
        minHeight: "100vh",
        background: THEME.bg0,
        color: THEME.text,
        fontFamily: THEME.sans,
        padding: layout === "desktop" ? 20 : 12,
      }}
    >
      <div style={{ maxWidth: shellWidth, margin: "0 auto", display: "flex", flexDirection: "column", gap: 12 }}>
        <div
          style={{
            background: THEME.bg1,
            border: `1px solid ${THEME.border}`,
            borderRadius: RADII.md,
            padding: "12px 14px",
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: TYPE_CSS_VAR.screenTitle, fontWeight: FONT_WEIGHTS.regular, fontFamily: THEME.display, color: THEME.text }}>Chart Parity Lab</span>
            <span style={{ fontSize: TYPE_CSS_VAR.bodyStrong, color: THEME.textDim }}>{scenario.description}</span>
            <span style={{ flex: 1 }} />
            <a href="/" style={{ color: THEME.accent, fontFamily: THEME.mono, fontSize: TYPE_CSS_VAR.bodyStrong }}>back to app</a>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {chartParityScenarios.map((entry) => {
              const active = entry.id === scenario.id;
              return (
                <button
                  key={entry.id}
                  type="button"
                  aria-pressed={active}
                  data-testid={`parity-scenario-${entry.id}`}
                  onClick={() => {
                    setScenarioId(entry.id);
                    appPrimary.resetState(entry.selectedIndicators, entry.timeframe);
                    appSecondary.resetState(entry.selectedIndicators, entry.timeframe);
                    if (entry.id === "pyrus-signals") {
                      setPyrusSignalsSettings({ ...DEFAULT_PYRUS_SIGNALS_SETTINGS });
                    }
                  }}
                  style={{
                    ...BUTTON_BASE,
                    background: active ? THEME.accentDim : THEME.bg3,
                    borderColor: active ? THEME.accent : THEME.border,
                    color: active ? THEME.accent : THEME.textDim,
                  }}
                >
                  {entry.label}
                </button>
              );
            })}
            <span style={{ width: 8 }} />
            {(["desktop", "narrow"] as LayoutMode[]).map((mode) => {
              const active = layout === mode;
              return (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={active}
                  data-testid={`parity-layout-${mode}`}
                  onClick={() => setLayout(mode)}
                  style={{
                    ...BUTTON_BASE,
                    background: active ? THEME.amber : THEME.bg3,
                    borderColor: active ? THEME.amber : THEME.border,
                    color: active ? THEME.bg0 : THEME.textDim,
                    fontWeight: FONT_WEIGHTS.regular,
                  }}
                >
                  {mode}
                </button>
              );
            })}
            {isPyrusSignalsScenario ? (
              <PyrusSignalsSettingsMenu
                theme={THEME}
                settings={pyrusSignalsSettings}
                onChange={setPyrusSignalsSettings}
              />
            ) : null}
          </div>
          <div style={{ fontSize: TYPE_CSS_VAR.bodyStrong, color: THEME.textMuted, fontFamily: THEME.mono }}>
            Use <code>?lab=chart-parity</code> with optional <code>&amp;scenario=core</code>, <code>&amp;scenario=pyrus-signals</code>, or <code>&amp;layout=narrow</code> for direct review targets.
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: comparisonGridColumns,
            gap: 12,
            alignItems: "stretch",
          }}
        >
          <div style={{ minHeight: layout === "desktop" ? 520 : 420 }}>
            <ResearchChartFrame
              dataTestId="parity-app-primary"
              theme={THEME}
              themeKey="chart-parity-lab"
              rangeIdentityKey={`chart-parity:${scenario.id}:primary:${appPrimary.timeframe}`}
              model={primaryModel}
              placement="workspace"
              showLegend
              legend={{
                symbol: "RAYA",
                name: "shared frame primary",
                timeframe: appPrimary.timeframe,
                statusLabel: `fixture ${appPrimary.timeframe}`,
                price: primaryLastBar?.c ?? null,
                changePercent: null,
                meta: {
                  open: primaryLastBar?.o,
                  high: primaryLastBar?.h,
                  low: primaryLastBar?.l,
                  close: primaryLastBar?.c,
                  volume: primaryLastBar?.v,
                  vwap: primaryLastBar?.vwap,
                  sessionVwap: primaryLastBar?.sessionVwap,
                  accumulatedVolume: primaryLastBar?.accumulatedVolume,
                  averageTradeSize: primaryLastBar?.averageTradeSize,
                  timestamp: primaryLastBar?.ts,
                  sourceLabel: primaryLastBar?.source || "FIXTURE",
                },
                studies: scenarioStudies,
                selectedStudies: appPrimary.selectedIndicators,
              }}
              drawings={appPrimary.drawings}
              drawMode={appPrimary.drawMode}
              onAddDrawing={appPrimary.addDrawing}
              surfaceTopOverlay={(controls) => (
                <ResearchChartWidgetHeader
                  theme={THEME}
                  controls={controls}
                  symbol="RAYA"
                  name="shared frame primary"
                  price={primaryLastBar?.c ?? null}
                  changePercent={null}
                  statusLabel={`fixture ${appPrimary.timeframe}`}
                  timeframe={appPrimary.timeframe}
                  showInlineLegend={false}
                  timeframeOptions={FRAME_TIMEFRAMES}
                  onChangeTimeframe={appPrimary.setTimeframe}
                  onUndo={appPrimary.undo}
                  onRedo={appPrimary.redo}
                  canUndo={appPrimary.canUndo}
                  canRedo={appPrimary.canRedo}
                  showUndoRedo
                  studies={scenarioStudies}
                  selectedStudies={appPrimary.selectedIndicators}
                  studySpecs={primaryModel.studySpecs}
                  onToggleStudy={appPrimary.toggleIndicator}
                  meta={{
                    open: primaryLastBar?.o,
                    high: primaryLastBar?.h,
                    low: primaryLastBar?.l,
                    close: primaryLastBar?.c,
                    volume: primaryLastBar?.v,
                    vwap: primaryLastBar?.vwap,
                    sessionVwap: primaryLastBar?.sessionVwap,
                    accumulatedVolume: primaryLastBar?.accumulatedVolume,
                    averageTradeSize: primaryLastBar?.averageTradeSize,
                    timestamp: primaryLastBar?.ts,
                    sourceLabel: primaryLastBar?.source || "FIXTURE",
                  }}
                />
              )}
              surfaceLeftOverlay={(controls) => (
                <ResearchChartWidgetSidebar
                  theme={THEME}
                  controls={controls}
                  drawMode={appPrimary.drawMode}
                  drawingCount={appPrimary.drawings.length}
                  onToggleDrawMode={appPrimary.setDrawMode}
                  onClearDrawings={appPrimary.clearDrawings}
                />
              )}
              surfaceBottomOverlay={(controls) => (
                <ResearchChartWidgetFooter
                  theme={THEME}
                  controls={controls}
                  studies={scenarioStudies}
                  selectedStudies={appPrimary.selectedIndicators}
                  studySpecs={primaryModel.studySpecs}
                  onToggleStudy={appPrimary.toggleIndicator}
                  statusText={`${primaryModel.chartBars.length || 0} bars`}
                />
              )}
            />
          </div>

          <div style={{ minHeight: layout === "desktop" ? 520 : 420 }}>
            <ResearchChartFrame
              dataTestId="parity-app-secondary"
              theme={THEME}
              themeKey="chart-parity-lab"
              rangeIdentityKey={`chart-parity:${scenario.id}:secondary:${appSecondary.timeframe}`}
              model={secondaryModel}
              placement="workspace"
              showLegend
              legend={{
                symbol: "RAYB",
                name: "shared frame secondary",
                timeframe: appSecondary.timeframe,
                statusLabel: `fixture ${appSecondary.timeframe}`,
                price: secondaryLastBar?.c ?? null,
                changePercent: null,
                meta: {
                  open: secondaryLastBar?.o,
                  high: secondaryLastBar?.h,
                  low: secondaryLastBar?.l,
                  close: secondaryLastBar?.c,
                  volume: secondaryLastBar?.v,
                  vwap: secondaryLastBar?.vwap,
                  sessionVwap: secondaryLastBar?.sessionVwap,
                  accumulatedVolume: secondaryLastBar?.accumulatedVolume,
                  averageTradeSize: secondaryLastBar?.averageTradeSize,
                  timestamp: secondaryLastBar?.ts,
                  sourceLabel: secondaryLastBar?.source || "FIXTURE",
                },
                studies: scenarioStudies,
                selectedStudies: appSecondary.selectedIndicators,
              }}
              drawings={appSecondary.drawings}
              drawMode={appSecondary.drawMode}
              onAddDrawing={appSecondary.addDrawing}
              surfaceTopOverlay={(controls) => (
                <ResearchChartWidgetHeader
                  theme={THEME}
                  controls={controls}
                  symbol="RAYB"
                  name="shared frame secondary"
                  price={secondaryLastBar?.c ?? null}
                  changePercent={null}
                  statusLabel={`fixture ${appSecondary.timeframe}`}
                  timeframe={appSecondary.timeframe}
                  showInlineLegend={false}
                  timeframeOptions={FRAME_TIMEFRAMES}
                  onChangeTimeframe={appSecondary.setTimeframe}
                  onUndo={appSecondary.undo}
                  onRedo={appSecondary.redo}
                  canUndo={appSecondary.canUndo}
                  canRedo={appSecondary.canRedo}
                  showUndoRedo
                  studies={scenarioStudies}
                  selectedStudies={appSecondary.selectedIndicators}
                  studySpecs={secondaryModel.studySpecs}
                  onToggleStudy={appSecondary.toggleIndicator}
                  meta={{
                    open: secondaryLastBar?.o,
                    high: secondaryLastBar?.h,
                    low: secondaryLastBar?.l,
                    close: secondaryLastBar?.c,
                    volume: secondaryLastBar?.v,
                    vwap: secondaryLastBar?.vwap,
                    sessionVwap: secondaryLastBar?.sessionVwap,
                    accumulatedVolume: secondaryLastBar?.accumulatedVolume,
                    averageTradeSize: secondaryLastBar?.averageTradeSize,
                    timestamp: secondaryLastBar?.ts,
                    sourceLabel: secondaryLastBar?.source || "FIXTURE",
                  }}
                />
              )}
              surfaceLeftOverlay={(controls) => (
                <ResearchChartWidgetSidebar
                  theme={THEME}
                  controls={controls}
                  drawMode={appSecondary.drawMode}
                  drawingCount={appSecondary.drawings.length}
                  onToggleDrawMode={appSecondary.setDrawMode}
                  onClearDrawings={appSecondary.clearDrawings}
                />
              )}
              surfaceBottomOverlay={(controls) => (
                <ResearchChartWidgetFooter
                  theme={THEME}
                  controls={controls}
                  studies={scenarioStudies}
                  selectedStudies={appSecondary.selectedIndicators}
                  studySpecs={secondaryModel.studySpecs}
                  onToggleStudy={appSecondary.toggleIndicator}
                  statusText={`${secondaryModel.chartBars.length || 0} bars`}
                />
              )}
            />
          </div>

          <div style={{ minHeight: layout === "desktop" ? 520 : 420 }}>
            {buildReferenceCard({
              label: "TradingView Widget Reference",
              description: "Public embed reference for shell and toolbar parity review.",
              layout,
              interval: appPrimary.timeframe,
            })}
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: layout === "desktop" ? "1fr 1fr" : "1fr",
            gap: 12,
          }}
        >
          <div
            style={{
              background: THEME.bg1,
              border: `1px solid ${THEME.border}`,
              borderRadius: RADII.md,
              padding: "12px 14px",
            }}
          >
            <div style={{ fontSize: TYPE_CSS_VAR.bodyStrong, fontWeight: FONT_WEIGHTS.regular, fontFamily: THEME.mono, color: THEME.text }}>E2E acceptance checks</div>
            <ul style={{ margin: "10px 0 0 18px", display: "flex", flexDirection: "column", gap: 6, color: THEME.textSec, fontSize: TYPE_CSS_VAR.bodyStrong }}>
              <li>Primary and secondary chart frames render independently.</li>
              <li>Scenario and timeframe switches rebuild bars without destabilizing the shell.</li>
              <li>Study toggles remain isolated to the targeted frame.</li>
              <li>Toolbar interactions remain isolated to the targeted frame.</li>
              <li>Empty-state fixtures keep the frame height and shell structure intact.</li>
            </ul>
          </div>

          <div
            style={{
              background: THEME.bg1,
              border: `1px solid ${THEME.border}`,
              borderRadius: RADII.md,
              padding: "12px 14px",
            }}
          >
            <div style={{ fontSize: TYPE_CSS_VAR.bodyStrong, fontWeight: FONT_WEIGHTS.regular, fontFamily: THEME.mono, color: THEME.text }}>Scenario notes</div>
            {isPyrusSignalsScenario ? (
              <div
                data-testid="pyrus-signals-diagnostics"
                style={{
                  marginTop: 10,
                  display: "grid",
                  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                  gap: 6,
                }}
              >
                {pyrusSignalsDiagnostics.map((item) => (
                  <div
                    key={item.id}
                    data-testid={`pyrus-signals-diagnostic-${item.id}`}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 8,
                      padding: "5px 7px",
                      border: `1px solid ${THEME.border}`,
                      background: THEME.bg2,
                      borderRadius: RADII.xs,
                      fontFamily: THEME.mono,
                      fontSize: TYPE_CSS_VAR.body,
                    }}
                  >
                    <span style={{ color: THEME.textMuted }}>{item.label}</span>
                    <span style={{ color: item.value > 0 ? THEME.text : THEME.red }}>
                      {item.value}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
            <div style={{ marginTop: 10, color: THEME.textSec, fontSize: TYPE_CSS_VAR.bodyStrong, lineHeight: 1.55 }}>
              The reference surface is the official TradingView embed widget. The app frames remain our own implementation on top of lightweight-charts, broker-backed data, and our normalized chart model.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
