import { pathToFileURL } from "node:url";
import { pool } from "@workspace/db";

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
};

type GexOptionMatchRow = {
  computedAtMs: number;
  strike: number;
  localStep: number;
};

function argValue(name: string): string | null {
  const prefix = `--${name}=`;
  const match = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : null;
}

function readInteger(value: string | undefined | null, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(max, Math.floor(parsed));
}

function readConfig(): Config {
  const start =
    argValue("start") ??
    process.env["SIGNAL_OPTIONS_GEX_ANALYSIS_START"] ??
    "2026-05-29";
  const end =
    argValue("end") ??
    process.env["SIGNAL_OPTIONS_GEX_ANALYSIS_END"] ??
    "2026-07-07";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    throw new Error("Use --start=YYYY-MM-DD and --end=YYYY-MM-DD.");
  }
  const coreSymbols = (
    argValue("core-symbols") ??
    process.env["SIGNAL_OPTIONS_GEX_ANALYSIS_CORE_SYMBOLS"] ??
    "SPY,QQQ,IWM,DIA"
  )
    .split(",")
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean);
  return {
    start,
    end,
    maxEventsPerScope: readInteger(
      argValue("max-events-per-scope") ??
        process.env["SIGNAL_OPTIONS_GEX_ANALYSIS_MAX_EVENTS_PER_SCOPE"],
      1_000,
      200_000,
    ),
    coreSymbols,
  };
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
  return String(value ?? "-").replaceAll("|", "\\|").replace(/\s+/g, " ").trim() || "-";
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
        then (selected_contract->>'strike')::double precision
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

async function loadCensus(config: Config): Promise<CensusRow[]> {
  const result = await pool.query<CensusRow>(
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
    [config.start, config.end, config.maxEventsPerScope],
  );
  return result.rows;
}

async function loadEligibleEvents(config: Config): Promise<AnalysisEvent[]> {
  const result = await pool.query<AnalysisEvent>(
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
    [config.start, config.end, config.maxEventsPerScope],
  );
  return result.rows;
}

