# WO-01: Orphan uncommitted-diff disposition

You are `codex-worker` for `claude-lead` (session f68a9158). Repo `/home/runner/workspace`, branch `main`. Do NOT read `~/.claude/`, `.claude/skills/`, `agents/`. The working tree contains OTHER agents' WIP — obey SCOPE strictly.

## Context

Six small modified files sit in the tree unattributed to any live lane (verified 2026-07-07 ~13:50 MDT):

- `artifacts/pyrus/src/features/flow/FlowDistributionScannerPanel.jsx` — adds a "Premium Distribution" header label block (~12 lines)
- `artifacts/pyrus/src/screens/SettingsScreen.jsx` — diagnostics severity → tone mapping now handles error/critical (red) and warning/unknown/degraded (amber)
- `artifacts/pyrus/src/screens/DiagnosticsScreen.jsx` — small (~3 line) change
- `artifacts/pyrus/src/features/market/MultiChartGrid.jsx` — 1-line change
- `artifacts/pyrus/src/features/charting/pyrusSignalsPineAdapter.ts` — ~35-line simplification
- `lib/pyrus-signals-core/src/index.ts` (+ `index.test.ts`) — ~9-line change

Likely origins: frontend design-audit rounds 4/5 (`FRONTEND_AUDIT_ROUND5.md`, `242a10dc` handoff) or the calibration-lane display work (`1ce0161c`).

## Task

1. `git diff` each SCOPE file; attribute it by matching against: `FRONTEND_AUDIT_ROUND5.md` findings, `FRONTEND_AUDIT_ROUND2.md` ranked list, recent commits (`git log --oneline -20`), and July 5–7 handoffs mentioning the file (rg the repo-root `SESSION_HANDOFF_2026-07-0[5-7]_*.md`).
2. For each file decide: **commit** (part of a coherent completed change — group by theme), **keep** (in-progress work an identifiable lane still needs — name the lane), or **revert** (accidental/superseded).
3. Run the relevant checks before committing: `pnpm --filter @workspace/pyrus test` for JSX files touched by tests, `pnpm --filter @workspace/pyrus-signals-core test` for the core lib.
4. Commit approved groups with conventional messages (e.g. `fix(web): ...`), footer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. Do NOT push.

## SCOPE (only these may appear in your diff/commits)

The six files above + `lib/pyrus-signals-core/src/index.test.ts`. NEVER touch: `signal-monitor.ts`, `signal-options-automation.ts`, `backtesting.*`, `backtest-worker/**`, `SESSION_HANDOFF*`, `.codex-watch*` (except your report).

## Acceptance / verification

- Every SCOPE file is committed, explicitly kept (with owner named), or reverted — none left unexplained.
- Tests named above pass; `pnpm --filter @workspace/pyrus-signals-core run typecheck` clean.
- Final `git status --short` shows no SCOPE file dirty unless verdict was "keep".

## Deliverable

`.codex-watch/wo-01-orphan-diffs-report-2026-07-07.md`: per-file verdict, evidence for attribution, commit hashes created, and anything you could not attribute (say so plainly — do not guess).
