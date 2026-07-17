import {
  spawn,
  spawnSync,
  type ChildProcess,
} from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { request as httpRequest } from "node:http";
import path from "node:path";
import { z } from "zod";

import {
  decodeIbkrHostControlKey,
  signIbkrHostControlRequest,
} from "@workspace/ibkr-contracts/control-auth";
import type { IbkrGatewayLifecycleState } from "@workspace/db";

import { HttpError } from "../lib/errors";
import {
  type IbkrGatewayFence,
  releaseIbkrGatewayLease,
  transitionIbkrGatewayLifecycle as transitionDurableIbkrGatewayLifecycle,
} from "./ibkr-gateway-session-store";
import {
  acknowledgeIbkrGatewayFleetControl,
  ensureIbkrGatewayFleetFence,
  isIbkrGatewayFleetEnabled,
  normalizeIbkrGatewayPath,
  prepareIbkrGatewayFleetDataRequest,
  readIbkrGatewayFleetFence,
  renewIbkrGatewayFleetFence,
  requestIbkrGatewayFleetHost,
} from "./ibkr-gateway-fleet-runtime";
import { findRepoRoot } from "./runtime-flight-recorder";

// Self-hosted IBKR Client Portal Gateway (CPAPI) pool. Each connected app user
// gets a dedicated gateway process (CPG holds exactly one authenticated IBKR
// session per instance), so we run one JVM per user on its own port. This is
// the "no IBKR OAuth vendor approval" bridge — the user logs in through a
// browser session proxied by our API; we only keep the session alive.

// Default lives inside the (gitignored) workspace so it survives Replit
// container resets, which rebuild /home/runner outside the workspace.
const PORTAL_HOME = process.env["IBKR_PORTAL_HOME"]
  ? path.resolve(process.env["IBKR_PORTAL_HOME"])
  : path.join(findRepoRoot(), ".pyrus-runtime", "ibkr-cpg");
const PORTABLE_JAVA = path.join(PORTAL_HOME, "jre", "bin", "java");
const GW_DIR =
  process.env["IBKR_PORTAL_GW_DIR"] ?? path.join(PORTAL_HOME, "gw");

// Resolve the java binary durably: explicit override -> portable JRE staged
// under PORTAL_HOME -> `java` from PATH (e.g. provided by replit.nix after a
// container rebuild). Cached so we probe PATH at most once.
let cachedJavaBin: string | null | undefined;
function resolveJavaBin(): string | null {
  if (cachedJavaBin !== undefined) return cachedJavaBin;
  const override = process.env["IBKR_PORTAL_JAVA_BIN"];
  if (override && existsSync(override)) return (cachedJavaBin = override);
  if (existsSync(PORTABLE_JAVA)) return (cachedJavaBin = PORTABLE_JAVA);
  const probe = spawnSync("java", ["-version"], { stdio: "ignore" });
  cachedJavaBin = probe.status === 0 ? "java" : null;
  return cachedJavaBin;
}
const INSTANCES_DIR = path.join(PORTAL_HOME, "instances");
const BASE_PORT = Number(process.env["IBKR_PORTAL_BASE_PORT"] ?? "5200");
const MAX_GATEWAYS = Number(process.env["IBKR_PORTAL_MAX_GATEWAYS"] ?? "4");
const READY_TIMEOUT_MS = 60_000;
const GATEWAY_JAR = path.join(
  GW_DIR,
  "dist",
  "ibgroup.web.core.iblink.router.clientportal.gw.jar",
);

export type PortalGateway = {
  appUserId: string;
  baseUrl: string;
  hosted: boolean;
  loginCompletions: number;
  origin: string;
  paperAccountVerified: boolean;
  port: number;
  proxyOrigin: string;
  proxyPort: number;
  recovered: boolean;
  status: "starting" | "ready" | "stopped";
  startedAt: number;
};

type Entry = PortalGateway & {
  fleetFence?: IbkrGatewayFence;
  lifecycleTransitionConflictEpoch?: number;
  lifecycleTransitionEpoch?: number;
  lifecycleTransitionTarget?: IbkrGatewayLifecycleState;
  process?: ChildProcess;
};

const gateways = new Map<string, Entry>();
const gatewayEpochs = new Map<string, number>();
const hostedEnsureRequests = new Map<string, Set<Promise<unknown>>>();
const hostedStatusRequests = new Map<
  string,
  { epoch: number; request: Promise<HostStatusResponse | null> }
>();
const hostedStops = new Map<string, Promise<void>>();
const fleetEnsureRequests = new Map<string, Promise<PortalGateway>>();
const fleetLeaseTimers = new Map<string, ReturnType<typeof setInterval>>();
const FLEET_LEASE_RENEW_INTERVAL_MS = 10_000;

