# WO-P1-SHADOW Report

Observed:
- `artifacts/api-server/src/services/shadow-account.ts` swallowed mark-time trailing-stop enforcement errors after logging only.
- The shadow option live-session gate and expiry maintenance close check used fixed weekday/time logic instead of the market-calendar early-close/holiday model.

Changed:
- Added a safe trailing-stop enforcement wrapper that records a structured diagnostic counter before returning `enforcement_failed`, so mark refresh continues without making the failure silent.
- Updated shadow option session and expiry close helpers to use `resolveUsEquityMarketSession`, `resolveUsEquityMarketStatus`, and `listNyseEarlyCloses` from `@workspace/market-calendar`.
- Preserved the existing 16:15 ET extended close only for configured underlyings on full trading days; half-days close at the calendar regular close.

Validation:
```text
pnpm --filter @workspace/api-server exec node --import tsx --input-type=module --eval '<targeted shadow-account assertions>'
{"level":40,"time":1783552002184,"pid":70337,"hostname":"repl","err":{"type":"Error","message":"forced enforcement failure","stack":"Error: forced enforcement failure\n    at enforce (file:///home/runner/workspace/artifacts/api-server/[eval1]:5:293)\n    at Object.enforceSignalOptionsTrailingStopFromShadowMarkSafely (/home/runner/workspace/artifacts/api-server/src/services/shadow-account.ts:5296:18)\n    at file:///home/runner/workspace/artifacts/api-server/[eval1]:5:32"},"positionId":"pos-1","symbol":"CRM","enforcementFailureCount":1,"msg":"Signal-options mark-time trailing stop enforcement failed"}
ok - shadow-account targeted TSX unit checks passed
```

Unknown:
- No browser, Playwright, e2e, project-wide typecheck, or full-suite tests were run per work-order constraints.
- No git commands were run.
