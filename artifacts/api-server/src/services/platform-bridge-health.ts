import { performance } from "node:perf_hooks";
import { HttpError, isHttpError } from "../lib/errors";
import { logger } from "../lib/logger";
import { getProviderConfiguration } from "../lib/runtime";
import { IbkrBridgeClient } from "../providers/ibkr/bridge-client";
import { getBridgeQuoteStreamDiagnostics } from "./bridge-quote-stream";
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

function bridgeStreamFreshMs(): number {
  const configured = Number.parseInt(
    process.env["IBKR_BRIDGE_STREAM_FRESH_MS"] ??
      process.env["IBKR_QUOTE_STREAM_STALL_MS"] ??
      "45000",
    10,
  );
  return Number.isFinite(configured) && configured > 0 ? configured : 45_000;
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

function hasCurrentBridgeDiagnostics(health: BridgeHealthSnapshot): boolean {
  return Boolean(health.diagnostics && typeof health.diagnostics === "object");
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
  const bridgeReachable = options.forceStale === true ? false : true;
  const subscriptions =
    health.diagnostics &&
    typeof health.diagnostics === "object" &&
    "subscriptions" in health.diagnostics
      ? (health.diagnostics as Record<string, unknown>)["subscriptions"]
      : null;
  const bridgeQuoteStreamAgeMs =
    options.bridgeQuoteDiagnostics?.streamActive === true
      ? (options.bridgeQuoteDiagnostics.lastSignalAgeMs ??
        options.bridgeQuoteDiagnostics.lastEventAgeMs)
      : null;
  const desiredSymbolCount = Math.max(
    options.bridgeQuoteDiagnostics?.unionSymbolCount ?? 0,
    numericRecordValue(subscriptions, "activeQuoteSubscriptions") ?? 0,
    numericRecordValue(subscriptions, "prewarmSymbolCount") ?? 0,
    numericRecordValue(subscriptions, "quoteListenerCount") ?? 0,
  );
  const lastStreamEventAgeMs = minFinite(
    numericRecordValue(subscriptions, "lastQuoteAgeMs"),
    numericRecordValue(subscriptions, "lastAggregateSourceAgeMs"),
    bridgeQuoteStreamAgeMs,
  );
  const streamFresh =
    lastStreamEventAgeMs !== null && lastStreamEventAgeMs <= bridgeStreamFreshMs();
  const brokerServerConnected =
    health.brokerServerConnected ?? Boolean(health.connected);
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
    Boolean(health.connected),
  );
  const strictReason = resolveIbkrRuntimeStrictReason({
    healthFresh,
    connected: Boolean(health.connected),
    brokerServerConnected,
    authenticated: Boolean(health.authenticated),
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
    connected: Boolean(health.connected),
    brokerServerConnected,
    authenticated: Boolean(health.authenticated),
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
  const strictFields = {
    healthFresh,
    healthAgeMs,
    stale: !healthFresh,
    bridgeReachable,
    socketConnected: Boolean(health.connected),
    brokerServerConnected,
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
          Boolean(rawTwsConnection.reachable || health.connected),
        ),
        reachable: Boolean(rawTwsConnection.reachable && bridgeReachable),
      }
    : undefined;

  return {
    ...health,
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

async function refreshBridgeHealthForSession(
  timeoutMs: number,
  context: string,
): Promise<void> {
  if (isBridgeWorkBackedOff("health")) {
    return;
  }

  try {
    const health = await withTimeout(
      runBridgeWork("health", () => fetchBridgeHealthWithPing()),
      timeoutMs,
      () =>
        new HttpError(504, "IBKR bridge health request timed out.", {
          code: "ibkr_bridge_health_timeout",
          detail: `Bridge health did not respond within ${timeoutMs}ms.`,
        }),
    );
    lastKnownBridgeHealth = health;
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

export async function getBridgeHealthForSession(): Promise<AnnotatedBridgeHealth | null> {
  if (!getProviderConfiguration().ibkr) {
    return null;
  }

  const initialTimeoutMs = sessionBridgeHealthInitialTimeoutMs();
  if (!lastKnownBridgeHealth && initialTimeoutMs > 0) {
    await refreshBridgeHealthForSession(
      initialTimeoutMs,
      "session_initial",
    );
  }

  if (!lastKnownBridgeHealth) {
    scheduleBridgeHealthRefreshForSession("session_background");
    return null;
  }

  let annotated = annotateBridgeHealth(lastKnownBridgeHealth, {
    bridgeQuoteDiagnostics: getBridgeQuoteStreamDiagnostics(),
  });
  if (
    (annotated.healthAgeMs === null ||
      annotated.healthAgeMs > bridgeHealthFreshMs()) &&
    !lastBridgeHealthRefreshPromise &&
    !isBridgeWorkBackedOff("health")
  ) {
    await refreshBridgeHealthForSession(
      sessionBridgeHealthStaleTimeoutMs(),
      "session_stale",
    );
    if (lastKnownBridgeHealth) {
      annotated = annotateBridgeHealth(lastKnownBridgeHealth, {
        bridgeQuoteDiagnostics: getBridgeQuoteStreamDiagnostics(),
      });
    }
  }
  if (
    annotated.healthAgeMs === null ||
    annotated.healthAgeMs > Math.floor(bridgeHealthFreshMs() / 2)
  ) {
    scheduleBridgeHealthRefreshForSession("session_background");
  }

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

export async function getRuntimeBridgeHealthState() {
  const configured = getProviderConfiguration();
  const bridgeHealthTimeoutMs = runtimeDiagnosticsTimeoutMs();
  const bridgeQuoteDiagnostics = getBridgeQuoteStreamDiagnostics();
  const cachedBridgeHealthAgeMs =
    lastKnownBridgeHealth == null
      ? null
      : (() => {
          const updatedAtMs = timestampMs(lastKnownBridgeHealth.updatedAt);
          return updatedAtMs === null ? null : Math.max(0, Date.now() - updatedAtMs);
        })();
  const useCachedBridgeHealth =
    lastKnownBridgeHealth !== null &&
    cachedBridgeHealthAgeMs !== null &&
    cachedBridgeHealthAgeMs <= runtimeDiagnosticsStaleHealthCacheMs();
  if (
    useCachedBridgeHealth &&
    cachedBridgeHealthAgeMs > Math.floor(bridgeHealthFreshMs() / 2)
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
  const annotatedHealth = bridgeHealth
    ? annotateBridgeHealth(bridgeHealth, { bridgeQuoteDiagnostics })
    : lastKnownBridgeHealth
      ? annotateBridgeHealth(lastKnownBridgeHealth, {
          forceStale: true,
          bridgeQuoteDiagnostics,
        })
      : null;
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
  const health = await withTimeout(
    runBridgeWork("health", () => fetchBridgeHealthWithPing()),
    timeoutMs,
    () =>
      new HttpError(504, "IB Gateway health request timed out.", {
        code: "ibkr_gateway_health_timeout",
        detail: "Gateway health did not respond before the trading guard timed out.",
      }),
  );
  lastKnownBridgeHealth = health;
  return annotateBridgeHealth(health, {
    bridgeQuoteDiagnostics: getBridgeQuoteStreamDiagnostics(),
  });
}
