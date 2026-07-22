# Algo Shared Allowance and Multi-Broker Readiness Plan

**Date:** 2026-07-22  
**Status:** Implementation task list; live activation explicitly excluded  
**Corrects:** The allocation/ceiling model in
`algo-account-control-plane-ui-ux-live-robinhood-plan-2026-07-22.md`  
**Providers in scope:** Robinhood, Schwab, SnapTrade, and IBKR

**Daily-loss decision (approved 2026-07-22):** Live entry admission uses all
realized options P&L in the selected broker account for the current
`America/New_York` trading day. The amount remains user-configurable; the scope
must be displayed as an account-wide setting and must not be silently replaced
by deployment-attributed P&L.

## Implementation status

| Task | Status | Current evidence |
| --- | --- | --- |
| 1. Typed allowance resolver | Complete | Pure USD/percent, freshness, exposure, reservation, and elastic-pool tests pass. |
| 2. Additive migration | Authored, not applied | Schema and forward-migration tests pass; no workspace database was mutated. |
| 3. Allowance-native CRUD | Complete | Owner-scoped Apply, partial results, shared impacts, and forced staged state pass service/route tests. |
| 4. Canonical API contract | In progress | Allowance and staging/readiness contracts are published; resolved live-capacity presentation remains. |
| 5. Replace duplicate inputs | Complete | Inline target/shared allowance fields use explicit USD/% units and reviewed Apply. |
| 6. Contextual/bulk editing | In progress | Explicit masked bulk editing is implemented; replacing the legacy profile-level simulation allowance with focused-target context remains. |
| 7. Split configurable/readiness | Core complete | All four providers stage safely; disconnected/excluded blockers remain activation-only; platform activation remains closed. |
| 8–12. Common/provider adapters | Queued | Existing provider services must be wrapped and pass one conformance suite before release. |
| 13. Account-serial admission | In progress | Shared allowance sizing and a conservative unresolved-entry fence exist; full provider-neutral reservation lifecycle remains. |
| 14. Readiness presentation | In progress | Inline staged/blocker states exist; full provider matrix and responsive browser QA remain. |

This status is source/test status only. It does not claim that the migration is
deployed, that a target is armed, or that any broker received a live request.

## Outcome

An owner can connect an Algo deployment to any owned broker account, configure
the deployment-account target inline, edit one or many targets, and see exactly
what remains before that target could trade. Configuration never enables live
execution. A later, separate reviewed action is required to arm each target.

## Observed starting point at session restore

- The database provider enum contains `robinhood`, `schwab`, `snaptrade`, and
  `ibkr`.
- All four providers have account/readiness or order-service foundations, but
  the Algo account-choice service currently marks only Robinhood options
  accounts as supported.
- The Algo live executor is Robinhood-specific and requires target
  `allocationPercent` plus account `hardCeilingPercent`.
- The existing Algo control panel already has one `Allowance` setting in USD.
  The inline connection panel added separate percentage fields, creating two
  controls for the same user intent.
- A target can currently become active as part of assignment. That is too
  tightly coupled for configuring additional brokers without turning them on.

## Corrected product contract

### One allowance concept at two scopes

```ts
type AlgoAllowanceSetting = {
  unit: "usd" | "percent";
  value: number;
};
```

- **Target allowance** belongs to one `(deployment, account)` pair and is the
  most that deployment may have exposed on that account.
- **Total algo allowance** belongs to the account and caps combined exposure
  from every deployment on that account.
- The pool is **elastic**. Configured target maxima may add up to more than the
  account total, but actual combined exposure and unresolved entry reservations
  may never exceed the account total.
- USD values remain USD. Percentage values use the existing fresh spending
  base: `min(net liquidation, buying power)`. Migration preserves each legacy
  value and unit; it does not convert a percentage to an invented dollar value.
- The existing Algo `Allowance` control becomes contextual to the focused
  target. Multi-select exposes the same control through a masked bulk edit.
