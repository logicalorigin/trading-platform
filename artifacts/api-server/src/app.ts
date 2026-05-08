import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { isHttpError } from "./lib/errors";
import { logger } from "./lib/logger";
import { recordApiRequest } from "./services/diagnostics";

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
  const mode = process.env["RAYALGO_CROSS_ORIGIN_ISOLATION"] || "report-only";
  const coop = process.env["RAYALGO_COOP_POLICY"] || "same-origin";
  const coep = process.env["RAYALGO_COEP_POLICY"] || "require-corp";
  res.setHeader("Reporting-Endpoints", 'rayalgo="/api/diagnostics/browser-reports"');
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
    res.setHeader("Cross-Origin-Opener-Policy-Report-Only", `${coop}; report-to="rayalgo"`);
    res.setHeader("Cross-Origin-Embedder-Policy-Report-Only", `${coep}; report-to="rayalgo"`);
  }
  next();
}

function isLongLivedStreamRequest(req: express.Request): boolean {
  return Boolean(
    req.url?.startsWith("/api/streams/") ||
      req.url?.startsWith("/api/diagnostics/stream"),
  );
}

function isExpectedStreamClose(
  req: express.Request,
  res: express.Response,
  err: Error | undefined,
): boolean {
  if (!isLongLivedStreamRequest(req) || res.statusCode >= 500) {
    return false;
  }
  if (!err) {
    return true;
  }
  return /abort|close|premature/i.test(err.message);
}

app.use((req, _res, next) => {
  (req as { _startTime?: number })._startTime = Date.now();
  next();
});
app.use(applyIsolationHeaders);
app.use((req, res, next) => {
  const startedAt = Date.now();
  res.on("finish", () => {
    recordApiRequest({
      method: req.method,
      path: req.path || req.url?.split("?")[0] || "/",
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
      if (isExpectedStreamClose(req, res, err)) return "silent";
      if (err || res.statusCode >= 500) return "error";
      if (res.statusCode >= 400) return "warn";
      const start = (req as { _startTime?: number })._startTime;
      const responseTime = start ? Date.now() - start : 0;
      if (responseTime >= 1000) return "warn";
      if (req.url?.startsWith("/healthz")) return "silent";
      return "info";
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
app.use(cors());
app.use(express.json({ type: ["application/json", "application/reports+json"] }));
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (res.headersSent) {
    return;
  }

  if (isZodError(error)) {
    const issues = (error.issues as unknown[]).map((issue) => issue as ZodIssueLike);

    res.status(400).type("application/problem+json").json({
      type: "https://rayalgo.local/problems/invalid-request",
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

    res.status(error.statusCode).type("application/problem+json").json({
      type: "https://rayalgo.local/problems/upstream",
      title: error.message,
      status: error.statusCode,
      detail: error.detail,
      code: error.code,
    });
    return;
  }

  logger.error({ err: error }, "Unhandled request error");

  res.status(500).type("application/problem+json").json({
    type: "https://rayalgo.local/problems/internal-server-error",
    title: "Internal server error",
    status: 500,
    detail: "The API server hit an unexpected error.",
  });
});

export default app;
