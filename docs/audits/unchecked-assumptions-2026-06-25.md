# Unchecked-assumption audit — 2026-06-25

Hunt for places where the code **assumes** something is true rather than **checking** it — the failure
mode that bit us repeatedly this session (worker-owns-bars, closed-bars-immutable, "85% = memory").
Six parallel read-only audits across market-data, signal-monitor, shadow/ledger, streams/pressure, the
Rust worker, and the IBKR bridge. Every row cites file:line. **Status discipline:** file:line is
*observed*; the causal "what breaks" is *inferred* from the code path — confirm each with its listed
check before fixing. Ranked by blast radius: live-money/trade correctness → risk-control → freeze →
crash/wrong-data.

## Tier 1 — live money / trade correctness (act first)

1. **Open-position identity is keyed by SYMBOL (assumes ≤1 position per underlying) AND the in-loop
   active-positions snapshot isn't refreshed as the entry loop opens positions.** Two independent audits
   landed here. `signal-options-automation.ts:5827` (`positions.set(symbol,…)`), `:17475` (stale snapshot)
   vs build `:17406`, post-open bump `:17577`. → **double entry** (same dir) or two opposing legs instead
   of a flip; a 2nd contract on one underlying silently overwrites/phantom-closes the first, so a leg is
   **never marked or exited**. Check: can two contracts on one underlying be open at once, and does the
   in-loop snapshot miss a position opened earlier in the same scan?

2. **`placeOrder` has no idempotency key — a timeout/504 retry is assumed to be safe.** LIVE path.
   `bridge-client.ts:2032-2042`; 12s default abort `:637`; `PlaceOrderInput` has no cOID/orderRef
   (`lib/ibkr-contracts/src/client.ts:204`). → a retry after the bridge already forwarded to TWS mints a
   **second real order**. Check: force a 504 after submit; confirm no client-supplied order key reaches `/orders`.

3. **The bridge's self-reported `/healthz` booleans are trusted as ground truth for "broker session
   alive."** LIVE. `bridge-client.ts:894`, gate `platform.ts:4452-4484`. → orders admitted against a
   stale/logged-out TWS session. Check: stub `/healthz` `authenticated:true` with TWS detached; confirm an order is still admitted.

4. **Fills are assumed unique per economic event — summed with no dedup; positions read-modify-write
   with no row lock.** `shadow-account.ts:4387` (auto UUID clientOrderId), dedup only on nullable
   `sourceEventId` (`lib/db/src/schema/trading.ts:240`); position upsert `:5609-5618` has **no `FOR UPDATE`**.
   → a manual double-submit **double-counts cash/realized**; concurrent fills on one positionKey **lost-update**
   avgCost (does not self-heal). Check: two manual orders same symbol/qty no clientOrderId → NAV moves 2×.

5. **A premium ≥ ½·multiplier (~$50) is assumed to be broker-contract-scaled, so divide by 100.**
   `account-position-model.ts:248` (divide `:261`). → a legit ≥$50 premium (deep-ITM/LEAP) has cost basis
   & PnL **off by 100×**. Check: feed a $60 premium with flat avg/mark → asserts it returns 0.60.

6. **The mark-stop mirror sell is assumed to always succeed, so the live stop emits exactly one
   pnl-bearing exit.** `shadow-account.ts:4746/4809`; halt sums all exits `signal-options-automation.ts:6287`.
   → mirror sell throws (DB contention) → position stays open with a persisted exit → re-emit next cycle →
   **loss double-counted into the daily-loss halt budget**. Check: force the mirror order to throw once, re-run mark refresh, observe 2 exits.

## Tier 2 — risk-control / signal correctness

7. **MTF 4h/D confirmation is fail-closed and silently suppresses ALL signals.** `signal-monitor.ts:4590`
   + `lib/pyrus-signals-core/src/index.ts:922/133`. ≤240 (or even 1000) intraday bars aggregate to far
   fewer than the ~85 a 4h/D trend needs → `resolvePyrusSignalsTrendDirection` returns 0 (neutral) →
   required confirmation can never be ±1 → **signals permanently, silently suppressed** when the advertised
   feature is on. Check: 240×5m bars + `{signalFiltersEnabled:true,requireMtf2:true}` → empty signalEvents despite a CHoCH.
8. **The daily-loss halt buckets P&L by UTC calendar day, not the ET session.** `signal-options-automation.ts:6291`
   (`isSameUtcDate`). UTC rolls ~8pm ET → overnight/extended exits land in the wrong day → halt **resets
   early / mis-aggregates**. Check: two exits straddling 00:00 UTC land in different "days."
9. **`barsSinceSignal ≈ elapsed ÷ timeframe` (assumes no session gaps), via `Math.max`.** `signal-monitor.ts:6422`.
   → over-ages a Fri 15:55 signal to ~768 bars by Mon open → genuinely-fresh carryover **dropped at next open**
   (missed entries). High likelihood (every gap). Check: `signalMonitorBarsSinceSignal({timeframe:'5m', signalAt:Fri15:55, latestBarAt:Mon09:35, presentBarsSinceSignal:1})` → hundreds.
10. **The off-money guardrail returns `true` (ALLOW) when the spot price is null/≤0.** `signal-options-automation.ts:11931`.
    → null/stale `signalPrice` → **deep-OTM/ITM strike passes and fills** — exactly the bug it was added to stop. Check: call `signalOptionsStrikeWithinMoneyness` with `spot:null` → `true`.
11. **A reconstructed position with no finite stop defaults to `entryPrice * 0.5`.** `signal-options-automation.ts:5787`.
    → a missing stop in the payload becomes a **−50% stop** instead of the tighter configured one. Check: entry payload with no `stopPrice` → `stopPrice === entryPrice*0.5`.

