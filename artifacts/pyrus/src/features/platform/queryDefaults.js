import {
  HYDRATION_PRIORITY,
  HYDRATION_FAMILY_HEADER,
  HYDRATION_PRIORITY_HEADER,
  buildHydrationRequestOptions,
} from "./hydrationCoordinator";

// Mirrors react-query's internal numeric retry check (`failureCount < max`) so
// behavior is identical to `retry: max`, except a client-side request timeout is
// never retried. Retrying a TimeoutError just re-fires the same request against
// an unresponsive backend, re-consuming the browser connection the timeout was
// meant to free (the connection-starvation that freezes screens on a spinner).
export const retryUnlessTimeout =
  (maxRetries) => (failureCount, error) =>
    error?.name !== "TimeoutError" && failureCount < maxRetries;

export const QUERY_DEFAULTS = {
  staleTime: 15_000,
  refetchInterval: 15_000,
  retry: retryUnlessTimeout(2),
  retryDelay: (attempt) => Math.min(1_000 * (attempt + 1), 5_000),
  refetchOnMount: true,
  gcTime: 30_000,
};

export const BARS_QUERY_DEFAULTS = {
  staleTime: 5 * 60_000,
  gcTime: 10 * 60_000,
  refetchInterval: false,
  refetchOnMount: false,
  retry: retryUnlessTimeout(1),
  retryDelay: (attempt) => Math.min(1_000 * (attempt + 1), 5_000),
};

export const BARS_REQUEST_PRIORITY_HEADER = HYDRATION_PRIORITY_HEADER;
export const BARS_REQUEST_FAMILY_HEADER = HYDRATION_FAMILY_HEADER;
export const BARS_REQUEST_PRIORITY = {
  background: HYDRATION_PRIORITY.background,
  favoritePrewarm: HYDRATION_PRIORITY.near,
  visible: HYDRATION_PRIORITY.visible,
  active: HYDRATION_PRIORITY.active,
};

export const buildBarsRequestOptions = buildHydrationRequestOptions;

export const HEAVY_PAYLOAD_GC_MS = 15_000;
