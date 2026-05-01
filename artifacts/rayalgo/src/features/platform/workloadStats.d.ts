export type RuntimeWorkloadEntry = {
  key?: string;
  kind?: string;
  label?: string;
  detail?: string;
  priority?: number;
};

export type RuntimeWorkloadStats = {
  activeCount: number;
  kindCounts: Record<string, number>;
  entries: RuntimeWorkloadEntry[];
};

export function setRuntimeWorkloadFlag(
  key: string,
  active: boolean,
  meta?: RuntimeWorkloadEntry,
): void;

export function clearRuntimeWorkloadFlag(key: string): void;

export function useRuntimeWorkloadFlag(
  key: string,
  active: boolean,
  meta?: RuntimeWorkloadEntry,
): void;

export function getRuntimeWorkloadStats(): RuntimeWorkloadStats;

export function useRuntimeWorkloadStats(): RuntimeWorkloadStats;
