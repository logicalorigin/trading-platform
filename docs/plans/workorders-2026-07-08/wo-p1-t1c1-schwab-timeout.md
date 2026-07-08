# WO-P1-T1c1 — Schwab Trader API: per-request timeout / abort / reconcile (no blind retry)

Codex worker, /home/runner/workspace. Targets (all clean): primary
artifacts/api-server/src/providers/schwab/trader-api-client.ts (`request()` :108 builds fetch init with
NO signal); callers artifacts/api-server/src/services/schwab-equity-orders.ts (~:439/:466) and
artifacts/api-server/src/routes/broker-execution.ts (~:410). Working-tree edit only, NO git commands,
no ~/.claude/ or .claude/skills/ or agents/ access. One logical fix across these files.

PROBLEM (T1c-1, P1 retry/feedback): `request()` has no timeout/abort/circuit-breaker. A hung request
pins the live order-submit path (callers await it directly) and encourages blind retry that stacks
broker calls — real money risk.

FIX: add a per-request AbortController timeout inside `request()` (sane default, e.g. 15s; allow
override via options). On timeout, surface a DISTINCT "unknown / needs-reconcile" outcome — NOT a
thrown generic failure that invites an immediate retry, and NOT a silent success. Update the live-submit
callers (schwab-equity-orders, broker-execution) to treat the timeout/unknown outcome as
reconcile-needed (do not auto-retry the submit). Keep existing non-timeout error handling intact.

AC: a hung fetch causes `request()` to abort within the timeout; the order-submit callers mark
reconcile rather than retrying; no retry-stacking on timeout. Verify: new targeted test injecting a
hanging fetchImpl → assert abort within timeout + caller marks reconcile (no second submit). Run
touched api-server suites; paste output.

Report: .codex-watch/wo-p1-t1c1-report.md.
