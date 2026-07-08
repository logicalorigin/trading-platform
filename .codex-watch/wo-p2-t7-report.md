# WO-P2-T7 Report

Observed:
- Scoped pre-edit diff check for `artifacts/api-server/src/services/algo-cockpit-streams.ts` and this report path was empty.
- Reproduced the issue with a package-local inline `tsx` unit probe: two subscribers on one fetched cockpit payload caused two `JSON.stringify` calls for the payload change signature.

Changed:
- Added an identity-based `WeakMap` cache for cockpit payload change signatures.
- Routed subscriber delivery and initial-payload signature setup through the cache so a shared payload object is serialized once and reused across subscribers.

Verified:
- Ran a focused package-local inline unit assertion with `pnpm --filter @workspace/api-server exec tsx -`.
- Post-fix result: one fetch, both subscribers received `event-1`, and the counted payload signature serialization was `1`.

Not run:
- Browser, Playwright, e2e, project-wide typecheck, and full-suite tests, per work-order constraints.
