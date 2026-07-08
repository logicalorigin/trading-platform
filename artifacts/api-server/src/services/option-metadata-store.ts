import {
  and,
  desc,
  eq,
  gte,
  inArray,
  like,
  not,
  or,
  sql,
} from "drizzle-orm";
import {
  algoDeploymentsTable,
  db,
  getPostgresDiagnosticContext,
  instrumentsTable,
  optionChainLatestTable,
  optionContractsTable,
  runWithPostgresDiagnosticContext,
} from "@workspace/db";
import { logger } from "../lib/logger";
import {
  createTransientPostgresBackoff,
  isPoolContentionError,
  isTransientPostgresError,
} from "../lib/transient-db-error";
import { normalizeSymbol } from "../lib/values";
import type { OptionChainContract } from "../providers/ibkr/client";
import { getApiResourcePressureSnapshot } from "./resource-pressure";
import { readPositiveIntegerEnv } from "../lib/env";

type DurableOptionMetadataCounters = {
  freshHit: number;
  staleHit: number;
  miss: number;
  writeSuccess: number;
  writeFailure: number;
  writeSkippedPressure: number;
  writeSkippedConcurrency: number;
  disabled: number;
  prunedRows: number;
};

export type DurableOptionMetadataDiagnostics = DurableOptionMetadataCounters & {
  disabled: number;
  disabledReason: string | null;
  activeBackoffs: Array<{
    scope: string;
    reason: string | null;
    failedUntilMs: number;
  }>;
  snapshotRetentionMs: number;
};

export type DurableOptionMetadataLoad<T> = {
  value: T;
  freshness: "fresh" | "stale";
  ageMs: number | null;
};

const counters: DurableOptionMetadataCounters = {
  freshHit: 0,
  staleHit: 0,
  miss: 0,
  writeSuccess: 0,
  writeFailure: 0,
  writeSkippedPressure: 0,
  writeSkippedConcurrency: 0,
  disabled: 0,
  prunedRows: 0,
};

type DurableOptionMetadataOperation =
  | "persist_option_chain"
  | "load_option_expirations"
  | "load_option_chain";

type DurableOptionMetadataBackoffEntry = {
  backoff: ReturnType<typeof createTransientPostgresBackoff>;
  reason: string | null;
};

const durableOptionMetadataBackoffs = new Map<
  string,
  DurableOptionMetadataBackoffEntry
>();

const OPTION_METADATA_SNAPSHOT_RETENTION_MS = readPositiveIntegerEnv(
  "OPTION_METADATA_SNAPSHOT_RETENTION_MS",
  24 * 60 * 60_000,
);

const OPTION_METADATA_QUERY_LIMIT = readPositiveIntegerEnv(
  "OPTION_METADATA_QUERY_LIMIT",
  5_000,
);
const OPTION_METADATA_DECISION_SOURCE_PREFIX = "signal-options:decision:";
const OPTION_METADATA_DECISION_PRUNE_INTERVAL_MS = readPositiveIntegerEnv(
  "OPTION_METADATA_DECISION_PRUNE_INTERVAL_MS",
  5 * 60_000,
);
const OPTION_METADATA_WRITE_MAX_CONCURRENCY = readPositiveIntegerEnv(
  "OPTION_METADATA_WRITE_MAX_CONCURRENCY",
  1,
);
const OPTION_METADATA_WRITE_BATCH_SIZE = readPositiveIntegerEnv(
  "OPTION_METADATA_WRITE_BATCH_SIZE",
  128,
);

let nextOptionMetadataDecisionPruneAtMs = 0;
const optionMetadataInstrumentIdCache = new Map<string, string>();
let activeOptionMetadataWrites = 0;

function runWithOptionMetadataContext<T>(
  workloadFamily: string,
  fn: () => Promise<T>,
): Promise<T> {
  if (getPostgresDiagnosticContext()) {
    return fn();
  }
  // Await `fn()` INSIDE the diagnostic scope — see runWithMarketDataStoreContext
  // in market-data-store.ts. The lazy drizzle thenable must be resolved while the
  // background context is active, or the query fires as null-context.
  return runWithPostgresDiagnosticContext(
    { routeClass: "background", workloadFamily },
    async () => fn(),
  );
}

export function __resetOptionMetadataInstrumentCacheForTests(): void {
  optionMetadataInstrumentIdCache.clear();
}

export function __getOptionMetadataInstrumentCacheSizeForTests(): number {
  return optionMetadataInstrumentIdCache.size;
}

