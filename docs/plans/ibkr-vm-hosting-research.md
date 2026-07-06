# IBKR on VMs / cloud — how others actually do it (research, 2026-07-06)

Research question: **how have others successfully run IBKR's Client Portal Gateway (clientportal.gw) or TWS/IB Gateway on virtual machines / cloud instead of the end user's own computer?** Compiled for the PYRUS hosted-IBKR workstream (which has been fighting to host CP Gateway centrally and hits a post-2FA "bounce back to login" loop). Sources are primary where possible (IBKR docs, GitHub repos/issues, community threads). Confidence is flagged per claim.

> Provenance: multi-agent web research (run wf_50acaad9-42a). A schema-forcing bug corrupted the agents' final structured emit; the underlying research (5 WebSearch + 5 WebFetch per angle) was recovered intact from the agent transcripts. Findings below are single-pass (the adversarial-verify stage did not survive the bug) — treat medium/low-confidence claims as unverified.

## Bottom line

There are **two completely different IBKR systems**, and their cloud maturity is night-and-day:

1. **Client Portal Gateway (clientportal.gw)** — the REST/web-login gateway PYRUS uses. **IBKR officially treats it as a same-machine/localhost tool**; running it on a separate machine or behind a proxy is "**not a supported practice**." It *can* be cloud-hosted (via IBeam) but is best-effort/fragile, and there is **no documented working reverse-proxy subpath recipe** — and, critically, **no primary source proves that serving it at its own root origin fixes the post-2FA login loop**.
2. **IB Gateway / TWS headless** — the classic Java desktop app + TWS socket API (ports 4001/4002). Run headless with **IBC + Xvfb + x11vnc + socat**, packaged by **gnzsnz/ib-gateway-docker**. This is the **mature, production-grade, battle-tested** cloud pattern (runs on AWS ECS in production), and it's what serious algo operators actually use.

For a **hosted multi-user product**, the two real answers are (a) a **per-account gateway fleet** (one container per account — heavy but proven) or (b) **IBKR OAuth 1.0a** (officially "blessed," **no gateway per user**, but needs Compliance approval). Data aggregators do **not** rescue IBKR trading — **SnapTrade's IBKR integration is read-only Flex Query, no order placement**.

The recurring wall on **both** systems is **not** IP/datacenter blocking — it's **IBKR's authentication cadence** (daily/periodic re-auth + a **weekly Sunday ~01:00 ET** 2FA that no headless setup fully escapes) and **IBKR's one-session-per-username rule**.

---

## 1. CP Gateway (clientportal.gw) in the cloud — IBeam

- **IBeam (voyz/ibeam) is the de-facto tool.** It runs clientportal.gw under a virtual display (pyvirtualdisplay) and automates the browser login with Selenium/Chrome, then keeps the session alive via `/tickle`, re-authenticating when it lapses. Officially documented on **AWS/GCP/DigitalOcean** (DigitalOcean gets a full walkthrough: 2GB droplet, NY region, port 5000). *[high]* — github.com/Voyz/ibeam wiki (Cloud-Deployment, Installation)
- **The exact PYRUS failure is a known IBeam bug.** "**Gateway session active but not authenticated**": browser login succeeds (`Client login succeeds`) then the gateway reports `authenticated=false` seconds later and re-auths every ~15s. Reported repeatedly and **often unresolved** — IBeam issues **#7, #152, #267**. **This happens in clean Docker with no reverse proxy at all** — evidence that a subpath proxy is *not* the sole cause, and that own-origin serving may not fix it. *[high]*
- **"Access Denied" ≠ datacenter-IP block.** It's the gateway's **own `conf.yaml` `ips/allow` list** rejecting a peer IP; Docker needs `network_mode: bridge` / allow `172.17.0.*`. Local config, not IBKR-side policy. *[high]* — ibeam wiki Troubleshooting
- **Headless 2FA is limited:** only fully-automated **TOTP**, an **External-Request** handler, or **Google-Messages SMS-scraping** work. **IBKR Mobile push and the IB Key security card cannot be automated headless.** IBeam warns this is "not an officially supported automatic interface." *[high]* — ibeam wiki Two-Factor-Authentication
- **Reliability caveat:** cloud IBeam instances have gone unresponsive after ~24h (a maintenance-cycle disconnect that fails to reconnect; `net::ERR_CONNECTION_REFUSED`) — DigitalOcean droplet, issue **#214**. *[medium]*
- **Not IBKR-endorsed, credential-injection is a real security risk** — framed as best-effort, not production-guaranteed. *[high]*

