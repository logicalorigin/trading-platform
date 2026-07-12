import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isIP } from "node:net";
import { fileURLToPath } from "node:url";

export type SessionHostConfig = {
  bindHost: "127.0.0.1";
  capsuleImage: string;
  capacity: 1;
  dockerBinary: "docker";
  mode: "paper";
  port: number;
  readonly seccompProfilePath: string;
};

export type DockerInvocation = {
  command: string;
  args: string[];
};

export type CommandResult = {
  code: number | null;
  stdout: string;
  stderr: string;
};

export type CommandRunner = (
  command: string,
  args: string[],
) => Promise<CommandResult>;

export type CapsuleRecord = {
  loginCompletions?: number;
  name: string;
  status: "ready" | "occupied";
};

export type CapsuleTargetKind = "cpg" | "console";

export type CapsuleTarget = {
  host: "127.0.0.1";
  port: 15000 | 16080;
};

export type CapsuleRelayTarget = {
  host: string;
  port: 15000 | 16080;
};

export type RuntimeReadiness =
  | { ready: true }
  | {
      ready: false;
      code:
        | "docker_unavailable"
        | "docker_capabilities_unavailable"
        | "seccomp_profile_invalid"
        | "capsule_image_unavailable"
        | "capsule_image_invalid";
    };

export const DEFAULT_SECCOMP_PROFILE_PATH = fileURLToPath(
  new URL("./chromium-seccomp.json", import.meta.url),
);
const SECCOMP_PROFILE_SHA256 =
  "19f1c5b65ff8280092de391959775201004f2c58eae2983612c028c6256a5b54";

export const execFileCommandRunner: CommandRunner = (command, args) =>
  new Promise((resolve) => {
    execFile(
      command,
      args,
      {
        encoding: "utf8",
        maxBuffer: 1024 * 1024,
        shell: false,
        timeout: 120_000,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        resolve({
          code:
            error === null
              ? 0
              : typeof error.code === "number"
                ? error.code
                : 1,
          stdout,
          stderr,
        });
      },
    );
  });

