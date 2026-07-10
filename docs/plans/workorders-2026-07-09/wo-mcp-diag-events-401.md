# WO-MCP-401 — restore list_diagnostic_events after WO-FIX-10 auth gate (task #6)

Dispatched by Claude session 26888663 (2026-07-09 ~13:50 MDT), Riley-approved. Worker: codex sol.
Report to: `.codex-watch/wo-mcp-diag-events-401-report.md`. Edits UNCOMMITTED; touch ONLY
artifacts/mcp-server (plus its package.json/lockfile if a workspace dep is added). Do NOT touch
artifacts/api-server auth/routes — commit 18f4fa65 (WO-FIX-10) gated /diagnostics/events behind
requireUser deliberately and the posture stays.

## Problem
mcp-server's `list_diagnostic_events` tool GETs `/diagnostics/events` with no credentials
(artifacts/mcp-server/src/http/api-client.ts:26 sends only `accept`) → 401 since WO-FIX-10.
Events live in the `diagnostic_events` Postgres table (lib/db schema `diagnosticEventsTable`;
written by artifacts/api-server/src/services/diagnostics.ts:3425). The mcp-server runs in the same
container with DATABASE_URL in env — reading the table directly adds no new trust surface.

## Fix (ponytail)
1. Reimplement the `list_diagnostic_events` tool to SELECT from `diagnostic_events` directly:
   - Preferred: import the workspace db lib (`@workspace/db` / lib/db) for schema + a tiny lazy pool
     (max 1 connection, created on first use, idle-released). If the mcp-server build cannot take
     that dependency cleanly, fall back to a minimal `pg` client with a hand-written parameterized
     SELECT. If neither works in its build, STOP and report — do not hack the API.
   - Preserve the tool's existing input contract exactly (from/to ISO window, subsystem, severity)
     and output shape (match what the HTTP endpoint returned: the listDiagnosticEvents result shape
     in artifacts/api-server/src/services/diagnostics.ts:4739 — same field names, order by lastSeenAt
     desc, default limit 200 max 1000).
2. Graceful degradation: if the DB is unreachable, return the same kind of structured error message
   the tool's HTTP failure produced (so callers see "DB unreachable", not a stack trace).
3. Check the sibling tool `list_recorder_incidents` and any other mcp-server tool that calls a
   requireUser-gated GET (cross-check routes in artifacts/api-server/src/routes/diagnostics.ts against
   the mcp registry endpoints) — list any others that are now broken; fix them the same way ONLY if
   they read a DB table; otherwise just report them.

## Verification
- mcp-server typecheck/build clean (use its package scripts).
- A live smoke test: run the tool handler directly (node) against the real DATABASE_URL and show it
  returns events (severity=warning, last 24h) — the same data the 401 blocked.
- List modified files.
