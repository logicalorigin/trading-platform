import { HttpError } from "../lib/errors";

export type BridgeWorkCategory =
  | "health"
  | "account"
  | "orders"
  | "options"
  | "bars"
  | "quotes";

type CategoryState = {
  active: number;
  queued: number;
  openedAt: number | null;
  backoffUntil: number | null;
  failureCount: number;
  lastFailure: string | null;
  lastFailureAt: number | null;
  lastSuccessAt: number | null;
};

export type BridgeGovernorConfig = {
  concurrency: number;
  failureThreshold: number;
  backoffMs: number;
};

export type BridgeGovernorConfigSource = "default" | "env" | "override";

export type BridgeGovernorConfigSnapshot = Record<
  BridgeWorkCategory,
  BridgeGovernorConfig & {
    defaults: BridgeGovernorConfig;
    overrides: Partial<BridgeGovernorConfig>;
    sources: Record<keyof BridgeGovernorConfig, BridgeGovernorConfigSource>;
  }
>;

export type BridgeGovernorSnapshot = Record<
  BridgeWorkCategory,
  CategoryState & {
    circuitOpen: boolean;
    backoffRemainingMs: number;
  }
>;

export const BRIDGE_GOVERNOR_DEFAULT_CONFIG: Record<
  BridgeWorkCategory,
  BridgeGovernorConfig
> = {
  quotes: { concurrency: 4, failureThreshold: 4, backoffMs: 5_000 },
  bars: { concurrency: 4, failureThreshold: 4, backoffMs: 10_000 },
  health: { concurrency: 1, failureThreshold: 2, backoffMs: 10_000 },
  account: { concurrency: 1, failureThreshold: 2, backoffMs: 10_000 },
  orders: { concurrency: 1, failureThreshold: 4, backoffMs: 2_000 },
  options: { concurrency: 1, failureThreshold: 1, backoffMs: 45_000 },
};

const overrideConfig: Partial<
  Record<BridgeWorkCategory, Partial<BridgeGovernorConfig>>
> = {};

const state: Record<BridgeWorkCategory, CategoryState> = {
  quotes: emptyState(),
  bars: emptyState(),
  health: emptyState(),
  account: emptyState(),
  orders: emptyState(),
  options: emptyState(),
};

const waiters: Record<BridgeWorkCategory, Array<() => void>> = {
  quotes: [],
  bars: [],
  health: [],
  account: [],
  orders: [],
  options: [],
};

function emptyState(): CategoryState {
  return {
    active: 0,
    queued: 0,
    openedAt: null,
    backoffUntil: null,
    failureCount: 0,
    lastFailure: null,
    lastFailureAt: null,
    lastSuccessAt: null,
  };
}

function readPositiveIntegerEnv(
  name: string,
  fallback: number,
): { value: number; source: BridgeGovernorConfigSource } {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(value) && value > 0
    ? { value, source: "env" }
    : { value: fallback, source: "default" };
}

function configSnapshotFor(
  category: BridgeWorkCategory,
): BridgeGovernorConfigSnapshot[BridgeWorkCategory] {
  const defaults = BRIDGE_GOVERNOR_DEFAULT_CONFIG[category];
  const prefix = `IBKR_BRIDGE_GOVERNOR_${category.toUpperCase()}`;
  const concurrency = readPositiveIntegerEnv(
    `${prefix}_CONCURRENCY`,
    defaults.concurrency,
  );
  const failureThreshold = readPositiveIntegerEnv(
    `${prefix}_FAILURE_THRESHOLD`,
    defaults.failureThreshold,
  );
  const backoffMs = readPositiveIntegerEnv(
    `${prefix}_BACKOFF_MS`,
    defaults.backoffMs,
  );
  const overrides = overrideConfig[category] ?? {};
  const values = {
    concurrency: overrides.concurrency ?? concurrency.value,
    failureThreshold: overrides.failureThreshold ?? failureThreshold.value,
    backoffMs: overrides.backoffMs ?? backoffMs.value,
  };

  return {
    ...values,
    defaults,
    overrides,
    sources: {
      concurrency:
        overrides.concurrency === undefined ? concurrency.source : "override",
      failureThreshold:
        overrides.failureThreshold === undefined
          ? failureThreshold.source
          : "override",
      backoffMs: overrides.backoffMs === undefined ? backoffMs.source : "override",
    },
  };
}

function configFor(category: BridgeWorkCategory): BridgeGovernorConfig {
  const snapshot = configSnapshotFor(category);
  return {
    concurrency: snapshot.concurrency,
    failureThreshold: snapshot.failureThreshold,
    backoffMs: snapshot.backoffMs,
  };
}

function isBridgeGovernorConfigKey(
  key: string,
): key is keyof BridgeGovernorConfig {
  return key === "concurrency" || key === "failureThreshold" || key === "backoffMs";
}

function normalizeOverrideValue(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return Math.floor(parsed);
}

export function getBridgeGovernorConfigSnapshot(): BridgeGovernorConfigSnapshot {
  return Object.fromEntries(
    (Object.keys(BRIDGE_GOVERNOR_DEFAULT_CONFIG) as BridgeWorkCategory[]).map(
      (category) => [category, configSnapshotFor(category)],
    ),
  ) as BridgeGovernorConfigSnapshot;
}

export function getBridgeGovernorOverrides(): Partial<
  Record<BridgeWorkCategory, Partial<BridgeGovernorConfig>>
> {
  return Object.fromEntries(
    Object.entries(overrideConfig).map(([category, config]) => [
      category,
      { ...config },
    ]),
  ) as Partial<Record<BridgeWorkCategory, Partial<BridgeGovernorConfig>>>;
}

