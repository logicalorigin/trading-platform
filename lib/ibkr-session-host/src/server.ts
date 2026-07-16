import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { Duplex } from "node:stream";

import { verifyIbkrHostControlRequest } from "@workspace/ibkr-contracts/control-auth";

import {
  CapsuleError,
  type CapsuleRecord,
  type CapsuleTarget,
  type CapsuleTargetKind,
  type RuntimeReadiness,
} from "./capsule";

type HostSnapshot = {
  mode: "paper";
  capacity: { max: number; active: number };
};

export type SessionHostServerOptions = {
  controlIdentity?:
    | {
        hostId: string;
        key: Uint8Array;
        nowSeconds?: () => number;
      }
    | undefined;
  controlToken?: string | undefined;
  ensureSession?: (
    sessionId: string,
    generation: number,
    slotNumber: number,
  ) => Promise<CapsuleRecord>;
  releaseSession?: (
    sessionId: string,
    generation: number,
    slotNumber: number,
  ) => Promise<void>;
  readiness: () => RuntimeReadiness | Promise<RuntimeReadiness>;
  resolveTarget?: (
    sessionId: string,
    generation: number,
    slotNumber: number,
    kind: CapsuleTargetKind,
  ) => Promise<CapsuleTarget>;
  snapshot: () => HostSnapshot;
  statusSession?: (
    sessionId: string,
    generation: number,
    slotNumber: number,
  ) => Promise<CapsuleRecord | null>;
  target?: (
    sessionId: string,
    generation: number,
    kind: "cpg" | "console",
    slotNumber: number,
  ) => CapsuleTarget;
};

const RESPONSE_HEADERS = {
  "cache-control": "no-store",
  "content-security-policy": "default-src 'none'",
  "content-type": "application/json; charset=utf-8",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
} as const;

function sendJson(
  response: ServerResponse,
  status: number,
  body: Record<string, unknown>,
): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    ...RESPONSE_HEADERS,
    "content-length": Buffer.byteLength(payload),
  });
  response.end(payload);
}

function sessionRoute(path: string): {
  action: string;
  explicitGeneration: boolean;
  explicitSlot: boolean;
  generation: number;
  sessionId: string;
  slotNumber: number;
} | null {
  const fenced =
    /^\/sessions\/([^/]+)\/generations\/([0-9]+)\/slots\/([0-9]+)\/([^/]+)$/.exec(
      path,
    );
  if (fenced) {
    return {
      action: fenced[4],
      explicitGeneration: true,
      explicitSlot: true,
      generation: Number(fenced[2]),
      sessionId: decodeURIComponent(fenced[1]),
      slotNumber: Number(fenced[3]),
    };
  }
  const placed = /^\/sessions\/([^/]+)\/slots\/([0-9]+)\/([^/]+)$/.exec(path);
  if (placed) {
    return {
      action: placed[3],
      explicitGeneration: false,
      explicitSlot: true,
      generation: 0,
      sessionId: decodeURIComponent(placed[1]),
      slotNumber: Number(placed[2]),
    };
  }
  const legacy = /^\/sessions\/([^/]+)\/([^/]+)$/.exec(path);
  return legacy
    ? {
        action: legacy[2],
        explicitGeneration: false,
        explicitSlot: false,
        generation: 0,
        sessionId: decodeURIComponent(legacy[1]),
        slotNumber: 1,
      }
    : null;
}

function dataRoute(path: string): {
  generation: number;
  kind: CapsuleTargetKind;
  sessionId: string;
  slotNumber: number;
  upstreamPath: string;
} | null {
  const match =
    /^\/sessions\/([^/]+)\/generations\/([0-9]+)\/slots\/([0-9]+)\/data\/(cpg|console)(\/.*)?$/.exec(
      path,
    );
  if (!match) return null;
  const generation = Number(match[2]);
  const slotNumber = Number(match[3]);
  if (
    !Number.isSafeInteger(generation) ||
    generation < 1 ||
    !Number.isSafeInteger(slotNumber) ||
    slotNumber < 1
  ) {
    return null;
  }
  try {
    return {
      generation,
      kind: match[4] as CapsuleTargetKind,
      sessionId: decodeURIComponent(match[1]),
      slotNumber,
      upstreamPath: match[5] || "/",
    };
  } catch {
    return null;
  }
}

