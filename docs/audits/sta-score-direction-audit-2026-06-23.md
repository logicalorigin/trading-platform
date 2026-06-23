# STA Signal-Score Direction Audit — 2026-06-23

**Type:** AUDIT + RECOMMENDATION only. No scoring code was changed. Author runs read-only DB queries; user reviews and signs off before any implementation.

**Repo state at audit:** `main` @ `58c63e8` (working tree dirty with unrelated in-flight work; none touched).

**One-line verdict:** With "more than enough" data (10,908 matured 5m signals), the current STA `signalQuality.score` and **every one of its components are statistically indistinguishable from random** at predicting realized price direction (AUC ≈ 0.50–0.53 across timeframes, horizons, labels, and both directions). **No reweighting of the existing inputs produces a robust directional lift** — because the inputs (MTF alignment, ADX) carry essentially no directional information. The recommendation is therefore **not** "reweight these features" but "the score cannot be made directionally predictive from its current inputs; new features are required." Evidence and the exact change surface are below.

---

## 1. Where the score is computed and its exact components

### Source of truth (backend)
`classifySignalOptionsEntryQuality()` — **`artifacts/api-server/src/services/signal-options-automation.ts:4481-4575`**

It emits the `SignalOptionsEntryQuality` object that becomes `candidate.signalQuality` / `position.signalQuality` (`.score`, `.tier`, `.liquidityTier`, `.components`, `.reasons`, `.raw`).

### Frontend fallback (identical formula)
`resolveSignalScoreBreakdown()` — **`artifacts/pyrus/src/screens/algo/algoHelpers.js:1642-1769`**. When `candidate.signalQuality` is present it passes the backend object straight through (`algoHelpers.js:1651-1665`); otherwise it recomputes the same formula from `filterState`. The MTF helpers it mirrors: `mtfAlignmentScore` (`algoHelpers.js:1630`), backend twins `signalOptionsMtfAlignmentScore` / `…Reason` (`signal-options-automation.ts:4293-4316`).

### The formula (raw points, then rescaled ×100/70 to a 0–100 score)

| Component | Input | Raw points | Notes |
|---|---|---|---|
| **mtfAlignment** | `filterState.mtfDirections` vs signal direction | `mtf.length ? (matches/frames)*25 : 8` (max **25**) | fraction of higher-timeframe trend frames that agree with the signal |
| **trendStrength** | `filterState.adx` | `adx==null ? 7.5 : clamp(adx/25,0,1)*15` (max **15**) | ADX saturates at 25 |
| **liquidity** | `orderPlan/quote.spreadPctOfMid` | strong `20` / standard `12` / weak `0` (max **20**) | tier by spread ≤15 / 15–30 / ≥30 |
| **riskFit** | `orderPlan.premiumAtRisk` | `>0 ? 10 : 5` (max **10**) | binary "is the trade sized" |
| **total** | — | sum × `100/70` | `maxRawScore = 25+15+20+10 = 70` |

Tier (`signal-options-automation.ts:4553`): `score≥75 & liquidity≠weak → high`; `score<50 ‖ weak → low`; else `standard`.

**Critical observation about live STA-table signals:** a raw monitor signal has **no contract / orderPlan**, so for every signal that reaches the STA table, `liquidity` and `riskFit` collapse to their constant defaults (`12` and `5`). The score's *only* varying inputs on the STA table are **mtfAlignment and trendStrength(ADX)** — exactly the two the user named, and exactly the two this audit grades. (The deleted prior-work file `_score_audit.ts`, recovered via `git show`, made the same observation and used the same data source — its methodology is the basis for this audit.)

### Where the score is consumed
- Display/ranking on the STA / Operations table: `OperationsSignalTable.jsx:1403`, `OperationsSignalRow.jsx:2490/2688`, `algoAccountPositions.js:504-515`.
- No hard admission gate keys off `signalQuality.score` in the automation path (the `policy.minScore` at `signal-options-automation.ts:3566` gates a *different* score — the option-greek contract score, not the STA entry-quality score). The STA score is primarily a **ranking / surfacing** signal today.

---

## 2. Data source & labeled-row counts (all observed)

