# PYRUS tenant-isolation cache verification v2

Audit scope: P0-2, P0-3, and P0-4 only. This was a read-only source audit plus read-only targeted validation; no database reads, application reloads, code edits, or commits were performed. The requested audit document is the only file created.

Revision observed at start: `38513ebfb18f57f82b74c08da8e07d05bf4e6108` (`38513ebf`).  
Revision observed during final reconciliation: `7b47b25f104d411d0f011ef3ef4cb0a47121ab60` (`7b47b25f`).

The intervening commits changed an unrelated audit document and AccountScreen calendar-P&L UI/test lines. None of the cited cache, route, or context files changed. Line references below are to the current working tree. `services/shadow-account.ts` had unrelated pre-existing in-progress edits; its cited tenant-scope helpers were re-read from the final working tree.

## Decisive verdicts

P0-2: REAL — ibkr-account-bridge returns a process-global cache hit before invoking the per-request gateway resolver; the accounts key is literally mode and the other keys contain only raw filters, `artifacts/api-server/src/services/ibkr-account-bridge.ts:140-143,236-328`.

P0-3: REAL — `/streams/accounts/page` defaults every tenant to the literal raw accountId `"combined"`, while real/combined account-page keys append `shadowAccountId:null` and never `appUserId` or a resolved broker identity, `artifacts/api-server/src/routes/platform.ts:3285-3294`; `artifacts/api-server/src/services/account-page-streams.ts:503-516,736-748`.

P0-4: REAL — the generic outer response key has no implicit tenant scope; equity-history, closed-trades, and full-risk omit `appUserId` that the accounts and summary callers explicitly include, `artifacts/api-server/src/services/account.ts:500-512,5359-5364,5487-5499,5790-5803,8698-8714,9152-9161`.

## Shared request and gateway context

- A session cookie is resolved and `session.user.id` is bound to request AsyncLocalStorage before the API router runs: `artifacts/api-server/src/app.ts:217-231`.
- The IBKR gateway pool is genuinely per user: the manager map is keyed by `appUserId`, and `getGateway(appUserId)` reads that entry at `artifacts/api-server/src/services/ibkr-portal-gateway-manager.ts:21-25,74,398-403`.
- `resolveClientPortalConfig()` reads the current app user and selects that user's gateway at `artifacts/api-server/src/services/ibkr-client-runtime.ts:11-33`.
- This does **not** protect a cache hit. The vulnerable maps are read before their factory/client code runs, so User B's gateway is never resolved on a hit or shared in-flight promise.
- Authentication patterns cover `/accounts`, `/orders`, and `/streams/accounts/page`, but the shared `/streams/orders`, `/streams/executions`, and `/streams/accounts` routes remain outside the user gate: `artifacts/api-server/src/routes/index.ts:29-35,44-66,78-89`. Authentication without a tenant-bearing key would not prevent the collision in either case.

## P0-2 — IBKR bridge and order caches

The gateway identity is resolved, but it is absent from every cited key. Explicit account IDs are raw caller strings. They may be globally unique in normal IBKR usage, which can reduce accidental collision, but they are not a tenant authorization/scope value. The omitted/default `accountId:null` routes prove the leak without guessing another user's account ID.

| Cache | Key classification | Direct effect and window |
|---|---|---|
| `accountListCache` / in-flight | Literal `key: mode`; no account or user: `artifacts/api-server/src/services/ibkr-account-bridge.ts:236-247` | Accounts include cash, buying power, NAV, and margin data because `IbkrClient.listAccounts` fetches summary/ledger and maps those values: `artifacts/api-server/src/providers/ibkr/client.ts:1594-1707`. Fresh 2s; stale up to 120s: `ibkr-account-bridge.ts:58-64`. |
| `positionCache` / in-flight | Raw `{ accountId: input.accountId ?? null, mode }`: `ibkr-account-bridge.ts:250-273` | Fresh 2s. Stale A data can be returned for up to 120s on backoff/transient failure or after the 2s initial-wait fallback: `ibkr-account-bridge.ts:74-76,140-169,191-230`. |
| `executionCache` / in-flight | Raw optional account, mode, days, limit, symbol, and contract filters: `ibkr-account-bridge.ts:276-302` | Fresh 10s; stale up to 120s. The user's active account is resolved only inside the skipped client loader: `artifacts/api-server/src/providers/ibkr/client.ts:1354-1378,1991-2003`. |
| `orderCache` / in-flight | Raw `{ accountId: input.accountId ?? null, mode, status }`: `ibkr-account-bridge.ts:305-328` | Fresh 2s. Stale A data can be returned for up to 120s on backoff/failure or after the 1.5s initial wait. |
| `orderVisibilityCache` / in-flight | Raw account/null, mode, and status: `artifacts/api-server/src/services/platform.ts:3010-3028` | Fresh 2s, stale 120s, and cold in-flight sharing: `platform.ts:2947-2960,3097-3189`. The request's gateway client is created only on a miss at `platform.ts:3030-3052`. |
| `orderSnapshotCache` | Same raw account/null, mode, and status: `artifacts/api-server/src/services/bridge-streams.ts:514-532` | Not a normal fresh shortcut, but it returns cached A orders for up to 120s during global suppression, work backoff, timeout, or transient failure: `bridge-streams.ts:55,535-595`. This remains unsafe even if only the inner order cache is fixed. |

