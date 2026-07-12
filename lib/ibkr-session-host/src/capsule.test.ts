import assert from "node:assert/strict";
import test from "node:test";

import {
  CapsuleError,
  CapsuleManager,
  DEFAULT_SECCOMP_PROFILE_PATH,
  buildCreateCapsuleInvocation,
  capsuleNameForSession,
  checkCapsuleRuntime,
  checkDocker,
  execFileCommandRunner,
  loadSessionHostConfig,
  type CommandResult,
  type CommandRunner,
} from "./capsule";

const IMAGE =
  "ghcr.io/pyrus/ibkr-session-capsule@sha256:" + "a".repeat(64);
const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_SESSION_ID = "22222222-2222-4222-8222-222222222222";
const SESSION_HASH = "bd7662a5eeb41614e720d477";
const SLOT_NAME = "pyrus-ibkr-slot-1";
const NETWORK_NAME = "pyrus-ibkr-capsule-net";
const NETWORK_IP = "172.20.0.2";
const NETWORK_ID = "c".repeat(64);
const READY_MARKER = "PYRUS_IBKR_CAPSULE_READY_V1";
const LOGIN_COMPLETE_MARKER = "PYRUS_IBKR_CAPSULE_LOGIN_COMPLETE_V1";
const STARTED_AT = "2026-07-09T22:00:00.000Z";
const CURRENT_LOG_AT = "2026-07-09T22:00:01.000Z";

const dockerLogLine = (message: string, timestamp = CURRENT_LOG_AT): string =>
  `${timestamp} ${message}\n`;

const noExistingSlot = (): CommandResult => ({
  code: 0,
  stdout: "",
  stderr: "",
});

const capsuleProbeResult = (
  args: string[],
  sessionHash = SESSION_HASH,
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
        Config: {
          Image: IMAGE,
          Labels: {
            "pyrus.ibkr.capsule": "1",
            "pyrus.ibkr.session_hash": sessionHash,
          },
        },
        HostConfig: { NetworkMode: NETWORK_NAME, PortBindings: null },
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

test("loads the capacity-one paper host configuration", () => {
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
    { IBKR_SESSION_CAPSULE_IMAGE: IMAGE, IBKR_SESSION_HOST_CAPACITY: "2" },
    { IBKR_SESSION_CAPSULE_IMAGE: "ghcr.io/pyrus/capsule:latest" },
    { IBKR_SESSION_CAPSULE_IMAGE: "sha256:" + "a".repeat(63) },
    { IBKR_SESSION_CAPSULE_IMAGE: "sha256:" + "A".repeat(64) },
    { IBKR_SESSION_CAPSULE_IMAGE: "-malicious@sha256:" + "a".repeat(64) },
    { IBKR_SESSION_CAPSULE_IMAGE: "bad image@sha256:" + "a".repeat(64) },
  ]) {
    assert.throws(() => loadSessionHostConfig(env), CapsuleError);
  }
});