function sameFleetFence(
  left: IbkrGatewayFence | undefined,
  right: IbkrGatewayFence,
): boolean {
  return Boolean(
    left &&
      left.appUserId === right.appUserId &&
      left.brokerConnectionId === right.brokerConnectionId &&
      left.generation === right.generation &&
      left.hostId === right.hostId &&
      left.leaseHolderId === right.leaseHolderId &&
      left.sessionId === right.sessionId &&
      left.slotNumber === right.slotNumber,
  );
}

function gatewayEpoch(appUserId: string): number {
  return gatewayEpochs.get(appUserId) ?? 0;
}

function bumpGatewayEpoch(appUserId: string): void {
  gatewayEpochs.set(appUserId, gatewayEpoch(appUserId) + 1);
}

function stopFleetLeaseKeepalive(appUserId: string): void {
  const timer = fleetLeaseTimers.get(appUserId);
  if (!timer) return;
  clearInterval(timer);
  fleetLeaseTimers.delete(appUserId);
}

function startFleetLeaseKeepalive(appUserId: string, entry: Entry): void {
  stopFleetLeaseKeepalive(appUserId);
  let renewing = false;
  const timer = setInterval(() => {
    if (renewing || gateways.get(appUserId) !== entry || !entry.fleetFence) {
      return;
    }
    renewing = true;
    void renewIbkrGatewayFleetFence(entry.fleetFence)
      .then((fence) => {
        if (gateways.get(appUserId) === entry) entry.fleetFence = fence;
      })
      .catch((error: unknown) => {
        if (
          error instanceof HttpError &&
          error.code === "ibkr_gateway_fence_stale" &&
          gateways.get(appUserId) === entry
        ) {
          entry.status = "stopped";
          gateways.delete(appUserId);
          stopFleetLeaseKeepalive(appUserId);
        }
      })
      .finally(() => {
        renewing = false;
      });
  }, FLEET_LEASE_RENEW_INTERVAL_MS);
  timer.unref?.();
  fleetLeaseTimers.set(appUserId, timer);
}

type HostedConfig = {
  auth:
    | { kind: "bearer"; token: string }
    | { hostId: string; key: Buffer; kind: "signed" };
  baseUrl: string;
};

const HOST_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function hostedConfig(): HostedConfig | null {
  if (process.env["IBKR_SESSION_HOST_ENABLED"] !== "1") return null;
  const token = process.env["IBKR_SESSION_HOST_CONTROL_TOKEN"]?.trim();
  const hostId = process.env["IBKR_SESSION_HOST_ID"]?.trim();
  const encodedKey = process.env["IBKR_SESSION_HOST_CONTROL_KEY"]?.trim();
  const key = encodedKey ? decodeIbkrHostControlKey(encodedKey) : null;
  const signed = Boolean(hostId || encodedKey);
  const rawUrl =
    process.env["IBKR_SESSION_HOST_URL"]?.trim() ??
    "http://127.0.0.1:18748";
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new HttpError(503, "The IBKR session host configuration is invalid.", {
      code: "ibkr_session_host_config_invalid",
      expose: true,
    });
  }
  if (
    (!signed && !token) ||
    (signed && (!hostId || !HOST_ID_PATTERN.test(hostId) || !key)) ||
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new HttpError(503, "The IBKR session host configuration is invalid.", {
      code: "ibkr_session_host_config_invalid",
      expose: true,
    });
  }
  return {
    auth: signed
      ? { hostId: hostId!, key: key!, kind: "signed" }
      : { kind: "bearer", token: token! },
    baseUrl: url.origin,
  };
}

export function isPortalRuntimeAvailable(): boolean {
  if (isIbkrGatewayFleetEnabled()) return true;
  if (hostedConfig()) return true;
  return resolveJavaBin() !== null && existsSync(GATEWAY_JAR);
}

function toPublic(entry: Entry): PortalGateway {
  const {
    fleetFence: _fleetFence,
    lifecycleTransitionConflictEpoch: _lifecycleTransitionConflictEpoch,
    lifecycleTransitionEpoch: _lifecycleTransitionEpoch,
    lifecycleTransitionTarget: _lifecycleTransitionTarget,
    process: _process,
    ...rest
  } = entry;
  return { ...rest };
}

function isAlive(entry: Entry): boolean {
  return (
    entry.status !== "stopped" &&
    (entry.hosted || entry.process?.exitCode === null)
  );
}

