# 5-28 Trading Analysis — Greek-Aware, Wireband-Following Trailing Stop

> Update to and continuation of `5-27 trading analysis.md`. The 5-27 doc prescribed greek-aware trade management as a framework; this doc finalizes a concrete, feasibility-checked design for a **wireband-following, greek-modulated trailing stop**, updates the analysis with the greeks data that actually exists today, and specifies the items 5-27 left open.

## Why this update

The 5-27 framework (looser runner trail while delta/gamma support holds; tighten on theta-burden spikes / delta decay / spread deterioration; greek-gated opposite-signal and overnight handling) is sound but **unimplemented in the exit code**, and it predates the new idea: have the trailing stop **follow the strategy's "wireband" lines** (the Pyrus Signals "Neon Wireframe") and **progressively tighten as price climbs the wires**, modulated by greeks. This doc resolves how that works end-to-end.

## Current state (verified in code)

- **The trailing stop is option-premium-space only and purely profit/peak-driven.** `computeSignalOptionsPositionStop` (`artifacts/api-server/src/services/signal-options-exit-policy.ts:90`): `stop = max(hardStop, max(entry×(1+minLocked%), peak×(1−giveback%)))`. Giveback precedence today: **10x > 5x peak-multiple > progressiveTrailStep > conditional liquidity > baseline**; locked-gain: progressive step > baseline. There is **no greek, underlying-price, or wire input.**
- **Greeks are captured but unused in exits.** delta/gamma/theta/vega/IV stream per position (`artifacts/pyrus/src/features/platform/live-streams.ts`, live option quote ~15s stall; account risk per-underlying ~7s) and are captured in `signal-options-automation.ts` — but never passed to the exit math.
- **Exit cadence is poll-based, not tick/bar.** The worker wakes every 5s (`signal-options-worker.ts:22`); each deployment evaluates on `pollIntervalSeconds` (default 60s, range 15–3600). Exit eval = `refreshActivePosition` (`signal-options-automation.ts:~6079` live, `~8218` backfill).
- **What the exit scope HAS today:** option mark; **greeks** (live path, bridge quote ~5s TTL, sampled per poll); **spreadPctOfMid** (live `markResolution.liquidity`). **What it LACKS:** underlying spot, underlying bars, regime/CHOCH state. The backfill path has none of greeks/spread/regime.
- **The wires** (`artifacts/pyrus/src/features/charting/pyrusSignalsPineAdapter.ts:3365-3420`): `trendLine` = the active-regime band; wires = `trendLine ± atrSmoothed×wireSpread×{1,2,3}`, active-side only, ATR-scaled (they breathe with volatility), reset on regime flip. So **trendLine = the tightest structural stop, and wire1 → wire2 → wire3 are progressively looser.** They are frontend-only today, but their inputs (`basis` WMA, `atrSmoothed` SMA-of-ATR, `regimeDirection`) are already computed and returned server-side by `evaluatePyrusSignalsSignals` (`lib/pyrus-signals-core/src/index.ts`), and `shadow-account.ts:8496` already reads `atrSmoothed` server-side. Frontend and core band math are identical (no divergence risk).
- **Parity gap:** the backtest engine (`lib/backtest-core/src/engine.ts` `resolveRiskExit`) does not run the progressive trail, and greeks are not stored historically.

## The design

### Dual-leg trailing stop — exit if EITHER leg fires
Each leg protects a different thing, so neither is redundant:

1. **Structure leg (new) — protects the thesis.** Exit when the **latest closed signal-timeframe bar of the underlying** is through the active wire (close-based, not an intrabar wick). This is what lets a runner run: you don't bail on premium noise while price still respects its wires.
2. **Premium floor (existing — non-negotiable backstop) — protects capital.** `max(entry×(1+minLocked%), peak×(1−giveback%))`, checked against the freshest option mark. Catches theta bleed, IV crush, and premium collapse the structure leg can't see.

