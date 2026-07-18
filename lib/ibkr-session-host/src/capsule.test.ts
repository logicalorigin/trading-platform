import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  CapsuleError,
  CapsuleManager,
  DEFAULT_SECCOMP_PROFILE_PATH,
  buildCreateCapsuleInvocation,
  capsuleNameForSession,
  checkCapsuleRuntime,
  checkDocker,
  createCapsuleLeaseGrantIssuer,
  execFileCommandRunner,
  loadSessionHostConfig,
  serializeCapsuleLeaseRenewal,
  type CapsuleLeaseGrant,
  type CapsuleLeaseRuntime,
  type CommandResult,
  type CommandRunner,
} from "./capsule";

const SECCOMP_PROFILE = JSON.parse(
  readFileSync(DEFAULT_SECCOMP_PROFILE_PATH, "utf8"),
) as Record<string, unknown>;
const SECCOMP_INSPECT_OPTION = `seccomp=${JSON.stringify(SECCOMP_PROFILE)}`;
const WEAKENED_SECCOMP_INSPECT_OPTION = `seccomp=${JSON.stringify({
  ...SECCOMP_PROFILE,
  defaultAction: "SCMP_ACT_ALLOW",
})}`;
const IMAGE = "ghcr.io/pyrus/ibkr-session-capsule@sha256:" + "a".repeat(64);
const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_SESSION_ID = "22222222-2222-4222-8222-222222222222";
const SESSION_HASH = "bd7662a5eeb41614e720d477";
const SLOT_NAME = "pyrus-ibkr-slot-1";
const NETWORK_NAME = "pyrus-ibkr-capsule-net";
const NETWORK_IP = "172.20.0.2";
const NETWORK_ID = "c".repeat(64);
const CONTAINER_ID = "e".repeat(64);
const READY_MARKER = "PYRUS_IBKR_CAPSULE_READY_V1";
const LOGIN_COMPLETE_MARKER = "PYRUS_IBKR_CAPSULE_LOGIN_COMPLETE_V1";
const STARTED_AT = "2026-07-09T22:00:00.000Z";
const CURRENT_LOG_AT = "2026-07-09T22:00:01.000Z";
const BOOT_ID = "33333333-3333-4333-8333-333333333333";
const CONTROL_ATTEMPT_ID = "44444444-4444-4444-8444-444444444444";
const LEASE_CONTROL_KEY = "ab".repeat(32);

const dockerLogLine = (message: string, timestamp = CURRENT_LOG_AT): string =>
  `${timestamp} ${message}\n`;

const leaseGrant = (
  grantNotAfterNs: bigint,
  controlAttemptId = CONTROL_ATTEMPT_ID,
): CapsuleLeaseGrant => ({
  bootId: BOOT_ID,
  controlAttemptId,
  grantNotAfterNs: String(grantNotAfterNs),
  version: 1,
});

const noExistingSlot = (): CommandResult => ({
  code: 0,
  stdout: "",
  stderr: "",
});

const capsuleProbeResult = (
  args: string[],
  sessionHash = SESSION_HASH,
  identity?: {
    fenceHash: string;
    generation: number;
    leaseGrant?: CapsuleLeaseGrant;
    slotNumber: number;
  },
): CommandResult | null => {
  if (args[0] === "network" && args[1] === "inspect") {
    return {
      code: 0,
      stdout: JSON.stringify({
        Attachable: false,
        ConfigOnly: false,
        Driver: "bridge",
        EnableIPv6: false,
        Id: NETWORK_ID,
        Ingress: false,
        Internal: false,
        Labels: { "pyrus.ibkr.network": "1" },
        Name: NETWORK_NAME,
        Options: {
          "com.docker.network.bridge.enable_icc": "false",
          "com.docker.network.bridge.gateway_mode_ipv4": "nat",
        },
        Scope: "local",
      }),
      stderr: "",
    };
  }
  if (args[0] === "container" && args[1] === "ls") return noExistingSlot();
  if (
    args[0] === "container" &&
    args[1] === "inspect" &&
    args.includes("{{json .}}")
  ) {
    return {
      code: 0,
      stdout: JSON.stringify({
        Id: CONTAINER_ID,
        Mounts: [],
        Config: {
          Entrypoint: ["/usr/local/bin/pyrus-capsule-supervisor.py"],
          Image: IMAGE,
          StopTimeout: 30,
          User: "0:0",
          Volumes: null,
          Env: identity?.leaseGrant
            ? [
                "PYRUS_IBKR_CAPSULE_LEASE_VERSION=1",
                `PYRUS_IBKR_CAPSULE_LEASE_BOOT_ID=${identity.leaseGrant.bootId}`,
                `PYRUS_IBKR_CAPSULE_LEASE_FENCE_HASH=${identity.fenceHash}`,
                `PYRUS_IBKR_CAPSULE_LEASE_CONTROL_ATTEMPT_ID=${identity.leaseGrant.controlAttemptId}`,
                `PYRUS_IBKR_CAPSULE_LEASE_GRANT_NOT_AFTER_NS=${identity.leaseGrant.grantNotAfterNs}`,
                `PYRUS_IBKR_CAPSULE_LEASE_CONTROL_KEY=${LEASE_CONTROL_KEY}`,
              ]
            : [],
          Labels: {
            "pyrus.ibkr.capsule": "1",
            "pyrus.ibkr.session_hash": sessionHash,
            ...(identity
              ? {
                  "pyrus.ibkr.fence_hash": identity.fenceHash,
                  "pyrus.ibkr.generation": String(identity.generation),
                  "pyrus.ibkr.slot": String(identity.slotNumber),
                  ...(identity.leaseGrant
                    ? { "pyrus.ibkr.lease_protocol": "1" }
                    : {}),
                }
              : {}),
          },
        },
        HostConfig: {
          Binds: null,
          CapAdd: ["KILL", "NET_ADMIN", "SETGID", "SETPCAP", "SETUID"],
          CapDrop: ["ALL"],
          CgroupnsMode: "private",
          DeviceCgroupRules: null,
          DeviceRequests: null,
          Devices: [],
          Init: false,
          IpcMode: "private",
          Memory: 2_147_483_648,
          MemorySwap: 2_147_483_648,
          NanoCpus: 1_000_000_000,
          NetworkMode: NETWORK_NAME,
          PidMode: "",
          PidsLimit: 512,
          PortBindings: null,
          Privileged: false,
          PublishAllPorts: false,
          ReadonlyRootfs: true,
          RestartPolicy: {
            Name: identity?.leaseGrant ? "no" : "on-failure",
          },
          SecurityOpt: ["no-new-privileges=true", SECCOMP_INSPECT_OPTION],
          ShmSize: 536_870_912,
          Tmpfs: {
            "/run/pyrus": identity?.leaseGrant
              ? "rw,noexec,nosuid,nodev,size=512m,mode=0710,uid=10001,gid=0"
              : "rw,noexec,nosuid,nodev,size=512m,mode=0700,uid=10001,gid=10001",
            "/tmp": "rw,noexec,nosuid,nodev,size=256m,mode=1777",
          },
          Ulimits: [
            { Hard: 0, Name: "core", Soft: 0 },
            { Hard: 4096, Name: "nofile", Soft: 4096 },
          ],
          VolumesFrom: null,
        },
        NetworkSettings: {
          Networks: {
            [NETWORK_NAME]: {
              IPAddress: NETWORK_IP,
              NetworkID: NETWORK_ID,
            },
          },
          Ports: {},
        },
        State: { Running: true },
      }),
      stderr: "",
    };
  }
  if (
    args[0] === "container" &&
    args[1] === "inspect" &&
    args.includes("{{json .State}}")
  ) {
    return {
      code: 0,
      stdout: JSON.stringify({ Running: true, StartedAt: STARTED_AT }),
      stderr: "",
    };
  }
  if (args[0] === "logs") {
    return { code: 0, stdout: dockerLogLine(READY_MARKER), stderr: "" };
  }
  return null;
};

test("loads a measured paper-host capacity without assuming one VM can hold twenty", () => {
  assert.deepEqual(
    loadSessionHostConfig({
      IBKR_SESSION_CAPSULE_IMAGE: IMAGE,
    }),
    {
      bindHost: "127.0.0.1",
      capsuleImage: IMAGE,
      capacity: 1,
      dockerBinary: "docker",
      mode: "paper",
      port: 18748,
      seccompProfilePath: DEFAULT_SECCOMP_PROFILE_PATH,
    },
  );
  assert.equal(
    loadSessionHostConfig({
      IBKR_SESSION_CAPSULE_IMAGE: IMAGE,
      IBKR_SESSION_HOST_CAPACITY: "2",
    }).capacity,
    2,
  );
});

test("accepts a local immutable image ID for development", () => {
  assert.equal(
    loadSessionHostConfig({
      IBKR_SESSION_CAPSULE_IMAGE: "sha256:" + "b".repeat(64),
    }).capsuleImage,
    "sha256:" + "b".repeat(64),
  );
});

test("rejects unsafe or unsupported host configuration", () => {
  for (const env of [
    {},
    { IBKR_SESSION_CAPSULE_IMAGE: IMAGE, IBKR_SESSION_HOST_MODE: "live" },
    { IBKR_SESSION_CAPSULE_IMAGE: IMAGE, IBKR_SESSION_HOST_PORT: "0" },
    { IBKR_SESSION_CAPSULE_IMAGE: IMAGE, IBKR_SESSION_HOST_PORT: "12.5" },
    { IBKR_SESSION_CAPSULE_IMAGE: IMAGE, IBKR_SESSION_HOST_PORT: "garbage" },
    { IBKR_SESSION_CAPSULE_IMAGE: IMAGE, IBKR_SESSION_HOST_CAPACITY: "0" },
    { IBKR_SESSION_CAPSULE_IMAGE: IMAGE, IBKR_SESSION_HOST_CAPACITY: "1.5" },
    { IBKR_SESSION_CAPSULE_IMAGE: IMAGE, IBKR_SESSION_HOST_CAPACITY: "21" },
    { IBKR_SESSION_CAPSULE_IMAGE: "ghcr.io/pyrus/capsule:latest" },
    { IBKR_SESSION_CAPSULE_IMAGE: "sha256:" + "a".repeat(63) },
    { IBKR_SESSION_CAPSULE_IMAGE: "sha256:" + "A".repeat(64) },
    { IBKR_SESSION_CAPSULE_IMAGE: "-malicious@sha256:" + "a".repeat(64) },
    { IBKR_SESSION_CAPSULE_IMAGE: "bad image@sha256:" + "a".repeat(64) },
  ]) {
    assert.throws(() => loadSessionHostConfig(env), CapsuleError);
  }
});

test("uses host-scoped slot names with opaque session labels", () => {
  const name = capsuleNameForSession(SESSION_ID);

  assert.equal(name, SLOT_NAME);
  assert.equal(name, capsuleNameForSession(OTHER_SESSION_ID));
  assert.equal(capsuleNameForSession(SESSION_ID, 2), "pyrus-ibkr-slot-2");
  assert.notEqual(
    capsuleNameForSession(SESSION_ID, 2),
    capsuleNameForSession(OTHER_SESSION_ID, 1),
  );
  const first = buildCreateCapsuleInvocation(
    loadSessionHostConfig({ IBKR_SESSION_CAPSULE_IMAGE: IMAGE }),
    SESSION_ID,
  );
  const second = buildCreateCapsuleInvocation(
    loadSessionHostConfig({ IBKR_SESSION_CAPSULE_IMAGE: IMAGE }),
    OTHER_SESSION_ID,
  );
  const firstLabel = first.args.find((arg) =>
    arg.startsWith("pyrus.ibkr.session_hash="),
  );
  const secondLabel = second.args.find((arg) =>
    arg.startsWith("pyrus.ibkr.session_hash="),
  );
  assert.match(firstLabel ?? "", /^pyrus\.ibkr\.session_hash=[a-f0-9]{24}$/);
  assert.match(secondLabel ?? "", /^pyrus\.ibkr\.session_hash=[a-f0-9]{24}$/);
  assert.notEqual(firstLabel, secondLabel);
  assert(!JSON.stringify(first).includes(SESSION_ID));
  assert.throws(() => capsuleNameForSession("../../not-a-uuid"), CapsuleError);
  assert.throws(() => capsuleNameForSession(SESSION_ID, 0), CapsuleError);
});

