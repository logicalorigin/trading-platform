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

- Replit Run button — use the **PYRUS web** workflow for full app bring-up. `.replit` intentionally has no root `run = [...]` line and no repo-defined workflow tasks; its `[workflows] runButton = "artifacts/pyrus: web"` points the workflow service at the PYRUS web artifact. `[agent] stack = "PNPM_WORKSPACE"` lets Replit discover that artifact.
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally
- `pnpm --filter @workspace/pyrus run dev` — run the PYRUS web app locally
- `pnpm --filter @workspace/backtest-worker run dev` — run the background backtest worker locally

Account/Flex persistence note:
- If `/api/accounts/flex/health` reports `schemaReady: false`, the account UI will fall back to live-only data and FLEX history/cache fields will stay empty until the DB schema is pushed.
- Run `pnpm --filter @workspace/db run push` to create the missing account/FLEX tables, then verify `/api/accounts/flex/health` shows `schemaReady: true` and an empty `missingTables` list.

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.

## Artifacts

- **pyrus** (`artifacts/pyrus`, `/`) — PYRUS Platform. React + Vite trading terminal with the platform shell, runtime providers, charting, market, flow, trade, account, research, algo, backtest, diagnostics, and settings code split under `src/features`, `src/screens`, and `src/components/platform`. The guarded artifact path remains `artifacts/pyrus` so Replit's pinned web artifact keeps the same identity. The retired `src/PyrusPlatform.jsx` monolith is no longer the app entry; `src/app/App.tsx` lazy-loads `src/features/platform/PlatformApp.jsx`. The `components/ui/` directory only retains `dropdown-menu.tsx` and `popover.tsx` (the only shadcn wrappers actually imported); the rest of the shadcn library plus its dependencies (radix-*, sonner, vaul, wouter, cmdk, framer-motion, react-hook-form, date-fns, etc.) were removed in the dependency cleanup pass.
- **api-server** (`artifacts/api-server`) — Express API serving research, trading, market data, and the new backtesting routes.
- **backtest-worker** (`artifacts/backtest-worker`) — background job worker that claims queued backtest jobs, hydrates/caches datasets, runs studies and sweeps, and promotes persistent run artifacts into the database.
- **ibkr-bridge** (`artifacts/ibkr-bridge`) — small HTTP service that runs beside the user's local Interactive Brokers Gateway/TWS socket. Built into `dist/index.mjs`; the Windows one-click helper exposes the bridge through Cloudflare, and the api-server's `IbkrBridgeClient` calls it for accounts, positions, bars, quotes, market depth, orders, and TWS contract search. All Date-typed fields are deserialized at the bridge-client boundary in `artifacts/api-server/src/providers/ibkr/bridge-client.ts` (HTTP JSON only carries strings).

## Replit Run

The tracked `.replit` intentionally has no root `run = [...]` line and no
repo-defined `[[workflows.workflow]]` tasks. It does keep
`[workflows] runButton = "artifacts/pyrus: web"` so Replit's primary Run
button points at the PYRUS web workflow. Replit may still show its generated
**Configure Your App** toolchain run option in some dropdowns; do not use that
generated option for app startup.

Replit's `PNPM_WORKSPACE` artifact app model should start the app from the
PYRUS artifact's `.replit-artifact/artifact.toml` `[services.development] run`
command. That command runs `pnpm --filter @workspace/pyrus run dev:replit`,
which tags the startup with `PYRUS_REPLIT_RUN=1`; its supervisor starts both
dev servers:

`PYRUS_REPLIT_RUN=1` is a tag only, not restart authority. Only
`REPLIT_MODE=workflow` may replace an existing supervisor or reap a foreign
execution scope.

- API Server — `LOG_LEVEL=warn pnpm --filter @workspace/api-server run dev` on port `8080`.
- PYRUS Platform — `pnpm --filter @workspace/pyrus run dev:web` on port `18747`.

