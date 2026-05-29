# IBKR Line Utilization and Contract-Wait Follow-Up

- Date: 2026-05-29
- Request: determine why IBKR market-data usage fell back to roughly 25 lines and why signal options showed "waiting on contract" after fresh signals.

## Finding

Scanner live quote leases were intentionally short-lived. `getOptionsFlowScannerQuoteLeaseTtlMs()` used `OPTIONS_FLOW_SCANNER_QUOTE_SAMPLE_TIMEOUT_MS` with a 5s default, while scanner live quote hydration keeps leases only until their TTL. The scanner can briefly consume spare lines, but those leases expire almost immediately after a quote batch, so line usage falls back to visible/account demand between hydration phases.

The cockpit contract stage also collapsed upstream states into "no resolved contracts yet." When candidates had already mapped to actions but action/contract work was still active or deferred, the UI made it look like contract selection itself was stuck.

## Changes

- Increased the scanner live quote lease dwell default from 5s to 30s so admitted scanner quote lines stay warm longer between hydration phases.
- Kept the existing env override: `OPTIONS_FLOW_SCANNER_QUOTE_SAMPLE_TIMEOUT_MS`.
- Updated the signal-options cockpit pipeline to distinguish:
  - an active upstream signal/action scan before contract selection,
  - deferred action work before contract selection,
  - actual contract-resolution blockers.
- Added cockpit regressions covering the active action-scan and deferred-action cases.

## Validation

- `node --import tsx --test src/services/signal-options-automation.test.ts --test-name-pattern "cockpit"` passed; Node ran the full file, 92/92 passing.
- `node --import tsx --test src/services/options-flow-scanner.test.ts --test-name-pattern "flow scanner"` passed; 77/77 passing.
- `pnpm --filter @workspace/api-server run typecheck` passed.

## Residual Note

This makes scanner utilization much less bursty, but truly pinning all available IBKR lines at all times would require a persistent scanner subscription pool with explicit demotion when visible/account/automation demand arrives. The current fix preserves the existing admission and priority model while stopping the most obvious five-second lease drop-off.
