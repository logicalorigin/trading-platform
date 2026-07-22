import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { stripVTControlCharacters } from "node:util";
import { pool } from "@workspace/db";

type JsonRecord = Record<string, unknown>;

type Config = {
  accountId: string;
  start: string;
  end: string;
  reportDir: string;
  topLeaks: number;
  sweepRoot: string;
};

type LedgerSummary = {
  fills: number;
  buyFills: number;
  sellFills: number;
  symbols: number;
  firstFillAt: string | null;
  lastFillAt: string | null;
  realizedPnl: number;
  fees: number;
  cashDelta: number;
};

type AggregateRow = {
  bucket: string;
  exits: number;
  wins: number;
  winPct: number | null;
  pnl: number;
  avgPnl: number | null;
  missedToPostExitHigh: number;
  reached25AfterExit: number;
  finalAboveExit: number;
};

type SymbolRow = {
  symbol: string;
  exits: number;
  wins: number;
  winPct: number | null;
  pnl: number;
  avgPnl: number | null;
  missedToPostExitHigh: number;
};

type LeakRow = {
  symbol: string;
  reason: string;
  closedAt: string;
  pnl: number;
  quantity: number;
  entryPrice: number | null;
  exitPrice: number;
  peakPrice: number | null;
  postHigh: number | null;
  highVsExitPct: number | null;
  missedToHigh: number;
  holdMinutes: number | null;
  score: number | null;
  mtfMatches: number | null;
  adx: number | null;
  premiumAtRisk: number | null;
  finalAboveExit: boolean | null;
  recoveredEntry: boolean | null;
};

type SweepEvidence = {
  reportDir: string;
  window: string | null;
  bestVariant: string | null;
  bestPnl: number | null;
  bestProfitFactor: number | null;
  bestTrades: number | null;
  bestWinPct: number | null;
  bestMaxDrawdown: number | null;
};

type Recommendation = {
  lane: "exit_management" | "sizing" | "entry_filtering" | "portfolio" | "data_quality";
  priority: "high" | "medium" | "low";
  title: string;
  evidence: string;
  nextTest: string;
};

type ReviewOutput = {
  summary: {
    generatedAt: string;
    accountId: string;
    window: { start: string; end: string };
    reportDir: string;
    ledger: LedgerSummary;
    opportunity: {
      realizedExitPnl: number;
      missedToPostExitHigh: number;
      missedToRealizedRatio: number | null;
      caveat: string;
    };
  };
  byMonth: AggregateRow[];
  byExitReason: AggregateRow[];
  byQuality: AggregateRow[];
  byGreekManagement: AggregateRow[];
  topSymbols: SymbolRow[];
  weakSymbols: SymbolRow[];
  topLeaks: LeakRow[];
  sweepEvidence: SweepEvidence[];
  recommendations: Recommendation[];
};

const MAX_SWEEP_DIRECTORIES = 1_000;
// ponytail: 16 MiB bounds each local sweep artifact. If measured reports reach
// this ceiling, extract the ranked summary into a small sidecar before raising it.
const MAX_SWEEP_REPORT_BYTES = 16 * 1024 * 1024;
// ponytail: 1,000 characters keeps operator output bounded. If this hides a
// useful diagnostic, add a structured field rather than widening the ceiling.
const MAX_OUTPUT_STRING_LENGTH = 1_000;
const UNSAFE_OUTPUT_PATTERN =
  /[\u0000-\u001f\u007f-\u009f\u2028-\u202e\u2066-\u2069]/gu;

