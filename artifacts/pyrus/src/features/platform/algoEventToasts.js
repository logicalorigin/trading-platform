import { formatEnumLabel } from "../../lib/formatters";

export const ALGO_EVENT_NOTIFICATION_POLL_MS = 5_000;
const ALGO_EVENT_SURFACE_POLL_MS = 30_000;
const ALGO_EVENT_TOAST_SEEN_STORAGE_PREFIX =
  "pyrus.algo-event-toast-seen.v1";
const ALGO_EVENT_TOAST_SEEN_MAX_IDS = 500;
const ALGO_EVENT_TOAST_SEEN_RETAIN_IDS = 300;

const algoEventToastSeenStorage = (storage) => {
  if (storage) return storage;
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
};

const algoEventToastSeenStorageKey = ({ userId, environment }) => {
  const normalizedUserId = String(userId || "").trim();
  if (!normalizedUserId) return null;
  const normalizedEnvironment =
    String(environment || "shadow").trim().toLowerCase() || "shadow";
  return `${ALGO_EVENT_TOAST_SEEN_STORAGE_PREFIX}:${encodeURIComponent(
    normalizedUserId,
  )}:${encodeURIComponent(normalizedEnvironment)}`;
};

const trimAlgoEventToastSeenIds = (seenIds) => {
  const ids = Array.from(seenIds || [])
    .map((id) => String(id || "").trim())
    .filter(Boolean);
  const uniqueIds = Array.from(new Set(ids));
  return new Set(
    uniqueIds.length > ALGO_EVENT_TOAST_SEEN_MAX_IDS
      ? uniqueIds.slice(-ALGO_EVENT_TOAST_SEEN_RETAIN_IDS)
      : uniqueIds,
  );
};

export const readAlgoEventToastSeenIds = ({
  storage = null,
  userId = null,
  environment = "shadow",
} = {}) => {
  const resolvedStorage = algoEventToastSeenStorage(storage);
  const key = algoEventToastSeenStorageKey({ userId, environment });
  if (!resolvedStorage || !key) return new Set();
  try {
    const parsed = JSON.parse(resolvedStorage.getItem(key) || "null");
    const ids = Array.isArray(parsed) ? parsed : parsed?.ids;
    return trimAlgoEventToastSeenIds(Array.isArray(ids) ? ids : []);
  } catch {
    return new Set();
  }
};

export const persistAlgoEventToastSeenIds = ({
  storage = null,
  userId = null,
  environment = "shadow",
  seenIds = new Set(),
} = {}) => {
  const resolvedStorage = algoEventToastSeenStorage(storage);
  const key = algoEventToastSeenStorageKey({ userId, environment });
  const mergedIds =
    resolvedStorage && key
      ? new Set([
          ...readAlgoEventToastSeenIds({
            storage: resolvedStorage,
            userId,
            environment,
          }),
          ...seenIds,
        ])
      : seenIds;
  const trimmedIds = trimAlgoEventToastSeenIds(mergedIds);
  if (!resolvedStorage || !key) return trimmedIds;
  try {
    resolvedStorage.setItem(
      key,
      JSON.stringify({ ids: Array.from(trimmedIds) }),
    );
  } catch {
    // Storage can be unavailable in private/restricted contexts; in-memory
    // dedupe still works for the current page lifetime.
  }
  return trimmedIds;
};

export const resolveAlgoEventFeedPolicy = ({
  notificationsEnabled = false,
  surfaceDataEnabled = false,
  streamFresh = false,
} = {}) => ({
  queryEnabled: Boolean(notificationsEnabled || surfaceDataEnabled),
  refetchInterval:
    notificationsEnabled
      ? ALGO_EVENT_NOTIFICATION_POLL_MS
      : streamFresh
        ? false
        : surfaceDataEnabled
          ? ALGO_EVENT_SURFACE_POLL_MS
          : false,
});

const readNumber = (value) => {
  const number =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : NaN;
  return Number.isFinite(number) ? number : null;
};

const formatSignedUsd = (value) =>
  `${value >= 0 ? "+" : "-"}$${Math.abs(value).toFixed(2)}`;

