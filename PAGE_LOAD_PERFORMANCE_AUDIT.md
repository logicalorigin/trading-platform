# Page & Container Load Performance Audit

Three parallel sweeps covered the React app, the API/bridge response path, and Replit container startup.

**Headline finding:** the biggest backend slowness isn't in code paths or queries — it's that every IBKR bridge work lane has `concurrency: 1`, so when the API correctly fires five parallel account calls, the bridge serializes them anyway. That single config decision dominates several "why is the account page slow" complaints.

---

## Frontend (page load)

Lazy-loading and vendor chunking are already well done — 10 screens lazy via `lazyWithRetry`, vendor chunks split, deferred preload for charting/backtest. So the wins are in render and refetch behavior, not bundling.

| # | What's slow | Where | Brainstorm |
|---|---|---|---|
| 1 | **AccountScreen polls every 5s on 4 queries** (overrides global 30s staleTime) | `screens/AccountScreen.jsx:111-115` | Bump to 15-30s; gate on page visibility; use SSE deltas not polling |
| 2 | **Flow main grid is `.map()` not virtualized** even though `DenseVirtualTable` exists | `screens/FlowScreen.jsx:1549, 2193` | Swap to `DenseVirtualTable` (already used in sub-component at line 4923) |
| 3 | **`import * as d3` defeats tree-shaking** — pulls 200KB | `features/research/PhotonicsObservatory.jsx:25` | Switch to named imports |
| 4 | **`readPersistedState()` runs at module-eval time**, blocks JS parsing | `workspaceState.js:22` | Defer to useEffect; consider IndexedDB for large state |
| 5 | **Recharts eager on AccountScreen** (EquityCurve + Portfolio + Allocation + TradingAnalysis), re-renders on every quote tick | `features/account/*` panels | Throttle chart updates to 1Hz; wrap each chart in its own Suspense |
| 6 | **Option chain batch chunks of 5 are awaited sequentially in a map of `useQuery`** | `screens/TradeScreen.jsx:2591` | Parallelize via individual queries; raise batch concurrency at the backend |
| 7 | **7 concurrent EventSources possible** on TradeScreen + watchlist + account | `features/platform/live-streams.ts` | Connection cap with multiplexing; reuse one SSE for account family streams |
| 8 | **TradeScreen: 4.7 kLOC, 123 hooks** in one component | `screens/TradeScreen.jsx` | Split by panel; context for shared ticker/expiry state |

---

## Backend (response path)

Cache and dedup are actually solid (in-flight maps + single-flight on account page). The bottlenecks are in the **bridge lane scheduler** and **timeout/backoff mismatches**.

| # | What's slow | Where | Brainstorm |
|---|---|---|---|
| 1 | **All bridge lanes `concurrency: 1`** — account, historical, options-meta, option-quotes. API parallelism (5 account calls in `Promise.all`) collapses back to serial at the bridge. | `ibkr-bridge/src/work-scheduler.ts:73-119` | Raise account/historical to 2-3; coordinate with IBKR API rate limits to find safe ceiling |
| 2 | **Account derived has a 6s boot delay** before SSE clients get full payload | `services/account-page-streams.ts:25-26` | Ship priority immediately; load derived in background; cache benchmark equity longer (5 min, not 30s) |
| 3 | **Quote timeout 30s, backoff 15s** → retries fire while underlying issue is still present (thundering herd) | `providers/ibkr/bridge-client.ts:562` + `services/bridge-governor.ts:56` | Make backoff ≥ timeout; add exponential backoff (5s/10s/30s) |
| 4 | **Cache TTL is 1s** for priority/live; at scale, every TTL window is a stampede risk | `services/account-page-streams.ts` | Adaptive TTL (extend under load); probabilistic early refresh; jitter |
| 5 | **SSE slow-clients get hard-killed at 256 chunks** | `ibkr-bridge/src/sse-writer.ts:74-80` | Drop intermediate snapshots first; flow-control by client drain rate; only kill on extended stall |
| 6 | **Transient DB error → 60s flow universe lockout** | `lib/transient-db-error.ts:28` | Per-query backoff with exponential ramp, not a global 60s |
| 7 | **TWS subscription churn O(N) on every listener add/remove** | `ibkr-bridge/src/tws-provider.ts:2505-2703` | Batch listener deltas over 100ms; rebalance once |
| 8 | **Diagnostics collection on the request path** | `services/diagnostics.ts` | Move to background tick; serve cached snapshot |

