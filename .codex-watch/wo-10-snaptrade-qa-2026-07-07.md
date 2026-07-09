# WO-10 SnapTrade Mocked-State Browser QA - 2026-07-07

Worker: codex-worker for claude-lead session f68a9158  
Scope: read-only browser QA, no code changes, no commits, no app restart  
Preview tested: `http://127.0.0.1:18747/` after `https://$REPLIT_DEV_DOMAIN` timed out at `page.goto(..., waitUntil: "domcontentloaded")`

## Summary Verdict

Overall verdict: BLOCKED for the three SnapTrade surfaces.

Observed: the app preview is reachable on local port 18747, but the requested unauthenticated helper shots do not expose the SnapTrade UI surfaces. Root eventually shows the sign-in gate; Settings and Trade show the sign-in gate immediately. No usable Playwright `--storage-state` file was found in the allowed workspace search. Per task instructions, gated screens were reported blocked rather than working around auth.

Theme coverage: the committed `scripts/headless-shot.mjs` helper exposes no theme/light/dark flag. Only the default rendered theme was captured.

## Helper Evidence

Command shape used:

```bash
pnpm shot "http://127.0.0.1:18747/?screen=<screen>" --out /tmp/wo10-<name>.png --full --json --fail-on-console --match snaptrade --wait-for '[data-testid="platform-screen-stack"]' --settle 4000
```

Supported helper flags were source-checked in `scripts/headless-shot.mjs`: `--out`, `--wait`, `--wait-for`, `--settle`, `--storage-state`, `--viewport`, `--full`, `--match`, `--json`, `--fail-on-console`.

Screenshots:

- Header/root default: `/tmp/wo10-header-default-longwait.png`
- Header/root initial shorter run: `/tmp/wo10-header-default.png`
- Settings default: `/tmp/wo10-settings-default.png`
- Trade default: `/tmp/wo10-trade-default.png`

## Surface Results

### A. Header Broker Popover

Verdict: BLOCKED.

Observed browser result:

- `http://127.0.0.1:18747/` returned HTTP 200 and title `PYRUS Platform`.
- `--fail-on-console`: 0 console errors.
- Failed requests captured by helper: none.
- `--match snaptrade`: 0 matched requests.
- `[data-testid="platform-screen-stack"]` never appeared, including a longer `--wait 60000` run.
- Final long-wait screenshot shows the sign-in gate, not the app header or broker popover: `/tmp/wo10-header-default-longwait.png`.

Source-backed context:

- Header popover trigger exists at `artifacts/pyrus/src/features/platform/HeaderSnapTradeBrokerStatus.jsx:866`.
- Header status test id exists at `artifacts/pyrus/src/features/platform/HeaderSnapTradeBrokerStatus.jsx:897`.
- Broker popover dialog is labelled `Broker connection` at `artifacts/pyrus/src/features/platform/HeaderSnapTradeBrokerStatus.jsx:535`.
- Existing browser spec expects this anonymous header path to render at `artifacts/pyrus/e2e/snaptrade-surfaces.browser-validation.spec.ts:89`, then click the broker trigger at `:104`.

Design smoke:

- BLOCKED. The popover did not render in the current browser session, so no live visual smoke judgment is possible.

### B. Settings SnapTrade Panel

Verdict: BLOCKED.

Observed browser result:

- `http://127.0.0.1:18747/?screen=settings` returned HTTP 200 and title `PYRUS Platform`.
- Screenshot shows the sign-in gate: `/tmp/wo10-settings-default.png`.
- `--fail-on-console`: 0 console errors.
- Failed requests captured by helper: none.
- `--match snaptrade`: 0 matched requests.

Source-backed context:

- Settings mounts `SnapTradeConnectPanel` on the Data & Broker tab at `artifacts/pyrus/src/screens/SettingsScreen.jsx:3067`.
- The panel reads auth session and computes admin/manage capability at `artifacts/pyrus/src/screens/settings/SnapTradeConnectPanel.jsx:617`.
- SnapTrade readiness and brokerage queries are gated by `enabled && canManage` at `artifacts/pyrus/src/screens/settings/SnapTradeConnectPanel.jsx:625` and `:632`.
- Existing browser spec separately expects the panel to be hidden for non-admin at `artifacts/pyrus/e2e/snaptrade-surfaces.browser-validation.spec.ts:324`.

No-credential path:

- BLOCKED in browser. Source indicates the panel intentionally avoids SnapTrade readiness/brokerage calls unless the authenticated user can manage connections.

Design smoke:

- BLOCKED. The SnapTrade panel did not render; only the login gate was visible.

### C. Trade Ticket SHARES Route

Verdict: BLOCKED.

Observed browser result:

- `http://127.0.0.1:18747/?screen=trade` returned HTTP 200 and title `PYRUS Platform`.
- Screenshot shows the sign-in gate: `/tmp/wo10-trade-default.png`.
- `--fail-on-console`: 0 console errors.
- Failed requests captured by helper: none.
- `--match snaptrade`: 0 matched requests.

Source-backed context:

- The SHARES asset mode control is defined in `artifacts/pyrus/src/features/trade/TradeOrderTicket.jsx:742`.
- The no-SnapTrade-account copy is defined at `artifacts/pyrus/src/features/trade/TradeOrderTicket.jsx:790`.
- The blocked submit label `SNAPTRADE ACCOUNT REQUIRED` is defined at `artifacts/pyrus/src/features/trade/TradeOrderTicket.jsx:2372`.
- The SnapTrade recent-orders status region is defined at `artifacts/pyrus/src/features/trade/TradeOrderTicket.jsx:2625`.
- Existing browser spec expects the no-credential SHARES path at `artifacts/pyrus/e2e/snaptrade-surfaces.browser-validation.spec.ts:138`.

No-credential path:

- BLOCKED in browser. The source and existing spec cover the intended state: `SNAPTRADE SETUP`, `Sync SnapTrade`, a blocked readiness strip, disabled submit, and no non-readiness SnapTrade calls.

Design smoke:

- BLOCKED. The trade ticket did not render; only the login gate was visible.

## Console And Network Findings

Observed via helper:

- Header/root local run: 0 console errors, 0 failed requests, 0 `snaptrade` request matches.
- Header/root long-wait run: 0 console errors, 0 failed requests, 0 `snaptrade` request matches.
- Settings local run: 0 console errors, 0 failed requests, 0 `snaptrade` request matches.
- Trade local run: 0 console errors, 0 failed requests, 0 `snaptrade` request matches.

Unknown:

- SnapTrade API response statuses for the actual surfaces remain unknown because no SnapTrade requests were issued before the login gate.
- The helper counts matched request paths but does not record response statuses for `--match`; status reporting would need an enhanced helper or a separate Playwright probe in an authenticated session.

## Ranked Defect / Blocker List

1. BLOCKER: Requested SnapTrade browser QA cannot reach the surfaces in the current unauthenticated preview and no usable storage-state file was available. Evidence: `/tmp/wo10-header-default-longwait.png`, `/tmp/wo10-settings-default.png`, `/tmp/wo10-trade-default.png`. Existing spec expectations for the same surfaces begin at `artifacts/pyrus/e2e/snaptrade-surfaces.browser-validation.spec.ts:89`, `:138`, and `:324`.

2. QA LIMITATION: Light/dark screenshots could not be captured because `scripts/headless-shot.mjs` has no theme flag. Only default-theme screenshots were produced.

3. ENVIRONMENT NOTE: `https://$REPLIT_DEV_DOMAIN` timed out at browser navigation for root/settings/trade, while `http://127.0.0.1:18747/` returned HTTP 200. Local preview was used for the report.
