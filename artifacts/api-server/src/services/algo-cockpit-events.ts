type AlgoCockpitChange = {
  deploymentId?: string | null;
  mode?: "paper" | "live" | null;
  reason: string;
  at: Date;
};

type AlgoCockpitChangeListener = (change: AlgoCockpitChange) => void;

const listeners = new Set<AlgoCockpitChangeListener>();

export function notifyAlgoCockpitChanged(input: {
  deploymentId?: string | null;
  mode?: "paper" | "live" | null;
  reason: string;
}): void {
  const change: AlgoCockpitChange = {
    deploymentId: input.deploymentId ?? null,
    mode: input.mode ?? null,
    reason: input.reason,
    at: new Date(),
  };
  listeners.forEach((listener) => listener(change));
}

export function subscribeAlgoCockpitChanges(
  listener: AlgoCockpitChangeListener,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
