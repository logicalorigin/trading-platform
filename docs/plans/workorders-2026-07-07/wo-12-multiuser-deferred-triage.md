# WO-12: Multi-user deferred-domains triage (READ-ONLY)

You are `codex-worker` for `claude-lead` (session f68a9158). Repo `/home/runner/workspace`. INVESTIGATION ONLY — no code changes, no commits. Do NOT read `~/.claude/`, `.claude/skills/`, `agents/`. Read-only DB queries allowed via `cd lib/db && node -e` with pg + `$DATABASE_URL` (information_schema only; no data dumps).

## Context

The multi-user durable handoff (`SESSION_HANDOFF_2026-07-05_d6cc55a2-*.md`) deferred these domains beyond Slice 9: `feature_flags`, `algo_deployments`, `saved_scans`, `alert_rules` row-scoping; the IBKR compliance flag/allow-list; on-demand gateway reaping. Slice 7 (`d25b6901`, `entitlements.ts`) may already cover parts.

## Task

For each deferred domain:
1. Current state: does the table exist, does it have a user/org scoping column, is there route-level scoping or an entitlement check already (`rg` the schema files, migrations, and route/service code; confirm columns via information_schema).
2. Gap: what Slice-style work remains, if any — or "covered by Slice 7 entitlements" with file:line evidence.
3. Risk if left unscoped (cross-user data exposure? which routes leak?) — check the actual route handlers for missing user filters; cite file:line for any handler that queries these tables without a user predicate.
4. Size the remaining work (XS/S/M) so real gaps become Slice 10+ work orders.

Also verify the two operational items: IBKR compliance flag (rg `IBKR` + `compliance|allow` in entitlements/env handling) and gateway reaping (`scripts/reap-dev-port.mjs` is startup-guard territory — if reaping work touches it, flag that `pnpm run audit:replit-startup` must run in any follow-up WO).

## Deliverable

`.codex-watch/wo-12-deferred-domains-2026-07-07.md`: per-domain table (state / gap / leak risk with file:line / size), the two operational-item verdicts, and a ranked Slice-10 proposal. Any route found leaking cross-user data goes at the TOP with severity called out.
