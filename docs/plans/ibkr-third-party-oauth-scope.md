# Scope — IBKR Third-Party OAuth (durable unattended trading)

> Status: SCOPE — 2026-07-05. Branch: `main` (all work on main, no side-branching).
> Track: DURABLE (unattended, server-side). The interim attended path is `docs/plans/ibkr-connector-local-setup-spec.md`.
> Confidence: HIGH on the core decision (workflow `wf_b3e15f66-634`: 2 web-research + fable synthesis + adversarial verify; the `approval-process` and `code-build-scope` research agents failed the structured-output cap but the synthesis/verify covered both).

## Bottom line

**Build the direct IBKR OAuth 1.0a integration. Don't try to buy your way out of it — SnapTrade can't place IBKR orders.** But the expensive part is IBKR's *approval*, not the code, and there's a clean way to decouple them:

- **SnapTrade (already integrated) can't do it.** Its IBKR connector is `INTERACTIVE-BROKERS-FLEX` — a user-pasted Flex Query token producing **read-only, delayed** account/portfolio data, **no order placement**. Confirmed by SnapTrade's own integration page and anticipated in our own `docs/plans/snaptrade-hosted-brokerage-integration-plan.md:83-96`. So SnapTrade stays as the multi-broker + IBKR-read-only fallback, not the trading path.
- **The self-service (first-party) OAuth path needs no approval and uses the *identical* crypto.** Both self-service and third-party converge on the same Diffie-Hellman → Live Session Token → HMAC-signed API machinery. So ~80% of the build (signer, LST, session manager, signed reads, order placement) can be **written and proven on PYRUS's own IBKR account before any approval lands**. Third-party approval only gates the final per-user `request_token → authorize → access_token` flow.
- **Calendar is the long pole.** IBKR's own doc estimates **3–6 weeks** for third-party approval (business/compliance-owned, may slip). Submit the application now; keep engineering fully unblocked on the self-service track in parallel.

## Build vs buy — the evidence

| Option | Unattended IBKR trading? | Approval burden | Notes |
|---|---|---|---|
| **Direct IBKR OAuth 1.0a (third-party)** ⭐ | **Yes** | IBKR third-party approval (3–6 wk) | The only durable path; crypto is all Node stdlib |
| SnapTrade (already integrated) | **No** — Flex Query, read-only | none | Keep for other brokers + IBKR read-only fallback |
| Other aggregators (Plaid/Yodlee/etc.) | No IBKR order placement | — | Ruled out |
| Local connector (`ibkr_special_connector`) | Attended only | none | The interim track, not unattended |

Adversarial check (HIGH confidence): third-party is genuinely required for a multi-user platform; SnapTrade provably can't place IBKR orders. Residual: SnapTrade *could* add native IBKR trading later (they do OAuth trading for E*TRADE), which would lower the strategic value but not eliminate it.

## The OAuth 1.0a "Extended" flow (what the build implements)

Base host `api.ibkr.com`, API root `/v1/api`. Two IBKR-specific crypto extensions on top of standard OAuth 1.0a: RSA-SHA256-signed auth phase, and a Diffie-Hellman-derived Live Session Token (LST) that keys every API call.

