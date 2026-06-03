# Live Session Handoff — IBKR Data Line Usage

- Session ID: pending
- CWD: `/home/runner/workspace`
- Started: 2026-06-02
- User request: Implement the IBKR data-line usage action plan using `ib_async` without reinventing IBKR plumbing.

## Current Step

Completed the first safe vertical slices:

- Shared desired-generation and generation-status contracts in `@workspace/ibkr-contracts`.
- API-side desired-generation converter from existing market-data admission leases.
- Bridge-side observer diagnostics for actual live quote subscriptions.
- Minimal Python `ib_async` sidecar scaffold with mocked registry lifecycle tests.
- API line-usage snapshot now exposes diagnostics-only sidecar desired-vs-actual comparison. Routing remains disabled unless `IBKR_ASYNC_SIDECAR_ROUTING_ENABLED` is set truthy in a future routing slice.
- Added authoritative desired-generation apply path:
  - Bridge `POST /market-data/generation` trims live quote subscriptions to API desired lines.
  - TWS provider keeps matching desired option/equity lines and stops bridge-only stale lines.
  - API line-usage snapshot applies the desired generation by default unless `IBKR_MARKET_DATA_GENERATION_APPLY_ENABLED=0/false/no/off`.
  - Snapshot recomputes final drift from the post-apply bridge generation status.
- Review fixes from 2026-06-02:
  - Desired-generation builder now merges owners by normalized line key, so equivalent keys cannot overwrite prior owners.
  - Bridge generation status now flags active lines outside an applied empty generation as `unexpected`.
- Python `ib_async` sidecar server slice from 2026-06-02:
  - Decodes PYRUS structured `twsopt:` provider contract IDs into `ib_async.Option(...)` contracts.
  - Keeps `Stock(...)`, `Option(...)`, `reqMktData(...)`, and `cancelMktData(...)` usage aligned with `ib_async` 2.1.0 docs.
  - Adds lazy IB connection config from `PYRUS_IBKR_SIDECAR_*` env vars so importing the FastAPI app does not connect to TWS.
  - Adds `GET /health`, `GET /market-data/generation`, and `POST /market-data/generation` to the Python sidecar, returning the same generation-status shape as the TS bridge.

## Files Touched So Far

- `lib/ibkr-contracts/src/market-data-sidecar.ts`
- `lib/ibkr-contracts/src/index.ts`
- `lib/ibkr-contracts/package.json`
- `artifacts/api-server/src/services/ibkr-sidecar-generation.ts`
- `artifacts/api-server/src/services/ibkr-sidecar-generation.test.ts`
- `artifacts/api-server/src/services/ibkr-line-usage.ts`
- `artifacts/api-server/src/services/ibkr-line-usage.test.ts`
- `artifacts/api-server/src/providers/ibkr/bridge-client.ts`
- `artifacts/ibkr-bridge/src/provider.ts`
- `artifacts/ibkr-bridge/src/app.ts`
- `artifacts/ibkr-bridge/src/service.ts`
- `artifacts/ibkr-bridge/src/tws-provider.ts`
- `artifacts/ibkr-bridge/src/tws-provider.test.ts`
- `python/ibkr_sidecar/pyproject.toml`
- `python/ibkr_sidecar/src/pyrus_ibkr_sidecar/__init__.py`
- `python/ibkr_sidecar/src/pyrus_ibkr_sidecar/registry.py`
- `python/ibkr_sidecar/src/pyrus_ibkr_sidecar/ib_async_adapter.py`
- `python/ibkr_sidecar/src/pyrus_ibkr_sidecar/models.py`
- `python/ibkr_sidecar/src/pyrus_ibkr_sidecar/app.py`
- `python/ibkr_sidecar/src/pyrus_ibkr_sidecar/service.py`
- `python/ibkr_sidecar/tests/test_registry.py`
- `python/ibkr_sidecar/tests/test_ib_async_adapter.py`
- `python/ibkr_sidecar/tests/test_app.py`

## Validation

- `pnpm --filter @workspace/api-server exec node --import tsx --test src/services/ibkr-sidecar-generation.test.ts`: pass.
- `pnpm --filter @workspace/api-server exec node --import tsx --test --test-name-pattern "applies desired generation|active scanner drift" src/services/ibkr-line-usage.test.ts`: pass.
- `pnpm --filter @workspace/api-server exec node --import tsx --test ../ibkr-bridge/src/tws-provider.test.ts --test-name-pattern "market data generation"` from workspace root: pass; Node ran the file, 52 tests passed.
- `pnpm --filter @workspace/api-server run typecheck`: pass.
- `pnpm --filter @workspace/api-server run build`: pass.
- `pnpm --filter @workspace/ibkr-bridge run typecheck`: pass.
- `pnpm --filter @workspace/ibkr-bridge run build`: pass.
- `pnpm --filter @workspace/ibkr-contracts exec tsc -p tsconfig.json --noEmit`: pass.
- `PYTHONPATH=python/ibkr_sidecar/src python -m pytest python/ibkr_sidecar/tests`: pass, 9 tests. FastAPI TestClient emitted the existing Starlette `httpx` deprecation warning.
- `PYTHONPATH=python/ibkr_sidecar/src python -m ruff check python/ibkr_sidecar/src python/ibkr_sidecar/tests`: pass.
- `PYTHONPATH=python/ibkr_sidecar/src python -m mypy python/ibkr_sidecar/src`: pass.
- Scoped `git diff --check` for IBKR slice files: pass.
- `pnpm run typecheck:libs` was attempted but refused by the workspace guard because the live PYRUS/Replit runtime is hot; targeted `@workspace/ibkr-contracts` no-emit validation passed instead.
- Live poll on the currently running API at 2026-06-02T01:18Z:
  - `/api/healthz`: `200`, `{"status":"ok"}`.
  - `/api/settings/ibkr-line-usage`: two polls reported `apiLineCount=18`, `bridgeLineCount=18`, `bridgeOnlyLineCount=0`, `persistentBridgeOnlyLineCount=0`, `driftStatus=matched`.
  - Runtime caveat: current API process was started before the apply patch and does not show `sidecar.applyEnabled`; this proves the live system is not currently wasting bridge-only lines, but it does not prove the new apply path is active. Live verification of the apply path still needs the default Replit app runner to restart API, and the active IBKR bridge must be rebuilt/restarted to include `POST /market-data/generation`.
- Resumed in session `019e862c-7a64-7982-b62e-6ed0423a8457` at 2026-06-01 20:33 MDT:
  - Current API had loaded the apply path and reported `sidecar.applyEnabled=true`, but the configured Cloudflare bridge returned `404 Cannot POST /market-data/generation`.
  - Root cause was stale served Windows bridge bundle: `artifacts/ibgateway-bridge-windows-current.tar.gz` was packaged at 2026-06-01 11:35 MDT and did not include the route, while `artifacts/ibkr-bridge/dist/index.mjs` did.
  - Ran `pnpm run build:ibkr-bridge-bundle`; pass. Repackaged bundle at `artifacts/ibgateway-bridge-windows-current.tar.gz` and verified the tarball contains `app.post("/market-data/generation")`.
  - Queued remote desktop relaunch job `2f25109a1697175df84ff300b3f0cc8b` for desktop `desktop-EASYSTREET-c572024619f59c20`; API attached fresh runtime at `2026-06-02T02:29:51.586Z`.
  - Final live `/api/settings/ibkr-line-usage` snapshot: `sidecar.applyEnabled=true`, `applyError=null`, bridge generation status present, comparison `matched`, desired/bridge/matched/bridge-only counts all `0`.
  - Final `/api/session` snapshot: bridge configured/authenticated/connected, health fresh, reachable, target `127.0.0.1:4001`, TWS live mode; `strictReady=false` only because `market_session_quiet`.

## Next Step

Next implementation slice: wire an API-side Python sidecar client behind `IBKR_ASYNC_SIDECAR_ROUTING_ENABLED` without duplicating bridge subscriptions. Keep the TypeScript bridge as the default route until sidecar routing has targeted tests and live no-duplicate-subscription verification.

## Routing Slice Update - 2026-06-01 20:45 MT

- Started API-side Python sidecar routing slice after user approved the next step.
- Planned scope: add a TS client for Python sidecar `POST /market-data/generation`, route desired-generation apply to it only when `IBKR_ASYNC_SIDECAR_ROUTING_ENABLED` is truthy, and skip TS bridge generation apply in that mode to avoid duplicate IBKR market-data subscriptions.
- Active files for this slice: `artifacts/api-server/src/services/ibkr-line-usage.ts`, `artifacts/api-server/src/services/ibkr-line-usage.test.ts`, and new API-side sidecar client file.
- Validation target: focused `ibkr-line-usage` tests proving sidecar routing calls the sidecar once, does not call bridge apply, and does not fall back to bridge on sidecar apply failure; then API server typecheck.

## Routing Slice Complete - 2026-06-01 20:57 MT

- Added `artifacts/api-server/src/services/ibkr-async-sidecar-client.ts`.
  - Defaults to `http://127.0.0.1:18769`, matching the Python sidecar service.
  - Supports `IBKR_ASYNC_SIDECAR_URL` / `PYRUS_IBKR_SIDECAR_URL`, host/port env overrides, and `IBKR_ASYNC_SIDECAR_REQUEST_TIMEOUT_MS`.
  - Validates `ib-async-sidecar` generation-status responses before line-usage trusts them.
- Updated `artifacts/api-server/src/services/ibkr-line-usage.ts`.
  - Default remains TS bridge apply.
  - `IBKR_ASYNC_SIDECAR_ROUTING_ENABLED=true` routes desired generation to the Python sidecar.
  - Sidecar routing does not call bridge generation apply and does not fall back to bridge if sidecar apply fails.
  - Snapshot now exposes `sidecar.applyTarget`, `sidecar.routingEnabled`, `sidecar.diagnosticsOnly=false` when routed, and sidecar apply errors/status.
- Added tests:
  - `artifacts/api-server/src/services/ibkr-async-sidecar-client.test.ts`
  - New routing/no-fallback cases in `artifacts/api-server/src/services/ibkr-line-usage.test.ts`.
- Validation:
  - `pnpm --filter @workspace/api-server exec node --import tsx --test src/services/ibkr-async-sidecar-client.test.ts`: pass, 2 tests.
  - `pnpm --filter @workspace/api-server exec node --import tsx --test src/services/ibkr-line-usage.test.ts`: pass, 15 tests.
  - `pnpm --filter @workspace/api-server run typecheck`: pass.
  - `pnpm --filter @workspace/api-server run build`: pass.
  - Scoped `git diff --check` for this slice and handoff: pass.
- Not touched in this slice: `.replit`, artifact startup config, bridge bundle packaging, live Replit app runner, or browser QA.

## Replit Env Enablement - 2026-06-01 21:27 MT

- User asked to set the Replit secret/env needed for API-side Python `ib_async` sidecar routing.
- Needed value is non-secret: `IBKR_ASYNC_SIDECAR_ROUTING_ENABLED=true`.
- Tried the preferred Replit-local env mutation path first:
  - Replit CLI has no `env`/`secrets` subcommand in this workspace.
  - GraphQL mutation path was blocked by persisted-query requirements.
  - Local pid2 exposes `environment.setEnvVars`, but the shell-available identity tokens were rejected by pid2 handshake validation.
- Applied the smallest fallback startup-config edit:
  - Added `[userenv.development] IBKR_ASYNC_SIDECAR_ROUTING_ENABLED = "true"` to `.replit`.
  - Chose development-only instead of shared so production autoscale does not accidentally route to a local sidecar.
- Required validation after touching `.replit`:
  - `pnpm run audit:replit-startup`: pass (`[check-replit-startup-guards] ok`).
  - `pnpm run replit:config:lock` and `pnpm run replit:config:status`: pass; `.replit`, `replit.nix`, and `artifacts/pyrus/.replit-artifact/artifact.toml` are read-only again.
- Current live process caveat:
  - Existing API process still has only `IBKR_TRANSPORT=tws` in `/proc/<pid>/environ`.
  - `/run/replit/env/latest.json` does not yet contain `IBKR_ASYNC_SIDECAR_ROUTING_ENABLED`.
  - Live `/api/settings/ibkr-line-usage` on ports `18747` and `8080` still reports `sidecar.routingEnabled=false`, `diagnosticsOnly=true`, and `applyTarget="tws-bridge"`.
  - Replit app/run environment needs a restart/reload to pick up the persisted development env flag.

