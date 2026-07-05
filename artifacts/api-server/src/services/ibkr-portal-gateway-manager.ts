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
  port: number;
  baseUrl: string;
  origin: string;
  status: "starting" | "ready" | "stopped";
  startedAt: number;
};

type Entry = PortalGateway & { process: ChildProcess };

const gateways = new Map<string, Entry>();

export function isPortalRuntimeAvailable(): boolean {
  return resolveJavaBin() !== null && existsSync(GATEWAY_JAR);
}

function toPublic(entry: Entry): PortalGateway {
  const { process: _process, ...rest } = entry;
  return { ...rest };
}

function isAlive(entry: Entry): boolean {
  return entry.status !== "stopped" && entry.process.exitCode === null;
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
  // Diagnostic (2026-07-04): raise the gateway's cookie + HTTP-message loggers
  // to DEBUG so a single login reproduction reveals whether the gateway's own
  // server-side GET /v1/api/sso/validate?gw=1 actually carries the IBKR session
  // cookie (x-sess-uuid/web). That discriminates the "reverse proxy loses the
  // session cookie" hypothesis from an account/IBKR-side rejection. Both loggers
  // are pinned to INFO in the shipped logback (additivity="false"), which
  // suppresses the jar/attach detail. Purely observational — no behavior change.
  const logbackPath = path.join(dir, "root", "logback.xml");
  if (existsSync(logbackPath)) {
    const logback = readFileSync(logbackPath, "utf8")
      .replace(
        /(name="ibgroup\.web\.core\.clientportal\.gw\.core\.CookieManager"[^>]*level=")INFO/,
        "$1DEBUG",
      )
      .replace(/(name="HttpMessageLogger"[^>]*level=")INFO/, "$1DEBUG");
    writeFileSync(logbackPath, logback);
  }
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

export async function ensureGateway(appUserId: string): Promise<PortalGateway> {
  const existing = gateways.get(appUserId);
  if (existing && isAlive(existing)) {
    return toPublic(existing);
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
    origin: `http://127.0.0.1:${port}`,
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

export async function stopGateway(appUserId: string): Promise<void> {
  const entry = gateways.get(appUserId);
  if (entry) {
    entry.status = "stopped";
    entry.process.kill("SIGTERM");
    gateways.delete(appUserId);
  }
  rmSync(instanceDir(appUserId), { recursive: true, force: true });
}

export function listGateways(): PortalGateway[] {
  return [...gateways.values()].filter(isAlive).map(toPublic);
}
