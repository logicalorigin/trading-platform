# Implementation Plan: Signal Scoring Calibration Rework (score → expected-move mapping)

Status: DRAFT — awaiting user review (Checkpoint 0)
Author session: `f890fb57-c850-401d-adab-49ac7c281b3a` (2026-07-03), continuing workstream from `ce6a2d36-08b0-418b-b0b3-9995c8071769`
Audit source: Fable outside audit (agent `ad4adbe046ad415d6`), verdict "partially on-track" — findings recorded in `SESSION_HANDOFF_2026-07-03_f890fb57-c850-401d-adab-49ac7c281b3a.md`

## Overview

Goal (user, verbatim): "we are using the data that we have from the signal combinations and the resulting move of the underlying after the signal to improve our signal scoring system. a +30% move should be 90+, but we need to figure out what we need to add to our formulas math to properly pick up the conditions that predict it."

Constraint (user): fully offline — historical observation data only; no live-market dependency.

What the audit established: the current score is an uncalibrated hand-weighted formula whose raw base caps at 75.8; realized big movers (15m 70-80 bucket, n=9, avgMFE 36%) score ~70-76; expected-move-v2's quantized bonuses (+4/+9/+9/+8) broke the monotone ordering v1 had and the model fails the repo's own comparison gates (which rank on directional expectancy, not magnitude). The user's actual metric — P(score≥90 | big move) — has never been computed.

This plan: (1) rebuild the data foundation reproducibly, (2) measure the user's metric first, (3) replace cliff bonuses with continuous features + per-timeframe quantile/isotonic calibration so score bands *mean* outcome quantiles, (4) extend the comparison gates with a magnitude axis so the platform's own tooling can endorse the model, (5) commit in coherent slices.

## Architecture Decisions

