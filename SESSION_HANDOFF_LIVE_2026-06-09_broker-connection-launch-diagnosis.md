# Live Session Handoff - Broker Connection Launch Diagnosis

- Last Updated (MT): `2026-06-09 11:11:30 MDT`
- Last Updated (UTC): `2026-06-09T17:11:30Z`
- Session ID: `claude:fb314818-0a28-46f8-9b7c-c1a4255fdf40`
- CWD: `/home/runner/workspace`
- Active Claude transcript: `/home/runner/.claude/projects/-home-runner-workspace/fb314818-0a28-46f8-9b7c-c1a4255fdf40.jsonl`
- Watcher output: `/tmp/claude-1000/-home-runner-workspace/fb314818-0a28-46f8-9b7c-c1a4255fdf40/tasks/bn4ouduhk.output`
- User clarification: IBKR is intentionally disconnected right now; do not treat disconnected broker state as the bug.

## Purpose

Inject Codex findings into Claude's active broker launch diagnosis without typing into the Claude TTY or responding to any permission prompt.

## Observed Runtime Facts

- Claude's active session is diagnosing the IBKR broker launch/autologin handoff, not the app responsiveness audit.
- Current `/api/session` shows the desktop agent is online, registered, compatible, and on helper `2026-06-09.ib-async-sidecar-v15-graceful-deactivate`.
- Current activation state is idle: `activeCount=0`, `currentOwner=none`, `currentPhase=idle`, `detail=No IBKR launch is active.`
- The live attempt captured by Claude's watcher reached credentials phase:
  - `10:58:59 owner=pyrus phase=credentials active=1 keyReads=2 handoffReady=True envSubmitted=False`
  - `11:01:15 owner=user phase=canceled active=0 keyReads=2 handoffReady=True envSubmitted=False`
- That means the helper published the login key and the browser/API read it twice, but the encrypted credential envelope was never submitted before cancel.

## Source-Verified Facts

- The frontend algorithm constant is already correct: `IBKR_LOGIN_HANDOFF_ALGORITHM = "RSA-OAEP-256-CHUNKED"` in `artifacts/pyrus/src/features/platform/HeaderStatusCluster.jsx:145`.
- The frontend key-read path is `waitForIbkrLoginKey()` in `HeaderStatusCluster.jsx:214`; it posts to `/api/ibkr/activation/:activationId/login-key/read`.
- The frontend credential delivery path is `deliverIbkrLoginCredentials()` in `HeaderStatusCluster.jsx:3433`.
- `deliverIbkrLoginCredentials()` appends `step: "encrypting_credentials"` before calling `encryptIbkrLoginEnvelope()` at `HeaderStatusCluster.jsx:3450`.
- The frontend envelope POST is `/api/ibkr/activation/${activationId}/login-envelope` at `HeaderStatusCluster.jsx:3463`.
- The server route exists at `artifacts/api-server/src/routes/platform.ts:1417`.
- The server increments `loginEnvelopeSubmitAttemptCount` immediately after matching activation/token in `submitLegacyIbkrBridgeLoginEnvelope()` at `artifacts/api-server/src/services/ibkr-bridge-runtime.ts:2808`.
- Claude observed `loginEnvelopeSubmitAttemptCount=0`, `lastLoginEnvelopeSubmitAttemptAt=null`, and no submit error code. That strongly means the matching `/login-envelope` handler was not entered.

## Inferences

- The old theory that the route or algorithm is wrong is disproven by source.
- The break is browser-side after `/login-key/read` returns ready and before the matching `/login-envelope` request reaches the server.
- Likely failure points are:
  - `deliverIbkrLoginCredentials()` never resumes after `waitForIbkrLoginKey()`;
  - `encryptIbkrLoginEnvelope()` throws before the POST leaves the browser;
  - `platformJsonRequest()` throws before or while sending the POST, without reaching the server route;
  - activation/token state is cleared or replaced in frontend state before delivery, but the fresh-launch branch still calls `deliverIbkrLoginCredentials()` after launch.
