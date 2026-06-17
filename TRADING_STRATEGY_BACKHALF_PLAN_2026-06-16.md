# Trading Strategy — Back-Half Audit & Implementation Plan

- **Created:** 2026-06-16 (MT)
- **Status:** WORKING reference for gap-finding and sequencing. Does **not** supersede `TRADING_STRATEGY.md` until the strategy is complete.
- **Scope:** The "back half" = what happens once a signal is in the matrix/STA table → filter → trade → manage → exit. Front-half signal generation is out of scope. The deployment/algo controls are essentially a **filter** on the shared signal feed.

> **How to read status:** ✅ landed & working · 🟡 partial / landed-but-unproven · ❌ missing · 🔴 correctness risk

---

## 0. The strategy in one paragraph

Multi-timeframe market-structure breakout, expressed through short-dated options. We take a buy/sell signal already in the matrix, confirm it across timeframes, and (buy→call / sell→put, long only) express it with 1–3 DTE options. A deployment is a **filter** over the shared, deployment-independent signal feed; if a fresh signal clears the gates we pick a contract, size it to a premium budget, and manage it with a hard stop + trailing/structure stops until exit. **Today this runs entirely in shadow (paper)** — even a "live" deployment records to the shadow ledger and sends nothing to the broker.

---

## 1. Stage-by-stage status

| # | Stage | Status | Evidence |
|---|-------|--------|----------|
| 1 | Actionability gate (≤1 bar old, not stale, clear buy/sell) | ✅ | `signal-monitor-actionability.ts:8` |
| 2 | Deployment match / filter (symbol universe, buy→call/sell→put, long-only) | ✅ | `signal-options-automation.ts:933, :10678` |
| 3 | Gateway gate (broker ready + RTH-only execution) | ✅ | `algo-gateway.ts:5-157` |
| 4 | Entry-policy gate (MTF align ≥2, bearish-regime ADX, inverse-put blocklist) | ✅ | `evaluateSignalOptionsEntryGate:4247` |
| 5 | Expiration + strike selection (1–3 DTE; greek selector toward ~0.45Δ, slot fallback) | ✅ | `option-greek-selector.ts:317` |
| 6 | Liquidity gate (spread ≤35% of mid, fresh quote, min bid) | ✅ | `resolveSignalOptionsLiquidity:3864` |
| 7 | Sizing + order plan (premium budget ÷ cost, capped) | ✅ | `buildSignalOptionsShadowOrderPlan:3941` |
| 8 | **Execution** | 🟡 shadow-only | `:357-359, :2296-2298`; events `signal_options_shadow_*` |
| 9 | Position marking (5s scan + on-quote tick; greeks now sourced) | ✅ | `requiresGreeks ?? true` `:11508` |
| 10 | Exit policy (hard stop, trail, wire-greek structure trail, early-invalidation) | ✅ | `signal-options-exit-policy.ts` (`wire_structure_break:480`) |
| 11 | **Exit *enforcement*** (does the stop actually fire?) | 🟡🔴 | fixed 06-12; one failure mode throttled-not-eliminated |
| 12 | **Partial scale-outs** | ❌ | no `exitQuantity`; all exits are full closes |

**Bottom line:** the *policy* layer is largely built (ahead of `TRADING_STRATEGY.md`). Risk has moved **down** the stack (does the stop fire? do we capture runners?) and **up** the stack (is the greek edge proven?).

---

## 2. Headline findings

1. **Signal→options is shadow-only.** `executionMode:"shadow"`, `brokerSubmission:false` effectively hardcoded; live submit path (`tws-provider.ts:6283`) is wired only to overnight-spot.
2. **Signals are now one shared feed**, decoupled from account/deployment mode (`resolveSignalSourceEnvironment()`).
3. **The money is in exits, not selection.** Backtest management review: ~$151k realized vs ~$1.0M left on the table (≈6.4×), overwhelmingly from exiting winners too early.
4. **Greeks were never fairly tested.** Greek exits never ran (env blocker); greek selection ran on low-fidelity reconstructed greeks (~95% candidates skipped). The "greeks underperformed" result is **contaminated, not a verdict.** Real historical greeks exist (`gex_snapshots`) but are unwired from the backtest.

---

## 3. Backtest evidence (what prior work actually showed)

