> **⚠️ SUPERSEDED / DIAGNOSIS CORRECTED (2026-06-11).** The "over-subscription / flood IBKR / load-shed" premise below is **wrong-direction**. IBKR is a **WebSocket push API**; the system **under-uses** lines (see `ibkr-data-line-architecture-plan.md`: `idleButEligibleLineCount=200`, options-metadata p95 ≈15.8s, failing durable `option_contracts` cache). The `504`s are our **HTTP control-plane to a stalled bridge**, not flooding. An independent live review (22:22Z) found the actual biting throttle is **self-made and frontend-gated**: the bridge **account lane reports `stalled`** on an otherwise-healthy bridge (`strictReady:true`, zero governor backoff), and the frontend `resolveIbkrWorkPressure` (`workPressureModel.js`) collapses that one field into **disabling all realtime IBKR work** via `appWorkScheduler`. The heap/latency "pressure" is **cosmetic** (caps nothing). The `optionLineCeiling` fix this doc inspired has been **reverted** as counterproductive (it caps lines the architecture wants kept full). Real fix lives in: (a) the frontend gate + account-lane-stalled trace, (b) the option metadata hot-path / `option_contracts` durable cache. Kept below for history only.

# Implementation Plan: IBKR Bridge / DB Overload — Load-Shed & Fix Call Patterns

## Overview

Our api-server is overwhelming our **own** IBKR bridge and Postgres with concurrent heavy work. Ground truth from the live console logs:

- `HTTP 504 Gateway Timeout: error code: 504` on `accounts` / `positions` / option-metadata / order reads, every few seconds (`bridge-client.ts:768`), serving stale cache.
- `Overnight spot worker scan timed out … 7e2e4e6f … after 45000ms` (the shadow deployment) — **repeatedly**.
- `Options flow scanner timed out scanning HOOD after 45000ms`.
- `Signal monitor worker skipped slow or failed history bar loads` across the entire A–Z universe.
- `delete from bar_cache … elapsed=22.12s` — DB retention sweep stalling Postgres.

**IB gateway-side logs (decisive — confirms a *wrong call pattern*, not an outage):**
- `LOG Client 101 Output exceeded limit (was: 100031), removed first half` — our market-data client's output buffer **overflowed and IB discarded half the queued data.** Classic symptom of subscribing to **more option market-data lines than IB can stream to one client.**
- `PACED` — IB is **throttling** us for over-requesting.
- `FROZEN` / `FROZEN_TOP` — IB is returning **frozen snapshots, not live ticks.**
- `Model is not valid … greeks=NaN/NaN/NaN/NaN … impVol=NAN … bidGreeks=NULL askGreeks=NULL` (US options dispatcher) — with frozen/dropped inputs, the option model **can't compute valid Greeks.**

**Causal chain for the blank shadow table:** we **over-subscribe US option market data** → IB per-client output buffer overflows + IB paces us + serves FROZEN data → **Greeks come back NaN** → shadow marks (which *require* Greeks) are rejected → positions never mark → bid/ask/Day/Greeks blank. The HTTP 504s are the same disease on the REST side. **The IB gateway is up; we are flooding it.**

**Effect:** the signal-options **shadow** deployment's scans time out at 45s and never reach/commit position marking → bid/ask, Day, Greeks blank (only DB-persisted price/P&L remain). The **real** account is unaffected because it reads off the separate, healthy live-quote WebSocket — not the overloaded request/bridge path.

**Goal:** reduce concurrent bridge + DB load (and fix any wrong IBKR call patterns) so deployment scans complete under their timeout and shadow position marking resumes.

## Architecture Decisions

- **Two tracks: relief then cure.** Ship reversible throttles first to stop the bleeding (Phase 1), then fix the *root* — wrong/excessive IBKR call patterns (Phase 2–3). Throttles are band-aids; call-pattern fixes are durable.
- **Back off under degradation, don't retry into the wall.** Any worker that times out on the bridge should exponentially back off while the bridge is shedding 504s, not re-issue the same 45s scan every cycle.
- **Prefer batch + stream + cache over per-item polling.** Investigate before assuming volume is irreducible.
- **Each change is independently shippable and leaves the system working.** No task depends on a later one.

