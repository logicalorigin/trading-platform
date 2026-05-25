import { WATCHLIST_SIGNAL_TIMEFRAMES } from "./watchlistModel.js";

export const HEADER_SIGNAL_MAX_ITEMS = 24;
export const HEADER_UNUSUAL_MAX_ITEMS = 28;
export const HEADER_ALGO_MAX_ITEMS = 20;
export const HEADER_ALGO_CONTEXT_ICON_MAX = 4;
export const HEADER_SIGNAL_CONTEXT_SYMBOL_LIMIT = HEADER_SIGNAL_MAX_ITEMS;
export const HEADER_RECENT_SIGNAL_MS = 2 * 24 * 60 * 60 * 1000;
export const DEFAULT_HEADER_BROADCAST_SPEED_PRESET = "slow";
export const HEADER_BROADCAST_SCROLL_MIN_SECONDS = 18;
export const HEADER_BROADCAST_SPEED_PRESETS = {
  slow: {
    label: "Slow",
    pixelsPerSecond: 18,
  },
  normal: {
    label: "Normal",
    pixelsPerSecond: 24,
  },
  fast: {
    label: "Fast",
    pixelsPerSecond: 36,
  },
};

export const resolveHeaderBroadcastSpeedPreset = (value) =>
  HEADER_BROADCAST_SPEED_PRESETS[value]
    ? value
    : DEFAULT_HEADER_BROADCAST_SPEED_PRESET;

export const getHeaderBroadcastScrollDurationSeconds = (
  value,
  { scrollDistancePx = 0 } = {},
) => {
  const preset = resolveHeaderBroadcastSpeedPreset(value);
  const pixelsPerSecond = Number(
    HEADER_BROADCAST_SPEED_PRESETS[preset].pixelsPerSecond,
  );
  const distance = Number(scrollDistancePx);
  const rawSeconds =
    Number.isFinite(distance) && distance > 0 && pixelsPerSecond > 0
      ? distance / pixelsPerSecond
      : HEADER_BROADCAST_SCROLL_MIN_SECONDS;
  const clamped = Math.max(HEADER_BROADCAST_SCROLL_MIN_SECONDS, rawSeconds);
  return Math.round(clamped * 10) / 10;
};

const normalizeSymbol = (symbol) => symbol?.trim?.().toUpperCase?.() || "";

const parseTimeMs = (value) => {
  if (!value) return 0;
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : 0;
  }
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
};

const normalizeDirection = (direction) => {
  const normalized = String(direction || "").trim().toLowerCase();
  return normalized === "buy" || normalized === "sell" ? normalized : "";
};

const normalizeSignalIntervalTimeframe = (timeframe) => {
  const normalized = String(timeframe || "").trim();
  return WATCHLIST_SIGNAL_TIMEFRAMES.includes(normalized) ? normalized : "";
};

const buildSignalIntervalStatesBySymbol = (states = []) => {
  const bySymbol = {};
  (states || []).forEach((state) => {
    const symbol = normalizeSymbol(state?.symbol);
    const timeframe = normalizeSignalIntervalTimeframe(state?.timeframe);
    if (!symbol || !timeframe) return;
    bySymbol[symbol] = {
      ...(bySymbol[symbol] || {}),
      [timeframe]: state,
    };
  });
  return bySymbol;
};

const signalItemToIntervalState = (item) => {
  const timeframe = normalizeSignalIntervalTimeframe(item?.timeframe);
  if (!timeframe) return null;
  return {
    ...(item?.raw || {}),
    symbol: item.symbol,
    timeframe,
    currentSignalDirection: item.direction,
    currentSignalAt: item.time,
    currentSignalPrice: item.price,
    barsSinceSignal: item?.raw?.barsSinceSignal ?? null,
    fresh: Boolean(item.fresh),
    status: item?.raw?.status || (item.fresh ? "ok" : item.source || "signal"),
  };
};

const withSignalIntervalStates = (item, intervalStatesBySymbol) => {
  const intervalStates = { ...(intervalStatesBySymbol[item.symbol] || {}) };
  const fallbackState = signalItemToIntervalState(item);
  if (fallbackState) {
    const currentState = intervalStates[fallbackState.timeframe];
    if (!normalizeDirection(currentState?.currentSignalDirection)) {
      intervalStates[fallbackState.timeframe] = fallbackState;
    }
  }
  return {
    ...item,
    intervalStates,
    intervalTimeframes: WATCHLIST_SIGNAL_TIMEFRAMES,
  };
};

