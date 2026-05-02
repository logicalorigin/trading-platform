import { MISSING_VALUE } from "./uiTokens.jsx";
import { formatAppDate } from "./timeZone";

export const isFiniteNumber = (value) =>
  typeof value === "number" && Number.isFinite(value);

export const fmtM = (value) =>
  value >= 1e6
    ? `$${(value / 1e6).toFixed(1)}M`
    : `$${(value / 1e3).toFixed(0)}K`;

export const fmtCompactNumber = (value) => {
  if (value == null || Number.isNaN(value)) return MISSING_VALUE;
  if (Math.abs(value) >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (Math.abs(value) >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (Math.abs(value) >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return value.toFixed(0);
};

export const fmtQuoteVolume = (value) =>
  value == null || Number.isNaN(value) ? MISSING_VALUE : fmtCompactNumber(value);

export const formatPriceValue = (value, digits = 2) =>
  isFiniteNumber(value) ? value.toFixed(digits) : MISSING_VALUE;

export const formatQuotePrice = (value) =>
  isFiniteNumber(value)
    ? value < 10
      ? value.toFixed(3)
      : value.toFixed(2)
    : MISSING_VALUE;

export const formatSignedPercent = (value, digits = 2) =>
  isFiniteNumber(value)
    ? `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`
    : MISSING_VALUE;

export const getAtmStrikeFromPrice = (price, increment = 5) =>
  isFiniteNumber(price) ? Math.round(price / increment) * increment : null;

export const clampNumber = (value, min, max) =>
  Math.min(max, Math.max(min, value));

export const toDateValue = (value) => {
  if (!value) return null;
  if (value instanceof Date)
    return Number.isNaN(value.getTime()) ? null : value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const formatExpirationLabel = (value) => {
  if (typeof value === "string" && /^\d{2}\/\d{2}$/.test(value)) return value;

  const date = toDateValue(value);
  if (!date) return value || MISSING_VALUE;

  return `${String(date.getUTCMonth() + 1).padStart(2, "0")}/${String(date.getUTCDate()).padStart(2, "0")}`;
};

export const parseExpirationValue = (value) => {
  const parsed = toDateValue(value);
  if (parsed) return parsed;
  if (typeof value !== "string") return null;

  const match = value.match(/^(\d{2})\/(\d{2})$/);
  if (!match) return null;

  const now = new Date();
  const month = Number(match[1]);
  const day = Number(match[2]);
  let candidate = new Date(Date.UTC(now.getUTCFullYear(), month - 1, day));

  if (candidate.getTime() < now.getTime() - 7 * 24 * 60 * 60 * 1000) {
    candidate = new Date(Date.UTC(now.getUTCFullYear() + 1, month - 1, day));
  }

  return candidate;
};

export const formatIsoDate = (value) => {
  const date = toDateValue(value);
  if (!date) return null;

  const parts = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "America/New_York",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  return year && month && day ? `${year}-${month}-${day}` : null;
};

export const formatShortDate = (value) => {
  const date = toDateValue(value);
  if (!date) return MISSING_VALUE;

  return formatAppDate(date, {
    month: "short",
    day: "numeric",
  });
};

export const formatRelativeTimeShort = (value) => {
  const date = toDateValue(value);
  if (!date) return MISSING_VALUE;

  const deltaMs = Date.now() - date.getTime();
  if (deltaMs < 0) return formatShortDate(date);

  const deltaMinutes = Math.floor(deltaMs / 60_000);
  if (deltaMinutes < 1) return "now";
  if (deltaMinutes < 60) return `${deltaMinutes}m`;

  const deltaHours = Math.floor(deltaMinutes / 60);
  if (deltaHours < 24) return `${deltaHours}h`;

  const deltaDays = Math.floor(deltaHours / 24);
  if (deltaDays < 7) return `${deltaDays}d`;

  return formatShortDate(date);
};

export const formatEnumLabel = (value) =>
  String(value || MISSING_VALUE)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());

export const parseSymbolUniverseInput = (value) =>
  String(value || "")
    .split(",")
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean)
    .filter((symbol, index, values) => values.indexOf(symbol) === index);

export const formatCalendarMeta = (dateValue, timeValue) => {
  const dateLabel = formatShortDate(dateValue);
  if (!timeValue) return dateLabel;

  const normalized = String(timeValue).trim().toUpperCase();
  if (!normalized) return dateLabel;

  return `${dateLabel} · ${normalized}`;
};

export const mapNewsSentimentToScore = (sentiment) => {
  const normalized = String(sentiment || "")
    .trim()
    .toLowerCase();
  if (!normalized) return 0;
  if (normalized.includes("bull") || normalized.includes("positive")) return 1;
  if (normalized.includes("bear") || normalized.includes("negative")) return -1;
  return 0;
};

export const daysToExpiration = (value) => {
  const date = parseExpirationValue(value);
  if (!date) return 0;

  const now = new Date();
  const start = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  const end = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  );

  return Math.max(0, Math.round((end - start) / (24 * 60 * 60 * 1000)));
};
