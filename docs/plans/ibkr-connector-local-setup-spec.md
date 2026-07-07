# Spec: PYRUS IBKR Desktop Connector

> Status: FRESH SPEC - rebuilt 2026-07-06 after local repo audit and external Codex audit.
> Track: interim, attended-only Client Portal Gateway path while IBKR third-party OAuth approval remains separate.
> Implementation target: Windows-first novice install, then macOS/Linux only after the Windows path is verified.

## Objective

Let a PYRUS user connect Interactive Brokers without PYRUS hosting that user's Client Portal Gateway. The user installs a small PYRUS desktop connector, the connector provisions and runs IBKR's `clientportal.gw` locally, and PYRUS talks to the connector through an authenticated outbound WebSocket. The user's IBKR login, 2FA, gateway cookies, and local certificate warning stay on the user's own machine.

Success means a novice Windows user can go to Settings, pick IBKR, download one installer, run it, click "Open desktop connector" after install, complete IBKR's local browser login, and see PYRUS report that IBKR is connected. Trading remains paper-gated until the order safety workflow is complete.

This document replaces the previous hosted-gateway plan. Do not implement from older assumptions in session handoffs.

## Source Facts

Official IBKR docs impose these constraints:

- Gateway setup: IBKR describes the Client Portal Gateway as a Java program requiring a JRE, launched from `clientportal.gw` with `bin\run.bat root\conf.yaml` on Windows or `bin/run.sh root/conf.yaml` on Unix. Users authenticate by opening `https://localhost:5000` and logging in locally. Source: https://www.interactivebrokers.com/campus/trading-lessons/launching-and-authenticating-the-gateway/
- Local certificate: the gateway ships with a default certificate. Browser warnings are expected because the certificate is local to `localhost`; IBKR states the outbound localhost-to-IBKR connection remains secure. Source: https://www.interactivebrokers.com/campus/ibkr-api-page/cpapi-v1/
- Auth cannot be automated: IBKR says individual Client Portal Gateway brokerage-session authentication cannot be automated and recommends against third-party automation of brokerage-session login. Source: https://www.interactivebrokers.com/campus/ibkr-api-page/cpapi-v1/
- Reauthentication: IBKR says Client Portal Gateway users must reauthenticate at least once after midnight each day. Source: https://www.interactivebrokers.com/campus/ibkr-api-page/cpapi-v1/
- Session model: `/iserver` endpoints require a brokerage session. CP Web API has an outer read-only session and an inner brokerage session; only one active trading-enabled brokerage session can exist per IB username across IBKR platforms. Source: https://www.interactivebrokers.com/campus/ibkr-api-page/cpapi-v1/
- Paper accounts: IBKR paper login uses a distinct paper username, not a live/paper toggle in the gateway login UI. Source: https://www.interactivebrokers.com/campus/ibkr-api-page/cpapi-v1/
- Tickle: IBKR documents `POST /tickle` as the keepalive endpoint and expects it to be called about every 60 seconds to maintain the brokerage session. Source: https://www.interactivebrokers.com/campus/ibkr-api-page/cpapi-v1/
- Order submission: IBKR order APIs require trading permissions, authorized session, brokerage session, account ID, and order-specific fields. Order replies may require explicit confirmation via `/iserver/reply/{messageId}` before an order goes to work. Source: https://www.interactivebrokers.com/campus/ibkr-api-page/webapi-doc/
- Order types: IBKR says order ideas should be tested manually before API execution and that paper execution behavior is simulated. Source: https://www.interactivebrokers.com/campus/ibkr-api-page/order-types/

## Current Repo Facts

Observed in this worktree:

