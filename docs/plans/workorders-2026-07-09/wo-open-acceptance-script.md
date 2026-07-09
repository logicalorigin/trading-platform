# WO-OPEN-ACCEPT — One-command market-open acceptance capture (scripts/diag)

> **HEADLESS WORKER PREAMBLE (overrides AGENTS.md session rituals):** You are a headless fix worker,
> not an interactive session. (1) Do NOT create/update any SESSION_HANDOFF_* file. (2) Do NOT read
> ~/.claude/, ~/.agents/, .claude/skills/, .agents/skills/, agents/, or AGENTS.md session sections.
> (3) NEVER restart/reload/signal the app, never `git push`. You MAY run the script once against
> the live API to smoke-test it (read-only probes + SIGUSR1 profiling only). (4) 2-core box: no
> builds/full suites. (5) Edit ONLY files under "Files you may touch". Never `git add -A`. If
> `.git/index.lock` exists, sleep 10s and retry. (6) Minimum code; node stdlib only.

## Purpose

Tomorrow ~07:35 MDT (market open + 5min) we score the day's perf program against today's baselines
with ONE command instead of a hand-run runbook. Baselines + metric list:
`docs/plans/runtime-verification-runbook-2026-07-09.md` (READ IT — the script automates its steps
3-7) and the BUS acceptance criteria in `docs/plans/db-pool-admission-bus-2026-07-09.md`.

## Deliverable — `scripts/diag/market-open-acceptance.mjs`

Single run (`node scripts/diag/market-open-acceptance.mjs [--out <dir>]`, default out
`scripts/reports/open-acceptance/<UTC-timestamp>/`) that captures, in order:

1. Identity: api pid (from `.pyrus-runtime/flight-recorder/api-current.json`), uptime, git SHA of
   the running bundle if recorded, supervisor pid + pid2-owned check (walk /proc as the runbook
   describes).
2. **Symbol-state write-rate gate (BUS-3B)**: two reads of pg_stat_user_tables n_tup_ins+n_tup_upd
   for signal_monitor_symbol_states 60s apart via `psql "$DATABASE_URL"` → rows/min. Print the
   verdict line: `BUS-3B gate: <n>/min (dispatch if >=300)`.
3. CPU profile: reuse `scripts/diag/cpu-profile-running-api.mjs` (spawn it; parse busy% + GC% + top
   10 rows). Retry once on ECONNREFUSED after 3s (inspector warmup — known).
4. Allocation profile: inline the CDP HeapProfiler sampling (same mechanism as the cpu profiler;
   65536 sampling interval, 20s) → top 15 self-size rows + MB/s.
5. Counters: `GET /api/diagnostics/runtime` → storedBarsCache (hit/miss/delta/invalidationFull/
   invalidationDeltaDue), storedBarsRead, dbAdmission per-lane gauges (search the tree), dbPool.
6. Firehose window: aggregate the last 30 min of `api-db-query-slow` events from today's
   `.pyrus-runtime/flight-recorder/api-events-*.jsonl` by SQL shape (count/total/max), top 12.
7. Emit `report.md` in the out dir: a table comparing every captured metric against the baseline
   table hardcoded from the runbook (2026-07-09 open: GC 32.6%, parseRow 50.7%, busy 95.8%,
   old_space 1596MB, waiters 28-65, auth max 60s), each row marked BETTER/WORSE/n-a. No thresholds
   beyond the runbook's targets; print, don't judge beyond the table.

Failure isolation: every capture step try/caught — a failed step writes "unavailable: <err>" and
the script continues (an acceptance run must never die half-way).

## Validation

1. `node --check scripts/diag/market-open-acceptance.mjs` → 0.
2. One live smoke run: `node scripts/diag/market-open-acceptance.mjs` completes; report.md exists;
   attach its summary table to your report (midday numbers are fine — it's a smoke test).

## Files you may touch

- NEW `scripts/diag/market-open-acceptance.mjs`
- (its report output dir is generated at runtime, not committed — add `scripts/reports/open-acceptance/` to .gitignore if reports/ isn't already ignored; check first)

## Commit

```
feat(diag): one-command market-open acceptance capture vs 2026-07-09 baselines (WO-OPEN-ACCEPT)

<2-4 lines>
```

Do NOT push.

## Report

`.codex-watch/wo-open-accept-report.md`: smoke-run summary table, commit SHA. Final message: 3 lines max.
