import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { normalizeSymbol } from "../lib/values";
import { logger } from "../lib/logger";

export type IbkrDataLaneId =
  | "equity-live-quotes"
  | "option-live-quotes"
  | "flow-scanner"
  | "option-chain-metadata"
  | "historical-bars"
  | "account-control"
  | "orders-control";

export type IbkrLaneSourceId =
  | "built-in"
  | "watchlists"
  | "flow-universe"
  | "manual"
  | "system";

export type IbkrLaneMembershipPolicy = {
  enabled: boolean;
  sources: Record<IbkrLaneSourceId, boolean>;
  manualSymbols: string[];
  excludedSymbols: string[];
  maxSymbols: number;
  priority: IbkrLaneSourceId[];
};

export type IbkrLanePolicy = {
  version: 1;
  lanes: Record<IbkrDataLaneId, IbkrLaneMembershipPolicy>;
  updatedAt: string | null;
};

export type IbkrLaneSymbolResolution = {
  laneId: IbkrDataLaneId;
  enabled: boolean;
  maxSymbols: number;
  desiredSymbols: Array<{
    symbol: string;
    sources: IbkrLaneSourceId[];
  }>;
  admittedSymbols: string[];
  droppedSymbols: Array<{
    symbol: string;
    reason: "disabled" | "excluded" | "capacity";
    sources: IbkrLaneSourceId[];
  }>;
  sourceCounts: Record<IbkrLaneSourceId, number>;
};

type LanePolicyPatch = Partial<
  Record<
    IbkrDataLaneId,
    Partial<
      Omit<
        IbkrLaneMembershipPolicy,
        "sources" | "manualSymbols" | "excludedSymbols" | "maxSymbols" | "priority"
      > & {
        sources: Partial<Record<IbkrLaneSourceId, boolean>>;
        manualSymbols: unknown;
        excludedSymbols: unknown;
        maxSymbols: unknown;
        priority: unknown;
      }
    >
  >
>;

function getLanePolicyFile(): string {
  return (
    process.env["RAYALGO_IBKR_LANE_POLICY_FILE"]?.trim() ||
    join(tmpdir(), "rayalgo", "ibkr-lane-policy.json")
  );
}

export const IBKR_DATA_LANE_IDS = [
  "equity-live-quotes",
  "option-live-quotes",
  "flow-scanner",
  "option-chain-metadata",
  "historical-bars",
  "account-control",
  "orders-control",
] as const satisfies IbkrDataLaneId[];

const SOURCE_IDS = [
  "built-in",
  "watchlists",
  "flow-universe",
  "manual",
  "system",
] as const satisfies IbkrLaneSourceId[];

const DEFAULT_SOURCES: Record<IbkrLaneSourceId, boolean> = {
  "built-in": false,
  watchlists: false,
  "flow-universe": false,
  manual: true,
  system: false,
};

const DEFAULT_PRIORITY: IbkrLaneSourceId[] = [
  "system",
  "manual",
  "watchlists",
  "flow-universe",
  "built-in",
];

