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
  Star,
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  formatPreferenceDateTime,
  type UserPreferences,
} from "../preferences/userPreferenceModel";
import { useUserPreferences } from "../preferences/useUserPreferences";
import { FONT_CSS_VAR, TYPE_CSS_VAR } from "../../lib/typography";
import type { ChartSurfaceControls } from "./ResearchChartSurface";
import type { StudySpec } from "./types";
import { AppTooltip } from "@/components/ui/tooltip";


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
  display?: string;
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
  statusTone?: "good" | "warn" | "bad" | "neutral" | "muted" | "info";
  timeframe: string;
  timeframeOptions: TimeframeOption[];
  favoriteTimeframes?: string[];
  onChangeTimeframe?: (next: string) => void;
  onToggleFavoriteTimeframe?: (next: string) => void;
  onPrewarmTimeframe?: (next: string) => void;
  onOpenSearch?: () => void;
  searchOpen?: boolean;
  onSearchOpenChange?: (open: boolean) => void;
  searchContent?: ReactNode;
  dense?: boolean;
  meta?: OhlcvMeta | null;
  showInlineLegend?: boolean;
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
  identitySlot?: ReactNode;
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

const formatTimestamp = (
  value: string | null | undefined,
  preferences: UserPreferences,
): string =>
  value
    ? formatPreferenceDateTime(value, {
        preferences,
        context: "chart",
        monthStyle: "short",
        dayStyle: "numeric",
        fallback: value,
      })
    : "";

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
  dedupeTimeframes(options);

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
  fontSize: dense ? TYPE_CSS_VAR.label : TYPE_CSS_VAR.bodyStrong,
  fontWeight: 400,
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
  fontSize: dense ? TYPE_CSS_VAR.label : TYPE_CSS_VAR.bodyStrong,
  whiteSpace: "nowrap",
});

const chartMenuContentClassName = "chart-widget-menu";
const chartMenuItemClassName = "chart-widget-menu__item";
const chartMenuLabelClassName = "chart-widget-menu__label";
const chartMenuSeparatorClassName = "chart-widget-menu__separator";

const menuContentStyle = (
  theme: WidgetTheme,
  palette: PanelPalette,
  minWidth = 220,
): CSSProperties =>
  ({
    "--chart-menu-accent": theme.accent || "#2962ff",
    "--chart-menu-active": withAlpha(theme.accent || "#2962ff", "24"),
    "--chart-menu-bg": palette.panel,
    "--chart-menu-border": theme.border,
    "--chart-menu-hover": withAlpha(theme.text, "12"),
    "--chart-menu-muted": theme.textMuted,
    "--chart-menu-text": theme.text,
    "--chart-menu-font": theme.display || FONT_CSS_VAR.sans,
    minWidth,
    padding: 6,
    borderRadius: 6,
    border: `1px solid ${withAlpha(theme.border, "d9")}`,
    background: palette.panel,
    color: theme.text,
    boxShadow:
      "0 16px 32px rgba(0,0,0,0.36), 0 0 0 1px rgba(255,255,255,0.03)",
    fontFamily: theme.display || FONT_CSS_VAR.sans,
  } as CSSProperties);

const menuItemStyle = (theme: WidgetTheme): CSSProperties => ({
  borderRadius: 4,
  color: theme.text,
  fontFamily: theme.display || FONT_CSS_VAR.sans,
  fontSize: TYPE_CSS_VAR.bodyStrong,
  fontWeight: 400,
});

