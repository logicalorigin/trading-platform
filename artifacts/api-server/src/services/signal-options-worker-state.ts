export type SignalOptionsWorkerSnapshot = {
  started: boolean;
  tickRunning: boolean;
  deploymentCount: number;
  activeDeploymentCount: number;
  deployments: Array<{
    deploymentId: string;
    lastCheckedAtMs: number;
    failedUntilMs: number;
    lastSuccessAt: string | null;
    lastError: string | null;
    scanCount: number;
    failureCount: number;
  }>;
};

const EMPTY_SNAPSHOT: SignalOptionsWorkerSnapshot = {
  started: false,
  tickRunning: false,
  deploymentCount: 0,
  activeDeploymentCount: 0,
  deployments: [],
};

let snapshotGetter: () => SignalOptionsWorkerSnapshot = () => EMPTY_SNAPSHOT;

export function registerSignalOptionsWorkerSnapshotGetter(
  getter: () => SignalOptionsWorkerSnapshot,
) {
  snapshotGetter = getter;
}

export function getSignalOptionsWorkerSnapshot() {
  return snapshotGetter();
}
