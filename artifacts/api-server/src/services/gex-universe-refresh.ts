import { logger } from "../lib/logger";
import { normalizeSymbol } from "../lib/values";
import {
  getHighBetaUniversePreview,
  type HighBetaUniversePreview,
} from "./high-beta-universe";
import {
  enqueueMarketDataJobs,
  isMarketDataIngestDatabaseConfigured,
  type EnqueueMarketDataJobInput,
  type EnqueueMarketDataJobResult,
  type MarketDataIngestJobKind,
  type MarketDataIngestJobStatus,
} from "./market-data-ingest";

const DEFAULT_GEX_UNIVERSE_LIMIT = 500;
const MAX_GEX_UNIVERSE_LIMIT = 500;
const DEFAULT_GEX_UNIVERSE_BATCH_SIZE = 25;
const MAX_GEX_UNIVERSE_BATCH_SIZE = 100;
const GEX_UNIVERSE_PROJECTION_MAX_EXPIRATIONS = 8;
const GEX_UNIVERSE_PROJECTION_STRIKES_AROUND_MONEY = 8;
const GEX_UNIVERSE_PROJECTION_EXPIRATION_UTC_HOUR = 20;
const DEFAULT_GEX_UNIVERSE_STALE_AFTER_MS = readPositiveIntegerEnv(
  "GEX_UNIVERSE_REFRESH_STALE_AFTER_MS",
  readPositiveIntegerEnv("GEX_SNAPSHOT_MAX_AGE_MS", 60_000),
);

const GEX_UNIVERSE_REFRESH_JOB_KINDS = [
  "option_chain_snapshot",
  "gex_snapshot",
] as const satisfies readonly MarketDataIngestJobKind[];

const GEX_UNIVERSE_REFRESH_JOB_PRIORITIES: Partial<Record<
  MarketDataIngestJobKind,
  number
>> = {
  option_chain_snapshot: 1,
  gex_snapshot: 2,
};
const GEX_UNIVERSE_PREREQUISITE_FAILURE_COOLDOWN_MS = 24 * 60 * 60 * 1_000;

export type GexUniverseRefreshScope = "high_beta_500" | "symbols";

export type GexUniverseRefreshSymbolStatus =
  | "fresh"
  | "stale"
  | "missing"
  | "queued"
  | "running"
  | "failed";

type GexUniverseRefreshSourceStatus =
  | HighBetaUniversePreview["sourceStatus"]
  | "high_beta_catalog_fallback"
  | "signal_monitor_catalog_fallback"
  | "catalog_flow_fallback";

export type GexUniverseRefreshSnapshotRow = {
  symbol: string;
  computedAt: Date | string;
  sourceStatus?: string | null;
  optionCount?: number | string | null;
  usableOptionCount?: number | string | null;
  payload?: unknown;
};

export type GexUniverseRefreshJobRow = {
  symbol: string;
  kind: MarketDataIngestJobKind | string;
  status: MarketDataIngestJobStatus | string;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
  lastError?: string | null;
  dedupeBucket?: string | null;
};

export type GexUniverseRefreshInventory = {
  available: boolean;
  unavailableReason: string | null;
  snapshots: GexUniverseRefreshSnapshotRow[];
  jobs: GexUniverseRefreshJobRow[];
};

export type GexUniverseRefreshSymbolHydration = {
  pagePopulated: boolean;
  pageComplete: boolean;
  zeroGammaPayloadReady: boolean;
  zeroGammaLineReady: boolean;
  zeroGammaLineRenderable: boolean;
  projectionOverlayReady: boolean;
  optionRowCount: number | null;
  expirationCount: number | null;
  projectionExpirationCount: number | null;
  zeroGamma: number | null;
  reason: string | null;
};

export type GexUniverseRefreshSymbolPlan = {
  symbol: string;
  status: GexUniverseRefreshSymbolStatus;
  eligible: boolean;
  reason: string;
  computedAt: string | null;
  ageMs: number | null;
  sourceStatus: string | null;
  optionCount: number | null;
  usableOptionCount: number | null;
  activeJobKinds: MarketDataIngestJobKind[];
  failedJobKinds: MarketDataIngestJobKind[];
  lastError: string | null;
  hydration: GexUniverseRefreshSymbolHydration;
};

export type GexUniverseRefreshPlan = {
  generatedAt: string;
  scope: GexUniverseRefreshScope;
  dryRun: boolean;
  limit: number;
  batchSize: number;
  staleAfterMs: number;
  targetSymbolCount: number;
  eligibleSymbolCount: number;
  selectedSymbolCount: number;
  remainingEligibleSymbolCount: number;
  statusCounts: Record<GexUniverseRefreshSymbolStatus, number>;
  plannedSymbols: string[];
  selectedSymbols: string[];
  symbols: GexUniverseRefreshSymbolPlan[];
  hydration: {
    pagePopulatedCount: number;
    pageCompleteCount: number;
    zeroGammaPayloadReadyCount: number;
    zeroGammaLineReadyCount: number;
    zeroGammaLineRenderableCount: number;
    projectionOverlayReadyCount: number;
  };
  inventory: {
    available: boolean;
    unavailableReason: string | null;
  };
  sourceUniverse: {
    acceptedCount: number;
    importedCount: number;
    sourceStatus: GexUniverseRefreshSourceStatus;
    generatedAt: string;
  } | null;
};

