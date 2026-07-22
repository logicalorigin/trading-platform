# Algo Account Control Plane and Robinhood Live Execution Plan

**Date:** 2026-07-22  
**Status:** Draft for implementation approval; product direction approved  
**Supersedes:** The modal-oriented account-management portion of
`docs/plans/algo-deployment-account-live-robinhood-spec-2026-07-21.md`  
**Preserves:** All approved ownership, archive, target-lifecycle, execution,
compliance, and fail-closed rules in that specification  
**Primary outcome:** A signed-in PYRUS owner can manage each Algo deployment and
its execution accounts through inline controls, apply individual or bulk edits
safely, and eventually run Pyrus Signal Options on the owned Robinhood Agentic
account through the normal UI without bypassing review, reconciliation, or
platform safeguards.

## 1. Executive decision

The chosen screen architecture is a **full-width inline Accounts & Trade
Controls band** within the selected deployment tab.

- Deployment tabs remain selection-only.
- The existing Accounts action expands or collapses the inline band; it no
  longer opens the account-edit modal.
- Assigned accounts appear first. Add-account expands unassigned and
  unavailable accounts inside the same band.
- Core target controls remain visible in each expanded row. Advanced controls
  use an inline disclosure.
- Single-account and multi-account edits share one staged draft model.
- Nothing persists while the user types. A sticky bar opens an inline review
  phase and then performs an explicit Apply.
- Successful items become the new baseline. Failed items keep their proposed
  values and can be retried independently.
- Credentials and broker authorization remain in Settings. Algo owns
  assignment, lifecycle, limits, overrides, and execution status.

The control band is contextual configuration, not a replacement for the
operational cockpit. When collapsed, the current readiness, signals, and
positions hierarchy remains unchanged.

## 2. Fact, inference, and unknown ledger

### Observed in the current working tree

- Generic owner-scoped deployment list/create/update, archive/restore, mode,
  enable/pause, and strategy-setting routes exist.
- Deployment target Apply/retry/manual-takeover routes exist and already return
  independent per-account success and failure results.
- The current account manager supports assignment, allocation, account ceiling,
  drain/manual-takeover choice, review, partial result, and retry, but it is a
  modal.
- The target table has a `risk_overrides` JSON column, but the service rejects
  every non-empty override.
- The Account screen derives linked-deployment text, but the association is not
  yet a complete read-only link back to the selected Algo deployment.
- Robinhood entry, owned-position close, durable execution reservation, and
  entry/exit reconciliation services exist in the dirty tree.
- Those Robinhood services are deliberately not called by the Signal Options
  worker.
- Broker-target enablement remains hard-blocked by
  `algo_live_execution_unavailable`.
- Existing live execution records track quantities and premium at risk but do
  not contain an immutable partial-fill journal sufficient for auditable
  deployment-attributed realized P&L.
- `algo_account_controls` currently stores only the account-wide hard ceiling.

### Inferred from the approved product rules

- Deployment settings are the strategy/default envelope; target overrides are
  exceptions for one deployment-account pair.
- Account controls are shared across every deployment using that broker
  account, so changes must disclose their cross-deployment impact.
- Runtime effective limits must be computed by the server and may be lower than
  any configured value because capital, buying power, exposure, or a platform
  cap is stricter.
- Live configuration needs optimistic concurrency. A stale browser must never
  overwrite a newer saved control silently.

### Unknown until implementation or activation

- The exact Agentic target allocation percentage.
- The exact Agentic account-wide algo ceiling percentage.
- The exact account-wide and target daily-loss amounts.
- The policy values ultimately selected for the Agentic account and Pyrus
  Signal Options target. Configurability is approved; activation values are not.
- The final immutable platform caps for contracts, premium, positions, balance
  age, quote age, and risk-snapshot age.
- Whether daily-loss percentage units should be added after V1 and, if so,
  their deterministic percentage bases. USD-only target/account loss limits
  are approved for V1.
- Whether the installed Robinhood provider surface exposes complete, timely
  account-wide realized options P&L including manual trades. If it does not,
  new live entries remain blocked.

No task may invent any of these values.

## 3. Approved behavior

### Deployment and account ownership

- A deployment owns its name, strategy family, strategy/default settings,
  symbol universe, mode, run state, draft state, and archive state.
- One deployment may have zero, one, or many real or Shadow targets.
- One account may be targeted by multiple deployments.
- Broker authentication, connection repair, and Agentic authorization remain
  in Settings. Algo may show a contextual **Open Settings** link but never
  renders or accepts credentials.

### Account-target lifecycle

- Adding a target affects future entry events only. It does not copy or infer
  an existing position.
- Removing a target with algo-owned positions defaults to `draining`: no new
  entries; automated protective exits continue until flat; then detach.
- `manual_takeover` is a separate, explicit confirmation that stops all further
  automation for that target.
- A target with no open algo-owned positions may detach immediately while
  preserving its durable target record and history.
- Archive always replaces delete. Archive pauses first and preserves settings,
  targets, history, and draft state. Restore returns paused.

### Independent execution

- Each target is prepared, submitted, failed, retried, and reconciled
  independently.
- A failed sibling does not block a healthy target.
- Live broker outcomes are never represented by a simulated Shadow fill.
- An ambiguous provider response becomes `reconciliation_required`; another
  mutation for the fenced account/target is blocked until reconciliation.

### Two-layer daily loss

The user approved two independent daily-loss layers:

1. **Account emergency halt** counts all realized options P&L in the Robinhood
   Agentic account, including manual and non-PYRUS option trades.
2. **Target halt** counts realized P&L attributed to one deployment-target pair
   from its durable broker fills.

Both layers use signed net realized P&L in USD for the US options trading date
in `America/New_York`. Realized gains offset realized losses. Each layer also
has its own user-configured resume policy:

- `when_net_pnl_recovers`: clear the loss halt after trustworthy reconciled
  realized P&L rises strictly above the threshold;
- `next_trading_day`: keep the loss halt latched until the next trading date.

The account policy is shared by every deployment using that account. The target
policy inherits the deployment default unless that target explicitly overrides
it. A target override may select either policy.

At the next `America/New_York` trading date, both policies begin from the new
date's trustworthy realized-P&L fold. A missing or incomplete new-date source
blocks entry rather than clearing a halt optimistically.

If either threshold is reached:

- block all new entries within its scope;
- continue protective exits, fill reconciliation, order reconciliation, and
  state repair;
- re-evaluate signed net realized P&L after every trustworthy reconciled fill;
- apply that scope's configured resume policy; entry eligibility returns only
  when both loss scopes and every other readiness gate are clear;
- show which layer halted entries, the observed P&L, the configured threshold,
  the trading date, source freshness, and affected targets;
- fail closed when the required source is missing, stale, incomplete, or
  ambiguous.

## 4. Scope ownership and override contract