function safeText(value: unknown): string {
  const cleaned = stripVTControlCharacters(
    String(value ?? "")
      .replace(
        /([a-z][a-z0-9+.-]*:\/\/)[^@\s]+@/giu,
        "$1[redacted]@",
      )
      .replace(
        /([?&](?:api[_-]?key|access[_-]?token|token|key)=)[^&#\s]*/giu,
        "$1[redacted]",
      ),
  )
    .replace(UNSAFE_OUTPUT_PATTERN, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return cleaned.length <= MAX_OUTPUT_STRING_LENGTH
    ? cleaned
    : `${cleaned.slice(0, MAX_OUTPUT_STRING_LENGTH - 1)}…`;
}

function errorMessage(error: unknown): string {
  return safeText(error instanceof Error ? error.message : error) || "Unknown review error";
}

function markdownText(value: unknown): string {
  return safeText(value)
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/\\/gu, "\\\\")
    .replace(/([`*_[\]{}()|~])/gu, "\\$1");
}

function jsonText(value: unknown, space?: number): string {
  return (
    JSON.stringify(
      value,
      (_key, current) => (typeof current === "string" ? safeText(current) : current),
      space,
    ) ?? "null"
  );
}

function jsonNumberSql(payloadSql: string, jsonPath: string): string {
  return `case when jsonb_typeof(${payloadSql} #> '${jsonPath}') = 'number' then (${payloadSql} #>> '${jsonPath}')::numeric end`;
}

function jsonBooleanSql(payloadSql: string, jsonPath: string): string {
  return `case when jsonb_typeof(${payloadSql} #> '${jsonPath}') = 'boolean' then (${payloadSql} #>> '${jsonPath}')::boolean end`;
}

function jsonStringSql(payloadSql: string, jsonPath: string): string {
  return `case when jsonb_typeof(${payloadSql} #> '${jsonPath}') = 'string' then ${payloadSql} #>> '${jsonPath}' end`;
}

function slug(now = new Date()): string {
  return now.toISOString().replace(/[:.]/g, "-");
}

function envValue(env: NodeJS.ProcessEnv, name: string): string | null {
  const value = env[name]?.trim();
  return value ? value : null;
}

function readPositiveIntegerEnv(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  max: number,
): number {
  const raw = envValue(env, name);
  if (raw === null) return fallback;
  if (!/^[1-9]\d*$/u.test(raw)) {
    throw new Error(`${name} must be a positive integer.`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value > max) {
    throw new Error(`${name} must be at most ${max}.`);
  }
  return value;
}

function readDateEnv(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: string,
): string {
  const value = envValue(env, name) ?? fallback;
  if (!isCanonicalDate(value)) {
    throw new Error(`${name} must use YYYY-MM-DD.`);
  }
  return value;
}

function isCanonicalDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
  );
}

function readConfig(
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
  now = new Date(),
): Config {
  const start = readDateEnv(
    env,
    "SHADOW_OPTIONS_MANAGEMENT_REVIEW_START",
    "2026-04-01",
  );
  const end = readDateEnv(
    env,
    "SHADOW_OPTIONS_MANAGEMENT_REVIEW_END",
    "2026-05-21",
  );
  if (start > end) {
    throw new Error("Shadow options management review window start must not exceed end.");
  }
  const reportRoot =
    envValue(env, "SHADOW_OPTIONS_MANAGEMENT_REVIEW_REPORT_DIR") ??
    path.join("reports", "shadow-options-management-review", slug(now));
  return {
    accountId:
      envValue(env, "SHADOW_OPTIONS_MANAGEMENT_REVIEW_ACCOUNT_ID") ?? "shadow",
    start,
    end,
    reportDir: path.resolve(cwd, reportRoot),
    topLeaks: readPositiveIntegerEnv(
      env,
      "SHADOW_OPTIONS_MANAGEMENT_REVIEW_TOP_LEAKS",
      30,
      250,
    ),
    sweepRoot: path.resolve(
      cwd,
      envValue(env, "SHADOW_OPTIONS_MANAGEMENT_REVIEW_SWEEP_ROOT") ??
        path.join("reports", "signal-options-exit-policy-sweeps"),
    ),
  };
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function finiteNumber(value: unknown): number | null {
  if (
    typeof value !== "number" &&
    (typeof value !== "string" || !value.trim())
  ) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function requiredFiniteNumber(value: unknown, name: string): number {
  const parsed = finiteNumber(value);
  if (parsed === null) {
    throw new Error(`Invalid ${name} in shadow management review row.`);
  }
  return parsed;
}

function optionalFiniteNumber(value: unknown, name: string): number | null {
  if (value === null || value === undefined) return null;
  return requiredFiniteNumber(value, name);
}

function nonnegativeInteger(value: unknown, name: string): number {
  const parsed = requiredFiniteNumber(value, name);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid ${name} in shadow management review row.`);
  }
  return parsed;
}

function round(value: number | null, decimals = 2): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}

function sqlWindow(config: Config) {
  return {
    from: `${config.start}T00:00:00.000Z`,
    to: `${config.end}T23:59:59.999Z`,
  };
}

function normalizeAggregateRow(row: Record<string, unknown>): AggregateRow {
  const exits = nonnegativeInteger(row["exits"], "exits");
  const wins = nonnegativeInteger(row["wins"], "wins");
  const winPct = optionalFiniteNumber(row["win_pct"], "win_pct");
  const reached25AfterExit = nonnegativeInteger(
    row["reached_25_after_exit"],
    "reached_25_after_exit",
  );
  const finalAboveExit = nonnegativeInteger(
    row["final_above_exit"],
    "final_above_exit",
  );
  if (
    wins > exits ||
    reached25AfterExit > exits ||
    finalAboveExit > exits ||
    (winPct !== null && (winPct < 0 || winPct > 100))
  ) {
    throw new Error("Invalid wins or win_pct in shadow management review row.");
  }
  const missedToPostExitHigh = requiredFiniteNumber(
    row["missed_to_post_exit_high"],
    "missed_to_post_exit_high",
  );
  if (missedToPostExitHigh < 0) {
    throw new Error("Invalid missed_to_post_exit_high in shadow management review row.");
  }
  return {
    bucket: typeof row["bucket"] === "string" ? row["bucket"] : "unknown",
    exits,
    wins,
    winPct: round(winPct, 1),
    pnl: round(requiredFiniteNumber(row["pnl"], "pnl"), 2)!,
    avgPnl: round(optionalFiniteNumber(row["avg_pnl"], "avg_pnl"), 2),
    missedToPostExitHigh: round(missedToPostExitHigh, 2)!,
    reached25AfterExit,
    finalAboveExit,
  };
}

function normalizeSymbolRow(row: Record<string, unknown>): SymbolRow {
  return {
    symbol: String(row["symbol"] ?? "unknown"),
    exits: Number(row["exits"] ?? 0),
    wins: Number(row["wins"] ?? 0),
    winPct: round(finiteNumber(row["win_pct"]), 1),
    pnl: round(finiteNumber(row["pnl"]) ?? 0, 2) ?? 0,
    avgPnl: round(finiteNumber(row["avg_pnl"]), 2),
    missedToPostExitHigh: round(finiteNumber(row["missed_to_post_exit_high"]) ?? 0, 2) ?? 0,
  };
}

function booleanOrNull(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function normalizeLeakRow(row: Record<string, unknown>): LeakRow {
  const closedAt =
    row["closed_at"] instanceof Date
      ? row["closed_at"]
      : typeof row["closed_at"] === "string"
        ? new Date(row["closed_at"])
        : null;
  if (!closedAt || !Number.isFinite(closedAt.getTime())) {
    throw new Error("Invalid closed_at in shadow management review row.");
  }
  const openedAt =
    typeof row["opened_at"] === "string"
      ? Date.parse(row["opened_at"])
      : Number.NaN;
  return {
    symbol: typeof row["symbol"] === "string" ? row["symbol"] : "unknown",
    reason: typeof row["reason"] === "string" ? row["reason"] : "unknown",
    closedAt: closedAt.toISOString(),
    pnl: round(finiteNumber(row["pnl"]) ?? 0, 2) ?? 0,
    quantity: finiteNumber(row["quantity"]) ?? 0,
    entryPrice: round(finiteNumber(row["entry_price"]), 2),
    exitPrice: finiteNumber(row["exit_price"]) ?? 0,
    peakPrice: round(finiteNumber(row["peak_price"]), 2),
    postHigh: round(finiteNumber(row["post_high"]), 2),
    highVsExitPct: round(finiteNumber(row["high_vs_exit_pct"]), 1),
    missedToHigh: round(finiteNumber(row["missed_to_high"]) ?? 0, 2) ?? 0,
    holdMinutes: Number.isFinite(openedAt)
      ? round((closedAt.getTime() - openedAt) / 60_000, 1)
      : null,
    score: round(finiteNumber(row["score"]), 1),
    mtfMatches: finiteNumber(row["mtf_matches"]),
    adx: round(finiteNumber(row["adx"]), 2),
    premiumAtRisk: round(finiteNumber(row["premium_at_risk"]), 2),
    finalAboveExit: booleanOrNull(row["final_above_exit"]),
    recoveredEntry: booleanOrNull(row["recovered_entry"]),
  };
}

async function loadLedgerSummary(config: Config): Promise<LedgerSummary> {
  const window = sqlWindow(config);
  const result = await pool.query(
    `
      select count(*)::int as fills,
             count(*) filter (where f.side = 'buy')::int as buy_fills,
             count(*) filter (where f.side = 'sell')::int as sell_fills,
             count(distinct f.symbol)::int as symbols,
             min(f.occurred_at) as first_fill_at,
             max(f.occurred_at) as last_fill_at,
             coalesce(sum(f.realized_pnl), 0)::numeric(18,2) as realized_pnl,
             coalesce(sum(f.fees), 0)::numeric(18,2) as fees,
             coalesce(sum(f.cash_delta), 0)::numeric(18,2) as cash_delta
      from shadow_fills f
      join shadow_orders o on o.id = f.order_id
      where o.account_id = $1
        and o.source = 'automation'
        and o.asset_class = 'option'
        and lower(coalesce(o.payload->>'forwardTest', 'false')) <> 'true'
        and f.occurred_at >= $2::timestamptz
        and f.occurred_at <= $3::timestamptz
    `,
    [config.accountId, window.from, window.to],
  );
  const row = result.rows[0] ?? {};
  return {
    fills: Number(row.fills ?? 0),
    buyFills: Number(row.buy_fills ?? 0),
    sellFills: Number(row.sell_fills ?? 0),
    symbols: Number(row.symbols ?? 0),
    firstFillAt: row.first_fill_at instanceof Date ? row.first_fill_at.toISOString() : null,
    lastFillAt: row.last_fill_at instanceof Date ? row.last_fill_at.toISOString() : null,
    realizedPnl: round(finiteNumber(row.realized_pnl) ?? 0, 2) ?? 0,
    fees: round(finiteNumber(row.fees) ?? 0, 2) ?? 0,
    cashDelta: round(finiteNumber(row.cash_delta) ?? 0, 2) ?? 0,
  };
}

async function loadAggregate(config: Config, bucketSql: string): Promise<AggregateRow[]> {
  const window = sqlWindow(config);
  const postHighSql = jsonNumberSql(
    "o.payload",
    "{postExitOutcome,highPrice}",
  );
  const reachedTwentyFiveSql = jsonBooleanSql(
    "o.payload",
    "{postExitOutcome,reachedTwentyFivePctGain}",
  );
  const finalAboveExitSql = jsonBooleanSql(
    "o.payload",
    "{postExitOutcome,finalAboveExit}",
  );
  const result = await pool.query(
    `
      select ${bucketSql} as bucket,
             count(*)::int as exits,
             count(*) filter (where f.realized_pnl > 0)::int as wins,
             (count(*) filter (where f.realized_pnl > 0)::numeric / nullif(count(*), 0) * 100)::numeric(18,1) as win_pct,
             coalesce(sum(f.realized_pnl), 0)::numeric(18,2) as pnl,
             avg(f.realized_pnl)::numeric(18,2) as avg_pnl,
             coalesce(sum(greatest(((${postHighSql}) - f.price) * f.quantity * 100, 0)), 0)::numeric(18,2) as missed_to_post_exit_high,
             count(*) filter (where (${reachedTwentyFiveSql}) is true)::int as reached_25_after_exit,
             count(*) filter (where (${finalAboveExitSql}) is true)::int as final_above_exit
      from shadow_orders o
      join shadow_fills f on f.order_id = o.id
      where o.account_id = $1
        and o.source = 'automation'
        and o.asset_class = 'option'
        and lower(coalesce(o.payload->>'forwardTest', 'false')) <> 'true'
        and o.side = 'sell'
        and o.placed_at >= $2::timestamptz
        and o.placed_at <= $3::timestamptz
      group by 1
      order by pnl desc
    `,
    [config.accountId, window.from, window.to],
  );
  return result.rows.map(normalizeAggregateRow);
}

async function loadGreekManagementAggregate(config: Config): Promise<AggregateRow[]> {
  const window = sqlWindow(config);
  const recommendationSql = `coalesce(
    nullif(${jsonStringSql("o.payload", "{stop,greekManagement,recommendation}")}, ''),
    nullif(${jsonStringSql("o.payload", "{position,lastStop,greekManagement,recommendation}")}, '')
  )`;
  const postHighSql = jsonNumberSql("payload", "{postExitOutcome,highPrice}");
  const reachedTwentyFiveSql = jsonBooleanSql(
    "payload",
    "{postExitOutcome,reachedTwentyFivePctGain}",
  );
  const finalAboveExitSql = jsonBooleanSql(
    "payload",
    "{postExitOutcome,finalAboveExit}",
  );
  const result = await pool.query(
    `
      with sells as (
        select ${recommendationSql} as bucket,
               f.realized_pnl,
               f.price,
               f.quantity,
               o.payload
        from shadow_orders o
        join shadow_fills f on f.order_id = o.id
        where o.account_id = $1
          and o.source = 'automation'
          and o.asset_class = 'option'
          and lower(coalesce(o.payload->>'forwardTest', 'false')) <> 'true'
          and o.side = 'sell'
          and o.placed_at >= $2::timestamptz
          and o.placed_at <= $3::timestamptz
      )
      select bucket,
             count(*)::int as exits,
             count(*) filter (where realized_pnl > 0)::int as wins,
             (count(*) filter (where realized_pnl > 0)::numeric / nullif(count(*), 0) * 100)::numeric(18,1) as win_pct,
             coalesce(sum(realized_pnl), 0)::numeric(18,2) as pnl,
             avg(realized_pnl)::numeric(18,2) as avg_pnl,
             coalesce(sum(greatest(((${postHighSql}) - price) * quantity * 100, 0)), 0)::numeric(18,2) as missed_to_post_exit_high,
             count(*) filter (where (${reachedTwentyFiveSql}) is true)::int as reached_25_after_exit,
             count(*) filter (where (${finalAboveExitSql}) is true)::int as final_above_exit
      from sells
      where bucket is not null
      group by 1
      order by exits desc, pnl desc
    `,
    [config.accountId, window.from, window.to],
  );
  return result.rows.map(normalizeAggregateRow);
}

async function loadSymbols(config: Config, order: "best" | "worst"): Promise<SymbolRow[]> {
  const window = sqlWindow(config);
  const postHighSql = jsonNumberSql(
    "o.payload",
    "{postExitOutcome,highPrice}",
  );
  const result = await pool.query(
    `
      select o.symbol,
             count(*)::int as exits,
             count(*) filter (where f.realized_pnl > 0)::int as wins,
             (count(*) filter (where f.realized_pnl > 0)::numeric / nullif(count(*), 0) * 100)::numeric(18,1) as win_pct,
             coalesce(sum(f.realized_pnl), 0)::numeric(18,2) as pnl,
             avg(f.realized_pnl)::numeric(18,2) as avg_pnl,
             coalesce(sum(greatest(((${postHighSql}) - f.price) * f.quantity * 100, 0)), 0)::numeric(18,2) as missed_to_post_exit_high
      from shadow_orders o
      join shadow_fills f on f.order_id = o.id
      where o.account_id = $1
        and o.source = 'automation'
        and o.asset_class = 'option'
        and lower(coalesce(o.payload->>'forwardTest', 'false')) <> 'true'
        and o.side = 'sell'
        and o.placed_at >= $2::timestamptz
        and o.placed_at <= $3::timestamptz
      group by 1
      having count(*) >= 3
      order by pnl ${order === "best" ? "desc" : "asc"}
      limit 20
    `,
    [config.accountId, window.from, window.to],
  );
  return result.rows.map(normalizeSymbolRow);
}

async function loadTopLeaks(config: Config): Promise<LeakRow[]> {
  const window = sqlWindow(config);
  const reasonSql = `coalesce(
    ${jsonStringSql("o.payload", "{reason}")},
    ${jsonStringSql("o.payload", "{exitReason}")},
    'unknown'
  )`;
  const result = await pool.query(
    `
      with sells as (
        select o.symbol,
               ${reasonSql} as reason,
               o.placed_at as closed_at,
               f.realized_pnl,
               f.quantity,
               f.price as exit_price,
               ${jsonNumberSql("o.payload", "{position,entryPrice}")} as entry_price,
               ${jsonNumberSql("o.payload", "{position,peakPrice}")} as peak_price,
               ${jsonNumberSql("o.payload", "{postExitOutcome,highPrice}")} as post_high,
               ${jsonNumberSql("o.payload", "{postExitOutcome,highVsExitPct}")} as high_vs_exit_pct,
               ${jsonBooleanSql("o.payload", "{postExitOutcome,finalAboveExit}")} as final_above_exit,
               ${jsonBooleanSql("o.payload", "{postExitOutcome,recoveredEntry}")} as recovered_entry,
               ${jsonNumberSql("o.payload", "{position,signalQuality,score}")} as score,
               ${jsonNumberSql("o.payload", "{position,signalQuality,mtfMatches}")} as mtf_matches,
               ${jsonNumberSql("o.payload", "{position,signalQuality,adx}")} as adx,
               ${jsonNumberSql("o.payload", "{position,premiumAtRisk}")} as premium_at_risk,
               ${jsonStringSql("o.payload", "{position,openedAt}")} as opened_at
        from shadow_orders o
        join shadow_fills f on f.order_id = o.id
        where o.account_id = $1
          and o.source = 'automation'
          and o.asset_class = 'option'
          and lower(coalesce(o.payload->>'forwardTest', 'false')) <> 'true'
          and o.side = 'sell'
          and o.placed_at >= $2::timestamptz
          and o.placed_at <= $3::timestamptz
      )
      select symbol,
             reason,
             closed_at,
             realized_pnl::numeric(18,2) as pnl,
             quantity::numeric(18,2) as quantity,
             entry_price,
             exit_price,
             peak_price,
             post_high,
             high_vs_exit_pct,
             greatest((post_high - exit_price) * quantity * 100, 0)::numeric(18,2) as missed_to_high,
             score,
             mtf_matches,
             adx,
             premium_at_risk,
             final_above_exit,
             recovered_entry
      from sells
      order by missed_to_high desc
      limit $4
    `,
    [config.accountId, window.from, window.to, config.topLeaks],
  );
  return result.rows.map(normalizeLeakRow);
}

async function readSweepEvidence(sweepRoot: string): Promise<SweepEvidence[]> {
  let entries: Array<{ name: string; isDirectory(): boolean }>;
  try {
    entries = await readdir(sweepRoot, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  if (entries.length > MAX_SWEEP_DIRECTORIES) {
    throw new Error(
      `Sweep root contains more than ${MAX_SWEEP_DIRECTORIES} entries: ${sweepRoot}`,
    );
  }

  const evidence: SweepEvidence[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory()) continue;
    const resultPath = path.join(sweepRoot, entry.name, "results.json");
    let stats;
    try {
      stats = await lstat(resultPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    if (!stats.isFile() || stats.isSymbolicLink()) continue;
    if (stats.size > MAX_SWEEP_REPORT_BYTES) {
      throw new Error(`Sweep result exceeds ${MAX_SWEEP_REPORT_BYTES} bytes: ${resultPath}`);
    }
    const parsed = asRecord(JSON.parse(await readFile(resultPath, "utf8")));
    const ranked = Array.isArray(parsed["ranked"])
      ? (parsed["ranked"] as unknown[])
      : [];
    if (!ranked.length) continue;
    const best = asRecord(ranked[0]);
    if (best["status"] !== "succeeded" || best["eligible"] !== true) continue;
    const metrics = asRecord(best["metrics"]);
    const variant = asRecord(best["variant"]);
    const bestVariant =
      typeof variant["id"] === "string" && variant["id"].trim()
        ? variant["id"]
        : null;
    const bestPnl = finiteNumber(metrics["realizedPnl"]);
    const bestTrades = finiteNumber(metrics["closedTrades"]);
    const profitFactor = finiteNumber(metrics["profitFactor"]);
    const winRate = finiteNumber(metrics["winRate"]);
    const maxDrawdown = finiteNumber(metrics["maxDrawdownAbs"]);
    const window = asRecord(best["window"]);
    const start = window["start"];
    const end = window["end"];
    if (
      !bestVariant ||
      bestVariant.length > 200 ||
      bestPnl === null ||
      bestTrades === null ||
      !Number.isSafeInteger(bestTrades) ||
      bestTrades < 0 ||
      (metrics["profitFactor"] !== null &&
        metrics["profitFactor"] !== undefined &&
        (profitFactor === null || profitFactor < 0)) ||
      winRate === null ||
      winRate < 0 ||
      winRate > 1 ||
      maxDrawdown === null ||
      maxDrawdown < 0 ||
      !isCanonicalDate(start) ||
      !isCanonicalDate(end) ||
      start > end
    ) {
      throw new Error(`Invalid ranked sweep winner: ${resultPath}`);
    }
    evidence.push({
      reportDir: path.join(sweepRoot, entry.name),
      window: `${start} through ${end}`,
      bestVariant,
      bestPnl: round(bestPnl, 2),
      bestProfitFactor: round(profitFactor, 3),
      bestTrades,
      bestWinPct: round(winRate * 100, 1),
      bestMaxDrawdown: round(maxDrawdown, 2),
    });
  }
  return evidence
    .sort((left, right) => (right.bestPnl ?? 0) - (left.bestPnl ?? 0))
    .slice(0, 8);
}

export function buildRecommendations(input: {
  byExitReason: AggregateRow[];
  byGreekManagement?: AggregateRow[];
  weakSymbols: SymbolRow[];
  sweepEvidence: SweepEvidence[];
  opportunityRatio: number | null;
}): Recommendation[] {
  const byReason = new Map(input.byExitReason.map((row) => [row.bucket, row]));
  const runner = byReason.get("runner_trail_stop");
  const opposite = byReason.get("opposite_signal");
  const early = byReason.get("early_invalidation");
  const overnight = byReason.get("overnight_risk_exit");
  const bestSweep = input.sweepEvidence[0];
  const byGreek = new Map(
    (input.byGreekManagement ?? []).map((row) => [row.bucket, row]),
  );
  const greekTighten = byGreek.get("tighten");
  const greekLoosen = byGreek.get("loosen");
  const recommendations: Recommendation[] = [];

  if (greekTighten && greekTighten.exits >= 5) {
    recommendations.push({
      lane: "exit_management",
      priority: "medium",
      title: "Evaluate Greek tighten-only enforcement on shadow",
      evidence: `Greek tighten diagnostics covered ${greekTighten.exits} exits with ${greekTighten.pnl.toFixed(2)} realized P&L, ${greekTighten.winPct ?? "n/a"}% wins, and ${greekTighten.missedToPostExitHigh.toFixed(2)} to post-exit highs.`,
      nextTest:
        "Run a shadow-only counterfactual that tightens premium trailing behavior on delta decay or theta burden, while leaving Greek loosening disabled.",
    });
  }

  if (greekLoosen && greekLoosen.exits >= 5) {
    recommendations.push({
      lane: "exit_management",
      priority: "low",
      title: "Keep Greek loosening in diagnostics until holdout evidence is stronger",
      evidence: `Greek loosen diagnostics covered ${greekLoosen.exits} exits with ${greekLoosen.missedToPostExitHigh.toFixed(2)} to post-exit highs and ${greekLoosen.finalAboveExit}/${greekLoosen.exits} final-above-exit outcomes.`,
      nextTest:
        "Require a larger holdout and explicit no-loosen control before allowing Greek support to lower or defer exits.",
    });
  }

  if (runner && runner.missedToPostExitHigh > Math.max(runner.pnl * 2, 25_000)) {
    recommendations.push({
      lane: "exit_management",
      priority: "high",
      title: "Keep a runner alive after first trail exit",
      evidence: `${runner.exits} runner-trail exits produced ${runner.pnl.toFixed(2)} realized P&L but left ${runner.missedToPostExitHigh.toFixed(2)} to post-exit highs.`,
      nextTest:
        "Dry-run partial exits: sell 50-70% at current trail, keep 30-50% under a looser trend/ATR trail, and compare April train vs May holdout.",
    });
  }

  if (opposite && opposite.missedToPostExitHigh > 50_000) {
    recommendations.push({
      lane: "exit_management",
      priority: "high",
      title: "Require confirmation before full opposite-signal liquidation",
      evidence: `${opposite.exits} opposite-signal exits left ${opposite.missedToPostExitHigh.toFixed(2)} to later highs while still making ${opposite.pnl.toFixed(2)}.`,
      nextTest:
        "Test half-exit on first opposite signal, full exit only after second confirming bar or MTF direction loss.",
    });
  }

  if (early && early.finalAboveExit > early.exits * 0.35) {
    recommendations.push({
      lane: "entry_filtering",
      priority: "medium",
      title: "Convert early invalidation from permanent exit to re-entry watch",
      evidence: `${early.finalAboveExit}/${early.exits} early invalidations finished above their exit price despite negative realized P&L.`,
      nextTest:
        "Test a re-entry rule after early invalidation when the original direction re-confirms within 3-6 bars and option liquidity is still valid.",
    });
  }

  if (overnight && overnight.missedToPostExitHigh > 50_000) {
    recommendations.push({
      lane: "portfolio",
      priority: "medium",
      title: "Differentiate overnight exits for strong runners",
      evidence: `Overnight-risk exits were nearly flat on realized P&L (${overnight.pnl.toFixed(2)}) but left ${overnight.missedToPostExitHigh.toFixed(2)} to post-exit highs.`,
      nextTest:
        "Allow high-quality runners to hold a small residual overnight with a wider runner stop while forcing weak/flat positions out.",
    });
  }

  const weak = input.weakSymbols.slice(0, 5).filter((row) => row.pnl < 500);
  if (weak.length) {
    recommendations.push({
      lane: "entry_filtering",
      priority: "medium",
      title: "Downweight or exclude weak expectancy symbols",
      evidence: `Lowest buckets include ${weak.map((row) => `${row.symbol} ${row.pnl.toFixed(2)}`).join(", ")}.`,
      nextTest:
        "Run a symbol-exclusion holdout sweep; only remove symbols that improve both April and May or improve one without harming the other materially.",
    });
  }

  if (bestSweep?.bestVariant) {
    recommendations.push({
      lane: "exit_management",
      priority: "medium",
      title: "Promote prior dry-sweep winners into the next hypothesis set",
      evidence: `Best prior sweep evidence is ${bestSweep.bestVariant} with ${bestSweep.bestPnl?.toFixed(2)} P&L, ${bestSweep.bestProfitFactor} PF, and ${bestSweep.bestTrades} trades.`,
      nextTest:
        "Use that variant as the baseline for new partial-runner, re-entry, and sizing counterfactuals.",
    });
  }

  if (input.opportunityRatio !== null && input.opportunityRatio > 3) {
    recommendations.push({
      lane: "sizing",
      priority: "low",
      title: "Scale only after management improves capture",
      evidence: `The post-exit opportunity ratio is ${input.opportunityRatio.toFixed(2)}x, so raw sizing alone risks amplifying avoidable exits.`,
      nextTest:
        "After exit/re-entry improvements, test quality-based premium caps and add-ons only for trades that reach +50%/+100%.",
    });
  }

  recommendations.push({
    lane: "data_quality",
    priority: "low",
    title: "Keep audit-quality fill provenance in the loop",
    evidence:
      "The April external audit found exact trade-source matches but aggregate-sourced sell exits had unresolved strict mismatches.",
    nextTest:
      "For candidate production settings, rerun the Massive audit and separate trade-sourced vs aggregate-sourced exit conclusions.",
  });

  return recommendations;
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const raw = String(value);
  const text =
    typeof value === "string" && /^\s*[=+\-@]/u.test(raw)
      ? `'${raw}`
      : raw;
  return /[",\n\r]/u.test(text) ? `"${text.replace(/"/gu, '""')}"` : text;
}

function topLeaksCsv(rows: LeakRow[]): string {
  const columns: (keyof LeakRow)[] = [
    "symbol",
    "reason",
    "closedAt",
    "pnl",
    "quantity",
    "entryPrice",
    "exitPrice",
    "peakPrice",
    "postHigh",
    "highVsExitPct",
    "missedToHigh",
    "holdMinutes",
    "score",
    "mtfMatches",
    "adx",
    "premiumAtRisk",
    "finalAboveExit",
    "recoveredEntry",
  ];
  return [
    columns.join(","),
    ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(",")),
  ].join("\n");
}

function markdownTable<T extends Record<string, unknown>>(
  rows: T[],
  columns: { key: keyof T; label: string }[],
): string {
  if (!rows.length) return "No rows.";
  return [
    `| ${columns.map((column) => markdownText(column.label)).join(" | ")} |`,
    `| ${columns.map(() => "---").join(" | ")} |`,
    ...rows.map(
      (row) =>
        `| ${columns.map((column) => markdownText(row[column.key])).join(" | ")} |`,
    ),
  ].join("\n");
}

function buildMarkdown(output: ReviewOutput): string {
  const opportunity = output.summary.opportunity;
  return [
    "# Shadow Options Management Review",
    "",
    `- Generated: ${markdownText(output.summary.generatedAt)}`,
    `- Account: ${markdownText(output.summary.accountId)}`,
    `- Window: ${markdownText(output.summary.window.start)} through ${markdownText(
      output.summary.window.end,
    )}`,
    `- Report directory: ${markdownText(output.summary.reportDir)}`,
    "",
    "## Ledger Summary",
    "",
    `- Fills: ${output.summary.ledger.fills}`,
    `- Buy fills: ${output.summary.ledger.buyFills}`,
    `- Sell fills: ${output.summary.ledger.sellFills}`,
    `- Symbols: ${output.summary.ledger.symbols}`,
    `- Fill window: ${markdownText(
      output.summary.ledger.firstFillAt,
    )} to ${markdownText(output.summary.ledger.lastFillAt)}`,
    `- Realized P&L: ${output.summary.ledger.realizedPnl.toFixed(2)}`,
    `- Fees: ${output.summary.ledger.fees.toFixed(2)}`,
    `- Cash delta: ${output.summary.ledger.cashDelta.toFixed(2)}`,
    "",
    "## Opportunity Snapshot",
    "",
    `- Realized exit P&L: ${opportunity.realizedExitPnl.toFixed(2)}`,
    `- Post-exit high opportunity: ${opportunity.missedToPostExitHigh.toFixed(2)}`,
    `- Opportunity / realized ratio: ${opportunity.missedToRealizedRatio?.toFixed(2) ?? "n/a"}x`,
    `- Caveat: ${markdownText(opportunity.caveat)}`,
    "",
    "## Recommendations",
    "",
    ...output.recommendations.map(
      (item) =>
        `- **${markdownText(item.priority.toUpperCase())} ${markdownText(
          item.lane,
        )}: ${markdownText(item.title)}** ${markdownText(
          item.evidence,
        )} Next test: ${markdownText(item.nextTest)}`,
    ),
    "",
    "## Greek Management Diagnostics",
    "",
    markdownTable(output.byGreekManagement, [
      { key: "bucket", label: "Recommendation" },
      { key: "exits", label: "Exits" },
      { key: "wins", label: "Wins" },
      { key: "winPct", label: "Win %" },
      { key: "pnl", label: "P&L" },
      { key: "avgPnl", label: "Avg P&L" },
      { key: "missedToPostExitHigh", label: "Missed To High" },
      { key: "reached25AfterExit", label: "Reached +25% After Exit" },
      { key: "finalAboveExit", label: "Final > Exit" },
    ]),
    "",
    "## Exit Reasons",
    "",
    markdownTable(output.byExitReason, [
      { key: "bucket", label: "Reason" },
      { key: "exits", label: "Exits" },
      { key: "wins", label: "Wins" },
      { key: "winPct", label: "Win %" },
      { key: "pnl", label: "P&L" },
      { key: "avgPnl", label: "Avg P&L" },
      { key: "missedToPostExitHigh", label: "Missed To High" },
      { key: "reached25AfterExit", label: "Reached +25% After Exit" },
      { key: "finalAboveExit", label: "Final > Exit" },
    ]),
    "",
    "## Top Symbols",
    "",
    markdownTable(output.topSymbols.slice(0, 15), [
      { key: "symbol", label: "Symbol" },
      { key: "exits", label: "Exits" },
      { key: "wins", label: "Wins" },
      { key: "winPct", label: "Win %" },
      { key: "pnl", label: "P&L" },
      { key: "avgPnl", label: "Avg P&L" },
      { key: "missedToPostExitHigh", label: "Missed To High" },
    ]),
    "",
    "## Weak Symbols",
    "",
    markdownTable(output.weakSymbols.slice(0, 15), [
      { key: "symbol", label: "Symbol" },
      { key: "exits", label: "Exits" },
      { key: "wins", label: "Wins" },
      { key: "winPct", label: "Win %" },
      { key: "pnl", label: "P&L" },
      { key: "avgPnl", label: "Avg P&L" },
      { key: "missedToPostExitHigh", label: "Missed To High" },
    ]),
    "",
    "## Prior Sweep Evidence",
    "",
    markdownTable(output.sweepEvidence, [
      { key: "bestVariant", label: "Best Variant" },
      { key: "bestPnl", label: "P&L" },
      { key: "bestProfitFactor", label: "PF" },
      { key: "bestTrades", label: "Trades" },
      { key: "bestWinPct", label: "Win %" },
      { key: "bestMaxDrawdown", label: "Max DD" },
      { key: "window", label: "Window" },
      { key: "reportDir", label: "Report Dir" },
    ]),
    "",
    "## Largest Post-Exit Leaks",
    "",
    markdownTable(output.topLeaks.slice(0, 20), [
      { key: "symbol", label: "Symbol" },
      { key: "reason", label: "Reason" },
      { key: "closedAt", label: "Closed At" },
      { key: "pnl", label: "P&L" },
      { key: "exitPrice", label: "Exit" },
      { key: "postHigh", label: "Post High" },
      { key: "highVsExitPct", label: "High vs Exit %" },
      { key: "missedToHigh", label: "Missed $" },
      { key: "score", label: "Score" },
    ]),
    "",
    "Full row-level leak details are in `top-leaks.csv`; structured output is in `results.json`.",
    "",
  ].join("\n");
}

async function buildReview(config: Config): Promise<ReviewOutput> {
  const exitReasonBucketSql = `coalesce(
    ${jsonStringSql("o.payload", "{reason}")},
    ${jsonStringSql("o.payload", "{exitReason}")},
    'unknown'
  )`;
  const qualityBucketSql = `coalesce(
    ${jsonStringSql("o.payload", "{position,signalQuality,tier}")},
    'unknown'
  ) || ':' || coalesce(
    width_bucket(
      ${jsonNumberSql("o.payload", "{position,signalQuality,score}")},
      0,
      100,
      5
    )::text,
    'unknown'
  )`;
  const [
    ledger,
    byMonth,
    byExitReason,
    byQuality,
    byGreekManagement,
    topSymbols,
    weakSymbols,
    topLeaks,
    sweepEvidence,
  ] =
    await Promise.all([
      loadLedgerSummary(config),
      loadAggregate(config, "to_char(date_trunc('month', f.occurred_at), 'YYYY-MM')"),
      loadAggregate(config, exitReasonBucketSql),
      loadAggregate(config, qualityBucketSql),
      loadGreekManagementAggregate(config),
      loadSymbols(config, "best"),
      loadSymbols(config, "worst"),
      loadTopLeaks(config),
      readSweepEvidence(config.sweepRoot),
    ]);

  const realizedExitPnl = byExitReason.reduce((sum, row) => sum + row.pnl, 0);
  const missedToPostExitHigh = byExitReason.reduce(
    (sum, row) => sum + row.missedToPostExitHigh,
    0,
  );
  const missedToRealizedRatio =
    realizedExitPnl > 0 ? round(missedToPostExitHigh / realizedExitPnl, 2) : null;
  const recommendations = buildRecommendations({
    byExitReason,
    byGreekManagement,
    weakSymbols,
    sweepEvidence,
    opportunityRatio: missedToRealizedRatio,
  });

  return {
    summary: {
      generatedAt: new Date().toISOString(),
      accountId: config.accountId,
      window: { start: config.start, end: config.end },
      reportDir: config.reportDir,
      ledger,
      opportunity: {
        realizedExitPnl: round(realizedExitPnl, 2) ?? 0,
        missedToPostExitHigh: round(missedToPostExitHigh, 2) ?? 0,
        missedToRealizedRatio,
        caveat:
          "Post-exit highs are an upper-bound diagnostic, not capturable P&L; use them to rank management hypotheses before dry-run validation.",
      },
    },
    byMonth,
    byExitReason,
    byQuality,
    byGreekManagement,
    topSymbols,
    weakSymbols,
    topLeaks,
    sweepEvidence,
    recommendations,
  };
}

type ReportFiles = Record<"results.json" | "top-leaks.csv" | "report.md", string>;

async function assertReportDestinationAvailable(reportDir: string): Promise<void> {
  try {
    await lstat(reportDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  throw new Error(`Report destination already exists: ${reportDir}`);
}

async function publishReportFiles(reportDir: string, files: ReportFiles): Promise<void> {
  const parent = path.dirname(reportDir);
  await mkdir(parent, { recursive: true });
  const temporaryDir = await mkdtemp(
    path.join(parent, `.${path.basename(reportDir)}.tmp-`),
  );
  try {
    await Promise.all(
      Object.entries(files).map(([name, contents]) =>
        writeFile(path.join(temporaryDir, name), contents),
      ),
    );
    await rename(temporaryDir, reportDir);
  } catch (error) {
    await rm(temporaryDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

async function writeReview(output: ReviewOutput): Promise<void> {
  await publishReportFiles(output.summary.reportDir, {
    "results.json": `${JSON.stringify(output, null, 2)}\n`,
    "top-leaks.csv": `${topLeaksCsv(output.topLeaks)}\n`,
    "report.md": `${buildMarkdown(output)}\n`,
  });
}

async function main(): Promise<void> {
  const config = readConfig();
  await assertReportDestinationAvailable(config.reportDir);
  const output = await buildReview(config);
  await writeReview(output);
  console.log(
    jsonText(
      {
        reportDir: output.summary.reportDir,
        window: output.summary.window,
        fills: output.summary.ledger.fills,
        realizedExitPnl: output.summary.opportunity.realizedExitPnl,
        missedToPostExitHigh: output.summary.opportunity.missedToPostExitHigh,
        missedToRealizedRatio: output.summary.opportunity.missedToRealizedRatio,
        recommendations: output.recommendations.length,
      },
      2,
    ),
  );
}

export const __shadowOptionsManagementReviewInternalsForTests = {
  assertReportDestinationAvailable,
  csvCell,
  errorMessage,
  finiteNumber,
  jsonBooleanSql,
  jsonNumberSql,
  jsonText,
  markdownText,
  normalizeAggregateRow,
  normalizeLeakRow,
  publishReportFiles,
  readConfig,
  readSweepEvidence,
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .catch((error) => {
      console.error(errorMessage(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await pool.end();
    });
}
