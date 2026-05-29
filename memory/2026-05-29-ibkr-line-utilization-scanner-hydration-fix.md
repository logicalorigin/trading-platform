# IBKR Line Utilization Scanner Hydration Fix - 2026-05-29

## Symptom

During a clean five-minute passive watch from `2026-05-29T15:26:36.872Z` to
`2026-05-29T15:32:34.167Z`, IBKR active lines averaged about 12 and peaked at
24 while the account had a 200-line target. Visible/account/automation demand
was modest, Massive stock aggregation was active for the broad stock universe,
and the options flow deep scanner was continuously active or queued. Despite
that, `flowScannerLineCount` stayed at 0 for every usable sample.

## Expected Line Allocation

- Execution, account, and automation lines should retain priority.
- Visible UI demand should consume only current visible symbols and position
  contracts.
- Broad stock/radar observation should stay on Massive where configured.
- The options flow deep scanner should opportunistically use the remaining IBKR
  live option quote capacity. With a 200-line target, line budget 80, effective
  concurrency 2, and roughly 176-198 idle lines, scanner quote leases should
  appear in short bursts instead of remaining at 0.

## Root Cause

`listFlowEventsUncached` selected up to the full scanner live-line budget for
live option quote hydration, but then sent that entire live candidate set through
IBKR historical option-bar hydration before requesting live quotes.

The intended cap already existed as `selectFlowScannerHistoricalCandidateContracts`
with `OPTIONS_FLOW_HISTORICAL_CANDIDATE_LIMIT` defaulting to 8, but it was not
used in the live scanner path. In production, that caused deep scans to queue
behind dozens of historical bar calls per symbol. The runtime evidence matched:
historical and options metadata lanes showed timeouts/rejections, while scanner
live quote leases never appeared.

The line-usage diagnostic also masked this state by reporting generic
`scanner-active` whenever the scanner was draining or queued, even when active
scanner live lines were 0 and most of the line pool was idle.

## Fix

- `artifacts/api-server/src/services/platform.ts`
  - Cap historical scanner hydration to the dedicated historical candidate set.
  - Merge that small historical hydration result back into the larger live
    candidate set.
  - Continue sending the full live candidate set to live quote hydration so IBKR
    scanner quote leases are admitted promptly.
  - Apply the same ordering to the scanner benchmark path.

- `artifacts/api-server/src/services/ibkr-line-usage.ts`
  - Report `scanner-waiting-for-live-lines` when scanner work is queued/draining
    but no scanner live lines are admitted while capacity remains.
  - Let line drift outrank generic scanner-active in the utilization reason.

- `artifacts/api-server/src/services/options-flow-scanner.test.ts`
  - Updated the regression to assert historical hydration is capped at 8 while
    live scanner quote leases are admitted for the larger candidate set.

## Verification

- `cd artifacts/api-server && node --import tsx --test src/services/options-flow-scanner.test.ts --test-name-pattern "historical hydration while admitting live scanner quotes"`
  - Passed: 77 tests, 0 failed.
- `cd artifacts/api-server && node --import tsx --test src/services/ibkr-line-usage.test.ts`
  - Passed: 10 tests, 0 failed.
- `pnpm --filter @workspace/api-server run typecheck`
  - Passed.

## Status

DONE_WITH_CONCERNS. The root cause is fixed and covered by focused tests. The
running Replit process was not restarted by this session, so live endpoint
verification needs the already-running app to pick up the patched server code.
