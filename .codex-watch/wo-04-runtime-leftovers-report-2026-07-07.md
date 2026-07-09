# WO-04 Runtime Leftovers Report - 2026-07-07

Worker: codex-worker for claude-lead session f68a9158

Scope: investigation-first. No app restart was performed. The only code edit applied was the mechanical `pg` SSL mode normalization in `lib/db/src/runtime.ts`.

## Baseline

Observed throttle-audit executive finding: `.codex-watch/throttle-audit-2026-07-07.md` identified `/diagnostics/client-metrics` as the earlier dominant slow route and gave KEEP/RETUNE verdicts for the pressure stack. I did not re-litigate those verdicts.

Observed live health: `GET http://127.0.0.1:8080/api/healthz` returned `{"status":"ok"}`.

Observed current pressure snapshot: `.pyrus-runtime/flight-recorder/api-current.json` showed API pressure `high`, event loop utilization `98%`, DB pool `max=12 total=12 idle=0 active=12 waiting=14`, and current 5-minute top-route p95 led by `GET /backtests/drafts` at `22812ms`. `/api/accounts/shadow/orders` was absent from current `topRoutes`.

Scope check: the worktree already contained many unrelated modified/untracked files before this worker edit. The worker-owned code diff is `lib/db/src/runtime.ts`; this report is the requested deliverable.

## Finding 1: Startup-ordering ECONNREFUSED

Status: root cause verified. No patch applied.

Evidence:

- `artifacts/pyrus/scripts/runDevApp.mjs:224` builds `VITE_PROXY_API_TARGET` as `http://127.0.0.1:${apiPort}` for the web service.
- `artifacts/pyrus/scripts/runDevApp.mjs:1052` starts the API child.
- `artifacts/pyrus/scripts/runDevApp.mjs:1062` documents that the web process starts in parallel with API boot and that `/api` proxy requests may briefly see the API unavailable.
- `artifacts/pyrus/scripts/runDevApp.mjs:1068` starts the web child before the API health gate completes.
- `artifacts/pyrus/scripts/runDevApp.mjs:1094` waits for API health only after both children have been spawned.
- `artifacts/pyrus/vite.config.ts:708` configures the `/api` proxy target with no custom startup-error handler.
- `artifacts/pyrus/package.json:9` sets the default `VITE_PROXY_API_TARGET=http://127.0.0.1:8080`.
- Prior attempts in git history include `45e2a524 Wait for the API to be ready before starting the development server` and `1f253095 perf(dev): start vite in parallel with the API health gate`.

Root cause: `runDevApp.mjs` intentionally starts Vite before the API health gate completes. During that startup window, Vite's `/api` proxy can connect to `127.0.0.1:8080` before the API listener binds, producing expected `ECONNREFUSED` noise. This is a startup-ordering/logging issue, not evidence that the live API is currently down.

Proposed patch sketch, not applied:

```ts
// artifacts/pyrus/vite.config.ts
server: {
  proxy: {
    "/api": {
      target: apiTarget,
      changeOrigin: true,
      configure(proxy) {
        proxy.on("error", (error, req, res) => {
          const isStartupRefusal =
            "code" in error &&
            error.code === "ECONNREFUSED" &&
            typeof req.url === "string" &&
            req.url.startsWith("/api/");

          if (!isStartupRefusal) {
            throw error;
          }

          if (!res.headersSent) {
            res.writeHead(503, { "Retry-After": "1" });
          }
          res.end("API is starting");
        });
      },
    },
  },
}
```

Recommended confirmation check: on the next intentional startup only, capture the timestamps for API child spawn, web child spawn, API health success, and first Vite proxy `ECONNREFUSED`. No restart was performed for this investigation.

## Finding 2: Node `pg` SSL-mode deprecation warning

Status: root cause verified and fixed.

Evidence:

- `artifacts/api-server/dist/index.mjs:30136` contains the bundled `pg-connection-string` deprecation warning: SSL modes `prefer`, `require`, and `verify-ca` are currently aliases for `verify-full`, but future `pg` behavior will change.
- `lib/db/src/runtime.ts:78` builds a generated PostgreSQL URL from discrete `PG*` environment variables.
- `lib/db/src/runtime.ts:97` previously copied `PGSSLMODE` directly into the generated URL's `sslmode` query parameter.
- `lib/db/src/index.ts:185` resolves the database runtime config.
- `lib/db/src/index.ts:232` passes that URL as the Node `pg` pool `connectionString`.
- The Rust market-data worker uses `sqlx`, not Node `pg`: `crates/market-data-worker/src/db.rs:7` imports `PgPoolOptions`, and `crates/market-data-worker/Cargo.toml:15` depends on `sqlx`.

Root cause: when `PGSSLMODE` was `prefer`, `require`, or `verify-ca`, `lib/db/src/runtime.ts` generated a Node `pg` connection string containing the soon-to-change `sslmode` value. Node `pg` emitted the deprecation warning when parsing that URL. The warning was likely attributed to the market-data worker because it appeared near worker startup logs, but the deprecated API usage is in the shared Node DB bootstrap path.

