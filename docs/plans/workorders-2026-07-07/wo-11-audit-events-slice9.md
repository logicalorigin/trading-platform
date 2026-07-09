# WO-11: Multi-user Slice 9 — `audit_events`

You are `codex-worker` for `claude-lead` (session f68a9158). Repo `/home/runner/workspace`, branch `main`. Do NOT read `~/.claude/`, `.claude/skills/`, `agents/`. Obey SCOPE. DB: migrations under `lib/db/migrations/`, schema in `lib/db/src/schema/`; read-only queries allowed via `cd lib/db && node -e` with pg + `$DATABASE_URL`. Do NOT apply the migration to the live DB — write it; claude-lead applies after review.

## Context

Multi-user rollout: Slices 1–7 landed (Slice 6 launch-token auth, Slice 7 entitlements `d25b6901`), Slice 8 login gate landed (`1d5e0b9d`). Slice 9 = `audit_events`, per the durable spec in `SESSION_HANDOFF_2026-07-05_d6cc55a2-d861-4e14-8fb4-556e5452bb5f.md` (read its Slice 9 section verbatim — that spec wins over this summary). Verified absent: no audit migration exists.

Follow the repo's established slice pattern: study the Slice 7 commit (`git show d25b6901 --stat`) and the Slice 6 auth commit for naming, migration style (`20260702_robinhood_agentic_foundation.sql` shows the SQL conventions), schema-file layout (`lib/db/src/schema/index.ts` exports), and how services write rows.

## Task

1. Migration `2026070X_audit_events.sql`: table with user scoping (match the slice spec's columns; expect at minimum id, user id, event type, subject/resource, payload jsonb, created_at, and the indexes the spec names). Respect the P3 lesson: keep payload lean — the DB-pool workstream flagged jsonb bloat (`docs/plans/2026-07-02-elu-p3-payload-jsonb-offload.md`); cap/normalize payload content.
2. Schema + typed model in `lib/db/src/schema/` (new `audit.ts`, exported from `index.ts`).
3. Write path: a small `audit-events.ts` service in `artifacts/api-server/src/services/` with a best-effort, non-blocking `recordAuditEvent()` (an audit failure must NEVER fail the user action — fire-and-forget with error logging), wired into exactly the event sites the slice spec names (expect: login/launch, broker connect/disconnect, entitlement changes, order-mutation attempts). If the spec names sites owned by live lanes (`signal-options-automation.ts`), wire everything else and list those as follow-ups.
4. Tests: service unit test (writes row, swallows failure), plus one integration-style test following the repo's DB-test pattern if one exists (`rg -l 'DATABASE_URL' artifacts/api-server/src/**/*test*` to find the pattern; if none, unit-only and say so).

## SCOPE

New migration file, `lib/db/src/schema/audit.ts` + `index.ts` export line, new `audit-events.ts` service + test, minimal call-site wiring in auth/broker routes named by the spec. NOT: `signal-options-automation.ts`, `signal-monitor.ts`, backtesting files.

## Acceptance / verification

- `pnpm --filter @workspace/db run typecheck` (or the repo's db package name — check `lib/db/package.json`) and api-server typecheck clean in SCOPE; tests green.
- Migration file lints against the conventions of the two cited prior migrations (same header/format).
- Scope-check passes. Commit as `feat(api,db): multi-user Slice 9 — audit_events`; do NOT push, do NOT apply the migration.

## Deliverable

`.codex-watch/wo-11-audit-events-report-2026-07-07.md`: schema decisions vs the d6cc55a2 spec (call out every deviation), wired event sites, deferred sites, test evidence, and the exact apply command for claude-lead.
