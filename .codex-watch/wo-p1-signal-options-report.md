# WO-P1-SIGNAL-OPTIONS Report

Target: `artifacts/api-server/src/services/signal-options-automation.ts`

## Fix A - NY-session daily-loss day key

What changed:
- Added `signalOptionsNyseSessionDayKey`, backed by `resolveNyseCalendarDay(value)?.date`.
- Routed live daily realized P&L filtering through that helper.
- Replaced backfill UTC day keys (`toISOString().slice(0, 10)`) with the same NYSE calendar day helper for both realized exit bucketing and signal-time daily halt checks.

Why:
- The verified backfill daily-loss path keyed `realizedByDay` and candidate checks by UTC date. Exits after the UTC rollover but still on the same New York trading date could be charged to the wrong daily-loss bucket.

Diff:

```diff
-        marketDateKeyFromDate(event.occurredAt) === marketDateKeyFromDate(now) &&
+        signalOptionsNyseSessionDayKey(event.occurredAt) ===
+          signalOptionsNyseSessionDayKey(now) &&
         signalOptionsExitEventHasActionableOptionSession(event),
```

```diff
-  const dayKey = input.occurredAt.toISOString().slice(0, 10);
+  const dayKey = signalOptionsNyseSessionDayKey(input.occurredAt);
```

```diff
-      const dayKey = historicalSignal.signalAt.toISOString().slice(0, 10);
+      const dayKey = signalOptionsNyseSessionDayKey(historicalSignal.signalAt);
```

## Fix B - Net daily P&L includes commissions/fees

What changed:
- Added `signalOptionsExitEventNetPnl`.
- Daily realized P&L now sums `payload.pnl - commission(s) - fee(s)` using existing payload field names when present.

Why:
- The verified daily realized helper summed gross `payload.pnl` only. That fed both the daily-loss halt and reporting, so commissions/fees were ignored.

Diff:

```diff
-    .reduce(
-      (sum, event) => sum + (finiteNumber(asRecord(event.payload).pnl) ?? 0),
-      0,
-    );
+    .reduce((sum, event) => sum + signalOptionsExitEventNetPnl(event), 0);
```

```diff
+function signalOptionsExitEventNetPnl(event: ExecutionEvent): number {
+  const payload = asRecord(event.payload);
+  const pnl = finiteNumber(payload.pnl) ?? 0;
+  const commissionsAndFees = [
+    payload.commission,
+    payload.commissions,
+    payload.fee,
+    payload.fees,
+  ].reduce((sum, value) => sum + (finiteNumber(value) ?? 0), 0);
+  return pnl - commissionsAndFees;
+}
```

## Fix C - Default backfill end uses market session close

What changed:
- `latestCompletedBackfillMarketDate` now compares `now` to `calendarDay.regularCloseAt` instead of fixed 16:00 ET.
- Added `signalOptionsBackfillSessionEndAt`.
- Backfill window `to` now resolves to the selected market date's calendar session end: `regularCloseAt` for regular session, `extendedCloseAt` for `all`, with the old UTC end-of-day only as invalid/holiday fallback.

Why:
- The verified window resolver returned `YYYY-MM-DDT23:59:59.999Z`, a fixed UTC boundary. That did not respect early closes and was not a session end.

Diff:

```diff
-  const minutes =
-    Number.parseInt(parts.hour ?? "0", 10) * 60 +
-    Number.parseInt(parts.minute ?? "0", 10);
-  if (minutes >= 16 * 60) {
+  const regularCloseMs = calendarDay.regularCloseAt
+    ? Date.parse(calendarDay.regularCloseAt)
+    : Number.NaN;
+  if (Number.isFinite(regularCloseMs) && now.getTime() >= regularCloseMs) {
     return today;
   }
```

```diff
-    to: new Date(end.getTime() + 24 * 60 * 60_000 - 1),
+    to: signalOptionsBackfillSessionEndAt(endDate, session),
```

## Test Output

Command:

```sh
pnpm --dir artifacts/api-server exec tsx --test --test-name-pattern "C3 daily-loss|C4 latest" src/services/signal-options-automation.test.ts && pnpm --dir artifacts/api-server exec tsx -e 'import assert from "node:assert/strict"; import { __signalOptionsAutomationInternalsForTests, SIGNAL_OPTIONS_EXIT_EVENT } from "./src/services/signal-options-automation"; const { computeSignalOptionsDailyRealizedPnl, resolveSignalOptionsBackfillWindow } = __signalOptionsAutomationInternalsForTests; const event = { id: "fee-net", eventType: SIGNAL_OPTIONS_EXIT_EVENT, occurredAt: new Date("2026-07-07T15:00:00.000Z"), payload: { pnl: 100, commission: 1.25, fees: 0.75, maintenance: true } }; assert.equal(computeSignalOptionsDailyRealizedPnl([event as any], new Date("2026-07-07T15:30:00.000Z")), 98); const early = resolveSignalOptionsBackfillWindow({ now: new Date("2026-11-27T18:30:00.000Z") }); assert.equal(early.endDate, "2026-11-27"); assert.equal(early.to.toISOString(), "2026-11-27T18:00:00.000Z"); const holiday = resolveSignalOptionsBackfillWindow({ now: new Date("2026-07-03T15:00:00.000Z") }); assert.equal(holiday.endDate, "2026-07-02"); assert.equal(holiday.to.toISOString(), "2026-07-02T20:00:00.000Z"); console.log("ok fee-net and backfill session-end assertions");'
```

Output:

```text
✔ C3 daily-loss halt keys off the NY trading day, not the UTC calendar day (3.837579ms)
✔ C4 latestCompletedBackfillMarketDate skips holidays, not just weekends (1.026875ms)
ℹ tests 2
ℹ suites 0
ℹ pass 2
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 15995.00798
ok fee-net and backfill session-end assertions
```

Notes:
- No git commands were run.
- No browser, Playwright, e2e, `browser:waterfall`, `pnpm shot`, project-wide typecheck, or full-suite tests were run.