test("builds isolated names, networks, and loopback relays for every host slot", () => {
  const config = loadSessionHostConfig({
    IBKR_SESSION_CAPSULE_IMAGE: IMAGE,
    IBKR_SESSION_HOST_CAPACITY: "2",
  });
  const invocation = buildCreateCapsuleInvocation(config, SESSION_ID, 2);

  assert.deepEqual(invocation.args.slice(0, 4), [
    "create",
    "--name",
    "pyrus-ibkr-slot-2",
    "--label",
  ]);
  assert.equal(
    invocation.args[invocation.args.indexOf("--network") + 1],
    "pyrus-ibkr-capsule-net-2",
  );
});

test("builds leased capsules with one non-resetting monotonic grant", () => {
  const config = loadSessionHostConfig({ IBKR_SESSION_CAPSULE_IMAGE: IMAGE });
  const grant = leaseGrant(25_000_000_000n);
  const invocation = buildCreateCapsuleInvocation(
    config,
    SESSION_ID,
    1,
    7,
    grant,
  );
  const serialized = JSON.stringify(invocation.args);
  const fenceHash = invocation.args
    .find((arg) => arg.startsWith("pyrus.ibkr.fence_hash="))!
    .split("=", 2)[1]!;

  assert(invocation.args.includes("pyrus.ibkr.lease_protocol=1"));
  assert(invocation.args.includes("PYRUS_IBKR_CAPSULE_LEASE_VERSION=1"));
  assert(
    invocation.args.includes(
      `PYRUS_IBKR_CAPSULE_LEASE_BOOT_ID=${grant.bootId}`,
    ),
  );
  assert(
    invocation.args.includes(
      `PYRUS_IBKR_CAPSULE_LEASE_FENCE_HASH=${fenceHash}`,
    ),
  );
  assert(
    invocation.args.includes(
      `PYRUS_IBKR_CAPSULE_LEASE_CONTROL_ATTEMPT_ID=${grant.controlAttemptId}`,
    ),
  );
  assert(
    invocation.args.includes(
      `PYRUS_IBKR_CAPSULE_LEASE_GRANT_NOT_AFTER_NS=${grant.grantNotAfterNs}`,
    ),
  );
  assert.match(
    invocation.args.find((argument) =>
      argument.startsWith("PYRUS_IBKR_CAPSULE_LEASE_CONTROL_KEY="),
    ) ?? "",
    /^PYRUS_IBKR_CAPSULE_LEASE_CONTROL_KEY=[a-f0-9]{64}$/,
  );
  assert.equal(invocation.args[invocation.args.indexOf("--restart") + 1], "no");
  assert.equal(invocation.args[invocation.args.indexOf("--user") + 1], "0:0");
  assert.deepEqual(
    invocation.args.flatMap((argument, index) =>
      argument === "--cap-add" ? [invocation.args[index + 1]] : [],
    ),
    ["KILL", "NET_ADMIN", "SETGID", "SETPCAP", "SETUID"],
  );
  assert(
    invocation.args.includes(
      "/run/pyrus:rw,noexec,nosuid,nodev,size=512m,mode=0710,uid=10001,gid=0",
    ),
  );
  assert(!invocation.args.includes("--init"));
  assert(!serialized.includes(SESSION_ID));
});

test("authenticates capsule lease renewal frames with the per-capsule key", () => {
  const grant = leaseGrant(25_000_000_000n);
  const fenceHash = "c".repeat(24);
  const frame = serializeCapsuleLeaseRenewal({
    controlKey: LEASE_CONTROL_KEY,
    fenceHash,
    grant,
  });
  const separator = frame.indexOf(" ");
  const mac = frame.slice(0, separator);
  const payload = frame.slice(separator + 1, -1);

  assert.equal(
    mac,
    createHmac("sha256", Buffer.from(LEASE_CONTROL_KEY, "hex"))
      .update(payload)
      .digest("hex"),
  );
  assert.deepEqual(JSON.parse(payload), {
    version: 1,
    bootId: grant.bootId,
    fenceHash,
    controlAttemptId: grant.controlAttemptId,
    grantNotAfterNs: grant.grantNotAfterNs,
  });
  assert.equal(frame.endsWith("\n"), true);
  assert.throws(
    () =>
      serializeCapsuleLeaseRenewal({
        controlKey: LEASE_CONTROL_KEY,
        fenceHash,
        grant: leaseGrant((1n << 63n) - 1n),
      }),
    CapsuleError,
  );
});

test("issues capsule grants from the session host boot clock", () => {
  const issue = createCapsuleLeaseGrantIssuer(BOOT_ID, () => 7_000_000_000n);
  assert.deepEqual(issue(CONTROL_ATTEMPT_ID), {
    version: 1,
    bootId: BOOT_ID,
    controlAttemptId: CONTROL_ATTEMPT_ID,
    grantNotAfterNs: "27000000000",
  });
});

test("builds a fixed hardened Docker create invocation without secret-bearing inputs", () => {
  const config = loadSessionHostConfig({ IBKR_SESSION_CAPSULE_IMAGE: IMAGE });
  const invocation = buildCreateCapsuleInvocation(config, SESSION_ID);
  const name = capsuleNameForSession(SESSION_ID);
  const serialized = JSON.stringify(invocation);

  assert.deepEqual(invocation, {
    command: "docker",
    args: [
      "create",
      "--name",
      name,
      "--label",
      "pyrus.ibkr.capsule=1",
      "--label",
      `pyrus.ibkr.session_hash=${SESSION_HASH}`,
      "--label",
      `pyrus.ibkr.fence_hash=${SESSION_HASH}`,
      "--label",
      "pyrus.ibkr.generation=0",
      "--label",
      "pyrus.ibkr.slot=1",
      "--pull",
      "never",
      "--restart",
      "on-failure:3",
      "--user",
      "0:0",
      "--read-only",
      "--cap-drop",
      "ALL",
      "--cap-add",
      "KILL",
      "--cap-add",
      "NET_ADMIN",
      "--cap-add",
      "SETGID",
      "--cap-add",
      "SETPCAP",
      "--cap-add",
      "SETUID",
      "--security-opt",
      "no-new-privileges=true",
      "--security-opt",
      `seccomp=${DEFAULT_SECCOMP_PROFILE_PATH}`,
      "--network",
      NETWORK_NAME,
      "--cgroupns",
      "private",
      "--memory",
      "2g",
      "--memory-swap",
      "2g",
      "--cpus",
      "1",
      "--pids-limit",
      "512",
      "--shm-size",
      "512m",
      "--ulimit",
      "core=0",
      "--ulimit",
      "nofile=4096:4096",
      "--tmpfs",
      "/tmp:rw,noexec,nosuid,nodev,size=256m,mode=1777",
      "--tmpfs",
      "/run/pyrus:rw,noexec,nosuid,nodev,size=512m,mode=0700,uid=10001,gid=10001",
      "--log-driver",
      "local",
      "--log-opt",
      "max-size=10m",
      "--log-opt",
      "max-file=3",
      "--stop-timeout",
      "30",
      IMAGE,
    ],
  });
  assert(!serialized.includes(SESSION_ID));
  assert(!invocation.args.includes("bridge"));
  assert.equal(invocation.args.at(-1), IMAGE, "image is the final argument");
});

test("binds capsule identity to an opaque generation fence", () => {
  const config = loadSessionHostConfig({
    IBKR_SESSION_CAPSULE_IMAGE: IMAGE,
    IBKR_SESSION_HOST_CAPACITY: "2",
  });
  const generationSeven = buildCreateCapsuleInvocation(
    config,
    SESSION_ID,
    2,
    7,
  );
  const generationEight = buildCreateCapsuleInvocation(
    config,
    SESSION_ID,
    2,
    8,
  );
  const label = (
    invocation: ReturnType<typeof buildCreateCapsuleInvocation>,
    prefix: string,
  ) => invocation.args.find((argument) => argument.startsWith(prefix));

  assert.equal(
    label(generationSeven, "pyrus.ibkr.session_hash="),
    `pyrus.ibkr.session_hash=${SESSION_HASH}`,
  );
  assert.equal(
    label(generationSeven, "pyrus.ibkr.generation="),
    "pyrus.ibkr.generation=7",
  );
  assert.equal(label(generationSeven, "pyrus.ibkr.slot="), "pyrus.ibkr.slot=2");
  assert.match(
    label(generationSeven, "pyrus.ibkr.fence_hash=") ?? "",
    /^pyrus\.ibkr\.fence_hash=[a-f0-9]{24}$/,
  );
  assert.notEqual(
    label(generationSeven, "pyrus.ibkr.fence_hash="),
    label(generationEight, "pyrus.ibkr.fence_hash="),
  );
  assert(!JSON.stringify(generationSeven).includes(SESSION_ID));
});

test("creates and verifies an ICC-disabled capsule network before use", async () => {
  const calls: string[][] = [];
  let networkInspections = 0;
  const runner: CommandRunner = async (_command, args) => {
    calls.push(args);
    if (args[0] === "network" && args[1] === "inspect") {
      networkInspections += 1;
      if (networkInspections === 1) {
        return { code: 1, stdout: "", stderr: "not found" };
      }
    }
    if (args[0] === "network" && args[1] === "create") {
      return { code: 0, stdout: `${NETWORK_NAME}\n`, stderr: "" };
    }
    return capsuleProbeResult(args) ?? { code: 0, stdout: "", stderr: "" };
  };
  const manager = new CapsuleManager(
    loadSessionHostConfig({ IBKR_SESSION_CAPSULE_IMAGE: IMAGE }),
    runner,
  );

  await manager.ensure(SESSION_ID);
  assert.deepEqual(
    calls.find((args) => args[0] === "network" && args[1] === "create"),
    [
      "network",
      "create",
      "--driver",
      "bridge",
      "--ipv6=false",
      "--opt",
      "com.docker.network.bridge.enable_icc=false",
      "--opt",
      "com.docker.network.bridge.gateway_mode_ipv4=nat",
      "--label",
      "pyrus.ibkr.network=1",
      NETWORK_NAME,
    ],
  );
  assert.equal(networkInspections, 2);
  assert(
    calls.findIndex((args) => args[0] === "network") <
      calls.findIndex((args) => args[0] === "create"),
  );
});

test("recreates a valid capsule network before provisioning a fresh slot", async () => {
  const calls: string[][] = [];
  let networkExists = true;
  const runner: CommandRunner = async (_command, args) => {
    calls.push(args);
    if (args[0] === "network" && args[1] === "inspect") {
      return networkExists
        ? (capsuleProbeResult(args) ?? { code: 1, stdout: "", stderr: "" })
        : { code: 1, stdout: "", stderr: "not found" };
    }
    if (args[0] === "network" && args[1] === "rm") {
      networkExists = false;
      return { code: 0, stdout: `${NETWORK_NAME}\n`, stderr: "" };
    }
    if (args[0] === "network" && args[1] === "create") {
      assert.equal(networkExists, false);
      networkExists = true;
      return { code: 0, stdout: `${NETWORK_NAME}\n`, stderr: "" };
    }
    return capsuleProbeResult(args) ?? { code: 0, stdout: "", stderr: "" };
  };
  const manager = new CapsuleManager(
    loadSessionHostConfig({ IBKR_SESSION_CAPSULE_IMAGE: IMAGE }),
    runner,
  );

  await manager.ensure(SESSION_ID);

  const removeIndex = calls.findIndex(
    (args) => args[0] === "network" && args[1] === "rm",
  );
  const networkCreateIndex = calls.findIndex(
    (args) => args[0] === "network" && args[1] === "create",
  );
  const capsuleCreateIndex = calls.findIndex((args) => args[0] === "create");
  assert(removeIndex >= 0);
  assert(removeIndex < networkCreateIndex);
  assert(networkCreateIndex < capsuleCreateIndex);
});

test("fails closed when an existing capsule network cannot be recreated", async () => {
  const calls: string[][] = [];
  const runner: CommandRunner = async (_command, args) => {
    calls.push(args);
    if (args[0] === "network" && args[1] === "rm") {
      return { code: 1, stdout: "", stderr: "network is in use" };
    }
    return capsuleProbeResult(args) ?? { code: 0, stdout: "", stderr: "" };
  };
  const manager = new CapsuleManager(
    loadSessionHostConfig({ IBKR_SESSION_CAPSULE_IMAGE: IMAGE }),
    runner,
  );

  await assert.rejects(
    () => manager.ensure(SESSION_ID),
    (error) =>
      error instanceof CapsuleError && error.code === "capsule_network_invalid",
  );
  assert(!calls.some((args) => args[0] === "create"));
});

