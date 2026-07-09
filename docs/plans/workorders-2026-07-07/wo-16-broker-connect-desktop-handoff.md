# WO-16: Browser-agnostic desktop handoff for broker connect (copy-link + QR)

You are `codex-worker` for `claude-lead` (session f68a9158). Repo `/home/runner/workspace`, branch `main`. Do NOT read `~/.claude/`, `.claude/skills/`, `agents/`. Obey SCOPE. Do NOT restart the app.

## Problem (verified)

Robinhood agent-auth (and by extension the other OAuth/portal brokers) must be **initiated on a desktop** — Robinhood's own docs: "You can only open an agentic account and authenticate your agent on a desktop device," and the documented mobile workaround is "copy the onboarding URL and open it in a desktop browser." Users on a phone hit a "use desktop platform" wall. The current flow (`artifacts/pyrus/src/screens/settings/SnapTradeConnectPanel.jsx` → `openBrokerPopup` → `window.open`) only offers a popup, and the only fallback (`SnapTradeConnectPanel.jsx:~2418-2432`, `href={lastPortal.redirectUri}`) is a plain anchor. There is NO copy-link and NO QR, so moving the flow to another device requires per-browser "Request Desktop Site" toggles — fragile and browser-specific.

The fix must be **browser-agnostic** (Safari, Chrome, Firefox, mobile + desktop — no reliance on per-browser desktop-mode).

## What the flow already exposes

- Robinhood connect start returns `{ authorizationUrl, state, redirectUri, expiresAt }` (see `robinhood-oauth.ts` `beginRobinhoodConnect` / the connect route). Schwab/SnapTrade/IBKR-portal each return their own launch URL (`start.authorizationUrl` for Schwab OAuth at `SnapTradeConnectPanel.jsx:~1435`, SnapTrade `portal.redirectUri` at `~1279`, IBKR `loginPath` at `~1521`).
- OAuth `state` is stored **server-side against the user's account** (`robinhood-user-custody.ts` persists `oauthState`), and the callback requires the same Pyrus login (entitlement `broker_connect`), NOT the same browser tab. So opening the launch URL on a different device that is logged into Pyrus as the same user completes correctly.

## Task

1. In the broker connect UI (`SnapTradeConnectPanel.jsx`, the shared connect surface), when a connect flow is initiated, in addition to opening the popup, render a **handoff affordance** next to it:
   - a **Copy link** button (copies the launch URL: `authorizationUrl` / `redirectUri` / `loginPath` per broker),
   - a **QR code** of that same URL,
   - short helper text: "On desktop? The window opened automatically. On a phone or need another device? Open this link in a **desktop browser** — you'll stay signed in and it finishes here."
2. **QR generation must be dependency-light and offline.** Prefer an existing repo dependency if one is already present (`rg -n '"qrcode"|qr-code|qrcodegen' package.json artifacts/pyrus/package.json lib/*/package.json`). If none exists, implement a tiny self-contained QR encoder or inline SVG QR rather than adding a heavy new dep — match the repo's minimal-dependency posture (`.claude`/ponytail discipline). If a QR lib is genuinely needed, note it and pick the smallest well-maintained one; do NOT pull a large package for this.
3. Keep the popup as the primary path (it's the happy path on desktop). The handoff is the browser-agnostic fallback. Do not remove `openBrokerPopup` or the popup-watcher completion detection.
4. Apply to **all four brokers** that use the connect surface (Robinhood, Schwab, SnapTrade, IBKR portal) since the desktop-handoff need is common — but if wiring a broker cleanly requires touching a live-lane-owned file, do Robinhood (the immediate need) + whichever others are clean, and list the rest as follow-ups.
5. The QR/link must reflect the CURRENT in-flight launch URL (regenerate when a new connect start fires), and should visually clear/expire when the flow completes or times out (reuse the existing popup-watcher signals).

## SCOPE

`artifacts/pyrus/src/screens/settings/SnapTradeConnectPanel.jsx`, a small new QR helper component/util under `artifacts/pyrus/src/screens/settings/` or `components/`, connect-model files if a URL needs surfacing, their tests. Do NOT touch api-server broker routes/services (the URLs are already returned), signal-options/signal-monitor/backtesting files. Before editing any file, `git diff -- <file>` and skip + report if it carries foreign uncommitted hunks.

## Acceptance / verification

- `pnpm --filter @workspace/pyrus test` green (add a focused test: copy-link copies the launch URL; QR renders for a given URL).
- `pnpm --filter @workspace/pyrus run typecheck` clean.
- No heavy new dependency added without justification in the report.
- Scope-check clean. Commit as `feat(web): browser-agnostic desktop handoff (copy link + QR) for broker connect`; do NOT push.

## Deliverable

`.codex-watch/wo-16-connect-handoff-report-2026-07-07.md`: what was added per broker, the QR approach (existing dep vs inline, with justification), test evidence, screenshots if the login gate allows, and any broker deferred for lane-collision reasons.
