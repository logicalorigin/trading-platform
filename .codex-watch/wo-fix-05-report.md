# WO-FIX-05 Report

## What / Why

Changed `refreshShadowPositionMarks` so open-position marks are still computed with the same per-position mark math, but DB writes are batched after computation:

- one multi-row `shadow_position_marks` insert
- one `UPDATE shadow_positions ... FROM unnest(...)` update
- both writes run inside one short transaction after all non-DB mark resolution awaits

This preserves `updatedCount` as the number of positions with positive marks, keeps cache invalidation gated on `updatedCount > 0`, and leaves single-flighting unchanged. If either batched write fails, the transaction rolls both back and the refresh rejects like the previous failed per-row write path.

## Statement-Count Evidence

The PGlite integration test `mark refresh batches mark writes and preserves per-row values` installs a Drizzle query logger only around `refreshShadowPositionMarks()` and filters for mark write statements. The passing assertions prove:

- `markInserts.length === 1`
- `positionUpdates.length === 1`
- the insert statement is multi-row: `/values \(.+\), \(/`
- the update statement is set-based: `/from unnest\(/`

The same test seeds three open positions, returns two positive marks plus one zero mark, verifies `updatedCount === 2`, verifies the skipped row remains unchanged, and verifies the inserted mark rows and updated position values match the prior per-row money/as-of/source semantics.

## Unified Diff

