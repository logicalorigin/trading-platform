# Live Session Handoff — Current App Error Audit

- Session ID: `current-app-error-audit`
- CWD: `/home/runner/workspace`
- Started: 2026-06-02
- Last updated: 2026-06-02T16:36:43Z
- User request: Look for currently thrown app errors and prepare a report with diagnosis and solutions.

## Current Step

- Invoked `/investigate`.
- Scope remained report-oriented: inspect current live API/runtime diagnostics, flight recorder, targeted endpoints, direct IBKR bridge/sidecar surfaces, and safe browser/app surfaces before proposing fixes.
- No app code was changed. This handoff and `SESSION_HANDOFF_CURRENT.md` were the only intended file updates.
- Do not restart the full app from shell. Use Replit default **Run Replit App** only if a full bring-up is explicitly needed.

## Findings

- Overall diagnostics were still `status=down`, `severity=critical` at `2026-06-02T14:21:06Z`. The current hard failure is API latency/route errors, not an app-wide crash.
- API snapshot at `2026-06-02T14:21:27Z`:
  - `requestCount5m=1042`, `errorCount5m=8`, `warningCount5m=3`.
  - `p50LatencyMs=5`, `p95LatencyMs=5204`, `p99LatencyMs=11873`, `eventLoopMaxMs=9261`.
  - Slow/error routes included `/accounts/shadow/positions` p95 `16499ms`, `/signal-monitor/matrix` p95 `16120ms`, `/settings/ibkr-line-usage` p95 `10184ms`, `/bars` p95 `8207ms`, and Signal Options performance/cockpit/state timeouts.
- Resource pressure remained `degraded/warning` because API latency is high and caches are saturated:
  - Bars cache `entries=256/maxEntries=256`, `inFlight=9`, `cacheMiss=1289`, `providerFetch=1146`.
  - Option chains cache `entries=128/maxEntries=128`, `inFlight=15`; durable option-chain reads disabled by a failed `option_contracts` query.
  - RSS was about `2235.9MB`, heap used about `471.6MB`; no OOM evidence.
- IBKR bridge/TWS subsystem was healthy:
  - `/api/session` and diagnostics showed configured/authenticated/connected/strict-ready.
  - Direct bridge `/orders?mode=live` and `/orders?mode=paper` returned `200` in about `280-301ms`, but bridge lane diagnostics had recent control/account lane timeouts/backoff.
- Order visibility remains `degraded/warning` in the API:
  - `/api/diagnostics/latest` orders probe reported `degraded=true`, `reason=orders_timeout`, `stale=true`, `orderCount=0`.
  - Root cause appears to be sticky API suppression after a prior bridge account-lane/open-orders timeout; direct bridge order reads are currently healthy.
- IBKR async sidecar regressed from the earlier clean line-usage handoff:
  - Direct sidecar probes showed failed option lines with `IBKR did not uniquely qualify the option contract.`
  - Failures were AAPL flow-scanner option lines around expirations `2026-07-02` and `2026-07-10`, strikes `307.5/312.5`, owner `flow-scanner:AAPL`.
  - `/api/settings/ibkr-line-usage` timed out after `11340ms` with `sidecar.applyError="IBKR async sidecar request to /market-data/generation timed out after 5000ms."`
- Signal Options automation was transiently unhealthy after the shadow deployment was enabled:
  - Earlier diagnostics showed worker scan timeouts after `120000ms`, stale cockpit cache, and failed Signal Options performance/state/cockpit route reads.
  - Final diagnostics at `14:21:27Z` showed automation recovered to `ok`, `failureCount=0`, `consecutiveFailureCount=0`, but `lastScanDurationMs=97533` and `totalFailureCount=3`; treat as recovered but fragile.
- Browser/front-end safe QA:
  - Opened `http://127.0.0.1:18747/?pyrusQa=safe`.
  - Rendered `market-workspace`; no root crash, no platform error boundary, no console errors/warnings, no page errors, no request failures in the safe window.
  - Browser diagnostics warnings are from slow API/client timings and long tasks, not observed JS exceptions.
- Runtime/restarts:
  - Current supervisor and API were running. API process started around `2026-06-02T14:05:07Z`.
  - Replit restart classifier recorded `same-container-supervisor-abrupt` at startup, but cgroup OOM events were zero and current health is running.

## Diagnosis

