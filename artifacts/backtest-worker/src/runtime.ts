const DEFAULT_API_BASE_URL = "http://127.0.0.1:8080/api";

export function resolveApiBaseUrl(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const explicit = env.BACKTEST_API_BASE_URL?.trim() || env.API_BASE_URL?.trim();
  return explicit || DEFAULT_API_BASE_URL;
}

export const API_BASE_URL = resolveApiBaseUrl();

export function readPositiveEnvNumber(
  name: string,
  fallback: number,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const value = Number(env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export const WORKER_POLL_INTERVAL_MS = readPositiveEnvNumber(
  "BACKTEST_WORKER_POLL_INTERVAL_MS",
  3_000,
);

export const JOB_HEARTBEAT_INTERVAL_MS = 10_000;
export const JOB_STALE_AFTER_MS = 60_000;
export const MAX_JOB_ATTEMPTS = 2;
export const MAX_PARALLEL_SWEEP_RUNS = 4;
export const BAR_STORAGE_TARGET_BYTES = readPositiveEnvNumber(
  "BAR_STORAGE_TARGET_BYTES",
  1024 * 1024 * 1024,
);