### 3a. Exit-policy sweeps — the validated winner (fixed, non-greek)
`hard stop −30%, trail arms +35% / locked 15% / giveback 20%, early-invalidation 6 bars @ −20%, overnight min-gain 10%`. ~$22–25k P&L, ~65% win, ~3.3 profit factor, tiny drawdown over 14 trading days / 90 symbols. (≈ today's tuned profile.) Source: `scripts/reports/signal-options-exit-policy-sweeps/full-universe-selected-rules-14-trading-days-2026-05-04-through-2026-05-21/`.

### 3b. Management review — where the money leaks (June 11 report, 2026-04-01→05-21)
Realized **$150,959** vs post-exit-high opportunity **$996,747** (**6.6×**). Leak by exit reason:

| Exit reason | Realized | Opportunity left | Read |
|---|---|---|---|
| `runner_trail_stop` | $91,095 | **$485,331** | trailing out of winners too early (biggest leak) |
| `opposite_signal` | $50,488 | **$255,874** | panic-exit on one opposing bar |
| `overnight_risk_exit` | $397 | **$133,404** | force-dumping good runners (336× waste ratio) |
| `early_invalidation` | −$10,677 | $53,290 | ~49% re-validated after exit |
| `hard_stop` | −$6,998 | $32,883 | over-sensitive on whipsaws |
| `expiration` | $26,416 | $32,595 | healthiest (forced; keep) |

Estimated recovery from management fixes alone: **$300–520k**, no greeks required. Source: `scripts/reports/shadow-options-management-review/2026-06-11T00-33-12-323Z/`.

### 3c. Greek tests — contaminated / never ran
- **Greek exits:** every wire/greek-trail variant `status=failed` — "Signal Options backfill requires explicit Signal Monitor bar-evaluation opt-in." Root cause: the sweep generator never set `PYRUS_SIGNAL_MONITOR_BAR_EVALUATION_ENABLED`; the backfill 503s at `signal-options-automation.ts:15997`. Source: `scripts/reports/signal-options-exit-policy-sweeps/tiebreaker-fresh-2026-05-22-through-2026-06-09/`.
- **Greek selection:** lost on 3 of 4 days (−$320 / −$1,193 / −$430 / +$158) **but** greeks were Black-Scholes reconstructions from entry price (`:14536`), only ~3–5% of candidates scored, `gex_snapshots` never read. Source: `scripts/reports/signal-options-greek-selector-smoke/`.
- **Greek positions:** 0 active positions to validate on 06-11.

---

## 4. Multi-strategy coexistence design (decided)

Users can deploy multiple strategies at once — **isolated, but respecting one another.**

- **Isolation** (mostly free after splitting deployments): per-`deployment_id` event streams, separate worker fleets/locks, positions keyed by deployment+symbol. Remaining: a "strategies reconstruct independently" regression test.
- **Respect / coordination** (missing today — all caps are per-deployment):
  - **Capital → priority tiers.** Higher-ranked strategy gets account budget first; per-deployment caps still apply underneath. (Building block: `account-portfolio-risk.ts`, currently unused by the entry gate.)
  - **Same symbol → block opposing, allow same-direction** (up to the shared cap).
  - **Quote lines → dynamic line arbiter.** Open-position marks always hold a line (critical); idle high-priority capacity is lent to busier lower-priority strategies and reclaimed on demand; contention degrades Active/Background to delayed quotes (never blind), shown in the UI. Primitives exist: `flow-universe-planner.ts` line budget, `work-scheduler.ts` priority lanes, per-candidate `liveQuoteDemand`.
  - **Unifying idea:** the priority tier is one currency governing both capital and quote-line contention.

---

## 5. Open design tension — the freshness gate

`SIGNAL_MONITOR_MAX_ACTIONABLE_BARS_SINCE_SIGNAL = 1` is sound for a momentum entry but is really a **latency budget** and is fragile: "1 bar" = ~60s on 1m vs ~1h on 1h; it can conflict with the MTF gate (confirmation forming a bar later → blocked); misses are silent. **Recommendation:** don't loosen — *instrument* the Age-0 share / too-old-block rate per timeframe, then decide whether the actionable clock should start at *alignment completion*.

---

## 6. Implementation plan

**Ordering rule:** correctness first (a stop must fire) → the *proven* profit lever (let winners run) → greeks only once earned → live last. Everything is shadow-provable; live is gated.

### Phase 0 — Foundation (correctness)
- **F1** — Move overnight-spot to its **own deployment row**; add a "two strategies reconstruct independently" regression test. *(Root-causes the 06-12 entanglement that silently lost positions & suppressed hard-stops.)*
- **F2** — **Exit-enforcement alert**: flag any open position breaching its stop with no exit event within the mark window.
- **F3** — **Purge** the ~85k stale blocked rows **+ retention cap**.

### Phase 0.5 — Multi-strategy coexistence framework
Priority-tier capital; block-opposing symbol policy; dynamic quote-line arbiter (see §4). Needed before >1 strategy runs live; can lag single-strategy shadow work.

### Phase 1 — Let winners run (greek-free; the proven ~$300–500k)
- **P1** — **Partial scale-outs**: at first trail arm sell 50–70%, keep 30–50% runner on a looser trail. *(runner_trail_stop ~$485k → est. $150–250k)*
- **P2** — **Opposite-signal dual-confirm**: half-exit on first opposite bar, full only on second confirm / MTF loss. *(opposite_signal ~$256k → est. $80–120k)*
- **P3** — **Quality-aware overnight**: let high-quality runners carry overnight on a wider trail. *(overnight_risk_exit ~$133k → est. $50–80k)*
- **P4** *(opt)* — **Early-invalidation → re-entry watch**. *(~$53k → est. $30–50k)*
- **Proof:** re-run the exit-policy sweep on the fresh window; promote only if it beats the tuned profile on realized P&L *and* capture-vs-opportunity without worse drawdown.

### Phase 2 — Prove greeks on real data *(was never done)*
- **G1** — Set `PYRUS_SIGNAL_MONITOR_BAR_EVALUATION_ENABLED` in the sweep/smoke generator env so the backfill runs. **(Same blocker as P1–P4.)**
- **G2** — Wire **real greeks from `gex_snapshots`** into the backfill/selector (replace BS reconstruction); first verify snapshot cadence + 1–3 DTE strike coverage — if thin, that's the finding.
- **G3** — A/B on identical trades: greek-pick vs fixed-pick (selection); wire/greek-exit vs control-exit (exits). Success bar: greeks ≥ baseline with scored coverage >~60%.
- **G4** — Flip greeks live only if they beat baseline; selection and exits gated **separately**; keep `fallbackToLegacy`.

### Phase 3 — Live execution (terminal, gated)
Flip shadow → real broker only when: F1–F3 green & exit-alert clean for a sustained window; P1–P3 proven in shadow; greek track earned a live vote or explicitly parked; coexistence framework in place (if >1 strategy live).

---

## 7. Immediate next actions (shadow / read-only)
1. **Run the exit-enforcement check live now** (F2) — catch any current silent breach.
2. **Flip the bar-eval setting** in the sweep generators (G1) — unblocks **both** P1–P4 *and* G1–G3.
3. **Re-run the exit-policy sweep** on the fresh window — re-confirm the P1–P4 recovery estimates and, with G2, the greek A/B.

---

## 8. Key source references
- Shadow-only & gates: `artifacts/api-server/src/services/signal-options-automation.ts`
- Exit policy: `artifacts/api-server/src/services/signal-options-exit-policy.ts`; defaults `lib/backtest-core/src/signal-options.ts:213,273`
- Greek selector: `lib/backtest-core/src/option-greek-selector.ts:317`
- Backfill bar-eval gate (blocker): `signal-options-automation.ts:15997`
- Real historical greeks: `gex_snapshots` `lib/db/src/schema/market-data.ts:181`; row type `gex.ts:39`
- Sweep generators: `scripts/src/signal-options-exit-policy-sweep.ts`, `scripts/src/signal-options-greek-selector-smoke.ts`
- Evidence: `scripts/reports/signal-options-exit-policy-sweeps/`, `scripts/reports/shadow-options-management-review/`, `scripts/reports/signal-options-greek-selector-smoke/`
- 06-12 exit-enforcement fixes: `SESSION_HANDOFF_LIVE_2026-06-12_shadow-stop-audit.md`
