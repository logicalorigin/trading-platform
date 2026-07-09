# WO-PV-OQ — option-quote WS keeps out-of-subscription pending quotes (P3, verified)

Codex worker, /home/runner/workspace. Target: artifacts/api-server/src/ws/options-quotes.ts (~:214
`enqueueQuotes`; `pendingQuotesByProviderContractId` ~:138; `currentProviderContractIds` ~:133). Verify
clean first; working-tree edit only, NO git commands, no ~/.claude/ or .claude/skills/ or agents/
access. Unit tests only.

PROBLEM (P3 backpressure/stale-state, CONFIRMED_REAL): `enqueueQuotes` inserts ANY payload
`providerContractId` into `pendingQuotesByProviderContractId`, but priority is only assigned for
`currentProviderContractIds`; resubscribe clears priorities but NOT pending quotes, so stale/
out-of-subscription IDs sort to `Number.MAX_SAFE_INTEGER` and waste degraded batch slots / linger.

FIX: (a) filter enqueued quotes to the current subscription set (`currentProviderContractIds`) so
out-of-subscription IDs are not retained; and (b) clear/prune `pendingQuotesByProviderContractId` on
resubscribe/unsubscribe alongside the priority reset. AC: quotes for IDs outside the active
subscription are not retained; resubscribe drops stale pending entries.

Verify: targeted test — enqueue a mix of in/out-of-subscription IDs + a resubscribe, assert only
current IDs remain pending. Report: .codex-watch/wo-pv-oq-report.md.
