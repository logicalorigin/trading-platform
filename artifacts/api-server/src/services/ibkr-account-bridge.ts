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

type CacheEntry<T> = {
  payload: T;
  cachedAt: number;
};

const bridgeClient = new IbkrBridgeClient();
const accountListCache = new Map<string, CacheEntry<BrokerAccountSnapshot[]>>();
const accountListInflight = new Map<string, Promise<BrokerAccountSnapshot[]>>();
const positionCache = new Map<string, CacheEntry<BrokerPositionSnapshot[]>>();
const positionInflight = new Map<string, Promise<BrokerPositionSnapshot[]>>();
const executionCache = new Map<string, CacheEntry<BrokerExecutionSnapshot[]>>();
const executionInflight = new Map<string, Promise<BrokerExecutionSnapshot[]>>();

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function accountFreshTtlMs(): number {
  return readPositiveIntegerEnv("IBKR_ACCOUNT_CACHE_TTL_MS", 3_000);
}

function accountStaleTtlMs(): number {
  return readPositiveIntegerEnv("IBKR_ACCOUNT_STALE_CACHE_TTL_MS", 120_000);
}

function executionsFreshTtlMs(): number {
  return readPositiveIntegerEnv("IBKR_ACCOUNT_EXECUTION_CACHE_TTL_MS", 10_000);
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
  work,
}: {
  cache: Map<string, CacheEntry<T>>;
  inflight: Map<string, Promise<T>>;
  key: string;
  freshTtlMs: number;
  staleTtlMs: number;
  label: string;
  work: () => Promise<T>;
}): Promise<T> {
  const cached = cache.get(key);
  if (cached && isFresh(cached, freshTtlMs)) {
    return cached.payload;
  }

  const pending = inflight.get(key);
  if (pending) {
    return pending;
  }

  if (
    isBridgeWorkBackedOff("account") &&
    cached &&
    isUsableStale(cached, staleTtlMs)
  ) {
    return cached.payload;
  }

  const promise = runBridgeWork("account", work)
    .then((payload) => {
      cache.set(key, { payload, cachedAt: Date.now() });
      return payload;
    })
    .catch((error) => {
      if (
        isTransientBridgeWorkError(error) &&
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
    work: async () =>
      (await bridgeClient.listPositions(input)).filter(
        (position) => Math.abs(Number(position.quantity)) > 1e-9,
      ),
  });
}

export function listIbkrExecutions(input: {
  accountId?: string;
  days?: number;
  limit?: number;
  symbol?: string;
  providerContractId?: string | null;
}): Promise<BrokerExecutionSnapshot[]> {
  const key = stableStringify({
    accountId: input.accountId ?? null,
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