function allocatePort(): number {
  const used = new Set(
    [...gateways.values()].filter(isAlive).map((g) => g.port),
  );
  for (let i = 0; i < MAX_GATEWAYS; i += 1) {
    const candidate = BASE_PORT + i;
    if (!used.has(candidate)) {
      return candidate;
    }
  }
  throw new HttpError(
    503,
    "All IBKR Client Portal connection slots are in use.",
    {
      code: "ibkr_portal_pool_exhausted",
      detail: `The gateway pool is capped at ${MAX_GATEWAYS} concurrent connections.`,
      expose: true,
    },
  );
}

function instanceDir(appUserId: string): string {
  const slug = appUserId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(INSTANCES_DIR, slug);
}

function setupInstance(appUserId: string, port: number): string {
  const dir = instanceDir(appUserId);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  cpSync(path.join(GW_DIR, "root"), path.join(dir, "root"), {
    recursive: true,
  });
  const confPath = path.join(dir, "root", "conf.yaml");
  // Serve plain HTTP on loopback: the gateway is 127.0.0.1-only and reached by
  // the browser through our TLS-terminating proxy, so a self-signed listener
  // would just break the server-side IbkrClient (global fetch can't skip TLS
  // verification without an undici dispatcher).
  const conf = readFileSync(confPath, "utf8")
    .replace(/listenPort:\s*\d+/, `listenPort: ${port}`)
    .replace(/listenSsl:\s*true/, "listenSsl: false");
  writeFileSync(confPath, conf);
  return dir;
}

function spawnGateway(dir: string, port: number): ChildProcess {
  void port;
  const classpath = [
    "root",
    GATEWAY_JAR,
    path.join(GW_DIR, "build", "lib", "runtime", "*"),
  ].join(":");
  return spawn(
    resolveJavaBin() ?? "java",
    [
      "-server",
      "-Dvertx.disableDnsResolver=true",
      "-Djava.net.preferIPv4Stack=true",
      "-Dvertx.logger-delegate-factory-class-name=io.vertx.core.logging.SLF4JLogDelegateFactory",
      "-Dnologback.statusListenerClass=ch.qos.logback.core.status.OnConsoleStatusListener",
      "-Dnolog4j.debug=true",
      "-Dnolog4j2.debug=true",
      "-cp",
      classpath,
      "ibgroup.web.core.clientportal.gw.GatewayStart",
      // GatewayStart resolves --conf relative to the classpath config dir
      // (`root`), so `../root/conf.yaml` -> `root/conf.yaml`. Passing
      // `root/conf.yaml` directly resolves to `root/root/conf.yaml` and fails.
      "--conf",
      "../root/conf.yaml",
    ],
    { cwd: dir, stdio: "ignore", detached: false },
  );
}

function probe(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port,
        path: "/",
        method: "GET",
        timeout: 3000,
      },
      (res) => {
        res.resume();
        resolve(true);
      },
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

async function waitForReady(port: number): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await probe(port)) {
      return;
    }
    await delay(1000);
  }
  throw new HttpError(
    504,
    "IBKR Client Portal gateway did not start in time.",
    { code: "ibkr_portal_gateway_timeout", expose: true },
  );
}

const HostCapsuleSchema = z.object({
  loginCompletions: z.number().int().min(0).max(1_000).default(0),
  name: z.string().min(1).max(128),
  status: z.enum(["ready", "occupied"]),
});
const HOSTED_TARGETS = {
  cpg: { host: "127.0.0.1", port: 15000 },
  console: { host: "127.0.0.1", port: 16080 },
} as const;
const HostTargetsSchema = z.object({
  cpg: z.object({
    host: z.literal("127.0.0.1"),
    port: z.number().int().min(1).max(65_535),
  }),
  console: z.object({
    host: z.literal("127.0.0.1"),
    port: z.number().int().min(1).max(65_535),
  }),
});
const HostEnsureResponseSchema = z.object({
  capsule: HostCapsuleSchema,
  targets: HostTargetsSchema,
});
const HostStatusResponseSchema = z.object({
  capsule: HostCapsuleSchema.nullable(),
  targets: HostTargetsSchema.optional(),
});
const FleetHostEnsureResponseSchema = HostEnsureResponseSchema.extend({
  sessionId: z.string().uuid(),
  generation: z.number().int().min(0).max(2_147_483_647),
  slotNumber: z.number().int().min(1).max(20),
}).strict();
const FleetHostStatusResponseSchema = HostStatusResponseSchema.extend({
  sessionId: z.string().uuid(),
  generation: z.number().int().min(0).max(2_147_483_647),
  slotNumber: z.number().int().min(1).max(20),
}).strict();
const HostReleaseResponseSchema = z
  .object({
    sessionId: z.string().uuid(),
    generation: z.number().int().min(0).max(2_147_483_647),
    slotNumber: z.number().int().min(1).max(20),
    released: z.literal(true),
  })
  .strict();

