import { useEffect, useMemo, useRef, useState } from "react";

const ACTIVE_WAIT_STATUSES = new Set([
  "pending",
  "loading",
  "fetching",
  "retrying",
  "stale",
  "blocked",
]);

const STATUS_LABELS = {
  pending: "Waiting on",
  loading: "Loading",
  fetching: "Refreshing",
  retrying: "Retrying",
  stale: "Waiting for fresh",
  blocked: "Waiting on",
};

const SOURCE_STATE_LABELS = {
  live: "Live",
  shared: "Shared",
  cached: "Cached",
  refreshing: "Refreshing",
  waiting: "Waiting",
  stale: "Stale",
};

const SOURCE_STATE_ALIASES = {
  "leader-bus": "shared",
  "follower-bus": "shared",
  bus: "shared",
  "shared-cache": "shared",
  "stale-bus": "stale",
  "stale-cache": "stale",
  fallback: "refreshing",
  "fallback-fetch": "refreshing",
};

const ACCOUNT_ID_RE = /^(?:DU|U)\d{5,}$/i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LONG_NUMERIC_RE = /^\d{4,}$/;

const cleanText = (value, maxLength = 160) => {
  const text = String(value ?? "").trim().replace(/\s+/g, " ");
  return text ? text.slice(0, maxLength) : null;
};

const normalizeWaitStatus = (status) => {
  const normalized = String(status || "").trim().toLowerCase();
  return ACTIVE_WAIT_STATUSES.has(normalized) ? normalized : null;
};

export const normalizeLoadingSourceState = (state) => {
  const normalized = String(state || "").trim().toLowerCase();
  const aliased = SOURCE_STATE_ALIASES[normalized] || normalized;
  return Object.prototype.hasOwnProperty.call(SOURCE_STATE_LABELS, aliased)
    ? aliased
    : null;
};

const formatLoadingSourceAge = (ageMs) => {
  const ageLabel = formatLoadingElapsed(ageMs);
  return ageLabel ? `${ageLabel} old` : null;
};

const formatLoadingSourceLine = (item) => {
  const sourceState = normalizeLoadingSourceState(item?.sourceState);
  if (!sourceState) return null;
  return [
    SOURCE_STATE_LABELS[sourceState],
    item.sourceAgeLabel || formatLoadingSourceAge(item.sourceAgeMs),
    cleanText(item.sourceDetail),
  ]
    .filter(Boolean)
    .join(" ");
};

const maskEndpointSegment = (segment) => {
  if (!segment) return segment;
  const decoded = decodeURIComponent(segment);
  if (ACCOUNT_ID_RE.test(decoded)) return ":account";
  if (UUID_RE.test(decoded) || LONG_NUMERIC_RE.test(decoded)) return ":id";
  return segment;
};

export const sanitizeLoadingEndpoint = (value) => {
  const text = cleanText(value, 220);
  if (!text) return null;
  if (!text.includes("/") && !/^https?:\/\//i.test(text)) {
    return text;
  }

  let pathname = text;
  try {
    const parsed = /^https?:\/\//i.test(text)
      ? new URL(text)
      : new URL(text, "https://pyrus.local");
    pathname = parsed.pathname;
  } catch {
    pathname = text.split("?")[0] || text;
  }

  const sanitized = pathname
    .split("/")
    .map(maskEndpointSegment)
    .join("/")
    .replace(/\/{2,}/g, "/");
  return cleanText(sanitized, 180);
};

export const formatLoadingElapsed = (elapsedMs) => {
  if (elapsedMs == null || elapsedMs === "") return null;
  const numeric = Math.max(0, Number(elapsedMs));
  if (!Number.isFinite(numeric)) return null;
  const seconds = numeric / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
};

export const normalizeLoadingWaitItems = (items = [], nowMs = Date.now()) =>
  (Array.isArray(items) ? items : [])
    .flatMap((item) => {
      if (!item) return [];
      const status = normalizeWaitStatus(item.status);
      if (!status) return [];
      const label = cleanText(item.label || item.id || "container");
      if (!label) return [];
      const startedAtMs = Number(item.startedAtMs);
      const providedElapsedMs = Number(item.elapsedMs);
      const elapsedMs = Number.isFinite(providedElapsedMs)
        ? Math.max(0, providedElapsedMs)
        : Number.isFinite(startedAtMs)
          ? Math.max(0, Number(nowMs) - startedAtMs)
          : null;
      const elapsedLabel =
        elapsedMs == null ? null : formatLoadingElapsed(elapsedMs);
      return [
        {
          id: cleanText(item.id || label, 80) || label,
          label,
          status,
          detail: cleanText(item.detail),
          endpoint: sanitizeLoadingEndpoint(item.endpoint),
          sourceState: normalizeLoadingSourceState(
            item.sourceState || item.freshnessSource || item.dataSource,
          ),
          sourceAgeMs: Number.isFinite(Number(item.sourceAgeMs))
            ? Math.max(0, Number(item.sourceAgeMs))
            : undefined,
          sourceAgeLabel: item.sourceAgeLabel
            ? cleanText(item.sourceAgeLabel, 60)
            : undefined,
          sourceDetail: cleanText(item.sourceDetail, 80),
          blocking: item.blocking !== false,
          elapsedMs,
          elapsedLabel,
        },
      ];
    });

