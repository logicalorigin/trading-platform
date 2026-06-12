# Implementation Plan: Ticker→Trades Bug-Hunt Fixes

## STATUS: COMPLETE (2026-06-12)

- [x] Task 1 — `a677cea` options snapshot status seatbelt (shared actionability; stale blocked at zero bars)
- [x] Task 2 — `f0a886e`-range / committed with docs: 1d heal-on-next-eval contract pinned (SQL comment + source-contract test)
- [x] Task 3 — `910a5f3` tick-manager swap carries buffered ticks (the real loss path; the "gap" itself is one synchronous turn)
- [x] Task 4 — `b69fb6f` stop exits demand fallback marks ≤60s (marks still allowed to 3 min); skip diagnostic carries fallbackMarkAgeMs
- [x] Task 5 — CLEARED: daily-bar UTC/NY boundary behaves correctly; pinned by characterization tests (`f879e42`)
- [x] Task 6 — CONFIRMED+FIXED: delayed replays no longer displace live bars (`f879e42`)
- [x] Task 7 — CONFIRMED+FIXED: rejected admissions keep explicit owners' leases (`8754dc0`, scoped hunks; other workstream untouched)
- [x] Task 8 — `256dfa3` REST carries actionEligible/actionBlocker (scoped spec/codegen hunks); STA age inference deleted; rows without backend fields are ineligible by default
- CHECKPOINT B: backend 74/74 + STA battery 51/51 + bridge/admission 27/27 + tick-manager 2/2; both typechecks clean; audit:api-codegen current. LIVE-PROBE PENDING: the running API serves the pre-change bundle — after the next Replit Run App restart, verify `/api/signal-monitor/state` rows carry actionEligible/actionBlocker and STA verdicts stay stable across REST polls.

- Created: 2026-06-12 (follows SIGNAL_MATRIX_STATE_CONSOLIDATION_PLAN_2026-06-12.md)
- Source: four-agent bug hunt over the ticker → bars → signals → STA → options → shadow-trades trace, with the high-stakes claims hand-verified. Findings classified: 3 verified fix-worthy, 3 credible-unverified, rest cleared.

## Overview

Close out the verified defects from the bug hunt (eligibility-field wobble between feeds, the 1d repair blind spot, two stop-enforcement soft spots), add one cheap trading-safety seatbelt, and run verify-then-fix on the three credible-but-unconfirmed claims (daily-bar timezone boundary, delayed-bar overwrite, admission-rejection lease bookkeeping). Nothing here changes product behavior except where a bug is confirmed; every fix lands with a pinning test.

## Architecture Decisions

- **The REST spec fields are the real fix for the feed wobble** — no interim merge hacks; the flip-flop disappears when both feeds carry the same verdict fields.
- **Safety direction preserved everywhere**: every fix may only block more or display less until proven; nothing widens trade eligibility.
- **Verify before fixing** for the three unconfirmed claims: each gets a characterization test first; if the test passes on current code, the claim is closed as cleared, not "fixed."

## Task List

### Phase 1: Trading-safety seatbelt + my own defect (no dependencies, do first)

**Task 1: Status seatbelt in the options signal snapshot**
- Description: `buildSignalOptionsSignalSnapshot` (`signal-options-automation.ts:~2222`) computes `actionBlocker` from bar age only. The DB loader already filters `status = "ok"` (`:4637`), so stale signals can't reach it today — but the snapshot is the last gate before candidate exploration and should not depend on every caller pre-filtering. Route it through the shared `buildSignalMonitorActionability` (signal-monitor-actionability.ts) so a non-ok status yields `data_stale`/ineligible regardless of caller.
- Acceptance criteria:
  - [ ] Snapshot for a state with `status: "stale"` (or error/unavailable) → `actionEligible: false`, `actionBlocker: "data_stale"`, even with `barsSinceSignal: 0`.
  - [ ] Behavior for `status: "ok"` states unchanged (existing 15 automation tests still pass).
- Verification: `pnpm --filter @workspace/api-server exec tsx --test src/services/signal-options-automation.test.ts` + new test case; api-server typecheck.
- Dependencies: none. Files: `signal-options-automation.ts`, its test. **Scope: S**

