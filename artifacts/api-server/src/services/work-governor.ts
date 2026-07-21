import { HttpError } from "../lib/errors";
import { readPositiveIntegerEnv } from "../lib/env";

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

export type WorkGovernorOperation =
  | "accounts"
  | "positions"
  | "executions"
  | "orders";

export type WorkGovernorTiming = {
  category: WorkGovernorCategory;
  operation: WorkGovernorOperation | null;
  outcome: "success" | "failure" | "canceled" | "backoff";
  queued: boolean;
  queueWaitMs: number;
  executionDurationMs: number;
  totalDurationMs: number;
};

export type WorkGovernorOptions = {
  bypassBackoff?: boolean;
  operation?: WorkGovernorOperation;
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

// Keep the finite environment surface literal so audit:env can verify that
// every active setting is documented in .env.example.
const WORK_GOVERNOR_ENV_KEYS = [
  {
    category: "account",
    concurrency: "WORK_GOVERNOR_ACCOUNT_CONCURRENCY",
    legacyConcurrency: "IBKR_BRIDGE_GOVERNOR_ACCOUNT_CONCURRENCY",
    failureThreshold: "WORK_GOVERNOR_ACCOUNT_FAILURE_THRESHOLD",
    legacyFailureThreshold:
      "IBKR_BRIDGE_GOVERNOR_ACCOUNT_FAILURE_THRESHOLD",
    backoffMs: "WORK_GOVERNOR_ACCOUNT_BACKOFF_MS",
    legacyBackoffMs: "IBKR_BRIDGE_GOVERNOR_ACCOUNT_BACKOFF_MS",
  },
  {
    category: "orders",
    concurrency: "WORK_GOVERNOR_ORDERS_CONCURRENCY",
    legacyConcurrency: "IBKR_BRIDGE_GOVERNOR_ORDERS_CONCURRENCY",
    failureThreshold: "WORK_GOVERNOR_ORDERS_FAILURE_THRESHOLD",
    legacyFailureThreshold: "IBKR_BRIDGE_GOVERNOR_ORDERS_FAILURE_THRESHOLD",
    backoffMs: "WORK_GOVERNOR_ORDERS_BACKOFF_MS",
    legacyBackoffMs: "IBKR_BRIDGE_GOVERNOR_ORDERS_BACKOFF_MS",
  },
] as const;

const state: Record<WorkGovernorCategory, CategoryState> = {
  account: emptyState(),
  orders: emptyState(),
};

const waiters: Record<WorkGovernorCategory, Array<() => void>> = {
  account: [],
  orders: [],
};

let timingListener: ((timing: WorkGovernorTiming) => void) | null = null;

export function setWorkGovernorTimingListener(
  listener: ((timing: WorkGovernorTiming) => void) | null,
): void {
  timingListener = listener;
}

function elapsedMs(startedAt: number, completedAt: number): number {
  return Math.max(0, Math.round((completedAt - startedAt) * 1_000) / 1_000);
}

function emitWorkGovernorTiming(timing: WorkGovernorTiming): void {
  try {
    timingListener?.(timing);
  } catch {
    // Diagnostics must never affect governed work.
  }
}

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

function configFor(category: WorkGovernorCategory): WorkGovernorConfig {
  const defaults = DEFAULT_CONFIG[category];
  const envKeys = WORK_GOVERNOR_ENV_KEYS.find(
    (candidate) => candidate.category === category,
  )!;
  return {
    concurrency: readPositiveIntegerEnv(
      envKeys.concurrency,
      readPositiveIntegerEnv(envKeys.legacyConcurrency, defaults.concurrency),
    ),
    failureThreshold: readPositiveIntegerEnv(
      envKeys.failureThreshold,
      readPositiveIntegerEnv(
        envKeys.legacyFailureThreshold,
        defaults.failureThreshold,
      ),
    ),
    backoffMs: readPositiveIntegerEnv(
      envKeys.backoffMs,
      readPositiveIntegerEnv(envKeys.legacyBackoffMs, defaults.backoffMs),
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
  if (!(error instanceof HttpError)) return "work_failed";
  const cause = error.cause;
  return (
    error.code ??
    (cause instanceof HttpError ? cause.code : null) ??
    "http_error"
  );
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
  const startedAt = performance.now();
  let acquiredAt: number | null = null;
  let executionStartedAt: number | null = null;
  let outcome: WorkGovernorTiming["outcome"] = "failure";
  let queued = false;
  let acquired = false;
  try {
    if (!bypassBackoff && isWorkBackedOff(category)) {
      outcome = "backoff";
      throw backoffError(category);
    }
    if (signal?.aborted) {
      outcome = "canceled";
      throw abortError(signal);
    }
    queued = state[category].active >= configFor(category).concurrency;
    await acquireSlot(category, signal);
    acquired = true;
    acquiredAt = performance.now();
    if (signal?.aborted) {
      outcome = "canceled";
      throw abortError(signal);
    }
    if (!bypassBackoff && isWorkBackedOff(category)) {
      outcome = "backoff";
      throw backoffError(category);
    }
    executionStartedAt = performance.now();
    const result = await work();
    recordWorkSuccess(category);
    outcome = "success";
    return result;
  } catch (error) {
    if (signal?.aborted) {
      outcome = "canceled";
    }
    if (
      executionStartedAt !== null &&
      options.recordFailure !== false &&
      !signal?.aborted
    ) {
      recordWorkFailure(category, error);
    }
    throw error;
  } finally {
    const completedAt = performance.now();
    if (acquired) releaseSlot(category);
    emitWorkGovernorTiming({
      category,
      operation: options.operation ?? null,
      outcome,
      queued,
      queueWaitMs:
        queued && acquiredAt !== null
          ? elapsedMs(startedAt, acquiredAt)
          : queued
            ? elapsedMs(startedAt, completedAt)
            : 0,
      executionDurationMs:
        executionStartedAt === null
          ? 0
          : elapsedMs(executionStartedAt, completedAt),
      totalDurationMs: elapsedMs(startedAt, completedAt),
    });
  }
}

export function __resetWorkGovernorForTests(): void {
  timingListener = null;
  (Object.keys(state) as WorkGovernorCategory[]).forEach((category) => {
    Object.assign(state[category], emptyState());
    waiters[category].splice(0);
  });
}
