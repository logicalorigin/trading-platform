# WO-P1-T1b5-FLOW Report

## Scope

- Touched `artifacts/api-server/src/services/historical-flow-events.ts`.
- Added this report at `.codex-watch/wo-p1-t1b5-flow-report.md`.
- No git state was mutated.

## Finding

Observed from source: `resolveHistoricalFlowSessions` used weekday filtering plus fixed 09:30-16:00 New York regular-session bounds, so it did not account for NYSE full holidays or early closes.

Observed baseline failures before the fix:

```text
AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
+ actual - expected

+ '2026-11-27T21:00:00.000Z'
- '2026-11-27T18:00:00.000Z'
```

```text
AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:

1 !== 0
```

## Change

- Imported `isNyseFullHoliday`, `listNyseEarlyCloses`, and `resolveUsEquityMarketSession` from `@workspace/market-calendar`.
- Added a small session-window resolver that:
  - skips weekends and NYSE full holidays,
  - confirms the computed regular open resolves to `rth`,
  - uses `listNyseEarlyCloses` to replace the fixed 16:00 ET close on half-days.

## Verification

Targeted half-day/holiday fixture:

```text
$ pnpm --filter @workspace/api-server exec tsx <<'EOF'
import assert from 'node:assert/strict';
import { resolveHistoricalFlowSessions } from './src/services/historical-flow-events.ts';

const halfDaySessions = resolveHistoricalFlowSessions({
  from: new Date('2026-11-27T00:00:00.000Z'),
  to: new Date('2026-11-27T23:59:59.999Z'),
});
assert.equal(halfDaySessions.length, 1);
assert.equal(halfDaySessions[0]?.marketDate, '2026-11-27');
assert.equal(halfDaySessions[0]?.windowFrom.toISOString(), '2026-11-27T14:30:00.000Z');
assert.equal(halfDaySessions[0]?.windowTo.toISOString(), '2026-11-27T18:00:00.000Z');

const holidaySessions = resolveHistoricalFlowSessions({
  from: new Date('2026-12-25T00:00:00.000Z'),
  to: new Date('2026-12-25T23:59:59.999Z'),
});
assert.equal(holidaySessions.length, 0);

console.log('historical flow session calendar fixture passed');
EOF
historical flow session calendar fixture passed
```

Touched module suite:

```text
$ pnpm --filter @workspace/api-server exec tsx --test src/services/historical-flow-events.test.ts
✔ single range scan is row-for-row identical to the per-window loop (per-window limit exceeded), in one query (23972.511452ms)
✔ single range scan matches the per-window loop when the global rowLimit forces an early break, in one query (28.261413ms)
✔ historical hydration persists the provider result once instead of streaming duplicate chunks (33.33451ms)
ℹ tests 3
ℹ suites 0
ℹ pass 3
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 36871.190412
```
