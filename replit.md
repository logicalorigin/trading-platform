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

- `pnpm run dev` — canonical Replit workspace run command; starts API, RayAlgo, and the backtest worker together
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally
- `pnpm --filter @workspace/backtest-worker run dev` — run the background backtest worker locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.

## Artifacts

- **rayalgo** (`artifacts/rayalgo`, `/`) — RayAlgo Platform. React + Vite + Recharts + D3 trading terminal imported from external project. Single ~5300-line component (`src/RayAlgoPlatform.jsx`) containing six screens: Market, Flow, Trade, Research, Algo, Backtest. Uses inline styles only; `index.css` is intentionally minimal (no Tailwind theme tokens) and `App.tsx` simply renders `<RayAlgoPlatform />`. The `components/ui/` directory only retains `dropdown-menu.tsx` and `popover.tsx` (the only shadcn wrappers actually imported); the rest of the shadcn library plus its dependencies (radix-*, sonner, vaul, wouter, cmdk, framer-motion, react-hook-form, date-fns, etc.) were removed in the dependency cleanup pass.
- **api-server** (`artifacts/api-server`) — Express API serving research, trading, market data, and the new backtesting routes.
- **backtest-worker** (`artifacts/backtest-worker`) — background job worker that claims queued backtest jobs, hydrates/caches datasets, runs studies and sweeps, and promotes persistent run artifacts into the database.
- **ibkr-bridge** (`artifacts/ibkr-bridge`) — small HTTP service that fronts the user's local Interactive Brokers Client Portal Gateway (CPG). Built into `dist/index.mjs`; runs on port 3002 via the "IBKR Bridge" workflow. The api-server's `IbkrBridgeClient` calls it for accounts, positions, bars, quotes, market depth, and orders. All Date-typed fields are deserialized at the bridge-client boundary in `artifacts/api-server/src/providers/ibkr/bridge-client.ts` (HTTP JSON only carries strings).

## IBKR Live Data Setup (User-Side)

The IBKR feed depends on three processes running on the user's Windows machine, plus a tunnel into Replit. If charts/quotes go quiet, work through this in order.

### Required env (already set in Replit Secrets)

- `IBKR_TRANSPORT=client_portal`
- `IBKR_BASE_URL=https://ibkr.<userdomain>/v1/api` (stable named-tunnel hostname; see below)
- `IBKR_BRIDGE_URL=http://127.0.0.1:3002`
- `IBKR_ALLOW_INSECURE_TLS=true` (CPG uses a self-signed cert)

### Tunnel: named cloudflared tunnel (recommended)

Quick tunnels (`cloudflared tunnel --url ...`) mint a fresh `*.trycloudflare.com` hostname every restart, which forces `IBKR_BASE_URL` to be re-edited in Replit Secrets every session. A **named tunnel** bound to the user's Cloudflare account gives a stable hostname (e.g. `ibkr.<userdomain>`) that survives restarts, machine reboots, and cloudflared upgrades — set the secret once and forget it.

One-time setup on the Windows machine (requires a Cloudflare account with a zone you control):

1. `cloudflared tunnel login` — opens a browser, pick the zone (`<userdomain>`).
2. `cloudflared tunnel create ibkr` — creates the tunnel and writes credentials to `%USERPROFILE%\.cloudflared\<TUNNEL-UUID>.json`.
3. `cloudflared tunnel route dns ibkr ibkr.<userdomain>` — creates the public DNS CNAME.
4. Create `%USERPROFILE%\.cloudflared\config.yml`:
   ```yaml
   tunnel: ibkr
   credentials-file: C:\Users\<you>\.cloudflared\<TUNNEL-UUID>.json
   originRequest:
     noTLSVerify: true
   ingress:
     - hostname: ibkr.<userdomain>
       service: https://localhost:5000
     - service: http_status:404
   ```
5. Set `IBKR_BASE_URL=https://ibkr.<userdomain>/v1/api` in Replit Secrets — once.

### Three windows on Windows