## Post-Restart Sidecar Verification - 2026-06-01 21:47 MT

- User restarted/reloaded the Replit app and asked to proceed.
- Verified API process now inherits `IBKR_ASYNC_SIDECAR_ROUTING_ENABLED=true`.
- Live `/api/settings/ibkr-line-usage` now reports:
  - `sidecar.routingEnabled=true`
  - `sidecar.diagnosticsOnly=false`
  - `sidecar.applyTarget="ib-async-sidecar"`
- Started Python sidecar on `127.0.0.1:18769` with:
  - `PYTHONPATH=python/ibkr_sidecar/src .pythonlibs/bin/python3 -m pyrus_ibkr_sidecar.service`
  - Current live sidecar PID: `33710`
  - Health endpoint returns `{"ok":true,"service":"pyrus-ibkr-sidecar",...}`.
- Found and fixed sidecar implementation bug:
  - Root cause: `LazyIbAsyncMarketDataAdapter` used synchronous `IB.connect(...)` from FastAPI's running event loop, producing `this event loop is already running`.
  - Fix: sidecar registry/app now use async subscribe/cancel lifecycle; lazy adapter uses `await IB.connectAsync(...)` guarded by an async lock.
  - Added regression test proving lazy adapter uses `connectAsync` and never sync `connect`.
- Validation after the Python fix:
  - `PYTHONPATH=python/ibkr_sidecar/src .pythonlibs/bin/python3 -m pytest python/ibkr_sidecar/tests`: pass, 10 tests.
  - `PYTHONPATH=python/ibkr_sidecar/src .pythonlibs/bin/python3 -m ruff check python/ibkr_sidecar/src python/ibkr_sidecar/tests`: pass.
  - `PYTHONPATH=python/ibkr_sidecar/src .pythonlibs/bin/python3 -m mypy python/ibkr_sidecar/src`: pass.
  - Scoped `git diff --check` for Python sidecar files: pass.
- Live routed result after fix:
  - API successfully posts desired generation to Python sidecar.
  - Python sidecar response source is `ib-async-sidecar`, mode `executor`, generation id `api-admission:e66143612f2ecced`.
  - Sidecar has `failedLineCount=3`, `liveLineCount=0`; all requested option lines fail with `[Errno 111] Connection refused`.
  - This is no longer an event-loop bug. The remaining blocker is that no local IB API socket is open from Replit: checked `127.0.0.1` ports `4001`, `4002`, `7496`, and `7497`; all were closed.
- Operational implication:
  - The existing TS bridge remains reachable through the desktop agent and reports TWS target `127.0.0.1:4001`, but that socket is local to the desktop/bridge environment, not exposed to the Replit Python sidecar.
  - To make `ib_async` live, either run the Python sidecar on the desktop/TWS host or provide a TCP tunnel from Replit to the desktop TWS API socket.

## Desktop-Side Sidecar Proxy Slice - 2026-06-01 22:01 MT

- User approved proceeding from the remaining blocker: Replit cannot reach the desktop-local TWS socket.
- Implemented the desktop-hosted path:
  - `scripts/package-ibkr-bridge-bundle.mjs` now includes `python/ibkr_sidecar/pyproject.toml`, `python/ibkr_sidecar/uv.lock`, and `python/ibkr_sidecar/src` in the Windows bridge bundle.
  - `scripts/windows/pyrus-ibkr-helper.ps1` helper version bumped to `2026-06-02.ib-async-sidecar-v1`.
  - Windows helper now starts the Python sidecar best-effort with `uv run --project python\ibkr_sidecar --python 3.11 python -m pyrus_ibkr_sidecar.service`.
  - Desktop sidecar env targets the desktop Gateway socket: `PYRUS_IBKR_SIDECAR_IB_HOST=127.0.0.1`, `PYRUS_IBKR_SIDECAR_IB_PORT=4001`, `PYRUS_IBKR_SIDECAR_CLIENT_ID=201`, live market data type `1`, readonly mode.
  - Helper stops the sidecar with bridge child processes and leaves the existing Node bridge launch alive if uv/Python sidecar startup fails.
  - `artifacts/ibkr-bridge/src/app.ts` now exposes authenticated proxy endpoints:
    - `GET /async-sidecar/health`
    - `GET /async-sidecar/market-data/generation`
    - `POST /async-sidecar/market-data/generation`
  - `artifacts/api-server/src/services/ibkr-async-sidecar-client.ts` now defaults to the attached bridge proxy URL `/async-sidecar/` when no explicit sidecar URL is set, and sends the bridge bearer token.
  - Fixed URL joining so proxy base paths are preserved.
- Built artifacts:
  - `pnpm --filter @workspace/api-server run build`: pass.
  - `pnpm --filter @workspace/ibkr-bridge run build`: pass.
  - `node scripts/package-ibkr-bridge-bundle.mjs`: pass; new bundle at `artifacts/ibgateway-bridge-windows-current.tar.gz`, size `1639363` bytes.
- Validation:
  - `pnpm --filter @workspace/api-server exec node --import tsx --test src/services/ibkr-async-sidecar-client.test.ts src/services/ibkr-line-usage.test.ts src/services/ibkr-bridge-runtime.test.ts`: pass, 48 tests.
  - `pnpm --filter @workspace/api-server run typecheck`: pass.
  - `pnpm --filter @workspace/ibkr-bridge run typecheck`: pass.
  - `PYTHONPATH=python/ibkr_sidecar/src .pythonlibs/bin/python3 -m pytest python/ibkr_sidecar/tests`: pass, 10 tests, existing FastAPI/Starlette `httpx` deprecation warning only.
  - `PYTHONPATH=python/ibkr_sidecar/src .pythonlibs/bin/python3 -m ruff check python/ibkr_sidecar/src python/ibkr_sidecar/tests`: pass.
  - `PYTHONPATH=python/ibkr_sidecar/src .pythonlibs/bin/python3 -m mypy python/ibkr_sidecar/src`: pass.
  - `pnpm run replit:config:status`: startup files remain locked/read-only.
  - PowerShell parser validation could not run in this Linux container because `pwsh` is not installed.
- Operational state:
  - The live API process is still the pre-change process from `2026-06-01 21:38 MDT`; repo docs explicitly say to use the Replit workflow restart action, not a shell kill/restart, for live API reloads.
  - The built API dist and Windows bridge bundle are ready. After the default Replit **Run Replit App** workflow restarts, queue a desktop remote launch/reconnect so the desktop agent self-updates to helper `2026-06-02.ib-async-sidecar-v1`, downloads the new bundle, starts the desktop Python sidecar, and exposes it through the existing bridge tunnel.

## Desktop Relaunch Verification and uv Installer Fix - 2026-06-01 22:31 MT

- User restarted via default Replit **Run Replit App** and asked to check/proceed.
- Verified fresh API process started at `2026-06-01 22:27 MDT`; routing flag active.
- Queued desktop remote launch job `1b8cf6178fcd3dce958bd4dee756594b`.
- Desktop agent self-updated to helper `2026-06-02.ib-async-sidecar-v1` and bridge reattached at `2026-06-02T04:28:36.576Z`.
- Bridge runtime is current and reachable:
  - Bridge runtime build `47c5c8eaf23898d297bc6815709a8d4c7f43f6bdf9312728d86d4c6485560076`.
  - TWS target `127.0.0.1:4001`, connected/authenticated, market data mode live.
- Sidecar proxy route now exists, but returns `502 fetch failed` for both:
  - `/async-sidecar/health`
  - `/async-sidecar/market-data/generation`
- Root cause found in helper script after checking current uv Windows install references:
  - Helper used wrong WinGet package id `AstralSoftware.uv`.
  - Current uv WinGet id is `astral-sh.uv`.
- Fixed helper installer id and bumped helper version to `2026-06-02.ib-async-sidecar-v2` so the desktop agent will self-update again on the next reconnect.
- Required next step after this fix: rebuild API dist, restart with default Replit **Run Replit App**, then queue desktop remote launch/reconnect again. The v2 helper should install/find `uv`, start the Python sidecar, and make `/async-sidecar/health` return `200`.

## Post-v2 Live API Check - 2026-06-01 22:35 MT

- User said restart was done and asked to check/proceed.
- Verified current repo/build state:

## Flow Scanner Lane UI + Account/Shadow Line Audit - 2026-06-02 13:25 MT

- User reported flow lines looked fine but the scanner lane still appeared empty, and requested a real/shadow account position-line audit.
- Root cause for the empty-looking scanner lane:
  - Live `/api/settings/ibkr-lanes` had a populated `flow-scanner` membership: 92 desired, 92 admitted; sources were built-in 37, watchlists 90, flow-universe 30.
  - The lane card was using current active IBKR line leases for its utilization bar/primary metric, comparing those transient leases to the symbol membership limit. During scanner TTL gaps the active lease count can be 0 even while the scanner universe is admitted.
- Implemented UI/diagnostic changes:
  - `artifacts/pyrus/src/screens/settings/IbkrLaneArchitecturePanel.jsx`: lane card utilization now uses admitted symbols over symbol limit; active live quote leases are labeled `LIVE LINES`; admitted symbols are shown as a separate metric.
  - `artifacts/api-server/src/services/ibkr-lanes.ts`: scanner architecture node summary now reports admitted/desired symbols and active IBKR lines instead of generic scanner copy.
  - `artifacts/pyrus/src/features/platform/runtimeControlModel.js`: shadow account detail now says `IBKR live` plus fallback policy when active lines exist, avoiding the misleading implication that `cache fallback` means non-IBKR routing.
  - `artifacts/pyrus/src/screens/SettingsScreen.jsx`: line usage panel now separates `Account IBKR lines`, `Shadow IBKR lines`, `Shadow fallback policy`, and `Shadow demand owners`.
  - Updated `artifacts/pyrus/src/features/platform/runtimeControlModel.test.js` expectation for the shadow detail copy.
- Live audit samples:
  - At `2026-06-02T19:23:26.959Z`, scanner lane membership was 92/92 admitted while scanner active lines were 0, with 196 effective scanner lines available; real account monitor had 2 active/covered/needed IBKR-demand lines; shadow had 2 active lines, 6 leases, 3 owners, and active owner sample `shadow-position-day-change:mixed`, `shadow-position-visible:mixed`, `shadow-risk-greek:mixed`.
  - Later direct API sample at `2026-06-02T19:24:57.908Z`: sidecar routing enabled, apply enabled, no apply error, desired generation had 15 lines with owner records including scanner 11, real account 4, shadow 6, signal 6; scanner audit reported 11 active lines, effective cap 196, planned horizon 746, draining true, no blocked reason.
- Audit conclusion:
  - Real account positions route through `account-monitor-live` demand and are admitted as account-monitor IBKR lines.
  - Shadow account positions route through `shadow-*` owners via the same live demand/admission path and appear in the sidecar desired generation when active.
  - `activeFallbackProviderLineCounts.cache` is fallback policy metadata for admitted live lines, not evidence that shadow lines bypassed IBKR.

## Flow Lane After-Hours Hydration - 2026-06-02 22:58 UTC

- User reported the Flow lane was empty / stuck at `FLOW SCANNING` after hours and asked for exact root cause before more work.
- Root cause:
  - `/api/flow/events/aggregate` only read `optionsFlowScanner.listSnapshots(...)`.
  - Scanner snapshots are process-memory state; after an API restart or after-hours quiet session they can be empty.
  - The durable `flow_events` table had the latest registered prints, but aggregate Flow never queried it.
- Durable data found before patch:
  - `flow_events` had 29,716 rows.
  - Latest 100 stored rows were provider `massive`, newest `2026-06-02T19:59:55.654Z`, oldest `2026-06-01T16:58:36.048Z`.
- Implemented backend fix:
  - `artifacts/api-server/src/services/historical-flow-events.ts`: added `listRecentStoredHistoricalFlowEvents(...)`, reading recent durable rows ordered by `flow_events.occurred_at DESC`, with existing Flow filters and bounded candidate limit.
  - `artifacts/api-server/src/services/platform.ts`: `listAggregateFlowEvents(...)` now combines scanner snapshot events with stored historical Flow rows, dedupes, recency-sorts, and returns the requested limit. Stored-only after-hours results report provider `massive`, status `fallback`, `fallbackUsed=true`, attempted providers `["ibkr","massive"]`, and `ibkrReason="options_flow_historical_store"`.
  - Regression coverage added in `historical-flow-events.test.ts` and `options-flow-scanner.test.ts`; scanner unit tests keep the durable store disabled except the static aggregate backfill guard.