The API dev script does not start Postgres. It uses Replit's managed Helium
database by default, even if an old workspace-local socket `DATABASE_URL` is
still present in the shell. Do not replace this with a manual terminal
prerequisite or an API-owned local Postgres process.

The IBKR connection launcher calls `/api/ibkr/bridge/launcher`, so the API must
already be running from app bring-up before the launcher is used. If that route
is unreachable after pressing **Run Replit App**, treat it as a Replit app
startup issue, not a reason to add a repo workflow or root runner.

The PYRUS artifact TOML is the development and deployment service metadata
source of truth.

Do not add repo-tracked `[[workflows.workflow]]` tasks for Project, API Server,
PYRUS Platform, Postgres, or IBKR Bridge.

The PYRUS dev supervisor owns both child services. Do not add a third root
runner or a separate API artifact service, because competing owners for ports
`8080` and `18747` are what caused prior workflow/reaper conflicts.

Do not add a separate Replit `IBKR Bridge` workflow for TWS mode. The bridge
runs beside IB Gateway/TWS on the Windows machine and is exposed through the
activation helper. A generated or stale workflow in the Replit UI is not part
of the repo config and must not be linked to app startup.

Publishing note: the PYRUS production build runs
`pnpm run build:pyrus-app`, which builds the web app, builds the API, builds
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
IBKR activation from the PYRUS header; the Windows helper posts the current
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
2. Start activation from the PYRUS header on the Windows machine. The helper
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
5. Start activation from the PYRUS header so the API stores the active bridge
   URL in the runtime override.

### Windows processes

1. **IB Gateway/TWS** — logged in live with API socket clients enabled on `127.0.0.1:4001`.
2. **PYRUS IBKR bridge** — launched only by the one-click activation helper; listens on `http://localhost:3002`.
3. **cloudflared** — launched by the activation helper for the bridge HTTP service.

### One-click activation helper (`scripts/windows/pyrus-ibkr-helper.ps1`)

Start activation from the PYRUS header after IB Gateway/TWS is logged in.

What it does:

1. Checks whether the IB Gateway/TWS socket is reachable.
2. Self-updates the installed protocol handler when the served helper version changes.
3. Opens the PYRUS bridge with `IBKR_TRANSPORT=tws`.
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
  - **Expiry parsing fix** — IBKR returns option expiries as compact YYYYMMDD strings (e.g. `"20260423"`). `artifacts/api-server/src/lib/values.ts` `toDate()` now handles 8-digit string/integer inputs as calendar dates *before* the numeric-milliseconds branch. Previously every option contract resolved to `1970-01-01T05:37:40Z`, which collapsed flow event IDs and broke UI dedupe.
- **Bridge surface** — endpoints `GET /news` and `GET /universe/search` live on the IBKR bridge (`artifacts/ibkr-bridge/src/app.ts`). `GET /news` returns empty in TWS mode by design; `GET /universe/search` is backed by TWS contract search.

## Server log noise (dev server)

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

The PYRUS dev supervisor pins API dev logging to warn-level by starting the
API child with `LOG_LEVEL=warn pnpm --filter @workspace/api-server run dev`.

To temporarily restore verbose per-request logging while debugging, drop
that env override in `artifacts/pyrus/scripts/runDevApp.mjs` and restart the
PYRUS web workflow. Production is unaffected: it runs raw JSON pino without
`pino-pretty` and the PYRUS artifact production env does not set `LOG_LEVEL`.
Bridge verbosity is controlled by the Windows activation helper environment,
not by a Replit workflow.

## Dev servers: single owner for API and web

The PYRUS web workflow owns both dev listeners: API on `8080` and pyrus on
`18747`. Older multi-workflow restarts could leave an orphan node process
holding the port, causing the next API start to fail with `EADDRINUSE` or vite
to bind a fallback port the preview proxy never used. Three fixes prevent the
recurrence:

