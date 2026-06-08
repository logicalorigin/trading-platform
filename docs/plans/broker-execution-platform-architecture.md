# Broker Execution Platform Architecture

Last reviewed: 2026-06-08

## Summary

PYRUS should become a hosted broker-execution platform where users connect
their own broker accounts without entering broker passwords into PYRUS. Users
authenticate at the broker or broker-connection portal, grant scoped access,
and return to PYRUS with a connected account.

Because PYRUS will provide market data, research, scanners, charts, signals,
and option analytics internally, v1 broker integrations do **not** need general
broker market-data access. They do need enough account and order access to
route trades safely and reconcile outcomes.

The practical answer to "do we need a full API connection?" is:

- No, not for market data, charts, scanners, or research.
- Yes, for account identity, buying power when available, positions, open
  orders, order placement, cancel/replace, executions, and reconciliation.
- Pure order-submit-only access is not enough for fully automated trading
  because PYRUS must know whether an order was accepted, filled, rejected,
  canceled, duplicated, or left in an unknown state.

## Reference Model

Observed market patterns:

- TradersPost-style model: broker connections are authorized through broker
  login/consent, then strategies/subscriptions route signals to selected broker
  accounts.
- QuantWheel-style model: broker account connection and trade-routing
  permission are separate decisions.
- SnapTrade-style model: connections can be read-only by default and upgraded
  to trade-enabled when the user re-authorizes.

PYRUS should borrow the broker-login and strategy-routing patterns, but v1
should be automation-first. A connected broker account is useful only when it
can support automation-grade execution. Read-only or manual-only states are
blocked/fallback provider states, not the intended onboarding path.

PYRUS should use this separation:

1. App login: user signs into PYRUS.
2. Broker connection: user authorizes automation execution scopes outside
   PYRUS.
3. Automation configuration: user chooses a broker account and sets caps,
   allowed symbols, allowed order types, live/paper preference, and kill
   switches.
4. Automation activation: user links a PYRUS strategy to the configured broker
   account. Terminal orders may use the same activated account with per-order
   confirmation.

## Architecture Decisions

- Use hosted SaaS with user and tenant isolation.
- Treat "their instance of PYRUS" as a logically isolated tenant/account
  workspace in a shared platform by default. Do not assume thousands of
  physically separate app deployments unless a broker, compliance, or runtime
  isolation requirement later forces that split.
- Use the portal as the front door and app identity provider. The marketing
  site owns public pages, login, dashboard, broker-connect entry points, and
  launch-platform handoff. The trading platform validates handoff-derived
  platform sessions and enforces tenant/account authorization.
- Use Better Auth as the in-process portal IdP if the platform portal plan is
  the active source of truth. Supabase Auth, Clerk, Auth0, and WorkOS are not
  the v1 path unless that portal decision is explicitly reopened.
- Never collect broker usernames or passwords in PYRUS.
- Store only broker-issued OAuth/connection tokens, encrypted at rest behind
  the platform/broker-adapter boundary, when a provider or aggregator requires
  token custody.
- Use a PYRUS-owned broker adapter contract. Direct official broker adapters
  and aggregator adapters must both map into the same internal model.
- Use broker/account-native execution rules. PYRUS should not force every
  broker into the lowest-common-denominator order menu; it should discover and
  enforce the capabilities of the specific broker account the user connects.
- Keep user broker market-data scopes disabled by default.
- Start with stocks and single-leg options. Multi-leg options spreads are
  deferred until after v1 automation because broker combo order formats,
  margin/preview behavior, and reconciliation semantics vary materially by
  provider.
- Make v1 broker connections automation-first execution connections.
- Support full terminal trading and fully automated execution from the same
  activated account permission. Terminal orders still require per-order live
  confirmation; automated strategy orders require strategy-level caps.
- Treat IBKR Gateway as a special connector class, not the general broker
  pattern. OAuth brokers and aggregator portal connections are the normal SaaS
  path.

## Portal Auth Gate And App Entry

The website/portal plan is the correct place for PYRUS user login and
first-time broker setup. Broker reauth after launch belongs to the platform
workspace, not the website, but must still be initiated through a
broker-hosted/OAuth/approved flow and never through PYRUS credential capture.
The terminal should be entered only after portal authentication and after the
user has connected a broker account through the website dashboard.
First-time broker connection should be a dedicated portal/dashboard flow.

Entry sequence:

1. Anonymous user lands on the marketing site.
2. User clicks `Log in` and signs into `/app/login` through the portal.
3. Portal session resolves `subject`, `tenantId`, roles, and account
   entitlements.
4. `/app` dashboard shows one of these states:
   - read-only shadow demo for non-connected users;
   - broker-connect gate for users ready to connect their own account;
   - connected account dashboard for users with an authorized broker account.
5. User connects a broker from `/app/connect` or a broker settings surface.
6. First-time broker login/consent happens only at the broker, OAuth provider, or
   broker-connection portal.
7. Platform stores returned connection references or broker-issued tokens
   behind the broker-adapter boundary, encrypted at rest where custody is
   required. Portal displays connection state and drives the UX.
8. Portal/platform sync broker accounts and capabilities.
9. Portal enables `Launch platform` after the tenant has at least one valid
   live-capable automation-grade customer broker connection, or a recoverable
   broker reauth path.
10. `Launch platform` creates a one-time tenant/workspace handoff code and
    opens the user's isolated PYRUS workspace; the platform server exchanges the
    code for a short-lived platform session before rendering the client app.
11. User selects accounts, configures caps, activates strategies, and performs
    routine broker-hosted reauth inside the launched workspace.

Terminal rules:

- The terminal must not be the first auth gate.
- The terminal must not be launchable for ordinary users without a connected
  broker account.
- The terminal must not host broker username/password login.
- The terminal can display broker/account state, missing capabilities, expired
  consent, and reauthorization prompts.
- Broker reauthorization is platform-owned after launch. The terminal may
  launch a broker-hosted/OAuth reauth flow when the adapter supports it
  cleanly. If the provider requires a full reconnect or setup reset, the
  terminal shows a blocked state and sends the user back to the website portal
  for new setup/activation; that is not the routine reauth path.
- The terminal consumes the selected broker account's capability map; it does
  not invent broker permissions locally.

Auth ownership:

- Portal owns app user sessions, tenant/org membership, roles, and dashboard
  access.
- Portal creates one-time tenant/workspace launch handoff codes for eligible
  connected users.
- Platform exchanges valid handoff codes for short-lived platform sessions and
  enforces tenant and account ownership before serving account/order/stream
  endpoints.
- Platform/broker adapters own durable broker authorization state,
  provider-specific post-launch reauth callbacks, token/reference storage,
  token refresh, capability discovery, execution, and disconnect/revoke
  semantics. Portal owns the customer-facing UX for first-time connect and
  launch.

Important distinction:

- App auth: Better Auth portal session, one-time platform handoff, and
  handoff-derived platform session.
- Broker auth: broker-hosted OAuth/consent or aggregator-hosted connect portal.
- Execution permission: PYRUS account-level automation activation, caps, kill
  switches, and strategy subscription.

Launch gating:

- The website dashboard may show a read-only shadow demo before broker connect.
- `Launch platform` stays disabled until the tenant has at least one valid
  live-capable automation-grade customer broker connection, or a recoverable
  broker reauth path.
- `demo_shadow` is explicitly non-entitled and non-tradable. It cannot launch
  the terminal, route orders, or activate automation.
- Paper-only, demo-only, and shadow-only accounts do not satisfy customer v1
  launch eligibility.
- Broker account selection, caps, strategy activation, and automation pause or
  resume are platform/workspace responsibilities after launch.
- Admin/operator/internal exceptions must be explicit and audited.

Launch handoff:

- V1 should use one-time handoff code exchange, not bearer JWTs in URLs.
- Handoff codes are single-use, short-lived, redirect-bound, stored hashed at
  rest, and exchanged server-to-server.
- Handoff landing pages should use a strict `Referrer-Policy` and strip the
  code from browser-visible URLs immediately after exchange.
- After exchange, the terminal receives an httpOnly, secure, sameSite platform
  session cookie or equivalent server-held platform session. Browser
  JavaScript should not receive bearer platform tokens.

### Phase 0 Detailed Contract

Objective: the website portal is the authenticated account dashboard and launch
gate. The platform is the user's isolated PYRUS trading workspace. An ordinary
customer can open it only after the portal has verified broker connection
eligibility.

#### Launch Eligibility

The portal computes launch eligibility for the signed-in user before showing or
issuing any platform handoff. This is a portal-owned contract, but the platform
must re-check the same facts during handoff exchange because launch eligibility
can change between button render and terminal exchange.

Portal loader/API:

```text
GET /api/portal/platform/launch-eligibility
```

Launch eligibility is tenant/workspace-scoped. The portal verifies that the
signed-in tenant has at least one live-capable automation-grade customer broker
account, or a recoverable broker reauth path, but it does not bind the launch
handoff to one selected broker account. Broker account selection and routing
happen inside the launched PYRUS workspace.

Canonical launch states:

```text
demo_shadow
connect_required
connection_pending
needs_reauth
missing_scope
syncing_accounts
activation_required
automation_paused
user_suspended
connection_revoked
connection_error
connected_launchable
automation_active
```

Launchable customer states:

```text
connected_launchable
needs_reauth
activation_required
automation_paused
automation_active
```

`connected_launchable` means the tenant has at least one live-capable
automation-grade customer broker account and can enter the workspace.
`needs_reauth` is launchable only when the provider has a platform-owned
broker-hosted/OAuth reauth path.
`activation_required` and `automation_paused` are workspace states: the user can
enter PYRUS, but order and automation surfaces remain disabled until platform
execution gates pass. `automation_active` means at least one account or strategy
activation is already live-ready.

`demo_shadow` is read-only, non-entitled, non-tradable, and cannot launch the
platform. It is a website dashboard experience only.

Minimum eligibility to issue a customer platform handoff:

- Portal session is valid and not suspended.
- User has a tenant/workspace.
- Tenant has at least one owned live-capable customer broker
  connection/account that is not paper-only, demo-only, or `demo_shadow`.
- At least one broker connection is either currently automation-capable or is
  expired but recoverable through platform-owned broker-hosted/OAuth reauth.
- Revoked, disconnected, unsupported, or full-reconnect-required connections do
  not satisfy launch eligibility.
- Account sync has discovered at least one account identity and execution
  capability map, unless the only issue is recoverable reauth.
- Required broker scopes for `automation_trading_connection` are present on at
  least one account, or the tenant is blocked with a clear `missing_scope`
  reason.

Eligibility response shape:

```json
{
  "subject": "user_123",
  "tenantId": "tenant_123",
  "workspaceId": "workspace_123",
  "launchState": "activation_required",
  "canLaunch": true,
  "canIssueHandoff": true,
  "isDemoShadow": false,
  "requiresPortalAction": false,
  "requiresBrokerHostedAction": false,
  "blockReasons": [],
  "workspaceActions": [
    {
      "code": "ACTIVATION_REQUIRED",
      "message": "Configure caps and activate automation inside PYRUS.",
      "severity": "action_required"
    }
  ],
  "requiredScopes": [
    "read_account",
    "read_positions",
    "read_orders",
    "read_executions",
    "trade_submit",
    "trade_manage"
  ],
  "missingScopes": [],
  "connectionSummary": {
    "automationCapableAccountCount": 1,
    "recoverableReauthAccountCount": 0,
    "missingScopeAccountCount": 0,
    "requiresAccountSelectionInPlatform": true,
    "assetClasses": ["stocks", "single_leg_options"]
  },
  "checkedAt": "2026-06-08T12:00:00Z",
  "expiresAt": "2026-06-08T12:01:00Z"
}
```

Field rules:

- `canLaunch` controls the portal button state. `canIssueHandoff` controls the
  server-side handoff issuance path. In customer v1 they should match; separate
  fields prevent UI mistakes from becoming authz decisions.
- Every non-launchable response must include at least one `blockReasons` item.
- Launchable responses may include `workspaceActions` for platform-owned setup
  work such as caps, strategy activation, paused automation, or recoverable
  broker reauth.
- `blockReasons[].code` is the durable machine contract. `message`, `label`, and
  `href` are user-facing and may be rewritten without changing behavior.
- `workspaceActions[].code` is advisory for the portal dashboard and should not
  be treated as an authorization decision.
- `expiresAt` should be short, default 30-60 seconds, because eligibility is a
  preflight and not an authorization grant.
- The handoff issuance endpoint must recompute eligibility; it must not trust a
  previously returned eligibility payload.
- The platform handoff exchange must recompute or back-channel validate
  eligibility; it must fail closed if portal state changed after issue.

Blocking reason codes:

| Code | Launch state | Portal behavior |
| --- | --- | --- |
| `PORTAL_SESSION_REQUIRED` | `connect_required` | Send the user to portal login. |
| `USER_SUSPENDED` | `user_suspended` | Disable launch and show account support/recovery path. |
| `TENANT_REQUIRED` | `connection_error` | Disable launch; account setup is incomplete. |
| `DEMO_SHADOW_ONLY` | `demo_shadow` | Show read-only shadow/demo dashboard; offer broker connect. |
| `PRODUCT_ENTITLEMENT_REQUIRED` | `connect_required` | Disable launch until subscription/entitlement is active. |
| `BROKER_CONNECT_REQUIRED` | `connect_required` | Show `Connect Broker` primary action. |
| `BROKER_CONNECTION_PENDING` | `connection_pending` | Keep launch disabled while authorization callback/account sync completes. |
| `BROKER_ACCOUNT_SYNC_REQUIRED` | `syncing_accounts` | Keep launch disabled while account identity is syncing. |
| `BROKER_CAPABILITY_SYNC_REQUIRED` | `syncing_accounts` | Keep launch disabled while execution capabilities are syncing. |
| `BROKER_REAUTH_REQUIRED` | `needs_reauth` | Launch allowed only when platform-owned hosted reauth is available; otherwise use `BROKER_FULL_RECONNECT_REQUIRED`. |
| `BROKER_FULL_RECONNECT_REQUIRED` | `connection_revoked` | Disable launch; send to portal reconnect/setup reset. |
| `BROKER_CONNECTION_REVOKED` | `connection_revoked` | Disable launch; send to reconnect/setup reset flow. |
| `BROKER_CONNECTION_DISCONNECTED` | `connection_revoked` | Disable launch; send to reconnect/setup reset flow. |
| `BROKER_SCOPE_MISSING` | `missing_scope` | Show required scopes and start reauthorization. |
| `BROKER_CAPABILITY_UNSUPPORTED` | `missing_scope` | Explain unsupported provider/account capability and fail closed. |
| `ACTIVATION_REQUIRED` | `activation_required` | Launch allowed; configure automation inside PYRUS. |
| `AUTOMATION_PAUSED` | `automation_paused` | Launch allowed; resume or inspect automation inside PYRUS. |
| `PLATFORM_MAINTENANCE` | `connection_error` | Disable launch with a temporary maintenance message. |
| `UNKNOWN_ELIGIBILITY_ERROR` | `connection_error` | Disable launch and audit the failed eligibility computation. |

Portal UI behavior:

- Dashboard may show `demo_shadow` read-only content before broker connect, but
  `Launch platform` remains disabled.
- `Connect Broker` is the primary action for `connect_required` and
  `demo_shadow`.
- `needs_reauth` still enables `Launch platform` when the platform can initiate
  broker-hosted/OAuth reauth. If the provider requires a full setup reset, the
  portal uses `BROKER_FULL_RECONNECT_REQUIRED` and keeps launch disabled.
- `missing_scope` shows the missing required scopes in plain language and starts
  reauthorization. It must not silently downgrade the user into read-only or
  manual-only trading.
- `activation_required` enables `Launch platform`; PYRUS routes the user to
  automation configuration and risk-cap setup after launch.
- `connected_launchable` enables `Launch platform`; the handoff issue endpoint
  still recomputes eligibility.
- `automation_paused` enables `Launch platform`; PYRUS shows paused automation
  state and resume controls after launch.
- `automation_active` enables `Launch platform` and may also surface live
  automation status and deep links in the portal dashboard. Direct portal
  activate/pause/resume controls require a separate execution-control contract;
  customer v1 keeps those trading controls inside the platform workspace.
- No admin/support override can bypass broker ownership, tenant ownership,
  token revocation, missing execution scopes, or user suspension for customer
  trading. Internal diagnostic access, if added later, must use a separate
  non-trading support impersonation contract.

Execution eligibility remains separately enforced by the platform:

- Terminal launch does not imply every order surface is enabled.
- Terminal order entry requires activated execution permission and per-order
  live confirmation.
- Strategy automation requires account caps, strategy caps, kill switches, and
  `automation_active`.
- Platform must re-check execution eligibility before every order mutation.

Launch eligibility contract tests:

- `demo_shadow` returns `canLaunch: false`, `DEMO_SHADOW_ONLY`, and no handoff
  can be issued.
- Tenant with at least one account with all minimum scopes, synced capabilities,
  and active entitlement returns `connected_launchable`, `activation_required`,
  `automation_paused`, or `automation_active` and can issue a handoff.
- Recoverable expired broker authorization returns `needs_reauth`,
  `BROKER_REAUTH_REQUIRED`, and can issue a handoff for platform-owned reauth.
- Full-reconnect-required authorization returns `connection_revoked`,
  `BROKER_FULL_RECONNECT_REQUIRED`, and cannot issue a handoff.
- Revoked/disconnected broker connection returns `connection_revoked` and cannot
  issue a handoff.
- Missing `trade_submit` or `trade_manage` returns `missing_scope`,
  `BROKER_SCOPE_MISSING`, and cannot launch.
- Suspended user returns `user_suspended`, `USER_SUSPENDED`, and cannot launch.
- Handoff response is tenant/workspace-scoped and does not include or require a
  selected broker account id.
- Handoff issue rejects a request when eligibility changed from launchable to a
  blocking state after the portal rendered the button.

#### Handoff Code Contract

Portal endpoint:

```text
POST /api/portal/platform/handoff
```

Request:

```json
{
  "returnTo": "/terminal"
}
```

Response:

```json
{
  "terminalUrl": "https://platform.pyrus.com/terminal?code=...",
  "expiresAt": "2026-06-08T02:00:00Z",
  "handoffId": "handoff_123",
  "workspaceId": "workspace_123"
}
```

Portal storage:

```text
platform_handoffs
  id
  code_hash
  subject
  tenant_id
  workspace_id
  eligibility_snapshot_hash
  eligible_account_count
  recoverable_reauth_account_count
  redirect_origin
  return_to
  expires_at
  consumed_at
  consumed_status
  denied_reason
  failed_attempt_count
  last_failed_at
  request_ip_hash
  request_user_agent_hash
  consumed_by_platform_session_id
  created_at
```

Rules:

- Code is high entropy and never stored raw.
- TTL should be short, default 60-120 seconds.
- Code is single-use and consumed atomically.
- Code is bound to an allowlisted platform origin and normalized return path.
  The return path should be a platform-relative path without arbitrary external
  origin or unvalidated query parameters.
- Handoff issue re-checks launch eligibility.
- Handoff exchange re-checks launch eligibility.
- Replay, expired, wrong-origin, wrong-tenant, and ineligible-user attempts
  fail closed and are audited.
- Handoff is tenant/workspace-scoped. It proves launch eligibility for the
  workspace; it does not select or authorize one broker account for trading.
- The platform must never read the portal handoff table directly, even if both
  services share infrastructure. The portal-owned exchange endpoint is the only
  authority for handoff validation and atomic consumption.

#### Handoff Exchange Contract

Platform exchange endpoint:

```text
POST /api/platform/session/exchange
```

Portal server-to-server validation endpoint:

```text
POST /api/portal/platform/handoff/exchange
```

Server-to-server authentication:

- The portal exchange endpoint accepts only authenticated platform service
  calls. Use mTLS, signed service requests, or a private service credential
  stored outside browser/client code.
- The authenticated service identity must match an allowlisted platform
  environment and the expected platform origin for the handoff.
- `exchangeNonce` is non-secret replay metadata. It is not a substitute for
  service authentication.
- Missing, invalid, disabled, or wrong-environment service identity fails
  closed before code consumption and emits a redacted audit event.

Exchange flow:

1. Browser navigates to the issued platform URL containing the one-time code.
2. The platform server handles the launch request before rendering the client
   app.
3. The platform server posts the raw code, expected platform origin, normalized
   return path, and request correlation metadata to the portal exchange endpoint.
4. Portal validates the code hash, expiry, origin, return path, tenant/workspace
   eligibility, replay status, and launch eligibility.
5. Portal atomically consumes a valid code and returns launch claims to the
   platform server.
6. Platform creates its own short-lived httpOnly session from those claims.
7. Platform returns a clean redirect or response to the normalized return path
   with the code stripped from browser-visible URLs.
8. Browser JavaScript never receives a bearer platform token and should not need
   to read or exchange the handoff code.

Portal exchange request:

```json
{
  "code": "raw-one-time-code",
  "expectedOrigin": "https://platform.pyrus.com",
  "returnTo": "/terminal",
  "exchangeNonce": "platform_exchange_123",
  "requestIpHash": "ip_hash",
  "requestUserAgentHash": "ua_hash",
  "correlationId": "corr_123"
}
```

Portal exchange success response:

```json
{
  "handoffId": "handoff_123",
  "subject": "user_123",
  "tenantId": "tenant_123",
  "workspaceId": "workspace_123",
  "roles": ["trader"],
  "portalSessionIdHash": "portal_session_hash",
  "returnTo": "/terminal",
  "expiresAt": "2026-06-08T02:00:00Z",
  "eligibilitySnapshotHash": "eligibility_hash"
}
```

Portal exchange failure response:

```json
{
  "error": {
    "code": "HANDOFF_EXPIRED",
    "message": "This launch link expired. Return to the portal and launch again.",
    "returnToPortal": "/app"
  },
  "correlationId": "corr_123"
}
```

Failure codes:

```text
HANDOFF_MISSING
HANDOFF_MALFORMED
HANDOFF_SERVICE_UNAUTHORIZED
HANDOFF_EXPIRED
HANDOFF_REPLAYED
HANDOFF_ORIGIN_MISMATCH
HANDOFF_RETURN_PATH_MISMATCH
HANDOFF_TENANT_MISMATCH
HANDOFF_USER_SUSPENDED
HANDOFF_LAUNCH_INELIGIBLE
HANDOFF_PORTAL_UNAVAILABLE
HANDOFF_EXCHANGE_CONFLICT
```

Failure UX:

- The platform shows a blocked launch screen for exchange failures. It does not
  automatically redirect back to the portal.
- The blocked screen shows a single return-to-portal action and a support-safe
  correlation id.
- The blocked screen must not show the raw handoff code, token material, broker
  account numbers, or portal internals.
- Expired, replayed, malformed, origin-mismatch, and ineligible exchanges are
  audited by the portal and platform.
- The platform must not retry a failed exchange with the same code except for a
  bounded network retry before the portal records an atomic consume outcome.
- Portal exchange is rate-limited by service identity, source network, code hash
  or handoff id when known, and tenant/user when known. Repeated malformed,
  replayed, or unauthorized exchange attempts increment failure counters and
  can move the handoff into a denied terminal state.

#### Platform Session Contract

Platform session is created only after a successful portal-owned handoff
exchange. It authenticates the launched workspace, not a selected broker
account or a blanket trading permission.

Platform session storage:

```text
platform_sessions
  id
  session_token_hash
  subject
  tenant_id
  workspace_id
  roles
  portal_session_id_hash
  handoff_id
  issued_at
  expires_at
  absolute_expires_at
  last_seen_at
  revoked_at
  revoke_reason
  request_ip_hash
  request_user_agent_hash
  created_at
  updated_at
```

Platform session cookie:

```text
Name: __Host-pyrus_platform_session
httpOnly: true
secure: true
sameSite: Lax
path: /
domain: unset
maxAge: 30-60 minutes
```

Cookie rules:

- httpOnly, secure, sameSite cookie, scoped to the platform origin.
- Use the `__Host-` prefix when deployment shape allows it: secure, path `/`,
  no domain attribute.
- Do not store session tokens in `localStorage`, `sessionStorage`, query
  strings, fragment identifiers, or browser-readable JavaScript state.
- Default idle TTL is 30-60 minutes.
- Absolute max lifetime should be short enough to bound missed revocation; v1
  default 8-12 hours unless compliance or broker rules require less.
- Session token is high entropy and stored only as a hash server-side.
- Session refresh, if added, must rotate server-side token state and re-check
  portal/broker eligibility before extending.

Session authority:

- Session record includes `subject`, `tenant_id`, `workspace_id`, `roles`,
  `portal_session_id_hash`, `handoff_id`, `expires_at`,
  `absolute_expires_at`, and `revoked_at`.
- The platform session proves authenticated workspace entry only.
- It does not prove broker account authority, order permission, automation
  activation, current broker authorization, or capability support.
- All account/order/stream endpoints resolve account authorization from the
  platform session and platform-side entitlement/account state.
- Request path account ids are treated as input to authorize, not as authority.
- Mutations require CSRF protection or an equivalent same-site mutation guard.

Current session endpoint:

```text
GET /api/platform/session
```

Sanitized response:

```json
{
  "subject": "user_123",
  "tenantId": "tenant_123",
  "workspaceId": "workspace_123",
  "roles": ["trader"],
  "sessionState": "active",
  "issuedAt": "2026-06-08T12:00:00Z",
  "expiresAt": "2026-06-08T12:45:00Z",
  "absoluteExpiresAt": "2026-06-08T20:00:00Z"
}
```

The current-session response must not include broker tokens, raw session tokens,
raw cookies, handoff codes, broker account numbers, or authorization headers.

Session logout/revoke endpoint:

```text
DELETE /api/platform/session
```

`DELETE /api/platform/session` revokes the current platform session and clears
the session cookie. It is idempotent and does not revoke broker authorization or
disconnect broker accounts.

Revocation and expiry:

- Missing, malformed, expired, or revoked sessions fail closed with `401`.
- Authenticated session without tenant/workspace/account authority fails with
  `403`.
- Platform sessions are revoked when portal logout, user suspension, tenant
  removal, broker disconnect, broker revoke, or platform admin session revoke
  events are propagated; if propagation fails, short TTL limits exposure.
- Every sensitive request should check server-side `revoked_at`, `expires_at`,
  `absolute_expires_at`, tenant status, workspace status, user suspension, and
  broker/account state relevant to the route.
- Broker disconnect/revoke should block account/order/stream access for that
  broker account immediately even if the platform session itself remains valid
  for non-trading workspace access.
- Session revocation is idempotent and auditable.

Route authorization matrix:

| Route family | Required checks |
| --- | --- |
| Workspace shell/read-only app state | Valid session, active tenant, active workspace, non-suspended user. |
| Broker account list | Valid session plus tenant/workspace-owned broker connection state. |
| Broker account detail | Valid session plus account belongs to tenant/workspace and is visible to subject. |
| Account positions/orders/executions | Account belongs to tenant/workspace, connection not revoked/disconnected, required read scope present, freshness policy satisfied. |
| Order preview | Account belongs to tenant/workspace, live-capable account, required read scopes, account capability supports requested asset/order shape, execution permission configured where required. |
| Order submit/replace/cancel | All preview checks plus activated execution permission, per-order confirmation for terminal orders, CSRF/same-site mutation guard, idempotency key, and no kill switch or pause block. |
| Automation configure/activate/pause | Account belongs to tenant/workspace, required scopes/capabilities present, user role can manage automation, and audit event emitted. |
| Streams/SSE/WebSocket | Valid session at connect, tenant/workspace scope on every subscription, periodic revocation checks, and forced close on session/account revoke. |