- Validation:
  - `pnpm --filter @workspace/api-server exec node --import tsx --test src/services/historical-flow-events.test.ts`: pass, 14 tests.
  - `pnpm --filter @workspace/api-server exec node --import tsx --test src/services/options-flow-scanner.test.ts --test-name-pattern listAggregateFlowEvents`: pass, 83 tests.
  - `pnpm --filter @workspace/api-server run typecheck`: pass.
  - `pnpm --filter @workspace/api-server run build`: pass.
  - Direct source call against real DB returned exactly 100 events, sorted newest-first, newest `2026-06-02T19:59:55.654Z`.
  - Live endpoint `GET /api/flow/events/aggregate?limit=100&blocking=false&queueRefresh=false` returned exactly 100 events, sorted newest-first, source `massive` fallback, first rows MSFT/SMCI/MSFT/AAPL/AAOI.
- Browser QA state:
  - Safe-mode URL `?pyrusQa=safe` reached the Flow screen but made no `/api/flow/events/aggregate` request because safe mode suppresses runtime work scheduling. It showed `FLOW SCANNING` and `0 / 0 shown`; this is not representative of the live runtime lane.
  - Asked user for approval to open the local app without `pyrusQa=safe` for read-only browser QA of the real Flow lane.
- Validation:
  - `pnpm --filter @workspace/pyrus exec node --import tsx --test src/screens/settings/ibkrLaneUiModel.test.js src/features/platform/runtimeControlModel.test.js`: pass, 44 tests.
  - `pnpm --filter @workspace/api-server run typecheck`: pass.
  - `pnpm --filter @workspace/pyrus run typecheck`: pass.
- Runtime caveat:
  - Frontend/Vite changes should hot reload.
  - API dev process was already running from built `dist`; the `ibkr-lanes.ts` scanner architecture-summary source change needs the default Replit app runner restart/rebuild before the live endpoint shows that new summary.

## Position Data-Line Coverage Follow-Up - 2026-06-02 13:31 MT

- User asked to make sure all shadow and real positions are accounted for with a data line.
- Live reconciliation before the fix:
  - Real account `/api/accounts/combined/positions`: 3 open stock positions, `FCEL`, `FRMI`, `INDI`; all had live `bridge_quote` marks but 0/3 had matching sidecar desired equity lines.
  - Shadow `/api/accounts/shadow/positions`: 3 open option positions, `AMD`, `TQQQ`, `QBTS`; all 3 had matching sidecar desired option lines via signal-options/automation owners in the sampled generation.
  - `/api/settings/ibkr-line-usage` sample at `2026-06-02T19:29:44.840Z`: sidecar routing/apply enabled, no apply error, desired line count 10; owner class counts were signal-options 9, automation 2, flow-scanner 4; no account-monitor lines were present.
- Root cause:
  - Real equity position quote hydration called `getQuoteSnapshots({ allowMassiveFallback: false })` without an admission owner, so it returned bridge quotes but did not declare account-monitor market-data leases for those stock positions.
- Implemented:
  - `artifacts/api-server/src/services/account.ts`: added `ACCOUNT_MONITOR_EQUITY_QUOTE_TTL_MS`; real equity position quote hydration now passes `admissionOwner: account-position-equity-quotes:${accountKey}`, `admissionIntent: "account-monitor-live"`, `admissionFallbackProvider: "cache"`, and the 15s TTL to `getQuoteSnapshots`.
  - `artifacts/api-server/src/services/platform.ts`: `GetQuoteSnapshotsInput` and uncached bridge quote fetch now carry `ttlMs` through to `fetchBridgeQuoteSnapshots`.
  - `artifacts/api-server/src/services/account-positions.test.ts`: regression assertion covers the real equity account-monitor owner, intent, fallback, and TTL.
- Validation:
  - `pnpm --filter @workspace/api-server exec node --import tsx --test src/services/account-positions.test.ts`: pass, 19 tests.
  - `pnpm --filter @workspace/api-server run typecheck`: pass.
  - `pnpm --filter @workspace/api-server run build`: pass; built `artifacts/api-server/dist/index.mjs` contains `account-position-equity-quotes`.
  - `pnpm --filter @workspace/api-server exec node --import tsx --test src/services/platform-massive-stock-routing.test.ts`: pass, 7 tests.
- Runtime caveat:
  - The running API process still needs the default Replit **Run Replit App** restart to load the rebuilt dist. After restart, reread `/api/accounts/combined/positions`, wait for `/api/settings/ibkr-line-usage`, and verify `FCEL`, `FRMI`, and `INDI` appear as desired equity lines with `account-monitor` owners.

## Post-Restart Verification + Explicit Owner Retention Fix - 2026-06-02 13:39 MT

- User restarted and asked to check.
- Verified fresh app process:
  - API process started at `2026-06-02 13:35:00 MDT`.
  - `artifacts/api-server/dist/index.mjs` mtime was `2026-06-02 13:35:01 MDT`.
  - `8080` and `18747` health checks both returned `{"status":"ok"}`.
- Live reconciliation after that restart:
  - Real positions: 3 stocks, `FCEL`, `FRMI`, `INDI`; all had live `bridge_quote` marks but 0/3 had matching desired sidecar equity lines.
  - Shadow positions: 4 options, `QBTS`, `ACHR`, `AMD`, `TQQQ`; 4/4 had desired option lines, with `shadow-account` owners present.
  - Final sample at `2026-06-02T19:38:07.490Z`: sidecar routing/apply enabled, desired lines 37, active lines 37, `accountMonitorLineCount=4`, `shadowActiveLineCount=4`, `flowScannerLineCount=30`, no apply error. Missing lines were still the three real equity symbols.
- Root cause of the remaining real-equity miss:
  - `fetchBridgeQuoteSnapshots` admitted explicit owners, fetched/cached bridge quotes, then unconditionally called `releaseMarketDataLeases(owner, "snapshot_complete")`.
  - That is correct for anonymous one-shot snapshot owners, but wrong for explicit position owners like `account-position-equity-quotes:*`, `shadow-equity-mark:*`, and `shadow-underlying-mark:*`; it deleted the desired data-line owner immediately.
- Implemented second fix:
  - `artifacts/api-server/src/services/bridge-quote-stream.ts`: explicit quote snapshot owners are retained until TTL; anonymous snapshot owners still release on completion.
  - `artifacts/api-server/src/services/bridge-quote-stream.test.ts`: added regression proving explicit `account-monitor-live` quote snapshot owners remain in admission diagnostics until TTL.
- Validation:
  - `pnpm --filter @workspace/api-server exec node --import tsx --test src/services/bridge-quote-stream.test.ts src/services/account-positions.test.ts`: pass, 39 tests.
  - `pnpm --filter @workspace/api-server run typecheck`: pass.
  - Scoped `git diff --check`: pass.
  - `pnpm --filter @workspace/api-server run build`: pass; rebuilt dist after the explicit-owner retention fix.
- Runtime caveat:
  - Because the build happened after the live API process was already running, another default Replit **Run Replit App** restart is needed.
  - After restart, rerun the reconciliation. Expected clean state: `FCEL`, `FRMI`, `INDI` desired equity lines with `account-monitor` owner class, plus all shadow option positions covered by `shadow-account`/automation owners.
  - `artifacts/api-server/src/services/ibkr-bridge-runtime.ts` contains `BRIDGE_HELPER_VERSION = "2026-06-02.ib-async-sidecar-v2"`.
  - `artifacts/api-server/dist/index.mjs` contains helper version `2026-06-02.ib-async-sidecar-v2`.
  - `scripts/windows/pyrus-ibkr-helper.ps1` contains `$HelperVersion = '2026-06-02.ib-async-sidecar-v2'` and `Ensure-Command -Command uv -WingetId astral-sh.uv`.
- Verified live runtime state:
  - Replit-owned API process is still PID `39910`, started `2026-06-01 22:27 MDT` with `node --enable-source-maps ./dist/index.mjs`.
  - `/api/session` still reports `desktopAgentExpectedHelperVersion="2026-06-02.ib-async-sidecar-v1"`.
  - `/api/ibkr/desktops` still reports the desktop helper online at `2026-06-02.ib-async-sidecar-v1`.
  - `/api/settings/ibkr-line-usage` returned an update timestamp but no v2 sidecar success yet.
- Decision:
  - Did not queue another desktop remote launch. The running API would still issue v1 launch metadata, so a launch now would not exercise the `astral-sh.uv` fix.
- Validation/status:
  - `pnpm run replit:config:status`: pass; startup files remain locked/read-only.
- Next required action:
  - Restart through the default Replit **Run Replit App** workflow again so the live API process reloads the v2 dist.
  - After restart, verify `/api/session` reports expected helper v2, then queue the desktop remote launch/reconnect and probe `/async-sidecar/health`.

## v2 Desktop Sidecar Validation - 2026-06-01 22:41 MT

- User restarted with the default Replit **Run Replit App** workflow and confirmed.
- Verified live API process now advertises helper `2026-06-02.ib-async-sidecar-v2`:
  - `/api/session`: expected helper v2, desktop actual helper initially v1, upgrade required true.
  - Replit-owned API process restarted at `2026-06-01 22:38:24 MDT`.
- Queued desktop remote-launch job `9df98fbb314e4f02d9a2809bab8a846b`; full payload with tokens is stored at `/tmp/ibkr-remote-launch-sidecar-v2.json` and must not be copied into user-facing output.
- Desktop helper self-updated to `2026-06-02.ib-async-sidecar-v2`.
- Bridge runtime reattached at `2026-06-02T04:40:28.678Z`.
- Direct bridge probes through the runtime override:
  - `/healthz`: `200`, bridge connected/authenticated to TWS `127.0.0.1:4001`, market data mode live.
  - `/async-sidecar/health`: `200`, service `pyrus-ibkr-sidecar`, applied generation `api-admission:4f53cda18c2baa0c`, live/failed line counts `0`.
  - `/async-sidecar/market-data/generation`: `200`, source `ib-async-sidecar`, mode `executor`, generation matched, live/failed line counts `0`.
- Live line-usage verification:
  - `applyTarget="ib-async-sidecar"`
  - `routingEnabled=true`
  - `diagnosticsOnly=false`
  - `applyEnabled=true`
  - `applyError=null`
  - comparison status `matched`, reason `desired_generation_matches_bridge_live_lines`
  - current desired line count `0` because the market session is quiet.
- `pnpm run replit:config:status`: pass; startup files remain locked/read-only.
- Next recommended step:
  - Monitor the next non-quiet live-demand window. The desktop-hosted sidecar path is healthy; current validation cannot prove non-empty subscriptions because the desired generation is empty during the quiet session.

## Pickup Regression Check - 2026-06-02 07:23 MT

- User asked to pick up this IBKR data-line workstream.
- Live post-pickup state:
  - API health is `200`.
  - `/api/session` shows the desktop helper online on expected helper `2026-06-02.ib-async-sidecar-v2`, upgrade not required, and reconnect available.
  - `/api/session` also shows `ibkrBridge=null` and `runtime.ibkr.runtimeOverrideActive=false`; no runtime override file was present in the checked local/runtime paths.
  - `/api/settings/ibkr-line-usage` shows `applyTarget="ib-async-sidecar"`, `routingEnabled=true`, `diagnosticsOnly=false`, and `applyEnabled=true`, but `applyError="IBKR async sidecar request failed."`
  - `/api/ibkr/desktops` shows desktop `desktop-EASYSTREET-c572024619f59c20` online on helper v2.
- Interpretation: the code/env path is still on sidecar routing, but the API lost its desktop bridge proxy attachment, so sidecar apply cannot reach the desktop-hosted sidecar.
- Reconnect attempts:
  - Job `0474691529e4982a23cd6ee0d84956c8` did not attach a runtime override during the first poll window.
  - Job `6191fbe1262dd666ab308bccf36148eb` was claimed by the desktop helper and activation progress reached `waiting_gateway` / `launching_gateway` with `Launching IB Gateway. Log in if prompted.`