**Task 2: 1d reconciliation age blind spot**
- Description: Identity adoption in `reconcileSignalMonitorSymbolStatesForProfile` resets `bars_since_signal = NULL` for all timeframes, but the recompute pass correctly excludes `1d` (trading days ≠ wall-clock days). Adopted 1d rows are age-less and action-blocked until the next daily evaluation rewrites them. Decision (recommended): keep NULL — it is the honest "unknown" and fails safe — but make it explicit: exclude nothing, document the 1d heal-on-next-eval contract in the SQL comment, and pin it with a test so the behavior is chosen, not accidental. (Alternative if the display gap matters: a small JS post-pass counting NYSE trading days via `@workspace/market-calendar` — costs a duplicate of eval logic; not recommended.)
- Acceptance criteria:
  - [ ] Test: adopted 1d row has `barsSinceSignal: null` and actionability `signal_age_unavailable` (blocked), and a subsequent 1d evaluation restores a numeric age.
  - [ ] SQL comment states the 1d contract explicitly.
- Verification: backend signal-monitor suites; api-server typecheck.
- Dependencies: none. Files: `signal-monitor.ts`, `signal-monitor-completed-bars.test.ts`. **Scope: XS-S**

### Checkpoint A (after Tasks 1-2)
- [ ] Backend suites green (signal-monitor 58+, signal-options 15+ with new cases), typecheck clean.

### Phase 2: Stop-enforcement hardening (money path)

**Task 3: Close the tick-manager resubscribe gap**
- Description: When a position's quote subscription is swapped (e.g., Greek requirement changes), `signal-options-position-tick-manager.ts:~276-287` releases the old runtime before installing the new one; a quote arriving in that window is dropped — and if it was the stop-trigger tick, enforcement slips to the next tick. Fix: make-before-break (install the replacement before releasing the old) or buffer quotes during the swap and replay them after install. Prefer make-before-break if the subscription layer tolerates a brief double-subscribe; otherwise buffer.
- Acceptance criteria:
  - [ ] Test: a quote delivered mid-swap is processed (stop enforcement runs on it), not dropped.
  - [ ] No duplicate enforcement from double-delivery during the overlap (exit-claim guard covers this — assert it).
- Verification: tick-manager test file (create if absent, following the worker test pattern with injected dependencies); api-server typecheck.
- Dependencies: none. Files: `signal-options-position-tick-manager.ts` + test. **Scope: S-M**

**Task 4: Stale-mark stop policy**
- Description: `isFreshShadowPositionMarkFallback` allows marks up to 3 minutes old (`SIGNAL_OPTIONS_SHADOW_MARK_FALLBACK_MAX_AGE_MS`, `signal-options-automation.ts:~204`) to drive stop decisions during data outages. A 3-minute-old price in a fast market can exit a position the live market wouldn't have. Proposed policy (NEEDS USER SIGN-OFF — open question 2): fallback marks may still *record* P&L marks, but **hard/trailing-stop exits require a mark fresher than 60 seconds**; when enforcement is skipped for staleness, record a diagnostic event so skipped enforcement is visible, and the next fresh tick enforces normally.
- Acceptance criteria:
  - [ ] Test: stop crossing on a 2-minute-old fallback mark does NOT exit; same crossing on a fresh tick does.
  - [ ] Skipped-enforcement diagnostic recorded with mark age.
- Verification: automation + tick-manager suites; api-server typecheck.
- Dependencies: Task 3 (same files; avoid conflicts). Files: `signal-options-automation.ts`, tests. **Scope: S-M**

### Checkpoint B (after Tasks 3-4)
- [ ] Suites green + typecheck; live sanity: open shadow position still marks and enforces on ticks (probe worker/tick-manager snapshot endpoints).
- [ ] User review of the stop-policy behavior change before it goes live in paper trading.

### Phase 3: Verify-then-fix (characterization test first; fix only if it fails)

**Task 5: Daily-bar timezone boundary**
- Description: `dailyBarDateKey`/`isSignalMonitorBarComplete` (`signal-monitor.ts:~2584-2706`) mix UTC-midnight date keys with NY-market date keys in string comparisons. Claim: around the date boundary a daily bar's completeness can be misjudged. Write characterization tests: daily bar timestamped `00:00Z`, evaluated at NY evening times either side of the boundary (and across DST). If a case misjudges, fix by normalizing both sides to the market date key.
- Acceptance criteria:
  - [ ] Boundary cases pinned by tests (pass = claim cleared; fail = fix + tests pass).
- Verification: `signal-monitor-completed-bars.test.ts`; typecheck.
- Dependencies: none. **Scope: S**

**Task 6: Delayed bar overwriting a fresh bar**
- Description: `mergeCompletedBars` (`signal-monitor.ts:~2754`) lets a later-processed bar replace an earlier one with the same timestamp regardless of `delayed`/source. Claim: a delayed replay can overwrite a fresh live bar. Characterize: merge fresh-then-delayed same-timestamp bars; assert the fresh bar survives. If it fails, prefer non-delayed (and live-source) bars on timestamp collisions.
- Acceptance criteria:
  - [ ] Collision cases pinned (fresh bar wins or claim cleared).
