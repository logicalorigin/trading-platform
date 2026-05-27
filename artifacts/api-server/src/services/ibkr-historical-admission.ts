import { HttpError } from "../lib/errors";
import { normalizeSymbol } from "../lib/values";

type HistoricalRequestFamilyStats = {
  accepted: number;
  completed: number;
  rejected: number;
  waitedMs: number;
  lastAcceptedAt: string | null;
  lastRejectedAt: string | null;
  lastRejectedReason: string | null;
};

type WeightedTimestamp = {
  at: number;
  weight: number;
};

type QueuedHistoricalWork = {
  resolve: () => void;
  reject: (error: Error) => void;
  priority: number;
  sequence: number;
  queuedAt: number;
  timeout: NodeJS.Timeout | null;
  family: string;
};

type HistoricalAdmissionConfig = {
  concurrency: number;
  queueCap: number;
  maxWaitMs: number;
  requestRatePerSecond: number;
  globalWindowMs: number;
  globalWindowMaxWeight: number;
  identicalCooldownMs: number;
  sameContractWindowMs: number;
  sameContractMaxWeight: number;
};

export type IbkrHistoricalAdmissionInput = {
  family?: string | null;
  priority?: number | null;
  symbol?: string | null;
  providerContractId?: string | null;
  timeframe?: string | null;
  exchange?: string | null;
  source?: string | null;
  signal?: AbortSignal;
};

const DEFAULT_CONCURRENCY = 50;
const DEFAULT_QUEUE_CAP = 50;
const DEFAULT_MAX_WAIT_MS = 30_000;
const DEFAULT_REQUEST_RATE_PER_SECOND = 50;
const DEFAULT_GLOBAL_WINDOW_MS = 10 * 60_000;
const DEFAULT_GLOBAL_WINDOW_MAX_WEIGHT = 60;
const DEFAULT_IDENTICAL_COOLDOWN_MS = 15_000;
const DEFAULT_SAME_CONTRACT_WINDOW_MS = 2_000;
const DEFAULT_SAME_CONTRACT_MAX_WEIGHT = 5;
const VISIBLE_PRIORITY = 6;
const FAMILY_LIMIT = 20;

let active = 0;
let sequence = 0;
const queue: QueuedHistoricalWork[] = [];
const globalWindow: WeightedTimestamp[] = [];
const requestRateWindow: WeightedTimestamp[] = [];
const sameContractWindows = new Map<string, WeightedTimestamp[]>();
const identicalRequests = new Map<string, number>();
const familyStats = new Map<string, HistoricalRequestFamilyStats>();
let accepted = 0;
let completed = 0;
let rejected = 0;
let lastRejectedAt: string | null = null;
let lastRejectedReason: string | null = null;

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function config(): HistoricalAdmissionConfig {
  return {
    concurrency: readPositiveIntegerEnv(
      "IBKR_HISTORICAL_API_CONCURRENCY",
      DEFAULT_CONCURRENCY,
    ),
    queueCap: readPositiveIntegerEnv(
      "IBKR_HISTORICAL_API_QUEUE_CAP",
      DEFAULT_QUEUE_CAP,
    ),
    maxWaitMs: readPositiveIntegerEnv(
      "IBKR_HISTORICAL_API_MAX_WAIT_MS",
      DEFAULT_MAX_WAIT_MS,
    ),
    requestRatePerSecond: readPositiveIntegerEnv(
      "IBKR_TWS_REQUEST_RATE_PER_SECOND",
      DEFAULT_REQUEST_RATE_PER_SECOND,
    ),
    globalWindowMs: readPositiveIntegerEnv(
      "IBKR_HISTORICAL_GLOBAL_WINDOW_MS",
      DEFAULT_GLOBAL_WINDOW_MS,
    ),
    globalWindowMaxWeight: readPositiveIntegerEnv(
      "IBKR_HISTORICAL_GLOBAL_WINDOW_MAX",
      DEFAULT_GLOBAL_WINDOW_MAX_WEIGHT,
    ),
    identicalCooldownMs: readPositiveIntegerEnv(
      "IBKR_HISTORICAL_IDENTICAL_COOLDOWN_MS",
      DEFAULT_IDENTICAL_COOLDOWN_MS,
    ),
    sameContractWindowMs: readPositiveIntegerEnv(
      "IBKR_HISTORICAL_SAME_CONTRACT_WINDOW_MS",
      DEFAULT_SAME_CONTRACT_WINDOW_MS,
    ),
    sameContractMaxWeight: readPositiveIntegerEnv(
      "IBKR_HISTORICAL_SAME_CONTRACT_MAX",
      DEFAULT_SAME_CONTRACT_MAX_WEIGHT,
    ),
  };
}

