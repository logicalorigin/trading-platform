import { runWithDbAdmissionSignal } from "@workspace/db";
import { logger } from "../lib/logger";
import type { RuntimeMode } from "../lib/runtime";
import { listAlgoDeployments, listExecutionEvents } from "./automation";
import { subscribeAlgoCockpitChanges } from "./algo-cockpit-events";
import {
  getAlgoDeploymentCockpit,
  getSignalOptionsPerformance,
  listSignalOptionsAutomationState,
} from "./signal-options-automation";
import { getSignalMonitorProfile } from "./signal-monitor";
type Unsubscribe = () => void;
type AlgoCockpitChange = Parameters<
  Parameters<typeof subscribeAlgoCockpitChanges>[0]
>[0];

export const ALGO_COCKPIT_STREAM_INTERVAL_MS = 5_000;
export const ALGO_COCKPIT_STREAM_COALESCE_MS = 1_000;

export type AlgoCockpitStreamInput = {
  appUserId?: string | null;
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
  signalMonitorProfile: Awaited<
    ReturnType<typeof getSignalMonitorProfile>
  > | null;
};

const ALGO_COCKPIT_STREAM_SIGNATURE_VOLATILE_FIELDS = {
  updatedAt: null,
  cockpit: { generatedAt: null },
  performance: { generatedAt: null },
} as const;

const stableStringify = (value: unknown): string => JSON.stringify(value);
const algoCockpitPayloadSignatureCache = new WeakMap<
  AlgoCockpitStreamPayload,
  string
>();

function getAlgoCockpitPayloadChangeSignature(
  payload: AlgoCockpitStreamPayload,
): string {
  let signature = algoCockpitPayloadSignatureCache.get(payload);
  if (signature === undefined) {
    signature = stableStringify({
      ...payload,
      updatedAt: ALGO_COCKPIT_STREAM_SIGNATURE_VOLATILE_FIELDS.updatedAt,
      cockpit: payload.cockpit
        ? {
            ...payload.cockpit,
            ...ALGO_COCKPIT_STREAM_SIGNATURE_VOLATILE_FIELDS.cockpit,
          }
        : null,
      performance: payload.performance
        ? {
            ...payload.performance,
            ...ALGO_COCKPIT_STREAM_SIGNATURE_VOLATILE_FIELDS.performance,
          }
        : null,
    });
    algoCockpitPayloadSignatureCache.set(payload, signature);
  }
  return signature;
}

const normalizeMode = (mode: RuntimeMode | undefined): RuntimeMode =>
  mode === "live" ? "live" : "shadow";

const normalizeEventLimit = (limit: number | undefined): number =>
  Math.min(Math.max(Math.floor(limit ?? 20), 1), 100);

function normalizeAlgoCockpitStreamInputForKey(
  input: AlgoCockpitStreamInput = {},
): Required<AlgoCockpitStreamInput> & {
  appUserId: string | null;
  deploymentId: string | null;
} {
  return {
    appUserId:
      typeof input.appUserId === "string" && input.appUserId.trim()
        ? input.appUserId.trim()
        : null,
    deploymentId:
      typeof input.deploymentId === "string" && input.deploymentId.trim()
        ? input.deploymentId.trim()
        : null,
    mode: normalizeMode(input.mode),
    eventLimit: normalizeEventLimit(input.eventLimit),
  };
}

function getAlgoCockpitStreamSharingKey(input: AlgoCockpitStreamInput): string {
  return stableStringify(normalizeAlgoCockpitStreamInputForKey(input));
}

export function shouldUsePrimaryOnlyAlgoCockpitPayload(
  pressure: unknown,
): boolean {
  void pressure;
  return false;
}

