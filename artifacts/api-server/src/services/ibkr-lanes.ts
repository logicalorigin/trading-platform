import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { HttpError } from "../lib/errors";
import { logger } from "../lib/logger";
import {
  IbkrBridgeClient,
  type BridgeLaneDiagnosticsSnapshot,
  type BridgeLaneSettingsRequest,
} from "../providers/ibkr/bridge-client";
import {
  getBridgeGovernorConfigSnapshot,
  resetBridgeGovernorOverrides,
  setBridgeGovernorOverrides,
  type BridgeGovernorConfig,
  type BridgeWorkCategory,
} from "./bridge-governor";
import { verifyIbkrBridgeManagementToken } from "./ibkr-bridge-runtime";
import {
  getOptionsFlowLaneSourceSymbols,
  getOptionsFlowRuntimeConfigSnapshot,
  getOptionsFlowUniverseCoverage,
  listWatchlistsForDiagnostics,
  resetOptionsFlowRuntimeOverrides,
  setOptionsFlowRuntimeOverrides,
  type OptionsFlowRuntimeConfig,
} from "./platform";
import {
  getIbkrLanePolicySnapshot,
  resolveIbkrLaneSymbols,
  updateIbkrLanePolicy,
  type IbkrDataLaneId,
  type IbkrLaneMembershipPolicy,
  type IbkrLaneSourceId,
  type IbkrLaneSymbolResolution,
} from "./ibkr-lane-policy";
import { getMarketDataAdmissionDiagnostics } from "./market-data-admission";

type ControlKind = "number" | "boolean" | "select" | "list";
type ControlSource = "default" | "env" | "override" | "unknown";

type LaneControl = {
  id: string;
  label: string;
  group: string;
  layer: "platform" | "bridge";
  kind: ControlKind;
  value: unknown;
  defaultValue?: unknown;
  source: ControlSource;
  overridden: boolean;
  description?: string;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: string[];
};

type LaneNode = {
  id: string;
  label: string;
  layer: "platform" | "bridge";
  status: "normal" | "degraded" | "backoff" | "stalled" | "unknown";
  summary: string;
};

type LaneEdge = {
  from: string;
  to: string;
  label: string;
};

type LaneMembership = IbkrLaneSymbolResolution & {
  label: string;
  availableSources: Partial<Record<IbkrLaneSourceId, string[]>>;
  activeCount: number | null;
  queuedCount: number | null;
  notes: string[];
};

export type IbkrLaneArchitectureSnapshot = {
  updatedAt: Date;
  persistence: {
    enabled: true;
    path: string;
  };
  layers: Array<{
    id: "platform" | "bridge";
    label: string;
    nodes: LaneNode[];
  }>;
  edges: LaneEdge[];
  controls: LaneControl[];
  policy: {
    lanes: Record<IbkrDataLaneId, IbkrLaneMembershipPolicy>;
    defaults: Record<IbkrDataLaneId, IbkrLaneMembershipPolicy>;
    updatedAt: string | null;
  };
  memberships: LaneMembership[];
  state: {
    apiGovernor: unknown;
    optionsFlow: unknown;
    flowCoverage: unknown;
    bridge: BridgeLaneDiagnosticsSnapshot | null;
    bridgeError: string | null;
  };
};

type PersistedLaneOverrides = {
  version: 1;
  apiGovernor?: Partial<
    Record<BridgeWorkCategory, Partial<BridgeGovernorConfig>>
  >;
  optionsFlow?: Partial<OptionsFlowRuntimeConfig>;
  updatedAt?: string;
};

type UpdatePayload = {
  managementToken?: unknown;
  overrides?: unknown;
  lanePolicy?: unknown;
};

const overrideFile =
  process.env["RAYALGO_IBKR_LANE_OVERRIDE_FILE"]?.trim() ||
  join(tmpdir(), "rayalgo", "ibkr-lane-overrides.json");

