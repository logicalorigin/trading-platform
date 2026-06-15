// Shared chart-widget types, style helpers, and the symbol-search trigger.
// Extracted verbatim from ResearchChartFrame.tsx.
import { memo, type CSSProperties, type ReactNode } from "react";
// @ts-expect-error JSX module imported into TypeScript context
import { FONT_WEIGHTS, RADII, cssColorAlpha } from "../../lib/uiTokens.jsx";
import type { ChartDisplayType, ChartSurfaceControls } from "./ResearchChartSurface";
import type { StudySpec } from "./types";
import { Activity, AreaChart, BarChart3, CandlestickChart, ChevronDown, Search } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatPreferenceDateTime, type UserPreferences } from "../preferences/userPreferenceModel";
import { FONT_CSS_VAR, TYPE_CSS_VAR } from "../../lib/typography";
import { AppTooltip } from "@/components/ui/tooltip";
import type { ResearchChartFrameDensity } from "./chartFrameDensity";

export type WidgetTheme = {
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

export type ResearchChartWidgetHeaderProps = {
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
  density?: ResearchChartFrameDensity;
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
  rightSlot?:
    | ReactNode
    | ((state: {
        density: ResearchChartFrameDensity;
        dense: boolean;
        iconOnly: boolean;
      }) => ReactNode);
  identitySlot?: ReactNode;
  contextSlot?: ReactNode;
};

export type ResearchChartWidgetFooterProps = {
  theme: WidgetTheme;
  controls: ChartSurfaceControls;
  studies?: StudyOption[];
  selectedStudies?: string[];
  studySpecs?: StudySpec[];
  onToggleStudy?: (studyId: string) => void;
  dense?: boolean;
  density?: ResearchChartFrameDensity;
  statusText?: string | null;
};

export type RenderedStudyLegendItem = {
  id: string;
  label: string;
  colors: string[];
};

export type ResearchChartWidgetSidebarProps = {
  theme: WidgetTheme;
  controls: ChartSurfaceControls;
  drawMode?: DrawMode | null;
  drawingCount?: number;
  onToggleDrawMode?: (next: DrawMode | null) => void;
  onClearDrawings?: () => void;
  dense?: boolean;
  density?: ResearchChartFrameDensity;
};

export type PanelPalette = {
  panel: string;
  panel2: string;
  panel3: string;
  hover: string;
  chipBg: string;
  chipBorder: string;
  shadow: string;
};

export const withAlpha = (color: string, alpha: string): string =>
  cssColorAlpha(color, alpha);

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

export const getPanelPalette = (theme: WidgetTheme): PanelPalette => {
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

export const formatPrice = (value: number | null | undefined): string => {
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

export const formatPercent = (value: number | null | undefined): string => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "-";
  }
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
};

export const formatVolume = (value: number | null | undefined): string => {
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

export const formatTimestamp = (
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

export const specBelongsToStudy = (specKey: string, studyId: string): boolean =>
  specKey === studyId || specKey.startsWith(`${studyId}-`);

export const resolveStudySpecColor = (spec: StudySpec): string | null => {
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

export const commonTimeframes = (options: TimeframeOption[]): TimeframeOption[] =>
  dedupeTimeframes(options);

export const iconStyle = (dense = false): CSSProperties => ({
  width: dense ? 10 : 13,
  height: dense ? 10 : 13,
  strokeWidth: 2,
  flexShrink: 0,
});

export const dividerStyle = (theme: WidgetTheme, dense = false): CSSProperties => ({
  width: 1,
  height: dense ? 14 : 20,
  background: theme.border,
  margin: dense ? "0 2px" : "0 6px",
  flexShrink: 0,
});

export const barButtonStyle = ({
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
  borderRadius: RADII.none,
  background: active ? palette.hover : "transparent",
  color: disabled
    ? withAlpha(theme.textMuted, "75")
    : active
      ? theme.text
      : theme.textDim || theme.textMuted,
  cursor: disabled ? "default" : "pointer",
  fontFamily: theme.mono,
  fontSize: dense ? TYPE_CSS_VAR.label : TYPE_CSS_VAR.bodyStrong,
  fontWeight: FONT_WEIGHTS.regular,
  opacity: disabled ? 0.6 : 1,
  whiteSpace: "nowrap",
  flexShrink: 0,
});

type ChartSymbolSearchTriggerProps = {
  theme: WidgetTheme;
  palette: PanelPalette;
  symbol: string;
  canSearch: boolean;
  hasAnchoredSearch: boolean;
  searchOpen?: boolean;
  onOpenSearch?: () => void;
  onSearchOpenChange?: (open: boolean) => void;
  searchContent?: ReactNode;
  chromeDense: boolean;
  minimalChrome: boolean;
  iconOnlyChrome: boolean;
  identitySlot?: ReactNode;
};

export const ChartSymbolSearchTrigger = memo(function ChartSymbolSearchTrigger({
  theme,
  palette,
  symbol,
  canSearch,
  hasAnchoredSearch,
  searchOpen,
  onOpenSearch,
  onSearchOpenChange,
  searchContent,
  chromeDense,
  minimalChrome,
  iconOnlyChrome,
  identitySlot = null,
}: ChartSymbolSearchTriggerProps) {
  const triggerStyle = {
    ...barButtonStyle({ theme, palette, dense: chromeDense }),
    color: theme.text,
    cursor: canSearch ? "pointer" : "default",
    maxWidth: minimalChrome ? 116 : iconOnlyChrome ? 160 : 220,
    minWidth: 0,
  } satisfies CSSProperties;
  const triggerContent = (
    <>
      {identitySlot ??
        (canSearch ? <Search style={iconStyle(chromeDense)} /> : null)}
      <span
        style={{
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          fontWeight: FONT_WEIGHTS.regular,
        }}
      >
        {symbol}
      </span>
      {canSearch ? <ChevronDown style={iconStyle(chromeDense)} /> : null}
    </>
  );

  if (hasAnchoredSearch) {
    return (
      <Popover open={Boolean(searchOpen)} onOpenChange={onSearchOpenChange}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={`Search ${symbol}`}
            data-testid="chart-symbol-search-button"
            style={triggerStyle}
          >
            {triggerContent}
          </button>
        </PopoverTrigger>
        {searchContent != null ? (
          <PopoverContent
            align="start"
            sideOffset={6}
            style={{
              width: chromeDense ? 340 : 430,
              maxWidth: "calc(100vw - 24px)",
              padding: 0,
              borderRadius: RADII.none,
              border: "none",
              background: "transparent",
              boxShadow: "none",
            }}
          >
            {searchContent}
          </PopoverContent>
        ) : null}
      </Popover>
    );
  }

  return (
    <AppTooltip content={canSearch ? `Search ${symbol}` : symbol}>
      <button
        type="button"
        aria-label={canSearch ? `Search ${symbol}` : symbol}
        data-testid={canSearch ? "chart-symbol-search-button" : undefined}
        onClick={canSearch ? onOpenSearch : undefined}
        style={triggerStyle}
      >
        {triggerContent}
      </button>
    </AppTooltip>
  );
});

export const railButtonStyle = ({
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
    borderRadius: RADII.none,
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

export const legendChipStyle = ({
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
  borderRadius: RADII.none,
  background: palette.chipBg,
  border: `1px solid ${palette.chipBorder}`,
  boxShadow: palette.shadow,
  color: color || theme.textMuted,
  fontFamily: theme.mono,
  fontSize: dense ? TYPE_CSS_VAR.label : TYPE_CSS_VAR.bodyStrong,
  whiteSpace: "nowrap",
});

export const chartMenuContentClassName = "chart-widget-menu";
export const chartMenuItemClassName = "chart-widget-menu__item";
export const chartMenuLabelClassName = "chart-widget-menu__label";
export const chartMenuSeparatorClassName = "chart-widget-menu__separator";

export const menuContentStyle = (
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
    borderRadius: RADII.sm,
    border: `1px solid ${withAlpha(theme.border, "d9")}`,
    background: palette.panel,
    color: theme.text,
    boxShadow:
      "0 16px 32px rgba(0,0,0,0.36), 0 0 0 1px rgba(255,255,255,0.03)",
    fontFamily: theme.display || FONT_CSS_VAR.sans,
  } as CSSProperties);

export const menuItemStyle = (theme: WidgetTheme): CSSProperties => ({
  borderRadius: RADII.xs,
  color: theme.text,
  fontFamily: theme.display || FONT_CSS_VAR.sans,
  fontSize: TYPE_CSS_VAR.bodyStrong,
  fontWeight: FONT_WEIGHTS.regular,
});

export const menuLabelStyle = (theme: WidgetTheme): CSSProperties => ({
  color: theme.textMuted,
  fontFamily: theme.display || FONT_CSS_VAR.sans,
  fontSize: TYPE_CSS_VAR.body,
  fontWeight: FONT_WEIGHTS.regular,
  letterSpacing: 0,
  textTransform: "uppercase",
});

export const chartTypeOptions = [
  { value: "candles", label: "Candles", Icon: CandlestickChart },
  { value: "footprint", label: "Footprint", Icon: CandlestickChart },
  { value: "bars", label: "OHLC Bars", Icon: BarChart3 },
  { value: "line", label: "Line", Icon: Activity },
  { value: "area", label: "Area", Icon: AreaChart },
  { value: "baseline", label: "Baseline", Icon: Activity },
] as const;

export const resolveChartType = (value: ChartDisplayType) =>
  chartTypeOptions.find((option) => option.value === value) ||
  chartTypeOptions[0];