const upsertByKey = (itemsByKey, item) => {
  if (!item?.key) return;
  const existing = itemsByKey.get(item.key);
  if (!existing) {
    itemsByKey.set(item.key, item);
    return;
  }

  const existingPriority = existing.source === "state" ? 2 : 1;
  const itemPriority = item.source === "state" ? 2 : 1;
  if (
    itemPriority > existingPriority ||
    (itemPriority === existingPriority && item.timeMs > existing.timeMs)
  ) {
    itemsByKey.set(item.key, item);
  }
};

export const buildHeaderSignalTapeItems = (
  snapshot,
  {
    nowMs = Date.now(),
    maxItems = HEADER_SIGNAL_MAX_ITEMS,
    recentSignalMs = HEADER_RECENT_SIGNAL_MS,
    signalMatrixStates = [],
  } = {},
) => {
  const itemsByKey = new Map();
  const cutoffMs = nowMs - recentSignalMs;
  const intervalStatesBySymbol =
    buildSignalIntervalStatesBySymbol(signalMatrixStates);

  (snapshot?.states || []).forEach((state) => {
    const symbol = normalizeSymbol(state?.symbol);
    const direction = normalizeDirection(state?.currentSignalDirection);
    if (!symbol || !direction || state?.active === false) return;

    const timeframe = state?.timeframe || "";
    const time = state?.currentSignalAt || state?.lastEvaluatedAt || "";
    const timeMs = parseTimeMs(time);
    if (timeMs && timeMs < cutoffMs) return;

    const key = [
      symbol,
      timeframe,
      direction,
      timeMs || state?.id || "current",
    ].join("|");

    upsertByKey(itemsByKey, {
      id: `signal-state-${key}`,
      key,
      kind: "signal",
      source: "state",
      symbol,
      direction,
      directionLabel: direction.toUpperCase(),
      timeframe,
      price: state?.currentSignalPrice ?? null,
      time,
      timeMs,
      fresh: Boolean(state?.fresh),
      raw: state,
    });
  });

  (snapshot?.events || []).forEach((event) => {
    const symbol = normalizeSymbol(event?.symbol);
    const direction = normalizeDirection(event?.direction);
    if (!symbol || !direction) return;

    const time = event?.signalAt || event?.emittedAt || "";
    const timeMs = parseTimeMs(time);
    if (timeMs && timeMs < cutoffMs) return;

    const timeframe = event?.timeframe || "";
    const key = [
      symbol,
      timeframe,
      direction,
      timeMs || event?.id || "event",
    ].join("|");

    upsertByKey(itemsByKey, {
      id: `signal-event-${event?.id || key}`,
      key,
      kind: "signal",
      source: "event",
      symbol,
      direction,
      directionLabel: direction.toUpperCase(),
      timeframe,
      price: event?.signalPrice ?? event?.close ?? null,
      time,
      timeMs,
      fresh: false,
      raw: event,
    });
  });

  return Array.from(itemsByKey.values())
    .map((item) => withSignalIntervalStates(item, intervalStatesBySymbol))
    .sort((left, right) => {
      if (left.timeMs !== right.timeMs) return right.timeMs - left.timeMs;
      if (left.fresh !== right.fresh) return left.fresh ? -1 : 1;
      return left.symbol.localeCompare(right.symbol);
    })
    .slice(0, maxItems);
};

export const buildHeaderSignalContextSymbols = (
  snapshot,
  {
    maxItems = HEADER_SIGNAL_MAX_ITEMS,
    maxSymbols = HEADER_SIGNAL_CONTEXT_SYMBOL_LIMIT,
    nowMs = Date.now(),
  } = {},
) => {
  const items = buildHeaderSignalTapeItems(snapshot, { maxItems, nowMs });

  return [
    ...new Set(
      items
        .map((item) => normalizeSymbol(item?.symbol))
        .filter(Boolean),
    ),
  ].slice(0, maxSymbols);
};

const getFlowEventTime = (event) =>
  event?.occurredAt || event?.time || event?.timestamp || "";

const getFlowEventSymbol = (event) =>
  normalizeSymbol(event?.ticker || event?.underlying || event?.symbol);

const getFlowEventRight = (event) => {
  const right = String(event?.cp || event?.right || "").trim().toUpperCase();
  if (right === "C" || right === "CALL") return "C";
  if (right === "P" || right === "PUT") return "P";
  return right;
};

const RADAR_ACTIVITY_OPTION_TICKER_RE = /\b(CALL|PUT|OPTION)\s+ACTIVITY\b/i;

