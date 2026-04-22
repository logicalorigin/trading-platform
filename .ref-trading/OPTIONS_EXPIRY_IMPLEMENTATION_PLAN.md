# Options Expiry Logic — Implementation Plan

## Current State: What's Broken

The backtest engine treats DTE as a Black-Scholes input parameter but never models the actual contract lifecycle. Five specific failures:

| # | Bug | Impact | Severity |
|---|-----|--------|----------|
| 1 | **0DTE prices to $0.10** — `priceOption(S, S, 0, iv)` hits guard clause `dte<=0 → max(S-K,0) = $0` for ATM, clamps to floor | Every 0DTE trade buys at $0.10, any $0.50 move = 400% return. Optimizer always selects 0DTE. | Critical |
| 2 | **No expiration enforcement** — positions never force-close at actual expiry. Engine relies on SL/TP/zombie/time_exit to eventually close. | 3DTE option bought Friday could survive to Wednesday with no forced settlement. P&L drifts past contract death. | Critical |
| 3 | **Weekend theta ignored** — `remDte = dte - barsHeld × 5/390` only counts market-open minutes | Friday 3:55pm buy → Monday 9:30am = 0.01 DTE elapsed. Reality: 2.07 calendar days of theta burned. Friday buys appear ~60% more profitable than they are. | High |
| 4 | **Taylor P&L instead of full reprice** — `estPnl = δ·ΔS + ½γ·ΔS² + θ·Δt` breaks down for large moves and near-expiry | Near-zero DTE + $2 SPY move = P&L error of 30-50% vs full BS. Compounds with bugs #1 and #3. | High |
| 5 | **Flat IV term structure** — single `iv=0.20` for all DTEs and strikes | 0DTE ATM IV is typically 25-40%, 30DTE is 15-18%. Makes short-DTE options too cheap at entry, inflating returns. | Medium |

---

## Architecture: What Needs to Change

### Current Flow
```
Signal fires → priceOption(spot, spot, dte, 0.20) → buy at $X
Each bar     → remDte = dte - bars×5/390
             → Taylor approx: δ·move + ½γ·move² + θ·time
             → Check SL/TP/trailing/zombie/time_exit
```

### Target Flow
```
Signal fires → Compute expiryDate (entry date + dte trading days)
             → Compute fractional DTE remaining today
             → Apply IV term structure for this DTE
             → priceOption(spot, strike, fracDTE, adjustedIV) → buy at $X

Each bar     → calendarDTE = trading days to expiry + fractional session remaining
             → Full reprice: priceOption(spot, strike, calendarDTE, adjustedIV)
             → If bar.date === expiryDate && near close → force expire
             → Else check SL/TP/trailing/zombie/time_exit
```

### Functions Modified
- `priceOption()` — no change (already correct, the caller was wrong)
- `bsGreeks()` — no change
- `estPnl()` — **removed**, replaced by full BS reprice
- `runBacktest()` — **major rewrite** of entry, per-bar P&L, and exit logic
- `runOptimizer()` — sweep range adjustment for DTE

### New Functions
- `tradingDaysBetween(date1, date2)` — count weekdays between two date strings
- `addTradingDays(dateStr, n)` — add n trading days to a date, skip weekends
- `calendarDaysTo(fromDate, fromHour, fromMin, toDate, tfMin)` — fractional calendar DTE including weekends/overnight
- `ivTermStructure(baseDTE, baseIV)` — DTE-dependent IV adjustment

---

## Phase 1: Calendar Infrastructure
**Scope:** Build date math helpers. Zero behavior change — just add utility functions.

### 1A: `addTradingDays(dateStr, n)`
Given entry date "2024-03-15" (Friday) and DTE=3:
- Day 1: Monday 2024-03-18
- Day 2: Tuesday 2024-03-19
- Day 3: Wednesday 2024-03-20  ← expiry date

Edge cases:
- DTE=0 → expiry = entry date itself
- DTE=1 on Friday → expiry = Monday
- No holiday calendar (SPY options expire every weekday, holidays are just skipped in the bar data)

### 1B: `calendarDaysTo(fromDate, fromH, fromM, toDate, tfMin)`
Converts a position's remaining life into fractional calendar days for BS input.