| Scope | Owns | Editable in Algo | Bulk-editable | Notes |
|---|---|---:|---:|---|
| Deployment | Name, family/strategy, universe, signal rules, contract selection, fill defaults, exit rules, risk defaults, target-loss resume default | Yes | No | The default envelope for every target. |
| Target | Assignment, lifecycle, allocation, entry-size override, contract-count override, target daily-loss override, target max-open-position override, target-loss resume override | Yes | Yes | One deployment-account pair. Numeric risk overrides may only tighten the deployment envelope in the first live release. |
| Account | Connection/readiness, hard algo ceiling, account emergency daily-loss threshold, account-loss resume policy, account-wide max algo positions | Limits/policy only | Yes | Shared by every deployment using the account. Connection/readiness is read-only here. |
| Platform | Supported order shape, provider/account eligibility, maximum caps, freshness limits, session/cutoff, compliance behavior, mutation fences | No | No | Always visible when it determines the effective value; never bypassable. |

### First-live-release target override allowlist

Only these typed keys are accepted. Unknown or structurally invalid keys are
rejected at the API boundary.

```ts
type AlgoDailyLossResumePolicy =
  | "when_net_pnl_recovers"
  | "next_trading_day";

type AlgoTargetRiskOverridesV1 = {
  riskCaps?: {
    maxPremiumPerEntryUsd?: number;
    maxContracts?: number;
    maxOpenPositions?: number;
    maxDailyRealizedLossUsd?: number;
  };
  riskPolicy?: {
    dailyLossResumePolicy?: AlgoDailyLossResumePolicy;
  };
};
```

Rules:

- All four numeric values are optional positive caps. The policy accepts only
  the two named enum values.
- Removing a key restores inheritance; blank input is never interpreted as
  zero.
- The first live release uses USD-only new target/account loss and premium
  overrides so their basis is deterministic. Existing deployment-level
  USD/percent settings remain supported.
- A numeric target override may be equal to or stricter than its deployment
  default, never looser. To increase the envelope, the user edits the
  deployment default and reviews every affected target. Resume policy is
  behavioral rather than numerically ordered, so a target may explicitly
  choose either allowed policy.
- Signal, contract-selection, fill-policy, and exit-policy overrides remain
  deployment-owned in this release. Per-target divergence for those settings
  is out of scope until a separate strategy-semantics review approves it.

### Capital, loss, and position semantics

- Allocation and account-ceiling percentages cap simultaneous premium at risk;
  they are not reservations and do not grant buying power.
- Their dollar basis is the stricter of fresh provider net liquidation and
  fresh provider buying power, matching the existing live-sizing service.
- Target premium at risk includes that target's open option premium basis plus
  pending or unresolved buy-to-open premium reservations. Account premium at
  risk is the owner/account sum across PYRUS deployments. A reservation remains
  counted until a trustworthy fill, cancellation, rejection, or reconciliation
  outcome releases it.
- Target allocation percentages on one account may total above 100% and above
  the account ceiling because they are independent maxima; review shows a
  warning, while the account ceiling still blocks aggregate spend.
- Daily-loss limits are positive USD magnitudes and realized P&L is signed USD.
  Realized gains offset realized losses before a breach. Entry halts when
  trustworthy signed net realized P&L is less than or equal to the negative
  configured limit. After a breach, `when_net_pnl_recovers` can clear the halt
  after trustworthy reconciled exits raise net P&L strictly above the limit;
  `next_trading_day` remains latched until the approved date boundary.
- A target open position is one normalized option contract with positive net
  target-owned quantity. The account-wide algo-position count is the union of
  positive PYRUS-owned target positions on that account, deduplicated by
  normalized contract; manual positions affect provider capital and the
  account P&L layer but are not mislabeled as algo-owned positions.
- Working orders and unresolved entry reservations do not count as open
  positions, but they have their own admission fence so concurrent submissions
  cannot race past a position cap.

### Effective-limit presentation

The server returns both configured and runtime-effective limits.

```text
configured target cap
    = min(deployment default, optional target override)

runtime entry premium
    = min(
        configured target cap,
        target allocation remaining,
        account ceiling remaining,
        provider buying power,
        immutable platform cap
      )
```

The UI never collapses those into one unexplained number. It shows:

- the saved deployment default;
- the saved target/account value or **Uses default**;
- the configured effective cap and which scope wins;
- the runtime amount available now, with source timestamp;
- a blocker instead of a number when freshness or trust requirements fail.

## 5. Information architecture

### Desktop

```text
┌ Active deployment identity · first blocker · mode · run · archive ┐
├ Deployment tabs: name · state · P&L · mode · dirty marker          ┤
├ ACCOUNTS & TRADE CONTROLS (explicitly expanded, full width)        ┤
│ Toolbar: selection · bulk edit · add account                       │
│ Account rows: readiness · lifecycle · core controls · effective    │
│ Advanced row details / lifecycle actions                           │
│ Sticky draft / review / result bar                                 │
├ Operational overview · signals · positions ┬ Deployment defaults   ┤
│                                             │ and diagnostics rail  │
└─────────────────────────────────────────────┴───────────────────────┘
```

The account band spans the Algo workspace while open because the current
380-pixel rail is not wide enough for comparison or bulk editing. The existing
right rail remains the deployment-default editor and diagnostics surface.

### Tablet and phone

```text
Active deployment → deployment tabs → Accounts & controls toggle
→ stacked inline account records → sticky Review bar
→ operational overview → signals → positions
```

- The account band remains inline; it does not become an edit modal.
- Each account record uses a two-column field grid where space allows and a
  one-column grid at pocket widths.
- Core fields remain visible. Advanced settings and lifecycle actions use a
  closed native disclosure.
- Touch actions are at least 44px. The deployment-tab strip scrolls
  horizontally without document-level overflow.
- The existing narrow Settings drawer may continue to host deployment-default
  controls; account editing does not depend on that drawer.

## 6. Component and interaction contract

### 6.1 Deployment tabs

Each tab shows:

- deployment name;
- operational state shape and word label;
- SHADOW or LIVE badge;
- P&L when trustworthy and available;
- archived badge when applicable;
- a non-color dirty marker and accessible dirty-field count.

Tabs perform selection only. Mode, run, archive, rename, and account actions are
outside the tab control. Switching deployments preserves each deployment's
in-memory draft and dirty marker. Leaving the Algo route or reloading with dirty
drafts requires discard confirmation.

### 6.2 Accounts & Trade Controls header

The expanded header shows:

- assigned, ready, blocked, draining, and dirty counts;
- **Add account**;
- selected-row count and **Bulk edit**;
- collapse control;
- inventory freshness or a clear unavailable state.

Opening Add account reveals owned unassigned accounts in the same band.
Unavailable accounts remain visible and disabled with the first plain-language
blocker and an optional Settings link.

### 6.3 Account row

Always-visible identity and state:

- selection checkbox;
- broker logo and display name;
- Shadow/real mode;
- connection state, execution readiness, and freshness;
- target lifecycle;
- account-scope shared indicator when other deployments use the account.

Always-visible core controls for an assigned target:

