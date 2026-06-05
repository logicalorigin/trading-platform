import {
  useEffect,
  useMemo,
  useSyncExternalStore,
} from "react";

const DEFAULT_ARTIFACT_ID = "artifacts/pyrus";
const DEFAULT_HEARTBEAT_MS = 1_000;
const DEFAULT_STALE_MS = 4_000;
const STORAGE_PREFIX = "pyrus:workspace-leader:";
const CHANNEL_PREFIX = "pyrus-workspace-leader:";

const createInstanceId = () => {
  const random = Math.random().toString(36).slice(2);
  return `${Date.now().toString(36)}-${random}`;
};

const safeJsonParse = (value) => {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
};

const readDocumentVisible = (documentRef) =>
  !documentRef || documentRef.visibilityState !== "hidden";

export function createWorkspaceLeadershipStore({
  artifactId = DEFAULT_ARTIFACT_ID,
  instanceId = createInstanceId(),
  storage =
    typeof window !== "undefined" ? window.localStorage : null,
  channelFactory =
    typeof BroadcastChannel !== "undefined"
      ? (name) => new BroadcastChannel(name)
      : null,
  documentRef = typeof document !== "undefined" ? document : null,
  windowRef = typeof window !== "undefined" ? window : null,
  now = () => Date.now(),
  heartbeatMs = DEFAULT_HEARTBEAT_MS,
  staleMs = DEFAULT_STALE_MS,
} = {}) {
  const storageKey = `${STORAGE_PREFIX}${artifactId}`;
  const channelName = `${CHANNEL_PREFIX}${artifactId}`;
  const listeners = new Set();
  let started = false;
  let channel = null;
  let heartbeatTimer = null;
  let snapshot = {
    artifactId,
    instanceId,
    isLeader: false,
    visible: readDocumentVisible(documentRef),
    leaderId: null,
    reason: "stopped",
  };

  const emit = (next) => {
    const changed = Object.entries(next).some(
      ([key, value]) => snapshot[key] !== value,
    );
    if (!changed) return;
    snapshot = { ...snapshot, ...next };
    listeners.forEach((listener) => listener());
  };

  const readLeader = () => {
    if (!storage) return null;
    try {
      return safeJsonParse(storage.getItem(storageKey));
    } catch {
      return null;
    }
  };

  const writeLeader = (visible) => {
    if (!storage) return false;
    const updatedAt = now();
    try {
      storage.setItem(
        storageKey,
        JSON.stringify({
          artifactId,
          instanceId,
          visible,
          updatedAt,
          expiresAt: updatedAt + staleMs,
        }),
      );
      channel?.postMessage?.({ type: "leader-heartbeat", instanceId });
      return true;
    } catch {
      return false;
    }
  };

  const clearOwnLeader = () => {
    if (!storage) return;
    const leader = readLeader();
    if (leader?.instanceId === instanceId) {
      try {
        storage.removeItem(storageKey);
        channel?.postMessage?.({ type: "leader-released", instanceId });
      } catch {
        // Storage can be unavailable while a Replit iframe is being restored.
      }
    }
  };

  const evaluateLeadership = () => {
    const visible = readDocumentVisible(documentRef);
    if (!storage) {
      emit({
        isLeader: true,
        visible,
        leaderId: instanceId,
        reason: "storage-unavailable",
      });
      return snapshot;
    }

    const leader = readLeader();
    const leaderId =
      typeof leader?.instanceId === "string" ? leader.instanceId : null;
    const leaderExpiresAt = Number(leader?.expiresAt);
    const leaderFresh =
      leaderId && Number.isFinite(leaderExpiresAt) && leaderExpiresAt > now();
    const ownLeader = leaderId === instanceId;
    const canClaim = !leaderFresh || ownLeader;

    if (canClaim) {
      if (!writeLeader(visible)) {
        emit({
          isLeader: true,
          visible,
          leaderId: instanceId,
          reason: "storage-unavailable",
        });
        return snapshot;
      }
      emit({
        isLeader: true,
        visible,
        leaderId: instanceId,
        reason: ownLeader ? "leader-heartbeat" : "leader-claimed",
      });
      return snapshot;
    }

    emit({
      isLeader: false,
      visible,
      leaderId: leaderFresh ? leaderId : null,
      reason: "follower",
    });
    return snapshot;
  };

  const onVisibilityChange = () => {
    evaluateLeadership();
  };

  const onStorage = (event) => {
    if (!event || event.key === storageKey) {
      evaluateLeadership();
    }
  };

  const start = () => {
    if (started) return;
    started = true;
    if (channelFactory) {
      try {
        channel = channelFactory(channelName);
        channel.onmessage = () => evaluateLeadership();
      } catch {
        channel = null;
      }
    }
    documentRef?.addEventListener?.("visibilitychange", onVisibilityChange);
    windowRef?.addEventListener?.("storage", onStorage);
    evaluateLeadership();
    heartbeatTimer = windowRef?.setInterval
      ? windowRef.setInterval(evaluateLeadership, heartbeatMs)
      : setInterval(evaluateLeadership, heartbeatMs);
  };

  const stop = () => {
    if (!started) return;
    started = false;
    if (heartbeatTimer != null) {
      if (windowRef?.clearInterval) {
        windowRef.clearInterval(heartbeatTimer);
      } else {
        clearInterval(heartbeatTimer);
      }
      heartbeatTimer = null;
    }
    documentRef?.removeEventListener?.("visibilitychange", onVisibilityChange);
    windowRef?.removeEventListener?.("storage", onStorage);
    clearOwnLeader();
    channel?.close?.();
    channel = null;
    emit({
      isLeader: false,
      visible: readDocumentVisible(documentRef),
      leaderId: null,
      reason: "stopped",
    });
  };

  return {
    artifactId,
    instanceId,
    storageKey,
    start,
    stop,
    evaluateLeadership,
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function useWorkspaceLeadership({
  artifactId = DEFAULT_ARTIFACT_ID,
  enabled = true,
} = {}) {
  const store = useMemo(
    () => createWorkspaceLeadershipStore({ artifactId }),
    [artifactId],
  );

  useEffect(() => {
    if (!enabled) {
      store.stop();
      return undefined;
    }
    store.start();
    return () => store.stop();
  }, [enabled, store]);

  return useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
}
