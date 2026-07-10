import { createServer, type Server, type ServerResponse } from "node:http";

import type { RuntimeReadiness } from "./capsule";

type HostSnapshot = {
  mode: "paper";
  capacity: { max: 1; active: number };
};

export type SessionHostServerOptions = {
  readiness: () => RuntimeReadiness | Promise<RuntimeReadiness>;
  snapshot: () => HostSnapshot;
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
    sendJson(response, 404, {
      error: { code: "not_found", message: "Not found." },
    });
  });
}
