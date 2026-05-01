import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  clearIbkrBridgeRuntimeOverride,
  getIbkrBridgeRuntimeOverride,
  getProviderConfiguration,
  getRuntimeMode,
} from "../lib/runtime";
import { HttpError } from "../lib/errors";
import {
  getDiagnosticThresholds,
  getLatestDiagnostics,
  pruneDiagnosticStorage,
} from "./diagnostics";
import { getIbkrLaneArchitecture } from "./ibkr-lanes";
import { listAlgoDeployments } from "./automation";
import { listPineScripts } from "./pine-scripts";
import { listWatchlists } from "./platform";
import { getResearchStatus } from "./research";
import { getSignalMonitorProfile } from "./signal-monitor";

type SettingRisk = "safe" | "operational" | "risky";
type SettingSource = "default" | "env" | "override" | "pending_restart";

type IsolationSettings = {
  mode: string;
  coop: string;
  coep: string;
  updatedAt: string;
};

type BackendSetting = {
  key: string;
  group: string;
  label: string;
  description: string;
  type: "string" | "boolean" | "number" | "enum" | "status";
  value: unknown;
  defaultValue: unknown;
  source: SettingSource;
  editable: boolean;
  requiresRestart: boolean;
  risk: SettingRisk;
  options?: Array<{ value: string; label: string }>;
  pendingValue?: unknown;
};

const DEFAULT_ISOLATION: IsolationSettings = {
  mode: "report-only",
  coop: "same-origin",
  coep: "require-corp",
  updatedAt: new Date(0).toISOString(),
};

const ISOLATION_MODE_OPTIONS = new Set([
  "off",
  "report-only",
  "enforce",
  "enforce-credentialless",
]);
const COOP_OPTIONS = new Set([
  "same-origin",
  "same-origin-allow-popups",
  "unsafe-none",
]);
const COEP_OPTIONS = new Set(["require-corp", "credentialless", "unsafe-none"]);

function getBackendSettingsFile(): string {
  return (
    process.env["RAYALGO_BACKEND_SETTINGS_FILE"] ||
    join(tmpdir(), "rayalgo", "backend-settings.json")
  );
}

