# WO-P1-T3 — bridge-option-quote-stream unbounded quote cache

Codex worker, /home/runner/workspace. Target:
artifacts/api-server/src/services/bridge-option-quote-stream.ts (clean). Working-tree edit only, NO
git commands, no ~/.claude/ or .claude/skills/ or agents/ access.

PROBLEM (P1 unbounded growth): `quoteCacheByProviderContractId = new Map<string, QuoteSnapshot>()`
(:153) grows one entry per provider contract id forever — set ~:828 (`.set`), read ~:818/:843, never
evicted. Long-lived process → unbounded RSS.

FIX: bound it to the set of ACTIVE subscriptions. Preferred: when a providerContractId no longer has
any live subscriber/retained-snapshot demand, delete its cache entry (there are `subscribers` and
`retainedSnapshotDemands` maps in this file — reuse them to decide liveness). If a pure
subscription-scoped bound is awkward, add an LRU/TTL cap sized generously above the active-subscription
count. Do not drop quotes that active subscribers still need.

AC: cache size stays bounded to active subscriptions (no monotonic growth across subscribe/unsubscribe
churn). Verify: new test exercising subscribe→quote→unsubscribe churn and asserting the cache does not
grow unbounded; steady-RSS spot check noted. Run touched suites; paste output.

Report: .codex-watch/wo-p1-t3-report.md.
