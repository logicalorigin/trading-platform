# Repair Plan v2: Connection-Recognition Root (priority) + DB-Pool Starvation (separate track)

> Status: DRAFT v2 for execution. No code written yet. Produced via /planning-and-task-breakdown.
> Basis: unified investigation + two adversarial audits (2026-06-18). All file:line refs verified against working tree.
> v2 change: connection-recognition reclassified from a pool symptom to an INDEPENDENT root and prioritized; fix scope widened from one gate to three + safety guards.

## Overview

There are TWO independent roots in an asymmetric feedback loop, not one root with symptoms:

- **Root 1 — Connection-recognition fragility (PRIORITY).** The bridge "connected" verdict
  fuses two orthogonal facts — *is the wire up* vs *is data fresh* — into one
  freshness-gated boolean (`platform-bridge-health.ts:322-324`). The bridge source is
  pure wire truth (`tws-provider.ts:4617,4632,4636`; `healthFresh` hardcoded true), so
  "not connected" is an **api-server cache-age artifact**, not a wire fact. ANY staleness
  trigger (quiet market with no quote subscribers; a health-circuit backoff after two 502s;
  a DB-independent ~8-11s event-loop CPU freeze; a slow frontend poll) flips it to
  disconnected while the socket is up. This is DB-independent and survives any pool fix.
  The freshness clocks measure when the API last *processed* an event, not when the bridge
  last *sent* one (`bridge-quote-stream.ts:471,606,1226`; `platform-bridge-health.ts:77,282`).

- **Root 2 — DB-pool starvation (SEPARATE track).** Option-chain persistence does serial,
  per-contract, multi-round-trip upserts (`option-metadata-store.ts:546` loops
  `await upsertOptionContract`, each ~4-6 sequential checkouts `:388-457`) against the hard
  12-connection pool (`lib/db/src/index.ts:153`). This causes the STA runtime-fallback and
  the resource-pressure "high". It is a real meltdown driver but is NOT the cause of the
  false "not connected".

- **The loop:** a false/flapping disconnect drives a frontend SSE reconnect storm
  (`PlatformApp.jsx:3344`) that adds backend/DB load (dominant arrow: recognition → load);
  DB-await latency feeds event-loop delay which inflates the freshness clocks (weak reverse
  arrow). Backend connection-flap does NOT itself re-trigger DB work (`ibkr-connection-audit.ts:290`
  is in-memory; the heavy producer `signal-monitor.ts:7326` is interval-driven, not event-driven).

## Architecture Decisions

1. **Connection-recognition is prioritized and decoupled from the pool surgery.** It is an
   independent root, the fix touches different files, and the symptom provably persists
   after any pool fix. Track A ships first and does not block on Track B.

2. **The fix is multi-gate, not single-point.** THREE independent freshness gates must all be
   addressed: the main collapse (`platform-bridge-health.ts:322`), the arming gate
   (`algo-gateway.ts:62`), and order-routing/depth (`platform.ts:4360,16726`), plus the
   pre-annotation trading-guard probe (`platform-bridge-health.ts:756`).

3. **No debounce — but safety is non-negotiable.** Removing freshness from the gate converts
   today's fail-SAFE bug (false negative) into a potential fail-DANGEROUS one (arming on a
   dead bridge). The no-debounce constraint is honored by replacing freshness with a
   **connectivity floor** + a **liveness round-trip** clock, not a time delay. These guards
   are first-class acceptance criteria, not optional.

4. **Separate "wire up" from "data fresh" everywhere.** Introduce one new authoritative
   `connectivityUp` (wire+auth+server, bounded by floor+liveness). Keep `healthFresh`/
   `streamFresh` as a non-blocking `dataFresh` indicator. Re-point every consumer to the
   right one.

5. **Order routing gates on connectivity only (DECIDED, 2026-06-18).** Everything —
   arming, display, status, market-depth, AND live order routing — gates on `connectivityUp`
   only. No freshness gate anywhere. The liveness round-trip in A1 makes `connectivityUp`
   mean "the gateway is provably completing round-trips" (not merely socket-open), so this is
   "route while the bridge is genuinely alive", not "route blindly on stale data". Accepted
   residual risk: routing against a genuinely stale-but-alive quote feed.

