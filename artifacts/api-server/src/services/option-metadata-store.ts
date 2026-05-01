import {
  and,
  desc,
  eq,
  gte,
  inArray,
  lt,
  or,
} from "drizzle-orm";
import {
  db,
  instrumentsTable,
  optionChainSnapshotsTable,
  optionContractsTable,
} from "@workspace/db";
import { logger } from "../lib/logger";
import { normalizeSymbol } from "../lib/values";
import type { OptionChainContract } from "../providers/ibkr/client";

type DurableOptionMetadataCounters = {
  freshHit: number;
  staleHit: number;
  miss: number;
  writeSuccess: number;
  writeFailure: number;
  disabled: number;
  prunedRows: number;
};

export type DurableOptionMetadataDiagnostics = DurableOptionMetadataCounters & {
  disabled: number;
  disabledReason: string | null;
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
  disabled: 0,
  prunedRows: 0,
};

let durableOptionMetadataDisabled = false;
let disabledReason: string | null = null;

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const OPTION_METADATA_SNAPSHOT_RETENTION_MS = readPositiveIntegerEnv(
  "OPTION_METADATA_SNAPSHOT_RETENTION_MS",
  24 * 60 * 60_000,
);

const OPTION_METADATA_QUERY_LIMIT = readPositiveIntegerEnv(
  "OPTION_METADATA_QUERY_LIMIT",
  5_000,
);