export type RefreshGexUniverseSnapshotsInput = {
  scope?: GexUniverseRefreshScope;
  symbols?: string[];
  limit?: number;
  batchSize?: number;
  staleAfterMs?: number;
  dryRun?: boolean;
  refreshUniverse?: boolean;
  reason?: string;
  now?: Date;
  signal?: AbortSignal;
};

export type RefreshGexUniverseSnapshotsResult = GexUniverseRefreshPlan & {
  enqueuedJobCount: number;
  enqueueFailures: Array<{
    symbol: string;
    kind: MarketDataIngestJobKind;
    reason: string;
    dedupeKey: string;
  }>;
};

type ResolveGexUniverseSymbolsResult = {
  scope: GexUniverseRefreshScope;
  limit: number;
  symbols: string[];
  sourceUniverse: GexUniverseRefreshPlan["sourceUniverse"];
};

type GexUniverseFallbackUniverse = {
  symbols: string[];
  acceptedCount: number;
  importedCount: number;
  sourceStatus: Extract<
    GexUniverseRefreshSourceStatus,
    "signal_monitor_catalog_fallback" | "catalog_flow_fallback"
  >;
  generatedAt: string;
};

export type RefreshGexUniverseSnapshotsDependencies = {
  getHighBetaUniversePreview?: typeof getHighBetaUniversePreview;
  readFallbackUniverseSymbols?: (
    limit: number,
  ) => Promise<GexUniverseFallbackUniverse | null>;
  readInventory?: (
    symbols: string[],
  ) => Promise<GexUniverseRefreshInventory>;
  enqueueMarketDataJobs?: (
    inputs: EnqueueMarketDataJobInput[],
  ) => Promise<EnqueueMarketDataJobResult[]>;
};

type DbModule = {
  pool: {
    query: <T = unknown>(
      text: string,
      values?: unknown[],
    ) => Promise<{ rows: T[] }>;
  };
};

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw?.trim()) {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function normalizePositiveInteger(
  value: unknown,
  fallback: number,
  max: number,
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.max(1, Math.min(Math.floor(parsed), max));
}

function normalizeGexUniverseLimit(value: unknown): number {
  return normalizePositiveInteger(
    value,
    DEFAULT_GEX_UNIVERSE_LIMIT,
    MAX_GEX_UNIVERSE_LIMIT,
  );
}

function normalizeGexUniverseBatchSize(value: unknown): number {
  return normalizePositiveInteger(
    value,
    DEFAULT_GEX_UNIVERSE_BATCH_SIZE,
    MAX_GEX_UNIVERSE_BATCH_SIZE,
  );
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value : null;
  }
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function toFiniteNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function sourceExpirationCoverage(payload: unknown): Record<string, unknown> | null {
  const source = asRecord(asRecord(payload)?.["source"]);
  return asRecord(source?.["expirationCoverage"]);
}

function normalizeGexUniverseSymbols(
  symbols: readonly string[],
  limit: number,
): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const raw of symbols) {
    const symbol = normalizeSymbol(raw);
    if (!symbol || seen.has(symbol)) {
      continue;
    }
    seen.add(symbol);
    normalized.push(symbol);
    if (normalized.length >= limit) {
      break;
    }
  }
  return normalized;
}

function emptyStatusCounts(): Record<GexUniverseRefreshSymbolStatus, number> {
  return {
    fresh: 0,
    stale: 0,
    missing: 0,
    queued: 0,
    running: 0,
    failed: 0,
  };
}

function isRefreshJobKind(value: string): value is MarketDataIngestJobKind {
  return GEX_UNIVERSE_REFRESH_JOB_KINDS.includes(
    value as MarketDataIngestJobKind,
  );
}

function indexLatestSnapshots(
  rows: readonly GexUniverseRefreshSnapshotRow[],
): Map<string, GexUniverseRefreshSnapshotRow> {
  const latest = new Map<string, GexUniverseRefreshSnapshotRow>();
  for (const row of rows) {
    const symbol = normalizeSymbol(row.symbol);
    const computedAt = toDate(row.computedAt);
    if (!symbol || !computedAt) {
      continue;
    }
    const existing = latest.get(symbol);
    const existingComputedAt = existing ? toDate(existing.computedAt) : null;
    if (!existingComputedAt || computedAt > existingComputedAt) {
      latest.set(symbol, row);
    }
  }
  return latest;
}

