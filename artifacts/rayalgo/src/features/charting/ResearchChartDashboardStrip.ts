export type IndicatorDashboardOverlaySize =
  | "compact"
  | "expanded"
  | "tiny"
  | "small"
  | "normal"
  | "large";

export type IndicatorDashboardStripTier = "micro" | "compact" | "full";

export type IndicatorDashboardStripSegment = {
  key: string;
  kind: "title" | "subtitle" | "trend" | "row" | "mtf";
  label?: string;
  value: string;
  color?: string;
  detail?: string;
  title?: string;
};

export const resolveDashboardStripTier = (
  plotWidth: number,
  compact: boolean,
): IndicatorDashboardStripTier => {
  if (Number.isFinite(plotWidth) && plotWidth > 0) {
    if (plotWidth <= 360) {
      return "micro";
    }
    if (plotWidth <= 520) {
      return "compact";
    }
    return "full";
  }

  return compact ? "micro" : "full";
};

export function resolveDashboardDensity(
  size: IndicatorDashboardOverlaySize,
  compact: boolean,
  tier: IndicatorDashboardStripTier,
) {
  if (tier === "micro") {
    return {
      maxWidth: "calc(100% - 16px)",
      height: 20,
      padding: "2px 5px",
      segmentPadding: "0",
      titleSize: 8,
      subtitleSize: 8,
      bodySize: 8,
      detailSize: 8,
      gap: 4,
      segmentMaxWidth: 52,
    };
  }

  if (tier === "compact") {
    return {
      maxWidth: "calc(100% - 18px)",
      height: 22,
      padding: "3px 6px",
      segmentPadding: "0 1px",
      titleSize: 8,
      subtitleSize: 8,
      bodySize: 8,
      detailSize: 8,
      gap: 5,
      segmentMaxWidth: 96,
    };
  }

  if (compact) {
    return {
      maxWidth: "calc(100% - 16px)",
      height: 22,
      padding: "3px 6px",
      segmentPadding: "0 1px",
      titleSize: 8,
      subtitleSize: 7,
      bodySize: 8,
      detailSize: 7,
      gap: 5,
      segmentMaxWidth: 104,
    };
  }

  if (size === "expanded" || size === "large" || size === "normal") {
    return {
      maxWidth: "min(860px, calc(100% - 24px))",
      height: 26,
      padding: "4px 7px",
      segmentPadding: "0 2px",
      titleSize: 10,
      subtitleSize: 9,
      bodySize: 10,
      detailSize: 9,
      gap: 7,
      segmentMaxWidth: 160,
    };
  }

  return {
    maxWidth: "min(760px, calc(100% - 24px))",
    height: 24,
    padding: "3px 6px",
    segmentPadding: "0 2px",
    titleSize: 8,
    subtitleSize: 7,
    bodySize: 8,
    detailSize: 7,
    gap: 6,
    segmentMaxWidth: 132,
  };
}

export const normalizeDashboardStripText = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const formatDashboardTitle = (value: string): string => {
  const normalized = value.replace(/\s+dashboard$/i, "").trim();
  if (/^rayalgo$/i.test(normalized)) {
    return "RayAlgo";
  }
  if (/^rayreplica$/i.test(normalized)) {
    return "RayReplica";
  }
  return normalized || value;
};

const formatDashboardTimeframeLabel = (value: string): string => {
  const normalized = value.replace(/\s+trend$/i, "").trim();
  const upper = normalized.toUpperCase();
  const minuteMatch = upper.match(/^(\d+)M$/);
  if (minuteMatch) {
    return `${minuteMatch[1]}m`;
  }
  const hourMatch = upper.match(/^H(\d+)$/);
  if (hourMatch) {
    return `${hourMatch[1]}h`;
  }
  const trailingHourMatch = upper.match(/^(\d+)H$/);
  if (trailingHourMatch) {
    return `${trailingHourMatch[1]}h`;
  }
  const dayMatch = upper.match(/^D(\d*)$/);
  if (dayMatch) {
    return `${dayMatch[1] || "1"}d`;
  }
  const trailingDayMatch = upper.match(/^(\d+)D$/);
  if (trailingDayMatch) {
    return `${trailingDayMatch[1]}d`;
  }
  const weekMatch = upper.match(/^W(\d*)$/);
  if (weekMatch) {
    return `${weekMatch[1] || "1"}w`;
  }
  const trailingWeekMatch = upper.match(/^(\d+)W$/);
  if (trailingWeekMatch) {
    return `${trailingWeekMatch[1]}w`;
  }
  return normalized || value;
};

const compactTrendValue = (value: string): string => {
  const normalized = value.trim().toUpperCase();
  if (normalized === "BULLISH" || normalized === "BULL") {
    return "BULL";
  }
  if (normalized === "BEARISH" || normalized === "BEAR") {
    return "BEAR";
  }
  return normalized || value;
};

const compactDirectionValue = (value: string): string => {
  const normalized = compactTrendValue(value);
  if (normalized === "BULL") {
    return "B";
  }
  if (normalized === "BEAR") {
    return "S";
  }
  return normalized.slice(0, 1) || value.slice(0, 1).toUpperCase();
};

const compactStrengthValue = (value: string): string => {
  const normalized = value.trim().toUpperCase();
  if (normalized === "STRONG") {
    return "STR";
  }
  if (normalized === "WEAK") {
    return "WEAK";
  }
  return normalized || value;
};

