# Implementation Plan: July 1–7 Hanging Workstreams Completion

**Date:** 2026-07-07 (~13:45 MDT) · **Author:** session `f68a9158` (Fable lead) · **Source:** codex-agent survey of 177 session handoffs (July 1–7) + repo verification.

## Overview

A 6-worker codex survey of all July 1–7 handoffs found the genuinely unfinished work that no live agent currently owns. Many candidates turned out to be already landed (verified against git) — this plan covers only what survived verification, ordered so nothing collides with the three active lanes.

## Verified current state (evidence)

**Already done — excluded from this plan:**
- Multi-user Slice 8 frontend login gate → landed as `1d5e0b9d` (shadcn login-03 gate).
- Signal stale/aged arrows + Age column → landed via `3ccc3895`, `68298501`, `1ce0161c`.
- Bar-cache evaluation-worker prefetch wrapper → landed as `bc9aa7d7`.
- `perf/elu-loop-pressure-fixes` branch → 0 unmerged commits; fully in main.
- Robinhood foundation (oauth/custody/sync services + tests + `20260702_robinhood_agentic_foundation.sql`) → committed and clean in tree; only the live OAuth connect proof remains (user-gated, Task 10).
- IBKR market-data-path removal, compute/GEX bridge fixes, tax/wash-sale foundation (`20260706_tax_planning_foundation.sql`), Task #3 account tabs, Slice 7 entitlements (`d25b6901`) → all completed per handoffs + commits.

