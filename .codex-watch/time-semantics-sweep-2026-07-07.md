# Time-semantics class sweep — wall-clock vs market time (2026-07-07)

Read-only audit of sites that conflate wall-clock/calendar time with market time
(bars, sessions, trading days). Excluded per brief: `signalMonitorBarsSinceSignal`
latch aging (signal-monitor.ts:7845-7875, sibling agent), the fixed 1d
`tradingWeekdaysBetween` holiday subtraction, the fixed market-closed label
ordering, and the MTF display/gate divergence.

Legend: **observed** = read from source / DB / production rows. **inferred** =
consequence derived from observed code. File paths are absolute-relative to
`/home/runner/workspace`.

---

## Finding 1 — Options DTE windows are UTC *calendar* days, not trading days (trading severity; DB-confirmed skips)

**Sites (observed):**
- `artifacts/api-server/src/services/signal-options-automation.ts:3341-3353` — `daysBetweenUtc` = `Math.round((toUtcDay - fromUtcDay) / 86_400_000)` on **UTC** date parts.
- `artifacts/api-server/src/services/signal-options-automation.ts:3355-3397` — `selectSignalOptionsExpiration` filters `dte >= minDte && dte <= maxDte` with that calendar DTE; no fallback — returns `null` → candidate skipped with `no_expiration_in_dte_window` (skip reason wired at :8114/:11266-11272/:13963). *(File is another lane's WIP — report-only.)*
- `artifacts/api-server/src/services/backtesting.ts:240-244` — clean-file sibling `calculateDte` (identical UTC calendar math), used by `selectExpiryWindow` :246-255 and `selectSignalOptionsExpiryWindow` :290-305. Defaults `minDte:1, targetDte:1, maxDte:3` come from `lib/backtest-core/src/signal-options.ts:207-210`.

**Production evidence (observed, read-only DB):** 13 `no_expiration_in_dte_window`
rows in `signal_options_seen_signals`, ALL on Mon/Tue (7 Mon, 6 Tue), symbols with
weekly/monthly-only expiries (TDY, NOC, ROK, BWXT, VIXY, ...). On Monday a Friday
weekly is 4 *calendar* DTE > maxDte 3 → skipped; on Wednesday the same contract is
2 DTE → traded. Same profile, day-of-week-dependent eligibility.

**Wrong unit:** calendar days (and UTC days at that) where "days to expiry" means
trading days / NY days.
**Consequences (inferred from observed arithmetic):**
- Weekend eats the window: Friday signal, `maxDte ≤ 2` → Monday expiry is dte 3 → no entry at all on Fridays.
- Mon/Tue block for weekly-expiry symbols (observed above).
- UTC-vs-NY day: between 20:00 ET (EDT; 19:00 EST) and midnight ET, the UTC date is already "tomorrow", so DTE reads one day LOW — a next-day expiry computes dte 0 and is dropped when `allowZeroDte=false`. Automation rows show evaluations at 02:25/04:42 NY (safe) but the 20:00-24:00 ET band is exposed for any eval that runs there.
- Friday-after-close 0DTE edge: at Fri 16:30 ET the Friday expiry still computes dte 0; with `allowZeroDte=true` an already-expired contract is selectable. Normally the session gate blocks entries then — but see Finding 2 for early-close days where the gate stays open.
**Severity:** blocks/mis-tenors real trades (automation) and skews backtest tenor selection identically (backtesting.ts).
**Minimal fix:** compute DTE in NY-timezone trading days: `tradingDaysBetween(nowNy, expirationNy)` (holiday-aware weekday count — the logic already exists as `tradingWeekdaysBetween` in signal-monitor.ts:7815-7838; promote to @workspace/market-calendar) and derive the day from `America/New_York` parts, not `getUTC*`.

## Finding 2 — Options automation session gates are weekday+clock only: holiday- and early-close-blind (trading severity; report-only file)

**Sites (observed):** `artifacts/api-server/src/services/signal-options-automation.ts`
- `:16101-16110` `isRegularMarketSession` — Sat/Sun + 9:30-16:00 NY minutes; no holiday check.
- `:16112-16137` `isLiveOptionTradingSession` — same, close 16:00/16:15 (extended set :299-304); gates entry (:15134), exit enforcement (:15363, :13385), mark admission (:1928), event session admission (:869-873, :901).
- `:16139-16148` `isLiveOvernightExitWindow` — 15:45-16:00 NY weekday window, gates overnight exits (:13322).
- `:16036-16051` `latestCompletedBackfillMarketDate` + `previousBackfillWeekdayOrSame` — weekday-only.

**Contrast (observed):** the repo already has session-true helpers and uses them
elsewhere — `signal-monitor.ts:42-44` imports `isNyseFullHoliday`/`resolveUsEquityMarketStatus`;
`overnight-spot-worker.ts:23-25,228` keys its loop off `resolveUsEquityMarketStatus(now).session.key`.
The options automation lane alone re-implements sessions from weekday+minutes.

**Consequences:**
- Weekday full holidays (July 4 observed date-class, Thanksgiving, Christmas): gates report a live option session 9:30-16:00 → entry pipeline runs against a dead market (inferred; entries then depend on quote-fetch failure/`frozen`-mode blocking :295-298 to fail safe).
- Early-close days (~13:00 ET close: Jul 3, day after Thanksgiving, Christmas Eve — dates in `listNyseEarlyCloses`, lib/market-calendar/src/index.ts:438): entries considered session-valid 13:00-16:00 after the close, and the 15:45-16:00 overnight exit window **never occurs** → an overnight-strategy position that must flatten before the close is carried through the holiday gap (trading severity). Combined with Finding 1, an early-close Friday afternoon allows 0DTE selection of an already-expired contract.
**Severity:** trading (missed mandatory exits, entries into closed sessions a few days/year).
**Minimal fix:** replace the three predicates' weekday+minute checks with `resolveUsEquityMarketStatus` (RTH flag + actual close minute) from @workspace/market-calendar; derive the overnight exit window from the day's real close (close-15m → close).

## Finding 3 — Watchlist backtest warmup: "1000 bars" requested as 1000 × intervalMs of wall-clock (clean file; analytic-high severity)

**Sites (observed):** `artifacts/api-server/src/services/shadow-account.ts`
- `:12550-12562` `watchlistBacktestHydrationStart` = `window.start - WATCHLIST_BACKTEST_TIMEFRAME_MS[tf] * PYRUS_SIGNALS_SIGNAL_WARMUP_BARS`.
- `PYRUS_SIGNALS_SIGNAL_WARMUP_BARS = 1000` (`lib/pyrus-signals-core/src/index.ts:164`); `WATCHLIST_BACKTEST_OUTSIDE_RTH = false` (:153) — RTH-only bars.
- The window is a hard bound: `from: hydrationStart` flows into the store query and `getBars` (:13091-13098 caller → :12602-12624 request `from`).
- `window.start` is 09:30 NY of the from-date (`resolveWatchlistBacktestWindow` :12126-12190).

**Wrong unit:** N bars ⇒ N × interval of *continuous* wall-clock, but RTH produces
only 390 1m bars per trading day.
**Consequences (inferred from the arithmetic):**
- 1m: 1000 min ≈ 16.7 h, **less than the 17.5 h overnight gap** (16:00 → next 09:30) → the warmup window reaches back to *zero* prior-session RTH bars on any day; evaluation starts cold at the session open.
- 5m: window ≈ 3.5 calendar days ⊃ ~2-3 trading days ≈ 160-230 bars of the intended 1000.
- 1h: 1000 h ≈ 41.7 days wall-clock vs ~150 trading days (~210 calendar days) actually needed.
- The live monitor fetches warmup **by count** (`limit: PYRUS_SIGNALS_SIGNAL_WARMUP_BARS`, `signal-monitor-evaluation-worker.ts:363`), so backtested signals near session opens are computed on cold indicator state (basisLength-80 WMA etc.) and **diverge from live signals** — win-rate/expectancy stats that feed trading decisions are skewed.
**Severity:** analytic-high (mis-measures the strategy; no direct order misfire).
**Minimal fix:** compute the hydration start by stepping back N *session* bars: `rthBarsBack(timeframe, window.start, WARMUP_BARS)` (see shared-utility section), or fetch by `limit` with `from` unset like the live path.

## Finding 4 — Weekday helpers treat holidays as trading days (siblings of the fixed `tradingWeekdaysBetween` bug)

**Sites (observed):**
- `artifacts/api-server/src/services/shadow-account.ts:12036-12042` `previousWeekdayOrSame` — skips Sat/Sun only.
- `shadow-account.ts:12066` `addWeekdaysToMarketDate` — counts holidays as days (used for `past_week` = -4 weekdays).
- Both feed `resolveWatchlistBacktestWindow` (:12126-12190): "today" and range endpoints.
- `signal-options-automation.ts:16036-16051` `latestCompletedBackfillMarketDate`/`previousBackfillWeekdayOrSame` — same class (report-only file).
- `shadow-account.ts:12514-12531` `isWatchlistBacktestRegularSessionTime` — weekday+minutes, holiday-blind (a holiday-dated window already yields no bars, so this compounds rather than causes).

**Consequences (inferred):** run a watchlist backtest on/for a weekday holiday
(e.g., a Monday MLK/Juneteenth-class date): "today" resolves to the holiday →
window covers a non-trading day → every symbol exits via `no_completed_bars`
skips; `past_week` windows spanning a holiday cover fewer real trading days than
labeled. Backfill target dates can resolve to holidays (wasted no-op backfill).
**Severity:** analytic/display (empty results, mislabeled ranges); no order risk.
**Minimal fix:** `previousTradingDayOrSame`/`addTradingDays` built on the same
holiday set as `isNyseFullHoliday` (already exported by @workspace/market-calendar).

## Finding 5 — Daily-loss halt "day" = UTC calendar day (report-only; low/latent)

**Site (observed):** `signal-options-automation.ts:7687-7693` `isSameUtcDate`, used at
:7708 in `computeSignalOptionsDailyRealizedPnl` (feeds the daily-loss halt,
`dailyLossHaltEnabled` :11149-11151).
**Wrong unit:** UTC calendar day; the NY trading day rolls at 20:00 EDT / 19:00 EST.
**Consequence (inferred):** currently mostly benign because option exits are
RTH-bounded (≤16:15 ET, same UTC day year-round). Residual: exit events stamped
after 20:00 ET (maintenance/expiration exits are session-exempt, :887-891) land on
the *next* UTC day's ledger; those carry no `pnl` today, so the halt is unaffected
— but the boundary is semantically wrong and becomes real the moment any exit
path emits P&L after 20:00 ET or the session extends.
**Severity:** low/latent.
**Minimal fix:** compare `marketDateKeyFromDate(occurredAt) === marketDateKeyFromDate(now)`
(the NY-day helper already exists 20 lines away, :16096-16099).

## Finding 6 — 72 h bar-cache retention chosen "to span a weekend" does not span a holiday weekend

**Site (observed):** `artifacts/api-server/src/services/signal-monitor-local-bar-cache.ts:57`
`DEFAULT_MEMORY_RETENTION_MS = 72 * 60 * 60_000`; pruning at :708-713.
**Arithmetic:** Fri 16:00 close → Tue 09:30 open across a Monday holiday = 89.5 h > 72 h
(even a normal weekend consumes 65.5 h, leaving <7 h of prior-session depth at Monday open).
**Consequence:** the DB-augmented path is safe (`loadSignalMonitorLocalBarCache`
falls back to stored bars when memory < limit, :1348-1353 — observed). The
memory-only reader `readSignalMonitorLocalMemoryBars` (:1363-1374, used per its
comment by the signal-quality KPI preview, :1356-1362) returns zero/near-zero
prior-session bars on a Tuesday-after-holiday open (inferred) → thin KPI preview
and cold DB reads at open.
**Severity:** display/perf only.
**Minimal fix:** retain "previous N sessions" instead of fixed hours (e.g., prune
before `resolvePreviousUsEquitySessionClose` walked back N sessions), or bump the
default past 96 h.

## Finding 7 — 1h rollup scan window: "last 3 buckets ≤ 4 h" is only true intra-session

**Site (observed):** `signal-monitor-local-bar-cache.ts:64-70` —
`ROLLUP_RECENT_WINDOW_MS = TIMEFRAME_MS["1h"] * 3 + TIMEFRAME_MS["1h"]` with the
comment claiming a 4 h scan "reproduces the full-history rollup output".
**Wrong unit:** 3 hourly *buckets* equated to 3-4 h of *wall-clock*. The first
aggregate after an overnight (17.5 h) or weekend (65 h) gap has its previous 1h
buckets far outside the 4 h scan window, so the capped scan emits fewer/emptier
buckets than the full-history rollup it is asserted to match.
**Consequence (inferred, limited):** in steady state the older buckets were
already emitted while live and persist downstream; the divergence bites after a
process restart across a session gap (rollup emit missing prior-session buckets
until durable backfill catches up). Cause of any user-visible artifact
unverified — flagging as a class instance for verification, not a confirmed bug.
**Severity:** low.
**Minimal fix:** scan back to the start of the bucket that contains
`resolvePreviousUsEquitySessionClose(now)` when the recent window crosses a
session boundary.

## Finding 8 — Black-Scholes expiry instant hardcodes 20:00 UTC as the 4pm ET close

**Site (observed):** `lib/backtest-core/src/option-greek-selector.ts:253-267`
`timeToExpirationYears` builds expiration close as `Date.UTC(y, m, d, 20, 0, 0, 0)`.
**Wrong unit:** 4pm ET = 20:00 UTC only under EDT; under EST it is 21:00 UTC → the
time-to-expiry horizon is 1 h short all winter. It also counts weekend/holiday
hours as live decay time (standard calendar-time convention, but for the 0-3 DTE
contracts this selector targets, a Fri→Mon tenor is 72 h calendar vs ~6.5 h of
trading — interacting with Finding 1's calendar DTE the greeks systematically
misprice short-dated weekend-spanning candidates).
**Consequence (inferred):** greek/IV-based contract scoring skews for near-dated
options, worst on Fridays and in winter.
**Severity:** low-moderate (scoring quality, not order safety).
**Minimal fix:** derive the close instant from NY-zone conversion (the codebase
has `zonedDateTimeToUtc` in shadow-account.ts and market-calendar session times);
weekend-decay handling is a modeling choice — document it if kept.

---

## Verified NOT defective (checked, listing to prevent re-audit)

- **60s fresh-mark stop-exit rule** (`signal-options-automation.ts:849-874` + constants :286-294): fails SAFE across session gaps — an old (Friday) mark *blocks* the exit rather than firing it, and `isLiveOptionTradingSession(fallback.latestAsOf, …)` additionally requires the mark itself to be in-session. No Monday-open misfire from mark age. (Holiday-blindness of the session fn is Finding 2, but the direction here is safe.)
- **Signal-monitor lane staleness/currency** (`signal-monitor.ts:5933-6008`): quiet-market sessions clamp the stale reference to the previous market close (`quietMarketSignalMonitorCompletedBarsQueryTo` :4271-4282 via `resolveSignalMonitorPreviousMarketCloseAt`), so `timeframeMs*6` stale windows do not relabel lanes stale over weekends/holidays.
- **Backfill scheduler cadence** (`signal-monitor.ts:5158-5176, 5189-5226`): per-timeframe refresh cadence is wall-clock but the whole cycle is gated off quiet/idle sessions — no session-boundary drift consequence.
- **`signal_options_seen_signals` dedup/resume** (`signal-options-automation.ts:8910-8935`, insert :2429+): identity-keyed with row caps, no wall-clock expiry window — nothing spuriously expires or persists across weekends.
- **Overnight expectancy module** (`artifacts/backtest-worker/src/overnight-signal-expectancy.ts:2, 41-47`): already session-aware (uses `resolveNyseCalendarDay`; warmup calendar-day constants are explicitly derived from trading-day needs with holiday buffer).
- **Pine adapter gap handling** (`artifacts/pyrus/src/features/charting/pyrusSignalsPineAdapter.ts:1552-1579`, WIP/report-only): bar-time gaps are detected from the data (median interval × 2), not assumed continuous.
- **Client freshness/age display** (`artifacts/pyrus/src/features/signals/signalStateFreshness.js`, `signalsRowModel.js:378-410, 1061-1068`): pass `barsSinceSignal`/`trendAgeBars` through in bar units; no interval division client-side.
- **BacktestingPanels chunk sizing** (`artifacts/pyrus/src/features/backtesting/BacktestingPanels.tsx:555-583`): uses barsPerTradingDay + a trading→calendar 365/252 conversion deliberately; worst case is chunk over/under-fill inside a pagination loop, not data loss.
- **Bars request window validation** (`artifacts/api-server/src/routes/platform.ts:771-800`): explicitly documented and labeled "calendar days per request" — intent matches unit. Sparkline seeding (:735-750+) is bar-count based.

## Shared utility recommendation

`@workspace/market-calendar` already exports `isNyseFullHoliday`,
`listNyseEarlyCloses`, `resolveUsEquityMarketStatus`,
`resolvePreviousUsEquitySessionClose`, and internally builds per-day session
intervals (`buildSessionIntervalsNear`, lib/market-calendar/src/index.ts). Two
additions would cover nearly every finding, plus the sibling agent's site:

1. **`tradingDaysBetween(from, to)`** — promote `tradingWeekdaysBetween`
   (signal-monitor.ts:7815-7838, already holiday-aware) into market-calendar,
   plus thin derivatives `previousTradingDayOrSame(dateKey)` /
   `addTradingDays(dateKey, n)`.
   Serves: Finding 1 (trading-day DTE in automation + backtesting.ts), Finding 4
   (both weekday helpers), and the 1d branch of the latch-aging site.

2. **`rthBarsBetween(timeframe, from, to)`** and its inverse
   **`rthBarsBack(timeframe, end, count) → Date`** — count/step completed RTH
   bars using the existing session-interval machinery (respecting early closes).
   Serves: Finding 3 (warmup hydration start), the sibling's intraday
   `elapsedMs / timeframeMs` inflation site (bars elapsed across gaps), any future
   fresh-window recompute, and Findings 6/7 if retention/rollup windows move to
   "previous N sessions" semantics (via `resolvePreviousUsEquitySessionClose`).

Finding 2 needs no new utility — only adoption of `resolveUsEquityMarketStatus`
(+ early-close close-minute) in the options automation session predicates.
Finding 5 is a one-line switch to the NY market-date key. Finding 8 is a
localized zoned-time fix.

Caveat for `rthBarsBetween`: define whether extended-hours bars count per
timeframe (the signal monitor deliberately lets extended-hours bars advance
intraday ages — signal-monitor.ts:4223 comment). A `session: "rth" | "all"`
parameter keeps both semantics honest at the call site.
