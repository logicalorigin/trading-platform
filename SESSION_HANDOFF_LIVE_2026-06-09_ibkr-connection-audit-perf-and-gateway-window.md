# Session Handoff — 2026-06-09 — IBKR connection audit, deactivate-lag fix, before/after perf capture, and Gateway-window login blocker

## Session Metadata
- Date: `2026-06-09`
- Repo root: `/home/runner/workspace`
- Branch: `main`
- All work below is **uncommitted** in the working tree (per repo convention).
- Public dev URL used in helper/launch payloads: `https://5950eeb6-fc7d-4b18-87e8-8d1c0536942f-00-36emsiuflovpf.riker.replit.dev`
- Desktop: `desktop-EASYSTREET-c572024619f59c20` (interactive & unlocked per user).

## TL;DR of what shipped (all validated: api-server typecheck+build, pyrus typecheck, 10 unit tests pass)
1. **Deactivate-detection lag fix** (broker "disconnect" took ~56s to show offline → now ~1.6s, verified live).
2. **Auditable IBKR connection report** — new subsystem writing a running diagnostic document of the full connect/disconnect lifecycle (3 actors: Pyrus backend, Windows helper, browser).
3. **Before/after IBKR-data performance capture** — new subsystem to measure why the app lags once live data flows (server event-loop vs client re-render storm), flag-gated sampler + rolling document.
4. **Helper hardening + v16 Gateway-window-foreground fix** in `scripts/windows/pyrus-ibkr-helper.ps1`.

## UPDATE 2026-06-09 (later) — Broker-connection repair implemented (helper → v17)

Decision (user interview): **harden window-typing only (no IBC); harden self-update + manual re-pull.** Implemented:

1. **Window-typing now survives Chrome holding the foreground.** New `Confirm-IBGatewayCredentialWindowForeground($Context, $Attempts=6)` (`pyrus-ibkr-helper.ps1`, just after `Assert-…`) replaces the single-shot guard: it polls for the credential window, **re-grabs the foreground via the existing `Activate-IBGatewayWindowCandidate` up to 6×**, does a 150 ms stability re-sample so it won't type into a window about to lose focus, and only falls back to the detailed-throw `Assert-…` if it truly can't win. Swapped in at all 4 guard sites in `Invoke-IBGatewayCredentialTyping` (before typing / username / password / submit). `Activate-…` and the typing/clipboard logic are untouched.
2. **Self-update no longer fails silently.** New `Test-DownloadedHelperVersion($Path,$ExpectedVersion)` requires the downloaded file to literally declare `$HelperVersion = '<requestedVersion>'` (a 404 page or truncated body ≥4096 B no longer passes). Wired into **both** `Invoke-HelperSelfUpdateIfNeeded` and `Invoke-DesktopAgentSelfUpdateIfNeeded`: on mismatch it deletes the bad download, surfaces failure (Send-BridgeProgress / Write-Log), and **throws before overwriting** the good helper and **before** setting `$env:PYRUS_IBKR_HELPER_SELF_UPDATE`, so the next launch retries. The non-fatal `-Install` catch now also emits a progress event.
3. **Version bumped in lockstep → `2026-06-09.ib-async-sidecar-v17-foreground-retry-safe-selfupdate`** in `pyrus-ibkr-helper.ps1:53` and `BRIDGE_HELPER_VERSION` (`ibkr-bridge-runtime.ts:27`).

**Note:** the v15 box lacks this hardening, so v15→v17 still needs the manual re-pull below (now expecting the **v17** string); every self-update *after* v17 is validated.

**Validation (shared workspace caveat):** `ibkr-bridge-runtime.ts` has **0** type errors and the esbuild **build passes**; the 10 prior unit tests still pass. A clean *whole-package* `tsc` was not obtainable because **other concurrent `codex` agents were actively editing `account.ts`/`shadow-account.ts`/`signal-monitor.ts`** during this session (confirmed via file mtimes + running PIDs) — those errors are unrelated to this change. PowerShell could not be parsed here (no `pwsh`); changes were statically reviewed. **The real acceptance test is the live EASYSTREET run.**

---

## OPEN BLOCKER (original diagnosis — superseded by the UPDATE above; kept for context) — Gateway window login + helper not updating to v16
**Symptom:** broker connect reaches `credentials_delivered` (credential pipeline works), then **fails at the Gateway login step**:
> `IB Gateway login window is not active before password entry; refused to type credentials into the wrong window. Foreground window is 'Pyrus Platform - Replit - Google Chrome' (process 'chrome', pid 36896).`