const DEFAULT_LANE_POLICY: IbkrLanePolicy = {
  version: 1,
  updatedAt: null,
  lanes: {
    "equity-live-quotes": {
      enabled: true,
      sources: {
        ...DEFAULT_SOURCES,
        watchlists: true,
        system: true,
      },
      manualSymbols: [],
      excludedSymbols: [],
      maxSymbols: 80,
      priority: DEFAULT_PRIORITY,
    },
    "option-live-quotes": {
      enabled: true,
      sources: {
        ...DEFAULT_SOURCES,
        "flow-universe": true,
      },
      manualSymbols: [],
      excludedSymbols: [],
      maxSymbols: 80,
      priority: DEFAULT_PRIORITY,
    },
    "flow-scanner": {
      enabled: true,
      sources: {
        ...DEFAULT_SOURCES,
        "built-in": true,
        "flow-universe": true,
      },
      manualSymbols: [],
      excludedSymbols: [],
      maxSymbols: 500,
      priority: ["manual", "flow-universe", "built-in", "watchlists", "system"],
    },
    "option-chain-metadata": {
      enabled: true,
      sources: {
        ...DEFAULT_SOURCES,
        "flow-universe": true,
        watchlists: true,
      },
      manualSymbols: [],
      excludedSymbols: [],
      maxSymbols: 100,
      priority: ["manual", "watchlists", "flow-universe", "built-in", "system"],
    },
    "historical-bars": {
      enabled: true,
      sources: {
        ...DEFAULT_SOURCES,
        watchlists: true,
        manual: true,
      },
      manualSymbols: [],
      excludedSymbols: [],
      maxSymbols: 60,
      priority: ["manual", "watchlists", "flow-universe", "built-in", "system"],
    },
    "account-control": {
      enabled: true,
      sources: {
        ...DEFAULT_SOURCES,
        system: true,
      },
      manualSymbols: [],
      excludedSymbols: [],
      maxSymbols: 1,
      priority: DEFAULT_PRIORITY,
    },
    "orders-control": {
      enabled: true,
      sources: {
        ...DEFAULT_SOURCES,
        system: true,
      },
      manualSymbols: [],
      excludedSymbols: [],
      maxSymbols: 1,
      priority: DEFAULT_PRIORITY,
    },
  },
};

let loaded = false;
let currentPolicy = clonePolicy(DEFAULT_LANE_POLICY);

function clonePolicy(policy: IbkrLanePolicy): IbkrLanePolicy {
  return {
    version: 1,
    updatedAt: policy.updatedAt ?? null,
    lanes: Object.fromEntries(
      IBKR_DATA_LANE_IDS.map((laneId) => {
        const lane = policy.lanes[laneId] ?? DEFAULT_LANE_POLICY.lanes[laneId];
        return [
          laneId,
          {
            enabled: Boolean(lane.enabled),
            sources: { ...DEFAULT_SOURCES, ...lane.sources },
            manualSymbols: normalizeSymbolList(lane.manualSymbols),
            excludedSymbols: normalizeSymbolList(lane.excludedSymbols),
            maxSymbols: normalizeMaxSymbols(laneId, lane.maxSymbols),
            priority: normalizePriority(lane.priority),
          },
        ];
      }),
    ) as Record<IbkrDataLaneId, IbkrLaneMembershipPolicy>,
  };
}

function safeRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isLaneId(value: string): value is IbkrDataLaneId {
  return IBKR_DATA_LANE_IDS.includes(value as IbkrDataLaneId);
}

function isSourceId(value: string): value is IbkrLaneSourceId {
  return SOURCE_IDS.includes(value as IbkrLaneSourceId);
}

function normalizeSymbolList(value: unknown): string[] {
  const rawValues = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];
  return [
    ...new Set(rawValues.map((symbol) => normalizeSymbol(String(symbol))).filter(Boolean)),
  ];
}

function normalizeMaxSymbols(laneId: IbkrDataLaneId, value: unknown): number {
  const fallback = DEFAULT_LANE_POLICY.lanes[laneId].maxSymbols;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  const upperBound =
    laneId === "flow-scanner" ? 2_000 : laneId.includes("control") ? 10 : 500;
  return Math.min(upperBound, Math.max(1, parsed));
}

function normalizePriority(value: unknown): IbkrLaneSourceId[] {
  const rawValues = Array.isArray(value) ? value : DEFAULT_PRIORITY;
  const normalized = rawValues
    .map((entry) => String(entry).trim())
    .filter(isSourceId);
  return [
    ...new Set([...normalized, ...DEFAULT_PRIORITY]),
  ];
}