---

## Track A — Connection-recognition root (PRIORITY)

### Task A1: Backend `connectivityUp` with connectivity floor + liveness round-trip
**Description:** In `annotateBridgeHealth`, add `connectivityUp = health.connected &&
health.authenticated && serverConnectivity !== 'disconnected'`, decoupled from the 30s/45s
data clocks (`platform-bridge-health.ts:320-329,415`). Bound it by (a) a short connectivity-
floor TTL (~15-20s, new `IBKR_BRIDGE_CONNECTIVITY_FLOOR_MS`) so it cannot ride the 120s
last-known-good cache, forcing it false in the `forceStale` branch (`:730-737`) using the
outage clock (`bridge-governor.ts` firstOpenedAt) and `desktopAgentOnline` proof; and (b) a
liveness round-trip clock from `lastTickleAt`/`getCurrentTime` freshness so a half-open/hung
socket de-asserts `connectivityUp` within ~the tickle interval. Keep `healthFresh`/`streamFresh`
as a separate `dataFresh` signal.
**Acceptance criteria:**
- [ ] Socket up + both data clocks expired → `connectivityUp=true`, `dataFresh=false`.
- [ ] Genuine disconnect (stale cache, no desktop proof, past floor TTL) → `connectivityUp=false` within the floor, NOT 120s.
- [ ] Half-open socket (health.connected true, no successful tickle past liveness TTL) → `connectivityUp=false`.
- [ ] Quiet market (no quote subscribers, socket up) → `connectivityUp=true`.
**Verification:**
- [ ] Unit tests for all four cases above + a fault-injection test for the half-open case.
- [ ] `pnpm --filter @workspace/api-server run typecheck`
- [ ] `pnpm --filter @workspace/api-server exec node --import tsx --test src/services/platform-bridge-health.test.ts`
**Dependencies:** None
**Files likely touched:** `platform-bridge-health.ts`, possibly `bridge-governor.ts`, `tws-provider.ts` (expose `lastTickleAt` if not already at `:4621`)
**Estimated scope:** M

### Task A2: Re-point the arming + readiness gates to `connectivityUp`
**Description:** In `resolveAlgoGatewayReadiness`, read `connectivityUp` for the
`gateway_socket_disconnected` check (currently `algo-gateway.ts:47,71` read the tainted
`connected`) and REMOVE the `!healthFresh && !liveStreamReady` hard block (`:62`,
`bridge_health_unavailable`), replacing it with `connectivityUp` + the liveness clock; return
freshness as a non-blocking note. Verify arming (`automation.ts:541`) inherits it with no
separate freshness assertion.
**Acceptance criteria:**
- [ ] Socket up + stale data → readiness `ready:true` (no `gateway_socket_disconnected`, no `bridge_health_unavailable`).
- [ ] Genuine disconnect (per A1) → readiness `ready:false` promptly.
- [ ] Arming an enable with stale-but-up bridge no longer throws 503.
**Verification:**
- [ ] Unit: stale-but-up → ready; dead → not-ready. `pnpm --filter @workspace/api-server exec node --import tsx --test src/services/algo-gateway.test.ts`
**Dependencies:** A1
**Files likely touched:** `algo-gateway.ts`, `platform.ts:3546` (emit `connectivityUp` in readiness signals), `automation.ts`
**Estimated scope:** M

### Task A3: Trading-guard probe fallback to bounded `connectivityUp`
**Description:** `getAnnotatedBridgeHealthForTradingGuard` (`platform-bridge-health.ts:756-781`)
runs a fresh probe with NO `bypassBackoff` and throws `bridge_health_unavailable` on
circuit-open/timeout — a not-connected path that bypasses A1's annotation. On timeout/open,
fall back to the bounded `connectivityUp` from the last good snapshot (or `bypassBackoff` for
the connectivity probe specifically).
**Acceptance criteria:**
- [ ] Transient probe timeout with a within-floor good snapshot → guard does not throw.
- [ ] Genuinely down past the floor → guard still blocks.
**Verification:**
- [ ] Unit: open-circuit + fresh connectivity snapshot → pass; stale → throw.
**Dependencies:** A1
**Files likely touched:** `platform-bridge-health.ts`
**Estimated scope:** S