- target allocation percentage;
- account-wide algo ceiling percentage;
- maximum premium per entry;
- maximum contracts;
- target daily realized-loss halt;
- target daily-loss resume policy, inherited or overridden;
- target maximum open positions;
- effective-limit summary.

Advanced disclosure:

- account emergency daily-loss threshold, current remaining loss room, and
  account resume policy;
- account-wide maximum algo positions;
- deployment defaults and inheritance provenance;
- current target exposure, open positions, working orders, and unresolved
  reconciliation status;
- joined/draining timestamps;
- **Drain**, **Detach when flat**, and **Manual takeover** actions;
- provider/platform constraints as read-only facts.

### 6.4 Inheritance controls

Each overridable field has two explicit states:

- **Uses default**: input is inactive and the deployment value is visible.
- **Override**: input is active, marked as an override, and shows the previous
  effective value.

Resetting an override is an explicit **Use deployment default** action. Emptying
an input creates a validation error; it never silently resets or writes zero.
The deployment-default editor includes **Target loss resume default**. Account
rows show the inherited/effective target policy beside its threshold, while the
account emergency policy is always an explicit shared-account value.

### 6.5 Bulk edit

Bulk edit uses an explicit field mask. Every bulk field is one of:

- **No change**;
- **Set value**;
- **Use deployment default** where inheritance is supported.

Only selected eligible rows participate. Disabled/unavailable rows cannot be
selected. Account-scope fields warn that they affect other deployments. Bulk
actions never infer a value from the first selected row and never overwrite an
unselected field.

Supported first-release bulk operations:

- assign selected available accounts;
- set target allocation;
- set or clear the four target risk-cap overrides and target resume-policy
  override;
- set account ceiling, account emergency daily loss, and account-wide max algo
  positions, plus the account resume policy;
- begin draining selected active targets;
- retry failed rows.

Manual takeover is intentionally excluded from bulk actions.

### 6.6 Draft, review, and Apply phases

The band has four stable phases:

1. **Saved** — no draft.
2. **Editing** — saved values remain active; dirty fields and tabs are marked.
3. **Review** — grouped before/after changes, effective values, warnings,
   cross-deployment account impacts, and pause requirements.
4. **Result** — succeeded, failed, not-attempted, warnings, and retry actions.

The sticky bar shows the number of changed fields and affected accounts. It
offers **Discard** and **Review changes**. Review offers **Back** and
**Apply changes**.

For a live running deployment, configuration remains editable but Apply is
fail-closed. The first implementation should require a pause before applying any
live configuration change. Review explains this and offers **Pause & Apply** as
one explicit, audited action. The deployment stays paused after Apply; the user
must separately enable live trading.

### 6.7 Partial success, retry, and concurrency

- Deployment/default changes are one atomic base-configuration operation.
- If the base operation fails, dependent target changes are not attempted.
- Target/account items then apply independently.
- Successful target rows advance to the returned saved baseline.
- Failed or not-attempted rows keep their proposed values and exact reasons.
- **Retry failed accounts** sends only the failed items with current expected
  revisions.
- A revision conflict does not auto-merge. The UI shows saved-vs-proposed-vs-
  newer-server values and requires refresh/review.
- A failed background refresh never erases a successfully loaded baseline.

### 6.8 Deployment CRUD

**Create** keeps the existing compact Options/Equities dialog. It creates a
paused zero-account draft and opens its new tab with Accounts & Trade Controls
expanded. The create dialog does not become a large account/settings wizard.

**Read** uses the canonical owner-scoped inventory with archived rows included.

**Update** places name, universe, and draft/ready state in a compact Deployment
details disclosure inside the selected tab. Strategy/default controls continue
in the right rail and participate in the shared dirty/review state.

**Delete** is never exposed. **Archive** and **Restore** remain explicit header
actions with confirmation, focus return, and truthful paused state.

### 6.9 Account screen reciprocal view

Each real or Shadow account shows every non-detached linked deployment,
including archived rows:

- linked deployment name;
- Draft, Paused, Running, Draining, Manual takeover, or Archived;
- target allocation;
- account ceiling;
- target/account halt state when available;
- **Open in Algo** deep link carrying the deployment ID.

This view is read-only. There are no inline edit, enable, pause, detach, or
credential controls on Account.

### 6.10 Replace the legacy live-money switch with selected-target activation

The current header control is unsafe as a mental model: it only changes
`deployment.mode`, while execution authority now belongs to explicit
deployment-account targets. It must not remain a stand-alone “Switch to live
money” mutation.

The replacement is one coherent workflow:

1. While Shadow, the header action reads **Prepare live trading**. It opens the
   activation review; it does not PATCH mode by itself.
2. The review lists every linked broker target with an explicit checkbox. A
   header-launched review starts with none selected. A review launched from an
   account row may preselect only that row. There is no implicit “all linked
   accounts” behavior.
3. Each selected row shows deployment allowance, shared account total, shared
   account daily-loss amount and fixed scope, strategy entry/position limits,
   immutable platform caps, provider readiness, data freshness, unresolved
   mutations, and owned-exit/reconciliation readiness. Missing user settings
   link back to that row's inline editor.
4. A read-only server review returns normalized values, all blockers, affected
   target IDs, target/account revisions, and a short-lived single-use review
   token. It never changes mode, run state, or target authorization.
5. **Enable selected accounts** revalidates the review token and every live
   prerequisite. In one database transaction it changes the deployment to
   Live, enables the deployment, and sets `execution_enabled=true` only for the
   reviewed target IDs. Non-selected linked targets remain staged and disabled.
   Any blocker leaves all three layers unchanged.
6. Once Live, the mode control reads **LIVE · n accounts** and opens **Manage
   live accounts**. The adjacent Run control becomes an operational pause/
   resume for new entries; pausing does not silently revoke target authority or
   abandon owned exits.
7. Returning to Shadow is blocked while a target is armed, draining, or owns
   an open/unresolved position. The user must pause entries and explicitly
   disable, drain, or take over each affected target first.

This preserves the useful deployment-wide pause while making real-money
authorization exact, reviewable, and account-scoped. A 409 keeps the prior
state and focuses the first blocking row.

## 7. UX state matrix

| Surface | Loading | Empty | Error | Success | Partial/stale |
|---|---|---|---|---|---|
| Deployment tabs | Stable tab skeleton; no stale substitution | Explain no deployments and offer Create | Inventory unavailable; preserve last success during background failure | Selected tab and status explicit | Dirty/stale markers remain word-labeled |
| Account band | Preserve column/row geometry | Zero-account draft plus Add account | Inline inventory error with retry | Assigned rows and effective limits | Last-known rows remain with timestamp and amber freshness |
| Account row | Identity skeleton and disabled fields | Not assigned; allocation required to add | Row-local blocker; no disappearing row | Ready/active with saved values | Draining, partial apply, conflict, or stale source is row-local |
| Review | Stable grouped diff | No changes; Apply disabled | Authoritative validation errors beside fields | Exact before/after and impact | Warning and pause-required groups do not masquerade as errors |
| Apply result | Disable changed fields; preserve diff | Not applicable | Base or row-specific failure | Saved baseline advances | Succeeded/failed/not-attempted groups plus retry |
| Live preflight | Preserve last result and label checking | No active target blocker | First blocker plus full list | Ready-to-enable summary | Stale risk/capital/reconciliation state blocks entry |