function normalizePersistedPolicy(value: unknown): IbkrLanePolicy {
  const record = safeRecord(value);
  const rawLanes = safeRecord(record.lanes);
  const lanes = Object.fromEntries(
    IBKR_DATA_LANE_IDS.map((laneId) => {
      const defaults = DEFAULT_LANE_POLICY.lanes[laneId];
      const rawLane = safeRecord(rawLanes[laneId]);
      const rawSources = safeRecord(rawLane.sources);
      const sources = Object.fromEntries(
        SOURCE_IDS.map((sourceId) => [
          sourceId,
          typeof rawSources[sourceId] === "boolean"
            ? rawSources[sourceId]
            : defaults.sources[sourceId],
        ]),
      ) as Record<IbkrLaneSourceId, boolean>;
      return [
        laneId,
        {
          enabled:
            typeof rawLane.enabled === "boolean"
              ? rawLane.enabled
              : defaults.enabled,
          sources,
          manualSymbols: normalizeSymbolList(rawLane.manualSymbols),
          excludedSymbols: normalizeSymbolList(rawLane.excludedSymbols),
          maxSymbols: normalizeMaxSymbols(laneId, rawLane.maxSymbols),
          priority: normalizePriority(rawLane.priority),
        },
      ];
    }),
  ) as Record<IbkrDataLaneId, IbkrLaneMembershipPolicy>;

  return {
    version: 1,
    lanes,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : null,
  };
}

function ensureLoaded(): void {
  if (loaded) {
    return;
  }
  loaded = true;
  const lanePolicyFile = getLanePolicyFile();
  try {
    if (existsSync(lanePolicyFile)) {
      currentPolicy = normalizePersistedPolicy(
        JSON.parse(readFileSync(lanePolicyFile, "utf8")) as unknown,
      );
    }
  } catch (error) {
    logger.warn({ err: error, lanePolicyFile }, "Failed to load IBKR lane policy");
    currentPolicy = clonePolicy(DEFAULT_LANE_POLICY);
  }
}

function persistPolicy(): void {
  const lanePolicyFile = getLanePolicyFile();
  try {
    mkdirSync(dirname(lanePolicyFile), { recursive: true });
    writeFileSync(lanePolicyFile, `${JSON.stringify(currentPolicy, null, 2)}\n`, {
      mode: 0o600,
    });
  } catch (error) {
    logger.warn({ err: error, lanePolicyFile }, "Failed to persist IBKR lane policy");
  }
}

export function getIbkrLanePolicySnapshot(): {
  policy: IbkrLanePolicy;
  defaults: IbkrLanePolicy;
  persistence: { path: string };
} {
  ensureLoaded();
  return {
    policy: clonePolicy(currentPolicy),
    defaults: clonePolicy(DEFAULT_LANE_POLICY),
    persistence: { path: getLanePolicyFile() },
  };
}

export function updateIbkrLanePolicy(patch: LanePolicyPatch): IbkrLanePolicy {
  ensureLoaded();
  const next = clonePolicy(currentPolicy);

  Object.entries(patch).forEach(([laneId, rawPatch]) => {
    if (!isLaneId(laneId) || !rawPatch) {
      return;
    }
    const lane = next.lanes[laneId];
    if (typeof rawPatch.enabled === "boolean") {
      lane.enabled = rawPatch.enabled;
    }
    if (rawPatch.sources && typeof rawPatch.sources === "object") {
      Object.entries(rawPatch.sources).forEach(([sourceId, enabled]) => {
        if (isSourceId(sourceId) && typeof enabled === "boolean") {
          lane.sources[sourceId] = enabled;
        }
      });
    }
    if (rawPatch.manualSymbols !== undefined) {
      lane.manualSymbols = normalizeSymbolList(rawPatch.manualSymbols);
    }
    if (rawPatch.excludedSymbols !== undefined) {
      lane.excludedSymbols = normalizeSymbolList(rawPatch.excludedSymbols);
    }
    if (rawPatch.maxSymbols !== undefined) {
      lane.maxSymbols = normalizeMaxSymbols(laneId, rawPatch.maxSymbols);
    }
    if (rawPatch.priority !== undefined) {
      lane.priority = normalizePriority(rawPatch.priority);
    }
  });

  next.updatedAt = new Date().toISOString();
  currentPolicy = next;
  persistPolicy();
  return clonePolicy(currentPolicy);
}

