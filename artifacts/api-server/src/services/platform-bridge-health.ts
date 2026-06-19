import { performance } from "node:perf_hooks";
import { HttpError, isHttpError } from "../lib/errors";
import { logger } from "../lib/logger";
import {
  clearIbkrBridgeRuntimeOverride,
  getIbkrBridgeRuntimeOverride,
  getProviderConfiguration,
} from "../lib/runtime";
import { recordConnectionLiveState } from "./ibkr-connection-audit";
import { getBridgeQuoteStreamDiagnostics } from "./bridge-quote-stream";
import {
  IbkrBridgeClient,
  describeIbkrBridgeRuntimeUnavailable,
  getIbkrBridgeRuntimeAvailability,
  type IbkrBridgeRuntimeUnavailableState,
} from "../providers/ibkr/bridge-client";
import {
  clearBridgeOrderReadSuppression,
  markBridgeOrderReadsSuppressed,
} from "./bridge-order-read-state";
import {
  getBridgeGovernorSnapshot,
  isBridgeWorkBackedOff,
  runBridgeWork,
} from "./bridge-governor";
import {
  resolveIbkrRuntimeStreamState,
  resolveIbkrRuntimeStrictReason,
  sanitizeConnectedBridgeLastError,
} from "./platform-runtime-status";

// How long the health circuit must stay continuously open before a launched bridge
// runtime override is treated as dead and cleared (see maybeAbandonDeadBridgeOverride).
const DEAD_BRIDGE_OVERRIDE_ABANDON_MS = 3 * 60_000;

type IbkrBridgeClientFactory = () => IbkrBridgeClient;
type BridgeHealthSnapshot = Awaited<ReturnType<IbkrBridgeClient["getHealth"]>>;

type BridgeHealthErrorSnapshot = {
  error: string;
  code: string | null;
  statusCode: number | null;
  detail: string | null;
};

let ibkrBridgeClientFactory: IbkrBridgeClientFactory = () =>
  new IbkrBridgeClient();
let lastKnownBridgeHealth: BridgeHealthSnapshot | null = null;
let lastBridgeHealthRefreshPromise: Promise<void> | null = null;
let lastBridgeHealthWarningAt = 0;
let lastBridgeHealthPingMs: number | null = null;
let lastBridgeHealthPingAt: Date | null = null;
// Injected by ibkr-bridge-runtime (one-way dependency; avoids a circular import).
// True when a Windows desktop agent is currently online — positive proof the
// helper/Gateway is alive even when health probes are transiently failing.
let desktopAgentOnlineProvider: () => boolean = () => false;

export function setDesktopAgentOnlineProvider(
  provider: () => boolean,
): void {
  desktopAgentOnlineProvider = provider;
}

export function getIbkrClient(): IbkrBridgeClient {
  return ibkrBridgeClientFactory();
}

export function __setIbkrBridgeClientFactoryForTests(
  factory: IbkrBridgeClientFactory | null,
): void {
  ibkrBridgeClientFactory = factory ?? (() => new IbkrBridgeClient());
  lastKnownBridgeHealth = null;
  lastBridgeHealthRefreshPromise = null;
}

export function primeBridgeHealthForSession(health: unknown): void {
  if (!health || typeof health !== "object") {
    return;
  }

  const snapshot = { ...(health as Record<string, unknown>) };
  if (!snapshot.updatedAt) {
    snapshot.updatedAt = new Date().toISOString();
  }
  lastKnownBridgeHealth = snapshot as BridgeHealthSnapshot;
  lastBridgeHealthRefreshPromise = null;
}

/**
 * Drop the cached bridge health so the next status read re-probes immediately.
 * Used on user-initiated deactivate (detach / bridge override clear): we know the
 * bridge is going away, so the stale "operational" cache (otherwise fresh for
 * IBKR_BRIDGE_HEALTH_FRESH_MS) must not keep reporting connected for ~30s+.
 */
export function invalidateBridgeHealthCache(): void {
  lastKnownBridgeHealth = null;
  lastBridgeHealthRefreshPromise = null;
}

function positiveEnvInt(name: string, fallback: number): number {
  const configured = Number.parseInt(process.env[name] ?? String(fallback), 10);
  return Number.isFinite(configured) && configured > 0 ? configured : fallback;
}

function sessionBridgeHealthInitialTimeoutMs(): number {
  const configured = Number.parseInt(
    process.env["SESSION_BRIDGE_HEALTH_INITIAL_TIMEOUT_MS"] ?? "0",
    10,
  );
  return Number.isFinite(configured) && configured > 0 ? configured : 0;
}

function sessionBridgeHealthBackgroundTimeoutMs(): number {
  return positiveEnvInt("SESSION_BRIDGE_HEALTH_TIMEOUT_MS", 5_000);
}

function sessionBridgeHealthStaleTimeoutMs(): number {
  return positiveEnvInt("SESSION_BRIDGE_HEALTH_STALE_TIMEOUT_MS", 1_500);
}

function bridgeHealthFreshMs(): number {
  return positiveEnvInt("IBKR_BRIDGE_HEALTH_FRESH_MS", 30_000);
}

function bridgeUnhealthyCacheMs(): number {
  return positiveEnvInt("IBKR_BRIDGE_UNHEALTHY_CACHE_MS", 2_000);
}