## 2. IB Gateway / TWS headless — the mature alternative

- **Canonical stack: IBC (IbcAlpha/IBC) + Xvfb + x11vnc + socat**, packaged by **gnzsnz/ib-gateway-docker** (+ many interchangeable forks: mfrener, heshiming/ibga, hartza-capital, datawookie, cslev, waytrade). Drives the **TWS socket API** on 4001/7496 (live), 4002/7497 (paper). **Genuinely production-grade** — Hartza Capital runs it on **AWS ECS** in production. *[high]*
- **The hard constraint is IBKR policy, not the tooling:** IBKR **invalidates security tokens every Sunday ~01:00 ET**, forcing a manual 2FA once/week. Between Sundays a scheduled **AUTO_RESTART preserves the token and reconnects without 2FA** — but any **mid-week crash re-triggers 2FA** and the bot is offline until a human taps IBKR Mobile. *[high]* — ibkrguides auto-restart doc, QuantRocket
- **Sharp edges:** multiple configured 2FA devices **deadlock IBC's login** (can't pick a device — reduce to one); arm64 token-path bugs cause *nightly* 2FA; the socket API has **no encryption/auth** (must SSH-tunnel / socat, never expose to 0.0.0.0). *[high/medium]* — IBC #118, gnzsnz README/#167
- **Resource-heavy:** ~768MB–1GB+ Java heap + ~1GB shm + a virtual display **per process**; ~2GB RAM/1 core each in K8s. Needs health-check-driven auto-restart because IB Gateway hangs. *[high]*

## 3. Auth / 2FA / IP walls — confirmed vs myth

- **MYTH (unsupported by primary sources): "IBKR blocks datacenter/cloud IPs."** The narrative traces to **static-IP proxy vendor marketing** (QuotaGuard, torchproxies), not IBKR docs or reproducible reports. IBeam's own guide treats AWS/GCP/DO as normal targets. *[medium]* — confirms PYRUS's earlier datacenter-IP refutation.
- **REAL: "IP Restrictions" is an opt-in account setting** (Settings > Security) that whitelists IPs for TWS/Mobile/Portal; changes take effect **next business day**. A rotating cloud IP breaks it → use a **reserved/static egress IP** (only matters if you enabled the feature). *[high]* — ibkrguides
- **REAL and load-bearing: one active session per username.** A competing login anywhere (another VM, **or your phone's IBKR Mobile**) de-authenticates the running gateway; the error mentions "connected from a different IP address" (misread as IP blocking). Documented fix = a **separate second username** for the automation. *[high]* — QuantConnect IB docs
- **REAL: the actual wall is 2FA + session expiry**, not IP. Interactive login needs **IBKR Mobile (IB Key)**; SMS/card/3rd-party-authenticator are unsupported for live. **~3-minute** hard 2FA-acknowledgment window. CP Web API sessions expire **~daily (24h)**; a **weekly Sunday** re-auth for live. *[high]*
- **Weak/anecdotal:** a few "Invalid username/password" reports correlate with geography and were sometimes cleared by VPN — folklore, not confirmed policy. *[medium]*
- **OAuth is the sanctioned way to skip the browser login entirely.** *[medium]*

## 4. Reverse proxy / own-origin — does it fix the loop?

- **IBKR: the gateway is a local same-machine tool; remote operation "is not a supported practice," and you must log in via a browser on the same machine as the gateway.** This is the root reason proxy setups are fragile. *[high]* — IBKR Campus (Launching & Authenticating the Gateway)
- **`portalBaseURL` (conf.yaml, default "") is undocumented;** users repeatedly ask what it does and get no answer — **no confirmed recipe** for relocating the SPA under a subpath. *[high]* — ibeam Gateway-Configuration, #148
- **Common confusion:** `proxyRemoteHost`/`proxyRemoteSsl` are the gateway's **own upstream to api.ibkr.com**, *not* a front proxy. No conf key configures trust of a front proxy. *[medium]*
- **The bundled UI is a root-anchored hash-routed SPA** (`https://localhost:<port>/demo#/`). Changing the **listen port** works (still root origin); there is **no primary-source example of a working subpath mount**. *[medium]*
- **⚠️ The decisive gap:** **no primary source proves that own-root serving fixes the post-2FA login loop.** It's a *plausible inference* (SPA is root-anchored; IBKR's same-machine model), but no repo/doc/thread demonstrates the loop appearing under a subpath and disappearing at root. *[medium]*
- **Browser quirk (confound):** datawookie reported CP Gateway auth **fails in Firefox, works in Chrome**, and needed to load `/demo#/` before the main login page. *[medium]*