function authorized(
  input: {
    body?: string | Uint8Array;
    headers: Record<string, string | string[] | undefined>;
    method: string;
    path: string;
  },
  options: SessionHostServerOptions,
  replayNonces: Map<string, number>,
): boolean {
  if (options.controlIdentity) {
    const nowSeconds =
      options.controlIdentity.nowSeconds?.() ?? Math.floor(Date.now() / 1_000);
    const verification = verifyIbkrHostControlRequest({
      expectedHostId: options.controlIdentity.hostId,
      body: input.body,
      headers: input.headers,
      key: options.controlIdentity.key,
      method: input.method,
      nowSeconds,
      path: input.path,
    });
    if (!verification.valid) return false;
    for (const [nonce, expiresAt] of replayNonces) {
      if (expiresAt <= nowSeconds) replayNonces.delete(nonce);
    }
    if (replayNonces.has(verification.nonce) || replayNonces.size >= 4_096) {
      return false;
    }
    replayNonces.set(verification.nonce, verification.timestampSeconds + 31);
    return true;
  }
  return (
    typeof options.controlToken === "string" &&
    options.controlToken.length > 0 &&
    input.headers.authorization === `Bearer ${options.controlToken}`
  );
}

const DATA_REQUEST_MAX_BYTES = 1 * 1024 * 1024;
const DATA_RESPONSE_MAX_BYTES = 8 * 1024 * 1024;
const DATA_PROXY_TIMEOUT_MS = 20_000;
const DATA_STRIPPED_HEADERS = new Set([
  "authorization",
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

async function readDataBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > DATA_REQUEST_MAX_BYTES) {
      throw new CapsuleError(
        "data_request_too_large",
        "IBKR host data request is too large.",
      );
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function dataHeaders(
  headers: IncomingMessage["headers"],
  body: Buffer,
  target: CapsuleTarget,
): Record<string, string | string[]> {
  const forwarded: Record<string, string | string[]> = {};
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (
      value === undefined ||
      DATA_STRIPPED_HEADERS.has(lower) ||
      lower.startsWith("x-pyrus-control-")
    ) {
      continue;
    }
    forwarded[name] = value;
  }
  forwarded.host = `${target.host}:${target.port}`;
  if (body.length > 0) forwarded["content-length"] = String(body.length);
  return forwarded;
}

async function proxyDataRequest(input: {
  body: Buffer;
  method: string;
  request: IncomingMessage;
  response: ServerResponse;
  target: CapsuleTarget;
  upstreamPath: string;
}): Promise<void> {
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = (status: number, body: Record<string, unknown>): void => {
      if (settled) return;
      settled = true;
      if (!input.response.headersSent) sendJson(input.response, status, body);
      else input.response.destroy();
      resolve();
    };
    const upstream = httpRequest(
      {
        host: input.target.host,
        port: input.target.port,
        method: input.method,
        path: input.upstreamPath,
        headers: dataHeaders(input.request.headers, input.body, input.target),
      },
      (upstreamResponse) => {
        const chunks: Buffer[] = [];
        let bytes = 0;
        upstreamResponse.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > DATA_RESPONSE_MAX_BYTES) {
            upstreamResponse.destroy();
            finish(502, {
              error: {
                code: "data_response_too_large",
                message: "IBKR host data request failed.",
              },
            });
            return;
          }
          chunks.push(chunk);
        });
        upstreamResponse.on("end", () => {
          if (settled) return;
          settled = true;
          const headers: Record<string, string | string[]> = {};
          for (const [name, value] of Object.entries(
            upstreamResponse.headers,
          )) {
            if (
              value !== undefined &&
              !["connection", "transfer-encoding"].includes(name.toLowerCase())
            ) {
              headers[name] = value;
            }
          }
          input.response.writeHead(upstreamResponse.statusCode ?? 502, headers);
          input.response.end(Buffer.concat(chunks));
          resolve();
        });
        upstreamResponse.on("error", () =>
          finish(502, {
            error: {
              code: "data_proxy_failed",
              message: "IBKR host data request failed.",
            },
          }),
        );
      },
    );
    upstream.setTimeout(DATA_PROXY_TIMEOUT_MS, () => upstream.destroy());
    upstream.on("error", () =>
      finish(502, {
        error: {
          code: "data_proxy_failed",
          message: "IBKR host data request failed.",
        },
      }),
    );
    if (input.body.length > 0) upstream.write(input.body);
    upstream.end();
  });
}

