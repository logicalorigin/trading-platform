import { execFile } from "node:child_process";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createConnection, isIP } from "node:net";
import { fileURLToPath } from "node:url";

import { readLinuxBoottimeNs } from "./lease-clock";

export type SessionHostConfig = {
  bindHost: "127.0.0.1";
  capsuleImage: string;
  capacity: number;
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
  port: number;
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
    daemon = await runner(config.dockerBinary, [
      "info",
      "--format",
      "{{json .}}",
    ]);
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
    entrypoint[0] !== "/usr/local/bin/pyrus-capsule-supervisor.py" ||
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
const MAX_HOST_CAPACITY = 20;
const CAPSULE_NETWORK_LABEL = "pyrus.ibkr.network";
const CAPSULE_NETWORK_ICC_OPTION = "com.docker.network.bridge.enable_icc";
const CAPSULE_NETWORK_GATEWAY_OPTION =
  "com.docker.network.bridge.gateway_mode_ipv4";
const DOCKER_ID_PATTERN = /^[a-f0-9]{64}$/;
const CAPSULE_READY_MARKER = "PYRUS_IBKR_CAPSULE_READY_V1";
const CAPSULE_LOGIN_COMPLETE_MARKER = "PYRUS_IBKR_CAPSULE_LOGIN_COMPLETE_V1";
// 1s granularity: CPG takes tens of seconds to boot, and every extra poll
// interval after the ready marker appears is dead time the user spends staring
// at the "starting session" screen. Same overall 90s budget as before.
const CAPSULE_READY_ATTEMPTS = 90;
const CAPSULE_READY_INTERVAL_MS = 1_000;
// ponytail: PID 1 emits only readiness and completion markers, so this covers
// hundreds of restart/login cycles. Persist a counter only if measured usage
// can exceed this bounded Docker-log window.
const CAPSULE_LOG_TAIL_LINES = 1_000;
const CAPSULE_INTERNAL_PORTS = {
  cpg: 15000,
  console: 16080,
} as const satisfies Record<CapsuleTargetKind, 15000 | 16080>;
const DIGEST_IMAGE_PATTERN = /^[a-z0-9][a-z0-9._:/-]*@sha256:[a-f0-9]{64}$/;
const LOCAL_IMAGE_ID_PATTERN = /^sha256:[a-f0-9]{64}$/;
type CapsuleInspection =
  | {
      containerId: string;
      fenceHash: string;
      generation: number;
      leaseControlKey: string | null;
      leaseProtocol: 1 | null;
      running: boolean;
      status: "current";
      networkAddress: string | null;
      sessionHash: string;
      slotNumber: number;
    }
  | { status: "stale_image"; containerId: string };

export type CapsuleLeaseGrant = {
  bootId: string;
  controlAttemptId: string;
  grantNotAfterNs: string;
  version: 1;
};

export type CapsuleLeaseRenewal = {
  controlKey: string;
  fenceHash: string;
  grant: CapsuleLeaseGrant;
  host: string;
};

export type CapsuleLeaseRenewer = (
  renewal: CapsuleLeaseRenewal,
) => Promise<boolean>;

export type CapsuleLeaseRuntime = {
  clear: (timer: ReturnType<typeof setTimeout>) => void;
  nowNs: () => bigint;
  schedule: (
    callback: () => void,
    delayMs: number,
  ) => ReturnType<typeof setTimeout>;
};

const CAPSULE_LEASE_PROTOCOL_VERSION = 1;
const CAPSULE_LEASE_TTL_NS = 120_000_000_000n;
const CAPSULE_LEASE_GRANT_WINDOW_NS = 20_000_000_000n;
const CAPSULE_LEASE_GRANTED_MARKER = "PYRUS_IBKR_CAPSULE_LEASE_GRANTED_V1";
const CAPSULE_LEASE_CONTROL_PORT = 17_000;
const CAPSULE_LEASE_CONTROL_TIMEOUT_MS = 5_000;
const CAPSULE_LEASE_CONTROL_KEY_PATTERN = /^[a-f0-9]{64}$/;
const BOOT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MONOTONIC_NS_PATTERN = /^[1-9][0-9]{0,18}$/;
const MAX_GRANT_NOT_AFTER_NS =
  9_223_372_036_854_775_807n - CAPSULE_LEASE_TTL_NS;
const defaultCapsuleLeaseRuntime: CapsuleLeaseRuntime = {
  clear: (timer) => clearTimeout(timer),
  nowNs: readLinuxBoottimeNs,
  schedule: (callback, delayMs) => {
    const timer = setTimeout(callback, delayMs);
    timer.unref?.();
    return timer;
  },
};

export async function readCapsuleBootId(): Promise<string> {
  let bootId = "";
  try {
    bootId = (await readFile("/proc/sys/kernel/random/boot_id", "utf8")).trim();
  } catch {
    // The supported session-host topology is Linux-only; fail closed below.
  }
  if (!BOOT_ID_PATTERN.test(bootId)) {
    throw new CapsuleError(
      "lease_clock_unavailable",
      "The Linux boot identity is unavailable.",
    );
  }
  return bootId;
}

export function createCapsuleLeaseGrantIssuer(
  bootId: string,
  nowNs: () => bigint = readLinuxBoottimeNs,
): (controlAttemptId: string) => CapsuleLeaseGrant {
  if (!BOOT_ID_PATTERN.test(bootId)) {
    throw new CapsuleError(
      "lease_clock_unavailable",
      "The Linux boot identity is unavailable.",
    );
  }
  return (controlAttemptId) => {
    if (!UUID_PATTERN.test(controlAttemptId)) {
      throw new CapsuleError(
        "invalid_lease_grant",
        "IBKR capsule lease grant is invalid.",
      );
    }
    let grantNotAfterNs: bigint;
    try {
      grantNotAfterNs = nowNs() + CAPSULE_LEASE_GRANT_WINDOW_NS;
    } catch {
      throw new CapsuleError(
        "lease_clock_unavailable",
        "The Linux boot clock is unavailable.",
      );
    }
    if (grantNotAfterNs <= 0n || grantNotAfterNs > MAX_GRANT_NOT_AFTER_NS) {
      throw new CapsuleError(
        "lease_clock_unavailable",
        "The Linux boot clock is unavailable.",
      );
    }
    return {
      version: CAPSULE_LEASE_PROTOCOL_VERSION,
      bootId,
      controlAttemptId,
      grantNotAfterNs: String(grantNotAfterNs),
    };
  };
}

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
    (asRecord(value) !== null &&
      Object.keys(asRecord(value) ?? {}).length === 0)
  );
}

