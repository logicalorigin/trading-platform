# Broker-proof runbooks — approved 2026-07-07 (all four this week)

Owner decisions from the 2026-07-07 interview: prove all four broker paths. Manual trading is currently hard-blocked `broker_not_configured` (IBKR desktop bridge retired; nothing configured in its place). Each runbook lists what Riley does, what the agent verifies, success, and park criteria. No live order is ever placed without Riley's explicit per-order confirmation.

## 1. Schwab (code-complete tonight: routes `8407812d`, reauth `fc0a328a`)

- **Riley:** approve the app in the Schwab developer portal; add the env credentials the readiness probe names (see `schwab-oauth.ts` config resolution — app key/secret + redirect base + encryption key).
- **Agent then:** `GET /broker-execution/schwab/readiness` → expect `research_required` (configured, no user); connect flow → OAuth callback → readiness `connected`; run an order **preview** (no submit) on a canary symbol; verify audit_events rows for connect + preview.
- **Success:** preview returns a priced order intent end-to-end.
- **Park if:** Schwab app approval stalls >1 week — revisit priority then.

## 2. IBKR Client Portal (mount-base fix `0a20c0c5`, live after tonight's reload)

- **Riley:** one login attempt with real IBKR creds + 2FA at the hosted gateway URL (Settings → broker panel → IBKR connect). ~5 min.
- **Agent then (before asking Riley):** confirm the re-anchor is live (gateway log shows `POST /sso/Authenticator` 200s, no `/api/Authenticator` 404s) and the gateway instance is up.
- **Success:** post-2FA lands in an authenticated session (no bounce back to login); readiness probe turns authenticated; then a read-only account fetch.
- **Park criteria (owner-agreed):** if it loops back to login again after this fix, park IBKR CP for good.

## 3. Robinhood (foundation committed since Jul 2/6)

- **Riley:** one OAuth login through the unified broker picker (Settings).
- **Agent then:** verify custody + account-sync readiness (`robinhood-readiness.ts`), synced positions appear, audit rows written.
- **Success:** readiness connected + one clean account sync.
- **Park if:** OAuth app registration/approval turns out to be missing on the Robinhood side — report exactly what's needed.

## 4. SnapTrade / E*TRADE (unfillable proof order)

- **Agent first (read-only):** verify an execution-ready E*TRADE SnapTrade account still exists (readiness + account list); re-read `docs/plans/snaptrade-capability-proof-2026-07-02.md` for the agreed order shape (far-from-market limit, immediately cancelable).
- **Riley:** explicitly confirm the EXACT order (symbol, side, qty, limit price) before placement; agent places, confirms open, cancels, and documents timestamps + order ids.
- **Success:** order accepted by E*TRADE and cleanly canceled; proof recorded in the plan doc.
- **Hard rule:** no placement without the explicit per-order confirmation; any ambiguity → stop and ask.

## Sequencing note

2 (IBKR retry) and 3 (Robinhood login) are ~5-minute Riley actions doable tonight after the reload verification. 1 (Schwab) depends on external portal approval — start it first, it has the longest external latency. 4 (E*TRADE) is market-hours sensitive — run the proof during tomorrow's RTH so the cancel path is fully live.