1. **Shared port reaper** in `scripts/reap-dev-port.mjs`, run by both
   `artifacts/api-server/package.json` and `artifacts/pyrus/package.json`
   before their dev servers start. It scans `/proc/net/tcp[6]` for the requested
   `PORT` and reaps the owning PID directly; stale pid files are not trusted.
2. **`strictPort: true`** on both `server` and `preview` blocks of
   `artifacts/pyrus/vite.config.ts` so vite exits with an error instead of
   silently falling back to the next port.
3. **Process-group supervision** in `artifacts/pyrus/scripts/runDevApp.mjs`,
   plus `exec` in the child dev scripts, so SIGTERM from the PYRUS workflow
   stops both API and Vite.

If a second Replit-owned artifact workflow starts while the existing PYRUS
supervisor lock points at a live `runDevApp.mjs` process, `runDevApp.mjs`
treats it as a duplicate Run event only during the startup guard window and
exits without restarting API/Vite. After
`PYRUS_DEV_DUPLICATE_RESTART_AFTER_MS` (default `30000`), a new Replit-owned
workflow start is treated as an intentional Run-button restart and requests a
controlled handoff from the old supervisor so the current workflow owns the app
again without overlapping API/Vite processes. Use `PYRUS_DEV_FORCE_RESTART=1`
only for explicit recovery restarts, or for stale/missing lock owners where
normal startup can safely become the single owner.
Use `PYRUS_DEV_DUPLICATE_CHECK_ONLY=1` for shell smoke tests of the duplicate
path; that mode only reads the supervisor lock and exits without starting
API/Vite or running port reapers.

The supervisor also writes lifecycle evidence to
`/tmp/pyrus/pyrus-dev-lifecycle-8080.jsonl`. Use that JSONL file to distinguish
clean supervisor shutdowns from external Replit workflow stops: heartbeats,
child starts/exits, ignored SIGHUP, duplicate-start no-ops, and shutdown events
are recorded outside the workflow stdout stream.

Replit workspace restoration can leave multiple live artifact iframe records in
Scribe state. Audit them with `pnpm run replit:scribe:artifacts`; the default
mode is read-only. If duplicate PYRUS or stale non-PYRUS live artifact cards are
not removable through the UI, run
`pnpm run replit:scribe:artifacts -- --backup-and-clean` for a backup-first
local cleanup of only the audited artifact rows.

Inside Replit, Playwright must attach to the existing app unless explicitly
overridden. `artifacts/pyrus/playwright.config.ts` disables its `webServer`
block when Replit env markers are present; set
`PYRUS_PLAYWRIGHT_ALLOW_WEB_SERVER=1` only for an intentional maintenance run
that should let Playwright own app startup.

If a service restart still fails with `EADDRINUSE`, run the shared reaper for
the conflicting pinned port and restart the PYRUS web workflow:

```bash
PORT=8080 node scripts/reap-dev-port.mjs    # API
PORT=18747 node scripts/reap-dev-port.mjs   # pyrus preview
```

From a normal shell this command is intentionally conservative: it refuses to
kill a listener owned by a different Replit cgroup. When Replit runs the same
script inside an artifact workflow (`REPLIT_MODE=workflow`), it may reclaim the
pinned port from an older Replit execution scope so the Workflow tab's restart
action can recover from stale app processes. `PYRUS_REPLIT_RUN=1` is a tag
only, not restart authority.

`fuser` is unavailable on this NixOS image, and `ps`/`pgrep` may be unavailable
depending on the shell environment. If the reaper cannot identify the PID, check
`/proc/net/tcp[6]` directly (look for `:HEX_PORT` where HEX =
`printf '%04X' PORT`).

### `ensurePreviewReachable` removed from PYRUS