const isRadarActivityFallbackEvent = (event) => {
  const basis = String(event?.sourceBasis || event?.confidence || "")
    .trim()
    .toLowerCase();
  if (basis !== "fallback_estimate") return false;
  if (event?.providerContractId) return false;
  return RADAR_ACTIVITY_OPTION_TICKER_RE.test(String(event?.optionTicker || ""));
};

export const buildHeaderUnusualTapeItems = (
  events = [],
  { maxItems = HEADER_UNUSUAL_MAX_ITEMS } = {},
) => {
  const itemsByKey = new Map();

  (events || []).forEach((event) => {
    if (isRadarActivityFallbackEvent(event)) return;
    const symbol = getFlowEventSymbol(event);
    if (!symbol) return;

    const score = Number(event?.unusualScore ?? event?.score ?? 0);

    const time = getFlowEventTime(event);
    const timeMs = parseTimeMs(time);
    const right = getFlowEventRight(event);
    const optionKey =
      event?.optionTicker ||
      [event?.strike, right, event?.expirationDate || event?.exp].join("-");
    const key =
      event?.id ||
      [symbol, optionKey, timeMs || time || "flow", event?.premium || ""].join("|");
    const premium = Number(event?.premium ?? 0);

    if (!itemsByKey.has(key)) {
      itemsByKey.set(key, {
        id: `unusual-${key}`,
        key,
        kind: "unusual",
        symbol,
        right,
        side: event?.side || "",
        sentiment: event?.sentiment || "",
        contract: event?.contract || "",
        optionTicker: event?.optionTicker || "",
        providerContractId: event?.providerContractId ?? null,
        confidence: event?.confidence || "",
        sourceBasis: event?.sourceBasis || "",
        strike: event?.strike ?? null,
        expirationDate: event?.expirationDate || event?.exp || "",
        premium: Number.isFinite(premium) ? premium : 0,
        size: event?.vol ?? event?.size ?? null,
        openInterest: event?.oi ?? event?.openInterest ?? null,
        dte: event?.dte ?? null,
        score: Number.isFinite(score) ? score : 0,
        time,
        timeMs,
        raw: event,
      });
    }
  });

  return Array.from(itemsByKey.values())
    .sort((left, right) => {
      if (left.timeMs !== right.timeMs) return right.timeMs - left.timeMs;
      if (left.score !== right.score) return right.score - left.score;
      if (left.premium !== right.premium) return right.premium - left.premium;
      return left.symbol.localeCompare(right.symbol);
    })
    .slice(0, maxItems);
};

const getAlgoEventTime = (event) =>
  event?.occurredAt || event?.createdAt || event?.updatedAt || "";

const getAlgoEventSymbol = (event) =>
  normalizeSymbol(
    event?.symbol ||
      event?.payload?.symbol ||
      event?.payload?.candidate?.symbol ||
      event?.payload?.position?.symbol,
  );

const readNumber = (value) => {
  const number =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : NaN;
  return Number.isFinite(number) ? number : null;
};

const compactMoney = (value, { showSign = false } = {}) => {
  const number = readNumber(value);
  if (number == null) return "";
  const sign = showSign && number >= 0 ? "+" : number < 0 ? "-" : "";
  const abs = Math.abs(number);
  const amount =
    abs >= 1_000_000
      ? `$${(abs / 1_000_000).toFixed(1)}M`
      : abs >= 1_000
        ? `$${(abs / 1_000).toFixed(1)}K`
        : `$${abs.toFixed(0)}`;
  return `${sign}${amount}`;
};

const normalizeOptionRight = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "c" || normalized === "call") return "call";
  if (normalized === "p" || normalized === "put") return "put";
  return "";
};

const firstPresent = (...values) =>
  values.find((value) => value != null && value !== "");

const getAlgoOptionRight = (event) => {
  const payload = event?.payload || {};
  return normalizeOptionRight(
    firstPresent(
      payload.selectedContract?.right,
      payload.selectedContract?.cp,
      payload.position?.optionRight,
      payload.position?.selectedContract?.right,
      payload.candidate?.optionRight,
      payload.candidate?.selectedContract?.right,
      payload.candidate?.selectedContract?.cp,
    ),
  );
};

const getAlgoQuantity = (event) => {
  const payload = event?.payload || {};
  return readNumber(
    firstPresent(
      payload.orderPlan?.quantity,
      payload.position?.quantity,
      payload.candidate?.orderPlan?.quantity,
      payload.candidate?.quantity,
    ),
  );
};