- The PYRUS app restarted during the second poll. Flight recorder recorded `same-container-supervisor-abrupt` at `2026-06-02T13:21:59Z`; post-restart API is healthy but still has no bridge override.
- Next step: queue a fresh reconnect from the new API process, then verify the bridge override, sidecar proxy, and `/api/settings/ibkr-line-usage` once attached. If activation remains at `waiting_gateway`, the desktop Gateway login/startup is the live blocker.

## Review and Tunnel Refresh - 2026-06-01 23:09 MT

- User asked to check the work.
- Reviewed the full IBKR sidecar slice, including:
  - API sidecar client/routing: `artifacts/api-server/src/services/ibkr-async-sidecar-client.ts`, `ibkr-sidecar-generation.ts`, `ibkr-line-usage.ts`.
  - Shared contracts: `lib/ibkr-contracts/src/market-data-sidecar.ts`.
  - Desktop bridge route/provider path: `artifacts/ibkr-bridge/src/app.ts`, `provider.ts`, `service.ts`, `tws-provider.ts`.
  - Windows helper and bundle packaging: `scripts/windows/pyrus-ibkr-helper.ps1`, `scripts/package-ibkr-bridge-bundle.mjs`.
  - Python sidecar source/tests under `python/ibkr_sidecar`.
- Validation run:
  - `pnpm --filter @workspace/api-server exec node --import tsx --test src/services/ibkr-async-sidecar-client.test.ts src/services/ibkr-sidecar-generation.test.ts src/services/ibkr-line-usage.test.ts src/services/ibkr-bridge-runtime.test.ts`: pass, 51 tests.
  - `artifacts/api-server/node_modules/.bin/tsx --test artifacts/ibkr-bridge/src/tws-provider.test.ts`: pass, 52 tests.
  - `pnpm --filter @workspace/api-server run typecheck`: pass.
  - `pnpm --filter @workspace/ibkr-bridge run typecheck`: pass.
  - `pnpm --filter @workspace/api-server run build`: pass.
  - `pnpm --filter @workspace/ibkr-bridge run build`: pass.
  - `PYTHONPATH=python/ibkr_sidecar/src .pythonlibs/bin/python3 -m pytest python/ibkr_sidecar/tests`: pass, 10 tests, existing FastAPI/Starlette `httpx` deprecation warning only.
  - `PYTHONPATH=python/ibkr_sidecar/src .pythonlibs/bin/python3 -m ruff check python/ibkr_sidecar/src python/ibkr_sidecar/tests`: pass.
  - `PYTHONPATH=python/ibkr_sidecar/src .pythonlibs/bin/python3 -m mypy python/ibkr_sidecar/src`: pass.
  - `node scripts/package-ibkr-bridge-bundle.mjs`: pass; bundle rebuilt.
  - `pnpm run audit:replit-startup`: pass.
  - Scoped `git diff --check` for sidecar/review files: pass.
- Review finding:
  - During live validation the active Cloudflare tunnel began returning `530` HTML for `/healthz`, `/async-sidecar/health`, and `/async-sidecar/market-data/generation`.
  - Line usage reflected the transient outage as `applyError="IBKR async sidecar returned 530 <none>."`.
  - Desktop helper heartbeat stayed online at helper `2026-06-02.ib-async-sidecar-v2`, so this was a stale tunnel/runtime issue rather than a helper-version issue.
- Corrective action:
  - Queued reconnect job `05cc444606b150dfca603beae4301867`; full payload with tokens is stored at `/tmp/ibkr-remote-launch-sidecar-v2-review-reconnect.json` and must not be copied into user-facing output.
  - Runtime override refreshed at `2026-06-02T05:08:16.195Z`.
- Final live status after reconnect:
  - `/api/session`: expected helper v2, actual helper v2, upgrade required false, desktop online true, bridge reachable true, health fresh true, socket connected true, strict ready true.
  - `/api/settings/ibkr-line-usage`: `applyTarget="ib-async-sidecar"`, `routingEnabled=true`, `diagnosticsOnly=false`, `applyEnabled=true`, `applyError=null`, comparison status `matched`, desired line count `0`.
- Residual limitation:
  - Still only validated an empty desired generation because the current market-data session is quiet. Next live proof point is the first non-empty generation during a non-quiet demand window.

## Live Bridge Up, Sidecar Bundle Pending - 2026-06-02 07:34 MT

- User reported the bridge should be up.
- Confirmed bridge recovery:
  - `/api/session`: runtime override active, desktop helper online, helper `2026-06-02.ib-async-sidecar-v2`, bridge connected/authenticated, socket connected, live market-data mode, `strictReady=true`.
  - `/api/settings/ibkr-line-usage`: sidecar route enabled with `applyTarget="ib-async-sidecar"` and `applyEnabled=true`.
- Live non-empty demand is now present. Desired line counts varied during polling from 25 to 200 lines.
- Current blocker moved from bridge attachment to Python sidecar subscription:
  - Direct bridge proxy `/async-sidecar/health`: `200`, service healthy, but live line count `0` and failed line count non-zero.
  - Direct bridge proxy `/async-sidecar/market-data/generation`: `200`, source `ib-async-sidecar`, but desired lines are failed with `Contract ... can't be hashed because no 'conId' value exists`.
- Local fix state:
  - `python/ibkr_sidecar/src/pyrus_ibkr_sidecar/ib_async_adapter.py` now qualifies contracts before `reqMktData` and rejects unqualified/ambiguous contracts before the `ib_async` wrapper hash path.
  - `python/ibkr_sidecar/tests/test_ib_async_adapter.py` covers qualification returning `None` and unqualified `conId=0`.
  - Validation passed: full sidecar `pytest` suite, sidecar `ruff`, sidecar `mypy`, API build, and bridge bundle packaging.
- Deployment state:
  - API route serves helper script with `$HelperVersion = '2026-06-02.ib-async-sidecar-v3'`.
  - API route serves bundle hash `f3d1995fe13fe6c2b5f9286ecb48d305aa77825048f3f498e9c8a8a4f68856ce`.
  - Active desktop bridge reports runtime build `d2714e7bb55fa6e8cc6583a81b57a032f2a8fee496db1084b8d4169ba8594575`, so it has not adopted the new bundle.
  - Running API process still advertises expected helper v2; a v2 reconnect job was queued as `3ed6728e41eb363e504d57a0acadc856`, but that cannot force helper self-update to v3.
- Next step: user must restart via default Replit **Run Replit App** so the live API advertises helper v3. Then queue a desktop reconnect; the v2 desktop agent should self-update to v3, download the `f3d1995...` bundle, restart the Python sidecar, and line-usage should be rechecked for no `conId` hash failures.

## v3 Bundle Adopted, v4 Sidecar Port Cleanup Built - 2026-06-02 07:47 MT

- User restarted Replit; live API then advertised expected helper `2026-06-02.ib-async-sidecar-v3`.
- Queued reconnect job `7485bef45f836e8e46a8d633a95a2154`.
- v3 desktop update succeeded:
  - `/api/session`: helper v3, expected helper v3, upgrade not required, bridge strict-ready.
  - Direct bridge `/healthz`: runtime build `f3d1995fe13fe6c2b5f9286ecb48d305aa77825048f3f498e9c8a8a4f68856ce`, matching the API-served bundle hash.
- The Python sidecar still reported failed desired lines with the old `Contract ... can't be hashed because no 'conId' value exists` error after v3. This means the bundle changed and the Node bridge restarted, but the old Python sidecar process survived on port `18769`.
- Implemented v4 helper fix:
  - Bumped `scripts/windows/pyrus-ibkr-helper.ps1` and API expected helper to `2026-06-02.ib-async-sidecar-v4`.
  - Added `Stop-SidecarPortProcess` using `netstat` owner discovery for sidecar port `18769`.
  - `Stop-BridgeLaunchChildProcesses` now also calls sidecar port cleanup.
  - `Ensure-LocalBridge` now force-restarts the sidecar when either the bundle changed or the helper self-updated during this run; helper self-update uses progress step `sidecar_restart_for_helper`.
- Validation:
  - `pnpm --filter @workspace/api-server run build`: pass.
  - `pnpm --filter @workspace/api-server exec node --import tsx --test src/services/ibkr-bridge-runtime.test.ts`: pass, 30 tests.
  - Scoped `git diff --check` for helper/runtime files: pass.
- Current live caveat: running API still expects helper v3 until another default Replit **Run Replit App** restart loads the rebuilt v4 dist. After restart, queue reconnect and verify helper v4 plus no `conId` hash failures.

## v5 Helper Adopted and Data-Line Sidecar Verified - 2026-06-02 08:04 MT

- User restarted the default Replit **Run Replit App** entry after the v5 helper/bridge diagnostic patch.
- Running API now serves `$HelperVersion = '2026-06-02.ib-async-sidecar-v5'`.
- Desktop heartbeat updated to helper `2026-06-02.ib-async-sidecar-v5`; `/api/session` reports expected helper v5, upgrade required false, bridge authenticated, socket connected, and `strictReady=true`.
- Direct bridge proxy checks through the active runtime override:
  - `/async-sidecar/health`: `200`, service `pyrus-ibkr-sidecar`, `failedLineCount=0`.
  - `/async-sidecar/market-data/generation`: `200`, source `ib-async-sidecar`, mode `executor`, `failedLineCount=0`.
- `/api/settings/ibkr-line-usage` re-applied the current desired generation and stabilized for four polls:
  - `sidecar.applyError=null`
  - comparison `matched`
  - desired/bridge/live line counts `6`
  - `liveEquityLineCount=3`
  - `liveOptionLineCount=3`
  - `failedLineCount=0`
  - throttled `false`
- The earlier `Contract ... can't be hashed because no 'conId' value exists` failures are gone.
- Final spot check at `2026-06-02T14:05:46Z`: current demand had moved to 3 option lines; comparison stayed `matched`, `sidecar.applyError=null`, `failedLineCount=0`, and no hash/conId errors.
- No IBKR data-line blocker remains. If hydration regresses, probe bridge tunnel health and `/async-sidecar/health` before changing code.

## Real/Shadow Position Data-Line Coverage Closed - 2026-06-02 13:59 MT

- User restarted the Replit app again and asked to recheck that every real and shadow position has an IBKR data line.
- Fresh runtime after the final patch:
  - API process started at `2026-06-02 13:56:04 MDT`.
  - `artifacts/api-server/dist/index.mjs` includes the latest `account-position-equity-quotes` owner path and the account-stream equity demand change.
  - `/api/healthz` returned `200` on both `8080` and `18747`.
- Remaining root cause found after the first explicit-owner fix:
  - Massive stock realtime is configured in the environment.
  - `getQuoteSnapshots` bypasses `fetchBridgeQuoteSnapshots` when Massive realtime is configured, so the account route's stock quote helper could still return marks without declaring IBKR bridge/admission leases.
  - `bridge-streams.ts` also skipped equity account-monitor requests when Massive realtime was configured.
- Final implementation:
  - `artifacts/api-server/src/services/account.ts`
    - Imports `admitMarketDataLeases`.
    - `fetchEquityQuoteSnapshotsForPositions` now explicitly declares account-monitor equity leases for open stock positions before fetching marks.
    - Owner is `account-position-equity-quotes:${accountKey}`; intent is `account-monitor-live`; fallback metadata is `cache`; TTL is `ACCOUNT_MONITOR_EQUITY_QUOTE_TTL_MS`.
  - `artifacts/api-server/src/services/bridge-streams.ts`
    - Account monitor no longer drops equity market-data requests just because Massive realtime is configured.
  - `artifacts/api-server/src/services/account-positions.test.ts`
    - Added source-level assertions that equity position hydration explicitly admits account-monitor leases.
  - `artifacts/api-server/src/services/bridge-streams-source.test.ts`
    - Updated regression contract so account monitor keeps IBKR equity position demand under Massive realtime.
- Validation:
  - `pnpm --filter @workspace/api-server exec node --import tsx --test src/services/account-positions.test.ts src/services/bridge-streams-source.test.ts src/services/bridge-quote-stream.test.ts`: pass, 42 tests.
  - `pnpm --filter @workspace/api-server run typecheck`: pass.
  - `pnpm --filter @workspace/api-server run build`: pass.
  - Scoped `git diff --check` for touched account/bridge stream files: pass.
