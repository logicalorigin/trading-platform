import { useMemo, type CSSProperties, type ReactNode } from "react";
import {
  Activity,
  AreaChart,
  ArrowUpDown,
  BarChart3,
  Camera,
  CandlestickChart,
  ChevronDown,
  Crosshair,
  Magnet,
  Maximize2,
  Minimize2,
  Minus,
  MoveVertical,
  Plus,
  Redo2,
  Ruler,
  Search,
  Settings,
  Square,
  Trash2,
  Undo2,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ChartSurfaceControls } from "./ResearchChartSurface";
import type { StudySpec } from "./types";

type WidgetTheme = {
  bg2: string;
  bg3: string;
  bg4: string;
  border: string;
  text: string;
  textMuted: string;
  textDim?: string;
  green: string;
  red: string;
  amber: string;
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

type DrawMode = "horizontal" | "vertical" | "box";

type OhlcvMeta = {
  open?: number | null;
  high?: number | null;
  low?: number | null;
  close?: number | null;
  volume?: number | null;
  vwap?: number | null;
  sessionVwap?: number | null;
  accumulatedVolume?: number | null;
  averageTradeSize?: number | null;
  timestamp?: string | null;
  sourceLabel?: string;
};

type ResearchChartWidgetHeaderProps = {
  theme: WidgetTheme;
  controls: ChartSurfaceControls;
  symbol: string;
  name?: string | null;
  price?: number | null;
  priceLabel?: string | null;
  changePercent?: number | null;
  statusLabel?: string | null;
  timeframe: string;
  timeframeOptions: TimeframeOption[];
  onChangeTimeframe?: (next: string) => void;
  onOpenSearch?: () => void;
  dense?: boolean;
  meta?: OhlcvMeta | null;
  studies?: StudyOption[];
  selectedStudies?: string[];
  studySpecs?: StudySpec[];
  onToggleStudy?: (studyId: string) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  showUndoRedo?: boolean;
  showSnapshotButton?: boolean;
  showSettingsButton?: boolean;
  showFullscreenButton?: boolean;
  onFocusChart?: () => void;
  focusChartActive?: boolean;
  focusChartTitle?: string;
  onEnterSoloMode?: () => void;
  soloChartTitle?: string;
  rightSlot?: ReactNode;
};

type ResearchChartWidgetFooterProps = {
  theme: WidgetTheme;
  controls: ChartSurfaceControls;
  studies?: StudyOption[];
  selectedStudies?: string[];
  studySpecs?: StudySpec[];
  onToggleStudy?: (studyId: string) => void;
  dense?: boolean;
  statusText?: string | null;
};

type RenderedStudyLegendItem = {
  id: string;
  label: string;
  colors: string[];
};

type ResearchChartWidgetSidebarProps = {
  theme: WidgetTheme;
  controls: ChartSurfaceControls;
  drawMode?: DrawMode | null;
  drawingCount?: number;
  onToggleDrawMode?: (next: DrawMode | null) => void;
  onClearDrawings?: () => void;
  dense?: boolean;
};

type PanelPalette = {
  panel: string;
  panel2: string;
  panel3: string;
  hover: string;
  chipBg: string;
  chipBorder: string;
  shadow: string;
};

const withAlpha = (color: string, alpha: string): string =>
  /^#[0-9a-fA-F]{6}$/.test(color) ? `${color}${alpha}` : color;

const colorLuminance = (color: string): number | null => {
  const match = /^#([0-9a-fA-F]{6})$/.exec(color);
  if (!match) {
    return null;
  }

  const hex = match[1];
  const channels = [0, 2, 4].map((offset) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
};

const isLightSurface = (color: string): boolean => {
  const luminance = colorLuminance(color);
  return luminance != null ? luminance >= 0.72 : false;
};

const getPanelPalette = (theme: WidgetTheme): PanelPalette => {
  const lightSurface = isLightSurface(theme.bg2);
  return {
    panel: lightSurface ? theme.bg2 : theme.bg3,
    panel2: lightSurface ? theme.bg3 : theme.bg2,
    panel3: lightSurface ? withAlpha(theme.bg3, "f4") : theme.bg4,
    hover: lightSurface
      ? withAlpha(theme.accent || theme.text, "10")
      : theme.bg4,
    chipBg: lightSurface
      ? withAlpha(theme.bg2, "f8")
      : withAlpha(theme.bg2, "d8"),
    chipBorder: lightSurface
      ? withAlpha(theme.border, "cc")
      : withAlpha(theme.border, "88"),
    shadow: lightSurface
      ? `0 1px 2px ${withAlpha(theme.border, "55")}`
      : "none",
  };
};

const formatPrice = (value: number | null | undefined): string => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "-";
  }

  const absValue = Math.abs(value);
  if (absValue >= 100) {
    return value.toFixed(2);
  }
  if (absValue >= 10) {
    return value.toFixed(3);
  }
  if (absValue >= 1) {
    return value.toFixed(4);
  }
  return value.toFixed(5);
};