Related but not counted as a direct disclosure cache: `accountMonitorSnapshots` is keyed by raw `mode` plus raw account or `"all"` at `bridge-streams.ts:67-75,113-118`. It does not feed a response directly, but it can cross-wire tenant positions/orders into shared market-data lease state.

### Concrete two-user traces

1. **Balances/accounts:** User A calls `GET /api/accounts?mode=live`. The outer accounts cache is correctly keyed by A's `appUserId`, but its miss calls the inner mode-only cache at `artifacts/api-server/src/services/account.ts:5344-5365,5376,5415-5417`. User B calls the same route within 2s; B's outer miss receives A's inner account/balance payload, then stores that contaminated response under B's outer key.
2. **Positions:** A calls `GET /api/streams/accounts?mode=live` without `accountId`, priming `{"accountId":null,"mode":"live"}`. B calls the same route within 2s and receives A's positions before B's gateway is invoked: `artifacts/api-server/src/routes/platform.ts:3379-3388`; `artifacts/api-server/src/services/bridge-streams.ts:609-629`.
3. **Orders:** A calls `GET /api/orders?mode=live`, priming the platform key `{"accountId":null,"mode":"live","status":null}`. B calls the same authenticated route within 2s and receives A's orders: `routes/platform.ts:2099-2103`; `services/platform.ts:3097-3102`. `/api/streams/orders` has the same inner collision plus the conditional outer stale collision: `routes/platform.ts:3127-3159`.
4. **Executions:** A calls `GET /api/executions?mode=live` with no other filters. B sends the identical request within 10s and receives A's executions; B's active-account resolution is skipped: `routes/platform.ts:2214-2237`; `services/platform.ts:4527-4537`.

Read-only behavioral validation injected a fake bridge client whose payload and call log were derived from the current ALS user. After identical calls under `user-A` and `user-B`, all B results contained A IDs and only A loaders ran:

```json
{"accountsA":"acct-user-A","accountsB":"acct-user-A","positionsA":"position-user-A","positionsB":"position-user-A","executionsA":"execution-user-A","executionsB":"execution-user-A","ordersA":"order-user-A","ordersB":"order-user-A","loaderCalls":["accounts:user-A","positions:user-A","executions:user-A","orders:user-A"]}
```

Validation used an inline `pnpm --filter @workspace/api-server exec tsx -e` async-IIFE harness. It created no file and made no DB call.

**Minimal fix sketch:** Resolve one stable scope before cache lookup (`appUserId`/resolved gateway identity, or a distinct explicit global-runtime identity) and add it to every bridge, order-visibility, stream-order, and in-flight key. Capture/thread that scope when an SSE subscription is created; do not rely on raw account IDs or mode.

## P0-3 — account-page dashboard caches

### No upstream real/combined resolution

- The authenticated SSE route accepts raw `req.query.accountId` and defaults it to literal `"combined"`: `artifacts/api-server/src/routes/platform.ts:3285-3294`.
- `admitAccountRoute` returns only an availability boolean and never rewrites the account ID: `routes/platform.ts:190-218`.
- The route wraps setup in `withCallerShadowScope`, but that helper is explicitly a passthrough for every non-shadow ID, including `"combined"`: `artifacts/api-server/src/services/shadow-account.ts:3284-3297`.
- `AccountPageSnapshotInput` has no `appUserId`, and normalization preserves raw `accountId`: `artifacts/api-server/src/services/account-page-streams.ts:40-53,454-468`.
- Consequently, two users requesting `accountId=combined&mode=live` build identical real-account keys with `shadowAccountId:null`. No per-user broker/account ID is resolved before those lookups.

