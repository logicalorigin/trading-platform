// Shared per-deployment freshness for the algo cockpit SSE stream.
//
// Only one component owns the cockpit EventSource at a time (AlgoScreen while
// the algo page is active — the sidebar's own scoped stream is gated off with
// reason "algo-screen-primary-stream" to avoid a duplicate connection). The
// sidebar previously had no way to see that owner's deployment-scoped
// freshness: the shell's external stream is unscoped (deploymentId null), so
// resolveAlgoMonitorRestPolling fell back to EMPTY freshness, the Runtime band
// showed a permanent "polling" state, and the 30s REST catch-up queries ran
// forever even while SSE was pushing. The stream owner records freshness here
// at mark time; any consumer can read it for its own deployment.
import { useEffect, useState } from "react";
import { freshnessUnchanged, isStreamFresh } from "./streamFreshness";

type FreshnessKind = "primary" | "full" | "heartbeat";

type RegistryEntry = {
  lastEventAt: number | null;
  lastPrimaryEventAt: number | null;
  lastFullEventAt: number | null;
};

export type AlgoCockpitRegistryFreshness = {
  deploymentId: string;
  deploymentScoped: true;
  algoLastEventAt: number | null;
  algoFresh: boolean;
  algoPrimaryFresh: boolean;
  algoFullFresh: boolean;
};

const timestampsByDeployment = new Map<string, RegistryEntry>();

const normalizeDeploymentId = (value: string | null | undefined): string =>
  String(value || "").trim();

export const recordAlgoCockpitStreamFreshness = (
  deploymentId: string | null | undefined,
  kind: FreshnessKind,
  atMs: number,
): void => {
  const id = normalizeDeploymentId(deploymentId);
  if (!id) {
    return;
  }
  let entry = timestampsByDeployment.get(id);
  if (!entry) {
    entry = { lastEventAt: null, lastPrimaryEventAt: null, lastFullEventAt: null };
    timestampsByDeployment.set(id, entry);
  }
  entry.lastEventAt = atMs;
  if (kind === "primary" || kind === "full") {
    entry.lastPrimaryEventAt = atMs;
  }
  if (kind === "full") {
    entry.lastFullEventAt = atMs;
  }
};

export const readAlgoCockpitStreamFreshness = (
  deploymentId: string | null | undefined,
  nowMs: number,
  freshMs: number,
): AlgoCockpitRegistryFreshness | null => {
  const id = normalizeDeploymentId(deploymentId);
  const entry = id ? timestampsByDeployment.get(id) : undefined;
  if (!entry) {
    return null;
  }
  return {
    deploymentId: id,
    deploymentScoped: true,
    algoLastEventAt: entry.lastEventAt,
    algoFresh: isStreamFresh(entry.lastEventAt, nowMs, freshMs),
    algoPrimaryFresh: isStreamFresh(entry.lastPrimaryEventAt, nowMs, freshMs),
    algoFullFresh: isStreamFresh(entry.lastFullEventAt, nowMs, freshMs),
  };
};

export const clearAlgoCockpitStreamFreshness = (
  deploymentId: string | null | undefined,
): void => {
  const id = normalizeDeploymentId(deploymentId);
  if (id) {
    timestampsByDeployment.delete(id);
  }
};

export const resetAlgoCockpitStreamFreshnessRegistryForTests = (): void => {
  timestampsByDeployment.clear();
};

/**
 * Registry-backed freshness for consumers that do not own the EventSource.
 * Same once-per-second flip-gated recompute pattern as useAlgoCockpitStream:
 * state commits only when a freshness field actually changes. Returns null
 * until the registry has seen at least one event for the deployment.
 */
export const useAlgoCockpitRegistryFreshness = (
  deploymentId: string | null | undefined,
  freshMs: number,
  enabled = true,
): AlgoCockpitRegistryFreshness | null => {
  const [freshness, setFreshness] = useState<AlgoCockpitRegistryFreshness | null>(
    () =>
      enabled && normalizeDeploymentId(deploymentId)
        ? readAlgoCockpitStreamFreshness(deploymentId, Date.now(), freshMs)
        : null,
  );
  useEffect(() => {
    if (!enabled || !normalizeDeploymentId(deploymentId)) {
      setFreshness(null);
      return undefined;
    }
    const tick = () => {
      const next = readAlgoCockpitStreamFreshness(deploymentId, Date.now(), freshMs);
      setFreshness((prev) =>
        prev && next && freshnessUnchanged(prev, next) ? prev : next,
      );
    };
    tick();
    const interval = setInterval(tick, 1_000);
    return () => clearInterval(interval);
  }, [deploymentId, enabled, freshMs]);
  return enabled && normalizeDeploymentId(deploymentId) ? freshness : null;
};
