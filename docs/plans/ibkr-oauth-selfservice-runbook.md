# Runbook — IBKR OAuth do-now (self-service setup + third-party application)

> 2026-07-05. Companion to `docs/plans/ibkr-third-party-oauth-scope.md`. Branch: `main`.
> Two parallel tracks you can start today: **Part A** (self-service — unblocks all engineering, no approval) and **Part B** (third-party application — the 3–6 week long pole).
> Sourced from IBKR's OAuth 1.0a as implemented by Voyz/ibind, quentinadam/deno-ibkr, and marchenko1985 (IBKR's own campus docs 403 automated fetch; portal on-screen labels below are functional, confirm against the live portal).

## ⏸️ STATUS — PAUSED 2026-07-05 (resume point)

Track paused by user to finish the Client Portal connector wizard first. Resume here:
- **Done:** `.env.example` scaffolding added (`IBKR_OAUTH_ENCRYPTION_KEY`, `IBKR_OAUTH_DH_PARAM`, `IBKR_OAUTH_ACCESS_TOKEN`, `IBKR_OAUTH_ACCESS_TOKEN_SECRET`). Key material generated in `.pyrus-runtime/ibkr-oauth/` (gitignored, private keys `chmod 600`, never printed): `private_signature.pem`, `public_signature.pem`, `private_encryption.pem`, `public_encryption.pem`, `dhparam.pem`. The three uploadable public files were shown to the user.
- **Waiting on the user (Part A, Step 2-6):** register at `https://ndcdyn.interactivebrokers.com/sso/Login?action=OAUTH&RL=1&ip2loc=US`, choose a 9-letter A-Z consumer key, upload the two public keys + dhparam, generate the Access Token + encrypted Secret.
- **Next when resumed:** user returns consumer key + confirms Access Token/Secret are stored in secrets (not chat); then build `providers/ibkr/oauth-signer.ts` + `oauth-live-session.ts` and prove one live `live_session_token` round-trip (cheapest de-risk). Then Phases 2-3 (session manager, signed reads, paper order). Part B (third-party application) can be submitted anytime in parallel.
- **No code written for the signer/LST yet.** Only env scaffolding + local key material exist.

## ⚠️ Security first — these credentials can trade on the account

The RSA **private** keys and the decrypted **access-token secret** grant order-placement authority and **bypass account 2FA** once established. Therefore:
- **Never** commit any `*private*.pem`, the access token, or the secret to git. Never paste them into chat, PRs, or the session handoff files.
- Store them in the secret manager / environment only (the `IBKR_OAUTH_*` vars). Keep the working files in a gitignored dir (e.g. `.pyrus-runtime/ibkr-oauth/`).
- The only non-sensitive values safe to share back with me: your chosen **consumer key** (9 chars) and the **realm** (`limited_poa`). Everything else goes in secrets.

---

## Part A — Self-service OAuth on your own IBKR account (do this to unblock engineering)

This uses PYRUS's own IBKR account. No approval needed. It gives us live credentials to build and prove the entire crypto core (signer, DH → Live Session Token, signed reads, paper orders).

### A1. Generate the credential set (openssl)

```bash
mkdir -p .pyrus-runtime/ibkr-oauth && cd .pyrus-runtime/ibkr-oauth   # gitignored

# RSA SIGNING keypair (signs request + LST headers, RSA-SHA256)
openssl genrsa -out private_signature.pem 2048
openssl rsa -in private_signature.pem -pubout -out public_signature.pem

# RSA ENCRYPTION keypair (IBKR RSA-encrypts your access-token secret with the public half)
openssl genrsa -out private_encryption.pem 2048
openssl rsa -in private_encryption.pem -pubout -out public_encryption.pem

# 2048-bit Diffie-Hellman params (generator g defaults to 2 — matches IBKR)
openssl dhparam -out dhparam.pem 2048
```

Formats (already correct for IBKR):

| File | Header | Upload to IBKR? |
|---|---|---|
| `private_signature.pem` / `private_encryption.pem` | `BEGIN RSA PRIVATE KEY` (PKCS#1) | **No** — secret |
| `public_signature.pem` / `public_encryption.pem` | `BEGIN PUBLIC KEY` (SPKI/X.509, from `-pubout`) | **Yes** |
| `dhparam.pem` | `BEGIN DH PARAMETERS` | **Yes** |

> Node's `crypto` reads the PKCS#1 private key directly, so **no PKCS#8 conversion is needed** for our build. (Only quentinadam's Deno client needs `openssl pkcs8 -topk8 …`.)

### A2. Register on IBKR (self-service OAuth form)

1. Log in here with the IBKR username you'll use for API sessions:
   `https://ndcdyn.interactivebrokers.com/sso/Login?action=OAUTH&RL=1&ip2loc=US`
   (This lands directly on the self-service OAuth registration form — there is no documented Settings-menu path; confirm the on-screen wording in your portal.)
