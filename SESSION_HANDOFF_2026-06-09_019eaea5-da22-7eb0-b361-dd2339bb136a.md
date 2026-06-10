# Session Handoff — 2026-06-09

## Session Metadata

- Session ID: `019eaea5-da22-7eb0-b361-dd2339bb136a`
- Saved At (MT): `2026-06-09 18:31:37 MDT`
- Saved At (UTC): `2026-06-10T00:31:37.511Z`
- Summary: 2026-06-09 18:31:37 MDT | 019eaea5-da22-7eb0-b361-dd2339bb136a | pick up the work on the ibkr connection. we solved this already
- Repo Root: `/home/runner/workspace`
- Thread CWD: `/home/runner/workspace`
- Rollout Path: `/home/runner/.codex/sessions/2026/06/09/rollout-2026-06-09T17-09-25-019eaea5-da22-7eb0-b361-dd2339bb136a.jsonl`
- Branch: `main`
- HEAD: `3d425e5992f78bfe9a209ab907d0031b68da2d01`
- Latest Commit: `feat(ibkr): connection audit + perf capture + bridge runtime hardening`
- Latest Commit Session ID: `unknown`
- Title: pick up the work on the ibkr connection. we solved this already
- Model: `gpt-5.5`
- Reasoning Effort: `xhigh`
- Tokens Used: `31920809`

## Current User Request

pick up the work on the ibkr connection. we solved this already

## Latest Update — 2026-06-09 18:43:14 MDT / 2026-06-10T00:43:14Z

- Current request: investigate the credential portion after prior evidence isolated live hangs at `waiting_secure_credentials`.
- Observed historical live traces where the Windows helper published/read the login key, but Pyrus never recorded a `/login-envelope` submit attempt (`loginEnvelopeSubmitAttemptCount=0`). This keeps the root cause in the browser/UI credential delivery path rather than helper decrypt/claim.
- Observed UI root cause: `HeaderIbkrCredentialForm` cleared the password after `onSubmitCredentials` returned, while `handleSubmitAutoLogin` catches credential-delivery errors, sets UI state, and returns normally. A failed envelope delivery therefore erased the typed password before the active-helper retry/auto-resume path could use it.
- Fixed `artifacts/pyrus/src/features/platform/HeaderStatusCluster.jsx` so password clearing is driven by an explicit submit result. Credentials now clear after confirmed delivery or explicit non-retry terminal flows; failed delivery keeps the typed password in DOM memory for retry/auto-resume.
- Added `shouldClearIbkrPasswordAfterCredentialSubmit()` and regression coverage in `artifacts/pyrus/src/features/platform/ibkrConnectionCredentialActionModel.js` and `.test.mjs`.
- Validation passed:
  - `pnpm --filter @workspace/pyrus exec node --test src/features/platform/ibkrConnectionCredentialActionModel.test.mjs src/features/platform/ibkrLoginHandoffErrorModel.test.mjs`
  - `pnpm --filter @workspace/api-server exec tsx --test src/services/ibkr-bridge-runtime.test.ts src/services/ibkr-connection-audit.test.ts`
  - `pnpm --filter @workspace/pyrus run typecheck`
  - `pnpm --filter @workspace/pyrus run build`
  - `git diff --check -- artifacts/pyrus/src/features/platform/HeaderStatusCluster.jsx artifacts/pyrus/src/features/platform/ibkrConnectionCredentialActionModel.js artifacts/pyrus/src/features/platform/ibkrConnectionCredentialActionModel.test.mjs`
  - `curl -sS -m 5 http://127.0.0.1:18747/api/session | jq '{ibkr: .runtime.ibkr, configured: .configured.ibkr}'`
- Observed `/api/session`: desktop agent online/registered, helper v20 compatible, no upgrade required, reconnect available, activation idle.
- Unknown: no live credential launch was submitted in this pass; final proof still requires real credentials and 2FA approval.

## Live Watch — 2026-06-09 20:21:13 MDT / 2026-06-10T02:21:13Z

- User asked to watch while launching from remote/home-computer setup.
- Watched `/api/ibkr/activation/diagnostics`, IBKR connection flight recorder, and API pressure snapshots from roughly `02:03Z` through `02:20Z`.
- Observed home Windows helper alive and compatible:
  - desktop id `desktop-EASYSTREET-c572024619f59c20`
  - helper version `2026-06-09.ib-async-sidecar-v20-direct-gateway-typing`
  - repeated successful `/api/ibkr/desktop/register`, `/api/ibkr/desktop/heartbeat`, and `/api/ibkr/desktop/jobs/claim` requests
- Observed no broker launch activation:
  - `activeCount=0`
  - `currentPhase=idle`
  - `latestActivation=null`
  - no new IBKR flight-recorder events after the earlier `2026-06-10T00:41:14Z` test/diagnostic events
- Inference: if the remote launch button was clicked during this window, the request did not reach `/api/ibkr/remote-launch` or `/api/ibkr/bridge/launcher`; the helper was waiting for jobs but no launch job was queued.
- Observed concurrent non-IBKR API pressure:
  - `GET /accounts/shadow/positions` p95 reported around `50s-77s`
  - later slow drivers included `GET /flow/events/aggregate`, `GET /watchlists`, and `GET /signal-monitor/profile`
  - API RSS fluctuated around `3.0GB-3.8GB`
- Direct probe confirmed `GET /api/accounts/shadow/positions` timed out at 12 seconds both with `liveQuotes=false` and `liveQuotes=true`, so quote hydration is not the only slow path. Source inspection suggests the cold/no-cache shadow positions ledger read can still block when no stale cached value exists.
- Recommended next check: if remote UI launch was clicked, inspect browser/network state for the missing launch POST. If the UI remains sluggish, fix the non-IBKR shadow positions cold-read pressure before retesting IBKR launch.

## Successful Remote Launch — 2026-06-09 20:30:57 MDT / 2026-06-10T02:30:57Z

- User clarified the prior watch was idle because they had forgotten to click launch, then clicked from the remote/home computer.
- Observed successful attempt `5991cc2d105b63c7e0e5dcfef933d4ef`.
- Timeline from `.pyrus-runtime/flight-recorder/ibkr-connection-2026-06-10.jsonl` and `/api/ibkr/connection-audit`:
  - `2026-06-10T02:28:19.510Z` `queued_on_pyrus`
  - `2026-06-10T02:28:19.532Z` `helper_launch_requested`
  - `2026-06-10T02:28:19.543Z` helper `desktop_claim`
  - `2026-06-10T02:28:23.949Z` browser `login_key_wait_started`
  - `2026-06-10T02:28:28.062Z` `credential_key_published`
  - `2026-06-10T02:28:28.305Z` `credential_key_read`
  - `2026-06-10T02:28:28.796Z` browser `login_key_ready`
  - `2026-06-10T02:28:28.900Z` browser `encrypting_credentials`
  - `2026-06-10T02:28:29.314Z` `credentials_received`
  - `2026-06-10T02:28:29.748Z` browser `credentials_sent_to_pyrus`
  - `2026-06-10T02:28:47Z` diagnostics reached `waiting_2fa`
  - `2026-06-10T02:28:57Z` diagnostics moved into bridge bundle download, indicating 2FA was accepted
  - `2026-06-10T02:29:31.502Z` `bridge_attached`, status `connected`
- `/api/ibkr/connection-audit` reported:
  - `outcome: connected`
  - `durationMs: 71992`
  - `liveState.connected: true`
  - `liveState.streamState: live`
  - `helperVersion: 2026-06-09.ib-async-sidecar-v20-direct-gateway-typing`
- Credential path is now live-validated: from queue to `credentials_received` was about `9.804s`; from `credential_key_published` to `credentials_received` was about `1.252s`; `loginEnvelopeSubmitAttemptCount` reached `1`.
- Remaining concern is unrelated API pressure: final broad `/api/session` and activation-diagnostics probes timed out at 8s after connection while `/api/ibkr/connection-audit` remained available. API pressure continued to report slow non-IBKR routes such as `GET /signal-monitor/events` and `GET /accounts/shadow/positions`.