- Hosted browser proxy still exists in `artifacts/api-server/src/routes/ibkr-portal.ts`: `GW_BASE`, `proxyToGateway`, request-body encoding, location/cookie/body rewrites, and `/broker-execution/ibkr-portal/gateway`.
- Gateway re-anchor guards still exist in `artifacts/api-server/src/app.ts` and `artifacts/pyrus/vite.config.ts`.
- Request-scoped routing still binds every authenticated app request to `runWithIbkrPortalUser`, and `ibkr-client-runtime.ts` falls back to global `IBKR_CLIENT_PORTAL_BASE_URL` / `IBKR_BASE_URL` runtime config.
- `IbkrClient` is an HTTP client built around `baseUrl + path`; a WebSocket tunnel cannot be introduced by only changing `baseUrl`.
- Current `IbkrClient.confirmOrderReplies` auto-posts `{ confirmed: true }` to IBKR reply prompts. The fresh plan must stop that before live trading is enabled.
- OpenAPI and generated clients expose only `readiness`, `status`, `connect`, and `disconnect` with old states: `unavailable`, `disconnected`, `gateway_starting`, `needs_login`, `competing`, `connected`.
- The Settings UI is old popup flow based and admin-only. It opens the proxied gateway login path instead of installing or relaunching a desktop connector.
- `artifacts/api-server/src/providers/ibkr/bridge-client.ts` and `artifacts/api-server/src/services/ibkr-bridge-runtime.ts` are deleted in this worktree. Any "bridge" surface must be rebuilt as a new connector surface, not revived in place.
- Workspace package globs are `artifacts/*`, `lib/*`, and `scripts`; there is no `packages/` workspace.
- `scripts/ensure-ibkr-portal-runtime.mjs` downloads the official `clientportal.gw.zip` but currently provisions Linux/x64 JRE and shells out to `curl`, `unzip`, `tar`, and `bash`. It is useful as logic reference, not as the Windows novice installer.

## Product Requirements

1. Settings must be the only place a novice needs to start.
2. The user must download a generic signed Windows installer, not a per-user secret-bearing binary.
3. After installation, Settings must relaunch the connector using a registered protocol URL: `pyrus-ibkr://pair?...`.
4. The browser must not assume it can detect installed software directly. Installed detection is inferred from connector heartbeat after protocol launch.
5. The connector must never collect or store IBKR username/password.
6. The connector must open the local IBKR login page and let the user complete IBKR credentials and 2FA in the browser.
7. PYRUS must display the expected local certificate warning in plain novice-safe copy before login.
8. Hosted gateway login through the PYRUS API origin must be removed or hard-disabled.
9. Until OAuth approval or a later explicit live rollout, this path is attended-only and paper-gated.
10. Live order placement must remain blocked until paper account detection, order confirmation, order ledger, reconciliation, and user-visible IBKR reply handling are shipped.

## Architecture

```
Settings UI                         PYRUS API                         User machine
-----------                         ---------                         ------------
IBKR tile
  | POST /pair
  | < pairing token + protocol URL
  | download installer
  | open pyrus-ibkr://pair?token=...
  v
poll /readiness  <-------------  device registry  <--- wss register --- connector
                                      |                              |
                                      | command frames                | local CPAPI client
                                      v                              v
                                IBKR connector port         https://127.0.0.1:5000/v1/api
                                                                  clientportal.gw
                                                                  local browser login
```

Key rule: PYRUS server sends typed connector commands, not arbitrary HTTP path/method RPC. The connector owns the CPAPI HTTP client, endpoint allowlist, localhost TLS handling, tickle loop, and local gateway process supervision.

## Component Boundaries

### Desktop connector

New workspace package: `artifacts/ibkr-connector`.

Responsibilities:

- Register `pyrus-ibkr://` protocol during install.
- Store connector credential in Windows DPAPI or Windows Credential Manager.
- Provision `clientportal.gw` and a Windows JRE under a per-user app data directory.
- Verify downloaded gateway and JRE artifacts with pinned hashes or a signed manifest before use.
- Start `clientportal.gw` on `127.0.0.1`, prefer port `5000`, fall back to a configured alternate such as `5001` if occupied.
- Open `https://localhost:<port>` for login.
- Call `POST /tickle` approximately every 60 seconds only after the gateway is reachable.
- Call `POST /iserver/auth/status`, `GET /sso/validate`, `POST /iserver/auth/ssodh/init` where appropriate, and account endpoints through the local gateway.
- Maintain an outbound `wss` connection to PYRUS and send heartbeats every 15 seconds.
- Execute only typed, allowlisted commands from PYRUS.
- De-dupe command IDs, especially order-capable commands.
- Provide visible local status: starting, login required, connected, reauth required, provisioning failed.

Non-responsibilities:

- No IBKR credential capture.
- No automated IBKR login or 2FA.
- No inbound listener exposed beyond loopback.
- No arbitrary server-driven URL fetches.

### PYRUS API

Responsibilities:

- Issue short-lived, single-use pairing tokens bound to the authenticated app user.
- Persist connector devices and hashed connector credentials.
- Authenticate connector WebSockets using connector credentials, not browser cookies.
- Keep live sockets in memory, backed by durable device rows for revoke/relaunch/audit.
- Expose generated HTTP APIs for Settings.
- Route IBKR-specific platform calls through an explicit connector execution port, not `baseUrl` substitution.
- Remove hosted gateway proxy and re-anchor middleware.
- Enforce entitlement, paper gate, brokerage-session readiness, and order-safety gates server-side.
- Revoke devices and disconnect live sockets on user action.

### Settings UI

Responsibilities:

- Render novice setup states from generated API types.
- Offer "Download for Windows", "Open desktop connector", "Retry", "Disconnect", and "Revoke this computer".
- Use `pyrus-ibkr://pair?...` to relaunch the connector after installation.
- Poll readiness while pairing/login is in progress.
- Explain expected local browser certificate warning before opening login.
- Surface competing session and daily reauth states with concrete recovery actions.

## API Contract

Update `lib/api-spec/openapi.yaml` first, regenerate `lib/api-client-react` and `lib/api-zod`, then implement server and UI. Do not hand-edit generated clients.

HTTP endpoints:

- `POST /broker-execution/ibkr-portal/pair`
  - Auth: user + CSRF + entitlement.
  - Response: `{ pairingToken, expiresAt, protocolUrl, downloads: [{ os, url, minVersion }] }`.
  - Token TTL: 10 minutes. Single use. Store only token hash server-side.
- `GET /broker-execution/ibkr-portal/readiness`
  - Auth: user.
  - Response state machine below plus device/account metadata safe for UI.
- `POST /broker-execution/ibkr-portal/open`
  - Auth: user + CSRF.
  - Response: fresh `protocolUrl` for the existing device or new pairing intent.
- `POST /broker-execution/ibkr-portal/disconnect`
  - Auth: user + CSRF.
  - Effect: asks connector to logout/stop gateway if online and marks current session disconnected.
- `POST /broker-execution/ibkr-portal/revoke-device`
  - Auth: user + CSRF.
  - Effect: revokes the device credential, closes any live socket, and removes it from readiness.
- `GET /broker-execution/ibkr-portal/download/windows`
  - Auth: user.
  - Response: redirect to signed installer or streams installer from a release artifact.

WebSocket endpoint:

- `WS /broker-execution/ibkr-portal/connector`
  - Upgrade auth: connector credential in an authorization header or first frame before registration completes.
  - Browser cookies must not authenticate connector sockets.

## Connector Protocol

Frames are JSON with `{ id, type, payload }`. All request IDs are globally unique. Server commands have an idempotency key when side effects are possible.

Connector -> server:

- `register`: `{ connectorId, credentialProof, version, os, machineLabel }`
- `heartbeat`: `{ status, gatewayPort, gatewayVersion, authenticated, connected, competing, selectedAccountId, accountIds, lastTickleAt, nextReauthRequiredAt }`
- `command_result`: `{ commandId, ok, result, error }`
- `order_reply_pending`: `{ commandId, replyId, message, messageIds, orderPreview }`

Server -> connector:

- `session_open_login`: open local browser to gateway login.
- `session_check`: run `/iserver/auth/status`, `/sso/validate`, and account load checks.
- `session_tickle`: force one `/tickle`.
- `account_list`: list accounts safe for PYRUS to display.
- `marketdata_snapshot`: optional, only after market-data plan defines limits.
- `order_preview`: create local preview using PYRUS and IBKR-safe fields. No order submission.
- `order_submit_paper`: submit paper-gated order.
- `order_confirm_reply_paper`: confirm one specific IBKR reply after explicit user confirmation.
- `order_status`: reconcile by `cOID` / IBKR order id.
- `disconnect`: logout gateway and stop tickle loop.

No generic `{ method, path, headers, body }` command is allowed in P1/P2. If a future generic transport is introduced for maintenance, it must be endpoint-allowlisted, method-allowlisted, forbidden from order endpoints by default, and separately security-reviewed.

## State Machine

```
never_paired
  -> installer_downloaded
  -> protocol_launching
  -> paired_offline
  -> connector_online
  -> provisioning_gateway
  -> login_required
  -> brokerage_session_ready
  -> reauth_required

Any state -> provisioning_failed
Any state -> unsupported_version
Any state -> device_revoked
Any authenticated state -> competing_session
Any online state -> connector_offline
```

