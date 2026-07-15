import { pathToFileURL } from "node:url";
import { parseArgs, stripVTControlCharacters } from "node:util";

let analysisPool: typeof import("@workspace/db").pool | null = null;

type Config = {
  start: string;
  end: string;
  maxEventsPerScope: number;
  coreSymbols: string[];
};

type MatchRateRow = {
  event_scope: "entry" | "exit";
  month: string;
  symbol_tier: string;
  eligible_events: number | string;
  matched_15m: number | string;
  matched_30m: number | string;
  matched_60m: number | string;
  pct_15m: number | string | null;
  pct_30m: number | string | null;
  pct_60m: number | string | null;
  nearest_match_p50_min: number | string | null;
  nearest_match_p90_min: number | string | null;
};

type CensusRow = {
  event_scope: "entry" | "exit";
  total_events: number | string;
  eligible_events: number | string;
  missing_contract_events: number | string;
};

type SuggestionRow = {
  event_date: string;
  symbol: string;
  matched_30m: number | string;
  eligible_events: number | string;
};

type AnalysisEvent = {
  event_scope: "entry" | "exit";
  id: string;
  symbol: string;
  occurred_at: Date | string;
  expiration_date: string;
  strike: number | string;
  cp: "C" | "P";
};

type GexOptionRow = {
  symbol: string;
  computed_at: Date | string;
  expiration_date: string;
  cp: "C" | "P";
  strike: number | string;
  delta: number | string | null;
  gamma: number | string | null;
  theta: number | string | null;
  vega: number | string | null;
  implied_vol: number | string | null;
};

type GexOptionMatchRow = {
  computedAtMs: number;
  strike: number;
  localStep: number;
};

const DEFAULT_START = "2026-05-29";
const DEFAULT_END = "2026-07-07";
const DEFAULT_MAX_EVENTS_PER_SCOPE = 1_000;
const MAX_EVENTS_PER_SCOPE = 200_000;
const DEFAULT_CORE_SYMBOLS = "SPY,QQQ,IWM,DIA";
const MAX_DIAGNOSTIC_LENGTH = 500;
// ponytail: 64 characters is the persisted decimal-text ceiling; raise it only
// with a wider contract format and an overflow regression test.
const MAX_PERSISTED_DECIMAL_TEXT_LENGTH = 64;
const UNSAFE_OUTPUT_PATTERN =
  /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;
const USAGE =
  "Usage: pnpm --filter @workspace/scripts exec tsx ./src/signal-options-gex-match-rate-analysis.ts [--start=YYYY-MM-DD] [--end=YYYY-MM-DD] [--max-events-per-scope=COUNT] [--core-symbols=SYMBOL,...]";

function pool() {
  if (!analysisPool)
    throw new Error("GEX analysis database is not configured.");
  return analysisPool;
}

function safeDiagnostic(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const redacted = raw
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^@\s]+@/giu, "$1[redacted]@")
    .replace(
      /([?&](?:api[_-]?key|access[_-]?token|token|password|secret)=)[^&#\s]*/giu,
      "$1[redacted]",
    );
  const cleaned = stripVTControlCharacters(redacted)
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  const diagnostic = cleaned || "Unknown GEX analysis error";
  return diagnostic.length <= MAX_DIAGNOSTIC_LENGTH
    ? diagnostic
    : `${diagnostic.slice(0, MAX_DIAGNOSTIC_LENGTH - 1)}…`;
}

function canonicalDate(value: string, name: "start" | "end"): string {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw new Error(`--${name} must use YYYY-MM-DD.`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new Error(`--${name} is not a calendar date.`);
  }
  return value;
}

function positiveInteger(value: string | undefined): number {
  if (value === undefined) return DEFAULT_MAX_EVENTS_PER_SCOPE;
  if (!/^[1-9]\d*$/u.test(value)) {
    throw new Error(
      "--max-events-per-scope must be a positive decimal integer.",
    );
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > MAX_EVENTS_PER_SCOPE) {
    throw new Error(
      `--max-events-per-scope must be at most ${MAX_EVENTS_PER_SCOPE}.`,
    );
  }
  return parsed;
}

