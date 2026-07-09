# WO-FIX-12 Report

## Status

DONE

## Finding Verification

Observed: `artifacts/api-server/src/services/overnight-spot-execution.ts` was clean before edits (`git diff --name-only -- artifacts/api-server/src/services/overnight-spot-execution.ts` produced no output).

Observed: the overnight spot execution path is called by:

- `artifacts/api-server/src/services/overnight-spot-worker.ts`, which starts on API startup via `startOvernightSpotWorker` in `artifacts/api-server/src/index.ts`.
- `artifacts/api-server/src/routes/automation.ts`, via `POST /algo/deployments/:deploymentId/overnight-spot/scan`.

Observed: before this fix, `handleReadyPlan` wrote shadow execution rows before `placeShadowOrder`, but the live branch called `placeLiveOrder(input.plan.order)` before inserting the live execution event. A crash after broker placement and before the later `insertEvent` could leave a real broker order with no local overnight spot ledger row.

Observed: there is no overnight spot broker-order reconciliation sweep. Startup starts the worker, and the worker calls `runOvernightSpotSignalScan`; the scan dedupes only against local `execution_events` and `automation_diagnostics` rows via `findExistingEventByClientOrderId`. I found no order-history sweep that would query the broker and reconstruct an orphaned overnight spot order.

Observed: `execution_events` already fits the durable intent use case without migration. It is the existing load-bearing overnight spot ledger table for `overnight_spot_{shadow,live}_*` and `overnight_spot_order_failed`. `order_requests`/`broker_orders` were not used here and require broker account/instrument FK material this flow does not resolve.

## Fix

Changed `artifacts/api-server/src/services/overnight-spot-execution.ts` to:

- Insert `overnight_spot_live_order_intent` into `execution_events` before `placeLiveOrder`.
- Include `sourceIntentEventId` on subsequent live success/failure events.
- Update the intent payload after success/failure with `intent.status = filled|failed`.
- Treat existing live intent rows as idempotency blockers, so retries do not submit a second broker order.
- When a later scan/startup sweep sees a pending live intent with no newer terminal row, update the intent to `reconciliation_required` and skip broker placement.

No schema migration was added.

## Tests

Command:

```text
node --import tsx --test src/services/overnight-spot-execution.test.ts
```

Output:

```text
✔ overnight spot skips recording duplicate recent blocked plans (1.189047ms)
✔ overnight spot suppresses an unchanged blocked plan regardless of age (no time window) (0.233693ms)
✔ overnight spot does not dedupe when blocker codes change (0.101306ms)
✔ scan skips placing an order when a ledger terminal event exists (idempotency across boundary) (1.904646ms)
✔ live scan writes a durable intent before broker placement and marks it filled (1.966728ms)
✔ scan flags pending live intents for reconciliation and does not double-submit (2.824001ms)
✔ selectExistingEventByClientOrderId returns the newest (terminal) row across both tables (0.430628ms)
✔ selectExistingEventByClientOrderId surfaces a diagnostics blocked row for blocked-dedup (0.844215ms)
✔ selectExistingEventByClientOrderId merges by occurred_at desc and matches payload (0.554581ms)
✔ selectExistingEventByClientOrderId skips a shadow event without a shadow order (1.307394ms)
✔ scan routes shadow execution events to the ledger, not diagnostics (0.645123ms)
✔ scan routes tracked telemetry to diagnostics and places no order (1.305612ms)
✔ computeAutomationDiagnosticsPrune throttles within the hour and cuts at 7 days (0.217767ms)
✔ pruneAutomationDiagnostics deletes when due, throttles repeats, advances the window (0.173479ms)
ℹ tests 14
ℹ suites 0
ℹ pass 14
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 3010.758718
```

Command:

```text
pnpm --filter @workspace/api-server run typecheck
```

Output:

```text
> @workspace/api-server@0.0.0 typecheck /home/runner/workspace/artifacts/api-server
> node ../../scripts/run-validation-command.mjs --label typecheck -- tsc -p tsconfig.json --noEmit
```