```diff
--- artifacts/api-server/src/services/shadow-account.ts
+++ artifacts/api-server/src/services/shadow-account.ts
@@ -277,6 +277,28 @@
   quoteAsOf: Date | null;
 };
 
+type ShadowResolvedMark = {
+  price: number | null;
+  bid: number | null;
+  ask: number | null;
+  source: string;
+  asOf: Date;
+};
+
+type ShadowPositionMarkRefreshWrite = {
+  position: ShadowPositionRow;
+  contract: ShadowOptionContract | null;
+  optionQuote: Partial<QuoteSnapshot> | Record<string, unknown> | null | undefined;
+  optionPricing: ShadowOptionPricingPolicy | null;
+  markPrice: number;
+  mark: string;
+  marketValue: string;
+  unrealizedPnl: string;
+  source: string;
+  asOf: Date;
+  updatedAt: Date;
+};
+
 type SignalOptionsShadowMarkExitContext = {
   deployment: AlgoDeployment;
   profile: SignalOptionsExecutionProfile;
@@ -535,6 +557,12 @@
 let shadowReadCacheStaleWaitMsForTests: number | null = null;
 let shadowOptionQuoteCacheTtlMsForTests: number | null = null;
 let shadowOptionQuoteCacheStaleTtlMsForTests: number | null = null;
+let resolveEquityMarkForTests:
+  | ((
+      symbol: string,
+      position: ShadowPositionRow,
+    ) => Promise<ShadowResolvedMark> | ShadowResolvedMark)
+  | null = null;
 // Mark refresh mutates open-position valuation and account totals. It does not
   // mutate orders/fills, and equity-history has its own derived-read TTL; expiring
   // those on every mark tick made the marketing stream rebuild expensive DB reads
@@ -3800,13 +3828,7 @@
   return totals;
 }
 
-async function resolveEquityMark(symbol: string): Promise<{
-  price: number | null;
-  bid: number | null;
-  ask: number | null;
-  source: string;
-  asOf: Date;
-> {
+async function resolveEquityMark(symbol: string): Promise<ShadowResolvedMark> {
   const normalized = normalizeSymbol(symbol).toUpperCase();
   const quotes = await getQuoteSnapshots({
     symbols: normalized,
@@ -3850,6 +3872,14 @@
   };
 }
 
+async function resolveEquityMarkForShadowRefresh(
+  position: ShadowPositionRow,
+): Promise<ShadowResolvedMark> {
+  return resolveEquityMarkForTests
+    ? resolveEquityMarkForTests(position.symbol, position)
+    : resolveEquityMark(position.symbol);
+}
+
 async function resolveOptionMark(contract: ShadowOptionContract): Promise<{
   price: number | null;
   bid: number | null;
@@ -6034,6 +6064,73 @@
   };
 }
 
+async function writeShadowPositionMarkBatch(
+  writes: ShadowPositionMarkRefreshWrite[],
+) {
+  if (!writes.length) {
+    return;
+  }
+
+  const positionIds = sql.join(
+    writes.map((write) => sql`${write.position.id}`),
+    sql`, `,
+  );
+  const marks = sql.join(writes.map((write) => sql`${write.mark}`), sql`, `);
+  const marketValues = sql.join(
+    writes.map((write) => sql`${write.marketValue}`),
+    sql`, `,
+  );
+  const unrealizedPnls = sql.join(
+    writes.map((write) => sql`${write.unrealizedPnl}`),
+    sql`, `,
+  );
+  const asOfs = sql.join(writes.map((write) => sql`${write.asOf}`), sql`, `);
+  const updatedAts = sql.join(
+    writes.map((write) => sql`${write.updatedAt}`),
+    sql`, `,
+  );
+
+  await db.transaction(async (tx) => {
+    await tx.insert(shadowPositionMarksTable).values(
+      writes.map((write) => ({
+        accountId: SHADOW_ACCOUNT_ID,
+        positionId: write.position.id,
+        mark: write.mark,
+        marketValue: write.marketValue,
+        unrealizedPnl: write.unrealizedPnl,
+        source: write.source,
+        asOf: write.asOf,
+      })),
+    );
+
+    await tx.execute(sql`
+      update shadow_positions as p
+      set
+        mark = batched.mark,
+        market_value = batched.market_value,
+        unrealized_pnl = batched.unrealized_pnl,
+        as_of = batched.as_of,
+        updated_at = batched.updated_at
+      from unnest(
+        array[${positionIds}]::uuid[],
+        array[${marks}]::numeric[],
+        array[${marketValues}]::numeric[],
+        array[${unrealizedPnls}]::numeric[],
+        array[${asOfs}]::timestamptz[],
+        array[${updatedAts}]::timestamptz[]
+      ) as batched(
+        position_id,
+        mark,
+        market_value,
+        unrealized_pnl,
+        as_of,
+        updated_at
+      )
+      where p.id = batched.position_id
+    `);
+  });
+}
+
 export async function refreshShadowPositionMarks() {
   await ensureShadowAccount();
   const positions = await readOpenShadowPositions();
@@ -6045,9 +6142,9 @@
   const optionQuoteByProviderContractId = optionPositions.length
     ? await fetchShadowOptionDayChangeQuotes(optionPositions).catch(() => new Map())
     : new Map<string, Partial<QuoteSnapshot> | Record<string, unknown>>();
-  let updatedCount = 0;
   const latestMarkAtBySnapshotSource = new Map<string, Date>();
   const observedAt = new Date();
+  const markWrites: ShadowPositionMarkRefreshWrite[] = [];
 
   for (const position of positions) {
     const contract = asOptionContract(position.optionContract);
@@ -6081,7 +6178,7 @@
               source: optionPricing?.valuationReason ?? "quote_unavailable",
               asOf: optionPricing?.quoteAsOf ?? new Date(),
             }
-        : await resolveEquityMark(position.symbol);
+        : await resolveEquityMarkForShadowRefresh(position);
     const price = mark.price;
     if (price == null || price <= 0) {
       continue;
@@ -6094,48 +6191,55 @@
     });
     const marketValue = quantity * price * multiplier;
     const unrealizedPnl = (price - averageCost) * quantity * multiplier;
-    await db
-      .update(shadowPositionsTable)
-      .set({
-        mark: money(price),
-        marketValue: money(marketValue),
-        unrealizedPnl: money(unrealizedPnl),
-        asOf: mark.asOf,
-        updatedAt: new Date(),
-      })
-      .where(eq(shadowPositionsTable.id, position.id));
-    await db.insert(shadowPositionMarksTable).values({
-      accountId: SHADOW_ACCOUNT_ID,
-      positionId: position.id,
+    markWrites.push({
+      position,
+      contract,
+      optionQuote,
+      optionPricing,
+      markPrice: price,
       mark: money(price),
       marketValue: money(marketValue),
       unrealizedPnl: money(unrealizedPnl),
       source: mark.source,
       asOf: mark.asOf,
+      updatedAt: new Date(),
     });
-    if (position.assetClass === "option" && contract && optionPricing) {
+    const snapshotSource = shadowMarkSnapshotSourceForPosition(position);
+    const latestMarkAt = latestMarkAtBySnapshotSource.get(snapshotSource);
+    if (!latestMarkAt || mark.asOf.getTime() > latestMarkAt.getTime()) {
+      latestMarkAtBySnapshotSource.set(snapshotSource, mark.asOf);
+    }
+  }
+
+  await writeShadowPositionMarkBatch(markWrites);
+
+  for (const write of markWrites) {
+    if (
+      write.position.assetClass === "option" &&
+      write.contract &&
+      write.optionPricing
+    ) {
       await enforceSignalOptionsTrailingStopFromShadowMark({
-        position,
-        contract,
-        quote: optionQuote,
-        pricing: optionPricing,
-        markPrice: price,
-        markAt: mark.asOf,
+        position: write.position,
+        contract: write.contract,
+        quote: write.optionQuote,
+        pricing: write.optionPricing,
+        markPrice: write.markPrice,
+        markAt: write.asOf,
       }).catch((error) => {
         logger.warn?.(
-          { err: error, positionId: position.id, symbol: position.symbol },
+          {
+            err: error,
+            positionId: write.position.id,
+            symbol: write.position.symbol,
+          },
           "Signal-options mark-time trailing stop enforcement failed",
         );
       });
     }
-    updatedCount += 1;
-    const snapshotSource = shadowMarkSnapshotSourceForPosition(position);
-    const latestMarkAt = latestMarkAtBySnapshotSource.get(snapshotSource);
-    if (!latestMarkAt || mark.asOf.getTime() > latestMarkAt.getTime()) {
-      latestMarkAtBySnapshotSource.set(snapshotSource, mark.asOf);
-    }
   }
 
+  const updatedCount = markWrites.length;
   if (updatedCount) {
     invalidateShadowReadCachesAfterBackgroundMarkRefresh();
     for (const [source, latestMarkAt] of latestMarkAtBySnapshotSource) {
@@ -14575,6 +14679,9 @@
     shadowOptionQuoteCache.clear();
     shadowOptionGreekQuoteCache.clear();
   },
+  setResolveEquityMarkForTests(resolver: typeof resolveEquityMarkForTests) {
+    resolveEquityMarkForTests = resolver;
+  },
   rememberShadowOptionQuoteForTests: rememberShadowOptionQuote,
   readCachedShadowOptionQuotesForTests: readCachedShadowOptionQuotes,
   readShadowDashboardFillsWithOrdersForTests: readShadowDashboardFillsWithOrders,
--- artifacts/api-server/src/services/shadow-account-latest-marks.test.ts
+++ artifacts/api-server/src/services/shadow-account-latest-marks.test.ts
@@ -33,6 +33,35 @@
   assert.doesNotMatch(body, /\.groupBy\(shadowPositionMarksTable\.positionId\)/);
 });
 
+test("shadow position mark refresh batches mark writes", () => {
+  const refreshStart = source.indexOf(
+    "export async function refreshShadowPositionMarks",
+  );
+  const refreshEnd = source.indexOf("async function ensureFreshShadowState", refreshStart);
+  assert.notEqual(refreshStart, -1, "Missing refreshShadowPositionMarks");
+  assert.notEqual(refreshEnd, -1, "Missing refreshShadowPositionMarks end marker");
+  const refreshBody = source.slice(refreshStart, refreshEnd);
+
+  assert.match(refreshBody, /const markWrites: ShadowPositionMarkRefreshWrite\[\] = \[\]/);
+  assert.match(refreshBody, /await writeShadowPositionMarkBatch\(markWrites\)/);
+  assert.doesNotMatch(refreshBody, /\.update\(shadowPositionsTable\)/);
+  assert.doesNotMatch(refreshBody, /db\.insert\(shadowPositionMarksTable\)/);
+
+  const batchStart = source.indexOf("async function writeShadowPositionMarkBatch");
+  const batchEnd = source.indexOf(
+    "export async function refreshShadowPositionMarks",
+    batchStart,
+  );
+  assert.notEqual(batchStart, -1, "Missing writeShadowPositionMarkBatch");
+  assert.notEqual(batchEnd, -1, "Missing writeShadowPositionMarkBatch end marker");
+  const batchBody = source.slice(batchStart, batchEnd);
+
+  assert.match(batchBody, /\.insert\(shadowPositionMarksTable\)\.values\(/);
+  assert.match(batchBody, /update shadow_positions as p/);
+  assert.match(batchBody, /from unnest\(/);
+  assert.match(batchBody, /array\[\$\{positionIds\}\]::uuid\[\]/);
+});
+
 test("shadow automation event reads keep literal predicates for partial indexes", () => {
   assert.match(
     source,
--- artifacts/api-server/src/services/shadow-account-read-cache.test.ts
+++ artifacts/api-server/src/services/shadow-account-read-cache.test.ts
@@ -2,9 +2,65 @@
 import { readFileSync } from "node:fs";
 import test from "node:test";
 
-import { __shadowWatchlistBacktestInternalsForTests as internals } from "./shadow-account";
+import { asc } from "drizzle-orm";
+
+import {
+  db,
+  shadowAccountsTable,
+  shadowPositionMarksTable,
+  shadowPositionsTable,
+} from "@workspace/db";
+import { createTestDb } from "@workspace/db/testing";
+
+import {
+  __shadowWatchlistBacktestInternalsForTests as internals,
+  refreshShadowPositionMarks,
+  SHADOW_ACCOUNT_ID,
+} from "./shadow-account";
 
 const waitTurn = () => new Promise((resolve) => setImmediate(resolve));
+const testMoney = (value: number) => Number(value.toFixed(6)).toString();
+
+type QueryLogger = {
+  logQuery: (query: string, params: unknown[]) => void;
+};
+
+type DrizzleDbWithLoggerSession = {
+  session: {
+    logger: QueryLogger;
+    options: {
+      logger?: QueryLogger;
+    };
+  };
+};
+
+function captureShadowMarkWriteQueries(
+  testDb: Awaited<ReturnType<typeof createTestDb>>,
+  statements: string[],
+) {
+  const dbWithSession = testDb.db as unknown as DrizzleDbWithLoggerSession;
+  const previousLogger = dbWithSession.session.logger;
+  const previousOptionsLogger = dbWithSession.session.options.logger;
+  const captureLogger: QueryLogger = {
+    logQuery(query, params) {
+      const compact = query.replace(/\s+/g, " ").trim().toLowerCase();
+      if (
+        compact.startsWith('insert into "shadow_position_marks"') ||
+        compact.startsWith("insert into shadow_position_marks") ||
+        compact.startsWith("update shadow_positions as p")
+      ) {
+        statements.push(compact);
+      }
+      previousLogger.logQuery(query, params);
+    },
+  };
+  dbWithSession.session.logger = captureLogger;
+  dbWithSession.session.options.logger = captureLogger;
+  return () => {
+    dbWithSession.session.logger = previousLogger;
+    dbWithSession.session.options.logger = previousOptionsLogger;
+  };
+}
 
 type TestShadowPositionsResponse = {
   positions: Array<{ id: string; symbol: string; assetClass: string }>;
@@ -13,6 +69,188 @@
   reason?: string;
 };
 
+test("mark refresh batches mark writes and preserves per-row values", async () => {
+  const testDb = await createTestDb();
+  const markWriteStatements: string[] = [];
+  let restoreQueryLogger = () => {};
+
+  const aaplAsOf = new Date("2026-07-08T14:31:00.000Z");
+  const tslaAsOf = new Date("2026-07-08T14:32:00.000Z");
+  const msftAsOf = new Date("2026-07-08T14:33:00.000Z");
+
+  internals.setResolveEquityMarkForTests((symbol) => {
+    if (symbol === "AAPL") {
+      return {
+        price: 123.4567894,
+        bid: null,
+        ask: null,
+        source: "quote",
+        asOf: aaplAsOf,
+      };
+    }
+    if (symbol === "TSLA") {
+      return {
+        price: 12.3456789,
+        bid: null,
+        ask: null,
+        source: "bar_fallback",
+        asOf: tslaAsOf,
+      };
+    }
+    return {
+      price: 0,
+      bid: null,
+      ask: null,
+      source: "quote",
+      asOf: msftAsOf,
+    };
+  });
+
+  try {
+    await db.insert(shadowAccountsTable).values({
+      id: SHADOW_ACCOUNT_ID,
+      displayName: "Shadow",
+      currency: "USD",
+      startingBalance: "25000",
+      cash: "25000",
+      status: "active",
+    });
+    await db.insert(shadowPositionsTable).values([
+      {
+        id: "00000000-0000-4000-8000-000000000001",
+        accountId: SHADOW_ACCOUNT_ID,
+        positionKey: "equity:AAPL",
+        symbol: "AAPL",
+        assetClass: "equity",
+        positionType: "stock",
+        quantity: "2",
+        averageCost: "100",
+        mark: "100",
+        marketValue: "200",
+        unrealizedPnl: "0",
+        status: "open",
+      },
+      {
+        id: "00000000-0000-4000-8000-000000000002",
+        accountId: SHADOW_ACCOUNT_ID,
+        positionKey: "equity:MSFT",
+        symbol: "MSFT",
+        assetClass: "equity",
+        positionType: "stock",
+        quantity: "5",
+        averageCost: "50",
+        mark: "50",
+        marketValue: "250",
+        unrealizedPnl: "0",
+        status: "open",
+      },
+      {
+        id: "00000000-0000-4000-8000-000000000003",
+        accountId: SHADOW_ACCOUNT_ID,
+        positionKey: "equity:TSLA",
+        symbol: "TSLA",
+        assetClass: "equity",
+        positionType: "stock",
+        quantity: "3",
+        averageCost: "10",
+        mark: "10",
+        marketValue: "30",
+        unrealizedPnl: "0",
+        status: "open",
+      },
+    ]);
+
+    restoreQueryLogger = captureShadowMarkWriteQueries(testDb, markWriteStatements);
+    const result = await refreshShadowPositionMarks();
+
+    assert.equal(result.updatedCount, 2);
+
+    const positions = await db
+      .select()
+      .from(shadowPositionsTable)
+      .orderBy(asc(shadowPositionsTable.symbol));
+    const positionsBySymbol = new Map(
+      positions.map((position) => [position.symbol, position]),
+    );
+    const aaplPosition = positionsBySymbol.get("AAPL");
+    const msftPosition = positionsBySymbol.get("MSFT");
+    const tslaPosition = positionsBySymbol.get("TSLA");
+    assert.ok(aaplPosition);
+    assert.ok(msftPosition);
+    assert.ok(tslaPosition);
+
+    assert.equal(aaplPosition.mark, testMoney(123.4567894));
+    assert.equal(aaplPosition.marketValue, testMoney(2 * 123.4567894));
+    assert.equal(
+      aaplPosition.unrealizedPnl,
+      testMoney((123.4567894 - 100) * 2),
+    );
+    assert.equal(aaplPosition.asOf.toISOString(), aaplAsOf.toISOString());
+
+    assert.equal(msftPosition.mark, "50.000000");
+    assert.equal(msftPosition.marketValue, "250.000000");
+    assert.equal(msftPosition.unrealizedPnl, "0.000000");
+
+    assert.equal(tslaPosition.mark, testMoney(12.3456789));
+    assert.equal(tslaPosition.marketValue, testMoney(3 * 12.3456789));
+    assert.equal(
+      tslaPosition.unrealizedPnl,
+      testMoney((12.3456789 - 10) * 3),
+    );
+    assert.equal(tslaPosition.asOf.toISOString(), tslaAsOf.toISOString());
+
+    const marks = await db
+      .select()
+      .from(shadowPositionMarksTable)
+      .orderBy(asc(shadowPositionMarksTable.positionId));
+    assert.equal(marks.length, 2);
+    assert.deepEqual(
+      marks.map((mark) => ({
+        positionId: mark.positionId,
+        mark: mark.mark,
+        marketValue: mark.marketValue,
+        unrealizedPnl: mark.unrealizedPnl,
+        source: mark.source,
+        asOf: mark.asOf.toISOString(),
+      })),
+      [
+        {
+          positionId: "00000000-0000-4000-8000-000000000001",
+          mark: testMoney(123.4567894),
+          marketValue: testMoney(2 * 123.4567894),
+          unrealizedPnl: testMoney((123.4567894 - 100) * 2),
+          source: "quote",
+          asOf: aaplAsOf.toISOString(),
+        },
+        {
+          positionId: "00000000-0000-4000-8000-000000000003",
+          mark: testMoney(12.3456789),
+          marketValue: testMoney(3 * 12.3456789),
+          unrealizedPnl: testMoney((12.3456789 - 10) * 3),
+          source: "bar_fallback",
+          asOf: tslaAsOf.toISOString(),
+        },
+      ],
+    );
+
+    const markInserts = markWriteStatements.filter((statement) =>
+      statement.startsWith('insert into "shadow_position_marks"') ||
+      statement.startsWith("insert into shadow_position_marks"),
+    );
+    const positionUpdates = markWriteStatements.filter((statement) =>
+      statement.startsWith("update shadow_positions as p"),
+    );
+    assert.equal(markInserts.length, 1);
+    assert.equal(positionUpdates.length, 1);
+    assert.match(markInserts[0] ?? "", /values \(.+\), \(/);
+    assert.match(positionUpdates[0] ?? "", /from unnest\(/);
+  } finally {
+    internals.setResolveEquityMarkForTests(null);
+    restoreQueryLogger();
+    await testDb.cleanup();
+  }
+});
+
 test("shadow read cache serves stale values immediately while refresh continues", async () => {
   const key = `test-shadow-read-immediate-${Date.now()}-${Math.random()}`;
   let resolveRefresh: (value: TestShadowPositionsResponse) => void = () => {
```

