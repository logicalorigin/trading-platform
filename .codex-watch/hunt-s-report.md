# HUNT-S report — session boundaries

## Findings

1. `artifacts/api-server/src/services/flow-universe.ts:270` | P1 | Options-flow RTH gate is UTC-fixed, not NYSE-session aware
Evidence: `isRegularTradingHours()` uses `now.getUTCDay()` and hard-coded `13:30 <= UTC < 20:00` at lines 270-276. `platform.ts` consumes it for scanner coverage health at `artifacts/api-server/src/services/platform.ts:12768`, diagnostics session block reason at `artifacts/api-server/src/services/platform.ts:13748`, and live quote empty-session labeling at `artifacts/api-server/src/services/platform.ts:18481`.
Consequence: During EST the first RTH hour (09:30-10:30 ET) is mislabeled quiet and 15:00-16:00 ET can be treated off by an hour; holidays and half-days are also treated like normal weekdays, so user-visible options-flow diagnostics/quote hydration status can be wrong.
Laziest fix: Replace the helper with `resolveUsEquityMarketStatus(now).session.key === "rth"` from `@workspace/market-calendar`.
Confidence: 0.96

2. `artifacts/api-server/src/services/shadow-account.ts:1263` | P1 | Shadow option live-session gate ignores holidays and early closes
Evidence: `isShadowOptionTradingSession()` rejects only Sat/Sun and otherwise allows `09:30` through fixed `16:00` or `16:15` at lines 1267-1272. This gate controls option quote use at `artifacts/api-server/src/services/shadow-account.ts:6159`, stop/exit decisions at `artifacts/api-server/src/services/shadow-account.ts:6498`, and live automation mirror entries/exits at `artifacts/api-server/src/services/shadow-account.ts:15828` / `artifacts/api-server/src/services/shadow-account.ts:15869`.
Consequence: On full weekday holidays shadow automation can accept option marks/orders as if the session were open; on early-close days it can keep stops/exits live until 16:00/16:15 ET instead of stopping at 13:00 ET.
Laziest fix: Drive the predicate from `resolveNyseCalendarDay(value)` and use `calendarDay.regularCloseAt` plus the existing extended-close exception only on non-early-close trading days.
Confidence: 0.93

3. `artifacts/api-server/src/services/shadow-account.ts:1251` | P1 | Expiring shadow options are force-closed three hours late on half-days
Evidence: `isMarketCloseOrLater()` is fixed to `hour > 16 || hour === 16` at lines 1251-1254. `shouldCloseOptionForShadowMaintenance()` uses it for same-day expirations at lines 1275-1281, and maintenance skips positions until that returns true at `artifacts/api-server/src/services/shadow-account.ts:5360`.
Consequence: On NYSE early closes, same-day expiring shadow options remain open in the ledger after the real 13:00 ET close, distorting active positions, diagnostics, and any downstream automation that sees them still open.
Laziest fix: Resolve the NYSE calendar day for `now` and compare `now` to `calendarDay.regularCloseAt`.
Confidence: 0.91

4. `artifacts/api-server/src/services/signal-options-automation.ts:17053` | P1 | Signal-options backfill default end ignores early closes
Evidence: `latestCompletedBackfillMarketDate()` states today counts when the regular session has closed, but it checks `minutes >= 16 * 60` at lines 17056-17069. Nearby session predicates were explicitly made early-close aware at lines 17121-17139, so this fixed close is not the shared calendar path.
Consequence: On half-days, default historical backfills omit the current completed market date from 13:00 ET until 16:00 ET, delaying signal-options replay/discovery for that session.
Laziest fix: Use `resolveNyseCalendarDay(now)?.regularCloseAt` and compare `now.getTime()` against that close instant.
Confidence: 0.9

5. `artifacts/api-server/src/services/historical-flow-events.ts:297` | P1 | Historical flow hydration sessions include holidays and miss half-day closes
Evidence: `resolveHistoricalFlowSessions()` iterates NY dates but filters only `!isWeekendSession(parts)` at lines 309-312, then builds every weekday as `09:30` to fixed `16:00` at lines 313-320. Those sessions feed hydration/read windows at `artifacts/api-server/src/services/historical-flow-events.ts:623`, `681`, and `738`.
Consequence: Weekday holidays get stored/read as flow sessions when there is no session, and half-days query 13:00-16:00 ET as if valid RTH; that can produce empty/degraded historical-flow hydration and misleading chart/tape coverage around holidays.
Laziest fix: Build sessions from `resolveNyseCalendarDay()` and skip non-trading days while using `regularOpenAt` / `regularCloseAt`.
Confidence: 0.92