## 8. Accessibility and responsive requirements

- Reuse the canonical buttons, inputs, Select, status pills, tooltips, dialogs,
  and focus treatment.
- Use native checkboxes, fieldsets, labels, inputs, and disclosures.
- The account grid has semantic column headers on desktop; stacked rows retain
  explicit field labels on tablet/phone.
- Tab and row selection are separate focus targets. No control is nested inside
  a focusable tab.
- All icon-only controls have accessible names and tooltips.
- Apply, archive, takeover, pause, and live enable restore focus on cancel or
  failure.
- Color is never the only signal for mode, health, lifecycle, dirty state, or
  result.
- Desktop controls meet the 24px minimum; touch layouts use 44px targets.
- Error messages are associated with their inputs. The result summary is an
  appropriate live region without repeatedly announcing market-data updates.
- Reduced-motion settings remove panel/value transitions without changing
  visibility or hierarchy.
- Conformance widths are 390x844, 768x1024, and 1440x900 in dark and light
  themes.

## 9. Persistence changes

The July 21 additive migration and schema are the starting point. They have not
been re-applied or runtime-validated in this planning session.

### 9.1 Configuration revisions

Add monotonic revision fields to prevent lost updates:

- `algo_deployments.configuration_revision bigint not null default 1`
- `algo_deployment_targets.configuration_revision bigint not null default 1`
- `algo_account_controls.configuration_revision bigint not null default 1`

Every relevant update increments its row revision. Apply requests carry the
expected revision; mismatches fail only the affected atomic unit.

### 9.2 Account controls

Extend `algo_account_controls` with nullable, activation-required controls:

- `max_daily_realized_options_loss_usd numeric(20,6)`
- `daily_loss_resume_policy text`
- `max_open_algo_positions integer`
- revision and normal timestamps

The fields remain nullable during migration. The policy has a database check
for `when_net_pnl_recovers` or `next_trading_day`. Live preflight rejects an
active real target until required controls and policies are explicitly
configured.

### 9.3 Typed target overrides

Keep `risk_overrides jsonb`, but validate it against the V1 allowlist on read
and write. Malformed legacy JSON blocks live entry and is surfaced as a
configuration error; it is never silently ignored.

### 9.4 Immutable fill journal

Add `algo_target_execution_fills`:

- owner, deployment, target, execution, account, and provider identity;
- broker fill ID or deterministic provider-event identity;
- quantity, fill price, fees, side/effect, and filled timestamp;
- normalized contract snapshot and bounded raw provenance/hash;
- uniqueness fence for account/provider/fill identity.

Partial fills create separate immutable rows. Position and realized-P&L folds
consume fills; they do not infer a filled price from the requested limit.

### 9.5 Daily risk state

Add an auditable daily state/cache keyed by trading date and scope:

- account scope: all realized options P&L from the broker source;
- target scope: realized P&L folded from attributed fills;
- threshold, applied resume policy, current threshold-breached/latched state,
  breach/clear timestamps, source cursor/freshness, calculated timestamp, and
  last trustworthy observation;
- unique account/date and target/date constraints.

The cache is not an independent source of truth. Provider activity and the
immutable fill journal must be sufficient to rebuild it.

## 10. API contract

All writes retain authenticated-owner, CSRF, and existing admin requirements
for live broker mutation. Secrets and provider payloads are never returned.

### 10.1 Enriched read model

`GET /api/algo/deployment-accounts?strategyKind=options` returns:

- every owned Shadow and broker account;
- stable local account IDs and public broker identity;
- assignment eligibility and all public blocker codes/messages;
- connection/readiness/freshness summary;
- saved account controls and revision;
- linked-deployment count for shared-impact copy;
- no credentials, access tokens, provider raw alerts, or internal exception
  text.

Deployment targets additionally return:

- saved target overrides and revision;
- server-computed configured effective controls and resume-policy provenance;
- lifecycle and timestamps;
- open position/working order/unresolved reconciliation counts;
- daily target/account risk status with freshness.

### 10.2 Review contract

Add a read-only endpoint:

`POST /api/algo/deployments/{deploymentId}/configuration/review`

Request:

- expected deployment revision;
- optional details/default patch;
- desired target/account changes with expected revisions;
- no broker mutation and no database write.

Response:

- normalized before/after groups;
- configured and currently effective values;
- warnings, blockers, cross-deployment impacts, and pause requirement;
- deterministic review hash bound to normalized payload and revisions.

### 10.3 Apply contract

Add:

`POST /api/algo/deployments/{deploymentId}/configuration/apply`

The request contains the reviewed normalized payload, expected revisions, and
review hash. The service recomputes validation and hash before mutation.

Response shape:

```json
{
  "deployment": { "status": "succeeded", "value": {} },
  "succeeded": [{ "accountId": "...", "target": {}, "effective": {} }],
  "failed": [{ "accountId": "...", "code": "...", "message": "..." }],
  "notAttempted": [{ "accountId": "...", "reason": "base_change_failed" }],
  "warnings": [],
  "deploymentPaused": true
}
```

Base deployment/default changes commit atomically. Target/account items retain
independent transactions. The existing PATCH/settings and target Apply/retry
routes remain compatibility delegates until all consumers migrate.

### 10.4 Retry and lifecycle

- Existing target retry accepts only failed normalized target items and fresh
  expected revisions.
- Drain remains a target Apply action.
- Manual takeover retains its dedicated endpoint and explicit confirmation.
- All responses use bounded public error codes/messages and emit owner-scoped
  audit/activity events.

### 10.5 Live preflight

Enable remains a separate endpoint but returns a structured blocker list, not
only the first string. It must verify:

- deployment lifecycle, mode, and active-target presence;
- ownership, Agentic capability, connection, account inclusion, option level,
  and provider execution readiness;
- target allocation and all required target/account controls;
- deployment, target, and account daily-loss resume policies;
- fresh capital and both daily-risk scopes;
- open-position caps and immutable platform caps;
- no unresolved order/reconciliation fence;
- working entry and owned-close adapters for the provider;
- no required compliance acknowledgement.

## 11. Client state model

Introduce one deployment-keyed configuration draft store:

```text
saved baseline + revisions
        ↓
deployment details draft
deployment-default draft
target/account row drafts
        ↓
validation + dirty-field registry
        ↓
authoritative review response
        ↓
apply result reconciliation
```

Requirements:

- drafts survive deployment-tab switching but not a confirmed discard;
- background reads never overwrite dirty fields;
- a changed server revision marks the draft stale;
- successful sections update only their own saved baseline;
- failed rows retain inputs and validation context;
- query invalidation/refetch happens after result reconciliation, not before;
- the existing `saveAllAlgoAdjustments` behavior is migrated into this
  coordinator rather than creating a second competing save bar.