function indexJobsBySymbol(
  rows: readonly GexUniverseRefreshJobRow[],
): Map<string, GexUniverseRefreshJobRow[]> {
  const jobsBySymbol = new Map<string, GexUniverseRefreshJobRow[]>();
  for (const row of rows) {
    const symbol = normalizeSymbol(row.symbol);
    if (!symbol || !isRefreshJobKind(String(row.kind))) {
      continue;
    }
    const status = String(row.status);
    if (status !== "queued" && status !== "running" && status !== "failed") {
      continue;
    }
    const jobs = jobsBySymbol.get(symbol) ?? [];
    jobs.push(row);
    jobsBySymbol.set(symbol, jobs);
  }
  return jobsBySymbol;
}

function jobKinds(rows: readonly GexUniverseRefreshJobRow[]): MarketDataIngestJobKind[] {
  const kinds: MarketDataIngestJobKind[] = [];
  for (const row of rows) {
    const kind = String(row.kind);
    if (isRefreshJobKind(kind) && !kinds.includes(kind)) {
      kinds.push(kind);
    }
  }
  return kinds;
}

function latestJobError(rows: readonly GexUniverseRefreshJobRow[]): string | null {
  const withErrors = rows
    .filter((row) => typeof row.lastError === "string" && row.lastError.trim())
    .sort((left, right) => {
      const leftDate = toDate(left.updatedAt ?? left.createdAt)?.getTime() ?? 0;
      const rightDate = toDate(right.updatedAt ?? right.createdAt)?.getTime() ?? 0;
      return rightDate - leftDate;
    });
  return withErrors[0]?.lastError?.trim() ?? null;
}

function optionExpirationDate(value: unknown): string | null {
  const record = asRecord(value);
  const expirationDate = record?.["expirationDate"];
  if (typeof expirationDate !== "string" || !expirationDate.trim()) {
    return null;
  }
  return expirationDate.trim().slice(0, 10);
}

function optionExpirationTimeMs(value: unknown): number | null {
  const expirationDate = optionExpirationDate(value);
  const match = expirationDate?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const time = Date.UTC(
    year,
    month - 1,
    day,
    GEX_UNIVERSE_PROJECTION_EXPIRATION_UTC_HOUR,
    0,
    0,
    0,
  );
  return Number.isFinite(time) ? time : null;
}

function isProjectionCandidateOption(value: unknown): boolean {
  const record = asRecord(value);
  const strike = toFiniteNumber(record?.["strike"] as number | string | null);
  const impliedVol = toFiniteNumber(
    record?.["impliedVol"] as number | string | null,
  );
  return Boolean(
    strike != null &&
      strike > 0 &&
      impliedVol != null &&
      impliedVol > 0 &&
      impliedVol <= 5,
  );
}

function selectProjectionCandidateOptions(input: {
  options: unknown[];
  spot: number;
  nowMs: number;
}): unknown[] {
  const rowsByExpiration = new Map<string, unknown[]>();
  for (const option of input.options) {
    const expirationDate = optionExpirationDate(option);
    const expirationTimeMs = optionExpirationTimeMs(option);
    if (
      !expirationDate ||
      (expirationTimeMs != null && expirationTimeMs <= input.nowMs)
    ) {
      continue;
    }
    const rows = rowsByExpiration.get(expirationDate) ?? [];
    rows.push(option);
    rowsByExpiration.set(expirationDate, rows);
  }

  return Array.from(rowsByExpiration.keys())
    .sort((left, right) => left.localeCompare(right))
    .slice(0, GEX_UNIVERSE_PROJECTION_MAX_EXPIRATIONS)
    .flatMap((expirationDate) => {
      const expirationRows = rowsByExpiration.get(expirationDate) ?? [];
      const selectedStrikes = new Set(
        Array.from(
          new Set(
            expirationRows
              .map((option) =>
                toFiniteNumber(
                  asRecord(option)?.["strike"] as number | string | null,
                ),
              )
              .filter((strike): strike is number => strike != null),
          ),
        )
          .sort(
            (left, right) =>
              Math.abs(left - input.spot) - Math.abs(right - input.spot) ||
              left - right,
          )
          .slice(0, GEX_UNIVERSE_PROJECTION_STRIKES_AROUND_MONEY * 2 + 1),
      );
      return expirationRows.filter((option) => {
        const strike = toFiniteNumber(
          asRecord(option)?.["strike"] as number | string | null,
        );
        return strike != null && selectedStrikes.has(strike);
      });
    });
}

function countProjectionCandidateExpirations(input: {
  options: unknown[];
  spot: number;
  nowMs: number;
}): number {
  const strikesByExpiration = new Map<string, Set<number>>();
  for (const option of selectProjectionCandidateOptions(input)) {
    if (!isProjectionCandidateOption(option)) {
      continue;
    }
    const expirationDate = optionExpirationDate(option);
    const strike = toFiniteNumber(
      asRecord(option)?.["strike"] as number | string | null,
    );
    if (!expirationDate || strike == null) {
      continue;
    }
    const strikes = strikesByExpiration.get(expirationDate) ?? new Set<number>();
    strikes.add(strike);
    strikesByExpiration.set(expirationDate, strikes);
  }
  return Array.from(strikesByExpiration.values()).filter(
    (strikes) => strikes.size >= 5,
  ).length;
}

