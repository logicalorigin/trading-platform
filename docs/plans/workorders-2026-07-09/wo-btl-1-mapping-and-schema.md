# WO-BTL-1 — Backtest ledger separation, Phase 1: field mapping + minimal DDL delta (manual-apply)

> **HEADLESS WORKER PREAMBLE (overrides AGENTS.md session rituals):** You are a headless fix worker,
> not an interactive session. (1) Do NOT create/update any SESSION_HANDOFF_* file. (2) Do NOT read
> ~/.claude/, ~/.agents/, .claude/skills/, .agents/skills/, agents/, or AGENTS.md session sections.
> (3) NEVER restart/rebuild/reload the app, never signal the supervisor, never `git push`, and
> **NEVER apply the migration to the database** — migration SQL in this repo is manual-apply by the
> owner (precedent: commit bef57303). (4) 2-core box, LIVE trading app: run ONLY the listed
> validations. (5) Edit ONLY files under "Files you may touch"; shadow-account.ts and
> signal-options-automation.ts are READ-ONLY references for you (another lane edits them). Never
> `git add -A`. If `.git/index.lock` exists, sleep 10s and retry. (6) Minimum DDL that hosts the
> data; no speculative columns.

## Context — READ FIRST

`docs/plans/backtest-ledger-separation-2026-07-09.md` (the design + locked owner decisions).
Summary: watchlist backtests + signal-options replays stop writing sim rows into shadow_*; they
become runs in the EXISTING backtest family (`lib/db/src/schema/backtesting.ts`: backtest_runs,
backtest_run_trades, backtest_run_points, ...). This WO produces the mapping + schema delta ONLY —
no writer changes.

## Deliverable 1 — the field-mapping report (the gate for everything downstream)

Read the sim writers and enumerate EVERY column they produce today:
- Watchlist backtest: `insertWatchlistBacktestFills`, `runShadowWatchlistBacktest` and the rows
  they write to shadow_orders / shadow_fills / shadow_positions / shadow_position_marks /
  shadow_balance_snapshots / execution_events (shadow-account.ts ~:14200-15800 — grep the exact
  writers; cite line ranges you actually read).
- Signal-options replay: `resetSignalOptionsReplayRowsForRange` + the replay writers (same file)
  and any replay writes from signal-options-automation.ts (READ-ONLY reference).

For each produced field: map to an existing column in the backtest family, OR mark MISSING with the
minimal hosting proposal (column on an existing table vs the one new table
`backtest_run_executions` if — and only if — trades/fills genuinely cannot share
backtest_run_trades' shape). Events: LEAN columns only, no per-event jsonb payload blobs (the
execution_events 3.3GB lesson — design doc §Bloat minimization); if a consumer provably reads a
payload field today, name the consumer and host that field as a real column.

STOP-CLAUSE: if the existing family fundamentally cannot host the shape (not "needs columns" but
structurally wrong), STOP after the mapping report, propose the alternative in the report, commit
NOTHING, final message "BLOCKED: <reason>".

## Deliverable 2 — schema delta (only what Deliverable 1 proved missing)

- Drizzle schema changes in `lib/db/src/schema/backtesting.ts`:
  - `backtest_runs`: kind discriminator ('study' | 'watchlist_backtest' | 'signal_options_replay' —
    check how existing rows would default), window/range fields if missing, config-used reference,
    `fidelity` ('full' | 'compact') + `compactedAt` (nullable) for the aged-run compaction design.
  - Whatever Deliverable 1 proved missing for trades/fills/points/events.
- Manual-apply migration SQL `lib/db/migrations/20260709_backtest_ledger_separation.sql`:
  additive only (ADD COLUMN / CREATE TABLE / CREATE INDEX), safe on a live DB, reversible note at
  top, and NOT applied by you.
- Indexes: per-run access patterns only (run_id lookups; run listing by kind+created_at). No
  speculative indexes.

## Validation

1. `pnpm --filter @workspace/db run typecheck` (verify script name from lib/db/package.json;
   fallback: exec tsc -p tsconfig.json --noEmit) → EXIT 0.
2. `pnpm --filter @workspace/api-server run typecheck` → EXIT 0 (schema export surface unchanged
   for existing consumers).
3. The PGlite test harness derives DDL from the drizzle schema (lib/db/src/testing.ts) — run ONE
   existing db-backed suite to prove the schema still materializes:
   `pnpm --filter @workspace/api-server exec tsx --test --test-force-exit src/services/shadow-account-recompute.test.ts` → 0 fail.

## Files you may touch

- `lib/db/src/schema/backtesting.ts`
- NEW `lib/db/migrations/20260709_backtest_ledger_separation.sql`
- NEW report only (below). NO other source files.

## Commit (only after validations pass)

```
feat(db-schema): backtest ledger hosts watchlist-backtest + replay runs — mapping + additive DDL, manual-apply (WO-BTL-1)

<3-6 lines: mapping outcome (hosted vs new columns/table), fidelity/compaction fields, migration file, NOT applied>
```

Do NOT push. Do NOT apply the migration. Do NOT reload.

## Report

`.codex-watch/wo-btl-1-report.md`: the FULL field-mapping table (produced field → destination →
evidence line), events-payload consumer findings, DDL summary, validation outputs, commit SHA.
Final message: 3 lines max — or "BLOCKED: <reason>".
