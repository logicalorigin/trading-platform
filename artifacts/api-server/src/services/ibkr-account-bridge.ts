import { logger } from "../lib/logger";
import type { RuntimeMode } from "../lib/runtime";
import { IbkrBridgeClient } from "../providers/ibkr/bridge-client";
import type {
  BrokerAccountSnapshot,
  BrokerExecutionSnapshot,
  BrokerPositionSnapshot,
} from "../providers/ibkr/client";
import {
  isBridgeWorkBackedOff,
  isTransientBridgeWorkError,
  runBridgeWork,
} from "./bridge-governor";
import {
  getBridgeHealthForSession,
  type AnnotatedBridgeHealth,
} from "./platform-bridge-health";

type CacheEntry<T> = {
  payload: T;
  cachedAt: number;
};

type AccountBridgeHealthReader = typeof getBridgeHealthForSession;
type AccountBridgeClient = Pick<
  IbkrBridgeClient,
  "listAccounts" | "listPositions" | "listExecutions"
>;

let bridgeClient: AccountBridgeClient = new IbkrBridgeClient();
let readBridgeHealthForAccountRead: AccountBridgeHealthReader =
  getBridgeHealthForSession;
const accountListCache = new Map<string, CacheEntry<BrokerAccountSnapshot[]>>();
const accountListInflight = new Map<string, Promise<BrokerAccountSnapshot[]>>();
const positionCache = new Map<string, CacheEntry<BrokerPositionSnapshot[]>>();
const positionInflight = new Map<string, Promise<BrokerPositionSnapshot[]>>();
const executionCache = new Map<string, CacheEntry<BrokerExecutionSnapshot[]>>();
const executionInflight = new Map<string, Promise<BrokerExecutionSnapshot[]>>();

export function __setIbkrAccountBridgeDependenciesForTests(
  input: {
    bridgeClient?: AccountBridgeClient | null;
    getBridgeHealthForSession?: AccountBridgeHealthReader | null;
  } | null,
): void {
  bridgeClient = input?.bridgeClient ?? new IbkrBridgeClient();
  readBridgeHealthForAccountRead =
    input?.getBridgeHealthForSession ?? getBridgeHealthForSession;
  accountListCache.clear();
  accountListInflight.clear();
  positionCache.clear();
  positionInflight.clear();
  executionCache.clear();
  executionInflight.clear();
}

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function accountFreshTtlMs(): number {
  return readPositiveIntegerEnv("IBKR_ACCOUNT_CACHE_TTL_MS", 2_000);
}

function accountStaleTtlMs(): number {
  return readPositiveIntegerEnv("IBKR_ACCOUNT_STALE_CACHE_TTL_MS", 120_000);
}

function executionsFreshTtlMs(): number {
  return readPositiveIntegerEnv("IBKR_ACCOUNT_EXECUTION_CACHE_TTL_MS", 10_000);
}

function executionsInitialWaitMs(): number {
  return readPositiveIntegerEnv("IBKR_ACCOUNT_EXECUTION_INITIAL_WAIT_MS", 1_500);
}

function normalizeInitialWaitMs(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return Math.max(0, Math.floor(value));
}

function waitForFallback<T>(ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(fallback), ms);
    timeout.unref?.();
  });
}

function cacheAgeMs(entry: CacheEntry<unknown>): number {
  return Math.max(0, Date.now() - entry.cachedAt);
}

function isFresh(entry: CacheEntry<unknown> | undefined, ttlMs: number): boolean {
  return Boolean(entry && cacheAgeMs(entry) <= ttlMs);
}

function isUsableStale(
  entry: CacheEntry<unknown> | undefined,
  staleTtlMs: number,
): boolean {
  return Boolean(entry && cacheAgeMs(entry) <= staleTtlMs);
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value);
}