function contractGexForHydration(option: unknown, spot: number): number | null {
  const record = asRecord(option);
  const cp = record?.["cp"];
  const gamma = toFiniteNumber(record?.["gamma"] as number | string | null);
  const openInterest = toFiniteNumber(
    record?.["openInterest"] as number | string | null,
  );
  const multiplier =
    toFiniteNumber(record?.["multiplier"] as number | string | null) ?? 100;
  const strike = toFiniteNumber(record?.["strike"] as number | string | null);
  if (
    strike == null ||
    gamma == null ||
    openInterest == null ||
    multiplier <= 0 ||
    (cp !== "C" && cp !== "P")
  ) {
    return null;
  }
  const sign = cp === "P" ? -1 : 1;
  return sign * gamma * openInterest * multiplier * spot * spot * 0.01;
}

function estimateZeroGamma(options: unknown[], spot: number): number | null {
  const byStrike = new Map<number, number>();
  for (const option of options) {
    const record = asRecord(option);
    const strike = toFiniteNumber(record?.["strike"] as number | string | null);
    const gex = contractGexForHydration(option, spot);
    if (strike == null || gex == null) {
      continue;
    }
    byStrike.set(strike, (byStrike.get(strike) ?? 0) + gex);
  }
  const ordered = Array.from(byStrike.entries()).sort(
    ([left], [right]) => left - right,
  );
  if (!ordered.length) {
    return null;
  }
  let previousStrike = ordered[0]?.[0] ?? null;
  let previousCum = ordered[0]?.[1] ?? 0;
  if (previousStrike == null) {
    return null;
  }
  if (previousCum === 0) {
    return previousStrike;
  }
  for (let index = 1; index < ordered.length; index += 1) {
    const [strike, netGex] = ordered[index] as [number, number];
    const nextCum = previousCum + netGex;
    if (
      (previousCum < 0 && nextCum >= 0) ||
      (previousCum > 0 && nextCum <= 0) ||
      nextCum === 0
    ) {
      const denominator = Math.abs(previousCum) + Math.abs(nextCum);
      const ratio = denominator > 0 ? Math.abs(previousCum) / denominator : 0;
      return previousStrike + ratio * (strike - previousStrike);
    }
    previousStrike = strike;
    previousCum = nextCum;
  }
  return null;
}

function resolveSymbolHydration(input: {
  snapshot: GexUniverseRefreshSnapshotRow | null;
  computedAt: Date | null;
  now: Date;
}): GexUniverseRefreshSymbolHydration {
  if (!input.snapshot || !input.computedAt) {
    return {
      pagePopulated: false,
      pageComplete: false,
      zeroGammaPayloadReady: false,
      zeroGammaLineReady: false,
      zeroGammaLineRenderable: false,
      projectionOverlayReady: false,
      optionRowCount: null,
      expirationCount: null,
      projectionExpirationCount: null,
      zeroGamma: null,
      reason: "gex_snapshot_missing",
    };
  }

  const payload = asRecord(input.snapshot.payload);
  const spot = toFiniteNumber(payload?.["spot"] as number | string | null);
  const options = asArray(payload?.["options"]);
  const expirations = new Set(
    options.map(optionExpirationDate).filter((value): value is string => Boolean(value)),
  );
  const coverage = sourceExpirationCoverage(payload);
  const usableOptionCount =
    toFiniteNumber(input.snapshot.usableOptionCount) ??
    toFiniteNumber(
      asRecord(payload?.["source"])?.["usableOptionCount"] as
        | number
        | string
        | null,
    );
  const pagePopulated = Boolean(spot != null && spot > 0 && options.length > 0);
  const pageComplete = Boolean(
    pagePopulated &&
      usableOptionCount != null &&
      usableOptionCount > 0 &&
      coverage?.["complete"] === true &&
      coverage?.["capped"] !== true &&
      (toFiniteNumber(coverage?.["failedCount"] as number | string | null) ?? 0) === 0,
  );
  const projectionExpirationCount =
    spot != null
      ? countProjectionCandidateExpirations({
          options,
          spot,
          nowMs: input.now.getTime(),
        })
      : 0;
  const zeroGamma = spot != null ? estimateZeroGamma(options, spot) : null;
  const zeroGammaLineRenderable = Boolean(
    zeroGamma != null &&
      spot != null &&
      zeroGamma >= spot * 0.5 &&
      zeroGamma <= spot * 1.5,
  );
  const reason = !pagePopulated
    ? "gex_snapshot_unpopulated"
    : !pageComplete
      ? "gex_snapshot_incomplete"
      : null;

  return {
    pagePopulated,
    pageComplete,
    zeroGammaPayloadReady: pagePopulated,
    zeroGammaLineReady: zeroGamma != null,
    zeroGammaLineRenderable,
    projectionOverlayReady: pagePopulated && projectionExpirationCount > 0,
    optionRowCount: options.length,
    expirationCount: expirations.size,
    projectionExpirationCount,
    zeroGamma: zeroGamma == null ? null : Math.round(zeroGamma * 10_000) / 10_000,
    reason,
  };
}