function readConfig(
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): Config {
  try {
    const parsed = parseArgs({
      args: argv[0] === "--" ? argv.slice(1) : argv,
      allowPositionals: false,
      strict: true,
      tokens: true,
      options: {
        start: { type: "string" },
        end: { type: "string" },
        "max-events-per-scope": { type: "string" },
        "core-symbols": { type: "string" },
      },
    });
    const optionCounts = new Map<string, number>();
    for (const token of parsed.tokens) {
      if (token.kind !== "option") continue;
      optionCounts.set(token.name, (optionCounts.get(token.name) ?? 0) + 1);
    }
    if ([...optionCounts.values()].some((count) => count > 1)) {
      throw new Error("Duplicate options are not allowed.");
    }

    const start = canonicalDate(
      parsed.values.start ??
        env["SIGNAL_OPTIONS_GEX_ANALYSIS_START"] ??
        DEFAULT_START,
      "start",
    );
    const end = canonicalDate(
      parsed.values.end ??
        env["SIGNAL_OPTIONS_GEX_ANALYSIS_END"] ??
        DEFAULT_END,
      "end",
    );
    if (start >= end)
      throw new Error("--start must be before the exclusive --end.");

    const rawSymbols =
      parsed.values["core-symbols"] ??
      env["SIGNAL_OPTIONS_GEX_ANALYSIS_CORE_SYMBOLS"] ??
      DEFAULT_CORE_SYMBOLS;
    const symbolParts = rawSymbols.split(",").map((symbol) => symbol.trim());
    if (!symbolParts.length || symbolParts.some((symbol) => !symbol)) {
      throw new Error(
        "--core-symbols must contain non-empty comma-separated symbols.",
      );
    }
    if (symbolParts.some((symbol) => UNSAFE_OUTPUT_PATTERN.test(symbol))) {
      throw new Error("--core-symbols contains unsafe control characters.");
    }
    const coreSymbols = symbolParts.map((symbol) => symbol.toUpperCase());
    if (new Set(coreSymbols).size !== coreSymbols.length) {
      throw new Error("--core-symbols must not contain duplicates.");
    }

    return {
      start,
      end,
      maxEventsPerScope: positiveInteger(
        parsed.values["max-events-per-scope"] ??
          env["SIGNAL_OPTIONS_GEX_ANALYSIS_MAX_EVENTS_PER_SCOPE"],
      ),
      coreSymbols,
    };
  } catch (error) {
    throw new Error(`${USAGE}\n${safeDiagnostic(error)}`);
  }
}

function numberValue(value: number | string | null): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function percentCell(value: number | string | null): string {
  const parsed = numberValue(value);
  return parsed == null ? "-" : `${(parsed * 100).toFixed(1)}%`;
}

function integerCell(value: number | string | null): string {
  const parsed = numberValue(value);
  return parsed == null ? "-" : String(Math.round(parsed));
}

function numberCell(value: number | string | null, digits = 1): string {
  const parsed = numberValue(value);
  return parsed == null ? "-" : parsed.toFixed(digits);
}

function cell(value: unknown): string {
  return (
    stripVTControlCharacters(String(value ?? "-"))
      .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu, " ")
      .replaceAll("|", "\\|")
      .replace(/\s+/gu, " ")
      .trim() || "-"
  );
}

