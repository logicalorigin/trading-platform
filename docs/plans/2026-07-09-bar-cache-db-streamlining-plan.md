# Implementation Plan: bar_cache / DB Read-Write Streamlining — Remaining & Possible Work

Post-completion of session 8939ce3f's three workstreams (2026-07-09; see
`SESSION_HANDOFF_2026-07-08_f4fe79f8-4c46-4d8d-82db-1e366ae3edb9.md`). This plan covers what MUST
still happen (verification of landed work) and what CAN happen (decision-gated structural cures),
per /planning-and-task-breakdown.

## Overview

The 5m-signal root cause (cold-disk bar_cache reads → statement_timeout 57014) has a landed
retention fix (`c3eae073`) plus write-side streamlining (`b9da851a`) and a crash fix (`5221e90e`) —
but the decisive verification (SPY 5m probe) never ran because the API crashed and the dev
supervisor died. Evidence gathered this session says retention at the approved 60d policy removes
only ~16% of the table (~3.3M of ~19.9M rows; write rate ~560k/day accelerating; 89%
massive-history across 1,348 symbols), so the probe may still be red — the structural cures are
scoped below but need owner authorization.

## Architecture Decisions (already made, evidence-based)

- Retention policy stays at 60d intraday / 400d daily (owner decision 2026-07-09; declined 14d and
  copy-swap for now). Scheduler auto-drains 1M rows/6h.
