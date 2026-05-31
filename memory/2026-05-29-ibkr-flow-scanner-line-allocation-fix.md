# IBKR Flow Scanner Line Allocation Fix - 2026-05-29

## Symptom

- Flow Scanner reported `1 option-chain scan active; quotes warming` even while the app appeared to reserve roughly 80 IBKR market data lines for option scanning.
- The scanner was effectively using one active option-chain lane, leaving most of the intended scanner line budget idle.

## Root Cause

- The scanner promotion capacity treated `scannerLineBudget` as a per-symbol budget. With an 80-line scanner budget, capacity became `availableLines / 80`, which collapsed to one promoted scan in normal conditions.
- Frontend and lane defaults also capped option-flow scanner concurrency at 1, reinforcing the single active scan behavior.
- `setMarketDataAdmissionRuntimeDefaults()` did not push the scanner runtime budget/concurrency into market-data admission, so line usage diagnostics and enforcement could drift from scanner config.
- Admission accounting charged shared scanner/protected subscriptions too bluntly, so scanner leases were not cleanly distinguished from account, visible, automation, and execution demand.
- REST option quote fallback did not carry the same owner/intent metadata as websocket quote streams, which could misclassify fallback quote demand as generic visible demand.

## Fix

- Treat `scannerLineBudget` as the scanner working-set cap, not the per-symbol budget.
- Allow scanner concurrency of 2 by default and split the scanner line budget across active scans. With an 80-line target and concurrency 2, each deep scan gets 40 lines.
- Make fallback radar promotion fill available scanner slots instead of stopping at one symbol when option activity is quiet.
- Sync scanner runtime defaults into market-data admission before diagnostics and line-usage snapshots.
- Charge the scanner cap only for scanner-exclusive lines; shared protected lines remain counted once globally and charged to their highest-priority owner.
- Rebalance scanner leases downward when protected non-scanner demand consumes headroom.
- Pass option quote fallback `owner`, `intent`, and `requiresGreeks` through the REST API and generated clients.
- Classify account position option quote streams as `account-monitor-live`.

## Validation

- `node --import tsx --test src/services/market-data-admission.test.ts src/services/ibkr-line-usage.test.ts`
- `node --import tsx --test src/services/options-flow-scanner.test.ts`
- `node --import tsx --test src/services/bridge-option-quote-stream.test.ts src/ws/options-quotes.test.ts`
- `node --import tsx --test src/features/platform/marketFlowScannerConfig.test.js src/features/platform/live-streams.test.ts`
- `pnpm run audit:api-codegen`
- `pnpm --filter @workspace/api-server run typecheck`
- `pnpm --filter @workspace/pyrus run typecheck`
- `pnpm run typecheck`

## Notes

- The package unit-test filters attempted earlier ran unrelated dirty-worktree suites. Focused direct node tests were used for this scanner change.
- The repo already had many unrelated dirty files before this fix; this note only describes the scanner allocation work.