const menuLabelStyle = (theme: WidgetTheme): CSSProperties => ({
  color: theme.textMuted,
  fontFamily: theme.display || FONT_CSS_VAR.sans,
  fontSize: TYPE_CSS_VAR.body,
  fontWeight: 400,
  letterSpacing: 0,
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
    <AppTooltip content="Settings">
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Settings"
          style={barButtonStyle({ theme, palette, dense })}
        >
          <Settings style={iconStyle(dense)} />
        </button>
      </DropdownMenuTrigger>
    </AppTooltip>
    <DropdownMenuContent
      align="end"
      className={chartMenuContentClassName}
      sideOffset={6}
      style={menuContentStyle(theme, palette, 240)}
    >
      <DropdownMenuLabel
        className={chartMenuLabelClassName}
        style={menuLabelStyle(theme)}
      >
        Display
      </DropdownMenuLabel>
      <DropdownMenuCheckboxItem
        className={chartMenuItemClassName}
        checked={controls.showVolume}
        onCheckedChange={() => controls.setShowVolume((value) => !value)}
        style={menuItemStyle(theme)}
      >
        Volume
      </DropdownMenuCheckboxItem>
      <DropdownMenuCheckboxItem
        className={chartMenuItemClassName}
        checked={controls.showGrid}
        onCheckedChange={() => controls.setShowGrid((value) => !value)}
        style={menuItemStyle(theme)}
      >
        Grid
      </DropdownMenuCheckboxItem>
      <DropdownMenuCheckboxItem
        className={chartMenuItemClassName}
        checked={controls.showPriceLine}
        onCheckedChange={() => controls.setShowPriceLine((value) => !value)}
        style={menuItemStyle(theme)}
      >
        Last price line
      </DropdownMenuCheckboxItem>
      <DropdownMenuCheckboxItem
        className={chartMenuItemClassName}
        checked={controls.showTimeScale}
        onCheckedChange={() => controls.setShowTimeScale((value) => !value)}
        style={menuItemStyle(theme)}
      >
        Time scale
      </DropdownMenuCheckboxItem>
      <DropdownMenuSeparator className={chartMenuSeparatorClassName} />
      <DropdownMenuLabel
        className={chartMenuLabelClassName}
        style={menuLabelStyle(theme)}
      >
        Crosshair
      </DropdownMenuLabel>
      <DropdownMenuRadioGroup
        value={controls.crosshairMode}
        onValueChange={(next) =>
          controls.setCrosshairMode(next as "magnet" | "free")
        }
      >
        <DropdownMenuRadioItem
          className={chartMenuItemClassName}
          value="magnet"
          style={menuItemStyle(theme)}
        >
          Magnet
        </DropdownMenuRadioItem>
        <DropdownMenuRadioItem
          className={chartMenuItemClassName}
          value="free"
          style={menuItemStyle(theme)}
        >
          Free
        </DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
      <DropdownMenuSeparator className={chartMenuSeparatorClassName} />
      <DropdownMenuLabel
        className={chartMenuLabelClassName}
        style={menuLabelStyle(theme)}
      >
        Scale
      </DropdownMenuLabel>
      <DropdownMenuRadioGroup
        value={controls.scaleMode}
        onValueChange={(next) =>
          controls.setScaleMode(next as ChartSurfaceControls["scaleMode"])
        }
      >
        <DropdownMenuRadioItem
          className={chartMenuItemClassName}
          value="linear"
          style={menuItemStyle(theme)}
        >
          Linear
        </DropdownMenuRadioItem>
        <DropdownMenuRadioItem
          className={chartMenuItemClassName}
          value="log"
          style={menuItemStyle(theme)}
        >
          Log
        </DropdownMenuRadioItem>
        <DropdownMenuRadioItem
          className={chartMenuItemClassName}
          value="percentage"
          style={menuItemStyle(theme)}
        >
          Percent
        </DropdownMenuRadioItem>
        <DropdownMenuRadioItem
          className={chartMenuItemClassName}
          value="indexed"
          style={menuItemStyle(theme)}
        >
          Indexed
        </DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
      <DropdownMenuSeparator className={chartMenuSeparatorClassName} />
      <DropdownMenuCheckboxItem
        className={chartMenuItemClassName}
        checked={controls.autoScale}
        onCheckedChange={() => controls.setAutoScale((value) => !value)}
        style={menuItemStyle(theme)}
      >
        Auto scale
      </DropdownMenuCheckboxItem>
      <DropdownMenuCheckboxItem
        className={chartMenuItemClassName}
        checked={controls.invertScale}
        onCheckedChange={() => controls.setInvertScale((value) => !value)}
        style={menuItemStyle(theme)}
      >
        Invert scale
      </DropdownMenuCheckboxItem>
      <DropdownMenuSeparator className={chartMenuSeparatorClassName} />
      <DropdownMenuItem
        className={chartMenuItemClassName}
        onClick={controls.fit}
        style={menuItemStyle(theme)}
      >
        Fit content
      </DropdownMenuItem>
      <DropdownMenuItem
        className={chartMenuItemClassName}
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
  statusTone,
  timeframe,
  timeframeOptions,
  favoriteTimeframes,
  onChangeTimeframe,
  onToggleFavoriteTimeframe,
  onPrewarmTimeframe,
  onOpenSearch,
  searchOpen,
  onSearchOpenChange,
  searchContent,
  dense = false,
  meta = null,
  showInlineLegend = true,
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
  identitySlot = null,
}: ResearchChartWidgetHeaderProps) => {
  const { preferences: userPreferences } = useUserPreferences();
  const palette = getPanelPalette(theme);
  const headerHeight = dense ? 28 : 40;
  const timeframes = commonTimeframes(timeframeOptions);
  const selectTimeframe = (nextTimeframe: string) => {
    if (!nextTimeframe || nextTimeframe === timeframe) {
      return;
    }
    onChangeTimeframe?.(nextTimeframe);
  };
  const favoriteTimeframeLookup = useMemo(
    () => new Set(favoriteTimeframes || []),
    [favoriteTimeframes],
  );
  const resolvedChartType = resolveChartType(controls.baseSeriesType);
  const hasAnchoredSearch =
    typeof onSearchOpenChange === "function" && searchContent != null;
  const canSearch = typeof onOpenSearch === "function" || hasAnchoredSearch;
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
        : activeBar?.source === "polygon-delayed-websocket"
          ? "DELAYED WS"
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
    statusTone === "good"
      ? theme.green
      : statusTone === "warn"
        ? theme.amber
        : statusTone === "bad"
          ? theme.red
          : statusTone === "neutral" || statusTone === "info"
            ? (theme.accent ?? theme.text)
            : statusLabel && /live|open|stream|massive|ibkr/i.test(statusLabel)
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
    <div
      data-chart-control-root
      style={{ position: "relative", pointerEvents: "none" }}
    >
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
        {hasAnchoredSearch ? (
          <Popover open={Boolean(searchOpen)} onOpenChange={onSearchOpenChange}>
            <AppTooltip content={`Search ${symbol}`}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  data-testid="chart-symbol-search-button"
                  style={{
                    ...barButtonStyle({ theme, palette, dense }),
                    color: theme.text,
                    cursor: "pointer",
                  }}
                >
                  {identitySlot ?? <Search style={iconStyle(dense)} />}
                  <span style={{ fontWeight: 400 }}>{symbol}</span>
                  <ChevronDown style={iconStyle(dense)} />
                </button>
              </PopoverTrigger>
            </AppTooltip>
            <PopoverContent
              align="start"
              sideOffset={6}
              style={{
                width: dense ? 380 : 430,
                maxWidth: "calc(100vw - 24px)",
                padding: 0,
                borderRadius: 0,
                border: "none",
                background: "transparent",
                boxShadow: "none",
              }}
            >
              {searchContent}
            </PopoverContent>
          </Popover>
        ) : (
          <AppTooltip content={canSearch ? `Search ${symbol}` : symbol}><button
            type="button"
            data-testid={canSearch ? "chart-symbol-search-button" : undefined}
            onClick={canSearch ? onOpenSearch : undefined}
            style={{
              ...barButtonStyle({ theme, palette, dense }),
              color: theme.text,
              cursor: canSearch ? "pointer" : "default",
            }}
          >
            {identitySlot ?? (canSearch ? <Search style={iconStyle(dense)} /> : null)}
            <span style={{ fontWeight: 400 }}>{symbol}</span>
            {canSearch ? <ChevronDown style={iconStyle(dense)} /> : null}
          </button></AppTooltip>
        )}

        <div style={dividerStyle(theme, dense)} />

        <DropdownMenu>
          <AppTooltip content="More timeframes">
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                data-testid="chart-timeframe-menu-trigger"
                data-chart-timeframe={timeframe}
                style={barButtonStyle({ theme, palette, dense })}
              >
                <span>{timeframe}</span>
                <ChevronDown style={iconStyle(dense)} />
              </button>
            </DropdownMenuTrigger>
          </AppTooltip>
          <DropdownMenuContent
            align="start"
            className={chartMenuContentClassName}
            sideOffset={6}
            style={menuContentStyle(theme, palette, 160)}
          >
            <DropdownMenuLabel
              className={chartMenuLabelClassName}
              style={menuLabelStyle(theme)}
            >
              Timeframe
            </DropdownMenuLabel>
            {timeframes.map((option) => {
              const active = option.value === timeframe;
              const favorite = favoriteTimeframeLookup.has(option.value);
              return (
                <DropdownMenuItem
                  className={chartMenuItemClassName}
                  key={option.value}
                  data-testid={`chart-timeframe-option-${option.value}`}
                  data-active={active ? "true" : "false"}
                  onFocus={() => onPrewarmTimeframe?.(option.value)}
                  onMouseEnter={() => onPrewarmTimeframe?.(option.value)}
                  onClick={() => selectTimeframe(option.value)}
                  onSelect={() => selectTimeframe(option.value)}
                  style={{
                    ...menuItemStyle(theme),
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 8,
                    background: active ? withAlpha(theme.accent || theme.text, "20") : undefined,
                    fontWeight: 400,
                    cursor: "pointer",
                  }}
                >
                  <button
                    type="button"
                    data-testid={`chart-timeframe-favorite-${option.value}`}
                    aria-label={
                      favorite
                        ? `Remove ${option.label} favorite`
                        : `Favorite ${option.label}`
                    }
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      onToggleFavoriteTimeframe?.(option.value);
                    }}
                    style={{
                      width: 18,
                      height: 18,
                      border: "none",
                      background: "transparent",
                      color: favorite ? theme.amber : theme.textMuted,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: "pointer",
                      padding: 0,
                      flexShrink: 0,
                    }}
                  >
                    <Star
                      style={{
                        width: 13,
                        height: 13,
                        fill: favorite ? "currentColor" : "none",
                      }}
                    />
                  </button>
                  <span style={{ flex: 1 }}>{option.label}</span>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <AppTooltip content="Chart type">
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Chart type"
                style={barButtonStyle({ theme, palette, dense })}
              >
                <resolvedChartType.Icon style={iconStyle(dense)} />
                {dense ? null : <span>{resolvedChartType.label}</span>}
                <ChevronDown style={iconStyle(dense)} />
              </button>
            </DropdownMenuTrigger>
          </AppTooltip>
          <DropdownMenuContent
            align="start"
            className={chartMenuContentClassName}
            sideOffset={6}
            style={menuContentStyle(theme, palette, 210)}
          >
            <DropdownMenuLabel
              className={chartMenuLabelClassName}
              style={menuLabelStyle(theme)}
            >
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
                  className={chartMenuItemClassName}
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
          <AppTooltip content="Indicators">
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                style={barButtonStyle({ theme, palette, dense })}
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
          </AppTooltip>
          <DropdownMenuContent
            align="start"
            className={chartMenuContentClassName}
            sideOffset={6}
            style={menuContentStyle(theme, palette, 220)}
          >
            <DropdownMenuLabel
              className={chartMenuLabelClassName}
              style={menuLabelStyle(theme)}
            >
              Indicators
            </DropdownMenuLabel>
            {studies.length ? (
              studies.map((study) => (
                <DropdownMenuCheckboxItem
                  className={chartMenuItemClassName}
                  key={study.id}
                  checked={selectedStudies.includes(study.id)}
                  onCheckedChange={() => onToggleStudy?.(study.id)}
                  style={menuItemStyle(theme)}
                >
                  {study.label}
                </DropdownMenuCheckboxItem>
              ))
            ) : (
              <DropdownMenuItem
                className={chartMenuItemClassName}
                disabled
                style={menuItemStyle(theme)}
              >
                No indicators available
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        <div style={{ flex: 1 }} />

        {showUndoRedo ? (
          <>
            <AppTooltip content="Undo"><button
              type="button"
              aria-label="Undo"
              onClick={onUndo}
              disabled={!canUndo}
              style={barButtonStyle({
                theme,
                palette,
                dense,
                disabled: !canUndo,
              })}
            >
              <Undo2 style={iconStyle(dense)} />
            </button></AppTooltip>
            <AppTooltip content="Redo"><button
              type="button"
              aria-label="Redo"
              onClick={onRedo}
              disabled={!canRedo}
              style={barButtonStyle({
                theme,
                palette,
                dense,
                disabled: !canRedo,
              })}
            >
              <Redo2 style={iconStyle(dense)} />
            </button></AppTooltip>
          </>
        ) : null}

        {showTrailingActions ? (
          <div style={dividerStyle(theme, dense)} />
        ) : null}

        {typeof onFocusChart === "function" ? (
          <AppTooltip content={focusChartTitle}><button
            type="button"
            aria-label={focusChartTitle}
            onClick={onFocusChart}
            style={barButtonStyle({
              theme,
              palette,
              dense,
              active: focusChartActive,
            })}
          >
            <Crosshair style={iconStyle(dense)} />
            {dense ? null : <span>Focus</span>}
          </button></AppTooltip>
        ) : null}

        {typeof onEnterSoloMode === "function" ? (
          <AppTooltip content={soloChartTitle}><button
            type="button"
            aria-label={soloChartTitle}
            onClick={onEnterSoloMode}
            style={barButtonStyle({ theme, palette, dense })}
          >
            <Maximize2 style={iconStyle(dense)} />
            {dense ? null : <span>Solo</span>}
          </button></AppTooltip>
        ) : null}

        {showSnapshotButton ? (
          <AppTooltip content="Screenshot"><button
            type="button"
            aria-label="Screenshot"
            onClick={controls.takeSnapshot}
            style={barButtonStyle({ theme, palette, dense })}
          >
            <Camera style={iconStyle(dense)} />
          </button></AppTooltip>
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
          <AppTooltip content={
              controls.isFullscreen ? "Exit fullscreen" : "Enter fullscreen"
            }><button
            type="button"
            aria-label={controls.isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            onClick={controls.toggleFullscreen}
            style={barButtonStyle({ theme, palette, dense })}
          >
            {controls.isFullscreen ? (
              <Minimize2 style={iconStyle(dense)} />
            ) : (
              <Maximize2 style={iconStyle(dense)} />
            )}
          </button></AppTooltip>
        ) : null}

        {rightSlot}
      </div>

      {showInlineLegend ? (
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
            <span style={{ fontWeight: 400 }}>{symbol}</span>
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
            <span style={{ color: changeColor, fontWeight: 400 }}>
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
                formatTimestamp(resolvedMeta.timestamp, userPreferences),
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
      ) : null}
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
  const scaleModes = [
    {
      key: "linear",
      label: dense ? "Ln" : "Lin",
      title: "Linear scale",
      onClick: () => controls.setScaleMode("linear"),
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
  ];
  const scaleButtonHeight = dense ? 14 : 18;
  const scaleButtonStyle = ({
    active = false,
    wide = false,
  }: {
    active?: boolean;
    wide?: boolean;
  }): CSSProperties => ({
    width: wide ? (dense ? 22 : 26) : dense ? 16 : 20,
    height: scaleButtonHeight,
    background: active ? theme.accent || theme.text : "transparent",
    color: active ? "#fff" : theme.textDim || theme.textMuted,
    border: "none",
    borderRadius: 0,
    cursor: "pointer",
    fontFamily: theme.mono,
    fontSize: dense ? TYPE_CSS_VAR.label : TYPE_CSS_VAR.body,
    fontWeight: 400,
    padding: 0,
  });

  return (
    <div
      data-chart-control-root
      style={{ position: "relative", pointerEvents: "none" }}
    >
      <div
        style={{
          height: footerHeight,
          background: palette.panel,
          borderTop: `1px solid ${theme.border}`,
          display: "flex",
          alignItems: "center",
          padding: dense ? "0 8px" : "0 10px",
          gap: dense ? 6 : 10,
          fontFamily: theme.mono,
          fontSize: dense ? TYPE_CSS_VAR.label : TYPE_CSS_VAR.body,
          color: theme.textMuted,
          pointerEvents: "auto",
          whiteSpace: "nowrap",
          overflow: "hidden",
        }}
      >
        {activeLabels.length ? (
          <AppTooltip content={activeLabels.join(" · ")}><span
            style={{
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {activeLabels.join(" · ")}
          </span></AppTooltip>
        ) : (
          <span style={{ flexShrink: 0 }}>{dense ? "Pan" : "Pan drag"}</span>
        )}
        {dense ? null : <span style={{ flexShrink: 0 }}>Zoom scroll</span>}
        <div style={{ flex: 1 }} />
        {statusText ? (
          <AppTooltip content={statusText}><span
            style={{
              minWidth: 0,
              maxWidth: dense ? 90 : 180,
              overflow: "hidden",
              textOverflow: "ellipsis",
              flexShrink: 1,
            }}
          >
            {statusText}
          </span></AppTooltip>
        ) : null}
        <div
          data-chart-footer-scale-controls
          style={{
            height: dense ? 16 : 20,
            display: "flex",
            alignItems: "center",
            gap: 1,
            background: palette.panel,
            border: `1px solid ${theme.border}`,
            borderRadius: 0,
            boxSizing: "border-box",
            padding: 0,
            fontFamily: theme.mono,
            fontSize: dense ? TYPE_CSS_VAR.label : TYPE_CSS_VAR.body,
            pointerEvents: "auto",
            flexShrink: 0,
          }}
        >
          {scaleModes.map((mode) => {
            const active =
              mode.key === "linear"
                ? controls.scaleMode === "linear"
                : controls.scaleMode === mode.key;
            return (
              <AppTooltip key={mode.key} content={mode.title}><button
                key={mode.key}
                type="button"
                onClick={mode.onClick}
                style={scaleButtonStyle({
                  active,
                  wide: mode.key === "indexed" || mode.key === "linear",
                })}
              >
                {mode.label}
              </button></AppTooltip>
            );
          })}

          <div
            style={{
              width: 1,
              alignSelf: "stretch",
              background: theme.border,
              margin: "0 1px",
            }}
          />

          <AppTooltip content="Auto-scale main price pane"><button
            type="button"
            onClick={() => controls.setAutoScale((value) => !value)}
            style={scaleButtonStyle({ active: controls.autoScale })}
          >
            A
          </button></AppTooltip>

          <AppTooltip content="Invert scale"><button
            type="button"
            onClick={() => controls.setInvertScale((value) => !value)}
            style={{
              ...scaleButtonStyle({ active: controls.invertScale }),
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <ArrowUpDown style={iconStyle(true)} />
          </button></AppTooltip>
        </div>
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
      data-chart-control-root
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
            <AppTooltip key={button.key} content={button.title}><button
              key={button.key}
              type="button"
              aria-pressed={button.active}
              onClick={button.onClick}
              style={railButtonStyle({
                theme,
                palette,
                active: button.active,
                dense,
              })}
            >
              {button.icon}
            </button></AppTooltip>
          ))}
        </div>
      ))}

      <div style={{ flex: 1, minHeight: 8 }} />

      <AppTooltip content={
          drawingCount
            ? `Remove all drawings (${drawingCount})`
            : "No drawings to remove"
        }><button
        type="button"
        onClick={onClearDrawings}
        disabled={!drawingCount}
        style={railButtonStyle({
          theme,
          palette,
          dense,
          danger: true,
          disabled: !drawingCount,
        })}
      >
        <Trash2 style={iconStyle(dense)} />
      </button></AppTooltip>
    </div>
  );
};
