import { logger } from "../lib/logger";
import type { RuntimeMode } from "../lib/runtime";
import {
  listAlgoDeployments,
  listExecutionEvents,
} from "./automation";
import {
  subscribeAlgoCockpitChanges,
} from "./algo-cockpit-events";
import {
  getAlgoDeploymentCockpit,
  getSignalOptionsPerformance,
  listSignalOptionsAutomationState,
} from "./signal-options-automation";
import { getSignalMonitorProfile } from "./signal-monitor";
type Unsubscribe = () => void;

export const ALGO_COCKPIT_STREAM_INTERVAL_MS = 5_000;
export const ALGO_COCKPIT_STREAM_COALESCE_MS = 1_000;

export type AlgoCockpitStreamInput = {
  deploymentId?: string | null;
  mode?: RuntimeMode;
  eventLimit?: number;
};

export type AlgoCockpitStreamPayload = {
  stream: "algo-cockpit-bootstrap" | "algo-cockpit-live";
  phase?: "primary" | "full";
  mode: RuntimeMode;
  deploymentId: string | null;
  updatedAt: string;
  deployments: Awaited<ReturnType<typeof listAlgoDeployments>>;
  focusedDeployment:
    | Awaited<ReturnType<typeof listAlgoDeployments>>["deployments"][number]
    | null;
  events: Awaited<ReturnType<typeof listExecutionEvents>>;
  signalOptionsState: Awaited<
    ReturnType<typeof listSignalOptionsAutomationState>
  > | null;
  cockpit: Awaited<ReturnType<typeof getAlgoDeploymentCockpit>> | null;
  performance: Awaited<ReturnType<typeof getSignalOptionsPerformance>> | null;
  signalMonitorProfile: Awaited<ReturnType<typeof getSignalMonitorProfile>> | null;
};

const stableStringify = (value: unknown): string => JSON.stringify(value);

const normalizeMode = (mode: RuntimeMode | undefined): RuntimeMode =>
  mode === "live" ? "live" : "shadow";

const normalizeEventLimit = (limit: number | undefined): number =>
  Math.min(Math.max(Math.floor(limit ?? 20), 1), 100);

export function shouldUsePrimaryOnlyAlgoCockpitPayload(pressure: unknown): boolean {
  void pressure;
  return false;
}

async function resolveAlgoCockpitTarget(input: AlgoCockpitStreamInput = {}) {
  const requestedMode = normalizeMode(input.mode);
  const deployments = await listAlgoDeployments({});
  const requestedDeploymentId =
    typeof input.deploymentId === "string" && input.deploymentId.trim()
      ? input.deploymentId.trim()
      : null;
  const focusedDeployment =
    deployments.deployments.find(
      (deployment) => deployment.id === requestedDeploymentId,
    ) ??
    deployments.deployments.find((deployment) => deployment.mode === requestedMode) ??
    deployments.deployments[0] ??
    null;
  const deploymentId = focusedDeployment?.id ?? null;
  const mode = focusedDeployment?.mode ?? requestedMode;
  const eventLimit = normalizeEventLimit(input.eventLimit);

  return {
    deployments,
    focusedDeployment,
    deploymentId,
    mode,
    eventLimit,
  };
}

export async function fetchAlgoCockpitPrimaryPayload(
  input: AlgoCockpitStreamInput = {},
  stream: AlgoCockpitStreamPayload["stream"] = "algo-cockpit-live",
): Promise<AlgoCockpitStreamPayload> {
  const target = await resolveAlgoCockpitTarget(input);
  const primaryEventLimit = Math.min(target.eventLimit, 20);
  const [events, signalOptionsState] = await Promise.all([
    listExecutionEvents(
      target.deploymentId
        ? { deploymentId: target.deploymentId, limit: primaryEventLimit }
        : { limit: primaryEventLimit },
    ),
    target.deploymentId
      ? listSignalOptionsAutomationState({
          deploymentId: target.deploymentId,
          view: "summary",
        }).catch((error) => {
          logger.warn(
            { err: error, deploymentId: target.deploymentId },
            "Signal-options primary cockpit stream state cache unavailable",
          );
          return null;
        })
      : Promise.resolve(null),
  ]);

  return {
    stream,
    phase: "primary",
    mode: target.mode,
    deploymentId: target.deploymentId,
    updatedAt: new Date().toISOString(),
    deployments: target.deployments,
    focusedDeployment: target.focusedDeployment,
    events,
    signalOptionsState,
    cockpit: null,
    performance: null,
    signalMonitorProfile: null,
  };
}

