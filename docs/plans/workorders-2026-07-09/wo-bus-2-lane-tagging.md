# WO-BUS-2 — Tag DB-lane entry points (census-driven; requires WO-BUS-1 landed)

> **HEADLESS WORKER PREAMBLE (overrides AGENTS.md session rituals):** You are a headless fix worker,
> not an interactive session. (1) Do NOT create/update any SESSION_HANDOFF_* file. (2) Do NOT read
> ~/.claude/, ~/.agents/, .claude/skills/, .agents/skills/, agents/, or AGENTS.md session sections.
> (3) NEVER restart/rebuild/reload the app, never signal the supervisor, never `git push`. (4) 2-core
> box, LIVE trading app: run ONLY the listed validations. (5) Edit ONLY files under "Files you may
> touch"; check `git status --short` per file first — if dirty from another lane, wait 60s up to 10
> tries then report BLOCKED for that file (tag the rest). Never `git add -A`. (6) Minimum diff: this
> WO is ~10 small wrappers, not a refactor.

## Context

WO-BUS-1 (must be landed first — verify `runInDbLane` exists in @workspace/db exports) added the
admission scheduler: per-lane caps (bulk 6, background 2, interactive uncapped, 5s aging) in front
of the shared pool, behavior-neutral until entry points are tagged. This WO does the tagging.
Design doc: `docs/plans/db-pool-admission-bus-2026-07-09.md`. ALS caveat: work executed from
queues/timers runs OUTSIDE the enqueuer's context — tag the DRAIN/tick function, not the enqueue.

## Tagging table (FINAL — census wf_d46c26fe-e6a, 122 functional DB ops across 8 slices + firehose crosscheck)

| Entry point (tag here) | Lane | Census evidence |
|---|---|---|
| signal-monitor universe evaluation cycle — `runWithSignalMonitorStoredBarsPrefetch` callers armed by the 60s refresh interval (signal-monitor.ts:5461) and 60s producer interval (:11802); prefetch loads at market-data-store.ts:803/:883 | bulk | firehose #1 (18,156s pool-incl); ~84-340 bulk reads/min at open, up to 48 sym × 1000-2000 rows cold. NOTE census nuance: feeds signal evaluation (trading-adjacent) — the 5s aging guard is its starvation protection; do NOT tag deeper than the tick |
| bars persist flush (`flushPendingPersistBars` 5s scheduler, signal-monitor-local-bar-cache.ts:821/:1204) + `barsBackgroundPersistWorker` drain (platform.ts:9073) | bulk | firehose #2/#3-writes (16,544s; ≤5,000-row statements, max 73.5s) — crosscheck: "de-facto bulk racing #1 readers"; background cap 2 would back it up, bulk cap fits |
| signal-monitor gap-fetch drain (`drainSignalMonitorCompletedBarsGapFetches`) | bulk | bounded durable reads, bursty |
| broker sync schedulers (snaptrade/schwab/robinhood `*-scheduler` ticks) incl. `storeActivities` ingest (snaptrade-account-history.ts:663, ≤25k-row INSERT) | bulk | largest single connection-hold write in broker slice |
| shadow backtest/replay bulk transactions (shadow-account.ts:14472/14607/14708/14829/15714) | bulk **+ see HOL note** | crosscheck HOL risk #1: multi-table DELETE+INSERT txs; nothing stops a user-initiated backtest firing at open and lock-stalling live shadow trading. LANE alone does not fix lock HOL — see Riley decision item in the design doc |
| retention schedulers (bar_cache prune, snapshot-retention, automation_diagnostics 7-day prune) | background | maintenance deletes |
| storage-health probe (storage-health.ts:102) | background | held tx across 5 round trips, 4×/min, pure telemetry; census #1 shed candidate. ALSO reduce cadence to 1/5min (env; note in report if a consumer depends on 15s freshness) |
| audit-event writes (audit-events.ts:110) + diagnostics persisters (diagnostic_snapshots etc.) | background | fire-and-forget telemetry |
| HTTP middleware default | interactive (implicit — do NOT tag) | fail-safe default |
| SSE stream producers (account-page snapshot, algo cockpit) | interactive (implicit) | user-visible freshness |
| automation execution path (placeShadowOrder etc.) | (none — hard tradingPool lane) | |
| option-chain/expiration per-request fan-outs, sparkline seed, getBars chart path | interactive (implicit) | already fronted by caches; per-request |

## Mechanics

- Wrap each tick/drain function body: `runInDbLane("bulk", () => <existing body>)` — the smallest
  possible diff per site; do not restructure the functions.
- For interval-armed schedulers, tag inside the interval callback (the callback IS the entry).
- Add one focused test per NEW pattern (not per site): a scheduler-tick wrapper propagates the lane
  to a nested async db call (use the scheduler-core test seam from WO-BUS-1).
- Wire the admission gauges into the api-server runtime diagnostics if BUS-1 exported but did not
  wire them (`getRuntimeDiagnostics()` in services/platform.ts — add `dbAdmission` beside the
  existing dbPool block) so the flight recorder records per-lane queue depth.

## Validation

1. `pnpm --filter @workspace/db exec tsx --test --test-force-exit src/admission.test.ts` → 0 fail.
2. `pnpm --filter @workspace/api-server run typecheck` → EXIT 0.
3. Targeted suites for every file you touched (tsx --test, list them) → 0 fail.

## Files you may touch

- The entry-point files named in the final tagging table (tick/drain functions only)
- `artifacts/api-server/src/services/platform.ts` (diagnostics wiring only)
- ONE new/extended test file

## Commit

```
perf(db): tag bulk/background DB-lane entry points; admission bus goes live (WO-BUS-2)

<3-6 lines: sites tagged per lane, gauges wired, behavior note (interactive untouched/default)>
```

Do NOT push. Do NOT reload (the dispatcher reloads and measures).

## Report

`.codex-watch/wo-bus-2-report.md`: per-site diff summary (site → lane → file:line), any BLOCKED
files, validation outputs, commit SHA. Final message: 3 lines max.
