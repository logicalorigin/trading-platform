# Spec — PYRUS IBKR Connector (local Client Portal + setup wizard)

> Status: SAVED PLAN — 2026-07-05. Branch: `main` (all work on main, no side-branching).
> Track: INTERIM, attended-only. The durable unattended path (IBKR OAuth third-party) is the separate parallel track — scoped in `docs/plans/ibkr-third-party-oauth-scope.md`.
> Decisions D1–D5 (below) are the working defaults; confirm at build start.
> Workstream record: `SESSION_HANDOFF_LIVE_2026-07-03_ibkr-client-portal-hosted-connector.md`.

## Context

Connecting Interactive Brokers has cost this workstream ~15 sessions because IBKR's Client Portal Gateway (`clientportal.gw`) is designed to run on the **end user's own machine** and breaks when hosted centrally. We verified (workflow `wf_f4280070-4f7`, HIGH confidence) that a Replit deployment cannot host a per-user gateway fleet: no nested virtualization (`REPL_IN_MICROVM=true`, no `/dev/kvm`) and a single external origin, which reintroduces the cookie-fragmentation + SPA base-path login bugs the whole redesign was meant to kill.

This spec takes the opposite approach: **let the user run the gateway locally**, where it is IBKR's supported same-machine model, so the login just works (gateway at `localhost`, own origin, root path — every origin/cookie/subpath bug disappears). A one-click download plus an in-app wizard makes that easy; a small local agent dials **outbound** to PYRUS so the cloud app can read the account and place trades without inbound access to the user's machine.

Who is affected: any PYRUS user who trades IBKR and does not have (or want to wait for) IBKR OAuth third-party approval. Why now: IBKR is currently unconnectable via a self-hosted path; this unblocks real IBKR trading for attended sessions while OAuth approval proceeds in parallel.

## Current State (verified 2026-07-05, all files tracked on `main`)

The connector was built for the *central-hosting* model. Most of the logic is reusable; only the transport moves from server-loopback to a user-machine tunnel, and the browser-facing proxy is deleted.

| File | Today (central-host model) | This spec |
|---|---|---|
| `artifacts/api-server/src/services/ibkr-portal-gateway-manager.ts` | Spawns a gateway JVM **server-side** on loopback ports 5200+, rewrites `conf.yaml` (`listenPort`, `listenSsl:false`), health-waits `GET /` (`waitForReady`, `setupInstance`, `spawnGateway`) | This spawn/conf/health logic moves **client-side into the agent**; server keeps only a registry of connected users → connector sessions |
| `scripts/ensure-ibkr-portal-runtime.mjs` | Downloads `clientportal.gw` (`CPG_URL`) + portable Temurin 17 JRE (`JRE_URL`) into `IBKR_PORTAL_HOME` | Becomes the agent's **first-run provisioner** (fetch JRE + gw onto the user's machine) |
| `artifacts/api-server/src/services/ibkr-portal-session.ts` | `readPortalReadiness` / `connectPortal` / `tickle` build a per-user `IbkrClient(baseUrl)` where `baseUrl=http://127.0.0.1:<port>/v1/api` | Reused nearly verbatim; `baseUrl` now resolves **through the tunnel** to the user's local gateway |
| `artifacts/api-server/src/routes/ibkr-portal.ts` | 4 control endpoints (`readiness`/`status`/`connect`/`disconnect`) **plus** `proxyToGateway` (browser-facing subpath reverse proxy + `rewriteLocation`/`rewriteSetCookie`/`rewriteBody`) | **Delete `proxyToGateway` + all rewrite\* + GW_BASE + trail** (login is local now). Keep the 4 control endpoints. Add connector **pairing** + **tunnel** endpoints |
| `artifacts/api-server/src/services/ibkr-portal-context.ts` | `AsyncLocalStorage` per-user routing | Unchanged in shape |
| `artifacts/api-server/src/services/ibkr-bridge-runtime.ts` | Retired desktop-bridge contract: `desktopAgentRegistered/Online`, `bridgeRuntimeStatus attached|desktop_agent_online_not_attached|detached`, `helper.ps1` at `/api/ibkr/bridge/helper.ps1` | **Revive** this registration/heartbeat/compatibility surface, pointed at `clientportal.gw` instead of TWS |
| `artifacts/api-server/src/providers/ibkr/bridge-client.ts` | `bridge-client.ts:145` "Windows helper is heartbeating … waiting for a tunnel/runtime handoff" | The heartbeat + tunnel handoff pattern the agent implements |
| `artifacts/pyrus/src/screens/settings/ibkrPortalConnectModel.js` + Settings tile | Connect → popup login → poll status | Becomes the 4-step **wizard** |
| `artifacts/api-server/src/services/ibkr-oauth-readiness.ts` | Stub: returns `implementation_not_complete`, `oauth1a_third_party`, `approvalRequired:true` | Untouched (OAuth is the separate track) |

