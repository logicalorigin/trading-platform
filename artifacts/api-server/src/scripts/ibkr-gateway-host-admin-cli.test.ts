import assert from "node:assert/strict";
import test from "node:test";

import {
  parseIbkrGatewayHostAdminArgs,
  runIbkrGatewayHostAdminCommand,
  type IbkrGatewayHostAdminDependencies,
  type OperatorHost,
} from "./ibkr-gateway-host-admin-cli";

const HOST_ID = "11111111-1111-4111-8111-111111111111";
const SHA = `sha256:${"a".repeat(64)}`;
const WORKLOAD = "b".repeat(64);
const NOW = new Date("2026-07-16T20:00:00.000Z");

function host(overrides: Partial<OperatorHost> = {}): OperatorHost {
  return {
    admissionSlotCapacity: 1,
    capsuleLeaseProtocolVersion: 1,
    controlOrigin: "http://127.0.0.1:18748",
    failureDomain: "reserved-vm-primary",
    heartbeatExpiresAt: new Date("2026-07-16T20:00:30.000Z"),
    id: HOST_ID,
    imageDigest: SHA,
    lastHeartbeatAt: new Date("2026-07-16T19:59:50.000Z"),
    measuredSlotCapacity: 20,
    runtimeAttestationDigest: SHA,
    runtimeSpecDigest: SHA,
    status: "quarantined",
    workloadIdentityDigest: WORKLOAD,
    ...overrides,
  };
}

function dependencies(
  overrides: Partial<IbkrGatewayHostAdminDependencies> = {},
): IbkrGatewayHostAdminDependencies {
  return {
    approveHost: async () => host({ status: "active" }),
    disableHost: async (_hostId, status) => host({ status }),
    readHost: async () => ({ activeLeaseCount: 0, host: host() }),
    ...overrides,
  };
}

test("parses only explicit bounded operator commands", () => {
  assert.deepEqual(
    parseIbkrGatewayHostAdminArgs(["inspect", `--host-id=${HOST_ID}`]),
    { action: "inspect", hostId: HOST_ID },
  );
  assert.deepEqual(parseIbkrGatewayHostAdminArgs(["--help"]), null);

  for (const args of [
    ["approve", `--host-id=${HOST_ID}`],
    ["drain", `--host-id=${HOST_ID}`],
    ["quarantine", `--host-id=${HOST_ID}`],
    ["inspect", `--host-id=${HOST_ID}`, "--execute"],
    ["inspect", "--host-id=not-a-uuid"],
    ["inspect", `--host-id=${HOST_ID}`, `--host-id=${HOST_ID}`],
    ["unknown", `--host-id=${HOST_ID}`],
  ]) {
    assert.throws(() => parseIbkrGatewayHostAdminArgs(args), /Usage:/);
  }
});

test("inspects only the bounded nonsecret host state", async () => {
  const output: string[] = [];
  const ok = await runIbkrGatewayHostAdminCommand(
    { action: "inspect", hostId: HOST_ID },
    dependencies(),
    { now: () => NOW, write: (line) => output.push(line) },
  );

  assert.equal(ok, true);
  assert.equal(output.length, 1);
  assert.deepEqual(JSON.parse(output[0]!), {
    type: "ibkr_gateway_host_inspection",
    host: {
      admissionSlotCapacity: 1,
      activeLeaseCount: 0,
      capsuleLeaseProtocolVersion: 1,
      controlOrigin: "http://127.0.0.1:18748",
      failureDomain: "reserved-vm-primary",
      heartbeatExpiresAt: "2026-07-16T20:00:30.000Z",
      heartbeatFresh: true,
      hostId: HOST_ID,
      imageDigest: SHA,
      lastHeartbeatAt: "2026-07-16T19:59:50.000Z",
      measuredSlotCapacity: 20,
      runtimeAttestationDigest: SHA,
      runtimeSpecDigest: SHA,
      status: "quarantined",
      workloadIdentityDigest: WORKLOAD,
    },
  });
});

test("approves only the exact attestation and requested admission ceiling", async () => {
  const approvals: unknown[] = [];
  const command = parseIbkrGatewayHostAdminArgs([
    "approve",
    `--host-id=${HOST_ID}`,
    `--workload-identity-digest=${WORKLOAD}`,
    `--image-digest=${SHA}`,
    `--runtime-spec-digest=${SHA}`,
    `--runtime-attestation-digest=${SHA}`,
    "--capsule-lease-protocol-version=1",
    "--admission-slot-capacity=1",
    "--execute",
  ]);
  assert.ok(command);

  const ok = await runIbkrGatewayHostAdminCommand(
    command,
    dependencies({
      approveHost: async (input) => {
        approvals.push(input);
        return host({ status: "active" });
      },
    }),
    { now: () => NOW, write: () => undefined },
  );

  assert.equal(ok, true);
  assert.deepEqual(approvals, [
    {
      admissionSlotCapacity: 1,
      capsuleLeaseProtocolVersion: 1,
      hostId: HOST_ID,
      imageDigest: SHA,
      runtimeAttestationDigest: SHA,
      runtimeSpecDigest: SHA,
      workloadIdentityDigest: WORKLOAD,
    },
  ]);
});

test("requires a canonical capsule lease protocol approval version", () => {
  const approvalArgs = [
    "approve",
    `--host-id=${HOST_ID}`,
    `--workload-identity-digest=${WORKLOAD}`,
    `--image-digest=${SHA}`,
    `--runtime-spec-digest=${SHA}`,
    `--runtime-attestation-digest=${SHA}`,
    "--admission-slot-capacity=1",
    "--execute",
  ];
  for (const version of ["0", "1"]) {
    const command = parseIbkrGatewayHostAdminArgs([
      ...approvalArgs,
      `--capsule-lease-protocol-version=${version}`,
    ]);
    assert.equal(
      command?.action === "approve"
        ? command.capsuleLeaseProtocolVersion
        : undefined,
      Number(version),
    );
  }
  for (const version of [undefined, "-1", "2", "01"]) {
    assert.throws(
      () =>
        parseIbkrGatewayHostAdminArgs([
          ...approvalArgs,
          ...(version === undefined
            ? []
            : [`--capsule-lease-protocol-version=${version}`]),
        ]),
      /Usage:/,
    );
  }
});

test("drains or quarantines through the explicit fail-safe state transition", async () => {
  const transitions: unknown[] = [];
  const deps = dependencies({
    disableHost: async (hostId, status) => {
      transitions.push({ hostId, status });
      return host({ status });
    },
  });

  for (const action of ["drain", "quarantine"] as const) {
    const command = parseIbkrGatewayHostAdminArgs([
      action,
      `--host-id=${HOST_ID}`,
      "--execute",
    ]);
    assert.ok(command);
    assert.equal(
      await runIbkrGatewayHostAdminCommand(command, deps, {
        now: () => NOW,
        write: () => undefined,
      }),
      true,
    );
  }

  assert.deepEqual(transitions, [
    { hostId: HOST_ID, status: "draining" },
    { hostId: HOST_ID, status: "quarantined" },
  ]);
});
