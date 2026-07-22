# Algo Deployment Accounts and Robinhood Live Execution

**Date:** 2026-07-21  
**Status:** Approved product intent; implementation specification  
**Primary outcome:** Use the normal PYRUS UI and its public API to connect the
existing Pyrus Signal Options deployment to the owned Robinhood Agentic account,
switch it to live, and enable future live orders without bypassing the UI.

## 1. Approved product rules

The user explicitly confirmed the following behavior during the July 21
interview. These are requirements, not implementation suggestions.

- A deployment owns its strategy details; execution accounts are independent
  targets of that deployment.
- One deployment may target multiple real or shadow accounts.
- A draft may be saved with zero accounts.
- Deleting always archives. Drafts are preserved. Normal product UI/API never
  hard-deletes a deployment.
- Adding an account to a running deployment applies only to future trades. It
  never copies an existing position into the new account.
- Removing an account that still has algo-owned positions defaults to
  **draining**: stop new entries, continue managing those positions until flat,
  then detach. **Manual takeover** is a separate explicit action.
- Each target succeeds or fails independently. One failed target must not stop
  a successful target from receiving its trade.
- A target allocation percentage is a maximum spend cap, not a reservation.
  Target percentages may add above 100%, with a warning. Actual combined algo
  spend may never exceed the account's hard algo ceiling.
- Account or limit changes to a live deployment require a review screen and an
  explicit Apply action.
- Batch Apply may partially succeed. Successful targets remain applied; failed
  targets remain unchanged and are returned with a clear reason and a
  **Retry failed accounts** action.
- The Account screen shows every connected deployment and lifecycle state as a
  read-only linked view. Editing remains in Algo.
- Unavailable accounts stay visible but disabled, with the reason shown.
- Platform safety invariants cannot be bypassed. This feature never transfers
  money.
- The create-deployment UI calls the equity strategy family **Equities**, not
  **Overnight**. Existing internal execution identifiers remain compatible.

## 2. Observed baseline

Source and read-only runtime inspection established these facts:

- `algo_deployments` has one required external `provider_account_id`; it has no
  owner, target collection, draft flag, archive state, or detach lifecycle.
- The current CRUD surface is list/create/enable/pause/mode/settings only.
- The create modal hardcodes `shadow` and offers no account selection.
- Account UI derives a text-only association by comparing the deployment's one
  provider account string.
- The current Pyrus Signal Options deployment is enabled in Shadow mode.
- One owned Robinhood account named `Agentic` is connected, open,
  execution-ready, Agentic-enabled, and approved for option level 2.
- Robinhood option review/place/cancel services exist and perform ownership,
  readiness, Agentic-account, confirmation, tax-preflight, and provider checks.
- The Signal Options worker never calls those services. It writes simulated
  entry/exit events and mirrors them to the Shadow ledger even when the
  deployment is labelled live.
- Robinhood's direct option-order service currently permits buy-to-open only.
  Sell-to-close is intentionally blocked until owned position and working-order
  context are checked.
- The current Signal Options profile has real-money-sensitive settings that are
  acceptable for research but not sufficient as immutable live safeguards:
  trading allowance and daily-loss halt are disabled. Live activation therefore
  cannot rely on the strategy profile alone.

Official Robinhood material current on July 21, 2026 confirms that Agentic
Trading supports US equities and options and that only the dedicated Agentic
account may receive agent-placed trades. The older local readiness copy that
describes options as unavailable is stale and must be corrected.

## 3. Scope

### In scope

- Deployment owner, draft, archive/restore, details update, and target CRUD.
- Relational target records using owned local account IDs.
- Account-wide algo ceiling plus per-target allocation cap.
- Independent target Apply results and retry.
- Active, draining, manual-takeover, and detached target lifecycle.
- Target-aware live event/outbox, execution records, positions, idempotency,
  reconciliation, and Robinhood option entry/exit routing.
- Algo create/edit/review/archive/restore UI.
- Account read-only deployment links.
- Options/Equities wording.
- Targeted unit, route, source-contract, and browser tests.
- Additive SQL migration, normal backend rebuild/restart, and final normal-UI
  activation.

