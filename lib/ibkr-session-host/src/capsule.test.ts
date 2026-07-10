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
const READY_MARKER = "PYRUS_IBKR_CAPSULE_READY_V1";
const STARTED_AT = "2026-07-09T22:00:00.000Z";

const noExistingSlot = (): CommandResult => ({
  code: 0,
  stdout: "",
  stderr: "",
});

const capsuleProbeResult = (args: string[]): CommandResult | null => {
  if (args[0] === "container" && args[1] === "ls") return noExistingSlot();
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
    return { code: 0, stdout: `${READY_MARKER}\n`, stderr: "" };
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
      "bridge",
      "--publish",
      "127.0.0.1:15000:15000/tcp",
      "--publish",
      "127.0.0.1:16080:16080/tcp",
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
  assert.equal(invocation.args.at(-1), IMAGE, "image is the final argument");
});

test("exposes only the fixed capsule relays on host loopback", () => {
  const invocation = buildCreateCapsuleInvocation(
    loadSessionHostConfig({ IBKR_SESSION_CAPSULE_IMAGE: IMAGE }),
    SESSION_ID,
  );
  const published = invocation.args.filter((arg) => arg.includes(":") && arg.endsWith("/tcp"));

  assert.deepEqual(published, [
    "127.0.0.1:15000:15000/tcp",
    "127.0.0.1:16080:16080/tcp",
  ]);
  assert(!invocation.args.some((arg) => /^0\.0\.0\.0:/.test(arg)));
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

  assert.deepEqual(first, { name: SLOT_NAME, status: "ready" });
  assert.deepEqual(repeated, first);
  assert.deepEqual(
    calls.map(({ args }) => args[0]),
    [
      "container",
      "create",
      "start",
      "container",
      "logs",
      "container",
      "logs",
    ],
  );
  await assert.rejects(
    () => manager.ensure(OTHER_SESSION_ID),
    (error) =>
      error instanceof CapsuleError && error.code === "capacity_exhausted",
  );
  assert.equal(calls.length, 7, "capacity rejection happens before Docker");
  assert(!calls.some(({ args }) => args[0] === "exec"));
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
  await manager.ensure(SESSION_ID);
  assert.deepEqual(manager.getTarget(SESSION_ID, "cpg"), {
    host: "127.0.0.1",
    port: 15000,
  });
  assert.deepEqual(manager.getTarget(SESSION_ID, "console"), {
    host: "127.0.0.1",
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
          Running: stateProbes === 1,
          StartedAt: STARTED_AT,
        }),
        stderr: "",
      };
    }
    if (args[0] === "logs") {
      return { code: 0, stdout: `${READY_MARKER}\n`, stderr: "" };
    }
    return { code: 0, stdout: "", stderr: "" };
  };
  const manager = new CapsuleManager(
    loadSessionHostConfig({ IBKR_SESSION_CAPSULE_IMAGE: IMAGE }),
    runner,
  );

  assert.deepEqual(await manager.ensure(SESSION_ID), {
    name: SLOT_NAME,
    status: "ready",
  });
  assert.deepEqual(await manager.ensure(SESSION_ID), {
    name: SLOT_NAME,
    status: "occupied",
  });
  assert.equal(stateProbes, 2);
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
            ? `prefix-${READY_MARKER}-suffix\n`
            : `noise\n${READY_MARKER}\n`,
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
  });
  assert.equal(logProbe, 2);
  assert.equal(delays, 1);
  assert(!calls.some((args) => args[0] === "exec"));
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
  assert.equal(logProbes, 18);
  assert.equal(inspectProbes, 18);
  assert.equal(delays, 17);
  assert.equal(removes, 1);
  assert.deepEqual(manager.snapshot(), {
    mode: "paper",
    capacity: { max: 1, active: 0 },
  });
});

test("sanitizes Docker failures", async () => {
  const sentinel = "sensitive-docker-stderr";
  const runner: CommandRunner = async (_command, args) =>
    capsuleProbeResult(args) ?? {
      code: 1,
      stdout: "",
      stderr: sentinel,
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
    ["container", "create", "start", "container", "logs"],
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
    ["container", "create", "start", "rm"],
  );

  failStart = false;
  await manager.ensure(SESSION_ID);
  assert.deepEqual(
    calls.map((args) => args[0]),
    [
      "container",
      "create",
      "start",
      "rm",
      "create",
      "start",
      "container",
      "logs",
    ],
  );
});

test("poisons capacity when partial-capsule cleanup cannot be confirmed", async () => {
  const startSecret = "sensitive-start-stderr";
  const cleanupSecret = "sensitive-cleanup-stderr";
  const calls: string[][] = [];
  const runner: CommandRunner = async (_command, args) => {
    calls.push(args);
    if (args[0] === "container") return noExistingSlot();
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
  });
  assert.deepEqual(await manager.ensure(SESSION_ID), {
    name: SLOT_NAME,
    status: "ready",
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
      "container",
      "inspect",
      "--format",
      "{{json .Config.Labels}}",
      SLOT_NAME,
    ],
    [
      "container",
      "inspect",
      "--format",
      "{{json .State}}",
      SLOT_NAME,
    ],
    ["logs", "--since", STARTED_AT, "--tail", "100", SLOT_NAME],
    [
      "container",
      "inspect",
      "--format",
      "{{json .State}}",
      SLOT_NAME,
    ],
    ["logs", "--since", STARTED_AT, "--tail", "100", SLOT_NAME],
  ]);
  assert(!calls.some((args) => args[0] === "exec"));
});

test("reconciliation keeps an unproven existing slot occupied, not ready", async () => {
  for (const probe of [
    { running: false, logs: `${READY_MARKER}\n` },
    { running: true, logs: `${READY_MARKER}-suffix\n` },
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
      throw new Error(`unexpected Docker command: ${args.join(" ")}`);
    };
    const manager = new CapsuleManager(
      loadSessionHostConfig({ IBKR_SESSION_CAPSULE_IMAGE: IMAGE }),
      runner,
    );

    assert.deepEqual(await manager.reconcile(), {
      name: SLOT_NAME,
      status: "occupied",
    });
    assert(!calls.some((args) => args[0] === "exec"));
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