- The connection row summarizes or edits that same target allowance; it does
  not introduce another “max spend” field.
- The account total is edited once at account scope and discloses every linked
  deployment affected by the change.
- The profile-level legacy allowance remains only for Shadow/backtest behavior
  and as an explicit template for a newly created target. Live admission reads
  the persisted target allowance, never an implicit profile fallback.

### Configuration is separate from activation

- Assignment creates or updates a **staged** target with execution disabled.
- Ownership and input validity determine whether an account is configurable.
- Provider capability, connection health, permissions, capital/risk freshness,
  adapter completeness, and platform authorization determine whether it is
  activation-ready.
- A target cannot become live merely because a connection later recovers.
- Enabling a deployment does not arm a staged target.
- This work leaves every new provider target staged and all provider live gates
  closed.

### Shared-pool admission

```text
target remaining
  = resolved target allowance - target exposure - target reservations

account remaining
  = resolved total algo allowance
    - all PYRUS target exposure on the account
    - all unresolved account entry reservations

entry budget
  = min(
      target remaining,
      account remaining,
      max premium per entry,
      provider buying power,
      immutable platform cap
    )
```

The final reservation and admission check must be serialized per account so
two deployments cannot race through the same remaining capacity.

## UI and UX

- Keep the full-width inline **Accounts & Trade Controls** band in Algo.
- Assigned/staged accounts appear first; available and blocked accounts remain
  visible below them.
- Each row shows broker, account, assignment, staged/armed state, readiness,
  target allowance, current target use, shared account total, and shared
  remaining capacity.
- The target allowance uses one USD/% segmented unit control. The account total
  uses the same control and is visually marked **Shared by N deployments**.
- Selecting multiple rows enables masked bulk editing. Only checked fields are
  changed, and mixed values remain visibly mixed until the user supplies one.
- Review names every target change and every cross-deployment account-total
  impact. Apply remains per-account atomic with partial success and retry.
- Provider blockers are actionable and public-safe: reconnect in Settings,
  permissions missing, account excluded, options unsupported, adapter not
  ready, or platform activation not authorized.
- No credential input appears in Algo. Settings remains the only broker-auth
  surface.

### Setting-scope contract

| Scope | Examples | Persistence | Affected rows |
| --- | --- | --- | --- |
| Deployment | signal timeframe, entry filters, contract selection defaults | immutable deployment version | all targets only when that version is explicitly applied |
| Deployment × account | per-entry premium, contract/open-symbol limits, exit-policy overrides, target allowance | target override/config row | only the selected target IDs |
| Account | total algo allowance and account-wide daily-loss policy | account control row | all deployments linked to only the selected account IDs |

The UI must always show the active scope next to the field. “Apply to selected”
accepts explicit target IDs and an explicit field mask; focus, filter state, or
visual grouping is never mutation authority. The review step resolves IDs to
human-readable deployment/account pairs and separately lists any shared-account
effects. The server rechecks ownership and expected revisions for every row.

## Ordered task list

### Phase 1 — Shared allowance foundation

#### Task 1 — Add the typed allowance resolver

**Acceptance criteria:** USD and percentage values validate at the boundary;
resolution returns configured value, effective USD value, source unit, spending
base timestamp, remaining capacity, and fail-closed blockers; elastic-pool math
counts positions plus unresolved reservations.

**Verification:** Pure tests for USD, percent, stale/missing capital, exhausted
target, exhausted account, oversubscribed maxima, and exact boundary values.

**Dependencies:** None.  
**Likely files:** new allowance policy module and focused test.  
**Scope:** Medium.

#### Task 2 — Add an additive allowance and activation migration

**Acceptance criteria:** Targets persist allowance value/unit and
`execution_enabled=false`; account controls persist total allowance value/unit;
legacy percentage values backfill with unit `percent`; constraints reject
nonpositive/invalid values; no existing target is armed by migration.

**Verification:** Schema/migration tests and forward-migration SQL review.

**Dependencies:** Task 1.  
**Likely files:** one new migration, automation schema, schema test.  
**Scope:** Medium.

