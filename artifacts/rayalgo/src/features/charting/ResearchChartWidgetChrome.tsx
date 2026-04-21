import type { ChartSurfaceControls } from "./ResearchChartSurface";

type WidgetTheme = {
  bg2: string;
  bg3: string;
  bg4: string;
  border: string;
  text: string;
  textMuted: string;
  green: string;
  red: string;
  accent?: string;
  accentDim?: string;
  mono: string;
};

type TimeframeOption = {
  value: string;
  label: string;
};

type StudyOption = {
  id: string;
  label: string;
};

type OhlcvMeta = {
  open?: number | null;
  high?: number | null;
  low?: number | null;
  close?: number | null;
  volume?: number | null;
  sourceLabel?: string;
};

type ResearchChartWidgetHeaderProps = {
  theme: WidgetTheme;
  controls: ChartSurfaceControls;
  symbol: string;
  name?: string | null;
  price?: number | null;
  changePercent?: number | null;
  statusLabel?: string | null;
  timeframe: string;
  timeframeOptions: TimeframeOption[];
  onChangeTimeframe?: (next: string) => void;
  onOpenSearch?: () => void;
  dense?: boolean;
  meta?: OhlcvMeta | null;
};

type ResearchChartWidgetFooterProps = {
  theme: WidgetTheme;
  controls: ChartSurfaceControls;
  studies?: StudyOption[];
  selectedStudies?: string[];
  onToggleStudy?: (studyId: string) => void;
  dense?: boolean;
};

const withAlpha = (color: string, alpha: string): string => (
  /^#[0-9a-fA-F]{6}$/.test(color)
    ? `${color}${alpha}`
    : color
);

const controlButtonStyle = ({
  theme,
  active = false,
  compact = false,
}: {
  theme: WidgetTheme;
  active?: boolean;
  compact?: boolean;
}) => ({
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 4,
  minWidth: compact ? 20 : 24,
  height: compact ? 18 : 20,
  padding: compact ? "0 5px" : "0 7px",
  borderRadius: 4,
  border: `1px solid ${active ? (theme.accent || theme.text) : withAlpha(theme.border, "cc")}`,
  background: active
    ? (theme.accentDim || withAlpha(theme.accent || theme.text, "22"))
    : withAlpha(theme.bg4, "f2"),
  color: active ? (theme.accent || theme.text) : theme.textMuted,
  fontSize: compact ? 9 : 10,
  fontWeight: 700,
  fontFamily: theme.mono,
  lineHeight: 1,
  cursor: "pointer",
}) satisfies Record<string, string | number>;

const formatPrice = (value: number | null | undefined) => (
  typeof value === "number" && Number.isFinite(value)
    ? value < 10
      ? value.toFixed(3)
      : value.toFixed(2)
    : "—"
);

const formatPercent = (value: number | null | undefined) => (
  typeof value === "number" && Number.isFinite(value)
    ? `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`
    : "—"
);

