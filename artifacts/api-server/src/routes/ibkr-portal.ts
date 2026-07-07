import {
  Router,
  type IRouter,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { appendFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import path from "node:path";

import {
  ConnectIbkrPortalResponse,
  DisconnectIbkrPortalResponse,
  GetIbkrPortalReadinessResponse,
  GetIbkrPortalStatusResponse,
} from "@workspace/api-zod";

import { requireUser, requireUserCsrf } from "./auth";
import { HttpError } from "../lib/errors";
import type { AuthenticatedSession } from "../services/auth";
import {
  ENTITLEMENTS,
  isIbkrMemberConnectEnabled,
  sessionHasEntitlement,
} from "../services/entitlements";
import { recordAuditEvent } from "../services/audit-events";
import {
  connectPortal,
  disconnectPortal,
  getPortalStatus,
  readPortalReadiness,
} from "../services/ibkr-portal-session";
import { getGateway } from "../services/ibkr-portal-gateway-manager";
import { findRepoRoot } from "../services/runtime-flight-recorder";

const router: IRouter = Router();

const GW_BASE = "/api/broker-execution/ibkr-portal/gateway";

export function getIbkrGatewayReanchorLocation(
  requestPath: string,
  referer: string | undefined,
): string | null {
  if (!referer || requestPath.startsWith(GW_BASE)) {
    return null;
  }
  try {
    if (!new URL(referer).pathname.startsWith(GW_BASE)) {
      return null;
    }
  } catch {
    return null;
  }

  const fixed = requestPath.startsWith("/api/")
    ? "/sso/" + requestPath.slice("/api/".length)
    : requestPath;
  return GW_BASE + fixed;
}

function reanchorGatewayEscapes(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const location = getIbkrGatewayReanchorLocation(
    req.originalUrl,
    req.headers.referer,
  );
  if (!location) {
    next();
    return;
  }
  res.redirect(307, location);
}

router.use(reanchorGatewayEscapes);

// DEBUG TRAIL (diagnosing popup login failures): one JSONL line per proxied
// request — method + path only (query strings stripped so SSO tokens and
// login params never land on disk), upstream status, and timing.
const TRAIL_PATH = path.join(
  findRepoRoot(),
  ".pyrus-runtime",
  "ibkr-portal-proxy-trail.jsonl",
);
function trace(entry: Record<string, unknown>): void {
  try {
    appendFileSync(
      TRAIL_PATH,
      JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n",
    );
  } catch {
    // diagnostics only — never disturb the proxy
  }
}

// Slice 7 (SPEC §6): the IBKR Client Portal stays OFF for members until the IBKR
// ToS/OAuth-approval question clears. Admins bypass; a member needs BOTH the
// kill-switch flag (IBKR_MEMBER_CONNECT_ENABLED) AND the `ibkr_access` entitlement.
function assertIbkrPortalAccess(session: AuthenticatedSession): void {
  if (session.user.role === "admin") return;
  if (
    isIbkrMemberConnectEnabled() &&
    sessionHasEntitlement(session, ENTITLEMENTS.IBKR_ACCESS)
  ) {
    return;
  }
  throw new HttpError(403, "IBKR connections are not available.", {
    code: "ibkr_member_connect_disabled",
  });
}

async function requireIbkrPortalAccess(
  req: Request,
): Promise<AuthenticatedSession> {
  const session = await requireUser(req);
  assertIbkrPortalAccess(session);
  return session;
}

async function requireIbkrPortalAccessCsrf(
  req: Request,
): Promise<AuthenticatedSession> {
  const session = await requireUserCsrf(req);
  assertIbkrPortalAccess(session);
  return session;
}

router.get("/broker-execution/ibkr-portal/readiness", async (req, res) => {
  const session = await requireIbkrPortalAccess(req);
  const data = GetIbkrPortalReadinessResponse.parse(
    await readPortalReadiness(session.user.id),
  );
  res.json(data);
});

router.get("/broker-execution/ibkr-portal/status", async (req, res) => {
  const session = await requireIbkrPortalAccess(req);
  const data = GetIbkrPortalStatusResponse.parse(
    await getPortalStatus(session.user.id),
  );
  res.json(data);
});

router.post("/broker-execution/ibkr-portal/connect", async (req, res) => {
  const session = await requireIbkrPortalAccessCsrf(req);
  const data = ConnectIbkrPortalResponse.parse(
    await connectPortal(session.user.id),
  );
  void recordAuditEvent({
    appUserId: session.user.id,
    eventType: "broker.connect_start",
    subject: { type: "broker_provider", id: "ibkr" },
    payload: { connector: "client_portal" },
  });
  res.json(data);
});

router.post("/broker-execution/ibkr-portal/disconnect", async (req, res) => {
  const session = await requireIbkrPortalAccessCsrf(req);
  const data = DisconnectIbkrPortalResponse.parse(
    await disconnectPortal(session.user.id),
  );
  void recordAuditEvent({
    appUserId: session.user.id,
    eventType: "broker.disconnect",
    subject: { type: "broker_provider", id: "ibkr" },
    payload: { connector: "client_portal" },
  });
  res.json(data);
});

// Browser-facing reverse proxy to the user's Client Portal gateway. The user's
// IBKR login (and the gateway's own assets/redirects) flow through here so the
// login can complete on our public domain. Intentionally outside the JSON API
// contract (mirrors the broker OAuth callback routes); auth only, no CSRF —
// IBKR's own login form cannot carry our CSRF token.
router.use("/broker-execution/ibkr-portal/gateway", proxyToGateway);

function encodeRequestBody(req: Request): Buffer | undefined {
  if (req.method === "GET" || req.method === "HEAD") {
    return undefined;
  }
  const contentType = String(req.headers["content-type"] ?? "");
  const body = req.body as unknown;
  if (/application\/json/i.test(contentType)) {
    return Buffer.from(JSON.stringify(body ?? {}));
  }
  if (/application\/x-www-form-urlencoded/i.test(contentType)) {
    const params = new URLSearchParams(
      (body as Record<string, string>) ?? {},
    );
    return Buffer.from(params.toString());
  }
  if (Buffer.isBuffer(body)) {
    return body;
  }
  return undefined;
}

function rewriteLocation(location: string, gatewayOrigin: string): string {
  if (location.startsWith(gatewayOrigin)) {
    return GW_BASE + location.slice(gatewayOrigin.length);
  }
  // root-relative gateway path (not already under our mount)
  if (location.startsWith("/") && !location.startsWith(GW_BASE)) {
    return GW_BASE + location;
  }
  return location;
}

function rewriteSetCookie(cookie: string): string {
  return cookie
    .replace(/;\s*Domain=[^;]+/gi, "")
    .replace(/;\s*Path=\/(?![^;]*gateway)([^;]*)/gi, `; Path=${GW_BASE}/$1`);
}

function rewriteBody(body: string, gatewayOrigin: string): string {
  return body
    .split(gatewayOrigin)
    .join(GW_BASE)
    .replace(/(href|src|action)=(["'])\/(?!\/)/gi, `$1=$2${GW_BASE}/`)
    .replace(/url\(\s*(['"]?)\/(?!\/)/gi, `url($1${GW_BASE}/`)
    .replace(
      /(["'])\/(v1\/api|sso|oauth|portal|tickle)(\b|\/)/gi,
      `$1${GW_BASE}/$2$3`,
    );
}

async function proxyToGateway(req: Request, res: Response): Promise<void> {
  const startedAt = Date.now();
  const tracePath = (req.originalUrl.slice(GW_BASE.length) || "/").split("?")[0];
  let session;
  try {
    session = await requireIbkrPortalAccess(req);
  } catch (error) {
    trace({
      method: req.method,
      path: tracePath,
      outcome: "auth-denied",
      detail: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
  const gateway = getGateway(session.user.id);
  if (!gateway) {
    trace({ method: req.method, path: tracePath, outcome: "no-gateway", status: 503 });
    res
      .status(503)
      .json({ error: "ibkr_portal_gateway_not_running" });
    return;
  }

  const rest = req.originalUrl.slice(GW_BASE.length) || "/";
  const outBody = encodeRequestBody(req);

  const forwardHeaders: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    const lower = key.toLowerCase();
    if (lower === "accept-encoding" || lower === "content-length") continue;
    // Never forward conditional-request headers: the gateway answers 304s with
    // malformed framing (trailing bytes after `Connection: close`), which makes
    // Node's HTTP client error out and this proxy 502 cached assets — the
    // popup's login page then renders without its stylesheets/scripts. Always
    // fetch fresh (loopback bandwidth is free) so the 304 path never happens.
    if (lower === "if-none-match" || lower === "if-modified-since") continue;
    forwardHeaders[key] = value;
  }
  forwardHeaders["host"] = `127.0.0.1:${gateway.port}`;
  if (outBody) {
    forwardHeaders["content-length"] = String(outBody.length);
  }

  await new Promise<void>((resolve) => {
    // The response must be finalized exactly once. A client disconnect, an
    // upstream error after headers were flushed, or a duplicate end event can
    // otherwise trigger ERR_HTTP_HEADERS_SENT — which, thrown from these
    // un-awaited callbacks, would be an uncaught exception in the app process.
    let settled = false;
    let responseStarted = false;
    const finalize = (send: () => void): void => {
      if (settled) return;
      settled = true;
      try {
        if (!res.writableEnded) {
          send();
        }
      } catch {
        // Response already torn down (client aborted); nothing left to do.
      }
      resolve();
    };

    const upstream = httpRequest(
      {
        host: "127.0.0.1",
        port: gateway.port,
        method: req.method,
        path: rest,
        headers: forwardHeaders,
      },
      (up) => {
        responseStarted = true;
        const chunks: Buffer[] = [];
        up.on("data", (chunk: Buffer) => chunks.push(chunk));
        up.on("end", () => {
          const outHeaders: Record<string, string | string[]> = {};
          for (const [key, value] of Object.entries(up.headers)) {
            if (value === undefined) continue;
            const lower = key.toLowerCase();
            if (
              lower === "content-length" ||
              lower === "content-encoding" ||
              lower === "transfer-encoding" ||
              lower === "connection"
            ) {
              continue;
            }
            if (lower === "location" && typeof value === "string") {
              outHeaders[key] = rewriteLocation(value, gateway.origin);
              continue;
            }
            if (lower === "set-cookie" && Array.isArray(value)) {
              outHeaders[key] = value.map(rewriteSetCookie);
              continue;
            }
            outHeaders[key] = value;
          }

          let out: Buffer = Buffer.concat(chunks);
          const contentType = String(up.headers["content-type"] ?? "");
          if (/text\/html|javascript|json|text\/css/i.test(contentType)) {
            out = Buffer.from(
              rewriteBody(out.toString("utf8"), gateway.origin),
            );
          }

          trace({
            method: req.method,
            path: tracePath,
            status: up.statusCode ?? 502,
            contentType: contentType.split(";")[0] || null,
            bytes: out.length,
            ms: Date.now() - startedAt,
            // redirect target (path only) so post-login hops are visible
            location:
              typeof up.headers["location"] === "string"
                ? rewriteLocation(up.headers["location"], gateway.origin).split("?")[0]
                : undefined,
          });

          finalize(() =>
            res.status(up.statusCode ?? 502).set(outHeaders).send(out),
          );
        });
        up.on("error", () => finalize(() => res.end()));
      },
    );
    upstream.on("error", (error) => {
      trace({
        method: req.method,
        path: tracePath,
        outcome: "upstream-error",
        detail: error.message,
        ms: Date.now() - startedAt,
      });
      // The gateway sometimes appends stray bytes after a complete response
      // (`Parse Error: Data after 'Connection: close'`), firing this error
      // even though the response arrived intact — observed to beat the
      // response's own `end` event by a few ms. If a response has started,
      // grant a short grace window so its finalize wins; only a genuine
      // failure (no response at all, or `end` never arriving) reaches the 502.
      const failWith502 = (): void =>
        finalize(() => {
          if (res.headersSent) {
            res.end();
          } else {
            res.status(502).json({
              error: "ibkr_portal_gateway_proxy_error",
              detail: error.message,
            });
          }
        });
      if (responseStarted) {
        setTimeout(failWith502, 100);
      } else {
        failWith502();
      }
    });
    req.on("aborted", () => {
      upstream.destroy();
      finalize(() => res.end());
    });
    if (outBody) {
      upstream.write(outBody);
    }
    upstream.end();
  });
}

export default router;
