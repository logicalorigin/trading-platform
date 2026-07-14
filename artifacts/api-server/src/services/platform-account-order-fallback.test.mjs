import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./platform.ts", import.meta.url), "utf8");
const accountSource = readFileSync(
  new URL("./account.ts", import.meta.url),
  "utf8",
);

function functionSource(name, exported = false) {
  const prefix = exported
    ? `export async function ${name}`
    : `async function ${name}`;
  const start = source.indexOf(prefix);
  assert.notEqual(start, -1, `Missing ${name}`);
  const nextFunction = source.indexOf("\nasync function ", start + 1);
  const nextExport = source.indexOf("\nexport ", start + 1);
  const candidates = [nextFunction, nextExport].filter((offset) => offset >= 0);
  const end = candidates.length ? Math.min(...candidates) : source.length;
  return source.slice(start, end);
}

test("platform order reads cache only fresh successful payloads and join in-flight reads", () => {
  const read = functionSource("readCurrentOrders");
  const visibility = functionSource("listOrdersForVisibility");
  const brokerRead = read.slice(0, read.indexOf("for (const order"));

  assert.match(brokerRead, /const orders = await client\.listOrders\(/);
  assert.doesNotMatch(
    brokerRead,
    /withTimeout|catch\s*\(|orders:\s*\[\]|degraded/,
  );
  assert.match(visibility, /if \(pending\) \{\s*return pending;\s*\}/);
  assert.doesNotMatch(
    visibility,
    /stale|Promise\.race|orderVisibilityFallback|markOrderVisibilitySnapshotStale|catch\s*\(/,
  );
});

test("order visibility probes never expose expired cache entries", () => {
  const start = source.indexOf("type OrderReadInput");
  const end = source.indexOf(
    "const DEFAULT_RUNTIME_DIAGNOSTICS_MARKET_DATA_INGEST_TIMEOUT_MS",
    start,
  );
  const orderVisibility = source.slice(start, end);
  const probe = orderVisibility.slice(
    orderVisibility.indexOf("export async function getOrderVisibilityProbe"),
  );

  assert.doesNotMatch(
    orderVisibility,
    /orderVisibilityStaleTtlMs|staleExpiresAt/,
  );
  assert.doesNotMatch(orderVisibility, /cacheStatus:\s*"stale"/);
  assert.doesNotMatch(probe, /orders:\s*\[\]/);
  assert.match(
    probe,
    /throw new HttpError\(503[\s\S]*ibkr_orders_snapshot_unavailable/,
  );
  assert.doesNotMatch(orderVisibility, /degraded\?|reason\?|stale\?|debug\?/);
});

test("account order responses do not emit retired fallback metadata", () => {
  const typeStart = accountSource.indexOf("type AccountUniverseOrderResult");
  const typeEnd = accountSource.indexOf(
    "async function listOrdersForUniverse",
    typeStart,
  );
  const orderResultType = accountSource.slice(typeStart, typeEnd);
  const closedTrades = accountSource.slice(
    accountSource.indexOf("async function getAccountClosedTradesUncached"),
    accountSource.indexOf("export async function getAccountOrders"),
  );
  const accountOrders = accountSource.slice(
    accountSource.indexOf("export async function getAccountOrders"),
    accountSource.indexOf("export async function cancelAccountOrder"),
  );

  assert.doesNotMatch(orderResultType, /degraded|reason|stale|debug|timeoutMs/);
  assert.doesNotMatch(closedTrades, /activityDegraded|activityReason/);
  assert.doesNotMatch(accountOrders, /degraded|reason|stale|debug/);
});

test("risk-increasing IBKR orders use one fresh complete account snapshot", () => {
  const guard = functionSource("validateOrderIntentForRouting");

  assert.match(guard, /await client\.readAccountRiskState\(/);
  assert.match(
    guard,
    /catch \(error\)[\s\S]*ibkr_trading_risk_state_unavailable/,
  );
  assert.match(guard, /validateSingleLegOrderIntent\(/);
  assert.match(guard, /verifiedStandardOptionContractIds\.includes/);
  assert.match(guard, /cause:\s*error/);
});