const formatVolume = (value: number | null | undefined) => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "—";
  }

  if (value >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(2)}B`;
  }
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(2)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }
  return `${Math.round(value)}`;
};

const scaleLabel = (value: ChartSurfaceControls["scaleMode"]) => (
  value === "log"
    ? "LOG"
    : value === "percentage"
      ? "%"
      : value === "indexed"
        ? "100"
        : "LIN"
);

export const ResearchChartWidgetHeader = ({
  theme,
  controls,
  symbol,
  name,
  price,
  changePercent,
  statusLabel,
  timeframe,
  timeframeOptions,
  onChangeTimeframe,
  onOpenSearch,
  dense = false,
  meta = null,
}: ResearchChartWidgetHeaderProps) => {
  const positive = (changePercent ?? 0) >= 0;

  return (
    <div
      style={{
        background: `linear-gradient(180deg, ${withAlpha(theme.bg2, "fa")} 0%, ${withAlpha(theme.bg2, "ee")} 100%)`,
        borderBottom: `1px solid ${theme.border}`,
        padding: dense ? "4px 7px" : "5px 8px",
        display: "flex",
        flexDirection: "column",
        gap: dense ? 2 : 4,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          minWidth: 0,
        }}
      >
        <button
          type="button"
          onClick={onOpenSearch}
          title={`Search ${symbol}`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            background: "transparent",
            border: "none",
            padding: 0,
            color: theme.text,
            cursor: onOpenSearch ? "pointer" : "default",
            minWidth: 0,
          }}
        >
          <span style={{ fontSize: dense ? 11 : 12, fontWeight: 800, fontFamily: theme.mono }}>{symbol}</span>
          <span style={{ fontSize: 9, color: theme.textMuted, fontFamily: theme.mono }}>⌕</span>
        </button>
        <span style={{ fontSize: dense ? 10 : 11, fontWeight: 700, fontFamily: theme.mono, color: theme.text }}>
          {formatPrice(price)}
        </span>
        <span
          style={{
            fontSize: 9,
            fontWeight: 700,
            fontFamily: theme.mono,
            color: positive ? theme.green : theme.red,
            whiteSpace: "nowrap",
          }}
        >
          {formatPercent(changePercent)}
        </span>
        <span style={{ flex: 1 }} />
        <div style={{ display: "flex", alignItems: "center", gap: 3, flexWrap: "wrap", justifyContent: "flex-end" }}>
          {[
            { key: "candles", label: "C", active: controls.baseSeriesType === "candles", onClick: () => controls.setBaseSeriesType("candles") },
            { key: "bars", label: "B", active: controls.baseSeriesType === "bars", onClick: () => controls.setBaseSeriesType("bars") },
            { key: "line", label: "L", active: controls.baseSeriesType === "line", onClick: () => controls.setBaseSeriesType("line") },
            { key: "area", label: "A", active: controls.baseSeriesType === "area", onClick: () => controls.setBaseSeriesType("area") },
            { key: "baseline", label: "BL", active: controls.baseSeriesType === "baseline", onClick: () => controls.setBaseSeriesType("baseline") },
          ].map((item) => (
            <button
              key={item.key}
              type="button"
              aria-pressed={item.active}
              onClick={item.onClick}
              style={controlButtonStyle({ theme, active: item.active, compact: dense })}
            >
              {item.label}
            </button>
          ))}
          <button
            type="button"
            aria-pressed={controls.showVolume}
            onClick={() => controls.setShowVolume((value) => !value)}
            style={controlButtonStyle({ theme, active: controls.showVolume, compact: dense })}
            title="Toggle volume"
          >
            VOL
          </button>
          <button
            type="button"
            aria-pressed={controls.scaleMode !== "linear"}
            onClick={controls.cycleScaleMode}
            style={controlButtonStyle({ theme, active: controls.scaleMode !== "linear", compact: dense })}
            title="Cycle scale mode"
          >
            {scaleLabel(controls.scaleMode)}
          </button>
          <button
            type="button"
            aria-pressed={controls.showGrid}
            onClick={() => controls.setShowGrid((value) => !value)}
            style={controlButtonStyle({ theme, active: controls.showGrid, compact: dense })}
            title="Toggle grid"
          >
            G
          </button>
          <button
            type="button"
            aria-pressed={controls.crosshairMode === "free"}
            onClick={() => controls.setCrosshairMode((value) => value === "free" ? "magnet" : "free")}
            style={controlButtonStyle({ theme, active: controls.crosshairMode === "free", compact: dense })}
            title="Toggle crosshair mode"
          >
            {controls.crosshairMode === "free" ? "FREE" : "MAG"}
          </button>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          flexWrap: "wrap",
          minWidth: 0,
        }}
      >
        <span
          style={{
            minWidth: 0,
            fontSize: 9,
            fontFamily: theme.mono,
            color: theme.textMuted,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {name || symbol}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap" }}>
          {timeframeOptions.map((option) => {
            const active = option.value === timeframe;
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={active}
                onClick={() => onChangeTimeframe?.(option.value)}
                style={controlButtonStyle({ theme, active, compact: true })}
              >
                {option.label}
              </button>
            );
          })}
        </div>
        <span style={{ flex: 1 }} />
        <div style={{ display: "flex", alignItems: "center", gap: 3, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <button type="button" onClick={controls.fit} style={controlButtonStyle({ theme, compact: true })} title="Fit content">FIT</button>
          <button type="button" onClick={controls.reset} style={controlButtonStyle({ theme, compact: true })} title="Reset viewport">RST</button>
          <button type="button" onClick={controls.realtime} style={controlButtonStyle({ theme, compact: true })} title="Scroll to realtime">RT</button>
          <span style={{ fontSize: 8, fontFamily: theme.mono, color: theme.textMuted, whiteSpace: "nowrap" }}>
            {statusLabel || ""}
          </span>
        </div>
      </div>

      {meta ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
            paddingTop: 3,
            borderTop: `1px solid ${withAlpha(theme.border, "66")}`,
            fontSize: 8,
            fontFamily: theme.mono,
            color: theme.textMuted,
          }}
        >
          <span>O {formatPrice(meta.open)}</span>
          <span>H <span style={{ color: theme.green }}>{formatPrice(meta.high)}</span></span>
          <span>L <span style={{ color: theme.red }}>{formatPrice(meta.low)}</span></span>
          <span>C <span style={{ color: theme.text }}>{formatPrice(meta.close)}</span></span>
          <span>V {formatVolume(meta.volume)}</span>
          <span style={{ marginLeft: "auto" }}>{meta.sourceLabel || ""}</span>
        </div>
      ) : null}
    </div>
  );
};

export const ResearchChartWidgetFooter = ({
  theme,
  controls,
  studies = [],
  selectedStudies = [],
  onToggleStudy,
  dense = false,
}: ResearchChartWidgetFooterProps) => (
  <div
    style={{
      background: `linear-gradient(0deg, ${withAlpha(theme.bg2, "fa")} 0%, ${withAlpha(theme.bg2, "ee")} 100%)`,
      borderTop: `1px solid ${theme.border}`,
      padding: dense ? "3px 7px" : "4px 8px",
      display: "flex",
      alignItems: "center",
      gap: 5,
      flexWrap: "wrap",
    }}
  >
    <span style={{ fontSize: 8, color: theme.textMuted, fontFamily: theme.mono, letterSpacing: "0.06em" }}>
      STUDIES
    </span>
    {studies.map((study) => {
      const active = selectedStudies.includes(study.id);
      return (
        <button
          key={study.id}
          type="button"
          aria-pressed={active}
          onClick={() => onToggleStudy?.(study.id)}
          style={controlButtonStyle({ theme, active, compact: true })}
        >
          {study.label}
        </button>
      );
    })}
    <span style={{ flex: 1 }} />
    <button
      type="button"
      aria-pressed={controls.showPriceLine}
      onClick={() => controls.setShowPriceLine((value) => !value)}
      style={controlButtonStyle({ theme, active: controls.showPriceLine, compact: true })}
      title="Toggle last price line"
    >
      PL
    </button>
    <button
      type="button"
      aria-pressed={controls.showTimeScale}
      onClick={() => controls.setShowTimeScale((value) => !value)}
      style={controlButtonStyle({ theme, active: controls.showTimeScale, compact: true })}
      title="Toggle time scale"
    >
      TIME
    </button>
    <button
      type="button"
      aria-pressed={controls.autoScale}
      onClick={() => controls.setAutoScale((value) => !value)}
      style={controlButtonStyle({ theme, active: controls.autoScale, compact: true })}
      title="Toggle auto scale"
    >
      AUTO
    </button>
    <button
      type="button"
      aria-pressed={controls.invertScale}
      onClick={() => controls.setInvertScale((value) => !value)}
      style={controlButtonStyle({ theme, active: controls.invertScale, compact: true })}
      title="Invert scale"
    >
      INV
    </button>
  </div>
);