test("fails closed when a fresh network cannot be proven newly created", async () => {
  const calls: string[][] = [];
  let networkInspections = 0;
  const runner: CommandRunner = async (_command, args) => {
    calls.push(args);
    if (args[0] === "network" && args[1] === "inspect") {
      networkInspections += 1;
      if (networkInspections === 1) {
        return { code: 1, stdout: "", stderr: "temporarily unavailable" };
      }
    }
    if (args[0] === "network" && args[1] === "create") {
      return { code: 1, stdout: "", stderr: "already exists" };
    }
    return capsuleProbeResult(args) ?? { code: 0, stdout: "", stderr: "" };
  };
  const manager = new CapsuleManager(
    loadSessionHostConfig({ IBKR_SESSION_CAPSULE_IMAGE: IMAGE }),
    runner,
  );

  await assert.rejects(
    () => manager.ensure(SESSION_ID),
    (error) =>
      error instanceof CapsuleError && error.code === "capsule_network_invalid",
  );
  assert(!calls.some((args) => args[0] === "create"));
});

test("rejects a pre-existing capsule network without the isolation contract", async () => {
  for (const overrides of [
    {
      Options: {
        "com.docker.network.bridge.enable_icc": "true",
        "com.docker.network.bridge.gateway_mode_ipv4": "nat",
      },
    },
    { EnableIPv6: true },
    {
      Options: {
        "com.docker.network.bridge.enable_icc": "false",
        "com.docker.network.bridge.gateway_mode_ipv4": "nat",
        "com.docker.network.bridge.trusted_host_interfaces": "eth0",
      },
    },
  ]) {
    const calls: string[][] = [];
    const runner: CommandRunner = async (_command, args) => {
      calls.push(args);
      if (args[0] === "network" && args[1] === "inspect") {
        return {
          code: 0,
          stdout: JSON.stringify({
            Attachable: false,
            ConfigOnly: false,
            Driver: "bridge",
            EnableIPv6: false,
            Id: NETWORK_ID,
            Ingress: false,
            Internal: false,
            Labels: { "pyrus.ibkr.network": "1" },
            Name: NETWORK_NAME,
            Options: {
              "com.docker.network.bridge.enable_icc": "false",
              "com.docker.network.bridge.gateway_mode_ipv4": "nat",
            },
            Scope: "local",
            ...overrides,
          }),
          stderr: "",
        };
      }
      return capsuleProbeResult(args) ?? { code: 0, stdout: "", stderr: "" };
    };
    const manager = new CapsuleManager(
      loadSessionHostConfig({ IBKR_SESSION_CAPSULE_IMAGE: IMAGE }),
      runner,
    );

    await assert.rejects(
      () => manager.ensure(SESSION_ID),
      (error) =>
        error instanceof CapsuleError &&
        error.code === "capsule_network_invalid",
    );
    assert(!calls.some((args) => args[0] === "create"));
    assert(
      !calls.some((args) => args[0] === "network" && args[1] === "create"),
    );
  }
});

test("does not publish the unauthenticated capsule relays through Docker", () => {
  const invocation = buildCreateCapsuleInvocation(
    loadSessionHostConfig({ IBKR_SESSION_CAPSULE_IMAGE: IMAGE }),
    SESSION_ID,
  );

  assert(!invocation.args.includes("--publish"));
  assert(!invocation.args.some((arg) => arg.endsWith("/tcp")));
});

test("keeps one session idempotent and rejects a second before invoking Docker", async () => {
  const calls: Array<{ command: string; args: string[] }> = [];
  const runner: CommandRunner = async (command, args) => {
    calls.push({ command, args });
    return capsuleProbeResult(args) ?? { code: 0, stdout: "", stderr: "" };
  };
  const manager = new CapsuleManager(
    loadSessionHostConfig({ IBKR_SESSION_CAPSULE_IMAGE: IMAGE }),
    runner,
  );

  const first = await manager.ensure(SESSION_ID);
  const repeated = await manager.ensure(SESSION_ID);

  assert.deepEqual(first, {
    name: SLOT_NAME,
    status: "ready",
    loginCompletions: 0,
  });
  assert.deepEqual(repeated, first);
  assert.deepEqual(
    calls.map(({ args }) => args[0]),
    [
      "container",
      "network",
      "network",
      "network",
      "network",
      "create",
      "start",
      "container",
      "logs",
      "container",
      "container",
      "container",
      "logs",
      "container",
    ],
  );
  const callCountBeforeCapacityRejection = calls.length;
  await assert.rejects(
    () => manager.ensure(OTHER_SESSION_ID),
    (error) =>
      error instanceof CapsuleError && error.code === "capacity_exhausted",
  );
  assert.equal(
    calls.length,
    callCountBeforeCapacityRejection,
    "capacity rejection happens before Docker",
  );
  assert(!calls.some(({ args }) => args[0] === "exec"));
});

test("does not return a replacement session through an in-flight status probe", async () => {
  let blockNextStateProbe = false;
  let markStateProbeStarted!: () => void;
  let releaseStateProbe!: () => void;
  const stateProbeStarted = new Promise<void>((resolve) => {
    markStateProbeStarted = resolve;
  });
  const stateProbeGate = new Promise<void>((resolve) => {
    releaseStateProbe = resolve;
  });
  let currentSessionHash = SESSION_HASH;
  const runner: CommandRunner = async (_command, args) => {
    if (args[0] === "create") {
      currentSessionHash =
        args
          .find((arg) => arg.startsWith("pyrus.ibkr.session_hash="))
          ?.split("=", 2)[1] ?? currentSessionHash;
    }
    if (args.includes("{{json .State}}") && blockNextStateProbe) {
      blockNextStateProbe = false;
      markStateProbeStarted();
      await stateProbeGate;
    }
    return (
      capsuleProbeResult(args, currentSessionHash) ?? {
        code: 0,
        stdout: "",
        stderr: "",
      }
    );
  };
  const manager = new CapsuleManager(
    loadSessionHostConfig({ IBKR_SESSION_CAPSULE_IMAGE: IMAGE }),
    runner,
  );

  await manager.ensure(SESSION_ID);
  blockNextStateProbe = true;
  const staleStatus = manager.status(SESSION_ID);
  await stateProbeStarted;
  await manager.release(SESSION_ID);
  await manager.ensure(OTHER_SESSION_ID);
  releaseStateProbe();

  await assert.rejects(
    staleStatus,
    (error) =>
      error instanceof CapsuleError && error.code === "session_not_found",
  );
  assert.equal((await manager.status(OTHER_SESSION_ID))?.status, "ready");
});

test("returns session-owned loopback targets and releases the fixed slot", async () => {
  const calls: string[][] = [];
  const runner: CommandRunner = async (_command, args) => {
    calls.push(args);
    return capsuleProbeResult(args) ?? { code: 0, stdout: "", stderr: "" };
  };
  const manager = new CapsuleManager(
    loadSessionHostConfig({ IBKR_SESSION_CAPSULE_IMAGE: IMAGE }),
    runner,
  );

  assert.throws(
    () => manager.getTarget(SESSION_ID, "cpg"),
    (error) =>
      error instanceof CapsuleError && error.code === "session_not_found",
  );
  assert.equal(manager.getRelayTarget("cpg"), null);
  await manager.ensure(SESSION_ID);
  assert.deepEqual(manager.getTarget(SESSION_ID, "cpg"), {
    host: "127.0.0.1",
    port: 15000,
  });
  assert.deepEqual(manager.getTarget(SESSION_ID, "console"), {
    host: "127.0.0.1",
    port: 16080,
  });
  assert.deepEqual(manager.getRelayTarget("cpg"), {
    host: NETWORK_IP,
    port: 15000,
  });
  assert.deepEqual(manager.getRelayTarget("console"), {
    host: NETWORK_IP,
    port: 16080,
  });
  assert.throws(
    () => manager.getTarget(OTHER_SESSION_ID, "cpg"),
    (error) =>
      error instanceof CapsuleError && error.code === "session_not_found",
  );

  await manager.release(SESSION_ID);
  assert.deepEqual(calls.at(-1), ["rm", "--force", CONTAINER_ID]);
  assert.deepEqual(manager.snapshot(), {
    mode: "paper",
    capacity: { max: 1, active: 0 },
  });
});

test("coalesces concurrent releases without poisoning capacity", async () => {
  let markRemoveStarted!: () => void;
  let releaseRemove!: () => void;
  const removeStarted = new Promise<void>((resolve) => {
    markRemoveStarted = resolve;
  });
  const removeGate = new Promise<void>((resolve) => {
    releaseRemove = resolve;
  });
  let removeCalls = 0;
  let currentSessionHash = SESSION_HASH;
  const runner: CommandRunner = async (_command, args) => {
    if (args[0] === "create") {
      currentSessionHash =
        args
          .find((arg) => arg.startsWith("pyrus.ibkr.session_hash="))
          ?.split("=", 2)[1] ?? currentSessionHash;
    }
    if (args[0] === "rm") {
      const call = ++removeCalls;
      markRemoveStarted();
      await removeGate;
      return call === 1
        ? { code: 0, stdout: "", stderr: "" }
        : { code: 1, stdout: "", stderr: "already removed" };
    }
    return (
      capsuleProbeResult(args, currentSessionHash) ?? {
        code: 0,
        stdout: "",
        stderr: "",
      }
    );
  };
  const manager = new CapsuleManager(
    loadSessionHostConfig({ IBKR_SESSION_CAPSULE_IMAGE: IMAGE }),
    runner,
  );

  await manager.ensure(SESSION_ID);
  const first = manager.release(SESSION_ID);
  await removeStarted;
  assert.equal(manager.getRelayTarget("cpg"), null);
  const repeated = manager.release(SESSION_ID);
  releaseRemove();

  await Promise.all([first, repeated]);
  assert.equal(removeCalls, 1);
  assert.deepEqual(manager.snapshot(), {
    mode: "paper",
    capacity: { max: 1, active: 0 },
  });
  assert.equal((await manager.ensure(OTHER_SESSION_ID)).status, "ready");
});

test("reprobes a cached ready capsule before reporting it ready again", async () => {
  let stateProbes = 0;
  const runner: CommandRunner = async (_command, args) => {
    if (args[0] === "container" && args[1] === "ls") {
      return noExistingSlot();
    }
    if (args.includes("{{json .State}}")) {
      stateProbes += 1;
      return {
        code: 0,
        stdout: JSON.stringify({
          Running: stateProbes <= 2 || stateProbes >= 4,
          StartedAt: STARTED_AT,
        }),
        stderr: "",
      };
    }
    if (args[0] === "logs") {
      return { code: 0, stdout: dockerLogLine(READY_MARKER), stderr: "" };
    }
    return capsuleProbeResult(args) ?? { code: 0, stdout: "", stderr: "" };
  };
  const manager = new CapsuleManager(
    loadSessionHostConfig({ IBKR_SESSION_CAPSULE_IMAGE: IMAGE }),
    runner,
  );

  assert.deepEqual(await manager.ensure(SESSION_ID), {
    name: SLOT_NAME,
    status: "ready",
    loginCompletions: 0,
  });
  assert.deepEqual(await manager.ensure(SESSION_ID), {
    name: SLOT_NAME,
    status: "occupied",
    loginCompletions: 0,
  });
  assert.equal(manager.getRelayTarget("cpg"), null);
  assert.deepEqual(await manager.ensure(SESSION_ID), {
    name: SLOT_NAME,
    status: "ready",
    loginCompletions: 0,
  });
  assert.deepEqual(manager.getRelayTarget("cpg"), {
    host: NETWORK_IP,
    port: 15000,
  });
  assert.equal(stateProbes, 5);
});

test("waits for an exact log marker and running state before returning ready", async () => {
  const calls: string[][] = [];
  let logProbe = 0;
  let delays = 0;
  const runner: CommandRunner = async (_command, args) => {
    calls.push(args);
    if (args[0] === "logs") {
      logProbe += 1;
      return {
        code: 0,
        stdout:
          logProbe === 1
            ? dockerLogLine(`prefix-${READY_MARKER}-suffix`)
            : `${dockerLogLine("noise")}${dockerLogLine(READY_MARKER)}`,
        stderr: "",
      };
    }
    return capsuleProbeResult(args) ?? { code: 0, stdout: "", stderr: "" };
  };
  const manager = new CapsuleManager(
    loadSessionHostConfig({ IBKR_SESSION_CAPSULE_IMAGE: IMAGE }),
    runner,
    async () => {
      delays += 1;
    },
  );

  assert.deepEqual(await manager.ensure(SESSION_ID), {
    name: SLOT_NAME,
    status: "ready",
    loginCompletions: 0,
  });
  assert.equal(logProbe, 2);
  assert.equal(delays, 1);
  assert(!calls.some((args) => args[0] === "exec"));
});