Mutation protection:

- Browser form/API mutations must include CSRF or equivalent same-site mutation
  protection in addition to SameSite cookies.
- Cross-origin credentialed requests are denied unless explicitly allowlisted
  for a trusted platform origin.
- CORS must not allow arbitrary origins with credentials.
- Order mutations require idempotency keys independent of CSRF.
- CSRF failure returns `403` and emits a redacted security audit event.

Platform session errors:

```text
PLATFORM_SESSION_MISSING
PLATFORM_SESSION_MALFORMED
PLATFORM_SESSION_EXPIRED
PLATFORM_SESSION_ABSOLUTE_EXPIRED
PLATFORM_SESSION_REVOKED
PLATFORM_SESSION_TENANT_INACTIVE
PLATFORM_SESSION_WORKSPACE_INACTIVE
PLATFORM_SESSION_USER_SUSPENDED
PLATFORM_SESSION_ACCOUNT_FORBIDDEN
PLATFORM_SESSION_ACCOUNT_REVOKED
PLATFORM_SESSION_CAPABILITY_MISSING
PLATFORM_SESSION_ROLE_FORBIDDEN
PLATFORM_SESSION_CSRF_FAILED
```

Observability and redaction:

- Audit `platform_session_created`, `platform_session_refreshed`,
  `platform_session_revoked`, `platform_session_expired`,
  `platform_session_csrf_failed`, and `platform_session_authz_denied`.
- Logs may include session id hashes, tenant id, workspace id, route family,
  error code, and correlation id.
- Logs must not include raw session tokens, raw handoff codes, broker tokens,
  authorization headers, account numbers, or full cookies.

Contract tests:

- Missing, malformed, expired, revoked, and absolute-expired sessions fail.
- Cross-tenant and cross-workspace account access fails.
- Path parameter account id does not grant account authority.
- Broker revoke blocks account/order routes even when the workspace session is
  otherwise valid.
- Terminal order mutation without CSRF/same-site mutation proof fails.
- Terminal order mutation without activated execution permission fails.
- Stream subscriptions are scoped and close after session/account revocation.
- Logs and error responses do not expose raw tokens, raw cookies, raw handoff
  codes, or broker account numbers.

Legacy summary:

- Platform session is httpOnly, secure, sameSite, short-lived, and revocable.
- Account/order routes authorize against server-side session, tenant/workspace
  ownership, account state, broker connection state, and execution permission.
- Path parameters never grant account authority by themselves.
- Order mutations include CSRF or equivalent same-site mutation protection.

#### Broker Connect And Reauth Ownership

- First-time broker connect happens on the website portal. Account selection,
  caps, strategy activation, and automation pause/resume happen inside the
  launched platform workspace.
- Platform cannot be launched by ordinary users before broker connect.
- If a broker OAuth callback terminates on the portal, the portal forwards raw
  returned token material to the platform over a server-to-server channel and
  discards it after the platform acknowledges durable encrypted storage.
- Terminal can show broker state, `needs_reauth`, `missing_scope`,
  `capability_missing`, `paused`, and `revoked` states.
- Routine broker reauth is owned by the platform after launch. The terminal
  initiates broker-hosted/OAuth reauth when the adapter supports a clean
  hosted flow.
- If the provider cannot reauth cleanly from the platform, the terminal marks
  the account unavailable and sends the user to the website portal only for a
  full reconnect or setup reset.
- No PYRUS surface may collect broker usernames, passwords, API keys, or API
  secrets for customer-facing v1 without a separate approved exception.

Reauth state vocabulary:

```text
connected
needs_reauth
reauth_starting
reauth_pending_user
reauth_callback_pending
reauth_syncing
reauth_succeeded
reauth_failed
full_reconnect_required
revoked
disconnected
unsupported
```

State meanings:

- `needs_reauth`: broker authorization is expired or stale, but the adapter
  reports a platform-owned broker-hosted/OAuth reauth path.
- `reauth_starting`: platform is creating a reauth attempt and broker-hosted
  URL.
- `reauth_pending_user`: user has been sent to broker-hosted/OAuth consent and
  no callback/outcome is recorded yet.
- `reauth_callback_pending`: platform received a callback and is validating
  state/PKCE/provider identity.
- `reauth_syncing`: token/reference update succeeded and platform is refreshing
  account identity, scopes, capabilities, positions, orders, and executions.
- `reauth_succeeded`: broker connection is usable after sync and required
  scopes/capabilities are present.
- `reauth_failed`: reauth attempt failed but the provider may allow another
  platform-owned retry.
- `full_reconnect_required`: provider path cannot be repaired from the platform;
  portal reconnect/setup reset is required.
- `revoked`/`disconnected`/`unsupported`: hard blocks for order and automation
  routes.

Reauth attempt storage:

```text
broker_reauth_attempts
  id
  subject
  tenant_id
  workspace_id
  connection_id
  provider
  adapter_kind
  state_hash
  pkce_verifier_ref
  expected_redirect_origin
  return_to
  status
  failure_code
  failure_reason
  started_at
  expires_at
  callback_received_at
  completed_at
  request_ip_hash
  request_user_agent_hash
  correlation_id
  created_at
  updated_at
```

`pkce_verifier_ref` points to encrypted or secret-managed verifier material when
PKCE is required. Raw OAuth codes, access tokens, refresh tokens, broker
account numbers, API keys, and usernames/passwords are never logged or returned
to the browser.

Platform-owned reauth endpoints:

```text
POST /api/platform/broker-connections/:connectionId/reauth/start
GET /api/platform/broker-connections/:connectionId/reauth/:attemptId
GET /api/platform/broker-connections/:connectionId/reauth/callback
POST /api/platform/broker-connections/:connectionId/reauth/callback
POST /api/platform/broker-connections/:connectionId/reauth/:attemptId/cancel
```

Start request:

```json
{
  "returnTo": "/terminal/settings/broker",
  "reason": "expired_authorization"
}
```

Start success response:

```json
{
  "attemptId": "reauth_123",
  "status": "reauth_pending_user",
  "hostedAuthUrl": "https://broker.example.com/oauth/authorize?...",
  "expiresAt": "2026-06-08T12:05:00Z"
}
```

Full-reconnect-required response:

```json
{
  "attemptId": null,
  "status": "full_reconnect_required",
  "error": {
    "code": "BROKER_REAUTH_FULL_RECONNECT_REQUIRED",
    "message": "Reconnect this broker from the PYRUS portal.",
    "portalHref": "/app/connect?connectionId=conn_123"
  }
}
```

Reauth start rules:

- Caller must have a valid platform session for the tenant/workspace.
- Connection must belong to the session tenant/workspace.
- Browser-initiated `start` and `cancel` mutations require CSRF or equivalent
  same-site mutation proof in addition to the platform session.
- Adapter must report `platform_hosted_reauth` support.
- Platform creates a single active reauth attempt per connection unless a prior
  attempt is expired, completed, canceled, or failed.
- Reauth attempt is short-lived, default 5-10 minutes.
- Reauth start emits an audit event before redirecting the user to the broker.
- If adapter reports full reconnect/setup reset only, platform returns
  `full_reconnect_required` and does not create a hosted reauth URL.

Callback rules:

- Broker reauth callback endpoints are external input boundaries. Validate the
  query/body schema, method, content type, provider, and callback shape before
  reading provider fields.
- Callbacks must not rely on the browser platform session as the sole authority.
  Broker redirects or provider backchannels are authorized by the active
  reauth attempt, state/PKCE, provider identity, expiry, and tenant/workspace/
  connection binding.
- Callback validates state hash, PKCE where applicable, provider identity,
  redirect origin, attempt expiry, tenant/workspace/connection ownership, and
  replay status.
- Callback path `connectionId` is only routing input. The active attempt state
  must bind the tenant, workspace, connection, provider, redirect origin, and
  return path before token/reference exchange.
- Callback exchanges OAuth code/token reference server-side only.
- Returned token/reference material is stored behind the platform/broker-adapter
  boundary, encrypted at rest when custody is required.
- Callback response never returns broker token material to the browser.
- Callback failure leaves the connection in `needs_reauth` or
  `full_reconnect_required`, depending on adapter classification and provider
  error.

Post-reauth safety gates:

- Successful token/reference update moves the connection to `reauth_syncing`,
  not directly to live order readiness.
- Platform refreshes account identity, required scopes, capability map,
  positions, orders, executions, and account freshness before re-enabling order
  or automation routes.
- Terminal order entry remains disabled until account state is fresh enough for
  the route's freshness policy.
- Strategy automation remains paused until required sync/reconciliation passes.
  Reauth must not blindly resume automation that was paused by unknown state,
  disconnect, revoke, or failed reconciliation.
- If scopes/capabilities changed after reauth, strategy/account activation is
  revalidated and may remain blocked with `missing_scope` or
  `capability_missing`.

Portal handoff for setup reset:

- Portal deep-links are used only for `full_reconnect_required`, first-time
  setup, user-requested disconnect/reconnect, or provider paths that cannot be
  repaired from platform-owned hosted reauth.
- Ordinary `needs_reauth` should not send the user back to the website portal.
- Portal reconnect/setup reset creates or replaces broker connection references
  and then launch eligibility is recomputed through Task 0A.

Credential capture guard:

- No customer-facing PYRUS surface may render broker username/password, API key,
  API secret, refresh token, or OAuth-code entry fields for customer v1.
- Any attempted credential-capture route, form, or adapter mode must fail closed
  with `BROKER_REAUTH_CREDENTIAL_CAPTURE_BLOCKED` and emit a redacted audit
  event.
- IBKR Gateway remains a special connector path and does not define the default
  SaaS broker reauth pattern.

Reauth failure codes:

```text
BROKER_REAUTH_NOT_SUPPORTED
BROKER_REAUTH_FULL_RECONNECT_REQUIRED
BROKER_REAUTH_STATE_MISMATCH
BROKER_REAUTH_PKCE_FAILED
BROKER_REAUTH_ATTEMPT_EXPIRED
BROKER_REAUTH_ATTEMPT_REPLAYED
BROKER_REAUTH_PROVIDER_DENIED
BROKER_REAUTH_PROVIDER_ERROR
BROKER_REAUTH_SCOPE_MISSING
BROKER_REAUTH_CAPABILITY_MISSING
BROKER_REAUTH_TOKEN_STORE_FAILED
BROKER_REAUTH_SYNC_FAILED
BROKER_REAUTH_CREDENTIAL_CAPTURE_BLOCKED
```

Reauth contract tests:

- `needs_reauth` with adapter support starts hosted reauth and returns a broker
  URL without exposing token material.
- Unsupported adapter returns `BROKER_REAUTH_FULL_RECONNECT_REQUIRED` and a
  portal reconnect link.
- Callback with wrong state, expired attempt, replayed attempt, wrong tenant, or
  wrong connection fails closed.
- Successful callback stores token/reference material server-side, then enters
  `reauth_syncing`.
- Order and automation routes stay blocked until post-reauth sync and
  reconciliation gates pass.
- Reauth does not automatically resume automation paused by unknown state,
  disconnect, revoke, or failed reconciliation.
- Credential-capture UI/API attempts fail closed and are audited.

#### Audit Events

Audit is the immutable, append-only system of record for security, broker,
automation, order, and reconciliation decisions. Ordinary application logs are
diagnostic hints; audit events are the durable truth used to reconstruct who did
what, when, from which tenant/workspace/account, through which portal/platform/
broker path, and why an action was allowed or blocked.

Audit storage:

```text
audit_events
  id
  sequence
  event_type
  event_version
  occurred_at
  recorded_at
  actor_subject
  actor_type
  tenant_id
  workspace_id
  broker_connection_id
  broker_account_id_hash
  order_intent_id
  strategy_id
  source_app
  route_family
  outcome
  decision_code
  correlation_id
  causation_id
  request_ip_hash
  request_user_agent_hash
  metadata_redacted
  customer_visible
  customer_activity_type
  customer_message_key
  previous_event_hash
  event_hash
```

Storage rules:

- Audit events are append-only. Corrections are new events that reference the
  original event through `causation_id`; events are not edited or deleted during
  normal operation.
- `sequence` must be monotonic within the audit store or partition.
- `event_hash` and `previous_event_hash` should make tampering detectable within
  an event stream or partition.
- Each event includes `event_version` so payloads can evolve without changing
  historical meaning.
- Audit writes must be best-effort durable before high-risk provider actions,
  especially order submit/replace/cancel and automation activation. If the audit
  write cannot be confirmed for a high-risk mutation, the mutation fails closed.
- Audit retention and export policy is a compliance decision, but v1 should keep
  audit events long enough to reconstruct all live-trading incidents.

Event envelope:

```json
{
  "eventType": "order_attempt_submitted",
  "eventVersion": 1,
  "occurredAt": "2026-06-08T12:00:00Z",
  "actor": {
    "subject": "user_123",
    "type": "user"
  },
  "scope": {
    "tenantId": "tenant_123",
    "workspaceId": "workspace_123",
    "brokerConnectionId": "conn_123",
    "brokerAccountIdHash": "acct_hash"
  },
  "source": {
    "app": "platform",
    "routeFamily": "orders",
    "correlationId": "corr_123",
    "causationId": "order_intent_123"
  },
  "decision": {
    "outcome": "allowed",
    "code": "ORDER_SUBMIT_ALLOWED",
    "scopeResult": "passed",
    "capabilityResult": "passed",
    "riskResult": "passed",
    "freshnessResult": "passed"
  },
  "metadata": {
    "orderIntentId": "order_intent_123",
    "idempotencyKeyHash": "idem_hash",
    "assetClass": "single_leg_options",
    "normalizedOrderShape": "limit_buy_to_open",
    "adapter": "alpaca",
    "providerRequestIdHash": "provider_req_hash"
  },
  "customerVisible": true,
  "customerActivityType": "order_submitted",
  "customerMessageKey": "activity.order.submitted"
}
```

Decision context rules:

- Audit events store normalized decision context, not raw sensitive payloads.
- Allow/block decisions should record enough context to reconstruct which gates
  passed or failed: tenant/workspace scope, route family, account ownership,
  required scopes, capability map result, freshness result, risk/cap result,
  idempotency key hash, strategy/order identifiers, and provider/adapter result
  codes.
- Order events include `OrderIntent` id, `OrderAttempt` id where applicable,
  normalized order shape, asset class, source (`terminal` or `automation`),
  idempotency key hash, capability decision, risk decision, and provider result
  code. They do not include raw broker request/response bodies.
- Reauth events include attempt id, provider, adapter kind, state/PKCE outcome,
  result state, and failure code. They do not include raw OAuth codes, token
  material, PKCE verifier, or broker credentials.
- Handoff/session events include handoff id, platform session id hash, origin/
  return-path decision, failure code, and revocation reason. They do not include
  raw handoff codes, raw session tokens, or full cookies.

Required audit events:

```text
portal_login_succeeded
portal_login_failed
portal_launch_allowed
portal_launch_denied
portal_handoff_issued
portal_handoff_issue_failed
platform_handoff_exchanged
platform_handoff_expired
platform_handoff_replayed
platform_handoff_exchange_failed
platform_session_created
platform_session_refreshed
platform_session_expired
platform_session_revoked
platform_session_authz_denied
platform_session_csrf_failed
broker_connect_started
broker_connect_completed
broker_connect_failed
broker_reauth_started
broker_reauth_completed
broker_reauth_failed
broker_reauth_full_reconnect_required
broker_reauth_credential_capture_blocked
broker_disconnect_requested
broker_disconnect_completed
broker_disconnect_failed
broker_connection_revoked
broker_capability_sync_started
broker_capability_sync_completed
broker_capability_sync_failed
automation_configured
automation_activation_blocked
automation_activated
automation_paused
automation_resumed
automation_kill_switch_triggered
order_intent_created
order_intent_blocked
order_attempt_submitted
order_attempt_rejected
order_attempt_unknown
order_reconciled
reconciliation_started
reconciliation_completed
reconciliation_failed
```

Redaction classes:

| Class | Examples | Audit handling |
| --- | --- | --- |
| Raw secret | tokens, OAuth codes, PKCE verifier, API keys, cookies | Never stored. |
| Sensitive broker identifier | full account number, provider customer id | Hash or last-4 only. |
| Security metadata | IP, user agent, session id, idempotency key | Hash or normalize. |
| Trading decision context | order id, strategy id, gate outcomes | Store normalized values. |
| Customer-safe label | broker display name, message key, timestamp | May appear in activity. |

Never audit raw handoff codes, raw session tokens, full cookies, OAuth codes,
PKCE verifiers, access tokens, refresh tokens, broker API keys/secrets, broker
passwords, full authorization headers, full broker account numbers, raw broker
request/response bodies, or unredacted provider webhooks/callback payloads.

Customer activity projection:

- Customers may see a sanitized activity history in the portal or platform.
- Customer-visible rows are projections from immutable audit events, not mutable
  audit events themselves.
- Customer activity can show high-level events such as broker connected, launch
  denied, reauth required, automation activated/paused, order submitted,
  order rejected, order reconciled, session revoked, and disconnect completed.
- Customer activity must not show IP hashes, user-agent hashes, raw denial
  metadata, internal adapter stack details, token lifecycle internals, raw
  provider request ids, full broker identifiers, or support-only forensic notes.
- If an internal audit event is not safe to expose directly, create a
  customer-safe message key and sanitized metadata projection.

Customer activity endpoints:

```text
GET /api/portal/activity
GET /api/platform/activity
```

Customer activity access rules:

- Activity reads are scoped to the authenticated subject's tenant/workspace;
  arbitrary tenant, workspace, actor, connection, account, or order filters are
  authorization inputs, not authority.
- Portal activity uses the portal session and portal tenant membership.
  Platform activity uses the platform session and platform workspace scope.
- Activity endpoints return customer-safe projections only and never expose raw
  audit metadata, internal failure stacks, request fingerprints, token lifecycle
  internals, or provider payload identifiers.
- Activity endpoints are cursor-paginated and bounded by a maximum page size so
  audit projection cannot become an unbounded export path.
- Internal/compliance audit export is a separate role-gated surface, not these
  customer activity endpoints.

Customer activity response:

```json
{
  "items": [
    {
      "id": "activity_123",
      "occurredAt": "2026-06-08T12:00:00Z",
      "type": "order_submitted",
      "messageKey": "activity.order.submitted",
      "severity": "info",
      "scope": {
        "workspaceId": "workspace_123",
        "brokerConnectionLabel": "Alpaca",
        "accountLabel": "Account ...1234"
      },
      "details": {
        "assetClass": "single_leg_options",
        "orderIntentId": "order_intent_123",
        "status": "submitted"
      }
    }
  ],
  "nextCursor": null
}
```

Audit builder and redaction rules:

- All audit events are emitted through typed builders that reject unknown event
  types and reject raw-secret fields.
- Redaction happens before the event enters storage or general logs.
- Redaction tests must include fixture strings that look like OAuth codes,
  bearer tokens, account numbers, session cookies, API keys, and broker payloads.
- Any audit builder receiving a raw-secret-looking value in metadata should fail
  closed in tests and either redact or reject at runtime according to severity.
- Application logs may include the audit `eventId`, `eventType`,
  `correlationId`, and non-sensitive decision code, but not the full metadata
  object by default.

Audit correlation:

- `correlation_id` ties together portal request, handoff issue, handoff
  exchange, platform session creation, reauth attempts, order attempts, and
  reconciliation work.
- `causation_id` links child events to the triggering domain object, such as
  handoff id, platform session id hash, reauth attempt id, order intent id, or
  reconciliation run id.
- Portal and platform must preserve incoming correlation ids across
  server-to-server calls where safe; otherwise they create a new id and record
  the parent id.

Portal plan integration note:

- Any older portal Stage 3 language about capturing broker API keys, secrets,
  usernames, or passwords should be superseded for customer-facing v1.
- Customer broker authorization should happen at the broker, official OAuth
  page, or broker-connection portal.
- If a provider cannot support broker-hosted authorization, it is not eligible
  for default customer-facing v1 without a separate security/product exception.
- IBKR Gateway remains a special connector path for operator-owned or advanced
  self-hosted setups; it should not define the normal SaaS login pattern.

## Broker Scope Model

| Scope | Required For | v1 Default | Notes |
| --- | --- | --- | --- |
| `read_account` | account list, account identity, buying power/cash where available | Required | Needed to pick the correct account and block obvious unsafe routing. |
| `read_positions` | terminal positions, sell-to-close validation, automation state | Required | Needed for options exits and duplicate/position-aware strategies. |
| `read_orders` | open orders, pending orders, cancel/replace, duplicate detection | Required | Pure submit-only integrations are not safe enough for automation. |
| `read_executions` | fills, partial fills, reconciliation, PnL attribution | Required | May be polling or streaming depending on provider. |
| `trade_preview` | buying-power checks, order validation, impact estimates | Preferred | Some providers do not support formal preview; PYRUS should degrade carefully. |
| `trade_submit` | place orders | Required for execution | Must require activated execution permission. |
| `trade_manage` | cancel and replace | Required for execution | Required for stops/exits and error recovery. |
| `market_data` | broker quotes/charts/chains/news | Disabled | PYRUS provides data internally. Allow only if a provider requires it for order validation. |

V1 instrument and order-shape contract:

```text
stocks
single_leg_options
```

Deferred from v1:

```text
multi_leg_options_spreads
combo_orders
```

Broker-native capability families:

```text
order_types
time_in_force
sessions
routes
trailing_stops
brackets
oco
oso
cancel_replace_fields
preview
order_status_streaming
```

These are not globally enabled or globally blocked by PYRUS. They are enabled
per connected broker account when that account's adapter reports support and
PYRUS can validate, audit, submit, manage, and reconcile the resulting order
intent.

Broker-native does **not** mean raw broker payload pass-through. PYRUS still
creates a normalized `OrderIntent` with enough structure to enforce account
caps, strategy caps, idempotency, audit logging, and reconciliation. The adapter
then translates that intent into the broker-native request shape for the
selected account.

Minimum safe execution connection:

```text
read_account
read_positions
read_orders
read_executions
trade_submit
trade_manage
```

Optional but strongly preferred:

```text
trade_preview
order_update_stream
```

V1 connection type:

```text
automation_trading_connection
```

Readiness states:

```text
pending_authorization
authorized
syncing_accounts
ready_for_configuration
configured
automation_active
paused
revoked
error
```

Locked decision:

> PYRUS v1 broker connections are automation-first execution connections. They
> require account, position, order, and fill read access plus order management
> access. Market-data access is excluded unless a broker requires it for order
> validation.
>
> Execution rules are broker/account-native: the selected broker account's
> capability map determines which order types, TIFs, routes, sessions,
> trailing stops, brackets, OCO/OSO, and cancel/replace fields are available.

## Core Domain Model

PYRUS should model broker execution around these objects:

- `User`: authenticated PYRUS user.
- `Tenant`: workspace/org boundary; customer v1 is one tenant/workspace per
  user. Enterprise/org accounts, multi-member tenant membership, and workspace
  switching are deferred.
- `PortalSession`: Better Auth app session owned by the portal.
- `PlatformHandoff`: one-time launch code issued by the portal and exchanged
  by the terminal.
- `PlatformSession`: short-lived platform session created after handoff
  exchange.
- `BrokerConnection`: provider-level authorization and token/capability state.
- `BrokerAccount`: a tradable account discovered through a connection.
- `TradingPermission`: automation-grade execution activation and caps for a
  broker account. Terminal orders use the same account permission but still
  require per-order live confirmation.
- `Strategy`: PYRUS strategy or signal source.
- `StrategySubscription`: links a strategy to a broker account with caps.
- `OrderIntent`: normalized order request PYRUS intends to send.
- `OrderAttempt`: one provider submission attempt for an order intent.
- `OrderEvent`: provider status timeline: accepted, filled, rejected, canceled.
- `Execution`: fills and partial fills.
- `ReconciliationRun`: background state sync proving order/account state.
- `AuditEvent`: immutable user/system action log.

## Process Flows

### 1. Portal App Login

1. User signs into the website portal through Better Auth.
2. Portal validates the server-side session and resolves `subject`, `tenantId`,
   roles, and account entitlements.
3. Portal dashboard decides whether to show read-only shadow demo,
   broker-connect gate, or connected account dashboard.
4. Portal keeps `Launch platform` disabled until the tenant has at least one
   valid automation-capable broker connection, or a recoverable broker reauth
   path.
5. Portal creates a one-time tenant/workspace handoff code when an eligible user
   launches the terminal.
6. Platform server exchanges the handoff code for a short-lived platform
   session before rendering the client app.
7. Platform resolves tenant/workspace authorization for that session.
8. Platform resolves broker account selection and account-level authorization
   inside the workspace.
9. Every broker, order, strategy, and audit query is scoped by tenant.

Exit criteria:

- No broker endpoints work without authenticated PYRUS user context.
- Every existing local/single-user route has a migration path to tenant scope.
- Terminal access requires a valid one-time handoff exchange and platform
  session.
- Non-connected users may see website `demo_shadow`, but cannot launch the
  terminal or trade from demo state.
- Broker login/authorization does not appear as a terminal top popover.

### 2. Broker Connection

1. User opens the portal broker-connect gate from `/app` or `/app/connect`.
2. User selects a broker.
3. Portal shows requested broker scopes in plain language.
4. Portal starts OAuth or an aggregator connection portal.
5. User logs in and approves at the broker/portal.
6. Broker/portal redirects back to the portal callback.
7. Portal validates state, PKCE where applicable, provider identity, and expiry.
8. Platform stores returned tokens or aggregator connection references behind
   the broker-adapter boundary, encrypted at rest where token custody is
   required.
9. Portal/platform sync accounts and capabilities.
10. PYRUS marks accounts without the minimum automation execution scopes as
   blocked until reauthorized.

Exit criteria:

- Browser never sees raw access/refresh tokens.
- Logs and crash diagnostics redact OAuth codes, tokens, account ids, and auth
  headers.
- Connection can be disconnected or revoked.

### 3. Automation Configuration And Activation

1. User chooses a connected broker account.
2. PYRUS displays supported asset classes, order types, live/paper status, and
   account-native execution capabilities.
3. User configures account-level max notional, max contracts, max daily loss,
   max daily trades, allowed asset classes, allowed order types, and kill
   switch behavior.
4. User accepts risk disclosures and activates automated execution for the
   broker account.
5. PYRUS records enablement in `TradingPermission`.

Exit criteria:

- Accounts without minimum execution scopes cannot be activated.
- Automation cannot be enabled without explicit risk caps and kill switch.
- Terminal orders and strategy automation both require activated execution
  permission; terminal orders additionally require per-order live confirmation.

### 4. Operator-Directed Terminal Order

1. User builds an order in PYRUS from internal data.
2. API validates symbol, account, side, quantity, order type, TIF, and asset
   class against the selected broker account's native capabilities.
3. API checks account/order state freshness.
4. API creates `OrderIntent`.
5. API previews where supported.
6. User confirms live order.
7. API submits through adapter with idempotency key/client order id.
8. API records provider response and starts reconciliation.

Exit criteria:

- Live order mutation requires explicit confirmation.
- Order state is durable before provider submission.
- Unknown provider response never triggers blind auto-resubmit.

### 5. Fully Automated Order

1. Signal engine creates an execution candidate from PYRUS data.
2. Strategy subscription resolves target broker account and caps.
3. API validates account permission, strategy status, allowed symbols, max
   notional, max contracts, max daily loss/trades, and order-state freshness.
4. API creates `OrderIntent` with `source=automation`.
5. API submits through adapter only if all gates pass.
6. Reconciliation worker follows order through accepted/fill/reject/cancel.
7. Any unknown state pauses that subscription until reconciled or reviewed.

Exit criteria:

