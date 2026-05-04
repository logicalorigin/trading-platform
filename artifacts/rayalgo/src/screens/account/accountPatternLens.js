const EMPTY_LENS = Object.freeze({
  kind: "none",
  label: "All patterns",
  symbol: "",
  assetClass: "all",
  sourceType: "all",
  side: "all",
  holdDuration: "all",
  strategy: "all",
  feeDrag: "all",
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

const normalizeSelectValue = (value) => {
  const normalized = String(value || "").trim();
  return normalized || "all";
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

  if (kind === "assetClass") {
    const assetClass = normalizeSelectValue(input.assetClass);
    return {
      ...emptyAccountPatternLens(),
      kind,
      label: assetClass === "all" ? "All assets" : `Asset ${assetClass}`,
      assetClass,
    };
  }

  if (kind === "side") {
    const side = normalizeSelectValue(input.side).toLowerCase();
    return {
      ...emptyAccountPatternLens(),
      kind,
      label: side === "all" ? "All sides" : `Side ${side.toUpperCase()}`,
      side,
    };
  }

  if (kind === "holdDuration") {
    const holdDuration = normalizeSelectValue(input.holdDuration);
    const label =
      {
        "intraday-fast": "Hold <= 30m",
        intraday: "Hold 30m-4h",
        swing: "Hold 4h-1d",
        "multi-day": "Hold multi-day",
        unknown: "Hold unknown",
      }[holdDuration] || `Hold ${holdDuration}`;
    return {
      ...emptyAccountPatternLens(),
      kind,
      label,
      holdDuration,
    };
  }

  if (kind === "strategy") {
    const strategy = normalizeSelectValue(input.strategy);
    const label = String(input.label || strategy).trim();
    return {
      ...emptyAccountPatternLens(),
      kind,
      label: strategy === "all" ? "All strategies" : `Strategy ${label}`,
      strategy,
    };
  }

  if (kind === "feeDrag") {
    const feeDrag = normalizeSelectValue(input.feeDrag);
    const label =
      {
        high: "High fee drag",
        medium: "Medium fee drag",
        low: "Low fee drag",
        none: "No fee drag",
      }[feeDrag] || "All fee drag";
    return {
      ...emptyAccountPatternLens(),
      kind,
      label,
      feeDrag,
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
  assetClass: lens.kind === "assetClass" ? lens.assetClass : filters.assetClass || "all",
  sourceType: lens.sourceType || filters.sourceType || "all",
  side: lens.side || filters.side || "all",
  holdDuration: lens.holdDuration || filters.holdDuration || "all",
  strategy: lens.strategy || filters.strategy || "all",
  feeDrag: lens.feeDrag || filters.feeDrag || "all",
  pnlSign: lens.pnlSign || filters.pnlSign || "all",
  closeHour: lens.closeHour ?? null,
});

export const clearPatternLensFromTradeFilters = (filters = {}, lens = EMPTY_LENS) => ({
  ...filters,
  symbol: "",
  assetClass: lens.kind === "assetClass" ? "all" : filters.assetClass,
  sourceType: "all",
  side: "all",
  holdDuration: "all",
  strategy: "all",
  feeDrag: "all",
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
