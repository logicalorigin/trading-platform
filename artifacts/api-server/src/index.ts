import { createServer } from "node:http";
import app from "./app";
import { logger } from "./lib/logger";
import {
  recordServerDiagnosticEvent,
  startDiagnosticsCollector,
} from "./services/diagnostics";
import {
  appendRuntimeFlightRecorderEvent,
  importRuntimeFlightRecorderIncidents,
  installRuntimeFlightRecorderProcessHandlers,
  startRuntimeFlightRecorder,
} from "./services/runtime-flight-recorder";
import {
  getAccountPositionVisibilityProbe,
  listAccounts,
  startAccountFlexRefreshScheduler,
} from "./services/account";
import {
  getRuntimeDiagnostics,
  getOrderVisibilityProbe,
  startFlowUniverseOptionabilityVerifier,
  startIbkrWatchlistPrewarmRuntime,
  startOptionsFlowScanner,
} from "./services/platform";
import { startTradeMonitorWorker } from "./services/trade-monitor-worker";
import { startSignalOptionsWorker } from "./services/signal-options-worker";
import { startSignalOptionsPositionTickManager } from "./services/signal-options-position-tick-manager";
import { startSignalMonitorLocalBarCacheWarmup } from "./services/signal-monitor";
import { startOvernightSpotWorker } from "./services/overnight-spot-worker";
import { ensureDefaultSignalOptionsPaperDeployment } from "./services/signal-options-automation";
import { startIbkrLineUsageGenerationCoordinator } from "./services/ibkr-line-usage";
import {
  getPythonComputeDiagnostics,
  startPythonComputeRuntime,
} from "./services/python-compute";
import { attachOptionQuoteWebSocket } from "./ws/options-quotes";
import { getBridgeQuoteStreamDiagnostics } from "./services/bridge-quote-stream";
import { ensureIbkrLaneRuntimeOverridesLoaded } from "./services/ibkr-lanes";

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
installRuntimeFlightRecorderProcessHandlers();

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

function runtimeModeFromDiagnostics(value: unknown): "paper" | "live" {
  const runtime = asRecord(value);
  const ibkr = asRecord(runtime.ibkr);
  return ibkr.sessionMode === "paper" ? "paper" : "live";
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
  const firstAccount = asRecord(accounts[0]);
  const accountId =
    typeof firstAccount.providerAccountId === "string"
      ? firstAccount.providerAccountId
      : typeof firstAccount.id === "string"
        ? firstAccount.id
        : undefined;
  const positionsProbe = await readOnlyProbe("positions probe", () =>
    accountId
      ? getAccountPositionVisibilityProbe({
          accountId,
          mode,
          source: "diagnostics-collector",
        })
      : Promise.resolve({ count: 0 }),
  );
  const ordersProbe = await readOnlyProbe("orders probe", () =>
    Promise.resolve(getOrderVisibilityProbe({ accountId, mode })),
  );
  const ordersProbeValue = ordersProbe.ok ? asRecord(ordersProbe.value) : {};

  return {
    runtime,
    probes: {
      accounts: accountsProbe.ok
        ? { ok: true, count: accounts.length }
        : { ok: false, error: accountsProbe.error },
      positions: positionsProbe.ok
        ? {
            ok: true,
            count:
              typeof asRecord(positionsProbe.value).count === "number"
                ? asRecord(positionsProbe.value).count
                : 0,
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
      marketData: getBridgeQuoteStreamDiagnostics(),
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

server.listen(port, () => {
  logger.info({ port }, "Server listening");
  ensureIbkrLaneRuntimeOverridesLoaded();
  startAccountFlexRefreshScheduler();
  startIbkrWatchlistPrewarmRuntime();
  startOptionsFlowScanner();
  startFlowUniverseOptionabilityVerifier();
  startTradeMonitorWorker();
  startIbkrLineUsageGenerationCoordinator();
  startSignalMonitorLocalBarCacheWarmup();
  void startPythonComputeRuntime().catch((err) => {
    logger.warn({ err }, "Failed to start Python compute runtime");
  });
  void ensureDefaultSignalOptionsPaperDeployment({
    enabled: true,
    preserveExistingPaused: true,
  })
    .catch((err) => {
      logger.warn(
        { err },
        "Failed to ensure default signal-options shadow deployment",
      );
    })
    .finally(() => {
      startSignalOptionsWorker();
      startSignalOptionsPositionTickManager();
      startOvernightSpotWorker();
    });
  startDiagnosticsCollector(collectDiagnosticsInput);
  startRuntimeFlightRecorder();
  void importRuntimeFlightRecorderIncidents(recordServerDiagnosticEvent).catch(
    (err) => {
      logger.warn(
        { err },
        "Failed to import runtime flight recorder incidents",
      );
    },
  );
});