export async function checkDocker(
  runner: CommandRunner,
  dockerBinary: string,
): Promise<boolean> {
  try {
    const result = await runner(dockerBinary, [
      "version",
      "--format",
      "{{.Server.Version}}",
    ]);
    return result.code === 0 && result.stdout.trim().length > 0;
  } catch {
    return false;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseJsonRecord(value: string): Record<string, unknown> | null {
  try {
    return asRecord(JSON.parse(value) as unknown);
  } catch {
    return null;
  }
}

export async function checkCapsuleRuntime(
  runner: CommandRunner,
  config: SessionHostConfig,
): Promise<RuntimeReadiness> {
  try {
    const profile = await readFile(config.seccompProfilePath);
    if (
      createHash("sha256").update(profile).digest("hex") !==
      SECCOMP_PROFILE_SHA256
    ) {
      return { ready: false, code: "seccomp_profile_invalid" };
    }
  } catch {
    return { ready: false, code: "seccomp_profile_invalid" };
  }

  let daemon: CommandResult;
  try {
    daemon = await runner(config.dockerBinary, ["info", "--format", "{{json .}}"]);
  } catch {
    return { ready: false, code: "docker_unavailable" };
  }
  if (daemon.code !== 0) {
    return { ready: false, code: "docker_unavailable" };
  }
  const info = parseJsonRecord(daemon.stdout);
  const securityOptions = Array.isArray(info?.["SecurityOptions"])
    ? info["SecurityOptions"]
    : [];
  if (
    info?.["OSType"] !== "linux" ||
    !["amd64", "x86_64"].includes(String(info["Architecture"])) ||
    String(info["CgroupVersion"]) !== "2" ||
    !securityOptions.includes("name=seccomp,profile=builtin") ||
    !securityOptions.includes("name=cgroupns") ||
    info["MemoryLimit"] !== true ||
    info["SwapLimit"] !== true ||
    info["PidsLimit"] !== true
  ) {
    return { ready: false, code: "docker_capabilities_unavailable" };
  }

  let inspected: CommandResult;
  try {
    inspected = await runner(config.dockerBinary, [
      "image",
      "inspect",
      "--format",
      "{{json .}}",
      config.capsuleImage,
    ]);
  } catch {
    return { ready: false, code: "capsule_image_unavailable" };
  }
  if (inspected.code !== 0) {
    return { ready: false, code: "capsule_image_unavailable" };
  }
  const image = parseJsonRecord(inspected.stdout);
  const imageConfig =
    image?.["Config"] && typeof image["Config"] === "object"
      ? (image["Config"] as Record<string, unknown>)
      : null;
  const entrypoint = Array.isArray(imageConfig?.["Entrypoint"])
    ? imageConfig["Entrypoint"]
    : [];
  const healthcheck = imageConfig?.["Healthcheck"];
  const imageId = image?.["Id"];
  const repoDigests = Array.isArray(image?.["RepoDigests"])
    ? image["RepoDigests"]
    : [];
  const imageMatchesRequestedReference = LOCAL_IMAGE_ID_PATTERN.test(
    config.capsuleImage,
  )
    ? imageId === config.capsuleImage
    : repoDigests.includes(config.capsuleImage);
  const volumes = imageConfig?.["Volumes"];
  const volumesAreEmpty =
    volumes === null ||
    volumes === undefined ||
    (typeof volumes === "object" &&
      !Array.isArray(volumes) &&
      Object.keys(volumes).length === 0);
  if (
    typeof imageId !== "string" ||
    !LOCAL_IMAGE_ID_PATTERN.test(imageId) ||
    !imageMatchesRequestedReference ||
    image?.["Os"] !== "linux" ||
    image?.["Architecture"] !== "amd64" ||
    imageConfig?.["User"] !== "10001:10001" ||
    entrypoint.length !== 1 ||
    entrypoint[0] !== "/usr/local/bin/pyrus-capsule-entrypoint" ||
    (healthcheck !== null && healthcheck !== undefined) ||
    !volumesAreEmpty
  ) {
    return { ready: false, code: "capsule_image_invalid" };
  }
  return { ready: true };
}

export class CapsuleError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CapsuleError";
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SESSION_HASH_PATTERN = /^[a-f0-9]{24}$/;
const CAPSULE_SLOT_NAME = "pyrus-ibkr-slot-1";
const CAPSULE_NETWORK_NAME = "pyrus-ibkr-capsule-net";
const CAPSULE_NETWORK_LABEL = "pyrus.ibkr.network";
const CAPSULE_NETWORK_ICC_OPTION =
  "com.docker.network.bridge.enable_icc";
const CAPSULE_NETWORK_GATEWAY_OPTION =
  "com.docker.network.bridge.gateway_mode_ipv4";
const DOCKER_ID_PATTERN = /^[a-f0-9]{64}$/;
const CAPSULE_READY_MARKER = "PYRUS_IBKR_CAPSULE_READY_V1";
const CAPSULE_LOGIN_COMPLETE_MARKER =
  "PYRUS_IBKR_CAPSULE_LOGIN_COMPLETE_V1";
// 1s granularity: CPG takes tens of seconds to boot, and every extra poll
// interval after the ready marker appears is dead time the user spends staring
// at the "starting session" screen. Same overall 90s budget as before.
const CAPSULE_READY_ATTEMPTS = 90;
const CAPSULE_READY_INTERVAL_MS = 1_000;
// ponytail: PID 1 emits only readiness and completion markers, so this covers
// hundreds of restart/login cycles. Persist a counter only if measured usage
// can exceed this bounded Docker-log window.
const CAPSULE_LOG_TAIL_LINES = 1_000;
const CAPSULE_TARGETS = {
  cpg: { host: "127.0.0.1", port: 15000 },
  console: { host: "127.0.0.1", port: 16080 },
} as const satisfies Record<CapsuleTargetKind, CapsuleTarget>;
const DIGEST_IMAGE_PATTERN =
  /^[a-z0-9][a-z0-9._:/-]*@sha256:[a-f0-9]{64}$/;
const LOCAL_IMAGE_ID_PATTERN = /^sha256:[a-f0-9]{64}$/;
type CapsuleInspection =
  | {
      status: "current";
      networkAddress: string | null;
      sessionHash: string;
    }
  | { status: "stale_image"; containerId: string };

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseTimestampedDockerLogLine(
  line: string,
): { message: string; timestampMs: number } | null {
  const separator = line.indexOf(" ");
  if (separator <= 0) return null;
  const timestamp = line
    .slice(0, separator)
    .replace(/(\.\d{3})\d+(Z|[+-]\d{2}:\d{2})$/, "$1$2");
  const timestampMs = Date.parse(timestamp);
  return Number.isFinite(timestampMs)
    ? { message: line.slice(separator + 1), timestampMs }
    : null;
}

function isPrivateIpv4(value: unknown): value is string {
  if (typeof value !== "string" || isIP(value) !== 4) return false;
  const octets = value.split(".").map(Number);
  return (
    octets[0] === 10 ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  );
}

function isEmptyRecordOrNull(value: unknown): boolean {
  return (
    value === null ||
    (asRecord(value) !== null && Object.keys(asRecord(value) ?? {}).length === 0)
  );
}

function parsePort(value: string | undefined): number {
  if (value === undefined) return 18748;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new CapsuleError(
      "invalid_host_port",
      "IBKR session host port must be an integer from 1 to 65535.",
    );
  }
  return port;
}

function parseCapsuleImage(value: string | undefined): string {
  if (
    !value ||
    value.length > 512 ||
    (!DIGEST_IMAGE_PATTERN.test(value) && !LOCAL_IMAGE_ID_PATTERN.test(value)) ||
    /[\s\x00-\x1f\x7f]/.test(value)
  ) {
    throw new CapsuleError(
      "invalid_capsule_image",
      "IBKR session capsule image must use an immutable sha256 digest.",
    );
  }
  return value;
}

export function loadSessionHostConfig(
  env: Record<string, string | undefined> = process.env,
): SessionHostConfig {
  if ((env["IBKR_SESSION_HOST_MODE"] ?? "paper") !== "paper") {
    throw new CapsuleError(
      "unsupported_host_mode",
      "The initial IBKR session host supports paper accounts only.",
    );
  }
  if ((env["IBKR_SESSION_HOST_CAPACITY"] ?? "1") !== "1") {
    throw new CapsuleError(
      "unsupported_host_capacity",
      "The initial IBKR session host capacity is fixed at one.",
    );
  }
  if (
    env["IBKR_SESSION_HOST_BIND"] !== undefined &&
    env["IBKR_SESSION_HOST_BIND"] !== "127.0.0.1"
  ) {
    throw new CapsuleError(
      "unsupported_host_bind",
      "The initial IBKR session host must bind to loopback.",
    );
  }

  return {
    bindHost: "127.0.0.1",
    capsuleImage: parseCapsuleImage(env["IBKR_SESSION_CAPSULE_IMAGE"]),
    capacity: 1,
    dockerBinary: "docker",
    mode: "paper",
    port: parsePort(env["IBKR_SESSION_HOST_PORT"]),
    seccompProfilePath: DEFAULT_SECCOMP_PROFILE_PATH,
  };
}

function sessionHashForSession(sessionId: string): string {
  if (!UUID_PATTERN.test(sessionId)) {
    throw new CapsuleError(
      "invalid_session_id",
      "IBKR session ID must be a canonical UUID.",
    );
  }
  return createHash("sha256").update(sessionId).digest("hex").slice(0, 24);
}

export function capsuleNameForSession(sessionId: string): string {
  sessionHashForSession(sessionId);
  return CAPSULE_SLOT_NAME;
}

export function buildCreateCapsuleInvocation(
  config: SessionHostConfig,
  sessionId: string,
): DockerInvocation {
  const name = capsuleNameForSession(sessionId);
  const sessionHash = sessionHashForSession(sessionId);
  return {
    command: config.dockerBinary,
    args: [
      "create",
      "--name",
      name,
      "--label",
      "pyrus.ibkr.capsule=1",
      "--label",
      `pyrus.ibkr.session_hash=${sessionHash}`,
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
      `seccomp=${config.seccompProfilePath}`,
      "--network",
      CAPSULE_NETWORK_NAME,
      "--memory",
      "2g",
      "--memory-swap",
      "2g",
      // Measured 2026-07-10: raising this to 2 CPUs did not improve the ~40s
      // CPG boot on the contended 2-core VM (boot time tracks VM load, not
      // this cap), so the tighter limit stays.
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
      config.capsuleImage,
    ],
  };
}

async function runChecked(
  runner: CommandRunner,
  invocation: DockerInvocation,
  failureCode: string,
): Promise<void> {
  let result: CommandResult;
  try {
    result = await runner(invocation.command, invocation.args);
  } catch {
    throw new CapsuleError(failureCode, "IBKR capsule Docker operation failed.");
  }
  if (result.code !== 0) {
    throw new CapsuleError(failureCode, "IBKR capsule Docker operation failed.");
  }
}

export class CapsuleManager {
  private active: {
    networkAddress: string | null;
    sessionHash: string;
    record: CapsuleRecord;
  } | null = null;
  private pending: {
    sessionHash: string;
    promise: Promise<CapsuleRecord>;
  } | null =
    null;
  private releasing: { sessionHash: string; promise: Promise<void> } | null =
    null;
  private poisoned = false;
  private reconciled = false;
  private reconcilePromise: Promise<CapsuleRecord | null> | null = null;

  constructor(
    private readonly config: SessionHostConfig,
    private readonly runner: CommandRunner,
    private readonly delayFn: (ms: number) => Promise<void> = delay,
  ) {}

  ensure(sessionId: string): Promise<CapsuleRecord> {
    const sessionHash = sessionHashForSession(sessionId);
    if (this.poisoned) {
      return Promise.reject(this.cleanupUnconfirmed());
    }
    if (this.releasing) {
      return Promise.reject(
        new CapsuleError(
          "capacity_exhausted",
          "The IBKR session host is already in use.",
        ),
      );
    }
    if (this.active?.sessionHash === sessionHash) {
      return this.refreshActive(sessionHash);
    }
    if (this.pending?.sessionHash === sessionHash) {
      return this.pending.promise;
    }
    if (this.active || this.pending) {
      return Promise.reject(
        new CapsuleError(
          "capacity_exhausted",
          "The IBKR session host is already in use.",
        ),
      );
    }

    const promise = this.ensureAfterReconcile(sessionId, sessionHash);
    this.pending = { sessionHash, promise };
    return promise;
  }

  async reconcile(): Promise<CapsuleRecord | null> {
    if (this.poisoned) {
      throw this.cleanupUnconfirmed();
    }
    if (this.reconciled) {
      return this.active?.record ?? null;
    }
    if (this.reconcilePromise) {
      return this.reconcilePromise;
    }

    const promise = this.reconcileFromDocker();
    this.reconcilePromise = promise;
    try {
      return await promise;
    } finally {
      if (this.reconcilePromise === promise) {
        this.reconcilePromise = null;
      }
    }
  }

  async status(sessionId: string): Promise<CapsuleRecord | null> {
    const sessionHash = sessionHashForSession(sessionId);
    if (this.poisoned) {
      throw this.cleanupUnconfirmed();
    }
    if (this.releasing?.sessionHash === sessionHash) return null;
    if (this.pending?.sessionHash === sessionHash) {
      return this.pending.promise;
    }
    if (!this.active) {
      await this.reconcile();
    }
    return this.active?.sessionHash === sessionHash
      ? this.refreshActive(sessionHash)
      : null;
  }

  getTarget(sessionId: string, kind: CapsuleTargetKind): CapsuleTarget {
    const sessionHash = sessionHashForSession(sessionId);
    if (this.active?.sessionHash !== sessionHash) {
      throw new CapsuleError("session_not_found", "IBKR session not found.");
    }
    return CAPSULE_TARGETS[kind];
  }

  getRelayTarget(kind: CapsuleTargetKind): CapsuleRelayTarget | null {
    return this.active?.networkAddress &&
      this.active.record.status === "ready" &&
      !this.releasing
      ? { host: this.active.networkAddress, port: CAPSULE_TARGETS[kind].port }
      : null;
  }

  release(sessionId: string): Promise<void> {
    let sessionHash: string;
    try {
      sessionHash = sessionHashForSession(sessionId);
    } catch (error) {
      return Promise.reject(error);
    }
    if (this.poisoned) {
      return Promise.reject(this.cleanupUnconfirmed());
    }
    if (this.releasing?.sessionHash === sessionHash) {
      return this.releasing.promise;
    }
    if (this.releasing) {
      return Promise.reject(
        new CapsuleError("session_not_found", "IBKR session not found."),
      );
    }
    const promise = this.releaseActive(sessionHash);
    this.releasing = { sessionHash, promise };
    const clear = (): void => {
      if (this.releasing?.promise === promise) this.releasing = null;
    };
    void promise.then(clear, clear);
    return promise;
  }

  private async releaseActive(sessionHash: string): Promise<void> {
    if (this.pending?.sessionHash === sessionHash) {
      await this.pending.promise;
    }
    if (!this.active) {
      await this.reconcile();
    }
    if (this.active?.sessionHash !== sessionHash) {
      throw new CapsuleError("session_not_found", "IBKR session not found.");
    }

    let removed: CommandResult;
    try {
      removed = await this.runner(this.config.dockerBinary, [
        "rm",
        "--force",
        this.active.record.name,
      ]);
    } catch {
      throw this.cleanupUnconfirmed();
    }
    if (removed.code !== 0) {
      throw this.cleanupUnconfirmed();
    }
    this.active = null;
    this.reconciled = true;
  }

  snapshot(): {
    mode: "paper";
    capacity: { max: 1; active: number };
  } {
    return {
      mode: "paper",
      capacity: {
        max: 1,
        active:
          this.active ||
          this.pending ||
          this.poisoned ||
          this.reconcilePromise ||
          this.releasing
            ? 1
            : 0,
      },
    };
  }

  private cleanupUnconfirmed(): CapsuleError {
    this.poisoned = true;
    return new CapsuleError(
      "cleanup_unconfirmed",
      "IBKR capsule cleanup could not be confirmed.",
    );
  }

  private async refreshActive(sessionHash: string): Promise<CapsuleRecord> {
    const active = this.active;
    if (!active || active.sessionHash !== sessionHash) {
      throw new CapsuleError(
        "capacity_exhausted",
        "The IBKR session host is already in use.",
      );
    }
    const probe = await this.probeCapsule(active.record.name);
    if (this.active !== active) {
      throw new CapsuleError("session_not_found", "IBKR session not found.");
    }
    if (!probe.ready) active.networkAddress = null;
    if (probe.ready && !active.networkAddress) {
      const networkId = await this.ensureCapsuleNetwork();
      if (this.active !== active) {
        throw new CapsuleError("session_not_found", "IBKR session not found.");
      }
      const identity = await this.inspectOwnedCapsule(
        active.record.name,
        networkId,
      );
      if (this.active !== active) {
        throw new CapsuleError("session_not_found", "IBKR session not found.");
      }
      if (
        identity?.status !== "current" ||
        identity.sessionHash !== active.sessionHash
      ) {
        throw this.cleanupUnconfirmed();
      }
      active.networkAddress = identity.networkAddress;
    }
    const record: CapsuleRecord = {
      loginCompletions: Math.max(
        active.record.loginCompletions ?? 0,
        probe.loginCompletions,
      ),
      name: active.record.name,
      status: probe.ready && active.networkAddress ? "ready" : "occupied",
    };
    active.record = record;
    return record;
  }

  private async reconcileFromDocker(): Promise<CapsuleRecord | null> {
    let listed: CommandResult;
    try {
      listed = await this.runner(this.config.dockerBinary, [
        "container",
        "ls",
        "--all",
        "--filter",
        `name=^/${CAPSULE_SLOT_NAME}$`,
        "--format",
        "{{.Names}}",
      ]);
    } catch {
      throw this.cleanupUnconfirmed();
    }
    if (listed.code !== 0) {
      throw this.cleanupUnconfirmed();
    }

    const names = listed.stdout
      .split(/\r?\n/)
      .map((name) => name.trim())
      .filter(Boolean);
    if (names.length === 0) {
      this.reconciled = true;
      return null;
    }
    if (names.length !== 1 || names[0] !== CAPSULE_SLOT_NAME) {
      throw this.cleanupUnconfirmed();
    }

    const networkId = await this.ensureCapsuleNetwork();

    const identity = await this.inspectOwnedCapsule(
      CAPSULE_SLOT_NAME,
      networkId,
    );
    if (!identity) {
      throw this.cleanupUnconfirmed();
    }
    if (identity.status === "stale_image") {
      let removed: CommandResult;
      try {
        removed = await this.runner(this.config.dockerBinary, [
          "rm",
          "--force",
          identity.containerId,
        ]);
      } catch {
        throw this.cleanupUnconfirmed();
      }
      if (removed.code !== 0) {
        throw this.cleanupUnconfirmed();
      }
      this.reconciled = true;
      return null;
    }

    const probe = await this.probeCapsule(CAPSULE_SLOT_NAME);
    const record: CapsuleRecord = {
      loginCompletions: probe.loginCompletions,
      name: CAPSULE_SLOT_NAME,
      status: probe.ready && identity.networkAddress ? "ready" : "occupied",
    };
    this.active = {
      networkAddress: identity.networkAddress,
      sessionHash: identity.sessionHash,
      record,
    };
    this.reconciled = true;
    return record;
  }

  private async ensureAfterReconcile(
    sessionId: string,
    sessionHash: string,
  ): Promise<CapsuleRecord> {
    try {
      await this.reconcile();
      if (this.active) {
        if (this.active.sessionHash === sessionHash) {
          return this.active.record;
        }
        throw new CapsuleError(
          "capacity_exhausted",
          "The IBKR session host is already in use.",
        );
      }
      return await this.provision(sessionId, sessionHash);
    } finally {
      if (this.pending?.sessionHash === sessionHash) {
        this.pending = null;
      }
    }
  }

  private async probeCapsule(
    name: string,
  ): Promise<{ ready: boolean; loginCompletions: number }> {
    let inspected: CommandResult;
    try {
      inspected = await this.runner(this.config.dockerBinary, [
        "container",
        "inspect",
        "--format",
        "{{json .State}}",
        name,
      ]);
    } catch {
      return { ready: false, loginCompletions: 0 };
    }
    const state = inspected.code === 0 ? parseJsonRecord(inspected.stdout) : null;
    const startedAt = state?.["StartedAt"];
    const startedAtMs =
      typeof startedAt === "string" ? Date.parse(startedAt) : Number.NaN;
    if (state?.["Running"] !== true || !Number.isFinite(startedAtMs)) {
      return { ready: false, loginCompletions: 0 };
    }

    let logs: CommandResult;
    try {
      logs = await this.runner(this.config.dockerBinary, [
        "logs",
        "--timestamps",
        "--tail",
        String(CAPSULE_LOG_TAIL_LINES),
        name,
      ]);
    } catch {
      return { ready: false, loginCompletions: 0 };
    }
    if (logs.code !== 0) {
      return { ready: false, loginCompletions: 0 };
    }
    const lines = logs.stdout
      .split(/\r?\n/)
      .map(parseTimestampedDockerLogLine)
      .filter((line) => line !== null);
    const loginCompletions = lines.filter(
      (line) => line.message === CAPSULE_LOGIN_COMPLETE_MARKER,
    ).length;
    const ready = lines.some(
      (line) =>
        line.message === CAPSULE_READY_MARKER &&
        line.timestampMs >= startedAtMs,
    );
    if (!ready) return { ready: false, loginCompletions };
    let confirmed: CommandResult;
    try {
      confirmed = await this.runner(this.config.dockerBinary, [
        "container",
        "inspect",
        "--format",
        "{{json .State}}",
        name,
      ]);
    } catch {
      return { ready: false, loginCompletions };
    }
    const confirmedState =
      confirmed.code === 0 ? parseJsonRecord(confirmed.stdout) : null;
    if (
      confirmedState?.["Running"] !== true ||
      confirmedState["StartedAt"] !== startedAt
    ) {
      return { ready: false, loginCompletions };
    }
    return {
      ready: true,
      loginCompletions,
    };
  }

  private async waitForCapsuleReady(
    name: string,
  ): Promise<{ ready: true; loginCompletions: number }> {
    for (let attempt = 0; attempt < CAPSULE_READY_ATTEMPTS; attempt += 1) {
      const probe = await this.probeCapsule(name);
      if (probe.ready) {
        return { ready: true, loginCompletions: probe.loginCompletions };
      }
      if (attempt + 1 < CAPSULE_READY_ATTEMPTS) {
        await this.delayFn(CAPSULE_READY_INTERVAL_MS);
      }
    }
    throw new CapsuleError(
      "capsule_readiness_failed",
      "IBKR capsule process readiness could not be confirmed.",
    );
  }

  private async provision(
    sessionId: string,
    sessionHash: string,
  ): Promise<CapsuleRecord> {
    const name = capsuleNameForSession(sessionId);
    let created = false;
    try {
      const networkId = await this.ensureCapsuleNetwork(true);
      await runChecked(
        this.runner,
        buildCreateCapsuleInvocation(this.config, sessionId),
        "docker_create_failed",
      );
      created = true;
      await runChecked(
        this.runner,
        { command: this.config.dockerBinary, args: ["start", name] },
        "docker_start_failed",
      );
      const probe = await this.waitForCapsuleReady(name);
      const identity = await this.inspectOwnedCapsule(name, networkId);
      if (
        identity?.status !== "current" ||
        !identity.networkAddress ||
        identity.sessionHash !== sessionHash
      ) {
        throw new CapsuleError(
          "capsule_identity_invalid",
          "IBKR capsule identity could not be confirmed.",
        );
      }
      const record: CapsuleRecord = {
        loginCompletions: probe.loginCompletions,
        name,
        status: "ready",
      };
      this.active = {
        networkAddress: identity.networkAddress,
        sessionHash: identity.sessionHash,
        record,
      };
      return record;
    } catch (error) {
      if (created) {
        let cleaned = false;
        try {
          const result = await this.runner(this.config.dockerBinary, [
            "rm",
            "--force",
            name,
          ]);
          cleaned = result.code === 0;
        } catch {
          cleaned = false;
        }
        if (!cleaned) {
          throw this.cleanupUnconfirmed();
        }
      }
      throw error;
    }
  }

  private async inspectCapsuleNetwork(): Promise<
    | { status: "missing" | "invalid" }
    | { status: "valid"; networkId: string }
  > {
    let inspected: CommandResult;
    try {
      inspected = await this.runner(this.config.dockerBinary, [
        "network",
        "inspect",
        "--format",
        "{{json .}}",
        CAPSULE_NETWORK_NAME,
      ]);
    } catch {
      return { status: "missing" };
    }
    if (inspected.code !== 0) return { status: "missing" };

    const network = parseJsonRecord(inspected.stdout);
    const labels = asRecord(network?.["Labels"]);
    const options = asRecord(network?.["Options"]);
    const optionNames = options ? Object.keys(options).sort() : [];
    const networkId = network?.["Id"];
    return typeof networkId === "string" &&
      DOCKER_ID_PATTERN.test(networkId) &&
      network?.["Name"] === CAPSULE_NETWORK_NAME &&
      network["Scope"] === "local" &&
      network["Driver"] === "bridge" &&
      network["EnableIPv6"] === false &&
      network["Internal"] === false &&
      network["Attachable"] === false &&
      network["Ingress"] === false &&
      network["ConfigOnly"] === false &&
      labels?.[CAPSULE_NETWORK_LABEL] === "1" &&
      optionNames.length === 2 &&
      optionNames[0] === CAPSULE_NETWORK_ICC_OPTION &&
      optionNames[1] === CAPSULE_NETWORK_GATEWAY_OPTION &&
      options?.[CAPSULE_NETWORK_ICC_OPTION] === "false" &&
      options[CAPSULE_NETWORK_GATEWAY_OPTION] === "nat"
      ? { status: "valid", networkId }
      : { status: "invalid" };
  }

  private async inspectOwnedCapsule(
    name: string,
    networkId: string,
  ): Promise<CapsuleInspection | null> {
    let inspected: CommandResult;
    try {
      inspected = await this.runner(this.config.dockerBinary, [
        "container",
        "inspect",
        "--format",
        "{{json .}}",
        name,
      ]);
    } catch {
      return null;
    }
    const container =
      inspected.code === 0 ? parseJsonRecord(inspected.stdout) : null;
    const containerConfig = asRecord(container?.["Config"]);
    const labels = asRecord(containerConfig?.["Labels"]);
    const hostConfig = asRecord(container?.["HostConfig"]);
    const networks = asRecord(
      asRecord(container?.["NetworkSettings"])?.["Networks"],
    );
    const ports = asRecord(container?.["NetworkSettings"])?.["Ports"];
    const networkNames = networks ? Object.keys(networks) : [];
    const endpoint = asRecord(networks?.[CAPSULE_NETWORK_NAME]);
    const state = asRecord(container?.["State"]);
    const sessionHash = labels?.["pyrus.ibkr.session_hash"];
    const image = containerConfig?.["Image"];
    const rawNetworkAddress = endpoint?.["IPAddress"];
    const networkAddress = isPrivateIpv4(rawNetworkAddress)
      ? rawNetworkAddress
      : rawNetworkAddress === "" && state?.["Running"] === false
        ? null
        : undefined;
    const ownedAndIsolated =
      labels?.["pyrus.ibkr.capsule"] === "1" &&
      typeof sessionHash === "string" &&
      SESSION_HASH_PATTERN.test(sessionHash) &&
      hostConfig?.["NetworkMode"] === CAPSULE_NETWORK_NAME &&
      isEmptyRecordOrNull(hostConfig["PortBindings"]) &&
      networkNames.length === 1 &&
      networkNames[0] === CAPSULE_NETWORK_NAME &&
      endpoint?.["NetworkID"] === networkId &&
      isEmptyRecordOrNull(ports) &&
      networkAddress !== undefined;
    if (!ownedAndIsolated) return null;
    if (image === this.config.capsuleImage) {
      return { status: "current", networkAddress, sessionHash };
    }
    const containerId = container?.["Id"];
    return typeof containerId === "string" &&
      DOCKER_ID_PATTERN.test(containerId) &&
      typeof image === "string" &&
      (LOCAL_IMAGE_ID_PATTERN.test(image) || DIGEST_IMAGE_PATTERN.test(image))
      ? { status: "stale_image", containerId }
      : null;
  }

  private async ensureCapsuleNetwork(
    recreateForFreshSlot = false,
  ): Promise<string> {
    const existing = await this.inspectCapsuleNetwork();
    if (existing.status === "valid" && !recreateForFreshSlot) {
      return existing.networkId;
    }
    if (existing.status === "invalid") {
      throw new CapsuleError(
        "capsule_network_invalid",
        "IBKR capsule network isolation could not be confirmed.",
      );
    }

    if (existing.status === "valid") {
      // Docker can retain valid bridge metadata across a daemon restart without
      // restoring its isolation rules. A fresh slot must start on a fresh bridge.
      await runChecked(
        this.runner,
        {
          command: this.config.dockerBinary,
          args: ["network", "rm", CAPSULE_NETWORK_NAME],
        },
        "capsule_network_invalid",
      );
    }

    const createInvocation = {
      command: this.config.dockerBinary,
      args: [
        "network",
        "create",
        "--driver",
        "bridge",
        "--ipv6=false",
        "--opt",
        `${CAPSULE_NETWORK_ICC_OPTION}=false`,
        "--opt",
        `${CAPSULE_NETWORK_GATEWAY_OPTION}=nat`,
        "--label",
        `${CAPSULE_NETWORK_LABEL}=1`,
        CAPSULE_NETWORK_NAME,
      ],
    } satisfies DockerInvocation;
    if (recreateForFreshSlot) {
      await runChecked(
        this.runner,
        createInvocation,
        "capsule_network_invalid",
      );
    } else {
      try {
        await this.runner(createInvocation.command, createInvocation.args);
      } catch {
        // A racing host process may still have created the exact network.
      }
    }
    const created = await this.inspectCapsuleNetwork();
    if (created.status !== "valid") {
      throw new CapsuleError(
        "capsule_network_invalid",
        "IBKR capsule network isolation could not be confirmed.",
      );
    }
    return created.networkId;
  }
}
