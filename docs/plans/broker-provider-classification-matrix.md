# Broker Provider Classification Matrix

Last reviewed: 2026-06-08

Purpose: organize Phase 1 provider research without turning unverified broker
assumptions into implementation facts. Every provider row must be refreshed
from official provider or aggregator documentation before code marks it
private-beta eligible.

Official-doc review cadence: review current official provider/aggregator docs
on every provider-related implementation change and at least monthly while live
customer trading depends on that provider. Record the review date, source refs,
and material changes in the provider row.

## Classification Contract

Adapter kinds:

```text
direct_oauth
aggregator
ibkr_connector
unsupported
```

Customer v1 statuses:

```text
eligible_for_private_beta
eligible_after_exception  # future/non-live only; not valid for private-beta live automation
insufficient_capability
unsupported_provider
research_only
ibkr_special_connector
```

Required evidence fields for every provider row:

- Provider name.
- Adapter kind.
- Auth type and reauth type.
- Token custody model.
- Required scopes.
- Optional scopes.
- Stocks support.
- Single-leg options support.
- Preview support.
- Order status support.
- Cancel/replace support.
- Account capability families.
- Known limitations.
- Default block reason.
- Official source refs.
- Last verified date.
- Reviewer.

## Candidate Rows

| Provider/category | Adapter kind | Customer v1 status | Current stance | Evidence status | Default block reason |
| --- | --- | --- | --- | --- | --- |
| IBKR Gateway/bridge | `ibkr_connector` | `ibkr_special_connector` | Wrap existing connector behind the adapter boundary; do not use it as the default SaaS OAuth pattern. | Existing repo behavior observed; official/current hosted-customer facts still need review before broader customer rollout. | `IBKR_SPECIAL_CONNECTOR_REQUIRED` |
| SnapTrade | `aggregator` | TBD; first non-IBKR private-beta lane | First aggregator candidate to evaluate. Eligible only if a named selected brokerage/account fixture proves stock and single-leg option order, fill, cancel/replace, account identity, token/reference custody, and audit semantics remain account-native and reconstructable. | Initial official docs reviewed 2026-06-08; not yet eligible. Source refs: `https://snaptrade.com/`, `https://docs.snaptrade.com/docs/getting-started`, `https://docs.snaptrade.com/reference/Trading/Trading_placeMlegOrder`. Generic SnapTrade capability is insufficient; must verify brokerage-specific trading support before `eligible_for_private_beta`. | `PROVIDER_RESEARCH_REQUIRED` |
| Direct OAuth broker candidate | `direct_oauth` | TBD; second-wave research lane | Candidate selection is deferred to Phase 3 provider research. Eligible later if current official scopes support account, positions, orders, executions, submit, manage, hosted reauth, and account-specific capability sync. It becomes a SnapTrade replacement only if Phase 3 provider research explicitly promotes it. | Not verified in this session. | `PROVIDER_RESEARCH_REQUIRED` |
| Read-only broker link | `unsupported` | `insufficient_capability` | Not sufficient for customer v1 automation execution. | Product contract decision. | `BROKER_SCOPE_MISSING` |
| Manual-only broker link | `unsupported` | `insufficient_capability` | Not a customer v1 success mode; may be reconsidered later under a separate product contract. | Product contract decision. | `BROKER_CAPABILITY_UNSUPPORTED` |
| Submit-only broker link | `unsupported` | `insufficient_capability` | Not sufficient because PYRUS cannot safely reconcile orders, fills, cancel/replace, and automation state. | Product contract decision. | `BROKER_SCOPE_MISSING` |
| Paper/demo/shadow connection | `unsupported` | `research_only` | Allowed only for non-trading demo/research/shadow surfaces; cannot satisfy live customer launch or automation activation. | Product contract decision. | `DEMO_SHADOW_ONLY` |

## Provider Review Checklist

For each provider candidate, complete this checklist before implementation:

- Official docs URL captured.
- Auth flow and reauth flow confirmed.
- Required scopes mapped to Phase 1 scope vocabulary.
- Account identity and account environment behavior confirmed.
- Selected brokerage/account fixture named for aggregator-backed providers.
- Stocks and single-leg options support confirmed or blocked.
- Preview behavior confirmed, including unavailable-preview fallback policy.
- Order status behavior confirmed: streaming, polling, or unsupported.
- Cancel/replace behavior confirmed.
- Options exercise/assignment and corporate-action edge cases noted if relevant.
- Provider rate limits and idempotency/client order id behavior noted.
- Token/reference custody model reviewed with security constraints.
- Capability map fixture created.
- Unsupported states mapped to customer-safe block reasons.
- Compliance/product owner signs off before `eligible_for_private_beta`.
- Official docs reviewed on every provider-related implementation change and at
  least monthly while live customer trading depends on the provider.
- Private-beta live automated execution does not allow
  `eligible_after_exception`; a provider must pass normal
  `eligible_for_private_beta` evidence or remain blocked/research-only.

## Deferred Provider Decisions

- SnapTrade selected brokerage/account fixture: deferred to the Phase 3
  fixture-selection research spike. Until the spike names and proves a fixture
  with stocks and single-leg options, SnapTrade remains
  `PROVIDER_RESEARCH_REQUIRED`.
- SnapTrade failure fallback provider: deferred to Phase 3 provider research.
  If SnapTrade fails the safety/compliance bar, the spike must evaluate another
  aggregator, direct OAuth, and embedded brokerage/BaaS candidates from current
  official docs before naming a replacement lane.
- Direct-OAuth second-wave broker candidate: deferred to Phase 3 provider
  research. No direct-OAuth broker is named in Phase 1.
- `eligible_after_exception`: disallowed for private-beta live automated
  execution. The status is reserved only for future/non-live or separately
  approved product contracts.

## Open Provider Decisions

No remaining open provider decisions after the current review pass. Deferred
provider decisions remain above and must be resolved before the relevant Phase
3 implementation can mark a provider eligible.
