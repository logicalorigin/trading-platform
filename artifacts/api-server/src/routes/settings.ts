import { once } from "node:events";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  applyBackendSettings,
  getBackendSettingsSnapshot,
  runBackendSettingsAction,
} from "../services/backend-settings";
import {
  getIbkrLaneArchitecture,
  updateIbkrLaneArchitecture,
} from "../services/ibkr-lanes";
import { getIbkrLineUsageSnapshot } from "../services/ibkr-line-usage";
import {
  getUserPreferencesSnapshot,
  updateUserPreferencesSnapshot,
} from "../services/user-preferences";

const router: IRouter = Router();
const IBKR_LINE_USAGE_ROUTE_CACHE_TTL_MS = 2_000;
const IBKR_LINE_USAGE_ROUTE_STALE_TTL_MS = 30_000;
const IBKR_LINE_USAGE_COMPACT_DETAIL = "compact";
const IBKR_LINE_USAGE_FULL_DETAIL = "full";

type IbkrLineUsageRouteSnapshot = Awaited<
  ReturnType<typeof getIbkrLineUsageSnapshot>
>;

let ibkrLineUsageRouteCache: {
  snapshot: IbkrLineUsageRouteSnapshot;
  expiresAt: number;
  staleUntil: number;
} | null = null;
let ibkrLineUsageRouteInFlight: Promise<IbkrLineUsageRouteSnapshot> | null = null;

type JsonRecord = Record<string, unknown>;

function asJsonRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function pickJsonRecord(
  value: unknown,
  keys: readonly string[],
): JsonRecord {
  const record = asJsonRecord(value);
  return Object.fromEntries(
    keys
      .filter((key) => Object.prototype.hasOwnProperty.call(record, key))
      .map((key) => [key, record[key]]),
  );
}

function compactOptionsFlowScanner(value: unknown): JsonRecord {
  const scanner = asJsonRecord(value);
  return {
    ...pickJsonRecord(scanner, [
      "enabled",
      "started",
      "scannerMode",
      "scannerFillMode",
      "limitingReason",
      "activeScanPhase",
      "marketDataMode",
      "delayedMarketData",
      "marketDataModeDegraded",
      "scannerAlwaysOn",
      "sessionBlockReason",
      "backgroundBlockedReason",
      "lineBudget",
      "seedLineBudget",
      "expandedLineBudget",
      "lastSkippedReason",
      "lastBatch",
      "lineUtilization",
      "deepScanner",
    ]),
    coverage: pickJsonRecord(scanner["coverage"], [
      "mode",
      "targetSize",
      "activeTargetSize",
      "selectedSymbols",
      "selectedShortfall",
      "stale",
      "fallbackUsed",
      "cooldownCount",
      "verifiedSymbols",
      "needsVerificationSymbols",
      "rejectedSymbols",
      "verificationBacklogSymbols",
      "scannedSymbols",
      "cycleScannedSymbols",
      "lastScannedAt",
      "oldestScanAt",
      "newestScanAt",
      "currentBatch",
      "lastScanAt",
      "degradedReason",
      "batchSize",
      "intervalMs",
      "lineBudget",
      "concurrency",
      "estimatedCycleMs",
      "deepActiveSymbols",
      "deepLastBatch",
      "scannerPhase",
      "lastScanAgeMs",
      "coverageHealth",
      "marketSessionQuiet",
      "coverageTargetMs",
    ]),
  };
}

