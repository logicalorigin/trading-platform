import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import {
  DbAdmissionTimeoutError,
  runWithDbAdmissionSignal,
  runWithPostgresDiagnosticContext,
  type PostgresDiagnosticContext,
} from "@workspace/db";
import router from "./routes";
import { isHttpError } from "./lib/errors";
import { logger } from "./lib/logger";
import { resolveApiRequestLogLevel } from "./lib/request-logging";
import { recordApiRequest } from "./services/request-metrics";
import {
  apiRouteAdmissionMiddleware,
  getApiRouteAdmission,
  readApiRouteRequestContext,
} from "./services/route-admission";
import { isRawJson } from "./lib/raw-json";
import { readSessionToken } from "./routes/auth";
import {
  getIbkrGatewayReanchorLocation,
  IBKR_PORTAL_CLIENT_MOUNT,
} from "./routes/ibkr-portal";
import { mountIbkrGatewayHostLifecycleRoutes } from "./routes/ibkr-gateway-hosts";
import { readAuthSessionFromToken } from "./services/auth";
import { runAsAppUser } from "./services/app-user-context";
import { runWithIbkrPortalUser } from "./services/ibkr-portal-context";

const app: Express = express();
app.disable("x-powered-by");

const CORS_ALLOWED_METHODS = ["GET", "HEAD", "POST", "OPTIONS"];

function normalizeConfiguredCorsOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    const loopback =
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "[::1]";
    if (
      (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function configuredCorsOrigins(): Set<string> {
  return new Set(
    (process.env["PYRUS_CORS_ALLOWED_ORIGINS"] ?? "")
      .split(",")
      .map((value) => normalizeConfiguredCorsOrigin(value.trim()))
      .filter((value): value is string => Boolean(value)),
  );
}

function requestDiagnosticId(requestId: unknown): string | null {
  if (typeof requestId === "string" || typeof requestId === "number") {
    return String(requestId);
  }
  return null;
}

function applyBaselineSecurityHeaders(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=()",
  );
  res.setHeader("X-Permitted-Cross-Domain-Policies", "none");
  res.setHeader(
    "Content-Security-Policy",
    "base-uri 'self'; object-src 'none'; frame-ancestors 'self'",
  );
  if (req.path === "/api" || req.path.startsWith("/api/")) {
    res.setHeader("Cache-Control", "no-store");
  }
  if (
    process.env["NODE_ENV"] === "production" &&
    process.env["PYRUS_SERVE_WEB"] === "1"
  ) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000");
  }
  next();
}

type ZodIssueLike = {
  message?: unknown;
};

type ZodErrorLike = {
  name: string;
  issues?: unknown;
};

function isZodError(error: unknown): error is ZodErrorLike {
  return Boolean(
    error &&
      typeof error === "object" &&
      (error as ZodErrorLike).name === "ZodError" &&
      Array.isArray((error as ZodErrorLike).issues),
  );
}

function isPayloadTooLargeError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as {
    name?: unknown;
    status?: unknown;
    statusCode?: unknown;
    type?: unknown;
  };
  return (
    (value.status === 413 || value.statusCode === 413) &&
    (value.name === "PayloadTooLargeError" || value.type === "entity.too.large")
  );
}

function applyIsolationHeaders(_req: express.Request, res: express.Response, next: express.NextFunction) {
  const mode =
    process.env["PYRUS_CROSS_ORIGIN_ISOLATION"] ?? "report-only";
  const coop = process.env["PYRUS_COOP_POLICY"] ?? "same-origin";
  const coep = process.env["PYRUS_COEP_POLICY"] ?? "require-corp";
  res.setHeader("Reporting-Endpoints", 'pyrus="/api/diagnostics/browser-reports"');
  if (mode === "off") {
    next();
    return;
  }
  if (mode.startsWith("enforce")) {
    res.setHeader("Cross-Origin-Opener-Policy", coop);
    res.setHeader(
      "Cross-Origin-Embedder-Policy",
      mode === "enforce-credentialless" ? "credentialless" : coep,
    );
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  } else {
    res.setHeader("Cross-Origin-Opener-Policy-Report-Only", `${coop}; report-to="pyrus"`);
    res.setHeader("Cross-Origin-Embedder-Policy-Report-Only", `${coep}; report-to="pyrus"`);
  }
  next();
}

function runWithRequestDbAdmissionSignal(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
): void {
  const controller = new AbortController();
  const abort = () => {
    if (!controller.signal.aborted) {
      controller.abort();
    }
  };
  const cleanup = () => {
    req.off("aborted", abort);
    res.off("finish", cleanup);
    res.off("close", close);
  };
  const close = () => {
    if (!res.writableEnded) {
      abort();
    }
    cleanup();
  };

  if (req.aborted) {
    abort();
  } else {
    req.once("aborted", abort);
    res.once("finish", cleanup);
    res.once("close", close);
  }
  runWithDbAdmissionSignal(controller.signal, next);
}