## 12. Live Signal Options boundary

### 12.1 Target dispatcher

At the final strategy entry/exit decision boundary, build one immutable source
event and fan it out to eligible targets:

- active Shadow targets keep the current ledger behavior;
- active live targets call the live adapter independently;
- draining targets receive only exits for their own attributed positions;
- manual-takeover and detached targets receive no automation;
- `joined_at` plus a source-event watermark prevents late-joined targets from
  receiving historical entries.

### 12.2 Entry

For each live Robinhood target:

1. Reload ownership, lifecycle, readiness, revisions, controls, capital, daily
   risk, positions, and unresolved mutations.
2. Resolve the strictest configured and runtime cap; size down, never up.
3. Reserve the deterministic outbox execution.
4. Review the exact limit order with Robinhood.
5. Run tax/compliance preflight; never auto-acknowledge.
6. Claim the broker mutation fence and submit once.
7. Persist the broker identity/outcome; ambiguous results require
   reconciliation.
8. Reconcile fills and positions before releasing capital or considering the
   entry complete.

### 12.3 Exit

For each target-owned open position:

- reserve an exit identity tied to the source exit/scale-out action;
- prove exact contract, provider position, quantity, deployment, and target;
- allow sell-to-close only, for no more than the owned long quantity;
- review, preflight, fence, submit, journal fills, and reconcile;
- keep exits running during daily-loss halts and draining;
- move failures/ambiguity to attention, never to a simulated close.

### 12.4 Reconciliation and crash recovery

- A scheduler scans submitted and reconciliation-required live executions.
- It resolves provider orders/fills/positions using stable identities and
  conservative matching where Robinhood lacks direct ref-ID lookup.
- It updates the fill journal, target position fold, capital reservations, and
  daily-risk state idempotently.
- Unknown or conflicting matches keep the target blocked and visible in Algo.
- Startup recovery runs reconciliation before live entry workers are admitted.

## 13. Ordered implementation tasks

Each task is intended to fit one focused implementation session. Do not start a
later phase while its checkpoint is red.

### Phase A — Contracts and persistence

#### Task 1 — Define the control schema and effective resolver

**Description:** Add shared typed schemas and pure resolution functions for
deployment defaults, target overrides, account controls, platform caps, and
scope provenance.

**Acceptance criteria:**

- [ ] Unknown override keys and invalid values fail closed.
- [ ] Resolution returns configured value, effective value, winning scope, and
      blockers without inventing platform values.
- [ ] Numeric target overrides cannot loosen the deployment envelope; target
      resume policy inherits or uses either explicit allowed policy.

**Verification:** Focused pure-function tests for inheritance, reset-to-default,
account/platform precedence, both resume policies, missing data, and boundary
values.

**Dependencies:** None.  
**Likely files:** New shared policy module and test; existing Signal Options
profile types only where reuse is necessary.  
**Scope:** Medium.

#### Task 2 — Add revisions and extended account controls

**Description:** Create an additive SQL migration and matching schema changes
for configuration revisions, account daily-loss amount/resume policy, and
account-wide max algo positions.

**Acceptance criteria:**

- [ ] Existing rows remain readable and nullable controls do not acquire fake
      defaults.
- [ ] Constraints reject nonpositive limits/revisions and unknown policy values.
- [ ] No destructive schema push is used.

**Verification:** Migration/schema tests plus SQL review against the existing
July 21 migration.

**Dependencies:** Task 1.  
**Likely files:** `lib/db/migrations/`, `lib/db/src/schema/automation.ts`, focused
schema tests.  
**Scope:** Medium.

#### Task 3 — Add the immutable fill journal

**Description:** Persist partial broker fills with stable provider identity and
enough price/fee provenance to rebuild positions and target realized P&L.

**Acceptance criteria:**

- [ ] Duplicate provider fills are idempotent.
- [ ] Partial fills remain separate and fold deterministically.
- [ ] Cross-owner/account/target attribution is rejected.

**Verification:** Schema and service tests for duplicates, partial fills,
replays, and ownership isolation.

**Dependencies:** Task 2.  
**Likely files:** additive migration, automation schema, new fill-journal service
and test.  
**Scope:** Medium.

#### Task 4 — Add daily-risk state and folds

**Description:** Fold account-source activity and target fills into auditable
daily account/target risk states without treating the cache as source of truth.

**Acceptance criteria:**

- [ ] Account scope includes manual/non-PYRUS realized option activity.
- [ ] Target scope includes only attributed target fills.
- [ ] Recovery policy can clear after trustworthy net-P&L improvement; next-day
      policy stays latched until the `America/New_York` date changes.
- [ ] Missing, stale, incomplete, or conflicting sources produce a blocking
      state while exits remain admissible.

**Verification:** Time-zone/date, partial close, fees, manual trade, replay,
staleness, threshold breach, trustworthy exit-driven recovery, and reset tests.

**Dependencies:** Task 3.  
**Likely files:** new daily-risk service/test and schema/migration additions.  
**Scope:** Medium.

### Checkpoint A — Foundation

- [ ] Focused schema and service tests pass.
- [ ] Existing Shadow Signal Options tests remain green.
- [ ] No live enable gate is removed.
- [ ] Migration remains additive and has an explicit rollback/forward-repair
      note.

### Phase B — Owner-scoped API and concurrency

#### Task 5 — Enrich the account and target read models

**Description:** Return readiness, freshness, controls, revisions, linkage
impact, effective limits, and live-risk state through owner-scoped services.

**Acceptance criteria:**

- [ ] Every owned account remains visible; unavailable rows include safe public
      reasons.
- [ ] No secret or raw provider payload appears.
- [ ] Account and target scopes are distinguishable in the response.

**Verification:** Service/route tests for Robinhood Agentic, Shadow, unsupported,
excluded, disconnected, stale, and cross-user cases.

**Dependencies:** Checkpoint A.  
**Likely files:** deployment-management service, automation routes, focused
tests.  
**Scope:** Medium.

#### Task 6 — Implement authoritative configuration review

**Description:** Normalize and validate proposed base plus target/account
changes without mutation and return the exact review model/hash.

**Acceptance criteria:**

- [ ] Review performs zero database or broker mutation.
- [ ] Shared-account impacts, allocation warnings, effective values, revision
      conflicts, and pause requirement are explicit.
- [ ] Review output is deterministic for identical facts.

**Verification:** Mutation-firewall tests and deterministic snapshot tests.

**Dependencies:** Task 5.  
**Likely files:** new configuration-review service/test and route test.  
**Scope:** Medium.

#### Task 7 — Implement base configuration Apply

**Description:** Apply reviewed deployment details/defaults atomically with
revision checking and pause-first behavior for live configurations.

**Acceptance criteria:**

- [ ] Hash or revision mismatch writes nothing.
- [ ] Live Apply pauses before changing configuration and never re-enables.
- [ ] Compatibility settings routes use the same validators.

**Verification:** Atomicity, stale revision, pause, ownership, CSRF, and
cross-user route tests.