function compactStreamDiagnostics(value: unknown): JsonRecord {
  return pickJsonRecord(value, [
    "provider",
    "activeProvider",
    "activeConsumerCount",
    "unionSymbolCount",
    "requestedSymbolCount",
    "unionProviderContractIdCount",
    "requestedProviderContractIdCount",
    "nonLiveSymbolCount",
    "nonLiveProviderContractIdCount",
    "cachedQuoteCount",
    "eventCount",
    "reconnectCount",
    "streamGapCount",
    "dataGapCount",
    "recentGapCount",
    "recentDataGapCount",
    "lastEventAt",
    "lastEventAgeMs",
    "lastSignalAt",
    "lastSignalAgeMs",
    "freshnessAgeMs",
    "dataFreshnessAgeMs",
    "transportFreshnessAgeMs",
    "streamActive",
    "reconnectScheduled",
    "lastError",
    "lastErrorAt",
    "lastStreamStatus",
    "pressure",
    "massiveDelayedWebSocket",
    "subscribedSymbolCount",
    "lastMessageAt",
    "lastMessageAgeMs",
    "configured",
    "connected",
    "state",
  ]);
}

function compactLineUsageSnapshot(
  snapshot: IbkrLineUsageRouteSnapshot,
): JsonRecord {
  const root = asJsonRecord(snapshot);
  const admission = asJsonRecord(root["admission"]);
  const historicalWork = asJsonRecord(root["historicalWork"]);
  const bridge = asJsonRecord(root["bridge"]);
  const bridgeDiagnostics = asJsonRecord(bridge["diagnostics"]);
  const streams = asJsonRecord(root["streams"]);
  const providers = asJsonRecord(root["providers"]);
  const massiveProvider = asJsonRecord(providers["massive"]);
  const massiveProviderRest = asJsonRecord(massiveProvider["rest"]);
  const massiveProviderWebSocket = asJsonRecord(massiveProvider["websocket"]);
  const drift = asJsonRecord(root["drift"]);
  const driftReconciliation = asJsonRecord(drift["reconciliation"]);
  const marketDataWorkPlan = asJsonRecord(root["marketDataWorkPlan"]);

  return {
    updatedAt: root["updatedAt"],
    detail: IBKR_LINE_USAGE_COMPACT_DETAIL,
    admission: {
      ...pickJsonRecord(admission, [
        "schemaVersion",
        "generatedAt",
        "budget",
        "pressure",
        "activeLineCount",
        "grossActiveLineCount",
        "reserveLineCount",
        "usableRemainingLineCount",
        "activeEquityLineCount",
        "routineEquityLineCount",
        "optionSupportEquityLineCount",
        "manualDepthEquityLineCount",
        "activeOptionLineCount",
        "automationExecutionLineCount",
        "automationExecutionRemainingLineCount",
        "executionLineCount",
        "automationLineCount",
        "automationRemainingLineCount",
        "accountMonitorLineCount",
        "accountMonitorRemainingLineCount",
        "accountMonitor",
        "visibleLineCount",
        "visibleRemainingLineCount",
        "flowScannerLineCount",
        "flowScannerChargedLineCount",
        "flowScannerSharedLineCount",
        "flowScannerActivity",
        "flowScannerRemainingLineCount",
        "poolUsage",
        "leaseCount",
        "intentUsage",
        "counters",
        "signalOptions",
        "shadowAccount",
      ]),
      optionsFlowScanner: compactOptionsFlowScanner(
        admission["optionsFlowScanner"],
      ),
    },
    historicalWork: {
      admission: historicalWork["admission"] ?? null,
      bridge: historicalWork["bridge"] ?? null,
    },
    policy: root["policy"],
    allocation: root["allocation"],
    lineUtilizationAudit: pickJsonRecord(root["lineUtilizationAudit"], [
      "status",
      "warnings",
      "bridgeActiveLineCount",
      "bridgeLineBudget",
      "apiActiveLineCount",
      "usableLineCount",
      "usableRemainingLineCount",
    ]),
    bridge: {
      activeLineCount: bridge["activeLineCount"],
      lineBudget: bridge["lineBudget"],
      remainingLineCount: bridge["remainingLineCount"],
      error: bridge["error"],
      diagnostics: {
        connected: bridgeDiagnostics["connected"],
        pressure: bridgeDiagnostics["pressure"],
        subscriptions: pickJsonRecord(bridgeDiagnostics["subscriptions"], [
          "activeQuoteSubscriptions",
          "marketDataLineBudget",
          "marketDataLineBudgetRemaining",
          "activeEquitySubscriptions",
          "activeOptionSubscriptions",
          "prewarmSymbolCount",
        ]),
      },
    },
    streams: {
      optionQuoteStreams: compactStreamDiagnostics(streams["optionQuoteStreams"]),
      massiveStockQuotes: compactStreamDiagnostics(streams["massiveStockQuotes"]),
      stockAggregates: compactStreamDiagnostics(streams["stockAggregates"]),
    },
    providers: {
      massive: {
        ...pickJsonRecord(massiveProvider, [
          "configured",
          "providerIdentity",
          "baseUrlHost",
          "stocksRealtimeConfigured",
          "status",
          "lastSuccessAt",
          "lastFailureAt",
          "lastError",
        ]),
        rest: pickJsonRecord(massiveProviderRest, [
          "status",
          "lastRequest",
          "recentRequests",
          "lastSuccessAt",
          "lastFailureAt",
          "lastError",
        ]),
        websocket: {
          ...pickJsonRecord(massiveProviderWebSocket, [
            "status",
            "configured",
            "providerIdentity",
            "mode",
            "activeChannels",
            "availableChannels",
            "subscribedSymbolCount",
            "activeConsumerCount",
            "eventCount",
            "lastMessageAt",
            "lastMessageAgeMs",
            "reconnectCount",
            "lastError",
            "lastErrorAt",
          ]),
          feeds: Array.isArray(massiveProviderWebSocket["feeds"])
            ? massiveProviderWebSocket["feeds"]
            : [],
        },
      },
    },
    warmup: root["warmup"],
    accountMonitor: root["accountMonitor"],
    signalOptions: root["signalOptions"],
    shadowAccount: root["shadowAccount"],
    drift: {
      admissionVsBridgeLineDelta: drift["admissionVsBridgeLineDelta"],
      reconciliation: {
        ...pickJsonRecord(driftReconciliation, [
          "status",
          "apiLineCount",
          "totalApiLineCount",
          "snapshotOnlyApiLineCount",
          "bridgeLineCount",
          "matchedLineCount",
          "apiOnlyLineCount",
          "bridgeOnlyLineCount",
          "snapshotOnlyApiLineSample",
          "apiOnlyLineSample",
          "bridgeOnlyLineSample",
          "snapshotOnlyApiGroups",
          "apiOnlyGroups",
          "bridgeOnlyGroups",
          "persistentBridgeOnlyGraceMs",
          "persistentBridgeOnlyLineCount",
          "persistentBridgeOnlyLineSample",
          "persistentApiOnlyGraceMs",
          "persistentApiOnlyLineCount",
          "persistentApiOnlyLineSample",
        ]),
      },
    },
    marketDataWorkPlan: {
      summary: marketDataWorkPlan["summary"],
      bridge: marketDataWorkPlan["bridge"],
      scanner: marketDataWorkPlan["scanner"],
      totals: marketDataWorkPlan["totals"],
    },
  };
}

