# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Key Commands

- Replit Run button — runs `bash scripts/run-replit-dev.sh` from `.replit`, which starts the API on port `8080` and the RayAlgo web app on port `18747` as one repo-owned dev command.
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally
- `pnpm --filter @workspace/rayalgo run dev` — run the RayAlgo web app locally
- `pnpm --filter @workspace/backtest-worker run dev` — run the background backtest worker locally

Account/Flex persistence note:
- If `/api/accounts/flex/health` reports `schemaReady: false`, the account UI will fall back to live-only data and FLEX history/cache fields will stay empty until the DB schema is pushed.
- Run `pnpm --filter @workspace/db run push` to create the missing account/FLEX tables, then verify `/api/accounts/flex/health` shows `schemaReady: true` and an empty `missingTables` list.

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.

## Artifacts

- **rayalgo** (`artifacts/rayalgo`, `/`) — RayAlgo Platform. React + Vite trading terminal with the platform shell, runtime providers, charting, market, flow, trade, account, research, algo, backtest, diagnostics, and settings code split under `src/features`, `src/screens`, and `src/components/platform`. The retired `src/RayAlgoPlatform.jsx` monolith is no longer the app entry; `src/app/App.tsx` lazy-loads `src/features/platform/PlatformApp.jsx`. The `components/ui/` directory only retains `dropdown-menu.tsx` and `popover.tsx` (the only shadcn wrappers actually imported); the rest of the shadcn library plus its dependencies (radix-*, sonner, vaul, wouter, cmdk, framer-motion, react-hook-form, date-fns, etc.) were removed in the dependency cleanup pass.
- **api-server** (`artifacts/api-server`) — Express API serving research, trading, market data, and the new backtesting routes.
- **backtest-worker** (`artifacts/backtest-worker`) — background job worker that claims queued backtest jobs, hydrates/caches datasets, runs studies and sweeps, and promotes persistent run artifacts into the database.
- **ibkr-bridge** (`artifacts/ibkr-bridge`) — small HTTP service that runs beside the user's local Interactive Brokers Gateway/TWS socket. Built into `dist/index.mjs`; the Windows one-click helper exposes the bridge through Cloudflare, and the api-server's `IbkrBridgeClient` calls it for accounts, positions, bars, quotes, market depth, orders, and TWS contract search. All Date-typed fields are deserialized at the bridge-client boundary in `artifacts/api-server/src/providers/ibkr/bridge-client.ts` (HTTP JSON only carries strings).

## Replit Run

The tracked `.replit` pins the Run button to:

```toml
run = ["bash", "scripts/run-replit-dev.sh"]
```

`scripts/run-replit-dev.sh` is the canonical development app startup path. It
starts both long-lived services and shuts both down when either child exits or
when Replit sends `SIGTERM`:

- API — `LOG_LEVEL=warn PORT=8080 pnpm --filter @workspace/api-server run dev`.
- RayAlgo web — `PORT=18747 BASE_PATH=/ VITE_PROXY_API_TARGET=http://127.0.0.1:8080 pnpm --filter @workspace/rayalgo run dev`.

In the Replit Run dropdown, use the default **Run Replit App** entry. Do not use
the generated **Configure Your App** workflow as the app runner; it is only a
setup placeholder and can restart/refresh the workspace without owning the real
API/web lifecycle. The per-artifact workflows may still exist in the Workflows
pane because Replit discovers `.replit-artifact/artifact.toml`, but they are
secondary service-level controls, not the normal operator run path.

The artifact TOML files remain the deployment/service metadata source:

- `artifacts/api-server: API Server` — `LOG_LEVEL=warn pnpm --filter @workspace/api-server run dev` on port `8080`.
- `artifacts/rayalgo: web` — `pnpm --filter @workspace/rayalgo run dev` on port `18747`.

Both artifact dev scripts call `scripts/reap-dev-port.mjs` before binding their
pinned port. The root runner deliberately delegates to those scripts instead of
duplicating the port cleanup logic.

Do not add a separate Replit `IBKR Bridge` workflow for TWS mode. The bridge
runs beside IB Gateway/TWS on the Windows machine and is exposed through the
activation helper. A generated or stale workflow in the Replit UI is not part
of the repo config and should be removed from the Workflows pane rather than
linked to app startup.