const governorCategories = [
  "health",
  "account",
  "orders",
  "options",
  "bars",
  "quotes",
] as const satisfies BridgeWorkCategory[];
const governorKeys = ["concurrency", "failureThreshold", "backoffMs"] as const;
const schedulerKeys = [
  "concurrency",
  "timeoutMs",
  "queueCap",
  "backoffMs",
  "failureThreshold",
] as const;
const flowModes = ["watchlist", "market", "hybrid"] as const;
const optionStrikeCoverages = ["fast", "standard", "full"] as const;
const flowMarkets = [
  "stocks",
  "etf",
  "indices",
  "futures",
  "fx",
  "crypto",
  "otc",
];

const laneLabels: Record<IbkrDataLaneId, string> = {
  "equity-live-quotes": "Equity Live Quotes",
  "option-live-quotes": "Option Live Quotes",
  "flow-scanner": "Flow Scanner",
  "option-chain-metadata": "Option Chain Metadata",
  "historical-bars": "Historical Bars",
  "account-control": "Account Control",
  "orders-control": "Orders Control",
};

const governorLimits: Record<
  keyof BridgeGovernorConfig,
  { min: number; max: number; unit?: string }
> = {
  concurrency: { min: 1, max: 8 },
  failureThreshold: { min: 1, max: 10 },
  backoffMs: { min: 1_000, max: 300_000, unit: "ms" },
};

const schedulerLimits: Record<
  (typeof schedulerKeys)[number],
  { min: number; max: number; unit?: string }
> = {
  concurrency: { min: 1, max: 4 },
  timeoutMs: { min: 500, max: 120_000, unit: "ms" },
  queueCap: { min: 1, max: 100 },
  backoffMs: { min: 1_000, max: 300_000, unit: "ms" },
  failureThreshold: { min: 1, max: 10 },
};

const bridgeLimitBounds: Record<string, { min: number; max: number; unit?: string }> =
  {
    tickleIntervalMs: { min: 10_000, max: 300_000, unit: "ms" },
    historicalReconnectMaxRetries: { min: 0, max: 5 },
    maxLiveEquityLines: { min: 0, max: 500 },
    maxLiveOptionLines: { min: 0, max: 500 },
    maxMarketDataLines: { min: 1, max: 500 },
    optionQuoteVisibleContractLimit: { min: 1, max: 500 },
    genericTickSampleMs: { min: 100, max: 10_000, unit: "ms" },
    connectTimeoutMs: { min: 1_000, max: 120_000, unit: "ms" },
    openOrdersRequestTimeoutMs: { min: 500, max: 60_000, unit: "ms" },
  };

const optionsFlowBounds: Partial<
  Record<keyof OptionsFlowRuntimeConfig, { min: number; max: number; unit?: string }>
> = {
  optionUpstreamBackoffMs: { min: 1_000, max: 300_000, unit: "ms" },
  optionChainBatchConcurrency: { min: 1, max: 8 },
  scannerIntervalMs: { min: 1_000, max: 300_000, unit: "ms" },
  universeSize: { min: 1, max: 2_000 },
  universeRefreshMs: { min: 60_000, max: 3_600_000, unit: "ms" },
  universeMinPrice: { min: 0.01, max: 1_000 },
  universeMinDollarVolume: { min: 0, max: 1_000_000_000 },
  radarBatchSize: { min: 1, max: 100 },
  radarDeepCandidateCount: { min: 1, max: 20 },
  radarFallbackDeepCandidateCount: { min: 0, max: 20 },
  radarDeepLineBudget: { min: 1, max: 40 },
  scannerBatchSize: { min: 1, max: 100 },
  scannerConcurrency: { min: 1, max: 8 },
  scannerLimit: { min: 1, max: 500 },
  scannerLineBudget: { min: 1, max: 150 },
  expirationScanCount: { min: 0, max: 20 },
};

let loaded = false;
let persistedOverrides: PersistedLaneOverrides = { version: 1 };

function safeRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isGovernorCategory(value: string): value is BridgeWorkCategory {
  return governorCategories.includes(value as BridgeWorkCategory);
}

function isGovernorKey(value: string): value is keyof BridgeGovernorConfig {
  return governorKeys.includes(value as keyof BridgeGovernorConfig);
}