function renderTable(headers: string[], rows: string[][]): string {
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(cell).join(" | ")} |`),
  ].join("\n");
}

const SELECTED_CONTRACT_SQL = `
coalesce(
  case
    when jsonb_typeof(payload->'selectedContract') = 'object'
      and payload->'selectedContract' <> '{}'::jsonb
      then payload->'selectedContract'
    else null
  end,
  case
    when jsonb_typeof(payload#>'{position,selectedContract}') = 'object'
      and payload#>'{position,selectedContract}' <> '{}'::jsonb
      then payload#>'{position,selectedContract}'
    else null
  end,
  case
    when jsonb_typeof(payload#>'{candidate,selectedContract}') = 'object'
      and payload#>'{candidate,selectedContract}' <> '{}'::jsonb
      then payload#>'{candidate,selectedContract}'
    else null
  end
)`;

const EVENTS_CTE = `
with event_scopes(event_scope, event_type) as (
  values
    ('entry'::text, 'signal_options_shadow_entry'::text),
    ('exit'::text, 'signal_options_shadow_exit'::text)
), raw_events as (
  select
    event_scopes.event_scope,
    e.id,
    upper(e.symbol) as symbol,
    e.occurred_at,
    ${SELECTED_CONTRACT_SQL} as selected_contract,
    row_number() over (
      partition by event_scopes.event_scope
      order by e.occurred_at desc, e.id desc
    ) as scope_rank
  from execution_events e
  join event_scopes on event_scopes.event_type = e.event_type
  where e.occurred_at >= $1::timestamptz
    and e.occurred_at < $2::timestamptz
    and e.symbol is not null
), bounded_events as (
  select *
  from raw_events
  where scope_rank <= $3::int
), parsed_events as (
  select
    event_scope,
    id,
    symbol,
    occurred_at,
    selected_contract,
    nullif(selected_contract->>'expirationDate', '') as expiration_date,
    case
      when selected_contract->>'strike' ~ '^-?[0-9]+(\\.[0-9]+)?$'
        and length(selected_contract->>'strike') <= ${MAX_PERSISTED_DECIMAL_TEXT_LENGTH}
        then selected_contract->>'strike'
      else null
    end as strike,
    case lower(coalesce(selected_contract->>'right', ''))
      when 'call' then 'C'
      when 'c' then 'C'
      when 'put' then 'P'
      when 'p' then 'P'
      else null
    end as cp
  from bounded_events
)`;

function eventQueryParameters(config: Config): [Date, Date, number] {
  return [
    new Date(`${config.start}T00:00:00.000Z`),
    new Date(`${config.end}T00:00:00.000Z`),
    config.maxEventsPerScope,
  ];
}

async function loadCensus(config: Config): Promise<CensusRow[]> {
  const result = await pool().query<CensusRow>(
    `
${EVENTS_CTE}
select
  event_scope,
  count(*)::int as total_events,
  count(*) filter (
    where selected_contract is not null
      and expiration_date is not null
      and strike is not null
      and cp is not null
  )::int as eligible_events,
  count(*) filter (
    where selected_contract is null
      or expiration_date is null
      or strike is null
      or cp is null
  )::int as missing_contract_events
from parsed_events
group by event_scope
order by event_scope
    `,
    eventQueryParameters(config),
  );
  return result.rows;
}

async function loadEligibleEvents(config: Config): Promise<AnalysisEvent[]> {
  const result = await pool().query<AnalysisEvent>(
    `
${EVENTS_CTE}
select
  event_scope,
  id::text as id,
  symbol,
  occurred_at,
  expiration_date,
  strike,
  cp
from parsed_events
where selected_contract is not null
  and expiration_date is not null
  and strike is not null
  and cp is not null
order by occurred_at, symbol, id
    `,
    eventQueryParameters(config),
  );
  return result.rows;
}

async function loadGexOptionsForSlice(input: {
  from: Date;
  to: Date;
  symbols: string[];
}): Promise<GexOptionRow[]> {
  if (!input.symbols.length) return [];
  const result = await pool().query<GexOptionRow>(
    `
select distinct
  upper(g.symbol) as symbol,
  g.computed_at,
  option_row->>'expirationDate' as expiration_date,
  option_row->>'cp' as cp,
  option_row->>'strike' as strike,
  option_row->>'delta' as delta,
  option_row->>'gamma' as gamma,
  option_row->>'theta' as theta,
  option_row->>'vega' as vega,
  coalesce(option_row->>'impliedVol', option_row->>'impliedVolatility') as implied_vol
from gex_snapshots g
join lateral jsonb_array_elements(
  case
    when jsonb_typeof(g.payload->'options') = 'array'
      then g.payload->'options'
    else '[]'::jsonb
  end
) as option_row on true
where g.computed_at >= $1::timestamptz
  and g.computed_at < $2::timestamptz
  and upper(g.symbol) = any($3::text[])
  and jsonb_typeof(option_row) = 'object'
  and option_row->>'expirationDate' is not null
  and option_row->>'cp' in ('C', 'P')
  and option_row->>'strike' ~ '^-?[0-9]+(\\.[0-9]+)?$'
  and length(option_row->>'strike') <= ${MAX_PERSISTED_DECIMAL_TEXT_LENGTH}
    `,
    [input.from, input.to, input.symbols],
  );
  return result.rows;
}

function dayKeyFromTime(timeMs: number): string {
  return new Date(timeMs).toISOString().slice(0, 10);
}

function monthKeyFromTime(timeMs: number): string {
  return new Date(timeMs).toISOString().slice(0, 7);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60_000);
}

function dateRangeDays(start: string, end: string): Date[] {
  const days: Date[] = [];
  let cursor = new Date(`${start}T00:00:00.000Z`);
  const stop = new Date(`${end}T00:00:00.000Z`);
  while (cursor.getTime() < stop.getTime()) {
    days.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return days;
}

function finiteNumber(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function gexKey(input: {
  symbol: string;
  expirationDate: string;
  cp: string;
}): string {
  return `${input.symbol}|${input.expirationDate}|${input.cp}`;
}

function buildGexOptionIndex(
  rows: GexOptionRow[],
): Map<string, GexOptionMatchRow[]> {
  const grouped = new Map<
    string,
    Map<number, { listed: Set<number>; usable: Set<number> }>
  >();
  for (const row of rows) {
    const strike = finiteNumber(row.strike);
    const computedAtMs = new Date(row.computed_at).getTime();
    if (strike == null || !Number.isFinite(computedAtMs)) continue;
    const key = gexKey({
      symbol: row.symbol,
      expirationDate: row.expiration_date,
      cp: row.cp,
    });
    let bySnapshot = grouped.get(key);
    if (!bySnapshot) {
      bySnapshot = new Map();
      grouped.set(key, bySnapshot);
    }
    let strikes = bySnapshot.get(computedAtMs);
    if (!strikes) {
      strikes = { listed: new Set(), usable: new Set() };
      bySnapshot.set(computedAtMs, strikes);
    }
    strikes.listed.add(strike);
    const impliedVolatility = finiteNumber(row.implied_vol);
    if (
      finiteNumber(row.delta) != null &&
      finiteNumber(row.gamma) != null &&
      finiteNumber(row.theta) != null &&
      finiteNumber(row.vega) != null &&
      impliedVolatility != null &&
      impliedVolatility > 0
    ) {
      strikes.usable.add(strike);
    }
  }

  const index = new Map<string, GexOptionMatchRow[]>();
  for (const [key, bySnapshot] of grouped.entries()) {
    const options: GexOptionMatchRow[] = [];
    for (const [computedAtMs, strikeSets] of bySnapshot.entries()) {
      const listed = Array.from(strikeSets.listed).sort(
        (left, right) => left - right,
      );
      for (let strikeIndex = 0; strikeIndex < listed.length; strikeIndex += 1) {
        const strike = listed[strikeIndex]!;
        if (!strikeSets.usable.has(strike)) continue;
        const prevStrike = listed[strikeIndex - 1] ?? null;
        const nextStrike = listed[strikeIndex + 1] ?? null;
        const localStep =
          prevStrike == null && nextStrike == null
            ? 0.001
            : prevStrike == null
              ? nextStrike! - strike
              : nextStrike == null
                ? strike - prevStrike
                : Math.min(strike - prevStrike, nextStrike - strike);
        options.push({
          computedAtMs,
          strike,
          localStep: Math.max(localStep, 0.001),
        });
      }
    }
    index.set(key, options);
  }
  return index;
}

function nearestGexMatchMs(input: {
  event: AnalysisEvent;
  eventTimeMs: number;
  optionsByKey: Map<string, GexOptionMatchRow[]>;
  toleranceMs: number;
  exactStrikeOnly: boolean;
}): number | null {
  const strike = finiteNumber(input.event.strike);
  if (strike == null) return null;
  const rows =
    input.optionsByKey.get(
      gexKey({
        symbol: input.event.symbol,
        expirationDate: input.event.expiration_date,
        cp: input.event.cp,
      }),
    ) ?? [];
  let nearest: number | null = null;
  for (const row of rows) {
    const ageMs = Math.abs(row.computedAtMs - input.eventTimeMs);
    if (ageMs > input.toleranceMs) continue;
    const strikeDistance = Math.abs(row.strike - strike);
    const strikeMatches = input.exactStrikeOnly
      ? strikeDistance <= 0.001
      : strikeDistance <= row.localStep;
    if (!strikeMatches) continue;
    nearest = nearest == null ? ageMs : Math.min(nearest, ageMs);
  }
  return nearest;
}

function percentile(values: number[], pct: number): number | null {
  if (!values.length) return null;
  const sorted = values.slice().sort((left, right) => left - right);
  const index = (sorted.length - 1) * pct;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower]!;
  const weight = index - lower;
  return sorted[lower]! * (1 - weight) + sorted[upper]! * weight;
}

function emptyMatchAggregate() {
  return {
    eligible: 0,
    matched15: 0,
    matched30: 0,
    matched60: 0,
    nearestMinutes: [] as number[],
  };
}

async function buildDailySlicedAnalysis(config: Config): Promise<{
  matchRates: MatchRateRow[];
  suggestions: SuggestionRow[];
}> {
  const events = await loadEligibleEvents(config);
  const eventsByDay = new Map<string, AnalysisEvent[]>();
  for (const event of events) {
    const eventTimeMs = new Date(event.occurred_at).getTime();
    if (!Number.isFinite(eventTimeMs)) continue;
    const dayKey = dayKeyFromTime(eventTimeMs);
    const dayEvents = eventsByDay.get(dayKey) ?? [];
    dayEvents.push(event);
    eventsByDay.set(dayKey, dayEvents);
  }

  const aggregates = new Map<string, ReturnType<typeof emptyMatchAggregate>>();
  const suggestions = new Map<
    string,
    { matched30: number; eligible: number }
  >();
  const coreSymbols = new Set(config.coreSymbols);

  for (const day of dateRangeDays(config.start, config.end)) {
    const dayKey = day.toISOString().slice(0, 10);
    const dayEvents = eventsByDay.get(dayKey) ?? [];
    if (!dayEvents.length) continue;
    const symbols = Array.from(
      new Set(dayEvents.map((event) => event.symbol)),
    ).sort();
    const gexRows = await loadGexOptionsForSlice({
      from: new Date(day.getTime() - 60 * 60_000),
      to: new Date(addDays(day, 1).getTime() + 60 * 60_000),
      symbols,
    });
    const gexIndex = buildGexOptionIndex(gexRows);

    for (const event of dayEvents) {
      const eventTimeMs = new Date(event.occurred_at).getTime();
      if (!Number.isFinite(eventTimeMs)) continue;
      const tier = coreSymbols.has(event.symbol) ? "SPY_QQQ_like" : "long_tail";
      const aggregateKey = `${event.event_scope}|${monthKeyFromTime(eventTimeMs)}|${tier}`;
      const aggregate = aggregates.get(aggregateKey) ?? emptyMatchAggregate();
      aggregate.eligible += 1;
      const nearestMs = nearestGexMatchMs({
        event,
        eventTimeMs,
        optionsByKey: gexIndex,
        toleranceMs: 60 * 60_000,
        exactStrikeOnly: false,
      });
      if (nearestMs != null) {
        aggregate.nearestMinutes.push(nearestMs / 60_000);
        if (nearestMs <= 15 * 60_000) aggregate.matched15 += 1;
        if (nearestMs <= 30 * 60_000) aggregate.matched30 += 1;
        aggregate.matched60 += 1;
      }
      aggregates.set(aggregateKey, aggregate);

      if (event.event_scope === "entry") {
        const suggestionKey = `${dayKey}|${event.symbol}`;
        const suggestion = suggestions.get(suggestionKey) ?? {
          matched30: 0,
          eligible: 0,
        };
        suggestion.eligible += 1;
        const exactNearestMs = nearestGexMatchMs({
          event,
          eventTimeMs,
          optionsByKey: gexIndex,
          toleranceMs: 30 * 60_000,
          exactStrikeOnly: true,
        });
        if (exactNearestMs != null) suggestion.matched30 += 1;
        suggestions.set(suggestionKey, suggestion);
      }
    }
  }

  const matchRates = Array.from(aggregates.entries())
    .map(([key, aggregate]) => {
      const [event_scope, month, symbol_tier] = key.split("|") as [
        "entry" | "exit",
        string,
        string,
      ];
      return {
        event_scope,
        month,
        symbol_tier,
        eligible_events: aggregate.eligible,
        matched_15m: aggregate.matched15,
        matched_30m: aggregate.matched30,
        matched_60m: aggregate.matched60,
        pct_15m: aggregate.eligible
          ? aggregate.matched15 / aggregate.eligible
          : null,
        pct_30m: aggregate.eligible
          ? aggregate.matched30 / aggregate.eligible
          : null,
        pct_60m: aggregate.eligible
          ? aggregate.matched60 / aggregate.eligible
          : null,
        nearest_match_p50_min: percentile(aggregate.nearestMinutes, 0.5),
        nearest_match_p90_min: percentile(aggregate.nearestMinutes, 0.9),
      } satisfies MatchRateRow;
    })
    .sort(
      (left, right) =>
        left.event_scope.localeCompare(right.event_scope) ||
        left.month.localeCompare(right.month) ||
        left.symbol_tier.localeCompare(right.symbol_tier),
    );

  const suggestionRows = Array.from(suggestions.entries())
    .map(([key, suggestion]) => {
      const [event_date, symbol] = key.split("|") as [string, string];
      return {
        event_date,
        symbol,
        matched_30m: suggestion.matched30,
        eligible_events: suggestion.eligible,
      } satisfies SuggestionRow;
    })
    .filter((row) => Number(row.matched_30m) > 0)
    .sort(
      (left, right) =>
        Number(right.matched_30m) - Number(left.matched_30m) ||
        Number(right.eligible_events) - Number(left.eligible_events) ||
        right.event_date.localeCompare(left.event_date) ||
        left.symbol.localeCompare(right.symbol),
    )
    .slice(0, 12);

  return { matchRates, suggestions: suggestionRows };
}

function renderCensus(rows: CensusRow[]): string {
  return renderTable(
    ["Scope", "Analyzed Events (capped)", "Eligible", "Missing Contract"],
    rows.map((row) => [
      row.event_scope,
      integerCell(row.total_events),
      integerCell(row.eligible_events),
      integerCell(row.missing_contract_events),
    ]),
  );
}

function censusCapWarning(rows: CensusRow[], limit: number): string | null {
  const scopes = rows
    .filter((row) => (numberValue(row.total_events) ?? -1) >= limit)
    .map((row) => row.event_scope);
  return scopes.length
    ? `Cap warning: ${scopes.join(", ")} reached ${limit} analyzed events; its census and match rates may be truncated.`
    : null;
}

function renderMatchRates(rows: MatchRateRow[]): string {
  return renderTable(
    [
      "Scope",
      "Month",
      "Tier",
      "Eligible",
      "15m",
      "15m %",
      "30m",
      "30m %",
      "60m",
      "60m %",
      "Nearest P50 Min",
      "Nearest P90 Min",
    ],
    rows.map((row) => [
      row.event_scope,
      row.month,
      row.symbol_tier,
      integerCell(row.eligible_events),
      integerCell(row.matched_15m),
      percentCell(row.pct_15m),
      integerCell(row.matched_30m),
      percentCell(row.pct_30m),
      integerCell(row.matched_60m),
      percentCell(row.pct_60m),
      numberCell(row.nearest_match_p50_min),
      numberCell(row.nearest_match_p90_min),
    ]),
  );
}

function renderSuggestions(rows: SuggestionRow[]): string {
  if (!rows.length) return "No exact-contract entry matches found within 30m.";
  return renderTable(
    ["Date", "Symbol", "Exact 30m Matches", "Eligible Entries"],
    rows.map((row) => [
      row.event_date,
      row.symbol,
      integerCell(row.matched_30m),
      integerCell(row.eligible_events),
    ]),
  );
}

export const __signalOptionsGexMatchRateAnalysisInternalsForTests = {
  buildGexOptionIndex,
  censusCapWarning,
  eventQueryParameters,
  finiteNumber,
  nearestGexMatchMs,
  readConfig,
};

async function main() {
  const config = readConfig();
  analysisPool = (await import("@workspace/db")).pool;
  const census = await loadCensus(config);
  const { matchRates, suggestions } = await buildDailySlicedAnalysis(config);
  const capWarning = censusCapWarning(census, config.maxEventsPerScope);
  const lines = [
    "# Signal Options GEX Match-Rate Analysis",
    "",
    `- Window: ${config.start} inclusive to ${config.end} exclusive`,
    `- Max events per scope: ${config.maxEventsPerScope}`,
    ...(capWarning ? [`- ${capWarning}`] : []),
    `- SPY/QQQ-like tier symbols: ${config.coreSymbols.join(", ")}`,
    `- GEX evidence rule: matching contract row with finite delta/gamma/theta/vega and positive implied volatility`,
    `- Strike rule: matching expiration/right and nearest listed GEX strike within one local strike step`,
    "",
    "## Event Census",
    "",
    renderCensus(census),
    "",
    "## Match Rates",
    "",
    renderMatchRates(matchRates),
    "",
    "## Smoke Suggestions",
    "",
    renderSuggestions(suggestions),
  ];
  console.log(`${lines.join("\n")}\n`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main()
    .catch((error) => {
      console.error(safeDiagnostic(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      try {
        await analysisPool?.end();
      } catch (error) {
        console.error(safeDiagnostic(error));
        process.exitCode = 1;
      }
    });
}
