import assert from "node:assert/strict";
import test from "node:test";

import {
  ensureGateway,
  getGateway,
  markGatewayPaperAccountVerified,
  refreshGateway,
  stopGateway,
} from "./ibkr-portal-gateway-manager";

test("hosted IBKR mode provisions through the loopback session host", async () => {
  const previousEnabled = process.env["IBKR_SESSION_HOST_ENABLED"];
  const previousToken = process.env["IBKR_SESSION_HOST_CONTROL_TOKEN"];
  const previousUrl = process.env["IBKR_SESSION_HOST_URL"];
  const previousFetch = globalThis.fetch;
  const appUserId = "11111111-1111-4111-8111-111111111111";
  const requests: Array<{ method: string; url: string; authorization: string | null }> = [];

  process.env["IBKR_SESSION_HOST_ENABLED"] = "1";
  process.env["IBKR_SESSION_HOST_CONTROL_TOKEN"] = "host-token";
  process.env["IBKR_SESSION_HOST_URL"] = "http://127.0.0.1:18748/";
  globalThis.fetch = (async (input, init) => {
    requests.push({
      method: String(init?.method ?? "GET"),
      url: String(input),
      authorization: new Headers(init?.headers).get("authorization"),
    });
    if (String(input).endsWith("/release")) {
      return Response.json({ released: true });
    }
    if (String(input).endsWith("/status")) {
      return Response.json({
        capsule: { name: "pyrus-ibkr-slot-1", status: "ready" },
      });
    }
    return Response.json({
      capsule: { name: "pyrus-ibkr-slot-1", status: "occupied" },
      targets: {
        cpg: { host: "127.0.0.1", port: 15000 },
        console: { host: "127.0.0.1", port: 16080 },
      },
    });
  }) as typeof fetch;

  try {
    const gateway = await ensureGateway(appUserId);
    assert.deepEqual(gateway, {
      appUserId,
      baseUrl: "http://127.0.0.1:15000/v1/api",
      hosted: true,
      origin: "http://127.0.0.1:15000",
      port: 15000,
      proxyOrigin: "http://127.0.0.1:16080",
      proxyPort: 16080,
      paperAccountVerified: false,
      status: "starting",
      startedAt: gateway.startedAt,
    });
    assert.deepEqual(getGateway(appUserId), gateway);

    const readyGateway = await refreshGateway(appUserId);
    assert.equal(readyGateway?.status, "ready");
    assert.equal(markGatewayPaperAccountVerified(appUserId), true);
    assert.equal(getGateway(appUserId)?.paperAccountVerified, true);

    await stopGateway(appUserId);

    assert.deepEqual(requests, [
      {
        method: "POST",
        url: `http://127.0.0.1:18748/sessions/${appUserId}/ensure`,
        authorization: "Bearer host-token",
      },
      {
        method: "GET",
        url: `http://127.0.0.1:18748/sessions/${appUserId}/status`,
        authorization: "Bearer host-token",
      },
      {
        method: "POST",
        url: `http://127.0.0.1:18748/sessions/${appUserId}/release`,
        authorization: "Bearer host-token",
      },
    ]);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousEnabled === undefined) {
      delete process.env["IBKR_SESSION_HOST_ENABLED"];
    } else {
      process.env["IBKR_SESSION_HOST_ENABLED"] = previousEnabled;
    }
    if (previousToken === undefined) {
      delete process.env["IBKR_SESSION_HOST_CONTROL_TOKEN"];
    } else {
      process.env["IBKR_SESSION_HOST_CONTROL_TOKEN"] = previousToken;
    }
    if (previousUrl === undefined) {
      delete process.env["IBKR_SESSION_HOST_URL"];
    } else {
      process.env["IBKR_SESSION_HOST_URL"] = previousUrl;
    }
  }
});

test("hosted IBKR mode rejects non-loopback relay targets", async () => {
  const previousEnabled = process.env["IBKR_SESSION_HOST_ENABLED"];
  const previousToken = process.env["IBKR_SESSION_HOST_CONTROL_TOKEN"];
  const previousFetch = globalThis.fetch;
  const appUserId = "22222222-2222-4222-8222-222222222222";

  process.env["IBKR_SESSION_HOST_ENABLED"] = "1";
  process.env["IBKR_SESSION_HOST_CONTROL_TOKEN"] = "host-token";
  globalThis.fetch = (async () =>
    Response.json({
      capsule: { name: "pyrus-ibkr-slot-1", status: "ready" },
      targets: {
        cpg: { host: "169.254.169.254", port: 80 },
        console: { host: "127.0.0.1", port: 16080 },
      },
    })) as typeof fetch;

  try {
    await assert.rejects(
      () => ensureGateway(appUserId),
      (error: unknown) =>
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ibkr_session_host_response_invalid",
    );
    assert.equal(getGateway(appUserId), null);
  } finally {
    await stopGateway(appUserId);
    globalThis.fetch = previousFetch;
    if (previousEnabled === undefined) {
      delete process.env["IBKR_SESSION_HOST_ENABLED"];
    } else {
      process.env["IBKR_SESSION_HOST_ENABLED"] = previousEnabled;
    }
    if (previousToken === undefined) {
      delete process.env["IBKR_SESSION_HOST_CONTROL_TOKEN"];
    } else {
      process.env["IBKR_SESSION_HOST_CONTROL_TOKEN"] = previousToken;
    }
  }
});

test("hosted IBKR mode surfaces release failures after removing broker routing", async () => {
  const previousEnabled = process.env["IBKR_SESSION_HOST_ENABLED"];
  const previousToken = process.env["IBKR_SESSION_HOST_CONTROL_TOKEN"];
  const previousFetch = globalThis.fetch;
  const appUserId = "77777777-7777-4777-8777-777777777777";

  process.env["IBKR_SESSION_HOST_ENABLED"] = "1";
  process.env["IBKR_SESSION_HOST_CONTROL_TOKEN"] = "host-token";
  globalThis.fetch = (async (input) => {
    if (String(input).endsWith("/release")) {
      return Response.json(
        { error: { code: "docker_failure" } },
        { status: 503 },
      );
    }
    return Response.json({
      capsule: { name: "pyrus-ibkr-slot-1", status: "ready" },
      targets: {
        cpg: { host: "127.0.0.1", port: 15000 },
        console: { host: "127.0.0.1", port: 16080 },
      },
    });
  }) as typeof fetch;

  try {
    await ensureGateway(appUserId);
    await assert.rejects(
      () => stopGateway(appUserId),
      (error: unknown) =>
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ibkr_session_host_control_failed",
    );
    assert.equal(getGateway(appUserId), null);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousEnabled === undefined) {
      delete process.env["IBKR_SESSION_HOST_ENABLED"];
    } else {
      process.env["IBKR_SESSION_HOST_ENABLED"] = previousEnabled;
    }
    if (previousToken === undefined) {
      delete process.env["IBKR_SESSION_HOST_CONTROL_TOKEN"];
    } else {
      process.env["IBKR_SESSION_HOST_CONTROL_TOKEN"] = previousToken;
    }
  }
});
