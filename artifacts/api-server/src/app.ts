import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { isHttpError } from "./lib/errors";
import { logger } from "./lib/logger";

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

app.use((req, _res, next) => {
  (req as { _startTime?: number })._startTime = Date.now();
  next();
});
app.use(
  pinoHttp({
    logger,
    customLogLevel(req, res, err) {
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
app.use(express.json());
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