## How to verify (shared)

Baseline now, then re-measure after each task:
- **IB over-subscription (primary):** the IB gateway log is free of `Output exceeded limit … removed first half`, sustained `PACED`, and `FROZEN`/NaN-Greeks for held-position contracts.
- **Bridge health:** rate of `HTTP 504 Gateway Timeout` and `… scan timed out after 45000ms` lines in the dev console (should drop toward zero).
- **Scans complete:** `Overnight spot worker scan timed out … 7e2e4e6f …` lines stop; `GET /api/algo/deployments/7e2e4e6f-…/signal-options/state?view=full` returns `activePositions.length > 0`.
- **Marking resumes (the real success signal):**
  `psql "$DATABASE_URL" -tAc "select count(*) from shadow_position_marks where as_of > now() - interval '2 minutes';"` → `> 0`.
- **UI:** shadow positions table shows live bid/ask, Day, Greeks again.
- **Build/types:** `pnpm --filter @workspace/api-server typecheck`; targeted `node --import tsx --test <file>` for touched services.

---

## Task List

### Phase 1 — Immediate, reversible load relief

#### Task 1: Dial back the options flow scanner aggressiveness  *(XS)*
**Description:** A prior "first attempt" left an uncommitted change raising the scanner's per-scan line budget `1 → 100` (plus a batch-size change) in `platform.ts`. This makes the scanner fan out ~100× more bridge work per ticker and is the most directly controllable amplifier (it already produces `scanning HOOD … 45000ms` timeouts). Restore a sane value (original `1`, or a small env-tunable default) and confirm the scanner stops monopolizing the bridge.
**Acceptance criteria:**
- [ ] `OPTIONS_FLOW_SCANNER_DEFAULT_PER_SCAN_LINE_BUDGET` (and the batch-size constant) set to a justified low value, env-overridable.
- [ ] No `Options flow scanner timed out … after 45000ms` lines for ≥5 min after deploy.
**Verification:** typecheck; run `options-flow-scanner-metadata-timeout.test.ts` + admission/scanner tests; watch console for scanner timeouts; check 504 rate drops.
**Dependencies:** None.
**Files:** `artifacts/api-server/src/services/platform.ts` (scanner budget/batch consts), maybe `options-flow-scanner.ts`.
**Scope:** XS.

#### Task 2: Overnight-spot worker backs off instead of retrying into the timeout  *(S)*
**Description:** `overnight-spot-worker.ts` re-runs a 45s scan every cycle for the shadow deployment and times out every time (`overnight-spot-worker.ts:306`, `DEFAULT_WORKER_SCAN_TIMEOUT_MS = 45_000`), piling load onto an already-degraded bridge. Add exponential backoff (and/or a "bridge degraded" gate) so consecutive timeouts widen the interval rather than hammering.
**Acceptance criteria:**
- [ ] After a scan timeout, the next attempt is delayed by a growing backoff (capped), reset on success.
- [ ] Repeated `Overnight spot worker scan timed out` lines stop clustering every cycle.
**Verification:** typecheck; unit test the backoff schedule; console shows spaced-out (not back-to-back) overnight-spot attempts.
**Dependencies:** None.
**Files:** `artifacts/api-server/src/services/overnight-spot-worker.ts` (+ test).
**Scope:** S.

### ✅ Checkpoint A — after Tasks 1–2
- [ ] 504 rate and 45s-timeout lines materially down.
- [ ] **`shadow_position_marks` getting new rows again** and `activePositions > 0`.
- [ ] **If marking has resumed, the user's symptom is fixed** — Phases 2–3 become hardening, not emergency. Review with user before continuing.

---

### Phase 2 — Root cause: are we calling IBKR the wrong way? (investigation → tasks)

