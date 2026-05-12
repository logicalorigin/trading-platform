type ShadowAccountChangeListener = () => void;

const shadowAccountChangeListeners = new Set<ShadowAccountChangeListener>();

export function subscribeShadowAccountChanges(
  listener: ShadowAccountChangeListener,
) {
  shadowAccountChangeListeners.add(listener);
  return () => {
    shadowAccountChangeListeners.delete(listener);
  };
}

export function notifyShadowAccountChanged() {
  shadowAccountChangeListeners.forEach((listener) => listener());
}
