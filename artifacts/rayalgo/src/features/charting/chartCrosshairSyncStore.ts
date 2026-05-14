export type CrosshairSyncEvent =
  | { kind: "move"; groupId: string; sourceId: string; time: number }
  | { kind: "clear"; groupId: string; sourceId: string };

type CrosshairSyncHandler = (event: CrosshairSyncEvent) => void;

type GroupEntry = {
  handlers: Map<string, CrosshairSyncHandler>;
};

const groups = new Map<string, GroupEntry>();

const ensureGroup = (groupId: string): GroupEntry => {
  const existing = groups.get(groupId);
  if (existing) {
    return existing;
  }
  const created: GroupEntry = { handlers: new Map() };
  groups.set(groupId, created);
  return created;
};

export const publishCrosshairSync = (event: CrosshairSyncEvent): void => {
  const group = groups.get(event.groupId);
  if (!group || group.handlers.size === 0) {
    return;
  }
  group.handlers.forEach((handler, subscriberId) => {
    if (subscriberId === event.sourceId) {
      return;
    }
    try {
      handler(event);
    } catch (error) {
      if (import.meta.env?.DEV) {
        // eslint-disable-next-line no-console
        console.warn("[rayalgo] crosshair sync handler failed", error);
      }
    }
  });
};

export const subscribeCrosshairSync = (
  groupId: string,
  subscriberId: string,
  handler: CrosshairSyncHandler,
): (() => void) => {
  const group = ensureGroup(groupId);
  group.handlers.set(subscriberId, handler);
  return () => {
    const entry = groups.get(groupId);
    if (!entry) {
      return;
    }
    if (entry.handlers.get(subscriberId) === handler) {
      entry.handlers.delete(subscriberId);
    }
    if (entry.handlers.size === 0) {
      groups.delete(groupId);
    }
  };
};

export const getCrosshairSyncSubscriberCount = (groupId: string): number => {
  return groups.get(groupId)?.handlers.size ?? 0;
};

export const resetCrosshairSyncStoreForTests = (): void => {
  groups.clear();
};