// Gzip large JSON API responses. Some payloads are multi-MB uncompressed (e.g.
// the full GEX option chain, ~3.5 MB for SPY); gzip cuts that ~88% on the wire
// with zero data loss. Scoped to res.json so streaming responses (SSE via
// res.write) are never buffered. gzip runs async so the event loop stays free;
// small bodies and clients that don't accept gzip pass straight through.
const GZIP_JSON_MIN_BYTES = 1024;
function gzipJsonResponses(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) {
  const acceptsGzip = /\bgzip\b/i.test(
    String(req.headers["accept-encoding"] ?? ""),
  );
  const isHead = req.method === "HEAD";
  const originalJson = res.json.bind(res);
  const gzipSend = (payload: string): express.Response => {
    res.vary("Accept-Encoding");
    zlib.gzip(payload, { level: 5 }, (error, compressed) => {
      if (res.headersSent) {
        return;
      }
      if (error) {
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(payload);
        return;
      }
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Content-Encoding", "gzip");
      res.setHeader("Content-Length", String(compressed.length));
      res.end(compressed);
    });
    return res;
  };
  res.json = (body?: unknown): express.Response => {
    if (res.headersSent || res.getHeader("Content-Encoding")) {
      return originalJson(body);
    }
    // Pre-serialized payloads (the cached /signal-monitor/state poll) skip a second
    // JSON.stringify of a multi-MB body — express can't serialize the wrapper, so it
    // must be sent here for both gzip and non-gzip clients.
    if (isRawJson(body)) {
      const payload = body.value;
      if (!isHead && acceptsGzip && Buffer.byteLength(payload) >= GZIP_JSON_MIN_BYTES) {
        return gzipSend(payload);
      }
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(isHead ? undefined : payload);
      return res;
    }
    // Normal bodies keep express's exact behavior; only large bodies on gzip-capable
    // (non-HEAD) clients are intercepted to compress.
    if (!acceptsGzip || isHead) {
      return originalJson(body);
    }
    let payload: string;
    try {
      payload = JSON.stringify(body);
    } catch {
      return originalJson(body);
    }
    if (Buffer.byteLength(payload) < GZIP_JSON_MIN_BYTES) {
      return originalJson(body);
    }
    return gzipSend(payload);
  };
  next();
}