function isRecentPermanentPrerequisiteFailure(
  row: GexUniverseRefreshJobRow,
  now: Date,
): boolean {
  const kind = String(row.kind);
  if (
    kind !== "option_chain_snapshot" && kind !== "gex_snapshot"
  ) {
    return false;
  }
  const updatedAt = toDate(row.updatedAt ?? row.createdAt);
  if (
    !updatedAt ||
    now.getTime() - updatedAt.getTime() > GEX_UNIVERSE_PREREQUISITE_FAILURE_COOLDOWN_MS
  ) {
    return false;
  }
  return isPermanentPrerequisiteFailureMessage(row.lastError);
}

function isPermanentPrerequisiteFailureMessage(
  message: string | null | undefined,
): boolean {
  const normalized = message?.toLowerCase() ?? "";
  if (!normalized) {
    return false;
  }
  if (
    normalized.includes("provider returned no option-chain snapshots") ||
    normalized.includes("option-chain snapshot truncated") ||
    normalized.includes("massive_api_key or massive_market_data_api_key must be set")
  ) {
    return true;
  }
  return (
    /\b(400|401|403|404|422)\b/.test(normalized) &&
    /\b(http|status|client error|response)\b/.test(normalized)
  );
}

export async function resolveGexUniverseSymbols(
  input: RefreshGexUniverseSnapshotsInput,
  dependencies: Pick<
    RefreshGexUniverseSnapshotsDependencies,
    "getHighBetaUniversePreview" | "readFallbackUniverseSymbols"
  > = {},
): Promise<ResolveGexUniverseSymbolsResult> {
  const limit = normalizeGexUniverseLimit(input.limit);
  const explicitSymbols = normalizeGexUniverseSymbols(input.symbols ?? [], limit);
  if (input.scope === "symbols" || explicitSymbols.length > 0) {
    return {
      scope: "symbols",
      limit,
      symbols: explicitSymbols,
      sourceUniverse: null,
    };
  }

  let preview: HighBetaUniversePreview | null = null;
  let previewError: unknown = null;
  try {
    preview = await (
      dependencies.getHighBetaUniversePreview ?? getHighBetaUniversePreview
    )({
      limit,
      dryRun: true,
      refresh: input.refreshUniverse,
      signal: input.signal,
    });
  } catch (error) {
    previewError = error;
    logger.warn(
      { err: error },
      "High-beta GEX universe unavailable; trying live catalog fallback",
    );
  }

  const previewSymbols = preview
    ? normalizeGexUniverseSymbols(
        preview.accepted.map((row) => row.symbol),
        limit,
      )
    : [];
  if (preview && previewSymbols.length >= limit) {
    return {
      scope: "high_beta_500",
      limit,
      symbols: previewSymbols,
      sourceUniverse: {
        acceptedCount: preview.acceptedCount,
        importedCount: preview.importedCount,
        sourceStatus: preview.sourceStatus,
        generatedAt: preview.generatedAt.toISOString(),
      },
    };
  }

  const fallback = await (
    dependencies.readFallbackUniverseSymbols ?? readGexUniverseFallbackSymbols
  )(limit);
  if (fallback?.symbols.length) {
    const symbols = normalizeGexUniverseSymbols(
      [...previewSymbols, ...fallback.symbols],
      limit,
    );
    return {
      scope: "high_beta_500",
      limit,
      symbols,
      sourceUniverse: {
        acceptedCount: symbols.length,
        importedCount:
          (preview?.importedCount ?? 0) + Math.max(0, fallback.importedCount),
        sourceStatus:
          previewSymbols.length > 0
            ? "high_beta_catalog_fallback"
            : fallback.sourceStatus,
        generatedAt:
          preview?.generatedAt.toISOString() ?? fallback.generatedAt,
      },
    };
  }

  if (preview) {
    return {
      scope: "high_beta_500",
      limit,
      symbols: previewSymbols,
      sourceUniverse: {
        acceptedCount: preview.acceptedCount,
        importedCount: preview.importedCount,
        sourceStatus: preview.sourceStatus,
        generatedAt: preview.generatedAt.toISOString(),
      },
    };
  }

  throw previewError instanceof Error
    ? previewError
    : new Error("GEX universe source unavailable.");
}

