import type { ChartBar } from "./types";

export const countChartValueDecimals = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 0;
  }

  const text = value.toString().toLowerCase();
  if (text.includes("e-")) {
    const [, exponentText = "0"] = text.split("e-");
    return Number.parseInt(exponentText, 10) || 0;
  }

  const [, decimals = ""] = text.split(".");
  return decimals.replace(/0+$/, "").length;
};

export const resolveChartPricePrecision = ({
  price,
  range,
  sourcePrecision = 0,
  compact = false,
}: {
  price?: number | null;
  range?: number | null;
  sourcePrecision?: number;
  compact?: boolean;
} = {}): number => {
  const absPrice = Math.abs(Number(price) || 0);
  const absRange = Math.abs(Number(range) || 0);
  let precision = 2;

  if (absPrice < 1) {
    precision = 5;
  } else if (absPrice < 10) {
    precision = absRange > 0 && absRange < 0.15 ? 4 : 3;
  } else if (absPrice < 100) {
    precision = absRange > 0 && absRange < 0.5 ? 3 : 2;
  } else if (absRange > 0 && absRange < 1) {
    precision = 3;
  }

  const maxPrecision = compact ? 3 : 5;
  return Math.min(maxPrecision, Math.max(2, precision, sourcePrecision));
};

export const resolveChartPricePrecisionForBars = (
  bars: Pick<ChartBar, "o" | "h" | "l" | "c" | "vwap" | "sessionVwap">[] = [],
  { compact = false } = {},
): number => {
  const values = bars.flatMap((bar) => [
    bar.o,
    bar.h,
    bar.l,
    bar.c,
    bar.vwap ?? Number.NaN,
    bar.sessionVwap ?? Number.NaN,
  ]);
  const finiteValues = values.filter((value) => Number.isFinite(value));
  const sourcePrecision = finiteValues.reduce(
    (result, value) => Math.max(result, countChartValueDecimals(value)),
    0,
  );
  const low = finiteValues.length ? Math.min(...finiteValues) : null;
  const high = finiteValues.length ? Math.max(...finiteValues) : null;
  const latest = finiteValues.length ? finiteValues[finiteValues.length - 1] : null;
  const range = high != null && low != null ? high - low : null;
  return resolveChartPricePrecision({
    price: latest,
    range,
    sourcePrecision,
    compact,
  });
};

export const formatCompactChartValue = (
  value: number | null | undefined,
  {
    missing = "-",
    maxFractionDigits,
  }: {
    missing?: string;
    maxFractionDigits?: number;
  } = {},
): string => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return missing;
  }

  const absValue = Math.abs(value);
  const format = (divisor: number, suffix: string, digits: number) =>
    `${(value / divisor).toFixed(digits).replace(/\.0+$|(\.\d*[1-9])0+$/, "$1")}${suffix}`;

  if (absValue >= 1_000_000_000) {
    return format(1_000_000_000, "B", maxFractionDigits ?? 2);
  }
  if (absValue >= 1_000_000) {
    return format(1_000_000, "M", maxFractionDigits ?? 2);
  }
  if (absValue >= 10_000) {
    return format(1_000, "K", maxFractionDigits ?? 1);
  }
  return value.toLocaleString("en-US", {
    maximumFractionDigits: maxFractionDigits ?? 2,
  });
};

export const formatChartPrice = (
  value: number | null | undefined,
  {
    precision,
    compact = false,
    missing = "-",
  }: {
    precision?: number;
    compact?: boolean;
    missing?: string;
  } = {},
): string => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return missing;
  }

  if (compact && Math.abs(value) >= 10_000) {
    return formatCompactChartValue(value, { missing, maxFractionDigits: 2 });
  }

  const resolvedPrecision =
    typeof precision === "number" && Number.isFinite(precision)
      ? Math.max(0, Math.min(8, Math.round(precision)))
      : resolveChartPricePrecision({ price: value, compact });
  return value.toFixed(resolvedPrecision);
};

export const formatChartSignedPrice = (
  value: number | null | undefined,
  options: Parameters<typeof formatChartPrice>[1] = {},
): string => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return options?.missing ?? "-";
  }
  return `${value >= 0 ? "+" : ""}${formatChartPrice(value, options)}`;
};

export const resolveChartOverlayLabelBudget = ({
  compact = false,
  plotWidth = 0,
  plotHeight = 0,
  overlayCount = 0,
}: {
  compact?: boolean;
  plotWidth?: number;
  plotHeight?: number;
  overlayCount?: number;
} = {}): number => {
  if (overlayCount <= 0) {
    return 0;
  }
  if (!compact && plotWidth >= 720 && plotHeight >= 360) {
    return Math.min(overlayCount, 10);
  }
  if (plotWidth >= 520 && plotHeight >= 260) {
    return Math.min(overlayCount, compact ? 5 : 7);
  }
  if (plotWidth >= 360 && plotHeight >= 190) {
    return Math.min(overlayCount, compact ? 3 : 5);
  }
  return Math.min(overlayCount, compact ? 1 : 2);
};
