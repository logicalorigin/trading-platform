# Signal AGE computation audit — 2026-07-07

Read-only investigation of why the SMR 15m signal shows ~500 "bars" old. All line numbers refer to
the **current working tree** (note: `signal-monitor.ts` carries ~541 lines of uncommitted WIP, see
§9). DB access was SELECT-only via `$DATABASE_URL`.

## 1. Verdict (executive summary)

Two independent mechanisms stack; **both are confirmed**:

- **(A) Wall-clock inflation [observed]** — for every intraday timeframe, stored
  `bars_since_signal` is `max(presentBars, round((latestBarAt − signalAt) / timeframeMs))`
  (`artifacts/api-server/src/services/signal-monitor.ts:7845-7874`). Nights, weekends, and
  holidays are divided by the bar interval and reported as "bars". 99.5–99.9% of all 15,209
  intraday state rows equal the wall-clock division **exactly** (§7). SMR 15m shadow row:
  stored **506** = exactly (2026-07-07T22:45Z − 2026-07-02T16:15Z) = 7,590 min ÷ 15. The honest
  RTH bar count for that same span is **~67** (15 bars rest-of-day Jul 2 + 0 on Jul 3 NYSE
  holiday + 26 Jul 6 + 26 Jul 7).
- **(B) The ~506 row is anchored to a superseded crossover [observed]** — the row the user saw is
  the **shadow** profile (`a5721cf5…`, env `shadow`, fresh_window 8) still latched to the
  2026-07-02T16:15Z sell. The **live** profile (`bd3674f7…`, env `live`, fresh_window 3) holds a
  newer 15m sell at **2026-07-06T17:30Z** (stored 117 wall-clock; honest RTH ≈ **36 bars** — this
  matches the chart TH:9 indicator's "~30–40 real bars" sell). Why shadow didn't flip on Jul 6 is
  **inferred, cause unverified**: the two profiles run different `pyrus_signals_settings` (shadow
  has a full custom settings object — basisLength 80 bands, waitForBarClose, etc.; live has only
  universe-scope defaults), so a genuinely different crossover set is plausible; evaluation-window
  starvation is the alternative. Check in §10.4.

So the user's "~500 vs ~35" discrepancy = (A) ~7.6× wall-clock inflation on top of (B) an anchor
that is one crossover older than the live/chart one.

## 2. Live DB evidence for SMR (observed)

`signal_monitor_symbol_states` for SMR (query in §10.1):

| profile | env | tf | current_signal_at | latest_bar_at | stored bars | wall-clock ÷ tf | honest RTH bars |
|---|---|---|---|---|---|---|---|
| a5721cf5 | shadow | 15m | 2026-07-02T16:15Z | 2026-07-07T22:45Z | **506** | **506 (exact)** | ~67 |
| bd3674f7 | live | 15m | 2026-07-06T17:30Z | 2026-07-07T22:45Z | **117** | **117 (exact)** | ~36 |
| a5721cf5 | shadow | 1h | 2026-06-25T13:00Z | 2026-07-07T21:00Z | 296 | 296 (exact) | ~55 |
| a5721cf5 | shadow | 1d | 2026-04-16 | 2026-07-06 | 57 | (weekday path) | 57 ✓ honest |

- Honest RTH math (26×15m bars/day, NYSE calendar; 2026-07-03 = observed July-4 holiday, closed):
  shadow = 15 (Jul 2, 12:15→16:00 ET) + 26 + 26 = 67; live = 10 (Jul 6, 13:30→16:00 ET) + 26 = 36.
- The 1d rows do NOT show the defect — the 1d branch counts trading weekdays
  (`signal-monitor.ts:7852-7864`, using `tradingWeekdaysBetween` at 7815 with today's
  `isNyseFullHoliday` fix at 7832).
- `signal_monitor_events` confirms the anchors are real: shadow's only SMR 15m event is
  `sell @ 2026-07-02T16:15Z` (source `state-anchor-backfill`, created 2026-07-07T15:46Z). Notably
  the live profile's 07-06T17:30Z 15m signal has **no event row at all** (no `pyrus-signals` 15m
  emission for SMR) — the state row is the only record of it [observed; separate smell].