function clampNumber(value: unknown, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value));
  if (!Number.isFinite(parsed)) {
    throw new HttpError(400, "Lane override value must be numeric.", {
      code: "invalid_ibkr_lane_override",
    });
  }
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function clampFloat(value: unknown, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value));
  if (!Number.isFinite(parsed)) {
    throw new HttpError(400, "Lane override value must be numeric.", {
      code: "invalid_ibkr_lane_override",
    });
  }
  return Math.min(max, Math.max(min, parsed));
}

function readBoolean(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new HttpError(400, "Lane override value must be boolean.", {
    code: "invalid_ibkr_lane_override",
  });
}

function normalizeMarkets(value: unknown): string[] {
  const values = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];
  const normalized = [
    ...new Set(
      values
        .map((item) => String(item).trim().toLowerCase())
        .filter((item) => flowMarkets.includes(item)),
    ),
  ];
  if (!normalized.length) {
    throw new HttpError(400, "At least one flow universe market is required.", {
      code: "invalid_ibkr_lane_override",
    });
  }
  return normalized;
}

function cleanPersistedOverrides(value: unknown): PersistedLaneOverrides {
  const record = safeRecord(value);
  return {
    version: 1,
    apiGovernor: safeRecord(record.apiGovernor) as PersistedLaneOverrides["apiGovernor"],
    optionsFlow: safeRecord(record.optionsFlow) as PersistedLaneOverrides["optionsFlow"],
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : undefined,
  };
}

function loadPersistedOverrides(): PersistedLaneOverrides {
  if (loaded) {
    return persistedOverrides;
  }
  loaded = true;
  try {
    if (existsSync(overrideFile)) {
      persistedOverrides = cleanPersistedOverrides(
        JSON.parse(readFileSync(overrideFile, "utf8")) as unknown,
      );
    }
  } catch (error) {
    logger.warn({ err: error, overrideFile }, "Failed to load IBKR lane overrides");
  }
  applyPersistedOverrides();
  return persistedOverrides;
}

function persistOverrides(): void {
  persistedOverrides = {
    ...persistedOverrides,
    version: 1,
    updatedAt: new Date().toISOString(),
  };
  try {
    mkdirSync(dirname(overrideFile), { recursive: true });
    writeFileSync(overrideFile, `${JSON.stringify(persistedOverrides, null, 2)}\n`);
  } catch (error) {
    logger.warn({ err: error, overrideFile }, "Failed to persist IBKR lane overrides");
  }
}

function applyPersistedOverrides(): void {
  resetBridgeGovernorOverrides();
  resetOptionsFlowRuntimeOverrides();
  if (persistedOverrides.apiGovernor) {
    setBridgeGovernorOverrides(persistedOverrides.apiGovernor);
  }
  if (persistedOverrides.optionsFlow) {
    setOptionsFlowRuntimeOverrides(persistedOverrides.optionsFlow);
  }
}

function controlSource(
  value: unknown,
  fallback: ControlSource = "unknown",
): ControlSource {
  return value === "default" || value === "env" || value === "override"
    ? value
    : fallback;
}