#### Task 3 — Make target/account CRUD allowance-native

**Acceptance criteria:** Owner-scoped reads and Apply use `allowance` and
`totalAlgoAllowance`; account-total updates disclose linked deployments;
target assignment defaults to staged; legacy fields are read-only compatibility
aliases during migration and are not accepted as a second write path.

**Verification:** Service tests for ownership, CSRF route coverage, partial
success, retry, account sharing, lifecycle, and no implicit activation.

**Dependencies:** Task 2.  
**Likely files:** deployment-management service/test and automation route/test.  
**Scope:** Medium.

#### Task 4 — Publish the canonical API contract

**Acceptance criteria:** OpenAPI exposes allowance settings, resolved capacity,
staged/armed state, configuration readiness, activation readiness, structured
blockers, and shared impact; generated-client drift is clean.

**Verification:** API-spec tests, code generation, client typecheck, and drift
audit.

**Dependencies:** Task 3.  
**Likely files:** OpenAPI source, API-spec tests, generated client artifacts.  
**Scope:** Medium.

### Checkpoint 1

- All new targets default to execution disabled.
- Existing values read back without unit conversion.
- No live provider call is reachable from configuration Apply.

### Phase 2 — Inline target and account controls

#### Task 5 — Replace duplicate percentage inputs

**Acceptance criteria:** “Deployment max spend” and “account-wide ceiling” no
longer appear; the row and Algo control panel edit one target Allowance source;
the shared account total is clearly account-scoped; single-row edit/review/apply
works without touching broker execution.

**Verification:** Model/component tests and a mutation-firewalled browser flow.

**Dependencies:** Task 4.  
**Likely files:** deployment account model/panel and focused tests.  
**Scope:** Medium.

#### Task 6 — Add contextual and bulk editing

**Acceptance criteria:** Focused target binds the control-panel Allowance;
multi-select exposes explicit field masks; mixed values are preserved; account
total changes enumerate other deployments; failed rows retain drafts.

**Verification:** Reducer/model tests plus keyboard, phone, tablet, and desktop
browser coverage.

**Dependencies:** Task 5.  
**Likely files:** Algo live/settings regions, target draft model, focused tests.  
**Scope:** Medium.

### Checkpoint 2

- One allowance concept is visible throughout Algo.
- Account sharing and remaining capacity are understandable without opening
  Settings.
- Apply performs database configuration only; protected broker mutation routes
  remain untouched.

### Phase 3 — Broker-neutral configuration readiness

#### Task 7 — Split configurable from activation-ready

**Acceptance criteria:** Owned Robinhood, Schwab, SnapTrade, and IBKR accounts
can be staged when their identity is valid; every account remains visible;
readiness blockers do not prevent saving safe staged configuration; no staged
target is executable.

**Verification:** Choice/service tests for all four providers, disconnected,
excluded, closed, read-only, unsupported-options, and cross-owner accounts.

**Dependencies:** Task 3.  
**Likely files:** deployment management, account inclusion/readiness model, tests.  
**Scope:** Medium.

#### Task 8 — Define the provider adapter contract and dispatcher

**Acceptance criteria:** One interface covers capital, risk, order review,
entry submit, owned-position exit, cancel, order/fill reads, and reconciliation;
the dispatcher rejects unknown/incomplete adapters; provider payloads do not
leak into the Algo API.

**Verification:** Contract tests with fake adapters, missing-capability cases,
ownership isolation, and mutation-fence assertions.

**Dependencies:** Tasks 1 and 7.  
**Likely files:** new provider-neutral adapter module/test and dispatcher/test.  
**Scope:** Medium.

#### Task 9 — Wrap Robinhood behind the common adapter

**Acceptance criteria:** Existing Robinhood preparation, order, exit, and
reconciliation services satisfy the common interface without weakening Agentic
or option-level gates; behavior remains fail-closed and disabled.

**Verification:** Existing Robinhood suites plus adapter conformance tests.

