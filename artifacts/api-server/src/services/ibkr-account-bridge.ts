import { createHash } from "node:crypto";

import type { RuntimeMode } from "../lib/runtime";
import { getIbkrRuntimeConfig } from "../lib/runtime";
import { HttpError } from "../lib/errors";
import { IbkrClient } from "../providers/ibkr/client";
import type {
  BrokerAccountSnapshot,
  BrokerExecutionSnapshot,
  BrokerOrderSnapshot,
  BrokerPositionSnapshot,
} from "../providers/ibkr/client";
import {
  runGovernedWork,
  type WorkGovernorCategory,
  type WorkGovernorOperation,
} from "./work-governor";
import {
  assertIbkrClientPortalGatewaySnapshot,
  getIbkrClientPortalClient,
  getIbkrClientPortalGatewaySnapshot,
  type IbkrClientPortalGatewaySnapshot,
} from "./ibkr-client-runtime";
import { getIbkrPortalUserId } from "./ibkr-portal-context";
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

type AccountBridgeScope = {
  gateway: IbkrClientPortalGatewaySnapshot | null;
  key: string;
};

function resolveAccountBridgeScope(): AccountBridgeScope {
  const appUserId = getIbkrPortalUserId();
  if (appUserId) {
    const gateway = getIbkrClientPortalGatewaySnapshot();
    if (!gateway) {
      throw new HttpError(503, "IBKR Client Portal is not configured.", {
        code: "ibkr_client_portal_not_configured",
        expose: true,
      });
    }
    return { gateway, key: stableStringify({ scope: "user", ...gateway }) };
  }

  // Keep global/background reads stable without placing runtime credentials in
  // process-wide cache keys.
  const fingerprint = createHash("sha256")
    .update(stableStringify(getIbkrRuntimeConfig()))
    .digest("base64url");
  return { gateway: null, key: `global:${fingerprint}` };
}

function clientForAccountBridgeScope(
  scope: AccountBridgeScope,
): AccountBridgeClient {
  if (scope.gateway) {
    assertIbkrClientPortalGatewaySnapshot(scope.gateway);
  }
  return accountClientFactory();
}

async function runCachedAccountRead<T extends unknown[]>({
  cache,
  inflight,
  key,
  freshTtlMs,
  operation,
  workCategory = "account",
  work,
}: {
  cache: Map<string, CacheEntry<T>>;
  inflight: Map<string, Promise<T>>;
  key: string;
  freshTtlMs: number;
  operation: WorkGovernorOperation;
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

  const promise = runGovernedWork(workCategory, work, { operation })
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

async function runScopedCachedAccountRead<T extends unknown[]>({
  requestKey,
  work,
  ...options
}: Omit<Parameters<typeof runCachedAccountRead<T>>[0], "key" | "work"> & {
  requestKey: unknown;
  work: (client: AccountBridgeClient) => Promise<T>;
}): Promise<T> {
  const scope = resolveAccountBridgeScope();
  return runCachedAccountRead({
    ...options,
    key: stableStringify({ scope: scope.key, request: requestKey }),
    work: () => work(clientForAccountBridgeScope(scope)),
  });
}

export function listIbkrAccounts(
  mode: RuntimeMode,
): Promise<BrokerAccountSnapshot[]> {
  return runScopedCachedAccountRead({
    cache: accountListCache,
    inflight: accountListInflight,
    requestKey: mode,
    freshTtlMs: accountFreshTtlMs(),
    operation: "accounts",
    work: (client) => client.listAccounts(mode),
  });
}

export function listIbkrPositions(input: {
  accountId?: string;
  mode: RuntimeMode;
}): Promise<BrokerPositionSnapshot[]> {
  const requestKey = {
    accountId: input.accountId ?? null,
    mode: input.mode,
  };
  return runScopedCachedAccountRead({
    cache: positionCache,
    inflight: positionInflight,
    requestKey,
    freshTtlMs: accountFreshTtlMs(),
    operation: "positions",
    work: async (client) =>
      (await client.listPositions(input)).filter(
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
  const requestKey = {
    accountId: input.accountId ?? null,
    mode: input.mode ?? null,
    days: input.days ?? null,
    limit: input.limit ?? null,
    symbol: input.symbol ?? null,
    providerContractId: input.providerContractId ?? null,
  };
  return runScopedCachedAccountRead({
    cache: executionCache,
    inflight: executionInflight,
    requestKey,
    freshTtlMs: executionsFreshTtlMs(),
    operation: "executions",
    work: (client) => client.listExecutions(input),
  });
}

export function listIbkrOrders(input: {
  accountId?: string;
  mode: RuntimeMode;
  status?: BrokerOrderSnapshot["status"];
}): Promise<BrokerOrderSnapshot[]> {
  const requestKey = {
    accountId: input.accountId ?? null,
    mode: input.mode,
    status: input.status ?? null,
  };
  return runScopedCachedAccountRead({
    cache: orderCache,
    inflight: orderInflight,
    requestKey,
    freshTtlMs: accountFreshTtlMs(),
    operation: "orders",
    workCategory: "orders",
    work: async (client) => {
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
