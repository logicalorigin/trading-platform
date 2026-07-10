# LIVE - IBKR session host control resume

- Last Updated (MT): `2026-07-09 22:22:27 MDT`
- Last Updated (UTC): `2026-07-10T04:22:27Z`
- Session ID: `019f4965-571b-78d0-beba-a408734da2da`
- Canonical handoff: `SESSION_HANDOFF_2026-07-09_019f4965-571b-78d0-beba-a408734da2da.md`
- Resuming: `019f48d5-54f7-75d3-82d9-1028f21ecc5f`
- Repo: `/home/runner/workspace`
- Workstream: hosted IBKR paper-login path, starting with the host-local control surface.

## Current Status

- Source handoff: `SESSION_HANDOFF_2026-07-09_019f48d5-54f7-75d3-82d9-1028f21ecc5f.md`.
- Scope constraint from prior handoff: use new/narrow IBKR files only; do not mutate Replit control-plane startup state; do not stage, commit, revert, or absorb unrelated dirty work.
- Observed current worktree before edits: only handoff files were dirty/untracked.
- Observed package mismatch: `lib/ibkr-session-host/src/capsule.test.ts` already expects `release()`, `getTarget()`, and fixed loopback relay publishes, but `capsule.ts` has not implemented them yet.
- Implemented manager support for status, target lookup, release, and fixed host-loopback relay publishes.
- Implemented host server control endpoints:
  - `POST /sessions/:sessionId/ensure`
  - `GET /sessions/:sessionId/status`
  - `POST /sessions/:sessionId/release`
- Control endpoints require `Authorization: Bearer <IBKR_SESSION_HOST_CONTROL_TOKEN>`; without a configured token they return `401`.
- Added `capsule/pyrus-capsule-relay.py`, copied into the image as `/usr/local/bin/pyrus-capsule-relay`, and updated the capsule entrypoint/health contract for CPG relay `15000` and noVNC relay `16080`.
- Added the disabled-by-default API-server hosted adapter and switched the existing IBKR HTTP proxy to the adapter-selected proxy origin/port.
- Added hosted `/status` refresh so recovered `occupied` capsules can advance to `ready` instead of remaining stuck at gateway-starting.
- Added the API server's authenticated, same-origin noVNC WebSocket upgrade tunnel with app-credential stripping and caller-owned gateway selection.
- Added fail-closed runtime validation for host capsule/target responses; targets must remain on loopback.
- Corrected the login URL to image-proven `vnc.html` plus a root-absolute WebSocket path that remains under the authenticated gateway mount.
- Real noVNC browser smoke rendered the IBKR login page and exposed that CPG defaults the login toggle to Live (`LOGIN_TYPE: '1'`); the prior host `mode: paper` label did not enforce paper mode.
- Added defense-in-depth paper enforcement: immutable Chromium extension selects/locks Paper, hosted gateways remain unavailable to broker calls until attested, `IbkrClient` accepts only nonempty `DU...` account sets in paper-only mode, and live/unverifiable sessions are released on status polling.
- Added frontend terminal-failure handling so a rejected live login closes the popup and reports the Paper Trading username requirement instead of polling for five minutes.
- No Replit artifact or startup control-plane files were changed by this workstream.

## Active Files

- `lib/ibkr-session-host/src/capsule.ts`
- `lib/ibkr-session-host/src/server.ts`
- `lib/ibkr-session-host/src/server.test.ts`
- `lib/ibkr-session-host/src/index.ts`
- `lib/ibkr-session-host/capsule/Dockerfile`
- `lib/ibkr-session-host/capsule/pyrus-capsule-entrypoint`
- `lib/ibkr-session-host/capsule/pyrus-capsule-health`
- `lib/ibkr-session-host/capsule/pyrus-capsule-relay.py`
- `lib/ibkr-session-host/capsule/paper-only-extension/manifest.json`
- `lib/ibkr-session-host/capsule/paper-only-extension/paper-only.js`
- `lib/ibkr-session-host/capsule/README.md`
- `artifacts/api-server/src/lib/runtime.ts`
- `artifacts/api-server/src/providers/ibkr/client.ts`
- `artifacts/api-server/src/providers/ibkr/client-paper-only.test.ts`
- `artifacts/api-server/src/services/ibkr-paper-account-policy.ts`
- `artifacts/api-server/src/services/ibkr-paper-account-policy.test.ts`
- `artifacts/api-server/src/services/ibkr-portal-gateway-manager.ts`
- `artifacts/api-server/src/services/ibkr-portal-gateway-manager.test.ts`
- `artifacts/api-server/src/routes/ibkr-portal.ts`
- `artifacts/api-server/src/routes/ibkr-portal-websocket.test.ts`
- `artifacts/api-server/src/routes/auth.ts`
- `artifacts/api-server/src/index.ts`
- `artifacts/api-server/src/services/ibkr-portal-session.ts`
- `artifacts/api-server/src/services/ibkr-portal-session.test.ts`
- `artifacts/pyrus/src/screens/settings/ibkrPortalConnectModel.js`
- `artifacts/pyrus/src/screens/settings/ibkrPortalConnectModel.test.mjs`
- `artifacts/pyrus/src/screens/settings/SnapTradeConnectPanel.jsx`