#### Task 3: Audit IBKR call patterns for inefficiency — lead with option-market-data over-subscription  *(M, investigation — read-only)*
**Description:** Determine whether the failures are driven by *how* we call IBKR, not just how much. **Primary lead (evidenced by the IB `Client 101 Output exceeded limit … removed first half` + `PACED` + `FROZEN` + NaN-Greeks logs): we are over-subscribing US option market data on a single IB client.** Audit:
- **Option market-data subscription fan-out:** how many distinct option contracts do we have live market-data/Greeks subscriptions for at once (scanner + visible chain + automation + account)? Is there a global cap respecting IB's per-client streaming/buffer limit? Where is the subscription set assembled (`bridge-option-quote-stream.ts`, `tws-provider.ts` `ensureOptionQuoteSubscription` / `limitQuoteDemandForBudget`, live-demand declarations)?
- **Greeks scope:** are we requesting **model Greeks** for far more contracts than needed (e.g., the whole scanner universe) when only held positions + the open visible chain need them? Greeks subscriptions are the expensive ones.
- **Market-data type:** are we (or is IB falling back to) **FROZEN** when we expect live? Confirm the `reqMarketDataType` we send.
- Then the REST side: (a) **per-symbol** calls that should be **batched**; (b) **polling** where a **stream** exists (the real account uses the healthy quote WS — reuse it?); (c) **redundant** reads across workers per tick; (d) **cache misuse** — we log "Returning cached … after transient failure"; is the cache only a failure fallback rather than a primary read? (e) **fan-out without concurrency caps**; (f) **full-universe pulls** where a scoped set would do.
**Acceptance criteria:**
- [ ] A measured count of concurrent option market-data / Greeks subscriptions and where they originate, vs IB's safe per-client ceiling.
- [ ] Each hot call site classified OK / batchable / streamable / cacheable / redundant / over-subscribed, with file:line + volume evidence.
- [ ] Ranked list of concrete fixes (each S/M) feeding Tasks 5+.
**Verification:** findings reviewed with user; top driver of IB load identified by evidence, not assumption; confirm whether NaN Greeks correlate with the buffer-overflow windows.
**Dependencies:** None (parallel with Phase 1).
**Files (read-only):** `artifacts/ibkr-bridge/src/tws-provider.ts`, `artifacts/api-server/src/services/bridge-option-quote-stream.ts`, `market-data-admission.ts`, `signal-options-automation.ts` (live-demand), `providers/ibkr/bridge-client.ts`, `platform.ts`, `signal-monitor.ts`, `overnight-spot-worker.ts`, `options-flow-scanner.ts`.
**Scope:** M.

#### Task 3b: Cap concurrent option market-data / Greeks subscriptions to IB's safe per-client limit  *(M)*
**Description:** Directly address the `Output exceeded limit … removed first half` overflow. Enforce a global ceiling on live option market-data subscriptions (and a tighter ceiling on **Greeks** subscriptions), prioritizing held positions + the open visible chain over scanner discovery. Shed scanner/low-priority demand first when near the cap. This is the durable cure for the NaN-Greeks → failed-marks chain. Coordinate the exact cap with Task 3's measured IB ceiling.
**Acceptance criteria:**
- [ ] A configurable global cap on concurrent option subscriptions; Greeks requested only for prioritized contracts.
- [ ] No `Client … Output exceeded limit … removed first half` lines for ≥10 min; no sustained `PACED`/`FROZEN` for held-position contracts.
- [ ] Held positions receive **valid (non-NaN) Greeks** → marks succeed.
**Verification:** IB gateway log clean of buffer-overflow/pacing for held contracts; `shadow_position_marks` advancing; UI Greeks populate.
**Dependencies:** Task 3 (for the right ceiling). Strongly complements Task 1.
**Files:** `artifacts/ibkr-bridge/src/tws-provider.ts` and/or `artifacts/api-server/src/services/bridge-option-quote-stream.ts` / `market-data-admission.ts` (subscription admission/limits).
**Scope:** M.