type HostEnsureResponse = z.infer<typeof HostEnsureResponseSchema>;
type HostStatusResponse = z.infer<typeof HostStatusResponseSchema>;

function invalidHostResponse(): HttpError {
  return new HttpError(
    502,
    "The IBKR session host returned an invalid response.",
    {
      code: "ibkr_session_host_response_invalid",
      expose: false,
    },
  );
}

function parseHostResponse<T extends z.ZodType>(
  schema: T,
  value: unknown,
): z.output<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw invalidHostResponse();
  }
  return parsed.data;
}

function assertMatchingFleetResponse(
  response: { generation: number; sessionId: string; slotNumber: number },
  fence: IbkrGatewayFence,
): void {
  if (
    response.sessionId !== fence.sessionId ||
    response.generation !== fence.generation ||
    response.slotNumber !== fence.slotNumber
  ) {
    throw invalidHostResponse();
  }
}

async function hostRequest<T>(
  path: string,
  method: "GET" | "POST",
): Promise<T> {
  const config = hostedConfig();
  if (!config) {
    throw new HttpError(503, "The IBKR session host is not configured.", {
      code: "ibkr_session_host_not_configured",
      expose: true,
    });
  }
  const response = await fetch(`${config.baseUrl}${path}`, {
    method,
    headers:
      config.auth.kind === "signed"
        ? signIbkrHostControlRequest({
            hostId: config.auth.hostId,
            key: config.auth.key,
            method,
            path,
          })
        : { authorization: `Bearer ${config.auth.token}` },
  });
  if (!response.ok) {
    throw new HttpError(
      response.status,
      "The IBKR session host control request failed.",
      { code: "ibkr_session_host_control_failed", expose: true },
    );
  }
  return (await response.json()) as T;
}

export async function prepareGatewayDataRequest(input: {
  appUserId: string;
  body?: string | Uint8Array;
  headers: Record<string, string | string[] | undefined>;
  kind: "cpg" | "console";
  method: string;
  path: string;
  transport: "http" | "websocket";
}): Promise<{
  headers: Record<string, string | string[]>;
  url: URL;
}> {
  const entry = gateways.get(input.appUserId);
  if (!entry || !isAlive(entry)) {
    throw new HttpError(503, "IBKR Client Portal gateway is not running.", {
      code: "ibkr_portal_gateway_not_running",
      expose: true,
    });
  }
  const upstreamPath = normalizeIbkrGatewayPath(input.path);
  const headers = Object.fromEntries(
    Object.entries(input.headers).filter(
      (entry): entry is [string, string | string[]] => entry[1] !== undefined,
    ),
  );
  if (entry.fleetFence) {
    const prepared = await prepareIbkrGatewayFleetDataRequest({
        body: input.body,
        fence: entry.fleetFence,
        headers,
        kind: input.kind,
        method: input.method,
        path: upstreamPath,
        transport: input.transport,
      }).catch((error: unknown) => {
        if (
          error instanceof HttpError &&
          error.code === "ibkr_gateway_fence_stale" &&
          gateways.get(input.appUserId) === entry
        ) {
          entry.status = "stopped";
          gateways.delete(input.appUserId);
          stopFleetLeaseKeepalive(input.appUserId);
        }
        throw error;
      });
    if (gateways.get(input.appUserId) !== entry) {
      throw new HttpError(409, "The IBKR gateway request was cancelled.", {
        code: "ibkr_portal_request_cancelled",
        expose: true,
      });
    }
    entry.fleetFence = prepared.fence;
    return { headers: prepared.headers, url: prepared.url };
  }
  const url = new URL(
    upstreamPath,
    input.kind === "cpg" ? entry.origin : entry.proxyOrigin,
  );
  if (input.transport === "websocket") {
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  }
  headers.host = url.host;
  return { headers, url };
}

export async function prepareGatewayClientRequest(
  appUserId: string,
  request: {
    body: string | Uint8Array | undefined;
    headers: Record<string, string>;
    method: string;
    transport: "http" | "websocket";
    url: string;
  },
): Promise<{ headers: Record<string, string>; url: string }> {
  const logicalUrl = new URL(request.url);
  const prepared = await prepareGatewayDataRequest({
    appUserId,
    body: request.body,
    headers: request.headers,
    kind: "cpg",
    method: request.method,
    path: `${logicalUrl.pathname}${logicalUrl.search}`,
    transport: request.transport,
  });
  return {
    headers: Object.fromEntries(
      Object.entries(prepared.headers).map(([name, value]) => [
        name,
        Array.isArray(value) ? value.join(", ") : value,
      ]),
    ),
    url: prepared.url.toString(),
  };
}

