# WO-P1-T1 — PhotonicsObservatory force-graph rebuilds every live tick

Codex worker, /home/runner/workspace. Target: artifacts/pyrus/src/features/research/PhotonicsObservatory.jsx
(the d3 force-graph effect ~:3943). Verify clean first (`git status --porcelain --`); working-tree
edit only, NO git commands, no ~/.claude/ or .claude/skills/ or agents/ access.

PROBLEM (P1 perf): the useEffect that builds the d3 force-simulation lists liveData/liveFund in its
dependency array, so the ENTIRE graph (nodes+links+simulation) is torn down and rebuilt on every live
price tick. Locate it by that signature (a force-graph/simulation build whose deps include the live
data object).

FIX: build graph STRUCTURE once per structural change (node/link identity), and on live ticks update
node data (values/positions) WITHOUT recreating the simulation. Split into two effects (structure vs
data) or hold the sim in a ref and only re-seed datum values when liveData changes. Do not change the
visual result.

AC: simulation is created once per structural change; data-only live ticks mutate existing nodes, not
rebuild. Verify: existing research-screen tests; if none cover this, add a targeted test (or a
render-count assertion) proving the sim is not recreated on a data-only change, else document the
manual visual check. Frontend → Vite hot-reloads (no API restart).

Report: .codex-watch/wo-p1-t1-report.md (what/why, diff, test output).