**Dependencies:** Task 6.  
**Likely files:** configuration service/route and focused tests.  
**Scope:** Medium.

#### Task 8 — Extend independent target/account Apply and retry

**Description:** Accept typed overrides and revisions while preserving
per-account transactions and failure isolation.

**Acceptance criteria:**

- [ ] One target failure never rolls back a successful sibling.
- [ ] Successful rows return new revisions/effective values; failed rows remain
      unchanged.
- [ ] Retry accepts only failed rows and revalidates current facts.

**Verification:** Partial success, conflict, allocation warning, shared account
control, drain, detach, and retry tests.

**Dependencies:** Task 7.  
**Likely files:** deployment-management service/test and route test.  
**Scope:** Medium.

#### Task 9 — Update OpenAPI and generated clients

**Description:** Make the reviewed configuration and enriched read contracts
canonical in OpenAPI, then regenerate clients from that source only.

**Acceptance criteria:**

- [ ] Generated hooks/types expose review, apply, retry, effective controls,
      and structured blockers.
- [ ] Codegen drift guard passes.
- [ ] Unrelated generated changes are preserved.

**Verification:** `pnpm --filter @workspace/api-spec run codegen`, API-spec tests,
client typecheck, and `pnpm run audit:api-codegen`.

**Dependencies:** Tasks 5-8.  
**Likely files:** `lib/api-spec/openapi.yaml`, API-spec tests, generated client.  
**Scope:** Medium.

### Checkpoint B — Contract complete

- [ ] Owner/CSRF/admin rules are green.
- [ ] Review is read-only and deterministic.
- [ ] Apply conflict and partial-success behavior is proven.
- [ ] Generated-client drift is clean.
- [ ] Broker live enable remains fail-closed.

### Phase C — Inline UI and CRUD

#### Task 10 — Add the inline control-band shell and draft registry

**Description:** Replace the account-modal trigger with a full-width expandable
band and deployment-keyed in-memory drafts/dirty markers.

**Acceptance criteria:**

- [ ] Opening Accounts renders inline and performs no mutation.
- [ ] Deployment switching preserves independent drafts and marks dirty tabs.
- [ ] Route/reload exit with dirty drafts requires an explicit decision.

**Verification:** Component tests for open/collapse, tab switching, dirty counts,
and nonmutation.

**Dependencies:** Task 9.  
**Likely files:** `AlgoScreen.jsx`, `AlgoLivePage.jsx`, new control-band/draft
model and tests.  
**Scope:** Medium.

#### Task 11 — Render account inventory and readiness rows

**Description:** Show assigned, available, and unavailable owned accounts with
stable row states and public blockers.

**Acceptance criteria:**

- [ ] Assigned rows sort first; Add account reveals unassigned rows inline.
- [ ] Unavailable rows stay visible/disabled and link to Settings when useful.
- [ ] Loading/error/stale states preserve row geometry and last-known data.

**Verification:** Row/model tests for Agentic, Shadow, unsupported, excluded,
disconnected, stale, and missing-target cases.

**Dependencies:** Task 10.  
**Likely files:** new account-row/model files and tests; existing broker logos.  
**Scope:** Medium.

#### Task 12 — Add single-row controls and inheritance

**Description:** Implement core fields, explicit override/default states,
validation, scope labels, and effective-value provenance.

**Acceptance criteria:**

- [ ] Blank, invalid, inherited, overridden, and reset states are distinct.
- [ ] Account-scope fields disclose shared deployment impact.
- [ ] Both resume policies are editable at their correct scope and their saved
      or inherited provenance is explicit.
- [ ] Effective values and stale blockers come from the server model.

**Verification:** Pure model and component tests for every field/scope and
keyboard interaction.

**Dependencies:** Task 11.  
**Likely files:** account-row, field/model, and focused test files.  
**Scope:** Medium.

#### Task 13 — Add masked multi-account bulk editing

**Description:** Apply explicit No change/Set/Use default operations to selected
eligible rows.

**Acceptance criteria:**

- [ ] Unmasked fields are never changed.
- [ ] Mixed values remain visibly mixed until a field is explicitly included.
- [ ] Bulk resume-policy edits use the same explicit field mask and never alter
      an unselected scope.
- [ ] Manual takeover and unavailable accounts cannot enter a bulk batch.

**Verification:** Model/component tests for mixed selection, shared account
fields, reset-to-default, validation, and keyboard selection.

**Dependencies:** Task 12.  
**Likely files:** bulk toolbar/model and tests.  
**Scope:** Medium.

#### Task 14 — Add inline Review, Apply, partial result, and retry

**Description:** Connect the draft registry to authoritative review/apply and
reconcile each returned section/row truthfully.

**Acceptance criteria:**

- [ ] Review compares saved/proposed/effective values and names pause/shared
      impacts.
- [ ] Successful baselines advance while failed/not-attempted drafts remain.
- [ ] Retry sends only failed rows and never repeats a successful mutation.

**Verification:** Component/integration tests with mutation counts, conflict,
base failure, partial target result, retry, focus, and live-region assertions.

**Dependencies:** Task 13.  
**Likely files:** control-band phase components/model, `AlgoScreen.jsx`, tests.  
**Scope:** Medium.

#### Task 15 — Complete target lifecycle interactions

**Description:** Move add, drain, detach-when-flat, and manual takeover into
inline row interactions with position-aware confirmations.

**Acceptance criteria:**

- [ ] Add establishes a future-event cursor and never copies positions.
- [ ] Remove defaults to draining when positions exist.
- [ ] Manual takeover is single-row, explicit, and stops all automation.

**Verification:** UI model/component tests plus route service tests for open and
flat targets.

**Dependencies:** Task 14.  
**Likely files:** lifecycle row/actions, Algo screen wiring, tests.  
**Scope:** Medium.

#### Task 16 — Complete deployment details, archive, and restore CRUD

**Description:** Add inline deployment details and ensure archived inventory is
selectable/restorable without introducing hard delete.

**Acceptance criteria:**

- [ ] Name/universe/draft edits share the staged review flow.
- [ ] Archive pauses and preserves drafts/settings/targets/history.
- [ ] Restore returns paused with previous draft/ready state.

**Verification:** CRUD component/route tests and focus-safe confirmation tests.

**Dependencies:** Task 14.  
**Likely files:** detail disclosure, Algo screen, existing deployment tabs/tests.  
**Scope:** Medium.

#### Task 17 — Add reciprocal Account links

**Description:** Replace summary-only association with a read-only deployment
list and deep links to Algo.

**Acceptance criteria:**

- [ ] Active, draining, takeover, draft, paused, running, and archived states
      render correctly.
- [ ] Open in Algo selects the correct deployment without mutating it.
- [ ] Account has no configuration or credential mutation controls.

**Verification:** Account component/source tests and deep-link navigation test.

**Dependencies:** Task 16.  
**Likely files:** `AccountScreen.jsx`, Account tabs/disclosure, focused tests.  
**Scope:** Medium.