- Read path keeps the full-window durable read for now — the read-side delta ("only read since
  last change") is explicitly deferred (owner decision).
- The covering index `(symbol, timeframe, source, starts_at)` already exists
  (`lib/db/src/schema/market-data.ts:68`) — reads are index-optimal; NO index work is planned. The
  bottleneck is heap-page coldness from table volume, hence retention/volume work, not query work.
- bar_cache is a self-healing cache (miss → provider refetch + re-persist): eviction is always
  safe; the cost of aggressive retention is only re-fetch latency.

## Task List

### Phase 0: Recover & Verify (blocked on the Run button — nothing else proceeds)

#### Task 0: Bootstrap the app (USER)
Press Run once. pid2 must spawn the supervisor (shell-launching detaches the preview). Boot
rebuilds from source, loading all 11 landed commits.
**AC:** `curl http://127.0.0.1:8080/api/healthz` → 200; web title probe on
`https://$REPLIT_DEV_DOMAIN/` renders.
**Deps:** none. **Size:** XS (user action).
NOTE: this session's shell lost node/pnpm/python3/psql from PATH (~03:45Z); a fresh session should
`command -v pnpm` before anything.

#### Task 1: Boot stability + crash-fix verification
**Description:** Confirm the idle-in-tx crash cannot recur and the fix behaves.
**AC:**
- [ ] No `uncaught-exception` events in `.pyrus-runtime/flight-recorder/api-events-*.jsonl` for 30+ min under normal load.
- [ ] Any `postgres-pool-error` events log-and-survive (grep stderr/flight recorder; process uptime unbroken).
**Verification:** flight-recorder grep + `pgrep` uptime check.
**Deps:** Task 0. **Files:** none (observation). **Size:** XS.

#### Task 2: Retention scheduler live confirmation
**Description:** Prove the landed `pruneBarCache` executes non-dry-run on schedule.
**AC:**
- [ ] Within ~10 min of boot, a retention log/flight-recorder line shows `table:'bar_cache'` with `deleted>0`.
- [ ] No statement-timeout errors from the sweep itself (bounded probe + batches hold).
**Verification:** flight-recorder/log grep; bounded psql count before/after one cycle.
**Deps:** Task 0. **Size:** XS.

#### Task 3: The 5m probe (the decisive check)
**Description:** Re-run session 8939ce3f's in-process probe. Temp file
`artifacts/api-server/src/services/__probe-5m.mts` importing `loadSignalMonitorCompletedBars` from
`./signal-monitor`; SPY on 1m/5m/15m; measure wall-clock; catch 57014. Delete the file after.
**AC:**
- [ ] 5m completes with NO 57014.
- [ ] 5m wall-clock within ~3× of 1m/15m (baseline red: 16,357ms vs 183/208ms).
- [ ] 5m exec:mtf recency restored to 1:1 in the product surface the user originally flagged.
**Verification:** `pnpm --filter @workspace/api-server exec tsx src/services/__probe-5m.mts`; screenshot/API check of 5m signal freshness.
**Deps:** Tasks 0–2 (+ some drain progress). **Size:** S.

#### Task 4: Post-drain VACUUM (ANALYZE)
**Description:** Reclaim dead tuples from the ~210k manual + scheduler deletions. Plain vacuum
only — NEVER `VACUUM FULL` (exclusive lock on a live trading DB).
**AC:**
- [ ] `VACUUM (ANALYZE) bar_cache` completes; `pg_stat_user_tables.last_vacuum/last_analyze` populated.
- [ ] Investigate WHY autovacuum has never touched this table (observed: empty last_autovacuum/last_autoanalyze) — check `pg_settings` autovacuum values and per-table storage parameters; report findings even if the hosted DB doesn't allow changes.
**Verification:** psql pg_stat query before/after.
**Deps:** Task 0. **Size:** S.

### Checkpoint: Phase 0
- [ ] App stable ≥30 min, no crashes.
- [ ] Probe verdict recorded (GREEN → Phase 2 becomes optional; RED → Phase 2 becomes the priority).
- [ ] Report probe table (1m/5m/15m, pre vs post) to owner.

### Phase 1: Read-path resilience (small, valuable regardless of probe verdict)

#### Task 5: Durable-read timeout degrades everywhere (never fails an eval)
**Description:** The original 57014 THREW out of `loadSignalMonitorCompletedBars` (proven by the
probe). Some sites already classify statement-timeouts (`signal-monitor.ts:15546,15787,16260`);
audit the durable-read call sites (`market-data-store.ts loadStoredMarketBars*` consumers:
signal-monitor-local-bar-cache.ts, platform.ts:10869) so a store timeout ALWAYS degrades to
provider fallback + `"skipped"`-style telemetry instead of failing the evaluation.
**AC:**
- [ ] A forced statement-timeout on the durable read (test with tiny `statement_timeout` via test hook) yields provider-fallback bars, not a thrown eval error.
- [ ] Timeout increments a visible counter (diagnostics or flight recorder), so silent degradation is observable.
**Verification:** new tsx --test suite; `pnpm --filter @workspace/api-server exec tsx --test --test-force-exit <new test>`.
**Deps:** Task 0 (env). **Files:** market-data-store.ts, signal-monitor-local-bar-cache.ts, +test. **Size:** M.

#### Task 6: Make the 5m probe repeatable (stop hand-writing it)
**Description:** Commit the probe as `scripts/probe-bar-latency.mts` (or api-server script):
symbol+timeframes args, JSON output, exits non-zero on 57014. It has now been hand-written twice.
**AC:**
- [ ] `pnpm probe:bars -- SPY 1m,5m,15m` (or equivalent) prints a timing table and exit code reflects health.
**Verification:** run it; compare to Task 3 output.
**Deps:** Task 3 learnings. **Files:** 1 new script + package.json line. **Size:** S.

#### Task 7: Fix the c3eae073 docstring lie
**Description:** `lib/db/src/retention.ts` claims signal-monitor is the ONLY bar_cache reader;
`platform.ts:10869` also reads it. Correct the comment so future retention decisions aren't made
on a false premise.
**AC:** docstring names both readers + their lookback envelopes.
**Deps:** none. **Files:** retention.ts (comment only). **Size:** XS.

### Checkpoint: Phase 1
- [ ] api-server typecheck EXIT=0; touched suites green (`tsx --test`, NOT vitest).
- [ ] SIGUSR2 reload + healthz 200.

### Phase 2: Structural volume cure (DECISION-GATED — pick after Task 3's verdict)

#### Task 8: Measure the write-waste before fixing it (data first)
**Description:** The cure hypothesis: most of the ~560k rows/day (1,348 symbols, 89%
massive-history) are written once and never re-read. PROVE it: instrument or sample which
(symbol,timeframe) windows the two readers actually request over 24h vs what gets persisted.
**AC:**
- [ ] A report: top-N persisted-but-never-read symbol/timeframe buckets, % of daily write volume they represent.
**Verification:** report file with query/log evidence.
**Deps:** Tasks 0, 2. **Size:** M. **Risk note:** do NOT change behavior yet.

#### Task 9: Scope bar-persist writes to actual readers (the real cure — NEEDS OWNER AUTHORIZATION)
**Description:** Using Task 8's data, gate `queueBarsBackgroundPersist`/`persistMarketDataBars` to
universes that get re-read (signal-monitor matrix + actively-charted symbols), or add a
read-triggered persist promotion. Design doc first (spec-driven; this touches the hot path).
**AC:**
- [ ] Write volume drops to the read-universe envelope (measure: rows/day before vs after).
- [ ] No reader regression: probe + signal freshness unchanged; gap-fill still self-heals for unscoped symbols.
**Deps:** Task 8 + owner go. **Files:** platform.ts, market-data-store.ts, +tests. **Size:** L → break down after Task 8.

#### Task 10: Retention tightening (NEEDS OWNER DECISION — declined 2026-07-09, revisit with probe data)
**Description:** If probe is red after full 60d drain: `BAR_CACHE_INTRADAY_RETENTION_DAYS=14` env
(readers need ≤10d) — no code change, reversible instantly.
**AC:** post-tightening probe green; no reader re-fetch storm (watch massive-history request rate).
**Deps:** Task 3 red verdict + owner go. **Size:** XS (env) + observation.

#### Task 11: Copy-swap rebuild (LAST RESORT — NEEDS OWNER GO)
**Description:** If retention alone can't restore locality (8GB file keeps rows scattered even
after deletes): build `bar_cache_new` keeping policy rows, delta-copy, single-transaction rename
swap (ms-scale lock), drop old. Compact file + fresh indexes = decisive cold-read cure.
**AC:** post-swap probe green; row counts match keep-policy; writers resume seamlessly (self-heal
covers the copy-window loss).
**Deps:** Tasks 3, 4, 10 verdicts + owner go. **Size:** M (script + supervised run).

