# WO-FB-FIX-BACKOFF-CONSECUTIVE — back off after consecutive local option timeouts (down-upstream guard)

> **HEADLESS WORKER PREAMBLE:** headless work-order worker. No SESSION_HANDOFF writes; do not read
> ~/.claude/, ~/.agents/, .claude/skills/, .agents/skills/, agents/; never restart/reload/SIGUSR2;
> no git add/commit. Lazy-minimal diff. Work ONLY this order.

Adversarial review of 8e9504fb found (confidence medium): with local timeouts
(`massive_options_request_timeout`) excluded from backoff entirely, a genuinely down/black-holed
upstream now gets re-dialed back-to-back per key (each attempt burning the local timeout budget) —
the old 60s backoff crudely protected that case. One local stall is usually SELF-inflicted event-loop
pressure (why 8e9504fb excluded it), but CONSECUTIVE timeouts on the same key are genuine upstream
evidence.

Fix, minimal, in `artifacts/api-server/src/services/platform.ts` (region ~:15076-15141,
`shouldBackOffOptionUpstream` / `recordOptionUpstreamBackoff` / `clearOptionUpstreamBackoff`):
1. Track consecutive local-timeout counts per backoff key (bounded Map, same key fn). On the Nth
   consecutive local timeout for a key (N=3), apply the normal backoff for that key. Genuine upstream
   errors (5xx/429/upstream_request_failed) keep backing off immediately as today.
2. Any success for the key resets its consecutive count (wire into the existing clear-on-success
   sites at ~:15759 / ~:16123 — `clearOptionUpstreamBackoff` is the natural home).
3. Bound the count map (evict on clear + cap total entries ~4096).
4. Extend the backoff tests in `option-chain-policy.test.ts` (see the 4 cases added by 8e9504fb at
   ~:110): two local timeouts -> no backoff; third consecutive -> backoff set; success resets count
   and clears.

Verify (paste tails): api-server typecheck exit 0; `option-chain-policy.test.ts` green (8+ tests);
targeted signal suites stay 446+/0. Report → .codex-watch/wo-fb-fix-backoff-consecutive-report.md
with file:line, test tails, start+end `git diff --stat -- artifacts/api-server/src/services/platform.ts`.