function normalizeFamily(value: string | null | undefined): string {
  const normalized =
    typeof value === "string"
      ? value.trim().toLowerCase().replace(/[^a-z0-9_.:-]+/g, "-")
      : "";
  return normalized ? normalized.slice(0, 64) : "unknown";
}

function requestWeight(input: IbkrHistoricalAdmissionInput): number {
  return String(input.source ?? "").toLowerCase() === "bid_ask" ? 2 : 1;
}

function timeframeDurationMs(value: unknown): number | null {
  const raw = String(value ?? "").trim().toLowerCase();
  const match = raw.match(
    /^(\d+(?:\.\d+)?)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)$/,
  );
  if (!match) {
    return null;
  }

  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }

  const unit = match[2];
  if (["s", "sec", "secs", "second", "seconds"].includes(unit)) {
    return amount * 1_000;
  }
  if (["m", "min", "mins", "minute", "minutes"].includes(unit)) {
    return amount * 60_000;
  }
  if (["h", "hr", "hrs", "hour", "hours"].includes(unit)) {
    return amount * 60 * 60_000;
  }
  if (["d", "day", "days"].includes(unit)) {
    return amount * 24 * 60 * 60_000;
  }
  return null;
}

function usesSmallBarHistoricalWindow(input: IbkrHistoricalAdmissionInput): boolean {
  const timeframeMs = timeframeDurationMs(input.timeframe);
  return timeframeMs !== null && timeframeMs <= 30_000;
}

