# PYRUS API probe plan — notes

Source of truth: `artifacts/api-server/src/routes/*.ts` (route registrations) + mount order in
`routes/index.ts` (lines 93–107) + auth prefixes in `index.ts` (REQUIRE_ADMIN_PATHS L39–42,
REQUIRE_USER_PATHS L44–68). Query-param requiredness read from `lib/api-zod/src/generated/api.ts`.
Deliverable: `probe-plan.json` = `{ probes:[...], noCookieProbes:[...] }`.

## Counts per class (GET/SSE probe entries only; non-GET are never probed and not listed)

| class | count | meaning |
|---|---|---|
| safe-live-probe (`safe`) | 68 | probe any time; bounded/light or cached |
| probe-off-hours-expensive (`offhours`) | 31 | single-shot, minimal params (SPY / limit=10 / short range) |
| probe-serial-SSE (`sse`) | 14 | `curl -N --max-time 8`, one at a time |
| exclude (`exclude`) | 10 | side-effect / third-party passthrough / proxy |
| **total probe entries** | **123** | |
| noCookieProbes (401 checks) | 71 | one per gated route (auth != anon, not excluded) |

Auth breakdown of the 123 entries: anon = 42, pyrus_session-gated = 79, marketing-bearer = 2.
(`exclude` entries still carry their real auth for reference but are not probed.)

## SSE endpoints (14) — all set `text/event-stream`

- Platform (`startSse` helper, platform.ts:1542): `/streams/quotes`, `/streams/options/chains`,
  `/streams/options/quotes`, `/streams/orders`, `/streams/executions`, `/streams/footprints`,
  `/streams/accounts`, `/streams/accounts/page`, `/streams/accounts/shadow`,
  `/streams/stocks/aggregates`.
- `/streams/algo/cockpit` (automation.ts:558), `/diagnostics/stream` (diagnostics.ts:339),
  `/signal-monitor/matrix/stream` (signal-monitor.ts:56), `/marketing/shadow-dashboard/stream`
  (marketing.ts:155).
- Gated SSE (need cookie): `/streams/accounts/page`, `/streams/accounts/shadow`,
  `/streams/algo/cockpit`, `/signal-monitor/matrix/stream`. `/streams/accounts` (base) is PUBLIC
  (index.ts comment: IBKR bridge snapshot, no shadow reader).

## Route ⇄ OpenAPI spec drift

Method: extracted 202 REST ops from source (+1 `router.use` proxy) vs 180 ops from
`lib/api-spec/openapi.yaml`.

- **Spec ops missing a route: NONE.** Every one of the 180 spec operations has a matching source
  route. The spec is a strict subset of the implemented routes.
- **Routes in source but NOT in spec: 22 REST + 1 proxy (23 total).**

| method | path | why / note |
|---|---|---|
| GET | /auth/session | auth surface (kept out of JSON API contract) |
| POST | /auth/bootstrap | auth |
| POST | /auth/login | auth |
| GET | /auth/launch | launch handoff (302 redirect) |
| POST | /auth/launch | launch handoff |
| POST | /auth/logout | auth |
| GET | /gex/{underlying}/projection | KNOWN — platform.ts:2270, not in spec |
| GET | /gex/{underlying}/zero-gamma | KNOWN — platform.ts:2294, not in spec |
| POST | /sparklines/seed | platform.ts:2448 |
| POST | /bars/batch | platform.ts:2554 |
| GET | /diagnostics/market-data/price-trace | diagnostics.ts:325 |
| POST | /diagnostics/market-data/gex-universe-refresh | diagnostics.ts:302 |
| POST | /backtests/overnight-expectancy | backtesting.ts:248 |
| GET | /backtests/overnight-expectancy/{studyId} | backtesting.ts:257 |
| GET | /backtests/overnight-expectancy/{studyId}/samples | backtesting.ts:270 |
| POST | /backtests/pattern-discovery/promote | backtesting.ts:327 |
| POST | /algo/deployments/{deploymentId}/signal-quality-kpis/refresh | automation.ts:311 |
| GET | /streams/algo/cockpit | automation.ts:536 (SSE) |
| GET | /broker-execution/robinhood/oauth/callback | OAuth callback (comment: intentionally not in contract) |
| GET | /broker-execution/schwab/oauth/callback | OAuth callback (intentionally not in contract) |
| GET | /marketing/shadow-dashboard/snapshot | marketing router (bearer-token) |
| GET | /marketing/shadow-dashboard/stream | marketing router (SSE, bearer-token) |
| USE | /broker-execution/ibkr-portal/gateway | reverse proxy (router.use, all methods) — not a REST op |