export const formatLoadingWaitLine = (item) => {
  if (!item) return "";
  const status = normalizeWaitStatus(item.status) || "loading";
  const label = cleanText(item.label || item.id || "container") || "container";
  const statusLabel = STATUS_LABELS[status] || "Waiting on";
  // Callers sometimes pass labels that already lead with the status verb
  // ("Loading algo monitor") — don't render "Loading Loading …".
  const primary = label.toLowerCase().startsWith(`${statusLabel.toLowerCase()} `)
    ? label
    : `${statusLabel} ${label}`;
  // Endpoints/module paths are diagnostics data, not product copy — they are
  // surfaced via the row's title attribute instead of the visible line.
  return [
    primary,
    formatLoadingSourceLine(item),
    cleanText(item.detail),
    item.elapsedLabel || formatLoadingElapsed(item.elapsedMs),
  ]
    .filter(Boolean)
    .join(" - ");
};

export const getQueryWaitStatus = (query) => {
  if (!query) return null;
  const retrying = Number(query.failureCount || 0) > 0;
  if (retrying && (query.isLoading || query.isPending || query.isFetching)) {
    return "retrying";
  }
  if (query.isLoading || query.isPending) return "loading";
  if (query.isFetching || query.fetchStatus === "fetching") return "fetching";
  return null;
};

export const buildQueryWaitItem = ({
  id,
  label,
  query,
  endpoint,
  detail,
  blocking = true,
  nowMs,
  startedAtMs,
}) => {
  const status = getQueryWaitStatus(query);
  if (!status) return null;
  const start = Number(startedAtMs);
  const now = Number(nowMs);
  return {
    id,
    label,
    status,
    detail,
    endpoint: sanitizeLoadingEndpoint(endpoint),
    blocking,
    startedAtMs: Number.isFinite(start) ? start : undefined,
    elapsedMs:
      Number.isFinite(start) && Number.isFinite(now)
        ? Math.max(0, now - start)
        : undefined,
  };
};

export const useLoadingWaits = (items = []) => {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const startedAtRef = useRef(new Map());
  const inputItems = Array.isArray(items) ? items : [];
  const hasActiveItems = inputItems.some((item) =>
    Boolean(item && normalizeWaitStatus(item.status)),
  );

  const trackedItems = useMemo(() => {
    const activeIds = new Set();
    const withStarts = inputItems.map((item) => {
      const status = normalizeWaitStatus(item?.status);
      if (!status) return item;
      const id = cleanText(item.id || item.label, 80) || "container";
      activeIds.add(id);
      if (!startedAtRef.current.has(id)) {
        startedAtRef.current.set(id, nowMs);
      }
      return {
        ...item,
        startedAtMs: item.startedAtMs ?? startedAtRef.current.get(id),
      };
    });
    Array.from(startedAtRef.current.keys()).forEach((id) => {
      if (!activeIds.has(id)) startedAtRef.current.delete(id);
    });
    return withStarts;
  }, [inputItems, nowMs]);

  useEffect(() => {
    if (!hasActiveItems || typeof window === "undefined") return undefined;
    const timerId = window.setInterval(() => setNowMs(Date.now()), 500);
    return () => window.clearInterval(timerId);
  }, [hasActiveItems]);

  return useMemo(
    () => normalizeLoadingWaitItems(trackedItems, nowMs),
    [nowMs, trackedItems],
  );
};

export const ContainerLoadingStatus = ({
  items = [],
  title = null,
  maxItems = 4,
  testId = "container-loading-status",
  style,
}) => {
  const waits = useLoadingWaits(items).slice(0, maxItems);
  if (!waits.length) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid={testId}
      data-loading-wait-count={waits.length}
      style={{
        display: "grid",
        gap: 3,
        color: "var(--ra-text-dim)",
        fontFamily: "var(--ra-font-sans)",
        fontSize: 12,
        lineHeight: 1.35,
        letterSpacing: 0,
        minWidth: 0,
        ...style,
      }}
    >
      {title ? (
        <div style={{ color: "var(--ra-text-secondary)", fontWeight: 500 }}>
          {title}
        </div>
      ) : null}
      {waits.map((wait) => (
        <div
          key={wait.id}
          data-loading-wait-id={wait.id}
          title={wait.endpoint || undefined}
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "normal",
            wordBreak: "break-word",
          }}
        >
          {formatLoadingWaitLine(wait)}
        </div>
      ))}
    </div>
  );
};

export default ContainerLoadingStatus;
