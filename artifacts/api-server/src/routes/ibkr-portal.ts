import {
  Router,
  type IRouter,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { appendFile } from "node:fs";
import {
  STATUS_CODES,
  request as httpRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
} from "node:http";
import path from "node:path";
import type { Duplex } from "node:stream";

import {
  ConnectIbkrPortalResponse,
  DisconnectIbkrPortalResponse,
  GetIbkrPortalReadinessResponse,
  GetIbkrPortalStatusResponse,
} from "@workspace/api-zod";

import {
  AUTH_CSRF_HEADER,
  AUTH_SESSION_COOKIE,
  requireUser,
  requireUserCsrf,
} from "./auth";
import { HttpError } from "../lib/errors";
import type { AuthenticatedSession } from "../services/auth";
import {
  ENTITLEMENTS,
  isIbkrMemberConnectEnabled,
  sessionHasEntitlement,
} from "../services/entitlements";
import { recordAuditEvent } from "../services/audit-events";
import {
  beginPortalReadinessQuietWindow,
  connectPortal,
  disconnectPortal,
  getPortalStatus,
  IBKR_PORTAL_CLIENT_MOUNT,
  readPortalReadiness,
} from "../services/ibkr-portal-session";
import { getGateway } from "../services/ibkr-portal-gateway-manager";
import {
  IBKR_PORTAL_EMBED_COOKIE,
  issueIbkrPortalEmbedGrant,
  readIbkrPortalEmbedSession,
  rememberIbkrPortalEmbedCookieNames,
  redeemIbkrPortalEmbedGrant,
  revokeIbkrPortalEmbedSessions,
} from "../services/ibkr-portal-embed-session";
import { findRepoRoot } from "../services/runtime-flight-recorder";

const router: IRouter = Router();

const GW_BASE = "/api/broker-execution/ibkr-portal/gateway";
export const IBKR_PORTAL_CONSOLE_LOGIN_PATH =
  `${GW_BASE}/vnc.html?autoconnect=1&resize=scale` +
  `&path=${encodeURIComponent(`${GW_BASE.slice(1)}/websockify`)}`;
export { IBKR_PORTAL_CLIENT_MOUNT };

function isWithinMount(pathname: string, mount: string): boolean {
  return pathname === mount || pathname.startsWith(`${mount}/`);
}

function isAllowedClientGatewayRequest(method: string, path: string): boolean {
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return true;
  }
  if (method !== "POST") return false;
  return (
    /^\/sso(?:\/|$)/.test(path) ||
    /^\/portal\.proxy\/v1\/gstat(?:\/|$)/.test(path) ||
    /^\/v1\/api\/(?:tickle|logout)\/?$/.test(path) ||
    /^\/v1\/api\/iserver\/(?:auth\/(?:status|ssodh\/init)|reauthenticate)\/?$/.test(
      path,
    )
  );
}