function isDurableOptionMetadataEnvDisabled(): boolean {
  const value = process.env["OPTION_METADATA_DISABLED"]?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

function isDurableOptionMetadataDisabled(): boolean {
  return isDurableOptionMetadataEnvDisabled();
}

function shouldSkipDurableOptionMetadataWriteForPressure(): boolean {
  const snapshot = getApiResourcePressureSnapshot();
  if (snapshot.hardResourceLevel !== "normal") {
    return true;
  }
  const active = snapshot.inputs.dbPoolActive;
  const waiting = snapshot.inputs.dbPoolWaiting ?? 0;
  const max = snapshot.inputs.dbPoolMax;
  return (
    waiting > 0 ||
    (active !== null && max !== null && max > 0 && active >= max)
  );
}

function shouldContinueDurableOptionMetadataWrite(): boolean {
  if (!shouldSkipDurableOptionMetadataWriteForPressure()) {
    return true;
  }
  counters.writeSkippedPressure += 1;
  return false;
}

function claimDurableOptionMetadataWriteSlot(): boolean {
  if (activeOptionMetadataWrites >= OPTION_METADATA_WRITE_MAX_CONCURRENCY) {
    return false;
  }
  activeOptionMetadataWrites += 1;
  return true;
}

function releaseDurableOptionMetadataWriteSlot(): void {
  activeOptionMetadataWrites = Math.max(0, activeOptionMetadataWrites - 1);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "Durable option metadata store failed.";
}

function durableOptionMetadataScope(input: {
  operation: DurableOptionMetadataOperation;
  underlying?: string | null;
}): string {
  const underlying = normalizeSymbol(input.underlying ?? "");
  return `${input.operation}:${underlying || "all"}`;
}

function durableOptionMetadataBackoffEntry(
  scope: string,
): DurableOptionMetadataBackoffEntry {
  const existing = durableOptionMetadataBackoffs.get(scope);
  if (existing) {
    return existing;
  }
  const created = {
    backoff: createTransientPostgresBackoff(),
    reason: null,
  };
  durableOptionMetadataBackoffs.set(scope, created);
  return created;
}

function isDurableOptionMetadataBackoffActive(scope: string): boolean {
  const entry = durableOptionMetadataBackoffs.get(scope);
  if (!entry?.backoff.isActive(Date.now())) {
    return false;
  }
  counters.disabled += 1;
  return true;
}

function clearDurableOptionMetadataBackoff(scope: string): void {
  const entry = durableOptionMetadataBackoffs.get(scope);
  if (!entry) {
    return;
  }
  entry.backoff.clear();
  entry.reason = null;
}

function markDurableOptionMetadataFailure(
  error: unknown,
  input: {
    operation: DurableOptionMetadataOperation;
    underlying?: string | null;
  },
): void {
  if (!isTransientPostgresError(error)) {
    logger.debug(
      { err: error, operation: input.operation, underlying: input.underlying },
      "Durable option metadata store operation failed without scoped backoff",
    );
    return;
  }
  if (isPoolContentionError(error)) {
    // Pool saturation is transient backpressure, not a durable DB failure; don't
    // disable the scope (the next call retries instead of falling back).
    return;
  }

  const scope = durableOptionMetadataScope(input);
  const entry = durableOptionMetadataBackoffEntry(scope);
  entry.reason = `${input.operation}: ${getErrorMessage(error)}`;
  counters.disabled += 1;
  entry.backoff.markFailure({
    error,
    logger,
    message: "Durable option metadata store entered scoped database backoff",
    nowMs: Date.now(),
  });
}

function activeDurableOptionMetadataBackoffs(nowMs = Date.now()) {
  return Array.from(durableOptionMetadataBackoffs.entries())
    .map(([scope, entry]) => ({
      scope,
      reason: entry.reason,
      failedUntilMs: entry.backoff.snapshot().failedUntilMs,
      active: entry.backoff.isActive(nowMs),
    }))
    .filter((entry) => entry.active)
    .map(({ active: _active, ...entry }) => entry);
}

function optionChainUnderlyingFromContracts(
  contracts: OptionChainContract[],
): string | null {
  for (const contract of contracts) {
    const underlying = normalizeSymbol(contract.contract.underlying);
    if (underlying) {
      return underlying;
    }
  }
  return null;
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function integerOrNull(value: unknown): number | null {
  const parsed = numberOrNull(value);
  return parsed === null ? null : Math.trunc(parsed);
}

function decimalOrNull(value: number | null | undefined): string | null {
  return typeof value === "number" && Number.isFinite(value)
    ? String(value)
    : null;
}

function integerValueOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.trunc(value)
    : null;
}

function dateFromDb(value: unknown): Date | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value;
  }
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
  }
  return null;
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function normalizeOptionTicker(value: unknown): string | null {
  const normalized =
    typeof value === "string"
      ? value.trim().toUpperCase().replace(/\s+/g, "")
      : "";
  if (!normalized) {
    return null;
  }
  return normalized.startsWith("O:") ? normalized : `O:${normalized}`;
}