export function buildGexUniverseRefreshPlan(input: {
  scope: GexUniverseRefreshScope;
  symbols: readonly string[];
  snapshots?: readonly GexUniverseRefreshSnapshotRow[];
  jobs?: readonly GexUniverseRefreshJobRow[];
  inventoryAvailable?: boolean;
  inventoryUnavailableReason?: string | null;
  dryRun?: boolean;
  limit?: number;
  batchSize?: number;
  staleAfterMs?: number;
  now?: Date;
  sourceUniverse?: GexUniverseRefreshPlan["sourceUniverse"];
}): GexUniverseRefreshPlan {
  const now = input.now ?? new Date();
  const limit = normalizeGexUniverseLimit(input.limit);
  const batchSize = normalizeGexUniverseBatchSize(input.batchSize);
  const staleAfterMs = normalizePositiveInteger(
    input.staleAfterMs,
    DEFAULT_GEX_UNIVERSE_STALE_AFTER_MS,
    Number.MAX_SAFE_INTEGER,
  );
  const symbols = normalizeGexUniverseSymbols(input.symbols, limit);
  const snapshotsBySymbol = indexLatestSnapshots(input.snapshots ?? []);
  const jobsBySymbol = indexJobsBySymbol(input.jobs ?? []);
  const statusCounts = emptyStatusCounts();
  const symbolPlans = symbols.map((symbol): GexUniverseRefreshSymbolPlan => {
    const snapshot = snapshotsBySymbol.get(symbol) ?? null;
    const computedAt = snapshot ? toDate(snapshot.computedAt) : null;
    const ageMs = computedAt
      ? Math.max(0, now.getTime() - computedAt.getTime())
      : null;
    const jobs = jobsBySymbol.get(symbol) ?? [];
    const runningJobs = jobs.filter((row) => row.status === "running");
    const queuedJobs = jobs.filter((row) => row.status === "queued");
    const failedJobs = jobs.filter((row) => row.status === "failed");
    const permanentPrerequisiteFailures = failedJobs.filter((row) =>
      isRecentPermanentPrerequisiteFailure(row, now),
    );
    const activeJobs = [...runningJobs, ...queuedJobs];
    const hydration = resolveSymbolHydration({ snapshot, computedAt, now });
    let status: GexUniverseRefreshSymbolStatus;
    let eligible = false;
    let reason: string;

    if (runningJobs.length > 0) {
      status = "running";
      reason = "refresh_job_running";
    } else if (queuedJobs.length > 0) {
      status = "queued";
      reason = "refresh_job_queued";
    } else if (permanentPrerequisiteFailures.length > 0) {
      status = "failed";
      reason = "recent_permanent_prerequisite_failure";
    } else if (!computedAt && failedJobs.length > 0) {
      status = "failed";
      eligible = true;
      reason = "last_refresh_failed_without_snapshot";
    } else if (!computedAt) {
      status = "missing";
      eligible = true;
      reason = "gex_snapshot_missing";
    } else if (ageMs !== null && ageMs <= staleAfterMs) {
      status = "fresh";
      reason = "gex_snapshot_fresh";
    } else if (failedJobs.length > 0) {
      status = "failed";
      eligible = true;
      reason = "last_refresh_failed_after_stale_snapshot";
    } else {
      status = "stale";
      eligible = true;
      reason = "gex_snapshot_stale";
    }

    statusCounts[status] += 1;
    return {
      symbol,
      status,
      eligible,
      reason,
      computedAt: computedAt?.toISOString() ?? null,
      ageMs,
      sourceStatus: snapshot?.sourceStatus ?? null,
      optionCount: toFiniteNumber(snapshot?.optionCount),
      usableOptionCount: toFiniteNumber(snapshot?.usableOptionCount),
      activeJobKinds: jobKinds(activeJobs),
      failedJobKinds: jobKinds(failedJobs),
      lastError: latestJobError(failedJobs),
      hydration,
    };
  });
  const plannedSymbols = symbolPlans
    .filter((row) => row.eligible)
    .map((row) => row.symbol);
  const selectedSymbols = plannedSymbols.slice(0, batchSize);
  const hydration = symbolPlans.reduce(
    (summary, row) => {
      if (row.hydration.pagePopulated) summary.pagePopulatedCount += 1;
      if (row.hydration.pageComplete) summary.pageCompleteCount += 1;
      if (row.hydration.zeroGammaPayloadReady) {
        summary.zeroGammaPayloadReadyCount += 1;
      }
      if (row.hydration.zeroGammaLineReady) summary.zeroGammaLineReadyCount += 1;
      if (row.hydration.zeroGammaLineRenderable) {
        summary.zeroGammaLineRenderableCount += 1;
      }
      if (row.hydration.projectionOverlayReady) {
        summary.projectionOverlayReadyCount += 1;
      }
      return summary;
    },
    {
      pagePopulatedCount: 0,
      pageCompleteCount: 0,
      zeroGammaPayloadReadyCount: 0,
      zeroGammaLineReadyCount: 0,
      zeroGammaLineRenderableCount: 0,
      projectionOverlayReadyCount: 0,
    },
  );

  return {
    generatedAt: now.toISOString(),
    scope: input.scope,
    dryRun: input.dryRun ?? true,
    limit,
    batchSize,
    staleAfterMs,
    targetSymbolCount: symbols.length,
    eligibleSymbolCount: plannedSymbols.length,
    selectedSymbolCount: selectedSymbols.length,
    remainingEligibleSymbolCount: Math.max(
      0,
      plannedSymbols.length - selectedSymbols.length,
    ),
    statusCounts,
    plannedSymbols,
    selectedSymbols,
    symbols: symbolPlans,
    hydration,
    inventory: {
      available: input.inventoryAvailable ?? true,
      unavailableReason: input.inventoryUnavailableReason ?? null,
    },
    sourceUniverse: input.sourceUniverse ?? null,
  };
}