function normalizeHttpOrigin(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
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

function firstHeaderValue(value: string | string[] | undefined): string {
  return (
    (Array.isArray(value) ? value[0] : value)?.split(",", 1)[0]?.trim() ?? ""
  );
}

function requestPublicOrigin(req: Request): string | null {
  const protocol =
    firstHeaderValue(req.headers["x-forwarded-proto"]) || req.protocol;
  const host =
    firstHeaderValue(req.headers["x-forwarded-host"]) || req.get("host") || "";
  return normalizeHttpOrigin(`${protocol}://${host}`);
}

function configuredPyrusOrigins(): string[] {
  return ["REPLIT_DEV_DOMAIN", "REPLIT_DOMAINS"].flatMap((name) =>
    (process.env[name] ?? "")
      .split(",")
      .map((value) => normalizeHttpOrigin(value.trim()))
      .filter((value): value is string => Boolean(value)),
  );
}

function parentOriginForRequest(req: Request): string {
  const requestOrigin = requestPublicOrigin(req);
  const browserOrigin = normalizeHttpOrigin(req.get("origin"));
  if (
    browserOrigin &&
    (browserOrigin === requestOrigin ||
      configuredPyrusOrigins().includes(browserOrigin))
  ) {
    return browserOrigin;
  }
  if (requestOrigin) return requestOrigin;
  throw new HttpError(400, "The PYRUS request origin could not be verified.", {
    code: "ibkr_portal_parent_origin_invalid",
    expose: true,
  });
}

function configuredEmbedOrigin(parentOrigin: string): string {
  const raw =
    process.env["IBKR_PORTAL_EMBED_ORIGIN"]?.trim() ||
    process.env["REPLIT_EXPO_DEV_DOMAIN"]?.trim();
  const embedOrigin = normalizeHttpOrigin(raw);
  if (!embedOrigin || embedOrigin === parentOrigin) {
    throw new HttpError(
      503,
      "The isolated IBKR login origin is not configured.",
      { code: "ibkr_portal_embed_origin_unavailable", expose: true },
    );
  }
  const url = new URL(embedOrigin);
  const localDevelopmentOrigin =
    url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !localDevelopmentOrigin) {
    throw new HttpError(
      503,
      "The isolated IBKR login origin must use HTTPS.",
      { code: "ibkr_portal_embed_origin_insecure", expose: true },
    );
  }
  return embedOrigin;
}

function issueAuthorizeUrl(
  appUserId: string,
  parentOrigin: string,
  embedOrigin: string,
): string {
  const grant = issueIbkrPortalEmbedGrant({
    appUserId,
    embedOrigin,
    parentOrigin,
  });
  const authorizeUrl = new URL(
    `${IBKR_PORTAL_CLIENT_MOUNT}/authorize`,
    embedOrigin,
  );
  authorizeUrl.searchParams.set("code", grant.code);
  return authorizeUrl.href;
}

export function getIbkrGatewayReanchorLocation(
  requestPath: string,
  referer: string | undefined,
): string | null {
  const mounts = [IBKR_PORTAL_CLIENT_MOUNT, GW_BASE];
  const requestPathname = requestPath.split("?", 1)[0] ?? requestPath;
  if (
    !referer ||
    mounts.some((mount) => isWithinMount(requestPathname, mount))
  ) {
    return null;
  }
  let mount: string | undefined;
  try {
    const refererPath = new URL(referer).pathname;
    mount = mounts.find((candidate) => isWithinMount(refererPath, candidate));
  } catch {
    return null;
  }
  if (!mount) return null;

  const fixed = requestPath.startsWith("/api/")
    ? "/sso/" + requestPath.slice("/api/".length)
    : requestPath;
  return mount + fixed;
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
  appendFile(
    TRAIL_PATH,
    JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n",
    () => undefined,
  );
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
  req: Pick<Request, "headers">,
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
  if (data.status === "connected" || data.status === "disconnected") {
    revokeIbkrPortalEmbedSessions(session.user.id);
  }
  res.json(data);
});

