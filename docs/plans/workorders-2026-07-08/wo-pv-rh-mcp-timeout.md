# WO-PV-RH — Robinhood MCP requests have no timeout/abort (P2, verified)

Codex worker, /home/runner/workspace. Target: artifacts/api-server/src/providers/robinhood/mcp-client.ts
(`post()` ~:86 awaits `this.fetchImpl(...)` with no AbortSignal). Verify clean first
(`git status --porcelain --`); working-tree edit only, NO git commands, no ~/.claude/ or .claude/skills/
or agents/ access. Unit tests only — NO browser/e2e.

PROBLEM (P2 retry/timeout, CONFIRMED_REAL): `post` has no local timeout/abort; live call sites
(account sync / history / portfolio balance) await `session.callTool` directly, so a hung MCP endpoint
hangs user-facing broker operations indefinitely.

FIX (mirror the Schwab pattern just landed): add a per-request AbortController timeout in `post`
(configurable via client options + per-call override; sane default ~15s). On timeout, ABORT and throw a
distinct broker-facing timeout error (not a silent hang, not an indefinite await). Preserve the
`fetchImpl` test-injection seam. Keep existing non-timeout error handling intact. AC: a hanging
`fetchImpl` causes `post` to abort within the timeout and surface a timeout error; no indefinite hang.

Verify: new targeted test injecting a hanging fetchImpl → assert abort within timeout + timeout error.
Report: .codex-watch/wo-pv-rh-report.md (what/why, diff, test output, confirm finding real).
