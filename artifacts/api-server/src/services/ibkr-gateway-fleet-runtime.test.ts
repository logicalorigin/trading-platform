import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveIbkrHostControlKey,
  verifyIbkrHostControlRequest,
} from "@workspace/ibkr-contracts/control-auth";
import { db, usersTable } from "@workspace/db";
import { withTestDb } from "@workspace/db/testing";

import {
  approveIbkrGatewayHost,
  registerIbkrGatewayHost,
} from "./ibkr-gateway-session-store";
import {
  ensureIbkrGatewayFleetFence,
  prepareIbkrGatewayFleetDataRequest,
} from "./ibkr-gateway-fleet-runtime";

test("fleet WebSocket data requests preserve loopback HTTP transport and upgrade HTTPS", async () => {
  await withTestDb(async () => {
    const envNames = [
      "IBKR_GATEWAY_FLEET_CONTROL_OVERLAP_ROOT_KEY",
      "IBKR_GATEWAY_FLEET_CONTROL_ROOT_KEY",
      "IBKR_GATEWAY_FLEET_ENABLED",
      "TRADING_MODE",
    ] as const;
    const previousEnv = Object.fromEntries(
      envNames.map((name) => [name, process.env[name]]),
    );
    const rootKey = Buffer.alloc(32, 31);
    const imageDigest = `sha256:${"a".repeat(64)}`;
    const hosts = [
      {
        controlOrigin: "http://127.0.0.1:18748",
        expectedOrigin: "ws://127.0.0.1:18748",
        hostId: "00000000-0000-4000-8000-000000000031",
        workloadIdentityDigest: "b".repeat(64),
      },
      {
        controlOrigin: "https://host-thirty-two.example.invalid",
        expectedOrigin: "wss://host-thirty-two.example.invalid",
        hostId: "00000000-0000-4000-8000-000000000032",
        workloadIdentityDigest: "c".repeat(64),
      },
    ];

    process.env["IBKR_GATEWAY_FLEET_CONTROL_ROOT_KEY"] =
      rootKey.toString("base64url");
    delete process.env["IBKR_GATEWAY_FLEET_CONTROL_OVERLAP_ROOT_KEY"];
    process.env["IBKR_GATEWAY_FLEET_ENABLED"] = "1";
    process.env["TRADING_MODE"] = "shadow";

    try {
      for (const [index, host] of hosts.entries()) {
        assert.ok(
          await registerIbkrGatewayHost({
            capsuleLeaseProtocolVersion: 1,
            controlOrigin: host.controlOrigin,
            failureDomain: `synthetic-transport-${index}`,
            hostId: host.hostId,
            imageDigest,
            measuredSlotCapacity: 1,
            runtimeAttestationDigest: imageDigest,
            runtimeSpecDigest: imageDigest,
            workloadIdentityDigest: host.workloadIdentityDigest,
          }),
        );
        assert.ok(
          await approveIbkrGatewayHost({
            admissionSlotCapacity: 1,
            capsuleLeaseProtocolVersion: 1,
            hostId: host.hostId,
            imageDigest,
            runtimeAttestationDigest: imageDigest,
            runtimeSpecDigest: imageDigest,
            workloadIdentityDigest: host.workloadIdentityDigest,
          }),
        );
      }

      for (const [index, host] of hosts.entries()) {
        const [user] = await db
          .insert(usersTable)
          .values({
            email: `synthetic-fleet-transport-${index}@example.invalid`,
            passwordHash: "synthetic-unused-hash",
          })
          .returning({ id: usersTable.id });
        assert.ok(user);
        const fence = await ensureIbkrGatewayFleetFence(user.id);
        assert.equal(fence.hostId, host.hostId);

        const headers = { "x-synthetic-request": "preserved" };
        const prepared = await prepareIbkrGatewayFleetDataRequest({
          fence,
          headers,
          kind: "console",
          method: "GET",
          path: "/websockify?token=synthetic",
          transport: "websocket",
        });

        assert.deepEqual(prepared.fence, fence);
        assert.equal(prepared.url.origin, host.expectedOrigin);
        assert.equal(prepared.headers["x-synthetic-request"], "preserved");
        assert.equal(prepared.headers.host, prepared.url.host);
        assert.equal(
          verifyIbkrHostControlRequest({
            expectedHostId: host.hostId,
            headers: prepared.headers,
            key: deriveIbkrHostControlKey(rootKey, host.hostId),
            method: "GET",
            path: `${prepared.url.pathname}${prepared.url.search}`,
          }).valid,
          true,
        );
      }
    } finally {
      for (const name of envNames) {
        const previous = previousEnv[name];
        if (previous === undefined) delete process.env[name];
        else process.env[name] = previous;
      }
    }
  });
});
