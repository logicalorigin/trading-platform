# WO-15 Multi-user Scope Report - 2026-07-07

Worker: `codex-worker` for `claude-lead` session `f68a9158`

## Summary

Landed a route-level user-scope guard for automation deployment reads, event reads, per-deployment cockpit/state/performance/KPI reads, and the algo cockpit SSE payload.

Ownership model used today:
- `admin` can read all automation deployments.
- `member` can read deployments whose `algo_deployments.provider_account_id` matches either an owned `broker_accounts.provider_account_id` or an owned `shadow_accounts.id`.
- Legacy/global deployments with no owned broker/shadow account match are admin-only.

Live DB check through `information_schema` observed no `app_user_id`/owner column on `algo_deployments`, `execution_events`, `automation_diagnostics`, or `algo_runs`; only broker/shadow/watchlist/tax tables have direct user columns. That is why the safely-landable predicate uses the nearest available ownership join.

## Sweep Table

| Surface | Auth gate evidence | Service query evidence | Verdict |
|---|---|---|---|
| `/algo/deployments` | `routes/index.ts:58` gates `/algo`; fixed route now calls `requireUser` and filter at `routes/automation.ts:173-182`. | Original leak: `services/automation.ts:363-369` selected `algo_deployments` by mode only. Fixed with `services/automation-authorization.ts:33-52` owner join. | Fixed leaking read. |
| `/algo/events` | `routes/index.ts:58`; fixed route at `routes/automation.ts:508-533`. | Original leak: `services/automation.ts:1288-1303` filtered only optional `deployment_id`. Fixed by pre-checking deployment and filtering returned events at `services/automation-authorization.ts:125-147`. | Fixed leaking read. |
| `/algo/deployments/:id/signal-options/state` | `routes/index.ts:58`; fixed guard at `routes/automation.ts:321-330`. | Underlying service reads deployment/events by `deployment_id` only, e.g. `services/signal-options-automation.ts:2170-2175`, `2190-2200`, `2208-2219`, `2226-2237`. | Fixed at clean route layer. |
| `/algo/deployments/:id/cockpit` | `routes/index.ts:58`; fixed guard at `routes/automation.ts:339-348`. | Same signal-options deployment/event helpers above. | Fixed at clean route layer. |
| `/algo/deployments/:id/signal-options/performance` | `routes/index.ts:58`; fixed guard at `routes/automation.ts:355-363`. | Same signal-options deployment/event helpers above. | Fixed at clean route layer. |
| `/algo/deployments/:id/signal-quality-kpis` | `routes/index.ts:58`; fixed guard at `routes/automation.ts:301-308`. | KPI service reads deployment by id (`signal-quality-kpis-service.ts`, observed via `algoDeploymentsTable` query during sweep). | Fixed at route layer. |
| `/streams/algo/cockpit` | `routes/index.ts:59`; fixed guard/scoped target at `routes/automation.ts:536-556`, scoped payload at `579-604`. | Original stream resolver read all deployments and selected first match at `services/algo-cockpit-streams.ts:80-103`; event/state/cockpit reads at `113-120`, `155-173`. | Fixed leaking SSE payload/target. |
| `/signal-monitor/profile`, `/state`, `/events`, matrix stream, breadth history | `routes/index.ts:63`. | Routes force canonical signal source (`routes/signal-monitor.ts:139-147`, `171-181`, `316-335`, `358-384`). Service reads profiles/states/events by environment/profile, e.g. `services/signal-monitor.ts:3410-3412`, `13783-13794`, `14242-14258`, `14778-14799`. | Intentionally global signal feed. Reason: route comments state signals are one universal source; no user owner columns in live `signal_monitor_*` tables. |
| `/watchlists` GET | `routes/index.ts:50`. | Route uses `listWatchlistsForCurrentUser` at `routes/platform.ts:2023-2025`; service filters owned IDs with `watchlists.app_user_id` at `services/platform.ts:3956-3975`. | User-scoped read. |
| watchlist mutations | `routes/index.ts:50`. | Create stamps `app_user_id` at `services/platform.ts:4136-4146`; update/delete still use id-only mutation predicates at `services/platform.ts:4197-4199`, `4231`. | Not a read leak; mutation residual outside WO-15 read scope. |
| `/accounts` and `/accounts/:id/*` | `routes/index.ts:47`; app user context bound from session at `app.ts:216-229`; shadow reads use `withCallerShadowScope` (`shadow-account.ts:2898-2965`). | Residual: `listAccounts` merges live/persisted/SnapTrade accounts at `services/account.ts:4470-4525`; persisted query has no app_user_id predicate at `1164-1195`; SnapTrade query filters mode/inclusion/provider/status but not `app_user_id` at `4199-4227`. | LEAKING/partial. Not fixed tonight; account service/platform surface is out of WO-15 landable scope and has active dirty hunks in adjacent platform/account lanes. |
| `/positions`, `/orders` legacy account routes | `routes/index.ts:48-49`. | `routes/platform.ts:2057-2078` call account/order services; account route follows account scoping residual above. | Residual risk follows account service scoping. |
| `/backtests/studies`, `/backtests/runs`, run/study detail/chart, overnight/pattern result routes | `routes/index.ts:60`. | `services/backtesting.ts:2063-2067` lists all studies; `2114-2137` lists runs with study/sweep/status only; `1552-1573` get-by-id with no owner; `3083-3092` preview chart by study only. Live `information_schema` observed no `app_user_id` on `backtest_runs`/`backtest_studies`. | LEAKING. Not fixed due explicit WO-15 scope: do not touch backtesting files. |
| `/settings/backend` | `routes/index.ts:39-41` admin-only. | Backend snapshot reads global watchlists and deployments (`backend-settings.ts:188-203`). | Intentionally global admin ops surface. |