### Out of scope

- Money movement or deposits.
- Multi-leg, naked short, buy-to-close, or sell-to-open option strategies.
- Copying existing positions to a newly attached account.
- Automatically acknowledging a compliance warning on the user's behalf.
- Hard deletion in ordinary UI/API.
- Rewriting the strategy/scanner or the existing Shadow simulation behavior.
- Enabling unsupported broker/provider combinations merely because the account
  is visible.

## 4. Persistence model

### 4.1 `algo_deployments` additions

- `app_user_id uuid null references users(id)`
  - Required for every new deployment.
  - Legacy unowned rows remain admin-only until they can be safely backfilled.
  - The existing Pyrus Signal Options row is backfilled from the owned Shadow
    account during the migration.
- `is_draft boolean not null default true`
- `archived_at timestamptz null`
- `provider_account_id` becomes nullable and remains only a compatibility
  projection of the primary/legacy target. It is not the authorization source.

Derived presentation state:

- `archived` when `archived_at` is non-null;
- `draft` when not archived and `is_draft` is true;
- `running` when not archived, not draft, and enabled;
- `paused` when not archived, not draft, and disabled.

Archiving force-pauses but preserves `is_draft`, configuration, targets, and
history. Restore returns the deployment paused in its prior draft/ready state.

### 4.2 `algo_deployment_targets`

Each row contains:

- `id uuid primary key`
- `deployment_id uuid not null`
- exactly one of `broker_account_id uuid` or `shadow_account_id varchar(64)`
- `lifecycle` in `active | draining | manual_takeover | detached`
- `allocation_percent numeric(5,2)` with `0 < value <= 100`
- `joined_at`, `draining_at`, `detached_at`, and normal timestamps
- optional bounded `risk_overrides jsonb` for only explicitly supported
  override keys; unknown keys are rejected

There is one durable row per deployment/account pair. Detach changes lifecycle;
it does not delete the row. Reactivation reuses the row and establishes a new
future-event cursor.

### 4.3 `algo_account_controls`

One owned row per real broker account:

- `app_user_id`
- `broker_account_id` unique
- `hard_ceiling_percent numeric(5,2)` with `0 < value <= 100`
- timestamps

The spending base is the lower of fresh net liquidation and usable buying
power. If a fresh trustworthy base cannot be read, new live entries fail
closed. Provider buying-power rejection remains authoritative.

### 4.4 Live execution records

`algo_target_executions` is the durable per-target outbox and broker journal:

- deployment, target, and source strategy-event IDs
- `entry | exit` action
- deterministic client/ref ID
- `pending | reviewed | submitted | filled | rejected |
  reconciliation_required | cancelled` status
- broker order ID/state, requested and filled quantity, bounded sanitized error,
  and contract/order snapshot
- a uniqueness fence on target + source event + action/scale-out identity

`algo_target_positions` records only positions actually accepted/found at the
broker for that target. It includes the strategy position key, contract
identity, quantity, premium basis, state, and last reconciliation time.

Strategy-level events remain the decision ledger. Live target execution and
position state are never inferred from a simulated Shadow fill.

## 5. API contracts

All writes require an authenticated owner, CSRF, and the existing admin policy
where live broker mutation remains admin-only. Reads are owner-scoped; admins do
not accidentally transfer ownership by reading.

### Deployment CRUD

- `GET /api/algo/deployments?includeArchived=`
- `GET /api/algo/deployments/{deploymentId}`
- `POST /api/algo/deployments`
  - account IDs optional; creates a paused draft
- `PATCH /api/algo/deployments/{deploymentId}`
  - name, strategy details, universe, supported config, and draft/ready state
- `POST /api/algo/deployments/{deploymentId}/archive`
- `POST /api/algo/deployments/{deploymentId}/restore`

The existing enable/pause/mode/settings routes remain compatibility delegates
to the same owner/lifecycle rules.

### Target/readiness APIs

- `GET /api/algo/deployment-accounts`
  - returns every owned Shadow/real account, readiness, supported strategy
    families, and public blocker reasons
