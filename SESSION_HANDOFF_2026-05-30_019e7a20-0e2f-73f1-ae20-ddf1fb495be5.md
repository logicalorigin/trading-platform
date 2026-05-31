# Session Handoff: Scanner Pressure Investigation

- Last Updated (MT): `2026-05-30 15:27:25 MDT`
- Last Updated (UTC): `2026-05-30T21:27:25Z`
- Native Codex Session ID: `019e7a20-0e2f-73f1-ae20-ddf1fb495be5`
- Replit Session ID: `SAFloans-mj8c`
- CWD: `/home/runner/workspace`
- Summary: 2026-05-30 15:27:25 MDT | 019e7a20-0e2f-73f1-ae20-ddf1fb495be5 | Scanner remediation validated after quiet-session stored-state follow-up

## Current Status

- Scanner halt/pause remediation is implemented in the working tree, with one fresh follow-up after the second live restart check.
- API resource pressure now separates global API pressure from scanner-only automation pressure. Automation long scans no longer raise the global API pressure level or shed manual shadow-scan routes, but remain visible under `apiResourcePressure.scannerPressure`.
- Signal-options worker scans now run with a worker wall-clock timeout and abort signal propagation. Timeout telemetry is exposed on worker deployment snapshots, and timed-out scans fail closed until the underlying scan promise settles.
- Signal-options worker refreshes now use capped rotating monitor batches for worker scans instead of full-universe soft-pressure bypass refreshes. Manual refreshes can still cover the full deployment universe.
- Heavy signal-options action work now defers when `caps.signalOptions.actionScansAllowed` is false, not only when position marks are disallowed.
- Options-flow scanner quiet-session behavior now respects `scannerAlwaysOn`: `market-session-quiet` no longer becomes a background blocker when always-on is true, while transport/auth/frozen/resource/line-cap blockers still apply.
- Diagnostics and Pyrus footer memory tests now guard that scanner-only automation pressure does not render as elevated footer memory pressure.
- Post-restart live check showed the original pressure split behaving correctly: global API pressure was `watch` from latency only, RSS/heap were normal, footer memory stayed `normal`, options-flow scanner was not quiet-blocked, and scanner line capacity remained available.
- The first live check exposed that the signal-options worker was still using the 60-symbol signal-monitor profile cap, timed out after 120s, then retried. A worker-only monitor batch cap of 12 symbols was added.
- The second live check still timed out after 120s with `scanCount: 0` and `lastBatchSize: 0`; direct `/api/signal-monitor/matrix` probes for 3 symbols also timed out after 30s. This localized the remaining quiet-session issue to live signal-refresh/bar hydration before any worker batch summary was recorded.
- Follow-up implemented: worker scans now use persisted signal-monitor state during `market_session_quiet`, mark non-current persisted states `stale`/non-fresh so action work will not fire, and still preserve gateway quiet as an execution blocker. Worker quiet-session gateway-blocked event spam is suppressed because quiet is no longer a scanner halt.
- Follow-up implemented: active signal-options run metadata is updated to `signal_refresh` before entering monitor refresh, so diagnostics can surface the phase while a scan is still running.
- Post-restart validation after the stored-state follow-up passed: two worker scans completed successfully in quiet session. First completed in about 1.1s, second in about 1.8s. `scanCount` advanced to 2, `lastScanOutcome` stayed `success`, `timedOut` stayed false, failures stayed 0, `activeLongScanCount` stayed 0, and quiet-session `gatewayBlockedCount` stayed 0.
- Live line/admission validation after restart stayed normal: active line count was low, scanner active lines were 0, scanner effective cap was 80, and scanner remaining lines were 80. Footer memory stayed `normal`.

## Implementation Notes

- Main touched API files: `resource-pressure.ts`, `platform.ts`, `signal-options-worker.ts`, `signal-options-worker-state.ts`, `signal-monitor.ts`, `signal-options-automation.ts`.
- Main touched regression tests: `resource-pressure.test.ts`, `route-admission.test.ts`, `signal-options-worker.test.ts`, `signal-options-automation.test.ts`, `options-flow-scanner.test.ts`, `diagnostics.test.ts`.
- Pyrus regression guard added in `artifacts/pyrus/src/features/platform/useMemoryPressureSignal.test.js`.
- One existing options-flow stale-skip test fixture was widened from a 1 ms scanner interval to 100 ms to avoid runner-jitter flakes while preserving the stale diagnostics assertion.
- The repo remains heavily dirty from other sessions. No unrelated files were reverted.

## Validation Snapshot

- Passed: `pnpm --filter @workspace/api-server exec node --import tsx --test src/services/resource-pressure.test.ts src/services/route-admission.test.ts src/services/signal-options-automation.test.ts src/services/signal-monitor.test.ts src/services/signal-options-worker.test.ts`
- Passed: `pnpm --filter @workspace/api-server exec node --import tsx --test src/services/options-flow-scanner.test.ts`
- Passed: `pnpm --filter @workspace/api-server exec node --import tsx --test src/services/diagnostics.test.ts`
- Passed: `pnpm --filter @workspace/pyrus exec node --import tsx --test src/features/platform/useMemoryPressureSignal.test.js src/features/platform/FooterMemoryPressureIndicator.test.js src/features/platform/appWorkScheduler.test.js`
- Passed after first live-check follow-up: `pnpm --filter @workspace/api-server exec node --import tsx --test src/services/signal-options-automation.test.ts src/services/signal-options-worker.test.ts src/services/signal-monitor.test.ts`
- Passed after second live-check follow-up: `pnpm --filter @workspace/api-server exec node --import tsx --test src/services/signal-monitor.test.ts src/services/signal-options-automation.test.ts src/services/signal-options-worker.test.ts`
- Passed: `pnpm --filter @workspace/api-server run typecheck`
- Passed: `pnpm --filter @workspace/pyrus run typecheck`
- Passed after second live-check follow-up: `pnpm --filter @workspace/api-server run build`
- Passed after second live-check follow-up: `git diff --check -- artifacts/api-server/src/services/signal-monitor.ts artifacts/api-server/src/services/signal-options-automation.ts artifacts/api-server/src/services/signal-monitor.test.ts artifacts/api-server/src/services/signal-options-automation.test.ts`
- Passed: `git diff --check -- artifacts/api-server/src/services/resource-pressure.ts artifacts/api-server/src/services/platform.ts artifacts/api-server/src/services/signal-options-worker.ts artifacts/api-server/src/services/signal-options-worker-state.ts artifacts/api-server/src/services/signal-monitor.ts artifacts/api-server/src/services/signal-options-automation.ts artifacts/api-server/src/services/resource-pressure.test.ts artifacts/api-server/src/services/route-admission.test.ts artifacts/api-server/src/services/signal-options-worker.test.ts artifacts/api-server/src/services/signal-options-automation.test.ts artifacts/api-server/src/services/options-flow-scanner.test.ts artifacts/api-server/src/services/diagnostics.test.ts artifacts/pyrus/src/features/platform/useMemoryPressureSignal.test.js`
- Noted: a single all-in-one API `node --test` invocation that mixed options-flow with unrelated suites hit shared runtime-state noise; the affected options-flow suite passed when run alone.
- Noted: `artifacts/pyrus/src/features/platform/memoryPressureModel.test.js` has pre-existing threshold expectation failures when run directly; not changed as part of this scanner fix.

## Next Recommended Steps

1. Scanner halt/pause remediation is ready to leave in place.
2. Proceed to the separate memory-pressure work.
3. Keep an eye on API latency independently; it remained `degraded`/`watch` from route latency even while scanner and footer memory behavior were healthy.
