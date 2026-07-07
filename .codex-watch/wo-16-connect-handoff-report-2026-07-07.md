# WO-16 Broker Connect Desktop Handoff Report

## Scope

Touched only the broker connect UI surface and focused tests/helpers:

- `artifacts/pyrus/src/screens/settings/SnapTradeConnectPanel.jsx`
- `artifacts/pyrus/src/screens/settings/brokerConnectHandoffQr.js`
- `artifacts/pyrus/src/screens/settings/brokerConnectQrVendor.js`
- `artifacts/pyrus/src/screens/settings/brokerConnectHandoffQr.test.mjs`
- `artifacts/pyrus/src/screens/settings/SnapTradeConnectPanel.source.test.mjs`

Observed pre-edit: `SnapTradeConnectPanel.jsx` and the settings test files had no existing uncommitted diff. `pnpm-lock.yaml` was already modified by other work and was not touched.

## What changed

- Added a shared broker-connect handoff block with:
  - `Copy link` button for the current in-flight launch URL.
  - Inline SVG QR code for the same URL.
  - Helper text: "On desktop? The window opened automatically. On a phone or need another device? Open this link in a desktop browser — you'll stay signed in and it finishes here."
  - Open-link anchor for users who want a direct top-level tab.
- Added `connectHandoff` state keyed by broker so a new connect start replaces the previous in-flight URL.
- Clear behavior:
  - Robinhood: clears on OAuth popup result or close/timeout; also expires on returned `expiresAt`.
  - Schwab: clears on OAuth popup result or close/timeout; also expires on returned `expiresAt`.
  - SnapTrade portal brokers: clears on popup close/timeout; also expires on portal `expiresAt`.
  - IBKR Client Portal: clears when poll detects connected or popup closes/times out.
- Popup remains the primary path. If a popup is blocked, the handoff URL remains visible instead of becoming a dead end.

## Broker coverage

- Robinhood: added copy-link + QR using `start.authorizationUrl`.
- Schwab: added copy-link + QR using `start.authorizationUrl`.
- SnapTrade portal brokers: added copy-link + QR using `portal.redirectUri`.
- IBKR Client Portal: added copy-link + QR using `loginPath`.

No brokers were deferred for lane-collision reasons.

## QR approach

No QR dependency was present in the searched manifests or lockfile (`qrcode`, `qr-code`, `qrcodegen`). I did not add a package or modify package manifests.

The QR encoder is vendored locally from Project Nayuki's MIT-licensed QR Code Generator, compiled from its TypeScript source to JS and exported behind `brokerConnectHandoffQr.js`. This keeps generation offline, dependency-free, and scannable across QR versions without lockfile churn. Source/reference: https://github.com/nayuki/QR-Code-generator and https://www.nayuki.io/page/qr-code-generator-library.

## Verification

- `pnpm --filter @workspace/pyrus test` passed with exit 0 and no output.
- `pnpm --filter @workspace/pyrus run typecheck` passed.
- Focused tests passed:
  - `node --test artifacts/pyrus/src/screens/settings/brokerConnectHandoffQr.test.mjs artifacts/pyrus/src/screens/settings/SnapTradeConnectPanel.source.test.mjs`
  - 7 tests passed.

## Screenshots

No screenshot captured. Per work-order instruction, I did not restart the app, and I did not perform runtime navigation.