### Checkpoint: Phase 2
- [ ] Probe green (the realm's exit criterion) OR explicit owner acceptance of current timings.
- [ ] bar_cache size trend flat-or-down week-over-week.

### Phase 3: Deferred / opportunistic (owner deferred; listed so they're not lost)

#### Task 12: Read-side delta read (DEFERRED by owner 2026-07-08)
Watermark-based incremental reads in `loadSignalMonitorCompletedBars` ("only read since last
change"). Only worth designing if Phase 2 leaves read latency unsatisfying — retention+scoping may
make it moot. **Size:** L (design doc first).

#### Task 13: bar_cache observability
Surface in diagnostics: table size (bounded probe), persist-queue counters (already counted:
skipped/coalesced/dropped — expose them), 57014 event counter, retention sweep results. One
diagnostics panel/endpoint addition. **Size:** S–M.

#### Task 14: Push the branch
`main` is 30+ commits ahead of origin (and a concurrent lane rewrote one of its own local commits
— verify `git log origin/main..HEAD` is sane first). Coordinate with active sessions before
pushing. **Size:** XS + coordination.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Probe still red after full 60d drain | High (realm goal unmet) | Phase 2 pre-scoped; escalate with data, not guesses |
| Write scoping (T9) starves an unnoticed reader | High | T8 measures readers FIRST; self-healing cache bounds damage to refetch latency |
| Concurrent sessions (f834d411 etc.) collide on hot files | Med | Re-check `git status` per file before every commit; explicit-path staging only |
| VACUUM/drain IO degrades live trading during market hours | Med | Run in off-hours; watch pool waiting; abort rules as in WO-R5 |
| idle-in-tx 10s kill switch fires under ELU stalls | Med (now survivable) | 5221e90e makes it non-fatal; T5 adds degradation; watch postgres-pool-error rate |
| Env/PATH degradation recurs | Low | Verify `command -v pnpm` at session start; note in handoffs |

## Open Questions (owner input needed before the gated tasks)

1. After Task 3's probe verdict: if red, which Phase 2 lever first — retention tightening (T10,
   instant/reversible) or write scoping (T9, structural but bigger)?
2. Is a 24h read-instrumentation window (T8) acceptable on the live API (tiny overhead, log-only)?
3. When should the 30+ local commits be pushed to origin, and who coordinates the active lanes?
