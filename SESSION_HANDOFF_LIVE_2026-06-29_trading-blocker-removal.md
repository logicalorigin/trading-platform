# Live Session Handoff: Trading Blocker Removal + Massive Stream / Event-Loop Diagnosis

- Session ID: `48237695-e382-4aed-a953-f4577279dcca` (Claude, opus-4-8)
- Date: 2026-06-29 MDT
- CWD: `/home/runner/workspace` · Branch: `main` · HEAD: `86ae9bc` (note: git history is frozen at 06-25; all session work is in the **uncommitted** working tree)
- Workstream: resume dropped session `c379765f` — find/remove anything blocking shadow trading now that equities + options data is fully on Massive; then diagnose the Massive-stream "interruption".

## Request arc
recover the dropped session → clear shadow-trading blockers on Massive → "watch the app, report anything blocking trading" → "what's interrupting the Massive stream (it's our side, not Massive)" → "fix the cause, not back off for pressure" → planning + C1 → **this handoff**.

---

## ✅ LANDED THIS SESSION (uncommitted, validated, live via SIGUSR2 reload)

All three edits are in the working tree mixed into a large pre-existing dirty tree. **Isolate them by these markers** (HEAD 86ae9bc predates them):

### 1. Fix: errant STA "shadow link pending"  — `artifacts/api-server/src/services/signal-options-automation.ts`
- **Root cause:** the default `view=summary` builds `buildSignalOptionsShadowIndex` from only `SIGNAL_OPTIONS_SUMMARY_EVENT_LIMIT = 100` events. High-frequency `shadow_mark`/`candidate_skipped` events push open positions' entry orders past #100, so their order/fill/position link never resolved → live, filled positions showed "shadow link pending". (`view=full`/2500 was always correct.)
- **Fix (marker `openPositionOrders`, ×2):** `buildSignalOptionsShadowIndex` now also loads orders/fills for currently-OPEN positions **independent of the event window** (mirrors the existing window-independent cash-ledger load), matched by `shadowPositionKey`.
- **Fix (marker `hasEntryOrFill`, ×4):** `deriveCandidateActionStatus` now treats a resolved shadow link as entry evidence → a filled open position reads `shadow_filled`, not `candidate`, in windowed views.
- **Test:** new `deriveCandidateActionStatus` regression in `signal-options-automation.test.ts` (markers `hasEntryOrFill` test). Suite **26/26**.
- **Runtime-verified:** default summary view now shows GLD/GOOGL `shadow_filled / Synced (attributed)` (were `candidate / shadow link pending`).

### 2. Perf cause-fix: matrix-stream flush cadence  — `artifacts/api-server/src/services/signal-monitor.ts`
- **Marker:** `const SIGNAL_MONITOR_MATRIX_STREAM_FLUSH_MS = 300;` (was 150) + the comment above it.
- The UI-only Signal-Matrix live-edge stream recomputed the whole universe every 150ms (6.7×/s) — excess CPU on the shared loop; the trade engine never reads this stream. 300ms (3.3×/s) is still smooth and roughly halves the continuous eval. **Permanent reduction of excess work — NOT pressure-reactive.**
- **Measured (before→after profile):** busy 72.5%→67.8%, idle 27.5%→32.2%, `_parseRowAsArray` 18.9%→14.9%. Marks went from a 66–130s sawtooth to fresh 6–10s.
- NOTE: an earlier *pressure-reactive* backoff ("C-shed") was implemented then **reverted** per user steer ("fix the cause, not back off for pressure"). No remnants.

**Validation (all green):** `pnpm --filter @workspace/api-server run typecheck` ✅ · signal-options suite **26/26** ✅ · `/api/healthz` 200. Changes are live (API rebuilt + `SIGUSR2`-reloaded). **NOT committed** (no commit requested).

---

## 🔍 DIAGNOSIS: the Massive "stream interruption" is our-side event-loop saturation
Confirmed via a live CPU profile (60s, ~148k samples, inspector via SIGUSR1 + CDP):
- **`eventLoopUtilization` pinned ~98–100%.** Flight-recorder confirms ELU is THE dominant pressure driver (latency/db-pool/cache are secondary "watch").
- Top costs: **`_parseRowAsArray` ~15–21%** (Postgres row decoding, distributed/fresh-required) + **signal-matrix eval ~10–12%** (`evaluateSignalMonitorMatrixStateFromCompletedBars`, `buildSignalMonitorIndicatorSnapshot`).
- **Mechanism:** the single API loop runs heavy fresh-required signal/UI compute that **cannot be cached** (caches deliberately `TTL=0`; trade engine reads live; `filterState` consumed) while ALSO running the trade-critical 5s mark tick + Massive websocket drain. When saturated it can't drain the socket / refresh the 1s-TTL quote snapshots → option marks go stale ("interruption"). Massive's feed is fine.

---

## ❌ VERIFIED NON-BUGS (do NOT re-investigate)
- **DB-pool saturation / low signal freshness:** transient scan-burst only (pg idle between); matrix scan prefetch uses `limit=240` not 1000; freshness 36/2796 is normal signal *sparsity* (actionable within 1 bar, by design). The workflow finder's "bump `STORED_BARS_PREFETCH_TARGET_ROWS_PER_QUERY`" was wrong (real value 480, batches at 2 for 240) and would break the startup-latency test.
- **IBKR option-line demand / position-mark "unavailable":** `bridge-option-quote-stream.ts` is Massive-backed (`source:"massive"`); "IBKR" is legacy naming; marks are fresh. Transient first-tick churn. Removing it would BREAK the Massive mark feed.
- **`greek_selector_liquidity_failed`:** disproven — `MASSIVE_OPTIONS_RECENCY` defaults to **realtime**, so options aren't "delayed"; gate never fires. The few cases are real per-contract liquidity; entries still fill via fallback.
- **`read_probe_failed`, `ibkr_bridge_not_configured`, `gateway_blocked`(historical), `ibkr_not_configured`(historical):** expected consequences of broker-less mode.
- **`mtf_not_aligned`** (dominant skip): by-design multi-timeframe strategy gate. Left untouched.
- See memory: `memory/shadow-trading-massive-blockers.md`.

---

## C1 (offload heavy compute off the trade loop) — DE-RISK SPIKE DONE, decision pending
Spike numbers (240-bar input): inline `evaluatePyrusSignalsSignals` = **691 µs/call**; serializing bars to a worker = **222 µs/call**.
- Naive per-call worker pool (message-pass bars) nets only **~67%** of the matrix bucket (IPC-bound). "Worker-owns-bars" (own Massive feed + bar store) nets ~100% but is a **major** build.
- **Either way, C1 only addresses the ~12% eval bucket** — the bigger ~15–21% **DB-parse ceiling is untouched**. Full un-saturation requires isolating the *entire* signal-monitor subsystem (DB reads + eval + SSE) off the API process = a real project.

### OPEN DECISION (next session resumes here)
System is currently **healthy** (trades flowing — 8 positions; marks fresh 6–10s; links synced; ~5% more headroom). Options presented to user, awaiting choice:
- **(A) Bank it + watch** *(recommended)* — keep landed fixes; wire a lightweight ELU/mark-freshness watch; treat full subsystem isolation as a scoped project.
- **(B) Build C1 now (worker-owns-bars)** — ~8–12% loop relief; major build; doesn't touch DB-parse ceiling.
- **(C) Full subsystem isolation** — complete cause-fix; largest project.

## Next step
Get the A/B/C decision. If A: set up the watch + (optionally) commit the 3 landed changes isolated from the pre-existing dirty tree. If B/C: break into the proper task sequence and start.
