import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ACCOUNT_PAGE_BENCHMARK_EQUITY_CACHE_TTL_MS,
  ACCOUNT_PAGE_CACHE_JITTER_MS,
  ACCOUNT_PAGE_CRITICAL_LIVE_CACHE_TTL_MS,
  ACCOUNT_PAGE_DERIVED_BOOT_DELAY_MS,
  ACCOUNT_PAGE_LIVE_BOOT_DELAY_MS,
  getAccountPageStreamDiagnostics,
} from "./account-page-streams";

test("account page stream starts live and derived work immediately after critical", () => {
  assert.equal(ACCOUNT_PAGE_LIVE_BOOT_DELAY_MS, 0);
  assert.equal(ACCOUNT_PAGE_DERIVED_BOOT_DELAY_MS, 0);
});

test("account page stream cache defaults reduce stampedes without slowing derived cadence", () => {
  assert.equal(ACCOUNT_PAGE_CRITICAL_LIVE_CACHE_TTL_MS, 2_000);
  assert.equal(ACCOUNT_PAGE_CACHE_JITTER_MS, 250);
  assert.equal(ACCOUNT_PAGE_BENCHMARK_EQUITY_CACHE_TTL_MS, 5 * 60_000);
});

test("account page stream diagnostics expose cache and timing fields", () => {
  const diagnostics = getAccountPageStreamDiagnostics();

  assert.equal(diagnostics.timings.criticalMs, null);
  assert.equal(diagnostics.timings.liveMs, null);
  assert.equal(diagnostics.timings.derivedMs, null);
  assert.equal(diagnostics.timings.firstCriticalWriteMs, null);
  assert.equal(diagnostics.timings.firstDerivedWriteMs, null);
  assert.equal(diagnostics.cache.criticalHit, null);
  assert.equal(diagnostics.cache.liveHit, null);
  assert.equal(diagnostics.cache.derivedHit, null);
  assert.equal(diagnostics.cache.benchmarkHit, null);
});

test("account page stream records write timing and benchmark cache sources", () => {
  const source = readFileSync(new URL("./account-page-streams.ts", import.meta.url), "utf8");
  const routeSource = readFileSync(new URL("../routes/platform.ts", import.meta.url), "utf8");

  assert.match(source, /accountPageBenchmarkEquityCache/);
  assert.match(source, /fetchAccountPageBenchmarkEquityHistory/);
  assert.match(source, /recordAccountPageCache\("benchmarkHit", true\)/);
  assert.match(routeSource, /recordAccountPageStreamWrite\("critical", streamStartedAt\)/);
  assert.match(routeSource, /recordAccountPageStreamWrite\("derived", writeStartedAt\)/);
});