2. **Consumer key:** enter a **9-character, A–Z uppercase** value you choose (e.g. `PYRUSCON1`). *(Note: the 25-char hex consumer key is the third-party flow, not this one.)*
3. **Upload** `public_signature.pem`, `public_encryption.pem`, and `dhparam.pem` into their respective slots.
4. **Generate** the Access Token + (RSA-encrypted, base64) Access Token Secret. Save both.

### A3. Decrypt the access-token secret

```bash
echo -n "PASTE_ENCRYPTED_ACCESS_TOKEN_SECRET" | base64 -d \
  | openssl pkeyutl -decrypt -inkey private_encryption.pem | xxd -p -c 0
```
Output is the decrypted secret as **hex** — this is what gets prepended to the LST base string and HMAC'd. (Our code will do this at runtime; the command is here to verify the keypair works.)

### A4. Extract the DH prime (runtime needs `p` as hex)

```bash
openssl dhparam -in dhparam.pem -text -noout \
  | sed -n '/prime:/,/generator:/p' \
  | grep -Ev 'prime|generator' | tr -d ' :\n' | sed 's/^00//'
```

### A5. Where the credentials go (env)

`.env.example:90-94` scaffolds most of these; the scope flagged **two missing** — add them:

```
IBKR_OAUTH_CONSUMER_KEY=          # your 9-char A–Z key (non-secret)
IBKR_OAUTH_SIGNING_KEY=           # path or PEM of private_signature.pem  (SECRET)
IBKR_OAUTH_ENCRYPTION_KEY=        # NEW — private_encryption.pem          (SECRET)
IBKR_OAUTH_DH_PARAM=              # NEW — dhparam.pem (or the extracted prime hex)
IBKR_OAUTH_ACCESS_TOKEN=          # from the portal (SECRET)
IBKR_OAUTH_ACCESS_TOKEN_SECRET=   # the RSA-encrypted secret from the portal (SECRET)
IBKR_OAUTH_CALLBACK_URL=          # third-party only (Part B); leave empty for self-service
```

### A6. Hand back to me (to start the crypto core)

Once A1–A4 are done, tell me: your **consumer key**, that the **realm is `limited_poa`**, and that the six env values are populated in secrets (do **not** paste the secret values). Then I build `providers/ibkr/oauth-signer.ts` + `oauth-live-session.ts` and prove one live `live_session_token` round-trip — the cheapest de-risk in the scope.

---

## Part B — Third-party OAuth application (the 3–6 week long pole)

Self-service trades only PYRUS's own account. To trade on behalf of **other users**, IBKR must approve PYRUS as a third-party OAuth vendor (compliance/vendor onboarding). IBKR doesn't publish detailed eligibility or a self-serve form — it's a direct-contact process. Submit this now so approval runs in the background while engineering proceeds on Part A.

**Draft request (email to IBKR Web API onboarding. Per 2026-07 onboarding research the correct intake is `webapionboarding@interactivebrokers.com` — NOT the older `api@ibkr.com`; confirm on send):**

> Subject: Third-party OAuth 1.0a onboarding request — [PYRUS / legal entity name]
>
> Hello,
>
> [Company / legal entity] operates PYRUS, a [one-line: e.g. algorithmic trading and portfolio platform]. We would like to onboard as an approved **third-party OAuth 1.0a** consumer so our customers can authorize PYRUS to access and place orders on their Interactive Brokers accounts on their behalf via the Web API.
>
> - Integration: IBKR Web API, OAuth 1.0a Extended (request_token → authorize → access_token → live session token → signed REST).
> - Access needed: account/portfolio reads and order placement, per-user, under each customer's explicit OAuth authorization.
> - Approximate customer scale: [N] accounts initially, [region(s)].
> - Technical contact: [name / email]. Compliance contact: [name / email].
>
> Please advise the application/compliance steps, any agreements to execute, and expected timeline. We can provide our firm details, use-case description, and security practices as needed.
>
> Thank you,
> [Name, title, company]

**Before sending, decide/gather:** legal entity + any regulatory registration, expected account volume + regions, a technical + a compliance contact, and a short security summary (how you store per-user tokens). Track A engineering does **not** wait on this.

---

## What's resolved / what this unblocks

- **Signature methods (was an open risk):** RSA-SHA256 for `request_token`/`access_token`/`live_session_token`; **HMAC-SHA256** (keyed by base64-decoded LST) for all API calls. Confirmed across 3 OSS impls.
- **Self-service skips the 3-legged flow:** the portal issues the access token directly, so Part A validates ~80% of the build (signer, DH/LST, session keep-alive, signed reads, paper orders) with **zero approval**.
- **Two implementation gotchas for the signer** (carried into the build): HMAC the **decrypted** secret bytes (not the encrypted form); serialize the DH shared secret big-endian with two's-complement sign handling (leading `0x00`) — the classic cause of a valid-looking but rejected LST.

Sources: Voyz/ibind wiki + `oauth1a.py`, quentinadam/deno-ibkr, marchenko1985 IBKR OAuth. IBKR campus OAuth-1.0a-Extended (403 to bots — verify portal labels live).