export async function fetchAlgoCockpitStreamPayload(
  input: AlgoCockpitStreamInput = {},
  stream: AlgoCockpitStreamPayload["stream"] = "algo-cockpit-bootstrap",
): Promise<AlgoCockpitStreamPayload> {
  const target = await resolveAlgoCockpitTarget(input);
  const [events, signalOptionsState, cockpit, performance, signalMonitorProfile] =
    await Promise.all([
      listExecutionEvents(
      target.deploymentId
        ? { deploymentId: target.deploymentId, limit: target.eventLimit }
        : { limit: target.eventLimit },
      ),
      target.deploymentId
        ? listSignalOptionsAutomationState({
            deploymentId: target.deploymentId,
            view: "summary",
          })
        : Promise.resolve(null),
      target.deploymentId
        ? getAlgoDeploymentCockpit({
            deploymentId: target.deploymentId,
            view: "summary",
          })
        : Promise.resolve(null),
      target.deploymentId
        ? getSignalOptionsPerformance({ deploymentId: target.deploymentId })
        : Promise.resolve(null),
      getSignalMonitorProfile({ environment: target.mode }),
    ]);

  return {
    stream,
    phase: "full",
    mode: target.mode,
    deploymentId: target.deploymentId,
    updatedAt: new Date().toISOString(),
    deployments: target.deployments,
    focusedDeployment: target.focusedDeployment,
    events,
    signalOptionsState,
    cockpit,
    performance,
    signalMonitorProfile,
  };
}

export function subscribeAlgoCockpitSnapshots(
  input: AlgoCockpitStreamInput,
  onSnapshot: (payload: AlgoCockpitStreamPayload) => void,
  options: {
    initialPayload?: AlgoCockpitStreamPayload;
    onPollSuccess?: (input: {
      payload: AlgoCockpitStreamPayload;
      changed: boolean;
    }) => void | Promise<void>;
    fetchPayload?: typeof fetchAlgoCockpitStreamPayload;
    subscribeChanges?: typeof subscribeAlgoCockpitChanges;
    setInterval?: typeof setInterval;
    clearInterval?: typeof clearInterval;
    setTimeout?: typeof setTimeout;
    clearTimeout?: typeof clearTimeout;
    coalescedPollDelayMs?: number;
  } = {},
): Unsubscribe {
  let active = true;
  let inFlight = false;
  let queued = false;
  let queuedTimer: ReturnType<typeof setTimeout> | null = null;
  const fetchPayload = options.fetchPayload ?? fetchAlgoCockpitStreamPayload;
  const subscribeChanges =
    options.subscribeChanges ?? subscribeAlgoCockpitChanges;
  const setPollInterval = options.setInterval ?? setInterval;
  const clearPollInterval = options.clearInterval ?? clearInterval;
  const setPollTimeout = options.setTimeout ?? setTimeout;
  const clearPollTimeout = options.clearTimeout ?? clearTimeout;
  const coalescedPollDelayMs = Math.max(
    0,
    Math.floor(options.coalescedPollDelayMs ?? ALGO_COCKPIT_STREAM_COALESCE_MS),
  );
  let lastSignature = options.initialPayload
    ? stableStringify({ ...options.initialPayload, updatedAt: null })
    : "";

  const scheduleQueuedPoll = () => {
    if (!active || queuedTimer) {
      return;
    }
    queuedTimer = setPollTimeout(() => {
      queuedTimer = null;
      if (!active) {
        return;
      }
      queued = false;
      void tick();
    }, coalescedPollDelayMs);
    queuedTimer.unref?.();
  };

  const tick = async () => {
    if (!active) {
      return;
    }
    if (inFlight || queuedTimer) {
      queued = true;
      return;
    }
    inFlight = true;
    try {
      queued = false;
      const payload = await fetchPayload(
        input,
        "algo-cockpit-live",
      );
      if (!active) {
        return;
      }
      const signature = stableStringify({ ...payload, updatedAt: null });
      const changed = signature !== lastSignature;
      if (changed) {
        lastSignature = signature;
        onSnapshot(payload);
      }
      await options.onPollSuccess?.({ payload, changed });
    } catch (error) {
      logger.warn({ err: error }, "Algo cockpit stream polling failed");
    } finally {
      inFlight = false;
      if (active && queued) {
        queued = false;
        scheduleQueuedPoll();
      }
    }
  };

  const timer = setPollInterval(() => {
    void tick();
  }, ALGO_COCKPIT_STREAM_INTERVAL_MS);
  timer.unref?.();
  const unsubscribeChanges = subscribeChanges((change) => {
    if (
      input.deploymentId &&
      change.deploymentId &&
      change.deploymentId !== input.deploymentId
    ) {
      return;
    }
    if (input.mode && change.mode && change.mode !== input.mode) {
      return;
    }
    void tick();
  });

  void tick();

  return () => {
    active = false;
    clearPollInterval(timer);
    if (queuedTimer) {
      clearPollTimeout(queuedTimer);
      queuedTimer = null;
    }
    unsubscribeChanges();
  };
}