1. **CPG (PowerShell #1)** — `cd $env:USERPROFILE\clientportal.gw; bin\run.bat root\conf.yaml`. Listens on `https://localhost:5000`. Requires OpenJDK 21.
2. **cloudflared (PowerShell #2)** — `cloudflared tunnel run ibkr`. Uses the named tunnel + `config.yml` above; the public hostname stays `ibkr.<userdomain>` across restarts.
   - **Fallback (no Cloudflare account)**: `cloudflared tunnel --url https://localhost:5000 --no-tls-verify` still works, but prints a fresh `*.trycloudflare.com` URL each run that has to be pasted into `IBKR_BASE_URL` (with `/v1/api` appended) every session.
3. **Browser tab** — `https://localhost:5000` for login. Click through the cert warning.

When a session-start script is added (see follow-up "one-click launch on Windows"), it should invoke `cloudflared tunnel run ibkr` (named tunnel by name), **not** `cloudflared tunnel --url ...`, so `IBKR_BASE_URL` never has to be touched.

### One-click launcher (`scripts/windows/start-ibkr.ps1`)

Instead of opening windows #1 and #2 by hand, just run the launcher:

- **Double-click** `scripts\windows\start-ibkr.cmd`, **or**
- **From PowerShell**: `powershell -ExecutionPolicy Bypass -File scripts\windows\start-ibkr.ps1`

What it does:

1. Opens CPG in its own PowerShell window (`%USERPROFILE%\clientportal.gw\bin\run.bat root\conf.yaml`).
2. Opens `cloudflared tunnel --url https://localhost:5000 --no-tls-verify` in another window and tees its output to `%TEMP%\rayalgo-ibkr\cloudflared-<timestamp>.log`.
3. Watches the log for the `*.trycloudflare.com` hostname and prints a big banner with the fully formatted `IBKR_BASE_URL` (already includes `/v1/api`). The value is copied to the clipboard when possible.

Only manual step left: paste that `IBKR_BASE_URL` into Replit Secrets, then complete the browser login at `https://localhost:5000`. Override defaults with `-CpgPath`, `-CloudflaredExe`, or `-TunnelTimeoutSeconds` if your install differs.

### The IBKR 2FA trick that actually works

The default "push notification to IBKR Mobile" flow **silently fails** with CPG. Use challenge/response instead:

1. In the browser at `https://localhost:5000`, enter username + password and click Login. Page sits "waiting for authentication" — leave it.
2. Open IBKR Mobile → menu → **"Authenticate"** (NOT a push notification — an actual menu item, sometimes labeled "Two-Factor Authentication" or "Generate Response").
3. The browser will offer a **"Get Challenge String"** link/button. Click it; a 6–8 digit code appears.
4. Type that code into the IBKR Mobile app. The app returns a response code.
5. Type the response code back into the browser. You should see "Client login succeeds".

CPG sessions silently expire roughly every 24h. Re-running the challenge/response above is enough; the bridge auto-recovers.

### Verifying the chain from Replit

```
curl -sS -X POST https://<tunnel>/v1/api/iserver/auth/status   # expect authenticated:true
curl -sS http://127.0.0.1:3002/accounts                         # expect real account data
curl -sS "http://127.0.0.1:8080/api/bars?symbol=AAPL&timeframe=1m&limit=2"  # expect HTTP 200
```

### Symbol quirks

- Polygon-style dotted tickers (`BRK.B`, `BF.B`) are translated to IBKR's space-separated form (`BRK B`) inside `resolveStockContract` in `artifacts/api-server/src/providers/ibkr/client.ts`. Add new mappings there if other symbol families fail.

## Data sourcing (IBKR-primary, Polygon-fallback)

`artifacts/api-server/src/services/platform.ts` is wired so IBKR is the primary source for everything the user has IBKR market data for, with Polygon as fallback only:

- **Bars** — IBKR historical bars merged with Polygon gap fill. Bars are tagged `ibkr-history` or `polygon-history` (no blanket source label).
- **News** — `getNews` calls `IbkrBridgeClient.getNews` first (`/iserver/news` keyed by conid). Falls back to Polygon when IBKR returns nothing (e.g. tickerless requests, since CP requires a conid).
- **Universe search** — `searchUniverseTickers` calls `IbkrBridgeClient.searchTickers` first (`/iserver/secdef/search`, filtered to STK). Falls back to Polygon for non-stock markets and on empty IBKR result.
- **Flow events** — derived from `IbkrBridgeClient.getOptionChain` snapshots, ranked by premium. Note: the IBKR option-chain mapper currently leaves `volume`/`openInterest` at 0; flow events synthesize size as `volume || 1` so contracts with a real `mark` still surface. To get true volume/OI, extend the snapshot field set in `client.ts` to include OPRA fields (e.g. 7762 = volume).
  - **Expiry parsing fix** — IBKR returns option expiries as compact YYYYMMDD strings (e.g. `"20260423"`). `lib/values.ts` `toDate()` now handles 8-digit string/integer inputs as calendar dates *before* the numeric-milliseconds branch. Previously every option contract resolved to `1970-01-01T05:37:40Z`, which collapsed flow event IDs and broke UI dedupe.
- **Bridge surface** — new endpoints `GET /news` and `GET /universe/search` on the IBKR bridge (`artifacts/ibkr-bridge/src/app.ts`). The TWS provider stubs both to empty arrays since the user's transport is Client Portal.

## Server log noise (dev workflow)

Both the API server and the IBKR Bridge use `pino-http` with a shared
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

The dev workflows pin `LOG_LEVEL=warn`:

- IBKR Bridge: prefix on the `.replit` workflow command
  (`PORT=3002 LOG_LEVEL=warn node ...`).
- API Server: prefix on the `[services.development] run` line in
  `artifacts/api-server/.replit-artifact/artifact.toml`
  (`LOG_LEVEL=warn pnpm --filter @workspace/api-server run dev`).

To temporarily restore verbose per-request logging while debugging, drop
the `LOG_LEVEL=warn` prefix in the relevant workflow command and restart
that workflow. Production is unaffected: it runs raw JSON pino without
`pino-pretty` and the `[services.production.run.env]` block does not set
`LOG_LEVEL`. Any change to `artifacts/ibkr-bridge/src/**` still requires
`pnpm --filter @workspace/ibkr-bridge run build` before restart since the
bridge runs the compiled `dist/index.mjs`.

## Vite dev server: single instance per workflow

The rayalgo workflow used to spawn duplicate vite processes that fought over
port `18747` (the port the Replit preview proxy is pinned to in
`artifacts/rayalgo/.replit-artifact/artifact.toml`). Symptoms: vite logged
`Port 18747 is in use, trying another one...` and bound `18748`, while the
preview pane kept hitting the stale orphan on `18747`. Two fixes prevent the
recurrence:

1. **`strictPort: true`** on both `server` and `preview` blocks of
   `artifacts/rayalgo/vite.config.ts` — vite now exits with an error instead of
   silently falling back to the next port. Failure becomes loud and visible.
2. **`exec` in the dev scripts** so SIGTERM from `restart_workflow` propagates
   through the `pnpm` wrapper to the actual node process. Applied to both
   `artifacts/rayalgo/package.json` (`exec vite ...`) and
   `artifacts/api-server/package.json` (`exec pnpm run start` and
   `exec node ... dist/index.mjs`). Without `exec`, the pnpm wrapper would
   intercept SIGTERM, leave the grandchild node process running as an orphan
   holding the port, and the next workflow start would EADDRINUSE-fail.

If a workflow restart still fails with `EADDRINUSE`, sweep orphans manually:

```bash
ps -eo pid,etime,cmd | grep -E "node.*(api-server|ibkr-bridge|vite|rayalgo)" | grep -v grep
kill -KILL <pids>
```

`fuser` is unavailable on this NixOS image; use `pkill -KILL -f <pattern>` or
check `/proc/net/tcp[6]` (look for `:HEX_PORT` where HEX = `printf '%04X' PORT`).

The `ibkr-bridge` runs as a direct `node ... dist/index.mjs` (no pnpm wrapper)
and currently has no `SIGTERM` handler, so a restart during a long in-flight
request (e.g. 30-60s `/options/chains` calls) can leave the previous process
alive past the workflow restart timeout. Adding an explicit shutdown handler
that calls `server.close()` and `process.exit()` is a known follow-up.

## Snapshot quote pipeline (gray-screen fix)

The IBKR Client Portal streams *partial* field updates per WebSocket tick and
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