- **Score semantics = calibrated outcome quantile, per timeframe.** Displayed 0-99 scale is kept; 90 ⇔ top-decile expected move for that TF's outcome horizon. A persisted score→expected-move% table makes cross-TF differences explicit (a 15m "92" and a 1h "92" map to different absolute %). Rationale: directly encodes "+30% movers should be 90+" once per-TF quantiles are fit, without re-educating every UI band/threshold.
- **Continuous features, not binary bonuses.** Mined conditions (volume spike, regime freshness, ATR thrust) enter the raw score as continuous terms (log volume ratio, 1/(1+regimeAgeBars), thrust magnitude), then the whole raw score is monotone-remapped. Kills the {0,4,13,30} cliff inversions structurally.
- **Measure before modeling.** The recall metric anchors targets; no scorer edits until Task 2's report exists and Checkpoint A settles target definitions.
- **New key `expected-move-v3`; v1/v2 stay in the registry for comparison.** v3 activates only after the (extended) gates support it. Resolves the shipped-model-vs-gates contradiction properly instead of ignoring it.
- **Reproducibility is a deliverable.** All dump/mining/fit tooling is committed (the prior round's scripts died with a /tmp scratchpad). Dumps go to a durable git-ignored dir, not /tmp.
- **Byte-locked trio discipline maintained:** `signal-quality-kpis.ts` (backend scorer + harness), `signal-options-automation.ts` (quality resolver + reasons), `algoHelpers.js` (frontend mirror) change together, with their suites.

## Dependency Graph

```
Task 1 (dump runner + dumps)
    ├── Task 2 (metric report)  ──► Checkpoint A (user: target defs)
    │                                   ├── Task 3 (continuous raw score, pure fn)
    │                                   │       └── Task 4 (per-TF calibration fit + mapping table)
    │                                   │               └── Task 5 (wire v3 into trio, inactive)
    │                                   └── Task 6 (magnitude axis in comparison gates)  [parallel with 3-5]
    │                                           └── Task 7 (harness comparison → activation decision)
    └── Task 8 (regimeAgeBars edge fix)  [independent; anytime after Task 1]
Task 0 (commit existing verified slices)  [user-gated; independent, recommended first]
Task 9 (commit rework slices)  [after 7]
Task 10 (regen generated API clients)  [optional, after 9]
```

## Task List

### Phase 0 — Baseline protection (user-gated)

#### Task 0: Commit the already-verified prior workstream in coherent slices
**Description:** The entire prior calibration lane is working-tree-only on `perf/elu-loop-pressure-fixes`. Committing it first protects it and makes every rework diff reviewable. Slices: (a) KPI horizon decoupling + outcomeTimeframe route draft, (b) market_closed blocker (gate precedence + frontend category + tests), (c) MTF requiredCount fix + trend-persistence fix + LONG/SHORT labels, (d) expected-move v1+v2 scorers + regimeAgeBars engine feature + tests, (e) observation-dump hook + audit enrichment.
**Acceptance criteria:**
- [ ] Each slice builds/typechecks independently and has a scoped conventional-commit message.
- [ ] No unrelated files (the branch also carries IBKR-sidecar-removal and other lanes — those are separate slices/owners, untouched here).
**Verification:** `pnpm run typecheck` at repo root; targeted suites per slice (`pnpm exec tsx --test src/services/signal-quality-kpis.test.ts src/services/signal-options-automation.test.ts` in `artifacts/api-server`; `node --test src/screens/algo/algoHelpers.test.mjs` in `artifacts/pyrus`; `pnpm exec tsx --test src/index.test.ts` in `lib/pyrus-signals-core`).
**Dependencies:** None. **Blocked on:** explicit user go (user said "commit when I say done").
**Files:** the prior session's changed set (see handoff). **Scope:** M (mechanical, but careful file selection).

### Phase 1 — Reproducible data foundation

#### Task 1: Committed observation-dump runner
**Description:** A committed tsx script that regenerates raw observation JSONL per timeframe by calling `refreshDeploymentSignalQualityKpiSnapshot` directly with a draft override (`{ signalTimeframe: "5m" | "15m" | "1h" }`) and `SIGNAL_QUALITY_OBSERVATION_DUMP_PATH` set in-process (hook at `artifacts/api-server/src/services/signal-quality-kpis-service.ts:983`). No API reload, no live market — runs against `bar_cache` history. Output to a durable git-ignored dir (`.pyrus-runtime/calibration/observations-<tf>.jsonl`), overwriting per run (delete-then-append; the hook appends). Follow the import pattern of `scripts/src/backfill-signal-monitor-events.ts` (workspace imports + direct service call); add a `pnpm` script entry in `scripts/package.json` (precedent: `signal-options:exit-policy-sweep`).
**Acceptance criteria:**
- [ ] One command dumps all three TFs for deployment `7e2e4e6f-749f-4e65-a011-87d3559a23b0` in ~6 min.
- [ ] Each JSONL has a header line (`resolvedTimeframe`, `outcomeHorizonBars`, `count`) and >0 observation rows carrying the scorer inputs (volumeRatio20, regimeAgeBars, ATR/thrust fields, MTF directions, session timing) and outcome fields (MFE et al.).
- [ ] Re-running replaces (not double-appends) the files; `.pyrus-runtime/calibration/` is git-ignored (add if missing).
**Verification:** `wc -l` per file > header count; `head -1 | python3 -m json.tool` shows header; one sampled row contains the expected keys; second run produces same-order-of-magnitude counts.
**Dependencies:** None. **Files:** `scripts/src/signal-scoring-observation-dump.ts` (new), `scripts/package.json`, possibly `.gitignore`. **Scope:** S.

#### Task 2: The user's metric — big-mover recall report
**Description:** Committed analysis script over Task 1 dumps producing the anchor report: per TF × direction, P(score≥90 | MFE≥10/20/30%) and P(score≥75 | same), plus the full score distribution (deciles) of big movers — computed for raw base, expected-move-v1, and expected-move-v2 (recompute scores from dumped features using the exported scorer functions; do NOT re-derive formulas in the script). Include per-cell n, and the precision direction (P(MFE≥X | score≥90)) alongside for contrast.
**Acceptance criteria:**
- [ ] Markdown + JSON report exists (e.g. `.pyrus-runtime/calibration/big-mover-recall.md/.json`) with every cell populated or explicitly n=0.
- [ ] States the horizon definition used (MFE within `outcomeHorizonBars` per TF) and dump timestamps.
- [ ] Sanity cross-check reproduced: the 15m score band holding avgMFE ≈ 36% appears (auditor's persisted-data observation).
**Verification:** script run is deterministic on the same dumps; cross-check against persisted KPI buckets via `GET /api/algo/deployments/7e2e4e6f-.../signal-quality-kpis`.
**Dependencies:** Task 1. **Files:** `scripts/src/signal-scoring-recall-report.ts` (new), `scripts/package.json`. **Scope:** S-M.

### Checkpoint A — user review (decides modeling targets)
- [ ] Report reviewed; answers "what do +30% movers score today."
- [ ] Open questions 1-3 (below) decided: horizon definition, per-TF score meaning, recall/precision trade target.
- [ ] Go/no-go on Phase 2 design.

### Phase 2 — Calibration model (`expected-move-v3`)

#### Task 3: Continuous conviction terms in a new raw score (pure function + tests)
**Description:** New pure function `expectedMoveRawScoreV3` in `signal-quality-kpis.ts` (exported for the fit script): v1's raw shape with the extreme-vol term reviewed (root cause of the 75-90 adverse-selection cohort) and the mined conditions as continuous terms — log-scaled volume ratio, freshness `1/(1+regimeAgeBars)`, thrust magnitude (ATR multiples) — no binary cliffs, no clamp yet (calibration owns the output range). Unit tests assert monotonicity in each feature and no interaction cliffs.
**Acceptance criteria:**
- [ ] Property-style tests: raising volumeRatio20 / lowering regimeAgeBars / raising thrust never lowers the raw score.
- [ ] v1 raw reproduced as the degenerate case documented in the test (regression anchor).
**Verification:** `pnpm exec tsx --test src/services/signal-quality-kpis.test.ts` green; typecheck.
**Dependencies:** Checkpoint A. **Files:** `artifacts/api-server/src/services/signal-quality-kpis.ts`, its test. **Scope:** S-M.

#### Task 4: Per-TF isotonic/quantile calibration fit + persisted mapping
**Description:** Committed fit script: per TF, isotonic (or monotone quantile) regression of outcome (median MFE and P(MFE≥X)) on `expectedMoveRawScoreV3`, validated with rolling-origin temporal splits and a forward-window embargo ≥ `outcomeHorizonBars` (kills the 26-bar overlap leakage). Output: a versioned mapping constant (raw score → displayed 0-99 quantile score → expected-move% table) committed as data (TS/JSON) consumed by the scorer, plus a validation report (recall AND precision vs v1/v2 from Task 2 baselines, per TF, train/test).
**Acceptance criteria:**
- [ ] v3 displayed score is monotone on held-out avgMFE at decade granularity on all 3 TFs (0 inversions; v2 had 14/21, 11/21, 8/21).
- [ ] Recall at 90+: P(score≥90 | MFE≥30%) beats v2's measured baseline on ≥2 of 3 TFs without precision at 90+ dropping below v1's baseline (exact numeric targets fixed at Checkpoint A from Task 2's report).
- [ ] Mapping table committed with fit metadata (data window, split scheme, embargo, git hash of fit script).
**Verification:** fit script rerun reproduces the table bit-identically from the same dumps; validation report checked in alongside.
**Dependencies:** Tasks 2, 3. **Files:** `scripts/src/signal-scoring-calibration-fit.ts` (new), mapping constant module (new, under `artifacts/api-server/src/services/`), `scripts/package.json`. **Scope:** M.

#### Task 5: Wire `expected-move-v3` into the trio (inactive)
**Description:** Register `expected-move-v3` in the score-model registry and `DEFAULT_SCORE_MODEL_COMPARISON_KEYS` (`signal-quality-kpis.ts:830`); implement the automation-side quality resolver (conviction components → continuous; re-derive the "ignition" reason from a calibrated threshold instead of `conviction>=13`); mirror in `algoHelpers.js` byte-consistently (mapping table shipped to frontend or mirrored constant). ACTIVE model stays v2 until Task 7.
**Acceptance criteria:**
- [ ] All three mirrors produce identical scores for shared fixture inputs (extend the existing parity tests).
- [ ] "ignition"/reason strings still render from the new continuous conviction (threshold documented).
- [ ] Registry lists v3; comparison harness scores it automatically.
**Verification:** api-server suites + `node --test src/screens/algo/algoHelpers.test.mjs` + `pnpm exec tsc -b lib/pyrus-signals-core`; repo typecheck.
**Dependencies:** Task 4. **Files:** the trio + tests. **Scope:** M.

### Checkpoint B
- [ ] Fresh sweep: v3 appears in `scoreModelComparisons` on all TFs; no suite regressions; report v3 vs all keys.

### Phase 3 — Gates + activation

#### Task 6: Magnitude-alignment axis in the comparison gates
**Description:** `buildScoreModelAlignment` (`signal-quality-kpis.ts:754`) ranks on directional `expectancyPercent` only, which structurally refutes magnitude models (v2 alignment -4.6/-7.7/-2.0). Add a second axis: avgMFE monotonicity/lift across score buckets, surfaced in `scoreModelComparisons` and in the recommendation gate constants (~301-311) so a model can be "supported" on the axis it targets, with the model's declared objective (directional vs magnitude) part of its registry entry.
**Acceptance criteria:**
- [ ] Comparison output exposes both axes per model; recommendation logic documents which axis gates which objective.
- [ ] Unit tests: a synthetic monotone-on-MFE model passes magnitude axis while failing expectancy axis, and vice versa.
**Verification:** kpis suite green; fresh sweep shows both axes populated.
**Dependencies:** none on 3-5 (parallelizable after Task 1); merge before Task 7. **Files:** `signal-quality-kpis.ts` + test; possibly `signal-quality-kpis-service.ts` response type. **Scope:** M.

#### Task 7: Activation decision (user sign-off)
**Description:** Run the full comparison on fresh sweeps; if v3 is supported on the magnitude axis on all 3 TFs, flip ACTIVE to v3 across the trio; else iterate Phase 2 with findings. Product-behavior change → user approves the flip.
**Acceptance criteria:**
- [ ] Gate evidence attached (per-TF alignment numbers); ACTIVE flip is a one-line change per mirror; suites green.
**Verification:** sweep after flip shows v3 as active/observed-score source; parity tests still green.
**Dependencies:** Tasks 5, 6. **Scope:** XS-S.

#### Task 8: `regimeAgeBars` window-edge fix (audit finding 5, minor)
**Description:** Engine fills age=1 at the loaded-window start (`lib/pyrus-signals-core/src/index.ts` ~1107 walk stops at bar 0) → spurious "fresh" flags near window edges. Emit undefined/null age when the flip predates the window (unknown ≠ fresh); freshness term treats unknown as not-fresh (matches existing old-row behavior).
**Acceptance criteria:**
- [ ] Test: regime unchanged since bar 0 of the window → age is unknown, not 1; freshness term contributes 0.
**Verification:** `pnpm exec tsx --test src/index.test.ts` in `lib/pyrus-signals-core`; `tsc -b lib/pyrus-signals-core`.
**Dependencies:** Task 1 (so re-dump captures the fix). **Files:** engine + test; possibly kpis feature read. **Scope:** S.

### Phase 4 — Durability

#### Task 9: Commit the rework in coherent slices
Slices: dump/report/fit tooling; v3 scorer + mapping; gates axis; activation flip; regimeAgeBars fix. Same verification battery as Task 0. **User-gated.**

#### Task 10 (optional): Regenerate generated API clients
`SignalScoreModelKey` enums in `lib/api-spec` / `lib/api-zod` / `lib/api-client-react` lag (reversion-sot-v3, expected-move-v1/v2, now v3). No runtime consumer validates against them (grep-verified), so cosmetic — do last.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Overfitting round 2 (fit script tuned until numbers look good) | High | Temporal rolling-origin CV + ≥horizon embargo; targets pre-registered at Checkpoint A; final holdout window touched once |
| Small n at the top band (1h 90+ was n=30) | Med | Quantile targets sized from population; report CIs; never gate on n<30 cells |
| Score-meaning change ripples into UI bands / "ignition" reason / any score>threshold consumer | Med | Task 5 includes a consumer audit (grep score-band thresholds in `artifacts/pyrus`); 0-99 scale + band semantics preserved by design |
| Market-wide volume-spike clustering inflates effective n | Med | Report per-day/per-event cluster counts in Task 4 validation; consider per-day dedup sensitivity check |
| Old persisted rows lack `regimeAgeBars` | Low | KPI harness recomputes features from bars (verified in prior session); dumps are freshly computed |
| Dump/fit drift (tooling lost again) | Low | Everything committed under `scripts/src/`; dumps in durable git-ignored dir; mapping table carries fit metadata |
| The branch carries unrelated uncommitted lanes | Med | Task 0/9 slice by explicit file lists; never `git add -A` |

## Open Questions (answer at Checkpoint A)

1. **Horizon definition:** "+30% move" = MFE within each TF's `outcomeHorizonBars` (currently 26 bars of the signal TF — ~2h on 5m vs ~26h on 1h)? Or a fixed wall-clock horizon via the drafted `outcomeTimeframe` decoupling? Default proposal: per-TF 26-bar MFE (matches existing KPI machinery); revisit after v3 lands.
2. **Per-TF score meaning:** confirm 90 ⇔ top-decile *of that timeframe* (same number, different absolute %, explicit in the mapping table) is the desired semantics.
3. **Recall/precision trade:** what recall at 90+ justifies how much precision loss? Set numeric targets from Task 2's measured baselines.
4. **Task 0 timing:** commit the existing verified lane now (recommended) or defer to Task 9?

## Parallelization

- After Task 1: Task 2, Task 6, Task 8 are mutually independent (three agents/sessions safe).
- Tasks 3→4→5 are a strict chain. Task 7 needs 5+6.
- Task 0 is independent of everything (file-selection care only).