### Task A4: Order-routing + market-depth gate → connectivity only (DECIDED)
**Description:** Live order routing and `getMarketDepth` hard-block on `healthFresh===false &&
connected!==true` (`platform.ts:4360,4367,16726-16728`). Per the 2026-06-18 decision
(connectivity everywhere), REMOVE the `healthFresh===false` freshness block from both paths
and gate purely on `connectivityUp`. The not-connected error must reflect connectivity, not
freshness. Confirm no other live-trading path retains a `healthFresh` block (grep `healthFresh`
across trading/order/depth code post-change).
**Acceptance criteria:**
- [ ] Socket up + stale quotes → order routing and market-depth proceed (gated on `connectivityUp` only).
- [ ] Genuine disconnect / half-open (per A1) → both block.
- [ ] No remaining `healthFresh`-based block on any order/depth/trading path.
**Verification:**
- [ ] Unit: stale-but-alive → routes; dead/half-open → blocks. Grep audit for residual `healthFresh` gates.
**Dependencies:** A1
**Files likely touched:** `platform.ts`
**Estimated scope:** S

### Task A5: Frontend — consume `connectivityUp`, split strictReady, stop failing closed
**Description:** Backend mirrors verbatim to the FE, so this lands after A1-A2. Split
`computedStrictReady` (`IbkrConnectionStatus.jsx:206-215`) into `connectivityReady` (drives
the connected/online verdict, reads backend `connectivityUp`) vs `dataFreshReady` (drives a
"data refreshing" badge). Point `isIbkrGatewayBridgeAttached` (`:316-352`), header tone,
`bridgeRuntimeModel.js:90-94,311-319`, `ibkrPopoverModel.js:727-737`, and
`ibkrConnectionSnapshot.js:141-162` at connectivity, not freshness. Hold last-known-good in
`fallbackConnection` (`:255-309`) instead of painting "offline" on a null/loading session
(bounded to a few missed polls; backend `connectivityUp` stays authoritative). Add `retry:1`
to the 20s session poll (`PlatformApp.jsx:1096-1102`).
**Acceptance criteria:**
- [ ] Header shows "connected, data refreshing" (not "not connected") when socket up + data stale.
- [ ] A single slow/aborted session poll does not paint disconnected.
- [ ] Genuine sustained disconnect still shows offline.
**Verification:**
- [ ] FE tests for stale-stream, slow-poll, and true-offline where covered by `src/features/platform/ibkrPopoverModel.test.mjs` and `src/features/platform/ibkrConnectionSnapshot.test.mjs`.
- [ ] `pnpm --filter @workspace/pyrus run typecheck`
**Dependencies:** A1, A2
**Files likely touched:** `IbkrConnectionStatus.jsx`, `bridgeRuntimeModel.js`, `ibkrPopoverModel.js`, `ibkrConnectionSnapshot.js`, `PlatformApp.jsx`
**Estimated scope:** M

### Task A6: Unblock the always-on event loop (remove the staleness trigger)
**Description:** Even with the verdict de-tainted, the DB-independent ~8-11s synchronous
freeze degrades everything. Chunk/offload the synchronous dashboard shaping on the always-on
poll path — primarily `gex.ts:1383` `compactPersistedGexDashboard` (synchronous `flatMap`
over the full chain) and `gex.ts:990-1059` chain shaping. Profile first to confirm the hot
function.
**Acceptance criteria:**
- [ ] No single synchronous pass on the dashboard poll path blocks the loop beyond a small budget (e.g. <100ms).
- [ ] Live event-loop p95 drops materially during dashboard polling.
**Verification:**
- [ ] `--cpu-prof` / SIGUSR1 capture during a freeze pins the function; before/after p95 comparison.
**Dependencies:** None (parallelizable)
**Files likely touched:** `gex.ts`, possibly `shadow-account.ts`
**Estimated scope:** M