- Primary current problem: API pressure/latency cascade from hot route fan-out and heavy synchronous diagnostics/workload endpoints.
- `/settings/ibkr-line-usage` is doing expensive sidecar generation/apply work on a GET/SSE-read path; when sidecar generation takes longer than the default 5s timeout, the route holds API capacity and surfaces stale/unknown line comparison.
- `/bars` and signal matrix/sparkline hydration are request-heavy under active market/session load; cache is full and miss/provider-fetch counts are high.
- Flow-scanner option sidecar requests are still emitting ambiguous/unqualified contracts, so failed lines can keep generation/apply work expensive.
- Signal Options shadow scans can run close to or past the 120s timeout; cockpit/performance/state routes then serve stale caches or route-level timeouts.
- Order degradation is likely a recoverable sticky suppression state inside the API after a bridge lane timeout, not a current TWS/bridge connectivity failure.

## Recommended Fixes

- Move IBKR line-usage sidecar apply out of GET/SSE reads:
  - Cache snapshots by desired-generation hash.
  - Apply new generations in a single background coordinator.
  - Have GET/SSE return last-known snapshot immediately with `stale/applying/error` fields.
  - Temporarily raise `IBKR_ASYNC_SIDECAR_REQUEST_TIMEOUT_MS` only as a mitigation, not the primary fix.
- Harden sidecar option qualification:
  - Prefer IBKR `conId`/`localSymbol` or persisted `contractDetails` for scanner-generated option lines.
  - Quarantine failed line keys by TTL so one ambiguous contract does not poison every generation apply.
  - Surface failed-line owner/symbol/expiry/strike/right in line-usage diagnostics.
- Reduce `/bars` and matrix request pressure:
  - Dedupe client callers by query hash and visible surface.
  - Batch visible-row-first requests and defer sparkline/signal-matrix background hydration under API pressure.
  - Increase or partition the bars cache by family if the 256-entry cap is too small for the 90-symbol active universe.
  - Add route metrics that include family/source/query hash to identify the biggest caller.
- Stabilize Signal Options shadow scans:
  - Cap candidate/action work per tick and resume instead of doing a full 90-symbol scan in one timeout window.
  - Add phase timings and enforce abort checks in contract resolution/Greek selector paths.
  - Prioritize active-position marks/exits over new entry scans when pressure is high.
  - Keep cockpit/performance reads stale-while-revalidate rather than letting read routes time out.
- Clear order read degradation when direct bridge orders recover:
  - Reset API order-read suppression after a successful direct/proxied bridge order snapshot.
  - Shorten the suppression TTL or expose a retry path.
  - Prewarm open-order snapshots after bridge reattach and consider a slightly longer account-lane timeout only if bridge reads regularly exceed 4s.

## Validation

- Ran `/api/healthz`, `/api/session`, `/api/diagnostics/latest`, `/api/orders`, `/api/positions`, `/api/accounts`, `/api/settings/ibkr-line-usage`, Signal Options cockpit/state/performance/events, and deployment endpoints.
- Ran direct bridge probes using runtime override config without printing secrets:
  - `/healthz`, `/orders?mode=live`, `/orders?mode=paper`, `/async-sidecar/health`, `/async-sidecar/market-data/generation`.
- Ran Replit restart diagnosis; no cgroup OOM events, current processes running.
- Ran safe Playwright browser load for `?pyrusQa=safe`; no observed JS/runtime exceptions.

## Next Step

- Implement the GET/SSE line-usage decoupling first, because it directly removes one of the slowest recurring diagnostics routes and prevents sidecar apply failures from becoming API-wide pressure.
- Then patch sidecar contract qualification/quarantine and bars/matrix request throttling.

## Follow-Up Fixes Landed - 2026-06-02 09:22:15 MDT

- Follow-up implementation continued in `SESSION_HANDOFF_2026-06-02_019e886f-b02b-70e1-8c40-018f3b7100e3.md`.
- Fixed:
  - Line-usage sidecar apply decoupling/no-overlap/timeout and generation-churn failed-apply backoff.
  - Signal Options stale/cache/in-flight summary reads.
  - Sticky order-read suppression clearing after successful bridge reads.
  - Cached `/diagnostics/latest` now stays available under critical pressure.
  - Account/position/execution bridge reads now serve stale cache while one background refresh runs.
  - Connected bridge health suppresses request-scoped lane backoff `lastError`.
  - Bars cache default increased from `256` to `1024`; synthesis-backed recent live-edge bars skip secondary IBEOS fallback while full recovery/direct broker history preserve it.
