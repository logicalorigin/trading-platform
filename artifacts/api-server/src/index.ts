import { createServer } from "node:http";
import app from "./app";
import { logger } from "./lib/logger";
import { startDiagnosticsCollector } from "./services/diagnostics";
import { startAccountFlexRefreshScheduler } from "./services/account";
import {
  getRuntimeDiagnostics,
  listAccounts,
  listOrders,
  listPositions,
  startOptionsFlowScanner,
} from "./services/platform";
import { startTradeMonitorWorker } from "./services/trade-monitor-worker";
import { startSignalOptionsWorker } from "./services/signal-options-worker";
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
    listPositions({ accountId, mode }),
  );
  const ordersProbe = await readOnlyProbe("orders probe", () =>
    listOrders({ accountId, mode }),
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
            count: asArray(asRecord(positionsProbe.value).positions).length,
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
    },
  };
}

server.once("error", (err) => {
  logger.error({ err }, "Error listening on port");
  process.exit(1);
});

server.listen(port, () => {
  logger.info({ port }, "Server listening");
  ensureIbkrLaneRuntimeOverridesLoaded();
  startAccountFlexRefreshScheduler();
  startOptionsFlowScanner();
  startTradeMonitorWorker();
  startSignalOptionsWorker();
  startDiagnosticsCollector(collectDiagnosticsInput);
});