- Automation has a per-account kill switch and per-strategy kill switch.
- Duplicate signal/order prevention uses idempotency, not timing assumptions.
- Unknown state fails closed.

### 6. Cancel/Replace

1. User or automation requests cancel/replace.
2. API confirms account ownership and `trade_manage` scope.
3. API verifies current order state is cancelable/replaceable.
4. API submits provider cancel/replace call.
5. Reconciliation confirms final state.

Exit criteria:

- Cancel/replace is blocked when open-order state is stale.
- Replace creates its own audit/order event chain.

### 7. Reconciliation

1. Worker polls or consumes provider streams for orders, executions, and
   positions.
2. Worker maps provider statuses to normalized statuses.
3. Worker updates order timelines and account snapshots.
4. Worker detects divergence: missing provider order, unknown status,
   unexpected fill, duplicate order, rejected exit, stale account state.
5. Worker marks subscriptions paused when divergence affects automation safety.

Exit criteria:

- Every submitted order reaches a terminal or explicitly unknown state.
- Automation pauses on unresolved divergence.
- User can see the reason and latest provider evidence.

### 8. Disconnect/Revoke

1. User disconnects broker connection.
2. PYRUS calls provider revoke where supported.
3. Tokens are destroyed or marked revoked.
4. Accounts become inactive for new trading.
5. Historical order/audit data remains for records.

Exit criteria:

- Disconnected accounts cannot place orders.
- Historical data remains tenant-scoped and auditable.

## Implementation Plan

### Phase 0: Portal Entry And Auth Boundary

#### Task 0: Align Portal Auth Gate

Description: Make the website portal the first authenticated surface and move
first-time broker connection out of terminal popovers into a dedicated
portal/dashboard gate. Keep routine broker reauth inside the launched PYRUS
workspace through broker-hosted/OAuth flows.

Acceptance criteria:

- Marketing site has a login CTA into the portal `/app` surface.
- Portal session is the app auth source of truth.
- Portal gates `Launch platform` behind at least one valid live-capable
  automation-grade customer broker connection, or a recoverable broker reauth
  path.
- Portal creates one-time handoff codes; the platform server exchanges them for
  short-lived platform sessions without exposing bearer tokens in URLs or
  browser JavaScript.
- Broker-connect starts from the portal dashboard/settings flow, not from a
  terminal top popover.
- Terminal shows broker/account status and owns broker reauth actions after
  launch, but never collects broker credentials.
- Platform/broker adapters own broker authorization state, token/reference
  storage, reauth, and execution runtime; portal owns customer-facing
  first-time broker-connect UX.

Verification:

- E2E review of marketing login -> portal dashboard -> broker-connect gate ->
  launch-platform handoff.
- Handoff tests prove one-time, expired, replayed, wrong-redirect, and
  ineligible-user codes fail closed.
- Authz tests prove platform account/order routes reject missing, expired,
  cross-tenant, or cross-account platform sessions.
- UI review confirms first-time broker setup is portal-owned and terminal
  reauth is broker-hosted/OAuth, not credential capture.

Dependencies: Portal plan and platform handoff/session contract.

Estimated scope: Medium; split across portal repo and platform repo.

##### Task 0A: Define Launch Eligibility Contract

Description: Define the launch states and blocking reasons the portal uses to
decide whether `Launch platform` is enabled.

Acceptance criteria:

- `demo_shadow` is read-only, non-entitled, non-tradable, and cannot launch
  the platform.
- Connected customer tenants expose a launchable state after at least one
  live-capable automation-grade customer broker connection exists, or when
  broker auth is expired but recoverable through platform-owned
  broker-hosted/OAuth reauth.
- Account selection, caps, strategy activation, paused automation, and terminal
  order readiness are platform/workspace states, not portal launch blockers.
- Blocking reasons are machine-readable and user-facing.

Verification:

- Contract tests for launchable, demo, needs-reauth, revoked, missing-scope,
  and suspended-user states.

Dependencies: Task 0

Estimated scope: Small

##### Task 0B: Define Handoff Code Exchange

Description: Define the one-time handoff code API, storage shape, TTL, origin
binding, atomic consumption, and failure modes.

Acceptance criteria:

- No bearer platform token appears in a URL or browser-readable storage.
- Handoff codes are stored only as hashes and are single-use.
- Platform exchange always calls the portal-owned server-to-server exchange
  endpoint; direct platform reads from the handoff table are not allowed.
- Portal exchange requires authenticated platform service identity; browser or
  unauthenticated server calls cannot consume handoff codes.
- Code is bound to the expected platform origin and normalized return path.
- Successful exchange creates a platform-owned httpOnly session and strips the
  code from browser-visible URLs.
- Exchange fails closed for expired, replayed, wrong-origin, wrong-tenant, and
  ineligible-user attempts.
- Failed exchange renders a platform-owned blocked launch screen with a
  return-to-portal action, not an automatic redirect loop.

Verification:

- API contract tests for issue, exchange, replay, expiry, and wrong-origin
  cases.
- Service-auth tests for missing, invalid, disabled, and wrong-environment
  platform service identity.
- Abuse tests for bounded retry, failed-attempt counters, and rate-limited
  malformed/replayed exchange attempts.
- Failure-path UI test for expired/replayed/invalid exchange rendering the
  blocked launch screen without exposing the raw code.

Dependencies: Task 0A

Estimated scope: Medium

##### Task 0C: Define Platform Session Contract

Description: Define the platform session created after handoff exchange and
the authorization rules for account/order/stream routes.

Acceptance criteria:

- Platform session is httpOnly, secure, sameSite, short-lived, and revocable.
- Account/order routes authorize against server-side session and account state.
- Path parameters never grant account authority by themselves.
- Order mutations include CSRF or equivalent same-site mutation protection.
- Session token is stored only as a server-side hash and is never exposed to
  browser-readable storage.
- Session represents workspace entry only; account authority, broker connection
  status, capability support, execution permission, and kill switches are
  re-checked server-side by route family.
- Broker disconnect/revoke blocks affected account/order/stream routes even if
  the workspace session remains valid for non-trading surfaces.
- `GET /api/platform/session` returns only sanitized workspace session claims.
- `DELETE /api/platform/session` revokes only the current platform session and
  clears the cookie; it does not disconnect broker authorization.
- Streams are tenant/workspace-scoped and close on session/account revoke.
- Session errors use stable machine-readable codes and never expose raw tokens,
  full cookies, handoff codes, broker tokens, or broker account numbers.

Verification:

- Authz tests for missing, expired, revoked, cross-tenant, and cross-account
  sessions.
- Mutation tests for missing/invalid CSRF or same-site proof.
- Stream tests for scoped subscription and forced close after revoke.
- Redaction tests for session logs and error responses.

Dependencies: Task 0B

Estimated scope: Medium

##### Task 0D: Define Broker Reauth Ownership Rules

Description: Define how the launched PYRUS workspace initiates broker-hosted
reauth after first-time setup, and when a failed provider path becomes a full
reconnect/setup reset in the website portal.

Acceptance criteria:

- First-time broker connect remains portal-only.
- Routine broker reauth is initiated from the terminal/workspace.
- Terminal reauth is allowed only through broker-hosted/OAuth flows supported
  by an adapter.
- Portal deep-links are used only for full reconnect/setup reset states, not
  ordinary reauth.
- Terminal never collects broker credentials or API secrets.
- Reauth outcomes update broker connection state and audit logs.
- Reauth attempts are tenant/workspace/connection scoped, expiring, replay-safe,
  and validate state/PKCE/provider identity where applicable.
- Broker callback endpoints are external input boundaries and do not rely on a
  browser platform session as the sole authority.
- Browser-initiated reauth start/cancel mutations include CSRF or equivalent
  same-site mutation proof.
- Successful callback moves the connection through `reauth_syncing`; order and
  automation routes remain blocked until post-reauth sync/reconciliation passes.
- Reauth never blindly resumes automation paused by unknown state, disconnect,
  revoke, or failed reconciliation.
- Full reconnect/setup reset is represented by a stable error code and portal
  link, not an ordinary hosted reauth URL.

Verification:

- UI and API tests for needs-reauth, hosted reauth start, failed reauth,
  full-reconnect-required, and blocked credential-capture attempts.
- Callback tests for wrong state, expired attempt, replay, wrong tenant, wrong
  connection, provider denial, missing scope, and sync failure.
- Callback tests prove path `connectionId` alone cannot select a connection and
  that callbacks without a browser session are accepted only when the active
  attempt, state/PKCE, provider, expiry, and redirect binding all pass.
- Post-reauth safety tests prove orders/automation stay blocked until account
  freshness and reconciliation gates pass.

Dependencies: Tasks 0A-0C

Estimated scope: Medium

##### Task 0E: Define Audit And Redaction Contract

Description: Define the shared audit event vocabulary and redaction rules
across portal, platform, broker adapters, and execution.

Acceptance criteria:

- Portal launch, handoff, session, broker connect, reauth, disconnect,
  activation, pause, order, and reconciliation events are named.
- Raw handoff codes, OAuth codes, broker tokens, account numbers, and
  authorization headers are never logged.
- Audit events can be correlated across portal and platform.
- Audit is immutable and append-only; corrections are new events.
- Audit events store normalized decision context sufficient to reconstruct
  allow/block outcomes without storing raw sensitive payloads.
- Customer-facing activity is a sanitized projection from audit events, not the
  raw audit stream.
- Customer activity endpoints are tenant/workspace scoped, cursor-paginated,
  and separate from internal/compliance audit export.
- Audit builders reject unknown event types and raw-secret metadata fields.

Verification:

- Unit tests for audit event builders and redaction.
- Manual review of log output from happy path and failure path fixtures.
- Redaction fixture tests for OAuth codes, bearer tokens, account numbers,
  session cookies, API keys, authorization headers, and raw broker payloads.
- Customer activity projection tests prove internal forensic metadata is not
  exposed.
- Activity authorization tests prove cross-tenant, cross-workspace, and
  arbitrary actor/account/order filters fail closed.
- Append-only tests prove corrections create new events rather than mutating
  existing records.

Dependencies: Tasks 0A-0D

Estimated scope: Small

### Phase 0 Review Outcome

Status: accepted for implementation planning after the 2026-06-08 architecture
and security review hardening pass.

Review-locked boundaries:

- Portal launch remains tenant/workspace-scoped and never selects a broker
  account for trading.
- Handoff exchange remains portal-authoritative and now requires authenticated
  service-to-service platform identity, bounded retries, rate limits, and
  failed-attempt counters.
- Platform session remains workspace-entry-only. Account, order, stream,
  automation, capability, freshness, kill-switch, and broker-state gates are
  rechecked by route family.
- Broker reauth remains platform-owned after launch when a hosted/OAuth adapter
  path exists. Callback handling is an external input boundary authorized by
  active attempt state/PKCE/provider binding rather than browser session
  presence alone.
- Audit remains immutable and append-only, stores normalized decision context,
  and feeds customer-facing activity only through sanitized projections.
- Portal automation status may deep-link into the platform, but direct customer
  trading activation/pause/resume controls are not part of v1 portal scope
  without a separate execution-control contract.

Implementation can proceed to Phase 1 planning from this contract. Any change
that weakens one of these boundaries should create a new ADR or explicit
security/product exception before code is written.

### Phase 1: Product And Permission Contract

Objective: turn the Phase 0 launch/session boundary into a precise product
contract for broker scopes, provider capability classification, and automation
execution permissions. This phase is still contract-first. It should not add
new runtime auth flows, token storage, provider integrations, or live order
behavior until the scope and permission model is stable.

Observed repo anchors for implementation planning:

- `lib/api-spec/openapi.yaml` already contains generic broker/account/order
  routes and generated clients. Existing `/orders` routes are IBKR-oriented and
  must be explicitly protected or renamed before multi-tenant customer traffic.
- API implementation likely starts in `artifacts/api-server/src/services/` and
  `artifacts/api-server/src/routes/`, with package validation through
  `pnpm --filter @workspace/api-server run typecheck`.
- Frontend consumers likely start in `artifacts/pyrus/src/features/platform/`,
  `artifacts/pyrus/src/screens/AccountScreen.jsx`, and
  `artifacts/pyrus/src/screens/AlgoScreen.jsx`, with validation through
  `pnpm --filter @workspace/pyrus run typecheck`.
- API contract changes should update `lib/api-spec/openapi.yaml`, generated
  clients, and `pnpm run audit:api-codegen` once implementation begins.

Phase 1 dependency graph:

```text
Task 1A scope vocabulary
  -> Task 1B capability map contract
    -> Task 1D decision-code registry and copy contract
      -> Task 1C readiness and order-shape evaluator
        -> Task 2 provider classification matrix
          -> Task 3A TradingPermission model
            -> Task 3B activation/pause/resume state machine
              -> Task 3C execution gate evaluator
                -> Phase 2 schema/API implementation
```

Review principles:

- Unknown provider capability fails closed.
- Read-only, manual-only, paper-only, demo, and shadow states are insufficient
  for customer v1 automation execution.
- `market_data` is not part of the required broker scope unless a provider
  requires it for order validation; PYRUS market data remains internal.
- Provider docs and provider/aggregator responses are external facts. Verify
  them from primary sources before implementation and validate returned shapes
  at the adapter boundary.
- Every allow/block decision must use the canonical Phase 1 decision-code
  registry from Task 1D and map to audit decision context from Task 0E.
- Phase 1 policy/evaluator modules are pure domain modules: no Express
  request/response objects, DB clients, provider clients, env/global reads,
  wall-clock generation, network calls, logging, persistence, or audit writes.
  Route, service, and adapter layers assemble inputs, fetch facts, inject
  time/freshness snapshots, perform side effects, and translate registry-backed
  decisions to API responses.

#### Task 1A: Define Broker Scope Vocabulary

Description: Create the canonical scope vocabulary and execution-connection
meaning for customer v1.

Scope contract:

| Scope | Internal meaning | Customer-facing copy | V1 requirement |
| --- | --- | --- | --- |
| `read_account` | Read account identity, cash/buying power where available, and account environment. | View account identity and buying power. | Required |
| `read_positions` | Read current positions for duplicate prevention, sell-to-close validation, exits, and automation state. | View positions so PYRUS can manage open risk. | Required |
| `read_orders` | Read open/pending/historical orders for duplicate detection, cancel/replace, and stale-state checks. | View orders so PYRUS does not duplicate or conflict with broker state. | Required |
| `read_executions` | Read fills and partial fills for reconciliation, PnL attribution, and order terminal state. | View executions and fills for reconciliation. | Required |
| `trade_preview` | Ask provider for buying-power/order validation when supported. | Preview orders before sending where the broker supports it. | Preferred |
| `trade_submit` | Submit live orders. | Place trades after PYRUS checks caps and confirmation gates. | Required for execution |
| `trade_manage` | Cancel and replace live orders. | Manage open orders and exits. | Required for execution |
| `order_update_stream` | Receive order/execution status by stream where supported. | Keep order status fresh. | Preferred |
| `market_data` | Broker-sourced quotes/chains/bars/news. | Use broker data for order validation only when required. | Disabled by default |

Connection type contract:

```text
automation_trading_connection
```

An `automation_trading_connection` means the account has all minimum safe
execution scopes, is live-capable, is not demo/shadow/paper-only for customer
v1, and can support at least one v1 asset/order shape after capability sync.

Acceptance criteria:

- The scope list above is the only v1 broker-scope vocabulary used by portal,
  platform, adapter, activity, audit, and UI copy.
- `automation_trading_connection` is the only v1 success-path customer
  connection type for live automation-capable execution.
- `market_data` is excluded from default required scope and can be required only
  by a provider-specific validation exception.
- Missing required scope maps to `BROKER_SCOPE_MISSING` and a specific
  user-facing missing-scope message.

Verification:

- Docs review proves every Phase 1 task references this vocabulary.
- Future implementation tests should cover scope normalization, missing-scope
  decisions, user-facing copy lookup, and audit decision codes.

Likely implementation files later:

- `artifacts/api-server/src/services/broker-scope-contract.ts`
- `artifacts/api-server/src/services/broker-scope-contract.test.ts`
- `lib/api-spec/openapi.yaml`
- Generated client packages under `lib/api-zod` and `lib/api-client-react`

Dependencies: Phase 0 Review Outcome

Estimated scope: Small

#### Task 1B: Define Broker Account Capability Map

Description: Define the account-native capability map that providers/adapters
must produce before any activation, terminal order ticket, or automation gate
can allow execution.

Capability map shape:

```text
BrokerAccountCapabilityMap
  provider
  adapter_kind
  connection_id
  broker_account_id_hash
  account_environment
  connection_type
  scope_status
  asset_classes
  order_types
  time_in_force
  sessions
  routes
  trailing_stops
  brackets
  oco
  oso
  cancel_replace_fields
  preview
  order_status_streaming
  position_freshness_policy
  order_freshness_policy
  execution_freshness_policy
  known_limitations
  last_synced_at
  expires_at
```

Allowed v1 asset classes:

```text
stocks
single_leg_options
```

Explicitly deferred from v1:

```text
multi_leg_options_spreads
combo_orders
```

Capability rules:

- Capability maps are account-specific, not provider-global.
- Missing, stale, or unknown capability map blocks activation and order
  mutation with `BROKER_CAPABILITY_SYNC_REQUIRED` or
  `BROKER_CAPABILITY_UNSUPPORTED`.
- Broker-native capability means PYRUS may use the provider's supported shape
  after normalizing the `OrderIntent`; it does not allow raw broker payload
  pass-through.
- Capability map data must not include raw account numbers, raw provider
  payloads, tokens, authorization headers, or credential material.
- `broker_account_id_hash` is safe for audit correlation; customer UI uses a
  separate customer-safe account label.

Acceptance criteria:

- Capability map supports all families named in the Broker Scope Model:
  order types, TIFs, sessions, routes, trailing stops, brackets, OCO/OSO,
  cancel/replace fields, preview, and order status support.
- Capability map can explain why each v1 order shape is allowed or blocked.
- Capability map carries freshness policies needed by order preview,
  submit/replace/cancel, and automation activation gates.
- Unknown or stale capability state fails closed.

Verification:

- Future unit tests cover supported/unsupported/stale/unknown capability maps.
- Redaction tests prove capability sync logs and audit metadata do not include
  raw provider payloads or full broker account identifiers.

Likely implementation files later:

- `artifacts/api-server/src/services/broker-capability-map.ts`
- `artifacts/api-server/src/services/broker-capability-map.test.ts`
- `artifacts/api-server/src/services/ibkr-account-bridge.ts`
- `artifacts/api-server/src/services/platform.ts`

Dependencies: Task 1A

Estimated scope: Medium

#### Task 1C: Define Order-Shape Support Evaluator

Description: Define the pure evaluator that answers whether a normalized
`OrderIntent` is supported by the selected broker account before preview,
submit, replace, cancel, or automation activation.

Evaluator input:

```text
ExecutionSupportInput
  tenant_id
  workspace_id
  subject
  broker_connection_id
  broker_account_id
  source
  requested_asset_class
  normalized_order_shape
  order_type
  time_in_force
  session
  route
  side
  quantity_kind
  capability_map
  scope_status
  trading_permission_state
  freshness_snapshot
```

Evaluator output:

```text
ExecutionSupportDecision
  outcome: allowed | blocked
  decision_code
  required_scopes
  missing_scopes
  required_capabilities
  missing_capabilities
  freshness_result
  customer_message_key
  audit_metadata_redacted
```

Decision codes are defined in the canonical Task 1D registry. Initial
`ExecutionSupportDecision` codes:

```text
EXECUTION_ALLOWED
EXECUTION_SCOPE_MISSING
EXECUTION_CAPABILITY_MISSING
EXECUTION_ASSET_CLASS_UNSUPPORTED
EXECUTION_ORDER_SHAPE_UNSUPPORTED
EXECUTION_PREVIEW_UNAVAILABLE
EXECUTION_FRESHNESS_STALE
EXECUTION_PERMISSION_NOT_CONFIGURED
EXECUTION_PERMISSION_PAUSED
EXECUTION_KILL_SWITCH_ACTIVE
EXECUTION_PROVIDER_LIMITATION
```

Acceptance criteria:

- Evaluator is pure and deterministic for a given input.
- Evaluator follows the Phase 1 policy purity boundary: all server facts,
  freshness data, provider facts, ownership facts, and current-time context are
  supplied in `ExecutionSupportInput`.
- Evaluator returns stable machine-readable `decision_code` values and
  customer-safe message keys.
- Evaluator cannot define ad hoc decision codes; every returned code must exist
  in the Task 1D registry.
- Evaluator can be used by strategy activation, terminal order tickets, and
  order mutation routes without duplicating policy logic.
- Evaluator never treats a path parameter or client-provided account id as
  authority; ownership and scope are server-side inputs.

Verification:

- Future tests cover stocks, single-leg options, unsupported spreads, missing
  scopes, stale capability maps, stale order state, and provider limitations.
- Audit fixture tests prove `audit_metadata_redacted` contains normalized
  decision context only.

Likely implementation files later:

- `artifacts/api-server/src/services/execution-support-decision.ts`
- `artifacts/api-server/src/services/execution-support-decision.test.ts`
- `artifacts/api-server/src/services/option-order-intent.ts`
- `artifacts/api-server/src/services/account-trade-model.ts`

Dependencies: Tasks 1A-1B and Task 1D

Estimated scope: Medium

#### Task 1D: Define Decision-Code Registry And Copy Contract

Description: Define the canonical decision-code registry, copy keys, and
severity model used by portal, platform, audit activity, tests, and support
diagnostics when scope, capability, provider, permission, freshness, risk, or
order gates allow or block launch, activation, or orders.

Registry contract:

```text
ExecutionDecisionRegistry
  decision_code
  gate_family
  outcome: allowed | blocked
  customer_message_key
  severity
  audit_event_hint
  redaction_class
  owner_task
  allowed_surfaces
```

Gate families:

```text
scope
capability
provider
permission
freshness
risk_caps
kill_switch
terminal_confirmation
idempotency
audit_durability
tenant_workspace
broker_connection
```

Initial decision-code families:

```text
EXECUTION_*
ACTIVATION_*
PROVIDER_*
SCOPE_*
CAPABILITY_*
PERMISSION_*
FRESHNESS_*
RISK_*
AUDIT_*
```

Copy contract:

```text
scope.read_account.required
scope.read_positions.required
scope.read_orders.required
scope.read_executions.required
scope.trade_submit.required
scope.trade_manage.required
scope.market_data.provider_required
capability.asset_class.unsupported
capability.order_shape.unsupported
capability.cancel_replace.unsupported
capability.preview.unavailable
capability.sync.required
execution.permission.required
execution.permission.paused
execution.kill_switch.active
```

Severity vocabulary:

```text
info
action_required
blocked
security_blocked
provider_limitation
```

Acceptance criteria:

- Every Phase 1 block reason maps to a message key and severity.
- Every `EXECUTION_*`, `ACTIVATION_*`, provider, scope, capability,
  permission, freshness, risk, kill-switch, idempotency, and audit-durability
  decision code is registered once in the canonical registry.
- Evaluators, API responses, audit builders, customer activity projections, and
  UI copy lookup use the registry rather than duplicating local code lists.
- Adding a new block reason requires adding one registry entry, one message key,
  one severity, redaction classification, and tests.
- Customer-facing copy never exposes internal adapter stack details, raw
  provider request ids, account numbers, tokens, or sensitive audit metadata.
- Portal copy explains broker scopes before connect; platform copy explains
  account/order/automation blocks after launch.
- Provider limitation copy is clear enough for support without implying PYRUS
  can bypass provider restrictions.

Verification:

- Future tests prove every evaluator-returned code exists in the registry and
  every registry entry has a message key, severity, redaction class, and audit
  hint.
- Future tests cover message-key lookup for every `ExecutionSupportDecision`
  and `ActivationDecision` block code.
- Redaction review confirms copy inputs are customer-safe.

Likely implementation files later:

- `artifacts/api-server/src/services/execution-decision-registry.ts`
- `artifacts/api-server/src/services/execution-decision-registry.test.ts`
- `artifacts/api-server/src/services/broker-permission-copy.ts`
- `artifacts/pyrus/src/features/platform/brokerPermissionCopy.js`
- `artifacts/pyrus/src/screens/SettingsScreen.jsx`
- `artifacts/pyrus/src/screens/AlgoScreen.jsx`

Dependencies: Tasks 1A-1B

Estimated scope: Small

#### Task 2A: Define Provider Classification Template

Description: Define the evidence-backed provider matrix schema used to decide
whether a broker can enter customer v1 as direct OAuth, aggregator-backed,
IBKR connector, or unsupported.

Provider classification shape:

```text
ProviderClassification
  provider
  adapter_kind
  auth_type
  customer_v1_status
  supported_asset_classes
  required_scopes
  optional_scopes
  unsupported_scopes
  account_capability_families
  preview_support
  order_status_support
  cancel_replace_support
  reauth_support
  token_custody_model
  provider_docs_refs
  last_verified_at
  known_limitations
  default_block_reason
```

Adapter kinds:

```text
direct_oauth
aggregator
ibkr_connector
unsupported
```

Customer v1 statuses:

```text
eligible_for_private_beta
eligible_after_exception  # future/non-live only; not valid for private-beta live automation
insufficient_capability
unsupported_provider
research_only
ibkr_special_connector
```

Acceptance criteria:

- Matrix records evidence source, verification date, and limitation for every
  provider row.
- Unsupported providers fail closed with `BROKER_CAPABILITY_UNSUPPORTED` or a
  provider-specific `default_block_reason`.
- Provider classification does not create execution entitlement by itself; it
  only informs adapter and capability sync behavior.
- Provider data must be refreshed from official provider/aggregator docs before
  implementation, because broker APIs and scopes change.

Verification:

- Future matrix tests load fixture rows and reject rows without source refs,
  status, required scopes, and known limitations.
- Human review checks private-beta candidates against current official docs.

Likely implementation files later:

- `docs/plans/broker-provider-classification-matrix.md`
- `artifacts/api-server/src/services/broker-provider-classification.ts`
- `artifacts/api-server/src/services/broker-provider-classification.test.ts`

Dependencies: Tasks 1A-1B

Estimated scope: Medium

#### Task 2B: Classify V1 Provider Entry Paths

Description: Apply the classification template to the initial provider
categories and lock SnapTrade as the first aggregator to evaluate for the
non-IBKR private-beta lane, subject to current official-doc and compliance
verification before eligibility.

Initial category decisions:

| Category | V1 stance | Reason |
| --- | --- | --- |
| IBKR connector | `ibkr_special_connector` | Existing Gateway/bridge path can be wrapped, but it is not the default SaaS OAuth pattern. |
| SnapTrade aggregator | First non-IBKR private-beta lane | Multi-provider v1 should prove one SnapTrade-backed execution path in addition to the IBKR special connector, but only after official docs and a named selected-brokerage/account fixture prove stock and single-leg option order, fill, cancel/replace, account identity, and audit semantics remain account-native. |
| Direct OAuth broker | Second-wave research candidate | Candidate selection is deferred to Phase 3 provider research. Eligible later if current official scopes support minimum safe execution and hosted reauth. If SnapTrade fails the safety bar, Phase 3 provider research chooses the fallback lane; it is not assumed to be direct OAuth. |
| Read-only connection | `insufficient_capability` | Cannot satisfy automation execution safety. |
| Manual-only connection | `insufficient_capability` | Customer v1 does not define manual-only as a success product mode. |
| Paper/demo/shadow | `research_only` or demo | Cannot satisfy live customer automation eligibility. |

Acceptance criteria:

