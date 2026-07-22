import type { NextFunction, Request, Response } from "express";
import {
  getApiResourcePressureSnapshot,
  type ApiResourcePressureLevel,
} from "./resource-pressure";

export type ApiRouteClass =
  | "protected-execution"
  | "protected-position"
  | "automation-control"
  | "active-screen"
  | "live-data"
  | "stream"
  | "decorative"
  | "deferred-analytics"
  | "background-maintenance";

export type ApiRouteAdmissionAction = "allow" | "cache-only" | "shed";
export type ApiRouteQaMode = "safe" | null;
export type ApiRouteRequestContext = {
  requestFamily?: string | null;
  fetchPriority?: number | null;
  requestOrigin?: string | null;
  clientRole?: string | null;
};

type NormalizedApiRouteRequestContext = {
  requestFamily: string;
  fetchPriority: number | null;
  requestOrigin: string;
  clientRole: string;
};

export type ApiRouteAdmission = {
  routeClass: ApiRouteClass;
  pressureLevel: ApiResourcePressureLevel;
  action: ApiRouteAdmissionAction;
  degraded: boolean;
  stale: boolean;
  cacheOnly: boolean;
  reason: string | null;
  statusCode: number | null;
  retryAfterMs: number | null;
  qaMode: ApiRouteQaMode;
  generatedAt: string;
};

const DEFAULT_ADMISSION: ApiRouteAdmission = {
  routeClass: "active-screen",
  pressureLevel: "normal",
  action: "allow",
  degraded: false,
  stale: false,
  cacheOnly: false,
  reason: null,
  statusCode: null,
  retryAfterMs: null,
  qaMode: null,
  generatedAt: new Date(0).toISOString(),
};

const queryParamsForPath = (path: string) => {
  const query = path.includes("?") ? path.slice(path.indexOf("?") + 1) : "";
  return new URLSearchParams(query);
};

const normalizePath = (path: string) => {
  const withoutQuery = path.split("?")[0] || "/";
  return withoutQuery.startsWith("/api/")
    ? withoutQuery.slice(4)
    : withoutQuery === "/api"
      ? "/"
      : withoutQuery;
};

const normalizeQaMode = (value: unknown): ApiRouteQaMode =>
  String(value || "")
    .trim()
    .toLowerCase() === "safe"
    ? "safe"
    : null;

const normalizeRouteContextValue = (value: unknown): string => {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return normalized ? normalized.slice(0, 64) : "";
};