---

## Container startup

Replit cold start is **15-50s end-to-end**, dominated by two things:

| # | What's slow | Where | Brainstorm |
|---|---|---|---|
| 1 | **API esbuild bundle 8-25s on every dev start** — bundles 70+ externals + 6 workspace libs | `artifacts/api-server/build.mjs` + `package.json:7` | Pre-build dist in CI and ship it; or switch dev to `tsx src/index.ts` (no bundle) |
| 2 | **Vite prebundles on first browser request** (3-10s) | Vite dev server | Commit `.vite/deps/` from CI run; warm in postinstall |
| 3 | **Healthz returns 200 with no DB / bridge check** | `routes/health.ts:6-8` | Add a DB ping + bridge-runtime presence check — eliminates the "ready but actually broken" window |
| 4 | **Supervisor lock waits up to 8s** on restart | `scripts/runDevApp.mjs:30` (`PYRUS_DEV_LOCK_WAIT_MS`) | Drop to 3s; aggressive takeover when prior process is unresponsive |
| 5 | **Workspace libs rebundled on every API build** | `build.mjs` external list | Pre-build `lib/*/dist/`, mark workspace libs as `external` in dev |
| 6 | **Vite config runs `git status/rev-parse/branch` on every start** (100-300ms) | `vite.config.ts:17-27` | Cache to `.vite-fingerprint`; refresh only when `.git/HEAD` mtime changes |
| 7 | **Background services fire-and-forget after healthz** — first call hits a cold service | `index.ts:153-174` | Either pre-warm priority (watchlist, account) before healthz, or return cached defaults on first hit |
| 8 | **`esbuild-plugin-pino` worker extraction** adds dev overhead nobody needs | `build.mjs:107` | Use console logging in dev; pino only in prod |

---

## Cross-cutting takeaways

1. **The single biggest unlock is raising bridge lane concurrency.** Most user-perceived slowness on account/options/historical pages traces back to that. It's a single config change to start experimenting with, gated by what TWS will accept without rate-limiting.
2. **Frontend's polling-instead-of-streaming is the second biggest** — AccountScreen alone fires ~50 requests/min when open. The SSE infrastructure already exists; just route the deltas through it instead of `refetchInterval`.
3. **Dev startup is mostly esbuild waiting on itself.** Pre-building in CI or switching dev to `tsx` is the cheapest large win there.

## Quick wins (low effort, real impact)

- Drop AccountScreen `refetchInterval` from 5s → 15s, or gate on `usePageVisible`.
- Fix `import * as d3` → named imports.
- Bump bridge `account` and `historical` lane concurrency from 1 → 2 and measure.
- Add DB ping to `/api/healthz`.
- Lower `PYRUS_DEV_LOCK_WAIT_MS` to 3s.

---

## Appendix: latency budget sketch

End-to-end "click → interactive" on the account screen, cold:

```
Replit start
  ├─ Supervisor lock wait        0-8s   (#4 startup)
  ├─ API esbuild compile         8-25s  (#1 startup)   ← priority path
  ├─ API listen + healthz        <1s
  ├─ Vite prebundle (1st req)    3-10s  (#2 startup)   ← priority path
  └─ React hydrate + bootstrap   1-3s
                                 ───────
  First paint                    13-47s

Account screen open
  ├─ Priority SSE payload        500ms-1.5s   (#1 backend — bridge serialization)
  ├─ Derived 6s boot delay       6s           (#2 backend)
  ├─ Recharts mount × 4          200-600ms    (#5 frontend)
  └─ Every 5s thereafter         4-5 req/5s   (#1 frontend)
```

The fixes line up against the longest segments: bridge concurrency for the 1.5s priority payload, derived boot delay for the 6s wait, AccountScreen refetch tuning for the steady-state load, esbuild + Vite prebundling for the cold start.