Publishing note: the API artifact production build runs
`pnpm run build:api-deployment`, which builds the API, builds
`@workspace/ibkr-bridge`, and packages
`artifacts/ibgateway-bridge-windows-current.tar.gz`. The API serves that archive
from `/api/ibkr/bridge/bundle.tar.gz` so the published app can launch the
Windows helper without IDE workflow access.

## IBKR Live Data Setup (User-Side)

### IB Gateway/TWS live mode

IBKR uses pure IB Gateway/TWS mode. Client Portal Gateway is not a supported
runtime path for this project. IBKR market-data line limits still apply, so this
mode streams watchlist/visible/selected instruments and falls back to
vendor/cached data for over-budget symbols. Do not expose the raw TWS socket.

Replit does not need IBKR bridge URL secrets for the normal live flow. Start
IBKR activation from the RayAlgo header; the Windows helper posts the current
Cloudflare bridge URL and bridge token back to the API, which stores them in the
runtime override. Stale URL secrets such as `IBKR_BASE_URL`,
`IBKR_API_BASE_URL`, `IB_GATEWAY_URL`, `IBKR_GATEWAY_URL`, `IBKR_BRIDGE_URL`,
and `IBKR_BRIDGE_BASE_URL` should be deleted from Replit Secrets if present.

Keep non-URL secrets/config as needed:

- `IBKR_TRANSPORT=tws` may remain as shared runtime intent.
- Optional account pin: `IBKR_ACCOUNT_ID=<live-account-id>`.
- Optional caps: `IBKR_MAX_LIVE_EQUITY_LINES=80`, `IBKR_MAX_LIVE_OPTION_LINES=20`.
- Account history/Flex secrets such as `IBKR_FLEX_TOKEN` and `IBKR_FLEX_QUERY_ID`
  are unrelated to bridge URL activation and should not be removed.

Windows side:

1. Start IB Gateway/TWS live and enable API socket clients on port `4001`.
   Uncheck API read-only mode only when live order submission is intentionally
   being tested.
2. Start activation from the RayAlgo header on the Windows machine. The helper
   defaults to live mode, port `4001`, client id `101`, and live market data
   type `1`.
3. The helper downloads the current served bridge bundle, starts the local
   bridge, starts a new Cloudflare quick tunnel when needed, and records the
   active URL automatically.

Security rule: when `IBKR_TRANSPORT=tws`, the bridge requires
a bridge token for every route except `/healthz`. The token is generated by
activation and stored with the runtime override; browser clients should not call
the Windows bridge directly.

Do not run Client Portal Gateway and IB Gateway/TWS at the same time with the
same IBKR username; IBKR treats them as competing brokerage sessions.

### Tunnel: named cloudflared tunnel (optional)

The one-click helper uses Cloudflare quick tunnels and clears stale quick-tunnel
state before launching a replacement. A named tunnel can still be used later if
a stable hostname is needed, but it is not part of the supported one-click path.

One-time setup on the Windows machine (requires a Cloudflare account with a zone you control):

1. `cloudflared tunnel login` — opens a browser, pick the zone (`<userdomain>`).
2. `cloudflared tunnel create ibkr` — creates the tunnel and writes credentials to `%USERPROFILE%\.cloudflared\<TUNNEL-UUID>.json`.
3. `cloudflared tunnel route dns ibkr ibkr.<userdomain>` — creates the public DNS CNAME.
4. Create `%USERPROFILE%\.cloudflared\config.yml`:
   ```yaml
   tunnel: ibkr
   credentials-file: C:\Users\<you>\.cloudflared\<TUNNEL-UUID>.json
   ingress:
     - hostname: ibkr.<userdomain>
       service: http://localhost:3002
     - service: http_status:404
   ```
5. Start activation from the RayAlgo header so the API stores the active bridge
   URL in the runtime override.

### Windows processes

1. **IB Gateway/TWS** — logged in live with API socket clients enabled on `127.0.0.1:4001`.
2. **RayAlgo IBKR bridge** — launched only by the one-click activation helper; listens on `http://localhost:3002`.
3. **cloudflared** — launched by the activation helper for the bridge HTTP service.

### One-click activation helper (`scripts/windows/rayalgo-ibkr-helper.ps1`)