- Do not call branch #3 itself the root cause without proof: the fresh-launch branch in `handleSubmitAutoLogin()` still calls `deliverIbkrLoginCredentials()` at `HeaderStatusCluster.jsx:3690`.

## Unknowns To Resolve

- Unknown whether the frontend emitted the `encrypting_credentials` progress event during the live activation; the activation was canceled/cleared before Claude queried current diagnostics, so current `recentProgress` is empty.
- Unknown whether Web Crypto failed inside `encryptIbkrLoginEnvelope()` for the browser/runtime used in the Replit app.
- Unknown whether `platformJsonRequest()` generated a client-side error that was only displayed in UI state and not preserved in activation diagnostics.

## Recommended Next Diagnostic Patch

1. Add short-lived, source-local diagnostics around `deliverIbkrLoginCredentials()` in `HeaderStatusCluster.jsx`:
   - before and after `waitForIbkrLoginKey()`;
   - before and after `encryptIbkrLoginEnvelope()`;
   - immediately before `/login-envelope` POST;
   - catch/log `error.name`, `error.message`, `error.code`, and `error.status` for encryption and POST failures.
2. Preserve activation progress after cancel or expose latest activation-by-ID diagnostics long enough to inspect `encrypting_credentials` versus `credentials_sent_to_pyrus`.
3. Re-run one live launch attempt with Claude's watcher active and inspect whether the progress reaches `encrypting_credentials`.
4. Add a focused frontend test for `handleSubmitAutoLogin()` proving:
   - resume path calls credential delivery;
   - fresh remote-launch path calls credential delivery after launch;
   - replace-current-launch path intentionally cancels/relaunches rather than silently dropping delivery.

## Do Not Chase

- Do not treat `broker_not_configured` / disconnected IBKR as the bug for this pass; user said disconnected is expected.
- Do not change Replit startup config, artifact dev scripts, env vars, or Replit control-plane state.
- Do not change the handoff algorithm or endpoint names unless a new source/runtime fact disproves the current source evidence.

## 2026-06-09T23:06:52Z Codex Update

- Controlled remote-launch probe against the live API:
  - `/api/ibkr/remote-launch` with `autoLogin:true` queued job `e0dd9232564595ad8efa25bf6d3f9d51`.
  - Desktop `desktop-EASYSTREET-c572024619f59c20` claimed immediately.
  - Helper reached `helper_launched`, `checking_gateway_socket`, `autologin_preflight`, and `waiting_secure_credentials`.
  - `loginHandoffReady=true`, `loginKeyPublishedAt=2026-06-09T23:03:54.184Z`.
  - Probe was canceled with `/api/ibkr/activation/:activationId/cancel`; activation diagnostics showed `activeCount=0`.
- Source fix applied:
  - `artifacts/pyrus/src/features/platform/HeaderStatusCluster.jsx`: restored the `/login-envelope` POST to `timeoutMs: 0` while keeping the new retry/status-diagnostic wrapper. Working baseline used an untimed envelope POST; the current diff had introduced `timeoutMs: 8_000`.
  - `artifacts/api-server/src/services/ibkr-bridge-runtime.ts`: changed activation cancel to use `appendLegacyBridgeActivationProgress()` so cancellation also records the terminal connection-audit event. The live API still has the old in-memory audit until API restart/rebuild, but source and dist build are updated.
- Validation passed:
  - `pnpm --filter @workspace/pyrus exec node --test src/features/platform/ibkrConnectionCredentialActionModel.test.mjs src/features/platform/ibkrBridgeSession.test.mjs`
  - `pnpm --filter @workspace/pyrus run typecheck`
  - `pnpm --filter @workspace/api-server exec tsx --test src/services/ibkr-bridge-runtime.test.ts src/services/ibkr-connection-audit.test.ts`
  - `pnpm --filter @workspace/api-server run typecheck`
  - `pnpm --filter @workspace/api-server run build`

## Validation State

- No code changes made by this handoff.
- Source locations and current `/api/session` state were verified locally.
- Runtime browser repro still needed.
