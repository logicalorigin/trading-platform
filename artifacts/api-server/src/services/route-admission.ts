import type { NextFunction, Request, Response } from "express";
import {
  getApiResourcePressureSnapshot,
  type ApiResourcePressureLevel,
} from "./resource-pressure";

export type ApiRouteClass =
  | "critical-execution"
  | "critical-position"
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
  String(value || "").trim().toLowerCase() === "safe" ? "safe" : null;

const normalizeRouteContextValue = (value: unknown): string => {
  const normalized = String(value || "").trim().toLowerCase();
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
  "chart-visible",
  "flow-visible",
  "flow-scanner-visible",
  "flow-tape-visible",
  "option-chart-visible",
  "signal-matrix",
  "signals-table-sparkline",
  "trade-visible",
]);
const chartRequestFamilies = new Set([
  "chart-bars",
  "option-chart-bars",
]);
const deferredRequestFamilies = new Set([
  "chart-backfill",
  "chart-flow",
  "background",
  "analytics",
  "scanner",
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
  if (
    chartRequestFamilies.has(context.requestFamily) &&
    (context.fetchPriority ?? 0) >= 6
  ) {
    return true;
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

  if (input.pressureLevel === "critical") {
    if (
      input.routeClass === "automation-control" ||
      input.routeClass === "live-data" ||
      input.routeClass === "stream" ||
      input.routeClass === "decorative" ||
      input.routeClass === "deferred-analytics" ||
      input.routeClass === "background-maintenance"
    ) {
      return {
        action: "shed",
        reason: "api-resource-pressure-critical",
        statusCode: input.routeClass === "decorative" ? 204 : 503,
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
  const mode = String(query.get("mode") || query.get("environment") || "").toLowerCase();
  const routeContext = normalizeRouteRequestContext({
    requestFamily:
      input.requestFamily ??
      query.get("requestFamily") ??
      query.get("family"),
    fetchPriority:
      input.fetchPriority ?? normalizeFetchPriority(query.get("fetchPriority")),
    requestOrigin: input.requestOrigin ?? query.get("requestOrigin"),
    clientRole: input.clientRole ?? query.get("clientRole"),
  });

  if (
    path === "/orders/submit" ||
    path === "/orders/preview" ||
    /^\/orders\/[^/]+\/(replace|cancel)$/.test(path) ||
    path === "/orders" && method === "POST" ||
    path === "/shadow/orders/preview" ||
    path === "/shadow/orders" ||
    /^\/accounts\/[^/]+\/orders\/[^/]+\/cancel$/.test(path)
  ) {
    return "critical-execution";
  }

  if (path.startsWith("/streams/") || path.endsWith("/stream")) {
    return "stream";
  }

  if (path === "/universe/logos" || path === "/universe/logo-proxy") {
    return "decorative";
  }

  if (
    method === "GET" &&
    mode === "live" &&
    (path === "/positions" ||
      path === "/orders" ||
      /^\/accounts\/[^/]+\/(summary|positions|positions-at-date|orders|risk|allocation|equity-history|closed-trades|cash-activity)$/.test(path))
  ) {
    return "live-data";
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

  if (path === "/options/quotes" || path === "/market-depth") {
    return "live-data";
  }

  if (
    path === "/positions" ||
    path === "/orders" ||
    path === "/accounts" ||
    /^\/accounts\/[^/]+\/(summary|positions|orders|risk)$/.test(path)
  ) {
    return "critical-position";
  }

  if (
    /^\/algo\/deployments\/[^/]+\/signal-options\/shadow-scan$/.test(path) ||
    /^\/algo\/deployments\/[^/]+\/overnight-spot\/scan$/.test(path)
  ) {
    return "automation-control";
  }

  if (
    /^\/algo\/deployments\/[^/]+\/signal-options\/shadow-backfill$/.test(path) ||
    path.includes("/watchlist-backtest/")
  ) {
    return "background-maintenance";
  }

  if (
    path === "/signal-monitor/matrix" ||
    path === "/signal-monitor/state" ||
    path === "/diagnostics/latest" ||
    path === "/diagnostics/runtime" ||
    path === "/diagnostics/client-metrics" ||
    path === "/diagnostics/market-data/gex-universe-refresh" ||
    (method === "GET" && path === "/diagnostics/thresholds")
  ) {
    return "active-screen";
  }

  if (
    path === "/bars" ||
    path === "/bars/batch" ||
    path === "/options/chart-bars" ||
    path === "/options/chains" ||
    path === "/options/expirations" ||
    path === "/flow/events" ||
    path === "/flow/events/aggregate" ||
    path === "/flow/premium-distribution" ||
    path === "/flow/universe"
  ) {
    if (isVisibleRouteRequestContext(routeContext)) {
      return "active-screen";
    }
    if (isDeferredRouteRequestContext(routeContext)) {
      return "deferred-analytics";
    }
  }

  if (
    path.startsWith("/diagnostics/") ||
    path === "/bars" ||
    path === "/bars/batch" ||
    path.startsWith("/options/") ||
    path.startsWith("/flow/") ||
    (/^\/algo\/deployments\/[^/]+\/signal-options\/state$/.test(path) &&
      query.get("view") === "full") ||
    (/^\/algo\/deployments\/[^/]+\/cockpit$/.test(path) &&
      query.get("view") === "full") ||
    (path === "/algo/events" && query.get("includePayload") === "true") ||
    (path === "/algo/events" && query.get("view") === "full") ||
    /^\/algo\/deployments\/[^/]+\/signal-options\/performance$/.test(path)
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

function readRequestContext(req: Request): ApiRouteRequestContext {
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
      ...readRequestContext(req),
    }),
    pressureLevel: pressure.level,
    qaMode,
  });

  res.locals["apiRouteAdmission"] = admission;
  res.setHeader("X-Pyrus-Route-Class", admission.routeClass);
  res.setHeader("X-Pyrus-Pressure-Level", admission.pressureLevel);
  res.setHeader("X-Pyrus-Admission-Action", admission.action);
  if (admission.qaMode) {
    res.setHeader("X-Pyrus-QA-Mode", admission.qaMode);
  }
  if (admission.degraded) {
    res.setHeader("X-Pyrus-Admission-Degraded", "1");
    res.setHeader("X-Pyrus-Admission-Reason", admission.reason ?? "degraded");
  }
  if (admission.retryAfterMs !== null) {
    res.setHeader("Retry-After", String(Math.ceil(admission.retryAfterMs / 1000)));
  }
  if (admission.action === "shed") {
    const statusCode = admission.statusCode ?? 503;
    if (statusCode === 204) {
      res.status(204).end();
      return;
    }
    res.status(statusCode).type("application/problem+json").json({
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
    partial:
      typeof record["partial"] === "boolean" ? record["partial"] : false,
  } as T;
}