test("counts only exact login markers and never lowers the exposed completion count", async () => {
  let logProbe = 0;
  const runner: CommandRunner = async (_command, args) => {
    if (args[0] === "logs") {
      logProbe += 1;
      return {
        code: 0,
        stdout:
          logProbe === 1
            ? `${dockerLogLine(READY_MARKER)}${dockerLogLine(`prefix-${LOGIN_COMPLETE_MARKER}`)}${dockerLogLine(`${LOGIN_COMPLETE_MARKER}-suffix`)}`
            : logProbe === 2
              ? `${dockerLogLine(READY_MARKER)}${dockerLogLine(LOGIN_COMPLETE_MARKER)}${dockerLogLine(LOGIN_COMPLETE_MARKER)}`
              : `${dockerLogLine(READY_MARKER)}${dockerLogLine(LOGIN_COMPLETE_MARKER)}`,
        stderr: "",
      };
    }
    return capsuleProbeResult(args) ?? { code: 0, stdout: "", stderr: "" };
  };
  const manager = new CapsuleManager(
    loadSessionHostConfig({ IBKR_SESSION_CAPSULE_IMAGE: IMAGE }),
    runner,
  );

  assert.deepEqual(await manager.ensure(SESSION_ID), {
    name: SLOT_NAME,
    status: "ready",
    loginCompletions: 0,
  });
  assert.deepEqual(await manager.status(SESSION_ID), {
    name: SLOT_NAME,
    status: "ready",
    loginCompletions: 2,
  });
  assert.deepEqual(await manager.status(SESSION_ID), {
    name: SLOT_NAME,
    status: "ready",
    loginCompletions: 2,
  });
});

test("keeps cumulative login completions across a capsule restart", async () => {
  const runner: CommandRunner = async (_command, args) => {
    if (args[1] === "ls") {
      return { code: 0, stdout: `${SLOT_NAME}\n`, stderr: "" };
    }
    if (args.includes("{{json .Config.Labels}}")) {
      return {
        code: 0,
        stdout: JSON.stringify({
          "pyrus.ibkr.capsule": "1",
          "pyrus.ibkr.session_hash": SESSION_HASH,
        }),
        stderr: "",
      };
    }
    if (args.includes("{{json .State}}")) {
      return {
        code: 0,
        stdout: JSON.stringify({ Running: true, StartedAt: STARTED_AT }),
        stderr: "",
      };
    }
    if (args[0] === "logs") {
      return {
        code: 0,
        stdout:
          dockerLogLine(READY_MARKER, "2026-07-09T21:59:50.000Z") +
          dockerLogLine(LOGIN_COMPLETE_MARKER, "2026-07-09T21:59:55.000Z") +
          dockerLogLine(READY_MARKER) +
          dockerLogLine(LOGIN_COMPLETE_MARKER, "2026-07-09T22:00:02.000Z"),
        stderr: "",
      };
    }
    const capsuleResult = capsuleProbeResult(args);
    if (capsuleResult) return capsuleResult;
    throw new Error(`unexpected Docker command: ${args.join(" ")}`);
  };
  const manager = new CapsuleManager(
    loadSessionHostConfig({ IBKR_SESSION_CAPSULE_IMAGE: IMAGE }),
    runner,
  );

  assert.deepEqual(await manager.reconcile(), {
    name: SLOT_NAME,
    status: "ready",
    loginCompletions: 2,
  });
});

test("does not accept a prior generation ready marker after restart", async () => {
  const runner: CommandRunner = async (_command, args) => {
    if (args[1] === "ls") {
      return { code: 0, stdout: `${SLOT_NAME}\n`, stderr: "" };
    }
    if (args.includes("{{json .Config.Labels}}")) {
      return {
        code: 0,
        stdout: JSON.stringify({
          "pyrus.ibkr.capsule": "1",
          "pyrus.ibkr.session_hash": SESSION_HASH,
        }),
        stderr: "",
      };
    }
    if (args.includes("{{json .State}}")) {
      return {
        code: 0,
        stdout: JSON.stringify({ Running: true, StartedAt: STARTED_AT }),
        stderr: "",
      };
    }
    if (args[0] === "logs") {
      return {
        code: 0,
        stdout:
          dockerLogLine(READY_MARKER, "2026-07-09T21:59:50.000Z") +
          dockerLogLine(LOGIN_COMPLETE_MARKER, "2026-07-09T21:59:55.000Z"),
        stderr: "",
      };
    }
    const capsuleResult = capsuleProbeResult(args);
    if (capsuleResult) return capsuleResult;
    throw new Error(`unexpected Docker command: ${args.join(" ")}`);
  };
  const manager = new CapsuleManager(
    loadSessionHostConfig({ IBKR_SESSION_CAPSULE_IMAGE: IMAGE }),
    runner,
  );

  assert.deepEqual(await manager.reconcile(), {
    name: SLOT_NAME,
    status: "occupied",
    loginCompletions: 1,
  });
});

test("does not certify readiness when the capsule restarts during a probe", async () => {
  let stateReads = 0;
  const runner: CommandRunner = async (_command, args) => {
    if (args[1] === "ls") {
      return { code: 0, stdout: `${SLOT_NAME}\n`, stderr: "" };
    }
    if (args.includes("{{json .Config.Labels}}")) {
      return {
        code: 0,
        stdout: JSON.stringify({
          "pyrus.ibkr.capsule": "1",
          "pyrus.ibkr.session_hash": SESSION_HASH,
        }),
        stderr: "",
      };
    }
    if (args.includes("{{json .State}}")) {
      stateReads += 1;
      return {
        code: 0,
        stdout: JSON.stringify({
          Running: true,
          StartedAt: stateReads === 1 ? STARTED_AT : "2026-07-09T22:00:02.000Z",
        }),
        stderr: "",
      };
    }
    if (args[0] === "logs") {
      return {
        code: 0,
        stdout: dockerLogLine(READY_MARKER),
        stderr: "",
      };
    }
    const capsuleResult = capsuleProbeResult(args);
    if (capsuleResult) return capsuleResult;
    throw new Error(`unexpected Docker command: ${args.join(" ")}`);
  };
  const manager = new CapsuleManager(
    loadSessionHostConfig({ IBKR_SESSION_CAPSULE_IMAGE: IMAGE }),
    runner,
  );

  assert.deepEqual(await manager.reconcile(), {
    name: SLOT_NAME,
    status: "occupied",
    loginCompletions: 0,
  });
  assert.equal(stateReads, 2);
});

test("bounds marker polling and sanitizes readiness failure before cleanup", async () => {
  const secret = "sensitive-capsule-output";
  let logProbes = 0;
  let inspectProbes = 0;
  let delays = 0;
  let removes = 0;
  const runner: CommandRunner = async (_command, args) => {
    if (args[0] === "logs") {
      logProbes += 1;
      return { code: 0, stdout: `not-ready ${secret}\n`, stderr: "" };
    }
    if (args.includes("{{json .State}}")) inspectProbes += 1;
    if (args[0] === "rm") removes += 1;
    return capsuleProbeResult(args) ?? { code: 0, stdout: "", stderr: "" };
  };
  const manager = new CapsuleManager(
    loadSessionHostConfig({ IBKR_SESSION_CAPSULE_IMAGE: IMAGE }),
    runner,
    async () => {
      delays += 1;
    },
  );

  await assert.rejects(
    () => manager.ensure(SESSION_ID),
    (error) =>
      error instanceof CapsuleError &&
      error.code === "capsule_readiness_failed" &&
      !error.message.includes(secret),
  );
  assert.equal(logProbes, 90);
  assert.equal(inspectProbes, 90);
  assert.equal(delays, 89);
  assert.equal(removes, 1);
  assert.deepEqual(manager.snapshot(), {
    mode: "paper",
    capacity: { max: 1, active: 0 },
  });
});

test("sanitizes Docker failures", async () => {
  const sentinel = "sensitive-docker-stderr";
  const runner: CommandRunner = async (_command, args) => {
    const probe = capsuleProbeResult(args);
    if (probe) return probe;
    if (args[0] === "network") {
      return { code: 0, stdout: "", stderr: "" };
    }
    return {
      code: 1,
      stdout: "",
      stderr: sentinel,
    };
  };
  const manager = new CapsuleManager(
    loadSessionHostConfig({ IBKR_SESSION_CAPSULE_IMAGE: IMAGE }),
    runner,
  );

  await assert.rejects(
    () => manager.ensure(SESSION_ID),
    (error) =>
      error instanceof CapsuleError &&
      error.code === "docker_create_failed" &&
      !error.message.includes(sentinel),
  );
});

test("reserves capacity while provisioning and coalesces concurrent ensures", async () => {
  let releaseCreate!: () => void;
  const createGate = new Promise<void>((resolve) => {
    releaseCreate = resolve;
  });
  const calls: string[][] = [];
  const runner: CommandRunner = async (_command, args) => {
    calls.push(args);
    if (args[0] === "create") await createGate;
    return capsuleProbeResult(args) ?? { code: 0, stdout: "", stderr: "" };
  };
  const manager = new CapsuleManager(
    loadSessionHostConfig({ IBKR_SESSION_CAPSULE_IMAGE: IMAGE }),
    runner,
  );

  const first = manager.ensure(SESSION_ID);
  const repeated = manager.ensure(SESSION_ID);
  await assert.rejects(
    () => manager.ensure(OTHER_SESSION_ID),
    (error) =>
      error instanceof CapsuleError && error.code === "capacity_exhausted",
  );
  releaseCreate();

  assert.deepEqual(await repeated, await first);
  assert.deepEqual(
    calls.map((args) => args[0]),
    [
      "container",
      "network",
      "network",
      "network",
      "network",
      "create",
      "start",
      "container",
      "logs",
      "container",
      "container",
    ],
  );
});

test("removes a partially created capsule and releases capacity after start failure", async () => {
  let failStart = true;
  const calls: string[][] = [];
  const runner: CommandRunner = async (_command, args) => {
    calls.push(args);
    if (args[0] === "start" && failStart) {
      return { code: 1, stdout: "", stderr: "start failed" };
    }
    return capsuleProbeResult(args) ?? { code: 0, stdout: "", stderr: "" };
  };
  const manager = new CapsuleManager(
    loadSessionHostConfig({ IBKR_SESSION_CAPSULE_IMAGE: IMAGE }),
    runner,
  );

  await assert.rejects(
    () => manager.ensure(SESSION_ID),
    (error) =>
      error instanceof CapsuleError && error.code === "docker_start_failed",
  );
  assert.deepEqual(
    calls.map((args) => args[0]),
    [
      "container",
      "network",
      "network",
      "network",
      "network",
      "create",
      "start",
      "rm",
    ],
  );

  failStart = false;
  await manager.ensure(SESSION_ID);
  assert.deepEqual(
    calls.map((args) => args[0]),
    [
      "container",
      "network",
      "network",
      "network",
      "network",
      "create",
      "start",
      "rm",
      "network",
      "network",
      "network",
      "network",
      "create",
      "start",
      "container",
      "logs",
      "container",
      "container",
    ],
  );
});

test("clears provisioned state when the final capsule lease expires before arming", async () => {
  const config = loadSessionHostConfig({ IBKR_SESSION_CAPSULE_IMAGE: IMAGE });
  const grant = leaseGrant(20_000_000_000n);
  const fenceHash = buildCreateCapsuleInvocation(
    config,
    SESSION_ID,
    1,
    7,
    grant,
  )
    .args.find((argument) => argument.startsWith("pyrus.ibkr.fence_hash="))!
    .split("=", 2)[1]!;
  let hasContainer = false;
  let nowNs = 10_000_000_000n;
  let removals = 0;
  const runner: CommandRunner = async (_command, args) => {
    if (args[0] === "container" && args[1] === "ls") {
      return {
        code: 0,
        stdout: hasContainer ? `${SLOT_NAME}\n` : "",
        stderr: "",
      };
    }
    if (args[0] === "create") {
      hasContainer = true;
      return { code: 0, stdout: `${CONTAINER_ID}\n`, stderr: "" };
    }
    if (args[0] === "rm") {
      removals += 1;
      hasContainer = false;
      return { code: 0, stdout: "", stderr: "" };
    }
    const result = capsuleProbeResult(args, SESSION_HASH, {
      fenceHash,
      generation: 7,
      leaseGrant: grant,
      slotNumber: 1,
    });
    if (
      hasContainer &&
      args[0] === "container" &&
      args[1] === "inspect" &&
      args.includes("{{json .}}")
    ) {
      nowNs = 140_000_000_000n;
    }
    return result ?? { code: 0, stdout: "", stderr: "" };
  };
  const manager = new CapsuleManager(config, runner, undefined, 1, {
    clear: () => undefined,
    nowNs: () => nowNs,
    schedule: () => ({}) as ReturnType<typeof setTimeout>,
  });

  await assert.rejects(
    () => manager.ensure(SESSION_ID, 7, grant),
    (error: unknown) =>
      error instanceof CapsuleError && error.code === "lease_grant_expired",
  );
  assert.equal(removals, 1);
  assert.equal(await manager.reconcile(), null);
  assert.deepEqual(manager.snapshot(), {
    mode: "paper",
    capacity: { max: 1, active: 0 },
  });
});