Logic:
```
If same day:  fractionOfSessionRemaining = (16:00 - currentTime) / 6.5hrs
              return fraction / 365  ... but minimum 0.001 for numerical stability

If different days:
  todayFraction = (16:00 - currentTime) / 6.5hrs  (partial day today)
  weekendDays   = count Sat/Sun between fromDate and toDate
  calendarDays  = (toDate - fromDate) in calendar days
  return (todayFraction + calendarDays - 1) → minimum 0.001
```

Key insight: BS wants **calendar days / 365**, not trading days. A Friday-to-Monday position has 3 calendar days of theta decay even though only 2 trading sessions.

### 1C: Unit tests
Validate with known cases:
- Friday 3:55pm, DTE=0 → ~0.013 fractional days (~1 min left)
- Friday 10:00am, DTE=1 → ~3.94 calendar days (rest of Friday + Sat + Sun + Monday session)
- Monday 9:30am, DTE=5 → ~5.0 calendar days
- Wednesday 2pm, DTE=0 → ~0.31 fractional days (~2hrs left)

**Deliverable:** Three pure functions, tested, no backtest changes yet.

---

## Phase 2: Full BS Reprice + 0DTE Fix
**Scope:** Replace Taylor approximation with full Black-Scholes reprice on every bar. Fix 0DTE entry pricing.

### 2A: Fix entry pricing

Current (broken):
```js
const oP = Math.max(priceOption(bar.c, strike, dte, iv), 0.10);
```

Fixed:
```js
// Compute actual expiry date
const expiryDate = addTradingDays(bar.date, dte);

// Compute fractional calendar DTE at moment of entry
const entryCalDTE = calendarDaysTo(bar.date, bar.hour, bar.min, expiryDate, tfMin);

// Price with real remaining time
const oP = Math.max(priceOption(bar.c, strike, entryCalDTE, iv), 0.05);
```

For 0DTE at 10:00am: `entryCalDTE ≈ 0.038` (5.5hrs / 365 × 2 for calendar conversion)
→ ATM BS price ≈ $1.80-3.50 depending on IV (vs current $0.10)

For 0DTE at 3:55pm: `entryCalDTE ≈ 0.001`
→ ATM BS price ≈ $0.15-0.30 (gamma scalp territory, realistic)

### 2B: Replace per-bar Taylor with full reprice

Current (Taylor approximation):
```js
const remDte = Math.max(0.01, t.dte - t.bh * tfMin / 390);
const eg = bsGreeks(t.sp, t.k, remDte, iv, t.ic);
const ps = estPnl(eg, bar.c - t.sp, t.bh, tfMin);
const cp = Math.max(t.oe + ps, 0.01);
```

Fixed (full reprice):
```js
const remCalDTE = calendarDaysTo(bar.date, bar.hour, bar.min, t.expiryDate, tfMin);
const cp = Math.max(priceOption(bar.c, t.k, remCalDTE, iv, t.ic), 0.001);
```

This is both simpler and more accurate. The option price at any moment is just BS with current spot and remaining time. No accumulating Taylor errors.

### 2C: Store expiry metadata on position

Add to the position object created in `open.push({...})`:
```js
{
  ...existing fields,
  expiryDate: addTradingDays(bar.date, dte),   // "2024-03-20"
  entryCalDTE: entryCalDTE,                      // for logging
}
```

### 2D: Remove `estPnl` function
Delete it entirely. All callers now use full BS reprice.

**Deliverable:** Accurate option pricing at entry and on every bar. 0DTE no longer produces garbage. Weekend theta decay fully captured. `estPnl` removed.

---

## Phase 3: Expiration Enforcement
**Scope:** Force-close positions at session end on their expiry date. Add "expired" exit reason.

### 3A: Expiration check in the per-bar loop

Insert before the existing exit checks:
```js
// Force expire if we're on or past expiry date
if (bar.date >= t.expiryDate) {
  if (bar.date > t.expiryDate) {
    // Past expiry — should never happen, but safety net
    ex = "expired";
  } else if (bar.hour >= 20 && bar.min >= 50) {
    // On expiry date, near close — settle at intrinsic
    ex = "expired";
  } else if (remCalDTE <= 0.0005) {
    // Less than ~3 minutes of time value left
    ex = "expired";
  }
}
```

### 3B: Expired settlement pricing

When exit reason is "expired", the option settles at **intrinsic value only** (no time premium):
```js
if (ex === "expired") {
  t.ep = Math.max(t.ic ? bar.c - t.k : t.k - bar.c, 0);
  // If OTM at expiry → worthless → ep = 0
}
```