function compact(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

function contractKey(input: IbkrHistoricalAdmissionInput): string {
  const symbol = normalizeSymbol(String(input.symbol ?? "")).toUpperCase();
  return [
    compact(input.providerContractId) || symbol || "UNKNOWN",
    compact(input.exchange) || "SMART",
    compact(input.source) || "TRADES",
  ].join(":");
}

function identicalKey(input: IbkrHistoricalAdmissionInput): string {
  return [
    contractKey(input),
    compact(input.timeframe) || "UNKNOWN_TIMEFRAME",
  ].join(":");
}

function pruneWeightedWindow(
  entries: WeightedTimestamp[],
  now: number,
  windowMs: number,
): void {
  while (entries.length && now - entries[0]!.at >= windowMs) {
    entries.shift();
  }
}

function weightedCount(entries: WeightedTimestamp[]): number {
  return entries.reduce((sum, entry) => sum + entry.weight, 0);
}

function statsForFamily(family: string): HistoricalRequestFamilyStats {
  const current =
    familyStats.get(family) ??
    {
      accepted: 0,
      completed: 0,
      rejected: 0,
      waitedMs: 0,
      lastAcceptedAt: null,
      lastRejectedAt: null,
      lastRejectedReason: null,
    };
  familyStats.set(family, current);
  if (familyStats.size > FAMILY_LIMIT) {
    const first = familyStats.keys().next().value;
    if (first) {
      familyStats.delete(first);
    }
  }
  return current;
}

function recordRejected(family: string, reason: string): void {
  rejected += 1;
  lastRejectedAt = new Date().toISOString();
  lastRejectedReason = reason;
  const stats = statsForFamily(family);
  stats.rejected += 1;
  stats.lastRejectedAt = lastRejectedAt;
  stats.lastRejectedReason = reason;
}

function admissionError(reason: string, waitMs: number | null): HttpError {
  return new HttpError(429, "IBKR historical request pacing is full.", {
    code: "ibkr_historical_admission_rejected",
    data: {
      reason,
      waitMs,
    },
  });
}

function abortError(signal?: AbortSignal): Error {
  const reason = signal?.reason;
  return reason instanceof Error ? reason : new Error("IBKR historical work aborted.");
}

function currentPacingBlock(input: IbkrHistoricalAdmissionInput): {
  reason: string;
  waitMs: number;
} | null {
  const now = Date.now();
  const nextConfig = config();
  const weight = requestWeight(input);
  const useGlobalWindow = usesSmallBarHistoricalWindow(input);
  if (useGlobalWindow) {
    pruneWeightedWindow(globalWindow, now, nextConfig.globalWindowMs);
  }
  pruneWeightedWindow(requestRateWindow, now, 1_000);

  const sameContractKey = contractKey(input);
  const sameContractWindow = sameContractWindows.get(sameContractKey) ?? [];
  pruneWeightedWindow(sameContractWindow, now, nextConfig.sameContractWindowMs);
  if (sameContractWindow.length) {
    sameContractWindows.set(sameContractKey, sameContractWindow);
  } else {
    sameContractWindows.delete(sameContractKey);
  }

  const matchingIdenticalKey = identicalKey(input);
  const identicalAt = identicalRequests.get(matchingIdenticalKey) ?? 0;
  if (identicalAt && now - identicalAt < nextConfig.identicalCooldownMs) {
    return {
      reason: "identical-request-cooldown",
      waitMs: identicalAt + nextConfig.identicalCooldownMs - now,
    };
  }

  if (weightedCount(requestRateWindow) + weight > nextConfig.requestRatePerSecond) {
    return {
      reason: "tws-request-rate",
      waitMs: requestRateWindow[0]!.at + 1_000 - now,
    };
  }

  if (weightedCount(sameContractWindow) + weight > nextConfig.sameContractMaxWeight) {
    return {
      reason: "same-contract-pacing",
      waitMs: sameContractWindow[0]!.at + nextConfig.sameContractWindowMs - now,
    };
  }

  if (
    useGlobalWindow &&
    weightedCount(globalWindow) + weight > nextConfig.globalWindowMaxWeight
  ) {
    return {
      reason: "global-historical-pacing",
      waitMs: globalWindow[0]!.at + nextConfig.globalWindowMs - now,
    };
  }

  return null;
}

function registerPacing(input: IbkrHistoricalAdmissionInput): void {
  const now = Date.now();
  const nextConfig = config();
  const weight = requestWeight(input);
  const useGlobalWindow = usesSmallBarHistoricalWindow(input);
  if (useGlobalWindow) {
    pruneWeightedWindow(globalWindow, now, nextConfig.globalWindowMs);
  }
  pruneWeightedWindow(requestRateWindow, now, 1_000);
  const sameContractKey = contractKey(input);
  const sameContractWindow = sameContractWindows.get(sameContractKey) ?? [];
  pruneWeightedWindow(sameContractWindow, now, nextConfig.sameContractWindowMs);
  if (useGlobalWindow) {
    globalWindow.push({ at: now, weight });
  }
  requestRateWindow.push({ at: now, weight });
  sameContractWindow.push({ at: now, weight });
  sameContractWindows.set(sameContractKey, sameContractWindow);
  identicalRequests.set(identicalKey(input), now);
}

function sortQueue(): void {
  queue.sort((left, right) => right.priority - left.priority || left.sequence - right.sequence);
}

async function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) {
    return;
  }
  if (signal?.aborted) {
    throw abortError(signal);
  }
  let abort: (() => void) | null = null;
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(resolve, ms);
    timeout.unref?.();
    abort = () => {
      clearTimeout(timeout);
      reject(abortError(signal));
    };
    signal?.addEventListener("abort", abort, { once: true });
  }).finally(() => {
    if (abort) {
      signal?.removeEventListener("abort", abort);
    }
  });
}

async function waitForPacing(input: IbkrHistoricalAdmissionInput): Promise<void> {
  const priority = Number(input.priority);
  const mayWait = Number.isFinite(priority) && priority >= VISIBLE_PRIORITY;
  const nextConfig = config();
  for (;;) {
    const blocked = currentPacingBlock(input);
    if (!blocked) {
      registerPacing(input);
      return;
    }
    if (!mayWait || blocked.waitMs > nextConfig.maxWaitMs) {
      throw admissionError(blocked.reason, blocked.waitMs);
    }
    await delay(blocked.waitMs, input.signal);
  }
}

function releaseSlot(): void {
  active = Math.max(0, active - 1);
  const next = queue.shift();
  if (!next) {
    return;
  }
  if (next.timeout) {
    clearTimeout(next.timeout);
    next.timeout = null;
  }
  next.resolve();
}