test("poisons capacity when partial-capsule cleanup cannot be confirmed", async () => {
  const startSecret = "sensitive-start-stderr";
  const cleanupSecret = "sensitive-cleanup-stderr";
  const calls: string[][] = [];
  const runner: CommandRunner = async (_command, args) => {
    calls.push(args);
    const probe = capsuleProbeResult(args);
    if (probe) return probe;
    if (args[0] === "start") {
      return { code: 1, stdout: "", stderr: startSecret };
    }
    if (args[0] === "rm") {
      return { code: 1, stdout: "", stderr: cleanupSecret };
    }
    return { code: 0, stdout: "", stderr: "" };
  };
  const manager = new CapsuleManager(
    loadSessionHostConfig({ IBKR_SESSION_CAPSULE_IMAGE: IMAGE }),
    runner,
  );

  await assert.rejects(
    () => manager.ensure(SESSION_ID),
    (error) =>
      error instanceof CapsuleError &&
      error.code === "cleanup_unconfirmed" &&
      !error.message.includes(startSecret) &&
      !error.message.includes(cleanupSecret),
  );
  assert.deepEqual(manager.snapshot(), {
    mode: "paper",
    capacity: { max: 1, active: 1 },
  });
  const callCount = calls.length;
  await assert.rejects(
    () => manager.ensure(OTHER_SESSION_ID),
    (error) =>
      error instanceof CapsuleError && error.code === "cleanup_unconfirmed",
  );
  assert.equal(
    calls.length,
    callCount,
    "poisoned capacity blocks Docker calls",
  );
});

test("reconciles the fixed daemon slot and preserves capacity across host restart", async () => {
  const calls: string[][] = [];
  const runner: CommandRunner = async (_command, args) => {
    calls.push(args);
    if (args[1] === "ls") {
      return { code: 0, stdout: `${SLOT_NAME}\n`, stderr: "" };
    }
    if (args.includes("{{json .Config.Labels}}")) {
      return {
        code: 0,
        stdout: JSON.stringify({
          "pyrus.ibkr.capsule": "1",
          "pyrus.ibkr.session_hash": SESSION_HASH,
        }),
        stderr: "",
      };
    }
    const probe = capsuleProbeResult(args);
    if (probe) return probe;
    throw new Error(`unexpected Docker command: ${args.join(" ")}`);
  };
  const manager = new CapsuleManager(
    loadSessionHostConfig({ IBKR_SESSION_CAPSULE_IMAGE: IMAGE }),
    runner,
  );

  assert.deepEqual(await manager.reconcile(), {
    name: SLOT_NAME,
    status: "ready",
    loginCompletions: 0,
  });
  assert.deepEqual(await manager.ensure(SESSION_ID), {
    name: SLOT_NAME,
    status: "ready",
    loginCompletions: 0,
  });
  await assert.rejects(
    () => manager.ensure(OTHER_SESSION_ID),
    (error) =>
      error instanceof CapsuleError && error.code === "capacity_exhausted",
  );
  assert.deepEqual(calls, [
    [
      "container",
      "ls",
      "--all",
      "--filter",
      `name=^/${SLOT_NAME}$`,
      "--format",
      "{{.Names}}",
    ],
    ["network", "inspect", "--format", "{{json .}}", NETWORK_NAME],
    ["container", "inspect", "--format", "{{json .}}", SLOT_NAME],
    ["container", "inspect", "--format", "{{json .State}}", CONTAINER_ID],
    ["logs", "--timestamps", "--tail", "1000", CONTAINER_ID],
    ["container", "inspect", "--format", "{{json .State}}", CONTAINER_ID],
    ["container", "inspect", "--format", "{{json .State}}", CONTAINER_ID],
    ["logs", "--timestamps", "--tail", "1000", CONTAINER_ID],
    ["container", "inspect", "--format", "{{json .State}}", CONTAINER_ID],
  ]);
  assert(!calls.some((args) => args[0] === "exec"));
});

test("upgrades a matching legacy capsule before acknowledging a leased ensure", async () => {
  const config = loadSessionHostConfig({ IBKR_SESSION_CAPSULE_IMAGE: IMAGE });
  const grant = leaseGrant(20_000_000_000n);
  let hasContainer = true;
  let leased = false;
  const calls: string[][] = [];
  const runner: CommandRunner = async (_command, args) => {
    calls.push(args);
    if (args[0] === "container" && args[1] === "ls") {
      return {
        code: 0,
        stdout: hasContainer ? `${SLOT_NAME}\n` : "",
        stderr: "",
      };
    }
    if (args[0] === "rm") {
      hasContainer = false;
      return { code: 0, stdout: "", stderr: "" };
    }
    if (args[0] === "create") {
      hasContainer = true;
      leased = true;
      return { code: 0, stdout: `${CONTAINER_ID}\n`, stderr: "" };
    }
    return (
      capsuleProbeResult(
        args,
        SESSION_HASH,
        leased
          ? {
              fenceHash: SESSION_HASH,
              generation: 0,
              leaseGrant: grant,
              slotNumber: 1,
            }
          : undefined,
      ) ?? { code: 0, stdout: "", stderr: "" }
    );
  };
  const manager = new CapsuleManager(config, runner, undefined, 1, {
    clear: () => undefined,
    nowNs: () => 10_000_000_000n,
    schedule: () => ({}) as ReturnType<typeof setTimeout>,
  });

  assert.equal((await manager.ensure(SESSION_ID, 0, grant)).status, "ready");
  assert.equal(leased, true);
  assert.ok(calls.some((args) => args[0] === "rm"));
  assert.ok(calls.some((args) => args[0] === "create"));
  assert.deepEqual(manager.getTarget(SESSION_ID, "cpg", 0), {
    host: "127.0.0.1",
    port: 15000,
  });
});

test("reconciles and enforces a persisted capsule generation fence", async () => {
  const invocation = buildCreateCapsuleInvocation(
    loadSessionHostConfig({ IBKR_SESSION_CAPSULE_IMAGE: IMAGE }),
    SESSION_ID,
    1,
    7,
  );
  const fenceHash = invocation.args
    .find((argument) => argument.startsWith("pyrus.ibkr.fence_hash="))!
    .split("=", 2)[1]!;
  const runner: CommandRunner = async (_command, args) => {
    if (args[0] === "container" && args[1] === "ls") {
      return { code: 0, stdout: `${SLOT_NAME}\n`, stderr: "" };
    }
    return (
      capsuleProbeResult(args, SESSION_HASH, {
        fenceHash,
        generation: 7,
        slotNumber: 1,
      }) ?? { code: 0, stdout: "", stderr: "" }
    );
  };
  const manager = new CapsuleManager(
    loadSessionHostConfig({ IBKR_SESSION_CAPSULE_IMAGE: IMAGE }),
    runner,
  );

  assert.deepEqual(await manager.identityForSession(SESSION_ID), {
    generation: 7,
  });
  assert.equal(await manager.status(SESSION_ID, 6), null);
  assert.equal((await manager.status(SESSION_ID, 7))?.status, "ready");
  assert.throws(
    () => manager.getTarget(SESSION_ID, "cpg", 6),
    (error: unknown) =>
      error instanceof CapsuleError && error.code === "session_not_found",
  );
  await assert.rejects(
    () => manager.release(SESSION_ID, 6),
    (error: unknown) =>
      error instanceof CapsuleError && error.code === "session_not_found",
  );
});

test("requires an exact capsule lease grant before routing after host restart", async () => {
  const config = loadSessionHostConfig({ IBKR_SESSION_CAPSULE_IMAGE: IMAGE });
  const initialGrant = leaseGrant(20_000_000_000n);
  const invocation = buildCreateCapsuleInvocation(
    config,
    SESSION_ID,
    1,
    7,
    initialGrant,
  );
  const fenceHash = invocation.args
    .find((argument) => argument.startsWith("pyrus.ibkr.fence_hash="))!
    .split("=", 2)[1]!;
  const identity = {
    fenceHash,
    generation: 7,
    leaseGrant: initialGrant,
    slotNumber: 1,
  };
  let nowNs = 10_000_000_000n;
  const scheduled: Array<() => void> = [];
  const leaseRuntime: CapsuleLeaseRuntime = {
    clear: () => undefined,
    nowNs: () => nowNs,
    schedule: (callback) => {
      scheduled.push(callback);
      return {} as ReturnType<typeof setTimeout>;
    },
  };
  const calls: string[][] = [];
  const renewals: unknown[] = [];
  const runner: CommandRunner = async (_command, args) => {
    calls.push(args);
    if (args[0] === "container" && args[1] === "ls") {
      return { code: 0, stdout: `${SLOT_NAME}\n`, stderr: "" };
    }
    return (
      capsuleProbeResult(args, SESSION_HASH, identity) ?? {
        code: 0,
        stdout: "",
        stderr: "",
      }
    );
  };
  const manager = new CapsuleManager(
    config,
    runner,
    undefined,
    1,
    leaseRuntime,
    async (renewal) => {
      renewals.push(renewal);
      return true;
    },
  );

  assert.equal((await manager.reconcile())?.status, "ready");
  assert.throws(
    () => manager.getTarget(SESSION_ID, "cpg", 7),
    (error: unknown) =>
      error instanceof CapsuleError && error.code === "session_not_found",
  );

  const renewal = leaseGrant(
    30_000_000_000n,
    "55555555-5555-4555-8555-555555555555",
  );
  await manager.keepalive(SESSION_ID, 7, renewal);
  assert.deepEqual(manager.getTarget(SESSION_ID, "cpg", 7), {
    host: "127.0.0.1",
    port: 15000,
  });
  assert.deepEqual(renewals, [
    {
      controlKey: LEASE_CONTROL_KEY,
      fenceHash,
      grant: renewal,
      host: NETWORK_IP,
    },
  ]);
  assert(!calls.some((args) => args[0] === "exec"));

  nowNs = 150_000_000_000n;
  const expiry = scheduled.at(-1);
  assert(expiry);
  expiry();
  assert.throws(
    () => manager.getTarget(SESSION_ID, "cpg", 7),
    (error: unknown) =>
      error instanceof CapsuleError && error.code === "session_not_found",
  );
});

test("applies a new lease attempt before acknowledging an existing leased ensure", async () => {
  const config = loadSessionHostConfig({ IBKR_SESSION_CAPSULE_IMAGE: IMAGE });
  const initialGrant = leaseGrant(20_000_000_000n);
  const invocation = buildCreateCapsuleInvocation(
    config,
    SESSION_ID,
    1,
    7,
    initialGrant,
  );
  const fenceHash = invocation.args
    .find((argument) => argument.startsWith("pyrus.ibkr.fence_hash="))!
    .split("=", 2)[1]!;
  const identity = {
    fenceHash,
    generation: 7,
    leaseGrant: initialGrant,
    slotNumber: 1,
  };
  const renewals: CapsuleLeaseGrant[] = [];
  const runner: CommandRunner = async (_command, args) => {
    if (args[0] === "container" && args[1] === "ls") {
      return { code: 0, stdout: `${SLOT_NAME}\n`, stderr: "" };
    }
    return (
      capsuleProbeResult(args, SESSION_HASH, identity) ?? {
        code: 0,
        stdout: "",
        stderr: "",
      }
    );
  };
  const manager = new CapsuleManager(
    config,
    runner,
    undefined,
    1,
    {
      clear: () => undefined,
      nowNs: () => 10_000_000_000n,
      schedule: () => ({}) as ReturnType<typeof setTimeout>,
    },
    async ({ grant }) => {
      renewals.push(grant);
      return true;
    },
  );
  await manager.reconcile();
  const renewal = leaseGrant(
    30_000_000_000n,
    "55555555-5555-4555-8555-555555555555",
  );

  assert.equal((await manager.ensure(SESSION_ID, 7, renewal)).status, "ready");
  assert.deepEqual(renewals, [renewal]);
});

