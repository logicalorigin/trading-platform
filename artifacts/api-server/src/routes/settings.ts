import { Router, type IRouter } from "express";
import {
  applyBackendSettings,
  getBackendSettingsSnapshot,
  runBackendSettingsAction,
} from "../services/backend-settings";
import {
  getUserPreferencesSnapshot,
  updateUserPreferencesSnapshot,
} from "../services/user-preferences";

const router: IRouter = Router();
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

export default router;