## Test Output

Command:

```bash
pnpm --filter @workspace/api-server exec tsx --test src/services/shadow-account-latest-marks.test.ts src/services/shadow-account-read-cache.test.ts src/services/shadow-account-recompute.test.ts src/services/shadow-account-streams.test.ts
```

Output:

```text
✔ snapshot totals read one latest mark per requested position (2.451773ms)
✔ position peak marks use lateral top-one probes instead of grouped scans (0.209277ms)
✔ shadow position mark refresh batches mark writes (0.248155ms)
✔ shadow automation event reads keep literal predicates for partial indexes (0.273634ms)
✔ mark refresh batches mark writes and preserves per-row values (14214.243145ms)
✔ shadow read cache serves stale values immediately while refresh continues (17.580293ms)
✔ background mark refresh keeps order and history caches hot (0.635802ms)
✔ mark refresh during an in-flight non-mark-affected compute keeps the cached store (4.884182ms)
✔ mark refresh during an in-flight mark-affected compute still discards its store (0.388587ms)
✔ shadow option quote cache keeps stale display quotes during live refresh gaps (15.268546ms)
✔ shadow option quote cache does not replace display quotes with empty updates (0.303964ms)
✔ shadow positions pressure fallback builds a bounded degraded snapshot from open rows (0.9584ms)
✔ shadow account positions use immediate stale cache strategy (1.810349ms)
✔ open shadow positions helper serves stale cache immediately (1.907629ms)
✔ shadow account positions pressure path does not start a full refresh (5.931337ms)
✔ shadow reusable position caches gate stale reuse on resource pressure (4.214469ms)
✔ shared dashboard fills+orders read serves stale immediately at the derived TTL (1.361293ms)
✔ shared dashboard fills+orders read is bounded and uses a 30s derived TTL (1.258121ms)
✔ automation ledger realized P&L keeps the all-time source path (3.623752ms)
✔ shared dashboard fills+orders read joins one in-flight operation (1.992029ms)
✔ shadow order tabs share the cached full account order scan (3.415607ms)
✔ shadow trade diagnostics uses shared stale-immediate read cache (3.735059ms)
✔ recompute sums only analytics-qualifying fills (excludes forward-test orders) (12355.66513ms)
✔ empty ledger -> startingBalance, zero pnl/fees (25.41619ms)
✔ a NULL-free realizedPnl set and all-qualifying ledger sums every fill (72.468359ms)
✔ shadow account stream snapshot uses live quote hydration (0.712866ms)
✔ shadow account stream snapshot cache spans multiple poll ticks (0.220554ms)
✔ shadow account stream skips full signature work for reused cached snapshots (0.1132ms)
ℹ tests 28
ℹ suites 0
ℹ pass 28
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 52861.827054
```
