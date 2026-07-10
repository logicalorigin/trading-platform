# PYRUS adversarial tenant-isolation verification v4

Audit scope: P1-2 through P1-6 only. This was a read-only source audit plus read-only PostgreSQL catalog/`EXPLAIN` and aggregate-count checks for P1-4. No row-level application data or identifiers were selected, no application/provider route was called, and no code, database row, commit, or live process was changed. This requested report is the only file created.

Revision observed at start: `b11a4799268fa4b741741bfa58771601ec28cbbb`.  
Revision observed at draft reconciliation: `e3f1e4d8ff845841680009290920822364cb51f9` (`2026-07-10T03:50:52Z`).

HEAD advanced while the audit ran. One cited file, `signal-options-automation.ts`, changed in `989754a9` for an unrelated replay/backtest-ledger writer; the cited deployment-read and cockpit-payload hunks were re-read afterward and were unchanged. No other cited implementation/schema/auth file changed between the start and draft revisions. Line references below are to the reconciled working tree.

## Decisive verdicts

P1-2: REAL — after the route's tenant filter produces `null`, the service selects the first deployment from a global, `updatedAt DESC` list, while the response scoper replaces only `deployments` and top-level `events`, `artifacts/api-server/src/routes/automation.ts:126-140,553-562,595-604`; `artifacts/api-server/src/services/algo-cockpit-streams.ts:115-128`; `artifacts/api-server/src/services/automation.ts:358-369,703-727,923-927`.

Minimal fix: if `readableDeploymentId` is null, emit an empty tenant-safe payload and do not subscribe; otherwise the existing key's server-authorized deployment UUID is sufficient. Alternatively, make target resolution accept only the route's readable deployment IDs and never globally fall through.

P1-3: REAL — `accountIds` reaches `buildRealPositionAttribution` but is absent from its symbol-only event `WHERE`, so foreign deployment UUIDs are folded into and returned as `sourceAttribution`, `artifacts/api-server/src/services/account.ts:6398-6401,6425-6433,6477-6487,6593-6596,6816-6817,6903-6904`.

Minimal fix: pass provider-account IDs resolved from the scoped account universe and AND them into the event `WHERE`; also enforce deployment ownership by `appUserId` so a reused provider ID cannot cross tenants.

P1-4: PARTIAL — the snapshot values and in-memory dedup key omit `appUserId`, but current partial unique indexes separate NULL-owner global rows from non-NULL user rows, and the missing partial-index predicate makes both current `ON CONFLICT` clauses error before any overwrite, `artifacts/api-server/src/services/account.ts:590-592,4363-4407`; `lib/db/src/schema/broker.ts:40-47,73-78`.

P1-5: PARTIAL — the guard asymmetry and material replacement fields are real, but `broker_connect` plus CSRF is the repo's explicit replacement policy and the service AND-scopes account/connection ownership by `appUserId`, `artifacts/api-server/src/routes/broker-execution.ts:692-743,1144-1164`; `docs/plans/workorders-2026-07-09/WO-REPLACE-order-replace-lanes.md:49-54`; `artifacts/api-server/src/services/snaptrade-equity-orders.ts:528-568,1343-1405`.

P1-6: REAL — public password login and GET launch mint and overwrite `pyrus_session` without an Origin/pre-auth-CSRF or browser-intent binding; URL-encoded cross-site forms are accepted, `artifacts/api-server/src/app.ts:193-195,262`; `artifacts/api-server/src/routes/auth.ts:292-313,353-381`.

Minimal fix: reject cross-site password/bootstrap login with same-origin Origin/fetch-metadata validation or a pre-login CSRF token; remove GET launch and require a trusted-parent Origin plus a one-time launch transaction nonce bound to the initiating browser.

## P1-2 — algo cockpit null to global deployment

The protecting path is real but ends one branch too early:

- The route authenticates the caller, filters the global mode list through deployment ownership, and rejects an explicitly supplied foreign deployment ID: `artifacts/api-server/src/routes/automation.ts:542-562`; `artifacts/api-server/src/services/automation-authorization.ts:25-54,69-95`.
- A non-null `readableDeploymentId` is a server-validated, globally unique deployment UUID. Downstream stream/cockpit caches keyed by that resolved UUID are not raw-client-input collisions.
- When the caller has no readable deployment, `firstReadableAlgoDeploymentId` deliberately returns `null`: `artifacts/api-server/src/services/automation-authorization.ts:149-154`.
- The route passes that literal null to both the initial payload and subscriber: `artifacts/api-server/src/routes/automation.ts:595-616`. The sharing key is only normalized `{deploymentId:null, mode, eventLimit}`; it has no `appUserId`: `artifacts/api-server/src/services/algo-cockpit-streams.ts:93-107,451-467`.
- `resolveAlgoCockpitTarget` then calls `listAlgoDeployments({})` and falls through to the first requested-mode deployment or first deployment: `artifacts/api-server/src/services/algo-cockpit-streams.ts:115-128`. The list implementation has no session/ALS parameter or ownership predicate: `{}` becomes the global `"all"` cache key, and the DB query selects all deployment rows ordered by `updatedAt DESC`: `artifacts/api-server/src/services/automation.ts:358-369,703-727,923-927`.
- Session scoping rewrites only `deployments` and top-level `events`: `artifacts/api-server/src/routes/automation.ts:126-140`. It does not clear `deploymentId`, `focusedDeployment`, `signalOptionsState`, `cockpit`, `performance`, or `signalMonitorProfile`; the separate `ready` and `freshness` events also emit the selected deployment ID at `:609-613,641-650`.

Concrete two-user trace: A owns the only (or most recently updated) global shadow deployment `A_DEP`; B has no readable shadow deployment and calls `GET /api/streams/algo/cockpit?mode=shadow` without `deploymentId`. B's filtered list is empty, so the route passes null; the ordered global fallback deterministically selects `A_DEP`. The initial SSE event exposes `A_DEP`, A's focused deployment and signal-options state. The poller starts immediately and every five seconds, adding A's cockpit and performance for the lifetime of B's connection: `artifacts/api-server/src/services/algo-cockpit-streams.ts:142-180,184-227,335-390`. The downstream deployment loader queries solely by the selected UUID, without caller ownership: `artifacts/api-server/src/services/signal-options-automation.ts:2225-2245`.

The initial primary payload has `cockpit`, `performance`, and top-level `signalMonitorProfile` set to null. Full polls populate all three. The top-level monitor profile is mode-global by schema, not demonstrably owned by A (`lib/db/src/schema/signal-monitor.ts:19-41`), but it is still unscoped. A's deployment profile, embedded events, active positions, risk, and P&L are already present inside signal state/cockpit: `artifacts/api-server/src/services/signal-options-automation.ts:13567-13577,13643-13705`.

## P1-3 — real-position attribution drops account and tenant scope

The upstream account path is tenant-aware. `/accounts/:accountId/positions` supplies the session user ID, and the account-universe cache includes it: `artifacts/api-server/src/routes/platform.ts:1833-1855`; `artifacts/api-server/src/services/account.ts:1292-1316,6504-6508`. That protection scopes B's positions, but it is discarded for the attribution subquery.

`buildRealPositionAttribution` receives `universe.accountIds`, derives only B's position symbols, and selects the newest 1,000 global execution events where `deploymentId IS NOT NULL` and `symbol IN (...)`: `artifacts/api-server/src/services/account.ts:6398-6433,6593-6596`. It never references `input.accountIds`, `appUserId`, or an ownership join. A deployment UUID does not encode tenant ownership; authorization derives ownership separately through broker/shadow-account joins: `artifacts/api-server/src/services/automation-authorization.ts:25-54`.

