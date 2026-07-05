import { sql } from "drizzle-orm";

import {
  db,
  signalUniverseRankingsTable,
  universeCatalogListingsTable,
} from "@workspace/db";
import { resolvePreviousUsEquitySessionClose } from "@workspace/market-calendar";

import { logger } from "../lib/logger";
import { getMassiveRuntimeConfig } from "../lib/runtime";
import { normalizeSymbol } from "../lib/values";
import {
  MassiveMarketDataClient,
  type StockGroupedDailyAggregate,
} from "../providers/massive/market-data";

// Curated signal-universe ranking: replaces the alphabetical catalog fill of
// the signal-monitor expansion universe with a stored, liquidity+volatility
// ranked order. The user-locked spec: optionable equities are a HARD GATE;
// score = 50/50 blend of rank-percentile dollar-volume and rank-percentile
// intraday volatility over a trailing ~20 completed sessions, sourced from
// grouped-daily aggregates (ONE provider call per session — never a
// per-symbol snapshot fan-out, which is what caps the high-beta path);
// exclusions (fixed income incl. bond ETFs, preferred/warrants/rights/units,
// SPACs, OTC) persist a reason so every drop is auditable and reversible;
// leveraged/inverse ETFs are deliberately KEPT ("most volatility +
// optionable"). Membership is hysteresis-banded so the top-2000 set cannot
// thrash the bar caches/backfill on borderline rank flips: current members
// survive until they fall below RETAIN_RANK while entrants must clear
// ENTRANT_RANK. Ranks refresh once per COMPLETED session (post-close — a
// partial current day is never used); the expansion query falls back to the
// prior alphabetical order whenever no ranking rows exist.

const SIGNAL_UNIVERSE_TRAILING_SESSIONS = 20;
// Refuse to rank on a too-thin window (provider outage/backfill gaps) — the
// stored order from the previous good run stays authoritative instead.
const SIGNAL_UNIVERSE_MIN_SESSIONS = 10;
// A symbol must trade in at least this many of the collected sessions to be
// scored; sparser rows (fresh IPOs, halts) are marked insufficient_data.
const SIGNAL_UNIVERSE_MIN_SYMBOL_SESSIONS = 5;
const SIGNAL_UNIVERSE_ENTRANT_RANK = 1900;
const SIGNAL_UNIVERSE_RETAIN_RANK = 2300;
// Bind-parameter-bounded upsert slices (matches the symbol-states persist).
const SIGNAL_UNIVERSE_UPSERT_CHUNK_ROWS = 1000;
const SIGNAL_UNIVERSE_CALENDAR_LOOKBACK_DAYS = 40;
const SIGNAL_UNIVERSE_SESSION_FETCH_DELAY_MS = 150;
const SIGNAL_UNIVERSE_SCHEDULER_INITIAL_DELAY_MS = 3 * 60 * 1000;
const SIGNAL_UNIVERSE_SCHEDULER_INTERVAL_MS = 30 * 60 * 1000;

// Liquid fixed-income ETFs/ETNs are typed ETF/ETN (not BOND) and are optionable
// with top-decile volume, so they would rank near the TOP of the curated set if
// only the type gate existed. Curated denylist as the safety net the name regex
// can miss; persisted reason keeps each drop auditable.
const SIGNAL_UNIVERSE_BOND_ETF_DENYLIST = new Set([
  "AGG",
  "AGGY",
  "ANGL",
  "BIL",
  "BKLN",
  "BND",
  "BNDX",
  "EDV",
  "EMB",
  "FALN",
  "FLOT",
  "FLRN",
  "GOVT",
  "HYG",
  "IEF",
  "IEI",
  "IGIB",
  "IGSB",
  "JNK",
  "LQD",
  "MUB",
  "PFF",
  "PFFD",
  "PGX",
  "SCHO",
  "SCHR",
  "SGOV",
  "SHV",
  "SHY",
  "SJNK",
  "SPTI",
  "SPTL",
  "SPTS",
  "SRLN",
  "STIP",
  "TBT",
  "TIP",
  "TLH",
  "TLT",
  "TMF",
  "TMV",
  "USHY",
  "USIG",
  "VCIT",
  "VCSH",
  "VGIT",
  "VGLT",
  "VGSH",
  "VTIP",
  "ZROZ",
]);

