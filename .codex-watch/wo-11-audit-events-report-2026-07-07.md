# WO-11 Audit Events Report — 2026-07-07

## Spec Basis

- Observed: `SESSION_HANDOFF_2026-07-05_d6cc55a2-d861-4e14-8fb4-556e5452bb5f.md` names Slice 9 only as ``audit_events`` in the Next Recommended Steps section; it does not contain a detailed Slice 9 table/column/index section.
- Observed: `docs/plans/workorders-2026-07-07/wo-11-audit-events-slice9.md` matches the work order prompt and adds no hidden schema details.
- Inferred implementation basis: prompt minimums plus prior migration/schema style from Slice 6/7 and `20260702_robinhood_agentic_foundation.sql`.

## Schema Decisions

- Migration: `lib/db/migrations/20260707_audit_events.sql`.
- Table: `audit_events`.
- Columns:
  - `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
  - `app_user_id uuid NOT NULL REFERENCES users(id)`
  - `event_type varchar(96) NOT NULL`
  - `subject_type varchar(64)`, `subject_id text`
  - `resource_type varchar(64)`, `resource_id text`
  - `payload jsonb NOT NULL DEFAULT '{}'::jsonb`
  - `created_at timestamptz NOT NULL DEFAULT now()`
- Indexes:
  - `audit_events_app_user_created_at_idx` on `(app_user_id, created_at DESC)`
  - `audit_events_event_type_created_at_idx` on `(event_type, created_at DESC)`
  - `audit_events_subject_idx` on `(subject_type, subject_id)`
  - `audit_events_resource_idx` on `(resource_type, resource_id)`
- Payload bloat guard:
  - Service normalization caps string length, array length, object keys, recursion depth, and total serialized bytes.
  - Migration checks `jsonb_typeof(payload) = 'object'` and `octet_length(payload::text) <= 8192`.

## Deviations From d6cc55a2 Spec

- Observed spec gap: no explicit Slice 9 column/index list exists in the referenced handoff.
- Deviation/inference: index names and the split `subject_*`/`resource_*` columns were inferred from the work order wording and existing naming conventions, not copied from a detailed d6cc55a2 spec section.
- Deviation/inference: `created_at` only, no `updated_at`, because audit rows are append-only.
- Deviation/inference: payload size cap is an added P3-safe guard from `docs/plans/2026-07-02-elu-p3-payload-jsonb-offload.md`.

## Wired Event Sites

- Auth routes:
  - `auth.bootstrap`
  - `auth.login`
  - `auth.launch` for POST and GET launch handoff
  - `entitlement.denied` from `requireEntitlement` / `requireEntitlementCsrf`
- Launch provisioning:
  - `entitlement.changed` when a returning launch user’s resolved entitlements change.
- Broker routes:
  - Robinhood connect start, OAuth denied, OAuth complete, sync.
  - Schwab connect start, OAuth denied, OAuth complete, sync.
  - SnapTrade user registration, connection portal generation, sync as connect complete.
  - IBKR portal connect and disconnect.
- Order mutation attempts:
  - Schwab preview, submit, cancel.
  - SnapTrade impact and submit.

## Deferred / Not Touched

- `artifacts/api-server/src/services/signal-options-automation.ts`
- `artifacts/api-server/src/services/signal-monitor.ts`
- Backtesting files
- Reason: explicitly out of SCOPE / live-lane-owned in the work order.

## Test Evidence

- `pnpm exec tsc --build lib/db/tsconfig.json` — passed.
- `pnpm --filter @workspace/api-server exec tsc -p tsconfig.json --noEmit` — passed.
- `pnpm --filter @workspace/api-server exec node --import tsx --test src/services/audit-events.test.ts` — passed, 3 tests.
- `rg -l 'DATABASE_URL' artifacts/api-server/src/**/*test*` — no matches observed, so no live-DB integration test pattern exists in `api-server`. Used existing `@workspace/db/testing` PGlite pattern.

## Scope Check

- Added/touched in scope:
  - `lib/db/migrations/20260707_audit_events.sql`
  - `lib/db/src/schema/audit.ts`
  - `lib/db/src/schema/index.ts` audit export
  - `artifacts/api-server/src/services/audit-events.ts`
  - `artifacts/api-server/src/services/audit-events.test.ts`
  - `artifacts/api-server/src/routes/auth.ts`
  - `artifacts/api-server/src/services/auth-launch.ts`
  - `artifacts/api-server/src/routes/broker-execution.ts`
  - `artifacts/api-server/src/routes/ibkr-portal.ts`
- Observed unrelated pre-existing dirty changes remain in the worktree and were not intentionally modified.

## Apply Command For claude-lead

Do not apply until reviewed:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f lib/db/migrations/20260707_audit_events.sql
```