export async function validateGatewayDataFence(appUserId: string): Promise<void> {
  const entry = gateways.get(appUserId);
  if (!entry || !isAlive(entry)) {
    throw new HttpError(503, "IBKR Client Portal gateway is not running.", {
      code: "ibkr_portal_gateway_not_running",
      expose: true,
    });
  }
  if (!entry.fleetFence) return;
  const fence = await renewIbkrGatewayFleetFence(entry.fleetFence).catch(
    (error: unknown) => {
      if (
        error instanceof HttpError &&
        error.code === "ibkr_gateway_fence_stale" &&
        gateways.get(appUserId) === entry
      ) {
        entry.status = "stopped";
        gateways.delete(appUserId);
        stopFleetLeaseKeepalive(appUserId);
      }
      throw error;
    },
  );
  if (gateways.get(appUserId) !== entry) {
    throw new HttpError(409, "The IBKR gateway request was cancelled.", {
      code: "ibkr_portal_request_cancelled",
      expose: true,
    });
  }
  entry.fleetFence = fence;
}

async function requestHostedGatewayStatus(
  appUserId: string,
): Promise<HostStatusResponse | null> {
  try {
    return parseHostResponse(
      HostStatusResponseSchema,
      await hostRequest<unknown>(
        `/sessions/${encodeURIComponent(appUserId)}/status`,
        "GET",
      ),
    );
  } catch (error) {
    if (error instanceof HttpError && error.statusCode === 404) {
      return null;
    }
    throw error;
  }
}

function readHostedGatewayStatus(
  appUserId: string,
): Promise<HostStatusResponse | null> {
  const epoch = gatewayEpoch(appUserId);
  const existing = hostedStatusRequests.get(appUserId);
  if (existing?.epoch === epoch) return existing.request;
  const request = requestHostedGatewayStatus(appUserId);
  hostedStatusRequests.set(appUserId, { epoch, request });
  const clear = (): void => {
    if (hostedStatusRequests.get(appUserId)?.request === request) {
      hostedStatusRequests.delete(appUserId);
    }
  };
  void request.then(clear, clear);
  return request;
}

async function releaseHostedGateway(appUserId: string): Promise<void> {
  try {
    await hostRequest<unknown>(
      `/sessions/${encodeURIComponent(appUserId)}/release`,
      "POST",
    );
  } catch (error) {
    if (error instanceof HttpError && error.statusCode === 404) {
      return;
    }
    throw error;
  }
}

function rememberHostedGateway(
  appUserId: string,
  result: HostEnsureResponse,
  recovered: boolean,
): PortalGateway {
  const existing = gateways.get(appUserId);
  if (existing?.hosted && isAlive(existing)) {
    existing.recovered = existing.recovered && recovered;
    return updateHostedGateway(existing, result.capsule);
  }
  const entry: Entry = {
    appUserId,
    baseUrl: `http://${result.targets.cpg.host}:${result.targets.cpg.port}/v1/api`,
    hosted: true,
    loginCompletions: result.capsule.loginCompletions,
    origin: `http://${result.targets.cpg.host}:${result.targets.cpg.port}`,
    paperAccountVerified: false,
    port: result.targets.cpg.port,
    proxyOrigin: `http://${result.targets.console.host}:${result.targets.console.port}`,
    proxyPort: result.targets.console.port,
    recovered,
    status: result.capsule.status === "ready" ? "ready" : "starting",
    startedAt: Date.now(),
  };
  gateways.set(appUserId, entry);
  return toPublic(entry);
}

function rememberFleetGateway(
  appUserId: string,
  fence: IbkrGatewayFence,
  result: HostEnsureResponse,
  recovered: boolean,
): PortalGateway {
  const existing = gateways.get(appUserId);
  if (existing?.fleetFence && isAlive(existing)) {
    existing.fleetFence = fence;
    existing.recovered = existing.recovered && recovered;
    startFleetLeaseKeepalive(appUserId, existing);
    return updateHostedGateway(existing, result.capsule);
  }
  const entry: Entry = {
    appUserId,
    baseUrl: `http://${result.targets.cpg.host}:${result.targets.cpg.port}/v1/api`,
    fleetFence: fence,
    hosted: true,
    loginCompletions: result.capsule.loginCompletions,
    origin: `http://${result.targets.cpg.host}:${result.targets.cpg.port}`,
    paperAccountVerified: false,
    port: result.targets.cpg.port,
    proxyOrigin: `http://${result.targets.console.host}:${result.targets.console.port}`,
    proxyPort: result.targets.console.port,
    recovered,
    status: result.capsule.status === "ready" ? "ready" : "starting",
    startedAt: Date.now(),
  };
  gateways.set(appUserId, entry);
  startFleetLeaseKeepalive(appUserId, entry);
  return toPublic(entry);
}