// Name-based fixed-income net for funds the type code and denylist miss. Kept
// deliberately tight (no bare "note(s)"/"trust" terms) — REIT "Trust" names and
// operating companies must not match; `type=BOND` + the denylist carry the
// unambiguous cases and `excluded_reason` makes any false positive visible.
const SIGNAL_UNIVERSE_FIXED_INCOME_NAME_RE =
  /\b(bond|bonds|treasur\w*|t[- ]?bill[s]?|municipal|muni\b|fixed income|floating rate|senior loan|corporate debt|debenture[s]?|high yield|aggregate bond|inflation[- ]protected|tips etf)\b/i;

const SIGNAL_UNIVERSE_SECURITY_TYPE_EXCLUSIONS = new Set([
  "BOND",
  "SP",
  "PFD",
  "WARRANT",
  "RIGHT",
  "UNIT",
  "NYRS",
]);

const SIGNAL_UNIVERSE_PREFERRED_WARRANT_NAME_RE =
  /\b(preferred (share|shares|stock)|preference share[s]?|warrant[s]?\b|rights? offering)\b/i;

// "Acquisition Corp/Company/Holdings" is the canonical blank-check tell; the
// explicit "blank check" phrasing appears in SPAC prospectuses/names directly.
const SIGNAL_UNIVERSE_SPAC_NAME_RE =
  /\b(acquisition (corp|corporation|co|company|holdings)\b|blank[- ]check)\b/i;

const SIGNAL_UNIVERSE_ALLOWED_MARKETS = new Set(["stocks", "etf"]);

export type SignalUniverseCatalogListing = {
  symbol: string;
  name: string | null;
  type: string | null;
  market: string | null;
  primaryExchange: string | null;
};

export type SignalUniverseRankingRow = {
  symbol: string;
  score: number;
  rank: number | null;
  dollarVolume: number | null;
  volatility: number | null;
  member: boolean;
  excludedReason: string | null;
};

export function classifySignalUniverseExclusion(
  listing: SignalUniverseCatalogListing,
): string | null {
  const symbol = normalizeSymbol(listing.symbol).toUpperCase();
  const type = (listing.type ?? "").trim().toUpperCase();
  const name = listing.name ?? "";
  const market = (listing.market ?? "").trim().toLowerCase();
  const exchange = (listing.primaryExchange ?? "").trim().toUpperCase();

  if (market && !SIGNAL_UNIVERSE_ALLOWED_MARKETS.has(market)) {
    return "unsupported_market";
  }
  if (exchange === "OTC") {
    return "otc_listing";
  }
  if (type === "BOND" || type === "SP") {
    return "fixed_income_type";
  }
  if (SIGNAL_UNIVERSE_SECURITY_TYPE_EXCLUSIONS.has(type)) {
    return "security_type";
  }
  if (SIGNAL_UNIVERSE_BOND_ETF_DENYLIST.has(symbol)) {
    return "bond_etf_denylist";
  }
  if (SIGNAL_UNIVERSE_FIXED_INCOME_NAME_RE.test(name)) {
    return "fixed_income_name";
  }
  if (SIGNAL_UNIVERSE_PREFERRED_WARRANT_NAME_RE.test(name)) {
    return "security_type_name";
  }
  if (SIGNAL_UNIVERSE_SPAC_NAME_RE.test(name)) {
    return "spac";
  }
  return null;
}