## Prior Handoffs

- `SESSION_HANDOFF_2026-06-09_019eae66-0e88-7431-82ce-e7909cea1b55.md`
- `SESSION_HANDOFF_2026-06-09_019eae19-7225-7e60-8c45-e32bd10b2c21.md`
- `SESSION_HANDOFF_2026-06-09_019eae05-eacb-7d50-a8dd-8323ada25d22.md`
- `SESSION_HANDOFF_2026-06-09_019eae02-420b-7fa1-953a-b1abcc2622bd.md`
- `SESSION_HANDOFF_2026-06-09_019eadfc-2cd0-78f2-b041-bbb600dbade3.md`
- `SESSION_HANDOFF_2026-06-09_019eade0-4046-70c3-975d-0cc3b0aee56a.md`
- `SESSION_HANDOFF_2026-06-09_019eade0-0422-7320-bbc6-22643066d321.md`
- `SESSION_HANDOFF_2026-06-09_019eadd8-e8e2-70c2-a7ff-fb5eefa135a4.md`
- `SESSION_HANDOFF_2026-06-09_019eadd4-25b3-7b52-949e-eda0aa2eafa7.md`
- `SESSION_HANDOFF_2026-06-09_019eadc4-e336-7472-87f1-7f6600f9b4b7.md`
- `SESSION_HANDOFF_2026-06-09_019ead78-0a4d-79c0-8333-f9e67135e8ca.md`
- `SESSION_HANDOFF_2026-06-09_019ead4a-2fc8-7b61-a989-2a78762f17c2.md`
- `SESSION_HANDOFF_2026-06-09_019ead39-ed30-7151-916c-188f0a0c305d.md`
- `SESSION_HANDOFF_2026-06-09_019eac9c-ec03-7de1-98f0-6421d5d8312a.md`
- `SESSION_HANDOFF_2026-06-08_019eaac8-99ba-7072-9412-bf2eb1070bed.md`
- `SESSION_HANDOFF_2026-06-08_019eaab5-1b86-7c60-875f-67b54a909239.md`
- `SESSION_HANDOFF_2026-06-08_019eaa48-a445-7482-8aa5-21d669524581.md`
- `SESSION_HANDOFF_2026-06-08_019eaa48-3cb6-7290-a56f-99c4a4af2d32.md`
- `SESSION_HANDOFF_2026-06-08_019ea975-0cde-7cd2-a5bc-4892aee272c4.md`
- `SESSION_HANDOFF_2026-06-08_019ea847-b017-7b53-a789-ccec852acccc.md`
- `SESSION_HANDOFF_2026-06-08_019ea81a-ebe7-7642-a873-09562ba0de35.md`
- `SESSION_HANDOFF_2026-06-08_019ea81a-819e-7841-9d0f-1e9a601a4691.md`
- `SESSION_HANDOFF_2026-06-08_019ea814-21e3-7672-9b64-7eeae3ff07d2.md`
- `SESSION_HANDOFF_2026-06-08_019ea813-0e32-7543-ab00-303e24d7008a.md`
- `SESSION_HANDOFF_2026-06-08_019ea812-8281-75d2-b082-8e5b5be596db.md`
- `SESSION_HANDOFF_2026-06-08_019ea765-6876-7d92-80df-62338c1ffa87.md`
- `SESSION_HANDOFF_2026-06-08_019ea72c-b88f-7f52-9b85-87faa59c57e5.md`
- `SESSION_HANDOFF_2026-06-08_019ea4a9-b0c1-70e0-aa79-7f3fc45be403.md`
- `SESSION_HANDOFF_2026-06-07_019ea43b-d49a-7f52-b5c9-d587e6c6040c.md`
- `SESSION_HANDOFF_2026-06-07_019ea437-deef-7981-9fe7-82c12513ffde.md`
- `SESSION_HANDOFF_2026-06-06_019e9de4-91e7-72b0-8853-3f70fd908c3e.md`
- `SESSION_HANDOFF_2026-06-06_019e9ddc-1936-7d52-a57b-de5e92b1a11e.md`
- `SESSION_HANDOFF_2026-06-06_019e9d7d-0f96-7750-9f11-dd41d293e473.md`
- `SESSION_HANDOFF_2026-06-06_019e9d7b-30c5-7502-b87c-0ac35e2d4f6f.md`
- `SESSION_HANDOFF_2026-06-05_signal-bubble-pending-hydration.md`
- `SESSION_HANDOFF_2026-06-05_semantic-tone-rollout.md`
- `SESSION_HANDOFF_2026-06-05_019e9a07-2756-7dc0-87c1-f22ac5fc79db.md`
- `SESSION_HANDOFF_2026-06-05_019e9a00-0ec7-7531-ba91-041f6bd63385.md`
- `SESSION_HANDOFF_2026-06-05_019e99c5-dd2d-7000-a813-5d649c3f3428.md`
- `SESSION_HANDOFF_2026-06-05_019e9923-d8b9-7fc1-91d6-02a81091fe1e.md`
- `SESSION_HANDOFF_2026-06-05_019e9923-c551-74c0-8f7a-4f4419b923ee.md`
- `SESSION_HANDOFF_2026-06-05_019e9923-1b8d-7cb0-9f8e-8cd49d80292a.md`
- `SESSION_HANDOFF_2026-06-04_019e953f-041b-71c3-a43e-542a8ef6e00d.md`
- `SESSION_HANDOFF_2026-06-04_019e9539-fcdb-7352-ba37-146876d76a81.md`
- `SESSION_HANDOFF_2026-06-04_019e9539-e3ff-7141-9ec2-b2bdd077e69e.md`
- `SESSION_HANDOFF_2026-06-04_019e9538-ef1f-70c0-9659-e0ad9176a023.md`
- `SESSION_HANDOFF_2026-06-04_019e94a9-bc59-7e40-93d2-8f113348cca2.md`
- `SESSION_HANDOFF_2026-06-04_019e940a-cceb-7790-889f-d5534cc0814c.md`
- `SESSION_HANDOFF_2026-06-04_019e934b-5d2a-7ab2-8676-71145b8a4c03.md`
- `SESSION_HANDOFF_2026-06-04_019e92c2-ff99-78e0-a36f-3ddb9c03a700.md`
- `SESSION_HANDOFF_2026-06-04_019e92c1-77d0-7fd0-b7e3-01bb797e2227.md`
- `SESSION_HANDOFF_2026-06-03_mtf-entry-sweep-ui.md`
- `SESSION_HANDOFF_2026-06-03_019e909f-4ab7-7f32-9321-237e31de2032.md`
- `SESSION_HANDOFF_2026-06-03_019e9091-8f8f-75c0-be2c-f9ccbaa788b4.md`
- `SESSION_HANDOFF_2026-06-03_019e9071-13a9-7603-a5fd-ed951f5273d5.md`
- `SESSION_HANDOFF_2026-06-03_019e906b-b44d-76d2-a8d5-020be84bba6e.md`
- `SESSION_HANDOFF_2026-06-03_019e9066-b78f-7160-b516-c85c2e7fe345.md`
- `SESSION_HANDOFF_2026-06-03_019e8ed9-7dcd-7812-982f-a2d96ed0676f.md`
- `SESSION_HANDOFF_2026-06-03_019e8ed7-2665-7a70-8107-953700380a4b.md`
- `SESSION_HANDOFF_2026-06-03_019e8e1a-67c0-7de1-a96e-f28098f0d355.md`
- `SESSION_HANDOFF_2026-06-03_019e8e19-f0f6-7a02-b8da-97fb302cf399.md`
- `SESSION_HANDOFF_2026-06-02_signals-timeframe-hydration.md`
- `SESSION_HANDOFF_2026-06-02_signal-bubbles-matrix-diagnosis.md`
- `SESSION_HANDOFF_2026-06-02_019e8afa-5620-70f1-a4b6-bf40e41e7aa5.md`
- `SESSION_HANDOFF_2026-06-02_019e8afa-4637-70b2-971a-b6a37b9539b7.md`
- `SESSION_HANDOFF_2026-06-02_019e8afa-10bc-76e0-96b3-1facd819d790.md`
- `SESSION_HANDOFF_2026-06-02_019e8ac2-edd3-7d53-b81e-2ee862972acc.md`
- `SESSION_HANDOFF_2026-06-02_019e8ac1-f364-7743-bee6-66c240b2b44d.md`
- `SESSION_HANDOFF_2026-06-02_019e8aaa-6793-77b1-90fc-1e053f373563.md`
- `SESSION_HANDOFF_2026-06-02_019e89ba-27c7-7560-804d-9a02b2a94b74.md`
- `SESSION_HANDOFF_2026-06-02_019e89b9-c29e-7541-baf7-7d9d4d5803fd.md`
- `SESSION_HANDOFF_2026-06-02_019e89a7-e15d-77f1-9820-862e90a38123.md`
- `SESSION_HANDOFF_2026-06-02_019e898a-b316-7df3-8842-2f179ad5d122.md`
- `SESSION_HANDOFF_2026-06-02_019e8972-55bb-7641-ab8b-02a041961ad6.md`
- `SESSION_HANDOFF_2026-06-02_019e8971-d31f-7720-9983-d413f637e126.md`
- `SESSION_HANDOFF_2026-06-02_019e8971-1dc4-75b2-9c36-4d78d5f75203.md`
- `SESSION_HANDOFF_2026-06-02_019e889a-133d-75f3-922f-fc54c144ea94.md`
- `SESSION_HANDOFF_2026-06-02_019e8897-3487-71b3-b357-5dcbc6b7ac6d.md`
- `SESSION_HANDOFF_2026-06-02_019e8870-4fd3-7130-aa12-b6324b163918.md`
- `SESSION_HANDOFF_2026-06-02_019e886f-b02b-70e1-8c40-018f3b7100e3.md`
- `SESSION_HANDOFF_2026-06-01_75218067-d9b9-4264-8b7a-3243c1a06ca1.md`
- `SESSION_HANDOFF_2026-06-01_019e862d-a38a-7a50-ab58-9801840e30fc.md`
- `SESSION_HANDOFF_2026-06-01_019e862c-7a64-7982-b62e-6ed0423a8457.md`
- `SESSION_HANDOFF_2026-06-01_019e8620-30a2-7792-8500-16c95843972c.md`
- `SESSION_HANDOFF_2026-06-01_019e8583-e862-7bb1-8560-5db3658c7345.md`
- `SESSION_HANDOFF_2026-06-01_019e856f-e49f-7fb0-941e-fd5c610c8e35.md`
- `SESSION_HANDOFF_2026-06-01_019e856e-bffa-7833-b2b7-da4c35f1f4ed.md`
- `SESSION_HANDOFF_2026-06-01_019e856e-09fe-7de1-b9bc-28878b14c985.md`
- `SESSION_HANDOFF_2026-06-01_019e856c-a253-71f2-9ad3-d53939c3f375.md`
- `SESSION_HANDOFF_2026-06-01_019e84ed-e068-7de2-ad5e-d900df7d26c1.md`
- `SESSION_HANDOFF_2026-06-01_019e84aa-d2bd-7103-91a9-a73c9fcfb9c1.md`
- `SESSION_HANDOFF_2026-06-01_019e84aa-c1d5-79e1-adba-5a743d03c8cc.md`
- `SESSION_HANDOFF_2026-06-01_019e84aa-83ed-7462-8cd5-1c29cc47fbd7.md`
- `SESSION_HANDOFF_2026-06-01_019e84aa-1f90-7b41-b68e-5b0b7120b56c.md`
- `SESSION_HANDOFF_2026-06-01_019e8411-18fc-7911-9c4d-4aeecba402ac.md`
- `SESSION_HANDOFF_2026-06-01_019e83a8-59ca-7843-b17d-1eb1b26d5363.md`
- `SESSION_HANDOFF_2026-06-01_019e838b-6af5-7b72-b4aa-ee78a7bd3449.md`
- `SESSION_HANDOFF_2026-06-01_019e8368-7762-7122-81b8-8a37bfbb0e60.md`
- `SESSION_HANDOFF_2026-06-01_019e8366-b25f-7921-bbd5-2bfc17403296.md`
- `SESSION_HANDOFF_2026-06-01_019e8361-9248-72a3-9743-ffd530b4d55e.md`
- `SESSION_HANDOFF_2026-05-31_019e80a2-9969-70a2-a92d-39cf6a379925.md`
- `SESSION_HANDOFF_2026-05-31_019e8076-ad60-7ee3-9c89-87f101b7545a.md`
- `SESSION_HANDOFF_2026-05-31_019e802e-8fc0-77a0-8857-7f3208f84734.md`
- `SESSION_HANDOFF_2026-05-31_019e802d-7aa8-7832-9d3b-d9a1f55357d2.md`
- `SESSION_HANDOFF_2026-05-31_019e802d-21e9-7bf1-961a-4c205f226e9e.md`
- `SESSION_HANDOFF_2026-05-31_019e7ff7-d9da-7333-9c5f-43f9156a8d45.md`
- `SESSION_HANDOFF_2026-05-31_019e7fc7-29fb-7991-9d61-98d6224fb6da.md`
- `SESSION_HANDOFF_2026-05-31_019e7fa4-ed2e-70e1-ac7f-a54fee386518.md`
- `SESSION_HANDOFF_2026-05-31_019e7fa0-bbf9-7033-ad99-00fd18019559.md`
- `SESSION_HANDOFF_2026-05-31_019e7f62-78ff-7773-a075-7f29d6a5269f.md`
- `SESSION_HANDOFF_2026-05-31_019e7f59-b4e2-7303-9a13-63ee370879ca.md`
- `SESSION_HANDOFF_2026-05-31_019e7f57-871a-71d2-8eb5-2662044d89b6.md`
- `SESSION_HANDOFF_2026-05-31_019e7f57-3814-7572-a4ab-f649059f9b14.md`
- `SESSION_HANDOFF_2026-05-31_019e7e9b-e240-7c30-98d2-a1ad94723f11.md`
- `SESSION_HANDOFF_2026-05-30_019e7acd-c715-7200-b4a6-1bb0adf72b13.md`
- `SESSION_HANDOFF_2026-05-30_019e7acd-1f10-7e00-9474-efbb5051b670.md`
- `SESSION_HANDOFF_2026-05-30_019e7a9a-5ec9-7eb3-95f1-d0c5503ed8a0.md`
- `SESSION_HANDOFF_2026-05-30_019e7a20-0e2f-73f1-ae20-ddf1fb495be5.md`
- `SESSION_HANDOFF_2026-05-30_019e7995-e4a1-7bf2-b6a0-339a98d29317.md`
- `SESSION_HANDOFF_2026-05-30_019e7994-2d67-7883-840f-7d3c3d92d721.md`
- `SESSION_HANDOFF_2026-05-29_019e752f-259e-7553-9866-4b0c4544dd05.md`
- `SESSION_HANDOFF_2026-05-29_019e752d-9895-7653-936f-31f010b764d5.md`
- `SESSION_HANDOFF_2026-05-29_019e752a-b590-79a3-a82b-ee464537fd82.md`
- `SESSION_HANDOFF_2026-05-29_019e7529-c353-7b83-a39a-5f8a0fe69745.md`
- `SESSION_HANDOFF_2026-05-29_019e7499-013e-7c80-ad40-9c917f319149.md`
- `SESSION_HANDOFF_2026-05-29_019e7442-882b-7a13-b625-d886421780aa.md`
- `SESSION_HANDOFF_2026-05-29_019e742a-a3f1-71b3-8374-b51029016cbf.md`
- `SESSION_HANDOFF_2026-05-29_019e7426-9371-7430-9a71-6686f1347001.md`
- `SESSION_HANDOFF_2026-05-29_019e7421-ba22-78a1-a721-7446ea362dd7.md`
- `SESSION_HANDOFF_2026-05-28_019e6f40-5f2f-78f1-afca-4032e91e55db.md`
- `SESSION_HANDOFF_2026-05-28_019e6f32-5565-76d0-8ae0-06b4e2e30a0e.md`
- `SESSION_HANDOFF_2026-05-28_019e6ea4-f32b-7261-8ca3-9d57cc9d40b5.md`
- `SESSION_HANDOFF_2026-05-27_019e6bbb-f865-7563-96f6-ede09cfc4167.md`
- `SESSION_HANDOFF_2026-05-26_019e654e-1409-7621-bde7-f8c231fda8d0.md`
- `SESSION_HANDOFF_2026-05-26_019e6477-7493-7191-acfb-8aa632788e6c.md`
- `SESSION_HANDOFF_2026-05-25_019e6049-463f-7ab0-a520-95e909a2eff6.md`
- `SESSION_HANDOFF_2026-05-22_019e509e-5038-7b20-a757-cf053441bc8d.md`
- `SESSION_HANDOFF_2026-05-22_019e5096-b2ce-7881-83b4-84fd5ae9aea9.md`
- `SESSION_HANDOFF_2026-05-22_019e4fde-9151-7940-a16a-b90a6bf12517.md`
- `SESSION_HANDOFF_2026-05-22_019e4fdd-cf2f-77a2-84e7-35d48584074b.md`
- `SESSION_HANDOFF_2026-05-22_019e4fd1-20ef-7931-9b08-e4cc646ccb00.md`
- `SESSION_HANDOFF_2026-05-21_019e4e27-3e58-7c51-a2ee-431ce0637c44.md`
- `SESSION_HANDOFF_2026-05-21_019e4d5e-ddaa-7d22-90ff-4b3b56c16ab1.md`
- `SESSION_HANDOFF_2026-05-21_019e4d5d-d653-7702-86a8-c20a83ee23ff.md`
- `SESSION_HANDOFF_2026-05-21_019e4d5c-a277-71d0-afd5-4a740991a8c6.md`
- `SESSION_HANDOFF_2026-05-21_019e4c7a-19cf-7740-84f6-5eb3a1f36fae.md`
- `SESSION_HANDOFF_2026-05-21_019e4c26-0d56-7120-b85e-bf5e18f14721.md`
- `SESSION_HANDOFF_2026-05-21_019e4c16-3a66-7302-8ada-1206e23e11df.md`
- `SESSION_HANDOFF_2026-05-21_019e4c15-88e9-7a42-aad0-86eed917c98a.md`
- `SESSION_HANDOFF_2026-05-21_019e4c14-fe5e-7802-970c-bae01f8b7212.md`
- `SESSION_HANDOFF_2026-05-21_019e4acb-958e-76f2-89fc-f534179f2902.md`
- `SESSION_HANDOFF_2026-05-20_019e46ed-0bc3-78f3-bad7-f7ca24065531.md`
- `SESSION_HANDOFF_2026-05-20_019e45cf-44f8-7fe2-87f5-7d055c00513f.md`
- `SESSION_HANDOFF_2026-05-20_019e45ab-830c-76d1-8f63-448f25c8f681.md`
- `SESSION_HANDOFF_2026-05-20_019e45a3-68ab-7160-ab80-038d09482d6a.md`
- `SESSION_HANDOFF_2026-05-19_019e4057-cc09-7610-9cd5-2b159d78b023.md`
- `SESSION_HANDOFF_2026-05-14_019e26f3-cc37-7351-94a3-c52aae3be0c7.md`
- `SESSION_HANDOFF_2026-05-13_019e21ab-042e-7d62-82c5-621bb214aaf4.md`
- `SESSION_HANDOFF_2026-05-13_019e219a-97c1-7c81-a23d-86233b1a8ccc.md`
- `SESSION_HANDOFF_2026-05-13_019e2194-a0c5-7fd1-8c6e-f3fd3869af34.md`
- `SESSION_HANDOFF_2026-05-13_019e2191-5255-7b50-9d9d-d66432f7cc23.md`
- `SESSION_HANDOFF_2026-05-13_019e2168-cce7-7f22-8a53-a394d6279949.md`
- `SESSION_HANDOFF_2026-05-11_019e1777-ea5d-7a03-aa38-a7da139985d7.md`
- `SESSION_HANDOFF_2026-05-08_019e0920-564f-78d0-8463-410e50e52b5d.md`
- `SESSION_HANDOFF_2026-05-08_019e0826-0850-7bf2-8100-0b3eada42e32.md`
- `SESSION_HANDOFF_2026-05-06_019dff8b-c488-7ec1-bab2-7eeca931697f.md`
- `SESSION_HANDOFF_2026-05-06_019dff88-574a-74f3-8ead-27ea141dfd2f.md`
- `SESSION_HANDOFF_2026-05-06_019dff6f-d657-70a2-bed9-7c3a2469bed7.md`
- `SESSION_HANDOFF_2026-05-06_019dff68-fd69-7fd1-84aa-f97b89d2efe8.md`
- `SESSION_HANDOFF_2026-05-06_019dff67-f5a1-7332-8624-585ac4cd1435.md`
- `SESSION_HANDOFF_2026-05-06_019dff66-df3f-7bc1-abe4-39b68ed2dcff.md`
- `SESSION_HANDOFF_2026-05-06_019dfe4d-4d96-7552-80ac-346c0646adb1.md`
- `SESSION_HANDOFF_2026-05-06_019dfe49-d18c-7bd1-97d1-7e004ff154f0.md`
- `SESSION_HANDOFF_2026-05-06_019dfe45-759c-77c0-b66f-9cc21addb43b.md`
- `SESSION_HANDOFF_2026-05-06_019dfe1c-e228-72b2-932c-6d9faa06df81.md`

