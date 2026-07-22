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

- Replit Run button — use the **PYRUS web** workflow (`artifacts/pyrus: web`) for full app bring-up.
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally
- `pnpm --filter @workspace/pyrus run dev` — run the PYRUS web app locally
- `pnpm --filter @workspace/backtest-worker run dev` — run the background backtest worker locally

Account/Flex persistence: if `/api/accounts/flex/health` reports `schemaReady: false`, the account UI falls back to live-only data and FLEX history/cache stays empty until the schema is pushed. Run `pnpm --filter @workspace/db run push`, then confirm `schemaReady: true` with an empty `missingTables` list.

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.

## Artifacts

- **pyrus** (`artifacts/pyrus`, `/`) — PYRUS Platform. React + Vite trading terminal; code split under `src/features`, `src/screens`, `src/components/platform`. Entry is `src/app/App.tsx`, which lazy-loads `src/features/platform/PlatformApp.jsx`. `components/ui/` retains only `dropdown-menu.tsx` and `popover.tsx`; the rest of shadcn and its deps were removed.
- **api-server** (`artifacts/api-server`) — Express API serving research, trading, market data, and backtesting routes.
- **backtest-worker** (`artifacts/backtest-worker`) — background worker that claims queued backtest jobs, hydrates/caches datasets, runs studies/sweeps, and promotes run artifacts into the DB.
- The legacy desktop IBKR bridge artifact has been retired. Do not add a separate bridge artifact, workflow, helper bundle, or Windows-side bridge runtime back into app startup.

## Replit startup

The Replit Run button starts the selected `artifacts/pyrus: web` artifact. Its
development command is declared in
`artifacts/pyrus/.replit-artifact/artifact.toml` and runs one foreground
app launcher for:

- API server on port `8080`
- Vite web server on port `18747`
- optional app workers when their configuration is present

Replit owns the outer workflow lifecycle. The app launcher only coordinates its
own child processes. Startup configuration is tracked in `.replit`,
`replit.nix`, and the artifact TOML. Canonical recovery snapshots live under
`scripts/replit-config/`; `pnpm run replit:config:restore` only compares them
unless an operator explicitly supplies `--write` during a startup-maintenance
window. The config lock and restore tools are recovery controls, not alternate
app runners.

Agents can run builds and checks directly. Runtime replacement goes through
Replit's native restart-run-workflow action for `artifacts/pyrus: web`, or the
workspace Run/Stop controls when that action is unavailable. Agents must never
signal the launcher or pid2 and must never shell-launch a competing app copy.
Vite handles frontend hot reload.

The development VM is a shared memory domain. Agents must serialize package
installs, broad builds/typechecks, repeated bundling, performance-capture
processing, and large file patches across every active session. Do not start a
memory-heavy action below 6 GiB `MemAvailable` or above 10 GiB cgroup
`memory.current`, do not launch nested `codex exec` sessions, and inspect large
generated captures by path/size/status rather than printing or patching them.

Publishing: `pnpm run build:pyrus-app` runs the fail-closed release guards and
builds the web app, API, and bounded IBKR session-host bundle. Production still
exposes one web service/port: the artifact runs
`artifacts/pyrus/scripts/runProductionApp.mjs`, which owns the API process and
optionally starts the signed session host on loopback. The host and fleet path
remain disabled unless explicitly configured; the retired IBKR desktop bridge
bundle is not part of build or deploy output.

The stateful IBKR fleet requires an always-on Reserved VM selected and verified
in Replit's Publishing tool. Repository configuration alone does not prove that
deployment choice or the production Docker daemon/capabilities required by the
capsule preflight.

## IBKR Broker Connectivity

### Hosted user path

Interactive Brokers uses one connection architecture: the per-user Client
Portal gateway exposed through `/api/broker-execution/ibkr-portal/*`. Connect
starts or claims a supervised paper-session capsule, opens the isolated login
viewer, and keeps the resulting broker session server-side. PYRUS does not ask
for or receive the user's IBKR password or two-factor code.

The session host and fleet remain disabled until their signed control-plane,
host identity, capsule image, and capacity configuration are present. The
required variables and safe defaults are documented in `.env.example`.

The retired desktop helper, tunnel, runtime-override file, and browser
credential handoff are removed. Do not restore bridge URL/token variables,
launcher routes, helper bundles, or a second IBKR connection workflow.

### App-owned Client Portal fallback

Internal development may point the same Client Portal client at an app-owned
gateway with `IBKR_CLIENT_PORTAL_BASE_URL` or `IBKR_BASE_URL`. Optional
cookie/bearer/account configuration remains Client Portal configuration; it is
not a separate bridge architecture.

Keep non-URL secrets/config as needed:
- Optional account pin `IBKR_ACCOUNT_ID=<live-account-id>`.
- Optional caps `IBKR_MAX_LIVE_EQUITY_LINES=80`, `IBKR_MAX_LIVE_OPTION_LINES=20`.
- Flex secrets `IBKR_FLEX_TOKEN` / `IBKR_FLEX_QUERY_ID` (unrelated to Client Portal; do not remove).