State meanings:

- `never_paired`: no active device.
- `installer_downloaded`: UI issued a pairing token and download link.
- `protocol_launching`: browser attempted `pyrus-ibkr://`.
- `paired_offline`: device exists but no heartbeat.
- `connector_online`: connector socket registered, gateway not ready.
- `provisioning_gateway`: connector is downloading/verifying JRE or gateway, or starting the JVM.
- `login_required`: local gateway reachable but user must log in.
- `brokerage_session_ready`: `connected`, `authenticated`, no `competing`, and at least one account loaded.
- `reauth_required`: daily reauth or IBKR timeout detected.
- `competing_session`: IBKR reports another brokerage session.
- `unsupported_version`: connector version below server minimum.
- `provisioning_failed`: connector reports install/start/download failure with recovery detail.

## Data Model

Add DB-backed device records. In-memory-only registry is not enough because Settings needs relaunch, revoke, audit, and restart recovery.

Tables:

- `ibkr_connector_pairing_tokens`
  - `id`, `app_user_id`, `token_hash`, `expires_at`, `used_at`, `created_at`, `user_agent`, `ip_hash`.
- `ibkr_connector_devices`
  - `id`, `app_user_id`, `credential_hash`, `display_name`, `os`, `connector_version`, `first_seen_at`, `last_seen_at`, `revoked_at`, `revoked_reason`, `last_status`, `last_gateway_port`.
- `ibkr_connector_order_ledger`
  - `id`, `app_user_id`, `device_id`, `account_id`, `mode`, `client_order_id`, `idempotency_key`, `payload_hash`, `status`, `ibkr_order_id`, `reply_id`, `reply_message`, `submitted_at`, `confirmed_at`, `reconciled_at`, `last_error`.

Runtime memory:

- `connectorSockets: Map<deviceId, socket>` for currently online devices.
- `pendingCommands: Map<commandId, resolver>` with timeouts.
- On API restart, devices reconnect and re-register. Old sockets are not trusted without credential auth.

## Security Requirements

- Store only hashed server-side connector credentials.
- Use random 256-bit device credentials.
- Rotate credential on explicit re-pair or suspicious duplicate registration.
- Reject connector registration if device is revoked or version is below minimum.
- Bind device to exactly one `app_user_id`.
- Do not allow cross-user pairing token use.
- Do not authenticate WebSocket upgrades with browser cookies.
- Do not forward PYRUS session cookies or CSRF tokens to the connector.
- Never log pairing tokens, connector credentials, IBKR cookies, SSO tokens, account numbers beyond masked forms, or order payloads with sensitive fields.
- Connector stores local secret in Windows DPAPI/Credential Manager. File fallback is allowed only for development and must be blocked in production builds.
- Connector verifies all downloaded artifacts. If IBKR does not publish checksums for `clientportal.gw.zip`, PYRUS must fetch via a signed manifest we control and update intentionally.
- Installer must be code signed before any novice-user rollout.

## Order Safety

This connector must not inherit the current auto-confirm behavior.

Requirements before any live-capable path:

1. Remove or gate `confirmOrderReplies` auto-confirmation. IBKR reply text must be returned to PYRUS and shown to the user.
2. Require a second explicit user confirmation for each IBKR reply prompt.
3. Use durable `client_order_id` / `cOID` and idempotency key for every order submission.
4. On timeout or socket drop after submit, do not blindly retry. Reconcile by `cOID`, order status, and recent orders before allowing another submit.
5. Paper-gate first. The server must verify paper mode using IBKR session data such as `/sso/validate` `LOGIN_TYPE = 2` or an account/user allowlist. PYRUS `mode: "shadow"` is not the same as IBKR paper trading.
6. Block live account IDs by default. Enabling live requires a separate product/security review.
7. Maintain an immutable order ledger for every submit, reply, confirmation, timeout, and reconciliation event.
8. Keep supported order types narrow for P2: market, limit, stop, stop-limit only if the current platform supports and tests the exact payload. Complex orders are out of scope.

## Market Data

Do not silently move market data through the connector in P1. IBKR market data requires a brokerage session and user-specific subscriptions. The current repo also has separate IBKR data-line and market-data pressure work.

