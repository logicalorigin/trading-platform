# WO-P2-T5 Report

## What changed

- Observed the finding is real in `artifacts/api-server/src/services/signal-monitor.ts`: the matrix eval path built one `chartBars` series, then `evaluateSignalMonitorMatrixHeavyEvaluation` and `buildSignalMonitorIndicatorSnapshot` independently computed the same completed-bars fingerprint and settings signature for their cache keys.
- Updated `evaluateSignalMonitorMatrixStateFromCompletedBars` to compute:
  - `settingsSignature` once via `signalMonitorPyrusSettingsSignature(settings)`
  - `completedBarsFingerprint` once via `fingerprintSignalMonitorMatrixCompletedBars(chartBars)`
- Threaded those exact strings into both cache helpers.
- Kept fallback computation inside both helpers so direct/internal callers preserve existing behavior.

## Why

This preserves identical cache identity and invalidation semantics while removing duplicate hot-path identity work from each matrix cell eval. The heavy-eval key still includes the completed-bars fingerprint plus `lastBarClosed`; the indicator-snapshot base key still uses the same completed-bars fingerprint without the closure suffix.

## Diff summary

- `buildSignalMonitorIndicatorSnapshot` accepts optional `completedBarsFingerprint` and `settingsSignature`.
- `evaluateSignalMonitorMatrixHeavyEvaluation` accepts optional `completedBarsFingerprint` and `settingsSignature`.
- `evaluateSignalMonitorMatrixStateFromCompletedBars` computes both values once per eval and reuses them for both caches.

Observed precondition: `artifacts/api-server/src/services/signal-monitor.ts` was already modified before this work began (`git status --porcelain -- artifacts/api-server/src/services/signal-monitor.ts .codex-watch/wo-p2-t5-report.md` reported ` M artifacts/api-server/src/services/signal-monitor.ts`).

Read-only diff stat after the edit:

```text
 .../api-server/src/services/signal-monitor.ts      | 85 ++++++++--------------
 1 file changed, 30 insertions(+), 55 deletions(-)
```

The stat includes pre-existing working-tree changes in the already-dirty target file.

## Verification

Command:

```text
pnpm --filter @workspace/api-server exec tsx --test --test-force-exit src/services/signal-monitor-matrix-eval-cache.test.ts
```

Output summary:

```text
tests 20
pass 20
fail 0
duration_ms 2040.073874
```

Result: targeted signal-monitor matrix eval/cache unit test passed.

## Finding status

Confirmed real. The patched matrix eval path now performs one completed-bars fingerprint and one settings JSON stringify per eval, then reuses those exact cache identity values.
