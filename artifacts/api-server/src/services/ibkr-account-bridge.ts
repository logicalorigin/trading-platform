import type { RuntimeMode } from "../lib/runtime";
import { HttpError } from "../lib/errors";
import { IbkrClient } from "../providers/ibkr/client";
import type {
  BrokerAccountSnapshot,
  BrokerExecutionSnapshot,
  BrokerOrderSnapshot,
  BrokerPositionSnapshot,
} from "../providers/ibkr/client";
import { runGovernedWork, type WorkGovernorCategory } from "./work-governor";
import { getIbkrClientPortalClient } from "./ibkr-client-runtime";
import { readPositiveIntegerEnv } from "../lib/env";

type CacheEntry<T> = {
  payload: T;
  cachedAt: number;
};

type AccountBridgeClient = Pick<
  IbkrClient,
  "listAccounts" | "listPositions" | "listExecutions"
> &
  Partial<Pick<IbkrClient, "listOrders">>;

let accountClientFactory: () => AccountBridgeClient = getIbkrClientPortalClient;
const accountListCache = new Map<string, CacheEntry<BrokerAccountSnapshot[]>>();
const accountListInflight = new Map<string, Promise<BrokerAccountSnapshot[]>>();
const positionCache = new Map<string, CacheEntry<BrokerPositionSnapshot[]>>();
const positionInflight = new Map<string, Promise<BrokerPositionSnapshot[]>>();
const executionCache = new Map<string, CacheEntry<BrokerExecutionSnapshot[]>>();
const executionInflight = new Map<string, Promise<BrokerExecutionSnapshot[]>>();
const orderCache = new Map<string, CacheEntry<BrokerOrderSnapshot[]>>();
const orderInflight = new Map<string, Promise<BrokerOrderSnapshot[]>>();

export function __setIbkrAccountBridgeDependenciesForTests(
  input: {
    bridgeClient?: AccountBridgeClient | null;
  } | null,
): void {
  accountClientFactory = input?.bridgeClient
    ? () => input.bridgeClient as AccountBridgeClient
    : getIbkrClientPortalClient;
  accountListCache.clear();
  accountListInflight.clear();
  positionCache.clear();
  positionInflight.clear();
  executionCache.clear();
  executionInflight.clear();
  orderCache.clear();
  orderInflight.clear();
}

function accountFreshTtlMs(): number {
  return readPositiveIntegerEnv("IBKR_ACCOUNT_CACHE_TTL_MS", 2_000);
}

function executionsFreshTtlMs(): number {
  return readPositiveIntegerEnv("IBKR_ACCOUNT_EXECUTION_CACHE_TTL_MS", 10_000);
}

function cacheAgeMs(entry: CacheEntry<unknown>): number {
  return Math.max(0, Date.now() - entry.cachedAt);
}

function isFresh(
  entry: CacheEntry<unknown> | undefined,
  ttlMs: number,
): boolean {
  return Boolean(entry && cacheAgeMs(entry) <= ttlMs);
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value);
}

async function runCachedAccountRead<T extends unknown[]>({
  cache,
  inflight,
  key,
  freshTtlMs,
  workCategory = "account",
  work,
}: {
  cache: Map<string, CacheEntry<T>>;
  inflight: Map<string, Promise<T>>;
  key: string;
  freshTtlMs: number;
  workCategory?: WorkGovernorCategory;
  work: () => Promise<T>;
}): Promise<T> {
  const cached = cache.get(key);
  if (cached && isFresh(cached, freshTtlMs)) {
    return cached.payload;
  }
  if (cached) {
    cache.delete(key);
  }

  const pending = inflight.get(key);
  if (pending) {
    return pending;
  }

  const promise = runGovernedWork(workCategory, work)
    .then((payload) => {
      cache.set(key, { payload, cachedAt: Date.now() });
      return payload;
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
    work: () => accountClientFactory().listAccounts(mode),
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
    work: async () =>
      (await accountClientFactory().listPositions(input)).filter(
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
    work: () => accountClientFactory().listExecutions(input),
  });
}

export function listIbkrOrders(input: {
  accountId?: string;
  mode: RuntimeMode;
  status?: BrokerOrderSnapshot["status"];
}): Promise<BrokerOrderSnapshot[]> {
  const key = stableStringify({
    accountId: input.accountId ?? null,
    mode: input.mode,
    status: input.status ?? null,
  });
  return runCachedAccountRead({
    cache: orderCache,
    inflight: orderInflight,
    key,
    freshTtlMs: accountFreshTtlMs(),
    workCategory: "orders",
    work: async () => {
      const client = accountClientFactory();
      if (!client.listOrders) {
        throw new HttpError(503, "IBKR orders are unavailable.", {
          code: "ibkr_orders_unavailable",
          expose: true,
        });
      }
      return client.listOrders(input);
    },
  });
}

export function __resetIbkrAccountBridgeCacheForTests(): void {
  accountListCache.clear();
  accountListInflight.clear();
  positionCache.clear();
  positionInflight.clear();
  executionCache.clear();
  executionInflight.clear();
  orderCache.clear();
  orderInflight.clear();
}