- Both SMR 15m rows have `status='ok'`, `last_evaluated_at=2026-07-07T23:00:06Z` — the shadow row
  is being re-evaluated continuously and still keeps the 07-02 anchor (the latch/merge path
  refreshes bar metadata without a new crossover).

## 3. Root cause code — the wall-clock division (mechanism A)

`artifacts/api-server/src/services/signal-monitor.ts:7845-7874` — `signalMonitorBarsSinceSignal`:

- 1d: `max(presentBars, tradingWeekdaysBetween(signalAt, latestBarAt))` (7852-7864) — honest.
- **Intraday: `max(presentBars, Math.round(elapsedMs / timeframeMs))` (7866-7873) — wall-clock.**

The comment above it (7840-7844) says intraday takes "the larger of the present-bar distance and
the wall-clock interval distance, so a stale signal can never read fresher than it actually is
(the safe direction for freshness/eligibility)". That is a deliberate *gate* conservatism — but
the same number is persisted to `bars_since_signal` and presented as literal "bars" everywhere
(§5), and it never decreases (both inputs are monotone), so there is **no morning reset**.

Three different "bar clocks" exist and are conflated:
1. wall-clock ÷ interval (what's stored — counts 24/7),
2. series-present bars (`chartBars.length - 1 - barIndex` — includes extended-hours aggregates),
3. RTH chart bars (what the user's TH:9 chart shows).

## 4. Producer inventory — every path that writes barsSinceSignal (observed)

All paths funnel through the same two functions, so the wall-clock behavior is universal:

| Producer | Site | Behavior per timeframe |
|---|---|---|
| Per-symbol completed-bars eval | `evaluateSignalMonitorSymbolFromCompletedBars` (signal-monitor.ts:7521), presentBars 7625-7628, calls `signalMonitorBarsSinceSignal` at 7637 | 1d honest weekdays; intraday wall-clock max |
| Matrix completed-bars eval | `evaluateSignalMonitorMatrixStateFromCompletedBars` (8171), presentBars 8288-8291, call at 8301 | same |
| Python-state merge | `signalMonitorMatrixStateFromPython` (8520), elapsed at 8612, then `max(elapsed, pythonBarsSinceSignal)` at 8618-8622 | wall-clock still wins even if Python supplies an honest count |
| DB latch (direction preserved on no-crossover re-eval) | `applyStoredSignalDirectionLatch` (6471) → `resolveLatchedSignalBarsSinceSignal` (6447-6469, call at 6530) | re-derives from stored signalAt + new latestBarAt → wall-clock |
| DB merge (fresher bar metadata onto preserved signal row) | `mergeFreshBarMetadataOntoPreservedSignalRow` (6574, call at 6592) | same — recomputed every advancing bar, keeps rows pinned at wall-clock |
| Stream-side latch (SSE wire) | `latchSignalMonitorMatrixStreamState` (9539, call at 9587) | same |
| REST passthrough | `stateToResponse` (1252, 1286) / stale rows (1351-1358) | serves stored value verbatim |

`resolveLatchedSignalBarsSinceSignal` is the reason §7 shows ~99.7% exact equality: even rows
originally written with a present-bar count get re-maxed against wall-clock on every merge cycle.

## 5. Blast radius — everything consuming the inflated number

### 5.1 Display (lies to the user)
- `artifacts/pyrus/src/features/signals/signalsRowModel.js:378-411` — `displayAgeBars` falls back
  to `signalAgeBars` with `displayAgeSource: "signal-bars"` (388-389, 404-409); primary-row
  `displayBarsSinceSignal` at 1061-1068.
- `artifacts/pyrus/src/screens/SignalsScreen.jsx:443-447` (`formatBars`/`formatCompactBars`),
  rendered at 1798, 1894, 2815, 3293 ("Bars" fact), 4325-4326 + 4371 (age column,
  `signal-bars` fallback marker). `intervalAge` (1779-1781) is a wall-clock relative *time* label
  — honest as a duration, so the row simultaneously shows an honest time and a lying bar count.
- `PlatformAlgoMonitorSidebar.jsx:373,725`, `OperationsSignalRow.jsx:1177`,
  `OperationsSignalTable.jsx:1036-1037` (sort by inflated bars), `PositionsPanel.jsx:1193-1195`
  ("N bars since signal" chip).

### 5.2 Fresh recompute (bar-window semantics from 3e6e000b, today)
`signalMonitorResponseFresh` (signal-monitor.ts:1205-1217) and the stream variant (~9508-9530)
compute display-`fresh` as `barsSinceSignal <= freshWindowBars` via `signalMonitorFresh`
(`signal-monitor-actionability.ts:42-53`). With wall-clock bars, a 15m signal exits the 8-bar
fresh window after 2 **hours** of wall time — every intraday signal reads not-fresh at the next
open even when honestly 0-2 bars old. Frontend `fresh` chips/counters
(`signalStateFreshness.js:58`, `signalsRowModel.js:353-354,641,886,1108,1162,1569`) inherit this.

### 5.3 Action-age gate — the morning-after blocker (the important one)
- Gate: `SIGNAL_MONITOR_MAX_ACTIONABLE_BARS_SINCE_SIGNAL = 8`
  (`signal-monitor-actionability.ts:17`), `signalMonitorSignalAgeBlocker` (32-40) →
  `"signal_too_old"`, wired in `buildSignalMonitorActionability` (54-80).
- `marketClosed` outranks age (66-74) but only during quiet/idle sessions:
  `SIGNAL_MONITOR_MARKET_IDLE_SESSION_KEYS = {overnight, pre, after}` (signal-monitor.ts:4138-4142),
  quiet = closed/holiday (4202). **At 09:30 ET the session key is regular → `marketClosed=false` →
  the age blocker applies.**
- **Verified-by-code-inspection (not yet runtime-observed at an open):** barsSinceSignal is
  monotone (max of two non-decreasing quantities, re-computed on every latch/merge —
  6530/6592/9587) and has **no session-aware reset**. A 15m signal fired at 15:45 ET reads ~71
  "bars" at the next 09:30 open (17.75h ÷ 15m) when it is honestly ~2 RTH bars old. Result: every
  intraday signal from the prior session is `signal_too_old` at the next open and stays blocked
  forever. The first ~2 RTH hours of each session (the honest 8-bar window for late-prior-session
  15m signals) are wrongly blocked; for the live profile (fresh_window 3) the honest window is
  even narrower. **The morning re-evaluation does NOT reset it.** Today's market-closed-label fix
  masks this after the close but does nothing at the open.
- Automation consumes the same gate: `signal-options-automation.ts:2528-2552`
  (`signalOptionsSignalAgeBlocker`, `isSignalOptionsWithinExecutionWindow`) and
  `buildSignalOptionsSignalSnapshot` → `buildSignalMonitorActionability` (2576-2583). So real
  trades at the open are blocked by the inflated count.

### 5.4 Not (directly) affected
- **Breadth**: `recordSignalMonitorBreadthSnapshot` (signal-monitor.ts:2649-2700) counts
  buy/sell direction only — no barsSinceSignal input [observed]. Frontend `freshCount` breadth
  chips ARE affected via §5.2.
- **Seen-signals / backfill**: `signal_options_seen_signals` rows are keyed by `signalKey` built
  from `signalAt` (signal-options-automation.ts:2436-2461, 2700), and the event-anchor backfill
  (signal-monitor.ts:1642-1661, 2342) is signalAt-keyed — neither windows on barsSinceSignal
  [observed]. But the snapshot rows persist the inflated `barsSinceSignal` + blocked
  actionability, so audit trails record the lie.

## 6. Mechanism B detail — the shadow row's stale anchor

- Shadow profile (a5721cf5, env=shadow) 15m: anchored sell 2026-07-02T16:15Z; live profile
  (bd3674f7) flipped to a new sell 2026-07-06T17:30Z. Both rows status ok, re-evaluated at
  23:00:06Z [observed].
- The latch design (`applyStoredSignalDirectionLatch`, 6471-6540) only replaces the anchor when an
  evaluation *detects* a signal; otherwise it refreshes bar metadata and re-ages. So shadow's
  evaluations since Jul 6 detected no 15m crossover.
- Why: **inferred, cause unverified.** Candidates: (i) different indicator settings — shadow
  carries a full custom `pyrus_signals_settings` object while live uses defaults [observed], so
  differing crossovers are legitimate; (ii) evaluation lookback window no longer contains the
  Jul 6 crossover bar and never saw it live (starvation). Distinguishing check in §10.4.
- Which row the UI shows depends on the selected environment; the user's ~500 matches the shadow
  row's 506 [observed].

## 7. Sizing the lie (observed; survey query in §10.3)

All intraday state rows with a signal (`timeframe <> '1d'`, non-null signal/latest/bars):

| tf | rows | stored == wall-clock division (exact) | stored > wall | avg stored | avg honest (approx) |
|---|---|---|---|---|---|
| 1m | 3,268 | 99.9% | 4 | 2,221 | ~430 |
| 2m | 2,826 | 99.9% | 4 | 875 | ~169 |
| 5m | 2,636 | 99.8% | 6 | 704 | ~136 |
| 15m | 4,170 | 99.7% | 12 | 321 | ~62 |
| 1h | 2,309 | 99.5% | 9 | 236 | ~46 |

15,209 rows; **100% exceed a plausible RTH count by >2×** (crude honest ≈ wall × 6.5/24 × 5/7);
average inflation ≈ **5×** (≈7.6× across a holiday weekend like SMR's). The handful of `stored >
wall` rows are presentBars-floor cases. The lie is universal, not an edge case.

## 8. Root cause statement + ranked minimal fixes

**Root cause:** `signalMonitorBarsSinceSignal`'s intraday branch divides wall-clock elapsed time
by the bar interval (signal-monitor.ts:7866-7873). That number — a deliberately conservative
freshness heuristic — is persisted as `bars_since_signal`, re-imposed on every latch/merge cycle
(6447-6469), displayed as literal "bars", used for the display-fresh window, and used by the
8-bar action gate, so overnight/weekend gaps inflate intraday ages ~5× and permanently block
prior-session signals at the next open.

**Fix 1 (recommended): session-aware intraday bar counter at the single choke point.**
Add a counter that counts market-session bars between `signalAt` and `latestBarAt` (the intraday
analogue of `tradingWeekdaysBetween`, sharing the NYSE calendar / `isNyseFullHoliday` — the 1d
holiday fix landed today at 7832 proves the calendar plumbing exists), and use it in the intraday
branch of `signalMonitorBarsSinceSignal`, keeping `max(presentBars, sessionBars)` so the "never
fresher than actual" invariant is preserved (presentBars stays the floor). Because every producer
and the latch path funnel through this one function (§4), one change fixes storage, display,
fresh, and the gate; stored rows self-heal on the next merge cycle (they are re-maxed every
advancing bar). **Decisions needed:** (a) whether "session bars" includes extended hours — the
aggregates feed emits extended-hours bars (latestBarAt=22:45Z observed; comment at 4223-4225), so
counting RTH-only while latestBarAt sits in extended hours needs a clamp, and RTH-only matches the
user's chart; (b) product call: the wall-clock gate arguably "protected" against acting on
overnight-gapped signals — if that protection is wanted, gate on price drift or same-session
explicitly, not on a false bar count.

**Fix 2 (smaller, display-only): honest display field, keep conservative gate.**
Persist/serve a second field (e.g. `displaySessionBarsSinceSignal`) or convert age columns to
trading-time durations, leaving the gate on wall-clock. Pro: zero trading-behavior change. Con:
does NOT fix the morning-after blocking (§5.3), which directly costs real trades at the open —
insufficient alone.

**Fix 3 (gate-side band-aid): pause aging during non-trading time for the gate only** (subtract
quiet/idle elapsed before dividing). Functionally converges on Fix 1's gate half with more
special-casing; only worth it if display semantics must stay frozen.

Mechanism B is a separate follow-up: verify shadow-vs-live crossover divergence (§10.4) and why
the live profile's Jul 6 15m signal has no event row.

## 9. Workstream/WIP notes (observed via `git status` / `git diff --stat`)

- `artifacts/api-server/src/services/signal-monitor.ts` — **uncommitted WIP, +541/−95** (includes
  today's `tradingWeekdaysBetween` holiday fix). All line numbers above are working-tree.
- `artifacts/api-server/src/services/signal-options-automation.ts` — **uncommitted WIP, +49** (the
  other workstream). Fix 1 does not need to touch it (it consumes the shared gate).
- `signal-monitor-actionability.ts`, `signalsRowModel.js`, `signalStateFreshness.js`,
  `SignalsScreen.jsx` — clean of age-related WIP per git status (SignalsScreen has a 1-line change
  from committed 3e6e000b).

## 10. Re-verification commands (read-only)

### 10.1 SMR rows + events
```bash
cd /home/runner/workspace/lib/db && node -e '
const { Client } = require("pg");
(async () => { const c = new Client({ connectionString: process.env.DATABASE_URL }); await c.connect();
  console.log((await c.query("SELECT profile_id, timeframe, current_signal_at, latest_bar_at, bars_since_signal, fresh, status FROM signal_monitor_symbol_states WHERE symbol='"'"'SMR'"'"' ORDER BY timeframe, profile_id")).rows);
  console.log((await c.query("SELECT profile_id, timeframe, direction, signal_at, source FROM signal_monitor_events WHERE symbol='"'"'SMR'"'"' ORDER BY signal_at DESC LIMIT 15")).rows);
  console.log((await c.query("SELECT id, environment, fresh_window_bars FROM signal_monitor_profiles")).rows);
  await c.end(); })().catch(e => { console.error(e.message); process.exit(1); });'
```
Expect: shadow 15m row bars=506-ish with signal_at 2026-07-02T16:15Z; live 15m signal_at
2026-07-06T17:30Z. (Values grow ~4/hour while extended bars advance.)

### 10.2 Wall-clock arithmetic check
506 == round((Date('2026-07-07T22:45Z') − Date('2026-07-02T16:15Z')) / 900000). Honest RTH: 26
bars/day, Jul 3 2026 = NYSE holiday (Jul 4 observed) → 15+26+26 = 67.

### 10.3 Inflation survey
```bash
cd /home/runner/workspace/lib/db && node -e '
const { Client } = require("pg");
const TF={"1m":6e4,"2m":12e4,"5m":3e5,"15m":9e5,"1h":36e5};
(async()=>{const c=new Client({connectionString:process.env.DATABASE_URL});await c.connect();
const r=await c.query("SELECT timeframe,current_signal_at,latest_bar_at,bars_since_signal FROM signal_monitor_symbol_states WHERE bars_since_signal IS NOT NULL AND current_signal_at IS NOT NULL AND latest_bar_at IS NOT NULL AND timeframe<>'"'"'1d'"'"'");
const b={};for(const row of r.rows){const t=TF[row.timeframe];if(!t)continue;
const w=Math.round((new Date(row.latest_bar_at)-new Date(row.current_signal_at))/t);
const s=b[row.timeframe]=b[row.timeframe]||{n:0,exact:0};s.n++;if(row.bars_since_signal===w)s.exact++;}
console.log(b);await c.end();})().catch(e=>{console.error(e.message);process.exit(1);});'
```
Expect ≥99% `exact` per timeframe.

### 10.4 Mechanism-B distinguishing check (not yet run)
Replay the pyrus-signals indicator over SMR 15m completed bars (Jul 2 → Jul 7) twice — once with
the live profile's default settings, once with shadow's `pyrus_signals_settings` — and compare
detected crossovers. If both detect the Jul 6 17:30Z sell, shadow's eval window/starvation is the
cause; if only live detects it, the settings difference is legitimate.

### 10.5 Code sites
```bash
sed -n '7840,7875p' /home/runner/workspace/artifacts/api-server/src/services/signal-monitor.ts   # wall-clock branch
sed -n '6447,6470p' /home/runner/workspace/artifacts/api-server/src/services/signal-monitor.ts   # latch re-aging
sed -n '4138,4142p' /home/runner/workspace/artifacts/api-server/src/services/signal-monitor.ts   # idle keys (no "regular")
sed -n '17,80p'   /home/runner/workspace/artifacts/api-server/src/services/signal-monitor-actionability.ts
```
