export type OvernightSpotWorkerSnapshot = {
  started: boolean;
  tickRunning: boolean;
  deploymentCount: number;
  deployments: Array<{
    deploymentId: string;
    lastCheckedAt: string | null;
    lastSuccessAt: string | null;
    lastError: string | null;
    lastSkippedAt: string | null;
    lastSkipReason: string | null;
    scanCount: number;
    failureCount: number;
    skippedScanCount: number;
    lastScanDurationMs: number | null;
    lastCandidateCount: number;
    lastExecutedCount: number;
    lastBlockedCount: number;
    lastSkippedCount: number;
    lastFailedCount: number;
    timedOut?: boolean;
    unsettledAfterTimeout?: boolean;
    nextScanDueAt: string | null;
    nextScanDueInMs: number | null;
  }>;
};

const EMPTY_SNAPSHOT: OvernightSpotWorkerSnapshot = {
  started: false,
  tickRunning: false,
  deploymentCount: 0,
  deployments: [],
};

let snapshotGetter: () => OvernightSpotWorkerSnapshot = () => EMPTY_SNAPSHOT;

export function registerOvernightSpotWorkerSnapshotGetter(
  getter: () => OvernightSpotWorkerSnapshot,
) {
  snapshotGetter = getter;
}

export function getOvernightSpotWorkerSnapshot() {
  return snapshotGetter();
}