`artifacts/pyrus/.replit-artifact/artifact.toml` no longer sets
`ensurePreviewReachable = "/"`. With that directive in place the Replit preview
proxy was health-polling `/` and re-mounting the iframe whenever a probe
hiccupped (bundling stalls during HMR, slow chunk transforms, etc.), which
manifested in the browser console as a `[vite] connecting... → connected`
pair and a fresh `[pyrus] localStorage audit` mount log roughly every three
seconds — i.e. ~20 full page reloads/minute that froze the IDE/Chrome. The
canonical `react-vite` artifact template (`.local/skills/artifacts/artifacts/react-vite/artifact.yaml`)
does not include the directive; PYRUS now matches. If preview reachability
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
   `artifacts/ibkr-bridge/src/tws-provider.ts` and the parser/snapshot
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

## Managed Postgres by default

Replit's managed Postgres should be the normal development DB. The app resolves
DB config in this order: explicit `LOCAL_DATABASE_URL` only when
`PYRUS_DATABASE_SOURCE=local`;
Replit's Helium `PG*` environment when a stale
workspace-local socket `DATABASE_URL` is also present; otherwise `DATABASE_URL`
and then Replit's `PG*` environment (`PGHOST`, `PGDATABASE`, `PGUSER`,
`PGPASSWORD`, `PGPORT`). This keeps **Run Replit App** self-contained without
starting Postgres inside the API workflow cgroup.

The workspace-local Postgres scripts remain only as fallback/diagnostic tools:

- `scripts/start-local-postgres.sh` — manual fallback starter for the local unix
  socket.
- `scripts/wait-for-local-postgres.sh` — one-off readiness check for the local
  fallback.
- `scripts/run-local-postgres.sh` — foreground diagnostic entry point.

### 2026-05-31 Postgres disconnect incident

Flight-recorder evidence for the 2026-05-31 disconnect points to an API-side
Postgres connection failure, alongside a separate Replit container replacement:

- `2026-05-31T16:33:38.159Z` — `.pyrus-runtime/flight-recorder/api-events-2026-05-31.jsonl`
  recorded `uncaught-exception`, pid `182`, message `Connection terminated
  unexpectedly`, with the stack in `pg@8.20.0/.../pg/lib/client.js`.
- `2026-05-31T16:33:38.160Z` — the same file recorded `api-process-exit`,
  code `1`.
- `2026-05-31T16:33:48.405Z` — `incidents.jsonl` classified the previous run
  as `container-replaced`, with evidence `previous-boot:btime:1780220834` and
  `current-boot:btime:1780242802`.
- `2026-05-31T16:33:51.546Z` — the API flight recorder started again with pid
  `384`.

When triaging a similar report, run `pnpm run diagnose:replit-restarts` first.
If it shows both `container-replaced` and a recent Postgres disconnect, treat
the container replacement as platform/runtime context and the unhandled `pg`
disconnect as the app-level hardening target. Do not add Replit workflows,
local Postgres startup, or root runners to address this class of incident.

Repo rule: `.replit` intentionally has no repo-defined
`[[workflows.workflow]]` tasks and no root `run = [...]` command. Keep
`[workflows] runButton = "artifacts/pyrus: web"` so the Replit primary Run
button targets the single PYRUS web workflow. Do not add a root workflow
coordinator to hide or rename generated **Configure Your App**; that would take
startup ownership away from the PYRUS artifact.
`pnpm run audit:replit-startup` guards these startup invariants.

## `reap-dev-port.mjs` is cgroup-aware

`scripts/reap-dev-port.mjs` now reads `/proc/<pid>/cgroup` for itself and
each port-holder. If the holder is in a different cgroup and the current
process is a normal shell, the reaper **refuses to kill** and exits non-zero
with the holder's PID, cmdline, and cgroup path. This protects the live
artifact-service workflow when an agent (or the user) runs
`pnpm --filter @workspace/api-server run dev` or `... pyrus run dev` from a
shell — the shell is in its own `shellexec-*.scope`, so the reaper sees the
workflow as foreign and aborts before SIGTERM/SIGKILL.