**Owned by live agents — excluded (do not dispatch):**
- Signal-options review findings/task list (peak-floor TTL #7, etc.) → `4f0c846b` (live, dispatching codex workers).
- Man-made throttle/cap/shed audit → `dbf9de08` + codex exec `019f3de8` (live).
- Overnight equities backtesting expectancy → codex `019f3dd2` (live; owns most of the current dirty tree).

**Surviving hanging/blocked work — this plan:** see task list. All six survey slices are in; July 1+3 additions are integrated below (calibration lane re-based on `f890fb57`, IBKR mount-base fix, SnapTrade QA, ELU levers). Also resolved by later evidence: `54de3be2`'s blocked GitHub push (main now in sync with origin) and the Jul 1 worktree-cleanup LIVE note (overtaken by landing1/landing2 + snapshot commit `0c284e27`; residue = Task 0.1).

## Execution model (owner directive)

Fable authors work orders only; implementation via `codex exec` (unsandboxed — bwrap broken in this container, owner-approved) or Opus subagents. Stagger codex launches ~20s (thread-exhaustion risk); background them (`run_in_background`, tsc ≈ 300s). Gate on tests + `tsc` scoped to the touched lane, per the running-tally PICKUP conventions.

## Re-verification pass (2026-07-07 ~13:55 MDT) + work orders

All tasks re-verified against HEAD after the afternoon's landings. Deltas: Schwab 3.1 re-scoped (service exists, routes missing); throttle-audit report landed at 13:02 (`.codex-watch/throttle-audit-2026-07-07.md` — no REMOVE-now items; RETUNE batch added as WO-05, gated on root fixes); tally lane advanced (`7d5445f2`/`929fcb94`/`cd1e3eb2` — WO-06 step 0 reconciles); orphan diffs still dirty; `audit_events` still absent; `directionalFeatures` code present in `jobs.py` but live verification still outstanding.

**Detailed codex work orders: `docs/plans/workorders-2026-07-07/`** (README has the dispatch board + conventions). Mapping: 0.1→WO-01, 0.2→WO-02, 1.1→WO-03, 1.2→WO-04, retune→WO-05, 2.1→WO-06, 2.2→WO-07, 3.1→WO-08, 3.2→WO-09, 3.3-pre→WO-10, 4.1→WO-11, 4.2→WO-12, 2.3a-fix→WO-13.

## Task List

### Phase 0 — Coordination gates (no code)

**Task 0.1: Disposition the orphan uncommitted UI diffs** — *S, no deps*
Small diffs sit unattributed in the tree: `FlowDistributionScannerPanel.jsx` ("Premium Distribution" label), `SettingsScreen.jsx` (diagnostics severity tone map), `DiagnosticsScreen.jsx`, `MultiChartGrid.jsx`, `pyrusSignalsPineAdapter.ts` (simplification), `lib/pyrus-signals-core/src/index.ts` (+ test).
- **Acceptance:** each diff attributed (likely Round-4/5 audit or calibration-lane residue), then committed on its theme or reverted; none left dangling.
- **Verify:** `git status --short` shows only files owned by live lanes (overnight-expectancy, signal-options WIP).
- **Caution:** do NOT touch `signal-monitor.ts`, `signal-options-automation.ts`, `backtesting.*`, `backtest-worker/*` — owned by live lanes.

**Task 0.2: Confirm running-tally remainder ownership with `4f0c846b`** — *XS, no deps*
The PICKUP doc (`docs/plans/2026-07-06-running-tally-PICKUP.md`) still lists: firehose write-cut → authority flip → allowance cache → shadow bake → flip on. `e61dae50` review shows tally shadow bake already running (`SIGNAL_OPTIONS_TALLY=shadow`) and drift self-repair landed (`929fcb94`); gate-flip checklist = review plan candidate 6, held by `4f0c846b`.
- **Acceptance:** one message/status check establishing which PICKUP steps `4f0c846b`'s lane covers; leftover steps (if any) become explicit tasks here.
- **Verify:** written ownership note added to this plan; no duplicate dispatch.

### Phase 1 — Correctness & DB pressure (dispatch after Phase 0)

**Task 1.1: Fix the second un-awaited bar-cache fan-out** — *S (1–2 files), deps: 0.1 + tree clearance*
`e89674ed` (Jul 6) found `persistSignalMonitorMatrixStatesBestEffort` runs DB reads outside any prefetch/background-read scope (`signal-monitor.ts`, `signal-monitor-local-bar-cache.ts`).
- **Acceptance:** persist path runs inside the intended prefetch scope; no fallback single-bar reads from that call site under load.
- **Verify:** `pnpm --filter @workspace/api-server test -- signal-monitor-local-bar-cache-prefetch` green; runtime check via `/api/diagnostics/runtime` fallback-read counters flat.
- **Gate:** `signal-monitor.ts` currently has another lane's events-cache residue — coordinate or wait for it to land first.

**Task 1.2: Startup/runtime audit leftovers from `019f398e`** — *M, deps: throttle-audit report*
Three open probes: startup-ordering `ECONNREFUSED` (Vite proxy before API up), market-data worker `pg` deprecation warning, slow `/api/accounts/shadow/orders`.
- **Acceptance:** each probe root-caused with file:line; fixes only where the throttle audit (dbf9de08's lane) doesn't already claim them.
- **Verify:** sanctioned SIGUSR2 reload + healthz 200; no `right.asOf.getTime` recurrence, no pg deprecation in fresh logs; shadow-orders p95 measured before/after.

### Phase 2 — Decisions that unblock work (user + small analysis)

**Task 2.1: Signal-score expected-move-v2 recalibration follow-up** — *M, no deps*
Latest calibration-lane state is `f890fb57` (Jul 3, supersedes the Jul 2 `reversion-sot-v3` vs `balanced-sot-v2` question — `ce6a2d36` shipped expected-move-v2 as the active scorer). Open list, verbatim from the handoff: regenerate observation dumps (`SIGNAL_QUALITY_OBSERVATION_DUMP_PATH`); compute P(score≥90 | MFE≥10/20/30%); fit per-TF isotonic/quantile calibration; fold continuous features; add magnitude-alignment axis; reconcile active model before commit. Prerequisite check from `7690f9ca` (Jul 1): confirm pyrus_compute `jobs.py` emits `filterState.directionalFeatures` on live STA rows (the compute-lane restart + live verification was never done).
- **Acceptance:** directionalFeatures confirmed live; dumps regenerated; calibration fits produced with metrics written to `docs/plans/`; model reconciliation proposal for user sign-off before any scorer config change.
- **Verify:** `signal-quality-kpis*` + `test_signal_matrix_directional_features.py` green; KPI refresh route returns sane metrics on the live deployment.

**Task 2.2: Round-5 frontend audit triage + batch selection** — *S analysis, then user picks*
`242a10dc` (Jul 6): Round-5 done, ~21/22 findings open awaiting owner remediation choices (`FRONTEND_AUDIT_ROUND5.md` + raw JSON). Rounds 2–4 partially absorbed by recolor batches — re-derive open set from current code, don't trust stale counts.
- **Acceptance:** open findings re-verified against HEAD; batched into ≤4 mechanical groups + judgment calls; user picks batches. Fold in the two dangling design decisions from `b03ee9be` (Jul 3): wire-or-delete the inert protan color mode, and the live-eyeball pass.
- **Verify:** each proposed batch names file:line and canonical replacement; `rg 'data-pyrus-color-mode'` documents protan's current state.

**Task 2.3: Two park-or-proceed decisions** — *XS, user*
(a) IBKR Client Portal hosted gateway: blocked externally twice (post-2FA login loop Jul 4, dead HTTPS tunnel Jul 5); no `packages/ibkr-connector` pivot exists. BUT the LIVE note (updated Jul 6) root-caused a `/api/Authenticator` mount-base bug in `routes/ibkr-portal.ts` with the fix decided and **not yet applied** — a cheap S-sized step before any park/fund decision. Recommendation: apply the mount-base fix, retry real login once (needs your IBKR creds + 2FA), then decide park vs microVM milestone.
(b) DB-pool P3 jsonb/payload offload (`docs/plans/2026-07-02-elu-p3-payload-jsonb-offload.md`): explicitly discussion-first; throttle-audit results may change its value. Decide after audit report. Related deferred levers from the Jul 1 ELU LIVE note (ELU-aware backfill pacing, `barsToPyrusSignalsBarEntries` memoization, matrix-eval offload) are queued behind the same audit — fold any survivors into Task 1.2.

### Phase 3 — Broker execution capability (`ca9f4967` remainder)

**Task 3.1: Schwab Phase 0d order routes** — *S/M, deps: none* — RE-SCOPED after verification
Half-built: `schwab-equity-orders.ts` service + tests EXIST and `broker-execution.ts` already imports the Submit/Preview/Cancel types — but only readiness/connect/callback/sync routes are registered. Remaining work is wiring the three order routes + guards + route tests (→ WO-08).
- **Acceptance:** three routes registered + spec'd, guard chain mirrors sibling order routes; tests for happy/not-ready/entitlement/malformed paths.
- **Verify:** route tests green; api-server typecheck; openapi codegen clean.

**Task 3.2: Schwab readiness re-auth blocker** — *S, deps: 3.1 or parallel*
- **Acceptance:** readiness probe distinguishes expired-refresh vs revoked; UI surfaces re-auth CTA instead of silent failure.
- **Verify:** unit test on readiness state machine; manual UI check.

**Task 3.3 (user-gated bundle):** IBKR OAuth live LST round-trip (needs 6 `IBKR_OAUTH_*` secrets), Robinhood live OAuth connect proof, Schwab developer-portal app approval + env credentials (blocks live Schwab auth, per `2e482682`), SnapTrade E*TRADE unfillable proof order (explicit per-action confirmation required; verify an execution-ready E*TRADE account still exists first).
- **Pre-step (agent-runnable, S):** mocked-state browser QA from `019f1eea` that no later session claimed — header SnapTrade broker popover, Settings SnapTrade panel, Trade-ticket SHARES route via `pnpm shot` with no live credentials.
- **Acceptance:** each proof documented in its plan doc with timestamped evidence.

### Phase 4 — Multi-user rollout completion

**Task 4.1: Slice 9 — `audit_events`** — *M, deps: none (Slice 8 landed)*
No audit_events migration exists (only tax tables reference the term).
- **Acceptance:** migration + write path for auth/entitlement/broker-mutation events, row-scoped per user, per `d6cc55a2` slice spec.
- **Verify:** migration applies; events written on login + broker connect in dev smoke.

**Task 4.2: Deferred multi-user domains triage** — *S analysis*
`feature_flags`, `algo_deployments`, `saved_scans`, `alert_rules` row-scoping + IBKR compliance flag + gateway reaping — confirm which are already covered by Slice 7 entitlements, produce follow-on slices only for real gaps.

### Phase 5 — Frontend Round-5 remediation (deps: 2.2 batch selection)

**Task 5.x:** one task per approved batch — *S each, mechanical, parallelizable across codex workers (staggered)*
- **Verify per batch:** screenshot pass via `pnpm shot` on affected screens (light+dark), `pnpm --filter @workspace/pyrus test` green.

### Checkpoints

- **After Phase 0:** tree contains only live-lane WIP; ownership notes written. 
- **After Phase 1:** targeted tests green; runtime counters verified via diagnostics MCP.
- **After Phase 2:** decisions recorded in this doc; batches approved.
- **After each of Phases 3–5:** typecheck + lane tests + SIGUSR2 reload + healthz + one `pnpm shot` visual.

## Risks & mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Collision with live lanes (signal-options, overnight-expectancy, throttle audit) | High | Phase 0 gates; never touch their named files until landed |
| Round 2–5 audit counts stale vs HEAD | Med | Task 2.2 re-derives open set from code, not docs |
| Codex workers wedge (thread exhaustion) or bwrap-fail | Med | Unsandboxed + staggered + rollout-fd health check (see memory note) |
| VM rotation mid-task (~every 6h at :17) | Med | Small tasks, commit per theme, autosave handoffs already active |
| User-gated proofs stall the broker phase | Low | Bundled in 3.3; everything else proceeds independently |

## Open questions (need Riley)

1. Round-5 remediation: greenlight mechanical batches wholesale, or review the batch list first (Task 2.2 output)?
2. IBKR CP hosted gateway: park or fund the microVM proof? (Task 2.3a)
3. Calibration: OK to flip scorer config on a positive Task 2.1 result, or decision-only?
4. Schedule for the three user-gated proofs (IBKR secrets, Robinhood login, E*TRADE proof order)?
5. P3 jsonb offload: revisit after throttle-audit report lands? (Task 2.3b)
