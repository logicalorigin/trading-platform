# IBKR Bridge Contention Fixes — Plan (#3 done, #2 & #1 planned)

**Date:** 2026-06-16
**Scope:** `artifacts/ibkr-bridge/src/tws-provider.ts` (+ `work-scheduler.ts`), the service that runs on the **remote Windows desktop** (`desktop-EASYSTREET`) and talks to TWS at `127.0.0.1:4001`.
**Why:** A single IBKR connection behind one global FIFO rate limiter (`maxReqPerSec: 35`, `tws-provider.ts:2158` → `@stoqey/ib` controller) serializes every request type onto one socket. The options-flow scanner's bursty contract-detail/quote requests head-of-line-block account/execution reads, which then exceed their 2s/12s timeouts and trip the `bridge-governor` circuit breakers (`account` fail-threshold **2**/15s, `quotes` **3**/30s). Breakers reject all work ("backed off"), which **flaps market-data line usage 0↔N and empties NLV/BP/Cash**. Root cause is socket contention, not a line-budget ceiling.

**Deploy locality:** All of this runs on the remote bridge. Changes here are typecheck/build-validatable in the repo but **require rebuild + redeploy on the Windows desktop** to take effect, then live verification.

**Pre-fix baseline (Replit api log, after-hours sample):** ~27 account "backed off" rejections, ~29 `/positions`+`/accounts` 504s, ~3 `/executions` timeouts per log window. Compare after redeploy.

---

## ✅ #3 — Lane-protect + cache `/executions` (DONE, typechecks clean)

Implemented in `tws-provider.ts`:
- `EXECUTIONS_CACHE_TTL_MS = 5_000` + `executionsCache` map.
- `listExecutions` now: serve-from-cache if fresh → else `runBridgeLane("account", …)` with a recheck inside the slot → delegate to new `fetchExecutionsLive` (the prior body, unchanged) → cache the result.
- Effect: executions stop issuing an unbounded live round-trip per call; they fail fast under contention (account lane concurrency/circuit) instead of hanging to the client's 12s timeout, and repeated polls within 5s share one fetch.

**Remaining sub-item (optional, not yet done):** persist the contract-detail cache (`optionContracts`/`stockContracts`) across reconnects so post-reconnect previews don't all cold-miss. Deferred — verify it's actually wiped on reconnect first (`stopConnectionBoundSubscriptions`) and weigh staleness vs. the existing 5-min `CONTRACT_CACHE_TTL_MS`.

### Post-audit hardening (2026-06-17) — 2 HIGH findings fixed

An independent adversarial audit of the committed #3 change (`fdce894`) found two HIGH issues, now fixed. Validation: bridge `typecheck` PASS + `tws-provider-account-read-path` source guard PASS. **Bridge rebuild + Windows redeploy still required for these to take effect.**

1. **Unbounded `executionsCache` growth** — the cache was never evicted (high-cardinality scanner symbol/contract keys grow one retained entry per query for the process lifetime). Added an eviction pass to `pruneContractCaches` (`tws-provider.ts`) dropping entries older than `EXECUTIONS_CACHE_TTL_MS` on the periodic tickle, mirroring the existing contract-cache sweep.
2. **Executions tripped the shared `account` circuit breaker (regression)** — routing executions onto the `account` lane meant a slow/timed-out `getExecutionDetails` could trip the account breaker and fail the lighter `listPositions`/`listAccounts`/`listOrders` reads — the exact NLV/BP/cash-emptying symptom #3 targets. Note `countsAgainstLaneHealth: () => false` does NOT fix this: a lane **timeout** always counts against health (`work-scheduler.ts` ~L611, `didTimeout || …` short-circuits the callback). Instead added a dedicated **`executions` lane** (concurrency 1, timeout 8s, own breaker/backoff) and routed `listExecutions` to it — isolating executions health from the account lane while preserving #3's fail-fast behavior.

**Lower-severity audit notes (NOT fixed — open follow-ups):** `option-quotes` concurrency 6 contradicts its "=4" comment rationale; raw-vs-normalized `symbol` cache key (miss inefficiency); ~7s stacked fill-visibility latency across the 3 cache layers; no executions-cache invalidation on reconnect/account switch. Framing correction from the audit: positions/account-summary/orders are **subscription-backed (TWS push), not per-call FIFO reads**, so #3 only protects the one exposed read (executions); the real NLV/BP/cash coupling is circuit-breaker flap / line-budget churn, which **#2/#1 still address**.