function readIbkrLineUsageDetail(req: Request): "compact" | "full" {
  const value = String(
    req.query["detail"] ?? req.query["view"] ?? req.query["mode"] ?? "",
  )
    .trim()
    .toLowerCase();
  return value === IBKR_LINE_USAGE_FULL_DETAIL ||
    req.query["full"] === "true"
    ? IBKR_LINE_USAGE_FULL_DETAIL
    : IBKR_LINE_USAGE_COMPACT_DETAIL;
}

function formatIbkrLineUsageRouteSnapshot(
  snapshot: IbkrLineUsageRouteSnapshot,
  detail: "compact" | "full",
): IbkrLineUsageRouteSnapshot | JsonRecord {
  return detail === IBKR_LINE_USAGE_FULL_DETAIL
    ? snapshot
    : compactLineUsageSnapshot(snapshot);
}

function refreshIbkrLineUsageRouteCache(): Promise<IbkrLineUsageRouteSnapshot> {
  const request = getIbkrLineUsageSnapshot()
    .then((snapshot) => {
      const refreshedAt = Date.now();
      ibkrLineUsageRouteCache = {
        snapshot,
        expiresAt: refreshedAt + IBKR_LINE_USAGE_ROUTE_CACHE_TTL_MS,
        staleUntil: refreshedAt + IBKR_LINE_USAGE_ROUTE_STALE_TTL_MS,
      };
      return snapshot;
    })
    .finally(() => {
      if (ibkrLineUsageRouteInFlight === request) {
        ibkrLineUsageRouteInFlight = null;
      }
    });
  ibkrLineUsageRouteInFlight = request;
  return request;
}