async function loadGexOptionsForSlice(input: {
  from: Date;
  to: Date;
  symbols: string[];
}): Promise<GexOptionRow[]> {
  if (!input.symbols.length) return [];
  const result = await pool.query<GexOptionRow>(
    `
select distinct
  upper(g.symbol) as symbol,
  g.computed_at,
  option_row->>'expirationDate' as expiration_date,
  option_row->>'cp' as cp,
  (option_row->>'strike')::double precision as strike
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
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function gexKey(input: { symbol: string; expirationDate: string; cp: string }): string {
  return `${input.symbol}|${input.expirationDate}|${input.cp}`;
}

function buildGexOptionIndex(rows: GexOptionRow[]): Map<string, GexOptionMatchRow[]> {
  const grouped = new Map<string, Map<number, Set<number>>>();
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
      bySnapshot = new Map<number, Set<number>>();
      grouped.set(key, bySnapshot);
    }
    let strikes = bySnapshot.get(computedAtMs);
    if (!strikes) {
      strikes = new Set<number>();
      bySnapshot.set(computedAtMs, strikes);
    }
    strikes.add(strike);
  }

  const index = new Map<string, GexOptionMatchRow[]>();
  for (const [key, bySnapshot] of grouped.entries()) {
    const options: GexOptionMatchRow[] = [];
    for (const [computedAtMs, strikeSet] of bySnapshot.entries()) {
      const strikes = Array.from(strikeSet).sort((left, right) => left - right);
      for (let index = 0; index < strikes.length; index += 1) {
        const strike = strikes[index]!;
        const prevStrike = strikes[index - 1] ?? null;
        const nextStrike = strikes[index + 1] ?? null;
        const localStep =
          prevStrike == null && nextStrike == null
            ? 0.001
            : prevStrike == null
              ? nextStrike! - strike
              : nextStrike == null
                ? strike - prevStrike
                : Math.min(strike - prevStrike, nextStrike - strike);
        options.push({ computedAtMs, strike, localStep: Math.max(localStep, 0.001) });
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
  const suggestions = new Map<string, { matched30: number; eligible: number }>();
  const coreSymbols = new Set(config.coreSymbols);

  for (const day of dateRangeDays(config.start, config.end)) {
    const dayKey = day.toISOString().slice(0, 10);
    const dayEvents = eventsByDay.get(dayKey) ?? [];
    if (!dayEvents.length) continue;
    const symbols = Array.from(new Set(dayEvents.map((event) => event.symbol))).sort();
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
        pct_15m: aggregate.eligible ? aggregate.matched15 / aggregate.eligible : null,
        pct_30m: aggregate.eligible ? aggregate.matched30 / aggregate.eligible : null,
        pct_60m: aggregate.eligible ? aggregate.matched60 / aggregate.eligible : null,
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

async function loadMatchRates(config: Config): Promise<MatchRateRow[]> {
  const result = await pool.query<MatchRateRow>(
    `
${EVENTS_CTE}, eligible_events as (
  select *
  from parsed_events
  where selected_contract is not null
    and expiration_date is not null
    and strike is not null
    and cp is not null
), gex_option_rows as materialized (
  select distinct
    upper(g.symbol) as symbol,
    g.computed_at,
    option_row->>'expirationDate' as expiration_date,
    option_row->>'cp' as cp,
    (option_row->>'strike')::double precision as strike
  from gex_snapshots g
  join lateral jsonb_array_elements(
    case
      when jsonb_typeof(g.payload->'options') = 'array'
        then g.payload->'options'
      else '[]'::jsonb
    end
  ) as option_row on true
  where g.computed_at >= $1::timestamptz - interval '60 minutes'
    and g.computed_at < $2::timestamptz + interval '60 minutes'
    and jsonb_typeof(option_row) = 'object'
    and option_row->>'expirationDate' is not null
    and option_row->>'cp' in ('C', 'P')
    and option_row->>'strike' ~ '^-?[0-9]+(\\.[0-9]+)?$'
), gex_option_steps as (
  select
    symbol,
    computed_at,
    expiration_date,
    cp,
    strike,
    lag(strike) over (
      partition by symbol, computed_at, expiration_date, cp
      order by strike
    ) as prev_strike,
    lead(strike) over (
      partition by symbol, computed_at, expiration_date, cp
      order by strike
    ) as next_strike
  from gex_option_rows
), gex_options as materialized (
  select
    symbol,
    computed_at,
    expiration_date,
    cp,
    strike,
    case
      when prev_strike is null and next_strike is null then 0.001
      when prev_strike is null then next_strike - strike
      when next_strike is null then strike - prev_strike
      else least(strike - prev_strike, next_strike - strike)
    end as local_step
  from gex_option_steps
), matched_events as (
  select
    eligible_events.*,
    min(abs(extract(epoch from (gex_options.computed_at - eligible_events.occurred_at)) * 1000)) as nearest_match_ms
  from eligible_events
  left join gex_options on gex_options.symbol = eligible_events.symbol
    and gex_options.expiration_date = eligible_events.expiration_date
    and gex_options.cp = eligible_events.cp
    and gex_options.computed_at between
      eligible_events.occurred_at - interval '60 minutes'
      and eligible_events.occurred_at + interval '60 minutes'
    and abs(gex_options.strike - eligible_events.strike)
      <= greatest(coalesce(gex_options.local_step, 0), 0.001)
  group by
    eligible_events.event_scope,
    eligible_events.id,
    eligible_events.symbol,
    eligible_events.occurred_at,
    eligible_events.selected_contract,
    eligible_events.expiration_date,
    eligible_events.strike,
    eligible_events.cp
)
select
  event_scope,
  to_char(date_trunc('month', occurred_at), 'YYYY-MM') as month,
  case when symbol = any($4::text[]) then 'SPY_QQQ_like' else 'long_tail' end as symbol_tier,
  count(*)::int as eligible_events,
  count(*) filter (where nearest_match_ms <= 15 * 60 * 1000)::int as matched_15m,
  count(*) filter (where nearest_match_ms <= 30 * 60 * 1000)::int as matched_30m,
  count(*) filter (where nearest_match_ms <= 60 * 60 * 1000)::int as matched_60m,
  (count(*) filter (where nearest_match_ms <= 15 * 60 * 1000))::double precision / nullif(count(*), 0) as pct_15m,
  (count(*) filter (where nearest_match_ms <= 30 * 60 * 1000))::double precision / nullif(count(*), 0) as pct_30m,
  (count(*) filter (where nearest_match_ms <= 60 * 60 * 1000))::double precision / nullif(count(*), 0) as pct_60m,
  percentile_cont(0.5) within group (order by nearest_match_ms / 60000.0)
    filter (where nearest_match_ms is not null) as nearest_match_p50_min,
  percentile_cont(0.9) within group (order by nearest_match_ms / 60000.0)
    filter (where nearest_match_ms is not null) as nearest_match_p90_min
from matched_events
group by event_scope, month, symbol_tier
order by event_scope, month, symbol_tier
    `,
    [config.start, config.end, config.maxEventsPerScope, config.coreSymbols],
  );
  return result.rows;
}

async function loadSmokeSuggestions(config: Config): Promise<SuggestionRow[]> {
  const result = await pool.query<SuggestionRow>(
    `
${EVENTS_CTE}, eligible_events as (
  select *
  from parsed_events
  where event_scope = 'entry'
    and selected_contract is not null
    and expiration_date is not null
    and strike is not null
    and cp is not null
), gex_option_rows as materialized (
  select distinct
    upper(g.symbol) as symbol,
    g.computed_at,
    option_row->>'expirationDate' as expiration_date,
    option_row->>'cp' as cp,
    (option_row->>'strike')::double precision as strike
  from gex_snapshots g
  join lateral jsonb_array_elements(
    case
      when jsonb_typeof(g.payload->'options') = 'array'
        then g.payload->'options'
      else '[]'::jsonb
    end
  ) as option_row on true
  where g.computed_at >= $1::timestamptz - interval '30 minutes'
    and g.computed_at < $2::timestamptz + interval '30 minutes'
    and jsonb_typeof(option_row) = 'object'
    and option_row->>'expirationDate' is not null
    and option_row->>'cp' in ('C', 'P')
    and option_row->>'strike' ~ '^-?[0-9]+(\\.[0-9]+)?$'
), matched_events as (
  select
    eligible_events.*,
    min(abs(extract(epoch from (gex_option_rows.computed_at - eligible_events.occurred_at)) * 1000)) as nearest_match_ms
  from eligible_events
  left join gex_option_rows on gex_option_rows.symbol = eligible_events.symbol
    and gex_option_rows.expiration_date = eligible_events.expiration_date
    and gex_option_rows.cp = eligible_events.cp
    and gex_option_rows.computed_at between
      eligible_events.occurred_at - interval '30 minutes'
      and eligible_events.occurred_at + interval '30 minutes'
    and abs(gex_option_rows.strike - eligible_events.strike) <= 0.001
  group by
    eligible_events.event_scope,
    eligible_events.id,
    eligible_events.symbol,
    eligible_events.occurred_at,
    eligible_events.selected_contract,
    eligible_events.expiration_date,
    eligible_events.strike,
    eligible_events.cp
)
select
  occurred_at::date::text as event_date,
  symbol,
  count(*) filter (where nearest_match_ms is not null)::int as matched_30m,
  count(*)::int as eligible_events
from matched_events
group by event_date, symbol
having count(*) filter (where nearest_match_ms is not null) > 0
order by matched_30m desc, eligible_events desc, event_date desc, symbol
limit 12
    `,
    [config.start, config.end, config.maxEventsPerScope],
  );
  return result.rows;
}

function renderCensus(rows: CensusRow[]): string {
  return renderTable(
    ["Scope", "Total Events", "Eligible", "Missing Contract"],
    rows.map((row) => [
      row.event_scope,
      integerCell(row.total_events),
      integerCell(row.eligible_events),
      integerCell(row.missing_contract_events),
    ]),
  );
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

async function main() {
  const config = readConfig();
  const census = await loadCensus(config);
  const { matchRates, suggestions } = await buildDailySlicedAnalysis(config);
  const lines = [
    "# Signal Options GEX Match-Rate Analysis",
    "",
    `- Window: ${config.start} inclusive to ${config.end} exclusive`,
    `- Max events per scope: ${config.maxEventsPerScope}`,
    `- SPY/QQQ-like tier symbols: ${config.coreSymbols.join(", ")}`,
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await pool.end();
    });
}
