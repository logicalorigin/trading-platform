# Signal-system tables: consolidation plan (2026-07-09 study, VERIFIED REVISION)

Revision note: the first version of this doc contained two false bloat claims taken from
pg_stat estimates on never-analyzed tables (`n_live_tup` lied — the same trap as bar_cache's
"56k rows" earlier today). Every claim below has been re-verified with real `count(*)` and
direct code reads (session e2aac502). Line refs are signal-monitor.ts unless noted.

## The question asked: "merge state into the matrix?"

**No — the premise is inverted, and this half is code-verified.** The matrix is not durable:
`SIGNAL_MONITOR_MATRIX_CACHE_TTL_MS = 0` / `STALE_TTL = 0` (:453-454), recomputed per request;
in-memory caches are evictable LRUs that die on restart. `signal_monitor_symbol_states`
**is the matrix's persistence**: boot/SSE hydration reads it (readCurrentSignalMonitorMatrixStates
:14665 via :14738/:15156; passive bootstrap :15903/:16042) so the matrix renders without
re-evaluating the universe. Merging it into `signal_monitor_events` fails structurally: events is
append-only/unique-keyed; symbol_states mutates per evaluation and its persist path does a per-cell
read-modify-write latch (applyStoredSignalDirectionLatch :7444 used :7661;
shouldPreserveExistingSignalMonitorSymbolState :10463 used :7668) that needs the current stored
row. It is also small (36,209 rows / 88 MB, upsert-bounded). **Verdict: keep as-is.**

## Verified table facts (real count(*), 2026-07-09 ~23:50Z)

| Table | Size | Real rows | Assessment |
|---|---|---|---|
| overnight_signal_expectancy_samples | 1,427 MB | **2,453,712** | Real study data (NOT empty — census stats were wrong). No retention pruner exists. |
| overnight_signal_expectancy_results | 104 kB | 18 | Real study output. Trivial. |
| shadow_position_marks | 288 MB | **793,738** | Healthy for its row count; pruner exists (180d closed). Not bloat. |
| automation_diagnostics | 984 kB | 409 | Trivial size; mirrors execution_events shape, union-read. |
| signal_monitor_symbol_states | 88 MB | 36,209 | Healthy, bounded. |
| signal_monitor_events | 145 MB | 88,850 | Healthy ledger, 120d retention. |
| execution_events / bar_cache | — | — | Already handled by today's EE-FIREHOSE/retention and RET-1/REINDEX/WO-IDX-1 lanes. |

## What survived verification (actionable)

1. **`overnight_signal_expectancy_samples` (1.4 GB, 2.45M rows) — investigated 2026-07-09:**
   NOT an abandoned relic. The feature is two days old (migration 20260707); one study ran
   2026-07-07 → 07-08 03:59Z producing 2.45M samples + 18 results; the API reads BOTH tables by
   studyId (backtesting.ts:2538/2625). "Never tuned" decomposed: (a) bulk-written once then quiet,
   (b) pg_stat activity counters wiped by Neon compute restarts, so autovacuum's thresholds never
   see the historical writes — an artifact, not neglect; (c) the REAL gaps: no ANALYZE ever
   (fixed 2026-07-09 — first ANALYZE run, logged in run-vacuum.log) and **no retention pruner**,
   so each future study run adds ~2.5M rows forever. Action: add a study-scoped retention pruner
   (keep last N studies) to lib/db/src/retention.ts — Riley to pick N.
2. **`signal_options_seen_signals` debug columns are write-only** (verified: the dedup reader at
   automation.ts:9687-9690 selects only signal_key/reason/payload_retryable; premium_cap /
   chain_debug_reason / expirations_debug_reason are never selected). Optional small writer-side
   thinning; rows are unique-key-bounded so the win is modest.
3. **Never-scanned-index drops: defer pending trustworthy stats.** The idx_scan=0 readings come
   from a post-restore stats window; re-measure after ≥1 full RTH day before dropping anything
   (candidates then: shadow_position_marks pkey/account/position, sm_events symbol_idx,
   execution_events overnight_deploy_occurred).

## Claims from the first draft now RETRACTED (verified false)

- ~~"expectancy_samples is empty, TRUNCATE reclaims 1.4GB"~~ — holds 2.45M rows. Truncate would
  destroy study data.
- ~~"shadow_position_marks: 288MB for 396 rows, VACUUM FULL reclaims ~285MB"~~ — holds 794k rows;
  size is proportionate. No action.
- ~~"marks market_value/unrealized_pnl written but never read"~~ — both ARE read: day-change
  baseline consumes marketValue (shadow-account.ts:7569/7690) and equity-history selects
  unrealized_pnl (:3799). Keep writing both.
- automation_diagnostics merge downgraded from "worth doing" to note-only: <1 MB, union-read works;
  a migration buys hygiene, not capacity. Fold in only if that code is being rewritten anyway.

## Rule of thumb (unchanged, and now better-earned)

The mess is lifecycle mixing, not table count — and **estimates from never-analyzed tables are
not facts**. Any future reclaim/drop decision on these tables starts with `count(*)` and a reader
grep, not pg_stat.