- Matrix distinguishes auth/connect pattern from execution capability.
- SnapTrade-backed execution is the first non-IBKR private-beta provider lane
  to evaluate and must produce account-specific capability maps before
  activation.
- SnapTrade cannot pass private-beta readiness as a generic aggregator; Phase 3
  must name a selected brokerage/account fixture that proves stocks and
  single-leg options before the row can move beyond research.
- Direct OAuth remains a second-wave research lane after SnapTrade-first unless
  Phase 3 provider research names a candidate and explicitly promotes it as a
  replacement path.
- SnapTrade failure fallback selection is deferred to Phase 3 provider
  research. The fallback may be another aggregator, a direct OAuth broker, or an
  embedded brokerage/BaaS lane, but no backup provider is named in Phase 1.
- IBKR remains a special connector path and does not weaken the portal
  broker-hosted/OAuth customer v1 default.
- SnapTrade remains a candidate, not an eligible provider, until current
  official docs, selected-brokerage support, fixtures, and compliance/product
  review clear the row.

Verification:

- Future docs review proves every provider candidate has current source refs.
- Future fixture tests map each category to allowed/blocked launch and
  activation states.

Likely implementation files later:

- `docs/plans/broker-provider-classification-matrix.md`
- `artifacts/api-server/src/services/broker-provider-classification.ts`
- `artifacts/api-server/src/services/ibkr-account-bridge.ts`

Dependencies: Task 2A

Estimated scope: Medium

#### Task 2C: Define Provider Limitation To Capability Mapping

Description: Define how provider-specific gaps become normalized capability
blocks rather than ad hoc route behavior.

Mapping rules:

- Provider lacks preview: set `preview.supported=false`; orders can proceed
  only if all other safety gates pass and the risk policy allows no-preview
  execution for that asset/order shape.
- Provider lacks order stream: set `order_status_streaming=false`; freshness
  policy must require polling and tighter stale-state blocking.
- Provider lacks cancel/replace: block `trade_manage` readiness for automation
  unless provider offers equivalent order management semantics.
- Provider lacks options support: block `single_leg_options`; do not silently
  downgrade strategy subscriptions to stocks.
- Provider supports paper only: block customer v1 live automation.
- Provider supports submit-only: block `automation_trading_connection`.

Acceptance criteria:

- Every known limitation maps to a normalized capability, freshness, or scope
  decision.
- Limitation mapping is pure and deterministic for a given adapter/provider
  fact input; it does not read DB clients, provider clients, request objects,
  env/global state, or clocks.
- Submit-only, read-only, and paper-only links fail closed.
- Capability mapping preserves provider-specific details internally while
  exposing only normalized customer-safe block reasons.

Verification:

- Future tests cover no-preview, no-stream, no-cancel, no-options, paper-only,
  read-only, and submit-only fixtures.

Likely implementation files later:

- `artifacts/api-server/src/services/provider-capability-normalizer.ts`
- `artifacts/api-server/src/services/provider-capability-normalizer.test.ts`

Dependencies: Tasks 1B-2B

Estimated scope: Medium

#### Task 3A: Define TradingPermission Data Model

Description: Define the account-level permission record that separates broker
authorization from automation-grade execution activation.

Trading permission shape:

```text
TradingPermission
  id
  tenant_id
  workspace_id
  subject
  broker_connection_id
  broker_account_id
  state
  allowed_asset_classes
  allowed_order_shapes
  max_notional_per_order
  max_contracts_per_order
  max_daily_notional
  max_daily_trades
  max_daily_loss
  allowed_symbols
  blocked_symbols
  require_terminal_confirmation
  account_kill_switch_state
  automation_kill_switch_state
  disclosure_acknowledged_at
  configured_by
  activated_by
  paused_by
  pause_reason
  last_capability_sync_at
  last_reconciled_at
  created_at
  updated_at
```

Permission states:

```text
pending_authorization
authorized
syncing_accounts
ready_for_configuration
configured
automation_active
paused
revoked
error
```

State meanings:

- `pending_authorization`: broker connect or reauth has started but usable
  scopes/capabilities are not yet confirmed.
- `authorized`: provider authorization exists but account/capability sync is
  not complete enough for configuration.
- `syncing_accounts`: account identity, scopes, capabilities, positions,
  orders, or executions are refreshing.
- `ready_for_configuration`: minimum scopes/capabilities exist; caps and risk
  settings are not complete.
- `configured`: caps, disclosures, and kill switch policy are configured but
  automation is not active.
- `automation_active`: account is active for strategy automation subject to
  per-strategy gates and real-time execution checks.
- `paused`: automation is disabled but the account may remain available for
  supervised terminal orders if all terminal-order gates pass.
- `revoked`: broker authorization, account ownership, or user/tenant authority
  was revoked.
- `error`: unknown or unreconciled state blocks automation until repaired.

Acceptance criteria:

- Broker authorization alone never creates `automation_active`.
- Terminal trades use the same activated account permission but always require
  per-order live confirmation.
- `paused`, `revoked`, `error`, missing reconciliation, or stale capability
  state blocks automation.
- Risk caps and kill switches are required before activation.
- Private beta does not define PYRUS hard numeric default caps. Users must
  explicitly configure account-level caps before activation; missing,
  zero/negative, non-finite, or unlimited caps are invalid.
- User-configured caps may be changed by the customer through platform-owned
  controls without internal approval, subject to server validation, audit, and
  re-running activation gates.

Verification:

- Future state tests cover every allowed transition and blocked transition.
- Future redaction tests prove permission audit events do not expose raw broker
  identifiers or sensitive provider payloads.

Likely implementation files later:

- `artifacts/api-server/src/services/trading-permission-model.ts`
- `artifacts/api-server/src/services/trading-permission-model.test.ts`
- DB/schema files discovered during Phase 2

Dependencies: Tasks 1A-2C

Estimated scope: Medium

#### Task 3B: Define Permission State Machine

Description: Define explicit state transitions and audit requirements for
configure, activate, pause, resume, revoke, and repair actions.

Allowed transitions:

| From | Action | To | Required gate |
| --- | --- | --- | --- |
| `pending_authorization` | broker auth completes | `authorized` | Provider authorization stored behind adapter boundary. |
| `authorized` | account/capability sync starts | `syncing_accounts` | Sync job accepted and audited. |
| `syncing_accounts` | sync passes | `ready_for_configuration` | Account identity, scopes, capabilities, and freshness pass. |
| `ready_for_configuration` | save caps/disclosure | `configured` | Caps, disclosure, and kill switch policy valid. |
| `configured` | activate automation | `automation_active` | Execution support, caps, scopes, capabilities, freshness, and audit pass. |
| `automation_active` | pause | `paused` | User/system pause audited. |
| `paused` | resume | `automation_active` | Re-run all activation gates and reconciliation checks. |
| any non-terminal | broker revoke/disconnect | `revoked` | Broker/account revoke event. |
| any non-terminal | unknown unsafe state | `error` | Unknown provider/account/reconciliation state. |
| `error` | repair passes | `ready_for_configuration` or `configured` | Human/system repair plus sync/reconciliation pass. |

Blind resume blockers:

```text
unknown_provider_state
disconnect
revoke
failed_reconciliation
changed_scope
changed_capability
stale_positions
stale_orders
kill_switch_active
tenant_or_user_suspended
```

Acceptance criteria:

- State transitions are centralized and auditable.
- Transition rules are pure and deterministic; callers provide current state,
  requested action, actor, gate result, and time/audit context rather than the
  state machine reading runtime state directly.
- Resume re-runs the same gates as activation.
- System pauses record a machine reason and do not become silent UI-only
  states.
- Existing IBKR live confirmation semantics are preserved for terminal orders.

Verification:

- Future tests cover transition table, blind-resume blockers, audit events, and
  idempotent pause/resume behavior.

Likely implementation files later:

- `artifacts/api-server/src/services/trading-permission-state-machine.ts`
- `artifacts/api-server/src/services/trading-permission-state-machine.test.ts`
- `artifacts/api-server/src/services/signal-options-automation.ts`

Dependencies: Task 3A

Estimated scope: Medium

#### Task 3C: Define Activation And Execution Gate Evaluator

Description: Define the single server-side evaluator used by platform
activation, terminal order preview/submit, strategy subscription activation,
and fully automated order submission.

Gate families:

```text
tenant_workspace
subject_role
broker_connection
broker_account_ownership
scope_status
capability_map
trading_permission
freshness
risk_caps
kill_switch
terminal_confirmation
idempotency
audit_durability
```

Activation gate output:

```text
ActivationDecision
  outcome
  decision_code
  blocked_gate
  customer_message_key
  audit_metadata_redacted
  next_action
```

Activation decision codes are defined in the canonical Task 1D registry.
Initial activation codes:

```text
ACTIVATION_ALLOWED
ACTIVATION_SCOPE_MISSING
ACTIVATION_CAPABILITY_MISSING
ACTIVATION_CAPS_REQUIRED
ACTIVATION_DISCLOSURE_REQUIRED
ACTIVATION_KILL_SWITCH_REQUIRED
ACTIVATION_FRESHNESS_STALE
ACTIVATION_RECONCILIATION_REQUIRED
ACTIVATION_TENANT_OR_USER_BLOCKED
ACTIVATION_AUDIT_UNAVAILABLE
```

Acceptance criteria:

- Gate evaluator is server-side and does not trust client state.
- Gate evaluator follows the Phase 1 policy purity boundary: route/service
  layers provide tenancy, ownership, scope, capability, permission, freshness,
  risk, kill-switch, idempotency, confirmation, and audit-durability facts as
  inputs.
- Same evaluator family is used by activation, terminal order, and automation
  code paths so policy does not drift.
- Gate evaluator cannot define ad hoc decision codes; every returned code must
  exist in the Task 1D registry.
- High-risk activation/order mutations fail closed when audit durability cannot
  be confirmed.
- Terminal order submit requires per-order live confirmation in addition to
  account permission.

Verification:

- Future unit tests cover every gate family and every decision code.
- Future integration tests prove terminal and automation routes cannot bypass
  activation gates.

Likely implementation files later:

- `artifacts/api-server/src/services/execution-gate-decision.ts`
- `artifacts/api-server/src/services/execution-gate-decision.test.ts`
- `artifacts/api-server/src/routes/platform.ts`
- `artifacts/api-server/src/routes/automation.ts`

Dependencies: Tasks 1C, 1D, and 3B

Estimated scope: Medium

#### Task 3D: Define Phase 1 API And Route Boundary

Description: Decide how Phase 1 contract data appears through APIs before
Phase 2/3 implementation expands persistence and adapters.

Route boundary decision:

- New customer-facing multi-tenant execution APIs use the explicit
  `/api/platform/...` namespace and are protected by platform-session
  middleware.
- Existing generic `/orders`, `/orders/preview`, `/orders/:orderId/replace`,
  `/orders/:orderId/cancel`, `/accounts`, `/broker-connections`, and related
  stream routes remain legacy/internal migration surfaces in Phase 1.
- Legacy generic routes may serve customer traffic only after an explicit
  platform-session middleware, tenant/workspace/account authorization, and API
  contract review. No generic route is silently promoted into the public
  customer multi-tenant execution contract.
- Phase 1 does not rename the whole current API. It adds the new platform
  contract first, then migrates or wraps legacy routes deliberately.

Contract endpoints to consider during implementation:

```text
GET /api/platform/broker-scope-contract
GET /api/platform/broker-providers
GET /api/platform/broker-accounts/:brokerAccountId/capabilities
GET /api/platform/broker-accounts/:brokerAccountId/trading-permission
POST /api/platform/broker-accounts/:brokerAccountId/configure-execution
POST /api/platform/broker-accounts/:brokerAccountId/activate-automation
POST /api/platform/broker-accounts/:brokerAccountId/pause-automation
POST /api/platform/broker-accounts/:brokerAccountId/resume-automation
POST /api/platform/orders/preview
POST /api/platform/orders
POST /api/platform/orders/:orderId/replace
POST /api/platform/orders/:orderId/cancel
GET /api/platform/orders
GET /api/platform/executions
POST /api/platform/orders/:orderId/reconcile
```

Acceptance criteria:

- Any public API shape exposes stable machine-readable decision codes and
  customer-safe message keys.
- API responses do not expose raw provider payloads, raw account numbers,
  tokens, authorization headers, internal stack details, or unredacted audit
  metadata.
- API routes use consistent error envelopes and HTTP semantics.
- OpenAPI/codegen changes are made before frontend consumers are wired.

Verification:

- Future OpenAPI review and `pnpm run audit:api-codegen`.
- Future API typecheck with `pnpm --filter @workspace/api-server run typecheck`.
- Future frontend typecheck with `pnpm --filter @workspace/pyrus run typecheck`
  after UI consumers are added.

Likely implementation files later:

- `lib/api-spec/openapi.yaml`
- `artifacts/api-server/src/routes/platform.ts`
- `lib/api-zod/src/generated/*`
- `lib/api-client-react/src/generated/*`

Dependencies: Tasks 1A-3C

Estimated scope: Medium

### Checkpoint: Phase 1 Contract Ready

- Broker scope vocabulary is stable.
- Account capability map contract is stable.
- Provider classification template and initial category decisions are recorded.
- Trading permission state machine and activation gates are stable.
- API route-boundary decision is made before code exposes customer execution
  routes.
- ADR-002 records the automation-first scope and permission decision.

### Phase 1 Backlog-Ready Execution Packets

Use these packets when implementation starts. Each packet should leave the repo
in a working state and should avoid broad runtime wiring until the previous
contract packet is merged or explicitly accepted.

Phase 1 stop rules:

- Do not add live provider integrations in Phase 1.
- Do not add new token storage, OAuth state storage, or broker credential
  custody in Phase 1; those belong to Phase 2.
- Do not expose new customer execution routes until the route-boundary decision
  in Task 3D is implemented.
- Do not rely on provider facts without official-doc verification captured in
  `docs/plans/broker-provider-classification-matrix.md`.
- Do not touch Replit startup config, `.replit`, artifact startup scripts, or
  Replit control-plane state for this work.

Common validation floor:

```bash
pnpm --filter @workspace/api-server run typecheck
pnpm --filter @workspace/pyrus run typecheck
pnpm run audit:api-codegen
```

Run a narrower subset when a packet is docs/types-only. Run the full floor when
OpenAPI, generated clients, API route code, or frontend consumers change.

#### Packet P1-1A: Broker Scope Contract Module

Goal: create the source-of-truth scope vocabulary and readiness meaning for
`automation_trading_connection`.

Implementation sequence:

1. Add `artifacts/api-server/src/services/broker-scope-contract.ts` with scope
   constants, requirement groups, customer copy keys, and helpers that classify
   missing scopes.
2. Add `artifacts/api-server/src/services/broker-scope-contract.test.ts` with
   fixtures for complete scope set, missing each required scope, optional
   `trade_preview`, optional `order_update_stream`, and disabled-by-default
   `market_data`.
3. If public response types are needed, add schemas to `lib/api-spec/openapi.yaml`
   before adding generated clients.
4. Run API typecheck and focused test command once the repo has a test runner
   entry point for API service tests; otherwise document the missing test runner
   in the packet handoff.

Likely files:

- `artifacts/api-server/src/services/broker-scope-contract.ts`
- `artifacts/api-server/src/services/broker-scope-contract.test.ts`
- `lib/api-spec/openapi.yaml`
- Generated clients under `lib/api-zod` and `lib/api-client-react` only if
  OpenAPI changes are required.

Do not touch:

- Provider-specific adapter code.
- Order submit/cancel/replace routes.
- Token or OAuth state storage.

Exit criteria:

- Required, preferred, and disabled-by-default scopes are represented exactly
  once.
- `automation_trading_connection` cannot be produced without the minimum safe
  scope set.
- Missing-scope output maps to `BROKER_SCOPE_MISSING` and customer-safe message
  keys.

#### Packet P1-1B: Broker Account Capability Map Types

Goal: define account-native execution capability maps without wiring provider
runtime behavior yet.

Implementation sequence:

1. Add `artifacts/api-server/src/services/broker-capability-map.ts` with the
   `BrokerAccountCapabilityMap` type, stale/unknown checks, and helpers for
   supported asset classes and order families.
2. Add tests for complete, stale, missing, unsupported, and redacted capability
   maps.
3. Add a pure normalization fixture for existing IBKR-style data only if it can
   be done without changing current bridge behavior.
4. Add OpenAPI schemas only after the internal type is stable.

Likely files:

- `artifacts/api-server/src/services/broker-capability-map.ts`
- `artifacts/api-server/src/services/broker-capability-map.test.ts`
- `artifacts/api-server/src/services/ibkr-account-bridge.ts`
- `artifacts/api-server/src/services/platform.ts`
- `lib/api-spec/openapi.yaml`

Do not touch:

- Live bridge startup, Gateway connection, or line-usage behavior.
- Broker connect/reauth flows.

Exit criteria:

- Unknown and stale maps fail closed.
- Capability map can explain stocks, single-leg options, preview, streaming,
  cancel/replace, TIF, session, route, trailing stop, bracket, OCO, and OSO
  support.
- Capability map fixtures contain no raw account numbers or raw provider
  payloads.

#### Packet P1-1D: Decision-Code Registry And Copy Contract

Goal: centralize decision codes, customer-safe copy keys, severities, audit
hints, and redaction classes for scope, capability, provider, permission,
freshness, risk, kill-switch, audit, activation, and execution blockers.

Implementation sequence:

1. Add backend decision-code registry constants in
   `artifacts/api-server/src/services/execution-decision-registry.ts`.
2. Add backend copy-key constants in
   `artifacts/api-server/src/services/broker-permission-copy.ts`.
3. Add frontend presentation mapping in
   `artifacts/pyrus/src/features/platform/brokerPermissionCopy.js` only after
   backend keys stabilize.
4. Add tests or fixtures proving every `EXECUTION_*`, `ACTIVATION_*`,
   provider, scope, capability, permission, freshness, risk, kill-switch, and
   audit-durability code has one customer-safe key, severity, audit hint, and
   redaction class.
5. Keep final display text short and product-neutral; do not leak provider
   internals.

Likely files:

- `artifacts/api-server/src/services/execution-decision-registry.ts`
- `artifacts/api-server/src/services/execution-decision-registry.test.ts`
- `artifacts/api-server/src/services/broker-permission-copy.ts`
- `artifacts/pyrus/src/features/platform/brokerPermissionCopy.js`
- `artifacts/pyrus/src/screens/SettingsScreen.jsx`
- `artifacts/pyrus/src/screens/AlgoScreen.jsx`

Do not touch:

- Layout-heavy UI implementation.
- Portal trading controls.

Exit criteria:

- Every block reason has one message key and one severity.
- Every evaluator-returned decision code is present in the canonical registry.
- Customer copy cannot include raw provider ids, full account ids, tokens,
  stack traces, or raw audit metadata.

#### Packet P1-1C: Execution Support Decision Evaluator

Goal: add a pure evaluator that says whether a normalized order shape is
supported by the selected account.

Implementation sequence:

1. Add `artifacts/api-server/src/services/execution-support-decision.ts`.
2. Use Task 1A scopes, Task 1B capabilities, and Task 1D registry codes as
   inputs; do not read from DB clients, provider clients, env/global state,
   clocks, network, or request objects inside the evaluator.
3. Add fixtures for stocks, single-leg options, deferred spreads, missing
   scopes, unsupported order types, stale freshness, paused permission, and
   provider limitation.
4. Return stable decision codes from the Task 1D registry, missing
   requirements, customer message keys, and redacted audit metadata.

Likely files:

- `artifacts/api-server/src/services/execution-support-decision.ts`
- `artifacts/api-server/src/services/execution-support-decision.test.ts`
- `artifacts/api-server/src/services/option-order-intent.ts`
- `artifacts/api-server/src/services/account-trade-model.ts`

Do not touch:

- API route authorization.
- Live order submission.
- UI order ticket behavior.

Exit criteria:

- Evaluator is deterministic and side-effect free.
- Client-provided account ids are never authority; ownership is an explicit
  server-side input.
- Every blocked result has a stable `EXECUTION_*` code.

#### Packet P1-2A: Provider Classification Schema

Goal: make provider research structured and testable without deciding the
first external provider.

Implementation sequence:

1. Keep `docs/plans/broker-provider-classification-matrix.md` as the human
   source for unverified provider research.
2. Add `artifacts/api-server/src/services/broker-provider-classification.ts`
   with classification row types and validation helpers.
3. Add fixture tests that reject rows missing docs refs, verification date,
   adapter kind, customer v1 status, required scopes, known limitations, or
   default block reason.
4. Do not mark a provider `eligible_for_private_beta` unless official source
   refs are current and captured.

Likely files:

- `docs/plans/broker-provider-classification-matrix.md`
- `artifacts/api-server/src/services/broker-provider-classification.ts`
- `artifacts/api-server/src/services/broker-provider-classification.test.ts`

Do not touch:

- Live provider credentials.
- OAuth implementation.
- Aggregator SDKs.

Exit criteria:

- Provider row schema is strict enough to prevent unsupported provider facts
  from entering code as defaults.
- Candidate rows with TBD facts remain blocked with `PROVIDER_RESEARCH_REQUIRED`.

#### Packet P1-2B: Provider Entry-Path Classification Fixtures

Goal: classify entry-path categories and make unsupported categories fail
closed through fixtures.

Implementation sequence:

1. Add fixtures for IBKR connector, direct OAuth candidate, aggregator
   candidate, read-only, manual-only, submit-only, paper/demo/shadow, and
   unsupported provider.
2. Map every fixture to launch, activation, and execution readiness outcomes.
3. Verify direct OAuth and aggregator candidates remain candidates until
   official docs are reviewed.
4. Keep IBKR classified as special connector, not the default SaaS pattern.

Likely files:

- `docs/plans/broker-provider-classification-matrix.md`
- `artifacts/api-server/src/services/broker-provider-classification.ts`
- `artifacts/api-server/src/services/broker-provider-classification.test.ts`
- `artifacts/api-server/src/services/ibkr-account-bridge.ts`

Do not touch:

- Provider startup flows.
- User-facing provider pickers.

Exit criteria:

- Read-only, manual-only, submit-only, paper/demo/shadow, and unsupported
  fixtures fail closed.
- Candidate providers do not imply execution entitlement.

#### Packet P1-2C: Provider Limitation Normalizer

Goal: normalize provider-specific gaps into standard scope/capability/freshness
decisions.

Implementation sequence:

1. Add `artifacts/api-server/src/services/provider-capability-normalizer.ts`.
2. Encode mapping rules for no-preview, no-stream, no-cancel/replace,
   no-options, paper-only, read-only, and submit-only.
3. Add fixtures that include provider-specific details internally and expose
   only normalized customer-safe block reasons externally.
4. Feed normalized output into `BrokerAccountCapabilityMap`.

Likely files:

- `artifacts/api-server/src/services/provider-capability-normalizer.ts`
- `artifacts/api-server/src/services/provider-capability-normalizer.test.ts`
- `artifacts/api-server/src/services/broker-capability-map.ts`

Do not touch:

- Strategy subscription activation.
- Live order routes.

Exit criteria:

- Every provider limitation maps to one normalized decision path.
- Normalizer accepts provider facts as explicit inputs and performs no DB,
  provider-client, env/global, request, network, or persistence reads/writes.
- Submit-only never becomes `automation_trading_connection`.

#### Packet P1-3A: TradingPermission Model

Goal: define account-level execution permission separate from broker
authorization.

Implementation sequence:

1. Add `artifacts/api-server/src/services/trading-permission-model.ts` with the
   `TradingPermission` type, cap fields, state enum, and redacted audit shape.
2. Add tests for default state, configured state, automation-active state,
   paused state, revoked state, and error state.
3. Defer DB schema/migrations to Phase 2 unless an implementation decision
   explicitly pulls schema forward.
4. Keep caps validation pure and independent of provider runtime state.

Likely files:

- `artifacts/api-server/src/services/trading-permission-model.ts`
- `artifacts/api-server/src/services/trading-permission-model.test.ts`
- Future DB/schema files discovered during Phase 2.

Do not touch:

- Persistent database schema unless Phase 2 is intentionally started.
- Account configuration UI.

Exit criteria:

- Broker authorization alone cannot produce `automation_active`.
- Caps, disclosure, kill switches, freshness, and reconciliation fields are
  represented.
- Terminal confirmation requirement is explicit.

#### Packet P1-3B: TradingPermission State Machine

Goal: centralize configure, activate, pause, resume, revoke, and repair
transitions.

Implementation sequence:

1. Add `artifacts/api-server/src/services/trading-permission-state-machine.ts`.
2. Implement the allowed transition table from Task 3B as pure functions.
3. Add blind-resume blocker fixtures for unknown state, disconnect, revoke,
   failed reconciliation, changed scope, changed capability, stale positions,
   stale orders, active kill switch, and suspended tenant/user.
4. Emit audit event names and redacted metadata shapes, but do not wire audit
   persistence yet unless Task 0E implementation exists.

Likely files:

- `artifacts/api-server/src/services/trading-permission-state-machine.ts`
- `artifacts/api-server/src/services/trading-permission-state-machine.test.ts`
- `artifacts/api-server/src/services/signal-options-automation.ts`

Do not touch:

- Existing automation deployment behavior except through isolated tests.
- Runtime pause/resume endpoints.

Exit criteria:

- Resume re-runs activation gates.
- State-machine functions accept explicit context and perform no DB,
  provider-client, env/global, request, network, or persistence reads/writes.
- System pauses are machine-reasoned, audited, and not UI-only.
- Pause/resume operations are idempotent where safe.

#### Packet P1-3C: Activation And Execution Gate Evaluator

Goal: create one server-side evaluator for activation, terminal orders,
strategy subscription activation, and automation order submission.

Implementation sequence:

1. Add `artifacts/api-server/src/services/execution-gate-decision.ts`.
2. Compose outputs from broker scope, capability map, execution support,
   trading permission, freshness, risk caps, kill switch, idempotency, terminal
   confirmation, and audit durability checks.
3. Add unit tests for every `ACTIVATION_*` decision code in the Task 1D
   registry and for representative terminal and automation gate outcomes.
4. Keep route handlers unchanged until the evaluator is covered by tests.

Likely files:

- `artifacts/api-server/src/services/execution-gate-decision.ts`
- `artifacts/api-server/src/services/execution-gate-decision.test.ts`
- `artifacts/api-server/src/routes/platform.ts`
- `artifacts/api-server/src/routes/automation.ts`

Do not touch:

- Live order submission path.
- Frontend order ticket enablement.

Exit criteria:

- Activation, terminal order, and automation paths can share one policy family.
- Audit durability failure blocks high-risk mutations.
- Client state is never trusted as a gate result.
- Gate evaluator accepts explicit context and performs no DB, provider-client,
  env/global, request, network, or persistence reads/writes.

#### Packet P1-3D: API Route Boundary And OpenAPI Contract

Goal: document and implement the customer-facing route boundary before wiring
frontend consumers.

Implementation sequence:

1. Inspect existing generic routes in `lib/api-spec/openapi.yaml` and
   `artifacts/api-server/src/routes/`.
2. Add new customer-facing multi-tenant execution routes under
   `/api/platform/...`.
3. Audit existing generic `/api/orders`, `/api/accounts`,
   `/api/broker-connections`, and stream routes; mark, guard, or wrap them as
   legacy/internal migration surfaces. Do not broadly rename the current API in
   Phase 1.
4. Update `lib/api-spec/openapi.yaml` first.
5. Regenerate clients.
6. Run `pnpm run audit:api-codegen`, API typecheck, and Pyrus typecheck before
   frontend consumers are wired.

Likely files:

- `lib/api-spec/openapi.yaml`
- `artifacts/api-server/src/routes/platform.ts`
- `artifacts/api-server/src/routes/index.ts`
- `lib/api-zod/src/generated/*`
- `lib/api-client-react/src/generated/*`

Do not touch:

- Runtime UI consumers until OpenAPI/codegen is clean.
- Replit startup config.

Exit criteria:

- Route boundary is explicit and cannot accidentally expose customer execution
  through unauthenticated or legacy paths.
- Generated clients are current.
- Error envelopes use stable machine-readable codes and customer-safe messages.

Parallelization notes:

- P1-1A must land before P1-1B/P1-1D.
- P1-1D should land before P1-1C so the evaluator consumes the shared
  registry instead of defining local codes.
- P1-2A can start after P1-1A and can run parallel to P1-1B if the scope enum
  is stable.
- P1-2B and P1-2C depend on P1-2A.
- P1-3A can start after P1-1A and P1-1B; P1-3B depends on P1-3A.
- P1-3C depends on P1-1C, P1-1D, and P1-3B.
- P1-3D should be last before any frontend/API route wiring.

### Phase 2: Identity, Tenancy, And Secrets

Objective: add the hosted-SaaS identity, tenant/workspace ownership, secret
custody, and OAuth state foundation that Phase 3-5 rely on. This phase still
must not create new customer trading behavior. It makes the data and request
boundaries enforceable before adapters, order safety, or UI flows use them.

Observed repo anchors for implementation planning:

- `lib/db/src/schema/broker.ts` currently defines `broker_connections` and
  `broker_accounts` without tenant/workspace owner columns.
- `lib/db/src/schema/trading.ts` currently defines `order_requests`,
  `broker_orders`, `execution_fills`, positions, and balances around broker
  accounts and provider ids.
- `lib/db/src/schema/automation.ts` currently defines `algo_deployments` with
  `providerAccountId`, not a tenant-owned broker account permission.
- `artifacts/api-server/src/routes/index.ts` mounts `platformRouter` directly;
  existing generic account/order routes in `platform.ts` must not become the
  multi-tenant public contract by accident.
- No current implementation should be assumed to provide tenant isolation until
  Phase 2 tasks prove it from source, schema, and route tests.

Phase 2 dependency graph:

```text
Task 4A principal and workspace model
  -> Task 4B tenant ownership columns and backfill policy
    -> Task 4C request context and authorization middleware
      -> Task 4D legacy route containment audit
        -> Task 5 secret classification and vault envelope
          -> Task 6 OAuth/reauth state store
            -> Phase 3 adapter implementation
```

Phase 2 non-negotiables:

- Tenant/workspace ownership is a server-side fact, never a client assertion.
- Existing single-user/local mode may be preserved only through an explicit
  default tenant/workspace bootstrap path.
- Secrets are never stored in raw logs, raw audit payloads, generated clients,
  browser storage, or customer-visible activity payloads.
- OAuth and hosted reauth callback payloads are external input and must be
  validated before they affect broker authorization or trading permission state.
- Phase 2 is not complete until every legacy generic route that can see broker,
  account, order, execution, strategy, or audit data has an explicit migration
  classification.

#### Task 4A: Define Principal, Tenant, And Workspace Contract

Description: Define the normalized authenticated principal and workspace model
that every portal and platform request uses before touching broker-owned or
execution-owned resources.

Contract shape:

```text
AuthenticatedPrincipal
  subject_type: user | service
  subject_id
  tenant_id
  workspace_id
  roles
  auth_session_id
  platform_session_id
  issued_at
  expires_at
```

Authority rules:

- Portal requests derive `tenant_id` and `workspace_id` from portal auth/session
  state, not request body or query params.
- Platform requests derive `tenant_id` and `workspace_id` from the Phase 0
  platform session created through one-time handoff exchange.
- Customer v1 resolves exactly one tenant/workspace per user; no user-facing
  org selector, workspace switcher, or multi-member tenant roles are in scope.
- Service-to-service calls use a service subject with explicit allowed actions;
  service identity is not a customer user surrogate.
- Admin/support subjects are out of scope for customer v1 unless a separate
  support-access contract is written.

Acceptance criteria:

- Principal contract covers portal user sessions, platform sessions, and
  portal-to-platform handoff service calls.
- Contract names the source of truth for tenant/workspace on every request
  family.
- Customer v1 bootstrap creates or resolves one default tenant/workspace for
  each user; future enterprise/org membership cannot be inferred from v1
  records without a separate migration contract.
- Request body, path params, and query params can select resources only after
  server-side ownership lookup.
- Suspended/revoked users and tenants map to stable fail-closed decision codes.

Verification:

- Future unit tests cover principal derivation for portal, platform, and
  service calls.
- Future route tests prove client-supplied tenant/workspace ids are ignored or
  rejected when they conflict with server authority.

Likely implementation files later:

- `artifacts/api-server/src/services/auth-context.ts`
- `artifacts/api-server/src/services/platform-session.ts`
- `artifacts/api-server/src/routes/platform.ts`
- `artifacts/api-server/src/routes/index.ts`

Dependencies: Phase 0 and Phase 1 Task 3D

Estimated scope: Medium

#### Task 4B: Define Tenant Ownership Schema Migration

Description: Define the schema ownership changes and migration/backfill order
for broker connections, broker accounts, orders, executions, strategies,
subscriptions, permissions, audit events, and activity projections.

Ownership targets:

```text
tenants
users
tenant_memberships
workspaces
broker_connections
broker_accounts
broker_account_capability_maps
trading_permissions
order_intents
provider_order_attempts
execution_fills
strategy_subscriptions
audit_events
customer_activity_events
```

Migration rules:

- New owner columns are added nullable only during backfill, then tightened when
  all reader/writer paths use them.
- Local/single-user mode receives an explicit default tenant and workspace.
- Hosted customer v1 also receives exactly one default tenant/workspace per
  user; `tenant_memberships` is a single-owner bootstrap record, not an
  enterprise RBAC surface.
- `providerAccountId` remains provider-native metadata and cannot be used as a
  tenant boundary.
- Cross-table references use PYRUS ids for ownership joins; provider ids stay
  behind adapter and reconciliation boundaries.
- Audit events keep immutable historical ownership fields even if a resource is
  later transferred, disconnected, or deleted.

Acceptance criteria:

- Every table that can expose broker, account, order, strategy, subscription,
  permission, audit, or activity state has a planned owner path.
- Backfill plan identifies creator path, reader path, and rollback posture for
  each table family.
- Existing generated clients and local/default mode have a planned
  compatibility path.
- No migration step depends on unverified provider facts.

Verification:

- Future migration tests prove default-tenant backfill is deterministic.
- Future schema tests prove uniqueness constraints are tenant/account scoped
  rather than globally provider-id scoped where customer data is involved.
- Future route tests prove cross-tenant ids cannot read or mutate resources.

Likely implementation files later:

- `lib/db/src/schema/broker.ts`
- `lib/db/src/schema/trading.ts`
- `lib/db/src/schema/automation.ts`
- `lib/db/src/schema/enums.ts`
- `lib/db/migrations/*`

Dependencies: Task 4A

Estimated scope: Large; split by table family before implementation.

#### Task 4C: Define Request Context And Authorization Middleware

Description: Define the middleware and service helper contract that resolves
authorized tenant/workspace/account access for every portal, platform, stream,
and service-to-service route family.

Authorization helpers:

```text
requirePortalPrincipal
requirePlatformPrincipal
requirePortalHandoffService
requireTenantWorkspaceAccess
requireBrokerConnectionAccess
requireBrokerAccountAccess
requireTradingPermissionAccess
requireOrderIntentAccess
requireStrategySubscriptionAccess
```

Route-family matrix:

| Route family | Session source | Required owner check | Notes |
| --- | --- | --- | --- |
| `/api/portal/...` | Portal auth | tenant/workspace membership | First broker setup and launch eligibility only. |
| `/api/portal/platform/handoff/exchange` | Platform service identity | handoff code tenant/workspace binding | Server-to-server only. |
| `/api/platform/session...` | Handoff exchange or platform cookie | platform session hash | No broker account authority by itself. |
| `/api/platform/broker-accounts...` | Platform session | tenant/workspace + account ownership | Uses broker account id after lookup. |
| `/api/platform/orders...` | Platform session | tenant/workspace + account + permission + gate | Uses Phase 4 ledger before provider call. |
| `/api/platform/streams...` | Platform session | tenant/workspace + stream resource scope | No unauthenticated SSE. |
| legacy generic routes | Existing runtime | migration/internal unless wrapped | Must be classified in Task 4D. |

Acceptance criteria:

- Middleware contract is explicit for API routes, SSE streams, background jobs,
  and service-to-service calls.
- Authorization helpers return stable errors: unauthenticated, unauthorized,
  not found under tenant, suspended, and stale session.
- Ownership checks happen before provider calls, broker token reads, audit
  exports, or order mutation attempts.
- Customer-visible errors do not reveal whether another tenant's resource id
  exists.

Verification:

- Future tests cover route, service helper, and SSE stream authorization.
- Future negative tests prove path-param account/order ids cannot bypass tenant
  ownership.

Likely implementation files later:

- `artifacts/api-server/src/middleware/auth-context.ts`
- `artifacts/api-server/src/services/authorization.ts`
- `artifacts/api-server/src/routes/platform.ts`
- `artifacts/api-server/src/routes/automation.ts`

Dependencies: Tasks 4A-4B

Estimated scope: Medium

#### Task 4D: Define Legacy Route Containment And Migration Audit

Description: Classify every existing generic broker/account/order/execution
route as public platform contract, wrapped migration route, internal-only
route, or deprecated IBKR-era surface before exposing customer SaaS traffic.

Observed legacy route families to audit:

```text
/broker-connections
/accounts
/accounts/:accountId/*
/positions
/orders
/orders/preview
/orders/submit
/orders/:orderId/replace
/orders/:orderId/cancel
/executions
/streams/orders
/streams/executions
/streams/accounts
/algo/deployments
/algo/deployments/:deploymentId/*
```

Classification vocabulary:

```text
platform_public_contract
wrapped_migration_route
internal_runtime_route
ibkr_special_connector_route
deprecated_not_for_customer_v1
```

Acceptance criteria:

- Every route family that can expose broker, account, order, execution,
  strategy, or subscription state has one classification.
- Generic routes are not listed as the customer v1 multi-tenant execution API;
  new customer execution routes stay under `/api/platform/...`.
- Wrapped migration routes must name the middleware and owner checks required
  before customer traffic.
- Deprecated/internal routes have a test or lint/audit plan preventing
  accidental public use.

Verification:

- Future route inventory test fails when a broker/order route lacks a
  classification.
- Future OpenAPI review proves customer-facing execution paths use the
  platform namespace.

Likely implementation files later:

- `artifacts/api-server/src/routes/platform.ts`
- `artifacts/api-server/src/routes/automation.ts`
- `lib/api-spec/openapi.yaml`
- `scripts/*route*` audit helpers if existing audit patterns support it

Dependencies: Tasks 4A-4C

Estimated scope: Medium

#### Task 5A: Define Secret And Sensitive Identifier Classification

Description: Define which broker/auth/account fields are raw secrets,
sensitive identifiers, internal correlation ids, or customer-safe labels before
any encrypted storage is implemented.

Classification rules:

| Class | Examples | Storage | Browser/API exposure |
| --- | --- | --- | --- |
| raw_secret | access token, refresh token, PKCE verifier, OAuth client secret | encrypted only | never |
| sensitive_identifier | full provider account number, provider user id | encrypted or tightly scoped column | never raw; hash/label only |
| provider_reference | provider order id, provider connection id | scoped internal column | only if customer-safe and necessary |
| internal_correlation | hashed account id, audit correlation id | internal/audit | customer activity only when safe |
| customer_safe_label | masked account label, provider display name | normal column | yes |

Acceptance criteria:

- Every field introduced by broker auth, token storage, account sync, order
  attempt tracking, and reauth state maps to one class.
- Raw secrets and sensitive identifiers are excluded from generated client
  schemas by default.
- Redaction rules are shared by logs, audit builders, activity projections, and
  support diagnostics.

Verification:

- Future redaction fixture tests cover each class.
- Future generated-client scan proves raw secret fields are not returned by
  public OpenAPI schemas.

Likely implementation files later:

- `artifacts/api-server/src/services/secret-classification.ts`
- `artifacts/api-server/src/services/redaction.ts`
- `docs/decisions/*secret*` if a separate ADR is needed

Dependencies: Tasks 4A-4B

Estimated scope: Small

#### Task 5B: Define Encrypted Credential Envelope And Key Policy

Description: Define the storage envelope, key-version metadata, rotation
posture, and failure semantics for broker tokens and aggregator references.

Credential envelope shape:

```text
BrokerCredentialEnvelope
  id
  tenant_id
  broker_connection_id
  credential_kind
  ciphertext
  encryption_key_version
  nonce_or_iv
  aad_context
  provider
  expires_at
  last_refreshed_at
  revoked_at
  created_at
  updated_at
```

Key policy:

- Encryption keys come from deployment secret management, not repo files.
- Associated data binds ciphertext to tenant, connection, provider, credential
  kind, and key version.
- Rotation supports read-old/write-new before old key retirement.
- Decryption failure blocks broker auth use and creates a security audit event.
- Local development may use a development key only when explicitly marked as
  non-production.

Acceptance criteria:

- Envelope supports OAuth access/refresh tokens, aggregator vault references,
  hosted reauth state secrets, and provider-specific credential metadata.
- Raw decrypted credentials are scoped to adapter calls and are never returned
  to route handlers or browser serializers.
- Rotation and revoke states are represented before implementation.
- Decryption, missing key, wrong AAD, and revoked credential states fail closed.

Verification:

- Future crypto unit tests cover encrypt/decrypt, wrong key, wrong AAD,
  rotation, revoked credential, and serialization redaction.
- Future startup/config validation fails production boot without required key
  configuration.

Likely implementation files later:

- `lib/db/src/schema/broker.ts`
- `artifacts/api-server/src/services/broker-credential-store.ts`
- `artifacts/api-server/src/services/broker-credential-store.test.ts`
- Runtime config validation files discovered before implementation

Dependencies: Task 5A

Estimated scope: Medium

#### Task 5C: Define Credential Access Service Boundary

Description: Define the only service boundary that can decrypt or use broker
credentials, so route handlers and UI-facing services cannot accidentally touch
raw tokens.

Service methods:

```text
storeCredential
readCredentialForAdapter
refreshCredential
markCredentialRevoked
rotateCredentialEnvelope
recordCredentialAccessAudit
```

Access rules:

- Only adapter execution and hosted reauth jobs can request decrypted
  credentials.
- Reads require tenant/workspace/broker connection authorization before
  decryption.
- Decrypted values are returned as short-lived in-memory values and never
  written to logs, audit event details, thrown errors, or response objects.
- Token refresh writes a new envelope before the old credential is considered
  replaced.

Acceptance criteria:

- Route handlers cannot import or call raw decrypt helpers directly.
- Credential access is audited with normalized credential kind and provider,
  never token contents.
- Refresh/revoke races have a planned lock or compare-and-swap strategy.
- Adapter calls receive only the credential material they need for one provider
  operation.

Verification:

- Future dependency/import test or code review checklist blocks route-layer
  decrypt usage.
- Future unit tests cover authorization, refresh race, revoke, and redaction.

Likely implementation files later:

- `artifacts/api-server/src/services/broker-credential-access.ts`
- `artifacts/api-server/src/services/broker-adapters/*`
- `artifacts/api-server/src/routes/platform.ts`

Dependencies: Tasks 4C and 5B

Estimated scope: Medium

#### Task 5D: Define Secret Redaction, Audit, And Incident Policy

Description: Define how secret-adjacent errors, callback payloads, provider
responses, and credential operations are logged, audited, and exposed to
customers.

Policy:

- Logs can include provider, tenant/workspace correlation id, connection id,
  safe account label, decision code, and request correlation id.
- Logs cannot include access tokens, refresh tokens, authorization headers,
  PKCE verifiers, full account numbers, full provider payloads, or raw callback
  query/body payloads.
- Security-relevant failures create internal audit events and customer-safe
  activity only when useful.
- Suspected secret exposure triggers credential revoke/reauth flow, not blind
  retry.

Acceptance criteria:

- Redaction policy covers route logs, adapter logs, audit events, activity
  projections, thrown errors, and test snapshots.
- Secret-related incidents map to stable decision codes and customer-safe
  message keys.
- Credential revoke and reauth pathways are referenced but not implemented in
  Phase 2 planning.

Verification:

- Future tests prove representative errors are redacted.
- Future snapshot tests fail if token-like fields appear in public responses.

Likely implementation files later:

- `artifacts/api-server/src/services/redaction.ts`
- `artifacts/api-server/src/services/audit-events.ts`
- `artifacts/api-server/src/services/customer-activity.ts`
- Logging configuration files discovered before implementation

Dependencies: Tasks 5A-5C

Estimated scope: Small

#### Task 6A: Define OAuth And Reauth State Record

Description: Define the single-use OAuth/hosted reauth state model used by
portal first-time connect and platform-owned reauth attempts.

State shape:

```text
BrokerAuthAttempt
  id
  tenant_id
  workspace_id
  subject_id
  provider
  connection_id
  attempt_kind: first_connect | platform_reauth | full_reconnect
  state_hash
  pkce_verifier_envelope_id
  return_path
  origin
  requested_scopes
  status
  expires_at
  consumed_at
  failure_count
  created_at
  updated_at
```

State rules:

- Raw state values are stored hashed; PKCE verifier uses the credential
  envelope policy from Task 5B.
- Attempt is bound to tenant, workspace, subject, provider, origin, return
  path, requested scopes, and attempt kind.
- Attempts are single-use, expiring, bounded by failure count, and cancellable.
- Platform-owned reauth can update an existing connection only when the active
  attempt and provider callback both validate.

Acceptance criteria:

- Same record family supports first connect, platform reauth, and full
  reconnect/setup reset.
- Replay, expired, wrong tenant, wrong user, wrong provider, wrong origin,
  wrong return path, and wrong attempt-kind callbacks fail closed.
- Failed callback attempts are rate-limited or bounded.
- Attempt success does not activate automation; it only enters sync and
  reconciliation gates.

Verification:

- Future unit tests cover valid, expired, replayed, wrong-user, wrong-provider,
  wrong-origin, wrong-return-path, cancelled, and over-failure-limit attempts.

Likely implementation files later:

- `lib/db/src/schema/broker.ts`
- `artifacts/api-server/src/services/broker-auth-attempts.ts`
- `artifacts/api-server/src/services/broker-auth-attempts.test.ts`

Dependencies: Tasks 4A-5C

Estimated scope: Medium

#### Task 6B: Define OAuth Callback Validation Boundary

Description: Define how callback query/body payloads are validated and
normalized before creating connections, refreshing credentials, or updating
auth attempt state.

Validation pipeline:

```text
parse_callback_input
validate_state_hash
load_active_attempt
verify_attempt_binding
exchange_code_or_provider_artifact
validate_provider_token_response
store_credential_envelope
sync_connection_and_accounts
record_audit_and_activity
redirect_or_render_safe_result
```

Acceptance criteria:

- Callback payloads are treated as external input even when received after
  browser redirect.
- Provider token responses are validated before storage.
- Browser session presence alone is not sufficient to authorize callback
  mutation.
- Callback errors return customer-safe states and do not expose provider raw
  errors or internal stack details.

Verification:

- Future route tests cover callback payload validation and response redaction.
- Future provider fixture tests cover malformed token responses and provider
  error responses.

Likely implementation files later:

- `artifacts/api-server/src/routes/portal.ts` or portal route file discovered
  before implementation
- `artifacts/api-server/src/routes/platform.ts`
- `artifacts/api-server/src/services/broker-auth-callback.ts`

Dependencies: Task 6A

Estimated scope: Medium

#### Task 6C: Define Auth Attempt Cleanup And Recovery Policy

Description: Define cleanup, cancellation, user recovery, and support-safe
diagnostic behavior for incomplete or failed broker auth attempts.

Policy:

- Expired attempts are inert and can be cleaned by background job.
- Cancelled attempts cannot be resumed or consumed.
- Multiple active attempts for the same tenant/user/provider/connection are
  either blocked or superseded explicitly; silent last-write-wins is forbidden.
- Recoverable states expose customer-safe next actions: retry, reauth, full
  reconnect, contact support, or wait for sync.
- Failed provider exchange never deletes an existing valid credential unless a
  revoke/disconnect is confirmed.

Acceptance criteria:

- Cleanup does not remove audit evidence needed to explain auth failures.
- User recovery paths are distinct for first connect, platform reauth, and full
  reconnect/setup reset.
- Existing valid connection remains usable or safely blocked according to
  Phase 0/1 launch and permission rules.

Verification:

- Future tests cover expired cleanup, cancelled attempt, superseded attempt,
  failed exchange with existing credential, and safe recovery messages.

Likely implementation files later:

- `artifacts/api-server/src/services/broker-auth-attempt-cleanup.ts`
- `artifacts/api-server/src/services/broker-reauth.ts`
- `artifacts/api-server/src/services/customer-activity.ts`

Dependencies: Tasks 6A-6B

Estimated scope: Small

### Checkpoint: Phase 2 Security Foundation Ready

- Principal, tenant, and workspace contracts are stable.
- Ownership migration/backfill plan covers broker, order, execution, strategy,
  subscription, audit, and activity data.
- Request authorization matrix covers portal, platform, service, stream, and
  legacy route families.
- Legacy generic route containment is documented before customer exposure.
- Secret classification, encrypted credential envelope, access service,
  redaction policy, and OAuth state model are stable.
- OAuth/reauth callback validation and cleanup policies fail closed.
- Implementation remains blocked until the final full-plan checkpoint is
  accepted.

### Phase 2 Backlog-Ready Execution Packets

Use these packets only after the full multi-phase planning pass is accepted.

#### Packet P2-4A: Principal And Workspace Contract

Goal: define authenticated principal and workspace context without changing
runtime route behavior.

Implementation sequence:

1. Add principal/workspace types and decision codes.
2. Add derivation helpers for portal, platform, and service contexts.
3. Add tests for server-authoritative tenant/workspace derivation.
4. Document unresolved support/admin access as out of scope.

Exit criteria:

- Principal contract exists and does not trust request body/query tenant ids.
- Portal, platform, and service contexts are represented separately.

#### Packet P2-4B: Ownership Schema And Backfill Plan

Goal: add tenant/workspace ownership to the data model safely.

Implementation sequence:

1. Inventory broker/order/execution/strategy/audit tables and current
   uniqueness constraints.
2. Add tenant/workspace owner columns and default-local backfill path.
3. Update schema tests before route consumers are changed.
4. Tighten constraints only after all readers/writers use owner columns.

Exit criteria:

- Customer data tables have planned or implemented tenant/workspace ownership.
- Backfill and rollback posture are documented per table family.

#### Packet P2-4C: Authorization Middleware And Route Matrix

Goal: make route/service authorization reusable and testable.

Implementation sequence:

1. Add route-family authorization helpers.
2. Wire helper tests against fixture principals and resources.
3. Apply helpers to a narrow route family only after tests pass.
4. Keep generic route customer exposure blocked until Task 4D classification.

Exit criteria:

- Ownership lookup happens before provider calls or order mutations.
- Cross-tenant ids fail without leaking resource existence.

#### Packet P2-4D: Legacy Route Containment Audit

Goal: prevent generic legacy broker/order routes from becoming accidental
customer v1 APIs.

Implementation sequence:

1. Generate or manually maintain a route inventory.
2. Classify every broker/account/order/execution/stream/algo route family.
3. Add audit/test guard for missing classification.
4. Update OpenAPI notes for public versus migration/internal surfaces.

Exit criteria:

- Every relevant legacy route has a classification and owner-check strategy.
- Customer execution routes remain under `/api/platform/...`.

#### Packet P2-5A-5D: Secret Custody Foundation

Goal: define and implement encrypted credential custody without exposing raw
secrets to routes, logs, audit, or clients.

Implementation sequence:

1. Land secret/sensitive-identifier classification and redaction fixtures.
2. Add encrypted credential envelope schema and key-version metadata.
3. Add credential access service for adapter-only decrypt.
4. Add rotation/revoke/decryption-failure tests.
5. Add public-response and generated-client scans for raw secret fields.

Exit criteria:

- Raw broker credentials can be stored only as encrypted envelopes.
- Route handlers cannot return or log decrypted token material.

#### Packet P2-6A-6C: OAuth And Reauth Attempt Store

Goal: make broker auth attempts single-use, tenant-bound, replay-safe, and
recoverable.

Implementation sequence:

1. Add auth-attempt data model and hashed-state rules.
2. Add callback validation pipeline tests.
3. Add cleanup/cancel/supersede policy tests.
4. Integrate with portal first connect and platform reauth only after contract
   tests pass.

Exit criteria:

- Callback validation fails closed for replay, mismatch, expiry, and malformed
  provider responses.
- Auth success enters sync/reconciliation gates, not automation activation.

### Phase 3: Broker Adapter Core

Objective: create the broker adapter boundary that lets PYRUS normalize
accounts, positions, orders, executions, provider health, and account-native
capabilities without leaking provider data models into public APIs or UI. V1
private beta is multi-provider first: preserve existing IBKR behavior and prove
one SnapTrade-backed non-IBKR execution path before customer beta readiness.
This phase still must not add UI migration or new automated trading behavior
until adapter contracts and fixture tests pass.

Observed repo anchors for implementation planning:

- `artifacts/api-server/src/services/platform.ts` currently owns generic
  account/order service functions such as `listOrders`, `previewOrder`,
  `placeOrder`, `replaceOrder`, `cancelOrder`, and `listExecutions`.
- `artifacts/api-server/src/services/account.ts` currently reads broker account,
  position, order, and execution state for account screens.
- `artifacts/api-server/src/services/ibkr-account-bridge.ts`,
  `bridge-order-read-state.ts`, and `ibkr-bridge-runtime.ts` are likely IBKR
  bridge anchors.
- Existing generated OpenAPI types include IBKR and generic order shapes; they
  must not define the provider-agnostic adapter contract by accident.

Phase 3 dependency graph:

```text
Task 7A normalized adapter domain types
  -> Task 7B BrokerAdapter method contract
    -> Task 7C adapter registry and routing policy
      -> Task 7D provider validation and error/status normalization
        -> Task 8 IBKR adapter wrapping
        -> Task 9 SnapTrade-backed first non-IBKR adapter lane
          -> Phase 4 order ledger and reconciliation
```

Phase 3 non-negotiables:

- Provider APIs and responses are external input; validate and normalize them at
  the adapter boundary.
- Adapter contract does not require broker market-data reads for customer v1.
- Raw provider payloads may be stored internally for compliance/debug only when
  redacted and access-controlled; they are not public API shapes.
- Account-native capability maps are output of adapters, not static provider
  assumptions.
- Multi-provider private beta requires the IBKR special connector and one
  SnapTrade-backed execution path to pass the same adapter, capability,
  order-ledger, and reconciliation contracts.
- Existing IBKR order confirmation and readiness guards remain intact during
  wrapping.

#### Task 7A: Define Normalized Adapter Domain Types

Description: Define the provider-independent types adapters exchange with
PYRUS services before any provider implementation is wired.

Core types:

```text
NormalizedBrokerConnection
NormalizedBrokerAccount
NormalizedBrokerPosition
NormalizedBrokerOrder
NormalizedBrokerExecution
NormalizedAccountBalance
NormalizedOrderPreview
NormalizedProviderHealth
NormalizedProviderError
BrokerAccountCapabilityMap
OrderIntent
ProviderOrderReference
```

Type rules:

