# DB Maintenance Phase 2 Task 7 Evidence - 2026-06-25

## Scope

- Roadmap: `docs/plans/db-maintenance-roadmap-2026-06-25.md`
- Task: Phase 2 Task 7, add snapshot and diagnostic retention.
- Resumed from dropped Codex session `019f0123-d58e-7be3-9c04-a1f835e5960c` inside Claude session `3e74af56-6bcb-4e0a-a018-4730f154180a`.
- DB target: Replit internal Postgres host `helium`, database `heliumdb`.
- Forbidden path status: no `drizzle-kit push` used.
- Destructive DB operations this pass: **none** (see Decision).

## Decision

- Retention windows (also the standing defaults): `balance_snapshots` 180d, `shadow_position_marks` (closed positions) 180d, `signal_monitor_breadth_snapshots` 90d.
- User chose conservative, forward-looking windows. At these windows **0 rows are currently eligible** in every table (the DB's oldest rows are newer than the cutoffs), so retention was implemented and dry-run verified but **no live deletes were executed**.
- `shadow_balance_snapshots`: **deferred with documented design** (source-aware replay/backtest coupling — see Deferral).
- `diagnostic_snapshots`: already self-prunes to 24h via the diagnostics collector (`artifacts/api-server/src/services/diagnostics.ts:4345-4366`) and is in the `pruneDiagnosticStorage` allow-list; no new work needed.

## Source Maps

Cutoff columns confirmed from schema:

- `diagnostic_snapshots.observed_at` (`lib/db/src/schema/diagnostics.ts:23`)
- `signal_monitor_breadth_snapshots.captured_at` (`lib/db/src/schema/signal-monitor.ts:146`)
- `balance_snapshots.as_of` (`lib/db/src/schema/trading.ts:156`)
- `shadow_balance_snapshots.as_of` (`lib/db/src/schema/trading.ts:373`)
- `shadow_position_marks.as_of` (`lib/db/src/schema/trading.ts:329`)

Reader requirements preserved by the new retention:

- `signal_monitor_breadth_snapshots`: forward cache for breadth sparklines. `listSignalMonitorBreadthHistory` (`signal-monitor.ts:~11989`) queries a bounded `captured_at` window and falls back to event-log reconstruction when snapshots don't cover it. No reader needs a single latest row, so a flat age delete is safe.
- `balance_snapshots`: newest row per account is the live fallback when the IBKR bridge is down (`getPersistedBackedAccounts`, `account.ts:1148-1183`) and backs Flex coverage health (`getFlexHealth`, `account.ts:7932-7948`). Equity history (`getAccountEquityHistoryUncached`, `account.ts:4563-4636`) reads older rows. Retention keeps `retentionDays` of history and ALWAYS preserves the newest row per account.
- `shadow_position_marks`: peak/high-water reads compute `max(mark)` since `openedAt` for OPEN positions (`readShadowPositionPeakMarkPrice`, `shadow-account.ts:4596-4634`); baseline/automation reads use the latest mark (`readLatestShadowPositionBaselineMarks` `shadow-account.ts:6728`; `signal-options-automation.ts:1810,6104`). Retention only touches marks of positions **closed for at least `retentionDays`**, never open positions, and always preserves the newest mark per position.

## Code Change

- `lib/db/src/retention.ts` (new) — `pruneSignalMonitorBreadthSnapshots`, `pruneBalanceSnapshots`, `pruneClosedShadowPositionMarks`. Dry-run by default; bounded-batch deletes (`DEFAULT_RETENTION_BATCH_SIZE = 5000`); `now` injectable for deterministic tests; runs against the shared `db` proxy so the PGlite harness exercises the real SQL. Exported via `lib/db/src/index.ts`.
- `lib/db/src/retention.test.ts` (new) — PGlite tests (see Tests).
- `scripts/src/db-snapshot-retention.ts` (new) — CLI mirroring `db-storage.ts`: `audit` (read-only counts + candidates) and `retention` (dry-run unless `--execute`), env-configurable windows, `vacuum (analyze)` + drained-set re-check after execute.
- `package.json` / `scripts/package.json` — `db:snapshot-retention:audit` and `db:snapshot-retention` scripts.

Env vars (defaults): `BALANCE_SNAPSHOT_RETENTION_DAYS=180`, `SHADOW_POSITION_MARK_RETENTION_DAYS=180`, `SIGNAL_BREADTH_SNAPSHOT_RETENTION_DAYS=90`, `SNAPSHOT_RETENTION_BATCH_SIZE=5000`.

## Tests

`pnpm --filter @workspace/db exec tsx --test --test-force-exit src/retention.test.ts` — 4/4 pass:

- `balance_snapshots`: prunes old non-latest rows, always keeps newest per account (including an account whose newest row is older than the cutoff).
- `shadow_position_marks`: keeps full history for an OPEN position, prunes a long-closed position to its latest mark, leaves a recently-closed position untouched.
- `signal_monitor_breadth_snapshots`: flat age delete keeps recent rows.
- batched delete converges across multiple iterations (batchSize forced small).

## Dry-Run / Audit Evidence

`pnpm db:snapshot-retention:audit` (read-only, exit 0):

| Table | Column | Window | Rows | Size | Candidates | Oldest | Newest |
|---|---|---:|---:|---:|---:|---|---|
| `signal_monitor_breadth_snapshots` | captured_at | 90d | 19,573 | 3.7 MB | 0 | 2026-06-14 | 2026-06-26 |
| `balance_snapshots` | as_of | 180d | 41,320 | 9.9 MB | 0 | 2026-04-23 | 2026-06-25 |
| `shadow_position_marks` | as_of | 180d | 567,947 | 145 MB | 0 | 2026-04-01 | 2026-06-25 |

`shadow_position_marks` breakdown (read-only) explaining the 0 candidates at 180d:

- By position state: closed = 560,786 marks / 767 positions; open = 7,190 marks / 1 position (TLT).
- Closed marks by time since close: `<7d` 78 (2 pos), `7-30d` 530,726 (105 pos), `30-60d` 19,364 (354 pos), `60-90d` 10,618 (306 pos), `>90d` 0.
- Mark sources: `quote` 515,355, `automation` 25,839, `bar_fallback` 15,401, `option_quote` 10,946, `polygon_option_quote` 463, `price_correction` 2.
- The heavy closed positions are real shadow EQUITY trades (COHR, DELL, AVGO, OKLO, …) marked ~28,000x each via high-frequency live quotes (~1/28s) while held 2026-06-02..06-11, now closed. Genuine but very granular history; no live reader needs closed-trade intra-life marks.
- Reclaim is therefore window-sensitive: 180d→0, 30d→~30k rows, 7d→~560k rows / ~140 MB. User selected **180d (forward-looking guard, no reclaim now)**.

## `shadow_balance_snapshots` (implemented — was initially deferred)

Implemented as `pruneShadowBalanceSnapshots` (source-aware). The original concern — flat age deletes corrupting source-scoped cleanup — is avoided by only pruning live wall-clock sources and excluding all simulation sources entirely. Background on the coupling that drove the design:

- `backfillSignalOptionsReplayEquitySnapshotsFromRun` (`shadow-account.ts:~7706`) deletes `source = SIGNAL_OPTIONS_REPLAY_SOURCE` within an `as_of` range.
- `resetWatchlistBacktestRowsForRange` (`shadow-account.ts:~13855`) deletes watchlist-backtest sources by range.
- `resetSignalOptionsReplayRowsForRange` (`shadow-account.ts:~14101`) deletes replay sources by range.

Implemented design (`lib/db/src/retention.ts`):

- Prunes ONLY live wall-clock sources; excludes simulation sources `signal_options_replay`, `signal_options_replay_mark`, `watchlist_backtest`, `watchlist_backtest_mark`, `signal_options_backfill` (and `signal_options_replay:%` / `watchlist_backtest:%` prefixes) — their `as_of` is simulated time, and they are owned by the range-scoped cleanup paths above. Retention is therefore disjoint from those paths and cannot corrupt a historical-dated or in-flight simulation run.
- Preserves the newest row per `(account_id, source)` (what `getShadowAccountEquityHistory` reconstructs per source).
- Window `SHADOW_BALANCE_SNAPSHOT_RETENTION_DAYS` (default 180). Prod is 66,926 rows / 21 MB, dominated by live `mark` (39,300) + `automation_mark` (25,796); 0 eligible at 180d today (oldest 2026-04-01).
- Tested in `lib/db/src/retention.test.ts`: live rows pruned per source, simulation rows (`signal_options_replay`, `watchlist_backtest`) preserved even when old.

## Scheduling (wired)

`startSnapshotRetentionScheduler` (`artifacts/api-server/src/services/snapshot-retention-scheduler.ts`) is registered in the api-server `backgroundWorkers` list (`index.ts`) and calls `runAllSnapshotRetention({ dryRun: false })` on a cadence: first run ~5 min after startup, then every `SNAPSHOT_RETENTION_INTERVAL_MS` (default 6h, matching the market-data worker). Overlap-guarded; failures log and never throw. Disable with `SNAPSHOT_RETENTION_ENABLED=false`. Takes effect on the next API rebuild/restart. The manual CLI (`pnpm db:snapshot-retention[:audit]`) remains for on-demand runs/preview.

## Validation

- `pnpm run typecheck:libs` — passed (covers `lib/db/src/retention.ts`).
- `pnpm --filter @workspace/db exec tsx --test --test-force-exit src/retention.test.ts` — 4/4 passed.
- `pnpm db:snapshot-retention:audit` — exit 0, read-only.
- NOTE: `pnpm --filter @workspace/scripts run typecheck` currently fails, but only in `artifacts/api-server/src/services/account.ts` and `ibkr-live-demand-coordinator.ts` — pre-existing uncommitted changes from another dropped session (`OptionQuoteWithSource` source `"massive"` vs `"ibkr"`), unrelated to Task 7. The new CLI typechecks clean and runs via `tsx`.

## Status

- Task 7 retention implemented for `signal_monitor_breadth_snapshots`, `balance_snapshots`, `shadow_balance_snapshots` (source-aware), and `shadow_position_marks`; `diagnostic_snapshots` already covered by the collector.
- Scheduling wired via `startSnapshotRetentionScheduler` (api-server, 6h); takes effect on next API rebuild/restart.
- 0 rows deleted to date (windows exceed current data age; forward-looking guard). Before/after state identical by construction.
- Tests: `lib/db/src/retention.test.ts` 7/7 pass; `typecheck:libs`, api-server, and scripts typecheck all pass.
- Checkpoint C: snapshot/diagnostic retention done. Remaining: ledger retention (Task 8: `execution_events`, `signal_monitor_events`).