function sendCapsuleError(response: ServerResponse, error: unknown): void {
  const code = error instanceof CapsuleError ? error.code : "control_failed";
  const status =
    code === "data_request_too_large"
      ? 413
      : code === "session_not_found"
        ? 404
        : code === "capacity_exhausted" ||
            code === "session_placement_conflict" ||
            code === "stale_generation"
          ? 409
          : code === "invalid_session_id" ||
              code === "invalid_generation" ||
              code === "invalid_slot_number"
            ? 400
            : 503;
  sendJson(response, status, {
    error: { code, message: "IBKR session control failed." },
  });
}

function rejectDataUpgrade(socket: Duplex, status: number): void {
  if (socket.destroyed) return;
  socket.end(
    `HTTP/1.1 ${status} ${status === 401 ? "Unauthorized" : "Bad Gateway"}\r\n` +
      "Connection: close\r\nContent-Length: 0\r\n\r\n",
  );
}

function writeDataUpgradeResponse(
  socket: Duplex,
  response: IncomingMessage,
): void {
  let head = `HTTP/${response.httpVersion} ${response.statusCode ?? 101} ${response.statusMessage ?? "Switching Protocols"}\r\n`;
  for (let index = 0; index < response.rawHeaders.length; index += 2) {
    head += `${response.rawHeaders[index]}: ${response.rawHeaders[index + 1]}\r\n`;
  }
  socket.write(`${head}\r\n`);
}

async function proxyDataUpgrade(input: {
  clientHead: Buffer;
  request: IncomingMessage;
  socket: Duplex;
  target: CapsuleTarget;
  upstreamPath: string;
}): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const headers = dataHeaders(
      input.request.headers,
      Buffer.alloc(0),
      input.target,
    );
    headers.connection = "Upgrade";
    headers.upgrade = input.request.headers.upgrade ?? "websocket";
    const upstream = httpRequest({
      headers,
      host: input.target.host,
      method: "GET",
      path: input.upstreamPath,
      port: input.target.port,
    });
    let upgraded = false;
    upstream.once("upgrade", (response, upstreamSocket, upstreamHead) => {
      upgraded = true;
      writeDataUpgradeResponse(input.socket, response);
      if (upstreamHead.length > 0) input.socket.write(upstreamHead);
      if (input.clientHead.length > 0) upstreamSocket.write(input.clientHead);
      input.socket.on("error", () => upstreamSocket.destroy());
      upstreamSocket.on("error", () => input.socket.destroy());
      input.socket.on("close", () => upstreamSocket.destroy());
      upstreamSocket.on("close", () => input.socket.destroy());
      input.socket.pipe(upstreamSocket).pipe(input.socket);
      resolve();
    });
    upstream.once("response", (response) => {
      response.resume();
      reject(new Error("IBKR capsule refused the data upgrade."));
    });
    upstream.once("error", reject);
    input.socket.once("close", () => {
      if (!upgraded) upstream.destroy();
    });
    upstream.setTimeout(DATA_PROXY_TIMEOUT_MS, () =>
      upstream.destroy(new Error("IBKR capsule data upgrade timed out.")),
    );
    upstream.end();
  });
}