1. **request_token** (third-party only) — `POST /oauth/request_token`, RSA-SHA256-signed with the consumer signing key → temporary request token.
2. **authorize** (third-party only) — redirect user to `interactivebrokers.com/authorize?oauth_token=<request_token>`; user logs into IBKR + grants; IBKR calls back the registered callback URL with `oauth_verifier`.
3. **access_token** (third-party only) — `POST /oauth/access_token`, RSA-SHA256-signed, with token+verifier → **per-user Access Token + (RSA-encrypted) Access Token Secret** (decrypt with the consumer's separate encryption key). Stored per user.
4. **live_session_token** (both paths) — `POST /oauth/live_session_token`; client sends DH challenge `A = g^a mod p`; RSA-SHA256-signed with the decrypted token secret prepended to the base string → DH response `B` + LST signature + expiry.
5. **LST computation** (client-side) — shared secret `K = B^a mod p`; `LST = HMAC-SHA1(K, decrypted_token_secret)`; validate `HMAC-SHA1(LST, consumer_key) == returned signature`. LST never leaves the process.
6. **Sign every API request** — switch to `HMAC-SHA256` keyed by the LST for all `iserver/*`, `portfolio/*`, order calls.
7. **ssodh/init** — `POST /iserver/auth/ssodh/init` `{publish:true, compete:true}` → establishes the brokerage session (required before trading endpoints report authenticated).
8. **Keep-alive / re-auth** — `POST /tickle` ~every 60s; LST valid ~24h; on expiry re-run steps 4–5 + 7 (the per-user access token persists, so the authorize redirect is NOT repeated).

## Technical build map (grounded in repo; Node crypto only, zero new deps)

| Component | Files | New/Reuse | Effort |
|---|---|---|---|
| OAuth 1.0a dual-mode signer (RSA-SHA256 auth-phase + token-secret prepend; HMAC-SHA256 LST-keyed; base-string/nonce/percent-encode) | NEW `providers/ibkr/oauth-signer.ts` + `.test.ts` | New (schwab/robinhood are OAuth2 — wrong crypto) | 2–3d |
| Live Session Token module (DH BigInt modexp p=2048/g=2, RSA-decrypt secret, LST=HMAC-SHA1, signature validate) | NEW `providers/ibkr/oauth-live-session.ts` | New | 1–2d |
| Unattended session manager (`ssodh/init`, 60s tickle, 24h re-auth loop, auth-loss recovery) | NEW `services/ibkr-oauth-session.ts` | New logic; model on `ibkr-portal-session.ts` + `ibkr-bridge-runtime.ts` | 3–4d |
| Transport integration (point endpoint client at `api.ibkr.com/v1/api` via a per-request signing hook) | MODIFY `providers/ibkr/client.ts` (3,825 lines; `buildHeaders`:985, `request`:1026, baseUrl config-driven :1010-1014) | **Reuse — whole endpoint surface incl. order confirm/reply carries over** | 2–3d |
| Third-party connect flow (`request_token`→authorize→`access_token`, per-user encrypted token store, callback route) | NEW `services/ibkr-oauth-connect.ts` + callback in `routes/broker-execution.ts` | New logic; model on `schwab-oauth.ts` start/complete (:141/:246) + robinhood token persistence | 2–3d (**Phase 4, gated on approval**) |
| Config + readiness upgrade (add `IBKR_OAUTH_ENCRYPTION_KEY` + `IBKR_OAUTH_DH_PARAM`; optional self-service `IBKR_OAUTH_ACCESS_TOKEN/SECRET`; extend readiness beyond `research_required`) | MODIFY `.env.example:90-94`, `ibkr-oauth-readiness.ts` (:41-57 alias plumbing) + tests | Extend stub | 0.5–1d |
| Provider classification + execution gating (promote `ibkr_oauth` to executable; keep ADR-002 scope permission on order routes) | MODIFY `broker-provider-classification.ts`, `routes/broker-execution.ts` | Extend | 1d |
| Test suite (signer/LST unit vectors vs OSS refs; paper account e2e: accounts→positions→order→cancel) | NEW tests per module + gated integration | New | 2–3d |

## Phased plan

- **Phase 0 (this week, parallel, mostly non-eng):** submit the IBKR third-party OAuth application (business); enable **self-service OAuth on PYRUS's own IBKR account** (portal + `openssl` — generate RSA signing + encryption keypairs and 2048-bit DH params, register public halves); a human reads the two campus docs (they 403 to bots) to settle the crypto ambiguities below; add the two missing env vars; confirm an IBKR **paper** account.
- **Phase 1 (~1wk):** signer + DH/LST module with unit test vectors; prove one live `live_session_token` round-trip against `api.ibkr.com` with self-service creds (LST signature validates). **Exit: validated LST from production IBKR.**
- **Phase 2 (~1wk):** session manager (`ssodh/init`, tickle, 24h re-auth) + signing hook in `providers/ibkr/client.ts`; unattended READ path live (accounts, positions, ledger, summary) with a **24h+ soak** proving re-auth with no human present. **Exit: overnight unattended account sync on own account.**
- **Phase 3 (~3–4d):** order placement via the existing order/reply/confirm surface against a **paper** account, gated by ADR-002 scope permission. **Exit: paper order placed + canceled server-side with the user offline.**
- **Phase 4 (post-approval, ~1wk):** third-party per-user flow (`request_token`/authorize/`access_token` routes modeled on `schwab-oauth.ts`, encrypted per-user token store, callback registered); flip `IBKR_OAUTH_THIRD_PARTY_APPROVED`. **Exit: a non-founder user connects via IBKR redirect and the server trades for them unattended.**
- **Phase 5 (hardening):** production rollout behind readiness gating; monitoring via existing `diagnostics-ibkr-metrics` patterns; optional `wss://api.ibkr.com/v1/api/ws` streaming.

## Do now (start the long poles today — no eng dependency)

1. **Submit the IBKR third-party OAuth / compliance onboarding request** (via `webapionboarding@interactivebrokers.com` — the current Web API onboarding intake per 2026-07 research; the older `api@ibkr.com` is out of date. See `ibkr-approval-readiness.md`). Longest lead time (3–6 wk per IBKR), gates only Phase 4. IBKR does not publish detailed third-party eligibility/agreement requirements — this is a direct-contact process; expect a compliance/vendor review.
2. **Enable self-service OAuth on PYRUS's own IBKR account** — generate two RSA-2048 keypairs + 2048-bit DH params (`openssl`), register the public halves. Unblocks ALL crypto-core dev with zero approval.
3. **Human reads the two docs that 403 to bots** (`.../oauth-1-0a-extended/` and `.../webapi-doc/`) to resolve the ambiguities below before the signer is coded.
4. Confirm/open an IBKR **paper** account for Phase 3.

## Cheapest de-risk (do first)

Enable self-service OAuth on our own account and **prove ONE `live_session_token` round-trip** against `api.ibkr.com` (the LST signature validating end-to-end). This validates the load-bearing assumption (~80% of the build works before any approval) at near-zero cost AND resolves the request_token signature-method ambiguity **empirically**, rather than from docs that block bots. ~1–2 days.

## Open decisions

- **Signature method on `request_token`/`access_token`** — OSS consensus + IBKR's oauth.pdf say RSA-SHA256 (no token secret exists yet); one campus snippet says HMAC-SHA256-only in third-party context. Settle from the live doc / self-service test before coding the signer. Wrong choice = classic integration failure.
- **Per-user token custody** — reuse the schwab/robinhood persistence as-is, or add encryption-at-rest/KMS (IBKR access-token secrets bypass account 2FA once established → higher blast radius than OAuth2 refresh tokens).
- **Single-session semantics** — IBKR allows one live session per account; `ssodh/init compete:true` evicts the user's own TWS/mobile session. Product call: when does PYRUS compete vs yield? (Directly affects "works when user is offline" vs "fights the user when online.")
- **Ship self-service as an interim feature?** (founder/power-user accounts trading unattended pre-approval) or keep it an internal validation harness only.
- **Client architecture** — inject the signer into the existing 3,825-line `providers/ibkr/client.ts` via an auth hook (recommended — full endpoint reuse) vs a thin separate OAuth client (cleaner, duplicated surface).
- **Secret rotation** — IBKR reissues the access-token secret on each generation while the token is stable; confirm rotation never forces a fresh authorize redirect (would break the unattended guarantee).
- **Secret handling** — DH private exponents + decrypted token secrets must never be captured by flight-recorder / diagnostics.

## Effort & calendar

- Engineering: **~2–3 engineer-weeks** to unattended, paper-validated IBKR trading on the self-service path (Phases 1–3), **+~1 week** post-approval for the third-party per-user flow (Phase 4).
- Calendar: dominated by IBKR third-party approval (**~3–6 weeks**, business-owned, may slip) — which is why the application goes in now and the self-service track keeps engineering unblocked.

## Related

- `ibkr-oauth-readiness.ts` (stub → live), route `broker-execution.ts:116`, env `.env.example:90-94`
- `providers/ibkr/client.ts` (endpoint surface to reuse), `schwab-oauth.ts` / `robinhood-oauth.ts` (connect/token patterns)
- `docs/decisions/ADR-002-automation-first-broker-scope-permission.md` (order-scope gating)
- `docs/plans/snaptrade-hosted-brokerage-integration-plan.md:83-96` (SnapTrade IBKR = Flex read-only)
- `docs/plans/ibkr-connector-local-setup-spec.md` (interim attended track)