## Fixes Landed

Files changed:
- `artifacts/api-server/src/services/automation-authorization.ts` - new helper for deployment read authorization, list/event filtering, and best-effort `entitlement.denied` audit writes.
- `artifacts/api-server/src/routes/automation.ts` - applied the helper to deployment list, per-deployment read routes, `/algo/events`, and `/streams/algo/cockpit`.
- `artifacts/api-server/src/routes/automation-route-auth.test.ts` - added cross-user route tests and updated `/algo/deployments` auth expectation.

Commit: this report is included in the landed WO-15 commit at `HEAD`; exact final
hash is reported in the worker handoff because a commit cannot embed its own
hash without changing it.

## Dirty Collision / Deferred Conflicts

Observed dirty hunks before selecting the fix layer:
- `artifacts/api-server/src/services/automation.ts`: active hunk around `listExecutionEvents` caching and test internals (`git diff` showed changes near `ListExecutionEventsInput`, cache maps, and `listExecutionEvents` implementation). This directly overlaps the ideal service-query predicate, so I did not edit it.
- `artifacts/api-server/src/services/platform.ts`: active hunk around bars/background persist and hydration; account/watchlist fixes would be adjacent to platform lanes, not touched.
- `artifacts/api-server/src/routes/platform.ts`: active hunk around sparkline/bars parsing; not touched.
- `artifacts/api-server/src/services/diagnostics.ts`: active hunk around diagnostic heavy-read caching and automation event diagnostics; not touched.

Additional explicit scope deferrals:
- `artifacts/api-server/src/services/signal-options-automation.ts` and `artifacts/api-server/src/routes/signal-monitor.ts` were read for evidence only and not edited.
- `artifacts/api-server/src/routes/backtesting.ts` / `services/backtesting.ts` are leaking authenticated backtest reads but explicitly out of WO-15 edit scope.

## Verification

Focused route test:

```text
pnpm --dir artifacts/api-server exec node --import tsx --test src/routes/automation-route-auth.test.ts
tests 7
pass 7
fail 0
duration_ms 54801.412081
```

Typecheck:

```text
pnpm --dir artifacts/api-server typecheck
@workspace/api-server typecheck: tsc -p tsconfig.json --noEmit
exit 0
```

## Residual Risk

- Account reads are still a high-priority residual: SnapTrade and persisted broker account reads lack a consistent `app_user_id` predicate in `services/account.ts`.
- Backtest reads are authenticated but globally readable because live schema lacks owner columns and services query by id/list without user predicates.
- Automation event global reads for non-admin are now response-filtered at route level. This prevents cross-user disclosure but can under-return a member's older events if global top-N rows are dominated by other users. A service-level scoped query should replace this after the `services/automation.ts` cache hunk lands.
- Automation deployment ownership is inferred from provider/shadow account ownership because no direct deployment owner column exists. A future migration should add `algo_deployments.app_user_id` and backfill legacy rows to the founding admin, matching Slice 6/7 conventions.