function updateHostedGateway(
  entry: Entry,
  capsule: NonNullable<HostStatusResponse["capsule"]>,
): PortalGateway {
  entry.status = capsule.status === "ready" ? "ready" : "starting";
  entry.loginCompletions = Math.max(
    entry.loginCompletions,
    capsule.loginCompletions,
  );
  if (entry.status !== "ready") {
    entry.paperAccountVerified = false;
  }
  return toPublic(entry);
}

async function ensureHostedGateway(appUserId: string): Promise<PortalGateway> {
  const stopping = hostedStops.get(appUserId);
  if (stopping) await stopping;
  const epoch = gatewayEpoch(appUserId);
  const request = hostRequest<unknown>(
    `/sessions/${encodeURIComponent(appUserId)}/ensure`,
    "POST",
  );
  const pending = hostedEnsureRequests.get(appUserId) ?? new Set();
  pending.add(request);
  hostedEnsureRequests.set(appUserId, pending);
  let value: unknown;
  try {
    value = await request;
  } finally {
    pending.delete(request);
    if (pending.size === 0) hostedEnsureRequests.delete(appUserId);
  }
  if (gatewayEpoch(appUserId) !== epoch) {
    throw new HttpError(409, "The IBKR Client Portal connection was cancelled.", {
      code: "ibkr_portal_connect_cancelled",
      expose: true,
    });
  }
  const result = parseHostResponse(
    HostEnsureResponseSchema,
    value,
  );
  return rememberHostedGateway(appUserId, result, false);
}

async function ensureFleetGateway(appUserId: string): Promise<PortalGateway> {
  const stopping = hostedStops.get(appUserId);
  if (stopping) await stopping;
  const existingRequest = fleetEnsureRequests.get(appUserId);
  if (existingRequest) return existingRequest;
  const epoch = gatewayEpoch(appUserId);
  const request = (async () => {
    const fence = await ensureIbkrGatewayFleetFence(appUserId);
    const response = await requestIbkrGatewayFleetHost<unknown>(
      fence,
      "ensure",
    );
    if (gatewayEpoch(appUserId) !== epoch) {
      throw new HttpError(
        409,
        "The IBKR Client Portal connection was cancelled.",
        { code: "ibkr_portal_connect_cancelled", expose: true },
      );
    }
    if (response.status !== "ok") throw invalidHostResponse();
    const result = parseHostResponse(
      FleetHostEnsureResponseSchema,
      response.value,
    );
    assertMatchingFleetResponse(result, response.fence);
    await acknowledgeIbkrGatewayFleetControl(response);
    if (gatewayEpoch(appUserId) !== epoch) {
      throw new HttpError(
        409,
        "The IBKR Client Portal connection was cancelled.",
        { code: "ibkr_portal_connect_cancelled", expose: true },
      );
    }
    return rememberFleetGateway(appUserId, response.fence, result, false);
  })();
  fleetEnsureRequests.set(appUserId, request);
  const pending = hostedEnsureRequests.get(appUserId) ?? new Set();
  pending.add(request);
  hostedEnsureRequests.set(appUserId, pending);
  try {
    return await request;
  } finally {
    if (fleetEnsureRequests.get(appUserId) === request) {
      fleetEnsureRequests.delete(appUserId);
    }
    pending.delete(request);
    if (pending.size === 0) hostedEnsureRequests.delete(appUserId);
  }
}

export async function ensureGateway(appUserId: string): Promise<PortalGateway> {
  const existing = gateways.get(appUserId);
  if (existing && isAlive(existing)) {
    return toPublic(existing);
  }

  if (isIbkrGatewayFleetEnabled()) {
    return ensureFleetGateway(appUserId);
  }

  if (hostedConfig()) {
    return ensureHostedGateway(appUserId);
  }

  if (!isPortalRuntimeAvailable()) {
    throw new HttpError(
      503,
      "The IBKR Client Portal runtime is not installed on this instance.",
      {
        code: "ibkr_portal_runtime_missing",
        detail:
          "Expected the Java runtime and clientportal.gw distribution under IBKR_PORTAL_HOME.",
        expose: true,
      },
    );
  }

  const port = allocatePort();
  const dir = setupInstance(appUserId, port);
  const child = spawnGateway(dir, port);
  const entry: Entry = {
    appUserId,
    port,
    baseUrl: `http://127.0.0.1:${port}/v1/api`,
    hosted: false,
    loginCompletions: 0,
    origin: `http://127.0.0.1:${port}`,
    paperAccountVerified: false,
    proxyOrigin: `http://127.0.0.1:${port}`,
    proxyPort: port,
    recovered: false,
    status: "starting",
    startedAt: Date.now(),
    process: child,
  };
  gateways.set(appUserId, entry);
  child.on("exit", () => {
    const current = gateways.get(appUserId);
    if (current && current.process === child) {
      current.status = "stopped";
    }
  });

  await waitForReady(port);
  entry.status = "ready";
  return toPublic(entry);
}

