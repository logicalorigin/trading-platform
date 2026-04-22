import { useEffect, useMemo, useRef, useState } from "react";
import {
  getMassiveOptionTrackingSnapshots,
  trackMassiveOptionContract,
  untrackMassiveOptionContract,
} from "../lib/brokerClient.js";
import { clearRuntimeActivity, upsertRuntimeActivity } from "../lib/runtimeDiagnostics.js";

function normalizeRequest(request) {
  if (!request || typeof request !== "object") {
    return null;
  }
  const trackingId = String(request.trackingId || "").trim();
  const optionTicker = String(request.optionTicker || "").trim().toUpperCase();
  if (!trackingId || !optionTicker) {
    return null;
  }
  return {
    trackingId,
    optionTicker,
    label: String(request.label || "").trim() || null,
    sourceType: String(request.sourceType || "").trim() || null,
    sourceId: String(request.sourceId || "").trim() || null,
    openedAt: request.openedAt || null,
    entrySignalTs: request.entrySignalTs || null,
    exitSignalTs: request.exitSignalTs || null,
  };
}

function buildRequestSignature(request) {
  if (!request) {
    return "";
  }
  return [
    request.trackingId,
    request.optionTicker,
    request.label || "",
    request.sourceType || "",
    request.sourceId || "",
    request.openedAt || "",
    request.entrySignalTs || "",
    request.exitSignalTs || "",
  ].join("|");
}

export function useMassiveOptionTracking(
  requests = [],
  {
    pollMs = 5000,
    diagnosticsId = "massive-option-tracking",
    diagnosticsSurface = null,
  } = {},
) {
  const [snapshotsByTrackingId, setSnapshotsByTrackingId] = useState({});
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState(null);
  const activeRequestsRef = useRef(new Map());
  const syncGenerationRef = useRef(0);

  const normalizedRequests = useMemo(() => {
    const byId = new Map();
    for (const request of Array.isArray(requests) ? requests : []) {
      const normalized = normalizeRequest(request);
      if (normalized) {
        byId.set(normalized.trackingId, normalized);
      }
    }
    return Array.from(byId.values()).sort((left, right) => left.trackingId.localeCompare(right.trackingId));
  }, [requests]);

  const requestSignature = useMemo(
    () => normalizedRequests.map(buildRequestSignature).join("||"),
    [normalizedRequests],
  );
  const normalizedRequestsById = useMemo(
    () => new Map(normalizedRequests.map((request) => [request.trackingId, request])),
    [normalizedRequests],
  );
  const effectivePollMs = Math.max(1000, Number(pollMs) || 5000);

  useEffect(() => {
    const activityId = `poller.${String(diagnosticsId || "massive-option-tracking").trim() || "massive-option-tracking"}`;
    if (!normalizedRequests.length) {
      clearRuntimeActivity(activityId);
      return undefined;
    }
    upsertRuntimeActivity(activityId, {
      kind: "poller",
      label: "Massive option tracking",
      surface: diagnosticsSurface,
      intervalMs: effectivePollMs,
      meta: {
        trackedContracts: normalizedRequests.length,
      },
    });
    return () => clearRuntimeActivity(activityId);
  }, [diagnosticsId, diagnosticsSurface, effectivePollMs, normalizedRequests.length]);

  useEffect(() => {
    let cancelled = false;
    const previous = activeRequestsRef.current;
    const next = new Map(normalizedRequests.map((request) => [request.trackingId, request]));
    activeRequestsRef.current = next;

    const removedIds = Array.from(previous.keys()).filter((trackingId) => !next.has(trackingId));
    const changedRequests = normalizedRequests.filter(
      (request) => buildRequestSignature(previous.get(request.trackingId)) !== buildRequestSignature(request),
    );

    if (removedIds.length) {
      setSnapshotsByTrackingId((prev) => {
        const nextSnapshots = { ...prev };
        for (const trackingId of removedIds) {
          delete nextSnapshots[trackingId];
        }
        return nextSnapshots;
      });
    }

    const syncRequests = async () => {
      if (removedIds.length) {
        await Promise.allSettled(
          removedIds.map((trackingId) => untrackMassiveOptionContract({ trackingId })),
        );
      }
      if (cancelled || syncGenerationRef.current !== currentGeneration) {
        return;
      }
      if (changedRequests.length) {
        await Promise.allSettled(
          changedRequests.map((request) => trackMassiveOptionContract(request)),
        );
      }
    };

    const currentGeneration = syncGenerationRef.current + 1;
    syncGenerationRef.current = currentGeneration;
    syncRequests().catch((nextError) => {
      if (!cancelled) {
        setError(nextError?.message || "Failed to sync Massive option tracking.");
      }
    });

    return () => {
      cancelled = true;
    };
  }, [normalizedRequests, requestSignature]);

  useEffect(() => {
    const trackingIds = normalizedRequests.map((request) => request.trackingId);
    if (!trackingIds.length) {
      setSnapshotsByTrackingId({});
      setStatus("idle");
      setError(null);
      return undefined;
    }

    let cancelled = false;
    let inFlight = false;

    const loadSnapshots = async () => {
      if (inFlight) {
        return;
      }
      inFlight = true;
      setStatus((current) => (current === "ready" ? current : "loading"));
      try {
        const response = await getMassiveOptionTrackingSnapshots({ trackingIds });
        if (cancelled) {
          return;
        }
        const nextSnapshots = Object.fromEntries(
          (Array.isArray(response?.snapshots) ? response.snapshots : [])
            .filter((snapshot) => snapshot && snapshot.trackingId)
            .map((snapshot) => [snapshot.trackingId, snapshot]),
        );
        const missingRequests = trackingIds
          .map((trackingId) => normalizedRequestsById.get(trackingId))
          .filter((request) => request && !nextSnapshots[request.trackingId]);
        if (missingRequests.length) {
          await Promise.allSettled(
            missingRequests.map((request) => trackMassiveOptionContract(request)),
          );
        }
        if (cancelled) {
          return;
        }
        setSnapshotsByTrackingId(nextSnapshots);
        setStatus("ready");
        setError(null);
      } catch (nextError) {
        if (cancelled) {
          return;
        }
        setStatus("error");
        setError(nextError?.message || "Failed to load Massive option tracking.");
      } finally {
        inFlight = false;
      }
    };

    loadSnapshots();
    const timerId = setInterval(loadSnapshots, effectivePollMs);
    return () => {
      cancelled = true;
      clearInterval(timerId);
    };
  }, [effectivePollMs, normalizedRequests, normalizedRequestsById, requestSignature]);

  useEffect(() => () => {
    const activeIds = Array.from(activeRequestsRef.current.keys());
    activeRequestsRef.current = new Map();
    if (!activeIds.length) {
      return;
    }
    Promise.allSettled(
      activeIds.map((trackingId) => untrackMassiveOptionContract({ trackingId })),
    ).catch(() => {});
  }, []);

  return {
    snapshotsByTrackingId,
    status,
    error,
  };
}
