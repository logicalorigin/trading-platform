# WO-EQH-1 — Equity history: bucket-first bounded reads (replaces the 280k-row scan)

> **HEADLESS WORKER PREAMBLE (overrides AGENTS.md session rituals):** You are a headless fix worker,
> not an interactive session. (1) Do NOT create/update any SESSION_HANDOFF_* file. (2) Do NOT read
> ~/.claude/, ~/.agents/, .claude/skills/, .agents/skills/, agents/, or AGENTS.md session sections.
> (3) NEVER restart/rebuild/reload the app — and explicitly NEVER run
> `REPLIT_MODE=workflow pnpm ... dev:replit` (it detaches the user's preview and kills the tracked
> supervisor; the dispatcher reloads via SIGUSR2). Never signal any process, never `git push`,
> never run DB maintenance. (4) 2-core box, LIVE trading app: run ONLY the listed validations. You
> MAY run read-only `EXPLAIN (ANALYZE, BUFFERS)` probes via psql "$DATABASE_URL". (5) Edit ONLY
> files under "Files you may touch"; PRECONDITION: `git status --short` them first — if dirty, wait
> 60s up to 10 tries then BLOCKED. Never `git add -A`. If `.git/index.lock` exists, sleep 10s and
> retry. (6) Minimum diff; preserve semantics over elegance everywhere they conflict.

## Evidence (measured against the LIVE DB by the codex investigation session, 2026-07-09 ~16:25Z)

- Hot path: `getShadowAccountEquityHistory` → broad `select * from shadow_balance_snapshots` by
  account/range ordered by as_of (`shadow-account.ts:8469` — verify by grep), then TypeScript
  source-selection/live-ledger filtering/compaction/bucketing over the materialized rows.
- 1Y raw scan: **~280.9k rows, ~3.1s in Postgres** before Node materialization (then RSS/event-loop
  cost on top). 1D scan: ~13.8k rows/8.8ms.
- Naive SQL window-function bucketing is WORSE (4.8-5.8s — still scans+sorts everything).
- **Bucket-first lateral using the EXISTING `(account_id, as_of)` index**: 1D per-1m ≈ 18ms/787
  rows; 1Y per-2h ≈ 127ms/298 rows; 1Y full candidates + daily anchors + dedupe ≈ **298ms/362
  rows**. No new index needed (indexes today: account_id, as_of, (account_id,as_of); none on
  source — do not add one).

## Mandate (their plan, adopted with refinements)

### 1. Point-budget + bucket policy helper
Pure function: range span → {bucketMs, candidatesPerBucket}. Target ≈ **1200 visual points max**
(env `SHADOW_EQUITY_HISTORY_POINT_BUDGET`), 1D stays minute-dense; 1Y/ALL derive bucket size from
span/budget. Candidate count explicit (default 3 — enough that live-ledger filtering still has
valid rows after discarding non-qualifying sources; NOT LIMIT 1, their prototype's shortcut).
Unit-tested without DB.

### 2. Bucket-first reader
Replace the broad range scan in the BASE (uncached) equity-history path with:
`generate_series` buckets `cross join lateral (select <needed columns> from shadow_balance_snapshots
where account_id = $1 and as_of >= bucket_start and as_of < bucket_end order by as_of desc limit
$candidates)` **PLUS daily/event anchors** (first-per-day rows so deposits/fills/ledger jumps are
never lost — mirror the codex prototype's daily-first + dedupe + order-by-asOf shape). Select full
needed columns INSIDE the lateral (no second fetch by id). Use the repo's existing
`db.execute(sql\`...\`)` raw-SQL pattern (PGlite in tests supports generate_series + lateral).

### 3. Semantics preserved EXACTLY
The bounded candidate set feeds the UNCHANGED existing pipeline: `selectShadowEquityHistoryRows`,
`filterShadowEquityHistoryRowsToLiveLedger`, compaction, bucketing. NO source exclusions (not
`automation_mark`, not `mark`, not `automation`) — the sampling bounds row count; the existing
filters decide correctness. Regression tests with mixed-source fixtures (mark, automation_mark,
automation, signal_options_replay, watchlist backtest) must show: same output as the old broad-scan
path over the same fixture data (write the comparison test by keeping a test-only copy of the old
read or fixture-level expected outputs — your choice, justify it).

### 4. Terminal-totals side-effect audit (their review finding #5)
`computeShadowEquityHistoryTerminalTotals` can trigger position-mark refresh WRITES during chart
READS. Document the path (file:line); if chart reads synchronously kick snapshot writes, make that
non-blocking (fire-and-forget or skip when a fresh mark exists) WITHOUT changing what the chart
returns; if it is already async/guarded, cite the evidence and change nothing.

### 5. Explicitly OUT of scope (do not touch)
Account-page fanout/single-flight (their Task 6 — post-measurement); read-model table (Task 7 —
post-measurement); write-side snapshot coalescing (separate WO); any staleStrategy changes
(their review finding #6 — note what you observe at shadow-account.ts:3334 in the report, change
nothing).

## Validation

1. `pnpm --filter @workspace/api-server run typecheck` → EXIT 0.
2. `pnpm --filter @workspace/api-server exec tsx --test --test-force-exit src/services/shadow-account*.test.ts <your new/extended test files>` → 0 fail; report counts.
3. Optional but valuable: one `EXPLAIN (ANALYZE, BUFFERS)` of your final SQL against the live DB
   (read-only) — report rows + timing vs the 280.9k/3.1s baseline.

## Files you may touch

- `artifacts/api-server/src/services/shadow-account.ts`
- test files: `src/services/shadow-account*.test.ts` (existing or one new)

## Commit

```
perf(shadow-account): bucket-first bounded equity-history reads — 280k-row scans become ~360-row lateral samples (WO-EQH-1)

<4-6 lines: measured before/after, point budget + candidates-per-bucket, anchors, semantics-preservation test evidence, terminal-totals finding>
```

Do NOT push. Do NOT reload.

## Report

`.codex-watch/wo-eqh-1-report.md`: the reader SQL shape, semantics-comparison method, terminal-
totals finding (file:line + what you did), staleStrategy:3334 observation, EXPLAIN numbers,
validation outputs, commit SHA. Final message: 3 lines max.