export function getGateway(appUserId: string): PortalGateway | null {
  const entry = gateways.get(appUserId);
  if (!entry || !isAlive(entry)) {
    return null;
  }
  return toPublic(entry);
}

export async function transitionGatewayLifecycle(
  appUserId: string,
  target: IbkrGatewayLifecycleState,
): Promise<boolean> {
  const entry = gateways.get(appUserId);
  if (!entry || !isAlive(entry)) return false;
  const transitionEpoch = (entry.lifecycleTransitionEpoch ?? 0) + 1;
  entry.lifecycleTransitionEpoch = transitionEpoch;
  if (entry.lifecycleTransitionTarget !== target) {
    entry.lifecycleTransitionConflictEpoch = transitionEpoch;
  }
  entry.lifecycleTransitionTarget = target;
  const transitionConflictEpoch =
    entry.lifecycleTransitionConflictEpoch ?? transitionEpoch;
  entry.paperAccountVerified = false;
  const fence = entry.fleetFence;
  if (!fence) {
    if (target === "authenticated" && entry.status !== "ready") return false;
    entry.paperAccountVerified = target === "authenticated";
    return true;
  }
  if (!(await transitionDurableIbkrGatewayLifecycle(fence, target))) {
    return false;
  }
  if (
    gateways.get(appUserId) !== entry ||
    !isAlive(entry) ||
    !sameFleetFence(entry.fleetFence, fence) ||
    (target === "authenticated" && entry.status !== "ready")
  ) {
    return false;
  }
  if (entry.lifecycleTransitionEpoch !== transitionEpoch) {
    return (
      entry.lifecycleTransitionTarget === target &&
      entry.lifecycleTransitionConflictEpoch === transitionConflictEpoch
    );
  }
  entry.paperAccountVerified = target === "authenticated";
  return true;
}

export async function markGatewayPaperAccountVerified(
  appUserId: string,
  verified = true,
): Promise<boolean> {
  return transitionGatewayLifecycle(
    appUserId,
    verified ? "authenticated" : "reauth_required",
  );
}

export async function refreshGateway(
  appUserId: string,
): Promise<PortalGateway | null> {
  if (hostedStops.has(appUserId)) return null;
  const epoch = gatewayEpoch(appUserId);
  const entry = gateways.get(appUserId);
  if (isIbkrGatewayFleetEnabled()) {
    const fence = entry?.fleetFence ?? (await readIbkrGatewayFleetFence(appUserId));
    if (!fence) return null;
    const response = await requestIbkrGatewayFleetHost<unknown>(
      fence,
      "status",
    );
    if (gatewayEpoch(appUserId) !== epoch) return null;
    const result = parseHostResponse(
      FleetHostStatusResponseSchema,
      response.value,
    );
    assertMatchingFleetResponse(result, response.fence);
    if (
      (response.status === "not_found" && result.capsule !== null) ||
      (response.status === "ok" && result.capsule === null)
    ) {
      throw invalidHostResponse();
    }
    await acknowledgeIbkrGatewayFleetControl(response);
    if (gatewayEpoch(appUserId) !== epoch) return null;
    if (response.status === "not_found") {
      if (
        entry &&
        gateways.get(appUserId) === entry &&
        sameFleetFence(entry.fleetFence, response.fence)
      ) {
        entry.status = "stopped";
        gateways.delete(appUserId);
        stopFleetLeaseKeepalive(appUserId);
      }
      return null;
    }
    const capsule = result.capsule;
    if (!capsule) throw invalidHostResponse();
    const current = gateways.get(appUserId);
    if (current) {
      if (
        !current.fleetFence ||
        !isAlive(current) ||
        !sameFleetFence(current.fleetFence, response.fence)
      ) {
        return null;
      }
      current.fleetFence = response.fence;
      return updateHostedGateway(current, capsule);
    }
    return rememberFleetGateway(
      appUserId,
      response.fence,
      { capsule, targets: result.targets ?? HOSTED_TARGETS },
      true,
    );
  }
  if ((!entry || !isAlive(entry)) && hostedConfig()) {
    const result = await readHostedGatewayStatus(appUserId);
    if (gatewayEpoch(appUserId) !== epoch) return null;
    if (!result?.capsule) return null;
    const recoveredDuringRequest = gateways.get(appUserId);
    if (
      recoveredDuringRequest?.hosted &&
      isAlive(recoveredDuringRequest)
    ) {
      return updateHostedGateway(recoveredDuringRequest, result.capsule);
    }
    return rememberHostedGateway(
      appUserId,
      {
        capsule: result.capsule,
        targets: HOSTED_TARGETS,
      },
      true,
    );
  }
  if (!entry || !isAlive(entry) || !entry.hosted) {
    return entry && isAlive(entry) ? toPublic(entry) : null;
  }

  const result = await readHostedGatewayStatus(appUserId);
  if (gatewayEpoch(appUserId) !== epoch) return null;
  if (gateways.get(appUserId) !== entry) return null;
  if (!result?.capsule) {
    entry.status = "stopped";
    gateways.delete(appUserId);
    return null;
  }
  return updateHostedGateway(entry, result.capsule);
}

