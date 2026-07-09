# WO-R1 — Commit lib/db units: bar_cache retention (5m fix) + pool topology

Codex worker, /home/runner/workspace. Apply /ponytail discipline (level: full): laziest solution
that works, no scope creep. You HAVE commit authority for the exact files listed — nothing else.
NEVER `git add -A`, `git add .`, or `git commit -a`. Stage by explicit path only.

CONTEXT: Session 8939ce3f proved SPY 5m durable reads hit Postgres statement_timeout 57014 because
the ~8GB bar_cache forces cold-disk reads. The working tree contains the written fix
(`pruneBarCache` in lib/db/src/retention.ts) plus DB pool-topology hardening. Your job: verify and
commit these as TWO isolated commits.

## Commit A — bar_cache retention prune
Files: `lib/db/src/retention.ts`, `lib/db/src/retention.test.ts`
- Read the full diff (`git diff -- lib/db/src/retention.ts lib/db/src/retention.test.ts`).
- Sanity-check: pruneBarCache uses a BOUNDED candidate probe (LIMIT 50_000, no unbounded count),
  batched deletes capped by maxRowsPerRun, wired into runAllSnapshotRetention, config + env
  overrides (BAR_CACHE_INTRADAY/DAILY_RETENTION_DAYS, BAR_CACHE_RETENTION_MAX_ROWS_PER_RUN).
- Verify: `pnpm --filter @workspace/db run typecheck` (or the lib/db package's typecheck script —
  confirm the package name from lib/db/package.json) AND run the retention tests
  (`pnpm --filter <db-pkg> exec vitest run src/retention.test.ts`). Both must pass.
- Commit message: `perf(db-retention): timeframe-aware bar_cache prune (60d intraday/400d daily), bounded probe + batched deletes (WO-R1)`

## Commit B — DB pool topology + advisory-lock hardening
Files: `lib/db/src/index.ts`, `lib/db/src/advisory-lock.ts`
- Read the diff. Expected: PYRUS_DB_PROFILE pool reservation, idle_in_transaction_session_timeout,
  application_name tagging, additive tradingPool/dbTrading export (unused so far).
- Do NOT include lib/db/src/schema/* (owned by WO-R4).
- Verify: db package typecheck passes; `rg -n 'dbTrading' --type ts` to confirm the export is
  additive (no existing caller broken).
- Commit message: `perf(db-pool): PYRUS_DB_PROFILE pool reservation, idle-in-tx timeout, application_name tagging; reserved trading lane (additive) (WO-R1)`

## Guardrails
- Touch ONLY the four files above. If any hunk in them looks like it belongs to a different
  workstream (SnapTrade, backtest, overnight, flow-universe), STOP and report instead of committing.
- If a verify step fails: do not commit that unit; report the failure verbatim.

Report → `.codex-watch/wo-r1-report.md`: per-commit SHA, verify command outputs (tail), any hunks
you declined to commit and why.
