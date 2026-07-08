# WO-P1-T1b5-FLOW — historical-flow-events hydration sessions ignore holidays/half-days

Codex worker, /home/runner/workspace. Target:
artifacts/api-server/src/services/historical-flow-events.ts (~:297, clean). Working-tree edit only, NO
git commands, no ~/.claude/ or .claude/skills/ or agents/ access.

PROBLEM (T1b-5, P1 session-boundary): the session windows used for flow hydration are computed with
fixed hours / UTC and ignore NYSE holidays and half-days. Locate the session-window computation (~:297).

FIX: consume @workspace/market-calendar (resolveUsEquityMarketSession / listNyseEarlyCloses /
isNyseFullHoliday) so hydration session windows use real early-close/holiday data. AC: hydration
windows are correct on half-days and skip holidays.

Verify: targeted test with a half-day / holiday fixture. Run touched suites; paste output. Report:
.codex-watch/wo-p1-t1b5-flow-report.md.
