import { HttpError } from "../lib/errors";

export type WorkGovernorCategory = "account" | "orders";

type CategoryState = {
  active: number;
  queued: number;
  openedAt: number | null;
  firstOpenedAt: number | null;
  backoffUntil: number | null;
  failureCount: number;
  lastFailure: string | null;
  lastFailureAt: number | null;
  lastSuccessAt: number | null;
};

export type WorkGovernorConfig = {
  concurrency: number;
  failureThreshold: number;
  backoffMs: number;
};

export type WorkGovernorOptions = {
  bypassBackoff?: boolean;
  recordFailure?: boolean;
  signal?: AbortSignal;
};

export type WorkGovernorSnapshot = Record<
  WorkGovernorCategory,
  CategoryState & {
    circuitOpen: boolean;
    backoffRemainingMs: number;
  }
>;

const DEFAULT_CONFIG: Record<WorkGovernorCategory, WorkGovernorConfig> = {
  account: { concurrency: 2, failureThreshold: 2, backoffMs: 15_000 },
  orders: { concurrency: 1, failureThreshold: 4, backoffMs: 2_000 },
};

const state: Record<WorkGovernorCategory, CategoryState> = {
  account: emptyState(),
  orders: emptyState(),
};

const waiters: Record<WorkGovernorCategory, Array<() => void>> = {
  account: [],
  orders: [],
};

function emptyState(): CategoryState {
  return {
    active: 0,
    queued: 0,
    openedAt: null,
    firstOpenedAt: null,
    backoffUntil: null,
    failureCount: 0,
    lastFailure: null,
    lastFailureAt: null,
    lastSuccessAt: null,
  };
}

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function configFor(category: WorkGovernorCategory): WorkGovernorConfig {
  const defaults = DEFAULT_CONFIG[category];
  const prefix = `WORK_GOVERNOR_${category.toUpperCase()}`;
  const legacyPrefix = `IBKR_BRIDGE_GOVERNOR_${category.toUpperCase()}`;
  return {
    concurrency: readPositiveIntegerEnv(
      `${prefix}_CONCURRENCY`,
      readPositiveIntegerEnv(`${legacyPrefix}_CONCURRENCY`, defaults.concurrency),
    ),
    failureThreshold: readPositiveIntegerEnv(
      `${prefix}_FAILURE_THRESHOLD`,
      readPositiveIntegerEnv(
        `${legacyPrefix}_FAILURE_THRESHOLD`,
        defaults.failureThreshold,
      ),
    ),
    backoffMs: readPositiveIntegerEnv(
      `${prefix}_BACKOFF_MS`,
      readPositiveIntegerEnv(`${legacyPrefix}_BACKOFF_MS`, defaults.backoffMs),
    ),
  };
}

export function isWorkBackedOff(category: WorkGovernorCategory): boolean {
  const current = state[category];
  const until = current.backoffUntil;
  if (!until) return false;
  if (until <= Date.now()) {
    current.backoffUntil = null;
    current.openedAt = null;
    return false;
  }
  return true;
}

export function getWorkGovernorSnapshot(): WorkGovernorSnapshot {
  const now = Date.now();
  return Object.fromEntries(
    (Object.keys(state) as WorkGovernorCategory[]).map((category) => {
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
  ) as WorkGovernorSnapshot;
}

export function isTransientWorkError(error: unknown): boolean {
  if (!(error instanceof HttpError)) return false;
  const cause = error.cause;
  const causeCode = cause instanceof HttpError ? cause.code : null;
  return (
    error.code === "orders_timeout" ||
    causeCode === "orders_timeout" ||
    error.code === "upstream_request_failed" ||
    error.code === "work_backoff" ||
    error.code === "ibkr_bridge_work_backoff" ||
    error.code === "ibkr_request_aborted" ||
    (error.code === "upstream_http_error" &&
      (error.statusCode === 429 || error.statusCode >= 500))
  );
}

function describeError(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "Work failed.";
}

function backoffError(category: WorkGovernorCategory): HttpError {
  const remainingMs = getWorkGovernorSnapshot()[category].backoffRemainingMs;
  return new HttpError(503, `${category} work is backed off.`, {
    code: "work_backoff",
    detail: `${category} work is backed off for ${Math.round(remainingMs)}ms.`,
  });
}

export function recordWorkFailure(
  category: WorkGovernorCategory,
  error: unknown,
): void {
  if (!isTransientWorkError(error)) return;
  const current = state[category];
  const config = configFor(category);
  current.failureCount += 1;
  current.lastFailure = describeError(error);
  current.lastFailureAt = Date.now();
  if (current.failureCount >= config.failureThreshold) {
    current.openedAt ??= current.lastFailureAt;
    current.firstOpenedAt ??= current.lastFailureAt;
    current.backoffUntil = current.lastFailureAt + config.backoffMs;
  }
}

export function recordWorkSuccess(category: WorkGovernorCategory): void {
  const current = state[category];
  current.failureCount = 0;
  current.openedAt = null;
  current.firstOpenedAt = null;
  current.backoffUntil = null;
  current.lastSuccessAt = Date.now();
}

function abortError(signal?: AbortSignal): unknown {
  return signal?.reason ?? new Error("Work aborted.");
}

async function acquireSlot(
  category: WorkGovernorCategory,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) throw abortError(signal);
  const current = state[category];
  const config = configFor(category);
  if (current.active < config.concurrency) {
    current.active += 1;
    return;
  }

  current.queued += 1;
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let cleanup = () => {};
    const waiter = () => {
      if (settled) return;
      settled = true;
      cleanup();
      current.queued = Math.max(0, current.queued - 1);
      current.active += 1;
      resolve();
    };
    const abort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      const index = waiters[category].indexOf(waiter);
      if (index >= 0) waiters[category].splice(index, 1);
      current.queued = Math.max(0, current.queued - 1);
      reject(abortError(signal));
    };
    cleanup = () => signal?.removeEventListener("abort", abort);
    waiters[category].push(waiter);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function releaseSlot(category: WorkGovernorCategory): void {
  const current = state[category];
  current.active = Math.max(0, current.active - 1);
  waiters[category].shift()?.();
}

export async function runGovernedWork<T>(
  category: WorkGovernorCategory,
  work: () => Promise<T>,
  options: WorkGovernorOptions = {},
): Promise<T> {
  const bypassBackoff = Boolean(options.bypassBackoff);
  const signal = options.signal;
  if (!bypassBackoff && isWorkBackedOff(category)) throw backoffError(category);
  await acquireSlot(category, signal);
  if (signal?.aborted) {
    releaseSlot(category);
    throw abortError(signal);
  }
  if (!bypassBackoff && isWorkBackedOff(category)) {
    releaseSlot(category);
    throw backoffError(category);
  }
  try {
    const result = await work();
    recordWorkSuccess(category);
    return result;
  } catch (error) {
    if (options.recordFailure !== false && !signal?.aborted) {
      recordWorkFailure(category, error);
    }
    throw error;
  } finally {
    releaseSlot(category);
  }
}

export function __resetWorkGovernorForTests(): void {
  (Object.keys(state) as WorkGovernorCategory[]).forEach((category) => {
    Object.assign(state[category], emptyState());
    waiters[category].splice(0);
  });
}