---

## #2 — Socket-level priority + reserved headroom (medium risk)

**Goal:** account/order/execution/control requests preempt scanner contract-detail/quote requests on the shared 35-req/s FIFO, and the scanner can never consume the whole rate budget.

**Why needed:** `work-scheduler.ts` lanes cap *concurrency* but all lanes still collapse onto `@stoqey/ib`'s single un-prioritized FIFO (`controller.schedule` → one `function-rate-limit`). Lane priority does not govern the wire.

**Plan:**
1. Add an app-level **two-tier token gate** in `tws-provider.ts` issued *before* each `this.api.*` call:
   - **Priority tier:** account-summary, positions, open-orders, executions, control (`getCurrentTime`), order placement.
   - **Background tier:** market-subscriptions, option-quotes, options-meta (`getSecDefOptParams`), scanner contract-details, `getMarketDataSnapshot`.
2. Reserve headroom: cap the **background** tier at e.g. ~70% of `maxReqPerSec`, leaving ~30% always available to the priority tier; priority requests bypass the background queue.
3. Lower scanner lane concurrency (`work-scheduler.ts` `option-quotes`/`options-meta`/`market-subscriptions`) so it cannot saturate even the background tier.
4. Gate behind a flag (e.g. `PYRUS_IBKR_REQUEST_PRIORITY_ENABLED`) so it can be disabled live if it misbehaves.

**Files:** `tws-provider.ts` (a small rate-gate helper + wrap the issuance sites), `work-scheduler.ts` (concurrency tuning).
**Risk:** medium — changes issuance ordering; mis-tuning could starve the scanner. Validate: typecheck/build here; on the bridge, watch that scanner still fills lines while `/positions`/`/executions` stop timing out.

---

## #1 — Separate the scanner onto its own IBKR connection (highest leverage, highest risk)

**Goal:** physical isolation — the scanner runs on its own `IBApiNext` (distinct `clientId`, own socket + own FIFO), so its bursts cannot delay account/execution reads at all.

**Plan:**
1. Add a second connection `apiScanner = new IBApiNext({...})` alongside the primary `this.api` (account/orders/executions/control). Use a derived distinct `clientId` (e.g. `config.clientId + 1`); TWS requires unique client IDs.
2. Extract the connection lifecycle (connect/reconnect/disconnect, `connectionState`/`error` subscriptions, `setMarketDataType`) into a helper parameterized by the connection, and run it for **both**. Health = both connected.
3. **Route requests:**
   - Primary `this.api`: `getManagedAccounts`, account-summary subscription, positions subscription, open-orders, `getExecutionDetails`, `getAllOpenOrders`, `getCurrentTime`, order placement.
   - `apiScanner`: market-data subscriptions, option quotes, options-meta (`getSecDefOptParams`), scanner `getContractDetails`, `getMarketDataSnapshot`.
4. Re-subscription on reconnect: `restoreQuoteSubscriptionsAfterReconnect` targets `apiScanner`; base account/positions/orders subscriptions target the primary.
5. Shared `optionContracts`/`stockContracts` caches stay shared (plain data); ensure contract-detail resolution for scanner paths uses `apiScanner`.
6. Gate behind a flag (e.g. `PYRUS_IBKR_SCANNER_CONNECTION_ENABLED`) defaulting **off**, so it can be rolled out and reverted safely on the live bridge.

**Files:** `tws-provider.ts` (major — connection fields, constructor, connect/reconnect/disconnect, error/state subs, `ensureBaseSubscriptions`, re-subscription, and the ~25 `this.api.*` call sites split by role), bridge config (second clientId), `work-scheduler.ts` (lane→connection mapping).
**Risk:** HIGH — dual connection lifecycle, reconnect handling, `clientId` conflicts with TWS client limits. Cannot be validated in Replit; **must** be tested on the Windows bridge against TWS. Ship behind the flag.

---

## Suggested rollout order on the bridge
1. Deploy **#3** (done) → confirm `/executions` timeouts and account-lane "backed off" drop vs. baseline.
2. Implement + deploy **#2** behind its flag → confirm `/positions`/`/executions` stop timing out under scanner load while the scanner still fills lines.
3. Implement **#1** behind its flag → enable in a maintenance window, watch for clean dual-connect + no line flapping; revert via flag if issues.
