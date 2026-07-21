import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const accountSource = readFileSync(
  new URL("./account.ts", import.meta.url),
  "utf8",
);

test("real account positions publish the fixed attribution stages", () => {
  assert.match(accountSource, /recordAccountPositionsTiming/);
  for (const stage of [
    "universe",
    "positions_upstream",
    "positions_snaptrade_snapshot",
    "positions_ibkr",
    "positions_robinhood",
    "positions_robinhood_session",
    "positions_robinhood_holdings",
    "positions_robinhood_market_data",
    "positions_provider_fanout",
    "fast_open_date_schedule",
    "equity_quotes",
    "option_quotes",
    "market_hydration_initial",
    "full_orders",
    "full_lots",
    "full_greeks",
    "full_flex_open_dates",
    "full_execution_open_dates",
    "full_fanout",
    "real_attribution",
    "market_hydration_full",
    "response_shape",
  ]) {
    assert.match(accountSource, new RegExp(stage), stage);
  }
});

test("full position enrichment keeps one parallel fanout", () => {
  const start = accountSource.indexOf(
    "async function buildAccountPositionsUncached",
  );
  const end = accountSource.indexOf(
    "export async function getAccountPositionsAtDate",
    start,
  );
  assert.ok(start >= 0 && end > start);
  const implementation = accountSource.slice(start, end);
  assert.match(implementation, /const \[([\s\S]*?)\] = await Promise\.all\(\[/);
  assert.match(implementation, /"full_orders"/);
  assert.match(implementation, /"full_execution_open_dates"/);
  assert.doesNotMatch(
    implementation,
    /recordAccountPositionsTiming\([\s\S]*?accountId:/,
  );
});

test("position upstream attribution distinguishes cache waiting from provider work", () => {
  const cacheStart = accountSource.indexOf(
    "function readShortLivedAccountCache",
  );
  const cacheEnd = accountSource.indexOf(
    "function stableAccountReadCacheKey",
    cacheStart,
  );
  assert.ok(cacheStart >= 0 && cacheEnd > cacheStart);
  const cacheImplementation = accountSource.slice(cacheStart, cacheEnd);
  assert.match(cacheImplementation, /cached\.settled\s*\?\s*"hit"\s*:\s*"inflight"/);
  assert.match(cacheImplementation, /"miss"/);

  const providerStart = accountSource.indexOf(
    "async function readPositionsForUniverseUncached",
  );
  const providerEnd = accountSource.indexOf(
    "export async function getAccountPositionVisibilityProbe",
    providerStart,
  );
  assert.ok(providerStart >= 0 && providerEnd > providerStart);
  const providerImplementation = accountSource.slice(providerStart, providerEnd);
  for (const stage of [
    "positions_snaptrade_snapshot",
    "positions_ibkr",
    "positions_robinhood",
    "positions_robinhood_session",
    "positions_robinhood_holdings",
    "positions_robinhood_market_data",
    "positions_provider_fanout",
  ]) {
    assert.match(providerImplementation, new RegExp(stage), stage);
  }
  assert.match(providerImplementation, /Promise\.all\(\[/);
});
