# HUNT-Z Zombie Config Report

Scope: HUNT-Z only. Read-only source inspection plus this report file. I did not inspect `agents/`, `.claude/skills/`, or `~/.claude/`.

## Findings

1. artifacts/pyrus/src/app/runtime-config.ts:50 | P2 | Documented public API env vars do not configure the frontend | verdict: migrate/wire-up
Evidence: `.env.example:18-19` advertises `PUBLIC_API_BASE_URL` and `PYRUS_PUBLIC_API_BASE_URL`, but the browser runtime reads only `import.meta.env.VITE_API_BASE_URL` at `artifacts/pyrus/src/app/runtime-config.ts:50`. `rg` found the documented public API vars only in `.env.example` and the dead bridge-origin helper in `artifacts/api-server/src/routes/platform.ts:334-337`; no frontend reader exists.
Consequence: operators can set the documented public API vars and still ship a browser bundle with `runtimeConfig.apiBaseUrl` null/default, causing user-visible API routing failures in non-standard deployments.
Laziest fix: add `VITE_API_BASE_URL` to `.env.example` and either remove the inert public aliases or map them into Vite's env at build/runtime with a test.
Confidence: 0.93

2. .env.example:146 | P2 | "Retired, ignored" IBKR bridge override env still drives persisted runtime state | verdict: migrate/document
Evidence: `.env.example:146-148` labels `IBKR_BRIDGE_RUNTIME_OVERRIDE_FILE` and `PYRUS_IBKR_BRIDGE_RUNTIME_OVERRIDE_FILE` as retired ignored tombstones. The runtime still reads those names at `artifacts/api-server/src/lib/runtime.ts:166-198`, loads/persists the override file at `artifacts/api-server/src/lib/runtime.ts:323-351`, and returns it from `getIbkrBridgeRuntimeConfig()` at `artifacts/api-server/src/lib/runtime.ts:678-688`.
Consequence: a stale override file path can still make diagnostics report bridge URL/token configuration even though the desktop bridge health path is hard-retired, increasing operator confusion during broker/debug work.
Laziest fix: if bridge override persistence is still needed, rename/comment it as active retired-state migration config; otherwise remove the env reader and override persistence surface.
Confidence: 0.90

3. artifacts/api-server/src/index.ts:300 | P2 | Retired IBKR watchlist prewarm scheduler still starts on every API boot | verdict: kill/migrate
Evidence: API startup still includes `startIbkrWatchlistPrewarmRuntime` in the background worker list at `artifacts/api-server/src/index.ts:298-300`. That function schedules startup and interval bridge prewarm work at `artifacts/api-server/src/services/platform.ts:1798-1808`, while the bridge reconciliation it calls is now a no-op that logs "retired" at `artifacts/api-server/src/services/platform.ts:1278-1280` and bridge health returns null at `artifacts/api-server/src/services/platform.ts:303-307`.
Consequence: every API process retains a bridge-era scheduler and, when Client Portal IBKR config is present, can still poll watchlists and run retired readiness checks before skipping. This is mostly wasted runtime work and stale diagnostics, but it lives on the hot startup path.
Laziest fix: remove `startIbkrWatchlistPrewarmRuntime` from startup, or rename/rebuild it around the current market-data provider with no bridge health dependency.
Confidence: 0.88

4. artifacts/api-server/src/routes/platform.ts:334 | P3 | Legacy bridge/public base URL reader is an uncalled exported helper | verdict: kill/wire-up
Evidence: `IBKR_BRIDGE_API_BASE_URL`, `PYRUS_PUBLIC_API_BASE_URL`, and `PUBLIC_API_BASE_URL` are prioritized by `IBKR_BRIDGE_PUBLIC_BASE_URL_ENV_NAMES` at `artifacts/api-server/src/routes/platform.ts:334-338` and read by `getConfiguredBridgeBaseUrl()` at `artifacts/api-server/src/routes/platform.ts:553-567`. The only consumer is exported `getIbkrBridgeRequestOrigin()` at `artifacts/api-server/src/routes/platform.ts:614-620`; `rg` found no in-repo call site for that helper.
Consequence: `.env.example:143-144` says the legacy bridge public base URL is still read by platform routes, but setting it currently appears to have no route effect. This is an operator-facing inert env claim.
Laziest fix: delete the helper/env aliases if obsolete, or wire `getIbkrBridgeRequestOrigin()` into the route that still needs public-origin selection and cover it with a route test.
Confidence: 0.86

