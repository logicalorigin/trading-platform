# Spec — Multi-tenant onboarding + per-user IBKR Client Portal

Status: **DRAFT for review** · Author session: b21b5fa5 · Date: 2026-07-03 (MT)
Decision log at bottom. Nothing here is built yet — this is the design to approve before implementation.

## 1. Goal

Turn the platform from a single-operator app into a **public self-serve SaaS**, entered from
an external front-end website via a **"Launch Platform"** button. Each user gets:
- logically-isolated data (one shared deployment, row-scoped by `app_user_id`), and
- an **on-demand** personal IBKR Client Portal gateway (their own CPG JVM while active).

## 2. Locked decisions (from review)

| # | Decision |
|---|---|
| D1 | **Logical** isolation — one shared deployment, per-user gateway + per-user data. |
| D2 | Audience: **public self-serve SaaS** (hundreds+ registered; tens concurrently active). |
| D3 | Auth handoff: **signed JWT launch token** minted by the external site. |
| D4 | Gateways are **on-demand + reaped** (not one persistent JVM per registered user). |
| D5 | Process: **full spec first**, then build in slices. |

## 3. Current-state facts (what we're changing)

- **Auth is single-operator.** Only `POST /auth/bootstrap` creates a user (first user → `admin`,
  409 forever after). No signup/invite/register. `users` schema *supports* many users (`role`
  default `member`, `disabledAt`) but only one exists. `users.password_hash` is **NOT NULL**.
- **Everything user-facing is `requireAdmin`-gated** (incl. the IBKR portal routes). SaaS members
  are not admins → this gating is wrong for them and must be reworked.
- **Broker tables already FK to `app_user_id`** (robinhood/schwab/snaptrade/broker + our IBKR
  portal routing keys by `session.user.id`). But non-broker services (account, signals,
  automation) were written assuming a single global operator — data-isolation is **not** yet
  enforced platform-wide.
- **IBKR gateway pool exists** (`ibkr-portal-gateway-manager.ts`): one CPG JVM per `appUserId`,
  hard cap `MAX_GATEWAYS=4`, spawned on connect, stopped on disconnect, **no idle reaping**.

## 4. Architecture

```
 External front-end site ──(user signs up / logs in there)──┐
        │  "Launch Platform" button                          │ mints short-lived
        ▼                                                     ▼ signed JWT (RS256)
   GET/POST  https://platform/api/auth/launch?token=<JWT> ───────────────┐
        │  verify sig+exp+aud+iss+jti(one-time)                          │
        ▼                                                                 │
   JIT find-or-create users row (by external id) → mint pyrus_session ───┘
        │  redirect into the app (session cookie set)
        ▼
   App (control plane): per-user data (row-scoped) + broker connectors
        │  user clicks "Connect IBKR"
        ▼
   Gateway manager: spawn on-demand CPG JVM for this user  ── reaped on
        (this container now; a fleet of gateway-workers later)   logout/expiry/idle
```

## 5. Detailed design (the 7 pieces)

### 5.1 Auth handoff — the JWT launch-token contract
- **Signing (OPEN Q1):** recommend **asymmetric RS256/EdDSA** — the parent site holds the private
  key, this app holds only the public key (`LAUNCH_JWT_PUBLIC_KEY` env). Avoids sharing a secret.
  Alternative: HS256 shared secret (simpler, but both sides hold the secret).
- **Required claims:** `iss` (parent site id), `aud` (this platform id), `sub` (stable external
  user id), `email`, `name` (optional), `iat`, `exp` (**short, ≤120s**), `jti` (unique — replay
  guard). Optional: `plan`/`entitlements` for gating.
- **Endpoint:** `POST /api/auth/launch` (token in body preferred over query so it isn't logged;
  a `GET` variant with token in URL fragment is acceptable if the button must be a plain link).
- **Verification (all must pass):** signature; `exp`/`iat` freshness; `aud`==us; `iss` allow-list;
  `jti` unused (one-time cache — table or Redis, TTL = token lifetime). On success: JIT provision,
  set `pyrus_session` cookie, 302 into the app. On failure: 401, no session.
- **Hardening:** HTTPS only; rate-limit by IP + `sub`; clock-skew tolerance ~30s; reject `alg=none`.

### 5.2 JIT user provisioning
- Add `users.external_user_id` (text, **unique**) + `users.external_issuer` (text). Find-or-create
  by (`external_issuer`,`external_user_id`); update email/displayName on each launch. Role = `member`.
- **Schema:** make `password_hash` **nullable** (launch users have no password) — migration.
- Idempotent; concurrent first-launch guarded by unique index (insert-on-conflict).

### 5.3 Session establishment
- Reuse `createAuthSession({ userId })` → sets `pyrus_session`. All existing `requireAuth`/session
  machinery keeps working unchanged. Session TTL unchanged.