Flex XML is a transient, in-memory parsing input. Never persist the full
statement or reference response. Store only the normalized account records and
bounded run metadata; migration
`lib/db/migrations/20260720_purge_flex_report_raw_xml.sql` removes the retired
payload column and clears existing values.

### Symbol quirks

- Polygon-style dotted tickers (`BRK.B`, `BF.B`) are translated to IBKR's space-separated form (`BRK B`) inside `resolveStockContract` in `artifacts/api-server/src/providers/ibkr/client.ts`. Add new mappings there if other symbol families fail.

## Data sourcing

`artifacts/api-server/src/services/platform.ts` uses app-owned market-data providers and broker clients:

- **Accounts/orders** — authenticated requests resolve through the user's
  supervised Client Portal gateway; internal development can use the same
  client against an explicitly configured app-owned gateway.
- **Bars/quotes/scanners** — Massive/cache first where configured; IBKR Client Portal can fill broker-specific gaps when configured.
- **News/search/flow events** — use app-owned provider clients; do not
  reintroduce the deleted desktop bridge artifact.
  - **Expiry parsing** — IBKR returns expiries as compact `YYYYMMDD` strings. `toDate()` in `artifacts/api-server/src/lib/values.ts` handles 8-digit inputs as calendar dates *before* the numeric-ms branch (otherwise every contract collapsed to `1970-01-01`, breaking flow-event IDs/dedupe).
- **Retired bridge surface** — the desktop helper/tunnel lifecycle, persisted
  runtime override, and browser credential-handoff modules are absent. The
  release startup guard rejects their reintroduction.

## Snapshot quote pipeline (gray-screen fix)

TWS snapshots stream *partial* field updates per tick and prefix some prices with marker letters (`C`, `H`, `B`, `@`). For `/api/quotes/snapshot` to return real data:

1. `asNumber` (`artifacts/api-server/src/lib/values.ts`) strips leading non-numeric prefixes (`"C709.47"` → `709.47`).
2. Field set includes `70`/`71` (high/low), `82`/`83` (change/%), `87`/`87_raw`/`7762` (volume), `7295` (open), `7296`/`7741` (prev close) in both `tws-provider.ts` and `client.ts`.
3. `IbkrMarketDataStream.handleMessage` merges `smd+` records per conid into `rawPayloadsByConid` and re-parses, so accumulated high/low/open/prevClose/volume survives delta-only ticks.
4. `parseSnapshotQuote` falls back to bid/ask midpoint (then ask, then bid) when field 31 (last) is 0/missing; change/% prefer IBKR fields 82/83 before computing from prevClose.

## Server log noise (dev server)

The API server uses a `pino-http` `customLogLevel` policy (`artifacts/api-server/src/app.ts`): 5xx → `error`; 4xx → `warn`; any request `>=1000ms` → `warn`; `GET /healthz*` under 1s → `silent`; else `info`. `responseTime` is computed from a `req._startTime` middleware ahead of `pinoHttp` (pino-http 10.5.0 doesn't expose `res.responseTime` to `customLogLevel`). The dev launcher defaults API logging to warn-level; change its `LOG_LEVEL` environment value and restart the managed workflow for verbose request logging.

## Managed Postgres by default

Replit's managed Postgres is the normal dev DB. Config resolution order: `LOCAL_DATABASE_URL` only when `PYRUS_DATABASE_SOURCE=local`; Replit's `PG*` env when a stale workspace-local socket `DATABASE_URL` is also present; otherwise `DATABASE_URL`, then `PG*` (`PGHOST`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`, `PGPORT`). This keeps **Run Replit App** self-contained without starting Postgres in the API workflow cgroup.

Workspace-local Postgres scripts remain only as fallback/diagnostic tools: `scripts/start-local-postgres.sh` and `scripts/wait-for-local-postgres.sh`.

If an API-side `pg` disconnect (`Connection terminated unexpectedly`) coincides with a Replit VM replacement, treat the replacement as platform context and the unhandled disconnect as the app-level hardening target.

## Historical fix notes

- **Bloomberg live dock** (`features/platform/BloombergLiveDock.jsx`) — originally mounted open with autoplaying HLS and a 300s DVR buffer, OOMing the tab in 30–60 min. Now defaults closed (`isOpen` starts `false`; the HLS pipeline is gated on `playbackSessionEnabled = isOpen`), DVR buffer cut to 30s, and a visibility `useEffect` calls `hls.stopLoad()`/`pause()` when the tab hides. Note: the five market/flow/signal stores are NOT leaks — each `publish*` replaces (not appends) its snapshot, bounded by distinct keys.
- **Module-level cache caps** — three previously-unbounded module Maps are now bounded LRU: `minuteCacheBySymbol` (`useMassiveStockAggregateStream.ts`, cap 64, listener-aware eviction), the research caches in `researchApi.js` (cap 64 each via `setLruEntry`), and `optionQuoteSnapshotsByProviderContractId` (`live-streams.ts`, cap 1024, listener-aware). Per-symbol inner bounds are unchanged.
