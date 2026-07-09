# WO-SO-05 Greek Open-Items Audit

Read timestamp: 2026-07-08T01:24:17Z.

Scope: read-only audit of the current working tree plus bounded read-only SQL against `heliumdb` and live API process env key checks for deployment `7e2e4e6f-749f-4e65-a011-87d3559a23b0`. No source, config, env, or flag edits were made; this report is the only write.

Observed dirty/mid-edit context: `git status --short` showed modified `lib/backtest-core/src/option-greek-selector.ts`, `artifacts/api-server/src/services/signal-options-automation.ts`, `artifacts/api-server/src/services/signal-options-automation.test.ts`, `artifacts/api-server/src/services/signal-options-greek-trail.test.ts`, and `artifacts/pyrus/src/screens/algo/algoHelpers.js`. Observed mtimes included `signal-options-automation.ts` at `2026-07-07 19:12:50 -0600` and `option-greek-selector.ts` at `2026-07-07 18:11:21 -0600`, so automation/service findings below should be treated as current in-flight working-tree facts.

Cross-reference docs read: `docs/reviews/2026-07-07-signal-options-system-review.md`, `docs/plans/2026-07-07-signal-options-live-money-plan.md`, `TRADING_STRATEGY_BACKHALF_PLAN_2026-06-16.md`, and `5-28 trading analysis.md`.

## Verdict Table

