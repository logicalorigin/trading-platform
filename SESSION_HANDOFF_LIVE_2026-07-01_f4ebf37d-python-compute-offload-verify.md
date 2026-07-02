# LIVE Session Handoff — Python compute-offload verification + core-sizing (coordination note)

- Session ID: `f4ebf37d-567d-492e-8ae0-2f7fd3a4128a` (Claude Code, opus-4-8[1m])
- Updated (MT): `2026-07-01 13:09 MDT`
- CWD: `/home/runner/workspace`, branch `main`, HEAD `86ae9bc` (dirty multi-session tree)
- Workstream: resumed `48237695` trading-blocker removal → user asks to confirm python compute is off the
  IBKR sidecar / on our runtime, using "the unused core". READ-ONLY verification lane (no hot-path edits).

## ⚠️ COORDINATION — active parallel agents (do NOT collide)
- **Session 2 (`2494701e`) owns the ELU / event-loop-relief lane.** Per its LIVE note (updated 12:58):
  landed `shadow-account.ts` read-cache version split; **roadmap claims next levers = bar-cache
  ingest/prefetch inter-chunk yielding + signal-monitor `/state` serialize TTL.** → I do NOT touch
  `shadow-account.ts`, `signal-monitor.ts`, or the bar-cache ingest path.
- **Worktrees `fix/bar-cache-rollup-churn` + `fix/bar-cache-persist-drain`** own the bar_cache /
  `market-data-store.ts` pg-decode "wall". → I do NOT touch `market-data-store.ts` / bar_cache.
- **MY LANE (non-overlapping, this session):** `pyrus_compute` offload verification (read-only), prod
  core-sizing investigation, and the Account-screen crash fix already landed (see below). No edits to any
  contended file.

## ✅ Landed this session (uncommitted)
- **Account screen root-crash fix** — `artifacts/pyrus/src/screens/AccountScreen.jsx`: restored the dropped
  named import `getGetAccountOrdersQueryOptions` (from `@workspace/api-client-react`; export exists at
  `lib/api-client-react/src/generated/api.ts:3111`). Usage at `:1362` (account-switch prefetch) had no
  import → `ReferenceError` → `PlatformErrorBoundary` root-crashed the whole screen. Frontend-only (Vite
  HMR). Verified: `?screen=account` loads 200, screen renders fully, no ReferenceError. Swept all of
  `pyrus` — no other `getGet*QueryOptions` dangling refs. (This is a 4th uncommitted change on top of
  session 48237695's 3; nothing committed.)

## 🔎 Compute-offload map (source + live-probe verified — the answer)
- **"Off the IBKR sidecar" is already true by construction.** `python/ibkr_sidecar` deps = fastapi/
  ib_async/pydantic/uvicorn (NO numpy/scipy/pandas); routes = `/health` + `/market-data/generation` only.
  It is a broker market-data subscription lifecycle manager, never a compute host.
- **Heavy math lives on OUR runtime, `pyrus_compute`** (numpy/scipy). Two lanes, both `/health` ok:
  risk `:18768` (greek_scenario_matrix, portfolio_optimization, portfolio_risk); research `:18770`
  (benchmark_matrix, signal_matrix). Flags live: `PYRUS_PYTHON_{COMPUTE,GREEK,PORTFOLIO_RISK,RESEARCH,
  SIGNAL_MATRIX}_ENABLED=1`.
- **Live dispatch is code-verified:** greek + portfolio_risk genuinely delegate (`account-greek-scenarios.ts`,
  `account-portfolio-risk.ts`); signal_matrix python reached via `evaluateSignalMonitorMatrixSymbol` →
  `resolveSignalMonitorMatrixPythonStates` (`signal-monitor.ts:11303`) from the on-demand
  `buildFreshRuntimeMatrixResponse` builder (`:12042/12077`). The bare `evaluateSignalMonitorMatrix`
  (`:12127`) has NO prod caller — it is test-guarded OUT of the stream path (deliberate).
- **`completedJobs=0` at probe is EXPLAINED, not a bug:** account has 0 open positions →
  `account-portfolio-risk.ts:430` returns `status:"empty"` WITHOUT dispatching (same for greek); +
  no fresh-matrix request fired in-window; + a ~13:00 supervisor cold restart reset the counters.
- **NOT on our runtime (and NOT a pyrus_compute job):** the real loop pressure — (a) per-tick SSE signal
  eval (synchronous `evaluateSignalMonitorMatrixState*`, can't await python; ~10-12%) and (b) pg/drizzle
  `bar_cache` row decode (`_parseRowAsArray`, ~15-32%, "the wall"; python gets pre-decoded bars). These
  are Session 2 + bar-cache-worktree territory, not mine.

## 🧮 "Unused core" — assessment
- Dev container: `nproc=2`, `cpuset.cpus.effective=0-1`, loadavg ~11 (~5.5× oversubscription), nothing
  pinned. `cpu.max=800000/100000` (=8) is a CFS QUOTA, not 8 physical cores — the 2-core cpuset is the
  real ceiling (the historical "8-core" handoff notes misread the quota). **No spare core in dev.** Only
  headroom = Postgres is out-of-container (`PGHOST=helium`), which is I/O relief, not a free core.
- **Prod (user-confirmed) = Replit Reserved VM, DEDICATED 2 vCPU / 8 GiB — NOT autoscale.** So there is
  NO idle/unused core anywhere (prod == dev core count). The "unused core" premise is retired.
- **BUT the intuition maps to a real lever on a DEDICATED VM: core isolation.** Pin Node API → core 0
  (trade loop: socket drain, mark tick, SSE, orders); pin `pyrus_compute` (both lanes) + `ibkr_sidecar` +
  rust market-data-worker → core 1. `taskset` present (`/usr/bin/taskset`). Sites: API launch
  `artifacts/pyrus/.replit-artifact/artifact.toml:29` + `scripts/runDevApp.mjs`; compute spawn
  `python-compute.ts:395`; prod gate `NODE_ENV==="production"` (`logger.ts:3`). MUST be prod-only — pinning
  on the oversubscribed dev box (load ~11) is HARMFUL. `.replit` still says `deploymentTarget="autoscale"`
  → deploy-config reconciliation flag (do not edit unilaterally; `audit:replit-startup` gate).

## STATUS: ✅ HANDED OFF TO SESSION 2 (`2494701e`) — user directed 2026-07-01 13:16
This whole thread (compute-offload finish, ELU relief, core isolation) is now Session 2's. Handoff posted
to `AGENT_CHAT.md` #246. Items handed over:
1. **Cheap loop win (their file):** memoize `buildSignalMonitorIndicatorSnapshot` per-tick MTF
   re-aggregation (`signal-monitor.ts`, `:7517` fingerprint-memo pattern) — pure fn, trading-safe.
2. **Prod core isolation (prod-only, env-gated):** design per the core-sizing section above.
3. **Un-offloadable ceiling:** pg `bar_cache` decode (~15-32%) → Node-side read owner / worker_thread
   (the `fix/bar-cache-*` worktrees' territory), NOT a pyrus_compute job.

This session (`f4ebf37d`) is releasing the lane and moving to other work. Only landed change here: the
Account-screen crash fix (`AccountScreen.jsx`, uncommitted, verified). No contended files touched.