Start activation from the RayAlgo header after IB Gateway/TWS is logged in.

What it does:

1. Checks whether the IB Gateway/TWS socket is reachable.
2. Self-updates the installed protocol handler when the served helper version changes.
3. Opens the RayAlgo bridge with `IBKR_TRANSPORT=tws`.
4. Clears stale quick-tunnel state, opens cloudflared, and posts the current bridge URL/token back to the API.

### Verifying the chain from Replit

```
curl -sS "http://127.0.0.1:8080/api/bars?symbol=AAPL&timeframe=1m&limit=2"  # expect HTTP 200
```

### Symbol quirks

- Polygon-style dotted tickers (`BRK.B`, `BF.B`) are translated to IBKR's space-separated form (`BRK B`) inside `resolveStockContract` in `artifacts/api-server/src/providers/ibkr/client.ts`. Add new mappings there if other symbol families fail.

## Data sourcing (IBKR-primary, Polygon-fallback)

`artifacts/api-server/src/services/platform.ts` is wired so IBKR is the primary source for everything the user has IBKR market data for, with Polygon as fallback only:

- **Bars** — IBKR historical bars merged with Polygon gap fill. Bars are tagged `ibkr-history` or `polygon-history` (no blanket source label).
- **News** — TWS does not expose the Client Portal `/iserver/news` feed through this bridge; `getNews` falls back to Polygon.
- **Universe search** — `searchUniverseTickers` calls `IbkrBridgeClient.searchTickers` first. The TWS bridge maps `getMatchingSymbols()` results to IBKR contract metadata, then falls back to Polygon when IBKR returns nothing.
- **Flow events** — derived from `IbkrBridgeClient.getOptionChain` snapshots, ranked by premium. Note: the IBKR option-chain mapper currently leaves `volume`/`openInterest` at 0; flow events synthesize size as `volume || 1` so contracts with a real `mark` still surface. To get true volume/OI, extend the snapshot field set in `client.ts` to include OPRA fields (e.g. 7762 = volume).
  - **Expiry parsing fix** — IBKR returns option expiries as compact YYYYMMDD strings (e.g. `"20260423"`). `lib/values.ts` `toDate()` now handles 8-digit string/integer inputs as calendar dates *before* the numeric-milliseconds branch. Previously every option contract resolved to `1970-01-01T05:37:40Z`, which collapsed flow event IDs and broke UI dedupe.
- **Bridge surface** — endpoints `GET /news` and `GET /universe/search` live on the IBKR bridge (`artifacts/ibkr-bridge/src/app.ts`). `GET /news` returns empty in TWS mode by design; `GET /universe/search` is backed by TWS contract search.

## Server log noise (dev workflow)

The API server and Windows-side IBKR bridge use `pino-http` with a shared
`customLogLevel` policy in `artifacts/api-server/src/app.ts` and
`artifacts/ibkr-bridge/src/app.ts`:

- 5xx → `error`, 4xx → `warn`
- any request with `responseTime >= 1000ms` → `warn` (preserves the
  bridge-overloaded signal even when the base level is `warn`)
- `GET /healthz*` under 1s → `silent`
- everything else → `info`

`responseTime` is computed from a `req._startTime` we stamp in a tiny
middleware ahead of `pinoHttp`, because `pino-http@10.5.0` does not
expose `res.responseTime` to `customLogLevel` (and `autoLogging.ignore`
fires at request start, before status/duration are known).

The API artifact pins dev logging to warn-level via the `LOG_LEVEL=warn`
prefix on the `[services.development] run` line in
`artifacts/api-server/.replit-artifact/artifact.toml`
(`LOG_LEVEL=warn pnpm --filter @workspace/api-server run dev`).

To temporarily restore verbose per-request logging while debugging, drop
the `LOG_LEVEL=warn` prefix in that artifact.toml and restart the
`artifacts/api-server: API Server` workflow. Production is unaffected: it runs
raw JSON pino without `pino-pretty` and the `[services.production.run.env]`
block does not set `LOG_LEVEL`. Bridge verbosity is controlled by the Windows
activation helper environment, not by a Replit workflow.

## Dev servers: single instance per app run