// Rank-percentile normalization to [0, 1] (1 = best). Mirrors the high-beta
// scoreByRank semantics so factor scales (dollars vs ratios) cannot dominate
// the blend; ties in the input value share ordering by prior sort stability.
function scoreByRankPercentile(
  values: Map<string, number>,
): Map<string, number> {
  const ordered = Array.from(values.entries()).sort(
    (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
  );
  const scores = new Map<string, number>();
  if (ordered.length === 1) {
    scores.set(ordered[0]![0], 1);
    return scores;
  }
  ordered.forEach(([symbol], index) => {
    scores.set(
      symbol,
      Math.round((1 - index / (ordered.length - 1)) * 1_000_000) / 1_000_000,
    );
  });
  return scores;
}

export function computeSignalUniverseRanking(input: {
  listings: SignalUniverseCatalogListing[];
  sessions: StockGroupedDailyAggregate[][];
  previousMembers: ReadonlySet<string>;
}): SignalUniverseRankingRow[] {
  type SymbolAggregate = {
    dollarVolumeSum: number;
    dollarVolumeSessions: number;
    volatilitySum: number;
    volatilitySessions: number;
  };
  const aggregates = new Map<string, SymbolAggregate>();
  for (const session of input.sessions) {
    for (const bar of session) {
      const symbol = normalizeSymbol(bar.symbol).toUpperCase();
      if (!symbol) {
        continue;
      }
      const entry = aggregates.get(symbol) ?? {
        dollarVolumeSum: 0,
        dollarVolumeSessions: 0,
        volatilitySum: 0,
        volatilitySessions: 0,
      };
      const price = bar.vwap ?? bar.close ?? null;
      if (price !== null && price > 0 && bar.volume > 0) {
        entry.dollarVolumeSum += price * bar.volume;
        entry.dollarVolumeSessions += 1;
      }
      if (
        bar.high !== null &&
        bar.low !== null &&
        bar.close !== null &&
        bar.close > 0 &&
        bar.high >= bar.low
      ) {
        entry.volatilitySum += (bar.high - bar.low) / bar.close;
        entry.volatilitySessions += 1;
      }
      aggregates.set(symbol, entry);
    }
  }

  const rows: SignalUniverseRankingRow[] = [];
  const scorable: Array<{
    symbol: string;
    dollarVolume: number;
    volatility: number;
  }> = [];
  // Multiple active listings can share a normalized ticker (foreign listings
  // on a US ticker, STK/ETF catalog variants of one fund), and the rankings
  // table is keyed by symbol — duplicate symbols in one upsert command fail
  // with "ON CONFLICT DO UPDATE cannot affect row a second time". Collapse to
  // one listing per symbol; an admissible listing beats an excluded duplicate
  // so a foreign/OTC variant can never mask the real one.
  const exclusionBySymbol = new Map<string, string | null>();
  for (const listing of input.listings) {
    const symbol = normalizeSymbol(listing.symbol).toUpperCase();
    if (!symbol) {
      continue;
    }
    const excludedReason = classifySignalUniverseExclusion(listing);
    const existing = exclusionBySymbol.get(symbol);
    if (existing === undefined || (existing !== null && excludedReason === null)) {
      exclusionBySymbol.set(symbol, excludedReason);
    }
  }
  for (const [symbol, excludedReason] of exclusionBySymbol) {
    if (excludedReason) {
      rows.push({
        symbol,
        score: 0,
        rank: null,
        dollarVolume: null,
        volatility: null,
        member: false,
        excludedReason,
      });
      continue;
    }
    const aggregate = aggregates.get(symbol);
    if (
      !aggregate ||
      aggregate.dollarVolumeSessions < SIGNAL_UNIVERSE_MIN_SYMBOL_SESSIONS ||
      aggregate.volatilitySessions < SIGNAL_UNIVERSE_MIN_SYMBOL_SESSIONS
    ) {
      rows.push({
        symbol,
        score: 0,
        rank: null,
        dollarVolume: null,
        volatility: null,
        member: false,
        excludedReason: "insufficient_data",
      });
      continue;
    }
    scorable.push({
      symbol,
      dollarVolume: aggregate.dollarVolumeSum / aggregate.dollarVolumeSessions,
      volatility: aggregate.volatilitySum / aggregate.volatilitySessions,
    });
  }

  const dollarVolumeScores = scoreByRankPercentile(
    new Map(scorable.map((row) => [row.symbol, row.dollarVolume])),
  );
  const volatilityScores = scoreByRankPercentile(
    new Map(scorable.map((row) => [row.symbol, row.volatility])),
  );
  const scored = scorable
    .map((row) => ({
      ...row,
      score:
        0.5 * (dollarVolumeScores.get(row.symbol) ?? 0) +
        0.5 * (volatilityScores.get(row.symbol) ?? 0),
    }))
    .sort(
      (left, right) =>
        right.score - left.score || left.symbol.localeCompare(right.symbol),
    );

  scored.forEach((row, index) => {
    const rank = index + 1;
    const member = input.previousMembers.has(row.symbol)
      ? rank <= SIGNAL_UNIVERSE_RETAIN_RANK
      : rank <= SIGNAL_UNIVERSE_ENTRANT_RANK;
    rows.push({
      symbol: row.symbol,
      score: Math.round(row.score * 1_000_000) / 1_000_000,
      rank,
      dollarVolume: Math.round(row.dollarVolume * 100) / 100,
      volatility: Math.round(row.volatility * 1_000_000) / 1_000_000,
      member,
      excludedReason: null,
    });
  });

  return rows;
}

// The signal-monitor expansion's optionable hard gate, verbatim
// (loadSignalMonitorCatalogExpansionSymbols): rank exactly the pool the
// expansion query can admit.
const OPTIONABLE_LISTING_PREDICATE = sql`
  ${universeCatalogListingsTable.active} = true
  and (
    coalesce(${universeCatalogListingsTable.contractMeta}->>'derivativeSecTypes', '') ~* '(^|,)\\s*OPT\\s*(,|$)'
    or ${universeCatalogListingsTable.contractMeta}->>'optionabilityStatus' = 'verified'
    or ${universeCatalogListingsTable.contractMeta}->'optionability'->>'status' = 'verified'
  )
`;

async function loadOptionableListings(): Promise<SignalUniverseCatalogListing[]> {
  const rows = await db
    .select({
      symbol: universeCatalogListingsTable.normalizedTicker,
      name: universeCatalogListingsTable.name,
      type: universeCatalogListingsTable.type,
      market: universeCatalogListingsTable.market,
      primaryExchange: universeCatalogListingsTable.primaryExchange,
    })
    .from(universeCatalogListingsTable)
    .where(OPTIONABLE_LISTING_PREDICATE);
  return rows;
}

async function loadPreviousMembers(): Promise<Set<string>> {
  const rows = await db
    .select({ symbol: signalUniverseRankingsTable.symbol })
    .from(signalUniverseRankingsTable)
    .where(sql`${signalUniverseRankingsTable.member} = true`);
  return new Set(rows.map((row) => row.symbol));
}

function wait(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

async function fetchTrailingSessions(input: {
  client: MassiveMarketDataClient;
  lastCompletedSessionClose: Date;
}): Promise<StockGroupedDailyAggregate[][]> {
  const sessions: StockGroupedDailyAggregate[][] = [];
  const startMs = input.lastCompletedSessionClose.getTime();
  for (
    let offset = 0;
    offset < SIGNAL_UNIVERSE_CALENDAR_LOOKBACK_DAYS &&
    sessions.length < SIGNAL_UNIVERSE_TRAILING_SESSIONS;
    offset += 1
  ) {
    const date = new Date(startMs - offset * 86_400_000);
    try {
      const aggregates = await input.client.getGroupedDailyStockAggregates({
        date,
      });
      // Weekends/holidays return empty result sets; only trading sessions count.
      if (aggregates.length) {
        sessions.push(aggregates);
      }
    } catch (error) {
      logger.warn(
        { err: error, date: date.toISOString().slice(0, 10) },
        "Signal universe ranking grouped-daily fetch failed",
      );
    }
    await wait(SIGNAL_UNIVERSE_SESSION_FETCH_DELAY_MS);
  }
  return sessions;
}

async function persistSignalUniverseRanking(input: {
  rows: SignalUniverseRankingRow[];
  rankedAt: Date;
}): Promise<void> {
  const values = input.rows.map((row) => ({
    symbol: row.symbol,
    score: row.score.toFixed(6),
    rank: row.rank,
    dollarVolume: row.dollarVolume === null ? null : row.dollarVolume.toFixed(2),
    volatility: row.volatility === null ? null : row.volatility.toFixed(6),
    optionable: true,
    excludedReason: row.excludedReason,
    member: row.member,
    rankedAt: input.rankedAt,
  }));
  for (
    let offset = 0;
    offset < values.length;
    offset += SIGNAL_UNIVERSE_UPSERT_CHUNK_ROWS
  ) {
    await db
      .insert(signalUniverseRankingsTable)
      .values(values.slice(offset, offset + SIGNAL_UNIVERSE_UPSERT_CHUNK_ROWS))
      .onConflictDoUpdate({
        target: signalUniverseRankingsTable.symbol,
        set: {
          score: sql`excluded.score`,
          rank: sql`excluded.rank`,
          dollarVolume: sql`excluded.dollar_volume`,
          volatility: sql`excluded.volatility`,
          optionable: sql`excluded.optionable`,
          excludedReason: sql`excluded.excluded_reason`,
          member: sql`excluded.member`,
          rankedAt: sql`excluded.ranked_at`,
          updatedAt: sql`now()`,
        },
      });
  }
  // Rows not refreshed this run are symbols that left the optionable pool
  // (delisted / verification revoked); drop them so a stale member can never
  // outrank live rows. The expansion join tolerates an empty table (fallback).
  await db
    .delete(signalUniverseRankingsTable)
    .where(sql`${signalUniverseRankingsTable.rankedAt} < ${input.rankedAt}`);
}

let signalUniverseRankingRunInFlight = false;

export async function refreshSignalUniverseRanking(input?: {
  now?: Date;
  client?: MassiveMarketDataClient;
}): Promise<
  | { status: "refreshed"; rankedAt: Date; scored: number; members: number }
  | { status: "skipped"; reason: string }
> {
  if (signalUniverseRankingRunInFlight) {
    return { status: "skipped", reason: "run_in_flight" };
  }
  signalUniverseRankingRunInFlight = true;
  try {
    const now = input?.now ?? new Date();
    const lastCompletedSessionClose = resolvePreviousUsEquitySessionClose(now);
    if (!lastCompletedSessionClose) {
      return { status: "skipped", reason: "no_completed_session" };
    }
    const latest = await db
      .select({ rankedAt: sql<Date | null>`max(${signalUniverseRankingsTable.rankedAt})` })
      .from(signalUniverseRankingsTable);
    const latestRankedAt = latest[0]?.rankedAt
      ? new Date(latest[0].rankedAt)
      : null;
    if (
      latestRankedAt &&
      latestRankedAt.getTime() >= lastCompletedSessionClose.getTime()
    ) {
      return { status: "skipped", reason: "already_current" };
    }

    const config = getMassiveRuntimeConfig();
    if (!config) {
      return { status: "skipped", reason: "massive_not_configured" };
    }
    const client = input?.client ?? new MassiveMarketDataClient(config);

    const [listings, previousMembers] = await Promise.all([
      loadOptionableListings(),
      loadPreviousMembers(),
    ]);
    if (!listings.length) {
      return { status: "skipped", reason: "no_optionable_listings" };
    }

    const sessions = await fetchTrailingSessions({
      client,
      lastCompletedSessionClose,
    });
    if (sessions.length < SIGNAL_UNIVERSE_MIN_SESSIONS) {
      logger.warn(
        { sessions: sessions.length, required: SIGNAL_UNIVERSE_MIN_SESSIONS },
        "Signal universe ranking skipped: too few grouped-daily sessions",
      );
      return { status: "skipped", reason: "insufficient_sessions" };
    }

    const rows = computeSignalUniverseRanking({
      listings,
      sessions,
      previousMembers,
    });
    const rankedAt = lastCompletedSessionClose;
    await persistSignalUniverseRanking({ rows, rankedAt });

    const members = rows.filter((row) => row.member).length;
    const scored = rows.filter((row) => row.rank !== null).length;
    logger.info(
      {
        rankedAt: rankedAt.toISOString(),
        listings: listings.length,
        scored,
        members,
        excluded: rows.length - scored,
        sessions: sessions.length,
      },
      "Signal universe ranking refreshed",
    );
    return { status: "refreshed", rankedAt, scored, members };
  } finally {
    signalUniverseRankingRunInFlight = false;
  }
}

export function startSignalUniverseRankingScheduler(): void {
  if (process.env["SIGNAL_UNIVERSE_RANKING_ENABLED"] === "false") {
    logger.info(
      "Signal universe ranking scheduler disabled (SIGNAL_UNIVERSE_RANKING_ENABLED=false)",
    );
    return;
  }
  const tick = () => {
    void refreshSignalUniverseRanking().catch((error) => {
      logger.warn({ err: error }, "Signal universe ranking refresh failed");
    });
  };
  setTimeout(() => {
    tick();
    const timer = setInterval(tick, SIGNAL_UNIVERSE_SCHEDULER_INTERVAL_MS);
    timer.unref?.();
  }, SIGNAL_UNIVERSE_SCHEDULER_INITIAL_DELAY_MS).unref?.();
  logger.info(
    { intervalMs: SIGNAL_UNIVERSE_SCHEDULER_INTERVAL_MS },
    "Signal universe ranking scheduler started",
  );
}

export const __signalUniverseRankingInternalsForTests = {
  classifySignalUniverseExclusion,
  computeSignalUniverseRanking,
  scoreByRankPercentile,
  SIGNAL_UNIVERSE_ENTRANT_RANK,
  SIGNAL_UNIVERSE_RETAIN_RANK,
};