**Dependencies:** Task 8.  
**Likely files:** Robinhood adapter and tests; minimal calls into existing
services.  
**Scope:** Medium.

#### Task 10 — Add the Schwab adapter behind a disabled gate

**Acceptance criteria:** Schwab option preview/submit/cancel/recent-order
services satisfy the common contract; account ownership and option permission
readiness are explicit; activation remains unavailable.

**Verification:** Schwab adapter conformance, partial/ambiguous order,
reauthentication, and reconciliation tests with no live calls.

**Dependencies:** Task 8.  
**Likely files:** Schwab adapter/test and readiness mapping/test.  
**Scope:** Medium.

#### Task 11 — Add the SnapTrade adapter behind a disabled gate

**Acceptance criteria:** The adapter binds to the selected underlying brokerage
and its proven option capabilities, never to generic SnapTrade capability;
read-only or incomplete brokerage fixtures remain blocked; activation remains
unavailable.

**Verification:** Named-brokerage fixtures, permission loss, partial fills,
cancel/reconcile, and capability-drift tests with no live calls.

**Dependencies:** Task 8.  
**Likely files:** SnapTrade adapter/test and readiness mapping/test.  
**Scope:** Medium.

#### Task 12 — Add the IBKR special-connector adapter behind a disabled gate

**Acceptance criteria:** The adapter uses the existing authenticated account
bridge and order lifecycle, enforces paper/live identity, reply/reconciliation
handling, and session freshness; activation remains unavailable.

**Verification:** IBKR adapter conformance, gateway/session loss, reply-needed,
partial-fill, and reconciliation tests with no live calls.

**Dependencies:** Task 8.  
**Likely files:** IBKR adapter/test and readiness mapping/test.  
**Scope:** Medium.

### Checkpoint 3

- All four providers can be configured as staged targets.
- Every adapter passes the same conformance suite.
- Every provider activation gate remains disabled.
- Test doubles prove no external order submission occurred.

### Phase 4 — Shared-pool runtime preparation

#### Task 13 — Make reservation/admission account-serial

**Acceptance criteria:** Exposure and unresolved reservations are summed across
deployments; final admission and reservation are serialized per account;
concurrent entries cannot exceed target or account allowance; exits and
reconciliation remain allowed when entry capacity is exhausted.

**Verification:** Concurrent transaction tests, replay/idempotency tests,
partial fill/cancel release tests, and stale-risk fail-closed tests.

**Dependencies:** Tasks 1, 2, and 8.  
**Likely files:** generic sizing/admission service/test and execution outbox
service/test.  
**Scope:** Medium.

#### Task 14 — Surface provider-specific readiness without enabling

**Acceptance criteria:** Algo shows staged, blocked, and technically ready
states per provider; the final action reads “Ready to enable” but is disabled
or absent; no API path can arm a target without the later activation release.

**Verification:** Provider matrix source tests and safe browser QA across phone,
tablet, and desktop with a mutation firewall.

**Dependencies:** Tasks 9-13.  
**Likely files:** readiness presenter, inline account UI, focused tests/E2E.  
**Scope:** Medium.

### Checkpoint 4 — Build-ready, not live

- Robinhood, Schwab, SnapTrade, and IBKR targets can be staged and fully
  configured.
- Shared allowance enforcement and provider adapters are test-complete.
- Database/API/UI readback agrees.
- All targets remain execution-disabled and no deployment/account is switched
  to live trading.

## Deferred activation task list

These tasks require a separate user-approved release:

1. Verify each real account's permissions, freshness, and provider conformance
   fixture through authenticated runtime reads.
2. Apply user-selected allowance values through the normal reviewed UI.
3. Enable one provider/target gate at a time, starting paused and with zero
   unresolved orders.
4. Review the exact activation diff and obtain explicit approval.
5. Arm the target through the owner/CSRF-protected UI, monitor the first window,
   and retain a tested pause/drain/reconciliation rollback.

No item in this plan authorizes those activation steps.
