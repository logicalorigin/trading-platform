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

export type AlgoCockpitStreamInput = {
  deploymentId?: string | null;
  mode?: RuntimeMode;
  eventLimit?: number;
};

export type AlgoCockpitStreamPayload = {
  stream: "algo-cockpit-bootstrap" | "algo-cockpit-live";
  phase?: "critical" | "full";
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
  mode === "live" ? "live" : "paper";

const normalizeEventLimit = (limit: number | undefined): number =>
  Math.min(Math.max(Math.floor(limit ?? 20), 1), 100);

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

export async function fetchAlgoCockpitCriticalPayload(
  input: AlgoCockpitStreamInput = {},
  stream: AlgoCockpitStreamPayload["stream"] = "algo-cockpit-live",
): Promise<AlgoCockpitStreamPayload> {
  const target = await resolveAlgoCockpitTarget(input);
  const [events, signalOptionsState] = await Promise.all([
    listExecutionEvents(
      target.deploymentId
        ? { deploymentId: target.deploymentId, limit: target.eventLimit }
        : { limit: target.eventLimit },
    ),
    target.deploymentId
      ? listSignalOptionsAutomationState({ deploymentId: target.deploymentId })
      : Promise.resolve(null),
  ]);

  return {
    stream,
    phase: "critical",
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
        ? listSignalOptionsAutomationState({ deploymentId: target.deploymentId })
        : Promise.resolve(null),
      target.deploymentId
        ? getAlgoDeploymentCockpit({ deploymentId: target.deploymentId })
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
  } = {},
): Unsubscribe {
  let active = true;
  let inFlight = false;
  let queued = false;
  let lastSignature = options.initialPayload
    ? stableStringify({ ...options.initialPayload, updatedAt: null })
    : "";

  const tick = async () => {
    if (!active || inFlight) {
      if (inFlight) {
        queued = true;
      }
      return;
    }
    inFlight = true;
    try {
      do {
        queued = false;
        const payload = await fetchAlgoCockpitStreamPayload(
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
      } while (active && queued);
    } catch (error) {
      logger.warn({ err: error }, "Algo cockpit stream polling failed");
    } finally {
      inFlight = false;
    }
  };

  const timer = setInterval(() => {
    void tick();
  }, ALGO_COCKPIT_STREAM_INTERVAL_MS);
  timer.unref?.();
  const unsubscribeChanges = subscribeAlgoCockpitChanges((change) => {
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
    clearInterval(timer);
    unsubscribeChanges();
  };
}