### 5.4 Per-user data isolation (SECURITY-CRITICAL — dedicated hardening pass)
- **Rule:** every user-scoped query filters by `app_user_id = session.user.id`; every write stamps it.
- **Audit surface:** broker tables already keyed — verify reads/writes scope. The bigger risk is the
  **non-broker** services (account/positions/orders, signals, automation, backtesting) that assume a
  single global IBKR/account. Each must be reviewed: does it leak another user's data or act on the
  wrong account? This is an explicit **audit + enforcement task**, not a one-liner.
- Consider a defense-in-depth helper (a scoped query wrapper / lint) so new code can't forget.

### 5.5 Role model rework
- Introduce `requireUser` (any authenticated, non-disabled) vs keep `requireAdmin` (platform ops).
- **Rescope:** broker connect/trade/account routes → `requireUser`, self-scoped to `session.user.id`.
  Currently the IBKR portal + robinhood/schwab routes use `requireAdmin` — change to `requireUser`.
  Truly admin-only surfaces (backend settings, platform config, diagnostics) stay `requireAdmin`.
- Define the admin/member route matrix explicitly (OPEN Q3).

### 5.6 On-demand gateway lifecycle + reaping
- Keep spawn-on-connect. **Add:**
  - `lastActivityAt` per gateway; bumped on tickle + any proxied/API request.
  - **Idle reaper**: background timer reaps gateways idle > `IBKR_PORTAL_IDLE_MS` (OPEN Q2, default
    ~30 min) or past CPG session expiry (~24h), and on user logout.
  - **Dynamic cap + LRU eviction**: replace hard cap 4 with a resource-derived cap; when full,
    evict the least-recently-used *idle* gateway before refusing a new one (refuse only if all busy).
  - Metrics: active gateway count, evictions, reap reasons (feed the flight recorder).

### 5.7 Horizontal scaling path (DESIGN NOW, BUILD LATER)
- When concurrent-active gateways exceed one container's budget (2 CPU is the ceiling, ~tens of JVMs):
  split into **control plane** (this app) + **gateway-worker** containers. A **gateway registry**
  maps `appUserId → worker`; the proxy routes a user's `/gateway/*` + IbkrClient calls to their
  assigned worker. Scheduler places new gateways on the least-loaded healthy worker. Not needed for
  beta/single-container; the manager's interface is designed so this is a drop-in later (the manager
  becomes a client of the registry instead of spawning locally).

## 6. IBKR compliance gate (BUSINESS decision, engineering-enforced)
- Public users logging their IBKR sessions through our hosted CPG is very likely outside IBKR's
  terms and carries regulatory weight. **Engineering guardrail:** the IBKR connect feature is behind
  a flag (via `backend-settings`) + an allow-list, defaulting **OFF for `member`s** until the
  IBKR ToS/OAuth-approval question is resolved. Robinhood/Schwab (sanctioned OAuth) are unaffected.

## 7. Data-model changes (migrations)
1. `users.password_hash` → nullable.
2. `users.external_user_id` (text) + `users.external_issuer` (text) + unique index on the pair.
3. `launch_token_jti` replay cache (table: `jti` PK, `expires_at`) — or Redis if available.
4. (Later, horizontal) `gateway_assignments` registry.

## 8. Implementation slices (ordered, each independently verifiable)
1. **Launch auth**: migrations (5.2/7), `/api/auth/launch` + JWT verify + JIT provision + session,
   `LAUNCH_JWT_PUBLIC_KEY`/`ISSUER`/`AUD` env, replay cache, tests. Verify with a locally-minted
   test JWT end-to-end (like the self-test we did).
2. **Role model**: `requireUser`; rescope broker/IBKR routes to self; admin/member matrix; tests.
3. **Data isolation audit + enforcement** (5.4) — the security pass; per-service review.
4. **On-demand gateway reaping + dynamic cap + LRU** (5.6) + metrics; tests.
5. **IBKR compliance flag/allow-list** (6).
6. **(Later)** horizontal gateway workers (5.7).

## 9. Open questions (need your input before/while building)
- **Q1 — JWT signing:** RS256 asymmetric (recommended, parent holds private key) or HS256 shared secret?
- **Q2 — Idle-reap timeout** for gateways (default proposed: 30 min inactivity)?
- **Q3 — Admin vs member route matrix:** confirm which surfaces stay admin-only (settings,
  diagnostics, automation config?) vs member-self (broker connect/trade, account view).
- **Q4 — External user id:** is the parent site's `sub` a stable, permanent id per user? And is
  email authoritative/verified there (so we can trust it)?
- **Q5 — Entitlements/billing:** does the launch token carry a plan/entitlement we must gate on
  (e.g. only "pro" users may connect a broker), or is that out of scope for v1?

## 10. Non-goals (v1)
- Building the external front-end / its signup (owned by the parent site).
- Horizontal gateway workers (designed, deferred).
- Resolving IBKR compliance (business track; engineering gates it OFF meanwhile).