P1/P2 scope:

- P1: no market data through connector.
- P2: account/order reads and paper order path only.
- P3: market-data connector support only after a separate line-limit, subscription, pacing, unsubscribe, and pressure plan is approved.

## Implementation Phases

### Phase 0: Contract and kill switch

Goal: make the source of truth impossible to confuse.

Tasks:

- Update OpenAPI with new readiness states and endpoints.
- Regenerate `lib/api-client-react` and `lib/api-zod`.
- Add API tests proving old hosted gateway routes are unavailable.
- Add an audit guard or focused test that fails on `proxyToGateway`, `GW_BASE`, `ibkrGatewayMount`, or `ibkr-gateway-mount-reanchor`.
- Remove or hard-disable hosted gateway proxy in `routes/ibkr-portal.ts`.
- Remove app and Vite re-anchor guards.
- Stop global request context from routing arbitrary authenticated requests to hosted gateway processes.
- Decide replacement behavior for global `IBKR_CLIENT_PORTAL_BASE_URL` fallback. Recommended: allow only explicit internal/dev configuration, never user trading.

Done when:

- `/api/broker-execution/ibkr-portal/gateway` cannot be used.
- Generated API clients know the new connector states.
- Typecheck for touched packages passes.

### Phase 1: Pairing, device registry, and UI wizard

Goal: Settings can download, launch, pair, revoke, and display real connector state without touching IBKR trading.

Tasks:

- Add DB schema/migration for pairing tokens and connector devices.
- Add pairing, open, readiness, disconnect, revoke, and download endpoints.
- Add WebSocket upgrade handler in `artifacts/api-server/src/index.ts` using the existing `ws` no-server pattern.
- Build Settings wizard in `SnapTradeConnectPanel.jsx` or split into a dedicated IBKR panel.
- Replace admin-only helper with entitlement/capability gating.
- Add protocol-launch flow and manual fallback: show a one-time pairing code if protocol launch fails.

Done when:

- A fake connector can pair and heartbeat.
- Settings moves from `never_paired` to `connector_online`.
- Revoke disconnects the fake connector and prevents reconnect.

### Phase 2: Windows connector MVP

Goal: a signed Windows installer installs and launches a connector that provisions and runs the local gateway.

Tasks:

- Add `artifacts/ibkr-connector`.
- Build a Windows-first connector with protocol handler, autostart or startup shortcut, local status, DPAPI secret storage, and outbound WSS.
- Implement Windows provisioning for JRE and `clientportal.gw`.
- Verify download hashes/signatures through a PYRUS-controlled manifest.
- Start gateway on loopback with TLS enabled because IBKR documents `https://localhost:5000/v1/api` as standard.
- Open the local browser login and report `login_required`.
- Implement `/tickle`, `/iserver/auth/status`, `/sso/validate`, account loading, and daily reauth detection.

Done when:

- On a clean Windows VM, a novice install reaches `brokerage_session_ready` with a paper IBKR login.
- Killing the connector flips Settings to `connector_offline` within 30 seconds.
- Restarting the connector reuses the stored device credential without re-downloading.

### Phase 3: Server execution port

Goal: server code can use connector-backed IBKR operations without pretending WebSocket is an HTTP `baseUrl`.

Tasks:

- Define an `IbkrExecutionPort` interface for the server's actual needs: session check, accounts, preview, submit paper order, confirm reply, status/reconcile, cancel where supported.
- Make existing HTTP `IbkrClient` implement that interface for explicitly configured internal/dev runtime.
- Implement `IbkrConnectorExecutionClient` that sends typed connector commands.
- Move platform trading call sites from concrete `IbkrClient` dependency to `IbkrExecutionPort`.
- Add command timeout and disconnect behavior.

Done when:

- Existing platform order/readiness tests pass against the HTTP implementation.
- New connector tests prove server command -> fake connector -> fake CPAPI response -> platform response.

### Phase 4: Paper order flow

Goal: paper-account order submission works with explicit reply handling and reconciliation.

Tasks:

- Add order ledger table and service.
- Add paper-account verifier.
- Replace auto-confirmed reply behavior with pending-reply UI/API workflow.
- Add idempotent submit with `cOID`.
- Add timeout reconciliation by `cOID` and recent order status.
- Add UI for IBKR reply messages requiring explicit confirmation.
- Run one manual paper order test and record evidence.