function bridgeStreamFreshMs(): number {
  const configured = Number.parseInt(
    process.env["IBKR_BRIDGE_STREAM_FRESH_MS"] ??
      process.env["IBKR_QUOTE_STREAM_STALL_MS"] ??
      "45000",
    10,
  );
  return Number.isFinite(configured) && configured > 0 ? configured : 45_000;
}

function bridgeConnectivityFloorMs(): number {
  // Bounded trust window for the stale last-known-good cache. MUST stay shorter
  // than runtimeDiagnosticsStaleHealthCacheMs (120s) so connectivity cannot ride
  // the full operational cache after a real disconnect, yet long enough to absorb
  // a transient event-loop freeze (~8-11s) without flipping a live bridge to
  // "not connected".
  return positiveEnvInt("IBKR_BRIDGE_CONNECTIVITY_FLOOR_MS", 20_000);
}

function bridgeLivenessFreshMs(): number {
  // Half-open guard: a hung-but-socket-open gateway keeps connected=true until the
  // ~30s watchdog flips it, and a failed tickle never flips it, so require a recent
  // successful round-trip (lastTickleAt). MUST exceed the bridge tickle interval
  // (>=10s) with margin so normal cadence never false-flaps; small enough to catch
  // a persistent half-open within a bounded window.
  return positiveEnvInt("IBKR_BRIDGE_LIVENESS_FRESH_MS", 90_000);
}

function runtimeDiagnosticsTimeoutMs(): number {
  return positiveEnvInt("RUNTIME_DIAGNOSTICS_BRIDGE_HEALTH_TIMEOUT_MS", 6_500);
}

function runtimeDiagnosticsStaleHealthCacheMs(): number {
  return positiveEnvInt(
    "RUNTIME_DIAGNOSTICS_BRIDGE_HEALTH_STALE_CACHE_MS",
    120_000,
  );
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutError: () => Error,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(timeoutError());
    }, timeoutMs);
    timeout.unref?.();

    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

function warnBridgeHealthFailure(error: unknown, context: string): void {
  const now = Date.now();
  if (now - lastBridgeHealthWarningAt < 60_000) {
    return;
  }
  lastBridgeHealthWarningAt = now;
  logger.warn({ err: error, context }, "IBKR bridge health request failed");
}

function recordBridgeHealthPing(startedAt: number, pingAt: Date): void {
  lastBridgeHealthPingMs = Math.max(
    0,
    Math.round(performance.now() - startedAt),
  );
  lastBridgeHealthPingAt = pingAt;
}

async function fetchBridgeHealthWithPing(): Promise<BridgeHealthSnapshot> {
  const startedAt = performance.now();
  const pingAt = new Date();
  try {
    const health = await getIbkrClient().getHealth();
    recordBridgeHealthPing(startedAt, pingAt);
    return health;
  } catch (error) {
    recordBridgeHealthPing(startedAt, pingAt);
    throw error;
  }
}

function timestampMs(value: unknown): number | null {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : null;
  }
  if (typeof value === "string" || typeof value === "number") {
    const time = new Date(value).getTime();
    return Number.isFinite(time) ? time : null;
  }
  return null;
}