async function resolveAlgoCockpitTarget(input: AlgoCockpitStreamInput = {}) {
  const requestedMode = normalizeMode(input.mode);
  const requestedDeploymentId =
    typeof input.deploymentId === "string" && input.deploymentId.trim()
      ? input.deploymentId.trim()
      : null;
  const deploymentList = requestedDeploymentId
    ? await listAlgoDeployments({})
    : { deployments: [] };
  const focusedDeployment = requestedDeploymentId
    ? (deploymentList.deployments.find(
        (deployment) => deployment.id === requestedDeploymentId,
      ) ?? null)
    : null;
  const deploymentId = focusedDeployment?.id ?? null;
  const mode = focusedDeployment?.mode ?? requestedMode;
  const eventLimit = normalizeEventLimit(input.eventLimit);

  return {
    deployments: focusedDeployment ? deploymentList : { deployments: [] },
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
    target.deploymentId
      ? listExecutionEvents({
          deploymentId: target.deploymentId,
          limit: primaryEventLimit,
        })
      : Promise.resolve({ events: [] }),
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
  const [
    events,
    signalOptionsState,
    cockpit,
    performance,
    signalMonitorProfile,
  ] = await Promise.all([
    target.deploymentId
      ? listExecutionEvents({
          deploymentId: target.deploymentId,
          limit: target.eventLimit,
        })
      : Promise.resolve({ events: [] }),
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
    target.deploymentId
      ? getSignalMonitorProfile({ environment: target.mode })
      : Promise.resolve(null),
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

type AlgoCockpitSnapshotSubscriber = {
  input: AlgoCockpitStreamInput;
  active: boolean;
  lastSignature: string;
  onSnapshot: (payload: AlgoCockpitStreamPayload) => unknown;
  onPollSuccess?: (input: {
    payload: AlgoCockpitStreamPayload;
    changed: boolean;
  }) => void | Promise<void>;
};

type AlgoCockpitSharedPoller = {
  key: string;
  input: AlgoCockpitStreamInput;
  subscribers: Set<AlgoCockpitSnapshotSubscriber>;
  active: boolean;
  inFlight: boolean;
  queued: boolean;
  queuedTimer: ReturnType<typeof setTimeout> | null;
  timer: ReturnType<typeof setInterval> | null;
  unsubscribeChanges: Unsubscribe;
  tick: () => Promise<void>;
  start: () => void;
  stop: () => void;
  deliverToSubscriber: (
    subscriber: AlgoCockpitSnapshotSubscriber,
    payload: AlgoCockpitStreamPayload,
  ) => Promise<void>;
};

const algoCockpitSharedPollers = new Map<string, AlgoCockpitSharedPoller>();

function algoCockpitChangeMatchesSubscriber(
  input: AlgoCockpitStreamInput,
  change: AlgoCockpitChange,
): boolean {
  if (
    input.deploymentId &&
    change.deploymentId &&
    change.deploymentId !== input.deploymentId
  ) {
    return false;
  }
  if (input.mode && change.mode && change.mode !== input.mode) {
    return false;
  }
  return true;
}

function createAlgoCockpitSharedPoller(
  key: string,
  input: AlgoCockpitStreamInput,
  options: {
    fetchPayload: typeof fetchAlgoCockpitStreamPayload;
    subscribeChanges: typeof subscribeAlgoCockpitChanges;
    setInterval: typeof setInterval;
    clearInterval: typeof clearInterval;
    setTimeout: typeof setTimeout;
    clearTimeout: typeof clearTimeout;
    coalescedPollDelayMs: number;
  },
): AlgoCockpitSharedPoller {
  const pollController = new AbortController();
  const poller: AlgoCockpitSharedPoller = {
    key,
    input,
    subscribers: new Set(),
    active: true,
    inFlight: false,
    queued: false,
    queuedTimer: null,
    timer: null,
    unsubscribeChanges: () => {},
    deliverToSubscriber: async (subscriber, payload) => {
      if (!subscriber.active) {
        return;
      }
      const signature = getAlgoCockpitPayloadChangeSignature(payload);
      const changed = signature !== subscriber.lastSignature;
      let snapshotDelivered = true;
      if (changed) {
        try {
          await subscriber.onSnapshot(payload);
          subscriber.lastSignature = signature;
        } catch (error) {
          snapshotDelivered = false;
          logger.warn(
            { err: error },
            "Algo cockpit stream subscriber write failed",
          );
        }
      }
      if (!snapshotDelivered || !subscriber.active) {
        return;
      }
      try {
        await subscriber.onPollSuccess?.({ payload, changed });
      } catch (error) {
        logger.warn(
          { err: error },
          "Algo cockpit stream subscriber freshness write failed",
        );
      }
    },
    tick: () =>
      runWithDbAdmissionSignal(pollController.signal, async () => {
        if (!poller.active) {
          return;
        }
        if (poller.inFlight || poller.queuedTimer) {
          poller.queued = true;
          return;
        }
        poller.inFlight = true;
        try {
          poller.queued = false;
          const payload = await options.fetchPayload(
            poller.input,
            "algo-cockpit-live",
          );
          if (!poller.active) {
            return;
          }
          for (const subscriber of [...poller.subscribers]) {
            await poller.deliverToSubscriber(subscriber, payload);
          }
        } catch (error) {
          if (poller.active) {
            logger.warn({ err: error }, "Algo cockpit stream polling failed");
          }
        } finally {
          poller.inFlight = false;
          if (poller.active && poller.queued) {
            poller.queued = false;
            if (!poller.queuedTimer) {
              poller.queuedTimer = options.setTimeout(() => {
                poller.queuedTimer = null;
                if (!poller.active) {
                  return;
                }
                poller.queued = false;
                void poller.tick();
              }, options.coalescedPollDelayMs);
              poller.queuedTimer.unref?.();
            }
          }
        }
      }),
    start: () => {
      poller.timer = options.setInterval(() => {
        void poller.tick();
      }, ALGO_COCKPIT_STREAM_INTERVAL_MS);
      poller.timer.unref?.();
      poller.unsubscribeChanges = options.subscribeChanges((change) => {
        for (const subscriber of poller.subscribers) {
          if (algoCockpitChangeMatchesSubscriber(subscriber.input, change)) {
            void poller.tick();
            return;
          }
        }
      });
      void poller.tick();
    },
    stop: () => {
      poller.active = false;
      pollController.abort();
      if (poller.timer) {
        options.clearInterval(poller.timer);
        poller.timer = null;
      }
      if (poller.queuedTimer) {
        options.clearTimeout(poller.queuedTimer);
        poller.queuedTimer = null;
      }
      poller.unsubscribeChanges();
      if (algoCockpitSharedPollers.get(poller.key) === poller) {
        algoCockpitSharedPollers.delete(poller.key);
      }
    },
  };

  return poller;
}

export function subscribeAlgoCockpitSnapshots(
  input: AlgoCockpitStreamInput,
  onSnapshot: (payload: AlgoCockpitStreamPayload) => unknown,
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
  const subscriber: AlgoCockpitSnapshotSubscriber = {
    input,
    active: true,
    onSnapshot,
    onPollSuccess: options.onPollSuccess,
    lastSignature: options.initialPayload
      ? getAlgoCockpitPayloadChangeSignature(options.initialPayload)
      : "",
  };

  const key = getAlgoCockpitStreamSharingKey(input);
  let poller = algoCockpitSharedPollers.get(key);
  if (!poller) {
    poller = createAlgoCockpitSharedPoller(
      key,
      normalizeAlgoCockpitStreamInputForKey(input),
      {
        fetchPayload,
        subscribeChanges,
        setInterval: setPollInterval,
        clearInterval: clearPollInterval,
        setTimeout: setPollTimeout,
        clearTimeout: clearPollTimeout,
        coalescedPollDelayMs,
      },
    );
    algoCockpitSharedPollers.set(key, poller);
    poller.subscribers.add(subscriber);
    poller.start();
  } else {
    poller.subscribers.add(subscriber);
    if (!poller.inFlight) {
      void poller.tick();
    }
  }

  return () => {
    if (!subscriber.active) {
      return;
    }
    subscriber.active = false;
    poller?.subscribers.delete(subscriber);
    if (poller && poller.subscribers.size === 0) {
      poller.stop();
    }
  };
}