**Historical signals:** `signal_monitor_events` (Postgres `heliumdb`). Each row's `payload->'filterState'` carries the exact scoring inputs recorded at signal time: `mtfDirections`, `adx`, plus extras `volatilityScore` (0–10), `sessionKey`, `direction`. **100% of rows carry these** — no missingness.

**Outcome / MFE / MAE:** computed read-only from `bar_cache` (source `massive-history`, dense coverage 2026-03-25 → 2026-06-23 for all timeframes) via `buildSignalForwardReturnDataset` (`lib/backtest-core/src/signal-forward-returns.ts`) — the same engine the production KPI service uses (`signal-quality-kpis.ts`). MFE = `maxFavorableExcursionPercent`, MAE = `maxAdverseExcursionPercent`, both signed in the signal's direction (MAE ≤ 0).

**Label (per user):** `FAVORABLE = MFE > |MAE|` over the execution horizon; else `ADVERSE`. Horizon = forward-return window in bars (production KPI default `settings.timeHorizon = 10`, `signal-quality-kpis-service.ts:507`).

| env | tf | total events | with filterState | matured (forward window complete) | first → last |
|---|---|---|---|---|---|
| shadow | 1m | 15,194 | 15,194 | — | 2026-05-19 → 06-23 |
| shadow | **5m** | 11,103 | 11,103 | **10,908** | 2026-05-18 → 06-23 |
| shadow | 2m | 6,845 | 6,845 | — | 2026-06-09 → 06-23 |
| live | 5m | 2,668 | 2,668 | — | 2026-04-28 → 06-01 |
| shadow | **15m** | 2,017 | 2,017 | **1,957** | 2026-04-23 → 06-23 |
| shadow | 1h | 754 | 754 | — | 2026-06-09 → 06-23 |

Primary calibration set: **shadow 5m, 10,908 matured labeled signals** (5,660 buy / 5,248 sell), the largest set with a meaningful holding horizon. Confirmed: data volume is real and ample. "More than enough data" = **true**.

**Base FAVORABLE rate ≈ 48%** (5m). Direction itself is close to a coin flip; the universe drifted up over the sample, so **sells skew adverse** (sell meanRet −0.225%, sell favorable 46.4% vs buy 49.5%).

---

## 3. Per-component directional predictiveness (the core finding)

Metrics: point-biserial correlation of the feature with the 0/1 favorable label; AUC (Mann–Whitney, 0.5 = random); information value (IV, equal-frequency deciles); favorable-rate across quintiles Q1→Q5. **shadow 5m, horizon 10, n = 10,908.**

| Feature | point-biserial | AUC | IV | favRate Q1→Q5 |
|---|---|---|---|---|
| **currentScore.total** | 0.021 | **0.512** | 0.005 | 47→46→48→48→50 |
| comp.mtfAlignment (= raw.mtfFraction) | 0.024 | 0.512 | 0.013 | 47→46→49→48→50 |
| raw.mtfMatchCount | 0.024 | 0.512 | 0.013 | 47→46→49→48→50 |
| raw.mtfFullAgree (0/1) | 0.017 | 0.508 | 0.013 | 45→52→45→48→50 |
| **comp.trendStrength (ADX)** | −0.005 | **0.499** | 0.006 | 49→48→47→46→50 |
| raw.adx (continuous) | 0.009 | 0.501 | 0.003 | 49→48→47→47→50 |
| raw.adx≥25 (0/1) | 0.006 | 0.503 | 0.008 | 47→49→47→47→50 |
| candidate.volatilityScore | −0.026 | 0.485 | 0.008 | 50→49→48→46→47 |
| candidate.hourEt | 0.002 | 0.499 | 0.010 | 49→48→49→46→49 |
| candidate.isOpenHour (9–11 ET) | −0.017 | 0.493 | 0.011 | 47→49→48→50→46 |

**Reading:** AUC 0.5 = no directional information. Everything sits at 0.49–0.52. IV < 0.02 everywhere (industry rule of thumb: IV < 0.02 = "not predictive"). The current composite score (0.512) is no better than its best single input and barely above chance.

- **mtfAlignment** is the *least bad* input (AUC 0.512, IV 0.013) but the lift is tiny and not monotonic.
- **trendStrength / ADX is dead** (AUC 0.499; continuous ADX 0.501). ADX adds **zero** directional value and is mildly counterproductive in some buckets.
- **volatilityScore** (an available feature the score ignores) is mildly *negatively* related (AUC 0.485) — not a useful add.
- **time-of-day** carries nothing at 5m (AUC 0.499).

