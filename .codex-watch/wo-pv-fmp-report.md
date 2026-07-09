Observed:
- `artifacts/api-server/src/providers/fmp/client.ts` had the confirmed silent-drop path: each high-beta screener exchange request used `.catch(() => [])`.
- I did not run git commands; clean working-tree status was not verifiable under the work-order's no-git constraint.

Changed:
- Replaced the per-exchange catch with `Promise.allSettled`.
- Successful exchange payloads are still returned and merged.
- Rejected exchanges now update high-beta screener diagnostics and emit `logger.warn` with the failed exchange, failed/requested exchange counts, and `partial: true`.

Verified:
- Ran a lightweight in-memory `tsx` unit probe for `FmpResearchClient`.
- Fixture: NASDAQ and AMEX returned candidates; NYSE rejected.
- Assertions passed: returned symbols were `AAA` and `BBB`, diagnostics had `lastPartial: true` and `lastFailedExchanges: ["NYSE"]`, and one warning was emitted for NYSE.