**Root causes (two, stacked):**
1. **Window-typing is structurally fragile.** The one-time-credential flow uses `Start-IBGatewayWithAutoLogin` → `Invoke-IBGatewayCredentialTyping`, which *types* credentials into the Gateway window via UI automation and therefore must bring that window to the **foreground**. Because the user clicks "Launch" in Chrome, **Chrome holds the foreground** and the helper's safety guard (`Assert-IBGatewayCredentialWindowForeground`) correctly refuses to type the IBKR password into Chrome.
   - A robust alternative **already exists but is dead code**: `Start-IBGatewayWithIbc` (`pyrus-ibkr-helper.ps1:2391`) writes credentials into **IBC** config so Gateway self-logs-in — no window/foreground/typing. `Ensure-IBGatewaySocket` (`:2434`) routes `UseAutoLogin → Start-IBGatewayWithAutoLogin` (window path, `:2446`), never the IBC path (`Start-IBGatewayWithIbc` has zero call sites). Wiring IBC is the permanent fix but requires IBController installed on EASYSTREET.
2. **The v16 fix never reached the desktop.** The desktop helper is still **v15** (`desktopAgentHelperVersion: …v15-graceful-deactivate`, `upgradeRequired: true`). **The server IS sending the updater correctly** — verified the live launch URL carries `helperVersion=v16` **and** `helperUrl=…/api/ibkr/bridge/helper.ps1` (the two things `Invoke-HelperSelfUpdateIfNeeded` needs). So **the self-update is failing on the helper itself** (download/install/relaunch on the Windows box) — not a server bug. **Restarting the Replit app does NOT update the helper** (separate Windows process).
   - Investigated and **ruled out** a server-side version-stamping bug: `claimIbkrRemoteDesktopLaunchJob` passes the desktop's reported version into `rewriteIbkrProtocolLaunchForDesktop`, but because v15 classifies as `update_required` (not "compatible"), `rewriteIbkrProtocolHelperVersion` (`:524`) leaves the base URL **unchanged** at v16. So the launch URL still carries v16. A speculative edit to stamp `BRIDGE_HELPER_VERSION` was made and then **reverted** (no-op). No server change is committed for this.

