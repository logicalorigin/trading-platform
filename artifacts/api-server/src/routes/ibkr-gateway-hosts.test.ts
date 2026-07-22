import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";

import {
  deriveIbkrHostControlKey,
  signIbkrHostControlRequest,
} from "@workspace/ibkr-contracts/control-auth";
import express from "express";
import productionApp from "../app";
import { isHttpError } from "../lib/errors";
import { createIbkrGatewayHostRequestVerifier } from "../services/ibkr-gateway-host-auth";
import {
  IBKR_GATEWAY_HOSTS_MOUNT,
  mountIbkrGatewayHostLifecycleRoutes,
} from "./ibkr-gateway-hosts";

const HOST_ID = "00000000-0000-4000-8000-000000000001";
const NOW_SECONDS = 1_800_000_000;
const ROOT_KEY = Buffer.alloc(32, 7);
const SHA = `sha256:${"a".repeat(64)}`;
const WORKLOAD_IDENTITY = "b".repeat(64);

const registrationBody = JSON.stringify({
  workloadIdentityDigest: WORKLOAD_IDENTITY,
  controlOrigin: "https://ibkr-host.internal.invalid",
  imageDigest: SHA,
  runtimeSpecDigest: SHA,
  runtimeAttestationDigest: SHA,
  capsuleLeaseProtocolVersion: 1,
  failureDomain: "reserved-vm-primary",
  measuredSlotCapacity: 20,
});
const heartbeatBody = JSON.stringify({
  verifiedWorkloadIdentityDigest: WORKLOAD_IDENTITY,
  runtimeAttestationDigest: SHA,
});

type HostInput = Record<string, unknown>;
type HostState = {
  heartbeatExpiresAt: Date;
  id: string;
  status: string;
};

function signedHeaders(input: {
  body: string;
  nonce: string;
  path: string;
}): Record<string, string> {
  return {
    "content-type": "application/json",
    origin: "https://browser.invalid",
    ...signIbkrHostControlRequest({
      body: input.body,
      hostId: HOST_ID,
      key: deriveIbkrHostControlKey(ROOT_KEY, HOST_ID),
      method: "POST",
      nonce: input.nonce,
      path: input.path,
      timestampSeconds: NOW_SECONDS,
    }),
  };
}

async function withServer(
  input: {
    heartbeatHost?: (value: HostInput) => Promise<HostState | null>;
    onHostReady?: (hostId: string) => void;
    registerHost?: (value: HostInput) => Promise<HostState | null>;
  },
  fn: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const app = express();
  mountIbkrGatewayHostLifecycleRoutes(app, {
    heartbeatHost:
      input.heartbeatHost ??
      (async () => ({
        id: HOST_ID,
        status: "active",
        heartbeatExpiresAt: new Date("2027-01-15T08:00:30.000Z"),
      })),
    registerHost:
      input.registerHost ??
      (async () => ({
        id: HOST_ID,
        status: "quarantined",
        heartbeatExpiresAt: new Date("2027-01-15T08:00:30.000Z"),
      })),
    onHostReady: input.onHostReady,
    verifyRequest: createIbkrGatewayHostRequestVerifier({
      nowSeconds: () => NOW_SECONDS,
      rootKeys: () => [ROOT_KEY],
    }),
  });
  app.use((_req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    next();
  });
  app.use((_req, res) => res.sendStatus(404));
  app.use(
    (
      error: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      if (isHttpError(error)) {
        res.status(error.statusCode).type("application/problem+json").json({
          title: error.message,
          status: error.statusCode,
          code: error.code,
        });
        return;
      }
      res.sendStatus(500);
    },
  );

  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  try {
    await fn(`http://127.0.0.1:${address.port}`);
  } finally {
    server.close();
    await once(server, "close");
  }
}

