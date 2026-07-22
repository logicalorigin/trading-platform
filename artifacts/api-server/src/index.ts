// MUST stay the first import: applies .pyrus-runtime/dev-env.local overrides
// before any module reads process.env.
import "./dev-env-local";
import { createServer } from "node:http";
import { closeDatabaseConnections, runInDbLane } from "@workspace/db";
import app from "./app";
import { logger } from "./lib/logger";
import { isTransientPostgresError } from "./lib/transient-db-error";
import {
  recordServerDiagnosticEvent,
  startDiagnosticsCollector,
} from "./services/diagnostics";
import {
  appendRuntimeFlightRecorderEvent,
  importRuntimeFlightRecorderIncidents,
  installRuntimeFlightRecorderDbDiagnostics,
  installRuntimeFlightRecorderProcessHandlers,
  setRuntimeFlightRecorderMemoryCensusProvider,
  startRuntimeFlightRecorder,
} from "./services/runtime-flight-recorder";
import {
  startAccountFlexRefreshScheduler,
} from "./services/account";
import {
  getRuntimeDiagnostics,
  getOptionExpirationCacheDiagnostics,
  startFlowUniverseOptionabilityVerifier,
  startOptionsFlowScanner,
} from "./services/platform";
import { startSignalOptionsWorker } from "./services/signal-options-worker";
import { startSignalOptionsPositionTickManager } from "./services/signal-options-position-tick-manager";
import { startAlgoOptionTargetReconciliationWorker } from "./services/algo-option-target-reconciliation-worker";
import { startSignalOptionsLiveTargetPositionWorker } from "./services/signal-options-live-target-position-worker";
import {
  getSignalMonitorResidentBarStats,
  startSignalMonitorBreadthSnapshotWorker,
  startSignalMonitorServerOwnedProducer,
  startSignalMonitorStateReconciliation,
} from "./services/signal-monitor";
import { getSignalMonitorLocalBarCacheDiagnostics } from "./services/signal-monitor-local-bar-cache";
import { startOvernightSpotWorker } from "./services/overnight-spot-worker";
import { startSignalUniverseRankingScheduler } from "./services/signal-universe-ranking";
import { startDbDiskUsageGuard } from "./services/db-disk-usage-guard";
import { startSnapshotRetentionScheduler } from "./services/snapshot-retention-scheduler";
import { startSnapTradeHistoryRefreshScheduler } from "./services/snaptrade-history-scheduler";
import { startRobinhoodHistoryRefreshScheduler } from "./services/robinhood-history-scheduler";
import { ensureDefaultSignalOptionsPaperDeployment } from "./services/signal-options-automation";
import {
  getPythonComputeDiagnostics,
  startPythonComputeRuntime,
  stopPythonComputeRuntime,
} from "./services/python-compute";
import { attachOptionQuoteWebSocket } from "./ws/options-quotes";
import { attachIbkrPortalWebSocket } from "./routes/ibkr-portal";
import {
  diagnosticsUserScopedBrokerProbes,
} from "./services/diagnostics-account-probes";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = createServer(app);
attachOptionQuoteWebSocket(server);
attachIbkrPortalWebSocket(server);
installRuntimeFlightRecorderProcessHandlers();
installRuntimeFlightRecorderDbDiagnostics();
setRuntimeFlightRecorderMemoryCensusProvider(() => ({
  residentBars: getSignalMonitorResidentBarStats(),
  storedBarsCache: getSignalMonitorLocalBarCacheDiagnostics().storedBarsCache,
  optionExpirations: getOptionExpirationCacheDiagnostics(),
}));

async function collectDiagnosticsInput() {
  const runtime = await getRuntimeDiagnostics();

  return {
    runtime,
    probes: {
      ...diagnosticsUserScopedBrokerProbes(),
      pythonCompute: getPythonComputeDiagnostics(),
    },
  };
}

server.once("error", (err) => {
  appendRuntimeFlightRecorderEvent("api-server-error", {
    message: err instanceof Error ? err.message : String(err),
  });
  logger.error({ err }, "Error listening on port");
  process.exit(1);
});

let shuttingDown = false;