This correctly models:
- ITM at expiry → exercise value minus slippage
- OTM at expiry → total loss of premium paid
- Deep OTM → max loss = premium (already capped)

### 3C: Exit priority ordering

The full exit check sequence becomes:
1. **Expired** — hard deadline, overrides everything
2. **Stop loss** — risk management
3. **Take profit** — target hit
4. **Trailing stop** — profit protection
5. **Zombie kill** — stale position cleanup
6. **Time exit** — end of session (for positions not expiring today)

### 3D: End-of-backtest cleanup

Current code force-closes all remaining positions at a flat 95% of entry. Change to:
```js
for (const t of [...open]) {
  const remCalDTE = calendarDaysTo(lastBar.date, lastBar.hour, lastBar.min, t.expiryDate, tfMin);
  const epRaw = remCalDTE > 0.5
    ? priceOption(lastBar.c, t.k, remCalDTE, iv, t.ic)  // still has time value
    : Math.max(t.ic ? lastBar.c - t.k : t.k - lastBar.c, 0);  // near expiry → intrinsic
  ...
}
```

### 3E: Add "expired" to UI

- Add to exit breakdown analytics (already dynamic from `t.er`)
- Add to trade log color coding: expired → gray/neutral
- Add expiry date column to trade log table

**Deliverable:** No position survives past its expiry. OTM options expire worthless. 0DTE positions die at 4pm same day.

---

## Phase 4: IV Term Structure
**Scope:** DTE-dependent implied volatility. Short-dated options get higher IV.

### 4A: `ivForDTE(baseIV, calendarDTE)` function

Empirical SPY term structure (simplified):
```
DTE    IV Multiplier    Typical SPY IV (if base=18%)
0      2.00             36%     ← intraday gamma, very high
1      1.50             27%
2-3    1.30             23%
5      1.15             21%
7      1.08             19%
14     1.00             18%     ← base
21     0.97             17%
30     0.95             17%
```

Implementation:
```js
function ivForDTE(baseIV, calDTE) {
  if (calDTE <= 0.1) return baseIV * 2.0;     // 0DTE
  if (calDTE <= 1.5) return baseIV * 1.5;     // 1DTE
  if (calDTE <= 3.5) return baseIV * 1.3;     // 2-3DTE
  if (calDTE <= 6)   return baseIV * 1.15;    // 5DTE
  if (calDTE <= 10)  return baseIV * 1.08;    // 7DTE
  if (calDTE <= 16)  return baseIV * 1.0;     // 14DTE (base)
  if (calDTE <= 25)  return baseIV * 0.97;    // 21DTE
  return baseIV * 0.95;                        // 30DTE
}
```

### 4B: Apply at entry and per-bar

Entry:
```js
const adjIV = ivForDTE(iv, entryCalDTE);
const oP = priceOption(bar.c, strike, entryCalDTE, adjIV, isCall);
```

Per-bar reprice:
```js
const adjIV = ivForDTE(iv, remCalDTE);
const cp = priceOption(bar.c, t.k, remCalDTE, adjIV, t.ic);
```

### 4C: Impact analysis

This changes the economics significantly:
- **0DTE becomes expensive to buy** ($2-4 instead of $0.10) — correct
- **Short DTE theta decay accelerates** — correct, real behavior
- **Optimizer will shift toward 3-7 DTE sweet spot** — expected, this is where most retail edge exists
- **Gamma is properly amplified for 0DTE** — large moves pay more, but entry cost is higher

### 4D: Optional VIX-linked IV

If `regimeAdapt` is on, scale base IV from the regime's VIX:
```js
const vixIV = reg.vix / 100;  // VIX 20 → base IV 0.20
const adjIV = ivForDTE(vixIV, remCalDTE);
```

This replaces the hardcoded `iv=0.20` with market-implied volatility per day.

**Deliverable:** Realistic option pricing across the DTE spectrum. Short-dated options properly expensive. Optimizer results reflect real-world cost structure.

---

## Phase 5: Slippage & Spread Refinement
**Scope:** More realistic execution modeling for different DTEs.

### 5A: DTE-aware spread model

Current:
```js
const slipFrac = (slipBps / 10000) * Math.sqrt(5 / Math.max(dte + 1, 1));
```