function readIsolationSettings(): IsolationSettings | null {
  try {
    const parsed = JSON.parse(readFileSync(getBackendSettingsFile(), "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    const record = parsed as Record<string, unknown>;
    const isolation =
      record.isolation && typeof record.isolation === "object"
        ? (record.isolation as Record<string, unknown>)
        : {};
    return {
      mode:
        typeof isolation.mode === "string" && ISOLATION_MODE_OPTIONS.has(isolation.mode)
          ? isolation.mode
          : DEFAULT_ISOLATION.mode,
      coop:
        typeof isolation.coop === "string" && COOP_OPTIONS.has(isolation.coop)
          ? isolation.coop
          : DEFAULT_ISOLATION.coop,
      coep:
        typeof isolation.coep === "string" && COEP_OPTIONS.has(isolation.coep)
          ? isolation.coep
          : DEFAULT_ISOLATION.coep,
      updatedAt:
        typeof isolation.updatedAt === "string" && isolation.updatedAt
          ? isolation.updatedAt
          : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

function writeIsolationSettings(settings: IsolationSettings): void {
  const file = getBackendSettingsFile();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(
    file,
    JSON.stringify({ version: 1, isolation: settings }, null, 2),
    { mode: 0o600 },
  );
}

function envIsolationSettings(): IsolationSettings {
  const mode = process.env["RAYALGO_CROSS_ORIGIN_ISOLATION"];
  const coop = process.env["RAYALGO_COOP_POLICY"];
  const coep = process.env["RAYALGO_COEP_POLICY"];
  return {
    mode: mode && ISOLATION_MODE_OPTIONS.has(mode) ? mode : DEFAULT_ISOLATION.mode,
    coop: coop && COOP_OPTIONS.has(coop) ? coop : DEFAULT_ISOLATION.coop,
    coep: coep && COEP_OPTIONS.has(coep) ? coep : DEFAULT_ISOLATION.coep,
    updatedAt: new Date().toISOString(),
  };
}

function setting(
  input: Omit<BackendSetting, "source"> & { source?: SettingSource },
): BackendSetting {
  return {
    source: "default",
    ...input,
  };
}

function isolationSetting(
  key: "mode" | "coop" | "coep",
  label: string,
  description: string,
  effective: IsolationSettings,
  desired: IsolationSettings | null,
  options: Set<string>,
): BackendSetting {
  const defaultValue = DEFAULT_ISOLATION[key];
  const pendingValue = desired?.[key];
  const hasPending = Boolean(desired && pendingValue !== effective[key]);
  const envName =
    key === "mode"
      ? "RAYALGO_CROSS_ORIGIN_ISOLATION"
      : key === "coop"
        ? "RAYALGO_COOP_POLICY"
        : "RAYALGO_COEP_POLICY";
  return setting({
    key: `isolation.${key}`,
    group: "isolation",
    label,
    description,
    type: "enum",
    value: effective[key],
    defaultValue,
    pendingValue: hasPending ? pendingValue : undefined,
    source: hasPending ? "pending_restart" : process.env[envName] ? "env" : "default",
    editable: true,
    requiresRestart: true,
    risk: key === "mode" ? "risky" : "operational",
    options: Array.from(options).map((value) => ({
      value,
      label: value,
    })),
  });
}

export async function getBackendSettingsSnapshot() {
  const providers = getProviderConfiguration();
  const bridgeOverride = getIbkrBridgeRuntimeOverride();
  const diagnostics = getLatestDiagnostics();
  const [
    thresholdsResult,
    lanesResult,
    watchlistsResult,
    signalMonitorResult,
    researchResult,
    pineScriptsResult,
    algoDeploymentsResult,
  ] = await Promise.allSettled([
    getDiagnosticThresholds(),
    getIbkrLaneArchitecture(),
    listWatchlists(),
    getSignalMonitorProfile({ environment: getRuntimeMode() }),
    getResearchStatus(),
    listPineScripts(),
    listAlgoDeployments({}),
  ]);
  const thresholds =
    thresholdsResult.status === "fulfilled" ? thresholdsResult.value : [];
  const lanes = lanesResult.status === "fulfilled" ? lanesResult.value : null;
  const watchlists =
    watchlistsResult.status === "fulfilled" ? watchlistsResult.value.watchlists : [];
  const signalMonitor =
    signalMonitorResult.status === "fulfilled" ? signalMonitorResult.value : null;
  const research =
    researchResult.status === "fulfilled" ? researchResult.value : null;
  const pineScripts =
    pineScriptsResult.status === "fulfilled" ? pineScriptsResult.value.scripts : [];
  const algoDeployments =
    algoDeploymentsResult.status === "fulfilled"
      ? algoDeploymentsResult.value.deployments
      : [];
  const effectiveIsolation = envIsolationSettings();
  const desiredIsolation = readIsolationSettings();
  const pendingRestartCount = ["mode", "coop", "coep"].filter(
    (key) =>
      desiredIsolation?.[key as keyof IsolationSettings] !== undefined &&
      desiredIsolation?.[key as keyof IsolationSettings] !==
        effectiveIsolation[key as keyof IsolationSettings],
  ).length;

  return {
    updatedAt: new Date().toISOString(),
    groups: [
      { id: "runtime", label: "Runtime" },
      { id: "diagnostics", label: "Diagnostics" },
      { id: "ibkr", label: "IBKR / Market Data" },
      { id: "storage", label: "Storage" },
      { id: "isolation", label: "Isolation" },
    ],
    summary: {
      tradingMode: getRuntimeMode(),
      providers,
      diagnosticsStatus: diagnostics?.status ?? "unknown",
      diagnosticsSeverity: diagnostics?.severity ?? "info",
      pendingRestartCount,
      thresholdCount: thresholds.length,
      ibkrLaneCount: lanes?.memberships?.length ?? 0,
      bridgeOverrideActive: Boolean(bridgeOverride),
      watchlistCount: watchlists.length,
      watchlistSymbolCount: watchlists.reduce(
        (count, watchlist) => count + (watchlist.items?.length ?? 0),
        0,
      ),
      signalMonitor: signalMonitor
        ? {
            enabled: signalMonitor.enabled,
            timeframe: signalMonitor.timeframe,
            maxSymbols: signalMonitor.maxSymbols,
            pollIntervalSeconds: signalMonitor.pollIntervalSeconds,
          }
        : null,
      researchConfigured: Boolean(research?.configured),
      pineScriptCount: pineScripts.length,
      chartEnabledPineScriptCount: pineScripts.filter(
        (script) => script.chartAccessEnabled,
      ).length,
      algoDeploymentCount: algoDeployments.length,
      enabledAlgoDeploymentCount: algoDeployments.filter(
        (deployment) => deployment.enabled,
      ).length,
    },
    settings: [
      setting({
        key: "runtime.tradingMode",
        group: "runtime",
        label: "Trading Mode",
        description: "Effective backend trading environment.",
        type: "status",
        value: getRuntimeMode(),
        defaultValue: "paper",
        source: process.env["TRADING_MODE"] ? "env" : "default",
        editable: false,
        requiresRestart: true,
        risk: "risky",
      }),
      setting({
        key: "runtime.providers",
        group: "runtime",
        label: "Provider Configuration",
        description: "Masked provider readiness derived from backend runtime configuration.",
        type: "status",
        value: providers,
        defaultValue: { polygon: false, research: false, ibkr: false },
        source: "env",
        editable: false,
        requiresRestart: true,
        risk: "operational",
      }),
      setting({
        key: "runtime.ibkrBridgeOverride",
        group: "runtime",
        label: "IBKR Bridge Override",
        description: "Whether the current IBKR bridge endpoint is persisted from the local bridge attach flow.",
        type: "status",
        value: bridgeOverride
          ? {
              active: true,
              baseUrl: bridgeOverride.baseUrl,
              updatedAt: bridgeOverride.updatedAt.toISOString(),
            }
          : { active: false },
        defaultValue: { active: false },
        source: bridgeOverride ? "override" : "default",
        editable: false,
        requiresRestart: false,
        risk: "operational",
      }),
      isolationSetting(
        "mode",
        "Cross-Origin Isolation Mode",
        "Controls whether COOP/COEP headers are disabled, report-only, or enforced after restart.",
        effectiveIsolation,
        desiredIsolation,
        ISOLATION_MODE_OPTIONS,
      ),
      isolationSetting(
        "coop",
        "COOP Policy",
        "Cross-Origin-Opener-Policy target used by the API/frontend headers after restart.",
        effectiveIsolation,
        desiredIsolation,
        COOP_OPTIONS,
      ),
      isolationSetting(
        "coep",
        "COEP Policy",
        "Cross-Origin-Embedder-Policy target used by the API/frontend headers after restart.",
        effectiveIsolation,
        desiredIsolation,
        COEP_OPTIONS,
      ),
    ],
    actions: [
      {
        id: "ibkr.bridgeOverride.clear",
        group: "ibkr",
        label: "Clear IBKR Bridge Override",
        risk: "risky",
        dryRunDefault: false,
      },
      {
        id: "diagnostics.storage.prune",
        group: "storage",
        label: "Prune Diagnostic Storage",
        risk: "risky",
        dryRunDefault: true,
      },
    ],
  };
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function validateEnum(value: unknown, allowed: Set<string>, key: string): string {
  if (typeof value !== "string" || !allowed.has(value)) {
    throw new HttpError(400, "Invalid backend setting.", {
      code: "invalid_backend_setting",
      detail: `${key} is not a supported value.`,
    });
  }
  return value;
}

export async function applyBackendSettings(input: unknown) {
  const body = readRecord(input);
  const changes = Array.isArray(body.changes) ? body.changes : [];
  const current = readIsolationSettings() ?? envIsolationSettings();
  const next: IsolationSettings = { ...current, updatedAt: new Date().toISOString() };
  const applied: Array<{ key: string; status: string; requiresRestart: boolean }> = [];
  const rejected: Array<{ key: string; reason: string }> = [];

  for (const rawChange of changes) {
    const change = readRecord(rawChange);
    const key = String(change.key || "");
    try {
      if (key === "isolation.mode") {
        next.mode = validateEnum(change.value, ISOLATION_MODE_OPTIONS, key);
      } else if (key === "isolation.coop") {
        next.coop = validateEnum(change.value, COOP_OPTIONS, key);
      } else if (key === "isolation.coep") {
        next.coep = validateEnum(change.value, COEP_OPTIONS, key);
      } else {
        throw new HttpError(400, "Unsupported backend setting.", {
          code: "unsupported_backend_setting",
          detail: `${key} cannot be changed through this endpoint.`,
        });
      }
      applied.push({ key, status: "pending_restart", requiresRestart: true });
    } catch (error) {
      rejected.push({
        key,
        reason:
          error instanceof Error ? error.message : "Backend setting validation failed.",
      });
    }
  }

  if (applied.length > 0) {
    writeIsolationSettings(next);
  }

  return {
    applied,
    rejected,
    pendingRestart: applied.filter((item) => item.requiresRestart),
    snapshot: await getBackendSettingsSnapshot(),
  };
}

export async function runBackendSettingsAction(actionId: string, input: unknown) {
  const body = readRecord(input);
  if (actionId === "ibkr.bridgeOverride.clear") {
    const current = getIbkrBridgeRuntimeOverride();
    if (!current) {
      return {
        runtimeOverrideActive: false,
        cleared: false,
        reason: "no_override",
        snapshot: await getBackendSettingsSnapshot(),
      };
    }

    const force = body.force === true;
    const isManualOverride =
      current.bridgeId === null && current.managementTokenHash === null;
    if (!force && !isManualOverride) {
      throw new HttpError(409, "IBKR bridge override is managed by the active bridge launcher.", {
        code: "managed_ibkr_bridge_override",
        detail:
          "Use the IB Gateway deactivate control or pass force=true after confirming the active bridge launcher is dead.",
      });
    }

    clearIbkrBridgeRuntimeOverride();
    return {
      runtimeOverrideActive: false,
      cleared: true,
      previous: {
        baseUrl: current.baseUrl,
        updatedAt: current.updatedAt.toISOString(),
        tokenConfigured: Boolean(current.apiToken),
      },
      snapshot: await getBackendSettingsSnapshot(),
    };
  }

  if (actionId !== "diagnostics.storage.prune") {
    throw new HttpError(404, "Backend settings action not found.", {
      code: "backend_settings_action_not_found",
    });
  }
  const tables = Array.isArray(body.tables)
    ? body.tables.map((value) => String(value))
    : undefined;
  const olderThanDays =
    body.olderThanDays === undefined ? undefined : Number(body.olderThanDays);
  const dryRun = body.dryRun !== false;
  return pruneDiagnosticStorage({ tables, olderThanDays, dryRun });
}
