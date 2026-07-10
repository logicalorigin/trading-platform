# QA-SESSION-OVERLAP P2 fix report

Status: **DONE**

## Outcome

London/New York overlap bars now retain the exclusive `london` display label while
satisfying a selected `new_york` session filter. Python, TypeScript batch, and
TypeScript incremental evaluation agree at both 14:00 and 14:30 UTC.

## Observed root cause and fix

- Python `jobs.py` and both TypeScript evaluators derived a London-first exclusive
  `sessionKey`, then reused that display value as filter membership. At 14:00 UTC,
  the label was correctly `london`, but a `new_york` selection incorrectly failed.
- `python/pyrus_compute/src/pyrus_compute/jobs.py:466-490` now resolves interval
  membership independently and keeps the London-first key only for display.
  `_build_signal_filter_state` filters against the bar membership at lines 683-685.
- `lib/pyrus-signals-core/src/index.ts:827-861` now exposes the shared interval
  membership predicate while preserving the exclusive London-first key. The batch
  filter uses membership at lines 1123-1127.
- `lib/pyrus-signals-core/src/incremental.ts:431-435` reuses that predicate instead
  of its former duplicate exclusive-key matcher.
- `artifacts/api-server` required no production edit: its batch and incremental
  paths delegate to `@workspace/pyrus-signals-core`.

## Regression evidence

TDD RED before the production edit:

- `pnpm --filter @workspace/pyrus-signals-core exec tsx --test src/incremental-last-bar-closed.test.ts`
  failed the new overlap parity test with `false !== true` for `sessionPass`.
- `uv run pytest -q tests/test_signal_matrix_directional_features.py -k london_new_york_overlap`
  failed with `assert False is True` for Python `sessionPass`.

GREEN after the fix:

- `pnpm run python-compute:test` — **9 passed**.
- `pnpm --filter @workspace/pyrus-signals-core exec tsx --test src/incremental-last-bar-closed.test.ts`
  — **4 passed**. The 14:00/14:30 fixture pins `sessionKey=london`,
  `sessionPass=true`, `passes=true`, emitted signals, and batch/incremental equality.
- `pnpm --filter @workspace/pyrus-signals-core exec tsx --test src/index.test.ts`
  — **19 passed**.
- `pnpm run typecheck:libs` — **PASS**.
- `pnpm --filter @workspace/api-server run typecheck` in a temporary detached
  current-HEAD worktree with only this TS patch — **PASS**.
- Scoped `git diff --check` — **PASS**.
- Independent scoped review — **CLEAN** (confidence 9/10); no correctness,
  parity, alias, type, lint, performance, or scope findings.

The live dirty worktree's API typecheck also ran and reached five unrelated existing
errors in modified `artifacts/api-server/src/services/shadow-account-read-cache.test.ts`
at lines 1194, 1199, 1246, 1247, and 1252. That file was not edited or staged. The
isolated passing check above removes that concurrent-work contamination.

Supplemental `pnpm run python-compute:lint` remains baseline-red with 27 findings in
pre-existing lines outside this scoped diff (plus the unchanged `timezone.utc`
expression retained from the old `_signal_session_key`). No lint finding was
introduced by the new test or membership conditions.

## Scope discipline

- Changed only the Python implementation/test, the shared TS batch implementation,
  the TS incremental implementation/parity test, and this report.
- No restart, signal, push, database write, Replit control-plane action, or
  `SESSION_HANDOFF` file write was performed.
- Unrelated dirty working-tree files were preserved and will not be staged.

## Commit

`fix(sessions): overlap bars satisfy both session filters — label != membership (QA-SESSION-OVERLAP P2)`
