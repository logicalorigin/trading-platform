const DAY_MS = 24 * 60 * 60 * 1000;
export const GEX_MARKET_TIME_ZONE = "America/New_York";

const MARKET_DAY_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: GEX_MARKET_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export const parseGexIsoDateParts = (value) => {
  const match = String(value || "").match(ISO_DATE_RE);
  if (!match) return null;
  const parts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
  const date = new Date(utcDayMs(parts));
  return date.getUTCFullYear() === parts.year &&
    date.getUTCMonth() === parts.month - 1 &&
    date.getUTCDate() === parts.day
    ? parts
    : null;
};

const utcDayMs = (parts) => Date.UTC(parts.year, parts.month - 1, parts.day);

export const getGexMarketDateParts = (value = new Date()) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = Object.fromEntries(
    MARKET_DAY_FORMATTER.formatToParts(date).map((part) => [part.type, part.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
  };
};

export const marketDayDistanceFromExpirationKey = (
  expirationKey,
  referenceDate = new Date(),
) => {
  const expirationParts = parseGexIsoDateParts(expirationKey);
  const referenceParts = getGexMarketDateParts(referenceDate);
  if (!expirationParts || !referenceParts) return null;
  return Math.round((utcDayMs(expirationParts) - utcDayMs(referenceParts)) / DAY_MS);
};

export const formatGexDteLabel = (days) => {
  if (!Number.isFinite(days)) return "";
  if (days === 0) return "today";
  return days > 0 ? `${days}d` : "Exp";
};

export const formatGexExpirationHeaderLabel = (dateLabel, days) =>
  days === 0 ? "0DTE" : dateLabel;
