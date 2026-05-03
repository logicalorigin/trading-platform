import { useEffect, useMemo, useSyncExternalStore } from "react";

export type HydrationPriorityTier =
  | "idle"
  | "background"
  | "near"
  | "visible"
  | "active";

export type HydrationIntent = {
  key: string;
  family: string;
  label?: string | null;
  priority: HydrationPriorityTier | number;
  active?: boolean;
  meta?: Record<string, unknown>;
};

export type HydrationGateInput = {
  enabled?: boolean;
  priority?: HydrationPriorityTier | number;
  family?: string;
};

export type HydrationPressureState = "normal" | "degraded" | "backoff" | "stalled";

export const HYDRATION_PRIORITY = {
  idle: -8,
  background: -2,
  near: 4,
  visible: 6,
  active: 8,
} as const satisfies Record<HydrationPriorityTier, number>;

export const HYDRATION_PRIORITY_HEADER = "x-rayalgo-fetch-priority";

type StoredHydrationIntent = Required<Pick<HydrationIntent, "key" | "family">> &
  Omit<HydrationIntent, "key" | "family" | "priority" | "active"> & {
    priority: number;
    active: true;
    updatedAt: number;
  };

let storeVersion = 0;
const listeners = new Set<() => void>();
const hydrationIntents = new Map<string, StoredHydrationIntent>();
let hydrationPressureState: HydrationPressureState = "normal";
let emitScheduled = false;

const flushListeners = () => {
  emitScheduled = false;
  storeVersion += 1;
  listeners.forEach((listener) => listener());
};

const emit = () => {
  if (emitScheduled) {
    return;
  }
  emitScheduled = true;
  if (typeof queueMicrotask === "function") {
    queueMicrotask(flushListeners);
    return;
  }
  setTimeout(flushListeners, 0);
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const getSnapshotVersion = () => storeVersion;

export const resolveHydrationPriority = (
  priority: HydrationPriorityTier | number | null | undefined,
): number => {
  if (typeof priority === "number" && Number.isFinite(priority)) {
    return priority;
  }
  if (priority && priority in HYDRATION_PRIORITY) {
    return HYDRATION_PRIORITY[priority as HydrationPriorityTier];
  }
  return HYDRATION_PRIORITY.background;
};

export const buildHydrationRequestOptions = (
  priority: HydrationPriorityTier | number | null | undefined,
) => {
  const resolvedPriority = resolveHydrationPriority(priority);
  return Number.isFinite(resolvedPriority)
    ? {
        headers: {
          [HYDRATION_PRIORITY_HEADER]: String(resolvedPriority),
        },
      }
    : undefined;
};

export const setHydrationPressureState = (
  state: HydrationPressureState,
): void => {
  if (hydrationPressureState === state) {
    return;
  }
  hydrationPressureState = state;
  emit();
};

export const getHydrationPressureState = (): HydrationPressureState =>
  hydrationPressureState;

const isHydrationAllowed = (priority: number): boolean => {
  if (hydrationPressureState === "normal") {
    return true;
  }
  if (hydrationPressureState === "degraded") {
    return priority >= HYDRATION_PRIORITY.near;
  }
  return priority >= HYDRATION_PRIORITY.visible;
};

export const registerHydrationIntent = (intent: HydrationIntent): (() => void) => {
  const key = intent.key?.trim();
  if (!key || intent.active === false) {
    return () => {};
  }

  hydrationIntents.set(key, {
    ...intent,
    key,
    family: intent.family || "other",
    priority: resolveHydrationPriority(intent.priority),
    active: true,
    updatedAt: Date.now(),
  });
  emit();

  return () => {
    if (hydrationIntents.delete(key)) {
      emit();
    }
  };
};

export const clearHydrationIntent = (key: string | null | undefined): void => {
  const normalizedKey = key?.trim();
  if (!normalizedKey) {
    return;
  }
  if (hydrationIntents.delete(normalizedKey)) {
    emit();
  }
};

export const useHydrationIntent = (intent: HydrationIntent): void => {
  const serializedIntent = JSON.stringify(intent);

  useEffect(() => {
    const parsed = JSON.parse(serializedIntent) as HydrationIntent;
    if (parsed.active === false) {
      clearHydrationIntent(parsed.key);
      return undefined;
    }
    return registerHydrationIntent(parsed);
  }, [serializedIntent]);
};

export const useHydrationGate = (input: HydrationGateInput = {}) => {
  const priority = resolveHydrationPriority(input.priority);
  useSyncExternalStore(subscribe, getSnapshotVersion, () => 0);
  const allowed = isHydrationAllowed(priority);
  return useMemo(
    () => ({
      enabled: input.enabled !== false && allowed,
      family: input.family || "other",
      priority,
      requestOptions: buildHydrationRequestOptions(priority),
      pressure: hydrationPressureState,
    }),
    [allowed, input.enabled, input.family, priority],
  );
};

export const getHydrationCoordinatorSnapshot = () => {
  const intents = Array.from(hydrationIntents.values()).sort((left, right) => {
    if (left.priority !== right.priority) {
      return right.priority - left.priority;
    }
    return right.updatedAt - left.updatedAt;
  });
  const familyCounts: Record<string, number> = {};
  intents.forEach((intent) => {
    familyCounts[intent.family] = (familyCounts[intent.family] || 0) + 1;
  });

  return {
    activeIntentCount: intents.length,
    pressure: hydrationPressureState,
    familyCounts,
    topIntents: intents.slice(0, 20).map((intent) => ({
      key: intent.key,
      family: intent.family,
      label: intent.label ?? null,
      priority: intent.priority,
      meta: intent.meta ?? {},
      updatedAt: intent.updatedAt,
    })),
  };
};

export const useHydrationCoordinatorStats = (enabled = true) => {
  const version = useSyncExternalStore(
    enabled ? subscribe : () => () => {},
    enabled ? getSnapshotVersion : () => 0,
    () => 0,
  );
  return useMemo(() => getHydrationCoordinatorSnapshot(), [version]);
};
