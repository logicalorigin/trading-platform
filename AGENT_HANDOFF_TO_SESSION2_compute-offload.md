# Handoff → Session 2 (`2494701e`) — Python compute-offload, ELU relief & prod core isolation

- **From:** session `f4ebf37d` (Claude Code) · **To:** Session 2 (`2494701e`, ELU/loop-relief lane)
- **Date:** 2026-07-01 · **Why:** user directed this whole thread to Session 2 so `f4ebf37d` can move to other work.
- **Also posted to:** `AGENT_CHAT.md` #246 and `SESSION_HANDOFF_LIVE_2026-07-01_f4ebf37d-python-compute-offload-verify.md` (this file duplicates that content standalone).

## 1. Verified state (read-only, no edits by me)
- **"Off the IBKR sidecar" is already true.** `python/ibkr_sidecar` hosts no heavy compute — deps are
  `fastapi/ib_async/pydantic/uvicorn` (no numpy/scipy/pandas); routes are only `/health` +
  `/market-data/generation`. It's a broker subscription lifecycle manager, not a compute service.
- **Heavy math already runs on our runtime (`pyrus_compute`).** Two lanes, both `/health` ok:
  risk `:18768` (greek_scenario_matrix, portfolio_optimization, portfolio_risk) and research `:18770`
  (benchmark_matrix, signal_matrix). Flags live: `PYRUS_PYTHON_{COMPUTE,GREEK,PORTFOLIO_RISK,RESEARCH,SIGNAL_MATRIX}_ENABLED=1`.
- **Dispatch is code-verified:** `greek_scenario_matrix` + `portfolio_risk` genuinely delegate
  (`account-greek-scenarios.ts`, `account-portfolio-risk.ts`); `signal_matrix` python is reached from the
  on-demand `buildFreshRuntimeMatrixResponse` → `resolveSignalMonitorMatrixPythonStates`
  (`signal-monitor.ts:11303`). The bare `evaluateSignalMonitorMatrix` (`:12127`) has NO prod caller —
  test-guarded out of the stream path.
- **`completedJobs=0` at probe is EXPLAINED, not broken:** account has 0 open positions →
  `account-portfolio-risk.ts:430` returns `status:"empty"` without dispatching (greek same); no fresh-matrix
  request fired in-window; a ~13:00 supervisor cold-restart reset the counters.

## 2. Prod core fact (resolves the "unused core" question)
- **Prod = Replit Reserved VM, DEDICATED 2 vCPU / 8 GiB — NOT autoscale** (user-confirmed).
- So there is **no idle/unused core** anywhere (prod == dev core count). The `cpu.max=800000/100000` some
  older notes read as "8 cores" is a CFS quota red herring; the 2-core cpuset is the real ceiling.
- ⚠️ `.replit` still says `deploymentTarget="autoscale"` → deploy-config reconciliation needed (do NOT edit
  unilaterally; it's behind the `audit:replit-startup` guard).

## 3. Real lever the "unused core" intuition maps to: CORE ISOLATION (prod-only)
On a **dedicated** VM (no noisy neighbors, unlike the dev box at load ~11), core isolation is viable:
- Pin **Node API → core 0** (trade-critical thread: socket drain, mark tick, SSE, order routing).
- Pin **`pyrus_compute` (both lanes) + `ibkr_sidecar` + rust market-data-worker → core 1**.
- Feasibility: `taskset` present (`/usr/bin/taskset`). Sites: API launch
  `artifacts/pyrus/.replit-artifact/artifact.toml:29` + `scripts/runDevApp.mjs`; compute spawn
  `python-compute.ts:395`. Prod gate: `NODE_ENV==="production"` (`logger.ts:3`).
- **MUST be prod-only / env-gated** — pinning on the oversubscribed dev box is HARMFUL. Not implemented.

## 4. Cheap loop-relief win (in YOUR file — yours to take)
- Memoize `buildSignalMonitorIndicatorSnapshot` per-tick MTF re-aggregation in `signal-monitor.ts` using the
  `:7517` fingerprint-memo pattern. Pure fn of (settings, completed bars), currently re-run every tick
  uncached. Trading-safe (advisory display, not order routing). Add a cached-vs-fresh parity assertion.

## 5. Un-offloadable ceiling (NOT a pyrus_compute job)
- pg/drizzle `bar_cache` decode (`_parseRowAsArray` + drizzle `mapFromDriverValue`, ~15-32%) stays on the
  Node thread because python receives pre-decoded bars. Relief needs a Node-side read owner / worker_thread
  — the `fix/bar-cache-rollup-churn` / `fix/bar-cache-persist-drain` worktrees' territory, not yours/mine.

## 6. Boundaries
- I touched NONE of the contended files: `signal-monitor.ts`, `shadow-account.ts`, `market-data-store.ts`.
- My only landed change is unrelated: Account-screen crash fix (`artifacts/pyrus/src/screens/AccountScreen.jsx`,
  restored dropped `getGetAccountOrdersQueryOptions` import; uncommitted, verified). Lane released to you.
