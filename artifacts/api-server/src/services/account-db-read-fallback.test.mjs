import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./account.ts", import.meta.url), "utf8");
const shadowSource = readFileSync(
  new URL("./shadow-account.ts", import.meta.url),
  "utf8",
);

function sourceBetween(startPattern, endPattern, document = source) {
  const start = document.indexOf(startPattern);
  assert.notEqual(start, -1, `Missing ${startPattern}`);
  const end = document.indexOf(endPattern, start + startPattern.length);
  assert.notEqual(end, -1, `Missing ${endPattern}`);
  return document.slice(start, end);
}

test("Account database reads never substitute empty or partial outage payloads", () => {
  assert.doesNotMatch(
    source,
    /accountSnapshotReadBackoff|accountPositionLotsReadBackoff|optionalAccountSchemaReadBackoff/,
  );
  assert.doesNotMatch(
    source,
    /withAccountSnapshotReadFallback|withAccountPositionLotsReadFallback/,
  );
  assert.doesNotMatch(
    source,
    /getPersistedAccounts|getFlexAccounts|getFlexBackedAccounts|emptyPersistedBackedAccounts/,
  );
  assert.doesNotMatch(source, /falling back to manual/);
  assert.match(
    source,
    /code:\s*"account_db_unavailable"[\s\S]*Retry after Postgres connectivity recovers/,
  );

  const optionalSchemaRead = sourceBetween(
    "async function withOptionalAccountSchema",
    "async function ensureFlexStorageTablesAvailable",
  );
  assert.match(
    optionalSchemaRead,
    /knownMissingTables[\s\S]*input\.whenMissing\(\)/,
  );
  assert.match(
    optionalSchemaRead,
    /isMissingRelationError[\s\S]*input\.whenMissing\(\)/,
  );
  assert.doesNotMatch(
    optionalSchemaRead,
    /isTransientPostgresError[\s\S]*input\.whenMissing\(\)/,
  );
});

test("Account summary, list P&L, and Flex health propagate database outages", () => {
  const summaryMetrics = sourceBetween(
    "async function resolveAccountSummaryReturnMetrics",
    "function isFiniteNumber",
  );
  const listDayPnl = sourceBetween(
    "async function withAccountListDayPnl",
    "async function getSnapTradeBackedAccounts",
  );
  const flexHealth = sourceBetween(
    "export async function getFlexHealth",
    "export async function testFlexToken",
  );

  assert.doesNotMatch(summaryMetrics, /catch\s*\(/);
  assert.doesNotMatch(listDayPnl, /catch\s*\(/);
  assert.doesNotMatch(flexHealth, /withAccountSnapshotReadFallback/);
  assert.doesNotMatch(
    flexHealth,
    /fallback:\s*\(\)\s*=>\s*\[\{[^}]*rowCount:\s*0/,
  );
});

test("Flex health batches its independent database reads", () => {
  const flexHealth = sourceBetween(
    "export async function getFlexHealth",
    "export async function testFlexToken",
  );

  assert.match(
    flexHealth,
    /const \[\s*lastRun,\s*lastCompletedRun,\s*latestSnapshot,\s*\[snapshotCoverage\],\s*\[flexCoverage\],\s*\[tradeCoverage\],\s*\[cashCoverage\],\s*\[dividendCoverage\],\s*\[openPositionCoverage\],?\s*\]\s*=\s*await Promise\.all\(\[/,
  );
});

test("provider portfolio failures never become zero-balance accounts", () => {
  const backedAccounts = sourceBetween(
    "async function getSnapTradeBackedAccounts",
    "const SNAPTRADE_PRESENCE_CACHE_TTL_MS",
  );
  const balanceHydration = sourceBetween(
    "function snapTradeBalanceValuesFromPortfolio",
    "export async function listAccounts",
  );

  assert.doesNotMatch(
    backedAccounts,
    /buyingPower:\s*0|cash:\s*0|netLiquidation:\s*0/,
  );
  assert.doesNotMatch(
    balanceHydration,
    /reporting zero balances|\?\s*\{\s*\.\.\.record\.snapshot[\s\S]*:\s*record\.snapshot/,
  );
  assert.match(balanceHydration, /snaptrade_account_balances_unavailable/);
  assert.match(balanceHydration, /robinhood_account_balances_unavailable/);
});

test("healthy provider equity history omits retired stale fallback metadata", () => {
  const equityHistory = sourceBetween(
    "async function getAccountEquityHistoryUncached",
    "export async function getAccountAllocation",
  );

  assert.doesNotMatch(equityHistory, /isStale|staleReason/);
});

test("account payloads omit unread derived PDT fields", () => {
  const summarySources = [
    sourceBetween(
      "async function getAccountSummaryUncached",
      "async function resolveBenchmarkPercents",
    ),
    sourceBetween(
      "function buildShadowAccountSummaryResponse",
      "export async function getShadowAccountSummary",
      shadowSource,
    ),
  ];
  const riskSources = [
    sourceBetween("async function getAccountRiskUncached", "type AccountRiskPayload"),
    sourceBetween(
      "async function buildShadowAccountRisk",
      "function shadowPositionForNotionalRisk",
      shadowSource,
    ),
  ];

  for (const summarySource of summarySources) {
    assert.doesNotMatch(summarySource, /\bpdt\s*:/);
  }
  for (const riskSource of riskSources) {
    assert.doesNotMatch(riskSource, /\bpdtDayTradeCount\s*:/);
  }
});
