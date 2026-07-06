# IBKR Third-Party OAuth — Approval Readiness + Draft Application (2026-07-06)

> Produced by a 3-reader + compile assessment workflow (wf_cdaf6266-db1): third-party flow state,
> per-user token security posture, and approval requirements. Companion to
> `ibkr-third-party-oauth-scope.md` + `ibkr-oauth-selfservice-runbook.md`. Branch: main.
>
> **Bottom line:** Engineering is NOT blocked by the IBKR application — the crypto core, uploadable
> public keys, integration description, and an accurate (honestly-incomplete) readiness endpoint exist
> today. The submission itself is blocked on BUSINESS inputs, not code. The per-user connect flow
> (callback route, 3-legged token exchange, per-user IBKR custody) is Phase-4-pending and gated on
> approval anyway — so its absence does not block submitting.

## A. Approval Readiness Checklist

| Item | Side | Status | Evidence / What's needed |
|---|---|---|---|
| OAuth 1.0a Extended crypto core (RSA-SHA256 auth signer, HMAC-SHA256 API signer, DH Live Session Token, IBKR double-encoded base string) | app | **ready (built + unit-tested)** | `providers/ibkr/oauth-signer.ts`, `oauth-live-session.ts` + passing tests |
| Wiring of crypto core to a live per-user flow | app | **gap** | Modules have zero non-test importers — not yet invoked against IBKR |
| Self-service (own-account) path proven end-to-end | app | **gap (partial)** | Reaches `self_service_ready` but still emits `self_service_session_not_implemented`; live-LST proof (task #5) pending |
| Callback route `/broker-execution/ibkr/oauth/callback` | app | **gap (not built)** | Phase-4-pending; only first-party Client Portal connect exists |
| request_token → authorize → access_token exchange | app | **gap (not built)** | Phase-4-pending |
| Callback URL value (`IBKR_OAUTH_CALLBACK_URL`) | app/user | **gap (unpopulated)** | Depends on the completed public site |
| Per-user token custody / encryption-at-rest for IBKR | app | **gap (none exists)** | No `ibkr_user_credentials` table / `ibkr-user-custody.ts`; IBKR secrets are single-account ENV |
| Reusable AES-256-GCM encryption pattern to instantiate for IBKR | app | **ready to reuse** | Proven in `schwab/robinhood/snaptrade-user-custody.ts` (fresh IV, 128-bit tag, per-field AAD, fail-closed). Caveat: not a shared module — IBKR would be a 4th copy unless factored |
| Key management (rotation, KMS) | app | **gap (honesty caveat)** | Master key in process ENV (no KMS); `tokenKeyVersion` recorded but never used (no rotation). Don't claim "defensible custody" yet |
| Log/secret redaction | app | **ready (env) / gap (object fields)** | Flight recorder redacts `IBKR_OAUTH_*` by name; pino `redact` only covers auth/cookie headers — a logged token object could leak. Add a redaction serializer |
| Readiness endpoint accuracy | app | **ready (accurate)** | Admin-gated; reports presence booleans only; self-certifies incomplete; always non-executable |
| Members-connect gating / kill-switch | app | **ready (keep as-is)** | Behind `IBKR_MEMBER_CONNECT_ENABLED=false` + `ibkr_access` entitlement |
| Uploadable public keys (signature, encryption, dhparam 2048-bit) | app | **ready** | Present in `.pyrus-runtime/ibkr-oauth/`; private halves stay secret |
| Integration description | app | **ready (drafted)** | Below + runbook Part B |
| Security-practices write-up | app | **partial** | Can describe the AES-GCM+AAD pattern truthfully; must state IBKR custody is not yet built + flag 2FA-bypass blast radius |
| Legal entity name | business | **user-to-provide** | Established business entity required |
| Regulatory registration / status | business | **user-to-provide** | Feeds enhanced due-diligence |
| Expected account volume + regions | business | **user-to-provide** | Required for Compliance |
| Technical + Compliance contacts | business | **user-to-provide** | Two named contacts (name + email) |
| Completed public website | business | **user-to-provide (weighted heavily)** | A placeholder site stalls Compliance; also gates the callback URL |
| Live, funded, **IBKR Pro** account + paper account | business | **user-to-provide** | Pro (not Lite) required |
| Onboarding contact | business | **correction** | Use **`webapionboarding@interactivebrokers.com`** — NOT `api@ibkr.com` (repo docs were out of date) |

## B. Draft Application

> **Send to:** `webapionboarding@interactivebrokers.com`
> **Subject:** Third-Party Web API Onboarding Request — OAuth 1.0a Extended — [LEGAL ENTITY NAME]

Hello IBKR Web API Onboarding Team,

We are requesting onboarding as a **third-party application** to the IBKR Web API using the **OAuth 1.0a Extended** flow, to act **on behalf of individual IBKR customers under each customer's explicit OAuth authorization**.

**1. Company / applicant**
- Legal entity: **[LEGAL ENTITY NAME]**
- Product: **PYRUS** — [ONE-LINE PRODUCT DESCRIPTION]
- Website: **[https://PRODUCTION_URL]** (completed, finalized product offering)
- Regulatory registration / status: **[REGISTRATION(S) OR EXPLICIT STATUS STATEMENT]**
- Customer regions / jurisdictions: **[REGIONS]**
- Expected account volume: **[N] accounts initially, [PROJECTION] near-term**
- Technical contact: **[NAME, EMAIL]** · Compliance contact: **[NAME, EMAIL]**

**2. Integration description (technical)**
We integrate via the IBKR Web API using the OAuth 1.0a Extended flow end-to-end: `request_token → authorize → access_token → live_session_token → HMAC-signed REST`. Access is per-user; each customer authorizes our consumer individually. Our OAuth 1.0a crypto implementation is built and unit-tested: RSA-SHA256 authorization-phase signing and HMAC-SHA256 (live-session-token-keyed) API signing, including IBKR's non-standard double-encoded base string; and Diffie-Hellman Live Session Token derivation with Java-BigInteger two's-complement serialization, LST validation, and access-token-secret decryption using uploaded 2048-bit DH parameters.

**3. Access scope requested** — account/portfolio reads and order placement.

**4. Callback URL** — **[https://PRODUCTION_URL/broker-execution/ibkr/oauth/callback]** to receive `oauth_verifier`. *(Finalize once the production site + route are live.)*

**5. Public keys** (attached; private keys never leave our systems) — `public_signature.pem`, `public_encryption.pem`, `dhparam.pem` (2048-bit DH).

**6. Security practices — per-user token custody**
Per-user broker credentials are protected with AES-256-GCM authenticated encryption: a fresh 96-bit IV per record, a 128-bit GCM auth tag, and per-field Additional Authenticated Data binding each ciphertext to a specific user + field, in a versioned envelope. The master key is length-validated and the system fails closed (rejects rather than storing plaintext) if the key is missing/invalid. Administrative surfaces expose presence booleans only; secrets are redacted from logs/diagnostics by name. *(We recognize IBKR access-token secrets bypass account 2FA once established; we treat them as high-blast-radius and hold per-user order placement behind an explicit, disabled-by-default entitlement until approval.)*

**7. Proof of concept** — We can demonstrate our self-service (own-account) build — signer, LST derivation, signed reads. *(Confirm the runtime POC is demonstrable before citing; see DO NOW #9.)*

We are prepared to complete a compliance due-diligence questionnaire and to review/sign the Web API agreement. Please advise the onboarding form and any additional materials.

Thank you, **[NAME, TITLE — LEGAL ENTITY]** · [EMAIL · PHONE]

## DO NOW (user) — before sending

1. Decide/confirm the **legal entity name**.
2. State **regulatory registration/status** (or explicit "none, status is X").
3. Provide **expected account volume** (initial + near-term) and **regions/jurisdictions**.
4. Name a **technical** and a **compliance** contact (name + email each).
5. Stand up / finalize the **public website** with completed product details (IBKR weights this heavily).
6. Confirm a **live, funded, IBKR Pro** account (not Lite) + an associated **paper** account.
7. Finalize the production **callback URL** and populate `IBKR_OAUTH_CALLBACK_URL`.
8. Attach the three public files from `.pyrus-runtime/ibkr-oauth/` (never the private keys).
9. **Verify the POC is demonstrable at runtime before citing §7** — the self-service path still emits `ibkr.oauth.self_service_session_not_implemented`; complete the live-LST proof (task #5) first or soften §7 to "in final integration testing."
10. Send to **`webapionboarding@interactivebrokers.com`**; expect ~3–6 wk enhanced due-diligence → Legal-generated Web API agreement → ~3–5 wk consumer configuration.

> Do NOT claim IBKR per-user encrypted custody is built — it is not. The §6 text describes the proven
> pattern shipping for Schwab/Robinhood/SnapTrade that will be instantiated for IBKR; it is written to
> be truthful about the mechanism without asserting an IBKR table exists yet.
