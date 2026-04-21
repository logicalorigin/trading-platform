export const API_BASE_URL =
  process.env.BACKTEST_API_BASE_URL ?? "http://127.0.0.1:80/api";

export const WORKER_POLL_INTERVAL_MS = Number(
  process.env.BACKTEST_WORKER_POLL_INTERVAL_MS ?? "3000",
);

export const JOB_HEARTBEAT_INTERVAL_MS = 10_000;
export const JOB_STALE_AFTER_MS = 60_000;
export const MAX_JOB_ATTEMPTS = 2;
export const MAX_PARALLEL_SWEEP_RUNS = 4;
export const BAR_STORAGE_TARGET_BYTES = 10 * 1024 * 1024 * 1024;