#### Task 18 — Prove responsive, accessibility, and state coverage

**Description:** Exercise the full inline workflow at the doctrine widths in
both themes with zero protected mutations until Apply fixtures are explicitly
enabled.

**Acceptance criteria:**

- [ ] Desktop compares all core fields; tablet/phone stack without document
      overflow or clipped actions.
- [ ] Keyboard, focus, labels, error association, touch targets, and reduced
      motion pass.
- [ ] Loading, empty, error, success, partial, stale, and conflict states retain
      stable dimensions.

**Verification:** Focused component suite, design audit, and six-presentation
Playwright fixture with a mutation firewall.

**Dependencies:** Tasks 10-17.  
**Likely files:** Algo component tests and a dedicated browser-validation spec.  
**Scope:** Medium.

### Checkpoint C — Control plane complete

- [ ] All deployment/account CRUD is available through the normal UI.
- [ ] No account-edit modal remains as a competing path.
- [ ] Single and bulk edits, review, Apply, conflict, partial result, and retry
      are green.
- [ ] Account reciprocal links are read-only and accurate.
- [ ] No broker order has been submitted.

### Phase D — Live execution wiring

#### Task 19 — Finish account-wide Robinhood risk ingestion

**Description:** Load trustworthy all-options realized P&L and open-position
facts for Agentic with freshness and source completeness guarantees.

**Acceptance criteria:**

- [ ] Manual and non-PYRUS option activity is included.
- [ ] Missing/stale/partial provider data blocks entries.
- [ ] Provider/account ownership and Agentic identity are rechecked each read.

**Verification:** Synthetic provider fixtures for manual gains/losses, partial
history, stale data, wrong account, closed account, and provider failures.

**Dependencies:** Checkpoint C and Task 4.  
**Likely files:** Robinhood risk loader/service and tests.  
**Scope:** Medium.

#### Task 20 — Enforce both loss layers and position caps in entry preparation

**Description:** Replace the single profile-only risk check with account,
target, and immutable platform enforcement.

**Acceptance criteria:**

- [ ] Either daily-loss layer or either position cap blocks new entries.
- [ ] Protective exits and reconciliation are not blocked by those halts.
- [ ] Recovery-policy scopes can clear after a trustworthy net-P&L improvement;
      next-day scopes remain latched until the date changes.
- [ ] Entries resume only when both scopes and every other gate are clear.
- [ ] Every execution snapshot records the facts and caps used.

**Verification:** Entry service tests covering each winning cap, halt, stale
snapshot, and effective sizing result.

**Dependencies:** Task 19 and approved numeric platform constants.  
**Likely files:** Robinhood entry/sizing services and tests.  
**Scope:** Medium.

#### Task 21 — Wire independent live entry fanout

**Description:** Connect qualifying Signal Options entry events to active
targets through the durable entry adapter while preserving Shadow behavior.

**Acceptance criteria:**

- [ ] One qualifying source event creates at most one execution per active
      target.
- [ ] A late-joined, draining, takeover, detached, or blocked target does not
      receive an entry.
- [ ] A failed target does not block a healthy sibling; Shadow remains
      regression-compatible.

**Verification:** Worker integration tests for multi-target fanout, replay,
crash, partial failure, lifecycle, and no simulated live fill.

**Dependencies:** Task 20.  
**Likely files:** new target dispatcher/test plus the smallest final-action seam
in Signal Options worker/automation.  
**Scope:** Medium.

#### Task 22 — Wire target-owned live exits

**Description:** Reserve and execute close/scale-out events only against the
exact target-owned reconciled position.

**Acceptance criteria:**

- [ ] Quantity cannot exceed the owned long option position.
- [ ] Draining targets continue exits; takeover targets do not.
- [ ] Failure or ambiguity becomes attention/reconciliation, never a simulated
      close.

**Verification:** Exit integration tests for full/partial close, scale-out,
double-sell fence, gap/stale quote, drain, takeover, and provider ambiguity.

**Dependencies:** Task 21.  
**Likely files:** exit dispatcher/service seam and focused tests.  
**Scope:** Medium.

#### Task 23 — Add reconciliation admission and recovery

**Description:** Reconcile submitted/ambiguous entries and exits before new
mutations, including startup recovery.

**Acceptance criteria:**

- [ ] Order/fill/position folds are idempotent across restarts.
- [ ] Unknown/conflicting provider matches keep the target blocked and visible.
- [ ] Live entry admission waits until required recovery completes.

**Verification:** Reconciliation scheduler tests for crash points, duplicate
fills, partial fills, provider delay, missing ref ID, and startup gating.

**Dependencies:** Tasks 21-22.  
**Likely files:** reconciliation scheduler/service and tests; startup admission
seam.  
**Scope:** Medium.

#### Task 24 — Surface target execution and halt attention in Algo

**Description:** Expose per-target entry/exit/reconciliation/halt state through
the cockpit and account rows without turning configuration into a log viewer.

**Acceptance criteria:**

- [ ] The first blocker names target/account and recovery action.
- [ ] Submitted, filled, rejected, reconciliation-required, draining, and halt
      states are word-labeled with freshness.
- [ ] Manual recovery links are shown only when a safe supported action exists.

**Verification:** Read-model/component tests and deterministic attention-state
browser fixture.

**Dependencies:** Task 23.  
**Likely files:** cockpit stream/read model, account row/attention UI, tests.  
**Scope:** Medium.

### Checkpoint D — Synthetic live path complete

- [ ] Entry, exit, fill journal, positions, both daily-loss layers, caps,
      compliance, idempotency, partial sibling failure, and reconciliation are
      green under synthetic provider fixtures.
- [ ] Shadow regression suite remains green.
- [ ] Broker live enable gate is still present until the final rollout task.
- [ ] No real order has been submitted.

### Phase E — Migration, UI activation, and monitored rollout

#### Task 25 — Validate migration and normal runtime readback

**Description:** Apply the reviewed additive migration through the approved
database process, rebuild, restart through Replit ownership, and verify normal
UI/API readback while paused.

**Acceptance criteria:**

- [ ] Migration state, revisions, controls, targets, and existing history read
      back correctly.
- [ ] The normal app shows Agentic and Shadow with truthful readiness/blockers.
- [ ] No second app process is launched and no live mutation occurs.

**Verification:** Migration audit, targeted typechecks/builds, normal-URL browser
inspection, console/network capture, and API readback.

**Dependencies:** Checkpoint D.  
**Likely files:** no new product code unless runtime evidence reveals a scoped
defect.  
**Scope:** Medium operational task.

#### Task 26 — Apply explicit Agentic controls through the normal UI

**Description:** While paused, enter the user-selected allocation, account
ceiling, both daily-loss amounts and resume policies, and position/entry caps;
review and Apply through the inline control plane.

**Acceptance criteria:**

- [ ] Every value is explicit and user-approved; no default is fabricated.
- [ ] UI, API, database, and effective readback agree.
- [ ] Provider and reconciliation preflight remain green with no order placed.

