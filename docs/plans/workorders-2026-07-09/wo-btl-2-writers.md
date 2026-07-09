# WO-BTL-2 — Backtest ledger writers: sim runs write the backtest family behind PYRUS_BACKTEST_LEDGER

> **HEADLESS WORKER PREAMBLE (overrides AGENTS.md session rituals):** You are a headless fix worker,
> not an interactive session. (1) Do NOT create/update any SESSION_HANDOFF_* file. (2) Do NOT read
> ~/.claude/, ~/.agents/, .claude/skills/, .agents/skills/, agents/, or AGENTS.md session sections.
> (3) NEVER restart/rebuild/reload the app, never `REPLIT_MODE=workflow`, never signal any process,
> never `git push`, never apply migrations. (4) 2-core box, LIVE trading app: run ONLY the listed
> validations. (5) PRECONDITION: `git status --short` the target files; if dirty (another session's
> live WIP), wait 60s up to 15 tries then BLOCKED. Never `git add -A`. If `.git/index.lock` exists,
> sleep 10s and retry. (6) Minimum diff; the flag default keeps ALL current behavior.

## Context — READ FIRST (in this order)

1. `docs/plans/backtest-ledger-separation-2026-07-09.md` — design + locked owner decisions.
2. `.codex-watch/wo-btl-1-report.md` — the COMPLETE field mapping (produced field → destination →
   evidence line). Follow it exactly; it is the contract. Schema landed in commit `3ba21034`
   (`backtest_run_executions` + run/point columns; migration file is manual-apply and may NOT yet
   be applied to the live DB — see "Flag + DB reality" below).

## Schema prerequisite (review P2 on BTL-1 — fix FIRST in this WO)

`backtest_runs.study_id` is still `.notNull().references(...)` (schema:95), but watchlist-backtest /
signal-options-replay runs have NO parent study. Before writing any run, make `study_id` NULLABLE
(drizzle schema + an additive `ALTER COLUMN ... DROP NOT NULL` line appended to the BTL-1 migration
`lib/db/migrations/20260709_backtest_ledger_separation.sql` — manual-apply, do NOT apply). Existing
study-run inserts still populate it; only the new kinds leave it null. Add a CHECK or app-level
assert that kind='study' ⇒ study_id not null, so the study path can't silently regress.

## Mandate

Behind env `PYRUS_BACKTEST_LEDGER` (`shadow` = today's behavior, DEFAULT; `own` = new family):

1. **Watchlist backtest writers** (`runShadowWatchlistBacktest` path, shadow-account.ts
   ~:15732-16069 per the BTL-1 report): in `own` mode, create a `backtest_runs` row
   (kind `watchlist_backtest`) and write orders/fills/positions/marks/balance points/events to
   `backtest_run_executions` / `backtest_run_points` per the mapping. The shadow_* tables receive
   NOTHING from this path in `own` mode. The delete/reset-for-range flows become no-ops in `own`
   mode for shadow tables (each run is a NEW run row — history preserved); prior-run lookup/replace
   semantics for the UI keep working by reading the LATEST run per range (reader changes are BTL-3;
   in this WO only ensure the run row carries what BTL-3 needs: range_key, market dates, kind).
2. **Signal-options replay writers** (reset/write path shadow-account.ts ~:14726-14845 +
   signal-options-automation.ts replay paths per the report): same treatment, kind
   `signal_options_replay`.
3. **Shared writer forks**: where sim paths reuse live writers (placeShadowOrder-style shared
   helpers, the report's "Shared shadow order/fill/position writers used by replay"
   :4626-4750/:6077-6182/:16120-16302), fork at the CALLER (sim callers route to new-family
   writers) — do NOT thread mode flags through the live trading writers.
4. **Flag + DB reality**: in `own` mode, if the new table/columns are missing at runtime (migration
   not yet applied), fail SOFT at run start with a clear error ("backtest ledger migration not
   applied") — never mid-run, never corrupting a half-written run.
5. **PnL invariant pre-wiring**: export a test-only helper that fingerprints the shadow account fold
   inputs (qualifying order/fill ids + totals) so BTL-4's migration proof can byte-compare. Tiny.

## Tests (PGlite harness materializes the new schema automatically from drizzle)

- `shadow` mode (default): existing suites pass UNTOUCHED — zero behavior change.
- `own` mode: a small watchlist backtest run writes ONLY the backtest family (assert shadow_* row
  counts unchanged); a replay run likewise; runs accumulate (two runs same range → two run rows);
  soft-fail behavior when the table is absent (drop it in the test to simulate).
- Fold-input fingerprint helper: identical before/after a sim run in `own` mode.

## Validation

1. `pnpm --filter @workspace/api-server run typecheck` → EXIT 0.
2. `pnpm --filter @workspace/api-server exec tsx --test --test-force-exit src/services/shadow-account*.test.ts <your new test file>` → 0 fail; report counts.

## Files you may touch

- `artifacts/api-server/src/services/shadow-account.ts`
- `artifacts/api-server/src/services/signal-options-automation.ts`
- ONE new test file (+ minimal extensions to existing shadow tests if a fixture needs the flag)

## Commit

```
feat(backtest-ledger): sim writers target the backtest family behind PYRUS_BACKTEST_LEDGER (default: legacy shadow) (WO-BTL-2)

<4-6 lines: what forks where, run-row contract for BTL-3, soft-fail note, default-unchanged proof>
```

Do NOT push. Do NOT reload. Do NOT apply the migration.

## Report

`.codex-watch/wo-btl-2-report.md`: fork points (file:line), run-row contract, validation outputs,
commit SHA. Final message: 3 lines max — or "BLOCKED: <reason>".