function formatLabel(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function buildGovernorControls(): LaneControl[] {
  const snapshot = getBridgeGovernorConfigSnapshot();
  return governorCategories.flatMap((category) =>
    governorKeys.map((key) => {
      const config = snapshot[category];
      const limits = governorLimits[key];
      const source = controlSource(config.sources[key]);
      return {
        id: `api.governor.${category}.${key}`,
        label: `${formatLabel(category)} ${formatLabel(key)}`,
        group: "API Governor",
        layer: "platform",
        kind: "number",
        value: config[key],
        defaultValue: config.defaults[key],
        source,
        overridden: source === "override",
        min: limits.min,
        max: limits.max,
        step: 1,
        unit: limits.unit,
      };
    }),
  );
}

function buildOptionsFlowControls(): LaneControl[] {
  const snapshot = getOptionsFlowRuntimeConfigSnapshot();
  const controls: LaneControl[] = [];
  (Object.keys(snapshot.defaults) as Array<keyof OptionsFlowRuntimeConfig>).forEach(
    (key) => {
      const source = controlSource(snapshot.sources[key], "default");
      if (
        key === "scannerEnabled" ||
        key === "scannerAlwaysOn" ||
        key === "radarEnabled"
      ) {
        controls.push({
          id: `api.flow.${key}`,
          label: formatLabel(key),
          group: "Options Flow",
          layer: "platform",
          kind: "boolean",
          value: snapshot[key],
          defaultValue: snapshot.defaults[key],
          source,
          overridden: source === "override",
        });
        return;
      }
      if (key === "universeMode") {
        controls.push({
          id: `api.flow.${key}`,
          label: "Universe Mode",
          group: "Options Flow",
          layer: "platform",
          kind: "select",
          value: snapshot[key],
          defaultValue: snapshot.defaults[key],
          source,
          overridden: source === "override",
          options: [...flowModes],
        });
        return;
      }
      if (key === "universeMarkets") {
        controls.push({
          id: `api.flow.${key}`,
          label: "Universe Markets",
          group: "Options Flow",
          layer: "platform",
          kind: "list",
          value: snapshot[key],
          defaultValue: snapshot.defaults[key],
          source,
          overridden: source === "override",
          options: flowMarkets,
        });
        return;
      }
      if (key === "scannerStrikeCoverage") {
        controls.push({
          id: `api.flow.${key}`,
          label: "Scanner Strike Coverage",
          group: "Options Flow",
          layer: "platform",
          kind: "select",
          value: snapshot[key],
          defaultValue: snapshot.defaults[key],
          source,
          overridden: source === "override",
          options: [...optionStrikeCoverages],
        });
        return;
      }
      const limits = optionsFlowBounds[key];
      if (!limits) return;
      controls.push({
        id: `api.flow.${key}`,
        label: formatLabel(key),
        group: "Options Flow",
        layer: "platform",
        kind: "number",
        value: snapshot[key],
        defaultValue: snapshot.defaults[key],
        source,
        overridden: source === "override",
        min: limits.min,
        max: limits.max,
        step: key === "universeMinPrice" ? 0.01 : 1,
        unit: limits.unit,
      });
    },
  );
  return controls;
}

function buildBridgeControls(bridge: BridgeLaneDiagnosticsSnapshot | null): LaneControl[] {
  const controls: LaneControl[] = [];
  const schedulerConfig = safeRecord(bridge?.schedulerConfig);
  Object.entries(schedulerConfig).forEach(([lane, rawConfig]) => {
    const config = safeRecord(rawConfig);
    const defaults = safeRecord(config.defaults);
    const sources = safeRecord(config.sources);
    schedulerKeys.forEach((key) => {
      const limits = schedulerLimits[key];
      const source = controlSource(sources[key]);
      controls.push({
        id: `bridge.scheduler.${lane}.${key}`,
        label: `${formatLabel(lane)} ${formatLabel(key)}`,
        group: "Bridge Scheduler",
        layer: "bridge",
        kind: "number",
        value: config[key],
        defaultValue: defaults[key],
        source,
        overridden: source === "override",
        min: limits.min,
        max: limits.max,
        step: 1,
        unit: limits.unit,
      });
    });
  });

  const limits = safeRecord(bridge?.limits);
  Object.entries(limits).forEach(([key, rawLimit]) => {
    const limit = safeRecord(rawLimit);
    const bounds = bridgeLimitBounds[key];
    if (!bounds) return;
    const source = controlSource(limit.source);
    controls.push({
      id: `bridge.limit.${key}`,
      label: formatLabel(key),
      group: "Bridge Subscription Limits",
      layer: "bridge",
      kind: "number",
      value: limit.value,
      defaultValue: limit.defaultValue,
      source,
      overridden: source === "override",
      description: typeof limit.description === "string" ? limit.description : undefined,
      min: bounds.min,
      max: bounds.max,
      step: key === "universeMinPrice" ? 0.01 : 1,
      unit: bounds.unit,
    });
  });

  return controls;
}

async function fetchBridgeLaneDiagnostics(): Promise<{
  bridge: BridgeLaneDiagnosticsSnapshot | null;
  bridgeError: string | null;
}> {
  try {
    return {
      bridge: await new IbkrBridgeClient().getLaneDiagnostics(),
      bridgeError: null,
    };
  } catch (error) {
    return {
      bridge: null,
      bridgeError:
        error instanceof Error && error.message
          ? error.message
          : "IBKR bridge lane diagnostics are unavailable.",
    };
  }
}

function collectWatchlistSymbols(value: unknown): string[] {
  const snapshot = safeRecord(value);
  const watchlists = Array.isArray(snapshot.watchlists) ? snapshot.watchlists : [];
  return [
    ...new Set(
      watchlists.flatMap((watchlist) => {
        const items = Array.isArray(safeRecord(watchlist).items)
          ? (safeRecord(watchlist).items as unknown[])
          : [];
        return items
          .map((item) => {
            const record = safeRecord(item);
            return typeof record.symbol === "string" ? record.symbol : "";
          })
          .map((symbol) => symbol.trim().toUpperCase())
          .filter(Boolean);
      }),
    ),
  ].sort();
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function bridgeSchedulerLane(bridge: BridgeLaneDiagnosticsSnapshot | null, lane: string) {
  return safeRecord(safeRecord(bridge?.scheduler)[lane]);
}

async function buildLaneMemberships(
  bridge: BridgeLaneDiagnosticsSnapshot | null,
): Promise<LaneMembership[]> {
  const watchlistSnapshot = await listWatchlistsForDiagnostics().catch(() => ({
    watchlists: [],
  }));
  const watchlistSymbols = collectWatchlistSymbols(watchlistSnapshot);
  const flowLaneSources = getOptionsFlowLaneSourceSymbols();
  const flowUniverseSymbols = flowLaneSources.flowUniverseSymbols;
  const flowScanner = resolveIbkrLaneSymbols("flow-scanner", {
    "built-in": flowLaneSources.builtInSymbols,
    "flow-universe": flowUniverseSymbols,
  });
  const subscriptions = safeRecord(bridge?.subscriptions);
  const admissionDiagnostics = getMarketDataAdmissionDiagnostics();

  const rows: Array<{
    label: string;
    resolution: IbkrLaneSymbolResolution;
    availableSources: Partial<Record<IbkrLaneSourceId, string[]>>;
    activeCount: number | null;
    queuedCount: number | null;
    notes: string[];
  }> = [
    {
      label: laneLabels["equity-live-quotes"],
      availableSources: {
        watchlists: watchlistSymbols,
      },
      resolution: resolveIbkrLaneSymbols("equity-live-quotes", {
        watchlists: watchlistSymbols,
      }),
      activeCount: readNumber(subscriptions.activeEquitySubscriptions),
      queuedCount: readNumber(bridgeSchedulerLane(bridge, "market-subscriptions").queued),
      notes: ["Feeds header/watchlist quote prewarm and equity quote streams."],
    },
    {
      label: laneLabels["option-live-quotes"],
      availableSources: {
        "flow-universe": flowUniverseSymbols,
        watchlists: watchlistSymbols,
      },
      resolution: resolveIbkrLaneSymbols("option-live-quotes", {
        "flow-universe": flowUniverseSymbols,
        watchlists: watchlistSymbols,
      }),
      activeCount: readNumber(subscriptions.activeOptionSubscriptions),
      queuedCount: readNumber(bridgeSchedulerLane(bridge, "option-quotes").queued),
      notes: ["Represents underlying demand that may create option contract quote subscriptions."],
    },
    {
      label: laneLabels["flow-scanner"],
      availableSources: {
        "built-in": flowLaneSources.builtInSymbols,
        "flow-universe": flowUniverseSymbols,
      },
      resolution: flowScanner,
      activeCount: admissionDiagnostics.flowScannerLineCount,
      queuedCount: null,
      notes: ["Controls symbols rotated through the protected options-flow live-line pool."],
    },
    {
      label: laneLabels["option-chain-metadata"],
      availableSources: {
        "flow-universe": flowUniverseSymbols,
        watchlists: watchlistSymbols,
      },
      resolution: resolveIbkrLaneSymbols("option-chain-metadata", {
        "flow-universe": flowUniverseSymbols,
        watchlists: watchlistSymbols,
      }),
      activeCount: null,
      queuedCount: readNumber(bridgeSchedulerLane(bridge, "options-meta").queued),
      notes: ["Controls option expiration/strike discovery pressure."],
    },
    {
      label: laneLabels["historical-bars"],
      availableSources: {
        watchlists: watchlistSymbols,
        "flow-universe": flowUniverseSymbols,
      },
      resolution: resolveIbkrLaneSymbols("historical-bars", {
        watchlists: watchlistSymbols,
        "flow-universe": flowUniverseSymbols,
      }),
      activeCount: null,
      queuedCount: readNumber(bridgeSchedulerLane(bridge, "historical").queued),
      notes: ["Historical requests are paced separately from live market data lines."],
    },
    {
      label: laneLabels["account-control"],
      availableSources: {
        system: ["ACCOUNT"],
      },
      resolution: resolveIbkrLaneSymbols("account-control", {
        system: ["ACCOUNT"],
      }),
      activeCount: readNumber(bridgeSchedulerLane(bridge, "account").active),
      queuedCount: readNumber(bridgeSchedulerLane(bridge, "account").queued),
      notes: ["Account lane is system controlled and should stay narrow."],
    },
    {
      label: laneLabels["orders-control"],
      availableSources: {
        system: ["ORDERS"],
      },
      resolution: resolveIbkrLaneSymbols("orders-control", {
        system: ["ORDERS"],
      }),
      activeCount: null,
      queuedCount: null,
      notes: ["Order reads/writes stay isolated from quote and flow data lanes."],
    },
  ];

  return rows.map((row) => ({
    laneId: row.resolution.laneId,
    label: row.label,
    availableSources: row.availableSources,
    enabled: row.resolution.enabled,
    maxSymbols: row.resolution.maxSymbols,
    desiredSymbols: row.resolution.desiredSymbols,
    admittedSymbols: row.resolution.admittedSymbols,
    droppedSymbols: row.resolution.droppedSymbols,
    sourceCounts: row.resolution.sourceCounts,
    activeCount: row.activeCount,
    queuedCount: row.queuedCount,
    notes: row.notes,
  }));
}

function buildNodes(
  bridge: BridgeLaneDiagnosticsSnapshot | null,
  bridgeError: string | null,
): IbkrLaneArchitectureSnapshot["layers"] {
  const flowCoverage = getOptionsFlowUniverseCoverage();
  const bridgePressure = bridge?.pressure ?? "unknown";
  const bridgeStatus =
    bridgePressure === "normal" ||
    bridgePressure === "degraded" ||
    bridgePressure === "backoff" ||
    bridgePressure === "stalled"
      ? bridgePressure
      : bridgeError
        ? "degraded"
        : "unknown";

  return [
    {
      id: "platform",
      label: "RayAlgo Platform",
      nodes: [
        {
          id: "api-governor",
          label: "API Governor",
          layer: "platform",
          status: "normal",
          summary: "Controls request concurrency and backoff before bridge calls.",
        },
        {
          id: "flow-universe",
          label: "Flow Universe",
          layer: "platform",
          status: flowCoverage.fallbackUsed ? "degraded" : "normal",
          summary: `${flowCoverage.selectedSymbols} selected, target ${flowCoverage.targetSize}.`,
        },
        {
          id: "flow-scanner",
          label: "Options Flow Scanner",
          layer: "platform",
          status: "normal",
          summary: "Rotates symbols through option chain and quote hydration.",
        },
      ],
    },
    {
      id: "bridge",
      label: "IBKR Bridge / IB Gateway",
      nodes: [
        {
          id: "bridge-runtime",
          label: "Bridge URL",
          layer: "bridge",
          status: bridgeError ? "degraded" : "normal",
          summary: bridgeError ?? "Uses the current local bridge tunnel and bearer token.",
        },
        {
          id: "bridge-scheduler",
          label: "Bridge Scheduler",
          layer: "bridge",
          status: bridgeStatus,
          summary: `Scheduler pressure: ${bridgePressure}.`,
        },
        {
          id: "subscription-budget",
          label: "IBKR Data Lines",
          layer: "bridge",
          status: bridgeStatus,
          summary: "Caps equity, option, and total market data subscriptions.",
        },
        {
          id: "ib-gateway",
          label: "IB Gateway / TWS API",
          layer: "bridge",
          status: bridgeError ? "unknown" : "normal",
          summary: "Final socket connection to IBKR market data and account APIs.",
        },
      ],
    },
  ];
}

function normalizeFlowOverride(
  key: keyof OptionsFlowRuntimeConfig,
  value: unknown,
): OptionsFlowRuntimeConfig[keyof OptionsFlowRuntimeConfig] {
  if (
    key === "scannerEnabled" ||
    key === "scannerAlwaysOn" ||
    key === "radarEnabled"
  ) {
    return readBoolean(value);
  }
  if (key === "universeMode") {
    const normalized = String(value).trim().toLowerCase();
    if (!flowModes.includes(normalized as (typeof flowModes)[number])) {
      throw new HttpError(400, "Invalid options flow universe mode.", {
        code: "invalid_ibkr_lane_override",
      });
    }
    return normalized as OptionsFlowRuntimeConfig["universeMode"];
  }
  if (key === "universeMarkets") {
    return normalizeMarkets(value);
  }
  if (key === "scannerStrikeCoverage") {
    const normalized = String(value).trim().toLowerCase();
    if (
      !optionStrikeCoverages.includes(
        normalized as (typeof optionStrikeCoverages)[number],
      )
    ) {
      throw new HttpError(400, "Invalid options flow strike coverage.", {
        code: "invalid_ibkr_lane_override",
      });
    }
    return normalized as OptionsFlowRuntimeConfig["scannerStrikeCoverage"];
  }
  const limits = optionsFlowBounds[key];
  if (!limits) {
    throw new HttpError(400, "Unknown options flow override.", {
      code: "invalid_ibkr_lane_override",
    });
  }
  return key === "universeMinPrice"
    ? clampFloat(value, limits.min, limits.max)
    : clampNumber(value, limits.min, limits.max);
}

function applyOverrideValue(
  id: string,
  value: unknown,
  bridgeUpdate: BridgeLaneSettingsRequest,
): void {
  const parts = id.split(".");
  if (parts[0] === "api" && parts[1] === "governor") {
    const [, , category, key] = parts;
    if (!isGovernorCategory(category) || !isGovernorKey(key)) {
      throw new HttpError(400, `Unknown governor lane control: ${id}`, {
        code: "invalid_ibkr_lane_override",
      });
    }
    persistedOverrides.apiGovernor ??= {};
    persistedOverrides.apiGovernor[category] ??= {};
    if (value === null || value === undefined || value === "") {
      delete persistedOverrides.apiGovernor[category]?.[key];
      return;
    }
    const limits = governorLimits[key];
    persistedOverrides.apiGovernor[category]![key] = clampNumber(
      value,
      limits.min,
      limits.max,
    );
    return;
  }

  if (parts[0] === "api" && parts[1] === "flow") {
    const key = parts[2] as keyof OptionsFlowRuntimeConfig;
    if (!(key in getOptionsFlowRuntimeConfigSnapshot().defaults)) {
      throw new HttpError(400, `Unknown options flow lane control: ${id}`, {
        code: "invalid_ibkr_lane_override",
      });
    }
    persistedOverrides.optionsFlow ??= {};
    if (value === null || value === undefined || value === "") {
      delete persistedOverrides.optionsFlow[key];
      return;
    }
    persistedOverrides.optionsFlow[key] = normalizeFlowOverride(key, value) as never;
    return;
  }

  if (parts[0] === "bridge" && parts[1] === "scheduler") {
    const [, , lane, key] = parts;
    if (!lane || !schedulerKeys.includes(key as (typeof schedulerKeys)[number])) {
      throw new HttpError(400, `Unknown bridge scheduler control: ${id}`, {
        code: "invalid_ibkr_lane_override",
      });
    }
    bridgeUpdate.scheduler ??= {};
    bridgeUpdate.scheduler[lane] ??= {};
    if (value === null || value === undefined || value === "") {
      bridgeUpdate.scheduler[lane][key] = null;
      return;
    }
    const limits = schedulerLimits[key as (typeof schedulerKeys)[number]];
    bridgeUpdate.scheduler[lane][key] = clampNumber(value, limits.min, limits.max);
    return;
  }

  if (parts[0] === "bridge" && parts[1] === "limit") {
    const key = parts[2];
    const limits = bridgeLimitBounds[key];
    if (!limits) {
      throw new HttpError(400, `Unknown bridge limit control: ${id}`, {
        code: "invalid_ibkr_lane_override",
      });
    }
    bridgeUpdate.limits ??= {};
    bridgeUpdate.limits[key] =
      value === null || value === undefined || value === ""
        ? null
        : clampNumber(value, limits.min, limits.max);
    return;
  }

  throw new HttpError(400, `Unknown IBKR lane control: ${id}`, {
    code: "invalid_ibkr_lane_override",
  });
}

function pruneEmptyOverrides(): void {
  for (const [category, config] of Object.entries(
    persistedOverrides.apiGovernor ?? {},
  )) {
    if (!config || Object.keys(config).length === 0) {
      delete persistedOverrides.apiGovernor?.[category as BridgeWorkCategory];
    }
  }
  if (
    persistedOverrides.apiGovernor &&
    Object.keys(persistedOverrides.apiGovernor).length === 0
  ) {
    delete persistedOverrides.apiGovernor;
  }
  if (
    persistedOverrides.optionsFlow &&
    Object.keys(persistedOverrides.optionsFlow).length === 0
  ) {
    delete persistedOverrides.optionsFlow;
  }
}

export async function getIbkrLaneArchitecture(): Promise<IbkrLaneArchitectureSnapshot> {
  loadPersistedOverrides();
  const { bridge, bridgeError } = await fetchBridgeLaneDiagnostics();
  const lanePolicy = getIbkrLanePolicySnapshot();
  const memberships = await buildLaneMemberships(bridge);
  const controls = [
    ...buildGovernorControls(),
    ...buildOptionsFlowControls(),
    ...buildBridgeControls(bridge),
  ];

  return {
    updatedAt: new Date(),
    persistence: {
      enabled: true,
      path: overrideFile,
    },
    layers: buildNodes(bridge, bridgeError),
    edges: [
      { from: "flow-universe", to: "flow-scanner", label: "symbol batches" },
      { from: "flow-scanner", to: "api-governor", label: "governed requests" },
      { from: "api-governor", to: "bridge-runtime", label: "bridge URL/token" },
      { from: "bridge-runtime", to: "bridge-scheduler", label: "HTTP calls" },
      { from: "bridge-scheduler", to: "subscription-budget", label: "lane queues" },
      { from: "subscription-budget", to: "ib-gateway", label: "TWS market data lines" },
    ],
    controls,
    policy: {
      lanes: lanePolicy.policy.lanes,
      defaults: lanePolicy.defaults.lanes,
      updatedAt: lanePolicy.policy.updatedAt,
    },
    memberships,
    state: {
      apiGovernor: getBridgeGovernorConfigSnapshot(),
      optionsFlow: getOptionsFlowRuntimeConfigSnapshot(),
      flowCoverage: getOptionsFlowUniverseCoverage(),
      bridge,
      bridgeError,
    },
  };
}

export async function updateIbkrLaneArchitecture(
  body: UpdatePayload,
): Promise<IbkrLaneArchitectureSnapshot> {
  verifyIbkrBridgeManagementToken(body);
  loadPersistedOverrides();

  const overrides = safeRecord(body.overrides);
  const lanePolicyPatch = safeRecord(body.lanePolicy);
  if (
    Object.keys(overrides).length === 0 &&
    Object.keys(lanePolicyPatch).length === 0
  ) {
    throw new HttpError(400, "At least one lane override is required.", {
      code: "invalid_ibkr_lane_override",
    });
  }

  const bridgeUpdate: BridgeLaneSettingsRequest = {};
  Object.entries(overrides).forEach(([id, value]) => {
    applyOverrideValue(id, value, bridgeUpdate);
  });
  pruneEmptyOverrides();
  persistOverrides();
  applyPersistedOverrides();
  if (Object.keys(lanePolicyPatch).length > 0) {
    updateIbkrLanePolicy(lanePolicyPatch as Parameters<typeof updateIbkrLanePolicy>[0]);
  }

  if (bridgeUpdate.scheduler || bridgeUpdate.limits) {
    await new IbkrBridgeClient().updateLaneDiagnostics(bridgeUpdate);
  }

  return getIbkrLaneArchitecture();
}