async function getCachedIbkrLineUsageSnapshot(): Promise<IbkrLineUsageRouteSnapshot> {
  const now = Date.now();
  if (ibkrLineUsageRouteCache && ibkrLineUsageRouteCache.expiresAt > now) {
    return ibkrLineUsageRouteCache.snapshot;
  }
  if (
    ibkrLineUsageRouteCache &&
    ibkrLineUsageRouteCache.staleUntil > now
  ) {
    if (!ibkrLineUsageRouteInFlight) {
      void refreshIbkrLineUsageRouteCache().catch(() => {});
    }
    return ibkrLineUsageRouteCache.snapshot;
  }
  if (ibkrLineUsageRouteInFlight) {
    return ibkrLineUsageRouteInFlight;
  }
  return refreshIbkrLineUsageRouteCache();
}

router.get("/settings/backend", async (_req, res) => {
  res.json(await getBackendSettingsSnapshot());
});

router.post("/settings/backend/apply", async (req, res) => {
  res.json(await applyBackendSettings(req.body ?? {}));
});

router.post("/settings/backend/actions/:actionId", async (req, res) => {
  res.json(await runBackendSettingsAction(req.params.actionId, req.body ?? {}));
});

router.get("/settings/preferences", async (_req, res) => {
  res.json(await getUserPreferencesSnapshot());
});

router.patch("/settings/preferences", async (req, res) => {
  const body =
    req.body && typeof req.body === "object" && "preferences" in req.body
      ? req.body.preferences
      : req.body;
  res.json(await updateUserPreferencesSnapshot(body ?? {}));
});

router.get("/settings/ibkr-lanes", async (_req, res) => {
  res.json(await getIbkrLaneArchitecture());
});

router.put("/settings/ibkr-lanes", async (req, res) => {
  res.json(await updateIbkrLaneArchitecture(req.body ?? {}));
});

router.get("/settings/ibkr-line-usage", async (req, res) => {
  res.json(
    formatIbkrLineUsageRouteSnapshot(
      await getCachedIbkrLineUsageSnapshot(),
      readIbkrLineUsageDetail(req),
    ),
  );
});

function writeSseEvent(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

async function startIbkrLineUsageSse(req: Request, res: Response): Promise<void> {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  let closed = false;
  let writeInFlight = false;
  const detail = readIbkrLineUsageDetail(req);
  const writeSnapshot = async () => {
    if (closed || writeInFlight) {
      return;
    }
    writeInFlight = true;
    try {
      writeSseEvent(
        res,
        "ibkr-line-usage",
        formatIbkrLineUsageRouteSnapshot(
          await getCachedIbkrLineUsageSnapshot(),
          detail,
        ),
      );
    } catch (error) {
      writeSseEvent(res, "error", {
        message:
          error instanceof Error && error.message
            ? error.message
            : "IBKR line usage stream failed.",
      });
    } finally {
      writeInFlight = false;
    }
  };

  await writeSnapshot();
  const interval = setInterval(writeSnapshot, 2_000);
  req.on("close", () => {
    closed = true;
    clearInterval(interval);
  });
  await once(req, "close");
}

router.get("/settings/ibkr-line-usage/stream", async (req, res) => {
  await startIbkrLineUsageSse(req, res);
});

export default router;