#### Task 4: Signal-monitor universe bar-load throttle / scope  *(M)*
**Description:** The signal monitor loads price history for the entire `all_watchlists_plus_universe` set every cycle (`signal-monitor.ts`), producing the constant "skipped slow or failed history bar loads" storms. Cap concurrency, batch, and/or narrow scope (or stagger across cycles) so it stops saturating the bridge/DB. Coordinate with Task 3 findings (this may instead become a batching fix).
**Acceptance criteria:**
- [ ] Bar-load concurrency/batch is bounded and configurable; per-cycle bridge bar requests drop measurably.
- [ ] "skipped slow or failed history bar loads" lines drop sharply.
**Verification:** typecheck; signal-monitor tests; console shows fewer bar timeouts; `/api/bars` p95 responseTime falls.
**Dependencies:** Task 3 (informs the right fix shape).
**Files:** `artifacts/api-server/src/services/signal-monitor.ts` (+ test).
**Scope:** M.

### ✅ Checkpoint B — after Tasks 3–4
- [ ] Findings turned into a concrete, sized fix list.
- [ ] Bridge 504 rate near zero under normal load; scans completing well under 45s.

---

### Phase 3 — Durable fixes & DB

#### Task 5+: Apply the call-pattern fixes from Task 3  *(S–M each, one per fix)*
**Description:** Implement each ranked call-pattern fix from Task 3 as its own small, shippable task (e.g., "batch position marks' contract reads", "reuse the live-quote WS for X instead of polling", "read cache first, refresh async"). Keep one subsystem per task.
**Acceptance criteria:** per fix — request volume to its endpoint drops; behavior unchanged; tests pass.
**Verification:** typecheck + targeted tests + before/after request-count evidence.
**Dependencies:** Task 3.
**Files:** per fix (each ≤5 files).
**Scope:** S–M each.

#### Task N: Fix slow `bar_cache` retention DELETE  *(M — Rust + DB)*
**Description:** Retention `delete from bar_cache where ctid in (… starts_at < $1 limit 20000)` takes up to 22s, stalling Postgres for everything else (`crates/market-data-worker/src/main.rs`). Reduce batch size and/or add a supporting index on `bar_cache(starts_at)` (migration), and/or run during low-load windows.
**Acceptance criteria:**
- [ ] No `slow statement … delete from bar_cache … elapsed > 1s` warnings.
- [ ] Retention still completes (rows pruned) without long lock/IO spikes.
**Verification:** market-data-worker build (`pnpm run build:market-data-worker` / its toolchain); run retention; confirm elapsed < 1s and rows pruned; DB `EXPLAIN` uses the index.
**Dependencies:** None (independent subsystem; different toolchain — Rust + a `lib/db` migration).
**Files:** `crates/market-data-worker/src/main.rs`, a new migration under `lib/db` (index on `bar_cache.starts_at`).
**Scope:** M.

### ✅ Checkpoint C — Complete
- [ ] Under normal operation: ~0 bridge 504s, scans complete, shadow marking steady, UI columns live.
- [ ] No single worker can re-saturate the bridge (caps/backoff in place).
- [ ] Call patterns batched/streamed/cached where Task 3 found waste.

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Throttling too hard starves the scanner/signal coverage | Med | Make all caps env-tunable; verify signal/candidate coverage after Task 1/4; tune, don't disable. |
| Editing files restarts the live dev app (observed all session) | Med | Batch edits per task; expect one rebuild per task; verify marks resume after each. |
| `signal-options-automation.ts` is mid-refactor by another workstream | Med | Phase 1/2 avoid it; the already-applied signal-first guard is additive — keep or revert as a separate decision. |
| `bar_cache` index migration on a large table locks/IO-spikes | Med | `CREATE INDEX CONCURRENTLY`; run off-peak. |
| Reducing load masks a deeper wrong-call-pattern bug | High | Task 3 runs regardless of whether Phase 1 "fixes" the symptom. |

## Open Questions (need user input)

