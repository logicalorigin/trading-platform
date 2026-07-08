# WO-P2-T10 Report

Observed:
- `reconcileActivePositionsWithShadowLedger` could read `shadow_positions` once through `recoverActivePositionsFromShadowLedger` and again through `buildSignalOptionsShadowIndex` when called with `deploymentId` and no provided `shadowIndex`.
- The fix builds/reuses one local `shadowIndex` before ledger recovery when `deploymentId` requires recovery, passes its `shadowPositions` into recovery, and reuses the same index for final reconciliation.
- Inline targeted unit check passed: spied `db.select().from(shadowPositionsTable)` and asserted one read for a reconcile call with `deploymentId`; reconcile output remained unchanged for the exercised position.

Command run:
- `printf ... | pnpm --filter @workspace/api-server exec tsx`

Inferred:
- Existing callers that already provide `shadowIndex` keep the same reuse behavior.
- Callers without `deploymentId` keep the lazy index build behavior.

Unknown:
- I did not run project-wide typecheck, browser tests, Playwright, e2e, or full test suites per work-order constraints.