## `/diagnostics/runtime` "candidate duplicate" — VERIFIED, NOT a duplicate

`GET /diagnostics/runtime` is defined in exactly ONE place: `platform.ts:1739`. `diagnostics.ts`
has NO `/runtime` route (grep for `runtime` in diagnostics.ts → none). Mount order in index.ts is
`diagnosticsRouter` (L100) before `platformRouter` (L102), but diagnosticsRouter never registers a
matching handler, so a request falls through to `platform.ts:1739`, which is the sole handler.
It IS present in the spec (`GET /diagnostics/runtime`). No mount conflict; no drift.

## Auth model (fact-first note — index prefixes UNDER-count gated routes)

The task's auth rule keys off `REQUIRE_USER_PATHS` / `REQUIRE_ADMIN_PATHS` prefixes in index.ts.
That gate covers: `/broker-connections`, `/accounts`, `/positions`, `/orders`, `/watchlists`,
`/shadow/orders`, `/streams/accounts/page`, `/streams/accounts/shadow`, `/algo`, `/streams/algo`,
`/backtests`, `/charting`, `/research`, `/signal-monitor`, `/settings/preferences`,
`/settings/backend` (admin), `/tax`. Note `/accounts/*/tax/*` is gated via the `/accounts` prefix.

BUT several routers also gate inside the handler, so the index prefix list is not the whole auth
picture (observed from source):
- `broker-execution/*` GETs: `requireEntitlement("broker_connect")` or `requireAdmin` per handler
  (the `/broker-execution` prefix is NOT in REQUIRE_USER_PATHS — only `/broker-connections` is).
- `ibkr-portal/*` GETs: `requireUser` + IBKR-portal access assertion per handler.
- `automation`/`tax` mutations additionally call `requireAdminCsrf` / `requireUserCsrf`.
- `marketing/*` uses a separate `PYRUS_MARKETING_DASHBOARD_TOKEN` Bearer token (NOT pyrus_session);
  no token → 401, unconfigured → 404.

`auth` field values in the JSON: `anon`, `session-user`, `session-admin`,
`session+entitlement:broker_connect`, `session+ibkr-portal-access`, `marketing-bearer`.
`noCookieProbes` covers every gated (session-cookie) route; admin routes may return 403 (not 401)
if a member cookie is present without admin.

## Parameterized-path harvest sources

- `{accountId}` ← `GET /accounts` (ListAccounts) → feeds all `/accounts/{accountId}/*` (platform +
  tax).
- `{deploymentId}` ← `GET /algo/deployments`.
- `{watchlistId}` ← `GET /watchlists`.
- `{studyId}` ← `GET /backtests/studies`; `{runId}` ← `GET /backtests/runs`;
  `{sweepId}` ← `run.sweepId` on `GET /backtests/runs` items (no sweeps-list endpoint);
  `{jobId}` ← `GET /backtests/jobs`.
- overnight-expectancy / pattern-discovery `{studyId}` are UUIDs from their POST creators (or
  `/backtests/studies`); `patternKey` ← `GET /backtests/pattern-discovery/{studyId}`.
- `{eventId}` ← `GET /diagnostics/events`.
- Market-data path/query values use literals (underlying/symbol = `SPY`); option `strike` ←
  `GET /options/chains`; `expirationDate` ← `GET /options/expirations`.
- `{accountId}` for `broker-execution/snaptrade/*` and `schwab/*` = broker provider account ids —
  those routes are `exclude` (third-party) so not harvested here.

## Off-hours-expensive rationale (31)

Broker/gateway readiness+health passthroughs (`/accounts/flex/health`, all `*/readiness`,
`ibkr-portal/readiness|status`), `exportDiagnostics` (NO query params), `signal-quality-kpis` (NO
query params), `signal-monitor/state` (~10 MB), `price-trace`, and heavy market-data/compute reads
(option chain/expirations/resolve-contract/chart-bars, bars, footprints, gex
dashboard/snapshots/projection/zero-gamma, flow events/aggregate/premium-distribution,
pattern-discovery, backtest preview/run charts, overnight-expectancy, research high-beta-universe)
— all probed single-shot with minimal params (SPY / limit=10 / short range).
