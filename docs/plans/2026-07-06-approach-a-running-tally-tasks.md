# Implementation Plan — Approach A: signal-options push-native running tally

## Overview

Stop the signal-options worker rebuilding its entire picture from a 2×2,500-row read every tick.
Instead keep a per-deployment **in-memory running tally** (positions + dedup + allowance) that folds
only NEW events as deltas, reconciles against the authoritative shadow ledger on every position
open/close, and falls back to today's full rebuild on restart / config change / gap / drift. **No new
DB tables.** Ship dual-run (compute old + new, prove zero drift) behind an env flag, then flip
authority with instant rollback. **Step 1 (the position fold + incremental-equivalence test) is DONE
and verified.**

## Architecture decisions

1. **Projection lives in a module-level `Map<deploymentId, projection>` in `signal-options-automation.ts`**
   — mirrors the existing `signalOptionsActionCursors` pattern (module-scoped, survives ticks, empty
   on process restart). No changes to `signal-options-worker.ts` needed. Empty projection ⇒ full
   rebuild path (today's code) ⇒ seed. This is why restart recovery needs ZERO new persistence.
2. **Shadow ledger stays the ONLY source of truth.** The projection is a CACHE. Authority order:
   `shadow_positions/fills` (cash) > `execution_events` (decisions/marks) > in-memory tally.
3. **Ordering key is `occurred_at`** (event ids are random UUIDs, `occurred_at` is not unique). Tail
   reads use `occurred_at >= watermark − OVERLAP` and **dedup already-folded events by id** (bounded
   recently-folded id set). Watermark advances to the max `occurred_at` folded.
4. **The single per-event code path is `foldSignalOptionsPositionEvent`** (Step 1). Full rebuild =
   fold-from-empty; tally = fold-onto-retained-state. They cannot diverge by construction.
5. **Rollout is flag-gated and staged:** `SIGNAL_OPTIONS_TALLY=off` (today, default) →
   `=shadow` (dual-run + drift metric, full rebuild authoritative) → `=on` (tally authoritative +
   reconcile-on-state-change + periodic backstop). Instant rollback = set flag back.
6. **Dedup and allowance are folded too, but stay derived** — dedup recomputes retryability each tick
   over the retained (bounded) entry-skip set (retryability is a live function of profile/positions/
   allowance); allowance caches `realizedNet` keyed to the latest shadow fill id (a step function that
   only moves on a fill), deriving openCost/markAdjustment from the position tally.

## Dependency graph

```
Step 1 fold (DONE)
   └─ Task 2.1 tail-read query
         └─ Task 2.2 projection cache + incremental update
               └─ Task 2.3 dual-run + drift metric (flag=shadow)   ── CHECKPOINT: bake ──┐
                     ├─ Task 3.1 dedup in projection                                      │
                     ├─ Task 3.2 allowance cache                                          │
                     └─ Task 4.1 reconcile-on-open/close ── Task 4.2 restart/gap fallback │
                                                                 └─ Task 4.3 flip authority (flag=on) ─┘
                                                                       └─ Task 5.x cut the firehose at source
```

---

## Task list

### Phase 2 — Tail-read + projection (foundation, dual-run, ZERO behavior change)

#### Task 2.1: Watermark tail-read query
**Description:** Add `listDeploymentEventsSince(deploymentId, sinceExclusiveOverlap)` reading
`execution_events` where `deployment_id = ? AND event_type LIKE 'signal_options_%' AND occurred_at >= ?`
ordered `occurred_at ASC`, driven by the existing partial index `execution_events_sigopt_deploy_occurred_idx`.
No payload filter (the detoast trap — see the scope doc's live-DB finding). Sibling to
`listDeploymentEvents` (~automation.ts:2040).
**Acceptance criteria:**
- [ ] Returns exactly the signal-options events at/after the given timestamp for the deployment.
- [ ] EXPLAIN on the live DB shows an index scan (no seq scan, no payload detoast) — sub-ms.
**Verification:** unit test on the query shape; `EXPLAIN ANALYZE` against the live busy deployment.
**Dependencies:** None. **Files:** `signal-options-automation.ts`. **Scope:** S.

#### Task 2.2: Projection cache + incremental update
**Description:** Add `signalOptionsPositionProjections: Map<deploymentId, Projection>` where
`Projection = { foldState, watermark: Date|null, recentlyFoldedIds: Set<string>, configSignature }`.
Add `updateSignalOptionsProjection(deploymentId, opts)` that: on empty/stale projection → full rebuild
(fold from a full `listDeploymentEvents` read) + seed; else tail-read since `watermark − OVERLAP`, skip
ids in `recentlyFoldedIds`, fold the rest, advance the watermark, trim the id set. Invalidate on
config-signature change or retention gap (watermark older than the oldest available row).
**Acceptance criteria:**
- [ ] Incremental update (seed then N tail folds) yields positions byte-identical to
      `deriveActivePositions(fullWindow)` — golden test, extends `signal-options-position-fold.test.ts`.
- [ ] Config-signature change and a simulated retention gap both force a clean full rebuild.
- [ ] An event re-delivered inside the overlap window is folded at most once (dedup-by-id).
**Verification:** `node --test signal-options-position-fold.test.ts`; tsc.
**Dependencies:** 2.1. **Files:** `signal-options-automation.ts`, `signal-options-position-fold.test.ts`. **Scope:** M.

#### Task 2.3: Dual-run + drift metric (flag = shadow)
**Description:** Behind `SIGNAL_OPTIONS_TALLY` (off|shadow|on; default off): when `shadow`, each worker
tick computes BOTH the current full rebuild (authoritative, unchanged) AND the projection, diffs the
position sets, and emits a `signal_options_tally_drift` counter + a bounded log of divergences. The
full rebuild still drives every decision. Zero behavior change.
**Acceptance criteria:**
- [ ] With flag `off` the code path is byte-for-byte today's behavior.
- [ ] With flag `shadow` a drift counter is observable via diagnostics; positions still come from the
      full rebuild.
**Verification:** unit test asserting `off` ⇒ full-rebuild path only; runtime check of the counter in
`get_diagnostics`. **Dependencies:** 2.2. **Files:** `signal-options-automation.ts`, `signal-options-worker.ts` (flag read), diagnostics. **Scope:** M.

### CHECKPOINT — Bake #1 (positions)
- [ ] tsc 0 errors; fold tests + existing 33 automation tests pass.
- [ ] Flag `shadow` live; **position drift counter is a hard ZERO across ≥1 week + ≥2 VM rotations.**
- [ ] Review with owner before extending to dedup/allowance.

### Phase 3 — Fold dedup + allowance into the projection (still dual-run)

#### Task 3.1: Dedup in the projection
**Description:** Retain the bounded entry-skip set in the projection and recompute `seenSignalKeys`
each tick from it + the current positions/profile/allowance (retryability is a live function — do NOT
cache the seen-set itself). Diff against the full-window `seenSignalKeys` in shadow mode.
**Acceptance criteria:**
- [ ] Projection seen-set === full-window `seenSignalKeys` for every options combination (golden test).
- [ ] The retained skip set is bounded (retention/trim) and survives the tail-fold correctly.
**Verification:** golden test mirroring the Step-1 style; tsc.
**Dependencies:** 2.2. **Files:** `signal-options-automation.ts`, test. **Scope:** M.

#### Task 3.2: Allowance cache keyed to last fill
**Description:** Cache `realizedNet` in the projection keyed to `max(shadow_fills.id)` for the
deployment; recompute via `computeSignalOptionsLedgerRealizedForDeployment` only when a newer fill
exists. Derive `openCost`/`markAdjustment` from the position tally. Removes the per-tick full
shadow-ledger scan (`readShadowLedgerBundleForSource('automation')`).
**Acceptance criteria:**
- [ ] Allowance === today's value in shadow mode; cache invalidates the instant a new fill lands.
- [ ] No allowance drift across a simulated fill.
**Verification:** unit test on the cache-key logic; shadow-mode diff. **Dependencies:** 2.2. **Files:** `signal-options-automation.ts`, test. **Scope:** M.

### Phase 4 — Anti-drift reconcile + authority flip

#### Task 4.1: Reconcile-on-open/close
**Description:** Any tick that folds an ENTRY or EXIT runs the existing
`reconcileActivePositionsWithShadowLedger` (+ `recoverActivePositionsFromShadowLedger`) for that
deployment, overlays shadow cash onto the tally, and diffs. Mismatch → increment drift metric + force
a full rebuild this tick + reseed the projection.
**Acceptance criteria:**
- [ ] An injected tally/ledger mismatch is detected and self-repaired within one tick.
- [ ] Reconcile runs only on state-change ticks (not mark-only ticks) except the periodic backstop.
**Verification:** unit test injecting drift; assert repair. **Dependencies:** 3.1, 3.2. **Files:** `signal-options-automation.ts`, test. **Scope:** M.

#### Task 4.2: Restart / gap / config fallback hardening
**Description:** Ensure the empty-projection (restart), retention-gap, and config-signature-change
paths all cleanly full-rebuild + reseed, and a periodic max-staleness backstop forces a reconcile even
on long mark-only runs.
**Acceptance criteria:**
- [ ] Clearing the projection Map (simulated restart) ⇒ first tick full-rebuilds + seeds, second tick
      incremental, identical result.
- [ ] Staleness backstop fires on a mark-only streak.
**Verification:** unit tests for each fallback trigger. **Dependencies:** 4.1. **Files:** `signal-options-automation.ts`, test. **Scope:** S.

#### Task 4.3: Flip authority (flag = on)
**Description:** With `SIGNAL_OPTIONS_TALLY=on`, the scan uses the projection for positions/dedup/
allowance and reads only the tail (drop the two 2×2,500 full reads from the hot path), keeping
reconcile-on-state-change + the periodic backstop. Full rebuild remains the seed/repair path.
**Acceptance criteria:**
- [ ] With flag `on`, the hot path issues a tail read (not 2×2,500) and decisions match shadow-mode.
- [ ] Instant rollback: setting the flag back to `shadow`/`off` restores prior behavior with no restart.
**Verification:** runtime — confirm tail-only reads (query logs / EXPLAIN), drift stays zero, marks/
exits/entries flow. **Dependencies:** 4.2 + Bake #1 green. **Files:** `signal-options-automation.ts`. **Scope:** M.

### CHECKPOINT — Bake #2 (authority)
- [ ] Flag `on` for a subset of deployments; drift zero; pool-pressure/ELU measurably down.
- [ ] Owner sign-off before wide enable and before Phase 5.

### Phase 5 — Cut the firehose at the source (separate, gated)

#### Task 5.1: Audit + decide the display path
**Description:** With dedup in the tally, the ~78k/day `signal_options_candidate_skipped` ledger
writes are no longer needed for dedup. But 5 display/analytics consumers read them
(`candidateFromEvent`, `signalOptionsReadModelSummary`, `buildCockpitDiagnostics`, `buildRuleAdherence`,
`buildSignalOptionsPerformanceFromInputs`). Decide per consumer: drop, serve from a bounded in-memory
recent-skips buffer (NO table), or accept reduced display. **Owner product decision required.**
**Acceptance criteria:** [ ] A written per-consumer disposition approved by the owner.
**Verification:** N/A (decision task). **Dependencies:** 4.3. **Scope:** S.

#### Task 5.2: Stop writing the entry-skip firehose
**Description:** Per 5.1's decision, stop emitting entry-candidate skips to `execution_events`; feed
display from the in-memory buffer or drop it. Dedup already lives in the tally.
**Acceptance criteria:**
- [ ] Entry-skip ledger write rate drops toward zero; dedup still correct; approved display intact.
- [ ] `execution_events` read windows go naturally firehose-free (the parse cost the whole effort
      targeted disappears at the source).
**Verification:** runtime write-rate + dedup regression + display check. **Dependencies:** 5.1. **Files:** `signal-options-automation.ts` (emit sites) + the 5 consumers. **Scope:** M.

### CHECKPOINT — Complete
- [ ] Tail-only reads live; drift zero; firehose cut; pressure resolved; all tests pass; owner review.

---

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Tally drifts from ledger → duplicate/missed trade | **High** | Shadow-mode zero-drift bake before flip; reconcile-on-open/close; full-rebuild fallback; instant flag rollback |
| Backdated / out-of-order event missed by watermark | High | Tail read with `OVERLAP` safety window + dedup-by-id; state-change reconcile catches slips |
| `realizedNet` cache stale if fills settle async without an EXIT | High | Key the cache to `max(shadow_fills.id)`; any new fill forces recompute (verify fill-vs-exit timing in 3.2) |
| Mutation aliasing (fold mutates position objects) across dual-run | Med | Dual-run derives from separate reads → separate objects; compare by value, not identity |
| Daily-P&L accumulator crosses UTC midnight | Med | Key `dailyRealized` by UTC date; reset on rollover |
| Firehose cut breaks a display screen | Med | Task 5.1 per-consumer audit + owner decision before 5.2 |

## Open questions for the owner

1. **Firehose display (Task 5.1):** is showing "skipped candidates" in the UI essential? If yes, an
   in-memory bounded buffer (no table) or reduced display — which do you prefer?
2. **Bake duration / drift threshold:** is "hard zero drift across ≥1 week + ≥2 VM rotations"
   acceptable before flipping authority, or do you want longer/shorter?
3. **Rollout granularity:** flip authority all-deployments-at-once, or a canary subset first (Bake #2)?
4. **Scope now:** build through Task 4.3 (authority flip) this effort and defer Phase 5, or all of it?