**Next step for the blocker (hand to user, deterministic):** do an out-of-band re-pull on EASYSTREET (Admin PowerShell) that bypasses the flaky self-update, and confirm the version before retesting:
```powershell
Get-Process ibgateway -ErrorAction SilentlyContinue | Stop-Process -Force
Get-ScheduledTask -TaskName 'Pyrus IBKR Desktop Agent' -ErrorAction SilentlyContinue | Stop-ScheduledTask
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
  Where-Object { $_.CommandLine -match 'pyrus-ibkr-helper\.ps1' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
$state  = Join-Path $env:LOCALAPPDATA 'Pyrus\ibkr-bridge'
$target = Join-Path $state 'pyrus-ibkr-helper.ps1'
Invoke-WebRequest -UseBasicParsing "<DEV_URL>/api/ibkr/bridge/helper.ps1" -OutFile $target -TimeoutSec 60
Select-String -Path $target -Pattern 'HelperVersion ='   # MUST print v17-foreground-retry-safe-selfupdate
& $target -InstallAgent
```
**Recommended direction:** if a *confirmed-v16* window attempt still loses the foreground race, stop fighting window-typing and **wire the IBC auto-login path** (the user's own framing: "send credentials with the initial command"). That permanently removes the foreground requirement.

---

## Detail of completed work

### 1. Deactivate-detection lag fix (DONE, verified live: ~56s → 1.6s)
- Root cause: bridge-health cache stays "fresh+connected" for `IBKR_BRIDGE_HEALTH_FRESH_MS` (30s) after teardown; nothing invalidated it on a user-initiated deactivate.
- Fix: new `invalidateBridgeHealthCache()` in `platform-bridge-health.ts`; called from both deactivate entry points — `detachIbkrBridgeRuntime` (`ibkr-bridge-runtime.ts`, after `clearIbkrBridgeRuntimeOverride()`) and the `ibkr.bridgeOverride.clear` action (`backend-settings.ts`). Next status read re-probes → `connected:false` in ~1.6s. Scoped to user deactivate; anti-flap stability for normal operation untouched.
- Test: `platform-bridge-health.test.ts` (invalidation → immediate disconnected read).

### 2. Auditable IBKR connection report (DONE)
- NEW `artifacts/api-server/src/services/ibkr-connection-audit.ts` — per-attempt model keyed by `activationId`; `recordConnectionAuditEvent`, change-gated `recordConnectionLiveState`; writes rolling docs under `.pyrus-runtime/flight-recorder/`: `ibkr-connection-YYYY-MM-DD.jsonl`, `ibkr-connection-current.json`, `ibkr-connection-audit.md`. 7-day retention. Best-effort/never-throws.
- Reuses exported flight-recorder helpers added in `runtime-flight-recorder.ts` (`recorderDir`, `flightRecorderDateKey`, `appendFlightRecorderJsonLine`, `atomicWriteFlightRecorderJson`, `atomicWriteFlightRecorderText`).
- Backend hooks in `ibkr-bridge-runtime.ts`: `appendLegacyBridgeActivationProgress` (whole phase machine), login-handoff incl. the 4 envelope-rejection error codes (refactored `submitLegacyIbkrBridgeLoginEnvelope` with a `rejectEnvelope` helper that `throw`s an `HttpError`), desktop register/claim/failures (idle polling gated via `hasActiveConnectionAttempt()`), launch/shutdown/detach/attach. Connected/streamState transitions hooked (change-gated) in `platform-bridge-health.ts` `getBridgeHealthForSession` return points.
- Browser channel: `POST /api/ibkr/activation/:activationId/browser-event` (`routes/platform.ts`) → `recordIbkrBridgeBrowserConnectionEvent` (`ibkr-bridge-runtime.ts`); frontend fire-and-forget reporter `reportIbkrBrowserConnectionEvent` in `HeaderStatusCluster.jsx` from `deliverIbkrLoginCredentials` (`encrypting_credentials`, `credentials_sent_to_pyrus`, `encrypt_failed`, `envelope_post_failed`, `login_key_timeout`).
- Read-back: `GET /api/ibkr/connection-audit`.
- Test: `ibkr-connection-audit.test.ts` (multi-actor correlation, stalled-attempt classification, change-gating, retention).
- KNOWN GAP (verified 2026-06-09): the `connected`/`streamState` `recordConnectionLiveState` hook fires **only** inside `getBridgeHealthForSession` (`platform-bridge-health.ts:455`, `:485`) — the `/api/session` path. `/api/diagnostics/runtime` does NOT call it: its bridge-health source is `getRuntimeBridgeHealthState()` (`platform-bridge-health.ts:508`), and `getAnnotatedBridgeHealthForTradingGuard` (`:591`, called from `platform.ts:4369`) is a separate trading-guard path. So the audit/perf "connected" tag can stay `null` unless `/api/session` is actively polled. Bucket by **stream activity** (`quote/aggregate events/sec`) instead, or move the `recordConnectionLiveState` hook to where `getRuntimeDiagnostics` finalizes `connected`/`streamState` (`platform.ts:3469`, `annotatedHealth?.connected ?? false` inside the ibkr object literal — needs a local before the literal).

### 3. Before/after IBKR-data performance capture (DONE)
- NEW `artifacts/api-server/src/services/ibkr-perf-capture.ts` — flag-gated ~7s sampler; bundles windowed `monitorEventLoopDelay` (dedicated instance), RSS, `getApiResourcePressureSnapshot`, `getBridgeQuoteStreamDiagnostics`, `getStockAggregateStreamDiagnostics` (incl. `pendingFanoutCount`), `getBridgeOptionQuoteStreamDiagnostics`, `getSseStreamDiagnostics`, `getBridgeGovernorSnapshot`, and SSE emit counters; derives rates; before/after buckets by connection state; rolling `ibkr-perf-YYYY-MM-DD.jsonl` / `ibkr-perf-current.json` / `ibkr-perf.md`; 7-day retention.
- SSE emit counters: `serializeSseEventData` + `getSseEmitCounters` in `sse-stream-diagnostics.ts` (events, bytes, `stringify`-ms — the direct event-loop serialization cost); used in `routes/platform.ts` `startSse.writeEvent`.
- Client attribution: `performanceMetrics.ts` posts a `liveData` section (`symbolListenerCount`, `notificationsPerSec`, `longTaskMsPerWindow`, option-quote listener/cache counts) via the existing `/api/diagnostics/client-metrics`; new fan-out counter + `getAggregateFanoutCounters()` in `useMassiveStockAggregateStream.ts`; `recordLatestClientPerfMetrics` forwarded from the client-metrics route (`routes/diagnostics.ts`).
- Control/read: `GET /api/diagnostics/ibkr-perf`, `POST /api/diagnostics/ibkr-perf/control {action:start|stop}`.
- Test: `ibkr-perf-capture.test.ts` (rate derivation, before/after bucketing, client liveData, retention).
- NOTE: a partial baseline run captured `eventLoopDelay maxMs spikes of ~500–1950ms` and `aggregate events/sec 450–715` while still *disconnected* — i.e. the Massive aggregate stream + SSE fan-out already stress the event loop before IBKR even connects. Worth pursuing when the perf run resumes.

### 4. Helper hardening + Gateway-window-foreground fix (`scripts/windows/pyrus-ibkr-helper.ps1`, version → `2026-06-09.ib-async-sidecar-v16-gateway-window-foreground`; matched in `ibkr-bridge-runtime.ts` `BRIDGE_HELPER_VERSION`)
- Self-update hardening (from earlier in session): `-TimeoutSec 60` on the helper download (both self-update paths), non-blocking/`try`-wrapped `-Install` step so a stalled install can't strand the launch.
- v16 window fix: `Activate-IBGatewayWindowCandidate` rewritten with the canonical Win32 foreground technique — `AttachThreadInput` (attach to the current foreground + target threads) + ALT-key tap (unlock SetForegroundWindow) + `BringWindowToTop` + `SetForegroundWindow` + `ShowWindow`. Added P/Invokes: `ShowWindow`, `BringWindowToTop`, `AttachThreadInput`, `GetCurrentThreadId`. **UNVERIFIED on Windows** (no PS parser here) — and not yet deployed to EASYSTREET (still v15).

## Other things done this session (context)
- Diagnosed the **app-wide lag / ~30s Chrome freeze**: primary cause was **DB contention** — the Rust `market-data-worker`'s option-chain upserts (`option_chain_snapshots` 5112 rows = **31s**, `option_contracts` 7.9s, `instruments` 5.4s) saturate the shared Postgres; the small DB pool (`max 6` helium / 10, `lib/db/src/index.ts`) + `apiPressure: high` at ~2.1GB RSS make API requests queue (`/api/bars` 15s, `/api/positions` 12s, aborts, 429s). Highest-impact fix: chunk/throttle the option-chain upsert; raise `DB_POOL_MAX`; cut RSS. (Documented also in `APP_RESPONSIVENESS_AUDIT_2026-06-09.md` sections B1/B3.)
- A second, self-inflicted freeze was caused by **two leftover background `python3` pollers** (`broker_lifecycle.py`, `broker_watch2.py`) hitting the heavy 346KB `/api/diagnostics/runtime` every 1.5s for ~1.6h — killed them. **Lesson: do not leave long-lived background pollers against heavy endpoints.**

## Validation status
- Independently re-run 2026-06-09 (handoff audit): all green again — api-server typecheck+build, pyrus typecheck, 10/10 tests via `npx tsx --test` (the runner; these are `node:test` files, NOT vitest — `vitest run` reports "No test suite found").
- `pnpm --filter @workspace/api-server run typecheck` ✅, `run build` ✅
- `pnpm --filter @workspace/pyrus run typecheck` ✅
- Unit tests ✅: `ibkr-connection-audit.test.ts` (4), `ibkr-perf-capture.test.ts` (4), `platform-bridge-health.test.ts` (2) = 10/10.
- Pre-existing unrelated failure: `ibkr-bridge-runtime.test.ts` "desktop heartbeat persists helper heartbeat evidence" — version-drift in the test: it heartbeats the stale hardcoded `2026-06-04.ib-async-sidecar-v8-foreground-guard` yet asserts `helperCompatibility:"compatible"`, which that version no longer satisfies. Confirmed still failing at HEAD with this session's `ibkr-bridge-runtime.ts`/`.test.ts` changes stashed (re-verified 2026-06-09). Not ours.
- The running API must be **restarted** to pick up new routes / `BRIDGE_HELPER_VERSION` (Node loads `dist` at boot; no hot-reload). Helper `.ps1` is served from file per-request so its edits are live immediately.

## Changed / new files
- Modified: `routes/platform.ts`, `routes/diagnostics.ts`, `services/ibkr-bridge-runtime.ts`, `services/backend-settings.ts`, `services/platform-bridge-health.ts` (+ `.test.ts`), `services/runtime-flight-recorder.ts`, `services/sse-stream-diagnostics.ts`; `pyrus/.../useMassiveStockAggregateStream.ts`, `pyrus/.../HeaderStatusCluster.jsx`, `pyrus/.../performanceMetrics.ts`; `scripts/windows/pyrus-ibkr-helper.ps1`.
- New: `services/ibkr-connection-audit.ts` (+`.test.ts`), `services/ibkr-perf-capture.ts` (+`.test.ts`).
- Installed skill (per user): `.claude/skills/karpathy-guidelines/SKILL.md`.

## Recommended next steps
1. **Unblock the connection:** get **confirmed-v16** on EASYSTREET via the re-pull above; if window-typing still fails the foreground race, **wire `Start-IBGatewayWithIbc`** (IBC auto-login) into `Ensure-IBGatewaySocket` and add IBC install/bundling — permanent fix.
2. **Resume the before/after perf run** once connected: `POST /api/diagnostics/ibkr-perf/control {start}`, capture disconnected baseline, connect, capture streaming, read `ibkr-perf.md`; write `IBKR_DATA_LAG_DIAGNOSIS.md`. Fix the `connected`-tag gap (see §2 KNOWN GAP) or bucket by stream activity.
3. **App lag:** chunk/throttle the market-data-worker option-chain upserts; bump `DB_POOL_MAX`; address RSS pressure.