function buildMassiveOptionTicker(input: {
  ticker?: string | null;
  underlying: string;
  expirationDate: Date;
  strike: number;
  right: "call" | "put";
}): string | null {
  const existing = normalizeOptionTicker(input.ticker);
  if (existing && /^O:[A-Z0-9.-]+\d{6}[CP]\d{8}$/.test(existing)) {
    return existing;
  }

  const underlying = normalizeSymbol(input.underlying).replace(/[^A-Z0-9]/g, "");
  if (!underlying || !Number.isFinite(input.strike) || input.strike <= 0) {
    return null;
  }
  const expiration = input.expirationDate;
  if (Number.isNaN(expiration.getTime())) {
    return null;
  }

  const yy = String(expiration.getUTCFullYear()).slice(-2);
  const mm = String(expiration.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(expiration.getUTCDate()).padStart(2, "0");
  const side = input.right === "put" ? "P" : "C";
  const strike = String(Math.round(input.strike * 1000)).padStart(8, "0");
  return `O:${underlying}${yy}${mm}${dd}${side}${strike}`;
}

function normalizeOpraOptionTicker(value: unknown): string | null {
  const normalized =
    typeof value === "string"
      ? value.trim().toUpperCase().replace(/\s+/g, "")
      : "";
  if (!normalized) {
    return null;
  }

  const ticker = normalized.startsWith("O:") ? normalized : `O:${normalized}`;
  return /^O:[A-Z0-9.-]+\d{6}[CP]\d{8}$/.test(ticker) ? ticker : null;
}

function isOpraOptionTicker(value: unknown): boolean {
  return normalizeOpraOptionTicker(value) !== null;
}

function normalizeContractInput(contract: OptionChainContract): {
  underlying: string;
  massiveTicker: string;
  expirationDate: Date;
  expirationKey: string;
  strike: number;
  right: "call" | "put";
} | null {
  const underlying = normalizeSymbol(contract.contract.underlying);
  const expirationDate =
    contract.contract.expirationDate instanceof Date
      ? contract.contract.expirationDate
      : new Date(contract.contract.expirationDate);
  const strike = Number(contract.contract.strike);
  if (
    !underlying ||
    !Number.isFinite(expirationDate.getTime()) ||
    !Number.isFinite(strike)
  ) {
    return null;
  }
  const massiveTicker = buildMassiveOptionTicker({
    ticker: contract.contract.ticker,
    underlying,
    expirationDate,
    strike,
    right: contract.contract.right,
  });
  if (!massiveTicker) {
    return null;
  }
  return {
    underlying,
    massiveTicker,
    expirationDate,
    expirationKey: dateKey(expirationDate),
    strike,
    right: contract.contract.right,
  };
}

type OptionMetadataInstrumentInput = {
  symbol: string;
  assetClass: "equity" | "option";
  name?: string | null;
  underlyingSymbol?: string | null;
};

type SavedOptionContract = {
  contract: OptionChainContract;
  id: string;
  underlyingInstrumentId: string;
};

async function ensureInstruments(
  inputs: OptionMetadataInstrumentInput[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const missingBySymbol = new Map<
    string,
    OptionMetadataInstrumentInput & { symbol: string }
  >();
  for (const input of inputs) {
    const symbol = normalizeSymbol(input.symbol);
    if (!symbol) {
      continue;
    }
    const cached = optionMetadataInstrumentIdCache.get(symbol);
    if (cached) {
      out.set(symbol, cached);
      continue;
    }
    if (!missingBySymbol.has(symbol)) {
      missingBySymbol.set(symbol, { ...input, symbol });
    }
  }

  const missing = Array.from(missingBySymbol.values());
  if (!missing.length) {
    return out;
  }

  for (
    let index = 0;
    index < missing.length;
    index += OPTION_METADATA_WRITE_BATCH_SIZE
  ) {
    if (!shouldContinueDurableOptionMetadataWrite()) {
      break;
    }
    const batch = missing.slice(index, index + OPTION_METADATA_WRITE_BATCH_SIZE);
    await runWithOptionMetadataContext("option-metadata-instrument", () =>
      db
        .insert(instrumentsTable)
        .values(
          batch.map((input) => ({
            symbol: input.symbol,
            assetClass: input.assetClass,
            name: input.name?.trim() || input.symbol,
            underlyingSymbol: input.underlyingSymbol
              ? normalizeSymbol(input.underlyingSymbol)
              : null,
            currency: "USD",
            isActive: true,
          })),
        )
        .onConflictDoNothing({ target: instrumentsTable.symbol }),
    );

    const rows = await runWithOptionMetadataContext(
      "option-metadata-instrument",
      () =>
        db
          .select({ id: instrumentsTable.id, symbol: instrumentsTable.symbol })
          .from(instrumentsTable)
          .where(
            inArray(
              instrumentsTable.symbol,
              batch.map((input) => input.symbol),
            ),
          ),
    );
    for (const row of rows) {
      const symbol = normalizeSymbol(row.symbol);
      if (!symbol) {
        continue;
      }
      optionMetadataInstrumentIdCache.set(symbol, row.id);
      out.set(symbol, row.id);
    }
  }
  return out;
}

async function ensureInstrument(
  input: OptionMetadataInstrumentInput,
): Promise<string | null> {
  const symbol = normalizeSymbol(input.symbol);
  if (!symbol) {
    return null;
  }
  return (await ensureInstruments([input])).get(symbol) ?? null;
}

async function upsertOptionContract(
  contract: OptionChainContract,
): Promise<{ id: string; underlyingInstrumentId: string } | null> {
  const normalized = normalizeContractInput(contract);
  if (!normalized) {
    return null;
  }

  const underlyingInstrumentId = await ensureInstrument({
    symbol: normalized.underlying,
    assetClass: "equity",
    name: normalized.underlying,
  });
  const optionInstrumentId = await ensureInstrument({
    symbol: normalized.massiveTicker,
    assetClass: "option",
    name: normalized.massiveTicker,
    underlyingSymbol: normalized.underlying,
  });
  if (!underlyingInstrumentId || !optionInstrumentId) {
    return null;
  }

  const rawProviderContractId =
    contract.contract.providerContractId?.trim?.() || null;
  const providerContractId =
    normalizeOpraOptionTicker(rawProviderContractId) ??
    normalized.massiveTicker;
  const brokerContractId =
    rawProviderContractId && !isOpraOptionTicker(rawProviderContractId)
      ? rawProviderContractId
      : null;
  const existingConditions = brokerContractId
    ? or(
        eq(optionContractsTable.massiveTicker, normalized.massiveTicker),
        eq(optionContractsTable.providerContractId, providerContractId),
        eq(optionContractsTable.brokerContractId, brokerContractId),
      )
    : or(
        eq(optionContractsTable.massiveTicker, normalized.massiveTicker),
        eq(optionContractsTable.providerContractId, providerContractId),
      );
  const [existing] = await runWithOptionMetadataContext(
    "option-metadata-contract",
    () =>
      db
        .select({ id: optionContractsTable.id })
        .from(optionContractsTable)
        .where(existingConditions)
        .limit(1),
  );

  if (existing?.id) {
    await runWithOptionMetadataContext("option-metadata-contract", () =>
      db
        .update(optionContractsTable)
        .set({
          instrumentId: optionInstrumentId,
          underlyingInstrumentId,
          massiveTicker: normalized.massiveTicker,
          providerContractId,
          brokerContractId,
          expirationDate: normalized.expirationKey,
          strike: String(normalized.strike),
          right: normalized.right,
          multiplier: Math.max(1, Math.trunc(contract.contract.multiplier || 100)),
          sharesPerContract: Math.max(
            1,
            Math.trunc(contract.contract.sharesPerContract || 100),
          ),
          isActive: true,
          updatedAt: new Date(),
        })
        .where(eq(optionContractsTable.id, existing.id)),
    );
    return { id: existing.id, underlyingInstrumentId };
  }

  const [created] = await runWithOptionMetadataContext(
    "option-metadata-contract",
    () =>
      db
        .insert(optionContractsTable)
        .values({
          instrumentId: optionInstrumentId,
          underlyingInstrumentId,
          massiveTicker: normalized.massiveTicker,
          providerContractId,
          brokerContractId,
          expirationDate: normalized.expirationKey,
          strike: String(normalized.strike),
          right: normalized.right,
          multiplier: Math.max(1, Math.trunc(contract.contract.multiplier || 100)),
          sharesPerContract: Math.max(
            1,
            Math.trunc(contract.contract.sharesPerContract || 100),
          ),
          isActive: true,
        })
        .returning({ id: optionContractsTable.id }),
  );

  return created?.id ? { id: created.id, underlyingInstrumentId } : null;
}

function optionContractIdentifiers(
  contract: OptionChainContract,
  normalized: NonNullable<ReturnType<typeof normalizeContractInput>>,
): {
  providerContractId: string;
  brokerContractId: string | null;
} {
  const rawProviderContractId =
    contract.contract.providerContractId?.trim?.() || null;
  return {
    providerContractId:
      normalizeOpraOptionTicker(rawProviderContractId) ?? normalized.massiveTicker,
    brokerContractId:
      rawProviderContractId && !isOpraOptionTicker(rawProviderContractId)
        ? rawProviderContractId
        : null,
  };
}

function isOptionContractBatchConflict(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /duplicate key|unique constraint|violates.*constraint/i.test(message);
}

async function upsertOptionContracts(
  contracts: OptionChainContract[],
): Promise<SavedOptionContract[]> {
  const normalizedItems = contracts
    .map((contract) => {
      const normalized = normalizeContractInput(contract);
      return normalized ? { contract, normalized } : null;
    })
    .filter(
      (item): item is {
        contract: OptionChainContract;
        normalized: NonNullable<ReturnType<typeof normalizeContractInput>>;
      } => item !== null,
    );
  if (!normalizedItems.length) {
    return [];
  }

  const instrumentIds = await ensureInstruments(
    normalizedItems.flatMap(({ normalized }) => [
      {
        symbol: normalized.underlying,
        assetClass: "equity" as const,
        name: normalized.underlying,
      },
      {
        symbol: normalized.massiveTicker,
        assetClass: "option" as const,
        name: normalized.massiveTicker,
        underlyingSymbol: normalized.underlying,
      },
    ]),
  );

  type PreparedOptionContract = {
    contract: OptionChainContract;
    normalized: NonNullable<ReturnType<typeof normalizeContractInput>>;
    underlyingInstrumentId: string;
    optionInstrumentId: string;
    providerContractId: string;
    brokerContractId: string | null;
    multiplier: number;
    sharesPerContract: number;
  };

  const prepared: PreparedOptionContract[] = normalizedItems
    .map(({ contract, normalized }) => {
      const underlyingInstrumentId = instrumentIds.get(normalized.underlying);
      const optionInstrumentId = instrumentIds.get(normalized.massiveTicker);
      if (!underlyingInstrumentId || !optionInstrumentId) {
        return null;
      }
      const { providerContractId, brokerContractId } = optionContractIdentifiers(
        contract,
        normalized,
      );
      return {
        contract,
        normalized,
        underlyingInstrumentId,
        optionInstrumentId,
        providerContractId,
        brokerContractId,
        multiplier: Math.max(1, Math.trunc(contract.contract.multiplier || 100)),
        sharesPerContract: Math.max(
          1,
          Math.trunc(contract.contract.sharesPerContract || 100),
        ),
      };
    })
    .filter((item): item is PreparedOptionContract => item !== null);
  if (!prepared.length) {
    return [];
  }

  const latestByTicker = new Map<string, (typeof prepared)[number]>();
  for (const item of prepared) {
    latestByTicker.set(item.normalized.massiveTicker, item);
  }
  const values = Array.from(latestByTicker.values()).map((item) => ({
    instrumentId: item.optionInstrumentId,
    underlyingInstrumentId: item.underlyingInstrumentId,
    massiveTicker: item.normalized.massiveTicker,
    providerContractId: item.providerContractId,
    brokerContractId: item.brokerContractId,
    expirationDate: item.normalized.expirationKey,
    strike: String(item.normalized.strike),
    right: item.normalized.right,
    multiplier: item.multiplier,
    sharesPerContract: item.sharesPerContract,
    isActive: true,
  }));

  const rows: Array<{
    id: string;
    massiveTicker: string;
    underlyingInstrumentId: string;
  }> = [];
  try {
    for (
      let index = 0;
      index < values.length;
      index += OPTION_METADATA_WRITE_BATCH_SIZE
    ) {
      if (!shouldContinueDurableOptionMetadataWrite()) {
        break;
      }
      const batch = values.slice(index, index + OPTION_METADATA_WRITE_BATCH_SIZE);
      rows.push(
        ...(await runWithOptionMetadataContext("option-metadata-contract", () =>
          db
            .insert(optionContractsTable)
            .values(batch)
            .onConflictDoUpdate({
              target: optionContractsTable.massiveTicker,
              set: {
                instrumentId: sql`excluded.instrument_id`,
                underlyingInstrumentId: sql`excluded.underlying_instrument_id`,
                providerContractId: sql`excluded.provider_contract_id`,
                brokerContractId: sql`excluded.broker_contract_id`,
                expirationDate: sql`excluded.expiration_date`,
                strike: sql`excluded.strike`,
                right: sql`excluded.right`,
                multiplier: sql`excluded.multiplier`,
                sharesPerContract: sql`excluded.shares_per_contract`,
                isActive: true,
                updatedAt: sql`now()`,
              },
            })
            .returning({
              id: optionContractsTable.id,
              massiveTicker: optionContractsTable.massiveTicker,
              underlyingInstrumentId: optionContractsTable.underlyingInstrumentId,
            }),
        )),
      );
    }
  } catch (error) {
    if (!isOptionContractBatchConflict(error)) {
      throw error;
    }
    logger.debug(
      { err: error },
      "Durable option metadata batch upsert hit an alias conflict; falling back to per-contract reconciliation",
    );
    const fallbackRows: SavedOptionContract[] = [];
    for (const contract of contracts) {
      if (!shouldContinueDurableOptionMetadataWrite()) {
        break;
      }
      const saved = await upsertOptionContract(contract);
      if (saved) {
        fallbackRows.push({ contract, ...saved });
      }
    }
    return fallbackRows;
  }

  const rowsByTicker = new Map(rows.map((row) => [row.massiveTicker, row]));
  return prepared
    .map((item) => {
      const row = rowsByTicker.get(item.normalized.massiveTicker);
      return row
        ? {
            contract: item.contract,
            id: row.id,
            underlyingInstrumentId: row.underlyingInstrumentId,
          }
        : null;
    })
    .filter(
      (item): item is SavedOptionContract => item !== null,
    );
}

function hasSnapshotFields(contract: OptionChainContract): boolean {
  return [
    contract.bid,
    contract.ask,
    contract.last,
    contract.mark,
    contract.impliedVolatility,
    contract.delta,
    contract.gamma,
    contract.theta,
    contract.vega,
    contract.openInterest,
    contract.volume,
  ].some((value) => value !== null && value !== undefined);
}

async function pruneObsoleteLatestDecisionSnapshots(
  nowMs = Date.now(),
): Promise<void> {
  if (nowMs < nextOptionMetadataDecisionPruneAtMs) {
    return;
  }
  nextOptionMetadataDecisionPruneAtMs =
    nowMs + OPTION_METADATA_DECISION_PRUNE_INTERVAL_MS;

  const activeDeploymentRows = await runWithOptionMetadataContext(
    "option-metadata-prune",
    () =>
      db
        .select({ id: algoDeploymentsTable.id })
        .from(algoDeploymentsTable)
        .where(eq(algoDeploymentsTable.enabled, true)),
  );
  const activeDecisionSources = activeDeploymentRows.map(
    (row) => `${OPTION_METADATA_DECISION_SOURCE_PREFIX}${row.id}`,
  );
  const obsoleteDecisionSourceFilter =
    activeDecisionSources.length > 0
      ? and(
          like(
            optionChainLatestTable.source,
            `${OPTION_METADATA_DECISION_SOURCE_PREFIX}%`,
          ),
          not(inArray(optionChainLatestTable.source, activeDecisionSources)),
        )
      : like(
          optionChainLatestTable.source,
          `${OPTION_METADATA_DECISION_SOURCE_PREFIX}%`,
        );
  const deleted = await runWithOptionMetadataContext(
    "option-metadata-prune",
    () =>
      db
        .delete(optionChainLatestTable)
        .where(obsoleteDecisionSourceFilter)
        .returning({ id: optionChainLatestTable.id }),
  );
  counters.prunedRows += deleted.length;
}

async function pruneObsoleteLatestDecisionSnapshotsBestEffort(): Promise<void> {
  try {
    await pruneObsoleteLatestDecisionSnapshots();
  } catch (error) {
    logger.debug(
      { err: error },
      "Durable option metadata latest cleanup skipped after database error",
    );
  }
}

export async function persistDurableOptionChain(input: {
  contracts: OptionChainContract[];
  source?: string;
  asOf?: Date;
}): Promise<void> {
  const underlying = optionChainUnderlyingFromContracts(input.contracts);
  const scope = durableOptionMetadataScope({
    operation: "persist_option_chain",
    underlying,
  });
  if (
    isDurableOptionMetadataDisabled() ||
    isDurableOptionMetadataBackoffActive(scope) ||
    input.contracts.length === 0
  ) {
    return;
  }
  if (!shouldContinueDurableOptionMetadataWrite()) {
    return;
  }
  if (!claimDurableOptionMetadataWriteSlot()) {
    counters.writeSkippedConcurrency += 1;
    return;
  }

  try {
    const asOf = input.asOf ?? new Date();
    const snapshotRows = [];
    const savedContracts = await upsertOptionContracts(input.contracts);
    for (const savedContract of savedContracts) {
      if (!hasSnapshotFields(savedContract.contract)) {
        continue;
      }
      snapshotRows.push({
        underlyingInstrumentId: savedContract.underlyingInstrumentId,
        optionContractId: savedContract.id,
        bid: decimalOrNull(savedContract.contract.bid),
        ask: decimalOrNull(savedContract.contract.ask),
        last: decimalOrNull(savedContract.contract.last),
        mark: decimalOrNull(savedContract.contract.mark),
        impliedVolatility: decimalOrNull(
          savedContract.contract.impliedVolatility,
        ),
        delta: decimalOrNull(savedContract.contract.delta),
        gamma: decimalOrNull(savedContract.contract.gamma),
        theta: decimalOrNull(savedContract.contract.theta),
        vega: decimalOrNull(savedContract.contract.vega),
        openInterest: integerValueOrNull(savedContract.contract.openInterest),
        volume: integerValueOrNull(savedContract.contract.volume),
        source: input.source ?? "ibkr",
        asOf,
      });
    }

    for (
      let index = 0;
      index < snapshotRows.length;
      index += OPTION_METADATA_WRITE_BATCH_SIZE
    ) {
      if (!shouldContinueDurableOptionMetadataWrite()) {
        break;
      }
      const values = snapshotRows.slice(
        index,
        index + OPTION_METADATA_WRITE_BATCH_SIZE,
      );
      if (!values.length) {
        continue;
      }
      // One source/asOf can include duplicate contracts; a single Postgres
      // upsert statement cannot update the same conflict target twice.
      const upsertValues = [
        ...new Map(values.map((row) => [row.optionContractId, row])).values(),
      ];
      await runWithOptionMetadataContext("option-metadata-snapshot-write", () =>
        db
          .insert(optionChainLatestTable)
          .values(upsertValues)
          .onConflictDoUpdate({
            target: [
              optionChainLatestTable.optionContractId,
              optionChainLatestTable.source,
            ],
            set: {
              bid: sql`excluded.bid`,
              ask: sql`excluded.ask`,
              last: sql`excluded.last`,
              mark: sql`excluded.mark`,
              impliedVolatility: sql`excluded.implied_volatility`,
              delta: sql`excluded.delta`,
              gamma: sql`excluded.gamma`,
              theta: sql`excluded.theta`,
              vega: sql`excluded.vega`,
              openInterest: sql`excluded.open_interest`,
              volume: sql`excluded.volume`,
              asOf: sql`excluded.as_of`,
              updatedAt: sql`now()`,
            },
            setWhere: sql`excluded.as_of >= ${optionChainLatestTable.asOf}`,
          }),
      );
    }
    if (snapshotRows.length > 0) {
      await pruneObsoleteLatestDecisionSnapshotsBestEffort();
    }
    clearDurableOptionMetadataBackoff(scope);
    counters.writeSuccess += 1;
  } catch (error) {
    counters.writeFailure += 1;
    markDurableOptionMetadataFailure(error, {
      operation: "persist_option_chain",
      underlying,
    });
  } finally {
    releaseDurableOptionMetadataWriteSlot();
  }
}

async function getUnderlyingInstrumentId(
  underlyingInput: string,
): Promise<string | null> {
  const underlying = normalizeSymbol(underlyingInput);
  if (!underlying || isDurableOptionMetadataDisabled()) {
    return null;
  }
  const [instrument] = await runWithOptionMetadataContext(
    "option-metadata-instrument",
    () =>
      db
        .select({ id: instrumentsTable.id })
        .from(instrumentsTable)
        .where(eq(instrumentsTable.symbol, underlying))
        .limit(1),
  );
  return instrument?.id ?? null;
}

function classifyFreshness(input: {
  ageMs: number | null;
  maxAgeMs: number;
  staleMaxAgeMs: number;
}): "fresh" | "stale" | null {
  if (input.ageMs === null) {
    return "stale";
  }
  if (input.ageMs <= input.maxAgeMs) {
    return "fresh";
  }
  if (input.ageMs <= input.staleMaxAgeMs) {
    return "stale";
  }
  return null;
}

function recordLoadResult<T>(
  result: DurableOptionMetadataLoad<T> | null,
): DurableOptionMetadataLoad<T> | null {
  if (!result) {
    counters.miss += 1;
    return null;
  }
  if (result.freshness === "fresh") {
    counters.freshHit += 1;
  } else {
    counters.staleHit += 1;
  }
  return result;
}

export async function loadDurableOptionExpirations(input: {
  underlying: string;
  maxExpirations?: number;
  maxAgeMs: number;
  staleMaxAgeMs: number;
  now?: Date;
}): Promise<DurableOptionMetadataLoad<Date[]> | null> {
  const underlying = normalizeSymbol(input.underlying);
  const scope = durableOptionMetadataScope({
    operation: "load_option_expirations",
    underlying,
  });
  if (
    isDurableOptionMetadataDisabled() ||
    isDurableOptionMetadataBackoffActive(scope)
  ) {
    counters.miss += 1;
    return null;
  }

  try {
    const underlyingInstrumentId = await getUnderlyingInstrumentId(underlying);
    if (!underlyingInstrumentId) {
      clearDurableOptionMetadataBackoff(scope);
      return recordLoadResult<Date[]>(null);
    }

    const rows = await runWithOptionMetadataContext(
      "option-metadata-read",
      () =>
        db
          .select({
            expirationDate: optionContractsTable.expirationDate,
            updatedAt: optionContractsTable.updatedAt,
          })
          .from(optionContractsTable)
          .where(
            and(
              eq(optionContractsTable.underlyingInstrumentId, underlyingInstrumentId),
              eq(optionContractsTable.isActive, true),
              // Only current/future expirations. Contracts are never deactivated, so
              // expired rows accumulate forever; without this filter, ORDER BY
              // expiration_date ASC LIMIT N returns the OLDEST (expired) rows and the
              // downstream today+ filter drops them all -> empty load -> cache miss ->
              // slow bridge metadata hot path. (option_contracts grows unbounded.)
              gte(
                optionContractsTable.expirationDate,
                dateKey(input.now ?? new Date()),
              ),
            ),
          )
          .orderBy(optionContractsTable.expirationDate)
          .limit(OPTION_METADATA_QUERY_LIMIT),
    );

    const todayKey = dateKey(input.now ?? new Date());
    const expirations = Array.from(
      new Map(
        rows
          .map((row) => dateFromDb(row.expirationDate))
          .filter((date): date is Date => Boolean(date))
          .filter((date) => dateKey(date) >= todayKey)
          .map((date) => [dateKey(date), date] as const),
      ).values(),
    ).sort((left, right) => left.getTime() - right.getTime());

    if (!expirations.length) {
      return recordLoadResult<Date[]>(null);
    }

    const latestUpdatedAt = rows
      .map((row) => dateFromDb(row.updatedAt))
      .filter((date): date is Date => Boolean(date))
      .sort((left, right) => right.getTime() - left.getTime())[0] ?? null;
    const ageMs = latestUpdatedAt
      ? Math.max(0, Date.now() - latestUpdatedAt.getTime())
      : null;
    const freshness = classifyFreshness({
      ageMs,
      maxAgeMs: input.maxAgeMs,
      staleMaxAgeMs: input.staleMaxAgeMs,
    });
    if (!freshness) {
      return recordLoadResult<Date[]>(null);
    }

    const value =
      typeof input.maxExpirations === "number" && input.maxExpirations > 0
        ? expirations.slice(0, Math.floor(input.maxExpirations))
        : expirations;
    clearDurableOptionMetadataBackoff(scope);
    return recordLoadResult({ value, freshness, ageMs });
  } catch (error) {
    markDurableOptionMetadataFailure(error, {
      operation: "load_option_expirations",
      underlying,
    });
    return null;
  }
}

export async function loadDurableOptionChain(input: {
  underlying: string;
  expirationDate?: Date;
  contractType?: "call" | "put";
  maxExpirations?: number;
  maxAgeMs: number;
  staleMaxAgeMs: number;
  now?: Date;
}): Promise<DurableOptionMetadataLoad<OptionChainContract[]> | null> {
  const underlying = normalizeSymbol(input.underlying);
  const scope = durableOptionMetadataScope({
    operation: "load_option_chain",
    underlying,
  });
  if (
    isDurableOptionMetadataDisabled() ||
    isDurableOptionMetadataBackoffActive(scope)
  ) {
    counters.miss += 1;
    return null;
  }

  try {
    const underlyingInstrumentId = await getUnderlyingInstrumentId(underlying);
    if (!underlyingInstrumentId) {
      clearDurableOptionMetadataBackoff(scope);
      return recordLoadResult<OptionChainContract[]>(null);
    }

    const rows = await runWithOptionMetadataContext(
      "option-metadata-read",
      () =>
        db
          .select({
            id: optionContractsTable.id,
            massiveTicker: optionContractsTable.massiveTicker,
            providerContractId: optionContractsTable.providerContractId,
            brokerContractId: optionContractsTable.brokerContractId,
            expirationDate: optionContractsTable.expirationDate,
            strike: optionContractsTable.strike,
            right: optionContractsTable.right,
            multiplier: optionContractsTable.multiplier,
            sharesPerContract: optionContractsTable.sharesPerContract,
            updatedAt: optionContractsTable.updatedAt,
          })
          .from(optionContractsTable)
          .where(
            and(
              eq(optionContractsTable.underlyingInstrumentId, underlyingInstrumentId),
              eq(optionContractsTable.isActive, true),
              // Current/future expirations only - see loadDurableOptionExpirations.
              // Without this, the LIMIT window fills with expired contracts and the
              // today+ filter empties the result -> cache miss -> bridge hot path.
              gte(
                optionContractsTable.expirationDate,
                dateKey(input.now ?? new Date()),
              ),
            ),
          )
          .orderBy(
            optionContractsTable.expirationDate,
            optionContractsTable.strike,
            optionContractsTable.right,
          )
          .limit(OPTION_METADATA_QUERY_LIMIT),
    );

    const todayKey = dateKey(input.now ?? new Date());
    const expirationFilter = input.expirationDate
      ? dateKey(input.expirationDate)
      : null;
    const allowedExpirations = new Set(
      Array.from(
        new Set(
          rows
            .map((row) => dateFromDb(row.expirationDate))
            .filter((date): date is Date => Boolean(date))
            .filter((date) => dateKey(date) >= todayKey)
            .map(dateKey),
        ),
      )
        .sort()
        .slice(
          0,
          typeof input.maxExpirations === "number" && input.maxExpirations > 0
            ? Math.floor(input.maxExpirations)
            : undefined,
        ),
    );

    const filteredRows = rows.filter((row) => {
      const expirationDate = dateFromDb(row.expirationDate);
      if (!expirationDate) {
        return false;
      }
      const key = dateKey(expirationDate);
      if (expirationFilter && key !== expirationFilter) {
        return false;
      }
      if (!expirationFilter && !allowedExpirations.has(key)) {
        return false;
      }
      if (input.contractType && row.right !== input.contractType) {
        return false;
      }
      return true;
    });
    if (!filteredRows.length) {
      return recordLoadResult<OptionChainContract[]>(null);
    }

    const snapshotsByContractId = new Map<
      string,
      {
        bid: unknown;
        ask: unknown;
        last: unknown;
        mark: unknown;
        impliedVolatility: unknown;
        delta: unknown;
        gamma: unknown;
        theta: unknown;
        vega: unknown;
        openInterest: unknown;
        volume: unknown;
        asOf: Date;
      }
    >();
    for (let index = 0; index < filteredRows.length; index += 500) {
      const contractIds = filteredRows.slice(index, index + 500).map((row) => row.id);
      const snapshotRows = await runWithOptionMetadataContext(
        "option-metadata-snapshot-read",
        () =>
          db
            .select({
              optionContractId: optionChainLatestTable.optionContractId,
              bid: optionChainLatestTable.bid,
              ask: optionChainLatestTable.ask,
              last: optionChainLatestTable.last,
              mark: optionChainLatestTable.mark,
              impliedVolatility: optionChainLatestTable.impliedVolatility,
              delta: optionChainLatestTable.delta,
              gamma: optionChainLatestTable.gamma,
              theta: optionChainLatestTable.theta,
              vega: optionChainLatestTable.vega,
              openInterest: optionChainLatestTable.openInterest,
              volume: optionChainLatestTable.volume,
              asOf: optionChainLatestTable.asOf,
            })
            .from(optionChainLatestTable)
            .where(
              and(
                inArray(optionChainLatestTable.optionContractId, contractIds),
                gte(
                  optionChainLatestTable.asOf,
                  new Date(Date.now() - input.staleMaxAgeMs),
                ),
              ),
            )
            .orderBy(desc(optionChainLatestTable.asOf))
            .limit(contractIds.length * 8),
      );

      for (const snapshot of snapshotRows) {
        if (!snapshotsByContractId.has(snapshot.optionContractId)) {
          snapshotsByContractId.set(snapshot.optionContractId, snapshot);
        }
      }
    }

    let newestDataAtMs: number | null = null;
    const contracts = filteredRows.flatMap((row): OptionChainContract[] => {
      const expirationDate = dateFromDb(row.expirationDate);
      if (!expirationDate) {
        return [];
      }
      const snapshot = snapshotsByContractId.get(row.id) ?? null;
      const updatedAt =
        snapshot?.asOf ?? dateFromDb(row.updatedAt) ?? new Date(0);
      const updatedAtMs = updatedAt.getTime();
      if (newestDataAtMs === null || updatedAtMs > newestDataAtMs) {
        newestDataAtMs = updatedAtMs;
      }
      const ageMs = Math.max(0, Date.now() - updatedAt.getTime());
      const providerContractId =
        normalizeOpraOptionTicker(row.providerContractId) ??
        normalizeOpraOptionTicker(row.massiveTicker) ??
        row.massiveTicker;
      const brokerContractId =
        row.brokerContractId ??
        (row.providerContractId && !isOpraOptionTicker(row.providerContractId)
          ? row.providerContractId
          : null);
      return [
        {
          contract: {
            ticker: row.massiveTicker,
            underlying,
            expirationDate,
            strike: numberOrNull(row.strike) ?? 0,
            right: row.right,
            multiplier: row.multiplier ?? 100,
            sharesPerContract: row.sharesPerContract ?? 100,
            providerContractId,
            brokerContractId,
          },
          bid: numberOrNull(snapshot?.bid),
          ask: numberOrNull(snapshot?.ask),
          last: numberOrNull(snapshot?.last),
          mark: numberOrNull(snapshot?.mark),
          impliedVolatility: numberOrNull(snapshot?.impliedVolatility),
          delta: numberOrNull(snapshot?.delta),
          gamma: numberOrNull(snapshot?.gamma),
          theta: numberOrNull(snapshot?.theta),
          vega: numberOrNull(snapshot?.vega),
          openInterest: integerOrNull(snapshot?.openInterest),
          volume: integerOrNull(snapshot?.volume),
          updatedAt,
          quoteFreshness: "metadata",
          marketDataMode: null,
          quoteUpdatedAt: snapshot?.asOf ?? null,
          dataUpdatedAt: snapshot?.asOf ?? updatedAt,
          ageMs,
          underlyingPrice: null,
        },
      ];
    });
    if (!contracts.length) {
      return recordLoadResult<OptionChainContract[]>(null);
    }

    const ageMs =
      newestDataAtMs !== null ? Math.max(0, Date.now() - newestDataAtMs) : null;
    const freshness = classifyFreshness({
      ageMs,
      maxAgeMs: input.maxAgeMs,
      staleMaxAgeMs: input.staleMaxAgeMs,
    });
    if (!freshness) {
      return recordLoadResult<OptionChainContract[]>(null);
    }
    clearDurableOptionMetadataBackoff(scope);
    return recordLoadResult({ value: contracts, freshness, ageMs });
  } catch (error) {
    markDurableOptionMetadataFailure(error, {
      operation: "load_option_chain",
      underlying,
    });
    return null;
  }
}

export function getDurableOptionMetadataDiagnostics(): DurableOptionMetadataDiagnostics {
  const envDisabled = isDurableOptionMetadataEnvDisabled();
  const activeBackoffs = activeDurableOptionMetadataBackoffs();
  const activeBackoffReason =
    activeBackoffs.map((entry) => entry.reason).filter(Boolean)[0] ?? null;
  return {
    ...counters,
    disabled:
      envDisabled || activeBackoffs.length
        ? counters.disabled || activeBackoffs.length || 1
        : 0,
    disabledReason: envDisabled
      ? "OPTION_METADATA_DISABLED"
      : activeBackoffReason,
    activeBackoffs,
    snapshotRetentionMs: OPTION_METADATA_SNAPSHOT_RETENTION_MS,
  };
}

export function __resetDurableOptionMetadataStoreForTests(): void {
  durableOptionMetadataBackoffs.clear();
  counters.freshHit = 0;
  counters.staleHit = 0;
  counters.miss = 0;
  counters.writeSuccess = 0;
  counters.writeFailure = 0;
  counters.writeSkippedPressure = 0;
  counters.writeSkippedConcurrency = 0;
  counters.disabled = 0;
  counters.prunedRows = 0;
  nextOptionMetadataDecisionPruneAtMs = 0;
  activeOptionMetadataWrites = 0;
}
