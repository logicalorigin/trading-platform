import { useSyncExternalStore } from "react";

export type BootProgressTaskStatus =
  | "pending"
  | "active"
  | "complete"
  | "failed"
  | "skipped";

export type BootProgressTaskId =
  | "static-html"
  | "react-root"
  | "app-content-chunk"
  | "workspace-route-chunk"
  | "session"
  | "watchlists"
  | "accounts"
  | "signal-profile"
  | "signal-state"
  | "first-screen"
  | "screen-preload-flow"
  | "screen-preload-trade"
  | "screen-preload-algo"
  | "screen-preload-backtest";

type BootProgressTaskDefinition = {
  id: BootProgressTaskId;
  label: string;
  weight: number;
  blocking: boolean;
};

export type BootProgressTaskSnapshot = BootProgressTaskDefinition & {
  status: BootProgressTaskStatus;
  detail: string | null;
  error: string | null;
  startedAt: string | null;
  settledAt: string | null;
  updatedAt: string | null;
};

export type BootProgressSnapshot = {
  version: 1;
  percent: number;
  label: string;
  detail: string | null;
  complete: boolean;
  failedCount: number;
  skippedCount: number;
  activeTaskIds: BootProgressTaskId[];
  settledTaskCount: number;
  totalTaskCount: number;
  settledBlockingTaskCount: number;
  totalBlockingTaskCount: number;
  startedAt: string;
  updatedAt: string;
  tasks: BootProgressTaskSnapshot[];
};

type BootProgressTaskPatch = {
  label?: string | null;
  detail?: string | null;
};

const TASKS: BootProgressTaskDefinition[] = [
  { id: "static-html", label: "Loading boot shell", weight: 3, blocking: true },
  { id: "react-root", label: "Starting React runtime", weight: 4, blocking: true },
  { id: "app-content-chunk", label: "Loading app shell", weight: 8, blocking: true },
  { id: "workspace-route-chunk", label: "Loading workspace route", weight: 10, blocking: true },
  { id: "session", label: "Loading session", weight: 10, blocking: false },
  { id: "watchlists", label: "Loading watchlists", weight: 8, blocking: false },
  { id: "accounts", label: "Loading accounts", weight: 8, blocking: false },
  { id: "signal-profile", label: "Loading signal profile", weight: 7, blocking: false },
  { id: "signal-state", label: "Loading signal state", weight: 5, blocking: false },
  { id: "first-screen", label: "Preparing first screen", weight: 15, blocking: true },
  { id: "screen-preload-flow", label: "Preloading Flow screen", weight: 5, blocking: false },
  { id: "screen-preload-trade", label: "Preloading Trade screen", weight: 5, blocking: false },
  { id: "screen-preload-algo", label: "Preloading Algo screen", weight: 6, blocking: false },
  { id: "screen-preload-backtest", label: "Preloading Backtest screen", weight: 6, blocking: false },
];

export const BOOT_SCREEN_MODULE_PRELOAD_TASK_IDS = [
  "screen-preload-flow",
  "screen-preload-trade",
  "screen-preload-algo",
  "screen-preload-backtest",
] as const satisfies readonly BootProgressTaskId[];

export const BOOT_SCREEN_MODULE_PRELOAD_TASK_BY_SCREEN_ID: Record<
  string,
  (typeof BOOT_SCREEN_MODULE_PRELOAD_TASK_IDS)[number] | undefined
> = {
  flow: "screen-preload-flow",
  trade: "screen-preload-trade",
  algo: "screen-preload-algo",
  backtest: "screen-preload-backtest",
};

const TASK_DEFINITIONS = new Map(TASKS.map((task) => [task.id, task]));
const SETTLED_STATUSES = new Set<BootProgressTaskStatus>([
  "complete",
  "failed",
  "skipped",
]);

const nowIso = () => new Date().toISOString();

const normalizeText = (value: string | null | undefined): string | null => {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, 160) : null;
};

const errorMessage = (error: unknown): string | null => {
  if (error instanceof Error) return normalizeText(error.message || error.name);
  return normalizeText(String(error ?? ""));
};

const createInitialTaskState = (): Map<BootProgressTaskId, BootProgressTaskSnapshot> =>
  new Map(
    TASKS.map((definition) => [
      definition.id,
      {
        ...definition,
        status: "pending" as const,
        detail: null,
        error: null,
        startedAt: null,
        settledAt: null,
        updatedAt: null,
      },
    ]),
  );

const readTask = (id: BootProgressTaskId): BootProgressTaskSnapshot | null =>
  taskState.get(id) ?? null;

let taskState = createInitialTaskState();
let startedAt = nowIso();
let updatedAt = startedAt;
let lastPercent = 0;
let snapshot: BootProgressSnapshot;
const listeners = new Set<() => void>();

