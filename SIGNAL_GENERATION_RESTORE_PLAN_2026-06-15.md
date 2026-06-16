# Implementation Plan: Restore Matrix Signal Generation (2m/15m/1h/1d) + Remove Deprecated Signal Monitor

- Created: 2026-06-15
- **Revised: 2026-06-15 (this session)** — original root-cause theory (the canonical-event *delay/stale gate*) was **disproven by live data**; this revision replaces it with an evidence-grounded diagnosis. See "Superseded diagnosis" and "Evidence" below.
- Branch base: `chart-dropdown-bugfixes`
- Companion evidence: live DB + SSE probes captured this session (see Evidence appendix), `docs/backend-data-map.md` (ticker-emitted contract).

## Superseded diagnosis (what the original plan got wrong)

The original plan asserted the dark frames (2m/15m/1h/1d) were dark because the **delayed/stale-bar gate** (`canonicalSignalEvent: stale ? null`, `signal-monitor.ts:5462`) was nulling their canonical events. **Live evidence contradicts this:**

- The matrix stream is healthy and **not delayed** (`source: massive-websocket`, `delayed: false`, `lastEventAgeMs: ~34`).
- For 2m/15m the producer reports `status: "ok"` (not `stale`) with a **current** `latestBarAt`; the "delayed bar" condition is recorded only on **5m**.
- The failure is in signal **detection/availability**, upstream of the persist/gate logic — the latched `current_signal_at` itself never advances past Jun 12.

The original task list (reopen the gate → widen window → 1d supply → delete) is therefore retargeted below. The plan's *observation* (which frames are dark) was correct; its *mechanism and fix* were not.

## Environment scoping (critical — was missing)

There are **two** signal-monitor profiles:

| env | enabled | profile.timeframe | state |
|---|---|---|---|
| **paper** | **true** | 5m | **active** — evaluates every ~2s; this is what the app/STA shows |
| live | false | 5m | disabled, abandoned since 2026-06-01; ignore |

All real work is on the **paper** profile. Earlier confusion came from querying `signal_monitor_symbol_states`/`_events` without joining `signal_monitor_profiles` and splitting by environment. **Every DB/verification query below must filter to the paper profile.**

## Overview

On the **paper** profile, only **1m** and **5m** generate signals today; **2m/15m/1h/1d** have produced zero since Fri Jun 12. The two working frames have **independent generators** (1m native/passthrough; 5m via the `trade-monitor-worker`, whose `profile.timeframe` is 5m), which masks the fact that the **matrix producer** — the sole generator for 2m/15m/1h/1d — stopped producing new signals. Today (Mon Jun 15) is the first trading session since the Jun 12 changes, exposing it.

There are **two distinct failure modes**, not one:

- **Mode A — 2m/15m detection regression (good bars, no signal).** The producer loads **current** bars (2m ~120 bars, ample; 15m ~16, marginal), computes a trend, reports `status: ok` — but detects **no new crossover** since Jun 12. This is a detection/selection regression specific to the **minute→multi-minute aggregated** frames (1m passthrough is unaffected). It coincides with the Jun 11–12 commit cluster.
- **Mode B — 1h/1d fresh-bar availability (no bars).** The stream loader returns `[]` for 1d (`signal-monitor.ts:3384`) and ~4 bars for 1h (the 4h history cap at `:3398` ÷ 60m); `latestBarAt` is stale (Jun 12/11), `status: stale`. The producer can't load enough fresh bars to evaluate.

Goal: pin and fix Mode A, then Mode B, verify all six generate on the **paper** matrix producer, then delete the deprecated Signal Monitor worker + dead browser-pull code. The "Deployment Unavailable / blocked exec-change" banner is a **separate thread** (Phase 4), not caused by the above.

## What is ruled out (do not re-investigate without new evidence)

- **The delayed/stale-bar gate** (original Task 1). Stream is non-delayed; 2m/15m are `status: ok`. Reopening it fixes nothing.
- **The persist/`fresh` gate** (`shouldPersistCanonicalSignalMonitorEvent`, `:4271`). Detection itself does not advance the latch; there is no fresh candidate being dropped.
- **Stream health / delay** — verified healthy.
- **live/paper confusion** — resolved; paper is the active env.

## What is verified correct and must be kept