Concrete two-user trace: A has a recent execution event `{deploymentId:A_DEP, providerAccountId:A_ACCT, symbol:NVDA, payload.brokerOrder.symbol:NVDA}`. B owns scoped account `B_ACCT`, holds NVDA, and calls `GET /api/accounts/B_ACCT/positions` without `detail=fast` (the route defaults to full). The global symbol-only query selects A's row; the fold maps NVDA to `A_DEP`; B receives `sourceAttribution:[{deploymentId:A_DEP,...}]` at `artifacts/api-server/src/services/account.ts:6477-6487,6903-6904`. Exposure lasts until A's row falls outside the newest 1,000 matching-symbol events, potentially indefinitely.

The input called `accountIds` is not automatically safe to drop into the query. Provider-backed universes can hold local broker-account UUIDs while `execution_events.provider_account_id` stores a provider/deployment account identifier. The fix must use IDs resolved from `universe.accounts` and retain explicit tenant ownership, not trust a raw route account ID.

## P1-4 — ownerless IBKR snapshot persistence

The omission is observed:

- Neither connection nor account insert supplies `appUserId`: `artifacts/api-server/src/services/account.ts:4363-4397`.
- Snapshot write/provider timestamp maps deduplicate on raw `mode:providerAccountId` with no tenant identity: `artifacts/api-server/src/services/account.ts:590-592,4410-4429,4433-4486`.
- Neither `onConflictDoUpdate` supplies `targetWhere`: `artifacts/api-server/src/services/account.ts:4374-4384,4398-4407`.

The claimed cross-user overwrite is refuted in the current schema. Ownerless connections are unique only under `app_user_id IS NULL`, user connections only under `IS NOT NULL`; broker accounts have the same split: `lib/db/src/schema/broker.ts:40-47,73-78`; `lib/db/migrations/20260701_broker_user_scope.sql:12-33`. A NULL insert therefore cannot conflict with A's non-NULL tenant row.

Read-only live-catalog inspection confirmed those four partial indexes. Read-only `EXPLAIN` of both exact conflict-target shapes returned `there is no unique or exclusion constraint matching the ON CONFLICT specification`: without `targetWhere ... app_user_id IS NULL`, PostgreSQL cannot infer either partial arbiter. The connection statement fails before insert/update, so no concrete “B overwrites A's row” trace exists through this code. If the missing predicate were added without adding ownership, the path could update only an existing ownerless/global row, not a tenant-owned row.

The live aggregate check observed ownerless and user-owned broker rows, but no provider-account ID shared between the two sets at audit time. Existing ownerless rows and the tenantless in-memory dedup remain data-model/availability concerns; they do not prove the alleged tenant overwrite.

## P1-5 — SnapTrade replace guard asymmetry

The admin-only invariant explicitly covers SnapTrade impact and submit and proves a `broker_connect` member receives `admin_required`: `artifacts/api-server/src/routes/broker-execution.test.ts:287-331`. Replace is absent from that invariant and uses user session + CSRF + entitlement: `artifacts/api-server/src/routes/auth.ts:234-252`; `artifacts/api-server/src/routes/broker-execution.ts:1144-1164`.

No downstream admin check changes that guard. `loadOrderContext` uses `appUserId` and `accountId`, then replacement normalizes and sends action, order type, TIF, price, symbol, stop, and units: `artifacts/api-server/src/services/snaptrade-equity-orders.ts:1216-1236,1343-1405`.

Concrete role trace: member B has `broker_connect`, a valid CSRF token, B's live SnapTrade account/order, and any required tax preflight. B posts `POST /api/broker-execution/snaptrade/accounts/B_ACCT/orders/B_ORDER/replace` with changed order fields. The route admits B and sends the provider mutation; the same B is denied on `/orders/impact` and `/orders`. This proves the asymmetry and B's own-order capability, not unauthorized access to A.