test("never rolls the local lease deadline backward when renewals finish out of order", async () => {
  const config = loadSessionHostConfig({ IBKR_SESSION_CAPSULE_IMAGE: IMAGE });
  const initialGrant = leaseGrant(20_000_000_000n);
  const invocation = buildCreateCapsuleInvocation(
    config,
    SESSION_ID,
    1,
    7,
    initialGrant,
  );
  const fenceHash = invocation.args
    .find((argument) => argument.startsWith("pyrus.ibkr.fence_hash="))!
    .split("=", 2)[1]!;
  const identity = {
    fenceHash,
    generation: 7,
    leaseGrant: initialGrant,
    slotNumber: 1,
  };
  const timers: Array<{
    cancelled: boolean;
    delayMs: number;
    handle: ReturnType<typeof setTimeout>;
  }> = [];
  const leaseRuntime: CapsuleLeaseRuntime = {
    clear: (handle) => {
      const timer = timers.find((candidate) => candidate.handle === handle);
      if (timer) timer.cancelled = true;
    },
    nowNs: () => 10_000_000_000n,
    schedule: (_callback, delayMs) => {
      const handle = {} as ReturnType<typeof setTimeout>;
      timers.push({ cancelled: false, delayMs, handle });
      return handle;
    },
  };
  let keepalivePhase = false;
  let keepaliveInspections = 0;
  let releaseFirstInspection!: () => void;
  let markFirstInspectionStarted!: () => void;
  const firstInspectionGate = new Promise<void>((resolve) => {
    releaseFirstInspection = resolve;
  });
  const firstInspectionStarted = new Promise<void>((resolve) => {
    markFirstInspectionStarted = resolve;
  });
  const runner: CommandRunner = async (_command, args) => {
    if (args[0] === "container" && args[1] === "ls") {
      return { code: 0, stdout: `${SLOT_NAME}\n`, stderr: "" };
    }
    const result = capsuleProbeResult(args, SESSION_HASH, identity);
    if (
      keepalivePhase &&
      args[0] === "container" &&
      args[1] === "inspect" &&
      args.includes("{{json .}}")
    ) {
      keepaliveInspections += 1;
      if (keepaliveInspections === 1) {
        markFirstInspectionStarted();
        await firstInspectionGate;
      }
    }
    return result ?? { code: 0, stdout: "", stderr: "" };
  };
  const manager = new CapsuleManager(
    config,
    runner,
    undefined,
    1,
    leaseRuntime,
    async () => true,
  );
  await manager.reconcile();
  keepalivePhase = true;

  const first = manager.keepalive(
    SESSION_ID,
    7,
    leaseGrant(30_000_000_000n, "55555555-5555-4555-8555-555555555555"),
  );
  await firstInspectionStarted;
  const second = manager.keepalive(
    SESSION_ID,
    7,
    leaseGrant(40_000_000_000n, "66666666-6666-4666-8666-666666666666"),
  );
  await second;
  releaseFirstInspection();
  await first;

  assert.deepEqual(
    timers.filter((timer) => !timer.cancelled).map((timer) => timer.delayMs),
    [150_000],
  );
});

test("does not poison a slot when release overtakes an in-flight keepalive", async () => {
  const config = loadSessionHostConfig({ IBKR_SESSION_CAPSULE_IMAGE: IMAGE });
  const initialGrant = leaseGrant(20_000_000_000n);
  const invocation = buildCreateCapsuleInvocation(
    config,
    SESSION_ID,
    1,
    7,
    initialGrant,
  );
  const fenceHash = invocation.args
    .find((argument) => argument.startsWith("pyrus.ibkr.fence_hash="))!
    .split("=", 2)[1]!;
  const identity = {
    fenceHash,
    generation: 7,
    leaseGrant: initialGrant,
    slotNumber: 1,
  };
  let keepalivePhase = false;
  let releaseNetworkInspection!: () => void;
  let markNetworkInspectionStarted!: () => void;
  const networkInspectionGate = new Promise<void>((resolve) => {
    releaseNetworkInspection = resolve;
  });
  const networkInspectionStarted = new Promise<void>((resolve) => {
    markNetworkInspectionStarted = resolve;
  });
  const runner: CommandRunner = async (_command, args) => {
    if (args[0] === "container" && args[1] === "ls") {
      return { code: 0, stdout: `${SLOT_NAME}\n`, stderr: "" };
    }
    if (keepalivePhase && args[0] === "network" && args[1] === "inspect") {
      markNetworkInspectionStarted();
      await networkInspectionGate;
    }
    return (
      capsuleProbeResult(args, SESSION_HASH, identity) ?? {
        code: 0,
        stdout: "",
        stderr: "",
      }
    );
  };
  const manager = new CapsuleManager(
    config,
    runner,
    undefined,
    1,
    {
      clear: () => undefined,
      nowNs: () => 10_000_000_000n,
      schedule: () => ({}) as ReturnType<typeof setTimeout>,
    },
    async () => true,
  );
  await manager.reconcile();
  keepalivePhase = true;

  const keepalive = manager.keepalive(
    SESSION_ID,
    7,
    leaseGrant(30_000_000_000n, "55555555-5555-4555-8555-555555555555"),
  );
  await networkInspectionStarted;
  await manager.release(SESSION_ID, 7);
  releaseNetworkInspection();

  await assert.rejects(
    keepalive,
    (error: unknown) =>
      error instanceof CapsuleError && error.code === "session_not_found",
  );
  assert.equal(await manager.reconcile(), null);
  assert.equal(manager.getRelayTarget("cpg"), null);
});

test("refuses to adopt a leased capsule without the root supervisor boundary", async () => {
  const config = loadSessionHostConfig({ IBKR_SESSION_CAPSULE_IMAGE: IMAGE });
  const initialGrant = leaseGrant(20_000_000_000n);
  const invocation = buildCreateCapsuleInvocation(
    config,
    SESSION_ID,
    1,
    7,
    initialGrant,
  );
  const fenceHash = invocation.args
    .find((argument) => argument.startsWith("pyrus.ibkr.fence_hash="))!
    .split("=", 2)[1]!;
  const calls: string[][] = [];
  const runner: CommandRunner = async (_command, args) => {
    calls.push(args);
    if (args[0] === "container" && args[1] === "ls") {
      return { code: 0, stdout: `${SLOT_NAME}\n`, stderr: "" };
    }
    const result = capsuleProbeResult(args, SESSION_HASH, {
      fenceHash,
      generation: 7,
      leaseGrant: initialGrant,
      slotNumber: 1,
    });
    if (
      result &&
      args[0] === "container" &&
      args[1] === "inspect" &&
      args.includes("{{json .}}")
    ) {
      const inspection = JSON.parse(result.stdout) as {
        Config: { User: string };
      };
      inspection.Config.User = "10001:10001";
      return { ...result, stdout: JSON.stringify(inspection) };
    }
    return result ?? { code: 0, stdout: "", stderr: "" };
  };
  const manager = new CapsuleManager(config, runner);

  await assert.rejects(
    () => manager.reconcile(),
    (error: unknown) =>
      error instanceof CapsuleError && error.code === "cleanup_unconfirmed",
  );
  assert.equal(manager.getRelayTarget("cpg"), null);
  assert(!calls.some((args) => args[0] === "exec"));
});

test("refuses to adopt a leased capsule with a weakened runtime contract", async () => {
  const config = loadSessionHostConfig({ IBKR_SESSION_CAPSULE_IMAGE: IMAGE });
  const initialGrant = leaseGrant(20_000_000_000n);
  const invocation = buildCreateCapsuleInvocation(
    config,
    SESSION_ID,
    1,
    7,
    initialGrant,
  );
  const fenceHash = invocation.args
    .find((argument) => argument.startsWith("pyrus.ibkr.fence_hash="))!
    .split("=", 2)[1]!;
  const mutations: Array<
    [
      string,
      (inspection: {
        Config: Record<string, unknown>;
        HostConfig: Record<string, unknown>;
      }) => void,
    ]
  > = [
    [
      "entrypoint",
      (inspection) => {
        inspection.Config["Entrypoint"] = [
          "/usr/local/bin/pyrus-capsule-entrypoint",
        ];
      },
    ],
    [
      "read-only root",
      (inspection) => {
        inspection.HostConfig["ReadonlyRootfs"] = false;
      },
    ],
    [
      "security options",
      (inspection) => {
        inspection.HostConfig["SecurityOpt"] = [
          "no-new-privileges=true",
          WEAKENED_SECCOMP_INSPECT_OPTION,
        ];
      },
    ],
    [
      "temporary setup capabilities",
      (inspection) => {
        inspection.HostConfig["CapAdd"] = ["KILL", "SETGID", "SETUID"];
      },
    ],
    [
      "duplicate setup capabilities hiding an omitted capability",
      (inspection) => {
        inspection.HostConfig["CapAdd"] = [
          "KILL",
          "KILL",
          "NET_ADMIN",
          "SETGID",
          "SETPCAP",
        ];
      },
    ],
  ];

  for (const [name, mutate] of mutations) {
    const runner: CommandRunner = async (_command, args) => {
      if (args[0] === "container" && args[1] === "ls") {
        return { code: 0, stdout: `${SLOT_NAME}\n`, stderr: "" };
      }
      const result = capsuleProbeResult(args, SESSION_HASH, {
        fenceHash,
        generation: 7,
        leaseGrant: initialGrant,
        slotNumber: 1,
      });
      if (
        result &&
        args[0] === "container" &&
        args[1] === "inspect" &&
        args.includes("{{json .}}")
      ) {
        const inspection = JSON.parse(result.stdout) as {
          Config: Record<string, unknown>;
          HostConfig: Record<string, unknown>;
        };
        mutate(inspection);
        return { ...result, stdout: JSON.stringify(inspection) };
      }
      return result ?? { code: 0, stdout: "", stderr: "" };
    };
    const manager = new CapsuleManager(config, runner);
    await assert.rejects(
      () => manager.reconcile(),
      (error: unknown) =>
        error instanceof CapsuleError && error.code === "cleanup_unconfirmed",
      name,
    );
  }
});

test("does not replace an active container ID with a same-name fence match", async () => {
  const config = loadSessionHostConfig({ IBKR_SESSION_CAPSULE_IMAGE: IMAGE });
  const initialGrant = leaseGrant(20_000_000_000n);
  const invocation = buildCreateCapsuleInvocation(
    config,
    SESSION_ID,
    1,
    7,
    initialGrant,
  );
  const fenceHash = invocation.args
    .find((argument) => argument.startsWith("pyrus.ibkr.fence_hash="))!
    .split("=", 2)[1]!;
  let emitReadyMarker = true;
  let replacementRace = false;
  const runner: CommandRunner = async (_command, args) => {
    if (args[0] === "container" && args[1] === "ls") {
      return { code: 0, stdout: `${SLOT_NAME}\n`, stderr: "" };
    }
    if (args[0] === "logs" && !emitReadyMarker) {
      return { code: 0, stdout: "", stderr: "" };
    }
    const result = capsuleProbeResult(args, SESSION_HASH, {
      fenceHash,
      generation: 7,
      leaseGrant: initialGrant,
      slotNumber: 1,
    });
    if (
      replacementRace &&
      args[0] === "container" &&
      args[1] === "inspect" &&
      args.includes("{{json .}}")
    ) {
      if (args.at(-1) === CONTAINER_ID) {
        return { code: 1, stdout: "", stderr: "missing" };
      }
      if (args.at(-1) === SLOT_NAME) {
        assert(result);
        const inspection = JSON.parse(result.stdout) as {
          Id: string;
          NetworkSettings: {
            Networks: Record<string, { IPAddress: string; NetworkID: string }>;
          };
        };
        inspection.Id = "f".repeat(64);
        inspection.NetworkSettings.Networks[NETWORK_NAME]!.IPAddress =
          "172.20.0.99";
        return { ...result, stdout: JSON.stringify(inspection) };
      }
    }
    return result ?? { code: 0, stdout: "", stderr: "" };
  };
  const manager = new CapsuleManager(
    config,
    runner,
    undefined,
    1,
    {
      clear: () => undefined,
      nowNs: () => 10_000_000_000n,
      schedule: () => ({}) as ReturnType<typeof setTimeout>,
    },
    async () => true,
  );

  await manager.reconcile();
  await manager.keepalive(
    SESSION_ID,
    7,
    leaseGrant(30_000_000_000n, "55555555-5555-4555-8555-555555555555"),
  );
  emitReadyMarker = false;
  assert.equal((await manager.status(SESSION_ID, 7))?.status, "occupied");
  emitReadyMarker = true;
  replacementRace = true;

  await assert.rejects(
    () => manager.status(SESSION_ID, 7),
    (error: unknown) =>
      error instanceof CapsuleError && error.code === "cleanup_unconfirmed",
  );
  assert.equal(manager.getRelayTarget("cpg"), null);
});