- Live coverage audit after rebuild/restart:
  - Triggered `/api/accounts/U24762790/positions?mode=live`, `/api/accounts/shadow/positions`, and `/api/settings/ibkr-line-usage`.
  - Coverage: `6/6` open positions have desired data lines, missing `[]`.
  - Real account lines:
    - `FCEL` -> `equity:FCEL`, owners `account-monitor:live:all` and `account-position-equity-quotes:U24762790`.
    - `FRMI` -> `equity:FRMI`, owners `account-monitor:live:all` and `account-position-equity-quotes:U24762790`.
    - `INDI` -> `equity:INDI`, owners `account-monitor:live:all` and `account-position-equity-quotes:U24762790`.
  - Shadow lines:
    - `QBTS` option line covered by account-monitor/shadow/signal/automation owners.
    - `TQQQ` option line covered by account-monitor/shadow/signal/automation owners.
    - `AAOI` option line covered by account-monitor/shadow/signal/automation owners.
  - Account monitor summary: `neededLineCount=6`, `coveredLineCount=6`, `deferredLineCount=0`, `activeLineCount=6`, `remainingLineCount=194`.
  - Final sidecar state:
    - `applyPending=false`
    - `applyError=null`
    - `comparison.status="matched"`
    - `desiredLineCount=32`
    - `bridgeLineCount=32`
    - `matchedLineCount=32`
    - `desiredOnlyLineCount=0`
    - `bridgeOnlyLineCount=0`
- Current status:
  - Real and shadow account positions are accounted for by desired sidecar data lines.
  - The live sidecar bridge line set matches the API desired generation.
  - No remaining data-line coverage blocker found in the final audit.

## Flow Scanner Event Display Route-Admission Fix Built - 2026-06-02 14:24 MT

- Active thread goal remains broader than data-line coverage: get the flow scanner lane working and properly displaying flow events.
- Current runtime investigation:
  - `/api/settings/ibkr-lanes` was allowed and reported the flow scanner lane as normal with `94 of 94 symbols admitted; 0 active IBKR lines`.
  - `/api/flow/universe`, `/api/flow/events`, and `/api/flow/events/aggregate` returned `429 api-resource-pressure-high` because route admission classified `/api/flow/*` as `deferred-analytics`.
  - This explains the visible Flow tape/scanner display regression under current high API pressure: lane membership exists, but event reads are shed before the Flow runtime can consume snapshots.
- Used older repo history as context:
  - `a650e1a Keep flow scanner running globally` is the oldest directly relevant global-scanner commit.
  - Older route admission behavior from `3c122e8` used less aggressive high-pressure handling for deferred analytics; current work keeps the stricter policy for background analytics and only promotes explicitly visible flow reads.
- Implemented:
  - `artifacts/api-server/src/services/route-admission.ts`
    - Added active request families: `flow-visible`, `flow-scanner-visible`, `flow-tape-visible`.
    - `/flow/events`, `/flow/events/aggregate`, and `/flow/universe` now classify as `active-screen` when carrying visible-flow request context, otherwise remain shed-able deferred analytics.
  - `artifacts/pyrus/src/features/platform/useLiveMarketFlow.js`
    - Broad Flow scanner universe, aggregate, and per-symbol event requests now send:
      - `x-pyrus-request-family: flow-scanner-visible`
      - `x-pyrus-fetch-priority: 8`
  - `artifacts/api-server/src/services/route-admission.test.ts`
    - Covers visible flow reads surviving high API pressure while background scanner requests still shed.
  - `artifacts/pyrus/src/features/platform/platformRootSource.test.js`
    - Covers that the Flow runtime sends the visible-flow headers.
- Validation:
  - `pnpm --filter @workspace/api-server exec node --import tsx --test src/services/route-admission.test.ts`: pass, 10 tests.
  - `pnpm --filter @workspace/pyrus exec node --import tsx --test src/features/platform/marketFlowStore.test.js src/features/platform/marketFlowScannerConfig.test.js src/features/platform/platformRootSource.test.js src/features/flow/flowScannerStatusModel.test.js`: pass, 89 tests.
  - `pnpm --filter @workspace/pyrus exec node --import tsx --test src/features/platform/platformRootSource.test.js`: pass, 59 tests after adding header assertions.
  - `pnpm --filter @workspace/api-server run typecheck`: pass.
  - `pnpm --filter @workspace/api-server run build`: pass.
  - `pnpm --filter @workspace/pyrus run typecheck`: pass.
  - Scoped `git diff --check` for route admission and Flow runtime files: pass.
- Live verification caveat:
  - Built `artifacts/api-server/dist/index.mjs` at `2026-06-02 14:22:37 MDT`; it contains the new visible-flow classifier.
  - Running API process started earlier at `2026-06-02 14:18:42 MDT`, so the live process still served the old classifier and continued returning `429` for the header probes.
  - Next required action is a default Replit **Run Replit App** restart/reload. After reload, verify with headers:
    - `/api/flow/universe`
    - `/api/flow/events?underlying=AAOI&limit=20&blocking=false&queueRefresh=false`
    - `/api/flow/events/aggregate?limit=50&blocking=false&queueRefresh=false`
  - Expected post-reload headers: `x-pyrus-route-class=active-screen`, `x-pyrus-admission-action=allow` under high pressure.

## Flow Scanner Quiet-State Data Line Fix Built - 2026-06-02 14:50 MT

- Follow-up live check after the route-admission fix:
  - Visible Flow endpoints are now admitted by the running API process: aggregate Flow returned `200` with visible-flow headers and scanner coverage advancing.
  - Flow rows are still empty after NYSE regular trading hours. Direct visible scanner probes returned no events; this is expected when IBKR live option quote hydration cannot produce fresh quotes after the market session.
  - The running API process is still PID `41276`, started `2026-06-02 14:25:41 MDT`; the rebuilt bundle is newer at `2026-06-02 14:44:05 MDT`, so the final quiet-state source is not live until the app is restarted.
- Implemented:
  - `artifacts/api-server/src/services/platform.ts`
    - Market-session quiet live quote blocks now map to `options_flow_scanner_market_session_quiet` without surfacing a user-facing error.
    - Scanner diagnostics include `sessionBlockReason`, with a market-clock fallback outside regular trading hours.
    - After-hours empty scanner hydration results map to `options_flow_scanner_market_session_quiet` unless the real reason is no expirations.
  - `artifacts/pyrus/src/features/platform/runtimeControlModel.js`
    - Flow scanner line/detail now uses `sessionBlockReason` so the UI can show a detail such as `market session quiet; 30 of 94 covered...` instead of a generic/empty scanner lane.
  - Tests cover the after-hours quiet source and the line-usage display detail.
- Current live position coverage check:
  - `/api/positions?mode=live` returned 3 real IBKR positions: `FCEL`, `FRMI`, `INDI`.
  - `/api/accounts/shadow/positions` returned 3 shadow option positions: `AAOI`, `TQQQ`, `QBTS`.
  - `/api/settings/ibkr-line-usage` reported `accountMonitor.neededLineCount=6`, `coveredLineCount=6`, `deferredLineCount=0`, `activeLineCount=6`, `remainingLineCount=194`.
  - Account monitor line sample includes all six data lines: `equity:FCEL`, `equity:FRMI`, `equity:INDI`, and the three shadow option contract line IDs.
  - Shadow ownership shows `activeLineCount=3`, `leaseCount=6`, owner sample `shadow-position-day-change:mixed` and `shadow-risk-greek:mixed`.
- Validation:
  - `pnpm --filter @workspace/api-server exec node --import tsx --test --test-name-pattern 'market close as quiet|keeps realtime flow on IBKR by default when Massive' src/services/options-flow-scanner.test.ts`: pass, 2 tests.
  - `pnpm --filter @workspace/pyrus exec node --import tsx --test --test-name-pattern 'scanner session quiet renders as a data-line detail' src/features/platform/runtimeControlModel.test.js`: pass, 1 test.
  - Earlier full targeted runs in this work item passed:
    - `pnpm --filter @workspace/api-server exec node --import tsx --test src/services/options-flow-scanner.test.ts`: pass, 82 tests.
    - `pnpm --filter @workspace/pyrus exec node --import tsx --test src/features/platform/runtimeControlModel.test.js src/features/platform/flowSourceState.test.js src/features/platform/marketFlowStore.test.js src/features/flow/flowScannerStatusModel.test.js`: pass, 65 tests.
    - `pnpm --filter @workspace/api-server run typecheck`: pass.
    - `pnpm --filter @workspace/pyrus run typecheck`: pass.
    - `pnpm --filter @workspace/api-server run build`: pass.
- Next required live action:
  - Restart via Replit **Run Replit App** so the running API loads the rebuilt `dist/index.mjs`.
  - Post-restart checks should show `sessionBlockReason="market-session-quiet"` in `/api/settings/ibkr-line-usage` after hours and `ibkrReason="options_flow_scanner_market_session_quiet"` on direct scanner probes outside RTH.

## Flow Scanner Lane Runtime Detail Hardening - 2026-06-02 14:54 MT

- Follow-up frontend model gap:
  - The live line-usage payload had useful scanner progress under `optionsFlowScanner.coverage`/`radar`, but the UI model could still prefer a transient radar fallback reason over current scanner coverage.
  - This made the Flow scanner lane risk showing generic/paused text even while the scanner was rotating and coverage was advancing.
- Implemented:
  - `artifacts/pyrus/src/features/platform/runtimeControlModel.js`
    - Added scanner coverage normalization across `coverage`, `radar`, and top-level scanner fields.
    - Quiet/lagging/rotating scanner details now render coverage data such as `rotating; 30 of 746 covered, last 14s ago`.
    - Non-blocking radar fallback reasons (`radar-quote-batch-fallback`, `radar-quote-batch-fallback-empty`) no longer hide current scanner coverage.
  - `artifacts/pyrus/src/features/platform/runtimeControlModel.test.js`
    - Added regressions for radar-shaped quiet coverage, active rotation coverage, and radar quote fallback not hiding coverage.
- Live model check:
  - Current `/api/settings/ibkr-line-usage` payload through the patched model produced:
    - Flow scanner detail: `rotating; 30 of 746 covered, last 14s ago`
    - Account detail: `6 covered of 6 needed`
  - This proves the scanner lane will have a concrete data-line detail from the current live payload even before the API process reloads the final quiet-state backend build.
- Validation:
  - `pnpm --filter @workspace/pyrus exec node --import tsx --test src/features/platform/runtimeControlModel.test.js src/features/platform/flowSourceState.test.js src/features/platform/marketFlowStore.test.js src/features/flow/flowScannerStatusModel.test.js`: pass, 68 tests.
  - `pnpm --filter @workspace/pyrus run typecheck`: pass.
  - Scoped `git diff --check` for the latest runtime model files: pass.
- Remaining live caveat:
  - Full browser surface could not be reached on local loopback ports `5173`, `5174`, `8080`, `3000`, or `5000` during this check.
  - Running API process is still older than the final backend quiet-state build; a Replit **Run Replit App** restart is still required for backend `sessionBlockReason` and direct flow probe quiet-state reasons to show live.

## Flow Screen Browser QA + Premium Distribution Admission - 2026-06-02 15:02 MT

- Browser QA:
  - Replit preview `https://5950eeb6-fc7d-4b18-87e8-8d1c0536942f-00-36emsiuflovpf.riker.replit.dev/?pyrusQa=safe` was reachable.
  - Opened the visible Flow screen through the screen nav with Playwright.
  - The Flow scanner panel rendered a concrete scanner line detail:
    - `rotating; 60 of 746 covered, last 33s ago`
  - The Flow tape was still empty after hours:
    - `0 filtered prints`
    - `0 prints`
  - This is consistent with the current after-hours IBKR quote/session state rather than a scanner-lane display failure.
- Additional 429 found during browser QA:
  - `/api/flow/premium-distribution?limit=16&timeframe=today&coverageMode=universe`
  - Old live process classified it as `deferred-analytics` and shed it under high pressure.
- Implemented:
  - `artifacts/api-server/src/services/route-admission.ts`
    - `/flow/premium-distribution` now participates in the visible-flow active-screen route path when visible-flow headers are present.
  - `artifacts/pyrus/src/screens/FlowScreen.jsx`
    - Premium distribution requests now send:
      - `x-pyrus-request-family: flow-scanner-visible`
      - `x-pyrus-fetch-priority: 8`
  - `artifacts/api-server/src/services/route-admission.test.ts`
    - Covers visible premium-distribution reads surviving high API pressure while background analytics still sheds.
  - `artifacts/pyrus/src/features/platform/platformRootSource.test.js`
    - Covers that the Flow premium-distribution hook sends the visible-flow request options.
