import { pool } from "@workspace/db";
import type {
  OptionGreekSelectorRight,
  OptionGreekSnapshot,
} from "@workspace/backtest-core";

export const DEFAULT_GEX_HISTORICAL_GREEKS_TOLERANCE_MS = 30 * 60_000;

type Queryable = Pick<typeof pool, "query">;

export type HistoricalGreekSource = "gex_snapshot" | "bs_reconstruction";

export type HistoricalGreeksLookupInput = {
  symbol: string;
  expirationDate: string | Date;
  strike: number;
  right: OptionGreekSelectorRight;
  timestamp: Date;
  toleranceMs?: number;
  strikeTolerance?: number;
  fallbackGreeks?: OptionGreekSnapshot | null;
  db?: Queryable;
};

export type GexHistoricalGreeksMatch = {
  source: "gex_snapshot";
  greeks: OptionGreekSnapshot;
  snapshotId: string;
  symbol: string;
  computedAt: string;
  ageMs: number;
  toleranceMs: number;
  sourceStatus: string | null;
  spot: number | null;
  option: {
    expirationDate: string;
    strike: number;
    right: OptionGreekSelectorRight;
    ticker: string | null;
    updatedAt: string | null;
  };
};

export type HistoricalGreeksLookupResult =
  | GexHistoricalGreeksMatch
  | {
      source: "bs_reconstruction";
      greeks: OptionGreekSnapshot | null;
      reason:
        | "invalid_input"
        | "missing_gex_snapshot"
        | "invalid_gex_greeks"
        | "query_failed";
      toleranceMs: number;
      error?: string;
    };

type GexLookupRow = {
  id: string;
  symbol: string;
  computed_at: Date | string;
  spot: number | string | null;
  source_status: string | null;
  option_row: unknown;
};

function finiteNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function readGexHistoricalGreeksToleranceMs(
  value: string | undefined = process.env["SIGNAL_OPTIONS_GEX_GREEKS_TOLERANCE_MS"],
): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0
    ? Math.floor(parsed)
    : DEFAULT_GEX_HISTORICAL_GREEKS_TOLERANCE_MS;
}

function rightToCp(right: OptionGreekSelectorRight): "C" | "P" {
  return right === "put" ? "P" : "C";
}

function normalizeExpirationDate(value: string | Date): string | null {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString().slice(0, 10) : null;
  }
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const parsed = new Date(trimmed);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : null;
}

function expirationCloseUtc(expirationDate: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(expirationDate);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }
  // ponytail: scripts-only adapter keeps the summer 2026 evidence path minimal;
  // move DST/early-close exactness into a shared core helper if production scoring uses this.
  const timestamp = Date.UTC(year, month - 1, day, 20, 0, 0, 0);
  const date = new Date(timestamp);
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? date
    : null;
}

function timeToExpirationYears(input: {
  expirationDate: string;
  timestamp: Date;
}): number {
  const closeAt = expirationCloseUtc(input.expirationDate);
  if (!closeAt || !Number.isFinite(input.timestamp.getTime())) return 0;
  return Math.max(
    0,
    (closeAt.getTime() - input.timestamp.getTime()) / (365 * 24 * 60 * 60 * 1_000),
  );
}

function optionGreekSnapshotFromGexRow(input: {
  optionRow: unknown;
  expirationDate: string;
  timestamp: Date;
}): OptionGreekSnapshot | null {
  const row = asRecord(input.optionRow);
  const delta = finiteNumber(row["delta"]);
  const gamma = finiteNumber(row["gamma"]);
  if (delta == null || gamma == null) return null;

  const bid = finiteNumber(row["bid"]);
  const ask = finiteNumber(row["ask"]);
  const mark = finiteNumber(row["mark"]);
  const price =
    mark != null && mark > 0
      ? mark
      : bid != null && ask != null && bid >= 0 && ask > 0
        ? (bid + ask) / 2
        : 0;

  return {
    price,
    delta,
    gamma,
    theta: finiteNumber(row["theta"]) ?? 0,
    vega: finiteNumber(row["vega"]) ?? 0,
    impliedVolatility:
      finiteNumber(row["impliedVol"]) ??
      finiteNumber(row["impliedVolatility"]) ??
      0,
    timeToExpirationYears: timeToExpirationYears(input),
  };
}

