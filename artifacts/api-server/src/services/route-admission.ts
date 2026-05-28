import type { NextFunction, Request, Response } from "express";
import {
  getApiResourcePressureSnapshot,
  type ApiResourcePressureLevel,
} from "./resource-pressure";

export type ApiRouteClass =
  | "critical-execution"
  | "critical-position"
  | "active-screen"
  | "deferred-analytics"
  | "background-maintenance";

export type ApiRouteAdmission = {
  routeClass: ApiRouteClass;
  pressureLevel: ApiResourcePressureLevel;
  degraded: boolean;
  stale: boolean;
  cacheOnly: boolean;
  reason: string | null;
  generatedAt: string;
};

const DEFAULT_ADMISSION: ApiRouteAdmission = {
  routeClass: "active-screen",
  pressureLevel: "normal",
  degraded: false,
  stale: false,
  cacheOnly: false,
  reason: null,
  generatedAt: new Date(0).toISOString(),
};

const normalizePath = (path: string) => {
  const withoutQuery = path.split("?")[0] || "/";
  return withoutQuery.startsWith("/api/")
    ? withoutQuery.slice(4)
    : withoutQuery === "/api"
      ? "/"
      : withoutQuery;
};

export function classifyApiRoute(input: {
  method?: string | null;
  path?: string | null;
}): ApiRouteClass {
  const method = String(input.method || "GET").toUpperCase();
  const path = normalizePath(String(input.path || "/"));

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
    /^\/algo\/deployments\/[^/]+\/(cockpit|signal-options\/(state|performance))$/.test(path)
  ) {
    return "deferred-analytics";
  }

  return "active-screen";
}

export function resolveApiRouteAdmission(input: {
  routeClass: ApiRouteClass;
  pressureLevel: ApiResourcePressureLevel;
  now?: Date;
}): ApiRouteAdmission {
  const pressureLevel = input.pressureLevel;
  const routeClass = input.routeClass;
  const pressureRequiresCache =
    pressureLevel === "high" || pressureLevel === "critical";
  const analyticsRoute =
    routeClass === "deferred-analytics" ||
    routeClass === "background-maintenance";
  const cacheOnly = pressureRequiresCache && analyticsRoute;

  return {
    routeClass,
    pressureLevel,
    degraded: cacheOnly,
    stale: cacheOnly,
    cacheOnly,
    reason: cacheOnly ? `api-resource-pressure-${pressureLevel}` : null,
    generatedAt: (input.now ?? new Date()).toISOString(),
  };
}

export function apiRouteAdmissionMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const pressure = getApiResourcePressureSnapshot();
  const admission = resolveApiRouteAdmission({
    routeClass: classifyApiRoute({
      method: req.method,
      path: req.path || req.url,
    }),
    pressureLevel: pressure.level,
  });

  res.locals["apiRouteAdmission"] = admission;
  res.setHeader("X-Pyrus-Route-Class", admission.routeClass);
  res.setHeader("X-Pyrus-Pressure-Level", admission.pressureLevel);
  if (admission.degraded) {
    res.setHeader("X-Pyrus-Admission-Degraded", "1");
    res.setHeader("X-Pyrus-Admission-Reason", admission.reason ?? "degraded");
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
