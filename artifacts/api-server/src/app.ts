import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
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
import { recordIbkrRemoteDesktopRawRequestAttempt } from "./services/ibkr-bridge-runtime";

const app: Express = express();

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
  if (!acceptsGzip || req.method === "HEAD") {
    next();
    return;
  }
  const originalJson = res.json.bind(res);
  res.json = (body?: unknown): express.Response => {
    if (res.headersSent || res.getHeader("Content-Encoding")) {
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
    res.setHeader("Vary", "Accept-Encoding");
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
  next();
}

app.use((req, _res, next) => {
  (req as { _startTime?: number })._startTime = Date.now();
  next();
});
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
app.use((req, _res, next) => {
  const path = req.originalUrl?.split("?")[0] || req.url?.split("?")[0] || "/";
  const normalized = path.toLowerCase();
  if (
    normalized.includes("ibkr") &&
    (normalized.includes("desktop") ||
      normalized.includes("agent") ||
      normalized.includes("job"))
  ) {
    recordIbkrRemoteDesktopRawRequestAttempt({
      contentType: req.get("content-type") ?? null,
      method: req.method,
      path,
      userAgent: req.get("user-agent") ?? null,
    });
  }
  next();
});
app.use(cors());
app.use(express.json({ type: ["application/json", "application/reports+json"] }));
app.use(express.urlencoded({ extended: true }));
app.use(apiRouteAdmissionMiddleware);
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

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (res.headersSent) {
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

  if (isHttpError(error)) {
    if (error.statusCode >= 500) {
      logger.error({ err: error }, "Request failed");
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
      title: error.message,
      status: error.statusCode,
      detail: error.detail,
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
});

export default app;