- `GET /api/algo/deployments/{deploymentId}/targets`
- `POST /api/algo/deployments/{deploymentId}/targets/apply`
- `POST /api/algo/deployments/{deploymentId}/targets/retry`
- `POST /api/algo/deployments/{deploymentId}/targets/{targetId}/takeover`

Apply request contains the desired target changes and account ceiling changes.
Each item is validated and committed independently. The response is always
structurally explicit:

```json
{
  "succeeded": [{ "accountId": "...", "target": {} }],
  "failed": [{ "accountId": "...", "code": "...", "message": "..." }],
  "warnings": [{ "code": "allocation_caps_exceed_account_total" }]
}
```

An item failure does not roll back successful siblings. A failed item must not
partially change its own target/control row.

### Live activation preflight

Enable returns 409 and leaves the deployment paused unless all conditions hold:

- not draft or archived;
- at least one active target;
- every active live target is owned, included, connected, open, provider-
  supported, and execution-ready;
- account ceiling and target cap are configured;
- a fresh account spending base exists;
- no unresolved broker mutation/reconciliation fence exists;
- fixed platform live caps are satisfied;
- provider credentials are usable;
- the strategy supports safe open and close routing for that provider.

Unavailable sibling targets may be left unchanged through partial Apply, but a
deployment cannot be armed while it still claims an invalid active target.

## 6. Live Signal Options execution

### 6.1 Decision/outbox boundary

The existing scanner continues to resolve signals, contracts, quantities,
quotes, and exit decisions once per deployment. At the final action boundary:

- Shadow targets retain the existing Shadow ledger behavior.
- Each active live target receives an independent durable outbox item.
- A target added after an entry event starts with a cursor at `joined_at` and
  never receives that historical entry.
- Draining targets ignore new entries but continue receiving exit actions for
  their own recorded positions.
- Manual-takeover targets receive no further automated orders.

### 6.2 Entry sequence

For each active Robinhood target, independently:

1. Re-read ownership, Agentic capability, readiness, account controls, fresh
   capital base, current algo-owned target positions, and unresolved mutations.
2. Compute allowed premium as the minimum of strategy caps, target allocation,
   account-wide remaining ceiling, provider buying power, and fixed platform
   caps. Size down or reject; never size up.
3. Call Robinhood order impact/review.
4. Reject broker alerts that are classified as blocking.
5. Create the existing tax/compliance preflight under the deployment owner.
6. If it blocks or requires acknowledgement, record a target failure and do not
   auto-acknowledge.
7. Claim the durable broker mutation fence and submit one buy-to-open limit
   order using a deterministic UUID.
8. Persist broker outcome. Network/ambiguous outcomes become
   `reconciliation_required` and forbid retry until reconciled.
9. Reconcile order and position state before treating capital as free.

### 6.3 Exit sequence

Sell-to-close becomes allowed only for the automation adapter after it proves:

- the target owns an open long option position with the exact normalized
  contract;
- requested close quantity is positive and no greater than that position;
- no conflicting working close/reconciliation exists;
- the source strategy position belongs to this deployment/target;
- the account remains owned and connected.

The adapter then performs review, compliance preflight, mutation fencing, and
sell-to-close submission. A failed exit leaves the target in an explicit
attention state and is retried only under deterministic/reconciled rules. It is
never converted into a simulated close.

### 6.4 Fixed live safeguards

Strategy settings may be stricter, never looser. Initial platform ceilings are
constants in the live adapter and must be reviewed before later expansion:

- long single-leg buy-to-open and sell-to-close only;
- one contract minimum/atomic sizing;
- limit orders only for automated opens and closes;
- normal option session and existing entry cutoff only;
- stale/missing quote blocks submission;
- unresolved broker outcome blocks the target;
- target/account spend cap always on;
- daily realized-loss and maximum-open-position live halts always on;
- no provider or account fallback;
- no automatic compliance acknowledgement.

The exact user-selected account ceiling and target allocation are activation
inputs. Code and tests do not invent them.

## 7. UI behavior

### Create/edit deployment

