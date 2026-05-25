import { timingSafeEqual } from "node:crypto";
import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import {
  fetchMarketingShadowDashboardSnapshot,
  MARKETING_SHADOW_DASHBOARD_STREAM_INTERVAL_MS,
  subscribeMarketingShadowDashboardSnapshots,
  type MarketingShadowDashboardInput,
  type MarketingShadowDashboardPayload,
} from "../services/marketing-shadow-dashboard";

export const MARKETING_DASHBOARD_TOKEN_ENV = "PYRUS_MARKETING_DASHBOARD_TOKEN";
export const MARKETING_DASHBOARD_NEXT_TOKEN_ENV =
  "PYRUS_MARKETING_DASHBOARD_NEXT_TOKEN";
export const MARKETING_DASHBOARD_HEARTBEAT_MS = 20_000;

export type MarketingRouterDependencies = {
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  fetchSnapshot?: (
    input: MarketingShadowDashboardInput,
  ) => Promise<MarketingShadowDashboardPayload>;
  subscribeSnapshots?: typeof subscribeMarketingShadowDashboardSnapshots;
  heartbeatMs?: number;
  setInterval?: typeof setInterval;
  clearInterval?: typeof clearInterval;
};

function configuredTokens(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): string[] {
  return Array.from(
    new Set(
      [
        env[MARKETING_DASHBOARD_TOKEN_ENV],
        env[MARKETING_DASHBOARD_NEXT_TOKEN_ENV],
      ]
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter(Boolean),
    ),
  );
}

export function isMarketingDashboardConfigured(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): boolean {
  return configuredTokens(env).length > 0;
}

function readBearerToken(req: Request): string | null {
  const header = req.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function safeTokenEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

export function authorizeMarketingDashboardRequest(
  req: Request,
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): "authorized" | "disabled" | "unauthorized" {
  const tokens = configuredTokens(env);
  if (!tokens.length) {
    return "disabled";
  }
  const providedToken = readBearerToken(req);
  if (!providedToken) {
    return "unauthorized";
  }
  return tokens.some((token) => safeTokenEqual(providedToken, token))
    ? "authorized"
    : "unauthorized";
}

function sendAuthFailure(
  res: Response,
  result: "disabled" | "unauthorized",
) {
  if (result === "disabled") {
    res.status(404).json({
      title: "Not found",
      status: 404,
    });
    return;
  }

  res.setHeader("WWW-Authenticate", 'Bearer realm="marketing-dashboard"');
  res.status(401).json({
    title: "Unauthorized",
    status: 401,
  });
}

function writeSseEvent(res: Response, event: string, payload: unknown) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function asyncRoute(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<void>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res, next).catch(next);
  };
}

function dashboardInputFromQuery(req: Request): MarketingShadowDashboardInput {
  return {
    equityRange: req.query.equityRange,
    eventLimit: req.query.eventLimit,
  };
}

export function createMarketingRouter(
  dependencies: MarketingRouterDependencies = {},
): IRouter {
  const router: IRouter = Router();
  const env = dependencies.env ?? process.env;
  const fetchSnapshot =
    dependencies.fetchSnapshot ?? fetchMarketingShadowDashboardSnapshot;
  const subscribeSnapshots =
    dependencies.subscribeSnapshots ?? subscribeMarketingShadowDashboardSnapshots;
  const heartbeatMs = dependencies.heartbeatMs ?? MARKETING_DASHBOARD_HEARTBEAT_MS;
  const setHeartbeatInterval = dependencies.setInterval ?? setInterval;
  const clearHeartbeatInterval = dependencies.clearInterval ?? clearInterval;

  router.get(
    "/marketing/shadow-dashboard/snapshot",
    asyncRoute(async (req, res) => {
      const auth = authorizeMarketingDashboardRequest(req, env);
      if (auth !== "authorized") {
        sendAuthFailure(res, auth);
        return;
      }

      res.json(await fetchSnapshot(dashboardInputFromQuery(req)));
    }),
  );

  router.get(
    "/marketing/shadow-dashboard/stream",
    asyncRoute(async (req, res) => {
      const auth = authorizeMarketingDashboardRequest(req, env);
      if (auth !== "authorized") {
        sendAuthFailure(res, auth);
        return;
      }

      const input = dashboardInputFromQuery(req);
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders?.();
      res.write("retry: 5000\n\n");

      let closed = false;
      let unsubscribe = () => {};
      let heartbeat: ReturnType<typeof setInterval> | null = null;
      const cleanup = () => {
        if (closed) {
          return;
        }
        closed = true;
        unsubscribe();
        if (heartbeat) {
          clearHeartbeatInterval(heartbeat);
          heartbeat = null;
        }
        if (!res.destroyed) {
          res.end();
        }
      };
      req.on("aborted", cleanup);
      res.on("close", cleanup);

      try {
        const initialPayload = await fetchSnapshot(input);
        if (closed) {
          return;
        }
        writeSseEvent(res, "snapshot", initialPayload);
        writeSseEvent(res, "ready", {
          stream: "marketing-shadow-dashboard",
          mode: "paper",
          source: "shadow-ledger",
          at: new Date().toISOString(),
        });
        heartbeat = setHeartbeatInterval(() => {
          if (!closed) {
            res.write(": ping\n\n");
          }
        }, heartbeatMs);
        heartbeat.unref?.();
        unsubscribe = subscribeSnapshots(
          input,
          (payload) => {
            if (!closed) {
              writeSseEvent(res, "snapshot", payload);
            }
          },
          {
            initialPayload,
            fetchSnapshot,
            intervalMs: MARKETING_SHADOW_DASHBOARD_STREAM_INTERVAL_MS,
          },
        );
      } catch (error) {
        if (!closed) {
          writeSseEvent(res, "error", {
            title: "Marketing shadow dashboard stream setup failed",
            status: 500,
            detail:
              error instanceof Error
                ? error.message
                : "Unknown stream error.",
          });
        }
        cleanup();
      }
    }),
  );

  return router;
}

export default createMarketingRouter();