export async function lookupHistoricalGreeks(
  input: HistoricalGreeksLookupInput,
): Promise<HistoricalGreeksLookupResult> {
  const toleranceMs =
    input.toleranceMs == null
      ? DEFAULT_GEX_HISTORICAL_GREEKS_TOLERANCE_MS
      : Math.max(0, Math.floor(input.toleranceMs));
  const symbol = input.symbol.trim().toUpperCase();
  const expirationDate = normalizeExpirationDate(input.expirationDate);
  const strike = finiteNumber(input.strike);
  if (
    !symbol ||
    !expirationDate ||
    strike == null ||
    !Number.isFinite(input.timestamp.getTime())
  ) {
    return {
      source: "bs_reconstruction",
      greeks: input.fallbackGreeks ?? null,
      reason: "invalid_input",
      toleranceMs,
    };
  }

  const db = input.db ?? pool;
  try {
    const result = await db.query<GexLookupRow>(
      `
with nearby_snapshots as (
  select id, symbol, computed_at, spot, source_status, payload
  from gex_snapshots
  where symbol = $1
    and computed_at between
      $5::timestamptz - ($6::double precision * interval '1 millisecond')
      and $5::timestamptz + ($6::double precision * interval '1 millisecond')
), option_rows as (
  select
    nearby_snapshots.id,
    nearby_snapshots.symbol,
    nearby_snapshots.computed_at,
    nearby_snapshots.spot,
    nearby_snapshots.source_status,
    option_row
  from nearby_snapshots
  join lateral jsonb_array_elements(
    case
      when jsonb_typeof(nearby_snapshots.payload->'options') = 'array'
        then nearby_snapshots.payload->'options'
      else '[]'::jsonb
    end
  ) as option_row on true
  where jsonb_typeof(option_row) = 'object'
    and option_row->>'expirationDate' = $2
    and option_row->>'cp' = $4
    and abs((option_row->>'strike')::double precision - $3::double precision)
      <= $7::double precision
)
select id, symbol, computed_at, spot::double precision as spot, source_status, option_row
from option_rows
order by
  abs(extract(epoch from (computed_at - $5::timestamptz)) * 1000),
  abs((option_row->>'strike')::double precision - $3::double precision),
  computed_at desc
limit 1
      `,
      [
        symbol,
        expirationDate,
        strike,
        rightToCp(input.right),
        input.timestamp,
        toleranceMs,
        input.strikeTolerance ?? 0.001,
      ],
    );
    const row = result.rows[0];
    if (!row) {
      return {
        source: "bs_reconstruction",
        greeks: input.fallbackGreeks ?? null,
        reason: "missing_gex_snapshot",
        toleranceMs,
      };
    }

    const computedAt = new Date(row.computed_at);
    const optionRow = asRecord(row.option_row);
    const greeks = optionGreekSnapshotFromGexRow({
      optionRow,
      expirationDate,
      timestamp: input.timestamp,
    });
    if (!greeks) {
      return {
        source: "bs_reconstruction",
        greeks: input.fallbackGreeks ?? null,
        reason: "invalid_gex_greeks",
        toleranceMs,
      };
    }

    return {
      source: "gex_snapshot",
      greeks,
      snapshotId: row.id,
      symbol: row.symbol,
      computedAt: computedAt.toISOString(),
      ageMs: Math.abs(computedAt.getTime() - input.timestamp.getTime()),
      toleranceMs,
      sourceStatus: row.source_status,
      spot: finiteNumber(row.spot),
      option: {
        expirationDate,
        strike: finiteNumber(optionRow["strike"]) ?? strike,
        right: input.right,
        ticker:
          typeof optionRow["ticker"] === "string" ? optionRow["ticker"] : null,
        updatedAt:
          typeof optionRow["updatedAt"] === "string"
            ? optionRow["updatedAt"]
            : null,
      },
    };
  } catch (error) {
    return {
      source: "bs_reconstruction",
      greeks: input.fallbackGreeks ?? null,
      reason: "query_failed",
      toleranceMs,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
