# Implementation Plan — Signal-Options Live-Money Push

Status: ACTIVE (2026-07-07). Owner-confirmed intent: live-money trustworthiness.
Sources: owner interview (2026-07-07), multi-agent review workflow `wf_dbde00bb-406`
(7 area reviews, 61 findings; verification 7/7 CONFIRMED so far, synthesis pending —
this plan is amendable when it lands), and
`docs/plans/2026-07-06-signal-options-push-native-redesign-scope.md` (fold redesign, Approach A).

## Overview

Take the signal-options strategy (stop loss, trailing stop, greeks) from its current state —
healthy tests, ~1,200 uncommitted fold-redesign lines, several confirmed real-money bugs — to
gate-flip readiness. Evidence bar (owner-set): **zero-drift shadow bake for the fold + hard tests
on the money paths** (stop breached while quotes dead, double-sell idempotency, restart
mid-position, gap-through-stop).

## Architecture Decisions (owner-directed, do not re-litigate)

- Shadow ledger (`execution_events` + `shadow_*`) is the SOLE source of truth; in-memory tally is a cache.
- NO new DB tables (sidecar tables rejected).
- Fold-first sequencing: land the in-flight redesign through its bake gate before strategy hardening
  on files it touches. Exception: confirmed surgical fixes in files OUTSIDE the fold blast radius
  (`signal-options-exit-policy.ts`, `lib/backtest-core/src/option-greek-selector.ts`) may proceed now.
- No threshold re-tuning, no strategy redesign. Complete the greeks integration; fix what's wrong.
- TDD for every fix: failing test first, then the fix, then full targeted suites.

## Task List

### Phase 0 — Confirmed surgical bug fixes (start now; no file overlap with fold work)

- [ ] **T1: Shadow-gate the wire/greek trail (enforce-gating hole)** — CONFIRMED high/bug.
  `usesWireTrail` activates the premium trail and `runner_trail_stop` is not shadow-gated, so the
  wire trail changes real exit behavior with the enforce gate OFF (`signal-options-exit-policy.ts:423-426`).
  AC: with enforce off, exit decisions are identical with `wireGreekTrail.enabled` on vs off; trail
  intent still emitted for diagnostics; existing gate tests keep passing.
  Verify: new failing test → pass; `signal-options-wire-trail-gate` + `exit-policy-wire` suites green.
  Deps: none. Scope: S (1-2 files).
- [ ] **T2: Fix `deltaSizedGiveback` unit mismatch** — CONFIRMED medium/bug.
  Per-contract dollars (×100) subtracted from per-share premium (`signal-options-exit-policy.ts:445-455`).
  AC: giveback computed per-share consistently; hand-computed call + put fixtures pin the math.
  Verify: failing test → pass. Deps: none. Scope: XS.
- [ ] **T3: Fix `gammaTheta` dimensional inconsistency in greek selector** — CONFIRMED medium/bug.
  Dollars vs premium-fraction mixed at `lib/backtest-core/src/option-greek-selector.ts:342-348`.
  AC: score components dimensionally consistent; fixture proves intended ranking. Wait for workflow
  end before editing (verifiers may still read this file).
  Verify: failing test → pass; selector suite green. Deps: workflow completion. Scope: S.

### Checkpoint 0
- [ ] `pnpm --filter @workspace/api-server run typecheck` clean; all signal-options suites pass.

### Phase 1 — Fold redesign completion (blocked on workflow synthesis; touches `signal-options-automation.ts` / worker)

- [ ] **T4: Drift detection + self-repair in authoritative mode** (plan step 4, never built).
  AC: folded ENTRY/EXIT triggers reconcile diff; mismatch increments a drift counter and forces a
  full rebuild that tick. Verify: unit test forcing an injected mismatch. Scope: M.
- [ ] **T5: Bake observability** — drift/fold counters surfaced via runtime diagnostics/flight
  recorder (no tables). AC: `get_runtime_diagnostics`/diagnostics route reports fold mode, drift
  count, last full-rebuild reason. Scope: S.