- PYRUS ids and provider ids are separate fields.
- Full account numbers and sensitive provider identifiers are not normalized
  public fields.
- Monetary values include currency and precision semantics.
- Timestamps identify provider time versus PYRUS observed/ingested time.
- Option contract identity uses normalized instrument/contract fields and does
  not rely on provider-specific descriptions.

Acceptance criteria:

- Types cover account identity, balances, positions, open orders, historical
  orders, executions, previews, cancel/replace, health, and capability sync.
- Types can represent stocks and single-leg options v1 without committing to
  multi-leg options.
- Types carry enough metadata for audit/reconciliation without exposing raw
  provider payloads.
- Types separate read freshness, order status freshness, and execution/fill
  freshness.

Verification:

- Future type/fixture tests prove IBKR-shaped data and aggregator-shaped data
  can normalize into the same types.
- Future redaction tests prove normalized public objects omit raw secrets and
  full account identifiers.

Likely implementation files later:

- `artifacts/api-server/src/services/broker-adapter-types.ts`
- `artifacts/api-server/src/services/broker-adapter-types.test.ts`
- `artifacts/api-server/src/services/option-order-intent.ts`

Dependencies: Phase 2 and Phase 1 Tasks 1A-1C

Estimated scope: Medium

#### Task 7B: Define BrokerAdapter Method Contract

Description: Define the interface that provider adapters implement for
connection health, account sync, capability sync, preview, submit, cancel,
replace, order reads, execution reads, and reconciliation support.

Adapter interface:

```text
BrokerAdapter
  provider
  adapter_kind
  getHealth(context)
  listAccounts(context)
  syncAccountCapabilities(context, brokerAccountId)
  listPositions(context, brokerAccountId)
  listOrders(context, brokerAccountId, filters)
  listExecutions(context, brokerAccountId, filters)
  previewOrder(context, orderIntent)
  submitOrder(context, orderIntent, idempotency)
  cancelOrder(context, orderReference, confirmation)
  replaceOrder(context, orderReference, replacementIntent, confirmation)
  reconcileOrder(context, orderReference)
```

Method rules:

- Methods receive authorized context and credential access handles; they do not
  perform route/session authorization.
- Methods return normalized results or normalized provider errors.
- Submit/cancel/replace require idempotency and confirmation inputs from Phase
  4 gate logic.
- Market-data methods are absent from the required v1 interface.
- Unsupported methods return normalized unsupported-capability results, not
  ad hoc thrown strings.

Acceptance criteria:

- Interface covers the v1 order lifecycle needed by terminal and automation
  paths.
- Interface keeps provider-specific request construction behind adapter files.
- Interface supports providers with no preview or no order stream through
  explicit capability/freshness metadata.
- Interface is narrow enough that a read-only provider can implement read
  methods but still fail activation.

Verification:

- Future type tests or fixture adapters compile against the interface.
- Future contract tests cover unsupported methods, stale reads, provider
  rejection, provider timeout, and unknown status.

Likely implementation files later:

- `artifacts/api-server/src/services/broker-adapter.ts`
- `artifacts/api-server/src/services/broker-adapter.test.ts`
- `artifacts/api-server/src/services/broker-adapters/*`

Dependencies: Task 7A

Estimated scope: Medium

#### Task 7C: Define Adapter Registry And Routing Policy

Description: Define how services resolve the correct adapter by tenant-owned
broker connection/account without letting provider ids or request params choose
provider behavior directly.

Registry contract:

```text
BrokerAdapterRegistry
  getAdapterForConnection(tenant_id, connection_id)
  getAdapterForAccount(tenant_id, broker_account_id)
  assertAdapterKindAllowed(provider, adapter_kind)
  listRegisteredAdapters()
```

Routing rules:

- Registry lookup starts from tenant-owned PYRUS `broker_connection_id` or
  `broker_account_id`.
- Provider and adapter kind come from trusted stored connection metadata after
  ownership check.
- Request payloads cannot override provider, account environment, or adapter
  kind.
- Registry exposes capability to background jobs and route services through the
  same lookup path.
- Missing adapter, disabled provider, or mismatched adapter kind fails closed.

Acceptance criteria:

- Route services, jobs, and reconciliation use the same adapter resolution
  policy.
- Registry can route IBKR special connector and future aggregator/direct OAuth
  adapters without changing public API shape.
- Registry emits audit-safe error codes for missing/disabled/mismatched
  adapters.

Verification:

- Future tests cover account-owned lookup, cross-tenant rejection, disabled
  adapter, missing adapter, and request-provider spoofing.

Likely implementation files later:

- `artifacts/api-server/src/services/broker-adapter-registry.ts`
- `artifacts/api-server/src/services/broker-adapter-registry.test.ts`
- `artifacts/api-server/src/services/authorization.ts`

Dependencies: Tasks 4C, 7A, and 7B

Estimated scope: Small

#### Task 7D: Define Provider Response Validation And Error Mapping

Description: Define the adapter-boundary validation and normalized error/status
mapping for third-party provider responses, including malformed payloads,
timeouts, unknown order states, and provider-specific limitations.

Validation targets:

```text
account list response
capability response
position response
order list response
execution/fill response
preview response
submit response
cancel/replace response
token/reauth response
health response
```

Normalized provider outcomes:

```text
provider_success
provider_rejected
provider_unauthorized
provider_rate_limited
provider_timeout_unknown
provider_unavailable
provider_malformed_response
provider_capability_unsupported
provider_account_restricted
provider_reauth_required
```

Acceptance criteria:

- Every adapter method validates external provider output before service logic
  trusts it.
- Provider errors map to stable PYRUS decision/error codes and customer-safe
  message keys.
- Timeout/unknown submit outcomes are never retried blindly; they flow into
  Phase 4 reconciliation.
- Malformed provider payloads create internal diagnostics and fail closed.

Verification:

- Future fixture tests cover malformed payloads, missing required fields,
  unknown enum values, timeout, unauthorized, rate limit, and provider
  limitation responses.
- Future redaction tests prove provider raw errors are not customer-visible.

Likely implementation files later:

- `artifacts/api-server/src/services/provider-response-validation.ts`
- `artifacts/api-server/src/services/provider-error-normalizer.ts`
- `artifacts/api-server/src/services/provider-error-normalizer.test.ts`

Dependencies: Tasks 7A-7B and Phase 2 secret/redaction policy

Estimated scope: Medium

#### Task 8A: Inventory Existing IBKR Read And Order Behavior

Description: Create a source-confirmed inventory of existing IBKR account,
position, order, preview, submit, cancel, replace, health, readiness, and live
confirmation behavior before wrapping it as an adapter.

Inventory targets:

```text
account list
positions
orders
executions
preview
submit
raw submit
replace
cancel
bridge health
gateway readiness
live confirmation
remote activation
streams
```

Acceptance criteria:

- Inventory names current service functions, routes, generated OpenAPI paths,
  tests, and known safety guards.
- Inventory identifies which behavior is provider adapter behavior versus
  legacy route behavior.
- Existing live confirmation and Gateway readiness requirements are documented
  as invariants.
- Raw IBKR payload submit paths are marked migration/internal and not new
  customer v1 public contract.

Verification:

- Future review compares inventory against `platform.ts`, account services,
  IBKR bridge services, OpenAPI, and existing tests.

Likely implementation files later:

- `artifacts/api-server/src/services/platform.ts`
- `artifacts/api-server/src/services/account.ts`
- `artifacts/api-server/src/services/ibkr-account-bridge.ts`
- `artifacts/api-server/src/services/bridge-order-read-state.ts`
- `lib/api-spec/openapi.yaml`

Dependencies: Tasks 7A-7D

Estimated scope: Small

#### Task 8B: Wrap IBKR Account And Read Methods

Description: Move IBKR account, position, order, execution, balance, and health
reads behind the adapter interface while preserving existing runtime behavior.

Acceptance criteria:

- Adapter read methods produce normalized account, position, order, execution,
  balance, health, and capability results.
- Existing account and platform screens can still read their current data while
  migration is in progress.
- Capability sync derives account-native readiness from IBKR/Gateway facts and
  current PYRUS order-capability diagnostics.
- IBKR bridge/Gateway availability remains a readiness input, not a tenant
  authorization substitute.

Verification:

- Future existing IBKR bridge tests continue to pass.
- Future adapter fixture tests compare current IBKR read fixtures to normalized
  adapter outputs.
- Future route tests prove read methods still require tenant/account authority
  once Phase 2 middleware is wired.

Likely implementation files later:

- `artifacts/api-server/src/services/broker-adapters/ibkr.ts`
- `artifacts/api-server/src/services/ibkr-account-bridge.ts`
- `artifacts/api-server/src/services/account.ts`
- `artifacts/api-server/src/services/platform.ts`

Dependencies: Task 8A

Estimated scope: Medium

#### Task 8C: Wrap IBKR Preview, Submit, Cancel, And Replace

Description: Move IBKR order preview, submit, cancel, and replace behavior
behind adapter methods without weakening confirmation, readiness, idempotency,
or provider-status handling.

Acceptance criteria:

- Adapter methods accept normalized `OrderIntent` and return normalized preview,
  submit, cancel, replace, and provider-reference results.
- Existing terminal live confirmation guard remains required for live terminal
  order submit/cancel/replace.
- Raw IBKR payload paths remain migration/internal and are not exposed as the
  public customer v1 order contract.
- Timeout/unknown outcomes are handed to Phase 4 order ledger/reconciliation
  semantics.

Verification:

- Future tests cover preview allowed/blocked, submit accepted/rejected,
  cancel/replace confirmation required, Gateway not ready, and unknown timeout.
- Future regression tests prove existing IBKR route behavior is preserved until
  intentionally migrated.

Likely implementation files later:

- `artifacts/api-server/src/services/broker-adapters/ibkr.ts`
- `artifacts/api-server/src/services/platform.ts`
- `artifacts/api-server/src/services/option-order-intent.ts`
- `artifacts/api-server/src/routes/platform.ts`

Dependencies: Tasks 8A-8B and Phase 4 ledger contract before live mutation
wiring

Estimated scope: Medium

#### Task 8D: Preserve IBKR Special Connector Boundaries

Description: Keep IBKR Gateway/remote activation/helper flows as an explicit
special connector while the general SaaS customer path uses portal
broker-hosted/OAuth first connect and platform-owned hosted reauth where
supported.

Acceptance criteria:

- IBKR activation, remote desktop, helper bundle, and Gateway health routes are
  classified as `ibkr_special_connector_route` or internal migration routes.
- IBKR-specific setup friction does not leak into direct OAuth or aggregator
  provider contract assumptions.
- Platform session and tenant authorization still apply before customer-owned
  account/order state is exposed through IBKR-backed adapter reads.
- Existing IBKR support diagnostics remain internal/support-safe and redacted.

Verification:

- Future route inventory proves IBKR special connector routes are classified.
- Future docs review proves IBKR exception does not weaken Phase 0/1 portal and
  platform boundaries.

Likely implementation files later:

- `artifacts/api-server/src/services/ibkr-bridge-runtime.ts`
- `artifacts/api-server/src/routes/platform.ts`
- `docs/decisions/ADR-002-automation-first-broker-scope-permission.md`

Dependencies: Tasks 4D and 8A

Estimated scope: Small

#### Task 9A: Define SnapTrade-Backed First Non-IBKR Adapter Contract

Description: Define the first non-IBKR private-beta adapter lane for an
aggregator-backed broker connection using SnapTrade as the first candidate
without binding PYRUS public APIs to SnapTrade's object model.

Aggregator shell fields:

```text
aggregator_connection_ref
aggregator_account_ref
underlying_provider
provider_account_ref
selected_brokerage_fixture_ref
capability_evidence
token_custody_model
reauth_model
webhook_or_polling_model
```

Acceptance criteria:

- Aggregator references are stored as provider/internal references, not PYRUS
  ids or public account ids.
- Shell can represent direct submit/cancel/replace support, read-only links,
  paper/demo links, and provider-specific restrictions.
- Shell requires provider/account capability sync before activation.
- Shell does not assume aggregator market-data scope is needed for PYRUS market
  data.
- Shell is not private-beta eligible until a specific aggregator row has
  current official source refs, a named selected-brokerage/account fixture for
  stocks and single-leg options, capability fixtures, token/reference custody
  review, and compliance/product sign-off.
- Generic SnapTrade capability is insufficient. The adapter lane must prove the
  selected underlying brokerage/account can submit, observe, cancel/replace,
  and reconcile the supported order shapes before Phase 3 can pass.
- The selected brokerage/account fixture choice is deferred to the Phase 3
  research spike; until that spike names and proves the fixture, SnapTrade stays
  `PROVIDER_RESEARCH_REQUIRED`.
- If SnapTrade fails the safety/compliance bar, Phase 3 provider research must
  choose and classify the replacement lane from current official docs instead
  of inheriting a preselected backup aggregator.
- SnapTrade user, connection, account, order, and option-order references remain
  internal provider references. PYRUS routes and public IDs stay PYRUS-owned.

Verification:

- Future fixture tests cover eligible, read-only, submit-only, paper-only,
  missing fills, no cancel/replace, no options, and stale account states.

Likely implementation files later:

- `artifacts/api-server/src/services/broker-adapters/aggregator-shell.ts`
- `artifacts/api-server/src/services/provider-capability-normalizer.ts`
- `docs/plans/broker-provider-classification-matrix.md`

Dependencies: Tasks 7A-7D and Phase 2 credential access service

Estimated scope: Medium

#### Task 9B: Define Provider Reference And Identity Mapping

Description: Define how aggregator/provider ids map to PYRUS
`BrokerConnection`, `BrokerAccount`, `OrderIntent`, provider order references,
and audit correlations without exposing raw provider identifiers publicly.

Mapping rules:

- PYRUS resource ids are primary for API routes and authorization.
- Provider connection/account/order/execution ids are internal references scoped
  to tenant and provider.
- Customer-safe labels are separate from provider account numbers.
- Hashes may be used for audit correlation when deterministic matching is
  useful and safe.
- Provider id collisions are scoped by tenant, provider, adapter kind, and
  connection.

Acceptance criteria:

- Mapping supports account sync, order submit, cancel/replace, executions,
  reconciliation, and audit correlation.
- Provider references cannot be used alone to read or mutate tenant resources.
- Deleting/disconnecting a broker connection preserves audit history and
  reconciliation evidence according to retention policy.

Verification:

- Future tests cover provider id collision, cross-tenant spoofing,
  disconnect/reconnect, and audit correlation.

Likely implementation files later:

- `lib/db/src/schema/broker.ts`
- `lib/db/src/schema/trading.ts`
- `artifacts/api-server/src/services/provider-reference-map.ts`

Dependencies: Tasks 4B and 9A

Estimated scope: Medium

#### Task 9C: Define Insufficient-Capability Aggregator Behavior

Description: Define fail-closed behavior for aggregator/provider links that
connect successfully but cannot satisfy automation-grade execution.

Insufficient states:

```text
read_only
submit_only
paper_only
demo_only
no_order_read
no_execution_read
no_cancel_replace
no_options_support
stale_or_unknown_capabilities
provider_reauth_required
provider_account_restricted
```

Acceptance criteria:

- Insufficient links can appear in portal/platform status views but cannot
  become `automation_trading_connection`.
- Each state maps to normalized capability/scope/permission decision codes and
  customer-safe copy keys.
- Provider limitations do not silently downgrade strategy behavior.
- Recoverable states point to reauth, full reconnect, or wait-for-sync as
  appropriate.

Verification:

- Future fixture tests map every insufficient state to launch, activation, and
  order-gate outcomes.

Likely implementation files later:

- `artifacts/api-server/src/services/provider-capability-normalizer.ts`
- `artifacts/api-server/src/services/execution-support-decision.ts`
- `artifacts/api-server/src/services/broker-permission-copy.ts`

Dependencies: Tasks 2C, 7D, and 9A

Estimated scope: Small

### Checkpoint: Phase 3 Broker Core Ready

- Normalized adapter domain types and method contract are stable.
- Adapter registry routes only through tenant-owned PYRUS connection/account
  ids.
- Provider response validation and error/status mapping fail closed.
- Existing IBKR behavior is inventoried and can be wrapped without weakening
  readiness or confirmation guards.
- IBKR special connector routes stay explicit exceptions.
- Aggregator shell behavior supports eligible and insufficient-capability
  fixtures without changing PYRUS public API shape.
- No UI migration or live order behavior starts until Phase 4 order ledger and
  reconciliation planning are detailed.

### Phase 3 Backlog-Ready Execution Packets

Use these packets only after the full multi-phase planning pass is accepted.

#### Packet P3-7A-7D: Adapter Contract Foundation

Goal: define provider-independent adapter types, methods, registry, validation,
and error mapping.

Implementation sequence:

1. Add normalized adapter domain types with fixture examples.
2. Add `BrokerAdapter` interface and unsupported-method semantics.
3. Add registry lookup by tenant-owned connection/account id.
4. Add provider response validation and error mapping fixtures.
5. Run typecheck and adapter fixture tests before any provider wrapping.

Exit criteria:

- Adapters can be tested without route or UI changes.
- Provider raw payloads and errors are normalized or redacted at the boundary.

#### Packet P3-8A-8D: IBKR Adapter Wrapping

Goal: wrap existing IBKR behavior behind the adapter contract while preserving
runtime behavior and special connector boundaries.

Implementation sequence:

1. Inventory current IBKR routes, services, generated types, and tests.
2. Wrap read/health/capability methods first.
3. Wrap preview/submit/cancel/replace only after Phase 4 ledger contracts are
   ready for mutation paths.
4. Classify IBKR activation/helper routes as special connector/internal
   surfaces.
5. Run existing IBKR tests plus adapter fixture tests.

Exit criteria:

- Existing IBKR behavior is preserved.
- IBKR routes do not become the general customer SaaS broker contract.

#### Packet P3-9A-9C: SnapTrade-Backed First Non-IBKR Adapter Lane

Goal: add the first non-IBKR SnapTrade-backed adapter lane and
insufficient-capability fixtures without leaking SnapTrade object models into
PYRUS public APIs.

Implementation sequence:

1. Add shell types for aggregator/provider references and token custody model.
2. Add provider reference mapping rules and collision tests.
3. Add insufficient-capability fixtures.
4. Run the SnapTrade fixture-selection research spike using official docs,
   account availability, and current brokerage support evidence; choose one
   named brokerage/account fixture that supports stocks and single-leg options,
   then run capability fixtures, token/reference custody review, and
   compliance/product sign-off.
5. If SnapTrade fails, run fallback provider research before naming a
   replacement lane. Evaluate another aggregator, direct OAuth, and embedded
   brokerage/BaaS candidates from current official docs and classify the chosen
   path explicitly.

Exit criteria:

- SnapTrade-backed data can be normalized in fixtures for the selected
  first-wave brokerage/account candidate, and the fixture proves stocks and
  single-leg options.
- The fixture-selection spike records the selected brokerage/account, rejected
  alternatives, source refs, and unresolved provider limitations.
- The fallback-provider spike records why SnapTrade failed, which lane type
  replaces it if any, rejected alternatives, source refs, and unresolved
  provider limitations.
- Read-only, submit-only, paper/demo, stale, and restricted states fail closed.

### Phase 4: Order Safety And Reconciliation

Objective: make every terminal and automated order durable, idempotent,
auditable, and reconcilable before it can reach a broker adapter. This phase is
where PYRUS prevents duplicate submits, blind retries, stale-state automation,
and unexplainable order outcomes.

Observed repo anchors for implementation planning:

- `lib/db/src/schema/trading.ts` already has `order_requests`,
  `broker_orders`, and `execution_fills`, but they are not yet the full
  tenant/workspace-owned order intent ledger described here.
- `artifacts/api-server/src/services/platform.ts` currently contains order
  list/preview/place/submit/replace/cancel service functions.
- `artifacts/api-server/src/services/option-order-intent.ts` is a likely anchor
  for normalized option order intent work.
- `artifacts/api-server/src/services/signal-options-automation.ts` and
  `artifacts/api-server/src/services/overnight-spot-execution.ts` are likely
  automation order-source anchors that must eventually use the same ledger and
  gate family.

Phase 4 dependency graph:

```text
Task 10A OrderIntent and order source contract
  -> Task 10B order intent ledger schema and idempotency
    -> Task 10C pre-submit audit and mutation transaction
      -> Task 11 provider attempt timeline
        -> Task 12A reconciliation state model
          -> Task 12B reconciliation worker orchestration
            -> Task 12C divergence pause policy
              -> Task 12D manual reconcile endpoint
                -> Phase 5 UI and strategy subscription flows
```

Phase 4 non-negotiables:

- Persist order intent before any provider submit/cancel/replace call.
- Never retry an unknown/timeout provider mutation blindly.
- Idempotency is tenant/account/source scoped and must survive process restart.
- Unknown order, execution, position, or account state fails closed for
  automation and triggers reconciliation.
- Terminal orders and automated orders share the same safety ledger, but
  terminal live orders still require per-order confirmation.

#### Task 10A: Define Normalized OrderIntent And Source Contract

Description: Define the normalized order intent model shared by terminal order
tickets, strategy automation, exits, cancel/replace, and reconciliation.

Order intent shape:

```text
OrderIntent
  id
  tenant_id
  workspace_id
  broker_account_id
  trading_permission_id
  source: terminal | strategy_subscription | system_exit | reconciliation
  source_ref
  asset_class
  symbol
  option_contract
  side
  position_effect
  quantity
  quantity_kind
  order_type
  limit_price
  stop_price
  time_in_force
  trading_session
  route
  client_order_id
  idempotency_key
  requires_confirmation
  confirmation_ref
  risk_snapshot
  capability_decision
  gate_decision
  created_by
  created_at
```

Source rules:

- `terminal` source always requires live per-order confirmation for live broker
  mutation.
- `strategy_subscription` source requires `automation_active` permission,
  subscription caps, and current strategy signal provenance.
- `system_exit` source is allowed only through explicit risk/kill-switch policy
  and must still use order gates.
- `reconciliation` source cannot create new market exposure; it can record
  repair/management actions only if separately allowed.

Acceptance criteria:

- Order intent can represent stocks and single-leg options v1.
- Unsupported spreads/combo orders are rejected before provider payload
  creation.
- Source-specific fields do not let clients bypass gate outputs.
- Market data inputs are PYRUS-internal snapshots, not broker market-data scope
  requirements by default.

Verification:

- Future tests cover terminal stock, terminal option, strategy option,
  unsupported spread, missing confirmation, and stale gate snapshot intents.

Likely implementation files later:

- `artifacts/api-server/src/services/order-intent.ts`
- `artifacts/api-server/src/services/option-order-intent.ts`
- `artifacts/api-server/src/services/execution-gate-decision.ts`
- `lib/api-spec/openapi.yaml`

Dependencies: Phase 1 Tasks 1C and 3C; Phase 3 Task 7A

Estimated scope: Medium

#### Task 10B: Define Order Intent Ledger And Idempotency

Description: Define the durable database ledger that records order intent,
idempotency, gate outcomes, and lifecycle state before adapter mutation.

Ledger shape:

```text
order_intents
  id
  tenant_id
  workspace_id
  broker_account_id
  trading_permission_id
  source
  source_ref
  client_order_id
  idempotency_key_hash
  normalized_intent
  gate_decision_code
  capability_decision_code
  status
  submitted_at
  terminal_at
  blocked_reason
  created_by
  created_at
  updated_at
```

Ledger statuses:

```text
created
blocked
ready_to_submit
submitting
provider_accepted
provider_rejected
unknown_pending_reconciliation
cancel_requested
replace_requested
terminal_filled
terminal_cancelled
terminal_rejected
terminal_failed
reconciled
```

Idempotency rules:

- Uniqueness is scoped by `tenant_id`, `broker_account_id`, `source`, and
  `idempotency_key_hash`.
- Duplicate idempotency key with same normalized intent returns the existing
  order intent status.
- Duplicate idempotency key with different normalized intent returns conflict.
- Idempotency key is not a broker order id and must not be reused across order
  sources accidentally.

Acceptance criteria:

- Order intent persists before provider mutation.
- Ledger stores normalized intent and decision codes, not raw provider payloads.
- Duplicate submit behavior is deterministic and restart-safe.
- Status transitions are explicit and auditable.

Verification:

- Future schema tests cover uniqueness and tenant/account scoping.
- Future unit tests cover duplicate same intent, duplicate changed intent,
  blocked intent, and restart-safe pending submit.

Likely implementation files later:

- `lib/db/src/schema/trading.ts`
- `artifacts/api-server/src/services/order-intent-ledger.ts`
- `artifacts/api-server/src/services/order-intent-ledger.test.ts`

Dependencies: Task 10A and Phase 2 ownership schema

Estimated scope: Medium

#### Task 10C: Define Pre-Submit Transaction And Audit Durability

Description: Define the transaction boundary that evaluates gates, writes the
order intent, writes audit, and only then calls the adapter for provider
mutation.

Pre-submit sequence:

```text
authorize principal and account
load trading permission and caps
load capability/freshness snapshots
evaluate execution gates
write order_intent
write audit event
commit durable pre-submit state
call adapter mutation
write provider attempt result
schedule reconciliation if needed
```

Acceptance criteria:

- Provider mutation is impossible before durable order intent and audit writes
  succeed.
- Audit durability failure blocks live submit/cancel/replace.
- Gate decision inputs are stored with redacted normalized metadata.
- Failed adapter calls update ledger state without losing the original intent.

Verification:

- Future tests cover audit write failure, DB transaction failure, adapter
  failure after commit, and provider call skipped when gate blocks.

Likely implementation files later:

- `artifacts/api-server/src/services/order-mutation-service.ts`
- `artifacts/api-server/src/services/audit-events.ts`
- `artifacts/api-server/src/services/execution-gate-decision.ts`

Dependencies: Tasks 10A-10B and Phase 0 Task 0E

Estimated scope: Medium

#### Task 11A: Define Provider Order Attempt Timeline

Description: Define the append-only provider mutation attempt timeline for
submit, cancel, replace, and provider-side order management outcomes.

Attempt shape:

```text
provider_order_attempts
  id
  tenant_id
  workspace_id
  order_intent_id
  broker_account_id
  provider
  adapter_kind
  action: submit | cancel | replace | reconcile
  request_hash
  provider_order_ref
  provider_execution_refs
  normalized_result
  normalized_error_code
  raw_payload_ref
  started_at
  completed_at
  observed_at
```

Acceptance criteria:

- Attempts are append-only; corrections are represented by later events.
- Request hash excludes secrets but can prove request equivalence.
- Provider order refs are internal and scoped to tenant/provider/account.
- Unknown/timeout attempts are marked for reconciliation, not retry.

Verification:

- Future tests cover success, provider rejection, timeout unknown, malformed
  provider response, cancel accepted, replace accepted, and duplicate provider
  ref.

Likely implementation files later:

- `lib/db/src/schema/trading.ts`
- `artifacts/api-server/src/services/provider-order-attempts.ts`
- `artifacts/api-server/src/services/provider-order-attempts.test.ts`

Dependencies: Task 10C and Phase 3 adapter error mapping

Estimated scope: Medium

#### Task 11B: Define No-Blind-Retry And Unknown-State Policy

Description: Define the safety behavior for provider mutations where PYRUS
cannot prove whether the broker accepted, rejected, filled, cancelled, or
replaced the order.

Unknown-state rules:

- Submit timeout after provider call enters `unknown_pending_reconciliation`.
- Cancel/replace timeout blocks further management of that order until
  reconciliation or manual review.
- Automation pauses for affected account/subscription when unknown state could
  create duplicate or unmanaged exposure.
- Terminal UI shows pending reconciliation and blocks duplicate submit with the
  same idempotency key.