test("production app mounts lifecycle authentication before JSON parsing", async () => {
  const previousRootKey =
    process.env["IBKR_GATEWAY_FLEET_CONTROL_ROOT_KEY"];
  const previousOverlapKey =
    process.env["IBKR_GATEWAY_FLEET_CONTROL_OVERLAP_ROOT_KEY"];
  process.env["IBKR_GATEWAY_FLEET_CONTROL_ROOT_KEY"] =
    ROOT_KEY.toString("base64url");
  delete process.env["IBKR_GATEWAY_FLEET_CONTROL_OVERLAP_ROOT_KEY"];

  const server = productionApp.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  const path = `${IBKR_GATEWAY_HOSTS_MOUNT}/${HOST_ID}/heartbeat`;
  try {
    const response = await fetch(
      `http://127.0.0.1:${address.port}${path}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://browser.invalid",
        },
        body: "{",
      },
    );

    assert.equal(response.status, 401);
    assert.equal(response.headers.get("access-control-allow-origin"), null);
    assert.equal(
      ((await response.json()) as { code?: string }).code,
      "ibkr_gateway_host_auth_invalid",
    );
  } finally {
    server.close();
    await once(server, "close");
    if (previousRootKey === undefined) {
      delete process.env["IBKR_GATEWAY_FLEET_CONTROL_ROOT_KEY"];
    } else {
      process.env["IBKR_GATEWAY_FLEET_CONTROL_ROOT_KEY"] = previousRootKey;
    }
    if (previousOverlapKey === undefined) {
      delete process.env["IBKR_GATEWAY_FLEET_CONTROL_OVERLAP_ROOT_KEY"];
    } else {
      process.env["IBKR_GATEWAY_FLEET_CONTROL_OVERLAP_ROOT_KEY"] =
        previousOverlapKey;
    }
  }
});

test("registers an authenticated host from the exact raw body", async () => {
  const inputs: HostInput[] = [];
  const readyHosts: string[] = [];
  const path = `${IBKR_GATEWAY_HOSTS_MOUNT}/${HOST_ID}/register`;
  await withServer(
    {
      registerHost: async (input) => {
        inputs.push(input);
        return {
          id: HOST_ID,
          status: "quarantined",
          heartbeatExpiresAt: new Date("2027-01-15T08:00:30.000Z"),
        };
      },
      onHostReady: (hostId) => readyHosts.push(hostId),
    },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: signedHeaders({
          body: registrationBody,
          nonce: "1".repeat(32),
          path,
        }),
        body: registrationBody,
      });

      assert.equal(response.status, 200);
      assert.equal(response.headers.get("access-control-allow-origin"), null);
      assert.deepEqual(await response.json(), {
        hostId: HOST_ID,
        status: "quarantined",
        heartbeatExpiresAt: "2027-01-15T08:00:30.000Z",
      });
      assert.deepEqual(inputs, [
        { hostId: HOST_ID, ...JSON.parse(registrationBody) },
      ]);
      assert.deepEqual(readyHosts, [HOST_ID]);
    },
  );
});

test("heartbeats only the host identity named by the signed path", async () => {
  const inputs: HostInput[] = [];
  const readyHosts: string[] = [];
  const path = `${IBKR_GATEWAY_HOSTS_MOUNT}/${HOST_ID}/heartbeat`;
  await withServer(
    {
      heartbeatHost: async (input) => {
        inputs.push(input);
        return {
          id: HOST_ID,
          status: "active",
          heartbeatExpiresAt: new Date("2027-01-15T08:00:30.000Z"),
        };
      },
      onHostReady: (hostId) => readyHosts.push(hostId),
    },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: signedHeaders({
          body: heartbeatBody,
          nonce: "2".repeat(32),
          path,
        }),
        body: heartbeatBody,
      });

      assert.equal(response.status, 200);
      assert.deepEqual(inputs, [
        { hostId: HOST_ID, ...JSON.parse(heartbeatBody) },
      ]);
      assert.deepEqual(readyHosts, [HOST_ID]);
    },
  );
});

test("rejects a body changed after signing before calling persistence", async () => {
  let calls = 0;
  const path = `${IBKR_GATEWAY_HOSTS_MOUNT}/${HOST_ID}/register`;
  await withServer(
    {
      registerHost: async () => {
        calls += 1;
        return null;
      },
    },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: signedHeaders({
          body: registrationBody,
          nonce: "3".repeat(32),
          path,
        }),
        body: `${registrationBody} `,
      });

      assert.equal(response.status, 401);
      assert.equal(calls, 0);
      assert.equal(response.headers.get("access-control-allow-origin"), null);
      assert.equal(
        ((await response.json()) as { code?: string }).code,
        "ibkr_gateway_host_auth_invalid",
      );
    },
  );
});

test("authenticates before parsing and rejects malformed signed JSON", async () => {
  let calls = 0;
  const path = `${IBKR_GATEWAY_HOSTS_MOUNT}/${HOST_ID}/heartbeat`;
  const malformedBody = "{";
  await withServer(
    {
      heartbeatHost: async () => {
        calls += 1;
        return null;
      },
    },
    async (baseUrl) => {
      const unsigned = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: malformedBody,
      });
      assert.equal(unsigned.status, 401);

      const signed = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: signedHeaders({
          body: malformedBody,
          nonce: "4".repeat(32),
          path,
        }),
        body: malformedBody,
      });
      assert.equal(signed.status, 400);
      assert.equal(calls, 0);
    },
  );
});

test("returns a generic conflict when attestation persistence rejects a host", async () => {
  const path = `${IBKR_GATEWAY_HOSTS_MOUNT}/${HOST_ID}/register`;
  await withServer(
    { registerHost: async () => null },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: signedHeaders({
          body: registrationBody,
          nonce: "5".repeat(32),
          path,
        }),
        body: registrationBody,
      });

      assert.equal(response.status, 409);
      assert.equal(
        ((await response.json()) as { code?: string }).code,
        "ibkr_gateway_host_registration_rejected",
      );
    },
  );
});

test("accepts only an explicit capsule lease protocol version 0 or 1", async () => {
  const path = `${IBKR_GATEWAY_HOSTS_MOUNT}/${HOST_ID}/register`;
  const baseRegistration = JSON.parse(registrationBody) as Record<
    string,
    unknown
  >;
  const inputs: HostInput[] = [];
  await withServer(
    {
      registerHost: async (input) => {
        inputs.push(input);
        return {
          id: HOST_ID,
          status: "quarantined",
          heartbeatExpiresAt: new Date("2027-01-15T08:00:30.000Z"),
        };
      },
    },
    async (baseUrl) => {
      const versionZeroBody = JSON.stringify({
        ...baseRegistration,
        capsuleLeaseProtocolVersion: 0,
      });
      const accepted = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: signedHeaders({
          body: versionZeroBody,
          nonce: "6".repeat(32),
          path,
        }),
        body: versionZeroBody,
      });
      assert.equal(accepted.status, 200);

      for (const [index, value] of [undefined, 2, "1"].entries()) {
        const invalidRegistration = { ...baseRegistration };
        if (value === undefined) {
          delete invalidRegistration.capsuleLeaseProtocolVersion;
        } else {
          invalidRegistration.capsuleLeaseProtocolVersion = value;
        }
        const body = JSON.stringify(invalidRegistration);
        const rejected = await fetch(`${baseUrl}${path}`, {
          method: "POST",
          headers: signedHeaders({
            body,
            nonce: String(index + 7).repeat(32),
            path,
          }),
          body,
        });
        assert.equal(rejected.status, 400);
      }
    },
  );
  assert.equal(inputs.length, 1);
  assert.equal(inputs[0]?.capsuleLeaseProtocolVersion, 0);
});

test("terminates browser preflights without granting CORS", async () => {
  const path = `${IBKR_GATEWAY_HOSTS_MOUNT}/${HOST_ID}/heartbeat`;
  await withServer({}, async (baseUrl) => {
    const response = await fetch(`${baseUrl}${path}`, {
      method: "OPTIONS",
      headers: {
        origin: "https://browser.invalid",
        "access-control-request-method": "POST",
      },
    });

    assert.equal(response.status, 404);
    assert.equal(response.headers.get("access-control-allow-origin"), null);
  });
});