function isEmptyArrayOrNull(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    (Array.isArray(value) && value.length === 0)
  );
}

function hasExactStringSet(value: unknown, expected: string[]): boolean {
  if (
    !Array.isArray(value) ||
    value.length !== expected.length ||
    value.some((entry) => typeof entry !== "string")
  ) {
    return false;
  }
  const entries = value as string[];
  return (
    new Set(entries).size === expected.length &&
    expected.every((entry) => entries.includes(entry))
  );
}

function canonicalJsonValue(value: unknown): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(canonicalJsonValue);
  }
  const record = asRecord(value);
  if (record) {
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, canonicalJsonValue(record[key])]),
    );
  }
  throw new Error("invalid JSON value");
}

async function hasExactSeccompSecurityOptions(
  value: unknown,
  profilePath: string,
): Promise<boolean> {
  if (!Array.isArray(value) || value.length !== 2) return false;
  const options = value.filter(
    (entry): entry is string => typeof entry === "string",
  );
  if (options.length !== 2 || !options.includes("no-new-privileges=true")) {
    return false;
  }
  const seccompOptions = options.filter((entry) =>
    entry.startsWith("seccomp="),
  );
  if (seccompOptions.length !== 1) return false;

  let expectedBytes: Buffer;
  try {
    expectedBytes = await readFile(profilePath);
  } catch {
    return false;
  }
  if (
    createHash("sha256").update(expectedBytes).digest("hex") !==
    SECCOMP_PROFILE_SHA256
  ) {
    return false;
  }

  const inspected = seccompOptions[0]!.slice("seccomp=".length);
  if (inspected === profilePath) return true;
  // Docker 27 expands a path-backed seccomp option to inline JSON in inspect;
  // older engines can retain the original path. Both must match the pinned file.
  try {
    return (
      JSON.stringify(canonicalJsonValue(JSON.parse(inspected) as unknown)) ===
      JSON.stringify(
        canonicalJsonValue(
          JSON.parse(expectedBytes.toString("utf8")) as unknown,
        ),
      )
    );
  } catch {
    return false;
  }
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

function parseHostCapacity(value: string | undefined): number {
  const capacity = Number(value ?? "1");
  if (
    !Number.isInteger(capacity) ||
    capacity < 1 ||
    capacity > MAX_HOST_CAPACITY
  ) {
    throw new CapsuleError(
      "invalid_host_capacity",
      "IBKR session host capacity must be an integer from 1 to 20.",
    );
  }
  return capacity;
}

function validateSlotNumber(slotNumber: number): number {
  if (
    !Number.isInteger(slotNumber) ||
    slotNumber < 1 ||
    slotNumber > MAX_HOST_CAPACITY
  ) {
    throw new CapsuleError(
      "invalid_slot_number",
      "IBKR capsule slot must be an integer from 1 to 20.",
    );
  }
  return slotNumber;
}

function validateGeneration(generation: number): number {
  if (
    !Number.isSafeInteger(generation) ||
    generation < 0 ||
    generation > 2_147_483_647
  ) {
    throw new CapsuleError(
      "invalid_generation",
      "IBKR session generation must be an integer from 0 to 2147483647.",
    );
  }
  return generation;
}

function capsuleSlotName(slotNumber: number): string {
  return `pyrus-ibkr-slot-${validateSlotNumber(slotNumber)}`;
}

function capsuleNetworkName(slotNumber: number): string {
  const slot = validateSlotNumber(slotNumber);
  return slot === 1
    ? "pyrus-ibkr-capsule-net"
    : `pyrus-ibkr-capsule-net-${slot}`;
}

export function capsuleTargetForSlot(
  slotNumber: number,
  kind: CapsuleTargetKind,
): CapsuleTarget {
  const slot = validateSlotNumber(slotNumber);
  const basePort = kind === "cpg" ? 15000 : 16080;
  return { host: "127.0.0.1", port: basePort + slot - 1 };
}

function parseCapsuleImage(value: string | undefined): string {
  if (
    !value ||
    value.length > 512 ||
    (!DIGEST_IMAGE_PATTERN.test(value) &&
      !LOCAL_IMAGE_ID_PATTERN.test(value)) ||
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
    capacity: parseHostCapacity(env["IBKR_SESSION_HOST_CAPACITY"]),
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

function fenceHashForSession(sessionId: string, generation: number): string {
  const sessionHash = sessionHashForSession(sessionId);
  const validGeneration = validateGeneration(generation);
  return validGeneration === 0
    ? sessionHash
    : createHash("sha256")
        .update(`${sessionId}\0${validGeneration}`)
        .digest("hex")
        .slice(0, 24);
}

function validateLeaseGrant(
  grant: CapsuleLeaseGrant,
  nowNs: bigint,
): { deadlineNs: bigint; grantNotAfterNs: bigint } {
  if (
    grant.version !== CAPSULE_LEASE_PROTOCOL_VERSION ||
    !BOOT_ID_PATTERN.test(grant.bootId) ||
    !UUID_PATTERN.test(grant.controlAttemptId) ||
    !MONOTONIC_NS_PATTERN.test(grant.grantNotAfterNs)
  ) {
    throw new CapsuleError(
      "invalid_lease_grant",
      "IBKR capsule lease grant is invalid.",
    );
  }
  const grantNotAfterNs = BigInt(grant.grantNotAfterNs);
  if (grantNotAfterNs > MAX_GRANT_NOT_AFTER_NS || nowNs >= grantNotAfterNs) {
    throw new CapsuleError(
      "lease_grant_expired",
      "IBKR capsule lease grant has expired.",
    );
  }
  return {
    deadlineNs: grantNotAfterNs + CAPSULE_LEASE_TTL_NS,
    grantNotAfterNs,
  };
}

export function serializeCapsuleLeaseRenewal(
  renewal: Omit<CapsuleLeaseRenewal, "host">,
): string {
  if (
    !CAPSULE_LEASE_CONTROL_KEY_PATTERN.test(renewal.controlKey) ||
    !SESSION_HASH_PATTERN.test(renewal.fenceHash)
  ) {
    throw new CapsuleError(
      "invalid_lease_control",
      "IBKR capsule lease control is invalid.",
    );
  }
  validateLeaseGrant(renewal.grant, -1n);
  const payload = JSON.stringify({
    version: renewal.grant.version,
    bootId: renewal.grant.bootId,
    fenceHash: renewal.fenceHash,
    controlAttemptId: renewal.grant.controlAttemptId,
    grantNotAfterNs: renewal.grant.grantNotAfterNs,
  });
  const mac = createHmac("sha256", Buffer.from(renewal.controlKey, "hex"))
    .update(payload)
    .digest("hex");
  return `${mac} ${payload}\n`;
}

export const renewCapsuleLease: CapsuleLeaseRenewer = async (
  renewal,
): Promise<boolean> => {
  if (!isPrivateIpv4(renewal.host)) return false;
  let request: string;
  try {
    request = serializeCapsuleLeaseRenewal(renewal);
  } catch {
    return false;
  }
  const expected = Buffer.from(`${CAPSULE_LEASE_GRANTED_MARKER}\n`);
  return new Promise<boolean>((resolve) => {
    const chunks: Buffer[] = [];
    let received = 0;
    let settled = false;
    const socket = createConnection({
      host: renewal.host,
      port: CAPSULE_LEASE_CONTROL_PORT,
    });
    const finish = (accepted: boolean): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(accepted);
    };
    socket.setTimeout(CAPSULE_LEASE_CONTROL_TIMEOUT_MS, () => finish(false));
    socket.once("connect", () => socket.end(request));
    socket.on("data", (chunk: Buffer) => {
      received += chunk.length;
      if (received > expected.length) {
        finish(false);
        return;
      }
      chunks.push(chunk);
    });
    socket.once("end", () => {
      finish(
        received === expected.length &&
          Buffer.concat(chunks, received).equals(expected),
      );
    });
    socket.once("error", () => finish(false));
  });
};

export function capsuleNameForSession(
  sessionId: string,
  slotNumber = 1,
): string {
  sessionHashForSession(sessionId);
  return capsuleSlotName(slotNumber);
}

export function buildCreateCapsuleInvocation(
  config: SessionHostConfig,
  sessionId: string,
  slotNumber = 1,
  generation = 0,
  leaseGrant?: CapsuleLeaseGrant,
): DockerInvocation {
  const name = capsuleNameForSession(sessionId, slotNumber);
  const sessionHash = sessionHashForSession(sessionId);
  const fenceHash = fenceHashForSession(sessionId, generation);
  if (leaseGrant) validateLeaseGrant(leaseGrant, -1n);
  const leaseControlKey = leaseGrant ? randomBytes(32).toString("hex") : null;
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
      "--label",
      `pyrus.ibkr.fence_hash=${fenceHash}`,
      "--label",
      `pyrus.ibkr.generation=${generation}`,
      "--label",
      `pyrus.ibkr.slot=${validateSlotNumber(slotNumber)}`,
      ...(leaseGrant
        ? [
            "--label",
            `pyrus.ibkr.lease_protocol=${CAPSULE_LEASE_PROTOCOL_VERSION}`,
            "--env",
            `PYRUS_IBKR_CAPSULE_LEASE_VERSION=${CAPSULE_LEASE_PROTOCOL_VERSION}`,
            "--env",
            `PYRUS_IBKR_CAPSULE_LEASE_BOOT_ID=${leaseGrant.bootId}`,
            "--env",
            `PYRUS_IBKR_CAPSULE_LEASE_FENCE_HASH=${fenceHash}`,
            "--env",
            `PYRUS_IBKR_CAPSULE_LEASE_CONTROL_ATTEMPT_ID=${leaseGrant.controlAttemptId}`,
            "--env",
            `PYRUS_IBKR_CAPSULE_LEASE_GRANT_NOT_AFTER_NS=${leaseGrant.grantNotAfterNs}`,
            "--env",
            `PYRUS_IBKR_CAPSULE_LEASE_CONTROL_KEY=${leaseControlKey}`,
          ]
        : []),
      "--pull",
      "never",
      "--restart",
      leaseGrant ? "no" : "on-failure:3",
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
      `seccomp=${config.seccompProfilePath}`,
      "--network",
      capsuleNetworkName(slotNumber),
      "--cgroupns",
      "private",
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
      leaseGrant
        ? "/run/pyrus:rw,noexec,nosuid,nodev,size=512m,mode=0710,uid=10001,gid=0"
        : "/run/pyrus:rw,noexec,nosuid,nodev,size=512m,mode=0700,uid=10001,gid=10001",
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
    throw new CapsuleError(
      failureCode,
      "IBKR capsule Docker operation failed.",
    );
  }
  if (result.code !== 0) {
    throw new CapsuleError(
      failureCode,
      "IBKR capsule Docker operation failed.",
    );
  }
}

export class CapsuleManager {
  private active: {
    containerId: string;
    fenceHash: string;
    generation: number;
    lease: {
      controlKey: string;
      deadlineNs: bigint | null;
      timer: ReturnType<typeof setTimeout> | null;
    } | null;
    networkAddress: string | null;
    sessionHash: string;
    record: CapsuleRecord;
  } | null = null;
  private pending: {
    fenceHash: string;
    promise: Promise<CapsuleRecord>;
  } | null = null;
  private releasing: { fenceHash: string; promise: Promise<void> } | null =
    null;
  private poisoned = false;
  private reconciled = false;
  private reconcilePromise: Promise<CapsuleRecord | null> | null = null;

  constructor(
    private readonly config: SessionHostConfig,
    private readonly runner: CommandRunner,
    private readonly delayFn: (ms: number) => Promise<void> = delay,
    private readonly slotNumber = 1,
    private readonly leaseRuntime: CapsuleLeaseRuntime = defaultCapsuleLeaseRuntime,
    private readonly leaseRenewer: CapsuleLeaseRenewer = renewCapsuleLease,
  ) {
    validateSlotNumber(slotNumber);
    if (slotNumber > config.capacity) {
      throw new CapsuleError(
        "invalid_slot_number",
        "IBKR capsule slot exceeds the configured host capacity.",
      );
    }
  }

  private get capsuleName(): string {
    return capsuleSlotName(this.slotNumber);
  }

  private get networkName(): string {
    return capsuleNetworkName(this.slotNumber);
  }

  ensure(
    sessionId: string,
    generation = 0,
    leaseGrant?: CapsuleLeaseGrant,
  ): Promise<CapsuleRecord> {
    const sessionHash = sessionHashForSession(sessionId);
    const fenceHash = fenceHashForSession(sessionId, generation);
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
    if (this.active?.fenceHash === fenceHash) {
      return this.ensureActive(sessionId, generation, fenceHash, leaseGrant);
    }
    if (this.pending?.fenceHash === fenceHash) {
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

    const promise = this.ensureAfterReconcile(
      sessionId,
      generation,
      sessionHash,
      fenceHash,
      leaseGrant,
    );
    this.pending = { fenceHash, promise };
    return promise;
  }

  private async ensureActive(
    sessionId: string,
    generation: number,
    fenceHash: string,
    leaseGrant?: CapsuleLeaseGrant,
  ): Promise<CapsuleRecord> {
    const active = this.active;
    if (!active || active.fenceHash !== fenceHash) {
      throw new CapsuleError(
        "capacity_exhausted",
        "The IBKR session host is already in use.",
      );
    }
    if (!leaseGrant) {
      if (active.lease) {
        throw new CapsuleError(
          "session_placement_conflict",
          "IBKR session placement conflicts with the current host slot.",
        );
      }
      return this.refreshActive(fenceHash);
    }
    if (!active.lease) {
      validateLeaseGrant(leaseGrant, this.leaseRuntime.nowNs());
      await this.release(sessionId, generation);
      return this.ensure(sessionId, generation, leaseGrant);
    }
    await this.keepalive(sessionId, generation, leaseGrant);
    return this.refreshActive(fenceHash);
  }

  async identityForSession(
    sessionId: string,
  ): Promise<{ generation: number } | null> {
    const sessionHash = sessionHashForSession(sessionId);
    if (this.poisoned) throw this.cleanupUnconfirmed();
    if (!this.active) await this.reconcile();
    return this.active?.sessionHash === sessionHash
      ? { generation: this.active.generation }
      : null;
  }

  async replace(
    sessionId: string,
    generation: number,
    leaseGrant?: CapsuleLeaseGrant,
  ): Promise<CapsuleRecord> {
    const sessionHash = sessionHashForSession(sessionId);
    const fenceHash = fenceHashForSession(sessionId, generation);
    if (this.poisoned) throw this.cleanupUnconfirmed();
    if (this.pending || this.releasing) {
      throw new CapsuleError(
        "capacity_exhausted",
        "The IBKR session host is already in use.",
      );
    }
    if (!this.active) await this.reconcile();
    if (!this.active) return this.ensure(sessionId, generation, leaseGrant);
    if (this.active.fenceHash === fenceHash) {
      return this.refreshActive(fenceHash);
    }
    if (this.active.sessionHash !== sessionHash) {
      throw new CapsuleError(
        "capacity_exhausted",
        "The IBKR session host is already in use.",
      );
    }
    if (this.active.generation > generation) {
      throw new CapsuleError(
        "stale_generation",
        "The IBKR session generation is stale.",
      );
    }
    await this.release(sessionId, this.active.generation);
    return this.ensure(sessionId, generation, leaseGrant);
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

  async status(
    sessionId: string,
    generation = 0,
  ): Promise<CapsuleRecord | null> {
    const fenceHash = fenceHashForSession(sessionId, generation);
    if (this.poisoned) {
      throw this.cleanupUnconfirmed();
    }
    if (this.releasing?.fenceHash === fenceHash) return null;
    if (this.pending?.fenceHash === fenceHash) {
      return this.pending.promise;
    }
    if (!this.active) {
      await this.reconcile();
    }
    if (
      this.active?.fenceHash === fenceHash &&
      this.active.lease &&
      !this.leaseIsCurrent(this.active)
    ) {
      return null;
    }
    return this.active?.fenceHash === fenceHash
      ? this.refreshActive(fenceHash)
      : null;
  }

  async keepalive(
    sessionId: string,
    generation: number,
    grant: CapsuleLeaseGrant,
  ): Promise<void> {
    const fenceHash = fenceHashForSession(sessionId, generation);
    const lease = validateLeaseGrant(grant, this.leaseRuntime.nowNs());
    if (this.poisoned) throw this.cleanupUnconfirmed();
    if (!this.active) await this.reconcile();
    const active = this.active;
    if (
      !active ||
      active.fenceHash !== fenceHash ||
      !active.lease ||
      !active.networkAddress ||
      this.releasing ||
      (active.lease.deadlineNs !== null && !this.leaseIsCurrent(active))
    ) {
      throw new CapsuleError("session_not_found", "IBKR session not found.");
    }

    let renewed = false;
    try {
      renewed = await this.leaseRenewer({
        controlKey: active.lease.controlKey,
        fenceHash: active.fenceHash,
        grant,
        host: active.networkAddress,
      });
    } catch {
      throw new CapsuleError(
        "lease_renewal_failed",
        "IBKR capsule lease renewal failed.",
      );
    }
    if (!renewed) {
      throw new CapsuleError(
        "lease_renewal_failed",
        "IBKR capsule lease renewal failed.",
      );
    }
    if (this.active !== active || this.releasing) {
      throw new CapsuleError("session_not_found", "IBKR session not found.");
    }
    const networkId = await this.ensureCapsuleNetwork();
    if (this.active !== active || this.releasing) {
      throw new CapsuleError("session_not_found", "IBKR session not found.");
    }
    const identity = await this.inspectOwnedCapsule(
      active.containerId,
      networkId,
    );
    if (
      this.active !== active ||
      this.releasing ||
      (active.lease.deadlineNs !== null && !this.leaseIsCurrent(active))
    ) {
      throw new CapsuleError("session_not_found", "IBKR session not found.");
    }
    if (
      identity?.status !== "current" ||
      identity.containerId !== active.containerId ||
      identity.fenceHash !== active.fenceHash ||
      identity.leaseControlKey !== active.lease.controlKey ||
      identity.leaseProtocol !== 1 ||
      !identity.running
    ) {
      throw this.cleanupUnconfirmed();
    }
    if (!this.armLease(active, lease.deadlineNs)) {
      throw new CapsuleError(
        "lease_renewal_failed",
        "IBKR capsule lease renewal failed.",
      );
    }
  }

  getTarget(
    sessionId: string,
    kind: CapsuleTargetKind,
    generation = 0,
  ): CapsuleTarget {
    const fenceHash = fenceHashForSession(sessionId, generation);
    if (
      this.poisoned ||
      this.releasing ||
      this.active?.fenceHash !== fenceHash ||
      !this.leaseIsCurrent(this.active)
    ) {
      throw new CapsuleError("session_not_found", "IBKR session not found.");
    }
    return capsuleTargetForSlot(this.slotNumber, kind);
  }

  getRelayTarget(kind: CapsuleTargetKind): CapsuleRelayTarget | null {
    return this.active?.networkAddress &&
      this.active.record.status === "ready" &&
      this.leaseIsCurrent(this.active) &&
      !this.poisoned &&
      !this.releasing
      ? { host: this.active.networkAddress, port: CAPSULE_INTERNAL_PORTS[kind] }
      : null;
  }

  release(sessionId: string, generation = 0): Promise<void> {
    let fenceHash: string;
    try {
      fenceHash = fenceHashForSession(sessionId, generation);
    } catch (error) {
      return Promise.reject(error);
    }
    if (this.poisoned) {
      return Promise.reject(this.cleanupUnconfirmed());
    }
    return this.beginRelease(fenceHash);
  }

  private beginRelease(fenceHash: string): Promise<void> {
    if (this.releasing?.fenceHash === fenceHash) {
      return this.releasing.promise;
    }
    if (this.releasing) {
      return Promise.reject(
        new CapsuleError("session_not_found", "IBKR session not found."),
      );
    }
    const promise = this.releaseActive(fenceHash);
    this.releasing = { fenceHash, promise };
    const clear = (): void => {
      if (this.releasing?.promise === promise) this.releasing = null;
    };
    void promise.then(clear, clear);
    return promise;
  }

  private leaseIsCurrent(active: NonNullable<typeof this.active>): boolean {
    if (!active.lease) return true;
    const deadlineNs = active.lease.deadlineNs;
    if (deadlineNs === null) return false;
    if (this.leaseRuntime.nowNs() < deadlineNs) return true;
    this.expireLease(active);
    return false;
  }

  private armLease(
    active: NonNullable<typeof this.active>,
    deadlineNs: bigint,
    expireOnFailure = true,
  ): boolean {
    if (!active.lease || this.active !== active) {
      throw new CapsuleError("session_not_found", "IBKR session not found.");
    }
    const nowNs = this.leaseRuntime.nowNs();
    const currentDeadlineNs = active.lease.deadlineNs;
    if (
      currentDeadlineNs !== null &&
      currentDeadlineNs >= deadlineNs &&
      active.lease.timer
    ) {
      if (nowNs < currentDeadlineNs) return true;
      if (expireOnFailure) this.expireLease(active);
      return false;
    }
    const effectiveDeadlineNs =
      currentDeadlineNs !== null && currentDeadlineNs > deadlineNs
        ? currentDeadlineNs
        : deadlineNs;
    if (active.lease.timer) this.leaseRuntime.clear(active.lease.timer);
    active.lease.deadlineNs = effectiveDeadlineNs;
    const remainingNs = effectiveDeadlineNs - nowNs;
    if (remainingNs <= 0n) {
      if (expireOnFailure) this.expireLease(active);
      return false;
    }
    const delayMs = Math.max(
      1,
      Math.min(Number((remainingNs + 999_999n) / 1_000_000n), 2_147_483_647),
    );
    active.lease.timer = this.leaseRuntime.schedule(() => {
      if (this.active !== active || !active.lease) return;
      active.lease.timer = null;
      if (this.leaseRuntime.nowNs() < effectiveDeadlineNs) {
        this.armLease(active, effectiveDeadlineNs);
        return;
      }
      this.expireLease(active);
    }, delayMs);
    return true;
  }

  private expireLease(active: NonNullable<typeof this.active>): void {
    if (this.active !== active || !active.lease) return;
    if (active.lease.timer) this.leaseRuntime.clear(active.lease.timer);
    active.lease.timer = null;
    active.lease.deadlineNs = 0n;
    active.networkAddress = null;
    active.record = { ...active.record, status: "occupied" };
    void this.beginRelease(active.fenceHash).catch(() => undefined);
  }

  private async releaseActive(fenceHash: string): Promise<void> {
    if (this.pending?.fenceHash === fenceHash) {
      await this.pending.promise;
    }
    if (!this.active) {
      await this.reconcile();
    }
    if (this.active?.fenceHash !== fenceHash) {
      throw new CapsuleError("session_not_found", "IBKR session not found.");
    }
    await this.removeActive(fenceHash);
  }

  private async removeActive(fenceHash: string): Promise<void> {
    const active = this.active;
    if (!active || active.fenceHash !== fenceHash) {
      throw new CapsuleError("session_not_found", "IBKR session not found.");
    }
    let removed: CommandResult;
    try {
      removed = await this.runner(this.config.dockerBinary, [
        "rm",
        "--force",
        active.containerId,
      ]);
    } catch {
      throw this.cleanupUnconfirmed();
    }
    if (removed.code !== 0) {
      throw this.cleanupUnconfirmed();
    }
    if (this.active !== active) {
      throw this.cleanupUnconfirmed();
    }
    if (active.lease?.timer) {
      this.leaseRuntime.clear(active.lease.timer);
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

  private async refreshActive(fenceHash: string): Promise<CapsuleRecord> {
    const active = this.active;
    if (!active || active.fenceHash !== fenceHash) {
      throw new CapsuleError(
        "capacity_exhausted",
        "The IBKR session host is already in use.",
      );
    }
    const probe = await this.probeCapsule(active.containerId);
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
        active.containerId,
        networkId,
      );
      if (this.active !== active) {
        throw new CapsuleError("session_not_found", "IBKR session not found.");
      }
      if (
        identity?.status !== "current" ||
        identity.containerId !== active.containerId ||
        identity.fenceHash !== active.fenceHash
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
        `name=^/${this.capsuleName}$`,
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
    if (names.length !== 1 || names[0] !== this.capsuleName) {
      throw this.cleanupUnconfirmed();
    }

    const networkId = await this.ensureCapsuleNetwork();

    const identity = await this.inspectOwnedCapsule(
      this.capsuleName,
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

    if (identity.leaseProtocol === 1 && !identity.running) {
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
      if (removed.code !== 0) throw this.cleanupUnconfirmed();
      this.reconciled = true;
      return null;
    }

    const probe = await this.probeCapsule(identity.containerId);
    const record: CapsuleRecord = {
      loginCompletions: probe.loginCompletions,
      name: this.capsuleName,
      status: probe.ready && identity.networkAddress ? "ready" : "occupied",
    };
    this.active = {
      containerId: identity.containerId,
      fenceHash: identity.fenceHash,
      generation: identity.generation,
      lease:
        identity.leaseProtocol === 1
          ? {
              controlKey: identity.leaseControlKey!,
              deadlineNs: null,
              timer: null,
            }
          : null,
      networkAddress: identity.networkAddress,
      sessionHash: identity.sessionHash,
      record,
    };
    this.reconciled = true;
    return record;
  }

  private async ensureAfterReconcile(
    sessionId: string,
    generation: number,
    sessionHash: string,
    fenceHash: string,
    leaseGrant?: CapsuleLeaseGrant,
  ): Promise<CapsuleRecord> {
    try {
      await this.reconcile();
      if (this.active) {
        if (this.active.fenceHash === fenceHash) {
          if (!leaseGrant) {
            if (this.active.lease) {
              throw new CapsuleError(
                "session_placement_conflict",
                "IBKR session placement conflicts with the current host slot.",
              );
            }
            return this.active.record;
          }
          if (this.active.lease) {
            await this.keepalive(sessionId, generation, leaseGrant);
            return this.refreshActive(fenceHash);
          }
          validateLeaseGrant(leaseGrant, this.leaseRuntime.nowNs());
          await this.removeActive(fenceHash);
        } else {
          throw new CapsuleError(
            "capacity_exhausted",
            "The IBKR session host is already in use.",
          );
        }
      }
      return await this.provision(
        sessionId,
        generation,
        sessionHash,
        fenceHash,
        leaseGrant,
      );
    } finally {
      if (this.pending?.fenceHash === fenceHash) {
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
    const state =
      inspected.code === 0 ? parseJsonRecord(inspected.stdout) : null;
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
    generation: number,
    sessionHash: string,
    fenceHash: string,
    leaseGrant?: CapsuleLeaseGrant,
  ): Promise<CapsuleRecord> {
    const name = capsuleNameForSession(sessionId, this.slotNumber);
    const lease = leaseGrant
      ? validateLeaseGrant(leaseGrant, this.leaseRuntime.nowNs())
      : null;
    let created = false;
    try {
      const networkId = await this.ensureCapsuleNetwork(true);
      await runChecked(
        this.runner,
        buildCreateCapsuleInvocation(
          this.config,
          sessionId,
          this.slotNumber,
          generation,
          leaseGrant,
        ),
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
        identity.sessionHash !== sessionHash ||
        identity.fenceHash !== fenceHash ||
        identity.leaseProtocol !== (leaseGrant ? 1 : null)
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
        containerId: identity.containerId,
        fenceHash: identity.fenceHash,
        generation: identity.generation,
        lease: lease
          ? {
              controlKey: identity.leaseControlKey!,
              deadlineNs: lease.deadlineNs,
              timer: null,
            }
          : null,
        networkAddress: identity.networkAddress,
        sessionHash: identity.sessionHash,
        record,
      };
      if (lease && !this.armLease(this.active, lease.deadlineNs, false)) {
        throw new CapsuleError(
          "lease_grant_expired",
          "IBKR capsule lease grant has expired.",
        );
      }
      return record;
    } catch (error) {
      if (created) {
        const failedActive =
          this.active?.fenceHash === fenceHash ? this.active : null;
        if (failedActive?.lease?.timer) {
          this.leaseRuntime.clear(failedActive.lease.timer);
        }
        if (failedActive) this.active = null;
        let cleaned = false;
        try {
          const result = await this.runner(this.config.dockerBinary, [
            "rm",
            "--force",
            failedActive?.containerId ?? name,
          ]);
          cleaned = result.code === 0;
        } catch {
          cleaned = false;
        }
        if (!cleaned) {
          throw this.cleanupUnconfirmed();
        }
        this.reconciled = true;
      }
      throw error;
    }
  }

  private async inspectCapsuleNetwork(): Promise<
    { status: "missing" | "invalid" } | { status: "valid"; networkId: string }
  > {
    let inspected: CommandResult;
    try {
      inspected = await this.runner(this.config.dockerBinary, [
        "network",
        "inspect",
        "--format",
        "{{json .}}",
        this.networkName,
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
      network?.["Name"] === this.networkName &&
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
    const environment = Array.isArray(containerConfig?.["Env"])
      ? containerConfig["Env"].filter(
          (entry): entry is string => typeof entry === "string",
        )
      : [];
    const hostConfig = asRecord(container?.["HostConfig"]);
    const networks = asRecord(
      asRecord(container?.["NetworkSettings"])?.["Networks"],
    );
    const ports = asRecord(container?.["NetworkSettings"])?.["Ports"];
    const networkNames = networks ? Object.keys(networks) : [];
    const endpoint = asRecord(networks?.[this.networkName]);
    const state = asRecord(container?.["State"]);
    const entrypoint = Array.isArray(containerConfig?.["Entrypoint"])
      ? containerConfig["Entrypoint"]
      : [];
    const sessionHash = labels?.["pyrus.ibkr.session_hash"];
    const rawFenceHash = labels?.["pyrus.ibkr.fence_hash"];
    const rawGeneration = labels?.["pyrus.ibkr.generation"];
    const rawSlotNumber = labels?.["pyrus.ibkr.slot"];
    const rawLeaseProtocol = labels?.["pyrus.ibkr.lease_protocol"];
    const legacyIdentity =
      rawFenceHash === undefined &&
      rawGeneration === undefined &&
      rawSlotNumber === undefined;
    const generation = legacyIdentity ? 0 : Number(rawGeneration);
    const slotNumber = legacyIdentity ? this.slotNumber : Number(rawSlotNumber);
    const fenceHash = legacyIdentity ? sessionHash : rawFenceHash;
    const generationIsValid =
      Number.isSafeInteger(generation) &&
      generation >= 0 &&
      generation <= 2_147_483_647 &&
      String(generation) === rawGeneration;
    const slotNumberIsValid =
      Number.isInteger(slotNumber) &&
      slotNumber === this.slotNumber &&
      String(slotNumber) === rawSlotNumber;
    const leaseProtocol: 1 | null = rawLeaseProtocol === undefined ? null : 1;
    const image = containerConfig?.["Image"];
    const rawContainerId = container?.["Id"];
    const containerId =
      typeof rawContainerId === "string" &&
      DOCKER_ID_PATTERN.test(rawContainerId)
        ? rawContainerId
        : leaseProtocol === null
          ? name
          : null;
    const environmentValue = (name: string): string | null => {
      const prefix = `${name}=`;
      const matches = environment.filter((entry) => entry.startsWith(prefix));
      return matches.length === 1 ? matches[0]!.slice(prefix.length) : null;
    };
    const leaseGrantNotAfterNs = environmentValue(
      "PYRUS_IBKR_CAPSULE_LEASE_GRANT_NOT_AFTER_NS",
    );
    const leaseControlKey = environmentValue(
      "PYRUS_IBKR_CAPSULE_LEASE_CONTROL_KEY",
    );
    const securityOptions = hostConfig?.["SecurityOpt"];
    const securityOptionsAreValid = await hasExactSeccompSecurityOptions(
      securityOptions,
      this.config.seccompProfilePath,
    );
    const tmpfs = asRecord(hostConfig?.["Tmpfs"]);
    const tmpfsNames = tmpfs ? Object.keys(tmpfs).sort() : [];
    const ulimits = Array.isArray(hostConfig?.["Ulimits"])
      ? hostConfig["Ulimits"]
      : [];
    const exactUlimit = (
      index: number,
      name: string,
      soft: number,
      hard: number,
    ): boolean => {
      const value = asRecord(ulimits[index]);
      return (
        value?.["Name"] === name &&
        value["Soft"] === soft &&
        value["Hard"] === hard
      );
    };
    const supervisorRuntimeConfigurationIsValid =
      entrypoint.length === 1 &&
      entrypoint[0] === "/usr/local/bin/pyrus-capsule-supervisor.py" &&
      containerConfig?.["StopTimeout"] === 30 &&
      containerConfig?.["User"] === "0:0" &&
      isEmptyRecordOrNull(containerConfig?.["Volumes"]) &&
      hostConfig?.["Privileged"] === false &&
      hostConfig["ReadonlyRootfs"] === true &&
      hasExactStringSet(hostConfig["CapAdd"], [
        "KILL",
        "NET_ADMIN",
        "SETGID",
        "SETPCAP",
        "SETUID",
      ]) &&
      hasExactStringSet(hostConfig["CapDrop"], ["ALL"]) &&
      securityOptionsAreValid &&
      hostConfig["CgroupnsMode"] === "private" &&
      hostConfig["IpcMode"] === "private" &&
      hostConfig["PidMode"] === "" &&
      isEmptyArrayOrNull(hostConfig["Binds"]) &&
      isEmptyArrayOrNull(hostConfig["Mounts"]) &&
      isEmptyArrayOrNull(hostConfig["VolumesFrom"]) &&
      isEmptyArrayOrNull(hostConfig["Devices"]) &&
      isEmptyArrayOrNull(hostConfig["DeviceRequests"]) &&
      isEmptyArrayOrNull(hostConfig["DeviceCgroupRules"]) &&
      isEmptyArrayOrNull(container?.["Mounts"]) &&
      tmpfsNames.length === 2 &&
      tmpfsNames[0] === "/run/pyrus" &&
      tmpfsNames[1] === "/tmp" &&
      tmpfs?.["/run/pyrus"] ===
        (leaseProtocol === null
          ? "rw,noexec,nosuid,nodev,size=512m,mode=0700,uid=10001,gid=10001"
          : "rw,noexec,nosuid,nodev,size=512m,mode=0710,uid=10001,gid=0") &&
      tmpfs?.["/tmp"] === "rw,noexec,nosuid,nodev,size=256m,mode=1777" &&
      hostConfig["Memory"] === 2_147_483_648 &&
      hostConfig["MemorySwap"] === 2_147_483_648 &&
      hostConfig["NanoCpus"] === 1_000_000_000 &&
      hostConfig["PidsLimit"] === 512 &&
      hostConfig["ShmSize"] === 536_870_912 &&
      ulimits.length === 2 &&
      exactUlimit(0, "core", 0, 0) &&
      exactUlimit(1, "nofile", 4096, 4096) &&
      hostConfig["PublishAllPorts"] === false &&
      hostConfig?.["Init"] !== true;
    const leaseConfigurationIsValid =
      leaseProtocol === null
        ? supervisorRuntimeConfigurationIsValid &&
          rawLeaseProtocol === undefined &&
          [
            "PYRUS_IBKR_CAPSULE_LEASE_VERSION",
            "PYRUS_IBKR_CAPSULE_LEASE_BOOT_ID",
            "PYRUS_IBKR_CAPSULE_LEASE_FENCE_HASH",
            "PYRUS_IBKR_CAPSULE_LEASE_CONTROL_ATTEMPT_ID",
            "PYRUS_IBKR_CAPSULE_LEASE_GRANT_NOT_AFTER_NS",
            "PYRUS_IBKR_CAPSULE_LEASE_CONTROL_KEY",
          ].every((name) => environmentValue(name) === null) &&
          asRecord(hostConfig?.["RestartPolicy"])?.["Name"] === "on-failure"
        : rawLeaseProtocol === String(CAPSULE_LEASE_PROTOCOL_VERSION) &&
          supervisorRuntimeConfigurationIsValid &&
          environmentValue("PYRUS_IBKR_CAPSULE_LEASE_VERSION") ===
            String(CAPSULE_LEASE_PROTOCOL_VERSION) &&
          BOOT_ID_PATTERN.test(
            environmentValue("PYRUS_IBKR_CAPSULE_LEASE_BOOT_ID") ?? "",
          ) &&
          environmentValue("PYRUS_IBKR_CAPSULE_LEASE_FENCE_HASH") ===
            fenceHash &&
          UUID_PATTERN.test(
            environmentValue("PYRUS_IBKR_CAPSULE_LEASE_CONTROL_ATTEMPT_ID") ??
              "",
          ) &&
          MONOTONIC_NS_PATTERN.test(leaseGrantNotAfterNs ?? "") &&
          CAPSULE_LEASE_CONTROL_KEY_PATTERN.test(leaseControlKey ?? "") &&
          asRecord(hostConfig?.["RestartPolicy"])?.["Name"] === "no";
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
      typeof fenceHash === "string" &&
      SESSION_HASH_PATTERN.test(fenceHash) &&
      (legacyIdentity || (generationIsValid && slotNumberIsValid)) &&
      typeof containerId === "string" &&
      leaseConfigurationIsValid &&
      hostConfig?.["NetworkMode"] === this.networkName &&
      isEmptyRecordOrNull(hostConfig["PortBindings"]) &&
      networkNames.length === 1 &&
      networkNames[0] === this.networkName &&
      endpoint?.["NetworkID"] === networkId &&
      isEmptyRecordOrNull(ports) &&
      networkAddress !== undefined;
    if (!ownedAndIsolated) return null;
    if (image === this.config.capsuleImage) {
      return {
        containerId,
        fenceHash,
        generation,
        leaseControlKey,
        leaseProtocol,
        running: state?.["Running"] === true,
        status: "current",
        networkAddress,
        sessionHash,
        slotNumber,
      };
    }
    return typeof rawContainerId === "string" &&
      DOCKER_ID_PATTERN.test(rawContainerId) &&
      typeof image === "string" &&
      (LOCAL_IMAGE_ID_PATTERN.test(image) || DIGEST_IMAGE_PATTERN.test(image))
      ? { status: "stale_image", containerId: rawContainerId }
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
          args: ["network", "rm", this.networkName],
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
        this.networkName,
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