const buildSnapshot = (): BootProgressSnapshot => {
  const tasks = TASKS.map((task) => taskState.get(task.id)!).filter(Boolean);
  const settledTasks = tasks.filter((task) => SETTLED_STATUSES.has(task.status));
  const blockingTasks = tasks.filter((task) => task.blocking);
  const settledBlockingTasks = blockingTasks.filter((task) =>
    SETTLED_STATUSES.has(task.status),
  );
  const activeTasks = tasks.filter((task) => task.status === "active");
  const activeBlockingTasks = blockingTasks.filter(
    (task) => task.status === "active",
  );
  const settledWeight = settledBlockingTasks.reduce(
    (sum, task) => sum + task.weight,
    0,
  );
  const totalBlockingWeight = blockingTasks.reduce(
    (sum, task) => sum + task.weight,
    0,
  );
  const rawPercent =
    settledBlockingTasks.length === blockingTasks.length
      ? 100
      : Math.min(99, Math.floor((settledWeight / totalBlockingWeight) * 100));
  const percent = Math.max(lastPercent, rawPercent);
  lastPercent = percent;
  const activeTask =
    activeBlockingTasks[activeBlockingTasks.length - 1] ??
    activeTasks[activeTasks.length - 1] ??
    null;
  const lastSettledBlockingTask =
    settledBlockingTasks[settledBlockingTasks.length - 1] ?? null;
  const label =
    activeTask?.detail ||
    activeTask?.label ||
    lastSettledBlockingTask?.detail ||
    lastSettledBlockingTask?.label ||
    "Loading PYRUS";
  const failedCount = tasks.filter((task) => task.status === "failed").length;

  return {
    version: 1,
    percent,
    label,
    detail:
      failedCount > 0
        ? `${failedCount} startup task${failedCount === 1 ? "" : "s"} failed`
        : activeTask?.label && activeTask.detail
          ? activeTask.label
          : null,
    complete: settledBlockingTasks.length === blockingTasks.length,
    failedCount,
    skippedCount: tasks.filter((task) => task.status === "skipped").length,
    activeTaskIds: activeTasks.map((task) => task.id),
    settledTaskCount: settledTasks.length,
    totalTaskCount: tasks.length,
    settledBlockingTaskCount: settledBlockingTasks.length,
    totalBlockingTaskCount: blockingTasks.length,
    startedAt,
    updatedAt,
    tasks,
  };
};

const writeWindowSnapshot = () => {
  if (typeof window === "undefined") return;
  const progressWindow = window as Window & {
    __PYRUS_BOOT_PROGRESS__?: BootProgressSnapshot;
    __PYRUS_GET_BOOT_PROGRESS__?: () => BootProgressSnapshot;
  };
  progressWindow.__PYRUS_BOOT_PROGRESS__ = snapshot;
  progressWindow.__PYRUS_GET_BOOT_PROGRESS__ = getBootProgressSnapshot;
};

const emit = () => {
  snapshot = buildSnapshot();
  writeWindowSnapshot();
  listeners.forEach((listener) => listener());
};

snapshot = buildSnapshot();

const setTaskStatus = (
  id: BootProgressTaskId,
  status: BootProgressTaskStatus,
  patch: BootProgressTaskPatch & { error?: unknown } = {},
) => {
  const current = readTask(id);
  const definition = TASK_DEFINITIONS.get(id);
  if (!current || !definition) return;
  if (SETTLED_STATUSES.has(current.status)) return;

  const timestamp = nowIso();
  const next: BootProgressTaskSnapshot = {
    ...current,
    label: normalizeText(patch.label) ?? current.label,
    detail:
      patch.detail === undefined ? current.detail : normalizeText(patch.detail),
    error: status === "failed" ? errorMessage(patch.error) : current.error,
    status,
    startedAt:
      current.startedAt ?? (status === "pending" ? null : timestamp),
    settledAt: SETTLED_STATUSES.has(status) ? timestamp : current.settledAt,
    updatedAt: timestamp,
  };

  taskState.set(id, next);
  updatedAt = timestamp;
  emit();
};

export const startBootProgressTask = (
  id: BootProgressTaskId,
  patch: BootProgressTaskPatch = {},
) => setTaskStatus(id, "active", patch);

export const completeBootProgressTask = (
  id: BootProgressTaskId,
  patch: BootProgressTaskPatch = {},
) => setTaskStatus(id, "complete", patch);

export const failBootProgressTask = (
  id: BootProgressTaskId,
  error: unknown,
  patch: BootProgressTaskPatch = {},
) => setTaskStatus(id, "failed", { ...patch, error });

export const skipBootProgressTask = (
  id: BootProgressTaskId,
  reason: string,
) => setTaskStatus(id, "skipped", { detail: reason });

export const skipBootProgressTasks = (
  ids: readonly BootProgressTaskId[],
  reason: string,
) => {
  ids.forEach((id) => skipBootProgressTask(id, reason));
};

export const reclassifyBootBlocking = (
  blockingIds: readonly BootProgressTaskId[],
) => {
  const nextBlockingIds = new Set(blockingIds);
  const timestamp = nowIso();
  let changed = false;

  for (const definition of TASKS) {
    const current = taskState.get(definition.id);
    if (!current) continue;
    const nextBlocking = nextBlockingIds.has(definition.id);
    if (current.blocking === nextBlocking) continue;
    taskState.set(definition.id, {
      ...current,
      blocking: nextBlocking,
      updatedAt: timestamp,
    });
    changed = true;
  }

  if (!changed) return;
  updatedAt = timestamp;
  emit();
};

export const getBootProgressSnapshot = () => snapshot;

export const subscribeBootProgress = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const useBootProgress = () =>
  useSyncExternalStore(
    subscribeBootProgress,
    getBootProgressSnapshot,
    getBootProgressSnapshot,
  );

export const resetBootProgressForTests = () => {
  taskState = createInitialTaskState();
  startedAt = nowIso();
  updatedAt = startedAt;
  lastPercent = 0;
  emit();
};