Router mount today: `artifacts/api-server/src/routes/index.ts:9,24` imports and `router.use(ibkrPortalRouter)`.

## Proposed Change

Three components:

1. **PYRUS IBKR Connector** — a small signed per-OS agent the user downloads. On launch it: provisions the local runtime (JRE + `clientportal.gw`) on first run, starts the gateway on `127.0.0.1`, opens the local IBKR login, keeps the session alive (55s tickle), and dials an authenticated **outbound WebSocket** to PYRUS (register + heartbeat, then request relay).
2. **PYRUS control surface** — pairing-token issuance, a connector registry (user ↔ connector, online/last-seen), and a tunnel-relay endpoint that forwards IBKR REST over the agent's WebSocket.
3. **In-app setup wizard** — Settings ▸ Broker Connections ▸ IBKR Client Portal ▸ Set up. 4 steps that auto-advance on live detection.

```
User machine                              PYRUS (cloud, main)
┌───────────────────────────┐            ┌────────────────────────────┐
│ PYRUS IBKR Connector       │            │ Settings wizard (React)    │
│  ├─ clientportal.gw (JVM)  │            │  └─ polls readiness        │
│  │    127.0.0.1:5000       │            │ /ibkr-portal/pair (token)  │
│  ├─ opens local login ─────┼─ browser ─▶│ connector registry         │
│  └─ outbound wss ──────────┼───────────▶│ tunnel-relay (REST over WS)│
│      register+heartbeat    │◀───REST────┤ IbkrClient(baseUrl=tunnel) │
│      relay IBKR REST        │   over WS  │ tickle / account / orders  │
└───────────────────────────┘            └────────────────────────────┘
```

### Resolved technical decisions (flagged — override any at review)

- **D1 Packaging:** single compiled binary via **Bun** (`bun build --compile`, `bun 1.3.6` already on PATH), cross-platform, one file. Minimal tray/console UX for the interim; a Tauri installer is a later polish item. *(Alt: Tauri/Electron now — nicer, heavier.)*
- **D2 Download vs fetch:** the download is the **thin signed agent only**; it fetches JRE + `clientportal.gw` on first run by reusing `ensure-ibkr-portal-runtime.mjs`. Tiny download, gateway always current. *(Alt: fat offline bundle with JRE+gw baked in.)*
- **D3 P1 OS scope:** **Windows-first** (matches the retired `helper.ps1` lineage and the IBKR retail user base), agent written cross-platform so macOS/Linux are a build-target flip in P3. *(Alt: all three at once.)*
- **D4 Tunnel transport:** our own **reverse WebSocket** — the agent dials `wss://<pyrus>/api/broker-execution/ibkr-portal/tunnel`, authenticates with the connector credential, and PYRUS frames IBKR REST requests over it; the agent forwards to `127.0.0.1:5000` and returns responses. No third-party tunnel, no inbound to the user's machine. *(Alt: cloudflared/ngrok public URL per connector.)*
- **D5 Pairing/auth:** the download is stamped with a **single-use, short-TTL pairing token** bound to the user. On first connect the agent exchanges it for a long-lived per-connector credential stored locally (OS keychain where available, file fallback). PYRUS maps connector credential → `userId`. `wss` only.

