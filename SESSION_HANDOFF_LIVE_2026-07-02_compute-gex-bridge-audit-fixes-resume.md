# LIVE — compute-gex-bridge-audit-fixes resume

- Session ID: c60d901f-6617-4549-ac3b-83ce6ebf24c3 (Claude, this session — resuming the workstream)
- Originating session: 1d93a427-473b-4d43-b8eb-28ba190290cb (Claude, 2026-07-02 12:27–13:19 MDT)
- Date: 2026-07-02 (MT)
- CWD: /home/runner/workspace · Branch: main · HEAD: 28314c4 (same anchor the plan was written against)

## Workstream identity

Execute the fix plan `docs/plans/2026-07-02-compute-gex-bridge-audit-fixes.md` (349 lines, untracked),
authored by session 1d93a427 from audit workflow `wf_4c2c649b-493` ("Audit the IBKR-bridge decoupling +
python compute offload + GEX migration"). Plan header says "For: Codex execution"; user said at
13:04 MDT "im going to pass this to codex to finish".

## Verified facts (observed 2026-07-02 ~13:55 MDT)

- NO session has executed the plan. H1's buggy code is still live: `_signal_trend_direction` in
  `python/pyrus_compute/src/pyrus_compute/jobs.py` (~:445) still defaults `direction = 1` (bullish)
  with no `basis_computable` guard.
- No Codex thread picked the plan up: rollouts 2026-07-02 13:09–13:15 (`019f243c-73f9…` parent +
  subagents) are the db-pool-ELU workstream; the single grep hit
  (`rollout-…13-15-18-019f2441-c5d6….jsonl`) is a read-only explorer that merely listed the untracked
  plan file in git status.
- Caution — concurrent workstream overlap: `jobs.py` (+120 lines, `_signal_directional_features`
  et al., mtime 13:07:55) and `signal-monitor.ts` (+150 lines) carry UNCOMMITTED changes from
  workstream A (signal calibration — see
  `SESSION_HANDOFF_LIVE_2026-07-02_workstream-a-signal-calibration-resume.md`). Plan line numbers in
  these two files have drifted; anchor on symbols. Do not commit or revert workstream-A hunks.

## Plan scope (priority order per plan §0)

H1 (python trend-direction parity, trading-impacting, live) → M1 (full-pipeline JS↔Python parity
test) → M2 (python-compute double-spawn race) → M3 (cold-start ignores caller budget) → L1
(unavailable-cell fallback) → L2–L7/I1–I4 (GEX+bridge hygiene batch). Suggested PRs: PR-1 (H1+M1,
python only), PR-2 (M2+M3+L1, api-server), PR-3 (hygiene batch).

## Current step

DONE PR-1: M1 pipeline parity fixture (generate-directional-features-parity.mts extended, new
signal-matrix-pipeline-parity.json, new test_full_pipeline_parity_with_js_golden_fixture) proved RED
(python [1,1,1] vs JS [0,0,0]); H1 fix applied to jobs.py _signal_trend_direction; pytest 6/6 +
mypy green (one-line pre-existing mypy fix: current_direction annotation, jobs.py
_signal_indicator_snapshot). NOTE: canonical test runner is `pnpm --filter @workspace/api-server
exec tsx --test <file>` — plan's "vitest" note is wrong (vitest not installed).
DONE PR-2: python-compute.ts M2 (startPromise coalescing + identity-checked child handlers), M3
(ensureHealthy(maxWaitMs) race + submitJob/getJob/cancelJob budget threading + waitForHealth
child-exit fail-fast), I1 (MAX_CONSECUTIVE_RESTARTS=10 cap + restartCount reset on healthy);
python-compute.test.ts 8/8. signal-monitor.ts L1 (status==="unavailable" → return null before state
build); signal-monitor-completed-bars.test.ts 55/55.
DONE PR-3 (fan-out wf_e92cd2fb-123, 5/5 agents, no failed verifications):
- gex.rs: L2 (theta/vega/mark/volume Option pass-through → JSON null) + I3 (dead massive branch
  deleted) + L4 doc comment on GEX_STALE_AFTER_SECS. cargo build release + fmt --check green.
- treasury-yield-curve.ts: L3 prior-month retry + 5-min unavailable TTL (6h kept for ok) + optional
  now() clock seam; new treasury-yield-curve.test.ts 4/4. Deviations declared: all unavailable forms
  (non-OK/thrown/empty) retry + get 5-min cached; retry skipped under TREASURY_YIELD_CURVE_URL.
- gex.ts: L4 role comments (both threshold sites), L5 zeroGammaMethod field (+ export of
  buildGexZeroGammaDataFromDashboard for tests, 3 new tests), I2 sorted-copy median.
- registry.py: L6 failure-branch delete of undesired handle-less line + _clear_task defensive drop;
  new FailingAdapter test, red-proofed against HEAD. 9/9 pytest.
- platform-bridge-health.ts: L7 future tickle → null age → not fresh; healthAgeMs>=0 guard on
  fallback (annotateBridgeHealth passes unclamped age into resolveBridgeConnectivity only); 41/41.
CENTRAL VERIFICATION green: api-server typecheck clean; tsx --test batch 113/113 across the 5
touched test files; pyrus_compute 6/6; ibkr_sidecar 9/9.
DONE adversarial verification (wf_2bb70343-a8b, 9 skeptic clusters): 8 clean incl. the critical
rust-null-vs-undefined consumer check (compactPersistedGexOption's typeof===number guards treat
null and undefined identically, so explicit nulls never reach clients), L6 re-desired race
(identity-guarded), L7 negative-age sweep, completeness critic (all 15 items implemented or
plan-sanctioned-skipped, invariants intact). ONE medium issue found and FIXED: client-aborted
requests poisoned the treasury cache with a 5-min unavailable — now `signal?.aborted` skips retry
and cache write (+ regression test); also added missing tmpdir cleanup in the budget test.
Post-fix: treasury 5/5 + python-compute 8/8 green.
DONE live smoke: SIGUSR2 to supervisor pid 89698 → API :8080/api/healthz 200, risk lane :18768 ok,
research lane :18770 ok (lanes respawned fresh on the fixed jobs.py); new-code markers
(zeroGammaMethod, restart-cap log) confirmed in live dist/index.mjs; public preview healthz 200.

## Post-rebuild re-verification (2026-07-02 ~15:05 MDT, user ran a rebuild)

New pid2-owned supervisor (210844 → …→ pid 24); API :8080 200, lanes :18768/:18770 ok, public
preview 200. Rebuilt dist/index.mjs (15:00) carries all fix markers (zeroGammaMethod, restart cap,
budget error, exited-during-startup). Source fixes intact. LIVE H1 END-TO-END PROBE PASS: posted
the h1-data-starved-htf-required fixture case to the running research lane → job completed,
signal null (suppressed), daily HTF direction null/pass=false. Test battery re-run: 114/114 tsx,
pyrus_compute 6/6, ibkr_sidecar 9/9.

## Status: WORKSTREAM COMPLETE — changes uncommitted, awaiting user review/commit

Suggested commit grouping per plan §"Suggested PR breakdown":
- PR-1 (python): jobs.py H1 + mypy annotation; tests/fixtures (generator, pipeline fixture, test) —
  note tests/ dir is untracked and shared with workstream-A.
- PR-2 (api-server dispatch): python-compute.ts + python-compute.test.ts;
  signal-monitor.ts L1 hunk + signal-monitor-completed-bars.test.ts (both files shared with
  workstream-A uncommitted changes — commit needs hunk-level care or lands together).
- PR-3 (hygiene): gex.rs, treasury-yield-curve.ts(+test), gex.ts,
  gex-zero-gamma-simulation.test.ts, registry.py(+test), platform-bridge-health.ts(+test).
I4 deliberately skipped (plan-optional). Plan doc's "vitest" toolbox refs are wrong → tsx --test.
