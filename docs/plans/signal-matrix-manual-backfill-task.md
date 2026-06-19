# Task Brief: Manual Signal-Matrix Backfill to June 1, 2026

Source: leader-claude fleet queue, 2026-06-18/19. Current owner: codex/PYRUS backend workstream unless reassigned by leader-claude.

## Goal

Backfill the Signal Monitor matrix from stored ticker data back to June 1, 2026. This is a one-time controlled repair, not a new worker, daemon, scheduler, or background service.

## Hard Constraints

1. No new persistent worker or scheduler. Use a manual bounded invocation only.
2. Do not restart the app, connect/disconnect the broker, or subscribe live broker streams for this job.
3. Use stored bars/aggregates already available to the API server. Do not pull live IBKR data to fill the matrix.
4. Keep the Postgres pool safe. The app has a 12-connection pool and known starvation under bulk writes; process small chunks, pace writes, and stop if `dbPool.waiting` rises above zero.
5. Preserve live-evaluation parity. Backfilled cells must be produced by the same signal evaluation/state-writing semantics as live matrix aggregate updates.
6. Keep the run idempotent. Re-running the backfill should update only missing/older/worse state and should not regress fresher live STA/Signal Monitor rows.

## Verified Source Anchors

- Live matrix aggregate evaluator/persist path: `emitSignalMonitorMatrixStreamAggregateDelta` in `artifacts/api-server/src/services/signal-monitor.ts:6995`.
- Matrix stream subscription that receives aggregate updates: `subscribeSignalMonitorMatrixStream` in `artifacts/api-server/src/services/signal-monitor.ts:7615`.
- Stored completed-bar loader to reuse: `loadSignalMonitorCompletedBars` in `artifacts/api-server/src/services/signal-monitor.ts:4962`. Existing callers include `:3665`, `:4805`, `:5557`, `:8127`, and `:8770`.
- Current-state freshness logic that must not be bypassed incorrectly: `isSignalMonitorStateCurrentForLane` at `artifacts/api-server/src/services/signal-monitor.ts:4178` and `readSignalMonitorStateFresh` at `:9875`.
- Stored aggregate runtime source helpers: `getCurrentStockMinuteAggregates` and `subscribeStockMinuteAggregates` in `artifacts/api-server/src/services/stock-aggregate-stream.ts:351` and `:748`.

## Suggested Execution Shape

1. Resolve the active Signal Monitor universe and target timeframes exactly as the server-owned producer does.
2. For each symbol/timeframe, load completed bars from June 1, 2026 through now using `loadSignalMonitorCompletedBars` with stored/historical fallback explicitly scoped to this manual repair.
3. Evaluate bars in timestamp order and persist the same matrix state deltas the live aggregate path would persist. Prefer calling/extracting the existing evaluation/persist helper over duplicating signal logic.
4. Pace work in small chunks, for example one symbol x timeframe at a time or a very small concurrency of independent reads with a single writer. Sleep between chunks and sample pool pressure.
5. Log progress as counts: symbols planned, cells attempted, cells changed, cells skipped because fresher, errors, elapsed time, and latest `dbPool.waiting`.
6. Stop safely on pool pressure, repeated transient DB errors, or any evidence that live STA rows are being overwritten by older backfill state.

## Acceptance Checks

- A dry run can report planned symbol/timeframe count and available bar coverage without writes.
- A limited run over 1-3 symbols updates expected missing matrix cells and leaves fresher live rows intact.
- During the limited run, `dbPool.waiting` stays at or near zero and event-loop/resource pressure does not climb.
- A second run over the same small scope is idempotent: changed-count drops to zero or only legitimately newer/better rows update.
- Full run emits a final summary and exits. No process remains running.

## Notes

- This brief is intentionally a task plan, not an implementation. If implementation needs a script, keep it manual and explicitly named as a repair tool.
- Coordinate with any option-chain persistence repair before the full run; both touch the same constrained database pool.
- Keep live runtime passive: normal Signal Monitor matrix routes should keep reading stored state and emitted live events only. Bar-derived evaluation is allowed here only because this is an explicit manual repair/backfill.
