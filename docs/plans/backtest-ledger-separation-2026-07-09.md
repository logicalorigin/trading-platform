# Backtest Ledger Separation — design (2026-07-09)

Owner decision (Riley, 2026-07-09 ~10:30 MDT): backtesting was ORIGINALLY meant to write into the
shadow ledger; that intent is retired. Backtests AND signal-options replays get their own ledger
with durable per-run histories. The shadow ledger becomes live-only.

## Decisions (locked)

1. **Scope: BOTH** watchlist backtests and signal-options replays move off the shadow tables.
2. **Old sim rows: MIGRATE** into the new ledger as legacy runs, then purge from shadow —
   **HARD INVARIANT: the shadow account's PnL (cash / realizedPnl / fees) and every live dashboard
   read must be byte-identical before and after the purge.** (Sim rows are already excluded from
   the PnL fold by `isDefaultShadowLedgerAnalyticsOrder`, so identity is expected — it must be
   PROVEN by running the recompute + key reads before/after on the same data.)
3. **Retention: keep all runs, prune on size budget — with active bloat-minimization** (below).

## What this kills (all traced earlier today)

- The #1 head-of-line risk: backtest multi-table DELETE+INSERT transactions lock shadow_* against
  live trading writes (crosscheck of census wf_d46c26fe-e6a). Separate tables → no shared locks.
- History destruction: `delete/resetWatchlistBacktestRowsForRange` +
  `resetSignalOptionsReplayRowsForRange` rewrite each range — histories cannot exist by design.
- The sim-exclusion filter tax on every live shadow read (`isDefaultShadowLedgerAnalyticsOrder`,
  `isLiveShadowPosition`, position-key prefix checks, source filters) — removable in Phase 4.
- A prime suspect for the historical execution_events/shadow churn (sim event insert+delete cycles
  through `deleteWatchlistBacktestRowsForRange` → executionEventsTable delete, shadow-account.ts:14831).

## Architecture: EXTEND the existing backtest family (do not invent a third system)

`lib/db/src/schema/backtesting.ts` already has: backtest_studies, backtest_sweeps, backtest_runs,
backtest_run_trades, backtest_run_points (equity/curve points), backtest_run_datasets,
backtest_promotions. The study/sweep engine already uses them. Watchlist backtests + replays become
RUNS in this family:

- One `backtest_runs` row per watchlist-backtest or replay execution (kind discriminator:
  watchlist_backtest | signal_options_replay; carry range/window + config used).
- Per-run rows: trades/fills → `backtest_run_trades` IF its shape hosts the required fields
  (Phase-1 mapping decides; add columns or one new table `backtest_run_executions` ONLY where the
  existing shape genuinely cannot host — the mapping report is the gate).
- Equity/PnL curves → `backtest_run_points`.
- Events (entry/exit/diagnostic) → LEAN by design: no per-event jsonb payload blobs (the
  execution_events 3.3GB lesson). Structured columns; payload only where a consumer provably reads it.

## Bloat minimization (Riley requirement)

- **Two-tier fidelity**: recent runs FULL (all trades/points/events); aged runs COMPACTED — keep
  the run row + summary metrics + a downsampled equity curve (e.g. ≤500 points), drop row-level
  trades/events. `backtest_runs.fidelity: full|compact` + compaction timestamp.
- **Size-budget pruner**: background job (background DB lane) compacts oldest-first past a budget
  (env, default e.g. 2GB total family size); never deletes the run row or summary. Piggyback the
  existing retention-scheduler pattern.
- Lean row shapes from day one; no unbounded jsonb.

## Phases (each a codex WO; sequential)

- **BTL-1** (dispatched): field-mapping report (every column the watchlist-backtest/replay writers
  produce today vs existing family columns) + minimal DDL delta as a manual-apply migration SQL
  (bef57303 precedent) + drizzle schema update. NO writer changes yet. STOP-clause if the family
  fundamentally cannot host the shape.
- **BTL-2**: writers — watchlist backtest + replay write the new family behind
  `PYRUS_BACKTEST_LEDGER=own` (default old path until cutover); delete/reset flows become
  create-new-run.
- **BTL-3**: readers — the UI surfaces that today read sim rows from shadow (find them from the
  census slice: watchlist backtest views, replay analysis, any calendar/closed-trades rangeKey
  filters) read the new family.
- **BTL-4**: migration + purge — legacy sim rows → one legacy run per range; purge from shadow_*;
  the PnL-invariant proof gates the purge (recompute + dashboard read fingerprints before/after).
- **BTL-5**: filter cleanup — remove sim-exclusion logic from live shadow paths (each removal
  cited against BTL-4's proof that no sim rows remain).

## Interactions

- The admission-bus work (BUS-*) is orthogonal; backtest writers get the bulk lane either way.
- 5e19cc84's classification memo stays (it also guards forward-test orders) but its hot reason
  shrinks after BTL-4.
- The "defer backtests during RTH open" guard is OBSOLETE under this design (no shared locks) —
  not built.