| # | Verdict | Evidence | Stale doc claim |
|---:|---|---|---|
| 1 | FIXED | Observed: `lib/backtest-core/src/option-greek-selector.ts:380-394` computes `gammaMovePremiumFraction = gamma * spot * spot * 0.0001 / entryPrice` before `gammaTheta`; `git log --oneline -5 -- lib/backtest-core/src/option-greek-selector.ts` includes `08f336ff`, and `git show 08f336ff --stat` modified the selector and exit policy. | Inferred stale: review #5 / plan T3 re-verification is stale for the current tree. |
| 2 | PARTIAL | Observed: fallback/greek-governed final delta gate is wired with `greekSelectorGoverned: Boolean(greekSelection)` at `artifacts/api-server/src/services/signal-options-automation.ts:14558-14577`; the gate synthesizes delta and rejects below `0.15` at `:4055-4122`; moneyness guard exists at `:3631-3655`. Observed remaining gap: legacy fallback attempts still carry `score: null` at `:3716-3733`, and final score gate is not governed for `fallback_legacy` (`Boolean(greekSelection?.selectedAttempt)`) at `:14668-14677`. | Review #2 is partially stale: delta/moneyness safety was added, but full scoring/minScore still does not cover fallback. |
| 3 | PARTIAL | Observed: final quote rechecks delta at `signal-options-automation.ts:14558-14609`, breakeven at `:14611-14650`, and score at `:14652-14690`. Observed remaining gap: score recheck passes open when final greeks cannot be derived (`:4216-4223`) and is only governed for actual selected attempts (`:14668-14677`), not fallback legacy. | Review #6 is partially stale: final fill quote now has gates, but not a mandatory full re-score for every path. |
| 4 | FIXED | Observed: entry greeks are taken from the quote at `signal-options-automation.ts:14508-14510`, synthesized for shadow fallback at `:14527-14554`, carried through fallback resolution at `:15318-15327`, and persisted into the position with `entryGreeks` / `greekBaselineSource` at `:15502-15520`. Mark-side fallback also reads position entry greeks at `:13381-13387`. | Plan T15 and review #20 are stale for normal live/synthetic/fallback paths. Unknown: if strike/spot/expiry are absent, synthesis can still be null. |
| 5 | OPEN | Observed: chain fetch breadth is still slot-shaped: default DTE is `1/1/3` and default slots are call `[3]`, put `[2]` in `lib/backtest-core/src/signal-options.ts:214-230`; selection resolves only slot quotes into the scorer at `signal-options-automation.ts:3933-3957`; helper comment still says near-money slot picker / `strikesAroundMoney<=3` at `:3598-3604`. Tests now pin slot-only behavior at `signal-options-automation.test.ts:1364-1414` and `:1459-1498`. | Review #15 remains current for candidate breadth; its "no tests" subclaim is partially stale because tests now cover the narrow behavior. |
| 6 | FIXED | Observed: enforce flag is read from `PYRUS_SIGNAL_OPTIONS_WIRE_TRAIL_ENFORCE` / `SIGNAL_OPTIONS_WIRE_TRAIL_ENFORCE` at `signal-options-automation.ts:16520-16527`, passed to exit policy at `:13444-13450` and `:18244-18249`; exit policy enforces only when true at `artifacts/api-server/src/services/signal-options-exit-policy.ts:495-499`; wire breaks are shadowed when flag is absent at `signal-options-automation.ts:13472-13483`. Runtime observed: `.pyrus-runtime/dev-env.local:3` has only `SIGNAL_OPTIONS_TALLY=shadow` for requested keys; API pid `33336` environ grep returned only `SIGNAL_OPTIONS_TALLY=shadow`. | Review #18's source-gate concern is stale; runtime remains telemetry-only by observed env. |
| 7 | PARTIAL | Observed source default changed to `45_000` at `lib/backtest-core/src/signal-options.ts:290-295` and tuned patch at `:387-392`. Runtime observed live deployment config still has `greekMaxAgeMs: 15000` and `runnerPollIntervalSeconds: 20`. Telemetry observed: latest 50 mark events were 0 fresh / 50 stale; latest 500 were 0 fresh / 500 stale; last 12h were 819 fresh / 1687 stale out of 2506, with 0 nonzero greek rungs. | Review #18 is partially stale on source defaults, but still materially current for live runtime. |
| 8 | FIXED | Observed tests exist for greek tighten/loosen (`signal-options-greek-trail.test.ts:66-114`), stale/missing freshness (`:116-144`, `:213-227`), short-side break (`:146-168`), regime-flip suppression (`:170-187`), and usable wire fallback (`:194-207`, `:229-246`). Enforce tests cover off/on and delta sizing at `signal-options-wire-trail-enforce.test.ts:32-133`. | Review #13 is stale for the listed greek/wire test batteries. |
| 9 | FIXED | Observed: `resolveWireBarFreshness` computes age and marks stale when `ageMs > intervalMs * 2` at `signal-options-exit-policy.ts:193-219`; `structureBreak` is suppressed when stale at `:482-491`; telemetry records `structureBreakSuppressed: "stale_bar"` at `:625-629`. Tests cover stale suppression, fresh fire, and fail-open without timeframe/spacing at `signal-options-wire-trail-enforce.test.ts:135-194`. | Review #18 is stale for normal contexts; observed caveat: guard fails open if timeframe and prior spacing are unavailable. |
| 10 | PARTIAL | Observed: `scripts/src/signal-options-exit-policy-sweep.ts:21` sets `PYRUS_SIGNAL_MONITOR_BAR_EVALUATION_ENABLED`, but `scripts/src/signal-options-greek-selector-smoke.ts:217` still reports Black-Scholes reconstruction and does not set that env key. Observed reports: latest sweep dir `fresh-20sym-2026-05-22-through-2026-06-13` has 16 succeeded rows, but `results.csv` rows show `missing_greeks` / `greeks_unavailable`, not non-failed greek variants. | BACKHALF G1 is partially stale for the exit sweep env blocker; the "no real greek evidence run" concern remains current. |
| 11 | OPEN | Observed source: no signal-options selector/backfill path reads `gex_snapshots`; `rg` only found GEX dashboard/ingest/audit paths plus synthetic `computeOptionGreeksFromPrice` in `signal-options-automation.ts` and smoke text at `scripts/src/signal-options-greek-selector-smoke.ts:217`. Runtime SQL observed data exists but is uneven: 1527 rows, 491 symbols, date range `2026-05-29` to `2026-07-06`, `partial=1523`, `ok=4`. | BACKHALF G2 remains current for wiring; the "if thin, that's the finding" data profile is observed below. |
| 12 | PARTIAL | Observed: selection payload persists scored attempts and top candidates for greek selections at `signal-options-automation.ts:4303-4345`, carries greek attempts even on fallback payloads at `:4365-4398`, emits `contractSelection` at `:13867-13912`, and decision snapshots append `greekSelection.topCandidates`, `contractSelection.attempts`, and `greekSelection.attempts` at `:1396-1406`. Observed limitation: tests assert slot-excluded chain contracts are absent from attempts/payload at `signal-options-automation.test.ts:1459-1498`. | 5-31 selector research step 1 is partially stale: considered-candidate payloads exist, but "all chain candidates" are still not captured because the universe is slot-filtered first. |
| 13 | PARTIAL | Observed backend default disables selector (`lib/backtest-core/src/signal-options.ts:223-230`) while tuned patch enables all six knobs at `:360-369`; UI default profile omits `optionSelection.greekSelector` at `artifacts/pyrus/src/screens/algo/algoHelpers.js:124-136`; UI has read-only Greek selector badges at `:330-366` but merge/default plumbing at `:2358-2381` still does not create editable/default selector knobs. Runtime SQL observed live tuned deployment has `{"enabled":true,"mode":"all","maxCandidates":24,"minScore":0,"fallbackToLegacy":true,"requireLiveGreeks":true}`. | Review #17 / plan T16 are partially stale: knobs are visible read-only when present, but UI-created defaults still omit/disable the selector. |

## Runtime Findings

### Item 6: enforce status

Observed source: wire/greek trail enforcement is gated by `isSignalOptionsWireTrailEnforceEnabled()` (`signal-options-automation.ts:16520-16527`) and the exit policy only uses the wire trail when `wireTrailEnforceEnabled === true` (`signal-options-exit-policy.ts:495-499`). Observed runtime env for API pid `33336` contained only:

```text
SIGNAL_OPTIONS_TALLY=shadow
```

Observed local dev env requested keys: `.pyrus-runtime/dev-env.local:3:SIGNAL_OPTIONS_TALLY=shadow`; `.env.example:537-545` has blank example keys for both `PYRUS_SIGNAL_OPTIONS_WIRE_TRAIL_ENFORCE` and `SIGNAL_OPTIONS_WIRE_TRAIL_ENFORCE`.