Worked scenarios that justify "either":
- *IV crush, structure holds* → premium falls below the floor while the underlying is still above its wire → **floor exits** (the doc's "IV-driven profit without follow-through → take profit faster"). Structure-only would have ridden the gain to zero.
- *Structure break, premium sticky* → underlying closes below the wire but an IV pop keeps premium up → **structure exits**, locking the gain. Premium-only would have ridden a dead trend.

### Cadence handling
There is no tick loop, so "structure-on-close / premium-on-mark" is realized **within the poll loop**: each poll, the structure leg checks the latest closed bar and the premium floor checks the freshest mark. For positions in the active-trail/runner state, **shorten the effective poll to ~15–20s** (the worker already supports down to 15s) for responsiveness; 60s is fine pre-activation. (Optional later: a lightweight mark-only stop check on the 5s wakeup between full scans.)

### Rung selection — profit baseline + greek modulation
Profit sets the baseline rung (more peak gain → tighter: wire3 → wire2 → wire1 → trendLine). Greeks then adjust:
- **Loosen** (ride an outer wire) while delta is strong/improving and gamma is strong — let the runner run.
- **Tighten** (inner wire / exit) on theta-burden spikes, delta decay, or spread widening.

This **replaces** the peak-% `progressiveTrailSteps` + 5x/10x ladder as the *tightening driver*; 5x/10x is retained only as an extreme-runner premium-floor tightener.

### Giveback sizing, gamma, and fallback
- **Giveback is delta-sized to the wire** — `|delta| × |S − W| × 100` — so it is moneyness-aware: a deep-ITM runner (delta ≈ 0.9) trails tight, a cheap OTM option (delta ≈ 0.2) keeps a wider premium leash. This reuses the same delta that signals quality.
- **Rollout:** ship the structure leg with the **existing fixed-% floor first** (prove the novel wire mechanic), then swap the floor's giveback to delta-sizing.
- **Gamma:** first-order delta with **continuous re-translation each poll** — as price nears the wire the gap → 0, so curvature error self-cancels at the trigger. No explicit `0.5·gamma·ΔS²` term; gamma keeps its job in the quality/rung layer, not the stop arithmetic.
- **Stale/missing greeks → revert to fixed-% giveback** so protection is never lost.

### Regime flip — snap-to-tightest, then hand off
A CHOCH flip against the position is a thesis reversal, **not** a blunt exit here. The trail leg freezes the stop at the last in-regime trendLine, tightens the premium floor to maximum, and raises a **reversal event** to the greek-gated opposite-signal handler, which decides trim / hedge / full-exit / keep-a-greek-strong-runner-on-the-tightened-trail (matches 5-27 lines 154-158). Reversal trigger = "regime flips against the open position's direction," independent of whether a fresh opposite entry signal fires.

### Scope and validation
Full 5-27 framework, **sequenced**: (1) wire+greek dual-leg trail [core], (2) partial/runner scaling, (3) opposite-signal greek gating, (4) overnight greek residuals. **Validation is live/shadow-first** (greeks available live); the backtest covers the **wire-structure leg only** (no historical greeks).

## Implementation approach (files & reuse)

- **Expose wires server-side (low-risk):** extend `PyrusSignalsEvaluation` with `upperBand`/`lowerBand`/`bullWires[3]`/`bearWires[3]`, add `wireSpread` to settings, derive from the existing `basis`/`atrSmoothed`/`regimeDirection` in `evaluatePyrusSignalsSignals` (`lib/pyrus-signals-core/src/index.ts`).
- **Thread the underlying eval into the exit (the main new plumbing):** source current wires + `regimeDirection` + underlying spot from the **signal-monitor/matrix evaluation already run for the underlying** (reuse, don't re-fetch per position) into `refreshActivePosition` (`signal-options-automation.ts:~6079`). Greeks + spread are already in scope there.
- **Exit policy:** extend `computeSignalOptionsPositionStop` (`signal-options-exit-policy.ts`) to take `{ underlyingSpot, wires, regimeDirection, greeks, spreadPctOfMid }`; add the structure leg, rung selection, delta-sized giveback (phase 2), and the regime-flip snap/handoff; keep hardStop + minLockedGain floor; add `exitReason`s (`wire_structure_break`, `regime_flip_handoff`).
- **Cadence:** in `signal-options-worker.ts`, reduce the effective poll for active-trail/runner positions to ~15–20s.
- **Profile + UI:** add exitPolicy fields (wire-trail enable, rung-by-profit map, greek thresholds, delta-sizing toggle) to the `lib/backtest-core` signal-options profile, `artifacts/pyrus/src/screens/algo/algoSettingsFields.js`, and the Algo settings UI.
- **Backtest parity:** port the structure leg into `lib/backtest-core/src/engine.ts` (wires from the eval; greeks neutral).

## Items 5-27 left open — now specified

- **Greek thresholds (starting constants, tunable in shadow):**
  - Delta: `delta_improvement = |delta_now| − |delta_entry|`; `> +0.05` → eligible to loosen one rung; `< −0.10` → tighten one rung.
  - Theta burden: `|theta| / mark` (daily decay as % of premium); `> ~8%/day` → tighten one rung (combine with the doc's "gamma high but underlying stalls" note).
  - Gamma: strong gamma + profitable → permit the looser rung (trim-only bias); gamma collapse (deep-ITM) → manage like delta, no extra loosening.
  - Spread: `spreadPctOfMid > max(entrySpread×1.5, liquidityGate.maxSpreadPctOfMid)` → tighten/exit.
- **Partial / runner scaling (phase 2, additive on existing quantity tracking):** add an `exitQuantity` to exit events; on a scale-out reduce `position.quantity` instead of `positions.delete`; reuse the shadow `positionQuantity` / `partial_shadow` infra (`shadow-account.ts:~3559-3581`). Trigger: at the first rung-tighten past `+50%` peak gain, sell 50–70%; keep a 30–50% runner on the wire trail while greek quality stays strong; the runner exits via wire / floor / regime-flip as normal.
- **Backtest historical greeks:** deferred — the backtest validates the wire-structure leg with greeks neutral; a full greek replay needs net-new historical-greek storage (a separate data effort), pursued only if shadow shows the greek layer adds edge.

## Verification

- **Unit:** exit-policy tests — structure leg fires on an underlying close through the active wire; the premium floor still fires on premium collapse with the underlying holding; "either" wins correctly in both conflict scenarios above; delta-sized giveback (deep-ITM tighter than OTM); stale-greek → fixed-% fallback; regime flip → snap-to-tightest + reversal event (no blunt exit); rung loosens/tightens at the threshold constants. `pyrus-signals-core`: wires match the frontend adapter for a fixture series. `backtest-core`: wire-structure replay. Then API + Pyrus typechecks; existing `signal-options-automation.test.ts` / `algoHelpers.test.js` stay green.
- **Shadow/live:** confirm runners ride outer wires while delta/gamma are strong and tighten on theta-burden / delta-decay / spread; confirm regime flips hand off to trim/exit rather than blunt-dumping a strong runner; confirm the reduced poll keeps stops responsive; measure realized vs. post-exit opportunity against the 6.39x gap the 5-27 review flagged.
