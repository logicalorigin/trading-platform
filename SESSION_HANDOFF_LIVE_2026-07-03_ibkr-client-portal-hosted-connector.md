# LIVE Handoff — IBKR Client Portal hosted connector (no OAuth approval)

Session ID: b21b5fa5-86c2-44ca-9006-aaa6beecc5b7 (dropped by container reset ~18:31 MDT 2026-07-03; transcript unrecoverable)
Resumed by: 3dd4cb3d-8946-4962-8496-2634846ebd2e (2026-07-03 evening; dropped by SECOND container reset ~19:16 MDT; transcript unrecoverable)
Resumed by: 63101575-7590-43f1-b9b1-f1f0558acf50 (2026-07-03 ~19:20 MDT)
Resumed by: 5044e347-5a40-4ae3-9f7a-b26161a08416 (2026-07-04 ~14:20 MDT — post dummy-cred E2E; runtime re-verified: healthz 200, re-anchor guard live in app.ts+vite.config.ts, .pyrus-runtime/ibkr-cpg present, proxy trail ends with POST /sso/Authenticator 200 x2; no gateway process currently running — expected, gateways are API children and respawn on Connect)

## RECOVERY EVENT #2 2026-07-03 ~19:16 MDT (resolved 19:20)
- Second container reset (uptime showed 0:03 at 19:19) wiped ~/.claude transcripts again AND
  /home/runner/ibkr-cpg — same failure mode as the 18:31 reset.
- Durability held again: replit.nix temurin-bin-17 kept `java` on PATH. Re-ran
  `node scripts/ensure-ibkr-portal-runtime.mjs` → clientportal.gw re-downloaded, "runtime OK".
- Verified post-recovery: repo-side connector files all present (routes/ibkr-portal.ts,
  services/ibkr-portal-{gateway-manager,session,context}.ts, ibkrPortalConnectModel.js);
  API healthz 200; /api/broker-execution/ibkr-portal/readiness live + 401 auth-guarded (expected).
- This is now the SECOND wipe in ~45 min → the pending durability decision (auto-run ensure
  script at startup vs move IBKR_PORTAL_HOME into workspace vs manual) is getting expensive;
  recommend deciding now.

## DURABILITY DECISION RESOLVED 2026-07-03 ~19:30 MDT — option (b) IMPLEMENTED
- User chose (b): IBKR_PORTAL_HOME default moved INTO the workspace. New default:
  `<repo>/.pyrus-runtime/ibkr-cpg` (already gitignored via `.pyrus-runtime/`; survives
  container resets — /home/runner/ibkr-cpg is retired).
- Code: gateway-manager.ts default now `path.join(findRepoRoot(), ".pyrus-runtime", "ibkr-cpg")`
  (findRepoRoot newly exported from runtime-flight-recorder.ts); env override still wins
  (now path.resolve'd). ensure-ibkr-portal-runtime.mjs anchors default off its own script dir
  (`<scripts>/..`). .env.example updated (IBKR_PORTAL_HOME= empty, comment documents default).
- Runtime physically moved (mv) to .pyrus-runtime/ibkr-cpg; ensure script re-run → "gateway
  present … runtime OK" (idempotent hit, no re-download). Startup contract NOT touched (no
  audit:replit-startup needed).
- Validated: api tsc exit 0; SIGUSR2 reload; loopback + public healthz 200; dist bundle
  contains `".pyrus-runtime", "ibkr-cpg"` and has ZERO occurrences of /home/runner/ibkr-cpg;
  jar existsSync true at new path; java on PATH (temurin via replit.nix).
- NEXT: user performs REAL login (Settings ▸ Broker Connections ▸ IBKR Client Portal ▸ Connect).

## RECOVERY EVENT 2026-07-03 ~18:31 MDT (resolved)
- Container reset rebuilt /home/runner outside the workspace: wiped `~/.claude` transcripts
  (the "3 dropped sessions") AND `/home/runner/ibkr-cpg` → UI showed "The IBKR Client Portal
  runtime is not installed on this instance." (readiness → unavailable; gateway-manager.ts:68
  existsSync(GATEWAY_JAR) false).
- Durability held where designed: `replit.nix` temurin-bin-17 → `java` back on PATH from nix
  after the rebuild. Re-ran `node scripts/ensure-ibkr-portal-runtime.mjs` → clientportal.gw
  re-downloaded (22MB total under /home/runner/ibkr-cpg).
- Boot-tested the FRESH distribution with a faithful replica of setupInstance+spawnGateway
  (port 5390, non-pool): conf rewrite OK, JVM up <60s, GET / → 302 login redirect,
  /v1/api/iserver/auth/status → 403 pre-session (maps to needs_login via readiness catch),
  clean SIGTERM. PASS. No API reload needed — readiness re-checks the jar per request.
- STILL OPEN (durability decision): /home/runner/ibkr-cpg will be wiped again on the NEXT
  container reset. Options: (a) auto-run ensure script in dev startup (touches startup
  contract → must run `pnpm run audit:replit-startup`), (b) move IBKR_PORTAL_HOME into the
  workspace (gitignored; survives resets), (c) leave manual (run the script when the error
  reappears). User decision pending.
Started from: resume of workstream #1 (2e482682 — Robinhood/Schwab broker connections),
then pivoted to IBKR Client Portal per user request.
Branch: perf/elu-loop-pressure-fixes (huge uncommitted pile; this work is untracked too).

