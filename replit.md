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

## Replit Run & startup invariants

The tracked `.replit` has **no** root `run = [...]` and **no** repo-defined `[[workflows.workflow]]` tasks. It keeps `[workflows] runButton = "artifacts/pyrus: web"` and `[agent] stack = "PNPM_WORKSPACE"` so the Run button targets the PYRUS web workflow and Replit discovers the artifact. Ignore Replit's generated **Configure Your App** option for startup.

The app starts from the PYRUS artifact's `.replit-artifact/artifact.toml` `[services.development] run` = `pnpm --filter @workspace/pyrus run dev:replit` (tags startup with `PYRUS_REPLIT_RUN=1`). That supervisor owns BOTH dev servers:

- API Server — `LOG_LEVEL=warn pnpm --filter @workspace/api-server run dev` on port `8080`.
- PYRUS Platform — `pnpm --filter @workspace/pyrus run dev:web` on port `18747`.

The API dev script does not start Postgres; it uses Replit's managed DB by default (even if a stale workspace-local socket `DATABASE_URL` is present). The IBKR launcher calls `/api/ibkr/bridge/launcher`, so the API must already be up before activation; an unreachable launcher route is a startup issue, not a reason to add a workflow.

**Invariants — do not violate during routine work:**
- Do not add repo-tracked `[[workflows.workflow]]` tasks, a root `run`, or a root workflow coordinator.
- Do not add a separate API artifact service or a third root runner — competing owners for ports `8080`/`18747` caused prior reaper conflicts. The PYRUS supervisor owns both.
- Do not add a separate Replit `IBKR Bridge` workflow or any replacement desktop bridge runner. Broker connectivity is app-owned.
- `PYRUS_REPLIT_RUN=1` is a tag only, not restart authority. **RETIRED (2026-07-09):** shell-launching `REPLIT_MODE=workflow pnpm --filter @workspace/pyrus run dev:replit` to restart/reload the app is NO LONGER sanctioned — it replaces the pid2-tracked supervisor, detaches the user's Replit preview, and produced the `same-container-supervisor-abrupt` kill-storm. **Sanctioned reload = SIGUSR2 to the LIVE pid2-owned supervisor** (`kill -USR2 "$(pgrep -f 'runDevApp[.]mjs' | head -1)"`): it rebuilds + restarts the API child IN PLACE while the supervisor and preview stay attached (no `143`/SIGTERM churn, no competing supervisor). Confirm with `http://127.0.0.1:8080/api/healthz` → 200 and verify the SAME supervisor pid is still alive; frontend (Vite) changes hot-reload on their own. If the app is fully stopped (no supervisor at all), only the user's Replit Run button (**artifacts/pyrus: web**) can bootstrap it — pid2 must spawn the tracked workflow. See CLAUDE.md "Project Run Rules" and AGENTS.md.
- The PYRUS artifact TOML is the source of truth for dev/deploy service metadata.
- `pnpm run audit:replit-startup` guards these invariants.

Publishing: `pnpm run build:pyrus-app` builds the web app and API only. The retired IBKR desktop bridge bundle is not part of build or deploy output.

## IBKR Broker Connectivity

### Hosted user path

For normal hosted PYRUS users, do not require TWS, IB Gateway, Client Portal Gateway, cloudflared, or a local connector. The user-facing IBKR path is the broker-hosted OAuth candidate exposed through `/api/broker-execution/ibkr/oauth/readiness`; it remains blocked until IBKR third-party approval, OAuth implementation, and account capability fixtures are complete.

Configure OAuth application placeholders with `IBKR_OAUTH_CONSUMER_KEY`, `IBKR_OAUTH_SIGNING_KEY` or `IBKR_OAUTH_PRIVATE_KEY`, `IBKR_OAUTH_CALLBACK_URL`, and `IBKR_OAUTH_THIRD_PARTY_APPROVED=true` only after approval is recorded. These values must never be returned to the browser.

SnapTrade is the hosted broker-aggregation setup path. The server owns `SNAPTRADE_CLIENTID` and `SNAPTRADE_API_KEY`; each authenticated PYRUS user registers through `POST /api/broker-execution/snaptrade/users/current`, which stores the returned SnapTrade `userSecret` encrypted with `PYRUS_CREDENTIAL_ENCRYPTION_KEY`. The app then generates a short-lived Connection Portal URL through `POST /api/broker-execution/snaptrade/connection-portal`. The portal route requests `trade-if-available` by default but must not be treated as live-trading eligible until brokerage-specific capability fixtures prove positions, orders, fills, cancel/replace, and option support.

### Client Portal special connector

