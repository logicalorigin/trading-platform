# Session Handoff: IBKR Broker Launch Direct Windows Protocol

- Last Updated (MT): `2026-06-22 16:20:26 MDT`
- Last Updated (UTC): `2026-06-22T22:20:26.749Z`
- Session ID: `019ef0ac-dd0c-7612-8e1d-ccd88c8e9637`
- Branch: `main`
- Summary: Broker launch now uses the direct `pyrus-ibkr://` path for Windows browser clicks even when a desktop helper heartbeat exists.

## Current Status

- Root cause found: `shouldUseRemoteIbkrLaunchBrowser()` still routed Windows browser clicks through `/api/ibkr/remote-launch` whenever a compatible desktop-agent heartbeat existed. That remote path starts the helper child hidden, which makes a valid local click look like nothing happened.
- Fix implemented: Windows browsers now always use the direct registered protocol path; remote desktop-agent queue remains available for non-Windows browsers with an online compatible desktop helper.
- Regression coverage updated in `artifacts/pyrus/src/features/platform/ibkrBridgeSession.test.mjs`.
- `.replit` port declarations restored to the guarded active runtime set only: `8080 -> 8080` and `18747 -> 3000`; stale/generated ports were removed. Startup config was unlocked for this maintenance edit and relocked afterward.

## Validation Snapshot

- `pnpm --filter @workspace/pyrus exec node --test src/features/platform/ibkrBridgeSession.test.mjs src/features/platform/ibkrBridgeLaunchFeedback.test.mjs src/features/platform/ibkrConnectionCredentialActionModel.test.mjs` passed: 31/31.
- Replit preview loaded at `https://5950eeb6-fc7d-4b18-87e8-8d1c0536942f-00-36emsiuflovpf.riker.replit.dev/?pyrusQa=safe`.
- Preview served patched `src/features/platform/ibkrBridgeSession.js`.
- Preview endpoints returned 200:
  - `/api/ibkr/bridge/helper.ps1`
  - `/api/ibkr/bridge/bundle.tar.gz`
- Browser QA with dummy credentials:
  - Clicked launch from the Replit preview.
  - Observed request path used `/api/ibkr/bridge/launcher`.
  - Observed no `/api/ibkr/remote-launch` request.
  - Post-click UI showed disabled credential fields, disabled primary action, and `Cancel launch`.
  - Dummy activation was canceled and popover returned to idle.
  - Console errors after the focused launch/cancel check: none.
- `pnpm run audit:replit-startup` passed after `.replit` port cleanup.
- `git diff --check -- artifacts/pyrus/src/features/platform/ibkrBridgeSession.js artifacts/pyrus/src/features/platform/ibkrBridgeSession.test.mjs` passed.

## Notes

- Upstream `ib_insync` source check confirmed the expected IBKR readiness boundary: running TWS/IB Gateway API socket plus account synchronization. Our bridge runtime already follows the socket/account pattern; this session's user-visible failure was earlier, in launcher transport selection.
- The working tree has many unrelated existing changes. Intentional edits from this session are scoped to `artifacts/pyrus/src/features/platform/ibkrBridgeSession.js`, `artifacts/pyrus/src/features/platform/ibkrBridgeSession.test.mjs`, and `.replit`.

## Next Recommended Steps

1. User should refresh the Replit preview in their Windows browser so the patched Vite module is active.
2. User can launch with real credentials from Windows; expected behavior is a visible local protocol/helper launch path instead of the hidden remote desktop-agent queue.
3. If Gateway opens but bridge attach still stalls, inspect the Windows helper progress events and the local bridge health after the helper publishes its tunnel URL.
