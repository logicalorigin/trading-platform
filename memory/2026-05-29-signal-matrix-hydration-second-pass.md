# Signal Matrix Hydration Second Pass

Date: 2026-05-29

## Symptom

After removing legacy 5m fallbacks, the browser showed signal dots and the header signal lane as pending/unhydrated. Initial browser diagnostics showed `stateCount: 0`, every `.ra-signal-dot` pending, and matrix requests either not starting or staying pending behind other startup traffic.

## Root Cause

Multiple regressions combined:

- A render-order bug read `signalHydrationBootstrapActive` and related bootstrap values in the diagnostics effect before the values were declared. This could break the platform render and prevent matrix hydration from starting.
- Frontend and backend matrix caps were raised in source, but the backend matrix cap still honored the profile `maxSymbols`. The live profile was low, so an 18-symbol startup batch was still truncated to 6.
- Matrix concurrency was too conservative for the available historical-bars lane. A cold 18-symbol, 3-timeframe matrix request took about 56s at concurrency 2.
- Header lane symbols were sorted by recency, but the matrix priority list used raw signal-state order. The symbols visible first in the signal lane could miss the first matrix batch.
- Lower-priority startup streams could start while signal profile/state bootstrap was still pending, pushing signal state/matrix requests behind heavier startup work in the browser origin queue.
- If HMR or a network stall orphaned a mutation, `inFlight` could remain true until user reload.

## Fix

- Moved signal hydration bootstrap declarations before diagnostics reads in `PlatformApp.jsx`.
- Raised frontend scheduler caps to `normal:24`, `watch:18`, `high:12`, `critical:6`.
- Decoupled backend matrix caps from profile `maxSymbols`; matrix now uses pressure caps directly.
- Raised backend matrix concurrency to `normal/watch:4`, `high:2`, `critical:1`.
- Ordered matrix signal symbols with `buildHeaderSignalContextSymbols` so the header signal lane's visible symbols enter early matrix batches.
- Added bootstrap gating for signal profile/state, not just matrix runtime, so low-priority streams wait while the signal lane is bootstrapping.
- Added a 90s request timeout plus a watchdog grace path that clears stuck `inFlight` state and schedules another matrix pass.
- Cleared stale `skippedSymbols`/`truncated` diagnostics on successful non-truncated matrix responses.

## Evidence

- Temporary rebuilt API on port 18092 returned 18 requested symbols, 54 states, no skipped symbols, no truncation, `sourceStrategy: native_timeframes`, in about 11.1s.
- Fresh browser navigation to `http://127.0.0.1:18747/?pyrusQa=off` after the live app settled showed no console errors, `bootstrapComplete: true`, `stateCount: 54`, coverage `requestedSymbols: 18`, `hydratedSymbols: 18`, `missingSymbols: 0`, and 51 active signal dots after 35s.
- Screenshot evidence: `/tmp/pyrus-signal-dots-final.png`.

## Validation

- `pnpm --filter @workspace/api-server exec node --import tsx --test src/services/signal-monitor.test.ts`
- `pnpm --filter @workspace/api-server run typecheck`
- `pnpm --filter @workspace/pyrus exec node --import tsx --test src/features/platform/signalMatrixScheduler.test.js`
- `pnpm --filter @workspace/pyrus exec node --import tsx --test --test-name-pattern "signal monitor display refreshes separately from evaluator cadence|screen shell warmup preloads top-level code without default hidden page mounting" src/features/platform/platformRootSource.test.js`
- `pnpm --filter @workspace/pyrus run typecheck`
- `git diff --check --` for the touched signal matrix files

## Related

Live verification caused Replit app-supervisor restarts while rebuilding/reloading the active app. Lifecycle logs classified them as same-container supervisor restarts, not container reboots. Future browser verification should avoid rebuilding `dist` against the active Replit workflow; use a temporary API port for backend probes and one final app reload only after code is ready.

## Status

DONE_WITH_CONCERNS: signal hydration is fixed and verified, but live Replit dev reloads remain sensitive while editing/rebuilding. The app was healthy after the final verification.