- Validation:
  - `pnpm --filter @workspace/api-server exec node --import tsx --test src/services/route-admission.test.ts`: pass, 11 tests.
  - `pnpm --filter @workspace/pyrus exec node --import tsx --test --test-name-pattern 'Flow page premium distribution widgets use Massive summary endpoint|Flow page scanner uses one broad scanner panel|shared flow hydrates visible flow' src/features/platform/platformRootSource.test.js`: pass, 3 tests.
  - `pnpm --filter @workspace/pyrus exec node --import tsx --test src/features/platform/runtimeControlModel.test.js src/features/platform/flowSourceState.test.js src/features/platform/marketFlowStore.test.js src/features/flow/flowScannerStatusModel.test.js`: pass, 68 tests.
  - `pnpm --filter @workspace/api-server run typecheck`: pass.
  - `pnpm --filter @workspace/pyrus run typecheck`: pass.
  - `pnpm --filter @workspace/api-server run build`: pass.
  - Built `artifacts/api-server/dist/index.mjs` at `2026-06-02 15:00:57 MDT`; it contains `/flow/premium-distribution`, `sessionBlockReason`, and `options_flow_scanner_market_session_quiet`.
- Known unrelated validation note:
  - Running the entire `platformRootSource.test.js` file currently fails at `hidden-mounted Algo and Backtest queries require visible screen ownership` (`Algo nested preload block must be present`).
  - The targeted Flow source tests pass; this unrelated failure was not introduced by the Flow scanner/premium distribution changes.
- Remaining live caveat:
  - Running API process PID `41276` is still from `2026-06-02 14:25:41 MDT`, older than the rebuilt bundle.
  - Replit **Run Replit App** restart/reload is still required for backend quiet-state and premium-distribution admission changes to become live.

## Follow-Up Live Check - 2026-06-02 15:08 MT

- Live direct API checks:
  - `/api/flow/events/aggregate?limit=100&blocking=false&queueRefresh=false` with visible Flow headers returned `200`, route class `active-screen`, `events=1`, provider `ibkr`, status `live`, `ibkrStatus=loaded`.
  - Scanner coverage in that response was active: `90` of `746` covered with current batch including `BWXT`, `ETN`, `PWR`, `POWL`, `IONQ`, `RGTI`, `QBTS`, `MSTR`, and others.
  - `/api/flow/premium-distribution?limit=16&timeframe=today&coverageMode=universe` returned `200` with visible headers in direct curl because current pressure allowed it, but the live header still reported route class `deferred-analytics`.
- Browser safe-QA check:
  - Safe-QA Flow navigation still showed `0 filtered prints`; this is expected because `?pyrusQa=safe` disables the broad Flow runtime in `PlatformApp`, so it is not a valid end-to-end Flow tape event check.
  - The browser request for premium distribution did include:
    - `x-pyrus-request-family: flow-scanner-visible`
    - `x-pyrus-fetch-priority: 8`
  - The live API still classified that browser request as `deferred-analytics` and shed it with `429`, proving the running API process has not loaded the rebuilt route-admission bundle yet.
- IBKR real/shadow position line audit:
  - `accountMonitor.neededLineCount=6`, `coveredLineCount=6`, `activeLineCount=6`, `deferredLineCount=0`.
  - Covered real equity lines: `FCEL`, `FRMI`, `INDI`.
  - Covered shadow option lines: `AAOI 20260605 205C`, `QBTS 20260605 29.5C`, `TQQQ 20260605 86C`.
  - Shadow account summary: `activeLineCount=3`, `leaseCount=6`, `ownerCount=2`, `recentRejectedCount=0`.
- Process/build state:
  - Running API PID `41276` still started at `2026-06-02 14:25:41 MDT`.
  - Built `artifacts/api-server/dist/index.mjs` is newer (`2026-06-02 15:00:57 MDT`) and contains `/flow/premium-distribution`, `flow-scanner-visible`, `sessionBlockReason`, and `options_flow_scanner_market_session_quiet`.
- Validation:
  - `pnpm --filter @workspace/api-server exec node --import tsx --test src/services/route-admission.test.ts`: pass, 11 tests.
  - `pnpm --filter @workspace/pyrus exec node --import tsx --test --test-name-pattern 'Flow page premium distribution widgets use Massive summary endpoint|flow scanner uses backend aggregate flow for broad scans|shared flow hydrates visible flow' src/features/platform/platformRootSource.test.js`: pass, 3 tests.
- Required live action:
  - Restart via Replit **Run Replit App** so the running API process loads the rebuilt backend bundle. Until then, direct aggregate Flow can show events, but premium-distribution route classification and backend quiet-state diagnostics are still served by the old process.

## Post-Restart Verification - 2026-06-02 16:16 MT

- Replit app was restarted by the user.
- Process state:
  - API `dist/index.mjs` PID `61924`, started `2026-06-02 16:14:05 MDT`.
  - Vite PID `62026`, started `2026-06-02 16:14:06 MDT`.
- Live endpoint checks:
  - `/api/flow/premium-distribution?limit=16&timeframe=today&coverageMode=universe` with visible Flow headers returned `200`, route class `active-screen`, admission `allow`, `widgets=15`, provider `massive`, hydration status `partial`.
  - Safe browser QA Flow screen request for the same premium-distribution endpoint included `x-pyrus-request-family: flow-scanner-visible` and `x-pyrus-fetch-priority: 8`; response was `200`, route class `active-screen`, admission `allow`.
  - `/api/flow/events?underlying=AAOI&limit=50&blocking=true&queueRefresh=true` with visible Flow headers returned `200`, route class `active-screen`, admission `allow`, `events=0`, source `status=empty`, `errorMessage=null`, `ibkrReason=options_flow_scanner_market_session_quiet`, `ibkrContractCount=1`, `ibkrLiveCandidateCount=1`, `ibkrAcceptedQuoteCount=0`, `ibkrRejectedQuoteCount=1`.
  - `/api/flow/events/aggregate?limit=100&blocking=false&queueRefresh=false` with visible Flow headers returned `200`, route class `active-screen`, admission `allow`, `events=0`, source `ibkrReason=options_flow_scanner_queued`, scanner coverage `30` of `746`, current batch starting `SPY`, `NVDA`, `DIA`, `AAPL`, `MSFT`, `TSLA`, `TQQQ`, `SQQQ`.
- Safe browser QA Flow screen:
  - Flow scanner lane rendered a concrete data line: `market session quiet; 30 of 746 covered, last 35s ago`.
  - Premium distribution rendered with the Massive warning text instead of route shedding.
  - Live Flow Tape showed `0 filtered prints`, which is expected after-hours quiet behavior with no available IBKR flow prints.
- IBKR line audit after restart:
  - Account monitor: `needed=6`, `covered=6`, `deferred=0`, `active=6`, `leases=9`, `owners=3`.
  - Covered real equity lines: `FCEL`, `FRMI`, `INDI`.
  - Covered shadow option lines: `AAOI 20260605 205C`, `QBTS 20260605 29.5C`, `TQQQ 20260605 86C`.
  - Shadow account: `active=3`, `leases=9`, `owners=3`, `recentRejected=0`; owners include `shadow-position-day-change:mixed`, `shadow-position-visible:mixed`, `shadow-risk-greek:mixed`.
- Outcome:
  - The restart loaded the rebuilt backend. Premium distribution admission is fixed live.
  - Flow scanner lane is no longer empty; it shows session-quiet coverage from the scanner.
  - Broker-history-error on direct after-hours flow probes is fixed live; it now reports market-session quiet cleanly.

## After-Hours Last Flow Replay - 2026-06-02

- User clarified that after-hours Flow should still show the last registered Flow events in the Flow lane, not an empty tape.
- Root cause:
  - In-memory quiet-state preservation already existed in `marketFlowStore`, but it only helped while the current frontend session still had prior events.
  - After a backend or frontend restart, the broad Flow store had no previous in-memory snapshot, and after-hours quiet snapshots could arrive empty first.
- Implemented:
  - `artifacts/pyrus/src/features/platform/marketFlowStore.js` now persists the last broad Flow snapshot with real flow events to localStorage.
  - Fresh broad Flow reads hydrate that snapshot for up to 72 hours, cap cached arrays, mark it `staleFlowEvents=true`, and keep quiet/queued provider diagnostics from the current empty snapshot.
  - Confirmed loaded-empty broad Flow responses clear the cached replay, so stale prints are not resurrected outside quiet/degraded states.
  - Persistence is scoped to the broad Flow lane only, not per-chart Flow stores.
- Validation:
  - `pnpm --filter @workspace/pyrus exec node --import tsx --test src/features/platform/marketFlowStore.test.js src/features/platform/flowSourceState.test.js`: pass, 21 tests.
  - `pnpm --filter @workspace/pyrus run typecheck`: pass.
  - Safe browser QA with `?pyrusQa=safe` seeded a cached last broad Flow event, opened Flow from persisted screen state, and confirmed `rowCount=1`, `hasLastFlow=true`, `hasSpy=true`, `hasFilteredPrints=true`, and `hasContract=true`.
  - Scoped `git diff --check` for `marketFlowStore.js` and `marketFlowStore.test.js`: pass.
- Operational note:
  - This can replay the last broad Flow event registered after the patch starts persisting snapshots. It cannot retroactively reconstruct a pre-patch last event if no cached snapshot exists in the browser yet.

## Flow Lane Durable 100-Event Hydration - 2026-06-02 23:10 UTC

- User requested code-level verification without browser QA: Flow lane success means the flow scan lane is hydrated with the most recent 100 registered flow events after hours.
- Exact root cause:
  - `/api/flow/events/aggregate` previously depended on `optionsFlowScanner.listSnapshots(...)`.
  - Those snapshots are process memory. After an API restart or quiet after-hours session, scanner memory can be empty even when durable registered flow rows exist in `flow_events`.
  - Older repo history still used the aggregate endpoint for broad scans; it worked when scanner memory was warm and had no durable latest-row fallback.
- Backend fix:
  - `historical-flow-events.ts` exports `listRecentStoredHistoricalFlowEvents(...)`, reading recent Massive rows from `flowEventsTable` ordered by `occurredAt DESC`, then applying request filters and limits.
  - `platform.ts` merges scanner snapshot rows with recent durable rows, dedupes them, sorts by event recency, and returns the requested limit. Stored-only after-hours responses identify source provider `massive`, status `fallback`, and reason `options_flow_historical_store`.
- Frontend fix:
  - Added `FLOW_SCANNER_AGGREGATE_EVENT_LIMIT = 100`.
  - `useLiveMarketFlow` now requests at least 100 aggregate events for backend broad scans.
  - Header flow lane now builds up to 100 newest flow tape items instead of 28, tied to the same aggregate hydration constant.
- Code-path proof:
  - `BroadFlowScannerRuntime` calls `useLiveMarketFlow(..., { blocking: false, scannerConfig: allWatchlistsPlusUniverse })`.
  - `useLiveMarketFlow` calls `/api/flow/events/aggregate` with a minimum 100-event limit.
  - The resulting `flowEvents` are published to `BROAD_MARKET_FLOW_STORE_KEY`.
  - `HeaderBroadcastScrollerStack` and Flow screen read that broad store; non-empty Massive fallback rows set `hasLiveFlow=true` and provider label `Massive trade fallback`, so the lane should not render `NO FLOW` or stay at `FLOW SCANNING`.
- Live API code/data check:
  - Direct aggregate endpoint returned `count=100`, `provider=massive`, `status=fallback`, `fallbackUsed=true`, `ibkrReason=options_flow_historical_store`.
  - Events were sorted descending; newest observed row was `2026-06-02T19:59:55.654Z`, oldest of the returned 100 was `2026-06-01T17:43:27.042Z`.
- Validation:
  - PASS: `pnpm --filter @workspace/pyrus exec node --import tsx --test src/features/platform/marketFlowScannerConfig.test.js src/features/platform/headerBroadcastModel.test.js src/features/platform/platformRootSource.test.js` - 89 tests.
  - PASS: `pnpm --filter @workspace/pyrus run typecheck`.
  - PASS: `pnpm --filter @workspace/api-server exec node --import tsx --test src/services/historical-flow-events.test.ts` - 14 tests.
  - PASS: `pnpm --filter @workspace/api-server exec node --import tsx --test src/services/options-flow-scanner.test.ts --test-name-pattern listAggregateFlowEvents` - 83 tests.
  - PASS: `pnpm --filter @workspace/api-server run typecheck`.
  - PASS: `pnpm --filter @workspace/api-server run build`.
  - PASS: `pnpm --filter @workspace/pyrus run build`.
  - PASS: scoped `git diff --check`.