The root Replit app run should own exactly one listener on each pinned Replit
dev port: API on `8080` and rayalgo on `18747`. Older restarts could leave an
orphan node process holding the port, causing the next API start to fail with
`EADDRINUSE` or vite to bind a fallback port the preview proxy never used.
Three fixes prevent the recurrence:

1. **Shared port reaper** in `scripts/reap-dev-port.mjs`, run by both
   `artifacts/api-server/package.json` and `artifacts/rayalgo/package.json`
   before their dev servers start. It scans `/proc/net/tcp[6]` for the requested
   `PORT` and reaps the owning PID directly; stale pid files are not trusted.
2. **`strictPort: true`** on both `server` and `preview` blocks of
   `artifacts/rayalgo/vite.config.ts` so vite exits with an error instead of
   silently falling back to the next port.
3. **`exec` in the dev scripts** so SIGTERM from a workflow restart propagates
   through the `pnpm` wrapper to the actual node process. Applied to both
   `artifacts/rayalgo/package.json` (`exec vite ...`) and
   `artifacts/api-server/package.json` (`exec node ... dist/index.mjs` in both
   `dev` and `start`). The root `scripts/run-replit-dev.sh` also forwards
   termination to both `pnpm` children so the app run stops as one unit.

If a workflow restart still fails with `EADDRINUSE`, run the shared reaper for
the conflicting pinned port and restart the affected workflow:

```bash
PORT=8080 node scripts/reap-dev-port.mjs    # API
PORT=18747 node scripts/reap-dev-port.mjs   # rayalgo preview
```

`fuser` is unavailable on this NixOS image, and `ps`/`pgrep` may be unavailable
depending on the shell environment. If the reaper cannot identify the PID, check
`/proc/net/tcp[6]` directly (look for `:HEX_PORT` where HEX =
`printf '%04X' PORT`).

### `ensurePreviewReachable` removed from rayalgo

`artifacts/rayalgo/.replit-artifact/artifact.toml` no longer sets
`ensurePreviewReachable = "/"`. With that directive in place the Replit preview
proxy was health-polling `/` and re-mounting the iframe whenever a probe
hiccupped (bundling stalls during HMR, slow chunk transforms, etc.), which
manifested in the browser console as a `[vite] connecting... → connected`
pair and a fresh `[rayalgo] localStorage audit` mount log roughly every three
seconds — i.e. ~20 full page reloads/minute that froze the IDE/Chrome. The
canonical `react-vite` artifact template (`.local/skills/artifacts/artifacts/react-vite/artifact.yaml`)
does not include the directive; rayalgo now matches. If preview reachability
gating is ever needed again, prefer raising the proxy's tolerance over
re-introducing a tight health probe.

The Windows-side `ibkr-bridge` runs as a direct `node ... dist/index.mjs` (no
pnpm wrapper) and currently has no `SIGTERM` handler, so restarting it during a
long in-flight request (e.g. 30-60s `/options/chains` calls) can leave the
previous process alive past the helper's restart timeout. Adding an explicit
shutdown handler that calls `server.close()` and `process.exit()` is a known
follow-up.

## Snapshot quote pipeline (gray-screen fix)

Legacy Client Portal snapshots streamed *partial* field updates per WebSocket tick and
prefixes some prices with marker letters (`C`, `H`, `B`, `@`). Three coupled
fixes were required so `/api/quotes/snapshot` returns real data instead of zeros:

1. **`asNumber` (`artifacts/api-server/src/lib/values.ts`)** — strips leading
   non-numeric prefix chars before parsing, so `"C709.47"` → `709.47`.
2. **Field set expansion** — both the WebSocket subscribe in
   `artifacts/ibkr-bridge/src/market-data-stream.ts` and the parser/snapshot
   request fields in `artifacts/api-server/src/providers/ibkr/client.ts` now
   include `70` (high), `71` (low), `82`/`83` (change/change%), `87`/`87_raw`/
   `7762` (volume), `7295` (open), `7296`/`7741` (prev close).
3. **Per-conid payload merging** — `IbkrMarketDataStream.handleMessage` now
   merges incoming `smd+` records into a `rawPayloadsByConid` map and re-parses
   the merged payload, so accumulated state (high/low/open/prevClose/volume)
   survives subsequent ticks that only carry bid/ask/last deltas.