- **Item 2 frontend (this session): done + green.** `SignalsScreen.jsx` renders the table from matrix states (the `hasSignalData` gate, `:4631`) so a transient profile/state read no longer blanks a table that has signal data; contract test passes 3/3. Keep.
- **Trade-safety chain: verified end-to-end.** Execution refuses non-actionable signals: `isSignalOptionsActionableSignalSnapshot` blocks on `actionEligible === false || actionBlocker` (`signal-options-automation.ts:2481`, `:2487`); actionability derives `data_stale` from `status !== "ok"` (`signal-monitor-actionability.ts:56`, fed at `signal-monitor.ts:995`). So restoring generation for any non-fresh bar cannot, by itself, make it tradeable. Any fix must preserve this.
- **`options-flow-scanner` concurrency revert 8→2** (this session, DB-contention mitigation) — keep.
- **Cutover discipline:** fix → verify → delete, in one pass, so 5m never goes dark; deletion is the irreversible step and stays gated on a verified-generating SSE path + explicit user review.
- **Do NOT restore Era A** browser-pull (`evaluateSignalMonitorMatrix` / `useEvaluateSignalMonitorMatrix`).

---

## Task List

### Phase 0: Baseline + verification harness — DONE this session

- Recorded per-(env,timeframe) generation freshness; confirmed paper 2m/15m/1h/1d dark since Jun 12, 1m/5m live (Evidence appendix).
- **Repeatable check (paper only):**
  ```sql
  select p.environment, e.timeframe,
         count(*) filter (where e.created_at >= current_date) today,
         max(e.created_at) newest
  from signal_monitor_events e
  join signal_monitor_profiles p on p.id = e.profile_id
  where p.environment = 'paper'
  group by 1,2 order by 2;
  ```

### Phase 1: Pin + fix Mode A — 2m/15m detection regression (CORE)

**Task A1: Pin the exact regression.**
- Read `selectSignalMonitorSignalEvent(..., "stable-only")` (`signal-monitor.ts:3782` → its impl) and the aggregated-bar path (`aggregateStockMinuteAggregatesForSignalMonitorBars`, the 4h window in `loadSignalMonitorStreamCompletedBars` `:3392`–`:3398`).
- Bisect the Jun 11–12 cluster — prime suspects `c30c536` (gap-aware `barsSinceSignal`, large refactor) and `66e4b5c` ("repair signal matrix state pipeline"). Use a unit reproduction: feed a known 2m bar series with a crossover through `evaluateSignalMonitorMatrixStateFromCompletedBars` and assert a signal is detected.
- Acceptance: a failing test that reproduces "2m bars present, crossover exists, but no signal detected at HEAD" and passes at the pre-regression commit. **Scope: M**

**Task A2: Fix detection so 2m/15m emit new crossovers.**
- Fix the pinned cause (selector filter / window / aggregation) without weakening the trade-safety chain or the stable-signal contract (no provisional/unstable signals leaking into canonical events).
- Acceptance: paper 2m/15m `signal_monitor_events` resume within their bar cadence (verify via the Phase-0 query); the new test passes; backend suites green. **Scope: M**

### Phase 2: Fix Mode B — 1h/1d fresh-bar availability

**Task B1: Supply 1h enough completed bars.** Widen the stream history window per-timeframe (the 4h cap yields ~4 1h bars), bounded to avoid event-loop cost; or source 1h warmup from the provider once. Acceptance: 1h evaluates on current bars (`latestBarAt` current, `status: ok`) and resumes events. **Scope: S**

**Task B2: Make 1d generate through the producer.** Stream loader returns `[]` for 1d (`:3384`); bootstrap daily warmup from the provider (`loadSignalMonitorCompletedBars` supports 1d) into the producer's per-symbol cache, then evaluate + emit on the same push path. Respect the 1d boundary / heal-on-next-eval contract (`cfcda3f`). Acceptance: 1d generates on the producer path on its daily cadence. **Scope: S**

### Checkpoint 1 — All six generate on the PAPER matrix producer (before any deletion)
- [ ] paper `signal_monitor_events` fresh for 1m/2m/5m/15m within cadence; 1h/1d on their cadence.
- [ ] Confirm 5m still flows (worker still running) AND that the SSE producer independently covers 5m before deletion.
- [ ] Backend suites + `pnpm --filter @workspace/api-server typecheck` pass.
- [ ] Browser QA on paper: STA + Signals tables show fresh signals across frames.
- [ ] **Review with user before Phase 3.**

