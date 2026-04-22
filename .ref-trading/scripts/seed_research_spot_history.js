#!/usr/bin/env node

import { isMassiveDbCacheConfigured } from "../server/services/massiveDbCache.js";
import { resolveMassiveApiKey } from "../server/services/massiveClient.js";
import { seedResearchSpotHistoryFromMassive } from "../server/services/researchSpotHistory.js";

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

function parsePositiveInteger(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return fallback;
  }
  return Math.max(1, Math.round(numeric));
}

async function main() {
  if (!isMassiveDbCacheConfigured()) {
    throw new Error("Postgres cache is not configured. Set DATABASE_URL or MASSIVE_DB_URL before seeding.");
  }

  const apiKey = resolveMassiveApiKey();
  if (!apiKey) {
    throw new Error("Massive API key is not configured.");
  }

  const symbols = parseSymbols(parseArg("symbols", "SPY,QQQ"));
  const days = parsePositiveInteger(parseArg("days", "730"), 730);
  const from = parseArg("from", null);
  const to = parseArg("to", null);
  const session = parseArg("session", "regular");
  const warmDaily = !hasFlag("skip-daily");

  const startedAt = Date.now();
  const results = [];
  for (const symbol of symbols) {
    const result = await seedResearchSpotHistoryFromMassive({
      symbol,
      apiKey,
      from,
      to,
      days,
      session,
      warmDaily,
    });
    results.push(result);
    console.log(JSON.stringify(result, null, 2));
  }

  console.log(JSON.stringify({
    ok: true,
    symbols,
    days,
    from,
    to,
    session,
    warmDaily,
    elapsedMs: Date.now() - startedAt,
    results,
  }, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exit(1);
});