## Tier 3 — freeze / data correctness (ties to this session's freeze)

12. **The pressure snapshot is assumed "current," but it's refreshed only by a 15s `setInterval` that is
    starved by the very event-loop freeze it exists to detect.** `diagnostics.ts:2736` (sole updater),
    `resource-pressure.ts:476` (hysteresis). → during a multi-second freeze no new sample lands;
    `hardResourceLevel` stays frozen at the pre-freeze value → shedding can't react, and pressure reads stale
    "normal" exactly when it's worst. This is part of why the headline read "normal" during the freeze we
    chased. Check: log wall-clock between successive `updateApiResourcePressure` calls under an induced sync loop-block.
13. **A completed higher-TF bucket is assumed to have all its constituent minute bars present.**
    `signal-monitor-local-bar-cache.ts:432-476`. → an AM-feed gap drops a minute; the bucket rolls up from a
    subset → understated volume / wrong high-low-close **persisted as authoritative** (`partial:false`). Check: inject minutes {9:00,9:01,9:03,9:04} for a 5m bucket; assert it's withheld, not persisted as 4-bar truth.
14. **An AM payload with a valid `close` is assumed to have valid `open/high/low` — only `close<=0` is rejected.**
    `massive-stock-aggregate-stream.ts:145-157`. → a `low:0`/negative/`low>high` payload flows into ATR/range
    and persisted lows. The `close<=0` fix already proves the provider emits non-physical OHLC. Check: feed `{o,h,l:0,c:5}`; observe a bar, not null.
15. **Day-change context (prevClose/open/high/low) is assumed valid across time — never session-resets.**
    `stock-quote-day-change-context.ts:132-148`. → a symbol quiet overnight keeps yesterday's prevClose;
    today's first quotes compute change vs yesterday and clamp today's high/low to yesterday's extremes.
    Check: seed context day N, advance clock to N+1, enrich a quote lacking prevClose; assert it doesn't reuse the day-N baseline.
16. **Position sizing assumes `price > 0`: `floor(min(cash,target)/price)`.** `shadow-account.ts:12903`. →
    `price===0` (bad bar) → `Infinity` → `while(quantity>0)` **never terminates → hang/freeze**. Check: `quantityForCash(price:0)` → non-termination.
17. **Off-RTH stream silence is assumed benign — the stall watchdog runs only during RTH.**
    `bridge-quote-stream.ts:714` (gated on `isLikelyUsEquitySession`). → a wedged/silent stream in
    pre-market/after-hours is **not force-reconnected** → frozen prices in extended hours. Plus the
    `isLikelyUsEquitySession` heuristic ignores holidays/half-days (`bridge-client.ts:613`) → false stalls on holidays.

## Tier 4 — Rust worker (mostly silent wrong-writes / job-fail, not crashes)

The crate is defensively written (zero raw `.unwrap()/panic!`, all errors are job-level). The real exposure
is **provider-shape drift → silent wrong writes**:
18. Per-contract parse drops are silent; chain completeness judged only by pagination → an undercounted GEX
    chain is written `source_status:"ok"`. `providers/massive.rs:440` + `:175`.
19. `as_of` is fabricated as `Utc::now()` when the provider timestamp is absent → stale data labeled "live"
    by the GEX staleness check. `providers/massive.rs:420`.
20. OI/volume `value.round() as i32` saturates silently on ≥2³¹ → wrong GEX. `providers/massive.rs:477`.
21. Retention `Utc::now() - Duration::days(retention_days)` with an absurd env → **panic in a dropped-handle
    spawn** → retention loop dies → cache tables bloat unbounded (the exact starvation it prevents). `retention.rs:149`, spawn `main.rs:243`.

**Latent (fires only if `IbkrClient` in `client.ts` is wired in — today the live path is `IbkrBridgeClient`):**
auto-confirm ALL order warnings (`client.ts:2921`), contract resolution falls back to `results[0]`
(`:2752/2860`), default account = `accounts[0]` (`:2974`), fabricate `randomUUID()` order id on missing id
(`:3060`). If the desktop bridge ships from this same `client.ts`, re-rank these to Tier 1.

## Cross-cutting themes
- **Timers don't fire during the freeze they detect** (pressure sampler #12, SSE drain/heartbeat, stall
  watchdog #17) — every `unref`'d `setInterval`/`setTimeout` degrades exactly under the condition it mitigates.
- **"Immutable closed bars / stable day baselines"** (#13–15) — corrections, backfill, and session
  rollovers are the ~0.4% the cross-cycle cache invalidation hook (built this session) must catch.
- **Position identity by symbol, no per-event/per-position uniqueness or locking** (#1, #4) — the single
  root behind double-entry, lost-update, and phantom-open.
- **External boundaries (provider JSON, bridge HTTP, broker session) trusted without validation** (#2, #3,
  #14, #18–20) — no schema/shape/freshness check at the seam.

## Ruled out (verified safe — don't re-chase)
- Bar sortedness is **enforced** (every eval path `.sort()`s by time: `signal-monitor.ts:4421`).
- Epoch units are consistent (ms vs s) across the signal path; ELU/delay/CPU units at the pressure
  producer boundary match their thresholds (`platform.ts:2725-2757`).
- `shadow_positions` is unique on `(accountId, positionKey)`; `account.cash/realizedPnl` are full re-SUM
  from the ledger each write (self-healing) — the un-healing case is the **position** row (#4).
- DB pool counts reflect reality; the `≥2 waiters` gate is a deliberate de-flap.
- The Rust worker is hard to crash (only absurd-env retention/lease panics).