### Implementation Details

**Agent ↔ PYRUS protocol (WebSocket, JSON frames):**
- `register` `{connectorId, credential, helperVersion, os}` → server marks connector online, binds to `userId`.
- `heartbeat` `{connectorId, gatewayStatus: "starting"|"ready"|"needs_login"|"connected", ts}` every 15s → drives the status chip + wizard auto-advance.
- `rpc-request` `{id, method, path, headers, body}` (server→agent) / `rpc-response` `{id, status, headers, body}` (agent→server) — the REST relay (P2). Agent forwards to `http://127.0.0.1:5000<path>`.
- Idempotency: `rpc-request` carries `id`; agent de-dupes on `id` (gateway calls must not double-execute an order).

**New/changed endpoints (`routes/ibkr-portal.ts`):**
- `POST /broker-execution/ibkr-portal/pair` (admin+CSRF) → `{pairingToken, downloadUrl}` (token single-use, TTL 15 min).
- `GET /broker-execution/ibkr-portal/download?os=win|mac|linux` → signed agent binary (P1: Windows).
- `WS /broker-execution/ibkr-portal/tunnel` → the agent's outbound socket (auth via connector credential).
- Keep `GET readiness`, `GET status`, `POST connect`, `POST disconnect`; `readiness`/`status` now read connector registry + relayed `/iserver/auth/status`.
- Remove `router.use(".../gateway", proxyToGateway)` and `encodeRequestBody`/`rewriteLocation`/`rewriteSetCookie`/`rewriteBody`/`GW_BASE`/`TRAIL_PATH`.

**Wizard state machine (`ibkrPortalConnectModel.js` + Settings tile):**
1. **Download** — detect OS (`navigator.userAgentData`/UA), call `/pair`, show the download button. → advances when a heartbeat for this user's connector arrives.
2. **Run it** — "double-click the connector." Poll registry; connector `online` → advance.
3. **Log in** — agent opened the local login; user does creds+2FA. Poll readiness; `authenticated` → advance.
4. **Connected** — show account; done. Chip: `Connected` / `Connector offline` / `Needs login`, plus "keep the connector running to trade."

## Phasing

- **P1 — local gateway + wizard + heartbeat.** Windows agent (D1/D2/D3) that provisions runtime, launches gw, opens local login, registers + heartbeats. Wizard steps 1–3 auto-advance; readiness reflects the local gateway via the agent (status only, no server-side trading yet). Delete the subpath proxy. **Done when:** a real Windows user completes IBKR login+2FA locally and the wizard reaches `Connected`.
- **P2 — REST relay (server-side trading).** `rpc-request`/`rpc-response` over the tunnel; `ibkr-portal-session.ts` `IbkrClient` `baseUrl` resolves to the tunnel; tickle + account reads + order placement work server-side through the connector. **Done when:** PYRUS places a test order on the user's account via the relay and reads it back.
- **P3 — signing + auto-update + macOS/Linux + polish.** Windows Authenticode + Apple notarization, agent auto-update, tray UX, macOS/Linux builds.

## Acceptance Criteria

1. On Windows, downloading + running the connector provisions JRE + `clientportal.gw` on first run with no separate "install Java" step, and launches the gateway on `127.0.0.1:5000` (verified: `GET /` 200 within 60s).
2. The wizard auto-advances step 2→3 within 5s of the connector's first heartbeat, and 3→4 within one readiness poll of `authenticated` (no manual "next").
3. A real IBKR login + 2FA completed against the local gateway reaches `readiness.status = connected` with the account listed — no cookie-fragmentation or SPA base-path failure (the two bugs this replaces).
4. (P2) PYRUS places a test order through the relay and reads it back via `/iserver/account/orders`; an `rpc-request` replayed with the same `id` executes at most once.
5. The browser-facing subpath proxy is gone: `rg 'proxyToGateway|rewriteBody|GW_BASE' artifacts/api-server/src` returns 0 hits, and `api` typecheck + build are green.
6. Status chip reflects reality: killing the connector flips it to `Connector offline` within 2 heartbeat intervals (≤30s).
7. No degradation: existing SnapTrade / Robinhood / Schwab connect flows in the same Settings panel are unchanged.