async function runCachedAccountRead<T extends unknown[]>({
  cache,
  inflight,
  key,
  freshTtlMs,
  staleTtlMs,
  label,
  initialWaitMs,
  cacheEmptyPayload = true,
  allowStaleFallback = true,
  serveStaleWhileRefreshing = true,
  preserveNonEmptyStaleOnEmpty = false,
  work,
}: {
  cache: Map<string, CacheEntry<T>>;
  inflight: Map<string, Promise<T>>;
  key: string;
  freshTtlMs: number;
  staleTtlMs: number;
  label: string;
  initialWaitMs?: number | null;
  cacheEmptyPayload?: boolean;
  allowStaleFallback?: boolean;
  serveStaleWhileRefreshing?: boolean;
  preserveNonEmptyStaleOnEmpty?: boolean;
  work: () => Promise<T>;
}): Promise<T> {
  const cached = cache.get(key);
  if (cached && isFresh(cached, freshTtlMs)) {
    return cached.payload;
  }
  const staleCached =
    cached && isUsableStale(cached, staleTtlMs) ? cached : null;
  const normalizedInitialWaitMs = normalizeInitialWaitMs(initialWaitMs);

  const pending = inflight.get(key);
  if (pending) {
    if (allowStaleFallback && serveStaleWhileRefreshing && staleCached) {
      return staleCached.payload;
    }
    if (normalizedInitialWaitMs !== null) {
      return Promise.race([
        pending,
        waitForFallback(normalizedInitialWaitMs, [] as unknown as T),
      ]);
    }
    return pending;
  }

  if (allowStaleFallback && isBridgeWorkBackedOff("account") && staleCached) {
    return staleCached.payload;
  }

  const health = await readBridgeHealthForAccountRead({
    waitForInitialRefresh: false,
    waitForStaleRefresh: false,
  }).catch((): AnnotatedBridgeHealth | null => null);
  const accountBridgeReady = Boolean(
    health?.bridgeReachable &&
      health.socketConnected &&
      health.brokerServerConnected &&
      health.authenticated &&
      health.accountsLoaded,
  );
  if (!accountBridgeReady) {
    if (allowStaleFallback && staleCached) {
      return staleCached.payload;
    }
    logger.debug(
      {
        label,
        key,
        strictReason: health?.strictReason ?? "health_unavailable",
      },
      "Skipping IBKR account bridge read until Gateway is ready",
    );
    return [] as unknown as T;
  }

  const promise = runBridgeWork("account", work)
    .then((payload) => {
      if (
        preserveNonEmptyStaleOnEmpty &&
        allowStaleFallback &&
        payload.length === 0 &&
        staleCached &&
        staleCached.payload.length > 0
      ) {
        logger.warn(
          { label, key, cacheAgeMs: cacheAgeMs(staleCached) },
          "Preserving non-empty IBKR account bridge cache after empty refresh",
        );
        return staleCached.payload;
      }
      if (payload.length > 0 || cacheEmptyPayload) {
        cache.set(key, { payload, cachedAt: Date.now() });
      }
      return payload;
    })
    .catch((error) => {
      if (
        isTransientBridgeWorkError(error) &&
        allowStaleFallback &&
        cached &&
        isUsableStale(cached, staleTtlMs)
      ) {
        logger.warn(
          { err: error, label, key, cacheAgeMs: cacheAgeMs(cached) },
          "Returning cached IBKR account bridge read after transient failure",
        );
        return cached.payload;
      }
      if (isTransientBridgeWorkError(error)) {
        logger.warn(
          { err: error, label, key },
          "Returning empty IBKR account bridge read after transient failure",
        );
        return [] as unknown as T;
      }
      throw error;
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, promise);
  if (allowStaleFallback && serveStaleWhileRefreshing && staleCached) {
    promise.catch((error) => {
      logger.warn(
        { err: error, label, key, cacheAgeMs: cacheAgeMs(staleCached) },
        "Background IBKR account bridge refresh failed after serving stale cache",
      );
    });
    return staleCached.payload;
  }
  if (normalizedInitialWaitMs !== null) {
    return Promise.race([
      promise,
      waitForFallback(normalizedInitialWaitMs, [] as unknown as T),
    ]);
  }
  return promise;
}

export function listIbkrAccounts(
  mode: RuntimeMode,
): Promise<BrokerAccountSnapshot[]> {
  return runCachedAccountRead({
    cache: accountListCache,
    inflight: accountListInflight,
    key: mode,
    freshTtlMs: accountFreshTtlMs(),
    staleTtlMs: accountStaleTtlMs(),
    label: "accounts",
    work: () => bridgeClient.listAccounts(mode),
  });
}

export function listIbkrPositions(input: {
  accountId?: string;
  mode: RuntimeMode;
}): Promise<BrokerPositionSnapshot[]> {
  const key = stableStringify({
    accountId: input.accountId ?? null,
    mode: input.mode,
  });
  return runCachedAccountRead({
    cache: positionCache,
    inflight: positionInflight,
    key,
    freshTtlMs: accountFreshTtlMs(),
    staleTtlMs: accountStaleTtlMs(),
    label: "positions",
    cacheEmptyPayload: false,
    allowStaleFallback: true,
    serveStaleWhileRefreshing: false,
    work: async () =>
      (await bridgeClient.listPositions(input)).filter(
        (position) => Math.abs(Number(position.quantity)) > 1e-9,
      ),
  });
}

export function listIbkrExecutions(input: {
  accountId?: string;
  mode?: RuntimeMode;
  days?: number;
  limit?: number;
  symbol?: string;
  providerContractId?: string | null;
}): Promise<BrokerExecutionSnapshot[]> {
  const key = stableStringify({
    accountId: input.accountId ?? null,
    mode: input.mode ?? null,
    days: input.days ?? null,
    limit: input.limit ?? null,
    symbol: input.symbol ?? null,
    providerContractId: input.providerContractId ?? null,
  });
  return runCachedAccountRead({
    cache: executionCache,
    inflight: executionInflight,
    key,
    freshTtlMs: executionsFreshTtlMs(),
    staleTtlMs: accountStaleTtlMs(),
    label: "executions",
    initialWaitMs: executionsInitialWaitMs(),
    preserveNonEmptyStaleOnEmpty: true,
    work: () => bridgeClient.listExecutions(input),
  });
}

export function __resetIbkrAccountBridgeCacheForTests(): void {
  accountListCache.clear();
  accountListInflight.clear();
  positionCache.clear();
  positionInflight.clear();
  executionCache.clear();
  executionInflight.clear();
}