function isDurableOptionMetadataEnvDisabled(): boolean {
  const value = process.env["OPTION_METADATA_DISABLED"]?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

function isDurableOptionMetadataDisabled(): boolean {
  return durableOptionMetadataDisabled || isDurableOptionMetadataEnvDisabled();
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "Durable option metadata store failed.";
}

function disableAfterError(error: unknown, operation: string): void {
  durableOptionMetadataDisabled = true;
  disabledReason = `${operation}: ${getErrorMessage(error)}`;
  counters.disabled += 1;
  logger.debug(
    { err: error, operation },
    "Durable option metadata store disabled after database error",
  );
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

function buildPolygonOptionTicker(input: {
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

function normalizeContractInput(contract: OptionChainContract): {
  underlying: string;
  polygonTicker: string;
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
  const polygonTicker = buildPolygonOptionTicker({
    ticker: contract.contract.ticker,
    underlying,
    expirationDate,
    strike,
    right: contract.contract.right,
  });
  if (!polygonTicker) {
    return null;
  }
  return {
    underlying,
    polygonTicker,
    expirationDate,
    expirationKey: dateKey(expirationDate),
    strike,
    right: contract.contract.right,
  };
}

async function ensureInstrument(input: {
  symbol: string;
  assetClass: "equity" | "option";
  name?: string | null;
  underlyingSymbol?: string | null;
}): Promise<string | null> {
  const symbol = normalizeSymbol(input.symbol);
  if (!symbol) {
    return null;
  }

  const [existing] = await db
    .select({ id: instrumentsTable.id })
    .from(instrumentsTable)
    .where(eq(instrumentsTable.symbol, symbol))
    .limit(1);
  if (existing?.id) {
    return existing.id;
  }

  await db
    .insert(instrumentsTable)
    .values({
      symbol,
      assetClass: input.assetClass,
      name: input.name?.trim() || symbol,
      underlyingSymbol: input.underlyingSymbol
        ? normalizeSymbol(input.underlyingSymbol)
        : null,
      currency: "USD",
      isActive: true,
    })
    .onConflictDoNothing({ target: instrumentsTable.symbol });

  const [created] = await db
    .select({ id: instrumentsTable.id })
    .from(instrumentsTable)
    .where(eq(instrumentsTable.symbol, symbol))
    .limit(1);
  return created?.id ?? null;
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
    symbol: normalized.polygonTicker,
    assetClass: "option",
    name: normalized.polygonTicker,
    underlyingSymbol: normalized.underlying,
  });
  if (!underlyingInstrumentId || !optionInstrumentId) {
    return null;
  }

  const providerContractId =
    contract.contract.providerContractId?.trim?.() || null;
  const existingConditions = providerContractId
    ? or(
        eq(optionContractsTable.polygonTicker, normalized.polygonTicker),
        eq(optionContractsTable.providerContractId, providerContractId),
      )
    : eq(optionContractsTable.polygonTicker, normalized.polygonTicker);
  const [existing] = await db
    .select({ id: optionContractsTable.id })
    .from(optionContractsTable)
    .where(existingConditions)
    .limit(1);

  if (existing?.id) {
    await db
      .update(optionContractsTable)
      .set({
        instrumentId: optionInstrumentId,
        underlyingInstrumentId,
        polygonTicker: normalized.polygonTicker,
        providerContractId,
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
      .where(eq(optionContractsTable.id, existing.id));
    return { id: existing.id, underlyingInstrumentId };
  }

  const [created] = await db
    .insert(optionContractsTable)
    .values({
      instrumentId: optionInstrumentId,
      underlyingInstrumentId,
      polygonTicker: normalized.polygonTicker,
      providerContractId,
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
    .returning({ id: optionContractsTable.id });

  return created?.id ? { id: created.id, underlyingInstrumentId } : null;
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

async function pruneOldSnapshots(now = Date.now()): Promise<void> {
  const cutoff = new Date(now - OPTION_METADATA_SNAPSHOT_RETENTION_MS);
  const deleted = await db
    .delete(optionChainSnapshotsTable)
    .where(lt(optionChainSnapshotsTable.asOf, cutoff))
    .returning({ id: optionChainSnapshotsTable.id });
  counters.prunedRows += deleted.length;
}

export async function persistDurableOptionChain(input: {
  contracts: OptionChainContract[];
  source?: string;
  asOf?: Date;
}): Promise<void> {
  if (isDurableOptionMetadataDisabled() || input.contracts.length === 0) {
    return;
  }

  try {
    const asOf = input.asOf ?? new Date();
    const snapshotRows = [];
    for (const contract of input.contracts) {
      const savedContract = await upsertOptionContract(contract);
      if (!savedContract || !hasSnapshotFields(contract)) {
        continue;
      }
      snapshotRows.push({
        underlyingInstrumentId: savedContract.underlyingInstrumentId,
        optionContractId: savedContract.id,
        bid: decimalOrNull(contract.bid),
        ask: decimalOrNull(contract.ask),
        last: decimalOrNull(contract.last),
        mark: decimalOrNull(contract.mark),
        impliedVolatility: decimalOrNull(contract.impliedVolatility),
        delta: decimalOrNull(contract.delta),
        gamma: decimalOrNull(contract.gamma),
        theta: decimalOrNull(contract.theta),
        vega: decimalOrNull(contract.vega),
        openInterest: integerValueOrNull(contract.openInterest),
        volume: integerValueOrNull(contract.volume),
        source: input.source ?? "ibkr",
        asOf,
      });
    }

    for (let index = 0; index < snapshotRows.length; index += 500) {
      const values = snapshotRows.slice(index, index + 500);
      if (values.length) {
        await db.insert(optionChainSnapshotsTable).values(values);
      }
    }
    await pruneOldSnapshots(asOf.getTime());
    counters.writeSuccess += 1;
  } catch (error) {
    counters.writeFailure += 1;
    disableAfterError(error, "persist_option_chain");
  }
}

async function getUnderlyingInstrumentId(
  underlyingInput: string,
): Promise<string | null> {
  const underlying = normalizeSymbol(underlyingInput);
  if (!underlying || isDurableOptionMetadataDisabled()) {
    return null;
  }
  const [instrument] = await db
    .select({ id: instrumentsTable.id })
    .from(instrumentsTable)
    .where(eq(instrumentsTable.symbol, underlying))
    .limit(1);
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
  if (isDurableOptionMetadataDisabled()) {
    counters.miss += 1;
    return null;
  }

  try {
    const underlyingInstrumentId = await getUnderlyingInstrumentId(input.underlying);
    if (!underlyingInstrumentId) {
      return recordLoadResult<Date[]>(null);
    }

    const rows = await db
      .select({
        expirationDate: optionContractsTable.expirationDate,
        updatedAt: optionContractsTable.updatedAt,
      })
      .from(optionContractsTable)
      .where(
        and(
          eq(optionContractsTable.underlyingInstrumentId, underlyingInstrumentId),
          eq(optionContractsTable.isActive, true),
        ),
      )
      .orderBy(optionContractsTable.expirationDate)
      .limit(OPTION_METADATA_QUERY_LIMIT);

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
    return recordLoadResult({ value, freshness, ageMs });
  } catch (error) {
    disableAfterError(error, "load_option_expirations");
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
  if (isDurableOptionMetadataDisabled()) {
    counters.miss += 1;
    return null;
  }

  try {
    const underlying = normalizeSymbol(input.underlying);
    const underlyingInstrumentId = await getUnderlyingInstrumentId(underlying);
    if (!underlyingInstrumentId) {
      return recordLoadResult<OptionChainContract[]>(null);
    }

    const rows = await db
      .select({
        id: optionContractsTable.id,
        polygonTicker: optionContractsTable.polygonTicker,
        providerContractId: optionContractsTable.providerContractId,
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
        ),
      )
      .orderBy(
        optionContractsTable.expirationDate,
        optionContractsTable.strike,
        optionContractsTable.right,
      )
      .limit(OPTION_METADATA_QUERY_LIMIT);

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
      const snapshotRows = await db
        .select({
          optionContractId: optionChainSnapshotsTable.optionContractId,
          bid: optionChainSnapshotsTable.bid,
          ask: optionChainSnapshotsTable.ask,
          last: optionChainSnapshotsTable.last,
          mark: optionChainSnapshotsTable.mark,
          impliedVolatility: optionChainSnapshotsTable.impliedVolatility,
          delta: optionChainSnapshotsTable.delta,
          gamma: optionChainSnapshotsTable.gamma,
          theta: optionChainSnapshotsTable.theta,
          vega: optionChainSnapshotsTable.vega,
          openInterest: optionChainSnapshotsTable.openInterest,
          volume: optionChainSnapshotsTable.volume,
          asOf: optionChainSnapshotsTable.asOf,
        })
        .from(optionChainSnapshotsTable)
        .where(
          and(
            inArray(optionChainSnapshotsTable.optionContractId, contractIds),
            gte(
              optionChainSnapshotsTable.asOf,
              new Date(Date.now() - input.staleMaxAgeMs),
            ),
          ),
        )
        .orderBy(desc(optionChainSnapshotsTable.asOf))
        .limit(contractIds.length * 8);

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
      return [
        {
          contract: {
            ticker: row.polygonTicker,
            underlying,
            expirationDate,
            strike: numberOrNull(row.strike) ?? 0,
            right: row.right,
            multiplier: row.multiplier ?? 100,
            sharesPerContract: row.sharesPerContract ?? 100,
            providerContractId: row.providerContractId ?? null,
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
    return recordLoadResult({ value: contracts, freshness, ageMs });
  } catch (error) {
    disableAfterError(error, "load_option_chain");
    return null;
  }
}

export function getDurableOptionMetadataDiagnostics(): DurableOptionMetadataDiagnostics {
  const envDisabled = isDurableOptionMetadataEnvDisabled();
  return {
    ...counters,
    disabled:
      durableOptionMetadataDisabled || envDisabled ? counters.disabled || 1 : 0,
    disabledReason: envDisabled
      ? "OPTION_METADATA_DISABLED"
      : disabledReason,
    snapshotRetentionMs: OPTION_METADATA_SNAPSHOT_RETENTION_MS,
  };
}

export function __resetDurableOptionMetadataStoreForTests(): void {
  durableOptionMetadataDisabled = false;
  disabledReason = null;
  counters.freshHit = 0;
  counters.staleHit = 0;
  counters.miss = 0;
  counters.writeSuccess = 0;
  counters.writeFailure = 0;
  counters.disabled = 0;
  counters.prunedRows = 0;
}