test("uses one daemon-wide slot name with an opaque session label", () => {
  const name = capsuleNameForSession(SESSION_ID);

  assert.equal(name, SLOT_NAME);
  assert.equal(name, capsuleNameForSession(OTHER_SESSION_ID));
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
      "--pull",
      "never",
      "--restart",
      "on-failure:3",
      "--init",
      "--user",
      "10001:10001",
      "--read-only",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges=true",
      "--security-opt",
      `seccomp=${DEFAULT_SECCOMP_PROFILE_PATH}`,
      "--network",
      NETWORK_NAME,
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
      error instanceof CapsuleError &&
      error.code === "capsule_network_invalid",
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
      error instanceof CapsuleError &&
      error.code === "capsule_network_invalid",
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
    (error) => error instanceof CapsuleError && error.code === "session_not_found",
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
    (error) => error instanceof CapsuleError && error.code === "session_not_found",
  );

  await manager.release(SESSION_ID);
  assert.deepEqual(calls.at(-1), ["rm", "--force", SLOT_NAME]);
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
          StartedAt:
            stateReads === 1
              ? STARTED_AT
              : "2026-07-09T22:00:02.000Z",
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
  assert.equal(calls.length, callCount, "poisoned capacity blocks Docker calls");
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
    [
      "network",
      "inspect",
      "--format",
      "{{json .}}",
      NETWORK_NAME,
    ],
    [
      "container",
      "inspect",
      "--format",
      "{{json .}}",
      SLOT_NAME,
    ],
    [
      "container",
      "inspect",
      "--format",
      "{{json .State}}",
      SLOT_NAME,
    ],
    ["logs", "--timestamps", "--tail", "1000", SLOT_NAME],
    [
      "container",
      "inspect",
      "--format",
      "{{json .State}}",
      SLOT_NAME,
    ],
    [
      "container",
      "inspect",
      "--format",
      "{{json .State}}",
      SLOT_NAME,
    ],
    ["logs", "--timestamps", "--tail", "1000", SLOT_NAME],
    [
      "container",
      "inspect",
      "--format",
      "{{json .State}}",
      SLOT_NAME,
    ],
  ]);
  assert(!calls.some((args) => args[0] === "exec"));
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
            HostConfig: { NetworkMode: NETWORK_NAME, PortBindings: null },
            NetworkSettings: {
              Networks: {
                [NETWORK_NAME]: {
                  IPAddress: probe.running ? NETWORK_IP : "",
                  NetworkID: NETWORK_ID,
                },
              },
              Ports: {},
            },
            State: { Running: probe.running },
          }),
          stderr: "",
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
          HostConfig: { NetworkMode: NETWORK_NAME, PortBindings: null },
          NetworkSettings: {
            Networks: {
              [NETWORK_NAME]: {
                IPAddress: running ? NETWORK_IP : "",
                NetworkID: NETWORK_ID,
              },
            },
            Ports: {},
          },
          State: { Running: running },
        }),
        stderr: "",
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
      return {
        code: 0,
        stdout: JSON.stringify({
          Config: {
            Image: IMAGE,
            Labels: {
              "pyrus.ibkr.capsule": "1",
              "pyrus.ibkr.session_hash": currentSessionHash,
            },
          },
          HostConfig: { NetworkMode: NETWORK_NAME, PortBindings: null },
          NetworkSettings: {
            Networks: {
              [NETWORK_NAME]: {
                IPAddress: running ? NETWORK_IP : "",
                NetworkID: NETWORK_ID,
              },
            },
            Ports: {},
          },
          State: { Running: running },
        }),
        stderr: "",
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

test("refuses to adopt persisted slots with unsafe networks, ports, or images", async () => {
  for (const { image, networkMode, networks, portBindings, ports } of [
    {
      image: IMAGE,
      networkMode: "bridge",
      networks: { bridge: { IPAddress: NETWORK_IP, NetworkID: "d".repeat(64) } },
      portBindings: null,
      ports: {},
    },
    {
      image: IMAGE,
      networkMode: NETWORK_NAME,
      networks: {
        [NETWORK_NAME]: { IPAddress: NETWORK_IP, NetworkID: NETWORK_ID },
        bridge: { IPAddress: "172.17.0.2", NetworkID: "d".repeat(64) },
      },
      portBindings: null,
      ports: {},
    },
    {
      image: IMAGE,
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
    {
      image: "sha256:" + "f".repeat(64),
      networkMode: NETWORK_NAME,
      networks: {
        [NETWORK_NAME]: { IPAddress: NETWORK_IP, NetworkID: NETWORK_ID },
      },
      portBindings: null,
      ports: {},
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
              Image: image,
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

  const empty: CommandRunner = async () => ({ code: 0, stdout: "", stderr: "" });
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
          Entrypoint: ["/usr/local/bin/pyrus-capsule-entrypoint"],
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
              Entrypoint: ["/usr/local/bin/pyrus-capsule-entrypoint"],
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
      Entrypoint: ["/usr/local/bin/pyrus-capsule-entrypoint"],
      Volumes: { "/run/pyrus": {} },
    },
    {
      User: "10001:10001",
      Entrypoint: ["/usr/local/bin/pyrus-capsule-entrypoint", "unexpected"],
      Volumes: {},
    },
    {
      User: "10001:10001",
      Entrypoint: ["/usr/local/bin/pyrus-capsule-entrypoint"],
      Healthcheck: {
        Test: ["CMD-SHELL", "/usr/local/bin/pyrus-capsule-health"],
      },
      Volumes: {},
    },
    {
      User: "10001:10001",
      Entrypoint: ["/usr/local/bin/pyrus-capsule-entrypoint"],
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
            SecurityOptions: [
              "name=seccomp,profile=builtin",
              "name=cgroupns",
            ],
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
