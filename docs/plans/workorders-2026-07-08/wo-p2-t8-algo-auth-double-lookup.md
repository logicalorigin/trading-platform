# WO-P2-T8 — /algo/* auth gate runs the session-lookup DB query twice per request

Codex worker, /home/runner/workspace. Target: artifacts/api-server/src/routes/index.ts (~:44-91, the
/algo/* path-prefix gate + per-handler gating). Verify clean first; working-tree edit only, NO git
commands, no ~/.claude/ or .claude/skills/ or agents/ access. Unit tests only.

PROBLEM (P2 perf, verified ≥0.85): /algo/* requests run the session-lookup DB query TWICE — once in the
path-prefix auth gate and again in per-handler gating. Locate both gate points.

FIX: perform the session lookup once per request and reuse it (memoize on the request object, e.g.
res.locals / a per-request cache) so the second gate consumes the first result instead of re-querying.
AC: one session-lookup DB query per /algo/* request; auth behavior (allow/deny) unchanged.

Verify: targeted test asserting the session lookup is invoked once per request across the prefix+handler
gates (spy/mock the lookup). Report: .codex-watch/wo-p2-t8-report.md.