export function createSessionHostServer(
  options: SessionHostServerOptions,
): Server {
  const replayNonces = new Map<string, number>();
  const server = createServer(async (request, response) => {
    const requestUrl = new URL(
      request.url ?? "/",
      "http://session-host.invalid",
    );
    const path = requestUrl.pathname;
    if (request.method === "GET" && path === "/healthz") {
      sendJson(response, 200, {
        service: "ibkr-session-host",
        status: "ok",
        ...options.snapshot(),
      });
      return;
    }
    if (request.method === "GET" && path === "/readyz") {
      let readiness: RuntimeReadiness;
      try {
        readiness = await options.readiness();
      } catch {
        readiness = { ready: false, code: "docker_unavailable" };
      }
      sendJson(response, readiness.ready ? 200 : 503, {
        service: "ibkr-session-host",
        status: readiness.ready ? "ready" : "degraded",
        ...(readiness.ready ? {} : { code: readiness.code }),
        ...options.snapshot(),
      });
      return;
    }
    const data = dataRoute(path);
    if (data) {
      try {
        const body = await readDataBody(request);
        if (
          !authorized(
            {
              body,
              headers: request.headers,
              method: request.method ?? "",
              path: `${path}${requestUrl.search}`,
            },
            options,
            replayNonces,
          )
        ) {
          sendJson(response, 401, {
            error: { code: "unauthorized", message: "Unauthorized." },
          });
          return;
        }
        const target = await options.resolveTarget?.(
          data.sessionId,
          data.generation,
          data.slotNumber,
          data.kind,
        );
        if (!target) {
          sendJson(response, 503, {
            error: {
              code: "data_proxy_unavailable",
              message: "IBKR host data request failed.",
            },
          });
          return;
        }
        await proxyDataRequest({
          body,
          method: request.method ?? "GET",
          request,
          response,
          target,
          upstreamPath: `${data.upstreamPath}${requestUrl.search}`,
        });
      } catch (error) {
        if (error instanceof CapsuleError) {
          sendCapsuleError(response, error);
        } else {
          sendJson(response, 502, {
            error: {
              code: "data_proxy_failed",
              message: "IBKR host data request failed.",
            },
          });
        }
      }
      return;
    }
    const route = sessionRoute(path);
    if (route) {
      if (
        !authorized(
          {
            headers: request.headers,
            method: request.method ?? "",
            path,
          },
          options,
          replayNonces,
        )
      ) {
        sendJson(response, 401, {
          error: { code: "unauthorized", message: "Unauthorized." },
        });
        return;
      }
      try {
        if (request.method === "POST" && route.action === "ensure") {
          const capsule = await options.ensureSession?.(
            route.sessionId,
            route.generation,
            route.slotNumber,
          );
          if (!capsule || !options.target) {
            sendJson(response, 503, {
              error: {
                code: "control_unavailable",
                message: "IBKR session control failed.",
              },
            });
            return;
          }
          sendJson(response, 200, {
            sessionId: route.sessionId,
            ...(route.explicitGeneration
              ? { generation: route.generation }
              : {}),
            ...(route.explicitSlot ? { slotNumber: route.slotNumber } : {}),
            capsule,
            targets: {
              cpg: options.target(
                route.sessionId,
                route.generation,
                "cpg",
                route.slotNumber,
              ),
              console: options.target(
                route.sessionId,
                route.generation,
                "console",
                route.slotNumber,
              ),
            },
          });
          return;
        }
        if (request.method === "GET" && route.action === "status") {
          const capsule =
            (await options.statusSession?.(
              route.sessionId,
              route.generation,
              route.slotNumber,
            )) ?? null;
          sendJson(response, capsule ? 200 : 404, {
            sessionId: route.sessionId,
            ...(route.explicitGeneration
              ? { generation: route.generation }
              : {}),
            ...(route.explicitSlot ? { slotNumber: route.slotNumber } : {}),
            capsule,
          });
          return;
        }
        if (request.method === "POST" && route.action === "release") {
          if (!options.releaseSession) {
            sendJson(response, 503, {
              error: {
                code: "control_unavailable",
                message: "IBKR session control failed.",
              },
            });
            return;
          }
          await options.releaseSession(
            route.sessionId,
            route.generation,
            route.slotNumber,
          );
          sendJson(response, 200, {
            sessionId: route.sessionId,
            ...(route.explicitGeneration
              ? { generation: route.generation }
              : {}),
            ...(route.explicitSlot ? { slotNumber: route.slotNumber } : {}),
            released: true,
          });
          return;
        }
      } catch (error) {
        sendCapsuleError(response, error);
        return;
      }
    }
    sendJson(response, 404, {
      error: { code: "not_found", message: "Not found." },
    });
  });
  server.on("upgrade", (request, socket, clientHead) => {
    const requestUrl = new URL(
      request.url ?? "/",
      "http://session-host.invalid",
    );
    const data = dataRoute(requestUrl.pathname);
    if (
      request.method !== "GET" ||
      !data ||
      !authorized(
        {
          headers: request.headers,
          method: request.method ?? "",
          path: `${requestUrl.pathname}${requestUrl.search}`,
        },
        options,
        replayNonces,
      )
    ) {
      rejectDataUpgrade(socket, 401);
      return;
    }
    void (async () => {
      const target = await options.resolveTarget?.(
        data.sessionId,
        data.generation,
        data.slotNumber,
        data.kind,
      );
      if (!target) throw new Error("IBKR host data target is unavailable.");
      await proxyDataUpgrade({
        clientHead,
        request,
        socket,
        target,
        upstreamPath: `${data.upstreamPath}${requestUrl.search}`,
      });
    })().catch(() => rejectDataUpgrade(socket, 502));
  });
  return server;
}
