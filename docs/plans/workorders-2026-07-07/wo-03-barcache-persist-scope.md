# WO-03: Bar-cache persist prefetch-scope fix — GATED on WO-02 clearance

You are `codex-worker` for `claude-lead` (session f68a9158). Repo `/home/runner/workspace`, branch `main`. Do NOT read `~/.claude/`, `.claude/skills/`, `agents/`. Working tree has other agents' WIP — obey SCOPE.

## Gate (check first, abort politely if it fails)

Read `.codex-watch/wo-02-ownership-matrix-2026-07-07.md`. Proceed ONLY if it verdicts WO-03 safe-to-dispatch AND `git diff -- artifacts/api-server/src/services/signal-monitor.ts` shows no other lane's uncommitted changes overlapping the persist path (~lines 8900–9300). Otherwise write your report stating the block and STOP.

## Context

Investigation `e89674ed` (Jul 6 handoff) found a second un-awaited DB fan-out: `persistSignalMonitorMatrixStatesBestEffort` (declared `signal-monitor.ts:~8954`, called `~9230`) runs its DB reads OUTSIDE the local-bar-cache prefetch/background-read scope, leaking per-symbol fallback reads onto the shared 12-conn pool under load. The first fan-out was fixed in `bc9aa7d7` (evaluation-worker loop wrapped) — study that commit for the established scoping pattern (`git show bc9aa7d7`).

Related files: `artifacts/api-server/src/services/signal-monitor-local-bar-cache.ts` (scope helper), `signal-monitor-local-bar-cache-prefetch.test.ts` (existing test shape).

## Task

1. Read the call site and determine what data `persistSignalMonitorMatrixStatesBestEffort` actually reads (vs writes) and which reads can be served by the prefetch scope.
2. Wrap the call (or its read section) in the same prefetch/background-read scope used by `bc9aa7d7`, preserving best-effort semantics (persist failures must stay non-fatal).
3. Extend `signal-monitor-local-bar-cache-prefetch.test.ts` with a test proving the persist path performs zero fallback single-bar DB reads when the prefetch scope is warm.

## SCOPE

`artifacts/api-server/src/services/signal-monitor.ts` (persist path only), `signal-monitor-local-bar-cache.ts` (only if the helper needs an export), `signal-monitor-local-bar-cache-prefetch.test.ts`. Nothing else.

## Acceptance / verification

- `pnpm --filter @workspace/api-server test -- signal-monitor-local-bar-cache-prefetch` green, including the new test.
- `pnpm --filter @workspace/api-server test -- signal-monitor-completed-bars` still green (adjacent lane's tests must not regress).
- `pnpm --filter @workspace/api-server run typecheck`: zero errors in SCOPE files (ignore pre-existing errors elsewhere; list them).
- Scope-check: `git status` diff covers only SCOPE files. Do NOT commit — leave staged-ready and report; claude-lead lands it after the adjacent lane's residue clears.

## Deliverable

`.codex-watch/wo-03-barcache-persist-report-2026-07-07.md`: what was scoped, before/after read behavior, test evidence, and the exact diff summary (`git diff --stat`).