- The scanner `1 → 100` change — intentional tuning or an over-aggressive "first attempt" tweak? (Affects how far Task 1 dials back.)
- Is the IBKR bridge single-instance / what's its real request ceiling? (Sets the target we throttle to.)
- Keep the already-applied **signal-first deferral guard** (`signal-options-automation.ts`) and the **day-gain/last-quote persistence** groundwork, or revert to a clean tree before this work?

## Task 3 Findings (completed — investigation)

**Measured live:** ~**167–170** concurrent option subscriptions right now; the **flow scanner alone owns 159 of 200 lines** (`scannerActiveLineCount=159`, `pressure.activeLineCount=172/200`). IB's per-client buffer overflowed at ~**100** (`Output exceeded limit (was: 100031)`). **We run ~70% over IB's real ceiling.**

**Root mechanisms (file:line):**
1. **No ceiling tied to IB's real limit, no backpressure.** App caps option lines at `DEFAULT_MAX_LINES = 200` (`market-data-admission.ts:191`); `tws-provider.ts` `maxMarketDataLines` has no enforcement against IB's actual per-client limit, and nothing feeds IB's `PACED`/`Output exceeded` signal back into admission. If the bridge line-budget TTL (30s) lapses, it silently assumes 200.
2. **Flow scanner is the dominant over-subscriber.** `OPTIONS_FLOW_SCANNER_DEFAULT_PER_SCAN_LINE_BUDGET 1→100` (`platform.ts:10910`), batch 8, concurrency 8 → up to ~800 contracts/cycle, holding 159 lines now. (It does *not* request Greeks — good — but the raw line volume overflows the IB client buffer.)
3. **Greeks hardcoded on for everyone else.** Generic tick list `"100,101,106"` (`tws-provider.ts:4008`) — 106 forces server-side Greeks; `requiresGreeks` defaults true; each Greek option costs **2 lines** (option + underlying support, `market-data-admission.ts:673`). No price-only path.
4. **REST 504s = shared-pool saturation.** One HTTP agent pool, `maxSockets:16` (`bridge-client.ts:211`), but governor lane concurrency sums to ~20. The **signal-monitor fans out 500 symbols × 4–5 timeframes ≈ 2,000–2,500 bar requests/cycle** at 6 concurrent (`signal-monitor.ts:344/347`), saturating the pool → 504s cascade to accounts/positions/option-meta. Orders are **cache-fallback-only** with a 5s timeout on a 2s poll; option-metadata isn't cache-first or batched across underlyings.

**Ranked fixes (feed Phase 1/3):**
- **A (biggest):** hard IB-client option-subscription ceiling well under 100, scanner shed first; add backpressure from IB `PACED`/`Output exceeded` → admission. → Task 3b.
- **B (quick):** dial back scanner `1→100`. → Task 1.
- **C:** cut signal-monitor concurrency/scope; raise/segment the socket pool; coalesce. → Task 4 + new.
- **D:** cache-first for orders + option-metadata; batch option-metadata across underlyings.
- **E (optional):** price-only (no-Greeks) subscription path for consumers that don't need Greeks.

**Cross-symptom confirmation — SL/TRL blanks are the same root cause.** Stop-loss / trailing-stop cells read `position.stopPrice` / `position.peakPrice` (`algoAccountPositions.js:485-486`), which are only updated by `enforceSignalOptionsTrailingStopFromShadowMark` **on each mark**, and the trail computation requires a live `markPrice` + tracked `peakPrice` (`shadow-account.ts:2100`); greek-based trails also need valid Greeks. Marking has been stalled since 15:59, so the peak/stop never advance → SL `—`, TRL `Unprotected`. **Risk:** the winners (TQQQ/AAPL/AMZN) should have a ratcheted trailing stop locked in — they're effectively *unprotected* while marking is down.

## Already in the working tree (context, decide in Open Questions)
- Signal-first deferral guard (skip signal-first when options circuit open) — additive, symptom-level.
- `dayChange`/`previousClose` plumbing + tests — foundation for "show last available data" after-hours (separate feature).