export async function stopGateway(appUserId: string): Promise<void> {
  const stopping = hostedStops.get(appUserId);
  if (stopping) {
    await stopping;
    return;
  }
  const entry = gateways.get(appUserId);
  if (isIbkrGatewayFleetEnabled()) {
    bumpGatewayEpoch(appUserId);
    stopFleetLeaseKeepalive(appUserId);
    if (entry) {
      entry.status = "stopped";
      if (gateways.get(appUserId) === entry) gateways.delete(appUserId);
    }
    const pending = [...(hostedEnsureRequests.get(appUserId) ?? [])];
    const promise = (async () => {
      await Promise.allSettled(pending);
      const fence =
        entry?.fleetFence ?? (await readIbkrGatewayFleetFence(appUserId));
      if (!fence) return;
      if (!(await transitionDurableIbkrGatewayLifecycle(fence, "draining"))) {
        throw new HttpError(
          409,
          "The IBKR gateway placement is no longer current.",
          { code: "ibkr_gateway_fence_stale", expose: true },
        );
      }
      let currentFence = fence;
      let releaseControlAttemptId: string | null = null;
      try {
        const released = await requestIbkrGatewayFleetHost<unknown>(
          fence,
          "release",
        );
        const receipt = parseHostResponse(
          HostReleaseResponseSchema,
          released.value,
        );
        if (released.status !== "ok") throw invalidHostResponse();
        assertMatchingFleetResponse(receipt, released.fence);
        await acknowledgeIbkrGatewayFleetControl(released);
        currentFence = released.fence;
        releaseControlAttemptId = released.controlAttemptId;
      } catch (error) {
        await transitionDurableIbkrGatewayLifecycle(fence, "quarantined");
        throw error;
      }
      if (
        !releaseControlAttemptId ||
        !(await releaseIbkrGatewayLease(
          currentFence,
          releaseControlAttemptId,
        ))
      ) {
        await transitionDurableIbkrGatewayLifecycle(fence, "quarantined");
        throw new HttpError(
          409,
          "The IBKR gateway cleanup could not be committed.",
          { code: "ibkr_gateway_cleanup_uncommitted", expose: true },
        );
      }
    })();
    hostedStops.set(appUserId, promise);
    const clear = (): void => {
      if (hostedStops.get(appUserId) === promise) hostedStops.delete(appUserId);
    };
    void promise.then(clear, clear);
    await promise;
    return;
  }
  if (entry?.hosted || (!entry && hostedConfig())) {
    bumpGatewayEpoch(appUserId);
    if (entry) {
      entry.status = "stopped";
      if (gateways.get(appUserId) === entry) gateways.delete(appUserId);
    }
    const pending = [...(hostedEnsureRequests.get(appUserId) ?? [])];
    const promise = (async () => {
      await Promise.allSettled(pending);
      await releaseHostedGateway(appUserId);
    })();
    hostedStops.set(appUserId, promise);
    const clear = (): void => {
      if (hostedStops.get(appUserId) === promise) hostedStops.delete(appUserId);
    };
    void promise.then(clear, clear);
    await promise;
    return;
  }
  if (!entry) {
    rmSync(instanceDir(appUserId), { recursive: true, force: true });
    return;
  }

  entry.status = "stopped";
  gateways.delete(appUserId);
  entry.process?.kill("SIGTERM");
  rmSync(instanceDir(appUserId), { recursive: true, force: true });
}

export function listGateways(): PortalGateway[] {
  return [...gateways.values()].filter(isAlive).map(toPublic);
}