### Regime cross-tabs (do components separate outcomes anywhere?)

ADX regime — favorable-rate is **flat across all ADX levels**, confirming ADX is non-informative:

| ADX | n | favRate MFE>\|MAE\| | favRate realRet>0 | meanRet% |
|---|---|---|---|---|
| <15 | 2,506 | 49.3% | 46.6% | −0.068 |
| 15–20 | 2,704 | 46.7% | 45.3% | −0.157 |
| 20–25 | 2,225 | 47.5% | 45.8% | −0.101 |
| 25–30 | 1,334 | 46.0% | 45.4% | −0.182 |
| ≥30 | 2,140 | 50.0% | 48.2% | −0.049 |

MTF agreement fraction — a weak, **non-monotonic** ~5pp spread (note 0.667 beats 1.000):

| MTF agree | n | favRate MFE>\|MAE\| | favRate realRet>0 | meanRet% |
|---|---|---|---|---|
| 0.000 | 3,942 | 47.0% | 45.1% | −0.206 |
| 0.333 | 1,307 | 44.4% | 42.6% | −0.281 |
| 0.667 | 1,717 | 50.4% | 48.7% | −0.003 |
| 1.000 | 3,943 | 49.1% | 47.6% | +0.004 |

The only weakly real effect: full / near-full MTF agreement is ~4–6pp better than partial disagreement, mostly by avoiding the worst bucket (0.333). That is the entire predictive content of the current feature set.

### Per-direction (the score is broken for sells)

| Direction | n | base MFE>\|MAE\| | score AUC vs MFE>\|MAE\| | score AUC vs realRet>0 |
|---|---|---|---|---|
| buy | 5,660 | 49.5% | 0.497 | 0.499 |
| sell | 5,249 | 46.4% | 0.487 | 0.492 |

For sells the score AUC is **below 0.5** (inverted): a higher STA score is, if anything, slightly *worse* for short signals. The score never accounts for the universe's upward drift, so it systematically over-rates sell setups.

---

## 4. Robustness — same conclusion across every cut

| Run | n | score AUC (test) | top-decile favRate (current → proposed) |
|---|---|---|---|
| shadow 5m, h=10 | 10,908 | 0.529 | 56.6% → 49.2% |
| shadow 5m, h=6 | 10,949 | 0.525 | 54.3% → 50.3% |
| shadow 15m, h=10 | 1,957 | 0.505 | 44.8% → 51.7% |

Label-invariance (5m h=10): score AUC = **0.512** vs `MFE>|MAE|`, **0.515** vs `realizedReturn>0` — the verdict does not depend on the label choice. The 15m set shows marginally higher component correlations (score AUC 0.533 in-sample) but collapses to 0.505 on the held-out test and has 5× less data; it is noise, not a regime where the score works.

---

## 5. Proposed recalibration & MEASURED lift

**Method:** chronological 70/30 train/test split (no look-ahead — the test period is strictly later than train), logistic regression over the user-named inputs (MTF agreement strength, MTF match count, full-agreement flag, ADX continuous, ADX regime) **plus** the available extras (volatilityScore, time-of-day), standardized on train, evaluated on held-out test.

**Result (5m, held-out test, base favorable 48.0%):**

| Metric | CURRENT STA score | PROPOSED reweight |
|---|---|---|
| AUC | **0.525** | 0.510 |
| top-decile favorable rate | **54.3%** | 50.3% |
| top-20% favorable rate | **53.7%** | 49.6% |

**The proposed reweighting does not beat the current score on held-out data** — and this held across all three configurations (15m: 0.494 vs 0.505 AUC). The fitted coefficients are vanishingly small (|w| < 0.08 standardized) and not stable in sign between timeframes (`mtfFullAgree` flips −0.07 → −0.37; `volatilityScore` flips −0.07 → +0.05). This is the signature of **fitting noise**: there is no reweighting of the existing inputs that yields a real, transferable directional edge.

**Honest conclusion (fact-first):** The task as scoped — "reweight the existing components so the score ranks by direction" — **cannot be satisfied with the current inputs**, because the inputs are not directionally predictive. Reporting a fabricated reweighting with a fake lift would be the wrong call. The right finding is: *the STA score measures setup quality, and setup quality (MTF alignment + ADX) does not predict 6–10 bar realized direction in this universe.*