If the current process is itself a Replit workflow (`REPLIT_MODE=workflow`),
the reaper treats that as an intentional workflow restart and may reclaim the
pinned port from a different Replit execution scope. `PYRUS_REPLIT_RUN=1` is a
tag only, not restart authority. Same-cgroup orphans (the original "previous
service restart left a node behind" case) still get reaped normally.

To intentionally restart the live API or web service, use the workflow
restart action, not `pnpm dev` from a shell.

## Agent guardrail: files that trigger a full workspace reload

Replit's workspace daemon watches a small set of platform-config files. Any save to one of them re-evaluates modules, ports, env, and the artifact stack — which kills open shells/terminals, re-mounts the IDE preview, and SIGKILLs the workspace-local Postgres process (visible in `.local/postgres/log/pg.log` as repeated "database system was not properly shut down; automatic recovery in progress" pairs minutes apart). PG WAL recovery on next start is fine and fast, but the shell/IDE disconnect destroys the user's working state.

**Do not edit these from any agent (Codex, main agent, task agent) during routine work or test cycles unless the user explicitly asked for a config change:**

- `.replit` — modules, ports, `[userenv.*]`, `[agent]`, `[deployment]`. Adding/removing an env var here reloads the workspace; use `setEnvVars` / `deleteEnvVars` instead when possible because those persist without a reload. Development database configuration should use a single `DATABASE_URL` value.
- `artifacts/*/.replit-artifact/artifact.toml` — the artifact controller reconciles on save, which in `PNPM_WORKSPACE` stack mode (`[agent] stack = "PNPM_WORKSPACE"` in `.replit`) cascades into a full app re-bring-up. Use the artifact skills to update artifact metadata; never hand-edit these.
- `replit.nix` — same daemon, same reload.

Evidence (audited 2026-05-11): of the last three commits touching `.replit`, two were a paired add+revert of a `run = [...]` line (`3ee9483` → `eeeb0f2`) that did not need to land at all, and one (`af93d82`) added a single env var that should have used `setEnvVars`. Each of those saves caused one full workspace reload.

**Test pattern that does NOT cause a reload:**

- Verifying API code: `pnpm --filter @workspace/api-server run typecheck` and `pnpm --filter @workspace/api-server run test:unit` — direct shell commands, no workflow restart.
- Verifying a route end-to-end: `curl -sS http://127.0.0.1:8080/api/healthz` against the already-running api-server, then `restart_workflow "artifacts/api-server: API Server"` only if the change is in compiled output. The artifact-service restart by itself does not edit any watched file.
- For pyrus: `pnpm --filter @workspace/pyrus run typecheck` plus the live Vite HMR; do not restart the pyrus workflow to "see" a change unless you edited `vite.config.ts` or `package.json`.

Root workspace validation is deliberately more conservative. `pnpm run typecheck:libs`
runs through `scripts/run-validation-command.mjs`, which reads the PYRUS
flight recorder plus the `/tmp/pyrus/pyrus-dev-supervisor-8080.lock` owner
process and refuses broad `tsc --build` while the Replit-owned supervisor is hot.
Refusals and executions are recorded in
`.pyrus-runtime/validation/commands.jsonl`. During live app work, prefer the
targeted package checks above; use `PYRUS_ALLOW_HOT_VALIDATION=1` only for an
intentional maintenance window where the app can tolerate broad compiler load.

If a test genuinely requires a config change, batch all the config edits into a single save and warn the user beforehand that one workspace reload is about to happen.

For routine work, keep the watched startup files read-only:

- `pnpm run replit:config:lock` — chmods `.replit`, `replit.nix`, and the
  artifact TOMLs to read-only.
- `pnpm run replit:config:unlock` — makes the same files writable for an
  intentional startup-config maintenance window. Re-lock immediately after the
  batched edit and run `pnpm run audit:replit-startup`.

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
