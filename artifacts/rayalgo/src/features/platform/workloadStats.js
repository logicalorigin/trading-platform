import {
  useEffect,
  useMemo,
  useSyncExternalStore,
} from "react";

let storeVersion = 0;
const listeners = new Set();
const workloadEntries = new Map();

const emit = () => {
  storeVersion += 1;
  listeners.forEach((listener) => {
    try {
      listener();
    } catch {}
  });
};

const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const getSnapshot = () => storeVersion;

const normalizeMeta = (meta = {}) => {
  const normalized = { ...meta };
  delete normalized.__hash;
  return normalized;
};

export const setRuntimeWorkloadFlag = (key, active, meta = {}) => {
  if (!key) {
    return;
  }

  if (!active) {
    if (workloadEntries.delete(key)) {
      emit();
    }
    return;
  }

  const normalized = normalizeMeta(meta);
  const hash = JSON.stringify(normalized);
  const previous = workloadEntries.get(key);
  if (previous?.__hash === hash) {
    return;
  }

  workloadEntries.set(key, {
    ...normalized,
    key,
    __hash: hash,
  });
  emit();
};

export const clearRuntimeWorkloadFlag = (key) => {
  if (!key) {
    return;
  }
  if (workloadEntries.delete(key)) {
    emit();
  }
};

export const useRuntimeWorkloadFlag = (key, active, meta = {}) => {
  const serializedMeta = JSON.stringify(normalizeMeta(meta));

  useEffect(() => {
    const parsedMeta = serializedMeta ? JSON.parse(serializedMeta) : {};
    setRuntimeWorkloadFlag(key, active, parsedMeta);
    return () => {
      clearRuntimeWorkloadFlag(key);
    };
  }, [active, key, serializedMeta]);
};

export const useRuntimeWorkloadStats = () => {
  const version = useSyncExternalStore(subscribe, getSnapshot, () => 0);

  return useMemo(() => {
    const entries = Array.from(workloadEntries.values())
      .map((entry) => normalizeMeta(entry))
      .sort((left, right) => {
        const leftPriority = left.priority ?? 99;
        const rightPriority = right.priority ?? 99;
        if (leftPriority !== rightPriority) {
          return leftPriority - rightPriority;
        }
        return String(left.label || left.key).localeCompare(
          String(right.label || right.key),
        );
      });

    const kindCounts = {};
    entries.forEach((entry) => {
      const kind = entry.kind || "other";
      kindCounts[kind] = (kindCounts[kind] || 0) + 1;
    });

    return {
      activeCount: entries.length,
      kindCounts,
      entries,
    };
  }, [version]);
};