## BUG 2026-07-03 eve: popup loads IBKR login then flips to PYRUS app (ROOT-CAUSED)
- Popup opens loginPath `/api/broker-execution/ibkr-portal/gateway/` → proxy → gateway 302
  → `/sso/Login`. Gateway login is a JS SPA (xyz.bundle.min.js 570KB) that uses ROOT-ABSOLUTE
  URLs (`/sso/…`, `/v1/api/…`) built at runtime.
- When that JS navigates the popup's top document to a root-absolute non-`/api` path, the
  browser leaves the `/api/.../gateway/` mount and hits our ORIGIN ROOT. Our Express SPA
  fallback `app.get(/^(?!\/api(?:\/|$)).*/)` (app.ts:246) serves index.html for EVERY non-api
  GET. PROVEN: `GET https://<domain>/sso/Login` → 200 `<title>PYRUS Platform</title>`.
  => popup renders PYRUS instead of the login page. Static body-rewriting (rewriteBody) can't
  catch JS-computed runtime paths → fundamentally leaky under a subpath mount.
- CPG has NO usable base-path config (portalBaseURL is for callbacks, not asset paths); it
  assumes it owns the origin root.
- DEEPER REALITY (surfaced to user): CPG is a STATEFUL JVM (one authed IBKR session, in-memory
  gateway map + auth rate-limiter). Incompatible with current `deploymentTarget=autoscale`
  (scale-to-zero kills sessions; multi-instance each has its own map — auth.ts already warns
  "distributed limiter required before multi-instance deploy"). Reliable path = single always-on
  host (Reserved VM) + serve each gateway at a HOST ROOT (own hostname/port) so zero rewriting
  is needed. Awaiting user decision (interim in-app carve-out vs durable host isolation; infra).

## Goal
Let users connect IBKR **without** IBKR OAuth vendor approval, by hosting IBKR's Java
Client Portal Gateway (CPG / clientportal.gw) in-container and proxying the browser login
through our public domain. **Multiple IBKR accounts per instance** (one gateway process per
connected app user). **Trading + account only** (no market-data websocket).

## Origin (git archaeology — completed)
- CPG was the app's ORIGINAL IBKR path (repo root commit 6f980b4, 2026-04-23). Removed in
  `b65202c` (2026-04-30) which collapsed transport to TWS-only; TWS bridge tree finally
  retired in `ccf6701` (2026-07-02).
- Low-level REST client `artifacts/api-server/src/providers/ibkr/client.ts` STILL EXISTS and
  is used (getSessionStatus `/iserver/auth/status`, tickleSession `/tickle`,
  ensureBrokerageSession, etc.). `getIbkrRuntimeConfig()` (lib/runtime.ts:601) still reads a
  client-portal base URL — NOT gated on transport. Deleted bridge provider recovered to
  /home/runner/ibkr-cpg/spike-proxy… (reference only).

## Runtime staged OUTSIDE the repo (no git noise, no replit.nix change yet)
`/home/runner/ibkr-cpg/`: `jre/` (Temurin 17, symlink), `gw/` (clientportal.gw), `instances/`.
- CONFIRMED: Java+CPG run in-container; JVM ~124MB RSS; login page renders cleanly through a
  reverse proxy on a different host (Phase-0 spike screenshot verified).
- CPG launch quirk: `GatewayStart` resolves `--conf` relative to the classpath config dir
  (`root`), so the arg MUST be `../root/conf.yaml` (NOT `root/conf.yaml`).

## Built this session (backend — DONE, typecheck GREEN, live via SIGUSR2, integration-tested)
- `services/ibkr-portal-gateway-manager.ts` — per-user CPG process pool (spawn on distinct
  ports from IBKR_PORTAL_BASE_PORT=5200, health-wait, teardown, cap IBKR_PORTAL_MAX_GATEWAYS=4).
- `services/ibkr-portal-session.ts` — connect / readiness / status / disconnect + tickle
  keep-alive; builds a per-user `new IbkrClient({baseUrl, allowInsecureTls:true})`.
- `routes/ibkr-portal.ts` — Express router: GET readiness, GET status, POST connect (CSRF),
  POST disconnect (CSRF), and `router.use()` browser-facing reverse PROXY at
  `/api/broker-execution/ibkr-portal/gateway` (Location/Set-Cookie/body URL rewriting).
  Mounted in routes/index.ts.
- `.env.example` — IBKR_PORTAL_HOME / _JAVA_BIN / _GW_DIR / _BASE_PORT / _MAX_GATEWAYS.
- Integration test (real gateway spawn) PASSED: connect→needs_login, gateway ready on 5200,
  disconnect→pool empty. Endpoints live: all 401 auth-guarded; `../root/conf.yaml` in dist.

