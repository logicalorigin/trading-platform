# WO-TI-SNAP — SnapTradeConnectPanel behavior test (replace source-slicing)

Codex worker, /home/runner/workspace. Targets (verify BOTH clean first, `git status --porcelain --`):
test artifacts/pyrus/src/screens/settings/SnapTradeConnectPanel.source.test.mjs and, if a testable seam
is needed, artifacts/pyrus/src/screens/settings/SnapTradeConnectPanel.jsx. Working-tree edit only, NO git
commands, no ~/.claude/ or .claude/skills/ or agents/ access. Unit tests only — NO browser/e2e. Frontend
→ Vite hot-reloads.

PROBLEM (P3 test-integrity, CONFIRMED_REAL): the test is source-sliced — it asserts strings/fragments
(`canManageSnapTradeConnections`, `openBrokerPopup`, QR/copy-link copy, memo fragments) instead of
exercising the connect/sync/handoff behavior, so real UI regressions can pass.

FIX (do NOT weaken product behavior): make the test exercise REAL behavior — render the panel with
mocked hooks across the key states (admin-gated vs not, connect/popup launch, sync states) and assert
observable outcomes; OR if mounting is heavy, extract a PURE decision/helper from SnapTradeConnectPanel.jsx
(e.g. the admission/connect-state resolver) and unit-test it, wiring the component to use it (no behavior
change). Keep only minimal source checks for non-behavioral import boundaries. AC: a behavior regression
(e.g. connect enabled when it should be gated) makes the test FAIL.

Verify: run the touched suite. Report: .codex-watch/wo-ti-snap-report.md (what/why, diff, test output).
