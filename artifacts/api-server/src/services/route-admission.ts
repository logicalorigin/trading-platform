import type { NextFunction, Request, Response } from "express";
import {
  getApiResourcePressureSnapshot,
  type ApiResourcePressureLevel,
} from "./resource-pressure";

export type ApiRouteClass =
  | "critical-execution"
  | "critical-position"
  | "active-screen"
  | "live-data"
  | "stream"
  | "decorative"
  | "deferred-analytics"
  | "background-maintenance";

export type ApiRouteAdmissionAction = "allow" | "cache-only" | "shed";
export type ApiRouteQaMode = "safe" | null;

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

  if (input.pressureLevel === "critical") {
    if (
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

  if (input.pressureLevel === "high") {
    if (
      input.routeClass === "stream" ||
      input.routeClass === "decorative" ||
      input.routeClass === "background-maintenance"
    ) {
      return {
        action: "shed",
        reason: "api-resource-pressure-high",
        statusCode: input.routeClass === "decorative" ? 204 : 503,
        retryAfterMs: 10_000,
      };
    }
    if (input.routeClass === "deferred-analytics") {
      return {
        action: "cache-only",
        reason: "api-resource-pressure-high",
        statusCode: null,
        retryAfterMs: null,
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
}): ApiRouteClass {
  const method = String(input.method || "GET").toUpperCase();
  const rawPath = String(input.path || "/");
  const path = normalizePath(rawPath);
  const query = queryParamsForPath(rawPath);
  const mode = String(query.get("mode") || query.get("environment") || "").toLowerCase();

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

  if (
    path === "/quotes/snapshot" ||
    path === "/options/quotes" ||
    path === "/market-depth"
  ) {
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
    /^\/algo\/deployments\/[^/]+\/signal-options\/shadow-(scan|backfill)$/.test(path) ||
    path.includes("/watchlist-backtest/")
  ) {
    return "background-maintenance";
  }

  if (
    path === "/diagnostics/latest" ||
    path.startsWith("/diagnostics/") ||
    path === "/signal-monitor/matrix" ||
    path === "/signal-monitor/state" ||
    path === "/bars" ||
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
