# WO-PV-PERF — performanceMetrics global listeners lack an uninstall path (P3, verified)

Codex worker, /home/runner/workspace. Target: artifacts/pyrus/src/features/platform/performanceMetrics.ts
(~:257, `installPyrusPerformanceMetrics`). Verify clean first; working-tree edit only, NO git commands,
no ~/.claude/ or .claude/skills/ or agents/ access. Unit tests only. Frontend → Vite hot-reloads.

PROBLEM (P3 lifecycle/listener retention, CONFIRMED_REAL): `installPyrusPerformanceMetrics` adds the API
timing listener and long-task observer once, but the hook cleanup removes only reporter intervals/
listeners; the global API-timing listener + long-task observer persist until `beforeunload` because
`metrics.installed` stays true — so HMR / remount / tests leak them.

FIX: provide a real uninstall path — return (or store) a disposer that removes the API timing listener
AND disconnects the long-task observer AND resets `metrics.installed` (so a later install re-registers
cleanly). Wire the hook cleanup to call it. AC: after uninstall, the global listener + observer are
gone and a subsequent install works; no leak across remount/HMR.

Verify: targeted test — install, uninstall, assert listener/observer removed and re-install succeeds.
Report: .codex-watch/wo-pv-perf-report.md.