## Header Flow Still `NO FLOW` - 2026-06-02 23:22 UTC

- User clarified the header Flow scanner lane still showed `NO FLOW`.
- Additional root cause:
  - The header Flow lane is global, but `buildPlatformWorkSchedule` only enabled `broadFlowRuntime` on the Flow screen or on Market after passive discovery gates passed.
  - On Account, Trade, Algo, Signals, etc., the header was mounted but no broad Flow runtime was hydrating `BROAD_MARKET_FLOW_STORE_KEY`.
  - That means the API could return 100 events and the pill builder could produce 100 items, while the header still rendered `NO FLOW` because its store stayed empty.
- Fix:
  - `appWorkScheduler.js` now enables `broadFlowRuntime` for any visible, session-ready screen after first-screen warmup and startup protection clear.
  - Mobile is no longer Flow-screen-only for broad Flow runtime.
  - Existing hidden-page, session-unsettled, startup-protection, and active-background-warmup gates still block it.
- Validation:
  - PASS: `pnpm --filter @workspace/pyrus exec node --import tsx --test src/features/platform/appWorkScheduler.test.js` - 29 tests.
  - PASS: `pnpm --filter @workspace/pyrus exec node --import tsx --test src/features/platform/appWorkScheduler.test.js src/features/platform/marketFlowScannerConfig.test.js src/features/platform/headerBroadcastModel.test.js src/features/platform/platformRootSource.test.js src/features/platform/marketFlowStore.test.js` - 133 tests.
  - PASS: `pnpm --filter @workspace/pyrus run typecheck`.
  - PASS: `pnpm --filter @workspace/pyrus run build`.
  - PASS: scoped `git diff --check`.

## Header Flow Runtime Background-Gate Fix - 2026-06-02 17:36 MT

- User reported the Replit preview still showed `NO FLOW` / `FLOW SCANNING` and asked whether Flow was tracking from today.
- Direct live data proof:
  - `GET /api/flow/events/aggregate?limit=100&blocking=false&queueRefresh=false` with visible Flow headers returned `200`, route class `active-screen`, admission `allow`, and `100` events.
  - Newest event was `QBTS` from `2026-06-02T20:00:00.000Z`, provider `ibkr`, premium `213490`.
  - The returned source reported scanner coverage around `90+` symbols and included both IBKR scanner rows and Massive durable fallback rows.
  - Replaying the live payload through `mapFlowEventToUi`, `filterFlowScannerEvents`, `filterFlowTapeEvents`, and `buildHeaderUnusualTapeItems` produced `100` header pills, so API data, mapping, filters, and pill building were not the blocker.
- Additional root cause found:
  - Runtime logs showed recent preview Flow reads were per-symbol `/api/flow/events`, not broad `/api/flow/events/aggregate`.
  - `appWorkScheduler.js` had been changed to allow broad Flow across screens, but `PlatformApp.jsx` still passed `activeScreenBackgroundDataAllowed` into `buildPlatformWorkSchedule`.
  - `activeScreenBackgroundDataAllowed` is false on mobile and whenever the active screen has not opened its heavier background-data gate. That can keep `BroadFlowScannerRuntime` disabled while the header still shows backend scanner status from line-usage diagnostics.
- Fix:
  - `artifacts/pyrus/src/features/platform/appWorkScheduler.js`: broad Flow runtime no longer depends on `activeBackgroundReady`; it still requires session ready, visible page, first-screen warmup, startup protection clear, and pressure caps.
  - `artifacts/pyrus/src/features/platform/PlatformApp.jsx`: the scheduler now receives raw `activeScreenBackgroundAllowed`, not `activeScreenBackgroundDataAllowed`, so header Flow hydration is not blocked by mobile/background warmup.
  - `artifacts/pyrus/src/features/platform/appWorkScheduler.test.js` and `platformRootSource.test.js` updated to guard this behavior.
- Validation:
  - PASS: `pnpm --filter @workspace/pyrus exec node --import tsx --test src/features/platform/appWorkScheduler.test.js src/features/platform/platformRootSource.test.js src/features/platform/marketFlowScannerConfig.test.js src/features/platform/headerBroadcastModel.test.js src/features/platform/marketFlowStore.test.js` - 133 tests.
  - PASS: `pnpm --filter @workspace/pyrus run typecheck`.
  - PASS: `pnpm --filter @workspace/pyrus run build`.
  - PASS: scoped `git diff --check` for the scheduler/runtime files and this handoff.
- Operational note:
  - Vite should HMR the frontend patch in the running Replit app. If the preview still shows the old state, refresh the preview tab once so it reconnects to the updated module graph.

## Header Flow Direct Aggregate Fallback - 2026-06-02 17:48 MT

- User reported the preview still only showed `SYNCING`.
- Follow-up interpretation:
  - `SYNCING` means the header has a visible broad Flow snapshot, but the snapshot still has `flowStatus="loading"` and no events.
  - Since direct API and pure client replay both produced 100 events/pills, the remaining failure mode is the header waiting behind the broad runtime/store path in the actual browser.
- Implemented:
  - `artifacts/pyrus/src/features/platform/HeaderBroadcastScrollerStack.jsx` now has a direct visible aggregate fallback.
  - While `BROAD_MARKET_FLOW_STORE_KEY` has no stored events, the header itself calls `/api/flow/events/aggregate` through the generated API client with:
    - `x-pyrus-request-family: flow-scanner-visible`
    - `x-pyrus-fetch-priority: 8`
    - `limit=FLOW_SCANNER_AGGREGATE_EVENT_LIMIT` (`100`)
  - The fallback maps and filters the returned events with the same `mapFlowEventToUi`, `filterFlowScannerEvents`, `filterFlowTapeEvents`, and `buildHeaderUnusualTapeItems` path.
  - Once the broad store has events, the header uses the store as before.
- Validation:
  - PASS: `pnpm --filter @workspace/pyrus exec node --import tsx --test src/features/platform/platformRootSource.test.js src/features/platform/headerBroadcastModel.test.js src/features/platform/marketFlowScannerConfig.test.js` - 90 tests.
  - PASS: `pnpm --filter @workspace/pyrus run typecheck`.
  - PASS: `pnpm --filter @workspace/pyrus run build`.
  - PASS: scoped `git diff --check`.

## Header Flow Pills Missing - 2026-06-02 23:16 UTC

- User asked why no pills were coming through the header Flow scanner lane.
- Code-level replay:
  - Direct `/api/flow/events/aggregate?limit=100` returned 100 events.
  - Replaying that payload through `mapFlowEventToUi`, `filterFlowTapeEvents`, and `buildHeaderUnusualTapeItems` produced 100 header items.
  - Therefore the payload, mapper, filters, and pill builder were not the blocker.
- Exact root cause:
  - `BroadFlowScannerRuntime` cleared `BROAD_MARKET_FLOW_STORE_KEY` whenever `runtimeActive` was false.
  - `runtimeActive` can be false because of scheduler/preload/screen gating, not because the Flow feed has confirmed no events.
  - Header status can still show scanner activity from backend diagnostics via `useRuntimeControlSnapshot`, so the header rendered `FLOW SCANNING` while `rawUnusualEvents` stayed empty from the cleared frontend broad store.
- Fix:
  - Removed the inactive-runtime clear from `MarketFlowRuntimeLayer.jsx`.
  - The broad flow snapshot is still cleared on actual runtime unmount, but it is no longer wiped by ordinary scheduler inactivity.
  - Updated the source test to reject the inactive clear pattern.
- Validation:
  - PASS: focused source/pill tests with `--test-name-pattern 'shared flow hydrates visible flow while broad scanner stays broad and nonblocking|Broad scanner owns Flow across the visible app after startup|flow scanner uses backend aggregate flow for broad scans|header flow scanner lane applies the shared Flow tape filters|buildHeaderUnusualTapeItems keeps the latest 100 scanner events'`.
  - PASS: `pnpm --filter @workspace/pyrus exec node --import tsx --test src/features/platform/marketFlowScannerConfig.test.js src/features/platform/headerBroadcastModel.test.js src/features/platform/platformRootSource.test.js src/features/platform/marketFlowStore.test.js` - 103 tests.
  - PASS: `pnpm --filter @workspace/pyrus run typecheck`.
  - PASS: `pnpm --filter @workspace/pyrus run build`.
  - PASS: scoped `git diff --check`.

## Cleanup Commits - 2026-06-03 UTC

- User confirmed the Replit preview now shows header Flow and asked to commit, then clean up and merge/commit finished worktree items that are not currently in-flight.
- Committed the confirmed Flow/header frontend fix:
  - `2b91c37 fix: hydrate header flow lane from scanner activity`
  - Scope: broad Flow runtime scheduler gates, retained broad snapshot behavior, header direct aggregate fallback, 100-event header pills, Flow scanner status/runtime activity display, and source/unit guards.
  - Validation before commit:
    - `pnpm --filter @workspace/pyrus exec node --import tsx --test src/features/platform/platformRootSource.test.js src/features/platform/headerBroadcastModel.test.js src/features/platform/marketFlowScannerConfig.test.js src/features/platform/appWorkScheduler.test.js src/features/platform/marketFlowStore.test.js src/features/platform/runtimeControlModel.test.js src/features/flow/flowScannerStatusModel.test.js` - 183/183 pass.
    - Staged `git diff --check` - pass.
- Committed the backend durable Flow aggregate backfill:
  - `9e3bcf2 fix: backfill aggregate flow from durable rows`
  - Scope: `listRecentStoredHistoricalFlowEvents(...)`, aggregate Flow snapshot+durable row merge/dedupe/recency sort, stored-only fallback source metadata, and focused source guards.
  - Validation before commit:
    - `pnpm --filter @workspace/api-server exec node --import tsx --test src/services/historical-flow-events.test.ts src/services/options-flow-scanner.test.ts --test-name-pattern "historical aggregate flow|listAggregateFlowEvents"` - 97/97 pass.
    - Staged `git diff --check` - pass.
- Committed the completed IBKR async sidecar/line-usage slice:
  - `0dc20f9 feat: route IBKR line usage through async sidecar`
  - Scope: shared market-data generation contracts, API desired-generation builder/client/coordinator, bridge generation apply/proxy endpoints, Python `ib_async` sidecar scaffold/tests, Windows helper packaging/startup, and development-only Replit routing flag.
  - Validation before commit:
    - `pnpm --filter @workspace/api-server exec node --import tsx --test src/services/ibkr-sidecar-generation.test.ts src/services/ibkr-async-sidecar-client.test.ts src/services/ibkr-line-usage.test.ts` - 27/27 pass.
    - `pnpm --filter @workspace/api-server exec node --import tsx --test ../ibkr-bridge/src/tws-provider.test.ts --test-name-pattern "market data generation"` - 52/52 pass.
    - `PYTHONPATH=python/ibkr_sidecar/src .pythonlibs/bin/python3 -m pytest python/ibkr_sidecar/tests` - 12/12 pass, existing FastAPI/Starlette `httpx` deprecation warning only.
    - `PYTHONPATH=python/ibkr_sidecar/src .pythonlibs/bin/python3 -m ruff check python/ibkr_sidecar/src python/ibkr_sidecar/tests` - pass.
    - `PYTHONPATH=python/ibkr_sidecar/src .pythonlibs/bin/python3 -m mypy python/ibkr_sidecar/src` - pass.
    - `pnpm --filter @workspace/api-server run typecheck` - pass.
    - `pnpm --filter @workspace/ibkr-bridge run typecheck` - pass.
    - `pnpm --filter @workspace/ibkr-contracts exec tsc -p tsconfig.json --noEmit` - pass.
    - `pnpm run audit:replit-startup` - pass, required because `.replit` was committed.
    - Staged `git diff --check` - pass.