router.post("/broker-execution/ibkr-portal/connect", async (req, res) => {
  const session = await requireIbkrPortalAccessCsrf(req);
  const portal = await connectPortal(session.user.id);
  const data = ConnectIbkrPortalResponse.parse({
    ...portal,
    loginPath: IBKR_PORTAL_CONSOLE_LOGIN_PATH,
  });
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
  revokeIbkrPortalEmbedSessions(session.user.id);
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

router.get(
  "/broker-execution/ibkr-portal/client/authorize",
  async (req, res) => {
    const code = typeof req.query["code"] === "string" ? req.query["code"] : "";
    const origin = requestPublicOrigin(req);
    const embed = origin
      ? redeemIbkrPortalEmbedGrant(code, origin)
      : null;
    if (!embed) {
      throw new HttpError(401, "The IBKR login link is invalid or expired.", {
        code: "ibkr_portal_embed_grant_invalid",
        expose: true,
      });
    }
    if (!getGateway(embed.appUserId)) {
      revokeIbkrPortalEmbedSessions(embed.appUserId);
      throw new HttpError(401, "The IBKR login link is invalid or expired.", {
        code: "ibkr_portal_embed_grant_invalid",
        expose: true,
      });
    }
    res.cookie(IBKR_PORTAL_EMBED_COOKIE, embed.sessionToken, {
      httpOnly: true,
      sameSite: "none",
      secure: true,
      path: `${IBKR_PORTAL_CLIENT_MOUNT}/`,
      maxAge: Math.max(0, embed.expiresAt - Date.now()),
    });
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.redirect(303, `${IBKR_PORTAL_CLIENT_MOUNT}/`);
  },
);

// Browser-facing reverse proxy to the user's Client Portal gateway. The user's
// IBKR login (and the gateway's own assets/redirects) flow through here so the
// login can complete on our public domain. Intentionally outside the JSON API
// contract (mirrors the broker OAuth callback routes); auth only, no CSRF —
// IBKR's own login form cannot carry our CSRF token.
router.use("/broker-execution/ibkr-portal/gateway", proxyToGateway);
router.use("/broker-execution/ibkr-portal/client", proxyToClientGateway);

function encodeRequestBody(req: Request): Buffer | undefined {
  if (req.method === "GET" || req.method === "HEAD") {
    return undefined;
  }
  const contentType = String(req.headers["content-type"] ?? "");
  const body = req.body as unknown;
  if (Buffer.isBuffer(body)) {
    return body;
  }
  if (/application\/json/i.test(contentType)) {
    return Buffer.from(JSON.stringify(body ?? {}));
  }
  if (/application\/x-www-form-urlencoded/i.test(contentType)) {
    const params = new URLSearchParams(
      (body as Record<string, string>) ?? {},
    );
    return Buffer.from(params.toString());
  }
  return undefined;
}

function rewriteLocation(
  location: string,
  gatewayOrigin: string,
  mount: string,
): string {
  if (location.startsWith(gatewayOrigin)) {
    return mount + location.slice(gatewayOrigin.length);
  }
  // root-relative gateway path (not already under our mount)
  if (location.startsWith("/") && !isWithinMount(location, mount)) {
    return mount + location;
  }
  return location;
}

function rewriteSetCookie(cookie: string, mount: string): string {
  return cookie
    .replace(/;\s*Domain=[^;]+/gi, "")
    .replace(/;\s*Path=\/([^;]*)/gi, `; Path=${mount}/$1`);
}

function rewriteBody(
  body: string,
  gatewayOrigin: string,
  mount: string,
  isClientHtml: boolean,
): string {
  let rewritten = body
    .split(gatewayOrigin)
    .join(mount)
    .replace(/(href|src|action)=(["'])\/(?!\/)/gi, `$1=$2${mount}/`)
    .replace(/url\(\s*(['"]?)\/(?!\/)/gi, `url($1${mount}/`)
    .replace(
      /(["'])\/(v1\/api|sso|oauth|portal|tickle)(\b|\/)/gi,
      `$1${mount}/$2$3`,
    );
  if (isClientHtml) {
    // The native page redirects its top window when framed. The isolated
    // origin and frame-ancestors policy provide that boundary without letting
    // IBKR replace the PYRUS application.
    rewritten = rewritten.replace(
      /if\s*\(\s*window\s*!={1,2}\s*top\s*\)\s*\{\s*top\.location\.href\s*=\s*location\.href\s*;?\s*\}/g,
      "",
    );
  }
  return rewritten;
}

function rewriteFrameAncestorsPolicy(
  policy: string | string[] | undefined,
  frameAncestor: string,
): string | string[] {
  const rewrite = (value: string): string => {
    const directives = value
      .split(";")
      .map((directive) => directive.trim())
      .filter(
        (directive) =>
          directive && !/^frame-ancestors(?:\s|$)/i.test(directive),
      );
    directives.push(`frame-ancestors ${frameAncestor}`);
    return directives.join("; ");
  };
  if (Array.isArray(policy)) return policy.map(rewrite);
  return rewrite(policy ?? "");
}

const STRIPPED_GATEWAY_REQUEST_HEADERS = new Set([
  "accept-encoding",
  "authorization",
  "connection",
  "content-encoding",
  "content-length",
  "forwarded",
  "host",
  "if-modified-since",
  "if-none-match",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "sec-fetch-dest",
  "sec-fetch-mode",
  "sec-fetch-site",
  "sec-fetch-user",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "via",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  AUTH_CSRF_HEADER,
]);

export function filterIbkrGatewayRequestHeaders(
  headers: IncomingHttpHeaders,
  allowedCookieNames?: readonly string[],
): Record<string, string | string[]> {
  const allowedCookies = allowedCookieNames
    ? new Set(allowedCookieNames)
    : null;
  const forwardHeaders: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    const lower = key.toLowerCase();
    if (STRIPPED_GATEWAY_REQUEST_HEADERS.has(lower)) continue;
    if (lower === "cookie") {
      const cookie = (Array.isArray(value) ? value.join("; ") : value)
        .split(";")
        .map((part) => part.trim())
        .filter(Boolean)
        .filter((part) => {
          const name = part.split("=", 1)[0];
          return (
            name !== AUTH_SESSION_COOKIE &&
            name !== IBKR_PORTAL_EMBED_COOKIE &&
            (!allowedCookies || allowedCookies.has(name))
          );
        })
        .join("; ");
      if (cookie) forwardHeaders[key] = cookie;
      continue;
    }
    forwardHeaders[key] = value;
  }
  return forwardHeaders;
}

function forwardedCookieNames(
  headers: Record<string, string | string[]>,
): string[] {
  const cookie = Object.entries(headers).find(
    ([key]) => key.toLowerCase() === "cookie",
  )?.[1];
  if (!cookie) return [];
  return (Array.isArray(cookie) ? cookie.join("; ") : cookie)
    .split(";")
    .map((part) => part.trim().split("=", 1)[0])
    .filter(Boolean)
    .sort();
}

async function proxyToClientGateway(
  req: Request,
  res: Response,
): Promise<void> {
  return proxyToGatewayTarget(req, res, "client");
}

async function proxyToGateway(req: Request, res: Response): Promise<void> {
  return proxyToGatewayTarget(req, res, "console");
}

const GATEWAY_PROXY_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const GATEWAY_PROXY_TIMEOUT_MS = 15_000;

async function proxyToGatewayTarget(
  req: Request,
  res: Response,
  target: "client" | "console",
): Promise<void> {
  const startedAt = Date.now();
  const mount = target === "client" ? IBKR_PORTAL_CLIENT_MOUNT : GW_BASE;
  const tracePath = `${target}:${(
    req.originalUrl.slice(mount.length) || "/"
  ).split("?")[0]}`;
  let appUserId: string;
  let frameAncestor = "'self'";
  let embedOrigin: string | null = null;
  let gatewayCookieNames: string[] | undefined;
  try {
    const requestOrigin = requestPublicOrigin(req);
    const embed =
      target === "client" && requestOrigin
        ? readIbkrPortalEmbedSession(req.headers.cookie, requestOrigin)
        : null;
    if (target === "client") {
      if (!embed) {
        throw new HttpError(401, "The IBKR login session is invalid or expired.", {
          code: "ibkr_portal_embed_session_invalid",
          expose: true,
        });
      }
      if (
        req.method !== "GET" &&
        req.method !== "HEAD" &&
        req.method !== "OPTIONS" &&
        (normalizeHttpOrigin(req.get("origin")) !== embed.embedOrigin ||
          firstHeaderValue(req.headers["sec-fetch-site"]) === "cross-site")
      ) {
        throw new HttpError(403, "The IBKR login request origin is not allowed.", {
          code: "ibkr_portal_embed_origin_denied",
          expose: true,
        });
      }
      appUserId = embed.appUserId;
      frameAncestor = embed.parentOrigin;
      embedOrigin = embed.embedOrigin;
      gatewayCookieNames = embed.gatewayCookieNames;
    } else {
      const session = await requireIbkrPortalAccess(req);
      appUserId = session.user.id;
    }
  } catch (error) {
    trace({
      method: req.method,
      path: tracePath,
      outcome: "auth-denied",
      detail: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
  const rest = req.originalUrl.slice(mount.length) || "/";
  const gateway = getGateway(appUserId);
  if (!gateway) {
    trace({ method: req.method, path: tracePath, outcome: "no-gateway", status: 503 });
    res
      .status(503)
      .json({ error: "ibkr_portal_gateway_not_running" });
    return;
  }

  if (
    target === "client" &&
    !isAllowedClientGatewayRequest(
      req.method,
      new URL(rest, "http://localhost").pathname,
    )
  ) {
    throw new HttpError(403, "This IBKR login request is not allowed.", {
      code: "ibkr_portal_embed_request_denied",
      expose: true,
    });
  }
  const outBody = encodeRequestBody(req);
  const targetPort = target === "client" ? gateway.port : gateway.proxyPort;
  const targetOrigin =
    target === "client" ? gateway.origin : gateway.proxyOrigin;

  const forwardHeaders = filterIbkrGatewayRequestHeaders(
    req.headers,
    gatewayCookieNames,
  );
  const dispatcherCookieNames =
    tracePath === "client:/sso/Dispatcher"
      ? forwardedCookieNames(forwardHeaders)
      : undefined;
  forwardHeaders["host"] = `127.0.0.1:${targetPort}`;
  if (target === "client") {
    if (req.headers.origin) forwardHeaders["origin"] = targetOrigin;
    if (req.headers.referer) {
      try {
        const referer = new URL(req.headers.referer);
        const suffix = isWithinMount(referer.pathname, mount)
          ? `${referer.pathname.slice(mount.length) || "/"}${referer.search}`
          : "/";
        forwardHeaders["referer"] = targetOrigin + suffix;
      } catch {
        delete forwardHeaders["referer"];
      }
    }
  }
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
    const failProxy = (status = 502): void =>
      finalize(() =>
        res.status(status).json({
          error: "ibkr_portal_gateway_proxy_error",
        }),
      );

    const upstream = httpRequest(
      {
        agent: false,
        host: "127.0.0.1",
        port: targetPort,
        method: req.method,
        path: rest,
        headers: forwardHeaders,
      },
      (up) => {
        responseStarted = true;
        const chunks: Buffer[] = [];
        let responseBytes = 0;
        up.on("data", (chunk: Buffer) => {
          if (settled) return;
          responseBytes += chunk.length;
          if (responseBytes > GATEWAY_PROXY_MAX_RESPONSE_BYTES) {
            trace({
              method: req.method,
              path: tracePath,
              outcome: "response-too-large",
              bytes: responseBytes,
              ms: Date.now() - startedAt,
            });
            up.destroy();
            failProxy();
            return;
          }
          chunks.push(chunk);
        });
        up.on("end", () => {
          if (settled) return;
          if (target === "client" && embedOrigin) {
            rememberIbkrPortalEmbedCookieNames(
              req.headers.cookie,
              embedOrigin,
              (up.headers["set-cookie"] ?? []).flatMap((cookie) => {
                const separator = cookie.indexOf("=");
                return separator > 0 ? [cookie.slice(0, separator).trim()] : [];
              }),
            );
          }
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
            if (target === "client" && lower === "x-frame-options") {
              continue;
            }
            if (
              target === "client" &&
              (lower === "content-security-policy" ||
                lower === "cross-origin-resource-policy")
            ) {
              continue;
            }
            if (lower === "location" && typeof value === "string") {
              outHeaders[key] = rewriteLocation(value, targetOrigin, mount);
              continue;
            }
            if (lower === "set-cookie" && Array.isArray(value)) {
              outHeaders[key] = value.map((cookie) =>
                rewriteSetCookie(cookie, mount),
              );
              continue;
            }
            outHeaders[key] = value;
          }

          let out: Buffer = Buffer.concat(chunks);
          const contentType = String(up.headers["content-type"] ?? "");
          if (/text\/html|javascript|json|text\/css/i.test(contentType)) {
            out = Buffer.from(
              rewriteBody(
                out.toString("utf8"),
                targetOrigin,
                mount,
                target === "client" && /text\/html/i.test(contentType),
              ),
            );
          }
          if (target === "client") {
            outHeaders["content-security-policy"] =
              rewriteFrameAncestorsPolicy(
                up.headers["content-security-policy"],
                frameAncestor,
              );
            outHeaders["cross-origin-resource-policy"] = "cross-origin";
            if (/text\/html/i.test(contentType)) {
              outHeaders["cache-control"] = "no-store";
            }
          }

          const dispatcherSucceeded =
            tracePath === "client:/sso/Dispatcher" &&
            (up.statusCode ?? 502) === 200 &&
            out.toString("utf8") === "Client login succeeds";
          if (dispatcherSucceeded) {
            beginPortalReadinessQuietWindow(appUserId);
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
                ? rewriteLocation(
                    up.headers["location"],
                    targetOrigin,
                    mount,
                  ).split("?")[0]
                : undefined,
            forwardedCookieNames: dispatcherCookieNames,
            stage: dispatcherSucceeded ? "dispatcher_succeeded" : undefined,
          });

          finalize(() =>
            res.status(up.statusCode ?? 502).set(outHeaders).send(out),
          );
        });
        const failAfterResponseError = (): void => {
          setTimeout(() => failProxy(), 100).unref?.();
        };
        up.on("aborted", failAfterResponseError);
        up.on("error", failAfterResponseError);
      },
    );
    upstream.setTimeout(GATEWAY_PROXY_TIMEOUT_MS, () => {
      trace({
        method: req.method,
        path: tracePath,
        outcome: "upstream-timeout",
        ms: Date.now() - startedAt,
      });
      upstream.destroy();
      failProxy(504);
    });
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
      const failWith502 = (): void => failProxy();
      if (responseStarted) {
        setTimeout(failWith502, 100).unref?.();
      } else {
        failWith502();
      }
    });
    req.on("aborted", () => {
      upstream.destroy();
      finalize(() => res.end());
    });
    res.once("close", () => {
      if (!settled && !res.writableEnded) {
        upstream.destroy();
        finalize(() => undefined);
      }
    });
    if (outBody) {
      upstream.write(outBody);
    }
    upstream.end();
  });
}

function gatewayUpgradePath(request: IncomingMessage): string | null {
  const url = new URL(request.url ?? "/", "http://localhost");
  if (
    url.pathname !== GW_BASE &&
    !url.pathname.startsWith(`${GW_BASE}/`)
  ) {
    return null;
  }
  return `${url.pathname.slice(GW_BASE.length) || "/"}${url.search}`;
}

function configuredGatewayHosts(): string[] {
  return ["REPLIT_DEV_DOMAIN", "REPLIT_DOMAINS"].flatMap((name) =>
    (process.env[name] ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
      .flatMap((value) => {
        try {
          return [
            new URL(value.includes("://") ? value : `https://${value}`).host,
          ];
        } catch {
          return [];
        }
      }),
  );
}

function hasSameGatewayOrigin(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  const host = request.headers.host;
  if (typeof origin !== "string" || !host) return false;
  try {
    const parsed = new URL(origin);
    const rawForwardedHost = request.headers["x-forwarded-host"];
    const forwardedHost = (
      Array.isArray(rawForwardedHost) ? rawForwardedHost[0] : rawForwardedHost
    )
      ?.split(",", 1)[0]
      ?.trim();
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      [host, forwardedHost, ...configuredGatewayHosts()].some(
        (candidate) => candidate?.toLowerCase() === parsed.host.toLowerCase(),
      )
    );
  } catch {
    return false;
  }
}

function writeUpgradeResponse(
  socket: Duplex,
  response: IncomingMessage,
): void {
  const status = response.statusCode ?? 101;
  const statusText = response.statusMessage ?? STATUS_CODES[status] ?? "Switching Protocols";
  let head = `HTTP/${response.httpVersion} ${status} ${statusText}\r\n`;
  for (let index = 0; index < response.rawHeaders.length; index += 2) {
    head += `${response.rawHeaders[index]}: ${response.rawHeaders[index + 1]}\r\n`;
  }
  socket.write(`${head}\r\n`);
}

function rejectUpgrade(socket: Duplex, status: number): void {
  if (socket.destroyed) return;
  socket.end(
    `HTTP/1.1 ${status} ${STATUS_CODES[status] ?? "Error"}\r\n` +
      "Connection: close\r\nContent-Length: 0\r\n\r\n",
  );
}

async function proxyGatewayUpgrade(
  request: IncomingMessage,
  socket: Duplex,
  clientHead: Buffer,
  path: string,
): Promise<void> {
  const session = await requireIbkrPortalAccess(request);
  if (!hasSameGatewayOrigin(request)) {
    throw new HttpError(403, "WebSocket origin is not allowed.", {
      code: "ibkr_portal_websocket_origin_denied",
    });
  }
  const gateway = getGateway(session.user.id);
  if (!gateway) {
    throw new HttpError(503, "IBKR Client Portal gateway is not running.", {
      code: "ibkr_portal_gateway_not_running",
    });
  }

  const headers = filterIbkrGatewayRequestHeaders(request.headers);
  headers["host"] = `127.0.0.1:${gateway.proxyPort}`;
  headers["connection"] = "Upgrade";
  headers["upgrade"] = "websocket";

  await new Promise<void>((resolve, reject) => {
    const upstream = httpRequest({
      host: "127.0.0.1",
      port: gateway.proxyPort,
      method: "GET",
      path,
      headers,
    });
    let upgraded = false;
    upstream.once("upgrade", (response, upstreamSocket, upstreamHead) => {
      upgraded = true;
      writeUpgradeResponse(socket, response);
      if (upstreamHead.length > 0) socket.write(upstreamHead);
      if (clientHead.length > 0) upstreamSocket.write(clientHead);
      socket.on("error", () => upstreamSocket.destroy());
      upstreamSocket.on("error", () => socket.destroy());
      socket.on("close", () => upstreamSocket.destroy());
      upstreamSocket.on("close", () => socket.destroy());
      socket.pipe(upstreamSocket).pipe(socket);
      resolve();
    });
    upstream.once("response", (response) => {
      response.resume();
      reject(new Error("IBKR console refused the WebSocket upgrade."));
    });
    upstream.once("error", reject);
    socket.once("close", () => {
      if (!upgraded) upstream.destroy();
    });
    upstream.end();
  });
}

export function attachIbkrPortalWebSocket(server: Server): void {
  server.on("upgrade", (request, socket, head) => {
    const path = gatewayUpgradePath(request);
    if (!path) return;
    void proxyGatewayUpgrade(request, socket, head, path).catch((error) => {
      const status = error instanceof HttpError ? error.statusCode : 502;
      trace({
        method: "GET",
        path: path.split("?", 1)[0],
        outcome: "websocket-denied",
        status,
      });
      rejectUpgrade(socket, status);
    });
  });
}

export default router;