### What would actually be needed (for the follow-up conversation, not implemented here)
The audit tested everything stored in `filterState` today. To make the score directional you would need **features not currently captured at signal time**, e.g.:
- **A direction/drift prior** — the single largest, cleanest effect here is that sells underperform buys (universe drift); a per-symbol or per-direction drift/bias term would beat every current component. This is the highest-value, lowest-risk addition.
- Magnitude-of-trend / momentum features beyond ADX's binary-ish saturation (ADX is provably dead here).
- Microstructure / volatility-regime features that aren't the current `volatilityScore` (which is non-predictive).

These require capturing new inputs into `signal_monitor_events.payload.filterState` first, then re-auditing. That is a feature-collection project, not a reweighting.

---

## 6. Leakage / robustness caveats

- **No look-ahead in the label or split.** MFE/MAE/return use only bars strictly *after* the entry bar (`signal-forward-returns.ts:228`, `buildWindow`). The proposed-model evaluation uses a strictly chronological train/test split. Component values are read from `filterState` as recorded at signal time.
- **Survivorship / selection:** the dataset is signals that *fired* (already past the live filter gates). The audit grades discrimination *within* fired signals, which is the correct scope for "rank the STA table." It does not claim anything about pre-filter signals.
- **Overlap:** multiple signals on the same symbol within a horizon overlap; the forward-return builder flags `overlapping_signal_window` but still scores them. This inflates effective-n slightly but does not change a 0.51 AUC into a real edge.
- **Liquidity/riskFit untested for direction** because they are constant on raw STA signals (no contract). They are liquidity/cost controls, not directional features, and out of scope for "predict direction."
- **Sample is one regime** (≈5 weeks, broadly up-drifting, May–Jun 2026). The sell-side inversion is regime-dependent; a drift term must be adaptive, not a fixed constant.
- **15m has 5× less data**; its slightly higher in-sample correlations do not survive the held-out split.

---

## 7. Exact implementation surface (for the approved follow-up only — NOT changed here)

Any score change would edit, in lockstep (they must stay numerically identical — there is a test asserting parity, `algoHelpers.test.mjs`):

1. **Backend, source of truth:** `classifySignalOptionsEntryQuality` — `artifacts/api-server/src/services/signal-options-automation.ts:4481-4575` (the component point allocations at lines 4515-4541; tier cutoffs 4553-4558).
2. **MTF helper (if MTF weighting changes):** `signalOptionsMtfAlignmentScore` — `signal-options-automation.ts:4293-4300`.
3. **Frontend fallback (must mirror exactly):** `resolveSignalScoreBreakdown` — `artifacts/pyrus/src/screens/algo/algoHelpers.js:1718-1769`, plus `mtfAlignmentScore` at `algoHelpers.js:1630`.
4. **Parity test to update:** `artifacts/pyrus/src/screens/algo/algoHelpers.test.mjs` (the `resolveSignalScoreBreakdown` tests around line 1410).
5. **If a new feature (e.g. drift prior) is added:** it must first be persisted into `signal_monitor_events.payload.filterState` at emit time (producer in `signal-monitor*` / `signal-options-automation.ts buildSignalOptionsSignalSnapshot`), then a re-audit run before any weighting is trusted.

**Recommendation to the user:** do **not** ship a reweighting of the current inputs — the audit shows no reweighting helps. Decide instead whether to (a) keep the score as an explicit *setup-quality* indicator and rename/reframe it so it isn't mistaken for a directional probability, or (b) fund a feature-collection effort (starting with a direction/drift prior) and re-audit. Both are conversations, not code changes.

---

### Appendix — analysis provenance
- Read-only SELECT queries against `heliumdb` via `@workspace/db` + `@workspace/backtest-core`.
- Throwaway scripts (kept OUT of the repo source tree, under the session scratchpad): `sta-score-audit.ts` (per-component predictiveness + logistic reweight + held-out lift) and `sta-label-robustness.ts` (multi-label / per-direction / regime cross-tabs).
- Runs: shadow 5m h10, shadow 5m h6, shadow 15m h10, label-robustness 5m h10 — all reproduced the same near-0.5 AUC verdict.