4. **Price fallback** — `parseSnapshotQuote` falls back to bid/ask midpoint
   (then ask, then bid) when field 31 (last) is 0 or missing, which is common on
   paper accounts and for tickers without recent prints in the snapshot window.
   Change/change% prefer IBKR-supplied fields 82/83 before computing from
   prevClose.

## Bloomberg live dock — Chrome unresponsiveness fix (2026-04-24)

`features/platform/BloombergLiveDock.jsx` shipped on commit `c0548d6`
mounting unconditionally with `useState(true)`, which auto-imported
`hls.js`, autoplayed the Bloomberg HD HLS source, and held a 300-second
DVR buffer in RAM. Within 30–60 minutes the trading-terminal tab OOMed
and Chrome flagged it unresponsive.

Surgical fix (Task #35) — three edits, frontend-only:

- `useState(true)` → `useState(false)` on the dock's `isOpen` (line 562).
  The component already had a `!isOpen` early-return rendering a small
  launcher pill, and `playbackSessionEnabled = isOpen` already gated the
  HLS init `useEffect`. So the entire HLS pipeline (hls.js import, video
  element wiring, timers, DVR buffer) is dormant until the user clicks
  the launcher.
- `BLOOMBERG_DVR_BUFFER_SECONDS = 300` → `30`. Same constant feeds the
  Hls config as `maxBufferLength` / `maxMaxBufferLength` /
  `backBufferLength`, cutting peak resident video data ~10× while
  retaining enough buffer for jitter and short rewind.
- New `useEffect` keyed on `[pageVisible, playbackSessionEnabled,
  reloadKey]` calls `hls.stopLoad()` + `video.pause()` when the tab
  hides and `hls.startLoad(-1)` when it comes back, so a forgotten-open
  dock can't keep filling buffer in a background tab.

Notes:

- The five "leaking" stores (`marketFlowStore`, `tradeFlowStore`,
  `signalMonitorStore`, `tradeOptionChainStore`, `marketAlertsStore`)
  were a misdiagnosis on closer inspection: each `publish*` REPLACES
  the snapshot, it doesn't append, so they're bounded by the number
  of distinct keys (tickers / symbol-set combos) the user touches.
  No caps are required.
- The "BRIDGE CP · ERROR" 502 waterfall in api-server logs is the
  user's stale cloudflared tunnel — a Windows-side action, not a
  code change. No retry-backoff was added because it would mask the
  real signal.

## Module-level cache caps (2026-04-24)

Three module-level Maps that previously grew without bound (one entry per
distinct symbol/contract/ticker the user ever touched in a session) are
now bounded LRU caches. Without these caps a long session of browsing
tickers, option chains, and research panels could grow tens of MB of
JS heap purely in caches that React Query never sees.

- `features/charting/useMassiveStockAggregateStream.ts` —
  `minuteCacheBySymbol` capped at `MAX_SYMBOLS_IN_MINUTE_CACHE = 64`.
  On each `recordAggregate`, the symbol is `delete`-then-`set` to move
  it to most-recently-used; once the outer map exceeds the cap, the
  oldest symbol that has **no active store listeners** is evicted
  (active subscriptions are never dropped, so visible charts can't be
  yanked out from under React).
- `features/research/lib/researchApi.js` — `histCache`, `fundCache`,
  `financialsCache`, `secFilingsCache`, `transcriptsCache` each capped
  via a shared `setLruEntry(cache, key, value, maxSize)` helper at
  `RESEARCH_CACHE_MAX_ENTRIES = 64`. Same delete-then-set LRU promotion;
  these caches don't track listeners, so the oldest entry is evicted
  unconditionally on overflow.
- `features/platform/live-streams.ts` —
  `optionQuoteSnapshotsByProviderContractId` capped at
  `MAX_OPTION_QUOTE_SNAPSHOTS = 1_024`. Listener-aware eviction (same
  pattern as `minuteCacheBySymbol`) — option contracts a component is
  still subscribed to are never evicted; `optionQuoteStoreVersions` is
  kept in sync on eviction.

Per-symbol bounds remain unchanged (e.g. minute-bar inner cap stays
`MAX_MINUTE_AGGREGATES_PER_SYMBOL = 2_048` — about 1.5 trading days of
1m bars per symbol). The new caps only affect the *outer* dimension of
how many distinct keys live in the Map at once.