## Validation

- `pnpm --filter @workspace/ibkr-session-host test` -> 37/37 pass.
- `pnpm --filter @workspace/ibkr-session-host typecheck` -> pass.
- `pnpm --filter @workspace/ibkr-session-host build` -> pass.
- `pnpm --filter @workspace/api-server exec tsx --test src/services/ibkr-portal-gateway-manager.test.ts` -> 1/1 pass.
- `pnpm --filter @workspace/api-server run typecheck` -> pass.
- Hosted adapter RED/GREEN test: missing `refreshGateway` failed as expected, then the focused test passed after implementation.
- noVNC proxy RED/GREEN test: missing upgrade attachment failed as expected; final test passes with 401/403 gates, `binary` subprotocol, credential stripping, and binary echo.
- Host-response validation RED/GREEN test: non-loopback target was accepted before the fix; both adapter tests now pass.
- Final `pnpm --filter @workspace/api-server run typecheck` -> pass.
- Final focused API set -> 4/4 pass; API build -> pass.
- A later full typecheck rerun is blocked by unrelated concurrent `candidatesPerBucket` errors in `shadow-account-eqh-demand.test.ts`; the prior typecheck passed this IBKR slice.
- Pinned image inspection: no `index.html`; `vnc.html` exists; noVNC 1.3 constructs `url += '/' + path`, confirming the corrected login/socket URL.
- Live supervisor PID `73200` remained healthy and `/api/healthz` returned 200; hosted flags and host process are absent, so no reload was attempted.
- Current capsule rebuild -> pass; new image ID `sha256:6d99af0c07754951030ef2a4cab126c648bd7f30bda772682f9be84905336b61`.
- The interrupted broad broker route test process is no longer running.
- Real pre-guard capsule smoke passed CPG/noVNC/RFB transport and Docker hardening; raw CDP screenshot proved the actual IBKR login rendered.
- Official IBKR Campus documentation identifies the separate Paper Trading username and `DU` paper account prefix; the API policy uses a conservative `^DU[0-9]+$` boundary.
- Paper policy focused tests pass: live-account rejection, paper-account acceptance, gateway verification state, and hosted live-session release.
- Capsule image-contract tests pass with the new paper-only extension.
- Pyrus terminal-connect model test passes.
- Rebuilt paper-guard image: `sha256:d4e8dd384052ddb12f326f664d835f1ef5df0ff8899f8365d9a523efe70636ef` (`pyrus-ibkr-capsule:dev-20260710-paper`).
- Exact-image runtime smoke passed: host/capsule ready, CPG 302, noVNC 200, restart count 0, no OOM, read-only root, 2 GiB/1 CPU/512 PID limits, and the sole container log is the readiness marker.
- Host process inspection shows Chromium launched with both `--disable-extensions-except=/opt/pyrus/paper-only-extension` and `--load-extension=/opt/pyrus/paper-only-extension` under UID 10001.
- noVNC visual proof shows IBKR `SIMULATED`, Paper selected, and `Simulated Login`; clicking the rendered Paper toggle left that state unchanged.
- API and Pyrus typechecks pass; API and Pyrus production builds complete; focused API suite is 8/8, host suite 37/37.
- Main slice was adopted and committed by the supervising agent as `d5821e1e` (`feat(ibkr-portal): hosted client-portal control/login slice — paper-only fail-closed, noVNC WS tunnel`).
- Final adversarial pass added/verified three additional boundaries: unverified per-user gateways cannot fall back to a global IBKR runtime; raw order payload account references must also be paper IDs; release failures remain observable after routing is removed.
- Hosted control configuration now accepts only plain HTTP on exact `127.0.0.1` and rejects credentials/path/query/hash/non-loopback URLs before sending the bearer token. The shared `@workspace/ibkr-contracts` runtime type carries the optional paper-only flag.
- Final focused API suite is 12/12; API bundle passes; direct `ibkr-contracts` typecheck passes. A later broad API typecheck is blocked only by five concurrent errors in `shadow-account-read-cache.test.ts`; this lane did not edit that file, and API typecheck passed before those concurrent changes appeared.
- Smoke cleanup complete: no `pyrus-ibkr-slot-1` container, standalone host port `18748` closed, live Replit supervisor still PID `73200`, `/api/healthz` 200, no reload performed.
- Residual hardening landed as commit `80759dae` (`fix(ibkr-portal): harden hosted paper routing`) with only the four owned files.
- User approved the attended startup-maintenance window. Added only local `dev-env.local` hosted flags with an ephemeral token, left protected Replit config locked, and started exact image `sha256:d4e8dd...70636ef` host on loopback; `/readyz` is ready with capacity 0/1. Next action is sanctioned `SIGUSR2` reload of the existing PID `73200` supervisor.
- Mobile Connect reached the host and provisioned the exact-image capsule. Fixed the mobile popup gesture bug by synchronously opening the login tab before the async connect mutation; focused source tests, Pyrus typecheck, and Pyrus production build pass.
- The user's noVNC page then reported `Failed to connect to server`. Runtime proxy trail proved the HTML/assets loaded but every `/websockify` upgrade was rejected with `403`. A RED regression reproduced the production proxy headers (`Host` rewritten to loopback, matching public `Origin`/`X-Forwarded-Host`); the origin guard now accepts an exact direct- or forwarded-host match. Focused WebSocket test passes, full IBKR portal slice is 7/7, and API typecheck passes. Pending sanctioned reload and live WebSocket verification.
- Self-run public mobile QA found two additional runtime failures. Mobile browsers foregrounded the reserved `about:blank` tab before the opener's async Connect POST completed, leaving no new audit event; the mobile branch now provisions in the active tab and same-tab navigates using the existing `isMobileIbkrLaunchBrowser` helper, while desktop retains the popup with an absolute login URL.
- Public proxy load measured `89/120` asset requests passing versus `120/120` both direct to the capsule and direct to the local API. Added `ClientRequest.reusedSocket` evidence showed every public-path 502 was a stale reused socket. The console HTTP proxy now uses `agent: false`; a deterministic RED/GREEN test kills any second request on one upstream socket and now passes. Focused IBKR suite 7/7, frontend source tests 5/5, Pyrus typecheck/build pass. Broad API typecheck is blocked only by unrelated concurrent order-response test type errors. Pending reload and final public mobile QA.
- Replit's live WS chain was observed to send public `Origin`, rewritten loopback `Host`, and no `X-Forwarded-Host`; same-origin validation now exact-matches trusted `REPLIT_DEV_DOMAIN`/`REPLIT_DOMAINS` as well as direct/forwarded hosts. Public authenticated WS probe opens with `binary` protocol.
- Final Pixel 7 acceptance used the real UI controls (More -> Settings -> Data & Broker -> Interactive Brokers -> Connect): one tab, Connect 200 in 9.14s, encrypted noVNC WS open with 39 frames, 1364x768 framebuffer with 787,752 nonblank pixels. Screenshot visually proves `SIMULATED`, Paper selected, and `Simulated Login`.
- The long-lived smoke capsule's Chromium renderer had reached an `Aw, Snap!` page after nearly two hours despite no OOM and 17% memory use. With no credentials entered, the capsule was released/recreated once through authenticated host control; the fresh exact-image capsule passed the acceptance run. Temporary QA sessions/scripts/screenshots were removed.
- Mobile/proxy fixes landed atomically as `398df9b0` (`fix(ibkr-portal): make hosted login work on mobile`) with exactly the API route/test and Settings connect panel/source test.
- Post-user-rebuild Pixel 7 rerun passed unchanged: Connect 200 in 5.709s, one tab, encrypted noVNC open with 40 frames, 1364x768 framebuffer and 787,731 nonblank pixels. Visual inspection again proved `SIMULATED`, Paper selected, and `Simulated Login`. Only noVNC's optional `/package.json` version probe returned a harmless 404. Temporary QA session/artifacts were removed.
- Mobile UX investigation confirmed the fixed `1364x768` + noVNC `resize=scale` combination shrinks the login to `412x232` in a `412x915` viewport. Same-origin framing is allowed, but an iframe around the current viewer would retain the remote-canvas keyboard/input problem.
- An isolated throwaway probe proved this noVNC/x11vnc pair supports remote resize (`1364x768` -> `412x768`); the probe container was removed. A usable security-preserving in-app surface still needs portrait-capable Xvfb geometry and Chromium window resize verification.
- Direct CPG HTML is responsive and observed without frame-blocking headers, but embedding it directly bypasses the capsule's immutable Paper-toggle extension and routes form credentials through the HTTP proxy. DU-only server attestation remains fail closed. Awaiting an explicit product/security choice before editing.
- User selected native direct CPG embedding. Proceed test-first with a separately authenticated CPG proxy mount and an in-app full-screen iframe; retain DU-only attestation/release as the hard trading boundary and do not log or store credential bodies.
- Native preflight exposed a serial TCP relay: the first keep-alive browser connection blocked all later CPG assets. `pyrus-capsule-relay.py` now handles accepted clients on standard-library daemon threads. The focused regression timed out RED and passes GREEN while the first connection remains open.
- Strict same-host iframe sandboxing was rejected by a direct Chromium proof: sandboxed login POSTs omit both cookies and Referer, while adding `allow-same-origin` on the PYRUS origin would expose the parent app boundary. The existing TLS-valid `REPLIT_EXPO_DEV_DOMAIN` resolves to the same app on a distinct origin, so implementation is moving to a one-time alternate-origin embed grant plus short-lived HttpOnly session and frame-ancestor restriction.

## Next Step

1. Decide between (A) a full-screen in-app noVNC surface with remote portrait resizing, preserving the capsule Paper lock, and (B) a native direct CPG iframe, relying on server DU-only attestation but changing the credential/paper-lock boundary.
2. Implement and mobile-test the chosen path before asking the user to enter Paper credentials/2FA. Never record credentials.
3. After login, verify CPG authentication and DU-only account attestation, then decide whether to leave the attended host active or restore disabled-by-default state. The host lifecycle remains attended/manual.