const formatPercent = (value: number | null | undefined): string => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "-";
  }
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
};

const formatVolume = (value: number | null | undefined): string => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "-";
  }

  if (value >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(2)}B`;
  }
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(2)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(2)}K`;
  }
  return `${Math.round(value)}`;
};

const formatTimestamp = (value: string | null | undefined): string => {
  if (!value) {
    return "";
  }

  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "America/New_York",
  }).format(new Date(parsed));
};

const specBelongsToStudy = (specKey: string, studyId: string): boolean =>
  specKey === studyId || specKey.startsWith(`${studyId}-`);

const resolveStudySpecColor = (spec: StudySpec): string | null => {
  const optionColor = spec.options?.color;
  if (typeof optionColor === "string" && optionColor.trim()) {
    return optionColor;
  }

  const pointColor = spec.data.find(
    (point) => typeof point.color === "string" && point.color.trim(),
  )?.color;
  return typeof pointColor === "string" && pointColor.trim()
    ? pointColor
    : null;
};

const dedupeTimeframes = (options: TimeframeOption[]): TimeframeOption[] => {
  const seen = new Set<string>();
  return options.filter((option) => {
    if (seen.has(option.value)) {
      return false;
    }
    seen.add(option.value);
    return true;
  });
};

const commonTimeframes = (options: TimeframeOption[]): TimeframeOption[] =>
  dedupeTimeframes([
    ...options,
    { value: "1m", label: "1m" },
    { value: "5m", label: "5m" },
    { value: "15m", label: "15m" },
    { value: "1h", label: "1h" },
    { value: "1D", label: "1D" },
    { value: "1W", label: "1W" },
  ]);

const iconStyle = (dense = false): CSSProperties => ({
  width: dense ? 10 : 13,
  height: dense ? 10 : 13,
  strokeWidth: 2,
  flexShrink: 0,
});

const dividerStyle = (theme: WidgetTheme, dense = false): CSSProperties => ({
  width: 1,
  height: dense ? 14 : 20,
  background: theme.border,
  margin: dense ? "0 2px" : "0 6px",
  flexShrink: 0,
});

const barButtonStyle = ({
  theme,
  palette,
  active = false,
  dense = false,
  disabled = false,
}: {
  theme: WidgetTheme;
  palette: PanelPalette;
  active?: boolean;
  dense?: boolean;
  disabled?: boolean;
}): CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 5,
  height: dense ? 20 : 28,
  minWidth: dense ? 20 : 28,
  padding: dense ? "0 4px" : "0 10px",
  border: "none",
  borderRadius: 0,
  background: active ? palette.hover : "transparent",
  color: disabled
    ? withAlpha(theme.textMuted, "75")
    : active
      ? theme.text
      : theme.textDim || theme.textMuted,
  cursor: disabled ? "default" : "pointer",
  fontFamily: theme.mono,
  fontSize: dense ? 9 : 12,
  fontWeight: active ? 700 : 500,
  opacity: disabled ? 0.6 : 1,
  whiteSpace: "nowrap",
});

const railButtonStyle = ({
  theme,
  palette,
  active = false,
  danger = false,
  dense = false,
  disabled = false,
}: {
  theme: WidgetTheme;
  palette: PanelPalette;
  active?: boolean;
  danger?: boolean;
  dense?: boolean;
  disabled?: boolean;
}): CSSProperties => {
  const accent = danger ? theme.red : theme.accent || theme.text;
  return {
    width: dense ? 22 : 32,
    height: dense ? 22 : 32,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: active ? palette.hover : "transparent",
    border: "none",
    borderRadius: 0,
    color: disabled
      ? withAlpha(theme.textMuted, "75")
      : active
        ? accent
        : danger
          ? theme.red
          : theme.textDim || theme.textMuted,
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.55 : 1,
  };
};

const legendChipStyle = ({
  theme,
  palette,
  color,
  dense = false,
}: {
  theme: WidgetTheme;
  palette: PanelPalette;
  color?: string;
  dense?: boolean;
}): CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  padding: dense ? "1px 3px" : "2px 6px",
  borderRadius: 0,
  background: palette.chipBg,
  border: `1px solid ${palette.chipBorder}`,
  boxShadow: palette.shadow,
  color: color || theme.textMuted,
  fontFamily: theme.mono,
  fontSize: dense ? 9 : 11,
  whiteSpace: "nowrap",
});