const compactTrendAgeValue = (value: string): string => {
  const match = value.trim().match(/^([a-z]+)\s*\((\d+)\)/i);
  if (!match) {
    return value.trim().toUpperCase();
  }

  return `${match[1].charAt(0).toUpperCase()}${match[2]}`;
};

const compactVolatilityValue = (value: string): string => {
  const match = value.trim().match(/^([^/]+)\s*\/\s*10$/);
  if (!match) {
    return value.trim().toUpperCase();
  }

  return `V${match[1].trim() || "--"}`;
};

const compactSessionValue = (value: string): string => {
  const normalized = value.trim().toLowerCase();
  const upper = value.trim().toUpperCase();
  if (upper === "PRE" || upper === "RTH" || upper === "AFT" || upper === "CLSD") {
    return upper;
  }
  if (normalized === "new york") {
    return "NY";
  }
  if (normalized === "london") {
    return "LDN";
  }
  if (normalized === "tokyo") {
    return "TKY";
  }
  if (normalized === "sydney") {
    return "SYD";
  }
  if (normalized === "closed") {
    return "CLSD";
  }

  const initials = value
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
  return initials || value.trim().slice(0, 4).toUpperCase();
};

const formatDashboardRowForTier = (
  row: { label: string; value: string; color?: string; detail?: string },
  tier: IndicatorDashboardStripTier,
) => {
  const label = normalizeDashboardStripText(row.label);
  const value = normalizeDashboardStripText(row.value);
  const detail = normalizeDashboardStripText(row.detail);
  const upperLabel = label.toUpperCase();

  if (upperLabel === "STRENGTH") {
    return {
      label: "",
      value:
        tier === "full"
          ? value.trim().toUpperCase()
          : compactStrengthValue(value),
      detail: "",
    };
  }

  if (upperLabel === "TREND AGE") {
    return {
      label: "",
      value: compactTrendAgeValue(value),
      detail: "",
    };
  }

  if (upperLabel === "VOLATILITY") {
    return {
      label: "",
      value: compactVolatilityValue(value),
      detail: "",
    };
  }

  if (upperLabel === "SESSION") {
    return {
      label: "",
      value: compactSessionValue(value),
      detail: "",
    };
  }

  return {
    label: tier === "micro" ? "" : label,
    value,
    detail: tier === "full" ? detail : "",
  };
};

export const buildIndicatorDashboardStripSegments = (dashboard: {
  id: string;
  title: string;
  subtitle?: string;
  trendLabel: string;
  trendValue: string;
  trendColor: string;
  rows: Array<{ label: string; value: string; color?: string; detail?: string }>;
  mtf: Array<{ label: string; value: string; color: string; detail?: string }>;
}, tier: IndicatorDashboardStripTier = "full"): IndicatorDashboardStripSegment[] => {
  const segments: IndicatorDashboardStripSegment[] = [];
  const title = normalizeDashboardStripText(dashboard.title);
  const trendLabel = normalizeDashboardStripText(dashboard.trendLabel);
  const trendValue = normalizeDashboardStripText(dashboard.trendValue);
  const shortTrendValue = compactTrendValue(trendValue);

  if (title) {
    segments.push({
      key: `${dashboard.id}-title`,
      kind: "title",
      value: tier === "full" ? formatDashboardTitle(title) : "RA",
      title,
    });
  }

  if (trendLabel || trendValue) {
    const formattedTrendLabel = formatDashboardTimeframeLabel(trendLabel);
    segments.push({
      key: `${dashboard.id}-trend`,
      kind: "trend",
      label: formattedTrendLabel,
      value: shortTrendValue,
      color: dashboard.trendColor,
      title: [trendLabel, trendValue].filter(Boolean).join(" "),
    });
  }

  dashboard.rows.forEach((row, index) => {
    const rawLabel = normalizeDashboardStripText(row.label);
    if (tier === "micro" && rawLabel.toUpperCase() !== "SESSION") {
      return;
    }
    const formatted = formatDashboardRowForTier(row, tier);
    const label = formatted.label;
    const value = formatted.value;
    const detail = formatted.detail;
    const fullTitle = [
      normalizeDashboardStripText(row.label),
      normalizeDashboardStripText(row.value),
      normalizeDashboardStripText(row.detail),
    ]
      .filter(Boolean)
      .join(" ");
    if (!label && !value && !detail) {
      return;
    }
    segments.push({
      key: `${dashboard.id}-row-${index}-${label || value || "item"}`,
      kind: "row",
      label,
      value,
      color: row.color,
      detail,
      title: fullTitle,
    });
  });

  dashboard.mtf.forEach((item, index) => {
    const label = formatDashboardTimeframeLabel(
      normalizeDashboardStripText(item.label),
    );
    const value = normalizeDashboardStripText(item.value);
    const detail = normalizeDashboardStripText(item.detail);
    const formattedValue = compactDirectionValue(value);
    const formattedLabel = label;
    if (!formattedLabel && !formattedValue && !detail) {
      return;
    }
    segments.push({
      key: `${dashboard.id}-mtf-${index}-${label || value || "item"}`,
      kind: "mtf",
      label: formattedLabel,
      value: formattedValue,
      color: item.color,
      detail: tier === "full" ? detail : "",
      title: [label, value, detail].filter(Boolean).join(" "),
    });
  });

  return segments;
};

export const resolveDashboardStripAnchorStyle = (
  compact: boolean,
  bottomOffset = 0,
  leftOffset = 0,
) => ({
  left: leftOffset + (compact ? 4 : 8),
  right: compact ? 4 : 8,
  bottom: bottomOffset + (compact ? 2 : 3),
});