## 5. Multi-user / hosted-SaaS reality

- **Two scaling paths only:**
  - **Per-account gateway fleet** — one CP Gateway (IBeam) or one IB Gateway (IBC) **per live account** (a single process can't multiplex live logins; only live+paper co-reside). Proven in Docker/K8s but heavy + needs per-process keepalive. IBeam #98/#115, gnzsnz #225. *[high]*
  - **IBKR third-party OAuth 1.0a** — authenticates REST calls directly against api.ibkr.com **with no gateway per user**. Officially institutional; needs **Compliance approval + registered business entity + financial-authority registration**. Community reports OAuth 1.0a *does* work on individual **Pro** accounts. *[high/medium]* — IBKR Campus Third-Party-Connections, ibind OAuth wiki
- **Aggregators don't help:** **SnapTrade IBKR = read-only Flex Query, no order placement.** *[high]* — confirms PYRUS's earlier finding.
- Commercial products (e.g. TradersPost) present IBKR as fully cloud-hosted "no local software" — implying a hosted per-account connection or third-party approval. *[medium]*

## 6. Provider reports

- **CP Gateway/IBeam:** designed for Docker on AWS/GCP/DigitalOcean; **DO** best-documented. AWS-Linux IBeam still gets a **daily** 2FA push (the desktop auto-restart-to-weekly GUI setting isn't exposed on headless Linux — issue #150). *[high]*
- **IB Gateway/IBC:** run on EC2/GCP/Hetzner/**Raspberry Pi** (ARM64 + Bellsoft Liberica JDK). Concrete fix patterns: **TrustedIPs "does not work" → use socat/SSH tunnel** (gnzsnz #167); raise **ulimit nofile 65536** to stop crashes (#245); align daily restart with IBKR's overnight window (~23:45–00:45 ET). Reported "fairly stable," ~1 startup failure/month. *[high/medium]*
- **Home vs cloud:** some traders deliberately keep the gateway on a **home IP** to sidestep login friction; hard first-hand A/B evidence was thin (Reddit not crawlable). *[medium]*

---

## Implications for PYRUS

**On the own-origin de-risk (the queued clean login test):**
- The evidence is **mixed-to-skeptical**: (a) IBKR officially calls remote/proxy CP Gateway unsupported; (b) **no source proves own-root fixes the post-2FA loop**; (c) the loop appears **even in clean own-origin Docker** (IBeam #152/#267). So a PASS is **not predicted** by the literature.
- **But it's still worth exactly ONE clean attempt** because it cheaply tests our specific cookie-fragmentation theory in isolation, *if* we control the confounds:
  - Use a **paper account** (paper CP logins typically skip the IBKR-Mobile 2FA — which also removes the **single-session/competing-login** confound, isolating the pure cookie/own-origin variable).
  - **Nothing else logged in** for that account (no Client Portal / TWS / IBKR Mobile session) — the one-session rule silently kills the gateway session.
  - **Chrome incognito** (Firefox is reported broken); consider the `/demo#/`-first trick.
  - Watch the gateway DEBUG log for `Client login succeeds` → whether the server-side `sso/validate?gw=1` carries `x-sess-uuid`.
- **Treat it as a decisive fork:** PASS → own-origin is a viable interim for attended paper use; FAIL → **stop fighting central CP Gateway** and commit to a proven path.

**The proven paths (where the evidence points):**
1. **IBKR OAuth 1.0a** (PYRUS "Track A", already scoped in `ibkr-third-party-oauth-scope.md` + `ibkr-oauth-selfservice-runbook.md`) — the officially blessed multi-user path, **no gateway fleet**. Self-service OAuth validates ~80% of the build with no approval. **This is the strongest long-term answer for a hosted product.**
2. **IB Gateway/TWS headless (IBC + gnzsnz/ib-gateway-docker)** — if we want a working connection *now* without OAuth approval, this is the mature, production-grade route (socket API, not REST). Cost: per-account container + the weekly-Sunday-2FA asterisk + it's a different API surface than our CP Gateway client.
3. **Local self-host connector** (PYRUS "Track B") — sidesteps everything by running the gateway on the user's own machine (IBKR's supported model).

**Cheapest decisive next experiment:** the clean paper own-origin login (above) — it's ~one command's worth of risk and definitively forks "interim CP Gateway viable" vs "commit to OAuth 1.0a / IB Gateway."