const normalizeFetchPriority = (value: unknown): number | null => {
  if (value == null || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const activeRequestFamilies = new Set([
  "account-trade-forensics",
  "chart-visible",
  "flow-visible",
  "flow-scanner-visible",
  "flow-tape-visible",
  "option-chart-visible",
  "trade-option-chain",
  "signal-matrix",
  "signals-row-chart",
  "trade-visible",
]);
const activeSparklineRequestFamilies = new Set([
  "algo-signal-sparkline",
  "signals-table-sparkline",
]);
const chartRequestFamilies = new Set([
  "chart-bars",
  "chart-warmup",
  "option-chart-bars",
]);
const passiveSparklineRequestFamilies = new Set(["sparkline"]);
const deferredRequestFamilies = new Set([
  "chart-backfill",
  "chart-flow",
  "background",
  "analytics",
  "scanner",
  "trade-option-chain-batch",
]);
const massiveLiveDataPaths = new Set([
  "/options/chart-bars",
  "/options/chains",
  "/options/expirations",
  "/flow/events",
  "/flow/events/aggregate",
  "/flow/premium-distribution",
  "/flow/universe",
]);

function normalizeRouteRequestContext(
  input: ApiRouteRequestContext = {},
): NormalizedApiRouteRequestContext {
  return {
    requestFamily: normalizeRouteContextValue(input.requestFamily),
    fetchPriority: normalizeFetchPriority(input.fetchPriority),
    requestOrigin: normalizeRouteContextValue(input.requestOrigin),
    clientRole: normalizeRouteContextValue(input.clientRole),
  };
}

function isVisibleRouteRequestContext(
  input: ApiRouteRequestContext = {},
): boolean {
  const context = normalizeRouteRequestContext(input);
  if (activeRequestFamilies.has(context.requestFamily)) {
    return true;
  }
  if (activeSparklineRequestFamilies.has(context.requestFamily)) {
    return true;
  }
  if (
    chartRequestFamilies.has(context.requestFamily) &&
    (context.fetchPriority ?? 0) >= 6
  ) {
    return true;
  }
  if (passiveSparklineRequestFamilies.has(context.requestFamily)) {
    return false;
  }
  return (context.fetchPriority ?? 0) >= 8;
}

function isDeferredRouteRequestContext(
  input: ApiRouteRequestContext = {},
): boolean {
  const context = normalizeRouteRequestContext(input);
  if (deferredRequestFamilies.has(context.requestFamily)) {
    return true;
  }
  return (context.fetchPriority ?? 0) < 0;
}

const routeAdmissionAction = (input: {
  routeClass: ApiRouteClass;
  pressureLevel: ApiResourcePressureLevel;
  qaMode: ApiRouteQaMode;
}): {
  action: ApiRouteAdmissionAction;
  reason: string | null;
  statusCode: number | null;
  retryAfterMs: number | null;
} => {
  const safeQaShedClasses = new Set<ApiRouteClass>([
    "live-data",
    "stream",
    "decorative",
    "deferred-analytics",
    "background-maintenance",
  ]);
  if (input.qaMode === "safe" && safeQaShedClasses.has(input.routeClass)) {
    return {
      action: "shed",
      reason: "qa-safe-mode-shed",
      statusCode: input.routeClass === "decorative" ? 204 : 429,
      retryAfterMs: 30_000,
    };
  }

  if (input.pressureLevel === "high") {
    if (
      input.routeClass === "decorative" ||
      input.routeClass === "deferred-analytics" ||
      input.routeClass === "background-maintenance"
    ) {
      return {
        action: "shed",
        reason: "api-resource-pressure-high",
        statusCode: input.routeClass === "decorative" ? 204 : 429,
        retryAfterMs: 15_000,
      };
    }
  }

  return {
    action: "allow",
    reason: null,
    statusCode: null,
    retryAfterMs: null,
  };
};

export function classifyApiRoute(input: {
  method?: string | null;
  path?: string | null;
  requestFamily?: string | null;
  fetchPriority?: number | null;
  requestOrigin?: string | null;
  clientRole?: string | null;
}): ApiRouteClass {
  const method = String(input.method || "GET").toUpperCase();
  const rawPath = String(input.path || "/");
  const path = normalizePath(rawPath);
  const query = queryParamsForPath(rawPath);
  const mode = String(
    query.get("mode") || query.get("environment") || "",
  ).toLowerCase();
  const routeContext = normalizeRouteRequestContext({
    requestFamily:
      input.requestFamily ?? query.get("requestFamily") ?? query.get("family"),
    fetchPriority:
      input.fetchPriority ?? normalizeFetchPriority(query.get("fetchPriority")),
    requestOrigin: input.requestOrigin ?? query.get("requestOrigin"),
    clientRole: input.clientRole ?? query.get("clientRole"),
  });

  if (
    path === "/orders/submit" ||
    path === "/orders/preview" ||
    path === "/orders/reply" ||
    (path === "/tax/profile" && method === "PUT") ||
    (path === "/tax/reserve/plan" && method === "POST") ||
    /^\/accounts\/[^/]+\/tax\/preflight$/.test(path) ||
    /^\/tax\/reserve\/actions\/(preview|submit)$/.test(path) ||
    /^\/orders\/[^/]+\/(replace|cancel)$/.test(path) ||
    /^\/orders\/[^/]+\/replace\/preview$/.test(path) ||
    (path === "/orders" && method === "POST") ||
    path === "/shadow/orders/preview" ||
    path === "/shadow/orders" ||
    /^\/accounts\/[^/]+\/orders\/[^/]+\/cancel$/.test(path)
  ) {
    return "protected-execution";
  }

  if (path.startsWith("/streams/") || path.endsWith("/stream")) {
    return "stream";
  }

  if (path === "/universe/logos" || path === "/universe/logo-proxy") {
    return "decorative";
  }

  // Sparkline seed is background hydration even when the client marks the row
  // visible. Live chart rows use /bars; this route can be shed only during a
  // process-memory emergency instead of competing with protected/live reads.
  if (path === "/sparklines/seed") {
    return "deferred-analytics";
  }

  if (
    method === "GET" &&
    mode === "live" &&
    (path === "/positions" ||
      path === "/orders" ||
      /^\/accounts\/[^/]+\/(summary|positions|positions-at-date|orders|risk|allocation|equity-history|closed-trades|cash-activity)$/.test(
        path,
      ))
  ) {
    return "live-data";
  }

  if (
    path === "/tax/profile" ||
    path === "/tax/state-rules/status" ||
    path === "/tax/overview" ||
    path === "/tax/reserve" ||
    /^\/accounts\/[^/]+\/tax\//.test(path)
  ) {
    return "protected-position";
  }

  if (path === "/quotes/snapshot") {
    if (isVisibleRouteRequestContext(routeContext)) {
      return "active-screen";
    }
    if (isDeferredRouteRequestContext(routeContext)) {
      return "deferred-analytics";
    }
    return "live-data";
  }

  if (path === "/options/quotes") {
    return "live-data";
  }

  if (
    path === "/positions" ||
    path === "/orders" ||
    path === "/accounts" ||
    /^\/accounts\/[^/]+\/(summary|positions|orders|risk)$/.test(path)
  ) {
    return "protected-position";
  }

  if (
    /^\/algo\/deployments\/[^/]+\/signal-options\/shadow-scan$/.test(path) ||
    /^\/algo\/deployments\/[^/]+\/overnight-spot\/scan$/.test(path)
  ) {
    return "automation-control";
  }

  if (
    /^\/algo\/deployments\/[^/]+\/signal-options\/shadow-backfill$/.test(
      path,
    ) ||
    /^\/algo\/deployments\/[^/]+\/signal-quality-kpis$/.test(path) ||
    path.includes("/watchlist-backtest/")
  ) {
    return "background-maintenance";
  }

  if (
    path === "/signal-monitor/matrix" ||
    path === "/signal-monitor/state" ||
    path === "/algo/events" ||
    /^\/algo\/deployments\/[^/]+\/cockpit$/.test(path) ||
    /^\/algo\/deployments\/[^/]+\/signal-options\/state$/.test(path) ||
    /^\/algo\/deployments\/[^/]+\/signal-options\/performance$/.test(path) ||
    path === "/diagnostics/latest" ||
    path === "/diagnostics/history" ||
    path === "/diagnostics/events" ||
    /^\/diagnostics\/events\/[^/]+$/.test(path) ||
    path === "/diagnostics/export" ||
    path === "/diagnostics/runtime" ||
    path === "/diagnostics/client-metrics" ||
    path === "/diagnostics/client-events" ||
    path === "/diagnostics/market-data/gex-universe-refresh" ||
    (method === "GET" && path === "/diagnostics/thresholds")
  ) {
    return "active-screen";
  }

  if (path === "/bars" || path === "/bars/batch") {
    if (isVisibleRouteRequestContext(routeContext)) {
      return "active-screen";
    }
    if (isDeferredRouteRequestContext(routeContext)) {
      return "deferred-analytics";
    }
  }

  if (massiveLiveDataPaths.has(path)) {
    if (isVisibleRouteRequestContext(routeContext)) {
      return "active-screen";
    }
    if (isDeferredRouteRequestContext(routeContext)) {
      return "deferred-analytics";
    }
    return "live-data";
  }

  if (
    path.startsWith("/diagnostics/") ||
    path === "/bars" ||
    path === "/bars/batch" ||
    path.startsWith("/options/") ||
    path.startsWith("/flow/")
  ) {
    return "deferred-analytics";
  }

  return "active-screen";
}

export function resolveApiRouteAdmission(input: {
  routeClass: ApiRouteClass;
  pressureLevel: ApiResourcePressureLevel;
  qaMode?: ApiRouteQaMode;
  now?: Date;
}): ApiRouteAdmission {
  const pressureLevel = input.pressureLevel;
  const routeClass = input.routeClass;
  const qaMode = input.qaMode ?? null;
  const admissionAction = routeAdmissionAction({
    routeClass,
    pressureLevel,
    qaMode,
  });
  const cacheOnly = admissionAction.action === "cache-only";
  const shed = admissionAction.action === "shed";

  return {
    routeClass,
    pressureLevel,
    action: admissionAction.action,
    degraded: cacheOnly || shed,
    stale: cacheOnly || shed,
    cacheOnly,
    reason: admissionAction.reason,
    statusCode: admissionAction.statusCode,
    retryAfterMs: admissionAction.retryAfterMs,
    qaMode,
    generatedAt: (input.now ?? new Date()).toISOString(),
  };
}

function readRequestQaMode(req: Request): ApiRouteQaMode {
  return (
    normalizeQaMode(req.get("x-pyrus-qa-mode")) ||
    normalizeQaMode(req.query["pyrusQa"]) ||
    normalizeQaMode(req.query["pyrusQaMode"]) ||
    normalizeQaMode(req.query["qaMode"])
  );
}

export function readApiRouteRequestContext(
  req: Request,
): ApiRouteRequestContext {
  return {
    requestFamily:
      req.get("x-pyrus-request-family") ??
      (typeof req.query["requestFamily"] === "string"
        ? req.query["requestFamily"]
        : typeof req.query["family"] === "string"
          ? req.query["family"]
          : null),
    fetchPriority: normalizeFetchPriority(
      req.get("x-pyrus-fetch-priority") ??
        (typeof req.query["fetchPriority"] === "string"
          ? req.query["fetchPriority"]
          : null),
    ),
    requestOrigin:
      req.get("x-pyrus-request-origin") ??
      (typeof req.query["requestOrigin"] === "string"
        ? req.query["requestOrigin"]
        : null),
    clientRole:
      req.get("x-pyrus-client-role") ??
      (typeof req.query["clientRole"] === "string"
        ? req.query["clientRole"]
        : null),
  };
}

export function apiRouteAdmissionMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const pressure = getApiResourcePressureSnapshot();
  const qaMode = readRequestQaMode(req);
  const admission = resolveApiRouteAdmission({
    routeClass: classifyApiRoute({
      method: req.method,
      path: req.originalUrl || req.url || req.path,
      ...readApiRouteRequestContext(req),
    }),
    // DB admission owns DB-pool pacing. Route shedding is a process-memory
    // emergency circuit only; DB, event-loop, and latency pressure stay telemetry
    // and cannot disable unrelated route families.
    pressureLevel: pressure.memoryResourceLevel,
    qaMode,
  });

  res.locals["apiRouteAdmission"] = admission;
  res.setHeader("X-Pyrus-Route-Class", admission.routeClass);
  // Pressure-Level = the memory-only level that governed admission.
  res.setHeader("X-Pyrus-Pressure-Level", admission.pressureLevel);
  // Resource-Level is consumed by the app as an actionable route/admission
  // signal, so keep it aligned with Pressure-Level. Preserve the wider
  // event-loop-inclusive resource signal under a diagnostic-only name.
  res.setHeader("X-Pyrus-Resource-Level", admission.pressureLevel);
  res.setHeader("X-Pyrus-Observed-Resource-Level", pressure.resourceLevel);
  res.setHeader("X-Pyrus-Admission-Action", admission.action);
  if (admission.qaMode) {
    res.setHeader("X-Pyrus-QA-Mode", admission.qaMode);
  }
  if (admission.degraded) {
    res.setHeader("X-Pyrus-Admission-Degraded", "1");
    res.setHeader("X-Pyrus-Admission-Reason", admission.reason ?? "degraded");
  }
  if (admission.retryAfterMs !== null) {
    res.setHeader(
      "Retry-After",
      String(Math.ceil(admission.retryAfterMs / 1000)),
    );
  }
  if (admission.action === "shed") {
    const statusCode = admission.statusCode ?? 503;
    if (statusCode === 204) {
      res.status(204).end();
      return;
    }
    res
      .status(statusCode)
      .type("application/problem+json")
      .json({
        type: "https://pyrus.local/problems/route-admission-shed",
        title: "Request shed by PYRUS route admission",
        status: statusCode,
        detail:
          admission.reason === "qa-safe-mode-shed"
            ? "Safe browser QA mode suppresses live streams, decorative requests, and deferred analytics."
            : "The API is under resource pressure and shed lower-priority work.",
        code: admission.reason,
        routeClass: admission.routeClass,
        pressureLevel: admission.pressureLevel,
        qaMode: admission.qaMode,
        generatedAt: admission.generatedAt,
      });
    return;
  }
  next();
}

export function getApiRouteAdmission(res: Response): ApiRouteAdmission {
  const value = res.locals["apiRouteAdmission"];
  return value && typeof value === "object"
    ? (value as ApiRouteAdmission)
    : {
        ...DEFAULT_ADMISSION,
        generatedAt: new Date().toISOString(),
      };
}

export function withRouteAdmissionMetadata<T>(
  payload: T,
  admission: ApiRouteAdmission,
): T {
  if (
    !admission.degraded ||
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload)
  ) {
    return payload;
  }

  const record = payload as Record<string, unknown>;
  return {
    ...record,
    degraded: true,
    stale: true,
    reason:
      typeof record["reason"] === "string" && record["reason"]
        ? record["reason"]
        : admission.reason,
    generatedAt:
      typeof record["generatedAt"] === "string"
        ? record["generatedAt"]
        : admission.generatedAt,
    partial: typeof record["partial"] === "boolean" ? record["partial"] : false,
  } as T;
}