test("does not route or acknowledge a failed authenticated lease renewal", async () => {
  const config = loadSessionHostConfig({ IBKR_SESSION_CAPSULE_IMAGE: IMAGE });
  const initialGrant = leaseGrant(20_000_000_000n);
  const invocation = buildCreateCapsuleInvocation(
    config,
    SESSION_ID,
    1,
    7,
    initialGrant,
  );
  const fenceHash = invocation.args
    .find((argument) => argument.startsWith("pyrus.ibkr.fence_hash="))!
    .split("=", 2)[1]!;
  const runner: CommandRunner = async (_command, args) => {
    if (args[0] === "container" && args[1] === "ls") {
      return { code: 0, stdout: `${SLOT_NAME}\n`, stderr: "" };
    }
    return (
      capsuleProbeResult(args, SESSION_HASH, {
        fenceHash,
        generation: 7,
        leaseGrant: initialGrant,
        slotNumber: 1,
      }) ?? { code: 0, stdout: "", stderr: "" }
    );
  };
  const manager = new CapsuleManager(
    config,
    runner,
    undefined,
    1,
    {
      clear: () => undefined,
      nowNs: () => 10_000_000_000n,
      schedule: () => ({}) as ReturnType<typeof setTimeout>,
    },
    async () => false,
  );

  await manager.reconcile();
  await assert.rejects(
    () =>
      manager.keepalive(
        SESSION_ID,
        7,
        leaseGrant(30_000_000_000n, "55555555-5555-4555-8555-555555555555"),
      ),
    (error: unknown) =>
      error instanceof CapsuleError && error.code === "lease_renewal_failed",
  );
  assert.throws(
    () => manager.getTarget(SESSION_ID, "cpg", 7),
    (error: unknown) =>
      error instanceof CapsuleError && error.code === "session_not_found",
  );
});

test("replaces an older capsule generation in place", async () => {
  const config = loadSessionHostConfig({ IBKR_SESSION_CAPSULE_IMAGE: IMAGE });
  const fenceHash = (generation: number): string =>
    buildCreateCapsuleInvocation(config, SESSION_ID, 1, generation)
      .args.find((argument) => argument.startsWith("pyrus.ibkr.fence_hash="))!
      .split("=", 2)[1]!;
  let identity = {
    fenceHash: fenceHash(7),
    generation: 7,
    slotNumber: 1,
  };
  let hasContainer = true;
  const calls: string[][] = [];
  const runner: CommandRunner = async (_command, args) => {
    calls.push(args);
    if (args[0] === "container" && args[1] === "ls") {
      return {
        code: 0,
        stdout: hasContainer ? `${SLOT_NAME}\n` : "",
        stderr: "",
      };
    }
    if (args[0] === "rm") {
      hasContainer = false;
      return { code: 0, stdout: "", stderr: "" };
    }
    if (args[0] === "create") {
      identity = {
        fenceHash: args
          .find((argument) => argument.startsWith("pyrus.ibkr.fence_hash="))!
          .split("=", 2)[1]!,
        generation: Number(
          args
            .find((argument) => argument.startsWith("pyrus.ibkr.generation="))!
            .split("=", 2)[1],
        ),
        slotNumber: 1,
      };
      hasContainer = true;
    }
    return (
      capsuleProbeResult(args, SESSION_HASH, identity) ?? {
        code: 0,
        stdout: "",
        stderr: "",
      }
    );
  };
  const manager = new CapsuleManager(config, runner);

  assert.deepEqual(await manager.identityForSession(SESSION_ID), {
    generation: 7,
  });
  assert.equal((await manager.replace(SESSION_ID, 8)).status, "ready");
  assert.deepEqual(await manager.identityForSession(SESSION_ID), {
    generation: 8,
  });
  assert.equal(await manager.status(SESSION_ID, 7), null);
  assert.equal(
    calls.filter((args) => args[0] === "rm" && args[1] === "--force").length,
    1,
  );
  assert(
    calls.some(
      (args) =>
        args[0] === "create" &&
        args.includes("pyrus.ibkr.generation=8") &&
        args.includes(`pyrus.ibkr.fence_hash=${fenceHash(8)}`),
    ),
  );
});

test("reconciliation keeps an unproven existing slot occupied, not ready", async () => {
  for (const probe of [
    { running: false, logs: dockerLogLine(READY_MARKER) },
    { running: true, logs: dockerLogLine(`${READY_MARKER}-suffix`) },
  ]) {
    const calls: string[][] = [];
    const runner: CommandRunner = async (_command, args) => {
      calls.push(args);
      if (args[1] === "ls") {
        return { code: 0, stdout: `${SLOT_NAME}\n`, stderr: "" };
      }
      if (args.includes("{{json .Config.Labels}}")) {
        return {
          code: 0,
          stdout: JSON.stringify({
            "pyrus.ibkr.capsule": "1",
            "pyrus.ibkr.session_hash": SESSION_HASH,
          }),
          stderr: "",
        };
      }
      if (
        args[0] === "container" &&
        args[1] === "inspect" &&
        args.includes("{{json .}}")
      ) {
        const inspected = capsuleProbeResult(args);
        assert(inspected);
        const container = JSON.parse(inspected.stdout) as {
          HostConfig: { NetworkMode: string; PortBindings: null };
          NetworkSettings: {
            Networks: Record<string, { IPAddress: string; NetworkID: string }>;
            Ports: Record<string, unknown>;
          };
          State: { Running: boolean };
        };
        container.NetworkSettings.Networks[NETWORK_NAME]!.IPAddress =
          probe.running ? NETWORK_IP : "";
        container.State.Running = probe.running;
        return {
          ...inspected,
          stdout: JSON.stringify(container),
        };
      }
      if (args.includes("{{json .State}}")) {
        return {
          code: 0,
          stdout: JSON.stringify({
            Running: probe.running,
            StartedAt: STARTED_AT,
          }),
          stderr: "",
        };
      }
      if (args[0] === "logs") {
        return { code: 0, stdout: probe.logs, stderr: "" };
      }
      const capsuleResult = capsuleProbeResult(args);
      if (capsuleResult) return capsuleResult;
      throw new Error(`unexpected Docker command: ${args.join(" ")}`);
    };
    const manager = new CapsuleManager(
      loadSessionHostConfig({ IBKR_SESSION_CAPSULE_IMAGE: IMAGE }),
      runner,
    );

    assert.deepEqual(await manager.reconcile(), {
      name: SLOT_NAME,
      status: "occupied",
      loginCompletions: 0,
    });
    assert.equal(manager.getRelayTarget("cpg"), null);
    assert(!calls.some((args) => args[0] === "exec"));
  }
});

test("restores the private relay address when a stopped slot becomes ready", async () => {
  let running = false;
  let stopOnNextIdentityInspect = false;
  const runner: CommandRunner = async (_command, args) => {
    if (args[0] === "network") {
      return capsuleProbeResult(args) ?? { code: 1, stdout: "", stderr: "" };
    }
    if (args[1] === "ls") {
      return { code: 0, stdout: `${SLOT_NAME}\n`, stderr: "" };
    }
    if (args.includes("{{json .State}}")) {
      return {
        code: 0,
        stdout: JSON.stringify({ Running: running, StartedAt: STARTED_AT }),
        stderr: "",
      };
    }
    if (args[0] === "container" && args.includes("{{json .}}")) {
      if (stopOnNextIdentityInspect) {
        stopOnNextIdentityInspect = false;
        running = false;
      }
      const inspected = capsuleProbeResult(args);
      assert(inspected);
      const container = JSON.parse(inspected.stdout) as {
        NetworkSettings: {
          Networks: Record<string, { IPAddress: string; NetworkID: string }>;
        };
        State: { Running: boolean };
      };
      container.NetworkSettings.Networks[NETWORK_NAME]!.IPAddress = running
        ? NETWORK_IP
        : "";
      container.State.Running = running;
      return {
        ...inspected,
        stdout: JSON.stringify(container),
      };
    }
    if (args[0] === "logs") {
      return { code: 0, stdout: dockerLogLine(READY_MARKER), stderr: "" };
    }
    throw new Error(`unexpected Docker command: ${args.join(" ")}`);
  };
  const manager = new CapsuleManager(
    loadSessionHostConfig({ IBKR_SESSION_CAPSULE_IMAGE: IMAGE }),
    runner,
  );

  assert.equal((await manager.reconcile())?.status, "occupied");
  assert.equal(manager.getRelayTarget("cpg"), null);
  running = true;
  stopOnNextIdentityInspect = true;
  assert.equal((await manager.status(SESSION_ID))?.status, "occupied");
  assert.equal(manager.getRelayTarget("cpg"), null);
  running = true;
  assert.equal((await manager.status(SESSION_ID))?.status, "ready");
  assert.deepEqual(manager.getRelayTarget("cpg"), {
    host: NETWORK_IP,
    port: 15000,
  });
});

test("a stale address recovery cannot poison a replacement capsule", async () => {
  let running = false;
  let currentSessionHash = SESSION_HASH;
  let blockNextNetworkInspect = false;
  let markNetworkInspectStarted!: () => void;
  let releaseNetworkInspect!: () => void;
  const networkInspectStarted = new Promise<void>((resolve) => {
    markNetworkInspectStarted = resolve;
  });
  const networkInspectGate = new Promise<void>((resolve) => {
    releaseNetworkInspect = resolve;
  });
  const runner: CommandRunner = async (_command, args) => {
    if (args[0] === "network" && args[1] === "inspect") {
      if (blockNextNetworkInspect) {
        blockNextNetworkInspect = false;
        markNetworkInspectStarted();
        await networkInspectGate;
      }
      return capsuleProbeResult(args) ?? { code: 1, stdout: "", stderr: "" };
    }
    if (args[0] === "network") {
      return { code: 0, stdout: "", stderr: "" };
    }
    if (args[1] === "ls") {
      return { code: 0, stdout: `${SLOT_NAME}\n`, stderr: "" };
    }
    if (args[0] === "create") {
      currentSessionHash =
        args
          .find((arg) => arg.startsWith("pyrus.ibkr.session_hash="))
          ?.split("=", 2)[1] ?? currentSessionHash;
      running = true;
      return { code: 0, stdout: "", stderr: "" };
    }
    if (args[0] === "start" || args[0] === "rm") {
      return { code: 0, stdout: "", stderr: "" };
    }
    if (args.includes("{{json .State}}")) {
      return {
        code: 0,
        stdout: JSON.stringify({ Running: running, StartedAt: STARTED_AT }),
        stderr: "",
      };
    }
    if (args[0] === "container" && args.includes("{{json .}}")) {
      const inspected = capsuleProbeResult(args, currentSessionHash);
      assert(inspected);
      const container = JSON.parse(inspected.stdout) as {
        NetworkSettings: {
          Networks: Record<string, { IPAddress: string; NetworkID: string }>;
        };
        State: { Running: boolean };
      };
      container.NetworkSettings.Networks[NETWORK_NAME]!.IPAddress = running
        ? NETWORK_IP
        : "";
      container.State.Running = running;
      return {
        ...inspected,
        stdout: JSON.stringify(container),
      };
    }
    if (args[0] === "logs") {
      return { code: 0, stdout: dockerLogLine(READY_MARKER), stderr: "" };
    }
    throw new Error(`unexpected Docker command: ${args.join(" ")}`);
  };
  const manager = new CapsuleManager(
    loadSessionHostConfig({ IBKR_SESSION_CAPSULE_IMAGE: IMAGE }),
    runner,
  );

  await manager.reconcile();
  running = true;
  blockNextNetworkInspect = true;
  const staleStatus = manager.status(SESSION_ID);
  await networkInspectStarted;
  await manager.release(SESSION_ID);
  await manager.ensure(OTHER_SESSION_ID);
  releaseNetworkInspect();

  await assert.rejects(
    staleStatus,
    (error) =>
      error instanceof CapsuleError && error.code === "session_not_found",
  );
  assert.equal((await manager.status(OTHER_SESSION_ID))?.status, "ready");
});