Done when:

- A paper order can be previewed, submitted, reply-confirmed if needed, reconciled, and read back.
- Duplicate submit command IDs execute at most once.
- A dropped socket after submit does not double-submit.

### Phase 5: Distribution hardening

Goal: novice rollout quality.

Tasks:

- CI build for Windows installer.
- Authenticode signing.
- Release artifact hosting with checksums.
- Minimum-version enforcement.
- Crash logs without secrets.
- Auto-update or guided update path.
- Installer uninstall/reinstall/re-pair tests.

Done when:

- A non-engineer can install, connect, disconnect, revoke, reinstall, and reconnect using only Settings.

## Testing Strategy

Unit tests:

- Pairing token TTL, single-use, cross-user rejection.
- Device credential hashing, revoke, version checks.
- Readiness state mapping.
- Command ID de-dupe.
- Endpoint allowlist rejects arbitrary CPAPI paths.
- Paper-account verifier.
- Order ledger idempotency and timeout states.

Integration tests:

- HTTP pair -> fake connector WS register -> heartbeat -> readiness.
- Revoke closes socket and blocks reconnect.
- Connector command timeout returns recoverable API error.
- Fake CPAPI `auth/status`, `sso/validate`, `tickle`, account list.
- Hosted gateway route removed.
- OpenAPI generated clients have no drift: `pnpm run audit:api-codegen`.

Frontend tests:

- IBKR status model covers all new states.
- Settings wizard shows correct primary action for each state.
- Protocol-launch timeout falls back to download/manual pairing.
- Non-entitled user cannot manage IBKR.

Manual gated tests:

- Windows clean VM install.
- Windows upgrade from older connector.
- Local cert warning flow.
- IBKR paper login + 2FA.
- Daily reauth after midnight or simulated expiry.
- Paper order submit, reply prompt, confirm, reconcile.

Recommended focused validation commands:

```bash
pnpm run audit:api-codegen
pnpm --filter @workspace/api-server run typecheck
pnpm --filter @workspace/pyrus run test -- ibkr
pnpm --filter @workspace/api-server run test -- ibkr
```

Adjust exact test commands after package scripts are confirmed in the implementation branch.

## Failure Modes

| Failure | Required behavior |
|---|---|
| User downloads but does not install | Settings stays in `installer_downloaded` and shows "Run installer", "Download again", and "I installed it, open connector". |
| Protocol URL launched before install | Browser times out waiting for heartbeat and keeps download/manual pairing visible. |
| Pairing token expired | Connector reports pair failure; UI issues a fresh token with one click. |
| Gateway port busy | Connector tries configured fallback port, reports chosen port in heartbeat. |
| Gateway download fails | UI shows `provisioning_failed` with retry and support detail. |
| Local cert warning scares user | UI explains expected localhost-only warning before opening login. |
| IBKR competing session | UI shows `competing_session` and tells user to log out of TWS/IBKR Mobile or use paper username. |
| Midnight reauth | UI shows `reauth_required`; connector opens local login on user action. |
| WebSocket drops during order | Ledger marks unknown, blocks retry, reconciles by `cOID`. |
| Server restart | Connector reconnects; device row persists; readiness returns after heartbeat. |
| Device stolen/revoked | Server rejects credential, closes socket, and requires new pairing. |

## What Already Exists To Reuse

- Existing `IbkrClient` request and CPAPI mapping logic can be reused behind an interface for internal/dev HTTP mode, but not by pretending the connector WebSocket is a `baseUrl`.
- Existing platform readiness guard can be adapted to connector-backed session health.
- Existing Settings broker panel patterns can be reused, but the IBKR popup flow must be replaced.
- Existing OpenAPI generation flow must be used.
- Existing `ws` server upgrade pattern in `artifacts/api-server/src/ws/options-quotes.ts` can guide connector socket attachment.
- Existing `scripts/ensure-ibkr-portal-runtime.mjs` gives source URLs and basic gateway/JRE provisioning logic, but Windows implementation must be rewritten.

## Not In Scope

- IBKR OAuth approval and OAuth production integration. See `docs/plans/ibkr-third-party-oauth-scope.md`.
- Unattended overnight/live auto-trading through the desktop connector.
- Live-account order submission.
- macOS/Linux connector releases before Windows succeeds.
- Market-data streaming through connector.
- Multiple simultaneous connector devices per user beyond replacing/revoking the active device.
- Complex order types, combos, algos, and bracket orders.
- Third-party login automation.