- Verification: same suite; typecheck.
- Dependencies: none. **Scope: S**

**Task 7: Admission-rejection lease bookkeeping**
- Description: `fetchBridgeQuoteSnapshots` (`bridge-quote-stream.ts:~1073-1092`) releases leases unconditionally on the all-rejected early return, while the normal path releases only for implicit owners. Claim: explicit-owner retries can hit stale lease state. Characterize with the existing market-data-admission test harness: explicit owner, all symbols rejected, then retry — assert admission state is clean. Fix the asymmetry if confirmed (release on the early return only for implicit owners, mirroring the finally block).
- Acceptance criteria:
  - [ ] Rejected-then-retry case pinned; explicit/implicit release symmetry matches the normal path.
- Verification: `bridge-quote-stream.test.ts` / `market-data-admission.test.ts`; typecheck. NOTE: these files carry another slice's uncommitted edits — commit only the hunks for this task or land after that slice (open question 1).
- Dependencies: none, but see commit-scoping note. **Scope: S**

### Phase 4: The real fix for the feed wobble (contract change)

**Task 8: REST spec carries actionEligible/actionBlocker; delete the STA fallback**
- Description: Add the two fields to the signal-monitor state response in `lib/api-spec/openapi.yaml`, regenerate `api-zod`/`api-client-react`, populate them in `stateToResponse` via `buildSignalMonitorActionability` (single author), then delete the frontend inference fallback: `STA_MAX_ACTIONABLE_BARS_SINCE_SIGNAL` + `staSignalAgeActionBlocker` + the inference branch in `algoHelpers.js:595-705`. This ends the REST/SSE equivalence wobble (both copies now carry identical verdict fields) and completes consolidation-plan Task 12.
- Acceptance criteria:
  - [ ] `pnpm run audit:api-codegen` clean; REST response carries the fields (live probe).
  - [ ] `rg "MAX_ACTIONABLE_BARS_SINCE_SIGNAL" artifacts/pyrus` → no hits; STA tests assert wire-fields-only.
  - [ ] Merge equivalence no longer flips between SSE/REST copies of the same cell (test with both copies carrying fields).
- Verification: codegen audit, backend + algo/frontend suites, both typechecks, live STA probe.
- Dependencies: **BLOCKED on resolving the openapi entanglement** (open question 1) — the spec + generated files carry another session's uncommitted quote-snapshot changes. Files: openapi.yaml, generated clients, `signal-monitor.ts`, `algoHelpers.js` + tests. **Scope: M**

### Checkpoint C — Complete
- [ ] All suites + both typechecks + codegen audit green.
- [ ] Live probes: STA verdicts stable across REST polls (no flicker), stops enforce on fresh ticks, skipped-stale-enforcement diagnostics visible.
- [ ] Browser QA pass on Signals/STA if available.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Task 4 changes live stop behavior (skips stale-mark exits) | High | Explicit user sign-off at Checkpoint B; diagnostic event makes every skipped enforcement visible; window length configurable |
| Task 8 mixed-slice commit (openapi entanglement) | Med | Resolve open question 1 first; otherwise commit spec hunks scoped to signal-monitor only |
| Task 3 double-subscribe during make-before-break trips admission line budget | Med | Overlap is per-position and momentary; assert lease counts in test; fall back to buffering approach if admission complains |
| Tasks 5-7 "fixes" for claims that aren't real | Low | Characterization-test-first: a passing test closes the claim with zero code change |

## Open Questions — RESOLVED by user interview (2026-06-12)

1. **openapi entanglement (Task 8):** RESOLVED — commit surgically **scoped hunks** of the spec + generated clients (signal-monitor fields only); other sessions' dirty spec changes stay uncommitted and untouched.
2. **Stop policy (Task 4):** RESOLVED — **wait for fresh data**: no stop fires from a mark older than 60s; skipped enforcement records a visible diagnostic; the next fresh tick enforces. User explicitly rejected firing on stale data.
3. **1d repair (Task 2):** RESOLVED — keep the fail-safe: reconciled 1d signals stay trade-blocked until their next daily evaluation; no trading-day age math.

Context from interview: system is paper today, headed live with **no timeline — the gate is confidence**. Fix properly over fix fast. Out of scope: other sessions' workstreams, sparkline/latency perf, live-trading enablement.

## Parallelization

- Tasks 1, 2, 5, 6 are independent — can run in any order or together.
- Task 3 → Task 4 sequential (same files).
- Task 7 independent but commit-scoped (see note).
- Task 8 last (contract change; depends on open question 1).