test("removes a fully owned persisted slot whose immutable image is stale", async () => {
  const calls: string[][] = [];
  const runner: CommandRunner = async (_command, args) => {
    calls.push(args);
    if (args[0] === "network") {
      return capsuleProbeResult(args) ?? { code: 1, stdout: "", stderr: "" };
    }
    if (args[1] === "ls") {
      return { code: 0, stdout: `${SLOT_NAME}\n`, stderr: "" };
    }
    if (args.includes("{{json .}}")) {
      const inspected = capsuleProbeResult(args);
      assert(inspected);
      const container = JSON.parse(inspected.stdout) as {
        Config: { Image: string };
      };
      container.Config.Image = "sha256:" + "f".repeat(64);
      return {
        ...inspected,
        stdout: JSON.stringify(container),
      };
    }
    if (args[0] === "rm") {
      return { code: 0, stdout: "", stderr: "" };
    }
    throw new Error(`unexpected Docker command: ${args.join(" ")}`);
  };
  const manager = new CapsuleManager(
    loadSessionHostConfig({ IBKR_SESSION_CAPSULE_IMAGE: IMAGE }),
    runner,
  );

  assert.equal(await manager.reconcile(), null);
  assert.deepEqual(manager.snapshot(), {
    mode: "paper",
    capacity: { max: 1, active: 0 },
  });
  assert.deepEqual(calls.at(-1), ["rm", "--force", CONTAINER_ID]);

  const failedManager = new CapsuleManager(
    loadSessionHostConfig({ IBKR_SESSION_CAPSULE_IMAGE: IMAGE }),
    async (command, args) =>
      args[0] === "rm"
        ? { code: 1, stdout: "", stderr: "sensitive Docker failure" }
        : runner(command, args),
  );
  await assert.rejects(
    () => failedManager.reconcile(),
    (error) =>
      error instanceof CapsuleError &&
      error.code === "cleanup_unconfirmed" &&
      !error.message.includes("sensitive Docker failure"),
  );
  assert.deepEqual(failedManager.snapshot(), {
    mode: "paper",
    capacity: { max: 1, active: 1 },
  });
});

test("refuses to adopt persisted slots with unsafe networks or ports", async () => {
  for (const { networkMode, networks, portBindings, ports } of [
    {
      networkMode: "bridge",
      networks: {
        bridge: { IPAddress: NETWORK_IP, NetworkID: "d".repeat(64) },
      },
      portBindings: null,
      ports: {},
    },
    {
      networkMode: NETWORK_NAME,
      networks: {
        [NETWORK_NAME]: { IPAddress: NETWORK_IP, NetworkID: NETWORK_ID },
        bridge: { IPAddress: "172.17.0.2", NetworkID: "d".repeat(64) },
      },
      portBindings: null,
      ports: {},
    },
    {
      networkMode: NETWORK_NAME,
      networks: {
        [NETWORK_NAME]: { IPAddress: NETWORK_IP, NetworkID: NETWORK_ID },
      },
      portBindings: {
        "15000/tcp": [{ HostIp: "127.0.0.1", HostPort: "15000" }],
      },
      ports: {
        "15000/tcp": [{ HostIp: "127.0.0.1", HostPort: "15000" }],
      },
    },
  ]) {
    let completeInspections = 0;
    const runner: CommandRunner = async (_command, args) => {
      if (args[0] === "network") {
        return capsuleProbeResult(args) ?? { code: 1, stdout: "", stderr: "" };
      }
      if (args[1] === "ls") {
        return { code: 0, stdout: `${SLOT_NAME}\n`, stderr: "" };
      }
      if (args.includes("{{json .Config.Labels}}")) {
        return {
          code: 0,
          stdout: JSON.stringify({
            "pyrus.ibkr.capsule": "1",
            "pyrus.ibkr.session_hash": SESSION_HASH,
          }),
          stderr: "",
        };
      }
      if (args.includes("{{json .}}")) {
        completeInspections += 1;
        return {
          code: 0,
          stdout: JSON.stringify({
            Config: {
              Image: IMAGE,
              Labels: {
                "pyrus.ibkr.capsule": "1",
                "pyrus.ibkr.session_hash": SESSION_HASH,
              },
            },
            HostConfig: {
              NetworkMode: networkMode,
              PortBindings: portBindings,
            },
            NetworkSettings: { Networks: networks, Ports: ports },
          }),
          stderr: "",
        };
      }
      return capsuleProbeResult(args) ?? { code: 0, stdout: "", stderr: "" };
    };
    const manager = new CapsuleManager(
      loadSessionHostConfig({ IBKR_SESSION_CAPSULE_IMAGE: IMAGE }),
      runner,
    );

    await assert.rejects(
      () => manager.reconcile(),
      (error) =>
        error instanceof CapsuleError && error.code === "cleanup_unconfirmed",
    );
    assert.equal(completeInspections, 1);
  }
});

test("runs commands without shell expansion", async () => {
  const sentinel = "$(printf shell-expanded)";
  const result = await execFileCommandRunner(process.execPath, [
    "-e",
    "process.stdout.write(process.argv[1])",
    sentinel,
  ]);

  assert.equal(result.code, 0);
  assert.equal(result.stdout, sentinel);
});

test("Docker preflight requires a successful server version response", async () => {
  const calls: string[][] = [];
  const success: CommandRunner = async (_command, args) => {
    calls.push(args);
    return { code: 0, stdout: "27.5.1\n", stderr: "" };
  };
  assert.equal(await checkDocker(success, "docker"), true);
  assert.deepEqual(calls, [["version", "--format", "{{.Server.Version}}"]]);

  const empty: CommandRunner = async () => ({
    code: 0,
    stdout: "",
    stderr: "",
  });
  const failed: CommandRunner = async () => ({
    code: 1,
    stdout: "",
    stderr: "sensitive failure",
  });
  const thrown: CommandRunner = async () => {
    throw new Error("sensitive failure");
  };
  assert.equal(await checkDocker(empty, "docker"), false);
  assert.equal(await checkDocker(failed, "docker"), false);
  assert.equal(await checkDocker(thrown, "docker"), false);
});

test("runtime preflight requires hardened daemon capabilities and the exact capsule image", async () => {
  const calls: string[][] = [];
  const runner: CommandRunner = async (_command, args) => {
    calls.push(args);
    if (args[0] === "info") {
      return {
        code: 0,
        stdout: JSON.stringify({
          OSType: "linux",
          Architecture: "x86_64",
          CgroupVersion: "2",
          SecurityOptions: ["name=seccomp,profile=builtin", "name=cgroupns"],
          MemoryLimit: true,
          SwapLimit: true,
          PidsLimit: true,
        }),
        stderr: "",
      };
    }
    return {
      code: 0,
      stdout: JSON.stringify({
        Id: "sha256:" + "b".repeat(64),
        RepoDigests: [IMAGE],
        Os: "linux",
        Architecture: "amd64",
        Config: {
          User: "10001:10001",
          Entrypoint: ["/usr/local/bin/pyrus-capsule-supervisor.py"],
          Volumes: {},
        },
      }),
      stderr: "",
    };
  };
  const config = loadSessionHostConfig({ IBKR_SESSION_CAPSULE_IMAGE: IMAGE });

  assert.deepEqual(await checkCapsuleRuntime(runner, config), { ready: true });
  assert.deepEqual(calls, [
    ["info", "--format", "{{json .}}"],
    ["image", "inspect", "--format", "{{json .}}", IMAGE],
  ]);
});

test("runtime preflight binds a local image reference to the inspected image ID", async () => {
  const localImage = "sha256:" + "b".repeat(64);
  const config = loadSessionHostConfig({
    IBKR_SESSION_CAPSULE_IMAGE: localImage,
  });
  const daemon = {
    OSType: "linux",
    Architecture: "x86_64",
    CgroupVersion: "2",
    SecurityOptions: ["name=seccomp,profile=builtin", "name=cgroupns"],
    MemoryLimit: true,
    SwapLimit: true,
    PidsLimit: true,
  };
  const runner: CommandRunner = async (_command, args) => ({
    code: 0,
    stdout: JSON.stringify(
      args[0] === "info"
        ? daemon
        : {
            Id: "sha256:" + "c".repeat(64),
            Os: "linux",
            Architecture: "amd64",
            Config: {
              User: "10001:10001",
              Entrypoint: ["/usr/local/bin/pyrus-capsule-supervisor.py"],
            },
          },
    ),
    stderr: "",
  });

  assert.deepEqual(await checkCapsuleRuntime(runner, config), {
    ready: false,
    code: "capsule_image_invalid",
  });
});

test("runtime preflight rejects image-declared volumes and non-exact exec arrays", async () => {
  const config = loadSessionHostConfig({ IBKR_SESSION_CAPSULE_IMAGE: IMAGE });
  const daemon = {
    OSType: "linux",
    Architecture: "x86_64",
    CgroupVersion: "2",
    SecurityOptions: ["name=seccomp,profile=builtin", "name=cgroupns"],
    MemoryLimit: true,
    SwapLimit: true,
    PidsLimit: true,
  };
  const imageConfigVariants = [
    {
      User: "10001:10001",
      Entrypoint: ["/usr/local/bin/pyrus-capsule-supervisor.py"],
      Volumes: { "/run/pyrus": {} },
    },
    {
      User: "10001:10001",
      Entrypoint: ["/usr/local/bin/pyrus-capsule-supervisor.py", "unexpected"],
      Volumes: {},
    },
    {
      User: "10001:10001",
      Entrypoint: ["/usr/local/bin/pyrus-capsule-supervisor.py"],
      Healthcheck: {
        Test: ["CMD-SHELL", "/usr/local/bin/pyrus-capsule-health"],
      },
      Volumes: {},
    },
    {
      User: "10001:10001",
      Entrypoint: ["/usr/local/bin/pyrus-capsule-supervisor.py"],
      Healthcheck: {
        Test: ["CMD", "/usr/local/bin/pyrus-capsule-health", "unexpected"],
      },
      Volumes: {},
    },
  ];

  for (const Config of imageConfigVariants) {
    const runner: CommandRunner = async (_command, args) => ({
      code: 0,
      stdout: JSON.stringify(
        args[0] === "info"
          ? daemon
          : {
              Id: "sha256:" + "b".repeat(64),
              RepoDigests: [IMAGE],
              Os: "linux",
              Architecture: "amd64",
              Config,
            },
      ),
      stderr: "",
    });

    assert.deepEqual(await checkCapsuleRuntime(runner, config), {
      ready: false,
      code: "capsule_image_invalid",
    });
  }
});

test("runtime preflight fails closed when the pinned seccomp profile is unavailable", async () => {
  const config = loadSessionHostConfig({ IBKR_SESSION_CAPSULE_IMAGE: IMAGE });
  let calls = 0;
  const runner: CommandRunner = async () => {
    calls += 1;
    return { code: 0, stdout: "", stderr: "" };
  };

  assert.deepEqual(
    await checkCapsuleRuntime(runner, {
      ...config,
      seccompProfilePath: "/definitely/missing/chromium-seccomp.json",
    }),
    { ready: false, code: "seccomp_profile_invalid" },
  );
  assert.equal(calls, 0);
});

test("runtime preflight fails closed on missing or incompatible capabilities", async () => {
  const config = loadSessionHostConfig({ IBKR_SESSION_CAPSULE_IMAGE: IMAGE });
  const missingSeccomp: CommandRunner = async () => ({
    code: 0,
    stdout: JSON.stringify({
      OSType: "linux",
      Architecture: "x86_64",
      CgroupVersion: "2",
      SecurityOptions: ["name=seccomp,profile=unconfined", "name=cgroupns"],
      MemoryLimit: true,
      SwapLimit: true,
      PidsLimit: true,
    }),
    stderr: "",
  });
  assert.deepEqual(await checkCapsuleRuntime(missingSeccomp, config), {
    ready: false,
    code: "docker_capabilities_unavailable",
  });

  let call = 0;
  const missingImage: CommandRunner = async () => {
    call += 1;
    return call === 1
      ? {
          code: 0,
          stdout: JSON.stringify({
            OSType: "linux",
            Architecture: "x86_64",
            CgroupVersion: "2",
            SecurityOptions: ["name=seccomp,profile=builtin", "name=cgroupns"],
            MemoryLimit: true,
            SwapLimit: true,
            PidsLimit: true,
          }),
          stderr: "",
        }
      : { code: 1, stdout: "", stderr: "sensitive image error" };
  };
  assert.deepEqual(await checkCapsuleRuntime(missingImage, config), {
    ready: false,
    code: "capsule_image_unavailable",
  });
});