Improved:
```js
function spreadModel(calDTE, premium, timeOfDay) {
  // Base spread as % of premium
  let spreadPct = 0.02;  // 2% of premium = typical tight market

  // Short DTE = wider spreads (less liquidity, faster decay)
  if (calDTE < 0.1) spreadPct = 0.08;       // 0DTE: 8% spread
  else if (calDTE < 1.5) spreadPct = 0.05;  // 1DTE: 5%
  else if (calDTE < 5) spreadPct = 0.03;    // 2-5DTE: 3%

  // Near close = wider (market makers pull back)
  if (timeOfDay > 15.5) spreadPct *= 1.3;   // after 3:30pm
  if (timeOfDay < 9.75) spreadPct *= 1.2;   // first 15 min

  // Penny pilot minimum: SPY options have $0.01 min tick
  const halfSpread = Math.max(premium * spreadPct / 2, 0.01);
  return halfSpread;
}
```

### 5B: Apply to entry and exit

Entry (pay the ask):
```js
const halfSpread = spreadModel(entryCalDTE, oP, bar.hour + bar.min/60);
const oFill = oP + halfSpread;
```

Exit (sell the bid):
```js
const halfSpread = spreadModel(remCalDTE, cp, bar.hour + bar.min/60);
const epFill = cp - halfSpread;
```

**Deliverable:** Execution costs reflect reality. 0DTE scalping properly penalized for wide spreads.

---

## Phase 6: Verification & UI
**Scope:** Validate the changes, update displays.

### 6A: Trade log enhancements

Add columns:
- **Expiry** — the contract's expiration date
- **Entry IV** — the DTE-adjusted IV used at entry
- **Settle** — intrinsic value at exit (for expired positions)

### 6B: Optimizer validation

- Run optimizer before/after comparison
- Verify 0DTE no longer dominates rankings
- Verify 3-7 DTE range produces realistic returns (10-40% annually, not 400%)
- Check that "expired" exit reason appears appropriately

### 6C: Analytics tab updates

- Exit breakdown should include "expired" bucket
- P&L by DTE chart — show which DTEs are actually profitable
- Weekend-entry flag — mark Friday afternoon entries for analysis

### 6D: Sanity checks embedded in engine

```js
// After each trade closes, validate:
assert(t.expiryDate >= t.ts.split(" ")[0]);  // expiry not before entry
assert(t.et.split(" ")[0] <= t.expiryDate);  // exit not after expiry
if (t.er === "expired") assert(t.et.split(" ")[0] === t.expiryDate);
```

---

## Execution Order & Dependencies

```
Phase 1 ─── Calendar Infrastructure (foundation)
  │
  ├──→ Phase 2 ─── Full BS Reprice + 0DTE Fix
  │       │
  │       └──→ Phase 3 ─── Expiration Enforcement
  │               │
  └───────────────┼──→ Phase 4 ─── IV Term Structure
                  │
                  └──→ Phase 5 ─── Slippage Refinement
                          │
                          └──→ Phase 6 ─── Verification & UI
```

Phases 1→2→3 are sequential (each depends on the prior).
Phase 4 and 5 can run in parallel after Phase 2.
Phase 6 comes last as integration testing.

## Estimated Complexity

| Phase | Lines Changed | New Functions | Risk |
|-------|--------------|---------------|------|
| 1 | ~30 new | 3 helpers | Low — pure math, no side effects |
| 2 | ~40 modified | 0 (replace estPnl) | Medium — changes P&L for every trade |
| 3 | ~25 modified | 0 | Medium — new exit path, edge cases |
| 4 | ~20 new + 10 modified | 1 (ivForDTE) | Low — multiplier on existing IV |
| 5 | ~15 modified | 1 (spreadModel) | Low — improves existing slippage |
| 6 | ~40 modified | 0 | Low — display only |

**Total: ~180 lines changed/added across 6 phases.**

## Expected Outcome Shifts

After all phases, expect these changes in optimizer results:
- **0DTE**: Goes from #1 ranked to middle-of-pack. Still viable for gamma scalps but properly costed.
- **1-3 DTE**: Likely emerges as optimal for intraday momentum strategies. Good gamma exposure, manageable theta.
- **5-7 DTE**: Sweet spot for swing strategies (EMA stack, momentum). Time to be right without excessive decay.
- **14-30 DTE**: Lower gamma, lower theta burn. Works for patient setups but returns compress.
- **Overall ROI**: Drops significantly (from fantasy to realistic). A good system should show 15-50% annual, not 200%+.
- **Win rates**: May actually *increase* slightly because entries are no longer garbage-priced.