### Cache-by-cache result

| Cache | Key and verdict | Exposure |
|---|---|---|
| Primary cache / in-flight | Raw account, mode, tab, asset class, plus `shadowAccountIdForCache`; for combined the last value is null: `account-page-streams.ts:731-758` | **Real:** B receives A's summary/NAV/cash, allocation, positions, orders, and fast risk for 2s or for the in-flight duration: `account-page-streams.ts:815-832`. |
| Live in-flight | Same raw real key: `account-page-streams.ts:611-626` | **Real:** an overlapping B tick awaits A's live promise and receives A's summary, intraday equity, positions, orders, and risk. |
| Last-live response cache | `cacheKeyForInput`, which spreads normalized raw input and appends null shadow scope for combined: `account-page-streams.ts:503-516,531-563` | **Real:** B can receive A's live payload tagged `refreshing` for 5m: `account-page-streams.ts:1195-1207`. The route seeds only `initialPrimaryPayload`, which does not disable this last-live branch: `routes/platform.ts:3361-3364`. |
| Derived cache / in-flight | Same full raw-input key: `account-page-streams.ts:887-903` | **Real:** B receives A's equity history, performance-calendar/closed trades, and cash activity for 30s or the in-flight duration: `account-page-streams.ts:988-1023`. |
| Benchmark-equity cache | Raw account, mode, range, benchmark, plus null shadow scope: `account-page-streams.ts:850-884` | **Real:** B can receive A's account-plus-benchmark equity response for 5m. |
| Live content-retention map | Read only after a fresh candidate exists, then reused only when content compares equal: `account-page-streams.ts:401-431` | **Not an independent prior-payload disclosure path.** It should still share the tenant key for clean object/timestamp ownership. |
| Full-snapshot in-flight map | Defined/used only inside `fetchAccountPageSnapshotPayload`: `account-page-streams.ts:142-145,1041-1097` | **Not currently route-reachable.** Repo-wide search found no production caller; the live route uses primary plus subscription at `routes/platform.ts:3341-3351`. |

### Concrete two-user trace

User A opens `GET /api/streams/accounts/page?accountId=combined&mode=live`; A's tenant-aware downstream loaders populate the global primary, last-live, derived, and benchmark maps. User B opens the identical authenticated SSE route. B receives A's `primary` event for 2s, A's `live` event tagged `refreshing` for up to 5m, and A's `derived` event for 30s; an overlapping call can join A's primary/live/derived promise.

The downstream universe **does** include `appUserId` on a miss at `artifacts/api-server/src/services/account.ts:1292-1315`, and provider account rows are owner-filtered at `account.ts:4684-4716,4765-4802`. That is too late: an account-page cache hit returns before those loaders run.

### Refuted shadow branch

Shadow dashboard keys are tenant-distinct. `withCallerShadowScope` resolves the authenticated user's persisted UUID or per-user virtual ID and binds it at `artifacts/api-server/src/services/shadow-account.ts:3243-3297`; `currentShadowAccountId()` reads it at `artifacts/api-server/src/services/shadow-account-context.ts:25-32`. Every account-page key adds that resolved identity only when raw `accountId` is `shadow`: `account-page-streams.ts:510,514-516,621,741,862`. The existing two-scope test confirms distinct keys at `account-page-streams.test.ts:340-350`.

**Minimal fix sketch:** Require the authenticated `appUserId` in `AccountPageSnapshotInput`, pass it from the SSE route, and add it to primary/live/last-live/derived/benchmark cache and in-flight keys. Keep the resolved shadow-account ID as the shadow discriminator and thread the explicit app user through long-lived polls.

## P0-4 — outer account response caches

`stableAccountReadCacheKey()` serializes only the supplied route and input fields; it performs no implicit ALS/session lookup: `artifacts/api-server/src/services/account.ts:500-512`. `readAccountRouteResponseCache()` returns fresh/stale values or an existing promise before calling the supplied factory: `account.ts:514-584`.

The safe comparison is exact:

