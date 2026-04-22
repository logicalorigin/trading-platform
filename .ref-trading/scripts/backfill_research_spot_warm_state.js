#!/usr/bin/env node

import {
  isMassiveDbCacheConfigured,
  readResearchSpotBarsCoverage,
  readResearchSpotWarmState,
  upsertResearchSpotWarmState,
} from "../server/services/massiveDbCache.js";

function parseArg(name, fallback = null) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((value) => value.startsWith(prefix));
  if (!hit) {
    return fallback;
  }
  const value = hit.slice(prefix.length).trim();
  return value || fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function parseSymbols(value) {
  return String(value || "SPY,QQQ")
    .split(",")
    .map((symbol) => String(symbol || "").trim().toUpperCase())
    .filter(Boolean);
}

function toIsoOrNow(value) {
  const text = String(value || "").trim();
  return text || new Date().toISOString();
}

async function backfillSymbol({
  symbol,
  session = "regular",
  timeframe = "1m",
  force = false,
} = {}) {
  const coverage = await readResearchSpotBarsCoverage({
    ticker: symbol,
    session,
    timeframe,
  });
  const existing = await readResearchSpotWarmState({
    ticker: symbol,
    session,
    timeframe,
  });

  if (!coverage?.coverageStart || !coverage?.coverageEnd) {
    return {
      symbol,
      session,
      timeframe,
      ok: false,
      skipped: "no_coverage",
      coverage,
      existing,
    };
  }

  const alreadyComplete = existing
    && existing.lastStatus === "complete"
    && existing.completedAt
    && existing.targetStart
    && existing.targetEnd;

  if (alreadyComplete && !force) {
    return {
      symbol,
      session,
      timeframe,
      ok: true,
      skipped: "already_complete",
      coverage,
      existing,
    };
  }

  const completedAt = toIsoOrNow(existing?.completedAt || coverage?.updatedAt || coverage?.fetchedAt);
  const lastRunAt = toIsoOrNow(existing?.lastRunAt || completedAt);
  await upsertResearchSpotWarmState({
    ticker: symbol,
    session,
    timeframe,
    targetStart: coverage.coverageStart,
    targetEnd: coverage.coverageEnd,
    nextCursorDate: coverage.coverageStart,
    lastWindowFrom: existing?.lastWindowFrom || coverage.coverageStart,
    lastWindowTo: existing?.lastWindowTo || coverage.coverageEnd,
    lastStatus: "complete",
    lastError: null,
    lastRunAt,
    completedAt,
    dailyWarmedAt: existing?.dailyWarmedAt || null,
  });

  const next = await readResearchSpotWarmState({
    ticker: symbol,
    session,
    timeframe,
  });

  return {
    symbol,
    session,
    timeframe,
    ok: true,
    skipped: null,
    coverage,
    previousWarmState: existing,
    nextWarmState: next,
  };
}

async function main() {
  if (!isMassiveDbCacheConfigured()) {
    throw new Error("Postgres cache is not configured. Set DATABASE_URL or MASSIVE_DB_URL before backfilling warm state.");
  }

  const symbols = parseSymbols(parseArg("symbols", "SPY,QQQ"));
  const session = parseArg("session", "regular");
  const timeframe = parseArg("timeframe", "1m");
  const force = hasFlag("force");
  const results = [];

  for (const symbol of symbols) {
    const result = await backfillSymbol({
      symbol,
      session,
      timeframe,
      force,
    });
    results.push(result);
    console.log(JSON.stringify(result, null, 2));
  }

  console.log(JSON.stringify({
    ok: true,
    symbols,
    session,
    timeframe,
    force,
    results,
  }, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exit(1);
});