**Verification:** Captured reviewed diff, Apply response, fresh API readback,
and zero-order broker audit.

**Dependencies:** Task 25 plus the unresolved numeric and per-scope policy
selections.  
**Likely files:** none expected.  
**Scope:** Small operational task.

#### Task 27 — Remove the final broker enable gate and enable through UI

**Description:** Remove only the source-confirmed temporary adapter gate after
all synthetic/runtime evidence is green, then switch/enable through the normal
UI with explicit human approval.

**Acceptance criteria:**

- [ ] No other safety, ownership, freshness, compliance, or reconciliation gate
      is weakened.
- [ ] Enable succeeds only with the exact reviewed configuration and remains
      fail-closed otherwise.
- [ ] A future qualifying event can create at most one real order per healthy
      active target.

**Verification:** Focused preflight test, normal-UI enable/readback, provider
readiness, outbox inspection, and duplicate-order audit. Do not manufacture a
signal or place a test order unless separately authorized.

**Dependencies:** Task 26 and explicit final approval.  
**Likely files:** deployment preflight service/test; possibly feature-gate
configuration.  
**Scope:** Small but high risk.

#### Task 28 — Monitor the first live window and document rollback

**Description:** Observe readiness, outbox, broker orders/fills, reconciliation,
daily-risk state, and duplicate fences through a bounded first live window.

**Acceptance criteria:**

- [ ] Any ambiguity pauses new entries without disabling protective exits.
- [ ] UI/API/provider state stays reconcilable and owner-scoped.
- [ ] Pause, drain, takeover, and rollback procedures are recorded and tested
      without destructive cleanup.

**Verification:** Canary checklist and durable handoff with timestamps, observed
state, alerts, and next operator action.

**Dependencies:** Task 27.  
**Likely files:** operational documentation/handoff only unless a scoped defect
is observed.  
**Scope:** Medium operational task.

## 14. Validation commands

Run targeted suites after each task. Serialize broader commands under the
workspace memory gate.

```bash
# API/service TypeScript tests (select only files changed by the slice)
cd artifacts/api-server
node --import tsx --test \
  src/services/algo-deployment-management.test.ts \
  src/routes/algo-deployment-management-route.test.ts

# Frontend control-plane tests
cd artifacts/pyrus
node --import tsx --test \
  src/screens/AlgoScreen.test.mjs \
  src/screens/algo/*.test.mjs

# API contracts and generated-client drift
cd /home/runner/workspace
pnpm --filter @workspace/api-spec run test
pnpm run audit:api-codegen

# Targeted package typechecks after focused tests
pnpm --filter @workspace/api-server run typecheck
pnpm --filter @workspace/pyrus run typecheck

# Browser proof after the UI checkpoint
cd artifacts/pyrus
pnpm exec playwright test \
  e2e/algo-account-control-plane.browser-validation.spec.ts \
  --reporter=list
```

Before any broad typecheck/build/browser batch:

- require at least 6 GiB `MemAvailable`;
- require cgroup `memory.current` at or below 10 GiB;
- run broad commands serially;
- use the Replit-owned restart action rather than shell-launching the app.

## 15. Rollout gates

| Gate | Must be true before proceeding |
|---|---|
| UI contract | Inline CRUD/bulk/review/partial/conflict behavior green at six presentations |
| Persistence | Additive migrations applied and read back; no fake defaults |
| Provider safety | Agentic ownership/readiness/options level and both order directions proven |
| Risk | Both daily-loss sources trustworthy, fresh, auditable, and fail-closed |
| Idempotency | Entry/exit/fill/reconciliation replay cannot duplicate a broker mutation |
| Shadow | Existing Signal Options Shadow behavior remains green |
| Configuration | Explicit user-selected allocation, ceiling, loss/resume policies, sizing, and position limits |
| Enable | Final temporary gate removed only after every earlier gate is evidenced |
| First live window | Human-approved, monitored, with pause/drain/takeover recovery ready |

## 16. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Account control edited from two deployments | High | Account revision, shared-scope labeling, impacted-deployment review, no silent merge |
| Frontend review becomes stale | High | Server review normalization plus expected revisions and Apply revalidation |
| Broker account P&L omits manual trades | High | Source-completeness test; block entries when completeness is not provable |
| Partial fills corrupt target P&L | High | Immutable fill journal and idempotent position/P&L folds |
| Live edit races a worker cycle | High | Pause-first Apply for every live configuration change in V1 |
| Late-joined target receives an old trade | High | Joined/source-event watermark enforced at dispatcher and outbox reservation |
| Failed exit is simulated as closed | High | Durable attention/reconciliation state; never mirror a live failure to Shadow completion |
| Recovery-policy loss state crosses the threshold repeatedly | High | Recompute only from trustworthy reconciled realized fills; audit every halt/resume transition; expose next-day policy as the stricter user choice; never add hidden hysteresis |
| Bulk edit overwrites mixed values | High | Explicit per-field mask and before/after review |
| Account band overwhelms the cockpit | Medium | Explicit collapse; full width only while open; operations unchanged when closed |
| Dirty background refresh erases edits | Medium | Baseline/draft separation and revision conflict state |
| Dirty shared worktree causes collateral changes | High | Surgical file scope, no broad staging/reset, focused tests before broad validation |

## 17. Explicit decisions still required

These are not implementation details and remain fail-closed gates:

1. Agentic target allocation percentage.
2. Agentic account-wide algo ceiling percentage.
3. Agentic account emergency daily realized-options loss amount.
4. Pyrus Signal Options target daily realized-loss amount.
5. Target/account maximum open positions.
6. Target maximum premium and contracts.
7. Immutable platform maximum premium, contracts, positions, and freshness
   windows.
8. Agentic account resume policy and Pyrus Signal Options target default or
   override policy.
9. Final authorization to apply real account controls through the normal UI.
10. Separate final authorization to enable live trading.

## 18. Definition of done

The work is complete only when:

- deployment CRUD, archive/restore, inline account assignment, scoped controls,
  single/bulk edit, review, Apply, partial result, conflict, and retry work in
  the normal UI;
- Account shows accurate read-only reciprocal deployment links;
- the server enforces owner scope, revisions, typed overrides, account/target/
  platform precedence, both daily-loss layers, and each layer's configured
  resume policy;
- entry and owned-position exit are wired per target with durable outbox, fill
  journal, idempotency, and reconciliation;
- Shadow behavior remains green and no live outcome is represented solely by a
  simulated fill;
- the UI/API/database/provider readback agrees on the explicitly selected
  Agentic configuration;
- live enablement occurs only after separate final approval and remains
  fail-closed for every missing/stale/ambiguous prerequisite;
- the durable session handoff records migrations, validations, UI evidence,
  live state, monitoring, and any remaining provider attention.

## 19. Plan approval gate

Planning does not authorize migration, runtime restart, account Apply, broker
mutation, mode switch, or live enablement. Implementation begins only after the
user approves this task order. Real-account configuration and live enablement
each require their own later approval with explicit values.