- Validation for the latest pass:
  - Focused API tests covering route admission, runtime diagnostics, account bridge cache, platform bars routing, line usage, order resilience, and Signal Options all passed.
  - API build passed.
- Still needs one Replit default Run App restart after `2026-06-02T15:22:15Z` to load the latest cached-diagnostics/account-read/bars-cache/stale-lastError build before live verification.

## Second Follow-Up Fixes And Live Check - 2026-06-02 09:57:58 MDT

- Additional fixes landed in `SESSION_HANDOFF_2026-06-02_019e886f-b02b-70e1-8c40-018f3b7100e3.md`:
  - Signal Monitor automatic matrix reads are cache-first for leaders/followers; leaders refresh in background unless critical pressure or debounce suppresses it.
  - Watchlist GET reads use a short cached snapshot with coalesced DB reads and throttled prewarm scheduling.
  - Account summary/equity/allocation/positions/risk live reads use short full-response route caches.
  - IBKR line-usage sidecar generation apply has a sequence guard and read-side bridge-generation comparison fallback.
  - Signal Options performance has a cold stale/degraded pressure fallback instead of returning 503 when caches are cold.
- Validation:
  - Focused API suite covering Signal Options, line usage, Signal Monitor, account cache, watchlist prewarm, account bridge, route admission, runtime diagnostics, order resilience, and bars routing passed: 249 tests.
  - API build passed and scoped diff check passed.
  - Rebuilt `artifacts/api-server/dist/index.mjs` contains the final fixes.
- Live probe after build, before another Replit restart:
  - IBKR remains connected/authenticated/strict-ready.
  - `/api/settings/ibkr-line-usage` returned `200` with `sidecar.applyError=null`.
  - Root diagnostics still show `down/critical`, but the active cause is API p95 latency dominated by `/bars` in the running pre-final-restart process, not an IBKR/UI crash.
- Required next step:
  - Restart via default **Run Replit App** once more to load the rebuilt API bundle, then wait for the 5-minute latency window to age and re-check `/bars`, line usage, Signal Options performance, and root diagnostics.

## Flow Scanner Queue and Diagnostics Threshold Follow-Up - 2026-06-02 10:32:25 MDT

- Follow-up implementation continued in `SESSION_HANDOFF_2026-06-02_019e8897-3487-71b3-b357-5dcbc6b7ac6d.md`.
- Additional root cause found:
  - The flow scanner cleared queued work into a local drain batch, so diagnostics undercounted scheduled work after draining started.
  - Platform capacity checks saw only active/explicit queued symbols and could add radar/read-triggered deep scans while prior drain work was already reserved.
  - This was duplicative scheduling, not a memory-cap problem. Live resource pressure was `high` from API latency, while RSS/heap were low and Signal Options caps were still allowed.
- Additional fixes landed:
  - Deep scanner diagnostics now expose `drainingCount` and `drainingSymbols`.
  - Platform deep queue capacity uses active + queued + draining scheduled symbols.
  - Radar promotions, direct scanner rotation, on-demand scanner refresh, aggregate seed refresh, and expanded seed follow-up stop when real queue capacity is full.
  - Aggregate seed selection can now return zero instead of forcing one more scan.
  - Line-usage and work-plan diagnostics now expose scheduled deep scan counts.
  - API latency-only p95 below `10000ms` now degrades diagnostics instead of marking API/root `critical/down`; repeated errors still escalate.
- Validation passed:
  - Full options flow scanner test file: 80/80.
  - Line usage + market-data work planner tests: 23/23.
  - Diagnostics + resource pressure tests: 43/43.
  - API build passed.
- Live note:
  - `/api/settings/ibkr-line-usage` already showed the new queue fields and no background scanner block.
  - After API PID `118537` started at `2026-06-02 10:33:57 MDT`, `/api/diagnostics/latest` reported root `degraded/warning`, API `degraded/warning`, p95 about `5001ms`, `errorCount5m=2`, resource pressure `high`, Signal Options caps allowed, and no critical events.
  - Final line-usage probe showed `deepQueueLimit=8`, `deepQueueBacklog=5`, `deepQueueAvailable=3`, `drainingCount=5`, `queuedCount=0`, and `scheduledDeepScanCount=5`.