function numericRecordValue(record: unknown, key: string): number | null {
  if (!record || typeof record !== "object") {
    return null;
  }
  const value = (record as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function minFinite(...values: Array<number | null | undefined>): number | null {
  const finiteValues = values.filter((value): value is number =>
    Number.isFinite(value),
  );
  return finiteValues.length ? Math.min(...finiteValues) : null;
}

function ageFromSnapshotAge(
  value: number | null,
  snapshotAgeMs: number | null,
): number | null {
  if (value === null || snapshotAgeMs === null) {
    return null;
  }
  return Math.max(0, value) + Math.max(0, snapshotAgeMs);
}

function hasCurrentBridgeDiagnostics(health: BridgeHealthSnapshot): boolean {
  return Boolean(health.diagnostics && typeof health.diagnostics === "object");
}

function bridgeHealthAgeMs(health: BridgeHealthSnapshot): number | null {
  const updatedAtMs = timestampMs(health.updatedAt);
  return updatedAtMs === null ? null : Math.max(0, Date.now() - updatedAtMs);
}

function isOperationalBridgeHealth(health: BridgeHealthSnapshot): boolean {
  const brokerServerConnected =
    health.brokerServerConnected ?? Boolean(health.connected);
  const accountsLoaded =
    brokerServerConnected &&
    Array.isArray(health.accounts) &&
    health.accounts.length > 0;
  const configuredLiveMarketDataMode =
    health.marketDataMode === "live" ||
    (health.marketDataMode == null && health.liveMarketDataAvailable === true);

  return Boolean(
    health.connected &&
      brokerServerConnected &&
      health.authenticated &&
      accountsLoaded &&
      configuredLiveMarketDataMode,
  );
}

function bridgeHealthCacheMs(health: BridgeHealthSnapshot): number {
  return isOperationalBridgeHealth(health)
    ? bridgeHealthFreshMs()
    : bridgeUnhealthyCacheMs();
}

function shouldRefreshCachedBridgeHealth(health: BridgeHealthSnapshot): boolean {
  const ageMs = bridgeHealthAgeMs(health);
  return ageMs === null || ageMs > bridgeHealthCacheMs(health);
}

function shouldScheduleCachedBridgeHealthRefresh(
  health: BridgeHealthSnapshot,
): boolean {
  const ageMs = bridgeHealthAgeMs(health);
  return ageMs === null || ageMs > Math.floor(bridgeHealthCacheMs(health) / 2);
}

function bridgeHealthContinuousOutageMs(now: number): number | null {
  // How long the health circuit has been CONTINUOUSLY open (firstOpenedAt is not
  // reset by each backoff window, unlike openedAt). Null when not currently failing.
  const firstOpenedAt = getBridgeGovernorSnapshot().health.firstOpenedAt;
  return typeof firstOpenedAt === "number"
    ? Math.max(0, now - firstOpenedAt)
    : null;
}

export type BridgeConnectivityReason =
  | "socket_disconnected"
  | "server_disconnected"
  | "not_authenticated"
  | "liveness_stale"
  | "connectivity_floor_exceeded"
  | "health_error"
  | "ibkr_bridge_not_configured"
  | "ibkr_bridge_runtime_unattached";

export type BridgeConnectivityInput = {
  connected: boolean;
  authenticated: boolean;
  serverConnectivity: "unknown" | "connected" | "disconnected" | null | undefined;
  /** ms timestamp of the last successful liveness round-trip (getCurrentTime tickle). */
  lastTickleAtMs: number | null;
  /** Age of the health snapshot (now - updatedAt); the real cache age even when forceStale. */
  healthAgeMs: number | null;
  /** True when we are serving the stale last-known-good cache (probe unavailable). */
  forceStale: boolean;
  /** Current stream/transport activity is positive liveness proof for the bridge. */
  streamFresh: boolean;
  /** Independent positive proof the Windows helper/Gateway host is alive. */
  desktopAgentOnline: boolean;
  /** How long the health circuit has been continuously open (null when not failing). */
  continuousOutageMs: number | null;
  now: number;
  livenessFreshMs: number;
  connectivityFloorMs: number;
  healthFreshMs: number;
};

export type BridgeConnectivityVerdict = {
  connectivityUp: boolean;
  connectivityReason: BridgeConnectivityReason | null;
  lastTickleAgeMs: number | null;
  livenessFresh: boolean;
  floorOk: boolean;
};

/**
 * The connection verdict, DECOUPLED from the data-freshness clocks (healthFresh /
 * streamFresh). It answers "is the bridge connection genuinely usable right now",
 * not "did the api-server recently process a quote/health event". Three layers:
 *
 *  1. Wire/server truth: socket connected, server not flagged disconnected, session
 *     authenticated. Pure transport facts straight from the bridge snapshot.
 *  2. Liveness round-trip (half-open guard): require a recent successful tickle
 *     or fresh quote stream/transport activity, since a hung-but-socket-open
 *     gateway keeps connected=true for ~30s and a failed tickle never flips it.
 *     A fresh successful health probe (not stale, healthAge<=healthFreshMs) is
 *     itself a round-trip, so a not-yet-tickled-but-just-probed bridge counts as live.
 *  3. Connectivity floor (stale-cache guard): when serving the stale cache, trust the
 *     connection only within a short floor (never the full 120s operational cache) and
 *     never past a continuous health outage longer than the floor. desktopAgentOnline is
 *     independent positive proof and overrides the floor (but NOT liveness — a live helper
 *     does not prove the TWS socket is completing round-trips).
 */
export function resolveBridgeConnectivity(
  input: BridgeConnectivityInput,
): BridgeConnectivityVerdict {
  // NOTE: lastTickleAt is stamped with the bridge host's clock while `now` is the
  // api-server clock. Math.max(0, ...) clamps a forward (bridge-ahead) skew to age 0,
  // so a >= livenessFreshMs forward skew would keep liveness perpetually fresh. This
  // inherits the pre-existing healthFresh skew assumption; a future task that gates
  // TRADING on connectivityUp must normalize the bridge clock (carry a serverTime
  // offset) rather than trust this field as skew-proof.
  const lastTickleAgeMs =
    input.lastTickleAtMs === null
      ? null
      : Math.max(0, input.now - input.lastTickleAtMs);

  if (input.serverConnectivity === "disconnected") {
    return {
      connectivityUp: false,
      connectivityReason: "server_disconnected",
      lastTickleAgeMs,
      livenessFresh: false,
      floorOk: false,
    };
  }
  if (input.connected !== true) {
    return {
      connectivityUp: false,
      connectivityReason: "socket_disconnected",
      lastTickleAgeMs,
      livenessFresh: false,
      floorOk: false,
    };
  }
  if (input.authenticated !== true) {
    return {
      connectivityUp: false,
      connectivityReason: "not_authenticated",
      lastTickleAgeMs,
      livenessFresh: false,
      floorOk: false,
    };
  }

  const livenessFresh =
    input.streamFresh === true ||
    (lastTickleAgeMs !== null && lastTickleAgeMs <= input.livenessFreshMs) ||
    (input.lastTickleAtMs === null &&
      input.forceStale !== true &&
      input.healthAgeMs !== null &&
      input.healthAgeMs <= input.healthFreshMs);
  if (!livenessFresh) {
    return {
      connectivityUp: false,
      connectivityReason: "liveness_stale",
      lastTickleAgeMs,
      livenessFresh: false,
      floorOk: false,
    };
  }

  const floorOk =
    input.forceStale !== true ||
    input.streamFresh === true ||
    input.desktopAgentOnline === true ||
    ((input.healthAgeMs === null ||
      input.healthAgeMs <= input.connectivityFloorMs) &&
      (input.continuousOutageMs === null ||
        input.continuousOutageMs <= input.connectivityFloorMs));
  if (!floorOk) {
    return {
      connectivityUp: false,
      connectivityReason: "connectivity_floor_exceeded",
      lastTickleAgeMs,
      livenessFresh: true,
      floorOk: false,
    };
  }

  return {
    connectivityUp: true,
    connectivityReason: null,
    lastTickleAgeMs,
    livenessFresh: true,
    floorOk: true,
  };
}

function annotateBridgeHealth(
  health: BridgeHealthSnapshot,
  options: {
    forceStale?: boolean;
    bridgeQuoteDiagnostics?: ReturnType<typeof getBridgeQuoteStreamDiagnostics> | null;
  } = {},
) {
  const now = Date.now();
  const updatedAtMs = timestampMs(health.updatedAt);
  const healthAgeMs = updatedAtMs === null ? null : Math.max(0, now - updatedAtMs);
  const healthFresh =
    options.forceStale === true
      ? false
      : healthAgeMs !== null && healthAgeMs <= bridgeHealthFreshMs();
  const subscriptions =
    health.diagnostics &&
    typeof health.diagnostics === "object" &&
    "subscriptions" in health.diagnostics
      ? (health.diagnostics as Record<string, unknown>)["subscriptions"]
      : null;
  const bridgeQuoteDataAgeMs =
    options.bridgeQuoteDiagnostics?.streamActive === true
      ? (options.bridgeQuoteDiagnostics.dataFreshnessAgeMs ??
        options.bridgeQuoteDiagnostics.lastEventAgeMs)
      : null;
  const bridgeQuoteTransportAgeMs =
    options.bridgeQuoteDiagnostics?.streamActive === true
      ? options.bridgeQuoteDiagnostics.transportFreshnessAgeMs
      : null;
  const desiredSymbolCount = Math.max(
    options.bridgeQuoteDiagnostics?.unionSymbolCount ?? 0,
    numericRecordValue(subscriptions, "quoteListenerCount") ?? 0,
  );
  const lastStreamEventAgeMs = minFinite(
    ageFromSnapshotAge(
      numericRecordValue(subscriptions, "lastQuoteAgeMs"),
      healthAgeMs,
    ),
    ageFromSnapshotAge(
      numericRecordValue(subscriptions, "lastAggregateSourceAgeMs"),
      healthAgeMs,
    ),
    bridgeQuoteDataAgeMs,
    bridgeQuoteTransportAgeMs,
  );
  const streamFresh =
    lastStreamEventAgeMs !== null && lastStreamEventAgeMs <= bridgeStreamFreshMs();
  // A fresh data stream is positive proof the bridge/gateway is connected: live
  // quotes cannot flow if it were not. When the /healthz probe is stale or
  // erroring (e.g. a transient cloudflared 502 on the health route) but the
  // stream is fresh, trust the stream and keep the connection live instead of
  // flipping the UI to disconnected on a false-negative health probe. If the
  // gateway genuinely drops, the stream goes stale and this correctly reverts.
  const streamVouchesForConnection =
    streamFresh && Boolean(health.connected) && options.forceStale !== true;
  const connectionProofFresh = healthFresh || streamVouchesForConnection;
  const bridgeReachable = connectionProofFresh && options.forceStale !== true;
  const socketConnected = connectionProofFresh && Boolean(health.connected);
  const authenticated = socketConnected && Boolean(health.authenticated);
  const brokerServerConnected =
    socketConnected && (health.brokerServerConnected ?? Boolean(health.connected));
  const accountsLoaded =
    brokerServerConnected && Array.isArray(health.accounts) && health.accounts.length > 0;
  const currentBridgeDiagnostics = hasCurrentBridgeDiagnostics(health);
  if (health.connected && health.authenticated && !currentBridgeDiagnostics) {
    markBridgeOrderReadsSuppressed({
      reason: "orders_bridge_update_required",
      message:
        "The running Windows IBKR bridge is an older build; order snapshots are paused until the bridge is reactivated.",
      ttlMs: 10 * 60_000,
    });
  } else if (currentBridgeDiagnostics) {
    clearBridgeOrderReadSuppression("orders_bridge_update_required");
  }
  const configuredLiveMarketDataMode =
    health.marketDataMode === "live" ||
    (health.marketDataMode == null && health.liveMarketDataAvailable === true);
  const sanitizedHealthLastError = sanitizeConnectedBridgeLastError(
    health.lastError,
    socketConnected,
  );
  const strictReason = resolveIbkrRuntimeStrictReason({
    healthFresh,
    connected: socketConnected,
    brokerServerConnected,
    authenticated,
    accountsLoaded,
    configuredLiveMarketDataMode,
    streamFresh,
    streamActive: options.bridgeQuoteDiagnostics?.streamActive,
    desiredSymbolCount,
    now: new Date(now),
  });
  const strictReady = strictReason === null;
  const streamState = resolveIbkrRuntimeStreamState({
    configured: true,
    healthFresh,
    bridgeReachable,
    connected: socketConnected,
    brokerServerConnected,
    authenticated,
    accountsLoaded,
    configuredLiveMarketDataMode,
    liveMarketDataAvailable: health.liveMarketDataAvailable,
    streamFresh,
    streamActive: options.bridgeQuoteDiagnostics?.streamActive,
    reconnectScheduled: options.bridgeQuoteDiagnostics?.reconnectScheduled,
    streamLastError: options.bridgeQuoteDiagnostics?.lastError,
    streamPressure: options.bridgeQuoteDiagnostics?.pressure,
    desiredSymbolCount,
    now: new Date(now),
  });
  // Connection verdict, decoupled from the data-freshness clocks above. This is the
  // authoritative "is the bridge connection usable" signal that gates/display should
  // consume instead of `connected`/`socketConnected` (which fold in healthFresh/streamFresh
  // and therefore flip to "not connected" when the api-server merely falls behind under load).
  const connectivity = resolveBridgeConnectivity({
    connected: Boolean(health.connected),
    authenticated: Boolean(health.authenticated),
    serverConnectivity: health.serverConnectivity,
    lastTickleAtMs: timestampMs(health.lastTickleAt),
    healthAgeMs,
    forceStale: options.forceStale === true,
    streamFresh,
    desktopAgentOnline: desktopAgentOnlineProvider(),
    continuousOutageMs: bridgeHealthContinuousOutageMs(now),
    now,
    livenessFreshMs: bridgeLivenessFreshMs(),
    connectivityFloorMs: bridgeConnectivityFloorMs(),
    healthFreshMs: bridgeHealthFreshMs(),
  });
  const strictFields = {
    healthFresh,
    healthAgeMs,
    stale: !healthFresh,
    bridgeReachable,
    socketConnected,
    brokerServerConnected,
    connectivityUp: connectivity.connectivityUp,
    connectivityReason: connectivity.connectivityReason,
    lastTickleAgeMs: connectivity.lastTickleAgeMs,
    serverConnectivity: health.serverConnectivity,
    lastServerConnectivityAt: health.lastServerConnectivityAt,
    lastServerConnectivityError: health.lastServerConnectivityError,
    accountsLoaded,
    configuredLiveMarketDataMode,
    streamFresh,
    lastStreamEventAgeMs,
    strictReady,
    strictReason,
    ...streamState,
  };
  const rawTwsConnection = health.connections?.tws;
  const twsConnection = rawTwsConnection
    ? {
        ...rawTwsConnection,
        lastPingMs: rawTwsConnection.lastPingMs ?? lastBridgeHealthPingMs,
        lastPingAt: rawTwsConnection.lastPingAt ?? lastBridgeHealthPingAt,
        ...strictFields,
        lastError: sanitizeConnectedBridgeLastError(
          rawTwsConnection.lastError,
          Boolean(rawTwsConnection.reachable && bridgeReachable),
        ),
        reachable: Boolean(rawTwsConnection.reachable && bridgeReachable),
      }
    : undefined;

  return {
    ...health,
    authenticated,
    connected: socketConnected,
    lastError: sanitizedHealthLastError,
    ...strictFields,
    connections: health.connections
      ? {
          ...health.connections,
          ...(twsConnection ? { tws: twsConnection } : {}),
        }
      : health.connections,
  };
}

export type AnnotatedBridgeHealth = ReturnType<typeof annotateBridgeHealth>;

function buildUnattachedDesktopAgentBridgeHealth(
  unavailable: IbkrBridgeRuntimeUnavailableState = describeIbkrBridgeRuntimeUnavailable(),
): AnnotatedBridgeHealth {
  const now = new Date();
  const streamState = {
    streamState: "checking" as const,
    streamStateReason: unavailable.code,
  };
  const connection = {
    transport: "tws" as const,
    role: "market_data" as const,
    configured: true,
    reachable: false,
    authenticated: false,
    competing: false,
    target: null,
    mode: null,
    clientId: null,
    selectedAccountId: null,
    accounts: [],
    lastPingMs: null,
    lastPingAt: null,
    lastTickleAt: null,
    lastError: unavailable.message,
    marketDataMode: null,
    liveMarketDataAvailable: null,
    healthFresh: false,
    healthAgeMs: null,
    stale: true,
    bridgeReachable: false,
    socketConnected: false,
    brokerServerConnected: false,
    serverConnectivity: "unknown" as const,
    lastServerConnectivityAt: null,
    lastServerConnectivityError: null,
    accountsLoaded: false,
    configuredLiveMarketDataMode: false,
    streamFresh: false,
    lastStreamEventAgeMs: null,
    strictReady: false,
    strictReason: unavailable.code,
    connectivityUp: false,
    connectivityReason: unavailable.code,
    lastTickleAgeMs: null,
  };
  return {
    configured: true,
    authenticated: false,
    connected: false,
    competing: false,
    selectedAccountId: null,
    accounts: [],
    lastTickleAt: null,
    lastError: unavailable.message,
    lastRecoveryAttemptAt: null,
    lastRecoveryError: null,
    updatedAt: now,
    transport: "tws" as const,
    connectionTarget: null,
    sessionMode: null,
    clientId: null,
    marketDataMode: null,
    liveMarketDataAvailable: null,
    healthFresh: false,
    healthAgeMs: null,
    stale: true,
    bridgeReachable: false,
    socketConnected: false,
    brokerServerConnected: false,
    serverConnectivity: "unknown" as const,
    lastServerConnectivityAt: null,
    lastServerConnectivityError: null,
    accountsLoaded: false,
    configuredLiveMarketDataMode: false,
    streamFresh: false,
    lastStreamEventAgeMs: null,
    strictReady: false,
    strictReason: unavailable.code,
    connectivityUp: false,
    connectivityReason: unavailable.code,
    lastTickleAgeMs: null,
    ...streamState,
    diagnostics: {
      lastReconnectReason: unavailable.code,
    },
    connections: {
      tws: connection,
    },
  };
}

export const __platformBridgeHealthInternalsForTests = {
  annotateBridgeHealth,
  maybeAbandonDeadBridgeOverride,
  DEAD_BRIDGE_OVERRIDE_ABANDON_MS,
  buildUnattachedDesktopAgentBridgeHealth,
};

async function refreshBridgeHealthForSession(
  timeoutMs: number,
  context: string,
): Promise<void> {
  if (isBridgeWorkBackedOff("health")) {
    return;
  }

  // Cache the snapshot whenever the probe itself resolves, decoupled from the
  // caller-side withTimeout below. A bridge that answers slower than `timeoutMs`
  // (common under market-open load, where timeoutMs is the short 5s/1.5s session
  // budget while the bridge request budget is 12s) must NOT have its successful
  // health snapshot discarded — otherwise lastKnownBridgeHealth never populates
  // and every health-gated read (session connection state, accounts, positions,
  // bars) stays blocked even though the bridge is alive. The await only bounds
  // how long the caller waits; it never decides whether a success is recorded.
  const probe = runBridgeWork("health", () => fetchBridgeHealthWithPing());
  probe.then(
    (health) => {
      lastKnownBridgeHealth = health;
    },
    () => {
      // Failure is recorded by runBridgeWork and surfaced via the await below.
    },
  );

  try {
    await withTimeout(
      probe,
      timeoutMs,
      () =>
        new HttpError(504, "IBKR bridge health request timed out.", {
          code: "ibkr_bridge_health_timeout",
          detail: `Bridge health did not respond within ${timeoutMs}ms.`,
        }),
    );
  } catch (error) {
    warnBridgeHealthFailure(error, context);
  }
}

function scheduleBridgeHealthRefreshForSession(context: string): void {
  if (lastBridgeHealthRefreshPromise || isBridgeWorkBackedOff("health")) {
    return;
  }

  lastBridgeHealthRefreshPromise = refreshBridgeHealthForSession(
    sessionBridgeHealthBackgroundTimeoutMs(),
    context,
  ).finally(() => {
    lastBridgeHealthRefreshPromise = null;
  });
}

type BridgeHealthForSessionOptions = {
  waitForInitialRefresh?: boolean;
  waitForStaleRefresh?: boolean;
};

// A launched bridge sets a runtime override pointing at its tunnel URL. If that
// bridge dies (gateway closed, tunnel gone), the override would otherwise linger
// "active" forever while the health circuit stays open — which the UI surfaces as a
// contradictory state (an active override plus a failing/disconnected bridge). Once
// the health circuit has been open CONTINUOUSLY (no success) for this long, treat
// the override as dead and clear it so the connection resolves to a clean
// disconnected/relaunchable state. Generous enough that a transient tunnel 502
// (which recovers in seconds and resets openedAt on the next success) cannot trip it.
function maybeAbandonDeadBridgeOverride(now = Date.now()): boolean {
  if (!getIbkrBridgeRuntimeOverride()) {
    return false;
  }
  // firstOpenedAt marks the start of the current unbroken failure streak and — unlike
  // openedAt — survives the backoff-window resets in isBridgeWorkBackedOff, so it is a
  // true continuous-outage clock. It is cleared only on a health success.
  const health = getBridgeGovernorSnapshot().health;
  if (
    !health.firstOpenedAt ||
    now - health.firstOpenedAt < DEAD_BRIDGE_OVERRIDE_ABANDON_MS
  ) {
    return false;
  }
  // A sustained health-circuit outage does NOT mean the bridge is dead while the
  // Windows desktop agent is still online — that's positive proof the helper (and
  // Gateway) are alive and the health probes are merely failing/timing out (e.g.
  // sidecar slowness). Abandoning here would wrongly flip configured.ibkr to false
  // (UI shows "disconnected"/not-configured for a LIVE connection) and delete the
  // persisted override so it can't recover. Only abandon when the agent is gone too.
  if (desktopAgentOnlineProvider()) {
    return false;
  }
  clearIbkrBridgeRuntimeOverride();
  logger.warn(
    { openForMs: now - health.firstOpenedAt, failureCount: health.failureCount },
    "Cleared IBKR bridge runtime override after a sustained health-circuit outage; the bridge appears dead. Relaunch to reconnect.",
  );
  return true;
}

export async function getBridgeHealthForSession(
  options: BridgeHealthForSessionOptions = {},
): Promise<AnnotatedBridgeHealth | null> {
  const runtimeAvailability = getIbkrBridgeRuntimeAvailability();
  if (!runtimeAvailability.runtimeConfigured) {
    if (runtimeAvailability.desktopAgentOnline) {
      return buildUnattachedDesktopAgentBridgeHealth(
        describeIbkrBridgeRuntimeUnavailable(runtimeAvailability),
      );
    }
    return null;
  }
  // Drop a dead override before evaluating health so the session reports a clean
  // disconnected state instead of an active-override-but-failing contradiction.
  maybeAbandonDeadBridgeOverride();

  const initialTimeoutMs =
    options.waitForInitialRefresh === false
      ? 0
      : sessionBridgeHealthInitialTimeoutMs();
  if (!lastKnownBridgeHealth && initialTimeoutMs > 0) {
    await refreshBridgeHealthForSession(
      initialTimeoutMs,
      "session_initial",
    );
  }

  if (!lastKnownBridgeHealth) {
    scheduleBridgeHealthRefreshForSession("session_background");
    recordConnectionLiveState({ connected: false, streamState: "offline" });
    return null;
  }

  const bridgeQuoteDiagnostics = getBridgeQuoteStreamDiagnostics();
  let cacheNeedsRefresh = shouldRefreshCachedBridgeHealth(lastKnownBridgeHealth);
  let annotated = annotateBridgeHealth(lastKnownBridgeHealth, {
    bridgeQuoteDiagnostics,
  });
  if (cacheNeedsRefresh && annotated.streamFresh !== true) {
    annotated = annotateBridgeHealth(lastKnownBridgeHealth, {
      forceStale: true,
      bridgeQuoteDiagnostics,
    });
  }
  if (
    cacheNeedsRefresh &&
    !lastBridgeHealthRefreshPromise &&
    !isBridgeWorkBackedOff("health")
  ) {
    if (options.waitForStaleRefresh === false) {
      scheduleBridgeHealthRefreshForSession("session_background");
    } else {
      await refreshBridgeHealthForSession(
        sessionBridgeHealthStaleTimeoutMs(),
        "session_stale",
      );
      if (lastKnownBridgeHealth) {
        cacheNeedsRefresh = shouldRefreshCachedBridgeHealth(lastKnownBridgeHealth);
        annotated = annotateBridgeHealth(lastKnownBridgeHealth, {
          bridgeQuoteDiagnostics,
        });
        if (cacheNeedsRefresh && annotated.streamFresh !== true) {
          annotated = annotateBridgeHealth(lastKnownBridgeHealth, {
            forceStale: true,
            bridgeQuoteDiagnostics,
          });
        }
      }
    }
  }
  if (shouldScheduleCachedBridgeHealthRefresh(lastKnownBridgeHealth)) {
    scheduleBridgeHealthRefreshForSession("session_background");
  }

  recordConnectionLiveState({
    connected: Boolean(annotated.connectivityUp),
    streamState: annotated.streamState,
  });
  return annotated;
}

function serializeBridgeHealthError(error: unknown): BridgeHealthErrorSnapshot {
  return {
    error:
      error instanceof Error && error.message
        ? error.message
        : "IBKR bridge health request failed.",
    code: isHttpError(error) ? (error.code ?? null) : null,
    statusCode: isHttpError(error) ? error.statusCode : null,
    detail: isHttpError(error) ? (error.detail ?? null) : null,
  };
}

function getBridgeBackoffRemainingMs(category: "orders" | "options" | "health"): number {
  return getBridgeGovernorSnapshot()[category].backoffRemainingMs;
}

export function getSessionBridgeHealthFailureState() {
  const runtimeAvailability = getIbkrBridgeRuntimeAvailability();
  if (!runtimeAvailability.runtimeConfigured) {
    return null;
  }

  const healthBackedOff = isBridgeWorkBackedOff("health");
  const governor = getBridgeGovernorSnapshot();
  const healthGovernor = governor.health;
  if (!healthBackedOff && !healthGovernor.lastFailure) {
    return null;
  }

  const fallbackStreamState = resolveIbkrRuntimeStreamState({
    configured: true,
    healthFresh: false,
    bridgeReachable: false,
    connected: false,
    brokerServerConnected: false,
    authenticated: false,
    accountsLoaded: false,
  });
  const healthError = healthBackedOff
    ? "IBKR bridge health is temporarily backed off."
    : (healthGovernor.lastFailure ?? "IBKR bridge health request failed.");

  return {
    reachable: false,
    healthError,
    healthErrorCode: healthBackedOff
      ? "ibkr_bridge_health_backoff"
      : "ibkr_bridge_health_failure",
    healthErrorStatusCode: healthBackedOff ? 503 : null,
    healthErrorDetail: healthBackedOff
      ? `Bridge health checks are backed off for ${Math.round(
          healthGovernor.backoffRemainingMs,
        )}ms.`
      : null,
    healthFresh: false,
    healthAgeMs: null,
    stale: true,
    bridgeReachable: false,
    socketConnected: false,
    brokerServerConnected: false,
    connectivityUp: false,
    connectivityReason: "health_error" as BridgeConnectivityReason,
    lastTickleAgeMs: null,
    connected: false,
    authenticated: false,
    accountsLoaded: false,
    streamFresh: false,
    lastStreamEventAgeMs: null,
    strictReady: false,
    strictReason: "health_error",
    ...fallbackStreamState,
    governor: {
      health: {
        circuitOpen: healthGovernor.circuitOpen,
        backoffRemainingMs: healthGovernor.backoffRemainingMs,
        failureCount: healthGovernor.failureCount,
        lastFailure: healthGovernor.lastFailure,
        lastFailureAt: healthGovernor.lastFailureAt,
        lastSuccessAt: healthGovernor.lastSuccessAt,
      },
    },
  };
}

export async function getRuntimeBridgeHealthState() {
  const configured = getProviderConfiguration();
  const runtimeAvailability = getIbkrBridgeRuntimeAvailability();
  const bridgeHealthTimeoutMs = runtimeDiagnosticsTimeoutMs();
  const bridgeQuoteDiagnostics = getBridgeQuoteStreamDiagnostics();
  if (
    !runtimeAvailability.runtimeConfigured &&
    runtimeAvailability.desktopAgentOnline
  ) {
    const annotatedHealth = buildUnattachedDesktopAgentBridgeHealth(
      describeIbkrBridgeRuntimeUnavailable(runtimeAvailability),
    );
    return {
      bridgeQuoteDiagnostics,
      annotatedHealth,
      fallbackStreamState: resolveIbkrRuntimeStreamState({
        configured: true,
        healthFresh: false,
        connected: false,
        authenticated: false,
      }),
      healthError: null,
      healthErrorCode: null,
      healthErrorStatusCode: null,
      healthErrorDetail: null,
    };
  }
  const cachedBridgeHealthAgeMs =
    lastKnownBridgeHealth == null
      ? null
      : bridgeHealthAgeMs(lastKnownBridgeHealth);
  const cachedBridgeHealthMaxAgeMs =
    lastKnownBridgeHealth === null
      ? 0
      : isOperationalBridgeHealth(lastKnownBridgeHealth)
        ? runtimeDiagnosticsStaleHealthCacheMs()
        : bridgeUnhealthyCacheMs();
  const useCachedBridgeHealth =
    lastKnownBridgeHealth !== null &&
    cachedBridgeHealthAgeMs !== null &&
    cachedBridgeHealthAgeMs <= cachedBridgeHealthMaxAgeMs;
  if (
    useCachedBridgeHealth &&
    lastKnownBridgeHealth !== null &&
    shouldScheduleCachedBridgeHealthRefresh(lastKnownBridgeHealth)
  ) {
    scheduleBridgeHealthRefreshForSession("runtime_background");
  }
  const bridgeHealthResult: BridgeHealthSnapshot | BridgeHealthErrorSnapshot =
    useCachedBridgeHealth
      ? lastKnownBridgeHealth!
      : isBridgeWorkBackedOff("health")
        ? serializeBridgeHealthError(
            new HttpError(503, "IBKR bridge health is temporarily backed off.", {
              code: "ibkr_bridge_health_backoff",
              detail: `Bridge health checks are backed off for ${getBridgeBackoffRemainingMs("health")}ms.`,
            }),
          )
        : await runBridgeWork("health", () =>
            withTimeout(
              fetchBridgeHealthWithPing(),
              bridgeHealthTimeoutMs,
              () =>
                new HttpError(504, "IBKR bridge health request timed out.", {
                  code: "ibkr_bridge_health_timeout",
                  detail: `Bridge health did not respond within ${bridgeHealthTimeoutMs}ms.`,
                }),
            ),
          ).catch(serializeBridgeHealthError);
  const bridgeHealth =
    bridgeHealthResult && !("error" in bridgeHealthResult)
      ? bridgeHealthResult
      : null;
  const bridgeHealthError =
    bridgeHealthResult && "error" in bridgeHealthResult
      ? bridgeHealthResult
      : null;
  if (bridgeHealth) {
    lastKnownBridgeHealth = bridgeHealth;
  }
  const annotationSource = bridgeHealth ?? lastKnownBridgeHealth;
  const annotationSourceRequiresStaleFloor =
    annotationSource !== null &&
    (useCachedBridgeHealth || bridgeHealth === null) &&
    shouldRefreshCachedBridgeHealth(annotationSource);
  let annotatedHealth = annotationSource
    ? annotateBridgeHealth(annotationSource, { bridgeQuoteDiagnostics })
    : null;
  if (
    annotationSource &&
    annotatedHealth &&
    annotationSourceRequiresStaleFloor &&
    annotatedHealth.streamFresh !== true
  ) {
    annotatedHealth = annotateBridgeHealth(annotationSource, {
      forceStale: true,
      bridgeQuoteDiagnostics,
    });
  }
  const fallbackStreamState = resolveIbkrRuntimeStreamState({
    configured: configured.ibkr,
    healthFresh: false,
    connected: false,
    authenticated: false,
  });

  return {
    bridgeQuoteDiagnostics,
    annotatedHealth,
    fallbackStreamState,
    healthError: bridgeHealthError?.error ?? null,
    healthErrorCode: bridgeHealthError?.code ?? null,
    healthErrorStatusCode: bridgeHealthError?.statusCode ?? null,
    healthErrorDetail: bridgeHealthError?.detail ?? null,
  };
}

export async function getAnnotatedBridgeHealthForTradingGuard(
  timeoutMs: number,
): Promise<AnnotatedBridgeHealth> {
  // As in refreshBridgeHealthForSession: cache the snapshot when the probe
  // resolves, even if the caller-side withTimeout fires first, so a slow-but-
  // successful probe still refreshes lastKnownBridgeHealth for the next read.
  const probe = runBridgeWork("health", () => fetchBridgeHealthWithPing());
  probe.then(
    (health) => {
      lastKnownBridgeHealth = health;
    },
    () => {},
  );
  const health = await withTimeout(
    probe,
    timeoutMs,
    () =>
      new HttpError(504, "IB Gateway health request timed out.", {
        code: "ibkr_gateway_health_timeout",
        detail: "Gateway health did not respond before the trading guard timed out.",
      }),
  );
  return annotateBridgeHealth(health, {
    bridgeQuoteDiagnostics: getBridgeQuoteStreamDiagnostics(),
  });
}
