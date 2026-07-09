# WO-PV-DIAG — DiagnosticsScreen refreshes overlap / swallow failures (P3 ×2, verified)

Codex worker, /home/runner/workspace. Target: artifacts/pyrus/src/screens/DiagnosticsScreen.jsx (two
sites). Verify clean first; working-tree edit only, NO git commands, no ~/.claude/ or .claude/skills/ or
agents/ access. Unit tests only — NO browser/e2e. Frontend → Vite hot-reloads (no API restart). TWO
independent fixes, separate hunks.

FIX A (~:959, `loadHistoryAndEvents`): fires history/events requests immediately and every 60s with no
in-flight/generation guard, and failures are `.catch`-swallowed, so a slower older response can
overwrite newer `historyData`/`events` and errors leave stale state silently. Add a generation token
(or in-flight ref) so only the latest request commits state, and surface/record refresh failures
(error state, not silent).

FIX B (~:1009, browser metrics effect): `collectBrowserResourceMetrics(...).then(postClientMetrics)`
runs immediately + every 30s with only a cancel flag; the post promise is not awaited by the scheduler,
so slow collection/posting can overlap. Add an in-flight guard so the next sample does not start while
one is outstanding, and catch/report post failures intentionally.

AC: no overlapping refresh overwrites newer state; no overlapping metric posts; failures surfaced not
swallowed. Verify: targeted test (or documented manual check if a render test is impractical). Report:
.codex-watch/wo-pv-diag-report.md.
