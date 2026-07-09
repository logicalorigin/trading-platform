# HUNT-C Cache Coherence Report

1. artifacts/api-server/src/services/account.ts:4564 | P1 | SnapTrade account balances survive live order submission
Evidence: `resolveSnapTradeAccountBalance` returns `snapTradeAccountBalanceCache` while fresh and seeds it for `SNAPTRADE_BALANCE_CACHE_TTL_MS` at lines 4564-4582; `/api/accounts` also wraps the full account-list response in a 5s/60s route cache at lines 4847-4852. `submitSnapTradeEquityOrder` posts the order and records tax submission at artifacts/api-server/src/services/snaptrade-equity-orders.ts:1292-1309, but there is no balance/account-list cache invalidation in that path.
Consequence: after a SnapTrade live order, account cash/buying-power shown through the account list can remain pre-order for up to 45s even if the UI refetches.
Laziest fix: export a scoped SnapTrade account balance/list invalidator from `account.ts` and call it after successful SnapTrade order submission.
Confidence: 0.87

2. artifacts/api-server/src/services/platform.ts:3094 | P1 | IBKR order mutations do not bust server order visibility cache
Evidence: `listOrdersForVisibility` returns `orderVisibilityCache` when fresh at lines 3094-3097 and stores successful reads for `IBKR_ORDER_VISIBILITY_CACHE_TTL_MS` at lines 3130-3137. `placeOrder`, `replaceOrder`, and `cancelOrder` submit mutations at lines 4816, 4892, and 4912 without clearing `orderVisibilityCache` or `orderVisibilityInFlight`.
Consequence: the frontend invalidates `/api/orders`, but the refetch can still receive the pre-submit/pre-cancel open-order payload for the cache window, making trading controls show the wrong working orders.
Laziest fix: clear affected order visibility cache keys and in-flight reads immediately after successful place/replace/cancel.
Confidence: 0.92

3. artifacts/api-server/src/services/signal-monitor.ts:3902 | P2 | Signal-monitor expansion universe memo is not invalidated by ranking writes
Evidence: the catalog/ranking expansion memo is cached by limit for 5 minutes at lines 3873-3883 and returned at lines 3902-3905. The ranking writer upserts/deletes `signalUniverseRankingsTable` at artifacts/api-server/src/services/signal-universe-ranking.ts:449-472, while the only exposed invalidator appears under test internals at artifacts/api-server/src/services/signal-monitor.ts:14325-14328.
Consequence: after a ranking refresh changes optionable membership/order, signal-monitor expansion can keep scanning the old universe for up to 5 minutes.
Laziest fix: move the memo invalidator to a production-safe boundary or callback registry and call it after `persistSignalUniverseRankings` completes.
Confidence: 0.82

4. artifacts/api-server/src/services/platform.ts:4030 | P2 | Watchlist list in-flight reads can repopulate stale cache after writes
Evidence: `listWatchlists` starts an in-flight DB read and unconditionally caches its result in `.then` at lines 4027-4030. `invalidateWatchlistListCache` only nulls the cache and in-flight pointer at lines 863-866; watchlist mutations call it after writes, e.g. add-symbol at lines 4284-4292.
Consequence: a list read that started before a watchlist mutation can resolve after the mutation and write the old snapshot back as fresh, briefly reverting watchlist UI and live-quote prewarm symbols.
Laziest fix: version the watchlist cache and only write an in-flight result if its captured version still matches current.
Confidence: 0.78

5. artifacts/api-server/src/services/diagnostics.ts:3770 | P2 | Diagnostic threshold in-flight reads can overwrite post-update cache
Evidence: `loadThresholdOverrides` reuses an in-flight read at lines 3766-3768 and every read completion writes `diagnosticThresholdOverridesCache` at lines 3770-3775. `updateDiagnosticThresholds` invalidates the settled cache before/after DB writes at lines 4610 and 4644, but it does not cancel/version older in-flight reads before returning a force refresh at line 4645.
Consequence: a threshold read that began before an update can finish after the update and repopulate the override cache with old thresholds for 30s.
Laziest fix: increment a threshold-cache generation on invalidation and gate `.then` cache writes on the captured generation.
Confidence: 0.8

6. artifacts/api-server/src/services/automation.ts:1327 | P2 | Algo event list cache is not busted by event writers
Evidence: `listExecutionEvents` serves cached event pages at lines 1326-1328 and stores them for `EXECUTION_EVENTS_LIST_CACHE_TTL_MS` at lines 1341-1344. Signal-options event persistence inserts `executionEventsTable` rows at artifacts/api-server/src/services/signal-options-automation.ts:2422-2434 and then invalidates dashboard caches at line 2453, but not `executionEventsListCache`.
Consequence: algo cockpit/event-feed reads can miss a just-written automation event until the 2s TTL expires, despite explicit frontend invalidations/polls.
Laziest fix: export a production `invalidateExecutionEventsListCache(deploymentId?)` and call it from all execution-event insert paths.
Confidence: 0.75

Coverage note: sampled cache/memo/TTL declarations in `artifacts/api-server/src/services`, `artifacts/api-server/src/routes`, `lib`, `lib/api-client-react`, and PYRUS React query/runtime-cache call sites. Ruled out as sufficiently guarded or intentionally bounded: user preferences per-user cache, shadow mark-refresh cache prefixes/versioning, signal-monitor state-row cache in-flight guard, bar-cache content-stamp invalidation (known), runtime chart cache keys sampled for trade equity/option bars, and heavy GET single-flight keying including URL/headers/request options.