- Tabs: **Options** and **Equities**.
- Draft can be saved before selecting an account.
- Account list includes Shadow and every owned broker account.
- Unavailable rows remain visible with a plain-language reason.
- Selected accounts show target allocation. Real accounts also show the hard
  account-wide algo ceiling.
- Caps above the account total show a warning, not a block.
- Live edits open a review surface comparing saved and proposed values.
- Apply shows per-account success/failure. Failed rows retain proposed values
  and expose **Retry failed accounts**.
- Activity toasts show the affected broker logo(s) as small overlapping
  superscript-style circular badges. Multi-account results retain one badge per
  recognizable broker and collapse overflow to a count. Text still names the
  outcome/account so recognition does not depend on color or imagery.
- Archive/restore are explicit. Archive warns and pauses first.

### Account screen

Each account shows connected deployments regardless of running state:

- linked deployment name;
- Draft/Paused/Running/Draining/Manual takeover/Archived status;
- target allocation and account ceiling;
- no edit control.

## 8. Test-driven implementation slices

1. **Schema contracts and migration**
   - failing schema/migration tests for ownership, nullable compatibility
     account, archive preservation, target exclusivity, and uniqueness;
   - additive migration only; never `drizzle push`.
2. **Owner-scoped CRUD**
   - service/route tests for draft-with-zero-targets, update, archive/restore,
     cross-user denial, and no hard delete.
3. **Target Apply**
   - tests for eligibility reasons, independent transactions, partial success,
     retry payload, allocation warning, drain, and takeover.
4. **UI models and source contracts**
   - Options/Equities, disabled account reasons, draft save, review/apply,
     partial result, retry, archive/restore, and Account links.
5. **Robinhood adapter**
   - synthetic MCP fixtures for impact, compliant open, owned close, size-down,
     target/account ceilings, tax block/ack block, provider rejection, ambiguous
     outcome, idempotent replay, and account isolation.
6. **Signal Options boundary**
   - Shadow regression byte-compatible;
   - independent target success/failure;
   - late join skips existing positions;
   - draining target exits but does not enter;
   - manual takeover stops automation;
   - no simulated live fill.
7. **Browser process**
   - intercepted/synthetic full UI flow first with a mutation firewall;
   - normal authenticated app, real read-only account inventory;
   - real UI Apply to Agentic while paused;
   - inspect console/network/UI and fix defects;
   - live preflight through UI;
   - final live-enable action only after the selected cap values are explicit;
   - verify UI, API readback, broker readiness, target/outbox state, and absence
     of duplicate or Shadow-only live events.

## 9. Validation and rollout

- Run narrow tests after every slice; serialize broader validation under the
  workspace memory gate.
- Regenerate API clients only from `lib/api-spec/openapi.yaml`; preserve
  unrelated generated changes.
- Apply the additive SQL migration explicitly; production does not auto-run SQL
  migrations on reload.
- Rebuild and use the Replit-owned restart workflow. Never shell-launch a second
  app.
- Browser QA uses `http://127.0.0.1:18747/` without safe-QA mode for the real
  path, explicit readiness selectors, network/console capture, and no
  `networkidle` dependency.
- Keep the deployment paused through every migration, test, and synthetic UI
  pass.
- The final target change and enable are made only through the normal UI. Direct
  DB/API mutation is not an acceptable substitute for the success criterion.

## 10. Completion criteria

The work is complete only when all of the following are observed:

- CRUD, drafts, archive/restore, target lifecycle, partial Apply/retry, and
  reciprocal Account links work and have focused green tests.
- Shadow Signal Options behavior remains green.
- The live adapter proves target-aware open/close, compliance, idempotency,
  ceiling, and reconciliation behavior with synthetic provider fixtures.
- The normal UI shows Pyrus Signal Options targeting the owned Agentic account
  with explicit cap values.
- The normal UI shows the deployment live and enabled.
- API readback matches the UI.
- A future qualifying signal can create at most one real Robinhood order per
  active target, and a failed sibling target cannot block it.
- No live action is represented solely by a Shadow simulated fill.
- The durable session handoff records migration, tests, UI evidence, live state,
  remaining operational monitoring, and any provider response requiring human
  attention.
