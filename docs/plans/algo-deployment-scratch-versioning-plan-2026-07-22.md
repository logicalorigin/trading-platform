# Algo Deployment Scratch Creation and Versioning Plan

**Date:** 2026-07-22  
**Status:** Approved for implementation  
**Safety boundary:** This work must not enable a deployment, arm a target, or
submit a broker order.

## Outcome

An owner can create an Algo deployment directly from the Algo control panel
without first creating or promoting a strategy. Every configuration save
creates an immutable deployment version. A running deployment reads only its
explicit active version; editing creates a draft and cannot silently change
live behavior. Backtests may remain optional provenance, while account targets
and shared allowances remain separately audited operational controls.

## Architecture decisions

- `algo_deployments` is the stable identity and operational lifecycle record.
- `algo_deployment_versions` is the immutable source of configuration history.
- `kind` is first-class (`signal_options` or `overnight_spot`) rather than
  inferred from JSON or an unrelated strategy row.
- `strategy_id` becomes nullable and means optional source provenance only.
- `draft_version_id` identifies the configuration shown for editing.
- `active_version_id` identifies the configuration used by enabled execution.
- Creating or editing never enables execution. Activation remains an explicit,
  separately guarded action.
- Account assignments, target allowances, and account-wide allowances are not
  rolled back with an algo configuration. Their existing owner-scoped CRUD and
  diagnostic audit trail remain separate.
- Settings use three explicit scopes. Signal logic belongs to the deployment
  version; trade/risk overrides belong to one `(deployment, account)` target;
  shared capital and loss controls belong to the account. No save endpoint may
  infer a broader scope from the currently focused tab.
- Multi-edit operates on an explicit list of target IDs plus a field mask. Its
  review payload names every deployment/account pair and any account-wide
  downstream impact before an owner confirms the mutation.
- Existing deployment columns remain a compatibility projection during this
  migration. Every version write and pointer change updates that projection in
  the same database transaction.

## Task list

### Task 1 — Add and prove the version schema

**Description:** Add the first-class deployment kind, optional provenance,
immutable version table, and draft/active pointers through an additive,
idempotent migration.

**Acceptance criteria:**

- Every existing deployment is backfilled to version 1 with an inferred kind.
- Existing enabled deployments point both draft and active at version 1;
  paused deployments point draft at version 1 and have no active version.
- No enabled state, target lifecycle, target execution flag, or allowance is
  changed.
- Version numbers are unique per deployment and immutable at the API layer.

**Verification:** Schema contract tests plus a PGlite forward/idempotent
migration test covering legacy Options and Equities rows.

**Dependencies:** None.  
**Likely files:** automation schema, one migration, focused schema test.  
**Scope:** Medium.

### Task 2 — Create deployments from scratch

**Description:** Replace the required strategy input with a required kind and
canonical defaults; accept optional backtest provenance when creation starts
from research.

**Acceptance criteria:**

- `POST /algo/deployments` succeeds with `kind`, name, mode, symbols, and
  optional config but no strategy ID.
- Creation atomically inserts the deployment and immutable version 1.
- The new deployment is owner-scoped, draft, paused, target-free, and has no
  active version.
- A supplied source strategy must exist; omission is normal rather than an
  error.

**Verification:** Service, route/auth, OpenAPI, generated-client, and migration
tests.

**Dependencies:** Task 1.  
**Likely files:** deployment-management service/route, OpenAPI, focused tests.  
**Scope:** Medium.

### Checkpoint 1 — Safe creation foundation

- Scratch creation works without a strategy row.
- Existing data reads unchanged through the compatibility response.
- New deployments cannot execute.

### Task 3 — Make configuration saves versioned and atomic

**Description:** Introduce one owner-scoped configuration-save service that
validates an expected draft version, writes the next immutable snapshot, moves
the draft pointer, and updates the compatibility projection atomically.

**Acceptance criteria:**

- Each successful save increments the deployment-local version exactly once.
- Stale concurrent saves fail with a version conflict and preserve both sides.
- Name, symbols, signal settings, and trade profile save as one configuration
  snapshot; there is no partial two-PATCH success state.
- Editing an enabled deployment does not move its active pointer.

**Verification:** Transaction, ownership, conflict, rollback, and concurrent
save tests.

**Dependencies:** Tasks 1–2.  
**Likely files:** version service/test, route/test, OpenAPI.  
**Scope:** Medium.

### Task 4 — Pin runtime execution to the active version

**Description:** Resolve runtime deployment configuration through the active
version for enabled execution and fail closed when the pointer is absent,
foreign, or inconsistent.

**Acceptance criteria:**

- Enable atomically promotes the reviewed draft version to active only after
  existing readiness preflight succeeds.
- Enabled execution reads the active snapshot, not newer draft edits.
- Pause preserves the active pointer for audit but prevents entry as today.
- Restore-as-draft creates a new version; immutable historical rows are never
  mutated.

**Verification:** Enable/pause, active-vs-draft, malformed pointer, restoration,
and execution-context tests.

**Dependencies:** Task 3.  
**Likely files:** version service, automation execution readers, focused tests.  
**Scope:** Medium.

### Task 5 — Replace the strategy-gated creation UI

**Description:** Make the Algo control-panel modal self-contained. Choose algo
type, name, symbols, and type-specific safe defaults inline; optionally start
from a backtest preset without making it a prerequisite.

**Acceptance criteria:**

- The create button remains available when there are no promoted backtests.
- Options and Equities both create zero-account paused drafts from scratch.
- An optional “Start from backtest” affordance copies provenance/config without
  changing the same scratch path.
