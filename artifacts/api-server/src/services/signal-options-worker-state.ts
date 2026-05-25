export type SignalOptionsWorkerSnapshot = {
  started: boolean;
  tickRunning: boolean;
  deploymentCount: number;
  activeDeploymentCount: number;
  maintenance: {
    runCount: number;
    totalClosedCount: number;
    lastRunAt: string | null;
    lastError: string | null;
    lastClosedCount: number;
    lastSkippedCount: number;
    lastDueCount: number;
    lastOrphanCount: number;
  };
  deployments: Array<{
    deploymentId: string;
    lastCheckedAtMs: number;
    failedUntilMs: number;
    lastSuccessAt: string | null;
    lastError: string | null;
    lastSkippedAt?: string | null;
    lastSkipReason?: string | null;
    skippedScanCount?: number;
    pressurePaused?: boolean;
    pressurePauseStartedAt?: string | null;
    pressurePauseAgeMs?: number | null;
    currentScanStartedAt: string | null;
    currentScanAgeMs: number | null;
    lastScanDurationMs: number | null;
    scanCount: number;
    totalFailureCount: number;
    failureCount: number;
    lastFailureAt: string | null;
    lastSignalCount: number;
    lastFreshSignalCount: number;
    lastStaleSignalCount: number;
    lastUnavailableSignalCount: number;
    lastLatestSignalBarAt: string | null;
    lastOldestSignalBarAt: string | null;
    lastCandidateCount: number;
    lastBlockedCandidateCount: number;
  }>;
};

const EMPTY_SNAPSHOT: SignalOptionsWorkerSnapshot = {
  started: false,
  tickRunning: false,
  deploymentCount: 0,
  activeDeploymentCount: 0,
  maintenance: {
    runCount: 0,
    totalClosedCount: 0,
    lastRunAt: null,
    lastError: null,
    lastClosedCount: 0,
    lastSkippedCount: 0,
    lastDueCount: 0,
    lastOrphanCount: 0,
  },
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