- Retry is allowed only after reconciliation proves no broker-side mutation or
  after a new human-confirmed corrective action is created.

Acceptance criteria:

- Unknown state has a distinct ledger status and audit decision code.
- No source path can call adapter submit twice for the same unresolved intent.
- Automation pause reason is machine-readable and customer-safe.
- Manual/support recovery path is named but not treated as automatic retry.

Verification:

- Future tests cover submit timeout, cancel timeout, replace timeout, duplicate
  submit after unknown, and reconciliation-cleared retry.

Likely implementation files later:

- `artifacts/api-server/src/services/order-mutation-service.ts`
- `artifacts/api-server/src/services/reconciliation-policy.ts`
- `artifacts/api-server/src/services/signal-options-automation.ts`

Dependencies: Task 11A

Estimated scope: Small

#### Task 11C: Define Provider Status Normalization

Description: Define how provider-native order, execution, cancel, replace, and
rejection statuses map into PYRUS normalized order lifecycle state.

Normalized lifecycle families:

```text
pre_submit
working
partially_filled
filled
pending_cancel
cancelled
pending_replace
replaced
rejected
expired
unknown
```

Mapping rules:

- Provider statuses map to normalized family plus provider-specific internal
  detail.
- Partial fills update execution/fill records and remaining quantity.
- Replace creates a linked successor/predecessor relationship where the broker
  exposes one.
- Cancel rejection leaves the order working unless provider proves otherwise.
- Unknown or unrecognized statuses fail closed for automation and create
  provider-status diagnostics.

Acceptance criteria:

- Status mapping covers order reads, execution reads, provider attempts, and
  reconciliation snapshots.
- Unknown enum values do not crash route responses or imply success.
- Customer activity receives normalized status and safe explanation.

Verification:

- Future provider fixture tests cover status families, partial fill, replace,
  cancel reject, expired, unknown enum, and malformed status.

Likely implementation files later:

- `artifacts/api-server/src/services/provider-status-normalizer.ts`
- `artifacts/api-server/src/services/provider-status-normalizer.test.ts`
- `artifacts/api-server/src/services/account-trade-model.ts`

Dependencies: Task 11A and Phase 3 Task 7D

Estimated scope: Medium

#### Task 12A: Define Reconciliation State Model

Description: Define the durable state model for reconciling provider orders,
executions, positions, balances, and account capability/freshness after order
activity or auth changes.

Reconciliation shape:

```text
reconciliation_runs
  id
  tenant_id
  workspace_id
  broker_account_id
  order_intent_id
  trigger
  status
  started_at
  completed_at
  stale_inputs
  divergence_codes
  resolved_codes
  next_action
```

Triggers:

```text
post_submit
post_cancel
post_replace
provider_timeout
stream_gap
manual_request
reauth_success
activation_check
scheduled_safety_sweep
```

Acceptance criteria:

- Reconciliation run records trigger, inputs, provider reads, normalized
  outputs, divergence, and resolution.
- Runs can target account-level state, order-level state, or subscription-level
  state.
- Stale provider reads and malformed provider responses create blocked
  reconciliation outcomes.

Verification:

- Future tests cover post-submit, timeout, stream gap, reauth success, manual
  request, stale provider read, and malformed provider response.

Likely implementation files later:

- `lib/db/src/schema/trading.ts`
- `artifacts/api-server/src/services/reconciliation-model.ts`
- `artifacts/api-server/src/services/reconciliation-model.test.ts`

Dependencies: Tasks 10B, 11A, and 11C

Estimated scope: Medium

#### Task 12B: Define Reconciliation Worker Orchestration

Description: Define how background and on-demand reconciliation jobs load
adapter data, compare it to PYRUS ledger state, and produce normalized updates.

Worker sequence:

```text
load authorized account and adapter
load unresolved order intents and provider attempts
read provider orders
read provider executions/fills
read positions and balances when needed
normalize statuses and fills
compare expected versus observed state
write ledger/status/fill updates
write audit and activity events
return account/subscription next action
```

Acceptance criteria:

- Worker can run idempotently and safely after process restart.
- Worker does not submit new provider orders.
- Worker handles partial provider availability and records degraded results.
- Worker can be manually triggered for an account or order without bypassing
  authorization.

Verification:

- Future tests cover idempotent rerun, partial fill, full fill, cancel,
  replace, reject, missing order, duplicate provider order, stale reads, and
  provider unavailable.

Likely implementation files later:

- `artifacts/api-server/src/services/reconciliation-worker.ts`
- `artifacts/api-server/src/services/reconciliation-worker.test.ts`
- `artifacts/api-server/src/jobs/*` if job structure exists at implementation
  time

Dependencies: Task 12A and Phase 3 adapter read methods

Estimated scope: Large; split by trigger/provider before implementation.

#### Task 12C: Define Divergence Pause And Repair Policy

Description: Define when account, strategy subscription, or automation state is
paused because provider reality diverges from PYRUS ledger or permission state.

Divergence codes:

```text
unknown_order_state
missing_provider_order
unexpected_provider_order
unexpected_fill
position_mismatch
buying_power_unknown
capability_changed
scope_changed
reauth_required
provider_restricted_account
audit_gap
```

Pause rules:

- Divergence that can create duplicate, unmanaged, or over-limit exposure pauses
  affected strategy subscriptions immediately.
- Account-level divergence pauses automation for that broker account.
- Terminal supervised orders may remain available only if terminal gates,
  reconciliation, and confirmation pass.
- Resume always re-runs activation gates and reconciliation; no blind resume.

Acceptance criteria:

- Each divergence code maps to affected resource scope, customer-safe copy,
  audit event, and next action.
- Pause is durable and not merely UI state.
- Repair paths distinguish automatic sync success, user reauth, full reconnect,
  manual review, and unsupported provider limitation.

Verification:

- Future tests cover divergence-to-pause mapping, terminal allowed/blocked
  after pause, repair pass, repair fail, and no-blind-resume.

Likely implementation files later:

- `artifacts/api-server/src/services/reconciliation-policy.ts`
- `artifacts/api-server/src/services/trading-permission-state-machine.ts`
- `artifacts/api-server/src/services/signal-options-automation.ts`

Dependencies: Task 12B and Phase 1 Task 3B

Estimated scope: Medium

#### Task 12D: Define Manual Reconcile API And Activity Projection

Description: Define the customer/platform route for requesting reconciliation
and viewing reconciliation results without exposing raw provider payloads.

Contract endpoints:

```text
POST /api/platform/orders/:orderId/reconcile
POST /api/platform/broker-accounts/:brokerAccountId/reconcile
GET /api/platform/broker-accounts/:brokerAccountId/reconciliation
```

Acceptance criteria:

- Manual reconcile requires platform session, tenant/workspace/account
  ownership, and order/account authorization.
- API response exposes normalized reconciliation status, divergence codes,
  next action, and customer-safe activity id.
- API never exposes raw provider payloads, tokens, full account ids, or
  internal stack traces.
- Reconcile requests are rate-limited or deduplicated by pending run.

Verification:

- Future route tests cover authorized request, cross-tenant denial,
  duplicate/pending run, order not found under tenant, and redacted response.

Likely implementation files later:

- `lib/api-spec/openapi.yaml`
- `artifacts/api-server/src/routes/platform.ts`
- `artifacts/api-server/src/services/reconciliation-worker.ts`
- `artifacts/api-server/src/services/customer-activity.ts`

Dependencies: Tasks 12A-12C and Phase 2 authorization middleware

Estimated scope: Medium

### Checkpoint: Phase 4 Execution Safety Ready

- Order intent and source contract are stable.
- Order ledger persists intent, idempotency, gate decisions, and audit before
  provider mutation.
- Provider attempt timeline is append-only and handles unknown outcomes.
- No-blind-retry policy is explicit and testable.
- Provider status normalization covers known and unknown order/execution states.
- Reconciliation model, worker orchestration, divergence pause policy, and
  manual reconcile API are detailed.
- Terminal and automated order flows are not wired until these safety contracts
  are implemented and validated.

### Phase 4 Backlog-Ready Execution Packets

Use these packets only after the full multi-phase planning pass is accepted.

#### Packet P4-10A-10C: Order Intent Ledger

Goal: make every order mutation durable, idempotent, gated, and audited before
provider mutation.

Implementation sequence:

1. Add normalized `OrderIntent` and source contract tests.
2. Add tenant/account/source-scoped ledger schema and idempotency tests.
3. Add pre-submit transaction service with audit-durability block.
4. Wire no provider calls until adapter mutation and attempt timeline contracts
   are ready.

Exit criteria:

- Provider mutation cannot occur before durable intent and audit writes.
- Duplicate idempotency behavior is deterministic.

#### Packet P4-11A-11C: Provider Attempt Timeline

Goal: record every provider mutation attempt and normalize provider outcomes.

Implementation sequence:

1. Add append-only attempt schema and request hash policy.
2. Add provider outcome/error/status normalizers.
3. Add no-blind-retry behavior for timeout and unknown outcomes.
4. Connect attempt writes to adapter mutation service.

Exit criteria:

- Success, rejection, timeout, malformed response, and unknown statuses are
  represented without losing original intent.
- Unknown outcomes enter reconciliation instead of retry.

#### Packet P4-12A-12D: Reconciliation And Divergence Control

Goal: reconcile provider reality against PYRUS ledger state and pause unsafe
automation on divergence.

Implementation sequence:

1. Add reconciliation run model and trigger contract.
2. Add idempotent worker using adapter read methods.
3. Add divergence-to-pause policy.
4. Add manual platform reconcile endpoints and redacted activity projections.
5. Add fixture tests for fills, cancels, replaces, rejections, unknowns, and
   position mismatches.

Exit criteria:

- Unknown or divergent provider state fails closed for automation.
- Customer can see normalized reconcile status without raw provider payloads.

### Phase 5: User Flows And UI

Objective: expose the broker execution product safely through portal and
platform user flows after the contracts, tenancy, adapter, order ledger, and
reconciliation foundations are detailed and implemented. Portal owns first
connect, launch eligibility, and full reconnect/setup reset. Platform owns
workspace session, reauth, automation configuration, terminal order routing,
strategy subscriptions, reconciliation status, and activity views.

Observed repo anchors for implementation planning:

- Platform UI likely starts in `artifacts/pyrus/src/features/platform/`,
  `artifacts/pyrus/src/screens/AccountScreen.jsx`,
  `artifacts/pyrus/src/screens/AlgoScreen.jsx`, and terminal/order-ticket
  components discovered before implementation.
- Portal/dashboard surfaces must be identified before implementation; this plan
  cannot assume a file path until source inspection names the actual portal
  route/component owner.
- Generated clients come from `lib/api-spec/openapi.yaml`,
  `lib/api-zod/src/generated/*`, and `lib/api-client-react/src/generated/*`.
- UI implementation must use `?pyrusQa=safe` for PYRUS browser QA and targeted
  `pnpm` checks, not Replit control-plane actions.

Phase 5 dependency graph:

```text
Task 13 portal connect/status/full reconnect
  -> Task 14 platform automation configuration and account controls
    -> Task 15 terminal account routing and order ticket gates
      -> Task 16 strategy subscription configuration and activation
        -> Beta readiness review and QA
```

Phase 5 non-negotiables:

- UI reflects server decisions; it does not create trading authority.
- Disabled controls are backed by server decision codes, not frontend-only
  heuristics.
- Portal never exposes direct customer v1 activation/pause/resume/cap controls
  unless a separate execution-control contract is approved.
- Platform order and automation controls use `/api/platform/...` routes and
  platform-session auth.
- Browser-visible state never includes raw tokens, raw provider payloads, full
  account numbers, unredacted audit metadata, or internal stack details.

#### Task 13A: Define Portal Broker Provider And Connect Entry

Description: Define the portal surface where users choose an eligible broker
provider, review requested scopes, start first-time connect, and understand
which providers are blocked or research-only.

Portal provider states:

```text
available_private_beta
available_ibkr_special_connector
coming_soon
unsupported
research_only
temporarily_unavailable
```

Acceptance criteria:

- Provider list uses Phase 1 provider classification and source verification
  status.
- Requested scope copy uses Task 1A/1D vocabulary.
- Start-connect action creates a portal-owned first-connect auth attempt and
  does not create platform session authority.
- Unsupported/read-only/paper-only/manual-only providers cannot be selected as
  automation-ready success paths.

Verification:

- Future component tests cover provider available, unsupported, coming soon,
  IBKR special connector, and temporarily unavailable states.
- Future route tests cover start-connect authorization and stable error
  envelopes.

Likely implementation files later:

- Portal route/component files discovered before implementation
- `lib/api-spec/openapi.yaml`
- `artifacts/api-server/src/services/broker-provider-classification.ts`
- Generated client packages

Dependencies: Phase 1 Tasks 1A-2C and Phase 2 Task 6A

Estimated scope: Medium

#### Task 13B: Define Portal Connection And Account Readiness View

Description: Define the read-only portal dashboard/settings view that shows
broker connection state, connected accounts, launch eligibility, scope/capability
status, last sync, health, and customer-safe activity.

Portal readiness fields:

```text
provider
connection_status
accounts
launch_eligibility_state
scope_status
capability_status
last_synced_at
reauth_available
full_reconnect_required
customer_message_keys
activity_summary
```

Acceptance criteria:

- Portal status is tenant/workspace scoped and customer-safe.
- Portal shows readiness and deep links, not platform execution controls.
- `needs_reauth` with hosted platform reauth deep-links into platform when the
  launched workspace can handle it.
- Full reconnect/setup reset remains a portal flow.
- Disconnect/revoke state disables new launch and new trading.

Verification:

- Future component tests cover launchable, needs reauth, activation required,
  automation paused, automation active, full reconnect required, and blocked
  states.
- Future API tests prove raw token/provider/account identifiers are redacted.

Likely implementation files later:

- Portal route/component files discovered before implementation
- `artifacts/api-server/src/services/launch-eligibility.ts`
- `artifacts/api-server/src/services/customer-activity.ts`
- `lib/api-spec/openapi.yaml`

Dependencies: Phase 0 Tasks 0A-0E and Phase 2 authorization

Estimated scope: Medium

#### Task 13C: Define Portal Disconnect And Full Reconnect Flow

Description: Define how users disconnect broker connections, revoke PYRUS
authority, and perform full reconnect/setup reset from portal surfaces without
mixing those flows with routine platform-owned reauth.

Disconnect effects:

```text
mark connection disconnecting/disconnected
revoke credential envelope where supported
invalidate launch eligibility
pause automation permissions
block new provider mutations
preserve audit/reconciliation history
show customer-safe activity
```

Acceptance criteria:

- Disconnect requires explicit user confirmation and server-side tenant
  authority.
- Disconnect pauses or revokes affected trading permissions before new trading
  can occur.
- Full reconnect starts a new first-connect/full-reconnect auth attempt and
  does not reuse stale callback state.
- Existing audit/order history remains available through customer-safe
  projections.

Verification:

- Future route and component tests cover disconnect confirm/cancel, connected
  state, pending orders, active automation, failed revoke, and reconnect start.

Likely implementation files later:

- Portal route/component files discovered before implementation
- `artifacts/api-server/src/services/broker-connection-lifecycle.ts`
- `artifacts/api-server/src/services/trading-permission-state-machine.ts`

Dependencies: Tasks 13A-13B and Phase 2 credential revoke policy

Estimated scope: Medium

#### Task 13D: Define Portal Activity And Support-Safe Diagnostics

Description: Define the portal-facing activity stream and support-safe
diagnostic summary for broker connection, launch eligibility, reauth, full
reconnect, disconnect, and blocked states.

Activity rules:

- Customer activity is a projection of audit/reconciliation/permission events,
  not the immutable audit system of record.
- Activity is cursor-paginated, tenant/workspace scoped, and redacted.
- Activity entries use decision codes and message keys from Phase 0/1.
- Internal diagnostic ids may be shown only when safe for support correlation.

Acceptance criteria:

- Portal activity explains why launch is allowed, blocked, or requires action.
- Activity never exposes raw provider payloads, secrets, full account numbers,
  or stack traces.
- Support-safe diagnostic copy distinguishes provider limitation, user action,
  sync delay, security block, and system error.

Verification:

- Future tests cover activity projection redaction, pagination, cross-tenant
  denial, and decision-code-to-copy mapping.

Likely implementation files later:

- `artifacts/api-server/src/services/customer-activity.ts`
- Portal route/component files discovered before implementation
- `lib/api-spec/openapi.yaml`

Dependencies: Phase 0 Task 0E and Tasks 13A-13C

Estimated scope: Small

#### Task 14A: Define Platform Broker Account Readiness Panel

Description: Define the launched platform workspace surface where users inspect
broker accounts, capability status, trading permission state, sync freshness,
reauth availability, reconciliation state, and automation readiness.

Panel fields:

```text
broker_account_id
customer_safe_label
provider
environment
capability_summary
scope_summary
trading_permission_state
freshness_summary
reconciliation_summary
kill_switch_state
next_action
```

Acceptance criteria:

- Panel data comes from `/api/platform/...` routes protected by platform
  session.
- Panel shows server decision codes and copy keys, not frontend-derived
  authority.
- Missing capability/scope/freshness/reauth/reconciliation states show
  specific next action.
- Raw account ids and provider payloads are never rendered.

Verification:

- Future component tests cover ready, configured, active, paused, stale,
  missing scope, missing capability, reauth required, and reconciliation
  required states.

Likely implementation files later:

- `artifacts/pyrus/src/features/platform/*`
- `artifacts/pyrus/src/screens/AlgoScreen.jsx`
- `artifacts/pyrus/src/screens/AccountScreen.jsx`
- `lib/api-client-react/src/generated/*`

Dependencies: Phases 1-4 platform APIs

Estimated scope: Medium

#### Task 14B: Define Execution Configuration Controls

Description: Define platform controls for account-level automation caps,
allowed symbols, blocked symbols, asset/order-shape limits, disclosure
acknowledgement, and kill-switch requirements.

Configuration fields:

```text
allowed_asset_classes
allowed_order_shapes
max_notional_per_order
max_contracts_per_order
max_daily_notional
max_daily_trades
max_daily_loss
allowed_symbols
blocked_symbols
require_terminal_confirmation
account_kill_switch_state
automation_kill_switch_state
disclosure_acknowledgement
```

Acceptance criteria:

- Controls validate client-side for usability but rely on server validation for
  authority.
- Save uses `/api/platform/broker-accounts/:brokerAccountId/configure-execution`.
- Activation remains unavailable until caps, disclosure, kill switch policy,
  scope, capability, freshness, and reconciliation gates pass.
- Numeric inputs have explicit units and cannot silently default to unlimited.
- Private beta starts from blank/user-entered cap values, not PYRUS hard
  defaults. Suggested examples may be shown as helper copy only if they are not
  submitted unless the user explicitly accepts them.
- Cap increases and decreases are customer-controlled, audited, and re-run
  activation gates; internal approval is not required for v1 cap changes.

Verification:

- Future UI tests cover missing caps, invalid numbers, unsupported order shape,
  disclosure missing, kill switch missing, save success, and server rejection.

Likely implementation files later:

- `artifacts/pyrus/src/features/platform/*`
- `artifacts/pyrus/src/screens/AlgoScreen.jsx`
- `lib/api-spec/openapi.yaml`

Dependencies: Phase 1 Task 3A and Phase 2 authorization

Estimated scope: Medium

#### Task 14C: Define Platform Activate, Pause, Resume, And Kill Switch Flow

Description: Define platform-owned automation activation, pause, resume, and
kill-switch UX for broker accounts.

Flow rules:

- Activate runs server activation gates and shows allowed/blocked decision.
- Pause is immediate, idempotent, durable, and auditable.
- Resume re-runs activation gates, capability freshness, and reconciliation.
- Kill switch disables automation quickly and creates customer-safe activity.
- Portal may deep-link to this flow but does not own the controls in customer
  v1.

Acceptance criteria:

- Activate, pause, resume, and kill switch all call platform-owned routes.
- UI displays blocked gates with specific next actions and does not imply
  support can bypass provider limitations.
- System pauses from reconciliation/unknown state appear distinctly from user
  pauses.
- Resume cannot proceed from revoked, unknown, stale, or unreconciled state.

Verification:

- Future component/API tests cover activate allowed, blocked, pause idempotent,
  resume allowed, resume blocked, kill switch, system pause, and audit failure.

Likely implementation files later:

- `artifacts/pyrus/src/features/platform/*`
- `artifacts/pyrus/src/screens/AlgoScreen.jsx`
- `artifacts/api-server/src/routes/platform.ts`

Dependencies: Phase 1 Task 3B-3D and Phase 4 Task 12C

Estimated scope: Medium

#### Task 14D: Define Platform Reauth And Reconciliation Recovery UI

Description: Define UI states for platform-owned hosted reauth, sync,
reconciliation, repair, and blocked account recovery after launch.

Recovery states:

```text
reauth_available
reauth_in_progress
reauth_failed
full_reconnect_required
syncing_accounts
reconciliation_required
reconciliation_running
reconciliation_failed
provider_limitation
support_required
```

Acceptance criteria:

- Hosted reauth starts/cancels through platform routes and cannot be confused
  with portal first connect.
- Full reconnect/setup reset clearly sends user back to portal.
- Reconciliation UI shows normalized progress and result, not raw provider
  data.
- Recovery success enters sync/reconciliation gates before controls reactivate.

Verification:

- Future UI tests cover start/cancel reauth, callback success/failure display,
  full reconnect link, reconcile request, running state, and blocked result.

Likely implementation files later:

- `artifacts/pyrus/src/features/platform/*`
- `artifacts/api-server/src/routes/platform.ts`
- `artifacts/api-server/src/services/broker-reauth.ts`

Dependencies: Phase 0 Task 0D, Phase 2 Task 6, and Phase 4 Task 12D

Estimated scope: Medium

#### Task 15A: Define Terminal Broker Account Selector

Description: Define how the terminal/order ticket selects a broker account for
supervised orders without using portal state or provider account ids as
authority.

Selector rules:

- Account list comes from platform session and tenant-owned broker accounts.
- Default selection is explicit and can be changed by user.
- Disabled accounts show server decision code and next action.
- Selected account id is PYRUS `broker_account_id`, not provider account id.
- Account selection does not change market-data provider.

Acceptance criteria:

- User can select only authorized broker accounts visible in current workspace.
- Selector handles no accounts, one account, multiple accounts, stale account,
  paused automation, reauth required, and capability-missing states.
- Selection is persisted only as safe user/workspace preference, not execution
  authority.

Verification:

- Future UI/API tests cover account selection, cross-tenant blocked account id,
  disabled reasons, and preference persistence.

Likely implementation files later:

- Terminal/order-ticket files discovered before implementation
- `artifacts/pyrus/src/features/platform/*`
- `lib/api-client-react/src/generated/*`

Dependencies: Phase 2 authorization and Phase 3 adapter reads

Estimated scope: Medium

#### Task 15B: Define Terminal Order Ticket Capability Gating

Description: Define terminal order ticket behavior for broker-account-native
asset classes, order types, TIFs, sessions, routes, preview availability,
cancel/replace fields, and unsupported order shapes.

Gating rules:

- Order ticket asks the server for capability/support decisions for selected
  account and normalized order intent.
- Unsupported fields are disabled or blocked with server message keys.
- Preview uses `/api/platform/orders/preview` when supported and policy allows.
- Submit uses `/api/platform/orders` and requires live confirmation.
- Cancel/replace uses platform order routes and requires server gate checks.

Acceptance criteria:

- UI cannot submit unsupported order shape by hiding/showing controls alone;
  server gate remains final authority.
- Unsupported spreads/combo orders remain blocked in v1.
- No-preview providers show explicit policy result before submit.
- Cancel/replace UI respects provider-native supported fields.

Verification:

- Future tests cover supported stock, supported single-leg option, unsupported
  spread, unsupported TIF/session/route, preview unavailable, submit confirm,
  cancel blocked, and replace-field blocked states.

Likely implementation files later:

- Terminal/order-ticket files discovered before implementation
- `artifacts/pyrus/src/features/account/positionTradeManagement.js`
- `artifacts/pyrus/src/features/account/PositionRowActionMenu.jsx`
- `artifacts/api-server/src/routes/platform.ts`

Dependencies: Phase 1 Task 1C, Phase 3 adapter contract, and Phase 4 order
ledger

Estimated scope: Medium

#### Task 15C: Define Market Data Separation In Terminal UI

Description: Define how terminal UI continues to use PYRUS internal market
data while broker account routing uses broker execution permissions and
capabilities only.

Separation rules:

- Quotes, chains, bars, scanners, signals, and chart data remain PYRUS market
  data surfaces.
- Broker `market_data` scope is not required for terminal display unless a
  provider-specific order validation exception is explicitly documented.
- Order preview/gates may include provider validation facts without changing
  chart/quote data source.
- UI labels avoid implying broker data is powering PYRUS charts by default.

Acceptance criteria:

- Terminal account routing does not add broker market-data scope requirement.
- UI can show broker execution readiness and market-data health separately.
- Regression tests protect charts/signals/scanners from broker auth scope
  dependency.

Verification:

- Future UI/API tests prove order ticket works with PYRUS market data and
  broker execution account selection separately.

Likely implementation files later:

- `artifacts/pyrus/src/features/platform/MarketDataSubscriptionProvider.jsx`
- Terminal/order-ticket files discovered before implementation
- `artifacts/api-server/src/services/platform.ts`

Dependencies: Phase 1 Task 1A and Phase 5 Task 15B

Estimated scope: Small

#### Task 16A: Define Strategy Subscription Data And UX Contract

Description: Define how a PYRUS strategy connects to an automation-active
broker account with explicit caps, symbols, order shapes, pause controls, and
reconciliation visibility.

Subscription shape:

```text
StrategySubscription
  id
  tenant_id
  workspace_id
  strategy_id
  broker_account_id
  trading_permission_id
  state
  allowed_symbols
  blocked_symbols
  max_notional_per_order
  max_contracts_per_order
  max_daily_notional
  max_daily_trades
  max_daily_loss
  allowed_order_shapes
  signal_source_policy
  pause_reason
  last_signal_at
  last_order_intent_id
  last_reconciled_at
```

Acceptance criteria:

- Subscription references PYRUS broker account and trading permission ids, not
  provider account ids.
- Strategy activation is impossible unless account permission is
  `automation_active` and subscription caps are valid.
- Strategy caps are user-configured and must be equal to or stricter than the
  account-level `TradingPermission` caps; missing or unlimited strategy caps
  block activation.
- Existing `algo_deployments.providerAccountId` migration is planned before
  customer automation exposure.
- Subscription state is durable and auditable.

Verification:

- Future schema/API tests cover create, update, activate, pause, resume,
  account inactive, invalid caps, and provider-account-id migration.

Likely implementation files later:

- `lib/db/src/schema/automation.ts`
- `artifacts/api-server/src/services/strategy-subscriptions.ts`
- `artifacts/pyrus/src/screens/AlgoScreen.jsx`

Dependencies: Phase 2 ownership schema and Phase 1 trading permission model

Estimated scope: Medium

#### Task 16B: Define Strategy Caps And Signal-To-Order Gate UX

Description: Define the UI and API behavior that turns strategy signals into
bounded, auditable order intents without allowing silent exposure expansion.

Gate inputs:

```text
strategy signal provenance
subscription caps
broker account permission
capability support
freshness snapshot
daily counters
kill switch state
reconciliation state
audit durability
```

Acceptance criteria:

- Strategy order generation shows caps and current usage before activation.
- Signal-to-order decisions write normalized blocked/allowed activity.
- Daily counters and max loss limits are server-side facts.
- Strategy cannot silently widen symbols, quantity, asset class, or order shape
  beyond subscription settings.

