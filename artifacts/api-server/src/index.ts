// MUST stay the first import: applies .pyrus-runtime/dev-env.local overrides
// before any module reads process.env.
import "./dev-env-local";
import { createServer } from "node:http";
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
  startRuntimeFlightRecorder,
} from "./services/runtime-flight-recorder";
import {
  getAccountPositionVisibilityProbe,
  listAccounts,
  startAccountFlexRefreshScheduler,
} from "./services/account";
import { isIbkrClientPortalConfigured } from "./services/ibkr-client-runtime";
import {
  getRuntimeDiagnostics,
  getOrderVisibilityProbe,
  startFlowUniverseOptionabilityVerifier,
  startIbkrWatchlistPrewarmRuntime,
  startOptionsFlowScanner,
} from "./services/platform";
import { startSignalOptionsWorker } from "./services/signal-options-worker";
import { startSignalOptionsPositionTickManager } from "./services/signal-options-position-tick-manager";
import {
  startSignalMonitorBreadthSnapshotWorker,
  startSignalMonitorServerOwnedProducer,
  startSignalMonitorStateReconciliation,
} from "./services/signal-monitor";
import { startOvernightSpotWorker } from "./services/overnight-spot-worker";
import { startSignalMonitorEvaluationWorker } from "./services/signal-monitor-evaluation-worker";
import { startSignalUniverseRankingScheduler } from "./services/signal-universe-ranking";
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
  diagnosticsPositionProbeForTarget,
  selectDiagnosticsAccountProbeTarget,
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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function diagnosticsProbeTimeoutMs(): number {
  const configured = Number.parseInt(
    process.env["DIAGNOSTICS_READ_PROBE_TIMEOUT_MS"] ?? "10000",
    10,
  );
  return Number.isFinite(configured) && configured > 0 ? configured : 10_000;
}

function runtimeModeFromDiagnostics(value: unknown): "shadow" | "live" {
  const runtime = asRecord(value);
  const ibkr = asRecord(runtime.ibkr);
  return ibkr.sessionMode === "shadow" ? "shadow" : "live";
}

async function readOnlyProbe<T>(
  label: string,
  probe: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try {
    const timeoutMs = diagnosticsProbeTimeoutMs();
    const value = await new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`${label} timed out after ${timeoutMs}ms.`));
      }, timeoutMs);
      timeout.unref?.();
      probe().then(
        (result) => {
          clearTimeout(timeout);
          resolve(result);
        },
        (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      );
    });
    return { ok: true, value };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function collectDiagnosticsInput() {
  const runtime = await getRuntimeDiagnostics();
  const mode = runtimeModeFromDiagnostics(runtime);
  const accountsProbe = await readOnlyProbe("accounts probe", () =>
    listAccounts({ mode }),
  );
  const accounts = accountsProbe.ok
    ? asArray(asRecord(accountsProbe.value).accounts)
    : [];
  const accountTarget = selectDiagnosticsAccountProbeTarget(accounts);
  const accountId = accountTarget.accountId ?? undefined;
  const readPositionProbe = (): Promise<unknown> => {
    if (
      accountTarget.positionProbeProvider === "snaptrade" ||
      accountTarget.positionProbeProvider === "none" ||
      !accountId ||
      // Legacy (IBKR) accounts route the position probe through the IBKR Client
      // Portal transport. When that transport is unconfigured/retired the probe
      // throws "IBKR Client Portal is not configured." and lands read_probe_failed
      // in readiness degradedReasons — a false alarm. Skip it as not-applicable;
      // keep probing when IBKR IS configured (real failures still surface).
      !isIbkrClientPortalConfigured()
    ) {
      return Promise.resolve(diagnosticsPositionProbeForTarget(accountTarget));
    }
    return getAccountPositionVisibilityProbe({
      accountId,
      mode,
      source: "diagnostics-collector",
    });
  };
  const positionsProbe = await readOnlyProbe<unknown>(
    "positions probe",
    readPositionProbe,
  );
  const ordersProbe = await readOnlyProbe("orders probe", () =>
    Promise.resolve(getOrderVisibilityProbe({ accountId, mode })),
  );
  const positionProbeValue = positionsProbe.ok ? asRecord(positionsProbe.value) : {};
  const ordersProbeValue = ordersProbe.ok ? asRecord(ordersProbe.value) : {};

  return {
    runtime,
    probes: {
      accounts: accountsProbe.ok
        ? {
            ok: true,
            count: accounts.length,
            probeAccountId: accountId ?? null,
            probeAccountProvider: accountTarget.provider,
            snapTradeAccountCount: accountTarget.snapTradeAccountCount,
          }
        : { ok: false, error: accountsProbe.error },
      positions: positionsProbe.ok
        ? {
            ok: true,
            count:
              typeof positionProbeValue.count === "number"
                ? positionProbeValue.count
                : 0,
            provider:
              typeof positionProbeValue.provider === "string"
                ? positionProbeValue.provider
                : null,
            reason:
              typeof positionProbeValue.reason === "string"
                ? positionProbeValue.reason
                : null,
            skippedLegacyBridgeProbe:
              positionProbeValue.skippedLegacyBridgeProbe === true,
          }
        : { ok: false, error: positionsProbe.error },
      orders: ordersProbe.ok
        ? {
            ok: true,
            count: asArray(ordersProbeValue.orders).length,
            degraded: ordersProbeValue.degraded === true,
            reason:
              typeof ordersProbeValue.reason === "string"
                ? ordersProbeValue.reason
                : null,
            stale: ordersProbeValue.stale === true,
          }
        : { ok: false, error: ordersProbe.error },
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

function shutdownApi(signal: NodeJS.Signals): void {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  appendRuntimeFlightRecorderEvent("api-shutdown-start", { signal });
  stopPythonComputeRuntime();
  server.close((error) => {
    if (error) {
      logger.warn({ err: error }, "API server shutdown close failed");
    }
    appendRuntimeFlightRecorderEvent("api-shutdown-complete", { signal });
    process.exit(signal === "SIGINT" ? 130 : 143);
  });
  setTimeout(() => {
    appendRuntimeFlightRecorderEvent("api-shutdown-forced", { signal });
    process.exit(signal === "SIGINT" ? 130 : 143);
  }, 5_000).unref();
}

process.once("SIGINT", () => shutdownApi("SIGINT"));
process.once("SIGTERM", () => shutdownApi("SIGTERM"));

const DEFAULT_SIGNAL_OPTIONS_SEED_RETRY_MS = 15_000;
const DEFAULT_SIGNAL_OPTIONS_SEED_MAX_RETRY_MS = 120_000;

function ensureDefaultSignalOptionsPaperDeploymentWithRetry(attempt = 1): void {
  void ensureDefaultSignalOptionsPaperDeployment({
    enabled: true,
    preserveExistingPaused: true,
  }).catch((err) => {
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
    startIbkrWatchlistPrewarmRuntime,
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
    startOvernightSpotWorker,
    startSignalMonitorEvaluationWorker,
    () => startDiagnosticsCollector(collectDiagnosticsInput),
    startSnapshotRetentionScheduler,
    startSignalUniverseRankingScheduler,
    startSnapTradeHistoryRefreshScheduler,
    startRobinhoodHistoryRefreshScheduler,
    startRuntimeFlightRecorder,
    () => {
      void importRuntimeFlightRecorderIncidents(
        recordServerDiagnosticEvent,
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
