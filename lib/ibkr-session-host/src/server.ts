import { createServer, type Server, type ServerResponse } from "node:http";

import {
  CapsuleError,
  type CapsuleRecord,
  type CapsuleTarget,
  type RuntimeReadiness,
} from "./capsule";

type HostSnapshot = {
  mode: "paper";
  capacity: { max: number; active: number };
};

export type SessionHostServerOptions = {
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

function authorized(
  authorization: string | undefined,
  controlToken: string | undefined,
): boolean {
  return (
    typeof controlToken === "string" &&
    controlToken.length > 0 &&
    authorization === `Bearer ${controlToken}`
  );
}

function sendCapsuleError(response: ServerResponse, error: unknown): void {
  const code = error instanceof CapsuleError ? error.code : "control_failed";
  const status =
    code === "session_not_found"
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

export function createSessionHostServer(
  options: SessionHostServerOptions,
): Server {
  return createServer(async (request, response) => {
    const path = new URL(request.url ?? "/", "http://session-host.invalid")
      .pathname;
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
    const route = sessionRoute(path);
    if (route) {
      if (!authorized(request.headers.authorization, options.controlToken)) {
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
}
