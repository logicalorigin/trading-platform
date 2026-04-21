import { useMemo, useState } from "react";
import { ResearchChartFrame } from "./ResearchChartFrame";
import { TradingViewWidgetReference } from "./TradingViewWidgetReference";
import { buildChartParityModel, chartParityScenarios, getChartParityScenario } from "./chartFixtures";

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
  bg0: "#080b12",
  bg1: "#0d1117",
  bg2: "#141b27",
  bg3: "#1a2235",
  bg4: "#212d42",
  border: "#1e293b",
  text: "#e2e8f0",
  textSec: "#94a3b8",
  textDim: "#64748b",
  textMuted: "#475569",
  accent: "#3b82f6",
  accentDim: "#1e3a5f",
  green: "#10b981",
  red: "#ef4444",
  amber: "#f59e0b",
  purple: "#8b5cf6",
  mono: "'JetBrains Mono', 'SF Mono', 'Menlo', monospace",
  sans: "'Inter', system-ui, -apple-system, sans-serif",
  display: "'Inter', system-ui, sans-serif",
};

const BUTTON_BASE = {
  padding: "4px 9px",
  borderRadius: 4,
  border: `1px solid ${THEME.border}`,
  background: THEME.bg3,
  color: THEME.textDim,
  fontSize: 11,
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

const buildFrameHeader = ({
  symbol,
  subtitle,
  statusLabel,
  timeframe,
  onChangeTimeframe,
  footerMeta,
}: {
  symbol: string;
  subtitle: string;
  statusLabel: string;
  timeframe: string;
  onChangeTimeframe?: (next: string) => void;
  footerMeta?: string;
}) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: 10,
      padding: "6px 10px",
      borderBottom: `1px solid ${THEME.border}`,
      flexShrink: 0,
    }}
  >
    <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
      <span style={{ fontSize: 12, fontWeight: 800, fontFamily: THEME.mono, color: THEME.text }}>{symbol}</span>
      <span style={{ fontSize: 10, fontFamily: THEME.mono, color: THEME.textDim }}>{subtitle}</span>
    </div>
    <span style={{ flex: 1 }} />
    <span style={{ fontSize: 10, color: THEME.textMuted, fontFamily: THEME.mono }}>{statusLabel}</span>
    <div style={{ display: "flex", gap: 3 }}>
      {FRAME_TIMEFRAMES.map((option) => {
        const active = option.value === timeframe;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChangeTimeframe?.(option.value)}
            style={{
              ...BUTTON_BASE,
              padding: "2px 7px",
              background: active ? THEME.accentDim : "transparent",
              borderColor: active ? THEME.accent : THEME.border,
              color: active ? THEME.accent : THEME.textMuted,
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
    {footerMeta ? (
      <span style={{ fontSize: 10, fontFamily: THEME.mono, color: THEME.textMuted }}>
        {footerMeta}
      </span>
    ) : null}
  </div>
);

const buildStudyHeader = ({
  availableIndicators,
  selectedIndicators,
  onToggleIndicator,
}: {
  availableIndicators: string[];
  selectedIndicators: string[];
  onToggleIndicator: (indicatorId: string) => void;
}) => {
  if (!availableIndicators.length) {
    return null;
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 10px",
        borderBottom: `1px solid ${THEME.border}`,
        flexWrap: "wrap",
      }}
    >
      <span style={{ fontSize: 10, color: THEME.textMuted, fontFamily: THEME.mono, letterSpacing: "0.06em" }}>
        STUDIES
      </span>
      {availableIndicators.map((indicatorId) => {
        const active = selectedIndicators.includes(indicatorId);
        return (
        <button
          key={indicatorId}
          type="button"
          aria-pressed={active}
          onClick={() => onToggleIndicator(indicatorId)}
          style={{
            ...BUTTON_BASE,
            padding: "2px 7px",
            background: active ? THEME.accentDim : "transparent",
            borderColor: active ? THEME.accent : THEME.border,
            color: active ? THEME.accent : THEME.textMuted,
            fontWeight: active ? 700 : 500,
          }}
        >
          {indicatorId}
        </button>
        );
      })}
    </div>
  );
};

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
      borderRadius: 6,
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
        <div style={{ fontSize: 12, fontWeight: 800, fontFamily: THEME.mono, color: THEME.text }}>{label}</div>
        <div style={{ fontSize: 10, color: THEME.textDim, fontFamily: THEME.sans }}>{description}</div>
      </div>
      <span style={{ fontSize: 10, color: THEME.textMuted, fontFamily: THEME.mono }}>
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

function useLabFrameState(initialIndicators: string[], initialTimeframe: string) {
  const [drawings, setDrawings] = useState<ResearchDrawing[]>([]);
  const [drawMode, setDrawMode] = useState<DrawMode | null>(null);
  const [selectedIndicators, setSelectedIndicators] = useState(initialIndicators);
  const [timeframe, setTimeframe] = useState(initialTimeframe);

  return {
    drawings,
    drawMode,
    selectedIndicators,
    timeframe,
    setTimeframe,
    setDrawMode,
    clearDrawings: () => {
      setDrawings([]);
      setDrawMode(null);
    },
    addDrawing: (drawing: ResearchDrawing) => setDrawings((current) => [...current, drawing]),
    toggleIndicator: (indicatorId: string) => setSelectedIndicators((current) => (
      current.includes(indicatorId)
        ? current.filter((value) => value !== indicatorId)
        : [...current, indicatorId]
    )),
    resetState: (nextIndicators: string[], nextTimeframe: string) => {
      setSelectedIndicators(nextIndicators);
      setTimeframe(nextTimeframe);
      setDrawings([]);
      setDrawMode(null);
    },
  };
}

export const ChartParityLab = () => {
  const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  const requestedScenario = params.get("scenario");
  const requestedLayout = params.get("layout");
  const [scenarioId, setScenarioId] = useState(requestedScenario || "core");
  const [layout, setLayout] = useState<LayoutMode>(requestedLayout === "narrow" ? "narrow" : "desktop");
  const scenario = useMemo(() => getChartParityScenario(scenarioId), [scenarioId]);
  const appPrimary = useLabFrameState(scenario.selectedIndicators, scenario.timeframe);
  const appSecondary = useLabFrameState(scenario.selectedIndicators, scenario.timeframe);

  const primaryModel = useMemo(
    () => buildChartParityModel(scenario, {
      timeframe: appPrimary.timeframe,
      selectedIndicators: appPrimary.selectedIndicators,
    }),
    [appPrimary.selectedIndicators, appPrimary.timeframe, scenario],
  );
  const secondaryModel = useMemo(
    () => buildChartParityModel(scenario, {
      timeframe: appSecondary.timeframe,
      selectedIndicators: appSecondary.selectedIndicators,
    }),
    [appSecondary.selectedIndicators, appSecondary.timeframe, scenario],
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
        padding: 20,
      }}
    >
      <div style={{ maxWidth: shellWidth, margin: "0 auto", display: "flex", flexDirection: "column", gap: 12 }}>
        <div
          style={{
            background: THEME.bg1,
            border: `1px solid ${THEME.border}`,
            borderRadius: 8,
            padding: "12px 14px",
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 18, fontWeight: 800, fontFamily: THEME.display, color: THEME.text }}>Chart Parity Lab</span>
            <span style={{ fontSize: 12, color: THEME.textDim }}>{scenario.description}</span>
            <span style={{ flex: 1 }} />
            <a href="/" style={{ color: THEME.accent, fontFamily: THEME.mono, fontSize: 11 }}>back to app</a>
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
                    color: active ? "#080b12" : THEME.textDim,
                    fontWeight: 700,
                  }}
                >
                  {mode}
                </button>
              );
            })}
          </div>
          <div style={{ fontSize: 11, color: THEME.textMuted, fontFamily: THEME.mono }}>
            Use <code>?lab=chart-parity</code> with optional <code>&amp;scenario=core</code> or <code>&amp;layout=narrow</code> for direct review targets.
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
              model={primaryModel}
              drawings={appPrimary.drawings}
              drawMode={appPrimary.drawMode}
              onAddDrawing={appPrimary.addDrawing}
              header={buildFrameHeader({
                symbol: "RAYA",
                subtitle: "shared frame · primary",
                statusLabel: `fixture ${appPrimary.timeframe}`,
                timeframe: appPrimary.timeframe,
                onChangeTimeframe: appPrimary.setTimeframe,
                footerMeta: `${primaryModel.chartBars.length || 0} bars`,
              })}
              subHeader={buildStudyHeader({
                availableIndicators: scenario.selectedIndicators,
                selectedIndicators: appPrimary.selectedIndicators,
                onToggleIndicator: appPrimary.toggleIndicator,
              })}
            />
          </div>

          <div style={{ minHeight: layout === "desktop" ? 520 : 420 }}>
            <ResearchChartFrame
              dataTestId="parity-app-secondary"
              theme={THEME}
              themeKey="chart-parity-lab"
              model={secondaryModel}
              drawings={appSecondary.drawings}
              drawMode={appSecondary.drawMode}
              onAddDrawing={appSecondary.addDrawing}
              header={buildFrameHeader({
                symbol: "RAYB",
                subtitle: "shared frame · secondary",
                statusLabel: `fixture ${appSecondary.timeframe}`,
                timeframe: appSecondary.timeframe,
                onChangeTimeframe: appSecondary.setTimeframe,
                footerMeta: `${secondaryModel.chartBars.length || 0} bars`,
              })}
              subHeader={buildStudyHeader({
                availableIndicators: scenario.selectedIndicators,
                selectedIndicators: appSecondary.selectedIndicators,
                onToggleIndicator: appSecondary.toggleIndicator,
              })}
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
              borderRadius: 8,
              padding: "12px 14px",
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 800, fontFamily: THEME.mono, color: THEME.text }}>E2E acceptance checks</div>
            <ul style={{ margin: "10px 0 0 18px", display: "flex", flexDirection: "column", gap: 6, color: THEME.textSec, fontSize: 12 }}>
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
              borderRadius: 8,
              padding: "12px 14px",
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 800, fontFamily: THEME.mono, color: THEME.text }}>Scenario notes</div>
            <div style={{ marginTop: 10, color: THEME.textSec, fontSize: 12, lineHeight: 1.55 }}>
              The reference surface is the official TradingView embed widget. The app frames remain our own implementation on top of lightweight-charts, Massive-backed data, and our normalized chart model.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
