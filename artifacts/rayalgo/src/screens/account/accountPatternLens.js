const EMPTY_LENS = Object.freeze({
  kind: "none",
  label: "All patterns",
  symbol: "",
  sourceType: "all",
  closeHour: null,
  pnlSign: "all",
});

const HOUR_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour: "2-digit",
  hourCycle: "h23",
});

const normalizeSourceType = (value) => {
  const normalized = String(value || "").trim();
  return normalized || "all";
};

export const emptyAccountPatternLens = () => ({ ...EMPTY_LENS });

export const normalizeCloseHour = (value) => {
  if (value == null || value === "") {
    return null;
  }
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 0 || numeric > 23) {
    return null;
  }
  return String(numeric).padStart(2, "0");
};

export const buildAccountPatternLens = (kind, input = {}) => {
  if (kind === "symbol") {
    const symbol = String(input.symbol || "").trim().toUpperCase();
    return {
      ...emptyAccountPatternLens(),
      kind,
      label: symbol ? `Symbol ${symbol}` : "All symbols",
      symbol,
    };
  }

  if (kind === "source") {
    const sourceType = normalizeSourceType(input.sourceType);
    const label = String(input.label || input.strategyLabel || sourceType).trim();
    return {
      ...emptyAccountPatternLens(),
      kind,
      label: `Source ${label || sourceType}`,
      sourceType,
    };
  }

  if (kind === "hour") {
    const closeHour = normalizeCloseHour(input.hour);
    return {
      ...emptyAccountPatternLens(),
      kind,
      label: closeHour == null ? "All close hours" : `Close hour ${closeHour}:00 ET`,
      closeHour,
    };
  }

  if (kind === "pnl") {
    const pnlSign =
      input.pnlSign === "winners" || input.pnlSign === "losers"
        ? input.pnlSign
        : "all";
    return {
      ...emptyAccountPatternLens(),
      kind,
      label:
        pnlSign === "winners"
          ? "Winning trades"
          : pnlSign === "losers"
            ? "Losing trades"
            : "All P&L",
      pnlSign,
    };
  }

  return emptyAccountPatternLens();
};

export const applyPatternLensToTradeFilters = (filters = {}, lens = EMPTY_LENS) => ({
  ...filters,
  symbol: lens.symbol || "",
  sourceType: lens.sourceType || "all",
  pnlSign: lens.pnlSign || "all",
  closeHour: lens.closeHour ?? null,
});

export const clearPatternLensFromTradeFilters = (filters = {}) => ({
  ...filters,
  symbol: "",
  sourceType: "all",
  pnlSign: "all",
  closeHour: null,
});

export const closeDateMatchesPatternHour = (closeDate, closeHour) => {
  const normalizedHour = normalizeCloseHour(closeHour);
  if (normalizedHour == null) {
    return true;
  }

  const parsed = new Date(closeDate);
  if (Number.isNaN(parsed.getTime())) {
    return false;
  }

  return HOUR_FORMATTER.format(parsed) === normalizedHour;
};
