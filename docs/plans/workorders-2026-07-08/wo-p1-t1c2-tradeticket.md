# WO-P1-T1c2 — TradeOrderTicket live-submit guard is source-sliced, not exercised (test-lie)

Codex worker, /home/runner/workspace. Targets (clean): test
artifacts/pyrus/src/features/trade/TradeOrderTicket.shadowBrokerGate.test.mjs (~:80 reads
TradeOrderTicket.jsx as TEXT + regex-checks branch order) and, for reference, the real guard in
artifacts/pyrus/src/features/trade/TradeOrderTicket.jsx (~:2075/:2336). Working-tree edit only, NO git
commands, no ~/.claude/ or .claude/skills/ or agents/ access.

PROBLEM (T1c-2, P1 test-integrity): the guard test asserts on the source text/branch order, so a
regression that calls a live broker mutation BEFORE the guard keeps the test green.

FIX (test only — do NOT weaken the product guard): make the test exercise real behavior — mount the
component with mocked mutations, or (preferred if mounting is heavy) extract a PURE submit/preview
decision function from TradeOrderTicket.jsx and unit-test it. Assert that a BLOCKED live submit never
invokes the live mutation. AC: a regression that fires a live mutation before the guard makes this
test FAIL. Verify by running the test (and, if you extract a fn, confirm the component still uses it —
no behavior change).

Frontend → Vite hot-reloads. Run the touched suite; paste output. Report:
.codex-watch/wo-p1-t1c2-report.md.
