import { useMemo } from "react";

const nowMs = () =>
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();

const normalizeElapsedMs = (value: number | null | undefined): number | null => {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(0, value);
};

const readBootLoaderStartedAtMs = (): number | null => {
  if (typeof window === "undefined") return null;

  const bootState = window as unknown as {
    __PYRUS_BOOT_LOADER_STARTED_AT__?: number;
  };
  const startedAt = bootState.__PYRUS_BOOT_LOADER_STARTED_AT__;
  if (typeof startedAt !== "number" || !Number.isFinite(startedAt)) return null;
  return startedAt;
};

export const readCurrentBootHandoffElapsedMs = (
  fallbackElapsedMs: number | null | undefined,
): number | null => {
  const startedAt = readBootLoaderStartedAtMs();
  if (startedAt !== null) return Math.max(0, nowMs() - startedAt);
  return normalizeElapsedMs(fallbackElapsedMs);
};

export const useBootHandoffElapsedMs = (
  fallbackElapsedMs: number | null | undefined,
): number | null =>
  useMemo(
    () => readCurrentBootHandoffElapsedMs(fallbackElapsedMs),
    [fallbackElapsedMs],
  );