The current repository expressly mandates `broker_connect + CSRF` for replacement routes, matching the already-hardened generic replace/cancel policy: `docs/plans/workorders-2026-07-09/WO-REPLACE-order-replace-lanes.md:49-54`; `docs/plans/workorders-2026-07-09/wo-sec-1-order-guards.md:10-38`. Both broker account and connection are also AND-scoped to B's `appUserId`, so B cannot substitute A's local account ID: `artifacts/api-server/src/services/snaptrade-equity-orders.ts:528-568`. No B-receives-A-data or B-mutates-A-order trace survives; whether all material replacements should instead inherit submit's admin policy is a product-policy question, not a current tenant-isolation finding.

The cited Schwab comparison is stale. Current Schwab replace is also `requireEntitlementCsrf("broker_connect")`, not admin-only: `artifacts/api-server/src/routes/broker-execution.ts:1118-1141`. This corroborates the documented replacement policy rather than providing the claimed stronger sibling guard.

## P1-6 — login CSRF/session swap

Password flow:

- Express installs unrestricted `cors()`, JSON parsing, and URL-encoded form parsing before the `/api` router: `artifacts/api-server/src/app.ts:193-195,262`. CORS response policy does not stop a normal cross-site top-level form POST.
- `/auth/login` requires only parsed email/password, then creates and sets a new session; it checks neither Origin/Sec-Fetch-Site nor a pre-auth CSRF token: `artifacts/api-server/src/routes/auth.ts:292-313`.
- The cookie is HttpOnly, `SameSite=Lax`, Secure on HTTPS, and path `/`: `artifacts/api-server/src/routes/auth.ts:103-125`. Lax prevents sending the existing cookie on a cross-site unsafe POST, but the cookie standard permits a Lax/Strict cookie to be set by a cross-site top-level navigation. See [RFC6265bis](https://datatracker.ietf.org/doc/draft-ietf-httpbis-rfc6265bis/) and [OWASP's login-CSRF guidance](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html#possible-csrf-vulnerabilities-in-login-forms).

Conditional two-user trace: password-backed attacker A auto-submits a top-level `application/x-www-form-urlencoded` form containing A's credentials to `POST /api/auth/login`. Victim B's browser accepts the response's A session cookie. B then receives/changes A-tenant data until logout, browser-session end, or the server-side 12-hour expiry. Current password login considers only users with a non-null password hash, so ordinary launch-only members may not use this variant: `artifacts/api-server/src/services/auth.ts:286-316`.

Launch flow supplies the general tenant trace. A obtains A's unused, valid launch JWT and causes B to navigate within 120 seconds to `GET /api/auth/launch?token=<A_TOKEN>`. The route authenticates the bearer token, mints A's session into B's browser, and redirects to `/`: `artifacts/api-server/src/routes/auth.ts:353-381`. Signature/algorithm, issuer, audience, 120-second lifetime, and one-use JTI checks are real, but they bind the token to the claimed user, not the initiating browser: `artifacts/api-server/src/services/auth-launch.ts:75-110,113-133,225-246`. The first presenter wins; B then acts as A for up to the 12-hour session TTL: `artifacts/api-server/src/services/auth.ts:24,194-210`.

This is login CSRF/session swapping, not classic session fixation. Every successful login/launch generates a fresh random 48-byte session token; A does not choose or learn B's token: `artifacts/api-server/src/services/auth.ts:106-108,194-210,316`.

## Verification posture

Three independent read-only source passes tried to refute the assigned findings, followed by main-thread reconciliation and a fourth fresh-context adversarial review of this report against the cited implementation, schema, migration, tests, installed Drizzle behavior, and live partial-index catalog. No external model CLI was invoked; the requested Codex 5.6/ultra review remained single-model. P1-4 remains PARTIAL because the ownerless/dedup subclaims are source-true while the alleged tenant overwrite is impossible; P1-5 is PARTIAL because the guard asymmetry is source-true while the claimed unauthorized/tenant effect is contradicted by explicit route policy and ownership scope.