async function shutdownApi(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  appendRuntimeFlightRecorderEvent("api-shutdown-start", { signal });
  setTimeout(() => {
    appendRuntimeFlightRecorderEvent("api-shutdown-forced", { signal });
    process.exit(signal === "SIGINT" ? 130 : 143);
  }, 5_000).unref();

  const serverClosed = new Promise<void>((resolveClose) => {
    server.close((error) => {
      if (error) {
        logger.warn({ err: error }, "API server shutdown close failed");
      }
      resolveClose();
    });
  });

  await Promise.all([
    serverClosed,
    stopPythonComputeRuntime().catch((pythonError) => {
      logger.warn({ err: pythonError }, "Python compute shutdown failed");
    }),
  ]);
  await closeDatabaseConnections().catch((databaseError) => {
    logger.warn({ err: databaseError }, "Database connection shutdown failed");
  });
  appendRuntimeFlightRecorderEvent("api-shutdown-complete", { signal });
  process.exit(signal === "SIGINT" ? 130 : 143);
}

process.once("SIGINT", () => void shutdownApi("SIGINT"));
process.once("SIGTERM", () => void shutdownApi("SIGTERM"));

const DEFAULT_SIGNAL_OPTIONS_SEED_RETRY_MS = 15_000;
const DEFAULT_SIGNAL_OPTIONS_SEED_MAX_RETRY_MS = 120_000;

function ensureDefaultSignalOptionsPaperDeploymentWithRetry(attempt = 1): void {
  void runInDbLane("background", () =>
    ensureDefaultSignalOptionsPaperDeployment({
      enabled: true,
      preserveExistingPaused: true,
    }),
  ).catch((err) => {
    logger.warn(
      { err, attempt },
      "Failed to ensure default signal-options shadow deployment",
    );
    if (!isTransientPostgresError(err)) {
      return;
    }
    const retryAfterMs = Math.min(
      DEFAULT_SIGNAL_OPTIONS_SEED_RETRY_MS * attempt,
      DEFAULT_SIGNAL_OPTIONS_SEED_MAX_RETRY_MS,
    );
    logger.warn(
      { attempt, retryAfterMs },
      "Retrying default signal-options shadow deployment seed after transient database failure",
    );
    setTimeout(
      () => ensureDefaultSignalOptionsPaperDeploymentWithRetry(attempt + 1),
      retryAfterMs,
    ).unref();
  });
}

server.listen(port, () => {
  logger.info({ port }, "Server listening");
  // Stagger the DB-touching background workers instead of starting them all in
  // the same tick. Starting ~19 workers synchronously had every one call
  // pool.connect() at once on boot; against the bounded pool (and a
  // connection-limited dev database shared with the market-data worker) that
  // herd exhausts connection slots, so acquires wait the full 30s
  // connectionTimeoutMillis and surface as "pool timed out" / "connection
  // terminated" across the app, the market-data worker, and the Replit DB pane.
  // HTTP is already serving here; these are background workers, so spreading
  // their first connect over a few seconds is harmless and keeps the boot from
  // stampeding Postgres.
  const backgroundWorkers: Array<() => void> = [
    startAccountFlexRefreshScheduler,
    startOptionsFlowScanner,
    startFlowUniverseOptionabilityVerifier,
    // Signal-monitor bar-evaluation scan + local-bar-cache warmup workers were
    // removed: the matrix is now fed by the live ticker SSE producer
    // (startSignalMonitorServerOwnedProducer below). Do not re-add a scanning
    // or warmup worker here.
    startSignalMonitorServerOwnedProducer,
    startSignalMonitorStateReconciliation,
    startSignalMonitorBreadthSnapshotWorker,
    () => {
      void startPythonComputeRuntime().catch((err) => {
        logger.warn({ err }, "Failed to start Python compute runtime");
      });
    },
    ensureDefaultSignalOptionsPaperDeploymentWithRetry,
    startSignalOptionsWorker,
    startSignalOptionsPositionTickManager,
    startAlgoOptionTargetReconciliationWorker,
    startSignalOptionsLiveTargetPositionWorker,
    startOvernightSpotWorker,
    () => startDiagnosticsCollector(collectDiagnosticsInput),
    startSnapshotRetentionScheduler,
    startDbDiskUsageGuard,
    startSignalUniverseRankingScheduler,
    startSnapTradeHistoryRefreshScheduler,
    startRobinhoodHistoryRefreshScheduler,
    startRuntimeFlightRecorder,
    () => {
      void runInDbLane("background", () =>
        importRuntimeFlightRecorderIncidents(recordServerDiagnosticEvent),
      ).catch((err) => {
        logger.warn(
          { err },
          "Failed to import runtime flight recorder incidents",
        );
      });
    },
  ];
  const BACKGROUND_WORKER_STAGGER_MS = 350;
  backgroundWorkers.forEach((startWorker, index) => {
    setTimeout(() => {
      try {
        startWorker();
      } catch (err) {
        logger.warn({ err }, "Background worker failed to start");
      }
    }, index * BACKGROUND_WORKER_STAGGER_MS).unref();
  });
});