### Checkpoint: Connection-recognition fixed
- [ ] Soak with socket up + induced staleness (quiet market, forced 502s, induced freeze): header stays "connected (data refreshing)", arming stays allowed, no false `gateway_socket_disconnected`.
- [ ] Fault-injection: genuine disconnect / half-open socket blocks within the floor + liveness TTL. **Human review before relying on it for live trading.**

---

## Track B — DB-pool starvation root (SEPARATE, parallelizable)

### Task B0: Attribute pool checkouts by call-site under load
**Description:** Before assuming option-chain is the only hog, instrument the pool to attribute
checkouts/wait-time by call-site. The first audit flagged co-equal hogs: shadow mark-refresh
serial writes (`shadow-account.ts`), the ~10 concurrent shadow sub-reads per dashboard request
(`lib/db/src/index.ts:147`), and the Rust market-data-worker's own pool against the same
Postgres.
**Acceptance criteria:**
- [ ] Under representative load, a report ranks pool consumers by checkout count + wait time.
**Verification:**
- [ ] Report produced; top consumers identified.
**Dependencies:** None
**Files likely touched:** `lib/db/src/index.ts`, diagnostics
**Estimated scope:** S

### Task B1: Commit the staged dbPool blip-sensitivity fix (+ test the gap)
**Description:** The working tree already softens `dbPoolLevel` (`resource-pressure.ts:205-229,
455-500`). Add tests, including the gap the audit found: a sustained queue with `active < max`
currently never trips "high" — decide deliberately whether that should be watch or high.
**Acceptance criteria:**
- [ ] Momentary `waiting=5, 12/12` → watch; sustained active-saturated+waiting → high; `waiting>=max` → high; sustained `active<max`+waiting → decided behavior with a test.
**Verification:** `pnpm --filter @workspace/api-server exec node --import tsx --test src/services/resource-pressure.test.ts`
**Dependencies:** None
**Files likely touched:** `resource-pressure.ts`, `*.test.ts`
**Estimated scope:** S

### Task B2: Batch instrument resolution + bulk transactional upsert
**Description:** Replace the per-contract `ensureInstrument` x2 + select + update/insert loop
(`option-metadata-store.ts:388-457,546`) with batched instrument resolution and a single bulk
`INSERT ... ON CONFLICT` for contracts + bulk insert for snapshots, in one `db.transaction`,
deduped by `(optionContractId, source)` to avoid the known ON CONFLICT throw. Collapses
hundreds of serial checkouts to ~2.
**Acceptance criteria:**
- [ ] O(1) instrument round-trips; bounded checkouts regardless of contract count.
- [ ] Intra-batch duplicates don't throw; writes atomic; parity vs current row output.
**Verification:** regression test for the dedup throw + golden parity test + soak showing `dbPool.waiting` ~0.
**Dependencies:** B0; coordinate with the in-flight option-chain upsert-latest redesign owner.
**Files likely touched:** `option-metadata-store.ts`, possibly `crates/market-data-worker/src/ingest.rs`
**Estimated scope:** L → split contracts vs snapshots if needed.

### Task B3: Add contention backoff + bound write concurrency
**Description:** `option-metadata-store` retries immediately on pool contention (no backoff),
creating a retry storm that worsens starvation. Add a contention backoff and cap concurrent
chain writers / route through single-flight. Extend to the B0-identified hogs (shadow refresh)
if they materialize.
**Acceptance criteria:**
- [ ] Under worst-case load, `dbPool.waiting` stays below the blip threshold; no retry storm.
**Verification:** load test.
**Dependencies:** B0, B2
**Files likely touched:** `option-metadata-store.ts`, `shadow-account.ts` (if flagged), worker scheduling
**Estimated scope:** M