app.use((req, _res, next) => {
  (req as { _startTime?: number })._startTime = Date.now();
  next();
});
app.use(applyBaselineSecurityHeaders);
app.use(applyIsolationHeaders);
app.use((req, res, next) => {
  const startedAt = Date.now();
  res.on("finish", () => {
    const admission = getApiRouteAdmission(res);
    const requestContext = readApiRouteRequestContext(req);
    recordApiRequest({
      method: req.method,
      path: req.path || req.url?.split("?")[0] || "/",
      routeClass: admission.routeClass,
      requestFamily: requestContext.requestFamily,
      fetchPriority: requestContext.fetchPriority,
      requestOrigin: requestContext.requestOrigin,
      clientRole: requestContext.clientRole,
      statusCode: res.statusCode,
      durationMs: Date.now() - startedAt,
    });
  });
  next();
});
app.use(
  pinoHttp({
    logger,
    customLogLevel(req, res, err) {
      const start = (req as { _startTime?: number })._startTime;
      return resolveApiRequestLogLevel({
        url: req.url,
        statusCode: res.statusCode,
        responseTimeMs: start ? Date.now() - start : 0,
        err,
      });
    },
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
// Host lifecycle requests are HMAC-authenticated over their exact raw bytes.
// Keep this terminal internal boundary ahead of browser CORS and JSON parsing.
mountIbkrGatewayHostLifecycleRoutes(app);
app.use((req, res, next) => {
  if (req.headers.origin) res.vary("Origin");
  next();
});
app.use(
  cors({
    origin(origin, callback) {
      callback(
        null,
        origin && configuredCorsOrigins().has(origin) ? origin : false,
      );
    },
    methods: CORS_ALLOWED_METHODS,
    allowedHeaders: ["Authorization", "Content-Type", "X-CSRF-Token"],
    maxAge: 600,
  }),
);

// Re-anchor the Client Portal's root-absolute credential POST before any body
// parser touches it. The 307 preserves its bytes for the bounded raw proxy.
app.use((req, res, next) => {
  const location = getIbkrGatewayReanchorLocation(
    req.originalUrl,
    req.headers.referer,
  );
  if (!location) {
    next();
    return;
  }
  res.redirect(307, location);
});
app.use(
  IBKR_PORTAL_CLIENT_MOUNT,
  express.raw({ type: () => true, limit: "256kb" }),
);
app.use(express.json({ type: ["application/json", "application/reports+json"] }));
app.use(express.urlencoded({ extended: true }));
app.use(runWithRequestDbAdmissionSignal);
app.use(apiRouteAdmissionMiddleware);
app.use((req, res, next) => {
  const admission = getApiRouteAdmission(res);
  const requestContext = readApiRouteRequestContext(req);
  const path = req.path || req.originalUrl?.split("?")[0] || req.url?.split("?")[0] || "/";
  const requestId = (req as { id?: unknown }).id;
  const context: PostgresDiagnosticContext = {
    requestId: requestDiagnosticId(requestId),
    method: req.method,
    path,
    route: `${req.method} ${path}`,
    routeClass: admission.routeClass,
    requestFamily: requestContext.requestFamily,
    clientRole: requestContext.clientRole,
    fetchPriority: requestContext.fetchPriority,
    requestOrigin: requestContext.requestOrigin,
    admissionAction: admission.action,
    workloadFamily: admission.routeClass,
  };
  runWithPostgresDiagnosticContext(context, next);
});
// Bind the authenticated app user to the request so IBKR calls can route to
// that user's hosted Client Portal gateway (getIbkrClientPortalClient). Only a
// read-only, indexed session lookup, and only when a session cookie is present.
app.use((req, _res, next) => {
  const token = readSessionToken(req);
  if (!token) {
    next();
    return;
  }
  readAuthSessionFromToken(token)
    .then((session) => {
      if (session) {
        runAsAppUser(session.user.id, () =>
          runWithIbkrPortalUser(session.user.id, next),
        );
      } else {
        next();
      }
    })
    .catch(() => next());
});
app.use(gzipJsonResponses);

app.use("/api", router);

if (process.env["PYRUS_SERVE_WEB"] === "1") {
  const webPublicDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../pyrus/dist/public",
  );
  const indexHtml = path.join(webPublicDir, "index.html");

  app.use(express.static(webPublicDir, { index: false }));
  app.get(/^(?!\/api(?:\/|$)).*/, (req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      next();
      return;
    }
    res.sendFile(indexHtml);
  });
}

export function apiErrorHandler(
  error: unknown,
  _req: express.Request,
  res: express.Response,
  _next: express.NextFunction,
) {
  if (res.headersSent || _req.aborted || res.destroyed) {
    return;
  }

  if (isPayloadTooLargeError(error)) {
    res.status(413).type("application/problem+json").json({
      type: "https://pyrus.local/problems/payload-too-large",
      title: "Payload too large",
      status: 413,
      detail: "The request body exceeds the allowed size.",
    });
    return;
  }

  if (isZodError(error)) {
    const issues = (error.issues as unknown[]).map((issue) => issue as ZodIssueLike);

    res.status(400).type("application/problem+json").json({
      type: "https://pyrus.local/problems/invalid-request",
      title: "Invalid request",
      status: 400,
      detail: issues
        .map((issue) => (typeof issue.message === "string" ? issue.message : "Invalid input"))
        .join("; "),
      errors: issues,
    });
    return;
  }

  if (error instanceof DbAdmissionTimeoutError) {
    res.setHeader("Retry-After", String(error.retryAfterSeconds));
    res.status(503).type("application/problem+json").json({
      type: "https://pyrus.local/problems/database-admission-timeout",
      title: "Database temporarily unavailable",
      status: 503,
      detail:
        "Database capacity is temporarily unavailable. Retry the request.",
      code: error.code,
      kind: error.kind,
      lane: error.lane,
    });
    return;
  }

  if (isHttpError(error)) {
    if (error.statusCode >= 500) {
      logger.error(
        error.expose
          ? { err: error }
          : { statusCode: error.statusCode, code: error.code },
        "Request failed",
      );
    }

    const problem: {
      type: string;
      title: string;
      status: number;
      detail?: string;
      code?: string;
      data?: unknown;
    } = {
      type: "https://pyrus.local/problems/upstream",
      title: error.expose ? error.message : "Request failed",
      status: error.statusCode,
      detail: error.expose ? error.detail : undefined,
      code: error.code,
    };
    if (error.expose && error.data !== undefined) {
      problem.data = error.data;
    }

    res.status(error.statusCode).type("application/problem+json").json(problem);
    return;
  }

  logger.error({ err: error }, "Unhandled request error");

  res.status(500).type("application/problem+json").json({
    type: "https://pyrus.local/problems/internal-server-error",
    title: "Internal server error",
    status: 500,
    detail: "The API server hit an unexpected error.",
  });
}

app.use(apiErrorHandler);

export const __httpBoundaryInternalsForTests = {
  gzipJsonResponses,
  runWithRequestDbAdmissionSignal,
};

export default app;