async function acquireSlot(input: IbkrHistoricalAdmissionInput): Promise<() => void> {
  if (input.signal?.aborted) {
    throw abortError(input.signal);
  }
  const family = normalizeFamily(input.family);
  const nextConfig = config();
  if (active < nextConfig.concurrency) {
    active += 1;
    return releaseSlot;
  }
  if (queue.length >= nextConfig.queueCap) {
    throw admissionError("api-historical-queue-full", null);
  }

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const queuedWork: QueuedHistoricalWork = {
      resolve: () => {
        if (settled) return;
        settled = true;
        input.signal?.removeEventListener("abort", abort);
        resolve();
      },
      reject: (error) => {
        if (settled) return;
        settled = true;
        input.signal?.removeEventListener("abort", abort);
        reject(error);
      },
      priority: Number.isFinite(Number(input.priority)) ? Number(input.priority) : 0,
      sequence,
      queuedAt: Date.now(),
      timeout: null,
      family,
    };
    sequence += 1;
    const abort = () => {
      const index = queue.indexOf(queuedWork);
      if (index >= 0) {
        queue.splice(index, 1);
      }
      if (queuedWork.timeout) {
        clearTimeout(queuedWork.timeout);
        queuedWork.timeout = null;
      }
      queuedWork.reject(abortError(input.signal));
    };
    queuedWork.timeout = setTimeout(() => {
      const index = queue.indexOf(queuedWork);
      if (index >= 0) {
        queue.splice(index, 1);
      }
      queuedWork.timeout = null;
      queuedWork.reject(admissionError("api-historical-queue-timeout", nextConfig.maxWaitMs));
    }, nextConfig.maxWaitMs);
    queuedWork.timeout.unref?.();
    queue.push(queuedWork);
    sortQueue();
    input.signal?.addEventListener("abort", abort, { once: true });
  });

  if (input.signal?.aborted) {
    throw abortError(input.signal);
  }
  active += 1;
  return releaseSlot;
}

export function isIbkrHistoricalAdmissionError(error: unknown): error is HttpError {
  return error instanceof HttpError && error.code === "ibkr_historical_admission_rejected";
}

export async function runIbkrHistoricalRequest<T>(
  input: IbkrHistoricalAdmissionInput,
  work: () => Promise<T>,
): Promise<T> {
  const family = normalizeFamily(input.family);
  let release: (() => void) | null = null;
  try {
    const queuedAt = Date.now();
    release = await acquireSlot(input);
    const waitedMs = Math.max(0, Date.now() - queuedAt);
    if (waitedMs > 0) {
      statsForFamily(family).waitedMs += waitedMs;
    }
    await waitForPacing(input);
    accepted += 1;
    const stats = statsForFamily(family);
    stats.accepted += 1;
    stats.lastAcceptedAt = new Date().toISOString();
    const result = await work();
    completed += 1;
    stats.completed += 1;
    return result;
  } catch (error) {
    if (isIbkrHistoricalAdmissionError(error)) {
      const reason =
        error.data && typeof error.data === "object"
          ? String((error.data as Record<string, unknown>).reason ?? "rejected")
          : "rejected";
      recordRejected(family, reason);
    }
    throw error;
  } finally {
    release?.();
  }
}

export function getIbkrHistoricalAdmissionSnapshot() {
  const now = Date.now();
  const nextConfig = config();
  pruneWeightedWindow(globalWindow, now, nextConfig.globalWindowMs);
  pruneWeightedWindow(requestRateWindow, now, 1_000);
  return {
    active,
    queued: queue.length,
    concurrency: nextConfig.concurrency,
    queueCap: nextConfig.queueCap,
    accepted,
    completed,
    rejected,
    lastRejectedAt,
    lastRejectedReason,
    pacing: {
      requestRatePerSecond: nextConfig.requestRatePerSecond,
      requestRateRemaining: Math.max(
        0,
        nextConfig.requestRatePerSecond - weightedCount(requestRateWindow),
      ),
      globalWindowMs: nextConfig.globalWindowMs,
      globalWindowMaxWeight: nextConfig.globalWindowMaxWeight,
      globalWindowUsedWeight: weightedCount(globalWindow),
      globalWindowRemainingWeight: Math.max(
        0,
        nextConfig.globalWindowMaxWeight - weightedCount(globalWindow),
      ),
      identicalCooldownMs: nextConfig.identicalCooldownMs,
      sameContractWindowMs: nextConfig.sameContractWindowMs,
      sameContractMaxWeight: nextConfig.sameContractMaxWeight,
    },
    families: Object.fromEntries(
      Array.from(familyStats.entries()).sort(
        ([, left], [, right]) =>
          right.rejected - left.rejected ||
          right.accepted - left.accepted,
      ),
    ),
  };
}

export function __resetIbkrHistoricalAdmissionForTests(): void {
  active = 0;
  sequence = 0;
  queue.splice(0, queue.length);
  globalWindow.splice(0, globalWindow.length);
  requestRateWindow.splice(0, requestRateWindow.length);
  sameContractWindows.clear();
  identicalRequests.clear();
  familyStats.clear();
  accepted = 0;
  completed = 0;
  rejected = 0;
  lastRejectedAt = null;
  lastRejectedReason = null;
}
