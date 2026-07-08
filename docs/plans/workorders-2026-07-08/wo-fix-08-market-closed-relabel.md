# WO-FIX-08 — Truthful not-taken labels: entry_window_expired vs market_closed

Codex worker, PYRUS monorepo /home/runner/workspace, ONE fix. Files are now CLEAN (workstream
landed) — verify with `git status --porcelain -- <file>` (must be empty) then edit directly and
`git add -- <exact paths>` when done; NO commit (orchestrator commits). No files under ~/.claude/,
.claude/skills/, agents/; never modify agents/openai.yaml.

Discipline: ponytail; fact-first (re-verify every cite — line numbers may have shifted in landing);
labeling/telemetry ONLY — actionEligible stays false in both branches, zero trading behavior change.

## Design (orchestrator-approved; from today's trace)
Signals that fired DURING a live session but were never evaluated get stamped "market_closed"
post-close, masking starvation. Fix per the verified design:
1. artifacts/api-server/src/services/signal-monitor.ts: export
   `isSignalMonitorActionPausedMarketSessionAt(at: Date)` — thin wrapper on the existing private
   `isSignalMonitorActionPausedMarketSession` (~:4234).
2. artifacts/api-server/src/services/signal-monitor-actionability.ts: add optional input
   `signalFiredWhileMarketClosed?: boolean`; in the market_closed branch (~:84):
   `input.signalFiredWhileMarketClosed === false && input.signalAt != null` →
   `"entry_window_expired"` else `"market_closed"`. Default undefined preserves current output.
   Add `entry_window_expired` to the blocker type/enum wherever the type lives.
3. Callers pass the flag from the signal's fire time:
   signal-options-automation.ts ~:2631 (STA snapshot), signal-monitor.ts ~:1261 (REST) and
   ~:9984 (matrix stream): `signalFiredWhileMarketClosed: signalAt ? isSignalMonitorActionPausedMarketSessionAt(new Date(signalAt)) : undefined`.
4. Frontend: NO change (formatEnumLabel handles the new value). Do NOT touch algoHelpers.js.

## Tests
Extend signal-monitor-actionability.test.ts: (a) marketClosed + signalFiredWhileMarketClosed:false
→ entry_window_expired; (b) marketClosed + flag undefined/true → market_closed (existing precedence
tests stay green).
Run: `pnpm --filter @workspace/api-server exec tsx --test src/services/signal-monitor-actionability.test.ts src/services/signal-monitor-completed-bars.test.ts` — all pass, paste output.

## Deliverable
.codex-watch/wo-fix-08-report.md — what/why, diff, test output. Stage with git add -- <paths>; no commit.