### Checkpoint: Pool relieved
- [ ] Under market-hours load: no dbPool-driven "high"; signal-monitor runtime-fallback ≈ 0; STA renders DB universe.

---

## Track C — Resilience + legibility (defense in depth)

### Task C1: Latch the signal-monitor fallback + keep the banner accurate
**Description:** The events read re-decides fallback every poll (`signal-monitor.ts:10327`, no
`createTransientPostgresBackoff` unlike `automation.ts:56`). Add a short latched backoff to stop
DB↔fallback thrash; keep the `runtime-fallback` banner accurate (`OperationsSignalTable.jsx:1566`).
**Acceptance criteria:** transient blip doesn't thrash; banner states "event DB unavailable — built-in universe".
**Verification:** unit on a simulated transient sequence.
**Dependencies:** None
**Files likely touched:** `signal-monitor.ts`, `signal-monitor-diagnostics.ts`, `OperationsSignalTable.jsx`
**Estimated scope:** M

### Task C2: Fix the frontend SSE reconnect-loop (the feedback arrow)
**Description:** The SSE stream URL is keyed on a universe list that collapses to empty during a
fallback flap (`PlatformApp.jsx:3344`), churning the stream. The handoff's PART1 high-water-mark
ref (`:3319`) addresses this — verify it's complete and landed.
**Acceptance criteria:** a fallback flap does not churn the SSE URL / cause reconnect storms.
**Verification:** confirm stream URL stable across a simulated flap.
**Dependencies:** None
**Files likely touched:** `PlatformApp.jsx`
**Estimated scope:** S

### Task C3: Resource-pressure rollup hysteresis
**Description:** `resourceLevel = max(...)` has no hysteresis; one bad sample forces "high". Add
enter/exit hysteresis on the rollup (on top of B1's dbPool smoothing).
**Acceptance criteria:** single high sample doesn't pause scans; sustained still does.
**Verification:** extend `background-worker-pressure.test.ts`.
**Dependencies:** B1
**Files likely touched:** `resource-pressure.ts`, `*.test.ts`
**Estimated scope:** S

### Checkpoint: Complete
- [ ] Full `pnpm` typecheck + targeted suites green; `pnpm run audit:replit-startup` if startup-adjacent files touched.
- [ ] End-to-end soak: none of the four symptoms recur under load; genuine disconnect still blocks safely.

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Connectivity-only gate arms on a genuinely dead bridge | **Critical** | Connectivity floor (A1) + liveness round-trip (A1) + bounded FE hold (A5); these are blocking acceptance criteria |
| Half-open socket not detected (health.connected lags ~30s) | High | `lastTickleAt` liveness clock in `connectivityUp` (A1) |
| Missing a freshness gate (3 gates + trading-guard) | High | A2 (algo-gateway:62), A3 (trading-guard), A4 (order-routing) explicitly cover all; grep audit for `healthFresh` gates post-change |
| Order routing fires against a stale-but-alive quote feed | Med (accepted) | DECIDED connectivity-everywhere; A1 liveness round-trip ensures the gateway is provably alive (not half-open) before routing — narrows residual to genuinely-stale-but-alive feeds |
| Option-chain batch rewrite reintroduces dedup/atomicity landmines | High | dedup + transaction + parity/regression tests (B2); coordinate with redesign owner |
| Track B checkpoint fails because non-option-chain hogs unaddressed | Med | B0 attribution before committing scope |
| Concurrent fleet edits to shared files | Med | `git status` ownership check; hand off via note |

## Open Questions

1. **RESOLVED (2026-06-18):** Connectivity everywhere — no freshness gate on order routing or market-depth; all paths gate on `connectivityUp` only. A4 updated accordingly.
2. **Connectivity-floor TTL value** (~15-20s?) and **liveness TTL** (~tickle interval?) — set from Task 0-style live capture of real blip durations.
3. **Rust `ingest.rs`** — is it a parallel writer needing the B2 fix on both sides?
4. **Coordinate B2** with the in-flight option-chain upsert-latest redesign — land inside it or separately?