const menuContentStyle = (
  theme: WidgetTheme,
  palette: PanelPalette,
  minWidth = 220,
): CSSProperties => ({
  minWidth,
  padding: 4,
  borderRadius: 0,
  border: `1px solid ${theme.border}`,
  background: palette.panel,
  color: theme.text,
  boxShadow: palette.shadow || "0 8px 24px rgba(0,0,0,0.2)",
  fontFamily: theme.mono,
});

const menuItemStyle = (theme: WidgetTheme): CSSProperties => ({
  borderRadius: 0,
  color: theme.text,
  fontFamily: theme.mono,
  fontSize: 12,
});

const menuLabelStyle = (theme: WidgetTheme): CSSProperties => ({
  color: theme.textMuted,
  fontFamily: theme.mono,
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: "0.05em",
  textTransform: "uppercase",
});

const chartTypeOptions = [
  { value: "candles", label: "Candles", Icon: CandlestickChart },
  { value: "bars", label: "OHLC Bars", Icon: BarChart3 },
  { value: "line", label: "Line", Icon: Activity },
  { value: "area", label: "Area", Icon: AreaChart },
  { value: "baseline", label: "Baseline", Icon: Activity },
] as const;

const resolveChartType = (value: ChartSurfaceControls["baseSeriesType"]) =>
  chartTypeOptions.find((option) => option.value === value) ||
  chartTypeOptions[0];

const SettingsMenu = ({
  theme,
  palette,
  controls,
  dense,
}: {
  theme: WidgetTheme;
  palette: PanelPalette;
  controls: ChartSurfaceControls;
  dense: boolean;
}) => (
  <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <button
        type="button"
        style={barButtonStyle({ theme, palette, dense })}
        title="Settings"
      >
        <Settings style={iconStyle(dense)} />
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent
      align="end"
      sideOffset={6}
      style={menuContentStyle(theme, palette, 240)}
    >
      <DropdownMenuLabel style={menuLabelStyle(theme)}>
        Display
      </DropdownMenuLabel>
      <DropdownMenuCheckboxItem
        checked={controls.showVolume}
        onCheckedChange={() => controls.setShowVolume((value) => !value)}
        style={menuItemStyle(theme)}
      >
        Volume
      </DropdownMenuCheckboxItem>
      <DropdownMenuCheckboxItem
        checked={controls.showGrid}
        onCheckedChange={() => controls.setShowGrid((value) => !value)}
        style={menuItemStyle(theme)}
      >
        Grid
      </DropdownMenuCheckboxItem>
      <DropdownMenuCheckboxItem
        checked={controls.showPriceLine}
        onCheckedChange={() => controls.setShowPriceLine((value) => !value)}
        style={menuItemStyle(theme)}
      >
        Last price line
      </DropdownMenuCheckboxItem>
      <DropdownMenuCheckboxItem
        checked={controls.showTimeScale}
        onCheckedChange={() => controls.setShowTimeScale((value) => !value)}
        style={menuItemStyle(theme)}
      >
        Time scale
      </DropdownMenuCheckboxItem>
      <DropdownMenuSeparator />
      <DropdownMenuLabel style={menuLabelStyle(theme)}>
        Crosshair
      </DropdownMenuLabel>
      <DropdownMenuRadioGroup
        value={controls.crosshairMode}
        onValueChange={(next) =>
          controls.setCrosshairMode(next as "magnet" | "free")
        }
      >
        <DropdownMenuRadioItem value="magnet" style={menuItemStyle(theme)}>
          Magnet
        </DropdownMenuRadioItem>
        <DropdownMenuRadioItem value="free" style={menuItemStyle(theme)}>
          Free
        </DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
      <DropdownMenuSeparator />
      <DropdownMenuLabel style={menuLabelStyle(theme)}>Scale</DropdownMenuLabel>
      <DropdownMenuRadioGroup
        value={controls.scaleMode}
        onValueChange={(next) =>
          controls.setScaleMode(next as ChartSurfaceControls["scaleMode"])
        }
      >
        <DropdownMenuRadioItem value="linear" style={menuItemStyle(theme)}>
          Auto / Linear
        </DropdownMenuRadioItem>
        <DropdownMenuRadioItem value="log" style={menuItemStyle(theme)}>
          Log
        </DropdownMenuRadioItem>
        <DropdownMenuRadioItem value="percentage" style={menuItemStyle(theme)}>
          Percent
        </DropdownMenuRadioItem>
        <DropdownMenuRadioItem value="indexed" style={menuItemStyle(theme)}>
          Indexed
        </DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
      <DropdownMenuSeparator />
      <DropdownMenuCheckboxItem
        checked={controls.autoScale}
        onCheckedChange={() => controls.setAutoScale((value) => !value)}
        style={menuItemStyle(theme)}
      >
        Auto scale
      </DropdownMenuCheckboxItem>
      <DropdownMenuCheckboxItem
        checked={controls.invertScale}
        onCheckedChange={() => controls.setInvertScale((value) => !value)}
        style={menuItemStyle(theme)}
      >
        Invert scale
      </DropdownMenuCheckboxItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={controls.fit} style={menuItemStyle(theme)}>
        Fit content
      </DropdownMenuItem>
      <DropdownMenuItem
        onClick={controls.realtime}
        style={menuItemStyle(theme)}
      >
        Jump to realtime
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
);