## Testing Plan

| Layer | What | Count |
|---|---|---|
| Unit | pairing-token issue/verify (single-use, TTL); connector registry online/last-seen; `rpc` id de-dupe | +5 |
| Integration | agent WS register→heartbeat→readiness; relay round-trip (`connect`→`needs_login`→`connected`); disconnect reaps connector | +4 |
| E2E (manual, gated) | real Windows connector: download→run→login+2FA→`connected`; P2 test order round-trip | +2 |

## Rollback

Feature-flag the wizard tile (`IBKR_LOCAL_CONNECTOR_ENABLED`); off = tile hidden, IBKR shows "coming soon." Deleting `proxyToGateway` is safe (the subpath login is already broken). No schema migration in P1; the connector registry can be in-memory first (a DB-backed map is a P2 hardening item so a PYRUS restart doesn't orphan connectors — connectors re-register on heartbeat regardless).

## Effort Estimate

- P1: agent (provision+launch+open-login+heartbeat) ~3d; PYRUS pairing/registry/WS + subpath-proxy deletion ~2d; wizard UI ~2d.
- P2: relay framing + `IbkrClient` tunnel baseUrl + idempotency ~3d.
- P3: signing + notarization + auto-update + mac/Linux ~1–2wk.

## Files Reference

| File | Change |
|---|---|
| `scripts/ensure-ibkr-portal-runtime.mjs` | Extract provisioning into the agent's first-run installer |
| `artifacts/api-server/src/routes/ibkr-portal.ts` | Delete proxy+rewrites; add `pair`/`download`/`tunnel`; keep 4 control endpoints |
| `artifacts/api-server/src/services/ibkr-portal-gateway-manager.ts` | Repurpose conf/spawn/health logic client-side; server keeps a connector registry |
| `artifacts/api-server/src/services/ibkr-portal-session.ts` | `baseUrl` resolves through the tunnel; readiness/tickle reused |
| `artifacts/api-server/src/services/ibkr-bridge-runtime.ts` | Revive registration/heartbeat/compatibility surface for the connector |
| `artifacts/api-server/src/routes/index.ts` | Register the new tunnel/pairing routes |
| `artifacts/pyrus/src/screens/settings/ibkrPortalConnectModel.js` + Settings tile | 4-step wizard + status chip |
| `packages/ibkr-connector/` (new) | The agent (Bun single-binary) |

## Out of Scope

- IBKR OAuth (`ibkr-oauth-readiness.ts`) — separate parallel track for the durable unattended answer.
- Unattended / overnight auto-trading through the local connector (attended-only interim; the auto-trader stays on its existing path).
- macOS/Linux agent builds (P3).
- Multi-connector-per-user / connector fleet management.

## Open decisions to confirm (Phase 4)

- D1 packaging (Bun binary vs Tauri), D2 download model (thin+fetch vs fat bundle), D3 P1 OS scope (Windows-first vs all), D4 tunnel (own WS vs third-party), D5 pairing/auth shape.
- Success metric target for "easy": e.g. median time-from-download-to-`connected` under N minutes? (define to make AC1–AC3 measurable).

## Related

- `SESSION_HANDOFF_LIVE_2026-07-03_ibkr-client-portal-hosted-connector.md` (workstream)
- `docs/plans/multi-broker-connections.md`, `docs/plans/broker-connection-ux-plan.md`
- Memory: `ibkr-per-user-gateway-fleet-hosting` (why central hosting was dropped)