export function resetIbkrLanePolicy(laneIds?: IbkrDataLaneId[]): IbkrLanePolicy {
  ensureLoaded();
  if (!laneIds || laneIds.length === 0) {
    currentPolicy = clonePolicy(DEFAULT_LANE_POLICY);
  } else {
    const next = clonePolicy(currentPolicy);
    laneIds.forEach((laneId) => {
      next.lanes[laneId] = clonePolicy(DEFAULT_LANE_POLICY).lanes[laneId];
    });
    next.updatedAt = new Date().toISOString();
    currentPolicy = next;
  }
  persistPolicy();
  return clonePolicy(currentPolicy);
}

export function __resetIbkrLanePolicyForTests(): void {
  loaded = false;
  currentPolicy = clonePolicy(DEFAULT_LANE_POLICY);
}

export function resolveIbkrLaneSymbols(
  laneId: IbkrDataLaneId,
  sources: Partial<Record<IbkrLaneSourceId, readonly string[]>>,
): IbkrLaneSymbolResolution {
  ensureLoaded();
  const lane = currentPolicy.lanes[laneId];
  const symbolsBySymbol = new Map<string, Set<IbkrLaneSourceId>>();
  const excluded = new Set(lane.excludedSymbols);
  const sourceCounts = Object.fromEntries(
    SOURCE_IDS.map((sourceId) => [sourceId, 0]),
  ) as Record<IbkrLaneSourceId, number>;

  const addSymbols = (sourceId: IbkrLaneSourceId, values: readonly string[]) => {
    if (!lane.sources[sourceId]) {
      return;
    }
    normalizeSymbolList(values).forEach((symbol) => {
      const set = symbolsBySymbol.get(symbol) ?? new Set<IbkrLaneSourceId>();
      set.add(sourceId);
      symbolsBySymbol.set(symbol, set);
      sourceCounts[sourceId] += 1;
    });
  };

  SOURCE_IDS.forEach((sourceId) => {
    addSymbols(sourceId, sourceId === "manual" ? lane.manualSymbols : sources[sourceId] ?? []);
  });

  const priorityIndex = new Map(
    lane.priority.map((sourceId, index) => [sourceId, index]),
  );
  const desiredSymbols = Array.from(symbolsBySymbol.entries())
    .map(([symbol, sourceSet]) => ({
      symbol,
      sources: Array.from(sourceSet).sort(
        (left, right) =>
          (priorityIndex.get(left) ?? 99) - (priorityIndex.get(right) ?? 99),
      ),
    }))
    .sort((left, right) => {
      const leftPriority = Math.min(
        ...left.sources.map((sourceId) => priorityIndex.get(sourceId) ?? 99),
      );
      const rightPriority = Math.min(
        ...right.sources.map((sourceId) => priorityIndex.get(sourceId) ?? 99),
      );
      return leftPriority - rightPriority || left.symbol.localeCompare(right.symbol);
    });

  const admittedSymbols: string[] = [];
  const droppedSymbols: IbkrLaneSymbolResolution["droppedSymbols"] = [];

  desiredSymbols.forEach((entry) => {
    if (!lane.enabled) {
      droppedSymbols.push({ ...entry, reason: "disabled" });
      return;
    }
    if (excluded.has(entry.symbol)) {
      droppedSymbols.push({ ...entry, reason: "excluded" });
      return;
    }
    if (admittedSymbols.length >= lane.maxSymbols) {
      droppedSymbols.push({ ...entry, reason: "capacity" });
      return;
    }
    admittedSymbols.push(entry.symbol);
  });

  return {
    laneId,
    enabled: lane.enabled,
    maxSymbols: lane.maxSymbols,
    desiredSymbols,
    admittedSymbols,
    droppedSymbols,
    sourceCounts,
  };
}