// Categorize by event-type suffix so this stays robust across the algo event
// family (e.g. signal_options_shadow_exit, signal_options_gateway_blocked,
// signal_options_candidate_skipped). High-frequency mark/candidate events
// return null so they never toast.
const categorize = (eventType) => {
  const type = String(eventType || "");
  if (type.endsWith("_exit")) return "exit";
  if (type.endsWith("_entry")) return "entry";
  if (type.endsWith("_blocked")) return "blocked";
  if (type.endsWith("_skipped")) return "skipped";
  return null;
};

// Drop the verbose "signal_options_" prefix, matching the notifications drawer.
const eventLabel = (eventType) => {
  const stripped = String(eventType || "").replace(/^signal_options_/, "");
  return formatEnumLabel(stripped || eventType || "event");
};

const includesMtfNotAligned = (value) => {
  if (typeof value !== "string") return false;
  const normalized = value.toLowerCase().replace(/[_-]+/g, " ");
  return normalized.includes("mtf not aligned");
};

const reasonValues = (value) =>
  Array.isArray(value) ? value : value == null ? [] : [value];

const isMtfNotAlignedControlEvent = (event, summary) => {
  const payload =
    event?.payload && typeof event.payload === "object" ? event.payload : {};
  const entryGate =
    payload?.entryGate && typeof payload.entryGate === "object"
      ? payload.entryGate
      : {};
  const values = [
    event?.reason,
    payload?.reason,
    payload?.skipReason,
    entryGate?.reason,
    ...reasonValues(payload?.reasons),
    ...reasonValues(payload?.reasonCodes),
    ...reasonValues(entryGate?.reasons),
    summary,
  ];
  return values.some(includesMtfNotAligned);
};

const isPositionManagementSkip = (event) => {
  const payload =
    event?.payload && typeof event.payload === "object" ? event.payload : {};
  const reason = String(payload?.reason || payload?.skipReason || "")
    .trim()
    .toLowerCase();
  return (
    reason.startsWith("position_mark_") ||
    reason === "invalid_position_mark"
  );
};

export function buildAlgoEventToast(event) {
  // This event came from the retired global broker-readiness gate. Keep its
  // durable row available to historical diagnostics, but never replay it as a
  // current trade notification now that readiness belongs to each target.
  if (event?.eventType === "signal_options_gateway_blocked") return null;

  const category = categorize(event?.eventType);
  if (!category) return null;

  const summary =
    typeof event?.summary === "string" && event.summary.trim()
      ? event.summary.trim()
      : "";
  const symbol = typeof event?.symbol === "string" ? event.symbol.trim() : "";
  const label = eventLabel(event?.eventType);
  const title = symbol ? `${symbol} · ${label}` : label;

  if (
    (category === "blocked" || category === "skipped") &&
    isMtfNotAlignedControlEvent(event, summary)
  ) {
    return null;
  }

  // Position-mark failures describe maintenance of an already-open position,
  // not a new trading candidate. The Algo health/attention surfaces retain the
  // condition; treating every retry row as candidate activity creates a fresh
  // toast for the same degraded feed state.
  if (category === "skipped" && isPositionManagementSkip(event)) {
    return null;
  }

  if (category === "exit") {
    const pnl = readNumber(event?.payload?.pnl);
    const kind =
      pnl == null ? "info" : pnl > 0 ? "success" : pnl < 0 ? "error" : "info";
    // Exit summaries carry the price/reason but not the PnL, so lead the body
    // with the realized PnL when we have it.
    const body =
      pnl == null
        ? summary || "Exit filled"
        : summary
          ? `PnL ${formatSignedUsd(pnl)} · ${summary}`
          : `Exit · PnL ${formatSignedUsd(pnl)}`;
    return { kind, title, body, duration: 5000 };
  }

  if (category === "entry") {
    return {
      kind: "success",
      title,
      body: summary || "Entry filled",
      duration: 5000,
    };
  }

  if (category === "blocked") {
    return {
      kind: "warn",
      title,
      body: summary || "Scan blocked",
      duration: 6000,
    };
  }

  // skipped
  return {
    kind: "info",
    title,
    body: summary || "Candidate skipped",
    duration: 4000,
  };
}
