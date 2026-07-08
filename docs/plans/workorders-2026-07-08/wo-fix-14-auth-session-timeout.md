# WO-FIX-14 — Client timeout on /api/auth/session (fixes forever-LOADING boot gate)
Codex worker, /home/runner/workspace. Target: artifacts/pyrus/src/features/auth/authSession.jsx
(readAuthSession :14-23). Check `git status --porcelain --` first; file may be dirty (in-flight
LoginGate work) — preserve other hunks, working-tree edit, NO git commands.
Fix per verified design: merge an ~8s timeout signal into the fetch —
`const timeout = AbortSignal.timeout(8000); const merged = signal ? AbortSignal.any([signal, timeout]) : timeout;`
— so a hung request rejects; react-query (retry:false) flips isError and LoginGate falls through to
the sign-in wall (fail-closed, matching the comment at :13). Optional if trivial: same-style backstop
for NeuralBootOverlay opener mode (NeuralBootOverlay.tsx — static mode already has 12s).
Test: extend the auth/LoginGate test style — hung fetch -> isError within timeout. Run touched suites.
Report: .codex-watch/wo-fix-14-report.md.
