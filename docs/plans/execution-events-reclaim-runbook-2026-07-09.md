# execution_events reclaim runbook (2026-07-09)

**Owner:** Riley. **Status:** demand fix landed (WO-EE-FIREHOSE); reclaim below is
scheduled/executed manually by the owner. **Do NOT run any step here from an
automated fix worker.**

## What already changed (the demand fix — no reclaim yet)

`execution_events` had grown to ~3,384 MB / ~1,086,718 live rows, 92% written in
the last 7 days. Composition of the last-7-day backlog:

- `signal_options_candidate_skipped` — 853,124 rows / 1,672 MB (one ~2KB event
  per candidate per scan cycle).
- `signal_options_shadow_mark` — 146,243 rows / 489 MB (per-position per-tick).
- Real trade history is tiny (entries 53, exits 42, candidates_created 3,103).

Landed to stop re-bloat:

1. **Coalesce the skip firehose** at the writer (`emitSkippedCandidate`): repeats
   of the same `(deploymentId, symbol, reason, signalKey)` inside a 15-min window
   (`SIGNAL_OPTIONS_SKIP_EVENT_COALESCE_MS`) update one row's
   `count`/`firstSeenAt`/`lastSeenAt` instead of inserting a new row. `signalKey`
   is in the key so the `signal_options_seen_signals` dedup (live trading logic)
   keeps one row per signal.
2. **Rate-bound mark EVENTS**: the per-tick `execution_events` mark row is floored
   to one per position per 5 min (`SIGNAL_OPTIONS_MARK_EVENT_MIN_INTERVAL_MS`);
   the `shadow_position_marks` TABLE (peak/high-water source) still gets every
   tick, so mark fidelity is unchanged.
3. **48h diagnostic retention** in the background-lane snapshot retention
   scheduler (`lib/db/src/retention.ts` → `pruneExecutionEventsDiagnostics`,
   auto-run by `runAllSnapshotRetention` on `runInDbLane("background", …)`).
   Diagnostic types are an explicit allowlist (skip, mark, gateway-blocked,
   scan-status, `overnight_spot_signal_blocked`); every trade/lifecycle type is
   never eligible. Window: `EXECUTION_EVENTS_DIAGNOSTIC_RETENTION_HOURS` (48h).

The retention sweep deletes in bounded batches with a `maxRowsPerRun` cap
(default 1,000,000), reporting `hitCap` so the scheduler switches to its backlog
cadence and drains the ~1M-row backlog over successive runs — exactly the
`bar_cache` pruner pattern. **Physical space is NOT reclaimed by DELETE** (dead
tuples stay until VACUUM); that is the step below.

## Reclaim sequence (run AFTER the retention sweep has drained the backlog)

Precondition: the retention scheduler has run enough backlog sweeps that the
diagnostic backlog is gone and the table holds only ~2 days of coalesced events.
Verify:

```sql
-- Should be a few thousand, not ~1M. Bounded to avoid a full scan.
select count(*) from (
  select 1 from execution_events
  where event_type in (
    'signal_options_candidate_skipped','signal_options_shadow_mark',
    'signal_options_gateway_blocked','signal_options_scan_running',
    'signal_options_scan_long_running','signal_options_scan_stale',
    'signal_options_signal_scan_degraded','overnight_spot_signal_blocked'
  ) and occurred_at < now() - interval '48 hours'
  limit 50000
) s;

-- Dead tuples still present until VACUUM (this is the space to reclaim):
select n_live_tup, n_dead_tup, last_autovacuum
from pg_stat_user_tables where relname = 'execution_events';

-- Physical size before:
select pg_size_pretty(pg_total_relation_size('execution_events'));
```

Once the backlog is drained, a `VACUUM FULL` is a small rewrite (the live set is
now tiny), so the exclusive lock is brief:

```sql
VACUUM (FULL, ANALYZE, VERBOSE) execution_events;
```

**Lock note:** `VACUUM FULL` takes an `ACCESS EXCLUSIVE` lock and rewrites the
table — every reader/writer of `execution_events` blocks for the duration. Run it
in a low-activity window (outside RTH). Because the reclaim is done only AFTER the
backlog has drained, the rewrite copies only the small live set, so the lock is
short; do NOT run `VACUUM FULL` against the full ~3.4GB bloated table — that lock
would be long. (Ordinary `VACUUM execution_events;` — no `FULL` — reclaims to the
freelist without an exclusive lock if you only need autovacuum to catch up rather
than shrink the file.)

Verify after:

```sql
select pg_size_pretty(pg_total_relation_size('execution_events'));
select n_live_tup, n_dead_tup from pg_stat_user_tables where relname = 'execution_events';
```

Expect the total relation size to drop from GB to the small live-set size and
`n_dead_tup` ≈ 0.

## Rollback / knobs

- `EXECUTION_EVENTS_DIAGNOSTIC_RETENTION_HOURS` — widen the diagnostic window.
- `EXECUTION_EVENTS_DIAGNOSTIC_RETENTION_MAX_ROWS_PER_RUN` — per-sweep delete cap.
- `SIGNAL_OPTIONS_SKIP_EVENT_COALESCE_MS=0` — disable skip coalescing.
- `SIGNAL_OPTIONS_MARK_EVENT_MIN_INTERVAL_MS=0` — disable the mark-event floor.
- `SNAPSHOT_RETENTION_ENABLED=false` — disable the whole retention scheduler.