- `listAccounts` resolves and keys `{ appUserId, mode }`: `account.ts:5344-5365`.
- `getAccountSummary` resolves and keys `{ accountId, appUserId, mode, source }`, then explicitly passes that ID to its uncached loader/universe: `account.ts:5487-5514`.

Those two are tenant-keyed at this outer layer. `listAccounts` is still end-to-end vulnerable to the lower P0-2 IBKR cache.

| Cache | Raw/shared key | Exposure |
|---|---|---|
| Equity history | Account ID, benchmark, mode, normalized range, source; no app user: `account.ts:5773-5803` | **Real:** 30s fresh without benchmark, 60s with benchmark, up to 5m stale, plus initial in-flight sharing: `account.ts:197-204,528-582`. |
| Closed trades | Account ID and raw filters; no app user: `account.ts:8676-8714` | **Real:** 2s fresh, up to 5m stale, plus in-flight sharing. |
| Full risk | Account ID, mode, source; no app user: `account.ts:9152-9161` | **Real:** 30s fresh, up to 5m stale, plus full-refresh in-flight sharing: `account.ts:208-209,9200-9229,9249-9282`. The current account-page fast-risk lane does not use this cache; the direct `detail=full` REST route does. |

`"combined"` is not tenant-distinct. It is the literal all-accounts identifier (`account.ts:194`) and is accepted as the raw route path/account-page default. `source` is also raw optional input, not a resolver-produced identity.

### Concrete two-user traces

1. **Equity history:** A calls `GET /api/accounts/combined/equity-history?mode=live&range=1Y`. Its miss resolves A's universe and stores A's history under a key with no user. B sends the identical request within 30s and receives A's history at `account.ts:528-539`; B's factory at `account.ts:5799` and B's universe resolver at `account.ts:5866` do not run. After fresh expiry, B can still receive A's stale value while B's refresh runs, until the 5m stale boundary.
2. **Closed trades:** A calls `GET /api/accounts/combined/closed-trades?mode=live`; B repeats it within 2s. B receives A's trades before the uncached factory/universe at `account.ts:8712,8729` runs. The route is `artifacts/api-server/src/routes/platform.ts:1880-1907`.
3. **Full risk:** A calls `GET /api/accounts/combined/risk?mode=live&detail=full`. A's background full build stores A's risk at `account.ts:9213-9221`. B repeats the route and receives A's fresh value at `account.ts:9259-9267`, or A's stale value at `account.ts:9270-9278`. The route is `routes/platform.ts:1947-1961`.

On an outer miss, `getLiveAccountUniverse()` correctly includes `appUserId` in its own key and scopes provider-backed account rows: `account.ts:1292-1315,4684-4716,4765-4802`. The equity/trade/risk loaders then use the resolved universe account IDs. These are real downstream protectors, but they cannot refute the finding because an outer hit or shared promise bypasses them.

Read-only validation ran the existing response-cache behavior tests:

```text
pnpm --filter @workspace/api-server exec tsx --test src/services/account-route-cache.test.ts
2 passed, 0 failed
```

The tests confirm identical-key in-flight collapse and stale serving; they do not contain a two-user tenant regression.

Final targeted verification also ran `ibkr-account-bridge.test.ts`, `account-page-streams.test.ts`, and `account-route-cache.test.ts` together: 16 passed, 0 failed. This confirms the current cache mechanics and resolved-shadow separation; it does not refute the missing real-user discriminators.

**Minimal fix sketch:** Resolve `appUserId` before each equity-history, closed-trades, and full-risk lookup; add it to the outer/full-risk cache and in-flight keys and pass it explicitly through the uncached loader to `getLiveAccountUniverse`. Use a distinct explicit global scope only for intentionally non-user callers.

## Adversarial reconciliation notes

- Four independent same-model source passes agreed on the route-reachable violations. A fresh-context reviewer received only the implementation scope and isolation contract, not the preliminary verdicts, and independently identified the same six cache families.
- Cross-model review was not run. The interactive authorization chooser was unavailable in this execution mode, so no external CLI was invoked without permission.
- The strongest attempted refutations were real but downstream: session auth, per-user gateway selection, tenant-keyed account-universe caches, provider-owner SQL filters, and resolved shadow-account IDs. Only the shadow-account cache keys survive as a protecting upstream scope; all real/combined vulnerable maps are read first.
