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

import { HttpError } from "../lib/errors";
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

type Entry = PortalGateway & { process?: ChildProcess };

const gateways = new Map<string, Entry>();
const gatewayEpochs = new Map<string, number>();
const hostedEnsureRequests = new Map<string, Set<Promise<unknown>>>();
const hostedStatusRequests = new Map<
  string,
  { epoch: number; request: Promise<HostStatusResponse | null> }
>();
const hostedStops = new Map<string, Promise<void>>();

function gatewayEpoch(appUserId: string): number {
  return gatewayEpochs.get(appUserId) ?? 0;
}

function bumpGatewayEpoch(appUserId: string): void {
  gatewayEpochs.set(appUserId, gatewayEpoch(appUserId) + 1);
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
  if (hostedConfig()) return true;
  return resolveJavaBin() !== null && existsSync(GATEWAY_JAR);
}

function toPublic(entry: Entry): PortalGateway {
  const { process: _process, ...rest } = entry;
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
// ponytail: capsule relay ports are a fixed private host contract; return
// targets from status if they ever become configurable.
const HOSTED_TARGETS = {
  cpg: { host: "127.0.0.1", port: 15000 },
  console: { host: "127.0.0.1", port: 16080 },
} as const;
const HostEnsureResponseSchema = z.object({
  capsule: HostCapsuleSchema,
  targets: z.object({
    cpg: z.object({
      host: z.literal("127.0.0.1"),
      port: z.number().int().min(1).max(65_535),
    }),
    console: z.object({
      host: z.literal("127.0.0.1"),
      port: z.number().int().min(1).max(65_535),
    }),
  }),
});
const HostStatusResponseSchema = z.object({
  capsule: HostCapsuleSchema.nullable(),
});

type HostEnsureResponse = z.infer<typeof HostEnsureResponseSchema>;
type HostStatusResponse = z.infer<typeof HostStatusResponseSchema>;

function parseHostResponse<T extends z.ZodType>(
  schema: T,
  value: unknown,
): z.output<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new HttpError(502, "The IBKR session host returned an invalid response.", {
      code: "ibkr_session_host_response_invalid",
      expose: false,
    });
  }
  return parsed.data;
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

export async function ensureGateway(appUserId: string): Promise<PortalGateway> {
  const existing = gateways.get(appUserId);
  if (existing && isAlive(existing)) {
    return toPublic(existing);
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

export function markGatewayPaperAccountVerified(
  appUserId: string,
  verified = true,
): boolean {
  const entry = gateways.get(appUserId);
  if (!entry || !isAlive(entry) || entry.status !== "ready") {
    return false;
  }
  entry.paperAccountVerified = verified;
  return entry.paperAccountVerified;
}

export async function refreshGateway(
  appUserId: string,
): Promise<PortalGateway | null> {
  if (hostedStops.has(appUserId)) return null;
  const epoch = gatewayEpoch(appUserId);
  const entry = gateways.get(appUserId);
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