## Recent User Messages

- `2026-06-09T23:31:36.875Z` testing again, please watch.
- `2026-06-09T23:32:24.295Z` hung/waiting here too long: helper_launched: Windows bridge helper launched.
Desktop agent registered for remote IBKR launches.
checking_gateway_socket: Checking IB Gateway live API socket on 127.0.0.1:4001.
autologin_preflight: Preparing one-time IB Gateway auto-login handoff.
waiting_secure_credentials: Waiting for encrypted IBKR credentials from Pyrus.
- `2026-06-09T23:32:58.049Z` can you make the same fixes you made that allowed it to get up in about 10 seconds? and im also not seeing a cancel button during launch, only clear
- `2026-06-09T23:37:54.921Z` yo have my creds in the UI, please take over until this if functioning propely
- `2026-06-09T23:39:13.637Z` no. you take control please.
- `2026-06-09T23:43:52.991Z` pyrus still not sending credentials timely
- `2026-06-09T23:55:56.483Z` im going to type my credentials into the ui and let you run it from there
- `2026-06-09T23:57:00.614Z` i typed it into the replit preview, which you need to contorl
- `2026-06-09T23:57:40.531Z` dude. you can fucking do this. you did it last session. stop playing retard
- `2026-06-09T23:58:38.553Z` 60+ seconds for ui to talk to powershell. unacceptablke./ fuck you
- `2026-06-09T23:59:06.203Z` why the fuck wont you just restore the WORK YOU ALREADY DID YOU FUCKING LOSER WHAT IS WRONG WITH YOU
- `2026-06-10T00:27:07.204Z` ive restarted. please check your work to ensure its complete and we have optimzied our ib gateway launch sequence

