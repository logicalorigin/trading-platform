# Breadth Fix Report - 2026-07-07

Worker: `codex-worker`  
Leader: `claude-lead`  
Status: built and targeted tests pass; full typecheck is blocked by unrelated pre-existing errors.

## What Changed

Files touched:

- `artifacts/api-server/src/services/signal-monitor.ts`
  - Lines 10192-10203: added `eventAnchorsInserted` to `SignalMonitorStateReconciliationCounts`.
  - Lines 11217-11228: initialized `eventAnchorsInserted: 0` in per-profile reconciliation counts.
  - Lines 11230-11285: after state reconciliation, runs `buildSignalMonitorEventAnchorBackfillPlan({ apply: true })` once per distinct environment, attaching inserted count to the first result for that environment. Dry-run does not insert anchors.
  - Lines 14268-14275: `listSignalMonitorBreadthHistory` now uses snapshot rows whenever any in-window snapshots exist; event replay remains the zero-snapshot fallback.
  - Existing dirty/unlanded events-list cache hunks were present before this worker edit and were not reflowed. They appear in `git diff` around imports, `insertSignalMonitorEventAnchorBackfillCandidates`, `insertSignalEvent`, `loadSignalMonitorEventRows`, and `listSignalMonitorEvents`.
- `artifacts/api-server/src/services/signal-monitor-breadth-history.test.ts`
  - Lines 25-82: week/month breadth history uses partial snapshots instead of incomplete replay; asserts bounded leading flat-fill from earliest exact snapshot.
  - Lines 84-130: accepted range contract for `hour/day/week/month`; day remains exact in snapshot-covered case.
  - Lines 132-169: recorded breadth snapshots include aged directional rows (`fresh=false`, `bars_since_signal` outside fresh window).
  - Lines 171-212: trading-safety focused test: `state-anchor-backfill` metadata cannot make an aged signal actionable or produce a candidate.
- `artifacts/api-server/src/services/signal-monitor-reconcile-minimal-readset.test.ts`
  - Lines 29-39: count-key coverage includes `eventAnchorsInserted`.
  - Lines 1091-1172: reconciliation entry point inserts one `state-anchor-backfill` event per active missing/mismatched latched cell and is idempotent on second run.

No commits, pushes, app restarts, DB backfills, DDL/DML against non-test DBs, or process kills were performed.

## Validation

Passed:

```bash
pnpm --filter @workspace/api-server exec tsx --test --test-force-exit src/services/signal-monitor-breadth-history.test.ts src/services/signal-monitor-reconcile-minimal-readset.test.ts
```

Result: 15 tests, 15 pass, 0 fail.

Blocked:

```bash
pnpm --filter @workspace/api-server run typecheck
```

Result: exit 2. Observed errors are in `src/services/algo-cockpit-streams.test.ts` lines 28, 31, 36, 131, 138, 176, 183, and 263. No typecheck errors were reported in the touched signal-monitor files. I did not edit `algo-cockpit-streams.test.ts` because it is outside the allowed file scope and not a direct consumer of `SignalMonitorStateReconciliationCounts`.

## Trading-Safety Evidence

Observed source facts:

- Backfilled anchors are inserted by `buildSignalMonitorEventAnchorBackfillPlan` with `source: "state-anchor-backfill"`, event keys prefixed `state-anchor`, and `emittedAt` equal to the historical `signalAt` (`signal-monitor.ts:2143-2368`).
- Signal-options automation candidate scanning iterates signal monitor state rows and skips non-actionable states before reading event metadata (`signal-options-automation.ts:18888-18918`).
- Event rows are only looked up by keys derived from the state identity to add metadata (`eventId`, `source`, `filterState`); this metadata read does not independently create candidates (`signal-options-automation.ts:2435-2450`, `2460-2511`, `2588-2655`).
- Snapshot actionability is computed from state `direction`, `signalAt`, `barsSinceSignal`, status, fresh window, and market closed state (`signal-options-automation.ts:2340-2392`). `candidateFromSignalSnapshot` returns `null` when the snapshot is not actionable (`signal-options-automation.ts:5182-5188`).
- Focused test `state-anchor-backfill metadata cannot make aged signals actionable` verifies an aged `barsSinceSignal=9` state with `freshWindowBars=8` and `source="state-anchor-backfill"` yields `actionEligible=false`, `actionBlocker="signal_too_old"`, and no candidate (`signal-monitor-breadth-history.test.ts:171-212`).

Conclusion: inserted `state-anchor-backfill` events cannot independently trigger signal-options automation entries or any order path. They can only be read as metadata for an already-selected state identity, and aged historical identities fail the actionability gate before order candidate construction.

Expected side effects:

- Events-list UI: synthetic anchor rows may appear in the signal monitor events list with `source="state-anchor-backfill"` and historical `signal_at` / `emitted_at`; the inserted-event path busts the existing events-list cache when rows are inserted.
- Retention counts: `signal_monitor_events` row count increases by one per inserted anchor. Retention prunes old event rows by `signal_at` but preserves the latest trusted event per profile/symbol/timeframe regardless of age (`lib/db/src/retention.ts:215-240`), so anchors that become latest trusted rows can be retained as canonical cell identity anchors.
- Breadth snapshot retention is unchanged; snapshot rows remain subject to flat age deletion (`lib/db/src/retention.ts:119-137`).

## Recommended Backfill Command Sequence

Dry-run first:

```bash
pnpm --filter @workspace/scripts run signal-monitor:event-anchor-plan -- --environment=shadow --candidate-limit=10000 --json
```

If the dry-run counts look correct, write:

```bash
pnpm --filter @workspace/scripts run signal-monitor:event-anchor-plan -- --environment=shadow --candidate-limit=10000 --write --confirm-write
```

Optional post-write verification:

```bash
pnpm --filter @workspace/scripts run signal-monitor:event-anchor-plan -- --environment=shadow --candidate-limit=10000 --json
```

Expected post-write dry-run shape: `candidateEvents=0` for already anchored cells, aside from any newly-created live state gaps since the write.

## Truncation Amendment

Files touched:

- `artifacts/api-server/src/services/signal-monitor.ts`
  - Lines 1941-1943: updated the snapshot-builder comment to document truncation before the first real snapshot bucket.
  - Lines 1975-1987: changed `buildPoints` so `last` starts unset and buckets are skipped until a snapshot is consumed. Interior buckets after the first snapshot still carry forward the latest value.
- `artifacts/api-server/src/services/signal-monitor-breadth-history.test.ts`
  - Lines 25-30: added a local bucket-alignment helper for first-bucket assertions.
  - Lines 71-103: replaced bounded leading flat-fill assertions with truncation assertions for week/month ranges: first point equals the bucket containing the earliest seeded snapshot and no emitted point precedes it.

Validation:

```bash
pnpm --filter @workspace/api-server exec tsx --test src/services/signal-monitor-breadth-history.test.ts src/services/signal-monitor-reconcile-minimal-readset.test.ts
```

Result: 15 tests, 15 pass, 0 fail.

```bash
pnpm --filter @workspace/api-server run typecheck
```

Result: exit 0.

Scope notes:

- No commits, pushes, DB writes outside test harnesses, app restarts, or process kills were performed.
- Existing dirty hunks in `signal-monitor.ts` outside the snapshot breadth builder region were observed and left untouched.