- Success opens the new deployment's Accounts & Trade Controls panel.

**Verification:** Source tests and mutation-firewalled phone/tablet/desktop
browser flows for empty and populated backtest lists.

**Dependencies:** Task 2.  
**Likely files:** Algo screen, create modal, focused UI tests/E2E.  
**Scope:** Medium.

### Task 6 — Add version history and explicit apply UX

**Description:** Show the draft/active version state in the Algo control panel,
offer version history and restore-as-new-draft, and make activation differences
clear before execution can change.

**Acceptance criteria:**

- The header shows Draft vN and Active vM without implying unsaved edits are
  running.
- History lists timestamp, source, author, and change summary.
- Restore never overwrites history and never implicitly enables execution.
- Version controls are keyboard accessible and responsive.

**Verification:** Model/component tests plus mutation-firewalled browser QA.

**Dependencies:** Tasks 3–4.  
**Likely files:** generated hooks, Algo version model/panel, focused tests.  
**Scope:** Medium.

### Task 6A — Add scope-safe individual and group tuning

**Description:** Let owners tune one deployment, one deployment-account target,
or an explicit group of targets without leaking a change into other accounts.

**Acceptance criteria:**

- The control panel labels every editable field as Deployment, This account,
  or Shared account scope.
- Deployment-scoped signal settings create one immutable deployment version and
  therefore affect every target only after that version is explicitly applied.
- Target-scoped trade/risk overrides update only the selected target IDs and do
  not alter the deployment version or sibling targets.
- Account-scoped controls enumerate every linked deployment before Apply and
  update only the selected account IDs.
- Group editing requires explicit target selection and an explicit field mask;
  mixed values remain mixed until the owner supplies a replacement.
- The review screen shows an exact `(deployment, account)` impact list and the
  server rejects cross-owner, stale-selection, or scope-mismatched writes.
- Partial success is reported per target/account, and retry resubmits only the
  failed rows. Configuration never arms a target or submits an order.

**Verification:** Scope-policy unit tests, owner/concurrency/partial-success API
tests, and mutation-firewalled single/multi-target browser flows.

**Dependencies:** Tasks 3–6 and the allowance target/account CRUD foundation.  
**Likely files:** target override schema/service, scoped bulk API, Algo settings
model/panel, OpenAPI/generated hooks, focused tests.  
**Scope:** Large.

### Checkpoint 2 — Version-safe control panel

- Scratch create, edit, version history, restore, and explicit activation work
  end to end.
- Editing cannot change an active runtime snapshot.
- No broker mutation is involved in configuration/version operations.

### Task 7 — Correct Strategy terminology

**Description:** Remove misleading Strategy language from the Algo workflow
while preserving legitimate trading-strategy and research concepts elsewhere.

**Acceptance criteria:**

- Algo uses Deployment, Signal settings, Trade settings, Backtest preset, and
  Source backtest consistently.
- API operations and public errors use deployment/configuration terminology;
  legacy strategy-named operations remain temporary deprecated aliases only if
  compatibility requires them.
- Backtesting says “Create Algo draft” / “Backtest preset” where it hands work
  to Algo; option-combination “Strategy” language in Trade remains unchanged.

**Verification:** Source-string contract tests, generated-client drift audit,
and rendered UI assertions.

**Dependencies:** Tasks 2–6.  
**Likely files:** OpenAPI, Algo/backtest copy, focused tests.  
**Scope:** Medium.

### Task 8 — Final migration and regression campaign

**Description:** Apply the migration only after forward tests pass, read back
all invariants, and run the focused API/UI/runtime safety campaign.

**Acceptance criteria:**

- Row counts, enabled state, owners, active/draft pointers, and version hashes
  reconcile after migration.
- API typecheck/build and focused DB/service/route/client tests pass.
- Normal-URL browser QA passes with a mutation firewall and zero protected
  broker/account mutations.
- Every provider activation release remains closed and every existing target
  remains execution-disabled.

**Verification:** Migration audit queries, focused test commands, generated
client drift audit, scoped diff check, and browser matrix.

**Dependencies:** Tasks 1–7.  
**Likely files:** no new product files beyond fixes found by the campaign.  
**Scope:** Medium.

## Risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Mutable projection diverges from a version | Runtime uses unexpected config | One transaction owns version insert, pointer update, and projection update; readback tests compare hashes. |
| Editing a running deployment changes execution | Live trading behavior changes without review | Runtime reads `active_version_id`; draft saves never move it. |
| Legacy rows lack a kind | Migration cannot backfill deterministically | Infer with the existing production predicates and abort on unclassified rows before constraints. |
| Concurrent saves lose work | User settings disappear | Require `expectedDraftVersion`; reject stale writes with a public conflict code. |
| “Strategy” removal damages valid trading terminology | Confusing or incorrect copy | Limit the rename to Algo deployment/backtest handoff concepts; keep order-strategy language intact. |
| Version rollback also rolls back capital controls | Unsafe account-wide changes | Keep targets/allowances outside deployment versions and audit them separately. |
| A bulk edit leaks into unselected accounts | Unintended trading behavior | Require target IDs plus field masks, authorize every row, preview the exact impact set, and reject scope mismatches. |

## Completion checkpoint

- A user can create an Options or Equities Algo deployment from scratch.
- Every configuration state is durably versioned and attributable.
- Active execution is pinned to an explicit reviewed version.
- Strategy is optional provenance, never a creation gate.
- All broker activations remain fail-closed until separately released.