### Phase 3: Remove deprecated Signal Monitor (only after Checkpoint 1)
- **Task 4:** Delete `trade-monitor-worker` single-timeframe (5m) generation + retire `PYRUS_SIGNAL_MONITOR_BAR_EVALUATION_ENABLED`, once the SSE path verifiably generates 5m. Preserve non-generation duties (stops/marks live in `signal-options-position-tick-manager`, not the scan loop — confirmed via `e028665`). Run `audit:replit-startup` if startup wiring changes. **Scope: M**
- **Task 5:** Delete dead Era-A browser-pull (`evaluateSignalMonitorMatrix` `:8791`, `useEvaluateSignalMonitorMatrix`) now that the route is gone (`66e4b5c`). `pnpm run deadcode` clean. **Scope: M**

### Phase 4: Deployment-read resilience (SEPARATE thread; independent)
- **Task 6:** "Signal-Options Deployment Unavailable" + blocked exec-change on load. Hypothesis (unverified this session): transient `loadAlgoDeploymentList` read failure → `markDeploymentListError` → empty + `cacheStatus:"unavailable"` under startup contention (`automation.ts:~315`/`~350`). Make it serve last-good/seeded deployment on transient error; confirm `ensureDefaultSignalOptionsPaperDeployment` is idempotent and seeds first. Verify on a clean reload. **Scope: S**

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Detection fix lets unstable/provisional signals into canonical events | High | Preserve the `stable-only` selector contract; pin with a test that provisional signals stay out; trade-safety chain (actionEligible) still gates execution |
| Deleting the 5m worker before SSE covers 5m → 5m goes dark | High | Checkpoint 1 gates deletion on verified SSE 5m generation; worker stays until then |
| Widening 1h/1d bar windows inflates event-loop cost | Med | Per-timeframe scaled + capped window; verify no p95 regression |
| Mis-scoping to `live` (disabled) profile again | Med | All queries/verification filter `p.environment = 'paper'` |
| Dev DB shared (drizzle-kit push disabled after data-loss) | Med | No schema changes; SQL migration under `lib/db/migrations/` only if needed |

## Parallelization

- Sequential spine: Phase 0 (done) → **Task A1 → A2** → (B1, B2 parallel) → **Checkpoint 1** → Task 4 → 5.
- Phase 4 (deployment resilience) is independent — any time.
- Do NOT parallelize Phase 3 deletions with Phases 1–2 (deletion depends on verified generation).

## Open questions

1. Mode A fix: is the regression in the **selector** (`stable-only` dropping valid crossovers) or the **aggregated-bar series** (degenerate/short window)? Resolve in Task A1 before A2.
2. Task 4 cutover: verify "SSE generates 5m" by briefly quiescing the worker in a probe, or dark-launch behind a flag first?

## Evidence appendix (captured 2026-06-15 ~21:45–22:01 UTC, paper profile)

- **Events today by (env,frame):** paper 1m=42, 5m=335+, 2m=0, 15m=0, 1h=0, 1d=0. live: all 0 (disabled).
- **Newest latched signal, paper:** 1m 21:46, 5m 21:55, 2m **Jun 12 23:42**, 15m **Jun 12 19:45**, 1h **Jun 12 19:00**, 1d **Jun 11**.
- **2m events/day (paper):** Jun 11 **1732** → Jun 12 144 → Jun 13 88 → Jun 14 2 → Jun 15 **0** (cliff at Jun 12; today first session since).
- **Live SSE producer (paper), TSLA/NVDA/AAPL:** 2m/15m `latestBarAt` current (22:00/21:45), `status: ok`, trend computed (e.g. NVDA 2m `trend=bullish ageBars=5`), no new signal; 1h/1d `latestBarAt` stale (Jun 12/11), `status: stale`.
- **Stream status:** `source: massive-websocket`, `delayed: false`, `lastEventAgeMs: 34`, `fallbackState: streaming`.
- **Constants:** `SIGNAL_MONITOR_MATRIX_BARS_LIMIT = 240`; stream history cap `min(4h, …)` at `:3398`; 1d returns `[]` at `:3384`.