export function setBridgeGovernorOverrides(
  overrides: Partial<Record<BridgeWorkCategory, Partial<BridgeGovernorConfig>>>,
): void {
  (Object.keys(overrides) as BridgeWorkCategory[]).forEach((category) => {
    if (!BRIDGE_GOVERNOR_DEFAULT_CONFIG[category]) {
      return;
    }
    const next = { ...(overrideConfig[category] ?? {}) };
    Object.entries(overrides[category] ?? {}).forEach(([key, value]) => {
      if (!isBridgeGovernorConfigKey(key)) {
        return;
      }
      const normalized = normalizeOverrideValue(value);
      if (normalized === null) {
        delete next[key];
      } else {
        next[key] = normalized;
      }
    });
    if (Object.keys(next).length === 0) {
      delete overrideConfig[category];
    } else {
      overrideConfig[category] = next;
    }
  });
}

export function resetBridgeGovernorOverrides(
  categories?: BridgeWorkCategory[],
): void {
  const targetCategories =
    categories && categories.length > 0
      ? categories
      : (Object.keys(BRIDGE_GOVERNOR_DEFAULT_CONFIG) as BridgeWorkCategory[]);
  targetCategories.forEach((category) => {
    delete overrideConfig[category];
  });
}

export function isBridgeWorkBackedOff(category: BridgeWorkCategory): boolean {
  const current = state[category];
  const until = current.backoffUntil;
  if (!until) {
    return false;
  }
  if (until <= Date.now()) {
    current.backoffUntil = null;
    current.openedAt = null;
    return false;
  }
  return true;
}

export function getBridgeGovernorSnapshot(): BridgeGovernorSnapshot {
  const now = Date.now();
  return Object.fromEntries(
    (Object.keys(state) as BridgeWorkCategory[]).map((category) => {
      const current = state[category];
      const backoffRemainingMs = Math.max(0, (current.backoffUntil ?? 0) - now);
      return [
        category,
        {
          ...current,
          circuitOpen: backoffRemainingMs > 0,
          backoffRemainingMs,
        },
      ];
    }),
  ) as BridgeGovernorSnapshot;
}

export function isTransientBridgeWorkError(error: unknown): boolean {
  if (!(error instanceof HttpError)) {
    return false;
  }
  const cause = error.cause;
  const causeCode = cause instanceof HttpError ? cause.code : null;
  if (
    error.code === "ibkr_bridge_request_timeout" ||
    error.code === "ibkr_bridge_health_timeout" ||
    error.code === "orders_timeout" ||
    causeCode === "orders_timeout" ||
    error.code === "upstream_request_failed" ||
    error.code === "ibkr_bridge_work_backoff"
  ) {
    return true;
  }
  return (
    error.code === "upstream_http_error" &&
    (error.statusCode === 429 || error.statusCode >= 500)
  );
}

function describeError(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "Bridge work failed.";
}

function backoffError(category: BridgeWorkCategory): HttpError {
  const remainingMs = getBridgeGovernorSnapshot()[category].backoffRemainingMs;
  return new HttpError(503, `IBKR bridge ${category} work is backed off.`, {
    code: "ibkr_bridge_work_backoff",
    detail: `Bridge ${category} work is backed off for ${Math.round(remainingMs)}ms.`,
  });
}

export function recordBridgeWorkFailure(
  category: BridgeWorkCategory,
  error: unknown,
): void {
  if (!isTransientBridgeWorkError(error)) {
    return;
  }

  const current = state[category];
  const config = configFor(category);
  current.failureCount += 1;
  current.lastFailure = describeError(error);
  current.lastFailureAt = Date.now();
  if (current.failureCount >= config.failureThreshold) {
    current.openedAt ??= current.lastFailureAt;
    current.backoffUntil = current.lastFailureAt + config.backoffMs;
  }
}

export function recordBridgeWorkSuccess(category: BridgeWorkCategory): void {
  const current = state[category];
  current.failureCount = 0;
  current.openedAt = null;
  current.backoffUntil = null;
  current.lastSuccessAt = Date.now();
}

async function acquireSlot(category: BridgeWorkCategory): Promise<void> {
  const current = state[category];
  const config = configFor(category);
  if (current.active < config.concurrency) {
    current.active += 1;
    return;
  }

  current.queued += 1;
  await new Promise<void>((resolve) => {
    waiters[category].push(resolve);
  });
  current.queued = Math.max(0, current.queued - 1);
  current.active += 1;
}

function releaseSlot(category: BridgeWorkCategory): void {
  const current = state[category];
  current.active = Math.max(0, current.active - 1);
  const next = waiters[category].shift();
  next?.();
}

export async function runBridgeWork<T>(
  category: BridgeWorkCategory,
  work: () => Promise<T>,
): Promise<T> {
  if (isBridgeWorkBackedOff(category)) {
    throw backoffError(category);
  }
  await acquireSlot(category);
  if (isBridgeWorkBackedOff(category)) {
    releaseSlot(category);
    throw backoffError(category);
  }
  try {
    const result = await work();
    recordBridgeWorkSuccess(category);
    return result;
  } catch (error) {
    recordBridgeWorkFailure(category, error);
    throw error;
  } finally {
    releaseSlot(category);
  }
}

export function __resetBridgeGovernorForTests(): void {
  (Object.keys(state) as BridgeWorkCategory[]).forEach((category) => {
    Object.assign(state[category], emptyState());
    waiters[category].splice(0);
  });
}