- Current branch state after cleanup commits: `main...origin/main [ahead 3]`.
- Follow-up Flow pill age commit:
  - `3fc2813 fix: show flow event age in header pills`
  - Scope: header unusual Flow item model now carries `ageLabel` from the shared Flow tape age formatter; the pill renders that label, with fallback to the existing relative formatter for older item shapes.
  - Validation:
    - `pnpm --filter @workspace/pyrus exec node --import tsx --test src/features/platform/headerBroadcastModel.test.js src/features/platform/flowTapeModel.test.js` - 27/27 pass.
    - `pnpm --filter @workspace/pyrus exec node --import tsx --test src/features/platform/platformRootSource.test.js --test-name-pattern "header flow scanner lane applies"` - 61/61 pass.
    - `pnpm --filter @workspace/pyrus run typecheck` - pass.
    - scoped `git diff --check` - pass.
- Current branch state after Flow pill age commit: `main...origin/main [ahead 4]`.
- Follow-up all-lane header pill overflow commit:
  - `4398f70 fix: prevent header pills from overflowing`
  - Scope: shared header pill shell now has `minWidth: 0`; Signal, Flow, and Algo pill children use explicit shrink/ellipsis bounds; signal interval pellets and algo context badges are clipped inside each pill.
  - Validation:
    - `pnpm --filter @workspace/pyrus exec node --import tsx --test src/features/platform/headerBroadcastModel.test.js src/features/platform/flowTapeModel.test.js` - 27/27 pass.
    - `pnpm --filter @workspace/pyrus run typecheck` - pass.
    - temporary Playwright DOM overflow spec against `http://127.0.0.1:18747/?pyrusQa=safe` - pass, no rendered header pill had `scrollWidth > clientWidth`.
    - scoped `git diff --check` - pass.
- Current branch state after all-lane overflow commit: `main...origin/main [ahead 5]`.
- User pushed the prior cleanup commits; branch returned to tracking cleanly before continuing dirty-tree cleanup.
- Committed the chart position risk overlay slice:
  - `190eb67 feat: surface position risk overlays from broker state`
  - Scope: chart risk overlays now read broker open orders, raw shadow `lastStop`/wire trail payloads, runtime ticker snapshots for equity marks, and render one-point risk lines instead of dropping them.
  - Validation:
    - `pnpm --filter @workspace/pyrus exec node --import tsx --test src/features/charting/chartPositionOverlays.test.ts src/features/charting/ResearchChartSurface.test.ts` - 102/102 pass.
    - `pnpm --filter @workspace/pyrus run typecheck` - pass.
    - scoped `git diff --check` - pass.
- Current branch state after chart overlay commit: `main...origin/main [ahead 1]`.
- Committed the API client heavy GET/admission slice:
  - `cfedf6d fix: preserve heavy get priority headers`
  - Scope: heavy GET priority headers are preserved on upstream fetches while ignored for dedupe keys, and 503 route-admission sheds are not retried as transient proxy failures.
  - Validation:
    - `pnpm --filter @workspace/api-client-react run test:unit` - 19/19 pass.
    - `pnpm --filter @workspace/api-client-react run typecheck` - pass.
    - scoped `git diff --check` - pass.
- Current branch state after API client commit: `main...origin/main [ahead 2]`.
- Committed the backtest-core signal-option MTF normalization slice:
  - `9dd4c2d feat: normalize signal option mtf timeframes`
  - Scope: execution profiles now carry normalized MTF timeframe lists and preset names, with required-count clamped to the selected timeframe count.
  - Validation:
    - `pnpm --filter @workspace/backtest-core exec tsc -p tsconfig.json --noEmit` - pass.
    - `pnpm --filter @workspace/pyrus exec node --import tsx --test ../../lib/backtest-core/src/signal-options.test.ts` - 9/9 pass. Direct package-local `node --import tsx` was not usable because `@workspace/backtest-core` has no `tsx` dev dependency.
    - scoped `git diff --check` - pass.
- Current branch state after backtest-core commit: `main...origin/main [ahead 3]`.
- Committed the IBKR line-usage settings route coalescing slice:
  - `4116381 fix: coalesce ibkr line usage settings snapshots`
  - Scope: `/settings/ibkr-line-usage` and its SSE stream share a short route-level cache/in-flight snapshot guard, preventing overlapping expensive IBKR line-usage snapshots.
  - Validation:
    - `pnpm --filter @workspace/api-server exec node --import tsx --test src/routes/settings.test.ts` - 1/1 pass.
    - `pnpm exec tsc --build lib/backtest-core` - pass/regenerated ignored project-reference declarations after the MTF commit.
    - `pnpm --filter @workspace/api-server run typecheck` - pass.
    - scoped `git diff --check` - pass.
- Current branch state after settings route commit: `main...origin/main [ahead 4]`.
- Committed the account route fanout/cache slice:
  - `71113e5 fix: cache account route fanout reads`
  - Scope: short-lived response caching for account summary/equity history/allocation/positions/risk/cash routes, plus explicit market-data leases for account equity quote hydration.
  - Validation:
    - `pnpm --filter @workspace/api-server exec node --import tsx --test src/services/account-read-cache.test.ts src/services/account-positions.test.ts` - 20/20 pass.
    - `pnpm --filter @workspace/api-server run typecheck` - pass.
    - scoped `git diff --check` - pass.
- Current branch state after account cache commit: `main...origin/main [ahead 5]` unless local `origin/main` was advanced by the environment.
- Committed the IBKR helper expected-version alignment slice:
  - `28b9262 fix: align ibkr helper expected version`
  - Scope: API runtime expected helper version and runtime source tests now match the already-updated Windows helper bundle version `2026-06-02.ib-async-sidecar-v5`.
  - Validation:
    - `pnpm --filter @workspace/api-server exec node --import tsx --test src/services/ibkr-bridge-runtime.test.ts --test-name-pattern "helper|remote desktop shutdown|remote desktop launch bootstraps|Windows helper restarts"` - 30/30 pass.
    - scoped `git diff --check` - pass.
  - Note: `pnpm --filter @workspace/api-server run typecheck` is currently blocked by the still-dirty in-flight `src/services/signal-options-automation.ts` at line 3867 (`number | null` pushed into `number[]`), unrelated to the two runtime-version files.
- Current branch state after helper version commit: `main...origin/main [ahead 6]` unless local `origin/main` was advanced by the environment.
- Committed the IBKR account bridge stale/cold read slice:
  - `0b067c5 fix: serve stale ibkr account reads during refresh`
  - Scope: account bridge reads now serve usable stale cache while refresh is in-flight and can return quickly on cold execution reads while the bridge warms cache in the background.
  - Validation:
    - `pnpm --filter @workspace/api-server exec node --import tsx --test src/services/ibkr-account-bridge.test.ts` - 2/2 pass.
    - scoped `git diff --check` - pass.
  - Note: full API typecheck remains blocked by the unrelated dirty signal-options automation nullability issue noted above.
- Current branch state after IBKR account bridge commit: `main...origin/main [ahead 7]` unless local `origin/main` was advanced by the environment.
- Committed the IBKR lane architecture scanner-capacity slice:
  - `35434f2 fix: show flow scanner lane capacity in architecture`
  - Scope: lane architecture now uses resolved lane membership to summarize Flow scanner admitted/desired symbols and active IBKR lines instead of a static scanner description.
  - Validation:
    - `pnpm --filter @workspace/api-server exec node --import tsx --test src/services/watchlist-prewarm.test.ts` - 21/21 pass.
    - scoped `git diff --check` - pass.
  - Note: full API typecheck remains blocked by the unrelated dirty signal-options automation nullability issue noted above.
- Current branch state after lane architecture commit: `main...origin/main [ahead 8]` unless local `origin/main` was advanced by the environment.
- Committed the route-latency resource pressure slice:
  - `e01ed42 fix: cap route latency resource pressure`
  - Scope: route latency no longer escalates API resource pressure to `critical`; bridge lane backoff errors are treated as request-scoped runtime health noise while connected.
  - Validation:
    - `pnpm --filter @workspace/api-server exec node --import tsx --test src/services/resource-pressure.test.ts src/services/runtime-diagnostics.test.ts --test-name-pattern "route latency pressure|request-scoped bridge health errors"` - 23/23 pass.
    - scoped `git diff --check` - pass.
  - Note: full API typecheck remains blocked by the unrelated dirty signal-options automation nullability issue noted above.
- Current branch state after route-latency resource pressure commit: `main...origin/main [ahead 5]`.
- User pushed through `e01ed42`; branch returned to tracking cleanly before continuing dirty-tree cleanup.
- Committed the signal-options MTF sweep script slice:
  - `c466bde feat: add signal options mtf sweep variants`
  - Scope: `pyrus-signals-options-sweep` can run curated MTF entry-gate profile patch variants, requires explicit MTF sweep windows, records profile patches in reports, and excludes diagnostic no-MTF variants from winner ranking.
  - Validation:
    - `pnpm --filter @workspace/scripts run test:pyrus-signals-options-sweep` - 5/5 pass.
    - scoped `git diff --check` - pass.
  - Note: `pnpm --filter @workspace/scripts run typecheck` is blocked by the still-dirty in-flight `artifacts/api-server/src/services/signal-options-automation.ts` at line 3867 (`number | null` pushed into `number[]`), unrelated to the two sweep files.
- Current branch state after sweep commit: `main...origin/main [ahead 1]`.
- Patched the local dirty signal-options automation type narrowing (`selectedDirections.push(direction as number)`) so dirty-tree API/scripts typechecks can run; this remains unstaged with the large in-flight signal-options automation group.
- Committed the route-admission visible-read pressure slice:
  - `e8d784d fix: preserve visible reads under route admission`
  - Scope: route admission now classifies request-family/fetch-priority metadata, sheds deferred analytics at high pressure, keeps visible Flow/chart reads alive, and separates manual shadow scans from background backfills.
  - Validation:
    - `pnpm --filter @workspace/api-server exec node --import tsx --test src/services/route-admission.test.ts` - 11/11 pass.
    - `pnpm --filter @workspace/api-server run typecheck` - pass.
    - scoped `git diff --check` - pass.
- Current branch state after route-admission commit: `main...origin/main [ahead 2]`.
- Committed the readiness diagnostics-down degradation slice:
  - `b16cf6e fix: degrade readiness when diagnostics are down`
  - Scope: diagnostics collector `down` now degrades app readiness instead of failing liveness or blocking manual trading; critical API pressure remains `not_ready`.
  - Validation:
    - `pnpm --filter @workspace/api-server exec node --import tsx --test src/services/readiness.test.ts` - 4/4 pass.
    - `pnpm --filter @workspace/api-server run typecheck` - pass.
    - scoped `git diff --check` - pass.
- Current branch state after readiness commit: `main...origin/main [ahead 3]`.
- Committed the IBKR order-read suppression probe slice:
  - `59ac230 fix: probe suppressed ibkr order reads`
  - Scope: order-read timeout suppression now has a configurable probe interval and can clear itself after a successful probe instead of staying stale until TTL expiry.
  - Validation:
    - `pnpm --filter @workspace/api-server exec node --import tsx --test src/services/order-read-resilience.test.ts` - 6/6 pass.
    - `pnpm --filter @workspace/api-server run typecheck` - pass.
    - scoped `git diff --check` - pass.
- Current branch state after order-read probe commit: `main...origin/main [ahead 4]`.
- Committed the stream-first signal monitor worker slice:
  - `ffba216 fix: prefer streaming signal monitor evaluations`
  - Scope: trade monitor worker skips REST-backed polling when stock aggregate streaming is available, evaluates streamed aggregates immediately including provisional 5m live edges, and avoids the prior completed-bar safety delay.
  - Validation:
    - `pnpm --filter @workspace/api-server exec node --import tsx --test src/services/trade-monitor-worker.test.ts` - 15/15 pass.
    - `pnpm --filter @workspace/api-server run typecheck` - pass.
    - scoped `git diff --check` - pass.
- Current branch state after stream-first worker commit: `main...origin/main [ahead 5]`.
- Still-dirty groups to continue sorting:
  - Handoff/master/current files: many modified/untracked session handoffs remain. Treat as docs/session bookkeeping, not app code.
  - Backend route/admission/readiness/diagnostics/order/watchlist/option-cache changes remain uncommitted and mixed across `platform.ts`, route files, and service tests.
  - Pyrus UI cleanup groups remain uncommitted: route waterfall/preload audit, signal matrix/timeframe work, failure-point tooltip/GEX work, table column interactions, account/algo/diagnostics screen changes.
  - Untracked `.agents/skills/animation-best-practices/` exists and was not touched by these commits.
  - Validation caches under `python/ibkr_sidecar/.pytest_cache`, `.ruff_cache`, and `__pycache__` were deliberately not staged.