## Acceptance Criteria

1. Old hosted gateway login path is unavailable and covered by a regression test.
2. New OpenAPI, generated React client, and generated Zod schemas include the connector states/endpoints.
3. Settings can issue a pairing token, download installer link, launch `pyrus-ibkr://`, and reflect fake connector heartbeat.
4. A Windows VM install provisions JRE + `clientportal.gw`, starts the gateway locally, and opens `https://localhost:<port>`.
5. A real paper IBKR login reaches `brokerage_session_ready`.
6. Daily reauth and competing session states are visible and recoverable.
7. Revoking a device blocks future connector registration with the old credential.
8. No IBKR username/password or connector secret appears in logs.
9. Paper order flow cannot auto-confirm IBKR replies and cannot double-submit on retry/timeout.
10. SnapTrade, Robinhood, and Schwab connection flows in Settings are unchanged.

## Worktree Parallelization

Sequential foundation:

- Phase 0 must land first because it changes contracts and removes stale hosted-gateway surfaces.

Parallel after Phase 0:

- Lane A: API registry, WebSocket, DB schema.
- Lane B: Settings wizard using generated types and fake connector states.
- Lane C: Windows connector prototype against fake server.

Merge A+B+C before Phase 3 because the execution port depends on real server protocol and connector command shape.

Phase 4 order safety should be mostly sequential. It touches platform order submission, connector commands, ledger schema, and UI confirmation.

## Open Questions

- Which Windows installer technology will be used? Requirement is signed per-user install, protocol handler, autostart, uninstall, and no terminal window. Do a packaging spike before connector logic if the answer is not already known.
- Where will signed installer artifacts be hosted: GitHub Releases, PYRUS API static route, or a private object store?
- What is the exact paper-account verifier for IBKR in production: `/sso/validate` `LOGIN_TYPE = 2`, account prefix allowlist, user-level allowlist, or a combination?
- Should the connector stop the gateway on PYRUS disconnect, or leave it running until user exits the connector?
- What support channel receives connector logs, and how are logs redacted before upload?

## Implementation Tasks

- [ ] T1 (P1) - Contract reset: update OpenAPI, regenerate clients, and replace old readiness enum.
- [ ] T2 (P1) - Hosted gateway removal: remove proxy, rewrites, app/Vite re-anchor guards, and add regression guard.
- [ ] T3 (P1) - Device persistence: add pairing-token and connector-device tables, hashing, revoke, and version checks.
- [ ] T4 (P1) - Connector WebSocket: implement credential-authenticated register, heartbeat, command, timeout, and disconnect.
- [ ] T5 (P1) - Settings wizard: replace popup flow with download/install/open/pair/login states.
- [ ] T6 (P1) - Windows packaging spike: prove installer, protocol handler, DPAPI storage, signing path, and artifact hosting.
- [ ] T7 (P2) - Connector MVP: provision Windows JRE/gateway, start local gateway, open login, tickle, status, and account checks.
- [ ] T8 (P2) - Execution port: introduce high-level server IBKR interface and connector-backed implementation.
- [ ] T9 (P1) - Order safety gate: remove auto-confirm behavior from any live-capable path before connector orders ship.
- [ ] T10 (P2) - Paper order ledger: implement idempotency, `cOID`, pending reply, explicit confirmation, and reconciliation.
- [ ] T11 (P2) - Manual Windows evidence: clean VM install and paper login/order evidence.

## References

- IBKR Client Portal API v1 docs: https://www.interactivebrokers.com/campus/ibkr-api-page/cpapi-v1/
- IBKR Launching and Authenticating the Gateway lesson: https://www.interactivebrokers.com/campus/trading-lessons/launching-and-authenticating-the-gateway/
- IBKR Web API docs: https://www.interactivebrokers.com/campus/ibkr-api-page/webapi-doc/
- IBKR Trading Web API session overview: https://www.interactivebrokers.com/campus/ibkr-api-page/web-api-trading/
- IBKR Order Types docs: https://www.interactivebrokers.com/campus/ibkr-api-page/order-types/
- Existing OAuth track: `docs/plans/ibkr-third-party-oauth-scope.md`