## Frontend (DONE — pyrus typecheck GREEN, self-verified)
- `artifacts/pyrus/src/screens/settings/ibkrPortalConnectModel.js` (new) + IBKR tile in
  `SnapTradeConnectPanel.jsx` (isIbkrPortal branch, raw fetch — no orval hooks). Connect →
  popup login → polls status every 3s until connected; Disconnect; unavailable state handled.
  Reuses existing csrfHeaders + openBrokerPopup. Calls the 4 /ibkr-portal/* endpoints. Vite
  hot-reloads it — the tile is live in Settings ▸ Broker Connections now.

## Proxy login VALIDATED with dummy credentials (2026-07-03)
- Drove a headless browser through a faithful standalone copy of the production proxy
  (same GW_BASE + rewriteLocation/SetCookie/Body) to a real gateway, submitted dummy creds.
- Result: IBKR returned **"Invalid username password combination"** — i.e. the credential
  POST routed THROUGH the proxy to api.ibkr.com and the auth response rendered back on the
  proxy host. Entire login round-trip stayed on-host (only off-host req = IBKR's go-mpulse
  analytics beacon). With REAL creds this path authenticates → session → readiness=connected.
- BUG FOUND + FIXED: the proxy could call res.send() after the response was finalized
  (client abort / dup end) → ERR_HTTP_HEADERS_SENT (would be an uncaught crash in the app).
  Fixed in routes/ibkr-portal.ts with a single-finalize guard + up/req abort handling.
  Typecheck GREEN, reloaded (SIGUSR2), `settled = true` guard confirmed in dist bundle.

## Infrastructure completed 2026-07-03 (items 2 + 3, all validated)
- **Gateway now serves PLAIN HTTP on loopback** (listenSsl:false). Reason: global fetch can't
  skip TLS verification without an undici dispatcher (undici not importable here); self-signed
  HTTPS broke the server-side IbkrClient. Browser still reaches it via our TLS proxy. Login
  RE-VALIDATED end-to-end over HTTP → dummy creds → "Invalid username password combination".
- **Durability:** replit.nix adds `pkgs.temurin-bin-17` (durable Java next rebuild); manager
  resolves java env→portable→PATH; `scripts/ensure-ibkr-portal-runtime.mjs` idempotently
  provisions clientportal.gw (+ portable JRE fallback) on fresh envs.
- **Per-user routing (account + TRADING):** `services/ibkr-portal-context.ts` (AsyncLocalStorage
  appUserId) set by an app.ts middleware (read-only indexed session lookup when cookie present);
  `getIbkrClientPortalClient()` routes to the connected user's gateway, else global-env fallback
  (background auto-trader UNCHANGED — deliberately not per-user; flag for a separate pass).
  Verified: inside user ctx → reaches that user's gateway (HTTP 401 pre-login); outside → 503
  (no leak). Trading-safety property holds.
- **Typed contracts:** openapi.yaml + orval regenerated (api-zod + api-client-react hooks) for the
  4 ibkr-portal endpoints; routes .parse() the generated schemas; frontend tile swapped off raw
  fetch to the generated hooks. api tsc 0, pyrus tsc 0, api-codegen drift 0, runtime zod-parse 0.

## NEXT
1. **Real login (USER):** Settings ▸ Broker Connections ▸ Interactive Brokers (Client Portal)
   ▸ Connect → real IBKR creds + 2FA → readiness flips to `connected`; then place a test trade.
   All infra validated; this is the end-to-end confirmation.
2. **Commit — DECISION: HOLD (user, 2026-07-03).** Not committing; ~749-file entangled
   multi-session pile can't be cleanly split. Connector is live + captured here. Branch
   hygiene / commits to be handled separately after the real login.
3. Deferred: per-user routing for the BACKGROUND overnight auto-trader (needs deployment-owner
   threading — high-stakes, separate).
2. **Durability:** the portable JRE won't survive a container rebuild — add Temurin to
   replit.nix (+ a step to fetch clientportal.gw) before relying on it long-term.
3. Follow-ons: OpenAPI + orval codegen for typed hooks; thread per-user IBKR routing through
   the ~10 downstream account/order services (getIbkrClientPortalClient(appUserId)); unit tests
   for the manager/session; commit strategy for the whole uncommitted pile.

## RESUMED 2026-07-04 (~12:30–13:05 MDT) by fa22886b-de00-47f1-8f95-0789b04b265b — real-login failure diagnosis
- User attempted real login: popup #1 = login page WITHOUT form (banner+footer only); "Continue
  login" window #2 = form renders, credentials accepted, then window "jumps to PYRUS errantly"
  (mount escape post-auth). Status never reached connected.
- Verified NOT the cause (observed): static asset paths all rewritten (offline simulation of
  rewriteBody over real gateway HTML/JS/CSS → 0 escaping refs besides cosmetic gdpr iframe +
  credential.recovery link); admission middleware (gateway path classifies "active-screen",
  never shed); COOP/COEP (mode=report-only).
- Verified WORKING (observed): full subpath pipeline via faithful unauthenticated replica proxy
  (scratchpad replica-proxy.mjs :5299 → spike gateway :5390) driven headlessly — form renders,
  credential POST round-trips to IBKR ("Invalid username password combination" with env
  IBKR_USERNAME/IBKR_PASSWORD creds, which are NOT valid CP Gateway creds). Cannot drive past
  real auth without user's creds + 2FA.
- NEW FRAGILITY (observed): CPG gateways are children of the API process — supervisor/API
  restarts (pid 393→20616 today) kill all user gateways; SIGUSR2 backend reloads will too.
  Needs lifecycle decision (detach/re-adopt or respawn-on-demand + UI re-login prompt).
- INSTRUMENTED (live): routes/ibkr-portal.ts proxyToGateway now appends a JSONL trail
  (method+path only, query stripped; upstream status/bytes/ms; rewritten redirect target;
  auth-denied; no-gateway; upstream-error) to .pyrus-runtime/ibkr-portal-proxy-trail.jsonl.
  tsc clean, SIGUSR2 reloaded, bundle grep 1 hit, trail write verified (auth-denied smoke).
- NEXT: user retries Connect + full login; read trail to pin (a) popup #1 asset failure mode,
  (b) post-auth escape URL; then fix (likely: rewrite/intercept post-auth landing + close popup
  on connected-poll + friendly gateway-booting page).

## RESUMED 2026-07-04 (~19:15–19:45 MDT) by dd862e5f — live login watch, bug #1 FIXED, bug #2 ROOT-CAUSED
Drove the real login flow headlessly (QA admin session cc74ab92, isolated gateway :5201) via
Playwright against the public domain + real proxy + real gateway; watched console/network/nav.

- **BUG #1 (popup #1 = login page WITHOUT form / "jumps to PYRUS") — FIXED + VERIFIED.**
  Root cause (observed): IBKR's login SPA fetches root-absolute asset URLs computed at runtime
  (`/en/includes/general/gdpr-am.php`, plus in dev `/@vite/client`, `/src/main.tsx`, …). Those
  escape the subpath mount, hit our origin root, and the SPA fallback served them PYRUS
  `index.html`; the gateway page injected that shell into `#root` and PYRUS booted inside the
  popup, hiding the form (screenshot ibkr-login-1-form.png before fix = "Loading app shell 17%").
  Fix: a Referer-based re-anchor guard — any request whose `Referer` pathname is inside the
  gateway mount is 307-redirected (method+body preserving) back under the mount so it resolves
  against the gateway, not our SPA. Added in BOTH layers:
    - `artifacts/pyrus/vite.config.ts` — new `ibkr-gateway-mount-reanchor` dev middleware plugin.
    - `artifacts/api-server/src/app.ts` — same guard before `express.static`/SPA fallback (prod).
  Verified: api tsc 0, pyrus tsc 0, SIGUSR2 reload, healthz 200. Re-ran headless watch → form
  renders and PERSISTS through submit (ibkr-login-3-after-submit.png = real IBKR login form).
  Guard curl test: escaped path w/ gateway Referer → 302 back under mount; no Referer → SPA 200.

- **BUG #2 (credential submit fails) — ROOT-CAUSED, fix is a DECISION (not yet applied).**
  With the form now working, clicking submit fires the SPA's API calls to root-absolute
  `/api/Authenticator` (+ `/api/report`, `/api/Dispatcher`). PROVEN root cause: the SPA bundle
  (sso/lib/xyz.bundle.min.js) computes its API base as
  `document.location.host + "/" + document.location.pathname.split("/")[1] + "/"` — the FIRST
  path segment of the page URL. At gateway root the page is `/sso/Login` → segment `sso` →
  correct base `/sso/`. Under our mount the page is
  `/api/broker-execution/ibkr-portal/gateway/sso/Login` → segment `api` → WRONG base `/api/`.
  Verified against the live gateway: `POST /sso/Authenticator` → 200 (real handler);
  `POST /api/Authenticator` → 302 to https://api.ibkr.com/api/Authenticator (the gateway's
  catch-all for unknown /api/*), which the browser XHR can't follow cross-origin (CORS block).
  Server-side following that 302 is a dead end too (api.ibkr.com/api/Authenticator → 404; the
  catch-all maps to a non-real remote path). NOTE: could NOT reach the real credential POST with
  dummy creds (client-side validation stops first), but the endpoint-derivation bug is proven
  structurally regardless of creds.
  => This is the LIVE-note "subpath mount is fundamentally leaky for JS-computed paths" prediction
  (lines 64-73) confirmed at the source line. Two fixes on the table:
    (a) DURABLE/infra: serve each gateway at a HOST ROOT (own hostname/port) so pathname seg1 is
        `sso` and the SPA computes correct bases with zero rewriting (already the note's
        recommended end-state; bigger change, deployment-target implications).
    (b) INTERIM/proxy hack: since seg1 is always `api` under our mount, rewrite gateway-referer'd
        `/api/<X>` → gateway `/sso/<X>` in the re-anchor (inverse of the corruption). Cheap to try,
        would likely get through LOGIN, but brittle and may break the POST-AUTH flow (which
        navigates to other roots and recomputes the base). Not yet attempted — awaiting decision.
  NEXT: user picks (a) or (b); if (b), I implement + re-watch; a REAL login attempt is still the
  end-to-end confirmation either way. QA gateway (cc74ab92 :5201) left running for inspection.
  Scratch harness: /tmp/.../scratchpad/{watch-ibkr-login,probe-iframe,probe-injection}.mjs.

## FIX APPLIED 2026-07-04 (~19:50 MDT) by dd862e5f — bug #2 interim fix (a) NO, (b) YES + VERIFIED
User did a REAL login: popup reached the right place (bug #1 fix confirmed by user) but showed
"Network connectivity error: Unable to reach server" — the SPA auth XHR to /api/Authenticator
failing cross-origin. Applied interim fix (b): the re-anchor guard now rewrites the SPA's
mis-prefixed /api/<X> back to the gateway's real /sso/<X> (inverse of the seg1 corruption).
- artifacts/pyrus/vite.config.ts + artifacts/api-server/src/app.ts: re-anchor now maps a
  gateway-referer'd "/api/..." to "<mount>/sso/...", other escapes unchanged. 307 (method+body).
- Verified: api tsc 0, pyrus tsc 0, SIGUSR2 reload, healthz 200. curl: /api/Authenticator w/
  gateway referer → 307 → <mount>/sso/Authenticator; normal PYRUS /api/healthz (app referer)
  UNAFFECTED = 200. Headless re-watch: NO more /api/Authenticator CORS/ERR_FAILED; proxy trail
  shows POST /sso/Authenticator → 200 (x2), and 0 /api/* requests reach the gateway proxy.
- REMAINING (cosmetic, NOT a blocker): gateway 301s /en/includes/general/gdpr-am.php →
  www.interactivebrokers.com (IBKR marketing cookie-consent asset), which CORS-fails. Off the
  auth path; already classified cosmetic. Leave unless it proves to gate the form.
- CAVEAT: dummy creds stop at client-side validation, so a real auth VERDICT wasn't observed —
  transport is proven correct (200 to /sso/Authenticator). Real creds + 2FA = final confirmation.
- Interim vs durable: fix (b) unblocks LOGIN; the SPA recomputes its base from seg1 on post-auth
  navigations, so if a post-login screen breaks, the durable fix is host-root serving (option a).

## REAL-LOGIN ROOT CAUSE 2026-07-04 (~18:00 MDT) by 5044e347 — CP_LOGIN_FAILED (server-side, NOT our proxy)
User did a REAL login and got stuck: after phone 2FA, the popup bounces back to the login screen (loop).
Pulled the GATEWAY'S OWN logs (instance 272b0024, :5200, gw.2026-07-04.log) — DECISIVE, verified:
  17:53:37 GatewayHttpProxy: "Client login succeeds"   <- browser creds+2FA WORK
  17:53:37 GET /v1/api/sso/validate?gw=1 -> 401 ; "failed ... | reason Access Denied"; portal validate response: null
  17:53:37..50 "authentication to cp failed, retry 1..5" -> "giving up" -> CP_LOGIN_FAILED (x every attempt)
  backend readiness poll keeps seeing POST /v1/api/iserver/auth/status -> 401 (never authenticated).
=> The user's login + 2FA SUCCEED. The failure is the gateway's OWN server-side call to api.ibkr.com
   (sso/validate?gw=1) returning 401 Access Denied. That call is gateway->api.ibkr.com DIRECTLY;
   our reverse proxy is browser->gateway ONLY, so it is NOT in that path — no proxy/browser fix can
   touch it. Both bugs #1/#2 (form render, /api->/sso) remain fixed and are NOT the issue here.
Our conf.yaml (setupInstance rewrites ONLY listenPort->5200, listenSsl->false off the shipped demo conf):
   proxyRemoteHost api.ibkr.com, proxyRemoteSsl true, ip2loc US, ips.allow [192.*,131.216.*,127.0.0.1].
Account U24762790. No competing/compete event logged. Gateway runs on the REPLIT DATACENTER IP (not
   the user's machine) — a non-standard CP Gateway deployment (IBKR designs clientportal.gw for localhost).
DIAGNOSIS COMPLETE (wf_95e0e768-804, 4-agent: web research + distribution docs + our-code + synthesis).
ROOT CAUSE (HIGH confidence ~0.75, cross-verified): IBKR applies a CLOUD/DATACENTER-IP restriction at the
  SSO-session-binding (gw=1) validation tier. The gateway proxies the user's creds+2FA out from the
  Replit egress IP and IBKR ACCEPTS them (real .ibkr.com cookies) — but when the gateway then calls
  sso/validate?gw=1 to BIND that session from the same datacenter IP, IBKR's IP-filter returns 401
  "Access Denied" (IBKR's specific string for IP/location rejection, NOT entitlement/session state).
CORROBORATION (observed): our container egress IP = 34.57.181.31, AS396982 Google LLC (GCP us-central1,
  Council Bluffs IA) — a datacenter IP. Only 1 gateway JVM running (competing-session ruled out in
  practice; also wrong symptom — that yields sso/validate 200 authenticated:false, not 401).
SOURCES: ibeam Troubleshooting wiki ("Access Denied" is IP-driven; VPN helps); ibeam #179 (identical creds
  work in local Docker, fail from K8s/datacenter node); QuotaGuard (IBKR enforces IP restrictions that
  break cloud deploys; session tied to authenticating IP). RULED OUT: our proxy/conf (only listenPort+
  listenSsl changed from ship default; both inbound-only; sso/validate is gateway->api.ibkr.com, outside
  every path we own), entitlement, 2FA, competing session.
STRATEGIC IMPLICATION: the whole premise (host CP Gateway in-container to AVOID IBKR OAuth vendor approval)
  hits exactly IBKR's datacenter-IP block on the gateway-binding step. Documented fixes:
  (a) route the GATEWAY'S OUTBOUND egress (JVM :5200 -> api.ibkr.com) through a residential/whitelisted
      STATIC IP (VPN egress / residential proxy / QuotaGuard-style SOCKS5). NOTE our browser-side reverse
      proxy does NOT help — wrong leg. Implementable via JVM -Dhttps.proxyHost on spawnGateway IF the user
      provides a proxy endpoint. Highest yield.
  (b) pivot to IBKR OAuth (the officially automatable cloud path) — i.e. the vendor-approval path this
      workstream was avoiding.
  (c) IBKR API support ticket to whitelist the static IP — often declined for datacenter ranges.
DEFINITIVE CONFIRMING TEST (not yet run — needs infra): route only the gateway's egress through a
  residential/non-datacenter IP and retry; if sso/validate?gw=1 -> 200, IP-tier restriction confirmed.
HYGIENE (not the cause): conf ips.deny has malformed "212.90.324.10" (324>255 octet); harmless.
AWAITING USER DECISION on path (a)/(b)/(c) — strategic fork, has cost/approval implications.

## BROKER-UI BACKLOG RECOVERED 2026-07-04 (~14:35 MDT) by 5044e347 (completes dd862e5f's cut-off sweep)
dd862e5f's backlog-finder agent died mid-stream (API stall) right after locating the spec. Completed
the recovery: the spec for all three user themes is `docs/plans/broker-connection-ux-plan.md`
(untracked, written 13:12 MDT 2026-07-04 by dropped session 66e2e192 — its handoff is empty; the doc
is its surviving output). The "Task #3" it references was in-harness task state wiped by the container
reset (not the multi-broker-connections.md Task 3); its meaning (per-broker tradable asset-type data)
is captured in the doc itself. Master numbered plan = docs/plans/multi-broker-connections.md (Tasks
1-17). SnapTrade-lineage pending items (d33f96f6 via snaptrade-completion-takeover LIVE note): Task #4
live E*TRADE order proof (user-gated), Task #6 scoped commit (user-gated). Fresh harness task list
created in session 5044e347: #1 real IBKR login (user), #2 card-native actions, #3 lifecycle
animations + popup close, #4 non-stock asset handling, #5 gateway lifecycle across API reloads,
#6 SnapTrade user-gated leftovers.

## DUMMY-CRED E2E VERIFIED 2026-07-04 (~20:04 MDT) by dd862e5f
Drove the full popup login headlessly (QA admin cc74ab92, real proxy + real gateway) with dummy
creds AFTER the api→sso fix. RESULT: IBKR returned its real verdict **"Invalid username password
combination"** rendered in the popup (screenshot ibkr-login-3-after-submit.png = IBKR login form
with the red IBKR error banner, NOT the PYRUS shell). Proxy trail: POST /sso/Authenticator → 200
(x2), 0 /api/* leaks to the gateway. This confirms the ENTIRE login round-trip end-to-end: form
renders (bug #1 fix) → credential POST reaches gateway /sso/Authenticator (bug #2 fix) → gateway
relays to api.ibkr.com → real IBKR auth verdict renders back in the popup. Real creds + 2FA would
authenticate → session → readiness=connected. Both bugs closed; only the real-login confirmation
(user's creds) remains, and a real login is now expected to succeed.

## ROOT CAUSE CORRECTED 2026-07-04 (~18:5x MDT) by 417f3669 — DATACENTER-IP THEORY REFUTED (0.75 -> ~0.07)
User challenged the datacenter-IP diagnosis ("no reason a VM should be different from any other use").
Two adversarial workflows (context re-map wf_608b4bef; 4-angle web-research second opinion wf_6a9b7899,
Opus verdict) REFUTE the prior "IBKR blocks our GCP datacenter IP at the sso/validate?gw=1 tier" root cause.
DECISIVE (first-hand): login + phone-2FA SUCCEED from egress IP 35.254.223.172 (GCP, googleusercontent.com)
and IBKR sets real .ibkr.com cookies (web=..., x-sess-uuid=...); ONLY the gateway's own server-side
GET /v1/api/sso/validate?gw=1 returns 401 "reason Access Denied" / "portal validate response: null" (retry
1..5 -> giving up). A blanket/session-tier IP block cannot spare the login+cookie handshake yet kill only
the next call from the SAME socket. Corroboration: (a) ibeam's most-documented deployment IS the Java CP
Gateway in Docker on AWS/GCP/DigitalOcean at scale, zero datacenter-IP warnings; (b) ibeam #183 same-IP
"Access Denied" flips on cookie/request construction, not IP; (c) the pro-IP anecdote (#179) is unconfirmed
and has the OPPOSITE signature (login form itself 403s).
RANKED CAUSES (Opus verdict):
  1. p=0.45  Session-cookie binding lost in OUR reverse proxy: conf portalBaseURL:"" + proxy overwrites
     upstream Host to a bare loopback IP (ibkr-portal.ts:175 `forwardHeaders["host"]="127.0.0.1:"+port`,
     not a legal cookie Domain per RFC6265) -> gateway CookieManager logs `Remapping Set-cookies
     [x-sess-uuid=...] -> (empty)` -> its server-side gw=1 validate goes out WITHOUT the session cookie ->
     IBKR 401 "missing session". IBKR docs: CP Gateway auth "must be done on the same machine ... remote
     authentication will not work" — reverse-proxying a remote browser login through a public domain
     violates that contract. UNPROVEN link: whether the empty remap starves the SERVER-SIDE jar or only
     the browser-facing Set-Cookie — this is exactly what the discriminator test resolves.
  2. p=0.22  Account-side pending step-up identity challenge (ibeam #267, Nov-2025+, EXACT symptom match):
     a new/unfamiliar egress IP triggers an extra IBKR email/device verification the headless gateway
     can't satisfy; cleared by logging into the IBKR web portal once. Not the VM per se — any new IP.
  3. p=0.10  IBKR account "IP Restrictions" feature (Portal > Settings > Security) allowlisting trading IPs;
     a non-listed IP can log in + admin but is denied the trading session. Opt-in, off by default.
  4. p=0.08  api.ibkr.com load-balancer node refusing session bind (IBKR support: switch proxyRemoteHost
     to https://1..8.api.ibkr.com); weaker (our failure is persistent, not intermittent).
  5. p=0.07  Datacenter-IP block — REFUTED (kept nonzero only for the unproven-jar residual).
  6. p=0.08  Stale bundled gateway JAR / misc (signature mismatch: #279 has validate SUCCEEDING).
CHEAPEST DISCRIMINATOR (splits the whole diagnosis, no IP/proxy/conf change): raise the gateway
CookieManager/HTTP-client log to DEBUG, reproduce ONE login on the same IP, inspect whether the outbound
gw=1 request carries x-sess-uuid/web. Branch A (absent) -> cause #1 confirmed, fix is config (real
portalBaseURL, stop Host-overwrite to bare IP, auth over the gateway's OWN origin via localhost:5200
port-forward). Branch B (present but still 401) -> account/IBKR-side (#2/#3/#4) -> web-portal step-up +
IP-Restrictions check. STRATEGIC: the old fork (residential-proxy egress / IBKR-OAuth pivot / support
ticket) was premised on the refuted theory and is very likely UNNECESSARY. Context re-map also confirmed
IBKR-OAuth is NOT pre-built (ibkr-oauth-readiness.ts is a stub that self-reports implementation_not_complete),
so the OAuth pivot would be a from-scratch OAuth-1.0a build. Both top causes hold the IP CONSTANT.
DONE (agent, 417f3669): instrumented DEBUG logging in gateway-manager setupInstance
(artifacts/api-server/src/services/ibkr-portal-gateway-manager.ts) — the copied instance logback.xml now
bumps loggers `ibgroup.web.core.clientportal.gw.core.CookieManager` + `HttpMessageLogger` from INFO->DEBUG
(both were pinned INFO additivity=false, suppressing jar/attach detail). Purely observational, no behavior
change. api tsc GREEN; SIGUSR2 rebuild+reload; healthz 200; comment confirmed in live dist bundle. The next
Connect spawns a gateway that logs whether the outbound gw=1 carries x-sess-uuid. DEBUG log lands at
.pyrus-runtime/ibkr-cpg/instances/<user-slug>/logs/gw.<date>.log (+ gw.message.<date>.log).
NEXT: (user) (1) 5-min IBKR web-portal login as U24762790 to surface/clear any step-up challenge + check
Settings>Security>IP Restrictions; (2) app Settings>Broker Connections>IBKR (Client Portal)>Connect + full
login+2FA once. Then (agent) read the fresh DEBUG log -> Branch A (cookie ABSENT on gw=1 => our reverse-proxy
cookie-binding bug => apply config fix: real portalBaseURL / stop Host-overwrite to bare IP / auth over the
gateway's own origin) vs Branch B (cookie PRESENT but still 401 => account/IBKR-side; the portal check
above likely already resolved it). Topology fix staged, NOT yet applied (avoids blind change to trading
proxy). All connector code intact + uncommitted; only the diagnostic log-level line changed on disk.

## INSTRUMENTED LOGIN #1 2026-07-04 (~19:54 MDT) by 417f3669 — IP THEORY CONCLUSIVELY DEAD; failure moved EARLIER
User retried Connect (same browser, NOT incognito). DEBUG logging captured the flow (instance 272b0024,
gw.2026-07-04.log 19:53-19:56). DECISIVE COUNTS this run: `Client login succeeds`=0, `sso/validate`=0,
`Access Denied`=0, `authentication to cp`=0. => the login NEVER reached IBKR's server-side session-bind
this time; it failed entirely inside our browser<->gateway<->SPA layer BEFORE api.ibkr.com's validate was
ever called. The datacenter-IP theory is now not just refuted but physically impossible for this failure.
SYMPTOM: /sso/Authenticator x6 + /sso/Dispatcher all 200 (2FA HTTP-completed), but no "login succeeds" and
the SPA bounced back to the login screen (user-confirmed "goes back to login after 2fa"); afterwards only
the backend readiness poller hits /v1/api/iserver/auth/status -> 401 forever.
TWO SMOKING GUNS (observed):
  1. STALE COOKIES: the FIRST request of this attempt (gateway was 2s old) already carried prior-attempt
     session tokens `JSESSIONID=5285AF30...; x-sess-uuid=0.472b3417.1783216350...; web=4163083674`. Browser
     replays dead session state into each fresh login (same browser reused across 17:53 + 19:54 attempts).
  2. POST-2FA Dispatcher forwarded `USERID=` (EMPTY) upstream -> session came out of 2FA without a bound
     user. Likely mechanism: gateway sets `x-sess-uuid` path-less; our rewriteSetCookie (ibkr-portal.ts:117)
     strips Domain + rewrites Path=/X but does NOT pin path-less cookies, so the browser FRAGMENTS x-sess-uuid
     across mount sub-paths and sends stale/wrong ones. (Mechanism = hypothesis; fragmentation is observed:
     multiple differing x-sess-uuid in one request at gw.log lines 41/109.)
NEXT: (user) CHEAPEST test — retry in a FRESH INCOGNITO window (or clear cookies for *.riker.replit.dev) to
remove the stale-cookie confound. Outcomes: connects => stale cookies were it; bounces again => our subpath
cookie handling => implement durable fix; reaches validate?gw=1 => DEBUG now captures the outbound Cookie
(original discriminator). (agent) DURABLE FIX if clean retry still fails: serve the gateway at its OWN
host-root origin (own hostname/port) instead of the /api/broker-execution/ibkr-portal/gateway subpath —
kills cookie Path/Domain fragmentation + SPA base-path recompute + earlier render leaks in one move
(the long-flagged "option a"). DEBUG instrumentation left LIVE for the next attempt.

## INSTRUMENTED LOGIN #2 2026-07-04 (~20:03 MDT) by 417f3669 — leak #3 CONFIRMED: subpath proxy fragments the session cookie
User retried; SAME symptom (bounce to login after 2FA). Counts again: Client login succeeds=0, sso/validate=0,
Access Denied=0 — never reached the bind step; 100% inside our proxy layer. NOTE: NOT a truly clean session —
`pyrus_session=Dy9b70Baw_...` is IDENTICAL to run #1, so it was the same browser context, not incognito.
DECISIVE OBSERVATION: the browser is now holding ~17 distinct `x-sess-uuid` cookies (two IBKR-node prefixes
0.967c4217.* and 0.a37c4217.*, many timestamps) and replays 2+ per request (gw.log line 101 sends both
0.a37c4217.1783216982.b1b9006 AND 0.967c4217.1783217010.10318adc). ROOT MECHANISM (now high-confidence):
the gateway sets `x-sess-uuid` PATH-LESS on nearly every response; under our subpath mount each /sso/*,
/v1/api/*, /portal.proxy/* request is a different directory, so the browser scopes a separate x-sess-uuid to
each sub-path and accumulates a pile — the gateway then cannot resolve WHICH session token is current after
2FA, so the bind never registers and the SPA falls back to login. rewriteSetCookie (ibkr-portal.ts:117-121)
strips Domain + rewrites Path=/X but does NOT normalize path-less cookies, and emulating the gateway's
per-directory cookie scoping under a subpath is fiddly/uncertain (a path-less cookie at the gateway's OWN
origin scopes to the request directory, e.g. /sso vs /v1/api — NOT site-wide — so a naive "pin to mount root"
changes semantics and may not help). This is the THIRD distinct leak of the subpath-reverse-proxy approach
(after form-render + /api->/sso). DECISION SURFACED TO USER (do NOT keep patching blind): (1) durable fix =
serve gateway at its OWN host-root origin (no rewriting) — correct, but real Replit port-exposure + multi-user
infra work; (2) cheap targeted cookie-scope patch + a TRUE incognito retry — faster, uncertain; (3) pause
IBKR-direct and lean on the working SnapTrade + Robinhood + Schwab connectors, revisit IBKR later. Awaiting
user's investment decision. DEBUG instrumentation still LIVE. IP/residential-proxy/OAuth-pivot remain OFF the table.

## ARCHITECTURE DECISION 2026-07-04 (~20:1x MDT) — user chose HOST-ROOT via PER-USER VM (not Replit ports, not autoscale)
User: "we are only focused on getting to multi-user... we are NOT autoscaling. we will spin up a small VM to
manage the client portal connection for each unique user's instance for IBKR." => The durable fix is NOT
exposing ports on the single Replit container; it is provisioning a SMALL VM PER USER, each running that
user's CP Gateway at its OWN origin/hostname. The browser popup opens the gateway's own-origin URL directly
(root path) — retires our /api/.../gateway subpath reverse proxy entirely, which dissolves the cookie
fragmentation + SPA base-path bugs. Datacenter IP is a NON-issue (IP theory dead; login+2FA already work from
a datacenter IP). autoscale (deploymentTarget) is being dropped. Replit-port-exposure research is now moot;
gateway-own-origin conf + app-side subpath-proxy retirement remain relevant. OPEN (asked user): (1) VM
provider/platform (Fly.io Machines / GCP/AWS / Replit Reserved VM / Hetzner-DO); (2) lifecycle (on-demand
spin-up-on-connect vs persistent-per-user). Design workflow wf_b25393ed running (Replit-port angle now moot;
code-scope + gateway-conf angles reusable). NEXT after answers: re-plan the per-user-VM orchestration +
implement app-side (retire subpath proxy, add per-user gateway-origin the popup opens, keep control endpoints).

## FEASIBILITY ANSWERED 2026-07-04 (~20:3x MDT) by 417f3669 (design wf_b25393ed, 3-agent) — Replit can ORCHESTRATE but not HOST the fleet
User asked: "can our replit app, once published, support the creation of our own microVMs per user, segregated?"
+ chose PERSISTENT-per-user lifecycle. VERIFIED (high conf): Replit CANNOT host the per-user gateway fleet —
autoscale exposes exactly ONE external port + scale-to-zero + multi-instance (hostile to a stateful per-user
JVM pool); even a deploy exposes one external port and the artifact-router path-routes a SINGLE origin; external
ports are a fixed allow-list (no dynamic per-user ports). BUT the published Replit app CAN be the CONTROL PLANE
that provisions OUR OWN microVMs on an EXTERNAL provider, one per user, with kernel-level segregation. RECOMMEND:
(a) deploy PYRUS as a Replit RESERVED VM (always-on, single instance — matches "not autoscaling"; needed for the
persistent orchestrator + session tickle keep-alive + DB-backed user->VM map); (b) per-user gateways = Fly.io
Machines (Firecracker microVMs = literally "our own microVMs": API-provisioned, one per user, own TLS hostname,
strong isolation, cheap); each runs the CP gateway at its OWN ROOT origin -> retires the subpath proxy ->
dissolves the cookie/SPA bugs. Datacenter IP is fine (IP theory dead). GATEWAY CONF (research-verified): keep
listenSsl:false (edge terminates TLS), portalBaseURL:"" (SPA base = / at root, correct), keep 127.0.0.1 in
ips.allow with a Host-preserving loopback proxy ON each VM (Vert.x does NOT trust X-Forwarded-*, so the on-VM
proxy MUST preserve Host; ips.allow matches the socket peer). CODE (research-verified, self-contained, blast
radius = 4 non-generated files): retire routes/ibkr-portal.ts proxyToGateway+rewrite*+GW_BASE+trail (KEEP the 4
control endpoints), delete the app.ts + vite.config.ts reanchor guards (dead once no subpath), rename
loginPath->loginUrl (absolute gateway origin) in ibkr-portal-session.ts + openapi + regen, and open that absolute
URL in SnapTradeConnectPanel connectIbkrPortal (popup already polls server status, so cross-origin popup is fine).
CAVEATS: IBKR officially says CP-gateway auth is same-machine/remote-unsupported (community does this widely,
but unsupported); persistent-per-user = standing cost per connected user (VM must stay up to hold the IBKR
session via tickle). PHASING: Phase 1 = app-side subpath-proxy retirement (provider-agnostic, safe); Phase 2 =
Fly Machines orchestration (provision/persist/reap per user, DB map, popup->VM URL); Phase 3 = e2e verify.
Awaiting user: confirm Fly.io (or other provider) + green-light Phase 1.
