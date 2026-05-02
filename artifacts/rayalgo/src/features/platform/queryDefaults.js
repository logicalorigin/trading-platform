import {
  HYDRATION_PRIORITY,
  HYDRATION_PRIORITY_HEADER,
  buildHydrationRequestOptions,
} from "./hydrationCoordinator";

export const QUERY_DEFAULTS = {
  staleTime: 15_000,
  refetchInterval: 15_000,
  retry: 2,
  retryDelay: (attempt) => Math.min(1_000 * (attempt + 1), 5_000),
  refetchOnMount: true,
  gcTime: 30_000,
};

export const BARS_QUERY_DEFAULTS = {
  staleTime: 5 * 60_000,
  gcTime: 10 * 60_000,
  refetchInterval: false,
  refetchOnMount: false,
  retry: 1,
  retryDelay: (attempt) => Math.min(1_000 * (attempt + 1), 5_000),
};

export const BARS_REQUEST_PRIORITY_HEADER = HYDRATION_PRIORITY_HEADER;
export const BARS_REQUEST_PRIORITY = {
  background: HYDRATION_PRIORITY.background,
  favoritePrewarm: HYDRATION_PRIORITY.near,
  visible: HYDRATION_PRIORITY.visible,
  active: HYDRATION_PRIORITY.active,
};

export const buildBarsRequestOptions = buildHydrationRequestOptions;

export const HEAVY_PAYLOAD_GC_MS = 15_000;