async function loadDbModule(): Promise<DbModule | null> {
  if (!isMarketDataIngestDatabaseConfigured()) {
    return null;
  }
  try {
    return (await import("@workspace/db")) as unknown as DbModule;
  } catch (error) {
    logger.debug({ err: error }, "GEX universe refresh database module unavailable");
    return null;
  }
}

export async function readGexUniverseFallbackSymbols(
  limitInput: number,
): Promise<GexUniverseFallbackUniverse | null> {
  const limit = normalizeGexUniverseLimit(limitInput);
  const dbModule = await loadDbModule();
  if (!dbModule) {
    return null;
  }

  try {
    const result = await dbModule.pool.query<{
      symbol: string;
      from_signal_monitor: boolean;
    }>(
      `
      with verified_symbols as (
        select
          u.normalized_ticker as symbol,
          max(f.previous_session_flow_score) as previous_session_flow_score,
          max(f.flow_score) as flow_score,
          max(f.dollar_volume) as dollar_volume
        from universe_catalog_listings u
        left join flow_universe_rankings f
          on f.symbol = u.normalized_ticker
        where u.active = true
          and u.ibkr_hydration_status = 'hydrated'
          and u.market in ('stocks', 'etf')
          and u.provider_contract_id ~ '^[0-9]+$'
          and coalesce(u.primary_exchange, '') <> 'OTC'
          and (
            coalesce(u.contract_meta->>'derivativeSecTypes', '') ~* '(^|,)\\s*OPT\\s*(,|$)'
            or u.contract_meta->>'optionabilityStatus' = 'verified'
            or u.contract_meta->'optionability'->>'status' = 'verified'
            or f.metadata->>'optionabilityStatus' = 'verified'
            or f.metadata->'optionability'->>'status' = 'verified'
          )
        group by u.normalized_ticker
      ),
      active_signal_symbols as (
        select distinct s.symbol
        from signal_monitor_symbol_states s
        inner join verified_symbols v
          on v.symbol = s.symbol
        where s.active = true
      ),
      latest_prerequisite_jobs as (
        select distinct on (symbol, kind)
          symbol,
          kind,
          status,
          updated_at
        from market_data_ingest_jobs
        where kind = 'option_chain_snapshot'
        order by symbol, kind, updated_at desc nulls last, created_at desc
      ),
      recently_failed_prerequisite_symbols as (
        select distinct symbol
        from latest_prerequisite_jobs
        where status = 'failed'
          and updated_at > now() - interval '1 day'
      )
      select
        v.symbol,
        (s.symbol is not null) as from_signal_monitor
      from verified_symbols v
      left join active_signal_symbols s
        on s.symbol = v.symbol
      left join recently_failed_prerequisite_symbols failed
        on failed.symbol = v.symbol
      where failed.symbol is null
      order by
        case when s.symbol is not null then 0 else 1 end,
        v.previous_session_flow_score desc nulls last,
        v.flow_score desc nulls last,
        v.dollar_volume desc nulls last,
        v.symbol asc
      limit $1
      `,
      [limit],
    );
    const symbols = normalizeGexUniverseSymbols(
      result.rows.map((row) => row.symbol),
      limit,
    );
    if (symbols.length === 0) {
      return null;
    }
    return {
      symbols,
      acceptedCount: symbols.length,
      importedCount: symbols.length,
      sourceStatus: result.rows.some((row) => row.from_signal_monitor)
        ? "signal_monitor_catalog_fallback"
        : "catalog_flow_fallback",
      generatedAt: new Date().toISOString(),
    };
  } catch (error) {
    logger.warn({ err: error }, "Failed to read GEX universe fallback symbols");
    return null;
  }
}