6. `artifacts/api-server/src/services/platform.ts:17708` | P2 | IBKR snapshot flow timestamps coerce to previous weekday/fixed 16:00, not previous trading close
Evidence: `coerceIbkrSnapshotFlowOccurredAt()` only treats weekends specially at lines 17713-17718; pre-open rolls to `previousWeekdayFlowClockParts()` at lines 17719-17723, and post-close clamps to fixed 16:00 at lines 17725-17727. Returned values become flow event IDs/timestamps at `artifacts/api-server/src/services/platform.ts:18578`.
Consequence: Snapshots on weekday holidays can be timestamped inside a nonexistent market session, and half-day snapshots after 13:00 ET are left/clamped too late, which mis-buckets options-flow events on charts and feeds.
Laziest fix: Replace weekday/fixed-close coercion with `resolvePreviousUsEquitySessionClose()` or `resolveNyseCalendarDay()`-based session windows.
Confidence: 0.86

7. `artifacts/pyrus/src/features/charting/chartEvents.ts:439` | P2 | Frontend flow lookback counts weekdays, not NYSE sessions
Evidence: `intradayFlowLookbackStart()` walks NY dates and increments `sessions` whenever `!isWeekendEventWindowDay(parts)` at lines 462-467. It returns a fixed 09:30 start at lines 472-474 and feeds chart flow event fetches at `artifacts/pyrus/src/features/charting/chartEvents.ts:1337`.
Consequence: Around full weekday holidays, one requested lookback "session" is consumed by a closed day, so charts can under-fetch a real prior trading session of flow overlays; early-close length is also not represented.
Laziest fix: Reuse `resolveNyseCalendarDay()` and count only `tradingDay` records, using their `regularOpenAt`.
Confidence: 0.88

8. `artifacts/api-server/src/services/shadow-account.ts:12617` | P2 | Watchlist backtest regular-session filter is weekday/fixed-close only
Evidence: `isWatchlistBacktestRegularSessionTime()` rejects only UTC-derived Sat/Sun at lines 12621-12627 and uses fixed `09:30`/`16:00` at lines 12628-12633. It filters signal candidates and fill times at `artifacts/api-server/src/services/shadow-account.ts:13259` / `13269`, and prepared bars at `artifacts/api-server/src/services/shadow-account.ts:13343`.
Consequence: Watchlist backtests can include bars/signals on weekday holidays if data exists and can treat 13:00-16:00 ET on half-days as regular-session time, skewing replay candidates and fills.
Laziest fix: Replace with a `resolveNyseCalendarDay(date)` check and compare against `regularOpenAt`/`regularCloseAt`.
Confidence: 0.84

9. `artifacts/api-server/src/services/signal-options-automation.ts:16457` | P3 | Gateway-blocked daily dedupe splits on UTC day instead of market day
Evidence: `recordSignalOptionsGatewayBlocked()` computes `todayKey` with `now.toISOString().slice(0, 10)` and matches prior events with `event.occurredAt.toISOString().slice(0, 10)` at lines 16462-16469. Gateway-blocked events are surfaced in readiness/incidents at `artifacts/api-server/src/services/signal-options-automation.ts:10502`, `11389`, and `12051`.
Consequence: Events between 20:00 ET and midnight ET are deduped into the next UTC day, so one NY market day can show split/duplicated gateway-blocked incidents and counts.
Laziest fix: Use the existing NY market-date helper (`marketDateKeyFromDate`) or the shared calendar day key for both sides of the dedupe.
Confidence: 0.82

10. `artifacts/api-server/src/services/diagnostics.ts:738` | P3 | Expiring-option diagnostics mark due at fixed 16:00, not early close
Evidence: diagnostics computes NY market date at lines 712-720, but `isMarketCloseOrLater()` only checks `minutes >= 16 * 60` at lines 738-740. The result determines whether today-expiring open shadow options count as `due` at lines 2248-2266.
Consequence: On half-days, diagnostic due counts remain low from 13:00 ET until 16:00 ET, masking stale expiring shadow option exposure in diagnostics.
Laziest fix: Compare `nowDate` with `resolveNyseCalendarDay(nowDate)?.regularCloseAt`.
Confidence: 0.8

## Coverage note

Read-only HUNT-S pass covered `lib/market-calendar`, primary consumers in `signal-monitor`, `signal-options-automation`, overnight/worker gates, account market-date handling, options-flow platform/historical-flow services, shadow account session predicates, backtest/timeframe helpers, and relevant frontend chart session/flow lookback code. I intentionally did not report the known fixed `market_closed` mislabel. I did not run the app or mutate code; the only write was this report file.
