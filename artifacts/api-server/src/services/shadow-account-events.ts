export type ShadowAccountChangeReason = "ledger" | "mark_refresh";

export type ShadowAccountChange = {
  reason: ShadowAccountChangeReason;
};

type ShadowAccountChangeListener = (change: ShadowAccountChange) => void;

const shadowAccountChangeListeners = new Set<ShadowAccountChangeListener>();

export function subscribeShadowAccountChanges(
  listener: ShadowAccountChangeListener,
) {
  shadowAccountChangeListeners.add(listener);
  return () => {
    shadowAccountChangeListeners.delete(listener);
  };
}

export function notifyShadowAccountChanged(
  change: ShadowAccountChange = { reason: "ledger" },
) {
  shadowAccountChangeListeners.forEach((listener) => listener(change));
}