- [ ] **T6: Allowance cache keyed to latest fill** (plan step 3 remainder). AC: new fill forces
  authoritative recompute; no incremented counters. Scope: S.
- [ ] **T7: De-self-reference the fold equivalence golden** — corpus derived independently of the
  refactored code path. AC: golden test fails if fold diverges from committed derive semantics. Scope: S.
- [ ] **T8: Land + start bake** — commit fold work, enable shadow-mode fold flag (fold computes,
  full-derive stays authoritative), begin zero-drift bake across VM rotations.
  AC: SIGUSR2 reload; healthz 200; drift counter visible and zero. Scope: S.

### Checkpoint 1
- [ ] Fold running shadow-mode in the live dev app; drift observable and zero; suites green.

### Phase 2 — Money-path test hardening (parallel with bake; tests only, no behavior edits)

- [ ] **T9: Trailing-ratchet direct tests** — progressive steps, `minLockedGainPct` floor, giveback,
  takeover crossover (currently zero direct tests). Scope: S.
- [ ] **T10: Greek-trail positive path + stale/missing greeks** — rung ladder actually tightening;
  `resolveGreekFreshness` / `resolveWireGreekAdjustment` behavior on stale, missing, and
  missing-timestamp greeks. Scope: S.
- [ ] **T11: Overnight exit + force-stop/expiry failsafe tests** — `computeSignalOptionsOvernightPositionExit`
  and the last-resort forced close (both currently untested). Scope: M.
- [ ] **T12: Double-sell idempotency + gap-through-stop orchestration tests** — restart/claim-expiry
  double-sell protection (today asserted only in comments) and quote-unavailable stop breach →
  fallback exit fill. Scope: M.

### Checkpoint 2
- [ ] All four owner-named money paths pinned by failing-first tests, green.

### Phase 3 — Exit-execution + worker fixes (post-bake-start; most already CONFIRMED)

- [ ] **T13: Exit dedup closure** — flip-close bypasses the exit-claim guard; mark-time stop
  enforcement and expiration ledger-sync lack the force-close pass's existing-exit-event dedup.
  AC: injected duplicate-trigger tests prove single exit event per position. Scope: M.
- [ ] **T14: Tick-manager subscription lifecycle** — CONFIRMED: contract change on an open position
  permanently kills its push-tick subscription (owner-keyed release races the stale-key sweep,
  `signal-options-position-tick-manager.ts:116`); also `stop()` doesn't cancel in-flight reconcile.
  AC: contract-change test keeps ticks flowing; no post-stop resubscribe. Scope: M.

### Phase 4 — Greeks completion + config coherence

- [ ] **T15: Persist `entryGreeks` for synthetic-greek selections** — baseline consistency so the
  greek trail's entry-baseline comparisons are never silently absent. Scope: S.
- [ ] **T16: Config-surface coherence** — stranded-gate guard on the primary server-state path (not
  just fallback draft); reconcile UI vs backend default-profile disagreements; decide with owner
  whether greekSelector knobs get UI or stay tuned-baseline-only. Scope: M. **Open question for owner.**

### Phase 5 — Gate-flip readiness

- [ ] **T17: Bake evaluation + readiness checklist** — zero drift across ≥1 week incl. VM rotations;
  all checkpoints green; written go/no-go checklist for flipping live/enforce gates. Scope: S.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Editing files still being read by review verifiers | Low | Phase 0 limited to cleared files; Phases 1+ wait for workflow completion |
| T1 changes shadow exit behavior mid-comparison | Med | Land T1 before the bake starts (fold + derive share exit policy, so bake itself is unaffected) |
| Synthesis adds unknown findings | Med | Plan explicitly amendable; new findings triaged into phases |
| VM rotation during bake | Expected | Bake must span rotations; restart full-rebuild is the designed fallback |
| 19k-line `signal-options-automation.ts` edit risk | Med | Small diffs, failing-test-first, full suite + SIGUSR2 runtime verify per task |

## Open Questions (owner)

1. T16: should the greekSelector's 6 knobs get UI surface, or remain backend-tuned only?
2. Bake duration: is ~1 week (per the 2026-07-06 plan) still the bar, or gate on N VM rotations?
