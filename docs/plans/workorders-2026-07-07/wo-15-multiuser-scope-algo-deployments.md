# WO-15: Multi-user Slice 10 — user-scope `algo_deployments` reads + cross-user leak sweep (TOP PRIORITY)

You are `codex-worker` for `claude-lead` (session f68a9158). Repo `/home/runner/workspace`, branch `main`. Do NOT read `~/.claude/`, `.claude/skills/`, `agents/`. Read-only DB allowed via `cd lib/db && node -e` with pg + `$DATABASE_URL` (information_schema only). Owner requirement: **multi-user must be safe TODAY** — land what is safely landable tonight, report precisely what is not.

## Context

WO-12 (`.codex-watch/wo-12-deferred-domains-2026-07-07.md`) verified: authenticated members can read GLOBAL automation deployments and their events — routes require login (Slice 6/8) but the service queries have no user predicate. Slice 7 landed entitlements (`d25b6901`, `entitlements.ts`); Slice 9 landed `audit_events` (`7a6d612c`, applied). Study the Slice 7 commit for the established scoping pattern and where user identity lives on the request.

## CRITICAL constraint — dirty-tree collision discipline

`artifacts/api-server/src/services/automation.ts`, `services/platform.ts`, `routes/platform.ts`, `services/diagnostics.ts` currently carry OTHER lanes' uncommitted changes. Before editing ANY file: `git diff -- <file>` and check whether your target functions/regions overlap existing hunks. If a needed edit overlaps another lane's hunk, do NOT edit there — implement the user predicate at the nearest clean layer (e.g., route-level filter or a new small scoped-read helper module) and record the conflict in your report. Never revert or absorb another lane's hunks.

## Task

1. **Sweep first (read-only):** enumerate every authenticated route that reads shared/global tables (`algo_deployments`, `algo_runs`, `execution_events`, `signal_monitor_*`, watchlists, backtests, accounts) and classify each: user-scoped / intentionally-global (say why) / LEAKING. Evidence: route file:line + the service query. WO-12 found `algo_deployments` + deployment events; find anything it missed.
2. **Fix the confirmed leaks** for deployments/events/cockpit/state reads: user predicate per the Slice 7 ownership model (deployment owner or entitled member), applied at the cleanest non-colliding layer. Global/legacy single-user deployments: follow whatever ownership backfill convention Slice 6/7 established (check migrations for an owner column default); if ownership data is missing, gate reads behind an admin entitlement rather than leaving them global, and flag it.
3. **Tests:** for each fixed route, a test proving user A cannot read user B's deployment/events; follow the existing route-test pattern (see `broker-execution.test.ts` internals-hook style if service mocking is needed).
4. **Audit:** record `entitlement.denied`-style audit events on rejected cross-user reads only if the existing `audit-events.ts` service makes it a one-liner; do not build new machinery.

## SCOPE

New helper module if needed, route files where the predicate lands, their tests. Avoid overlapping dirty hunks per the discipline above. Do NOT touch signal-options-automation.ts, signal-monitor.ts, backtesting files.

## Acceptance / verification

- Sweep table complete with per-route verdicts and evidence.
- Cross-user read tests green; `pnpm --dir artifacts/api-server exec node --import tsx --test <your test files>` output in report; api-server typecheck clean in SCOPE.
- Scope-check: your diff contains only SCOPE files with no foreign hunks absorbed.
- Commit as `fix(api): multi-user Slice 10 — user-scope automation reads`; do NOT push.

## Deliverable

`.codex-watch/wo-15-multiuser-scope-report-2026-07-07.md`: the sweep table, fixes landed (commit hash), conflicts deferred with exact file:line + which lane's hunk blocked you, and the residual-risk list for claude-lead.