## Session Activity Summary

- `2026-06-09T23:09:41.777Z` User: pick up the work on the ibkr connection. we solved this already
- `2026-06-09T23:09:56.196Z` Agent: I’ll restore the prior session context first, then verify the IBKR work from repo evidence before touching code. I’m using the `session-handoff` skill because this is a resume req…
- `2026-06-09T23:09:56.197Z` Tool: exec_command sed -n '1,240p' /home/runner/.codex/skills/.system/../.system/session-handoff/SKILL.md
- `2026-06-09T23:09:56.207Z` Tool: exec_command pwd && rg --files -g 'SESSION_HANDOFF*' -g 'AGENTS.md' -g 'package.json'
- `2026-06-09T23:10:08.064Z` Agent: The handoff list shows several IBKR-related live handoffs, including today’s connection audit. I hit a path typo reading the skill file, so I’m correcting that and then I’ll read…
- `2026-06-09T23:10:08.072Z` Tool: exec_command sed -n '1,260p' /home/runner/workspace/.agents/skills/session-handoff/SKILL.md
- … 649 lower-signal transcript events omitted …
- `2026-06-10T00:31:07.856Z` Agent: `pwsh` is not installed in this Linux workspace, so I can’t run a local PowerShell parser. The helper/runtimes still need a cleaner version-lock check because my first regex was s…
- `2026-06-10T00:31:07.875Z` Tool: exec_command node <<'NODE' const fs=require('fs'); const helper=fs.readFileSync('scripts/windows/pyrus-ibkr-helper.ps1','utf8'); const runtime=fs.readFileSync('artifacts/api-server/src/service…
- `2026-06-10T00:31:07.906Z` Tool: exec_command rg -n "Set-Clipboard|Clipboard|Invoke-SendKeysTextEntry|function Invoke-IBGatewayCredentialTyping|Submitting IBKR credentials|Entering IBKR" scripts/windows/pyrus-ibkr-helper.ps1
- `2026-06-10T00:31:07.961Z` Tool: exec_command sed -n '2330,2495p' scripts/windows/pyrus-ibkr-helper.ps1
- `2026-06-10T00:31:22.845Z` Agent: Version lock is correct: API expects v20 and the helper declares the same v20. The credential-typing function itself no longer uses clipboard; it uses direct SendKeys text entry f…
- `2026-06-10T00:31:22.853Z` Tool: exec_command pnpm --filter @workspace/ibkr-bridge run typecheck
- `2026-06-10T00:31:22.872Z` Tool: exec_command git diff --stat -- artifacts/pyrus/src/features/platform/HeaderStatusCluster.jsx artifacts/pyrus/src/features/platform/ibkrConnectionCredentialActionModel.js artifacts/pyrus/src/f…
- `2026-06-10T00:31:22.899Z` Tool: exec_command curl -fsS http://127.0.0.1:18747/api/ibkr/activation/diagnostics | jq '{activeCount, phase: .insight.currentPhase, detail: .insight.detail}'
- `2026-06-10T00:31:32.973Z` Agent: The bridge package typecheck also passes, and activation is still idle after the browser/UI smoke. I’m refreshing the durable handoff with these validation results.
- `2026-06-10T00:31:34.467Z` Tool: exec_command node .agents/skills/session-handoff/scripts/write-session-handoff.mjs --session 019eaea5-da22-7eb0-b361-dd2339bb136a

## High-Signal Changed Files

- `SESSION_HANDOFF_CURRENT.md`
- `SESSION_HANDOFF_MASTER.md`
- `artifacts/api-server/src/index.ts`
- `artifacts/api-server/src/providers/ibkr/client.ts`
- `artifacts/api-server/src/providers/massive/market-data.ts`
- `artifacts/api-server/src/routes/platform.ts`
- `artifacts/api-server/src/services/account-page-streams.ts`
- `artifacts/api-server/src/services/backend-settings.ts`
- `artifacts/api-server/src/services/ibkr-bridge-runtime.ts`
- `artifacts/api-server/src/services/overnight-spot-worker.ts`
- `artifacts/api-server/src/services/platform.ts`
- `artifacts/api-server/src/services/resource-pressure.test.ts`
- `artifacts/api-server/src/services/resource-pressure.ts`
- `artifacts/api-server/src/services/signal-monitor-stream.test.ts`
- `artifacts/api-server/src/services/signal-monitor.ts`
- `artifacts/api-server/src/services/signal-options-automation.test.ts`
- `artifacts/api-server/src/services/signal-options-automation.ts`
- `artifacts/api-server/src/services/signal-options-worker-state.ts`
- `artifacts/api-server/src/services/signal-options-worker.ts`
- `artifacts/api-server/src/services/sse-stream-diagnostics.ts`
- `artifacts/api-server/src/services/stock-quote-day-change-context.ts`
- `artifacts/api-server/src/services/trade-monitor-worker.ts`
- `artifacts/ibkr-bridge/src/tws-provider.ts`
- `artifacts/pyrus/src/components/platform/signal-language/SignalDots.jsx`
- `artifacts/pyrus/src/features/charting/ResearchChartFrame.tsx`
- `artifacts/pyrus/src/features/charting/ResearchChartSurface.tsx`
- `artifacts/pyrus/src/features/charting/chartPositionOverlays.ts`
- `artifacts/pyrus/src/features/flow/FlowScannerStatusPanel.jsx`
- `artifacts/pyrus/src/features/market/MultiChartGrid.jsx`
- `artifacts/pyrus/src/features/platform/AppHeader.jsx`

## Repo State Snapshot

```text
## main...origin/main
 M SESSION_HANDOFF_CURRENT.md
 M SESSION_HANDOFF_MASTER.md
 M artifacts/api-server/src/index.ts
 M artifacts/api-server/src/providers/ibkr/client.ts
 M artifacts/api-server/src/providers/massive/market-data.ts
 M artifacts/api-server/src/routes/platform.ts
 M artifacts/api-server/src/services/account-page-streams.ts
 M artifacts/api-server/src/services/backend-settings.ts
 M artifacts/api-server/src/services/ibkr-bridge-runtime.ts
 M artifacts/api-server/src/services/overnight-spot-worker.ts
 M artifacts/api-server/src/services/platform.ts
 M artifacts/api-server/src/services/resource-pressure.test.ts
 M artifacts/api-server/src/services/resource-pressure.ts
 M artifacts/api-server/src/services/signal-monitor-stream.test.ts
 M artifacts/api-server/src/services/signal-monitor.ts
 M artifacts/api-server/src/services/signal-options-automation.test.ts
 M artifacts/api-server/src/services/signal-options-automation.ts
 M artifacts/api-server/src/services/signal-options-worker-state.ts
 M artifacts/api-server/src/services/signal-options-worker.ts
 M artifacts/api-server/src/services/sse-stream-diagnostics.ts
 M artifacts/api-server/src/services/stock-quote-day-change-context.ts
 M artifacts/api-server/src/services/trade-monitor-worker.ts
 M artifacts/ibkr-bridge/src/tws-provider.ts
 M artifacts/pyrus/src/components/platform/signal-language/SignalDots.jsx
 M artifacts/pyrus/src/features/charting/ResearchChartFrame.tsx
 M artifacts/pyrus/src/features/charting/ResearchChartSurface.tsx
 M artifacts/pyrus/src/features/charting/chartPositionOverlays.ts
 M artifacts/pyrus/src/features/flow/FlowScannerStatusPanel.jsx
 M artifacts/pyrus/src/features/market/MultiChartGrid.jsx
 M artifacts/pyrus/src/features/platform/AppHeader.jsx
 M artifacts/pyrus/src/features/platform/HeaderBroadcastScrollerStack.jsx
 M artifacts/pyrus/src/features/platform/HeaderStatusCluster.jsx
 M artifacts/pyrus/src/features/platform/PlatformAlgoMonitorSidebar.jsx
 M artifacts/pyrus/src/features/platform/PlatformAlgoMonitorSidebar.test.mjs
 M artifacts/pyrus/src/features/platform/PlatformAppDiagnostics.test.mjs
 M artifacts/pyrus/src/features/platform/PlatformRuntimeLayer.jsx
 M artifacts/pyrus/src/features/platform/PlatformScreenRouter.jsx
 M artifacts/pyrus/src/features/platform/PlatformShell.jsx
 M artifacts/pyrus/src/features/platform/PlatformWatchlist.jsx
 M artifacts/pyrus/src/features/platform/appWorkScheduler.js
 M artifacts/pyrus/src/features/platform/appWorkScheduler.test.mjs
 M artifacts/pyrus/src/features/platform/ibkrConnectionCredentialActionModel.js
 M artifacts/pyrus/src/features/platform/ibkrConnectionCredentialActionModel.test.mjs
 M artifacts/pyrus/src/features/platform/live-streams.test.mjs
 M artifacts/pyrus/src/features/platform/live-streams.ts
 M artifacts/pyrus/src/features/platform/runtimeMarketDataModel.js
 M artifacts/pyrus/src/features/platform/runtimeMarketDataModel.test.mjs
 M artifacts/pyrus/src/features/platform/useIbkrLineUsageSnapshot.js
 M artifacts/pyrus/src/features/platform/useLiveMarketFlow.js
 M artifacts/pyrus/src/features/platform/useRuntimeControlSnapshot.js
 M artifacts/pyrus/src/features/preferences/userPreferenceModel.ts
 M artifacts/pyrus/src/features/trade/TradeEquityPanel.jsx
 M artifacts/pyrus/src/features/trade/TradeL2Panel.jsx
 M artifacts/pyrus/src/features/trade/TradeOrderTicket.jsx
 M artifacts/pyrus/src/index.css
 M artifacts/pyrus/src/lib/timeZone.ts
 M artifacts/pyrus/src/screens/AlgoScreen.jsx
 M artifacts/pyrus/src/screens/FlowScreen.jsx
 M artifacts/pyrus/src/screens/SettingsScreen.jsx
 M artifacts/pyrus/src/screens/account/PositionOptionQuoteStreams.jsx
 M artifacts/pyrus/src/screens/account/PositionOptionQuoteStreams.test.mjs
 M artifacts/pyrus/src/screens/algo/AlgoLivePage.jsx
 M artifacts/pyrus/src/screens/algo/AlgoLivePage.test.mjs
 M artifacts/pyrus/src/screens/algo/AlgoOperationsPrimitives.jsx
 M artifacts/pyrus/src/screens/algo/OperationsSignalRow.jsx
 M artifacts/pyrus/src/screens/algo/OperationsSignalRow.test.mjs
 M artifacts/pyrus/src/screens/algo/OperationsSignalTable.jsx
 M artifacts/pyrus/src/screens/algo/OperationsSignalTable.test.mjs
 M artifacts/pyrus/src/screens/algo/algoHelpers.js
 M artifacts/pyrus/src/screens/algo/algoHelpers.test.mjs
 M crates/market-data-worker/src/ingest.rs
 M docs/backend-data-map.md
 M docs/plans/signal-bubbles-sse-push-hydration-plan.md
 M docs/platform-freshness-inventory.md
 M scripts/package.json
 M scripts/windows/pyrus-ibkr-helper.ps1
?? SESSION_HANDOFF_2026-06-09_019ead39-ed30-7151-916c-188f0a0c305d.md
?? SESSION_HANDOFF_2026-06-09_019ead4a-2fc8-7b61-a989-2a78762f17c2.md
?? SESSION_HANDOFF_2026-06-09_019ead78-0a4d-79c0-8333-f9e67135e8ca.md
?? SESSION_HANDOFF_2026-06-09_019eadc4-e336-7472-87f1-7f6600f9b4b7.md
?? SESSION_HANDOFF_2026-06-09_019eadd4-25b3-7b52-949e-eda0aa2eafa7.md
?? SESSION_HANDOFF_2026-06-09_019eadd8-e8e2-70c2-a7ff-fb5eefa135a4.md
?? SESSION_HANDOFF_2026-06-09_019eade0-0422-7320-bbc6-22643066d321.md
?? SESSION_HANDOFF_2026-06-09_019eade0-4046-70c3-975d-0cc3b0aee56a.md
?? SESSION_HANDOFF_2026-06-09_019eadfc-2cd0-78f2-b041-bbb600dbade3.md
?? SESSION_HANDOFF_2026-06-09_019eae02-420b-7fa1-953a-b1abcc2622bd.md
?? SESSION_HANDOFF_2026-06-09_019eae05-eacb-7d50-a8dd-8323ada25d22.md
?? SESSION_HANDOFF_2026-06-09_019eae19-7225-7e60-8c45-e32bd10b2c21.md
?? SESSION_HANDOFF_2026-06-09_019eae66-0e88-7431-82ce-e7909cea1b55.md
?? SESSION_HANDOFF_2026-06-09_019eaea5-da22-7eb0-b361-dd2339bb136a.md
?? SESSION_HANDOFF_LIVE_2026-06-09_broker-connection-launch-diagnosis.md
?? SESSION_HANDOFF_LIVE_2026-06-09_ibkr-connection-audit-perf-and-gateway-window.md
?? SIGNAL_MATRIX_LIVE_SSE_FINDINGS.md
?? artifacts/api-server/src/services/account-route-admission.test.ts
?? artifacts/api-server/src/services/account-route-admission.ts
?? artifacts/api-server/src/services/background-worker-pressure.test.ts
?? artifacts/api-server/src/services/stock-quote-day-change-context.test.ts
?? artifacts/pyrus/src/components/platform/signal-language/SignalDots.test.mjs
?? artifacts/pyrus/src/features/platform/extendedHoursQuote.test.mjs
?? artifacts/pyrus/src/features/platform/extendedHoursQuote.ts
?? artifacts/pyrus/src/features/platform/ibkrLoginHandoffErrorModel.js
?? artifacts/pyrus/src/features/platform/ibkrLoginHandoffErrorModel.test.mjs
?? artifacts/pyrus/src/features/preferences/userPreferenceModel.test.mjs
?? artifacts/pyrus/src/features/trade/TradeL2PanelDiagnostics.test.mjs
?? artifacts/pyrus/src/screens/algo/AlgoOperationsPrimitives.test.mjs
?? scripts/src/backfill-signal-monitor-events.ts
```

## Diff Summary

```text
 SESSION_HANDOFF_CURRENT.md                         |  45 +-
 SESSION_HANDOFF_MASTER.md                          |  14 +
 artifacts/api-server/src/index.ts                  |   6 +-
 artifacts/api-server/src/providers/ibkr/client.ts  |   4 +-
 .../src/providers/massive/market-data.ts           |  32 +
 artifacts/api-server/src/routes/platform.ts        |  94 ++-
 .../src/services/account-page-streams.ts           |  13 +-
 .../api-server/src/services/backend-settings.ts    |  10 +
 .../api-server/src/services/ibkr-bridge-runtime.ts |   2 +-
 .../src/services/overnight-spot-worker.ts          |  28 +-
 artifacts/api-server/src/services/platform.ts      |   6 +
 .../src/services/resource-pressure.test.ts         |  24 +
 .../api-server/src/services/resource-pressure.ts   |  24 +-
 .../src/services/signal-monitor-stream.test.ts     | 203 +++++--
 .../api-server/src/services/signal-monitor.ts      |  18 -
 .../src/services/signal-options-automation.test.ts | 151 ++++-
 .../src/services/signal-options-automation.ts      | 195 +++++-
 .../src/services/signal-options-worker-state.ts    |   1 +
 .../src/services/signal-options-worker.ts          |  73 ++-
 .../src/services/sse-stream-diagnostics.ts         |  34 ++
 .../src/services/stock-quote-day-change-context.ts |  54 ++
 .../src/services/trade-monitor-worker.ts           |  36 +-
 artifacts/ibkr-bridge/src/tws-provider.ts          |   6 +
 .../platform/signal-language/SignalDots.jsx        | 101 +++-
 .../src/features/charting/ResearchChartFrame.tsx   |   4 +
 .../src/features/charting/ResearchChartSurface.tsx |  68 +++
 .../src/features/charting/chartPositionOverlays.ts |   6 +-
 .../src/features/flow/FlowScannerStatusPanel.jsx   |   2 +-
 .../pyrus/src/features/market/MultiChartGrid.jsx   |   2 +-
 .../pyrus/src/features/platform/AppHeader.jsx      |   7 +-
 .../platform/HeaderBroadcastScrollerStack.jsx      |   2 +-
 .../src/features/platform/HeaderStatusCluster.jsx  | 503 ++++++++++++++--
 .../platform/PlatformAlgoMonitorSidebar.jsx        |  50 +-
 .../platform/PlatformAlgoMonitorSidebar.test.mjs   |  28 +
 .../platform/PlatformAppDiagnostics.test.mjs       |  54 ++
 .../src/features/platform/PlatformRuntimeLayer.jsx |   4 +
 .../src/features/platform/PlatformScreenRouter.jsx |   2 +
 .../pyrus/src/features/platform/PlatformShell.jsx  |  18 +-
 .../src/features/platform/PlatformWatchlist.jsx    |  53 ++
 .../src/features/platform/appWorkScheduler.js      |  19 +-
 .../features/platform/appWorkScheduler.test.mjs    |  19 +
 .../ibkrConnectionCredentialActionModel.js         |  40 +-
 .../ibkrConnectionCredentialActionModel.test.mjs   |  77 ++-
 .../src/features/platform/live-streams.test.mjs    |  26 +
 .../pyrus/src/features/platform/live-streams.ts    | 669 ++++++++++++++++++++-
 .../features/platform/runtimeMarketDataModel.js    |   6 +
 .../platform/runtimeMarketDataModel.test.mjs       |  32 +
 .../features/platform/useIbkrLineUsageSnapshot.js  |   4 +-
 .../src/features/platform/useLiveMarketFlow.js     |   5 +-
 .../features/platform/useRuntimeControlSnapshot.js |   7 +-
 .../features/preferences/userPreferenceModel.ts    |  71 ++-
 .../pyrus/src/features/trade/TradeEquityPanel.jsx  |   1 +
 .../pyrus/src/features/trade/TradeL2Panel.jsx      |   1 +
 .../pyrus/src/features/trade/TradeOrderTicket.jsx  |   4 +-
 artifacts/pyrus/src/index.css                      |  10 +-
 artifacts/pyrus/src/lib/timeZone.ts                |  10 +-
 artifacts/pyrus/src/screens/AlgoScreen.jsx         |   2 +
 artifacts/pyrus/src/screens/FlowScreen.jsx         | 116 +++-
 artifacts/pyrus/src/screens/SettingsScreen.jsx     |  15 +-
 .../screens/account/PositionOptionQuoteStreams.jsx |  80 ++-
 .../account/PositionOptionQuoteStreams.test.mjs    |  25 +
 artifacts/pyrus/src/screens/algo/AlgoLivePage.jsx  |  69 ++-
 .../pyrus/src/screens/algo/AlgoLivePage.test.mjs   |  28 +
 .../src/screens/algo/AlgoOperationsPrimitives.jsx  |   4 +-
 .../pyrus/src/screens/algo/OperationsSignalRow.jsx |  94 +--
 .../src/screens/algo/OperationsSignalRow.test.mjs  |  22 +-
 .../src/screens/algo/OperationsSignalTable.jsx     | 356 ++++++-----
 .../screens/algo/OperationsSignalTable.test.mjs    |  46 ++
 artifacts/pyrus/src/screens/algo/algoHelpers.js    |   8 +
 .../pyrus/src/screens/algo/algoHelpers.test.mjs    |  44 ++
 crates/market-data-worker/src/ingest.rs            |  89 ++-
 docs/backend-data-map.md                           |  30 +-
 .../signal-bubbles-sse-push-hydration-plan.md      |  11 +-
 docs/platform-freshness-inventory.md               |   7 +-
 scripts/package.json                               |   1 +
 scripts/windows/pyrus-ibkr-helper.ps1              |  52 +-
 76 files changed, 3448 insertions(+), 629 deletions(-)
```

## Validations Detected In Transcript

- `pnpm --filter @workspace/pyrus exec node --test src/features/platform/ibkrConnectionCredentialActionModel.test.mjs src/features/platform/ibkrLoginHandoffErrorModel.test.mjs` — 10/10 passing.
- `pnpm --filter @workspace/api-server exec tsx --test src/services/ibkr-bridge-runtime.test.ts src/services/ibkr-connection-audit.test.ts` — 14/14 passing.
- `pnpm --filter @workspace/pyrus run typecheck` — passing.
- `pnpm --filter @workspace/api-server run typecheck` — passing.
- `pnpm --filter @workspace/api-server run build` — passing, updates `dist/index.mjs`.
- `pnpm --filter @workspace/ibkr-bridge run typecheck` — passing.
- GStack browser smoke at `http://127.0.0.1:18747/?pyrusQa=safe`: shell mounted, IBKR credential form rendered, dummy credentials enabled `Reconnect on desktop`, dummy values cleared, fresh console had no JavaScript errors.

## What Changed This Session

- Restored the IBKR browser credential handoff path after observing live activations stuck at `loginHandoffReady=true`, `loginKeyReadCount>0`, and `loginEnvelopeSubmitAttemptCount=0`.
- `HeaderStatusCluster.jsx` now reads the login key without the browser abort timer (`timeoutMs: 0`) so a ready key is not lost to `AbortController` before encryption/envelope POST.
- Added an in-memory auto-resume path for active launches where the helper key was already read, no encrypted envelope reached Pyrus, and the username/password fields are still populated. Credentials are read from the DOM refs only and are not persisted.
- Exposed the password input ref to the header parent and kept the auto-resume one-shot per activation.
- Added `shouldAutoResumeIbkrCredentials()` and focused tests covering the stuck-key/no-envelope case, envelope-already-posted case, and one-shot guard.
- Prior session fixes still present in this worktree: v20 helper direct Gateway typing, browser abort classification, runtime-active cancel/resume state, and helper version lockstep with API expected version.
- Post-restart validation confirmed live runtime reports desktop agent online/registered, helper version `2026-06-09.ib-async-sidecar-v20-direct-gateway-typing`, expected helper version matches, upgrade not required, reconnect available, and activation idle.

## Current Status

- Observed current live activation stuck before this fix: key published/read, envelope submit count stayed `0`, then helper reported timeout.
- Observed targeted frontend/API tests, Pyrus/API/bridge typechecks, API build, and controlled safe-browser smoke pass after the user restart.
- Observed version lock is correct: API `BRIDGE_HELPER_VERSION` and PowerShell `$HelperVersion` both equal `2026-06-09.ib-async-sidecar-v20-direct-gateway-typing`.
- Observed `Invoke-IBGatewayCredentialTyping()` uses `Invoke-SendKeysTextEntry()` for username/password and does not use clipboard inside the credential-typing function.
- Observed many pre-existing unrelated dirty files remain in the worktree; they were not reverted.
- Unknown: full live Gateway connection still requires a real credential launch and 2FA approval; this pass did not click the launch button or submit dummy credentials.

## Next Recommended Steps

1. Retry the broker launch from the Replit preview after the browser bundle updates; expected evidence is `login_key_ready`, `encrypting_credentials`, and `credentials_sent_to_pyrus` in the connection audit within seconds of key publication.
2. If the active helper has already timed out, cancel/retry the launch rather than waiting on the stale activation.
3. If committing this slice, isolate the IBKR files from the broader dirty worktree first.

## Shadow Positions Pressure Fix — 2026-06-09 20:48:25 MDT / 2026-06-10T02:48:25Z

User asked to fix shadow positions pressure and assume the bug is on our side.

Observed:

- Current API runtime PID `101892` was using high CPU with ~`928MB` RSS shortly after restart.
- `GET /api/diagnostics/runtime` returned in `1.520890s`.
- `GET /api/accounts/shadow/positions?mode=paper&assetClass=option&liveQuotes=false` returned no bytes before a `15.002476s` curl timeout.
- Runtime diagnostics showed `shadowAccountReads.routes.positions` average `33359ms`, p95 `41672ms`, max `41672ms`.
- Runtime diagnostics showed `ledger-bundle` max `11118ms`, so the route was blocking first on broad ledger reads and then on synchronous position enrichment.

Root cause:

- `getShadowAccountPositions()` already used immediate stale cache when a usable cached positions response existed, but cold/no-cache pressure still entered the full positions builder.
- The full builder reads broad ledger state (`readShadowLedgerBundleForSource` uses all fills/orders/open positions for the default ledger) and then performs synchronous enrichment (`latestShadowAutomationManagementEvents`, day changes, peak marks, quote paths).
- Route admission keeps `/accounts/:id/positions` as `protected-position`, and shadow account admission always allows shadow routes, so the accepted route itself must remain bounded under pressure.

Fix:

- Updated `artifacts/api-server/src/services/shadow-account.ts`.
- Added a pressure fallback: when API pressure is `watch` or `high`, no reusable positions response exists, and a shadow positions request arrives, Pyrus now returns a degraded/stale snapshot built from persisted open shadow position rows plus account cash.
- The fallback keeps the response shape usable (`positions`, `totals`, weights, option payloads, `degraded: true`, `stale: true`, `reason: "shadow_positions_pressure_fallback"`).
- The full positions cache refresh is kicked in the background through the existing `withShadowReadCache()` path so the richer response can recover without making the UI wait.
- Added `positions-fast:*` short read cache so repeated pressure fallback requests do not repeatedly hit open positions.
- Exposed the pure fallback builder only through `__shadowWatchlistBacktestInternalsForTests`.

Validation:

- `pnpm --filter @workspace/api-server exec tsc --noEmit --pretty false` passed.
- `pnpm --filter @workspace/api-server exec tsx --test src/services/shadow-account-read-cache.test.ts` passed 5/5.
- `pnpm --filter @workspace/api-server exec tsx --test src/services/shadow-account-read-cache.test.ts src/services/account-route-admission.test.ts src/services/resource-pressure.test.ts src/services/background-worker-pressure.test.ts` passed 16/16.
- `git diff --check -- artifacts/api-server/src/services/shadow-account.ts artifacts/api-server/src/services/shadow-account-read-cache.test.ts` passed.
- `pnpm --filter @workspace/api-server run build` passed and rebuilt `dist/index.mjs`.

Runtime caveat:

- The live API process was launched from `dist/index.mjs` by the Replit-owned supervisor. Source edits and the rebuild will not affect that already-running process until the approved Replit Run App workflow restarts it.
- I did not kill/restart the Replit-owned API child from Codex because `artifacts/pyrus/scripts/runDevApp.mjs` explicitly refuses Codex-owned full-app starts and manages clean handoff through Replit workflow ownership.

Next:

1. Restart through the approved Replit Run App path to load rebuilt API dist.
2. Re-probe `GET /api/accounts/shadow/positions?mode=paper&assetClass=option&liveQuotes=false`; expected under pressure is a degraded/stale response in sub-second to low-single-digit seconds, not a 15s+ timeout.
3. Continue separately with `signal-monitor/events`, `flow/events/aggregate`, and `watchlists` if API pressure remains high after this route is bounded.

## Post-Restart Validation + Refinement — 2026-06-09 21:16:32 MDT / 2026-06-10T03:16:32Z

User restarted and asked to check the work.

Live validation after restart:

- Replit-owned API restarted as PID `116047` from `./dist/index.mjs`.
- `GET /api/healthz` returned `HTTP 200` in `0.074726s`.
- `GET /api/accounts/shadow/positions?mode=paper&assetClass=option&liveQuotes=false` direct API returned `HTTP 200` in `0.033603s`, with `degraded: true`, `stale: true`, `count: 9`.
- Repeated direct API probes:
  - `liveQuotes=false`: `HTTP 200` in `0.005230s`, `count: 9`.
  - `liveQuotes=true`: `HTTP 200` in `0.003868s`, `count: 9`.
- Web-proxy probe through `127.0.0.1:18747` returned `HTTP 200` in `0.002360s`, with `reason: "shadow_positions_pressure_fallback"`, `count: 9`.
- Runtime diagnostics showed the new `positions-fast` route active with p95 `10ms`, then `2ms`.

Residual issue found:

- The first fallback protected user-facing latency but still started the expensive full positions refresh in the background for each pressure request.
- Diagnostics after repeated probes showed:
  - `positions-fast` p95 `2ms`.
  - `positions` p95 still climbing to `20.473s`, max `25.349s`, from background full-refresh samples.
- This means the first patch improved UX but could still keep API pressure alive.

Refinement applied:

- In `artifacts/api-server/src/services/shadow-account.ts`, the pressure branch now returns `buildFastShadowPositionsResponse()` directly.
- It no longer calls `withShadowReadCache(cacheKey, readFullPositions, ...)` while pressure is `watch`/`high`.
- The full rich positions response resumes only when pressure returns to normal.
- Removed the background refresh warning path; `rg` confirms `"Background shadow positions refresh failed"` is absent from both source and `dist/index.mjs`.

Regression guard:

- Added `shadow account positions pressure path does not start a full refresh` in `artifacts/api-server/src/services/shadow-account-read-cache.test.ts`.
- The test slices the `getShadowAccountPositions()` pressure branch and asserts it returns `buildFastShadowPositionsResponse()` without `withShadowReadCache()` or `readFullPositions`.

Validation after refinement:

- `pnpm --filter @workspace/api-server exec tsx --test src/services/shadow-account-read-cache.test.ts` passed 6/6.
- `pnpm --filter @workspace/api-server exec tsc --noEmit --pretty false` passed.
- `git diff --check -- artifacts/api-server/src/services/shadow-account.ts artifacts/api-server/src/services/shadow-account-read-cache.test.ts` passed.
- `pnpm --filter @workspace/api-server run build` passed and rebuilt `dist/index.mjs`.

Runtime caveat:

- The current running API process has the first fallback loaded and is serving shadow positions quickly.
- It does not yet have the no-background-refresh refinement because API dev runs compiled `dist/index.mjs` and does not hot-reload source changes into the running process.
- One more normal Replit Run App restart is needed to load the refined dist.

Next:

1. Restart once more through approved Replit Run App.
2. Re-probe shadow diagnostics; expected result is `positions-fast` continues to serve pressure requests quickly, while new `positions` full-refresh samples stop growing under `watch`/`high` pressure.

## Second Restart Validation — 2026-06-09 21:28:30 MDT / 2026-06-10T03:28:30Z

User restarted again and asked to check.

Observed:

- Replit-owned API restarted as PID `121786`, running `node --enable-source-maps ./dist/index.mjs`.
- `GET /api/healthz` returned `HTTP 200` in `0.103334s`.
- Source and built dist both contain the refined pressure branch; the removed background-refresh warning string is absent from `dist/index.mjs`.
- Baseline `shadowAccountReads` diagnostics were empty after restart.

Shadow positions probes:

- Direct API clean-cache probe:
  - `GET /api/accounts/shadow/positions?mode=paper&assetClass=option&liveQuotes=false`
  - `HTTP 200` in `4.877496s`
  - `degraded: true`, `stale: true`, `reason: "shadow_positions_pressure_fallback"`, `count: 9`
- Direct API `liveQuotes=true` probe:
  - `HTTP 200` in `0.001199s`
  - same degraded fallback, `count: 9`
- Web-proxy probe through `127.0.0.1:18747`:
  - `HTTP 200` in `0.002451s`
  - same degraded fallback, `count: 9`
- Five repeated direct probes returned in `0.002297s`, `0.001183s`, `0.001422s`, `0.001282s`, and `0.001227s`.

Diagnostics after probes:

- `positions-fast` route exists and absorbed the requests.
- Old full `positions` route is absent from diagnostics after the probes.
- `open-positions` had only one cold miss, `724ms`.
- `ledger-bundle` had a prior cold sample from other startup work, but no full `positions` route growth from the pressure branch.
- `/api/session` through web proxy returned `HTTP 200` in `0.007868s`.

Conclusion:

- The no-background-refresh refinement is loaded and working.
- User-facing shadow positions no longer time out under pressure.
- The pressure branch no longer feeds the expensive full positions refresh path.
- Remaining note: the first clean-cache fallback can still take a few seconds while persisted open-position rows are read; subsequent requests are millisecond-scale via `positions-fast`.

Next:

1. Treat shadow positions pressure fix as live-validated.
2. If API pressure remains, investigate the other observed slow routes separately: `signal-monitor/events`, `flow/events/aggregate`, and `watchlists`.
