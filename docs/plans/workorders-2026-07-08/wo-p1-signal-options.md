# WO-P1-SIGNAL-OPTIONS — signal-options-automation: NY-session day + commissions + backfill end

Codex worker, /home/runner/workspace. Target:
artifacts/api-server/src/services/signal-options-automation.ts (clean; already imports
@workspace/market-calendar at :35). Working-tree edit only, NO git commands, no ~/.claude/ or
.claude/skills/ or agents/ access. THREE independent fixes, SEPARATE hunk sets. Locate each site by
description (huge file); verify the finding before editing.

FIX A (T1b-1, ~:18807) — the daily-loss halt window is keyed by UTC day, not the NY trading session.
Compute the day key via NY session (market-calendar: resolveNyseCalendarDay / session-for-date), so the
daily loss resets on the NY session boundary, not 00:00 UTC. (Sibling site in backtest-worker is handled
separately — do NOT touch other files.)

FIX B (T1b-2, ~:8271) — signal-options daily P&L ignores commissions/fees. Include commission/fees in
the daily P&L used for the loss halt and reporting. AC: P&L is net of commissions.

FIX C (T1b-5, ~:17053) — backfill default END boundary is fixed/UTC. Use the market-calendar session
end (respecting early-close/holiday) for the default backfill end. AC: backfill end respects the
session/holiday calendar.

Run the touched signal-options suites for each fix; paste output. Report:
.codex-watch/wo-p1-signal-options-report.md (per-fix what/why, diff, test output).