IBKR account and order routes can still use the app-owned Client Portal runtime for internal/dev or explicitly approved special-connector use. Configure the API with `IBKR_CLIENT_PORTAL_BASE_URL` or `IBKR_BASE_URL`; optional auth/account values are `IBKR_COOKIE`, `IBKR_BEARER_TOKEN`, `IBKR_ACCOUNT_ID`, and `IBKR_EXT_OPERATOR`.

Delete stale desktop bridge secrets if present: `IBKR_BRIDGE_URL`, `IBKR_BRIDGE_BASE_URL`, `IBKR_BRIDGE_RUNTIME_OVERRIDE_FILE`, and `PYRUS_IBKR_BRIDGE_RUNTIME_OVERRIDE_FILE`.

Keep non-URL secrets/config as needed:
- Optional account pin `IBKR_ACCOUNT_ID=<live-account-id>`.
- Optional caps `IBKR_MAX_LIVE_EQUITY_LINES=80`, `IBKR_MAX_LIVE_OPTION_LINES=20`.
- Flex secrets `IBKR_FLEX_TOKEN` / `IBKR_FLEX_QUERY_ID` (unrelated to Client Portal; do not remove).

### Windows side

No PYRUS Windows bridge helper is required. Hosted users must not be asked to install local IBKR software. For internal Client Portal special-connector use, a manually authenticated Client Portal Gateway may still be used outside the default customer path.

### Verifying the chain from Replit

```
curl -sS "http://127.0.0.1:8080/api/bars?symbol=AAPL&timeframe=1m&limit=2"  # expect HTTP 200
```

### Symbol quirks

- Polygon-style dotted tickers (`BRK.B`, `BF.B`) are translated to IBKR's space-separated form (`BRK B`) inside `resolveStockContract` in `artifacts/api-server/src/providers/ibkr/client.ts`. Add new mappings there if other symbol families fail.

## Data sourcing

`artifacts/api-server/src/services/platform.ts` uses app-owned market-data providers and broker clients:

- **Accounts/orders** — hosted user path is broker-hosted OAuth/SnapTrade-style per-user connections; IBKR Client Portal remains an app-owned special connector for internal/dev use.
- **Bars/quotes/scanners** — Massive/cache first where configured; IBKR Client Portal can fill broker-specific gaps when configured.
- **News/search/flow events** — use app-owned provider clients; do not reintroduce the deleted desktop bridge artifact.
  - **Expiry parsing** — IBKR returns expiries as compact `YYYYMMDD` strings. `toDate()` in `artifacts/api-server/src/lib/values.ts` handles 8-digit inputs as calendar dates *before* the numeric-ms branch (otherwise every contract collapsed to `1970-01-01`, breaking flow-event IDs/dedupe).
- **Retired bridge surface** — legacy `/api/ibkr/desktop/*`, `/api/ibkr/bridge/*`, `/api/ibkr/activation/*`, and `/api/ibkr/remote-*` routes may remain as API tombstones so stale helpers can self-remove, but they are not app dependencies.

## Snapshot quote pipeline (gray-screen fix)

TWS snapshots stream *partial* field updates per tick and prefix some prices with marker letters (`C`, `H`, `B`, `@`). For `/api/quotes/snapshot` to return real data:

1. `asNumber` (`artifacts/api-server/src/lib/values.ts`) strips leading non-numeric prefixes (`"C709.47"` → `709.47`).
2. Field set includes `70`/`71` (high/low), `82`/`83` (change/%), `87`/`87_raw`/`7762` (volume), `7295` (open), `7296`/`7741` (prev close) in both `tws-provider.ts` and `client.ts`.
3. `IbkrMarketDataStream.handleMessage` merges `smd+` records per conid into `rawPayloadsByConid` and re-parses, so accumulated high/low/open/prevClose/volume survives delta-only ticks.
4. `parseSnapshotQuote` falls back to bid/ask midpoint (then ask, then bid) when field 31 (last) is 0/missing; change/% prefer IBKR fields 82/83 before computing from prevClose.

## Server log noise (dev server)