5. artifacts/api-server/src/lib/runtime.ts:622 | P3 | Legacy TWS transport env readers are dead exports | verdict: kill/document
Evidence: `.env.example:175-194` lists legacy TWS/bridge tuning such as `IBKR_TRANSPORT`, `IBKR_TWS_HOST`, and `TWS_PORT`. The API runtime still parses them in `getIbkrTwsRuntimeConfig()` and `getIbkrBridgeProviderRuntimeConfig()` at `artifacts/api-server/src/lib/runtime.ts:622-675`, but `rg` found no production caller of either exported function outside their own definitions. The shared `lib/ibkr-contracts/src/runtime.ts:222-280` duplicates the same exported parsing surface, also with no production caller found.
Consequence: setting the TWS env block suggests an operator can select a socket/gateway transport, but in the current API path it does not activate anything. The stale exports also preserve retired broker semantics in shared contracts.
Laziest fix: remove the TWS readers from the API runtime and move any intentionally preserved shared-contract API behind explicit docs/tests that say it is dormant.
Confidence: 0.84

6. .env.example:493 | P3 | Replit duplicate restart delay flag is listed but explicitly forbidden by the guard | verdict: kill
Evidence: `.env.example:492-494` lists `PYRUS_DEV_DUPLICATE_CHECK_ONLY`, `PYRUS_DEV_DUPLICATE_RESTART_AFTER_MS`, and `PYRUS_DEV_FORCE_RESTART`. `runDevApp.mjs` reads only check-only and force-restart at `artifacts/pyrus/scripts/runDevApp.mjs:46-47`, and the startup guard explicitly asserts the runner must not include `PYRUS_DEV_DUPLICATE_RESTART_AFTER_MS` at `scripts/check-replit-startup-guards.mjs:317-324`.
Consequence: the sample env advertises a restart-delay knob that cannot work by design, which can send future startup-maintenance work down the wrong path.
Laziest fix: remove `PYRUS_DEV_DUPLICATE_RESTART_AFTER_MS` from `.env.example` and any docs that still mention it.
Confidence: 0.96

7. .env.example:470 | P3 | Playwright env inventory includes local names the Playwright config never reads | verdict: kill/document
Evidence: `.env.example:470-478` lists `PLAYWRIGHT_CHROMIUM_EXECUTABLE`, `PLAYWRIGHT_PORT`, `PLAYWRIGHT_WORKERS`, `PYRUS_PLAYWRIGHT_NO_WEB_SERVER`, and `PYRUS_PLAYWRIGHT_ALLOW_WEB_SERVER`. Local code reads only `REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE` in `artifacts/pyrus/playwright.config.ts:15` and `scripts/headless-shot.mjs:71`; `rg` found no local reader for the other listed names.
Consequence: setting these env vars will not affect the repo's Playwright launch path, so QA/debug runs can silently ignore operator intent.
Laziest fix: remove the unused names, or wire them into `artifacts/pyrus/playwright.config.ts` with tests/docs if they are meant to be supported.
Confidence: 0.78

## Refuted / Not Re-Reported

- `requestSignalOptionsWorkerScanSoon`: absent repo-wide. Current worker exposes an instance-local `requestRunSoon` only (`artifacts/api-server/src/services/signal-options-worker.ts:801-845`).
- Signal-options worker `getResourcePressure`: no production dependency in `artifacts/api-server/src/services/signal-options-worker.ts`; current pressure checks are in other services. I did not re-report the known dead wire.
- `PYRUS_QA_SHOT_DIR`: known item in the work order; observed only in the SnapTrade browser-validation spec and `.env.example`, not re-reported.
- Scan-architecture relic: known item in the work order; not re-reported.

## Coverage Note

Covered `.env.example` high-risk sections by section sampling: core/public API base, retired IBKR bridge/TWS blocks, Pyrus frontend/runtime flags, diagnostics worker flags, Playwright/dev-shell flags. Traced relevant runtime readers with `rg` and line reads across `artifacts/api-server`, `artifacts/pyrus`, `lib`, and `scripts`, excluding forbidden `agents/` and `.claude/skills/`. I did not exhaustively prove all 425+ env entries because per-var fixed-string scans over the full repo were too slow; findings above are all file:line-verified and refuted against direct readers/call sites before inclusion.