export const ResearchChartWidgetHeader = ({
  theme,
  controls,
  symbol,
  name,
  price,
  priceLabel = null,
  changePercent,
  statusLabel,
  timeframe,
  timeframeOptions,
  onChangeTimeframe,
  onOpenSearch,
  dense = false,
  meta = null,
  studies = [],
  selectedStudies = [],
  studySpecs = [],
  onToggleStudy,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
  showUndoRedo = false,
  showSnapshotButton = true,
  showSettingsButton = true,
  showFullscreenButton = true,
  onFocusChart,
  focusChartActive = false,
  focusChartTitle = "Focus chart",
  onEnterSoloMode,
  soloChartTitle = "Expand chart",
  rightSlot = null,
}: ResearchChartWidgetHeaderProps) => {
  const palette = getPanelPalette(theme);
  const headerHeight = dense ? 28 : 40;
  const timeframes = commonTimeframes(timeframeOptions);
  const favoriteTimeframes = timeframes.slice(0, dense ? 3 : 5);
  const resolvedChartType = resolveChartType(controls.baseSeriesType);
  const canSearch = typeof onOpenSearch === "function";
  const activeBar = controls.activeBar;
  const resolvedMeta = {
    open: activeBar?.open ?? meta?.open ?? null,
    high: activeBar?.high ?? meta?.high ?? null,
    low: activeBar?.low ?? meta?.low ?? null,
    close: activeBar?.close ?? meta?.close ?? null,
    volume: activeBar?.volume ?? meta?.volume ?? null,
    vwap: activeBar?.vwap ?? meta?.vwap ?? null,
    sessionVwap: activeBar?.sessionVwap ?? meta?.sessionVwap ?? null,
    accumulatedVolume:
      activeBar?.accumulatedVolume ?? meta?.accumulatedVolume ?? null,
    averageTradeSize:
      activeBar?.averageTradeSize ?? meta?.averageTradeSize ?? null,
    timestamp: activeBar?.ts ?? meta?.timestamp ?? null,
    sourceLabel:
      activeBar?.source === "ibkr-websocket-derived"
        ? "WS"
        : activeBar?.source === "ibkr+massive-gap-fill"
          ? "IBKR + GAP"
          : activeBar?.source === "ibkr-history"
            ? "IBKR"
            : (meta?.sourceLabel ?? (activeBar?.source ? "REST" : "")),
  };
  const displayPrice = price ?? resolvedMeta.close ?? null;
  const positive = (changePercent ?? 0) >= 0;
  const changeColor = positive ? theme.green : theme.red;
  const statusColor =
    statusLabel && /live|open|stream|massive|ibkr/i.test(statusLabel)
      ? theme.green
      : theme.textDim || theme.textMuted;
  const showTrailingActions =
    showSnapshotButton ||
    showSettingsButton ||
    showFullscreenButton ||
    typeof onFocusChart === "function" ||
    typeof onEnterSoloMode === "function" ||
    rightSlot != null;
  const studyLookup = useMemo(
    () => new Map(studies.map((study) => [study.id, study.label])),
    [studies],
  );
  const renderedStudyItems = useMemo<RenderedStudyLegendItem[]>(
    () =>
      selectedStudies.reduce<RenderedStudyLegendItem[]>((items, studyId) => {
        const visibleSpecs = studySpecs.filter(
          (spec) =>
            specBelongsToStudy(spec.key, studyId) &&
            spec.options?.visible !== false &&
            spec.data.length > 0,
        );
        if (!visibleSpecs.length) {
          return items;
        }

        const colors = Array.from(
          new Set(
            visibleSpecs
              .map(resolveStudySpecColor)
              .filter((value): value is string => Boolean(value)),
          ),
        );

        items.push({
          id: studyId,
          label: studyLookup.get(studyId) || studyId,
          colors: colors.length ? colors : [theme.accent || theme.text],
        });
        return items;
      }, []),
    [selectedStudies, studyLookup, studySpecs, theme.accent, theme.text],
  );

  return (
    <div style={{ position: "relative", pointerEvents: "none" }}>
      <div
        style={{
          height: headerHeight,
          background: palette.panel,
          borderBottom: `1px solid ${theme.border}`,
          display: "flex",
          alignItems: "center",
          padding: dense ? "0 2px" : "0 4px",
          gap: 2,
          overflow: "hidden",
          fontFamily: theme.mono,
          pointerEvents: "auto",
        }}
      >
        <button
          type="button"
          data-testid={canSearch ? "chart-symbol-search-button" : undefined}
          onClick={canSearch ? onOpenSearch : undefined}
          style={{
            ...barButtonStyle({ theme, palette, dense }),
            color: theme.text,
            cursor: canSearch ? "pointer" : "default",
          }}
          title={canSearch ? `Search ${symbol}` : symbol}
        >
          {canSearch ? <Search style={iconStyle(dense)} /> : null}
          <span style={{ fontWeight: 700 }}>{symbol}</span>
          {canSearch ? <ChevronDown style={iconStyle(dense)} /> : null}
        </button>

        <div style={dividerStyle(theme, dense)} />

        {favoriteTimeframes.map((option) => {
          const active = option.value === timeframe;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onChangeTimeframe?.(option.value)}
              style={barButtonStyle({
                theme,
                palette,
                dense,
                active,
              })}
              title={`Set timeframe ${option.label}`}
            >
              {option.label}
            </button>
          );
        })}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              style={barButtonStyle({ theme, palette, dense })}
              title="More timeframes"
            >
              <span>{timeframe}</span>
              <ChevronDown style={iconStyle(dense)} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            sideOffset={6}
            style={menuContentStyle(theme, palette, 160)}
          >
            <DropdownMenuLabel style={menuLabelStyle(theme)}>
              Timeframe
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={timeframe}
              onValueChange={(next) => onChangeTimeframe?.(next)}
            >
              {timeframes.map((option) => (
                <DropdownMenuRadioItem
                  key={option.value}
                  value={option.value}
                  style={menuItemStyle(theme)}
                >
                  {option.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              style={barButtonStyle({ theme, palette, dense })}
              title="Chart type"
            >
              <resolvedChartType.Icon style={iconStyle(dense)} />
              {dense ? null : <span>{resolvedChartType.label}</span>}
              <ChevronDown style={iconStyle(dense)} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            sideOffset={6}
            style={menuContentStyle(theme, palette, 210)}
          >
            <DropdownMenuLabel style={menuLabelStyle(theme)}>
              Chart type
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={controls.baseSeriesType}
              onValueChange={(next) =>
                controls.setBaseSeriesType(
                  next as ChartSurfaceControls["baseSeriesType"],
                )
              }
            >
              {chartTypeOptions.map((option) => (
                <DropdownMenuRadioItem
                  key={option.value}
                  value={option.value}
                  style={menuItemStyle(theme)}
                >
                  <option.Icon
                    style={{ ...iconStyle(dense), marginRight: 6 }}
                  />
                  {option.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              style={barButtonStyle({ theme, palette, dense })}
              title="Indicators"
            >
              <Plus style={iconStyle(dense)} />
              <span>
                {dense
                  ? selectedStudies.length > 0
                    ? `Ind ${selectedStudies.length}`
                    : "Ind"
                  : `Indicators ${
                      selectedStudies.length > 0 ? selectedStudies.length : ""
                    }`.trim()}
              </span>
              <ChevronDown style={iconStyle(dense)} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            sideOffset={6}
            style={menuContentStyle(theme, palette, 220)}
          >
            <DropdownMenuLabel style={menuLabelStyle(theme)}>
              Indicators
            </DropdownMenuLabel>
            {studies.length ? (
              studies.map((study) => (
                <DropdownMenuCheckboxItem
                  key={study.id}
                  checked={selectedStudies.includes(study.id)}
                  onCheckedChange={() => onToggleStudy?.(study.id)}
                  style={menuItemStyle(theme)}
                >
                  {study.label}
                </DropdownMenuCheckboxItem>
              ))
            ) : (
              <DropdownMenuItem disabled style={menuItemStyle(theme)}>
                No indicators available
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        <div style={{ flex: 1 }} />

        {showUndoRedo ? (
          <>
            <button
              type="button"
              onClick={onUndo}
              disabled={!canUndo}
              style={barButtonStyle({
                theme,
                palette,
                dense,
                disabled: !canUndo,
              })}
              title="Undo"
            >
              <Undo2 style={iconStyle(dense)} />
            </button>
            <button
              type="button"
              onClick={onRedo}
              disabled={!canRedo}
              style={barButtonStyle({
                theme,
                palette,
                dense,
                disabled: !canRedo,
              })}
              title="Redo"
            >
              <Redo2 style={iconStyle(dense)} />
            </button>
          </>
        ) : null}

        {showTrailingActions ? (
          <div style={dividerStyle(theme, dense)} />
        ) : null}

        {typeof onFocusChart === "function" ? (
          <button
            type="button"
            onClick={onFocusChart}
            style={barButtonStyle({
              theme,
              palette,
              dense,
              active: focusChartActive,
            })}
            title={focusChartTitle}
          >
            <Crosshair style={iconStyle(dense)} />
            {dense ? null : <span>Focus</span>}
          </button>
        ) : null}

        {typeof onEnterSoloMode === "function" ? (
          <button
            type="button"
            onClick={onEnterSoloMode}
            style={barButtonStyle({ theme, palette, dense })}
            title={soloChartTitle}
          >
            <Maximize2 style={iconStyle(dense)} />
            {dense ? null : <span>Solo</span>}
          </button>
        ) : null}

        {showSnapshotButton ? (
          <button
            type="button"
            onClick={controls.takeSnapshot}
            style={barButtonStyle({ theme, palette, dense })}
            title="Screenshot"
          >
            <Camera style={iconStyle(dense)} />
          </button>
        ) : null}

        {showSettingsButton ? (
          <SettingsMenu
            theme={theme}
            palette={palette}
            controls={controls}
            dense={dense}
          />
        ) : null}

        {showFullscreenButton ? (
          <button
            type="button"
            onClick={controls.toggleFullscreen}
            style={barButtonStyle({ theme, palette, dense })}
            title={
              controls.isFullscreen ? "Exit fullscreen" : "Enter fullscreen"
            }
          >
            {controls.isFullscreen ? (
              <Minimize2 style={iconStyle(dense)} />
            ) : (
              <Maximize2 style={iconStyle(dense)} />
            )}
          </button>
        ) : null}

        {rightSlot}
      </div>

      <div
        style={{
          position: "absolute",
          top: headerHeight + 6,
          left: dense ? 8 : 12,
          right: 12,
          display: "flex",
          flexDirection: "column",
          gap: dense ? 2 : 3,
          pointerEvents: "none",
          maxWidth: "calc(100% - 104px)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: dense ? 6 : 8,
            flexWrap: "wrap",
          }}
        >
          <span
            style={legendChipStyle({
              theme,
              palette,
              color: theme.text,
              dense,
            })}
          >
            <span style={{ fontWeight: 700 }}>{symbol}</span>
            {name && !dense ? (
              <span style={{ color: theme.textMuted }}>{name}</span>
            ) : null}
            <span style={{ color: theme.textMuted }}>{timeframe}</span>
            {statusLabel ? (
              <span style={{ color: statusColor }}>{statusLabel}</span>
            ) : null}
          </span>

          <span
            style={legendChipStyle({
              theme,
              palette,
              color: theme.text,
              dense,
            })}
          >
            {priceLabel ? (
              <span style={{ color: theme.textMuted }}>{priceLabel}</span>
            ) : null}
            <span>{formatPrice(displayPrice)}</span>
            <span style={{ color: changeColor, fontWeight: 700 }}>
              {formatPercent(changePercent)}
            </span>
          </span>

          <span style={legendChipStyle({ theme, palette, dense })}>
            <span style={{ color: theme.textMuted }}>
              {`Bar ${timeframe}`}
            </span>{" "}
            O{" "}
            <span style={{ color: theme.text }}>
              {formatPrice(resolvedMeta.open)}
            </span>
            H{" "}
            <span style={{ color: theme.green }}>
              {formatPrice(resolvedMeta.high)}
            </span>
            L{" "}
            <span style={{ color: theme.red }}>
              {formatPrice(resolvedMeta.low)}
            </span>
            C{" "}
            <span style={{ color: theme.text }}>
              {formatPrice(resolvedMeta.close)}
            </span>
            V{" "}
            <span style={{ color: theme.text }}>
              {formatVolume(resolvedMeta.volume)}
            </span>
          </span>

          {!dense && resolvedMeta.vwap != null ? (
            <span style={legendChipStyle({ theme, palette, dense })}>
              VWAP{" "}
              <span style={{ color: theme.text }}>
                {formatPrice(resolvedMeta.vwap)}
              </span>
            </span>
          ) : null}

          {!dense && resolvedMeta.sessionVwap != null ? (
            <span style={legendChipStyle({ theme, palette, dense })}>
              SVWAP{" "}
              <span style={{ color: theme.text }}>
                {formatPrice(resolvedMeta.sessionVwap)}
              </span>
            </span>
          ) : null}

          {!dense && (resolvedMeta.timestamp || resolvedMeta.sourceLabel) ? (
            <span style={legendChipStyle({ theme, palette, dense })}>
              {[
                formatTimestamp(resolvedMeta.timestamp),
                resolvedMeta.sourceLabel,
              ]
                .filter(Boolean)
                .join("  ")}
            </span>
          ) : null}
        </div>

        {renderedStudyItems.length ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              flexWrap: "wrap",
            }}
          >
            {renderedStudyItems.map((study) => (
              <span
                key={study.id}
                style={legendChipStyle({
                  theme,
                  palette,
                  dense,
                  color: theme.textMuted,
                })}
              >
                {study.colors.map((color, index) => (
                  <span
                    key={`${study.id}-${color}-${index}`}
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: "50%",
                      background: color,
                      display: "inline-block",
                    }}
                  />
                ))}
                {study.label}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
};

export const ResearchChartWidgetFooter = ({
  theme,
  controls,
  studies = [],
  selectedStudies = [],
  studySpecs = [],
  onToggleStudy: _onToggleStudy,
  dense = false,
  statusText = null,
}: ResearchChartWidgetFooterProps) => {
  const palette = getPanelPalette(theme);
  const footerHeight = dense ? 16 : 22;
  const studyLookup = useMemo(
    () => new Map(studies.map((study) => [study.id, study.label])),
    [studies],
  );
  const activeLabels = selectedStudies
    .filter((studyId) =>
      studySpecs.some(
        (spec) =>
          specBelongsToStudy(spec.key, studyId) &&
          spec.options?.visible !== false &&
          spec.data.length > 0,
      ),
    )
    .map((studyId) => studyLookup.get(studyId) || studyId)
    .slice(0, 4);

  return (
    <div style={{ position: "relative", pointerEvents: "none" }}>
      <div
        style={{
          height: footerHeight,
          background: palette.panel,
          borderTop: `1px solid ${theme.border}`,
          display: "flex",
          alignItems: "center",
          padding: dense ? "0 8px" : "0 10px",
          gap: dense ? 8 : 14,
          fontFamily: theme.mono,
          fontSize: dense ? 9 : 10,
          color: theme.textMuted,
          pointerEvents: "auto",
          whiteSpace: "nowrap",
          overflow: "hidden",
        }}
      >
        {activeLabels.length ? (
          <span>{activeLabels.join(" · ")}</span>
        ) : (
          <span>Pan: drag</span>
        )}
        <span>Zoom: scroll</span>
        <span>{dense ? "Scale: A/L/%" : "A / L / % / 100 = price scale"}</span>
        <div style={{ flex: 1 }} />
        {statusText ? <span>{statusText}</span> : null}
      </div>

      <div
        style={{
          position: "absolute",
          right: dense ? 44 : 58,
          bottom: footerHeight + (dense ? 4 : 6),
          display: "flex",
          gap: 2,
          background: palette.panel,
          border: `1px solid ${theme.border}`,
          borderRadius: 0,
          padding: dense ? 1 : 2,
          fontFamily: theme.mono,
          fontSize: dense ? 8 : 10,
          zIndex: 5,
          pointerEvents: "auto",
          boxShadow: palette.shadow,
        }}
      >
        {[
          {
            key: "linear",
            label: "A",
            title: "Auto / linear scale",
            onClick: () => {
              controls.setScaleMode("linear");
              controls.setAutoScale(true);
            },
          },
          {
            key: "log",
            label: "L",
            title: "Log scale",
            onClick: () => controls.setScaleMode("log"),
          },
          {
            key: "percentage",
            label: "%",
            title: "Percent scale",
            onClick: () => controls.setScaleMode("percentage"),
          },
          {
            key: "indexed",
            label: "100",
            title: "Indexed scale",
            onClick: () => controls.setScaleMode("indexed"),
          },
        ].map((mode) => {
          const active =
            mode.key === "linear"
              ? controls.scaleMode === "linear"
              : controls.scaleMode === mode.key;
          return (
            <button
              key={mode.key}
              type="button"
              onClick={mode.onClick}
              title={mode.title}
              style={{
                width:
                  mode.key === "indexed" ? (dense ? 24 : 28) : dense ? 16 : 20,
                height: dense ? 16 : 20,
                background: active ? theme.accent || theme.text : "transparent",
                color: active ? "#fff" : theme.textDim || theme.textMuted,
                border: "none",
                borderRadius: 0,
                cursor: "pointer",
                fontFamily: theme.mono,
                fontSize: dense ? 8 : 10,
                fontWeight: 700,
                padding: 0,
              }}
            >
              {mode.label}
            </button>
          );
        })}

        <div
          style={{
            width: 1,
            alignSelf: "stretch",
            background: theme.border,
            margin: "0 2px",
          }}
        />

        <button
          type="button"
          onClick={() => controls.setInvertScale((value) => !value)}
          title="Invert scale"
          style={{
            width: dense ? 16 : 20,
            height: dense ? 16 : 20,
            background: controls.invertScale
              ? theme.accent || theme.text
              : "transparent",
            color: controls.invertScale
              ? "#fff"
              : theme.textDim || theme.textMuted,
            border: "none",
            borderRadius: 0,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 0,
          }}
        >
          <ArrowUpDown style={iconStyle(true)} />
        </button>
      </div>
    </div>
  );
};

export const ResearchChartWidgetSidebar = ({
  theme,
  controls,
  drawMode = null,
  drawingCount = 0,
  onToggleDrawMode,
  onClearDrawings,
  dense = false,
}: ResearchChartWidgetSidebarProps) => {
  const palette = getPanelPalette(theme);
  const groups = [
    [
      {
        key: "crosshair",
        title: "Crosshair / pan",
        icon: <Crosshair style={iconStyle(dense)} />,
        active: !drawMode,
        onClick: () => onToggleDrawMode?.(null),
      },
    ],
    [
      {
        key: "horizontal",
        title: "Horizontal line",
        icon: <Minus style={iconStyle(dense)} />,
        active: drawMode === "horizontal",
        onClick: () =>
          onToggleDrawMode?.(drawMode === "horizontal" ? null : "horizontal"),
      },
      {
        key: "vertical",
        title: "Vertical line",
        icon: <MoveVertical style={iconStyle(dense)} />,
        active: drawMode === "vertical",
        onClick: () =>
          onToggleDrawMode?.(drawMode === "vertical" ? null : "vertical"),
      },
      {
        key: "box",
        title: "Rectangle",
        icon: <Square style={iconStyle(dense)} />,
        active: drawMode === "box",
        onClick: () => onToggleDrawMode?.(drawMode === "box" ? null : "box"),
      },
    ],
    [
      {
        key: "magnet",
        title:
          controls.crosshairMode === "free"
            ? "Free crosshair"
            : "Magnet crosshair",
        icon:
          controls.crosshairMode === "free" ? (
            <Crosshair style={iconStyle(dense)} />
          ) : (
            <Magnet style={iconStyle(dense)} />
          ),
        active: controls.crosshairMode === "free",
        onClick: () =>
          controls.setCrosshairMode((value) =>
            value === "free" ? "magnet" : "free",
          ),
      },
      {
        key: "fit",
        title: "Fit content",
        icon: <Ruler style={iconStyle(dense)} />,
        active: false,
        onClick: controls.fit,
      },
    ],
  ];

  return (
    <div
      style={{
        width: dense ? 30 : 40,
        height: "100%",
        background: palette.panel,
        borderRight: `1px solid ${theme.border}`,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: dense ? "4px 0" : "6px 0",
        gap: 2,
        overflowY: "auto",
      }}
    >
      {groups.map((group, groupIndex) => (
        <div
          key={groupIndex}
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 2,
            width: "100%",
          }}
        >
          {groupIndex > 0 ? (
            <div
              style={{
                width: dense ? 14 : 20,
                height: 1,
                background: theme.border,
                margin: "3px 0",
              }}
            />
          ) : null}

          {group.map((button) => (
            <button
              key={button.key}
              type="button"
              aria-pressed={button.active}
              onClick={button.onClick}
              title={button.title}
              style={railButtonStyle({
                theme,
                palette,
                active: button.active,
                dense,
              })}
            >
              {button.icon}
            </button>
          ))}
        </div>
      ))}

      <div style={{ flex: 1, minHeight: 8 }} />

      <button
        type="button"
        onClick={onClearDrawings}
        disabled={!drawingCount}
        title={
          drawingCount
            ? `Remove all drawings (${drawingCount})`
            : "No drawings to remove"
        }
        style={railButtonStyle({
          theme,
          palette,
          dense,
          danger: true,
          disabled: !drawingCount,
        })}
      >
        <Trash2 style={iconStyle(dense)} />
      </button>
    </div>
  );
};