The API server uses a `pino-http` `customLogLevel` policy (`artifacts/api-server/src/app.ts`): 5xx → `error`; 4xx → `warn`; any request `>=1000ms` → `warn`; `GET /healthz*` under 1s → `silent`; else `info`. `responseTime` is computed from a `req._startTime` middleware ahead of `pinoHttp` (pino-http 10.5.0 doesn't expose `res.responseTime` to `customLogLevel`). The dev supervisor pins API logging to warn-level via `LOG_LEVEL=warn`. To restore verbose per-request logging while debugging, drop that env override in `artifacts/pyrus/scripts/runDevApp.mjs` and restart the PYRUS web workflow (production is unaffected).

## Managed Postgres by default

Replit's managed Postgres is the normal dev DB. Config resolution order: `LOCAL_DATABASE_URL` only when `PYRUS_DATABASE_SOURCE=local`; Replit's `PG*` env when a stale workspace-local socket `DATABASE_URL` is also present; otherwise `DATABASE_URL`, then `PG*` (`PGHOST`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`, `PGPORT`). This keeps **Run Replit App** self-contained without starting Postgres in the API workflow cgroup.

Workspace-local Postgres scripts remain only as fallback/diagnostic tools: `scripts/start-local-postgres.sh`, `scripts/wait-for-local-postgres.sh`, `scripts/run-local-postgres.sh`.

If an API-side `pg` disconnect (`Connection terminated unexpectedly`) coincides with a `container-replaced` classification, treat the container replacement as platform context and the unhandled `pg` disconnect as the app-level hardening target. Do not add Replit workflows, local Postgres startup, or root runners for this class of incident.

## Restart / reconnect diagnosis

Start with `pnpm run diagnose:agent-restarts` (and `pnpm run diagnose:replit-restarts`). Both are observe-only: they correlate PYRUS flight-recorder incidents (`.pyrus-runtime/flight-recorder/`), Replit runtime file mtimes, workflow log tails, and surviving Codex session/log records. If a host-side trigger is not recorded inside the guest, the report says so rather than guessing. See `.agents/memory/replit-reconnect-diagnosis.md` for what each signal (DB-token reissue, `container-replaced` vs same-container bounce, agent log survival) does and does not prove.

## Dev servers: single owner for API and web

The PYRUS web workflow owns both dev listeners (API `8080`, pyrus `18747`). Three fixes prevent orphaned-port / `EADDRINUSE` recurrences:

1. **Shared port reaper** (`scripts/reap-dev-port.mjs`), run by both packages before their dev servers start; it scans `/proc/net/tcp[6]` for `PORT` and reaps the owning PID (stale pid files are not trusted).
2. **`strictPort: true`** on both `server` and `preview` in `artifacts/pyrus/vite.config.ts` so vite errors instead of silently falling back.
3. **Process-group supervision** in `artifacts/pyrus/scripts/runDevApp.mjs` plus `exec` in child dev scripts, so workflow SIGTERM stops both API and Vite.

Duplicate-start handling: a Replit-owned workflow start that finds an existing live PYRUS supervisor is treated as an intentional Run-button restart immediately. It requests a controlled handoff so the new workflow becomes sole owner instead of exiting as a duplicate no-op. Use `PYRUS_DEV_FORCE_RESTART=1` only for explicit recovery; `PYRUS_DEV_DUPLICATE_CHECK_ONLY=1` for shell smoke tests of the duplicate detection path. The supervisor writes lifecycle evidence to `/tmp/pyrus/pyrus-dev-lifecycle-8080.jsonl` (heartbeats, child starts/exits, controlled handoffs, ignored SIGHUP, shutdowns) to distinguish clean shutdowns from external Replit stops.

`reap-dev-port.mjs` is **cgroup-aware**: it reads `/proc/<pid>/cgroup` for itself and each holder. From a normal shell it **refuses to kill** a holder in a different cgroup (protects the live workflow when you run `pnpm ... dev` from a shell). Under `REPLIT_MODE=workflow` it may reclaim the pinned port from a different Replit execution scope. To intentionally restart the live API/web service, use the workflow restart action, not `pnpm dev` from a shell.

`EADDRINUSE` recovery:
```bash
PORT=8080 node scripts/reap-dev-port.mjs    # API
PORT=18747 node scripts/reap-dev-port.mjs   # pyrus preview
```
`fuser` is unavailable on this NixOS image, and `ps`/`pgrep` may be too; if the reaper can't identify the PID, check `/proc/net/tcp[6]` directly (`:HEX_PORT`, HEX = `printf '%04X' PORT`).

browser QA must attach to the existing app inside Replit: `artifacts/pyrus/browser QA.config.ts` disables its `webServer` block when Replit env markers are present. Set `PYRUS_BROWSER_QA_ALLOW_WEB_SERVER=1` only for an intentional maintenance run.

`ensurePreviewReachable` is intentionally removed from the PYRUS artifact TOML — its health-poll of `/` re-mounted the iframe on probe hiccups (HMR stalls), causing ~20 reloads/min. If preview gating is ever needed again, raise the proxy's tolerance rather than re-adding a tight health probe.

Known follow-up: the Windows `ibkr-bridge` (`node dist/index.mjs`, no pnpm wrapper) has no `SIGTERM` handler, so restarting it during a long in-flight request can leave the old process alive past the helper's restart timeout. Add a shutdown handler that calls `server.close()` + `process.exit()`.

## Agent guardrail: files & actions that trigger app bounces

Replit's workspace daemon watches a small set of config files; any save re-evaluates modules/ports/env/stack, which kills shells/terminals, re-mounts the preview, and SIGKILLs workspace-local Postgres. Separately, host-side control-plane writes (set/delete Replit env vars, create/update/remove Replit artifacts) rewrite `/run/replit/env/latest.json` + `/run/replit/toolchain.json` env/toolchain state and bounce the same-container supervisor ~1s later. Neither is normal setup/cleanup work.

**Do not edit these from any agent during routine work or test cycles unless the user explicitly asked for a config change:**

- `.replit` — modules, ports, `[userenv.*]`, `[agent]`, `[deployment]`. Use a single `DATABASE_URL` for dev DB config.
- Replit control-plane env writes (set/delete env vars / add secrets) — only inside an explicit startup maintenance window.
- Replit control-plane artifact writes (create/update/remove artifacts) — the controller reconciles on change and, in `PNPM_WORKSPACE` stack mode, cascades into a full re-bring-up. Maintenance window only.
- `artifacts/*/.replit-artifact/artifact.toml` — same reconciliation cascade. Never hand-edit outside a maintenance window.
- `replit.nix` — same daemon, same reload.

**Test patterns that do NOT cause a reload:**
- Verify API code: `pnpm --filter @workspace/api-server run typecheck` / `... run unit validation`.
- Verify a route: `curl -sS http://127.0.0.1:8080/api/healthz` against the running server; `restart_workflow "artifacts/api-server: API Server"` only if the change is in compiled output.
- For pyrus: `pnpm --filter @workspace/pyrus run typecheck` plus live Vite HMR; only restart the pyrus workflow if you edited `vite.config.ts` or `package.json`.

Root validation: `pnpm run typecheck:libs` runs through `scripts/run-validation-command.mjs`, which logs every run to `.pyrus-runtime/validation/commands.jsonl` and holds a single-validation lock so two broad checks do not contend with each other. It does not inspect the live PYRUS supervisor and does not refuse rebuilds/checks because the app is running. Prefer targeted package checks when they are faster, but root validation is no longer gated on supervisor hot-state.

If a test genuinely requires a config change, batch all edits into a single save and warn the user that one workspace reload will happen. To keep watched files read-only during routine work: `pnpm run replit:config:lock` / `pnpm run replit:config:unlock` (re-lock immediately after a batched edit, then run `pnpm run audit:replit-startup`).

Recovery-clobber protection: Replit's platform "Post-Recovery checkpoint" flow can rewrite `.replit` from control-plane state and delete `replit.nix` (this bricked shells on 2026-07-09). Canonical known-good copies live in `scripts/replit-config/`; `pnpm run replit:config:restore` diffs them against the live files and `pnpm run replit:config:restore -- --write` restores + re-locks in one batch (ONE workspace reload). The startup audit and the dev supervisor both detect the clobber signature — the supervisor only warns and names the restore command; it never writes `.replit` itself. Note: Replit blocks direct `.replit`/`replit.nix` writes from agent-owned shells, so `-- --write` may fail there; the script detects the blocked write and prints the fallback (run from the user-owned Shell pane, or `cp` the canonical copies + `pnpm run replit:config:lock`). If the canonical startup config intentionally changes, update `scripts/replit-config/` in the same maintenance window.

Scribe artifact hygiene: workspace restoration can leave duplicate live artifact iframe records. Audit read-only with `pnpm run replit:scribe:artifacts`; only inside a maintenance window, `PYRUS_ALLOW_REPLIT_CONTROL_PLANE_CLEANUP=1 pnpm run replit:scribe:artifacts -- --backup-and-clean --confirm-control-plane-cleanup` (backup-first, but still control-plane maintenance).

## Historical fix notes

- **Bloomberg live dock** (`features/platform/BloombergLiveDock.jsx`) — originally mounted open with autoplaying HLS and a 300s DVR buffer, OOMing the tab in 30–60 min. Now defaults closed (`isOpen` starts `false`; the HLS pipeline is gated on `playbackSessionEnabled = isOpen`), DVR buffer cut to 30s, and a visibility `useEffect` calls `hls.stopLoad()`/`pause()` when the tab hides. Note: the five market/flow/signal stores are NOT leaks — each `publish*` replaces (not appends) its snapshot, bounded by distinct keys.
- **Module-level cache caps** — three previously-unbounded module Maps are now bounded LRU: `minuteCacheBySymbol` (`useMassiveStockAggregateStream.ts`, cap 64, listener-aware eviction), the research caches in `researchApi.js` (cap 64 each via `setLruEntry`), and `optionQuoteSnapshotsByProviderContractId` (`live-streams.ts`, cap 1024, listener-aware). Per-symbol inner bounds are unchanged.
