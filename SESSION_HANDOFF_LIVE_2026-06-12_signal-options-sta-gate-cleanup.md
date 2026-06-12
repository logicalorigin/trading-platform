# Live Session Handoff - Signal Options STA Gate Cleanup

- Session ID: pending
- Saved At (MT): 2026-06-12 08:45:51 MDT
- Saved At (UTC): 2026-06-12T14:45:51Z
- Repo Root: `/home/runner/workspace`
- Workstream: remove Signal Options scanner behavior; keep STA as Signal Matrix-derived filter and Signal Options as downstream option exploration only.

## Current User Request

Proceed with the plan to stop Signal Options from scanning/refreshing ticker signals. User confirmed:

- Signal Matrix is the only canonical ticker signal source.
- STA is a derived filter over Signal Matrix plus algo controls.
- Signal Options does not scan; it explores the options side once a signal reaches actionable STA.
- Reviewed/skipped/no-trade rows should remain visible in STA, but stale rows must not keep live trading permission.

## Observed Runtime Before Edits

- `/api/settings/ibkr-line-usage?detail=summary` at 2026-06-12T14:43Z showed:
  - `automationLineCount: 12`
  - `signalOptions.activeLineCount: 6`
  - Signal Options owners included old 5m signals such as `CLS:5m:sell:2026-06-12T13:00:00.000Z`, `FHI:5m:sell:2026-06-12T13:00:00.000Z`, and `AEVA:5m:sell:2026-06-12T13:00:00.000Z`.
  - `flowScannerLineCount: 160`, separate from Signal Options cleanup.
- Earlier investigation confirmed `activeLongScanCount: 1` came from Signal Options automation before an API recycle.

## Planned Implementation Slices

1. Stop Signal Options as a recurring deployment scan owner.
2. Remove/guard Signal Options signal refresh/evaluate paths.
3. Preserve STA candidate/history display while blocking stale rows from live option exploration.
4. Add focused tests.
5. Validate line usage and STA freshness separately.

## Active Files

- `artifacts/api-server/src/services/signal-options-worker.ts`
- `artifacts/api-server/src/services/signal-options-worker-state.ts`
- `artifacts/api-server/src/services/background-worker-pressure.test.ts`
- `artifacts/api-server/src/services/signal-options-automation.ts`
- `artifacts/pyrus/src/screens/algo/algoHelpers.js`
- `artifacts/pyrus/src/screens/algo/OperationsSignalTable.jsx`

## Current Status

- Read-only planning and source trace complete.
- No code edits made in this cleanup slice yet.
- Worktree is already dirty in many unrelated files. Preserve existing changes; do not use broad staging or checkout/reset.

## Next Step

Write focused regression tests that prove the Signal Options worker no longer runs deployment scans or ticker signal evaluations, then implement the smallest worker/automation changes needed.