Applied patch:

- `lib/db/src/runtime.ts:97` now writes `sslmode=verify-full` for generated URLs when `PGSSLMODE` is `prefer`, `require`, or `verify-ca`.
- `lib/db/src/runtime.ts:102` adds `normalizeNodePgSslMode`, preserving current Node `pg` behavior exactly as the warning recommends.
- Values that are not part of the deprecation set, such as `disable` and `verify-full`, pass through unchanged.

Verification:

- `pnpm exec tsc -p tsconfig.json --noEmit` passed.
- `pnpm exec tsc -p lib/db/tsconfig.json --noEmit` passed.
- `pnpm --filter @workspace/db exec tsx --test src/*.test.ts src/schema/*.test.ts` passed: 30 tests.
- Direct config check confirmed mappings: `prefer`, `require`, and `verify-ca` become `verify-full`; `verify-full` and `disable` remain unchanged.
- `pnpm --filter @workspace/db run typecheck` could not run because `@workspace/db` has no `typecheck` script.

Fresh live-log verification: needs the next natural API or worker restart. The running process was not restarted, so it cannot load the source change yet.

## Finding 3: Slow `/api/accounts/shadow/orders`

Status: cause mostly verified as pressure/pool queueing rather than a missing obvious order index. No patch applied.

Evidence:

- `.pyrus-runtime/flight-recorder/api-current.json` current 5-minute top routes did not include `/api/accounts/shadow/orders`.
- Current 5-minute dominant route was `GET /backtests/drafts` with p95 `22812ms`; `POST /diagnostics/client-metrics` was still slow at p95 `8415ms` but no longer dominant in this snapshot.
- Full-day parsed slow DB/acquire events ranked `/api/accounts/shadow/orders` at rank 31: 206 events, 139 pool-acquire slow events, 67 query-slow events, total slow milliseconds `751738`, max `24411ms`, average `3649ms`.
- Since `2026-07-07T19:00:00Z`, `/api/accounts/shadow/orders` did not appear in the top 30 slow DB/acquire routes.
- Example slow events showed high pool waiting at the same time as the route: `.pyrus-runtime/flight-recorder/api-events-2026-07-07.jsonl:351903`, `:352203`, `:355111`, `:355500`, and `:414225`.
- `artifacts/api-server/src/routes/platform.ts:1895` registers `GET /accounts/:accountId/orders`.
- `artifacts/api-server/src/services/account.ts:7555` routes shadow account requests to `getShadowAccountOrders`.
- `artifacts/api-server/src/services/shadow-account.ts:3213` reads shadow orders by account, ordered by `placedAt desc`, capped by `shadowLedgerDashboardReadLimit()`.
- `lib/db/src/schema/trading.ts:253` defines `shadow_orders_account_placed_at_idx`.
- `lib/db/src/schema/trading.ts:259` defines `shadow_orders_account_asset_side_symbol_placed_at_idx`.
- `lib/db/migrations/20260629_shadow_account_stream_indexes.sql:22` creates the account/placed-at index concurrently.

Root cause: the route is no longer a current dominant slow route. Its full-day slow samples are dominated by DB pool queueing during broader pressure, with some slow `auth_sessions`, `shadow_accounts`, and `shadow_orders` reads occurring while pool waiters were high. Source already contains the expected account/placed-at order indexes, so the strongest current cause is contention plus repeated per-route reads rather than a missing straightforward index.

Proposed patch sketch, not applied:

```ts
// artifacts/api-server/src/services/shadow-account.ts
// Reuse the existing short-TTL/stale shadow read cache for the
// route-specific orders path, keyed by account, tab, and source.
return shadowAccountReadCache.getOrLoad(
  `orders:${accountId}:${tab}:${source}`,
  () => readShadowOrdersForAccount({ accountId, tab, source }),
  {
    ttlMs: shadowReadTtlMs,
    staleTtlMs: shadowReadStaleTtlMs,
    staleImmediateWhenPressureHigh: true,
  },
);
```

Recommended confirmation check: during a quiet read-only diagnostic window, run `EXPLAIN (ANALYZE, BUFFERS)` for the actual `shadow_orders` account query used by `readShadowOrdersForAccount`. That would separate query-plan cost from pool-queue wait. Do not use a synthetic endpoint probe; use the route source and schema-confirmed query.

## Ranked Recommendation

1. Dispatch the startup proxy-noise fix next if the goal is clean supervisor startup logs. It is localized to the Vite proxy configuration and should preserve the current parallel startup behavior.
2. Dispatch the shadow-orders cache/stale-read change after confirming the exact query plan. Current data says this route is not the present top pressure source, so it should not preempt broader DB pool and stream-pressure work.
3. On the next natural API or worker restart, verify that the Node `pg` SSL-mode warning is absent from inherited process logs. No restart was forced for this work order.
