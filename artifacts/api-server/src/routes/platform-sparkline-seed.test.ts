import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./platform.ts", import.meta.url), "utf8");

function sparklineSeedLoaderSource(): string {
  const start = source.indexOf("async function loadSparklineSeedBarsBySymbol");
  const end = source.indexOf("function readBatchBarCloseValue", start);
  assert.notEqual(start, -1, "Missing loadSparklineSeedBarsBySymbol");
  assert.notEqual(end, -1, "Missing loader end marker");
  return source.slice(start, end);
}

test("sparkline seed reads live edge from memory instead of live bar_cache source", () => {
  const loader = sparklineSeedLoaderSource();

  assert.match(source, /readSignalMonitorLocalMemoryBars/);
  assert.match(loader, /readSparklineSeedMemoryBarsBySymbol/);
  assert.match(loader, /sourceName:\s*"massive-history"/);
  assert.doesNotMatch(loader, /sourceName:\s*"massive-websocket"/);
});

test("sparkline seed cache stores history only and merges live memory per request", () => {
  const loader = sparklineSeedLoaderSource();
  const cacheHitStart = loader.indexOf("if (cached && cached.expiresAt > now)");
  const cacheMissStart = loader.indexOf("if (!seenMiss.has(normalized))");
  assert.notEqual(cacheHitStart, -1, "Missing cache hit branch");
  assert.notEqual(cacheMissStart, -1, "Missing miss branch");

  const cacheHitBlock = loader.slice(cacheHitStart, cacheMissStart);
  assert.match(cacheHitBlock, /mergeSparklineSeedBars\(/);
  assert.match(cacheHitBlock, /cached\.bars/);
  assert.match(cacheHitBlock, /liveBars/);

  const cacheWriteStart = loader.indexOf("sparklineSeedBarsCache.set(");
  assert.notEqual(cacheWriteStart, -1, "Missing cache write");
  const cacheWriteBlock = loader.slice(cacheWriteStart, cacheWriteStart + 300);
  assert.match(cacheWriteBlock, /bars:\s*historyBars/);
});

test("sparkline seed coalesces duplicate in-flight backfills", () => {
  const loader = sparklineSeedLoaderSource();

  assert.match(source, /const sparklineSeedInFlight = new Map/);
  assert.match(source, /SPARKLINE_SEED_IN_FLIGHT_MAX_ENTRIES/);
  assert.match(loader, /const existing = sparklineSeedInFlight\.get\(key\)/);
  assert.match(loader, /loadSparklineSeedBarsBySymbolUncoalesced\(body\)\.finally/);
  assert.match(loader, /sparklineSeedInFlight\.set\(key, flight\)/);
});

test("sparkline seed uses one bounded DB backfill path for cache misses", () => {
  const loader = sparklineSeedLoaderSource();

  assert.match(loader, /if \(misses\.length\) \{/);
  assert.match(source, /const SPARKLINE_SEED_DB_BATCH_SIZE = 64;/);
  assert.match(loader, /SPARKLINE_SEED_DB_CONCURRENCY/);
  assert.match(loader, /runSparklineSeedDbBackfill\(\(\) =>\s*loadStoredMarketBarsBySymbol/);
  assert.match(
    source,
    /SPARKLINE_SEED_DB_CONCURRENCY[\s\S]*Number\(process\.env\["SPARKLINE_SEED_DB_CONCURRENCY"\]\) \|\| 1/,
  );
  assert.doesNotMatch(source, /shouldSkipSparklineSeedDbBackfillForPressure/);
  assert.doesNotMatch(source, /snapshot\.inputs\.dbPoolWaiting/);
});

test("sparkline seed DB batch size turns 96 symbols into 2 chunks", () => {
  const match = source.match(/const SPARKLINE_SEED_DB_BATCH_SIZE = (\d+);/);
  assert.ok(match, "Missing SPARKLINE_SEED_DB_BATCH_SIZE");
  const batchSize = Number(match[1]);
  const symbols = Array.from({ length: 96 }, (_unused, index) => `S${index}`);
  const chunks: string[][] = [];
  for (let index = 0; index < symbols.length; index += batchSize) {
    chunks.push(symbols.slice(index, index + batchSize));
  }

  assert.equal(batchSize, 64);
  assert.equal(chunks.length, 2);
  assert.deepEqual(
    chunks.map((chunk) => chunk.length),
    [64, 32],
  );
});

test("sparkline seed returns live misses while scheduling historical backfill", () => {
  const loader = sparklineSeedLoaderSource();

  assert.match(loader, /const liveBySymbol = readSparklineSeedMemoryBarsBySymbol/);
  assert.match(loader, /result\[normalized\] = liveBars/);
  assert.match(loader, /scheduleSparklineSeedHistoryWarm\(body, misses, cacheEnabled\)/);
  assert.match(loader, /sparklineSeedHistoryWarmInFlight\.has\(key\)/);
  assert.match(loader, /sparklineSeedBarsCache\.set\(/);
  assert.doesNotMatch(source, /SPARKLINE_SEED_LIVE_ONLY_MIN_POINTS/);
  assert.doesNotMatch(loader, /liveBars\.length >=/);
});

test("runtime diagnostics route supports compact polling", () => {
  const start = source.indexOf('router.get("/diagnostics/runtime"');
  // Bound by the next route registration (the old "/diagnostics/ibkr-perf"
  // end marker was retired with the legacy IBKR bridge surfaces).
  const end = source.indexOf("router.get(", start + 1);
  assert.notEqual(start, -1, "Missing runtime diagnostics route");
  assert.notEqual(end, -1, "Missing runtime diagnostics route end marker");
  const route = source.slice(start, end);

  assert.match(route, /x-pyrus-diagnostics-detail/);
  assert.match(route, /getRuntimeDiagnosticsCompact\(\)/);
  assert.match(route, /getRuntimeDiagnostics\(\)/);
});