Inferred verdict: the running system is telemetry-only for wire structure breaks and greek trail stop behavior.

### Item 7: greek freshness distribution

Observed live deployment config:

```json
{
  "wireGreekTrail": {
    "enabled": true,
    "greekMaxAgeMs": 15000,
    "requireFreshGreeks": true,
    "runnerPollIntervalSeconds": 20
  },
  "greekSelector": {
    "enabled": true,
    "mode": "all",
    "minScore": 0,
    "maxCandidates": 24,
    "fallbackToLegacy": true,
    "requireLiveGreeks": true
  }
}
```

Observed telemetry query over `execution_events` for `signal_options_shadow_mark`:

| Window | Sample | Fresh | Stale-zeroed | Missing greeks | Age min | Age p50 | Age p90 | Age max | Nonzero rung |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| latest 50 | 50 | 0 | 50 | 0 | 17,055,817ms | 18,083,082ms | n/a | 19,275,036ms | 0 |
| latest 500 | 500 | 0 | 500 | 0 | 5,726,428ms | 10,942,070ms | 17,055,823ms | 19,275,036ms | 0 |
| last 12h | 2506 | 819 | 1687 | 0 | 308ms | 50,497ms | 10,917,164ms | 19,275,036ms | 0 |

Observed hourly split for the last 12h UTC: `13:00 16/276 fresh`, `15:00 57/95`, `16:00 183/394`, `17:00 111/231`, `18:00 180/338`, `19:00 267/380`, `20:00 5/136`, and `21:00-01:00 0 fresh`.

Inferred headline: live runtime is still stale-zeroing most greek trail evaluations under the deployed 15s threshold; latest active telemetry was entirely stale-zeroed.

### Item 11b: `gex_snapshots` coverage profile

Observed SQL profile:

- Rows: 1527.
- Date range: `2026-05-29 14:19:26.881692+00` to `2026-07-06 16:43:51.328787+00`.
- Distinct symbols: 491.
- Distinct dates: 27.
- Source status: `partial=1523`, `ok=4`.
- Symbol-days: 634; snapshots per symbol-day min `1`, median `1`, average `2.41`, max `264`.

Observed 1-3 calendar DTE near-money coverage for latest SPY snapshot (`2026-07-06`, spot `734.30`, near money defined as strike within +/-5% of spot):

| Expiration | Calendar DTE | Near-money strikes | All strikes | Strike min | Strike max |
|---|---:|---:|---:|---:|---:|
| 2026-07-07 | 1 | 72 | 147 | 500.0 | 950.0 |
| 2026-07-08 | 2 | 72 | 150 | 500.0 | 950.0 |
| 2026-07-09 | 3 | 72 | 147 | 500.0 | 935.0 |

Observed bounded top-25 latest-by-option-count sample: 14 underlying-expiries in the 1-3 DTE window; near-money strikes min `8`, median `27`, average `36.9`, max `73`; all strikes min `50`, median `143`, average `137.9`, max `313`.

Inferred data finding: `gex_snapshots` can support rich SPY/QQQ-style short-DTE coverage, but symbol cadence/status is uneven and the signal-options selector/backfill does not consume it yet.

## Recommended Fix Slicing

1. Selector entry hardening, M, queue behind WO-SO-01/02/03 for `artifacts/api-server/src/services/signal-options-automation.ts`.
   - Covers items 2, 3, 5, and 12.
   - Inferred work: make `maxCandidates` honest by broadening the candidate universe beyond slot-resolved quotes, or rename/constrain the feature explicitly; decide whether `fallback_legacy` can exist when `requireLiveGreeks=true`; make final fill quote scoring/minScore mandatory where data is available; persist/log the full scored candidate universe.
   - Can start now only for pure `lib/backtest-core` scorer/test work. Service-file changes should queue.

2. Wire/greek freshness runtime cleanup, S, can start now in scripts/config review but live flag/config changes require explicit maintenance approval.
   - Covers items 7 and 10.
   - Inferred work: align live deployment `greekMaxAgeMs` with the 45s source default or change poll cadence; remove the 15s hardcode in `scripts/src/signal-options-exit-policy-sweep.ts`; run a post-2026-06-16 greek/wire variant that produces non-missing greeks.

3. Real-greeks evidence pipeline, M, mostly can start now outside service ownership if scoped to scripts/backfill adapters.
   - Covers item 11 and the evidence-program side of item 10.
   - Inferred work: wire `gex_snapshots` into selector smoke/backfill or explicitly document why it is unsuitable; add bounded coverage guards by symbol/DTE; report when the dataset falls back to Black-Scholes reconstruction.

4. Config surface and UI deployment coherence, M, coordinate with UI/service owners.
   - Covers item 13.
   - Inferred work: expose the six `greekSelector` knobs as editable or intentionally read-only with server-owned profile selection; ensure UI-created deployments do not silently fall back to selector-disabled defaults when the tuned server profile is expected.

No fix work recommended for items 1, 4, 6, 8, or 9 beyond optional regression hardening. Observed caveat for item 9: the bar-age guard deliberately fails open when both timeframe and prior spacing are missing.