export async function readGexUniverseRefreshInventory(
  symbolsInput: string[],
): Promise<GexUniverseRefreshInventory> {
  const symbols = normalizeGexUniverseSymbols(
    symbolsInput,
    MAX_GEX_UNIVERSE_LIMIT,
  );
  if (symbols.length === 0) {
    return {
      available: true,
      unavailableReason: null,
      snapshots: [],
      jobs: [],
    };
  }

  const dbModule = await loadDbModule();
  if (!dbModule) {
    return {
      available: false,
      unavailableReason: "database_unconfigured",
      snapshots: [],
      jobs: [],
    };
  }

  try {
    const [snapshots, jobs] = await Promise.all([
      dbModule.pool.query<{
        symbol: string;
        computed_at: Date | string;
        source_status: string | null;
        option_count: number | string | null;
        usable_option_count: number | string | null;
        payload: unknown;
      }>(
        `
        select distinct on (symbol)
          symbol,
          computed_at,
          source_status,
          option_count,
          usable_option_count,
          payload
        from gex_snapshots
        where symbol = any($1::text[])
        order by symbol, computed_at desc
        `,
        [symbols],
      ),
      dbModule.pool.query<{
        symbol: string;
        kind: string;
        status: string;
        created_at: Date | string | null;
        updated_at: Date | string | null;
        last_error: string | null;
        dedupe_bucket: string | null;
      }>(
        `
        select
          symbol,
          kind,
          status,
          created_at,
          updated_at,
          last_error,
          nullif(payload->>'dedupeBucket', '') as dedupe_bucket
        from market_data_ingest_jobs
        where symbol = any($1::text[])
          and kind = any($2::text[])
          and status in ('queued', 'running', 'failed')
        order by symbol, updated_at desc
        `,
        [symbols, [...GEX_UNIVERSE_REFRESH_JOB_KINDS]],
      ),
    ]);

    return {
      available: true,
      unavailableReason: null,
      snapshots: snapshots.rows.map((row) => ({
        symbol: row.symbol,
        computedAt: row.computed_at,
        sourceStatus: row.source_status,
        optionCount: row.option_count,
        usableOptionCount: row.usable_option_count,
        payload: row.payload,
      })),
      jobs: jobs.rows.map((row) => ({
        symbol: row.symbol,
        kind: row.kind,
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        lastError: row.last_error,
        dedupeBucket: row.dedupe_bucket,
      })),
    };
  } catch (error) {
    logger.debug({ err: error }, "Failed to read GEX universe refresh inventory");
    return {
      available: false,
      unavailableReason: "database_error",
      snapshots: [],
      jobs: [],
    };
  }
}

async function enqueueGexUniverseRefreshJobs(input: {
  plan: GexUniverseRefreshPlan;
  reason: string;
  now: Date;
  enqueue: (
    jobs: EnqueueMarketDataJobInput[],
  ) => Promise<EnqueueMarketDataJobResult[]>;
}): Promise<{
  enqueuedJobCount: number;
  enqueueFailures: RefreshGexUniverseSnapshotsResult["enqueueFailures"];
}> {
  const dedupeBucket = Math.floor(input.now.getTime() / 60_000);
  const payload = {
    reason: input.reason,
    dedupeBucket,
    scope: input.plan.scope,
    refreshPlan: "gex_universe_refresh",
  };
  let enqueuedJobCount = 0;
  const enqueueFailures: RefreshGexUniverseSnapshotsResult["enqueueFailures"] = [];
  const jobs: EnqueueMarketDataJobInput[] = input.plan.selectedSymbols.flatMap(
    (symbol) =>
      GEX_UNIVERSE_REFRESH_JOB_KINDS.map((kind) => ({
        kind,
        symbol,
        priority: GEX_UNIVERSE_REFRESH_JOB_PRIORITIES[kind],
        payload,
      })),
  );

  // Single bulk enqueue holds at most one pool connection for the whole
  // refresh, instead of one connection per job via Promise.all.
  const results = await input.enqueue(jobs);
  for (let i = 0; i < jobs.length; i += 1) {
    const job = jobs[i]!;
    const result = results[i];
    if (result?.queued) {
      enqueuedJobCount += 1;
      continue;
    }
    enqueueFailures.push({
      symbol: job.symbol,
      kind: job.kind,
      reason: result?.reason ?? "enqueue_failed",
      dedupeKey: result?.dedupeKey ?? "",
    });
  }

  return { enqueuedJobCount, enqueueFailures };
}

export async function refreshGexUniverseSnapshots(
  input: RefreshGexUniverseSnapshotsInput = {},
  dependencies: RefreshGexUniverseSnapshotsDependencies = {},
): Promise<RefreshGexUniverseSnapshotsResult> {
  const now = input.now ?? new Date();
  const resolved = await resolveGexUniverseSymbols(input, dependencies);
  const inventory = dependencies.readInventory
    ? await dependencies.readInventory(resolved.symbols)
    : await readGexUniverseRefreshInventory(resolved.symbols);
  const plan = buildGexUniverseRefreshPlan({
    scope: resolved.scope,
    symbols: resolved.symbols,
    snapshots: inventory.snapshots,
    jobs: inventory.jobs,
    inventoryAvailable: inventory.available,
    inventoryUnavailableReason: inventory.unavailableReason,
    dryRun: input.dryRun ?? true,
    limit: resolved.limit,
    batchSize: input.batchSize,
    staleAfterMs: input.staleAfterMs,
    now,
    sourceUniverse: resolved.sourceUniverse,
  });

  if (plan.dryRun) {
    return {
      ...plan,
      enqueuedJobCount: 0,
      enqueueFailures: [],
    };
  }

  const enqueueResult = await enqueueGexUniverseRefreshJobs({
    plan,
    reason: input.reason?.trim() || "gex_universe_refresh",
    now,
    enqueue: dependencies.enqueueMarketDataJobs ?? enqueueMarketDataJobs,
  });

  return {
    ...plan,
    ...enqueueResult,
  };
}

export const __gexUniverseRefreshInternalsForTests = {
  DEFAULT_GEX_UNIVERSE_BATCH_SIZE,
  MAX_GEX_UNIVERSE_BATCH_SIZE,
  normalizeGexUniverseSymbols,
};