Verification:

- Future tests cover cap exceeded, symbol blocked, stale signal, stale broker
  state, daily max reached, kill switch, audit failure, and allowed order.

Likely implementation files later:

- `artifacts/api-server/src/services/signal-options-automation.ts`
- `artifacts/api-server/src/services/overnight-spot-execution.ts`
- `artifacts/api-server/src/services/strategy-subscriptions.ts`
- `artifacts/pyrus/src/screens/AlgoScreen.jsx`

Dependencies: Phase 4 order ledger and Task 16A

Estimated scope: Medium

#### Task 16C: Define Strategy Pause, Resume, And Divergence Display

Description: Define user and system pause/resume behavior for strategy
subscriptions, including divergence, reauth, unknown order state, and kill
switch display.

Acceptance criteria:

- Pause is immediate, durable, idempotent, and visible.
- Resume re-runs account activation gates, subscription caps, reconciliation,
  and signal freshness.
- System pause reasons are distinct from user pause reasons.
- Divergence display shows normalized reason, affected account/subscription,
  next action, and last safe activity.

Verification:

- Future UI/API tests cover user pause, system pause, resume allowed, resume
  blocked by divergence, reauth required, kill switch, and unknown order state.

Likely implementation files later:

- `artifacts/api-server/src/services/strategy-subscriptions.ts`
- `artifacts/api-server/src/services/reconciliation-policy.ts`
- `artifacts/pyrus/src/screens/AlgoScreen.jsx`

Dependencies: Phase 4 Task 12C and Task 16B

Estimated scope: Medium

#### Task 16D: Define Beta Readiness Activity And QA Contract

Description: Define the end-to-end customer beta readiness checklist, activity
trail, and QA evidence required before live customer automation is exposed.

Beta readiness flows:

```text
portal first connect
launch eligibility
platform handoff/session
account capability sync
execution configuration
activation
terminal supervised order
strategy subscription
automated order intent
provider attempt
reconciliation
pause/resume
disconnect/full reconnect
customer activity review
```

Acceptance criteria:

- Every beta flow has source-backed server decisions and customer-safe UI
  states.
- Public launch with automated live execution is gated by documented internal
  product/security review, not external counsel by default for customer v1.
- Internal review covers provider eligibility, order/automation disclosures,
  default risk caps, kill switches, audit/reconciliation evidence, incident
  response, rollback/disable controls, and customer activity explanations.
- External securities counsel remains a deferred escalation path if provider
  terms, jurisdiction, discretionary routing, advisory/recommendation behavior,
  payment/order-routing arrangements, or regulatory status become unresolved.
- QA uses safe-mode browser entry and explicit readiness selectors.
- Live full-app navigation and live broker mutation require explicit approval
  at implementation/QA time.
- Audit/customer activity can explain every action, block, and pause.

Verification:

- Future end-to-end QA plan covers portal, platform, terminal, automation,
  reconciliation, disconnect, reauth, and activity flows.
- Future release checklist includes security, route inventory, OpenAPI/codegen,
  typecheck, targeted tests, browser QA, internal product/security review
  sign-off, and rollback/disable controls.

Likely implementation files later:

- `docs/plans/*beta*` if split into a launch checklist
- `artifacts/pyrus/e2e/*` or existing browser QA harness discovered before
  implementation
- `artifacts/api-server/src/services/customer-activity.ts`

Dependencies: Tasks 13A-16C and Phases 0-4

Estimated scope: Medium

### Checkpoint: Phase 5 User Flow And Beta Readiness Planned

- Portal first connect, status, disconnect, full reconnect, and activity views
  are detailed.
- Platform broker account readiness, execution configuration, activation,
  pause, resume, kill switch, reauth, and reconciliation recovery are detailed.
- Terminal account routing, order ticket capability gating, and market-data
  separation are detailed.
- Strategy subscription data, caps, signal-to-order gates, pause/resume, and
  divergence display are detailed.
- Beta readiness flow and QA contract are detailed.
- Implementation remains blocked until the full-plan checkpoint below is
  accepted.

### Phase 5 Backlog-Ready Execution Packets

Use these packets only after the full multi-phase planning pass is accepted.

#### Packet P5-13A-13D: Portal Broker Lifecycle UI

Goal: build portal first-connect, readiness, disconnect/full reconnect, and
activity views without exposing platform execution controls.

Implementation sequence:

1. Identify actual portal route/component ownership from source.
2. Add OpenAPI/client contract for provider list, connect start, connection
   status, launch eligibility, disconnect, and activity.
3. Build read-only readiness and customer-safe activity UI.
4. Add disconnect/full reconnect confirmation flow.
5. Test blocked, launchable, reauth, reconnect, disconnect, and activity states.

Exit criteria:

- Portal can explain readiness and start setup/reconnect.
- Portal cannot directly activate, pause, resume, or edit execution caps.

#### Packet P5-14A-14D: Platform Account Execution Controls

Goal: build platform-owned account readiness, execution configuration,
activation/pause/resume/kill switch, reauth, and reconciliation recovery.

Implementation sequence:

1. Add platform broker-account readiness panel from generated client types.
2. Add execution cap/disclosure/kill-switch configuration controls.
3. Add activate/pause/resume flow backed by server decisions.
4. Add hosted reauth and reconciliation recovery states.
5. Test allowed/blocked/server-error/redaction states before browser QA.

Exit criteria:

- Platform owns execution controls and displays server gate decisions.
- Recovery states do not bypass sync or reconciliation gates.

#### Packet P5-15A-15C: Terminal Account Routing And Order Ticket Gates

Goal: let terminal users select a broker account and submit supervised orders
only when server capability and gate decisions allow it.

Implementation sequence:

1. Identify terminal/order-ticket source files.
2. Add account selector using PYRUS broker account ids.
3. Add server-backed order-shape support checks.
4. Add preview/submit/cancel/replace platform routes.
5. Preserve PYRUS market-data source separation and add regression tests.

Exit criteria:

- Terminal orders are supervised, account-routed, capability-gated, and
  confirmed.
- Broker market-data scope is not required for PYRUS chart/signal data.

#### Packet P5-16A-16D: Strategy Subscription And Beta QA

Goal: connect strategies to automation-active broker accounts with caps,
durable pause/resume, divergence display, and beta readiness evidence.

Implementation sequence:

1. Add strategy subscription schema/API using broker account and permission ids.
2. Add UI for caps, symbols, order-shape settings, and activation state.
3. Route signal-to-order through Phase 4 ledger/gates.
4. Add pause/resume/divergence display.
5. Build beta readiness QA checklist and activity trail review.

Exit criteria:

- Strategy automation cannot activate without account permission, caps,
  reconciliation, and audit durability.
- Beta QA evidence covers connect-to-reconcile lifecycle before customer live
  exposure.

### Full-Plan Checkpoint: Implementation Gate

Implementation should remain blocked until all of the following are true:

- Phase 0 launch/session/audit contracts are accepted.
- Phase 1 scope/capability/provider/permission/API-boundary contracts are
  accepted.
- Phase 2 identity/tenancy/secrets/OAuth planning is accepted.
- Phase 3 adapter core planning is accepted.
- Phase 4 order safety/reconciliation planning is accepted.
- Phase 5 user-flow/beta-readiness planning is accepted.
- Open questions are either answered, explicitly deferred, or turned into
  implementation blockers.
- Provider candidates are not marked private-beta eligible until official docs
  are verified.
- Once live customer trading depends on a provider, official provider/aggregator
  docs are reviewed on every provider-related implementation change and at
  least monthly. The provider row records review date, source refs, and material
  changes.
- Private-beta live automated execution does not allow
  `eligible_after_exception`; provider rows must pass normal eligibility or
  remain blocked/research-only.
- The SnapTrade selected-brokerage/account fixture is an explicitly deferred
  Phase 3 research-spike output and blocks SnapTrade beta eligibility until it
  is named and proven.
- SnapTrade failure fallback selection is an explicitly deferred Phase 3
  provider-research output; no backup aggregator or replacement execution lane
  is named in Phase 1.
- Direct-OAuth second-wave candidate selection is an explicitly deferred Phase 3
  provider-research output; no direct-OAuth broker is named in Phase 1.
- Public automated live execution is blocked until internal product/security
  review signs off on the beta readiness checklist. External securities counsel
  review is deferred unless an escalation trigger is hit.
- Private beta risk caps are mandatory user-configured fields, not PYRUS hard
  numeric defaults. Activation fails closed when required caps are absent or
  unlimited.
- The formal eng-review test artifact exists, includes packet-level coverage
  for every backlog packet, and agrees with the Test Strategy before
  implementation starts.

## Deferred Product Decisions

- Enterprise/org accounts, multi-member tenant membership, org roles, support
  impersonation, and workspace switching are deferred beyond customer v1.
  Customer v1 keeps one tenant/workspace per user while preserving server-side
  tenant/workspace ownership columns.

## Deferred Review Items

- Numeric latency, freshness, provider-timeout, and reconciliation budgets for
  order-affecting flows are deferred to a later performance review. Current
  implementation planning still requires fail-closed stale/unknown-state
  behavior, no blind retry/resume, and tests for timeout/reconciliation paths,
  but does not require final numeric performance budgets before implementation
  unlock.

## Public API Direction

Add normalized portal-owned broker-connect endpoints:

- `GET /api/portal/broker-providers`
- `POST /api/portal/broker-connections/:provider/start`
- `GET /api/portal/broker-connections/:provider/callback`
- `POST /api/portal/broker-connections/:provider/callback`
- `GET /api/portal/broker-connections`
- `DELETE /api/portal/broker-connections/:connectionId`
- `GET /api/portal/broker-accounts`
- `GET /api/portal/platform/launch-eligibility`
- `POST /api/portal/platform/handoff`
- `POST /api/portal/platform/handoff/exchange` (server-to-server only)
- `GET /api/portal/activity`

Add normalized platform-owned execution endpoints, all protected by
platform session auth created by one-time portal handoff exchange:

- `POST /api/platform/session/exchange`
- `GET /api/platform/session`
- `DELETE /api/platform/session`
- `POST /api/platform/broker-accounts/:brokerAccountId/configure-execution`
- `POST /api/platform/broker-accounts/:brokerAccountId/activate-automation`
- `POST /api/platform/broker-accounts/:brokerAccountId/pause-automation`
- `POST /api/platform/broker-accounts/:brokerAccountId/resume-automation`
- `POST /api/platform/broker-connections/:connectionId/reauth/start`
- `GET /api/platform/broker-connections/:connectionId/reauth/:attemptId`
- `GET /api/platform/broker-connections/:connectionId/reauth/callback`
- `POST /api/platform/broker-connections/:connectionId/reauth/callback`
- `POST /api/platform/broker-connections/:connectionId/reauth/:attemptId/cancel`
- `POST /api/platform/orders/preview`
- `POST /api/platform/orders`
- `POST /api/platform/orders/:orderId/replace`
- `POST /api/platform/orders/:orderId/cancel`
- `GET /api/platform/orders`
- `GET /api/platform/executions`
- `POST /api/platform/orders/:orderId/reconcile`
- `GET /api/platform/activity`

Endpoint naming note:

- New customer-facing multi-tenant execution APIs use `/api/platform/...`.
  Existing generic `/api/orders`, `/api/executions`, account, broker-connection,
  and reconciliation paths remain migration/internal surfaces unless they are
  explicitly guarded and reviewed before customer exposure.

Existing IBKR-specific endpoints should remain during migration but should not
be the long-term public shape for multi-user broker execution.

## Test Strategy

Formal test review deliverables:

- Before implementation is unlocked, the eng review must produce a packet-level
  ASCII coverage diagram tied to every backlog packet in this plan.
- The coverage diagram must distinguish planned coverage from observed passing
  tests because no runtime implementation exists yet.
- The review must write a gstack QA-consumable test-plan artifact at
  `/home/runner/.gstack/projects/workspace/runner-main-eng-review-test-plan-2026-06-08T173506Z.md`.
- The artifact must cover affected routes/pages, key interactions, edge cases,
  critical paths, and the packet coverage gate used by `/qa` or `/qa-only`.

Packet-level test requirements:

```text
P1-1A Broker Scope Contract
  - Unit tests for complete required scope set.
  - Unit tests for each missing required scope.
  - Unit tests for preferred `trade_preview` and `order_update_stream`.
  - Unit tests proving `market_data` is disabled by default and required only by
    provider-specific validation policy.
  - Copy/registry tests for `BROKER_SCOPE_MISSING` and missing-scope messages.

P1-1B Broker Account Capability Map
  - Unit tests for supported, unsupported, stale, expired, and unknown maps.
  - Unit tests for stocks and single-leg options capability decisions.
  - Unit tests for order type, TIF, session, route, trailing stop, bracket,
    OCO, OSO, cancel/replace, preview, and order-status support.
  - Redaction tests proving capability fixtures/log metadata contain no raw
    account numbers, raw provider payloads, tokens, or authorization headers.

P1-1D Decision-Code Registry And Copy Contract
  - Registry completeness tests for every `EXECUTION_*`, `ACTIVATION_*`,
    provider, scope, capability, permission, freshness, risk, kill-switch,
    terminal-confirmation, idempotency, and audit-durability code.
  - Tests proving every registry entry has exactly one customer message key,
    severity, audit hint, redaction class, owner task, and allowed surface list.
  - Backend/frontend copy lookup tests proving UI copy consumes registry keys
    rather than local ad hoc code lists.

P1-1C Execution Support Decision Evaluator
  - Pure-function unit tests for stock, single-leg option, and deferred spread
    order intents.
  - Unit tests for missing scope, missing capability, unsupported asset class,
    unsupported order shape, preview unavailable, stale freshness, paused
    permission, kill switch, and provider limitation.
  - Tests proving every returned decision code exists in P1-1D registry.
  - Tests proving client-provided account ids are never authority; ownership is
    supplied as server-side input.

P1-2A Provider Classification Schema
  - Fixture validation tests rejecting rows without provider name, adapter kind,
    auth type, customer status, required scopes, known limitations, source refs,
    verification date, reviewer, and default block reason.
  - Tests proving `eligible_after_exception` is invalid for private-beta live
    automation rows.

P1-2B Provider Entry-Path Classification Fixtures
  - Fixtures for IBKR special connector, SnapTrade candidate, direct-OAuth
    candidate, read-only, manual-only, submit-only, paper/demo/shadow, and
    unsupported providers.
  - Tests mapping each fixture to launch, activation, terminal order, and
    automation readiness outcomes.
  - Tests proving candidate providers do not imply execution entitlement.

P1-2C Provider Limitation Normalizer
  - Unit tests for no-preview, no-stream, no-cancel/replace, no-options,
    paper-only, read-only, manual-only, and submit-only provider facts.
  - Tests proving normalized customer-safe block reasons are exposed while
    provider-specific internals stay redacted/internal.
  - Tests proving submit-only never becomes `automation_trading_connection`.

P1-3A TradingPermission Model
  - Unit tests for pending, authorized, syncing, ready-for-configuration,
    configured, automation-active, paused, revoked, and error states.
  - Cap validation tests for missing, zero, negative, non-finite, unlimited,
    account-level, strategy-level, symbol allow/block, and disclosure cases.
  - Redaction tests for permission audit metadata.

P1-3B TradingPermission State Machine
  - Transition-table tests for every allowed transition.
  - Blocked-transition tests for blind resume blockers: unknown provider state,
    disconnect, revoke, failed reconciliation, changed scope, changed
    capability, stale positions, stale orders, kill switch, and suspended
    tenant/user.
  - Idempotency tests for safe pause/resume/cancel-style actions.
  - Audit-shape tests for user, system, and repair transitions.

P1-3C Activation And Execution Gate Evaluator
  - Unit tests for every `ACTIVATION_*` code in P1-1D registry.
  - Shared-gate tests proving activation, terminal order, strategy subscription,
    and automation submission consume the same gate family.
  - Tests for tenant/workspace, subject role, account ownership, scope,
    capability, permission, freshness, risk caps, kill switch, terminal
    confirmation, idempotency, and audit durability gates.
  - Tests proving audit durability failure blocks high-risk mutations.

P1-3D API Route Boundary And OpenAPI Contract
  - OpenAPI contract tests for new `/api/platform/...` execution routes.
  - Route classification tests for existing generic order, account,
    broker-connection, execution, reconciliation, and stream routes.
  - Authorization tests proving legacy/generic routes cannot become customer
    execution surfaces unless explicitly wrapped and reviewed.
  - Codegen/audit tests proving generated clients match OpenAPI.

P2-4A Principal And Workspace Contract
  - Unit tests for portal principal, platform principal, service principal,
    suspended user, revoked user, and expired session contexts.
  - Tests proving tenant/workspace ids are derived server-side and not trusted
    from client input.

P2-4B Ownership Schema And Backfill Plan
  - Migration/backfill tests for broker connections, broker accounts, orders,
    executions, strategies, subscriptions, audit events, and activity rows.
  - Uniqueness and no-cross-tenant tests for each ownership-bearing table.
  - Tests proving resource existence is not leaked across tenants/workspaces.

P2-4C Authorization Middleware And Route Matrix
  - Middleware tests for portal, platform, service-to-service, stream/SSE, and
    legacy route families.
  - Cross-tenant, wrong-workspace, wrong-account, missing-session, expired
    session, and suspended-user denial tests.
  - CSRF/same-site mutation tests for browser-initiated mutations.

P2-4D Legacy Route Containment Audit
  - Classification tests proving every broker/account/order/execution/stream
    route is customer-public, wrapped-migration, internal, IBKR-special, or
    deprecated.
  - Regression tests proving unclassified legacy routes fail closed.

P2-5A-5D Secret Custody Foundation
  - Secret classification tests for token/reference/account identifiers,
    provider payloads, OAuth codes, cookies, authorization headers, and logs.
  - Envelope encryption tests for correct AAD, wrong AAD, wrong key, rotation,
    revoke, decrypt failure, and redaction.
  - Credential access service tests proving adapters receive credentials only
    through the approved boundary and API responses never expose raw secrets.
  - Incident/redaction fixture tests for logs, audit metadata, and activity
    projections.

P2-6A-6C OAuth And Reauth Attempt Store
  - Attempt lifecycle tests for start, valid callback, expired callback,
    replayed callback, wrong user, wrong provider, wrong origin, wrong return
    path, cancelled, superseded, malformed callback, and cleanup.
  - PKCE/state binding tests for hosted/OAuth providers.
  - Recovery tests for full reconnect required versus hosted reauth available.

P3-7A-7D Adapter Contract Foundation
  - Type/fixture tests for normalized account, position, order, execution,
    capability, preview, submit, cancel, replace, and reauth outputs.
  - Registry lookup tests by tenant-owned PYRUS connection/account ids.
  - Provider response validation tests for malformed, partial, extra-field,
    stale, and unknown enum responses.
  - Error mapping tests proving customer responses use normalized safe codes.

P3-8A-8D IBKR Adapter Wrapping
  - Inventory tests around existing IBKR read/order behavior before wrapping.
  - Adapter fixture tests proving IBKR read, preview, submit, cancel, replace,
    status, and account identity normalize without weakening existing live
    confirmation behavior.
  - Regression tests proving IBKR special connector remains explicit and does
    not become the default SaaS broker pattern.

P3-9A-9C SnapTrade-Backed First Non-IBKR Adapter Lane
  - Official-doc fixture tests for selected brokerage/account support once the
    Phase 3 research spike names the fixture.
  - Tests proving SnapTrade remains research-only until stocks, single-leg
    options, fills, cancel/replace, account identity, token/reference custody,
    and audit semantics are proven.
  - Insufficient-capability tests for aggregator-backed providers that lack the
    required account-native execution evidence.

P4-10A-10C Order Intent Ledger
  - Unit tests for terminal, strategy, repair, and reconciliation order sources.
  - Idempotency tests for same key/same intent, same key/different intent,
    different key/same intent, restart-safe pending submit, and tenant-scoped
    idempotency.
  - Transaction tests proving intent, gate decision, and audit durability are
    written before provider mutation.
  - Tests proving audit-durability failure blocks provider mutation.

P4-11A-11C Provider Attempt Timeline
  - Attempt tests for success, provider rejection, timeout unknown, malformed
    response, cancel accepted, replace accepted, duplicate provider ref, unknown
    status, and unsupported provider response.
  - No-blind-retry tests proving unknown outcomes enter reconciliation and
    cannot be retried until repaired or proven safe.
  - Status normalization tests for fills, partial fills, rejected, cancelled,
    expired, replaced, pending, unknown, and malformed provider status.

P4-12A-12D Reconciliation And Divergence Control
  - Reconciliation tests for fill, partial fill, reject, cancel, replace,
    timeout, unknown provider state, stream gap, stale provider reads, provider
    unavailable, duplicate run, and manual reconcile.
  - Divergence tests proving affected automation pauses durably and cannot
    resume blindly.
  - Activity projection tests proving customers see normalized reconcile status
    without raw provider payloads.

P5-13A-13D Portal Broker Lifecycle UI
  - UI tests for provider list, connect start, callback states, connection
    status, launch eligibility, disconnect, full reconnect, and activity.
  - Tests proving portal shows readiness/deep links but cannot activate, pause,
    resume, or edit execution caps in customer v1.
  - Regression tests proving broker login/authorization is reachable from the
    portal dashboard/settings gate and not from a terminal top popover.

P5-14A-14D Platform Account Execution Controls
  - UI and API integration tests for readiness panel, cap configuration,
    disclosure acknowledgement, kill switch, activate, pause, resume, hosted
    reauth, and reconciliation recovery states.
  - Tests proving disabled controls are backed by server decision codes and
    recovery states do not bypass sync/reconciliation gates.

P5-15A-15C Terminal Account Routing And Order Ticket Gates
  - UI tests for no account, one account, multiple accounts, stale account,
    unsupported order shape, preview unavailable, submit blocked, submit
    confirmed, cancel, replace, and server-error states.
  - Regression tests proving broker market-data scope is not required for PYRUS
    charts, signals, scanners, or terminal display unless a provider-specific
    order-validation exception requires it.

P5-16A-16D Strategy Subscription And Beta QA
  - API/UI tests for strategy subscription account selection, caps, symbols,
    order-shape settings, activation state, pause, resume, divergence display,
    and signal-to-order gates.
  - Tests proving strategy automation cannot activate without account
    permission, caps, reconciliation, freshness, and audit durability.
  - Beta readiness checklist tests or QA evidence covering connect through
    reconcile lifecycle before customer live exposure.
```

- Portal auth tests: Better Auth session required, session revocation, role
  claims, tenant/account claims, and launch eligibility.
- Platform handoff tests: single-use code, TTL, redirect binding, hashed
  storage, replay rejection, code URL stripping, referrer policy, and
  ineligible-user rejection.
- Platform session tests: missing, malformed, expired, wrong tenant, and
  cross-account sessions fail closed.
- Session revocation tests: portal logout, user suspension, broker disconnect,
  and token revocation propagate to platform sessions or are contained by TTL.
- Scope model tests: required scopes per `automation_trading_connection`.
- Capability map tests: account-native order shape, TIF, session, route,
  preview, streaming, cancel/replace, and freshness policies fail closed when
  missing, stale, or unknown.
- Provider classification tests: fixture rows require source refs,
  verification date, auth type, customer v1 status, required scopes, known
  limitations, and default block reason.
- Trading permission tests: state transitions, caps, disclosures, kill
  switches, blind-resume blockers, terminal confirmation, and audit durability.
- Execution gate tests: activation, terminal order, strategy subscription, and
  automation routes share the same scope/capability/freshness/permission
  decision semantics.
- Principal/request-context tests: portal, platform, service, suspended user,
  expired session, wrong tenant, wrong workspace, and client-supplied tenant id
  spoofing.
- Tenant ownership tests: backfill, uniqueness scopes, no cross-user
  broker/account/order/execution/strategy/subscription/audit access, and no
  resource-existence leaks.
- Legacy route containment tests: every broker/account/order/execution/stream
  route has a customer-public, wrapped-migration, internal, IBKR-special, or
  deprecated classification.
- Secret tests: classification, envelope encryption, wrong key/AAD, rotation,
  revoke, decryption failure, adapter-only credential access, redaction, and no
  raw token response.
- Audit tests: append-only event writes, typed builders, redaction fixtures, event
  correlation, normalized decision context, and customer-safe activity
  projections.
- OAuth tests: valid, expired, replayed, wrong-user, wrong-provider,
  wrong-origin, wrong-return-path, cancelled, superseded, and malformed provider
  callbacks.
- Adapter fixture tests: normalized types, registry lookup, IBKR wrapping,
  aggregator shell, unsupported methods, provider status/error normalization,
  malformed provider responses, and insufficient-capability fixtures.
- Order ledger tests: source contract, idempotency, durable pre-submit state,
  audit-durability block, duplicate changed intent, and restart-safe pending
  submit.
- Provider attempt tests: success, rejection, timeout unknown, malformed
  response, cancel accepted, replace accepted, duplicate provider ref, and
  no-blind-retry behavior.
- Reconciliation tests: fill, partial fill, reject, cancel, replace, timeout,
  unknown provider state, stream gap, stale provider reads, provider
  unavailable, manual reconcile, divergence pause, and no-blind-resume.
- UI tests: portal provider/connect/status/disconnect/full reconnect/activity,
  platform account readiness/configuration/activate/pause/resume/kill switch,
  reauth/reconciliation recovery, terminal account routing, terminal order
  ticket capability gates, strategy subscription caps, strategy pause/resume,
  divergence display, and beta readiness activity.
- UI regression tests: broker login/authorization flow is reachable from the
  portal dashboard/settings gate and not from a terminal top popover.
- Regression tests: charts/signals/scanners do not require user broker market
  data scope.

## Risks And Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Broker APIs have inconsistent preview/order semantics | Bad fills, rejected orders, or false confidence | Capability matrix, provider-specific adapter tests, fail closed when preview/order state is stale. |
| Token custody creates security burden | Account compromise risk | Managed auth, encrypted token storage, strict redaction, rotation plan, short retention of sensitive logs. |
| Submit timeout causes duplicate trades | Financial loss | Durable order intent, idempotency keys, no blind retry, reconcile before retry. |
| Account/order reads lag provider reality | Automation acts on stale state | Freshness thresholds and automatic pause on stale/unknown state. |
| Aggregator abstraction hides provider differences | Unsupported order behavior leaks into production | PYRUS-owned adapter contract and provider capability gating. |
| IBKR Gateway does not fit hosted OAuth model | Setup friction for IBKR users | Treat IBKR as special connector/VPS/agent path, not the general broker pattern. |

## Open Questions

No remaining main-plan open questions after the current review pass. Deferred
provider decisions are tracked in
`docs/plans/broker-provider-classification-matrix.md`.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | Not run | Not part of this checkpoint. |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | Not run | Not part of this checkpoint. |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | In progress | 11 architecture decisions accepted, 2 code-quality decisions accepted, packet-level test matrix added, test-plan artifact created, numeric performance budgets deferred. |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | Not run | UI plan exists but design review has not run. |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | Not run | Developer-experience review has not run. |

- **UNRESOLVED:** No remaining main-plan open questions. Deferred provider
  decisions live in `docs/plans/broker-provider-classification-matrix.md`.
  Numeric latency, freshness, timeout, and reconciliation budgets are deferred
  to a later performance review.
- **ARTIFACTS:** Eng-review test plan exists at
  `/home/runner/.gstack/projects/workspace/runner-main-eng-review-test-plan-2026-06-08T173506Z.md`.
- **VERDICT:** ENG REVIEW NOT YET CLEARED. Implementation remains blocked until
  the full-plan checkpoint is explicitly accepted.