const getAlgoPremium = (event) => {
  const payload = event?.payload || {};
  return readNumber(
    firstPresent(
      payload.orderPlan?.premiumAtRisk,
      payload.position?.premiumAtRisk,
      payload.candidate?.orderPlan?.premiumAtRisk,
    ),
  );
};

const getAlgoDte = (event) => {
  const payload = event?.payload || {};
  return readNumber(
    firstPresent(
      payload.selectedExpiration?.dte,
      payload.selectedContract?.dte,
      payload.position?.dte,
      payload.candidate?.dte,
      payload.candidate?.selectedExpiration?.dte,
    ),
  );
};

const getAlgoReason = (event) => {
  const payload = event?.payload || {};
  return String(
    firstPresent(
      payload.reason,
      payload.skipReason,
      payload.readiness?.reason,
      payload.message,
    ) || "",
  ).trim();
};

const compactReasonLabel = (reason) => {
  const normalized = String(reason || "").trim().toLowerCase();
  if (!normalized) return "";
  if (normalized.includes("position_mark")) return "NO MARK";
  if (normalized.includes("option_chain")) return "CHAIN";
  if (normalized.includes("missing_bid")) return "NO BID";
  if (normalized.includes("market_session")) return "SESSION";
  if (normalized.includes("gateway")) return "GATEWAY";
  if (normalized.includes("ibkr")) return "IBKR";
  if (normalized.includes("liquidity") || normalized.includes("spread")) return "LIQ";
  if (normalized.includes("quote")) return "QUOTE";
  if (normalized.includes("resource") || normalized.includes("pressure")) return "CPU";
  if (normalized.includes("risk") || normalized.includes("halt")) return "RISK";
  if (normalized.includes("opposite")) return "FLIP";
  return normalized
    .split(/[_\s-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.slice(0, 4))
    .join("/")
    .toUpperCase();
};

const resolveAlgoEventPresentation = (eventType) => {
  const normalized = String(eventType || "").trim().toLowerCase();
  if (normalized.includes("entry")) {
    return { actionLabel: "ENTRY", iconKind: "entry", toneKind: "success" };
  }
  if (normalized.includes("exit")) {
    return { actionLabel: "EXIT", iconKind: "exit", toneKind: "danger" };
  }
  if (normalized.includes("skip") || normalized.includes("blocked")) {
    return {
      actionLabel: normalized.includes("blocked") ? "BLOCK" : "SKIP",
      iconKind: normalized.includes("blocked") ? "blocked" : "skip",
      toneKind: "warning",
    };
  }
  if (normalized.includes("mark")) {
    return { actionLabel: "MARK", iconKind: "mark", toneKind: "info" };
  }
  if (normalized.includes("profile") || normalized.includes("settings")) {
    return { actionLabel: "CONFIG", iconKind: "config", toneKind: "accent" };
  }
  if (normalized.includes("deployment")) {
    return { actionLabel: "DEPLOY", iconKind: "deploy", toneKind: "accent" };
  }
  return { actionLabel: "ALGO", iconKind: "algo", toneKind: "info" };
};

const buildHeaderAlgoContextIcons = (
  event,
  presentation,
  { maxIcons = HEADER_ALGO_CONTEXT_ICON_MAX } = {},
) => {
  const eventType = String(event?.eventType || "").toLowerCase();
  const isSkipped = eventType.includes("skip");
  const isBlocked = eventType.includes("blocked");
  const isEntry = eventType.includes("entry");
  const isExit = eventType.includes("exit");
  const isMark = eventType.includes("mark");
  const optionRight = getAlgoOptionRight(event);
  const quantity = getAlgoQuantity(event);
  const premium = getAlgoPremium(event);
  const pnl = readNumber(event?.payload?.pnl);
  const dte = getAlgoDte(event);
  const reason = getAlgoReason(event);
  const icons = [];
  const push = (icon) => {
    if (!icon?.kind || icons.some((existing) => existing.kind === icon.kind)) return;
    icons.push(icon);
  };

  if (optionRight) {
    push({
      kind: "contract",
      iconKind: optionRight,
      toneKind: optionRight === "put" ? "danger" : "success",
      label: optionRight === "put" ? "PUT contract" : "CALL contract",
      valueLabel: "",
    });
  }

  if (isBlocked) {
    push({
      kind: "status",
      iconKind: "blocked",
      toneKind: "warning",
      label: "Blocked",
    });
  } else if (isSkipped) {
    push({
      kind: "status",
      iconKind: "skipped",
      toneKind: "warning",
      label: "Skipped",
    });
  } else if (isEntry) {
    push({
      kind: "status",
      iconKind: "opened",
      toneKind: "success",
      label: "Opened",
    });
  } else if (isExit) {
    const exitIconKind =
      pnl == null
        ? "opened"
        : pnl > 0
          ? "profit_exit"
          : pnl < 0
            ? "loss_exit"
            : "flat_exit";
    const exitToneKind =
      pnl == null ? "info" : pnl > 0 ? "success" : pnl < 0 ? "danger" : "info";
    push({
      kind: "status",
      iconKind: exitIconKind,
      toneKind: exitToneKind,
      label:
        pnl == null
          ? "Exited"
          : pnl > 0
            ? "Profitable exit"
            : pnl < 0
              ? "Losing exit"
              : "Flat exit",
      valueLabel: pnl == null ? "" : compactMoney(pnl, { showSign: true }),
    });
  } else if (isMark) {
    push({
      kind: "status",
      iconKind: "mark",
      toneKind: "info",
      label: "Position mark",
    });
  } else if (presentation?.iconKind === "config" || presentation?.iconKind === "deploy") {
    push({
      kind: "status",
      iconKind: presentation.iconKind,
      toneKind: presentation.toneKind,
      label: presentation.actionLabel,
    });
  }

  if (pnl != null && !isExit) {
    push({
      kind: "money",
      iconKind: "money",
      toneKind: pnl > 0 ? "success" : pnl < 0 ? "danger" : "info",
      label: `PnL ${compactMoney(pnl, { showSign: true })}`,
      valueLabel: compactMoney(pnl, { showSign: true }),
    });
  } else if (premium != null) {
    push({
      kind: "money",
      iconKind: "money",
      toneKind: "accent",
      label: `Premium ${compactMoney(premium)}`,
      valueLabel: compactMoney(premium),
    });
  }

  if ((isSkipped || isBlocked) && reason) {
    push({
      kind: "reason",
      iconKind: "reason",
      toneKind: "warning",
      label: `Reason ${reason}`,
      valueLabel: compactReasonLabel(reason),
    });
  }

  if (quantity != null && quantity > 0) {
    push({
      kind: "quantity",
      iconKind: "quantity",
      toneKind: "info",
      label: `Quantity x${quantity}`,
      valueLabel: `x${quantity}`,
    });
  }

  if (!(isSkipped || isBlocked) && reason) {
    push({
      kind: "reason",
      iconKind: "reason",
      toneKind: "warning",
      label: `Reason ${reason}`,
      valueLabel: compactReasonLabel(reason),
    });
  }

  if (dte != null && dte >= 0) {
    push({
      kind: "dte",
      iconKind: "dte",
      toneKind: "info",
      label: `DTE ${dte}`,
      valueLabel: `${dte}d`,
    });
  }

  return icons.slice(0, maxIcons);
};

export const buildHeaderAlgoTapeItems = (
  events = [],
  { maxItems = HEADER_ALGO_MAX_ITEMS } = {},
) => {
  const itemsByKey = new Map();

  (events || []).forEach((event) => {
    if (!event || typeof event !== "object") return;
    const key = event.id || [
      event.eventType || "algo",
      getAlgoEventSymbol(event) || "ALGO",
      getAlgoEventTime(event) || event.summary || "event",
    ].join("|");
    const time = getAlgoEventTime(event);
    const timeMs = parseTimeMs(time);
    const presentation = resolveAlgoEventPresentation(event.eventType);
    const symbol = getAlgoEventSymbol(event) || "ALGO";
    const detail = String(event.summary || event.eventType || "Algo event").trim();
    const contextIcons = buildHeaderAlgoContextIcons(event, presentation);
    const item = {
      id: `algo-${key}`,
      key,
      kind: "algo",
      symbol,
      eventType: event.eventType || "",
      detail,
      time,
      timeMs,
      contextIcons,
      raw: event,
      ...presentation,
    };
    const existing = itemsByKey.get(key);
    if (!existing || item.timeMs >= existing.timeMs) {
      itemsByKey.set(key, item);
    }
  });

  return Array.from(itemsByKey.values())
    .sort((left, right) => {
      if (left.timeMs !== right.timeMs) return right.timeMs - left.timeMs;
      return left.symbol.localeCompare(right.symbol);
    })
    .slice(0, maxItems);
};
