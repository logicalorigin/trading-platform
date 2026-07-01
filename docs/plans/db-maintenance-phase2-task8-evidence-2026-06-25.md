# DB Maintenance Phase 2 Task 8 Evidence - 2026-06-25

## Scope

- Roadmap: `docs/plans/db-maintenance-roadmap-2026-06-25.md` (Task 8, Checkpoint C).
- Task: design ledger-safe retention for the load-bearing event tables `execution_events` and `signal_monitor_events`.
- Resumed from dropped Codex session `019f0123-d58e-7be3-9c04-a1f835e5960c` inside Claude session `3e74af56-6bcb-4e0a-a018-4730f154180a`.
- **Decision: DEFER both tables** (retention not safe today). No code or DB changes. This satisfies the roadmap's "if retention is not safe yet, document a defer decision with evidence" path and the standing rule "do not flat-prune `execution_events` or `signal_monitor_events`."

## `execution_events` — DEFER

Cutoff column would be `occurred_at` (`lib/db/src/schema/automation.ts:84`). Two load-bearing mechanisms make age-pruning unsafe:

1. **Order idempotency.** Before placing an order, `findExistingEventByClientOrderId` reads `execution_events WHERE deployment_id = ? ORDER BY occurred_at DESC` and a signal is only re-placed if no terminal event (`overnight_spot_{shadow,live,order_failed}`) matches the `clientOrderId` (`overnight-spot-execution.ts:659,930-1001`; union-merged with `automation_diagnostics` in `automation.ts:1201-1211`). Deleting a terminal order event → **duplicate order placed on the next signal replay.**
2. **Position-state reconstruction.** `deriveActivePositions` (`signal-options-automation.ts:5809-5890`) replays `signal_options_*` ENTRY/EXIT/MARK/SKIPPED events in chronological order to rebuild open positions and their peak/stop prices, fed from `listDeploymentEvents` (`:2034-2045,2665-2673`). Deleting any ENTRY/EXIT/MARK event → **corrupted reconstructed portfolio state.**

Must never age-prune: all terminal order events and all `signal_options_*` lifecycle events for any deployment that is not provably retired. **There is no `retired_at`/lifecycle marker on `algo_deployments`**, so code cannot distinguish active from retired deployments, and a disabled deployment can be re-enabled.

Prerequisites to make it safe later:
- Add a deployment retirement marker (e.g., `algo_deployments.retired_at`) set when a deployment is disabled with no recent activity.
- Source/deployment-aware retention: preserve 100% of events for non-retired deployments; for retired deployments prune only terminal `overnight_spot_*` events older than the window; never prune ENTRY/EXIT (position-lifecycle definition).
- Tests: active-deployment events never pruned; idempotency (`clientOrderId` dedup) still holds after retention; reconstruction unaffected.
- Conservative window once rules exist: `overnight_spot_*` 180d for retired deployments; `signal_options_*` only after the position is fully closed ≥180d.

(Telemetry-only readers that are NOT load-bearing: `account.ts:5116` UI history; `diagnostics.ts:2086` recent-window audit.)

## `signal_monitor_events` — DEFER

Cutoff column would be `signal_at`. Load-bearing in four ways:

1. **Symbol-state reconstruction.** `reconcileSignalMonitorSymbolStatesFromCanonicalEvents` (`signal-monitor.ts:9177-9205`) rebuilds `signal_monitor_symbol_states` from the **latest TRUSTED event per `(profileId, symbol, timeframe)`** via `trustedSignalMonitorCanonicalEventsSql` (`:8769-8817`). The latest trusted event must survive **regardless of age** — pruning it makes reconciliation adopt an untrusted newer event or lose the symbol's state (regression covered by `signal-monitor-reconcile-minimal-readset.test.ts`).
2. **Breadth-seed reconstruction.** `listSignalMonitorBreadthHistory` (`:11960-12066`) falls back to replaying events when breadth snapshots don't cover the window; the seed query (`:12023-12031`) reads `DISTINCT ON (symbol,timeframe)` events with `signal_at < window.from` to establish standing direction before the window. **Seeds can be arbitrarily old** — and the Task 7 breadth-snapshot retention is only 90d, so reconstruction (and thus old seed events) is needed for any query older than 90d. There is no age cutoff that is safe.
3. **Point-in-time queries.** `getSignalDirectionsForSymbolAsOf` (`:11800-11848`) reads the latest event at-or-before an arbitrary `asOf`; pruning the matching row returns `null` (wrong direction) silently.
4. **Idempotency.** Unique `event_key` (`schema/signal-monitor.ts:129`) + `onConflictDoNothing` dedupes canonical signals.

Prerequisites to make it safe later (any one path):
- Extend breadth-snapshot retention well beyond 90d so reconstruction never needs old seed events, OR
- Add a materialized "latest trusted event per `(profileId, symbol, timeframe)`" anchor so retention can keep the anchor and prune the rest, AND
- Business sign-off on whether untrusted events (`sourceIntegrity.trusted = false`, unused by reconciliation) carry audit/regulatory value.
- Only then: source-aware retention preserving all trusted events + the latest-per-key anchors + everything within the breadth window.

## Status

- Task 8 mapping complete; retention **deferred for both tables with the evidence above**. No flat `WHERE occurred_at < cutoff` or `WHERE signal_at < cutoff` was introduced.
- Checkpoint C is now satisfiable: market-data jobs (Task 6) + snapshot/diagnostic retention (Task 7) implemented; ledger retention explicitly deferred with source evidence (this doc); before/after audit evidence captured.
- Recommended next roadmap step: Phase 3 (dead-table retirement) or build the `execution_events` deployment-retirement marker if event-table growth becomes a pressure.
