# WO-TI-TICKER — TickerSearch provider-label behavior test (replace source-slicing)

Codex worker, /home/runner/workspace. Targets (verify BOTH clean first): test
artifacts/pyrus/src/features/platform/tickerSearch/TickerSearch.source.test.mjs and, if a seam is needed,
artifacts/pyrus/src/features/platform/tickerSearch/TickerSearch.jsx. Working-tree edit only, NO git
commands, no ~/.claude/ or .claude/skills/ or agents/ access. Unit tests only. Frontend → Vite hot-reloads.

PROBLEM (P3 test-integrity, CONFIRMED_REAL): the test reads TickerSearch.jsx and matches label/provider
snippets rather than rendering results with different provider arrays, so incorrect provider-label
behavior can pass while the strings remain.

FIX (do NOT weaken product behavior): render representative results with different provider arrays and
assert the VISIBLE provider labels are correct; OR extract a pure label/provider-resolver from
TickerSearch.jsx and unit-test it (wire the component to use it, no behavior change). AC: a wrong
provider-label mapping makes the test FAIL.

Verify: run the touched suite. Report: .codex-watch/wo-ti-ticker-report.md.
