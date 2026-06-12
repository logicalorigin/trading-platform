# IBKR Data-Line Session Progress

Updated: 2026-06-11. Owner: Claude (this session). Coordinating with a second agent (see Division of Labor).

## Corrected diagnosis (my earlier one was wrong)
- IBKR is a **WebSocket push API**. The app **under-uses** lines (idle), it does **not** over-subscribe. (`docs/plans/ibkr-data-line-architecture-plan.md`: `idleButEligibleLineCount=200`, options-metadata p95 ≈15.8s, failing durable `option_contracts` cache.)
- The `HTTP 504`s are our **api-server → stalled bridge control-plane**, not flooding. The "Output exceeded limit" is the bridge unable to drain the WS while stalled on metadata — a symptom, not a cause.
- **Live smoking gun (other agent, 22:22Z):** bridge **account lane = `stalled`** on a healthy bridge (`strictReady:true`, zero governor backoff) → frontend **`resolveIbkrWorkPressure` (`workPressureModel.js`)** collapses that one field into **disabling ALL realtime IBKR work** via `appWorkScheduler`. Heap/latency "pressure" is **cosmetic** (caps nothing).

## What I changed this session
**Reverted (built on the wrong over-subscription model):**
- `market-data-admission.ts` + its tests + `options-flow-scanner-metadata-timeout.test.ts`: the `optionLineCeiling` (arbitrary cap — the architecture forbids it; wants `bridgeBudget − hardReserve`).
- `signal-options-automation.ts`: the signal-first guard (`!isBridgeWorkBackedOff("options")`) + its import.

**Kept:**
- `signal-options-automation.ts`: day-change/last-quote plumbing (`dayChange`/`previousClose`) + `signal-options-option-day-change.test.ts` — separate "show last available data" feature.
- `runtimeControlModel.js`: removed a genuinely-dead `scanner-awaiting-next-cycle` handler.
- `docs/plans/ibkr-bridge-overload-loadshed.md`: annotated as **SUPERSEDED** (wrong premise; kept for history).

**Verification:** `pnpm --filter @workspace/api-server typecheck` green; 23 service tests pass.

**Live build caveat:** the running build still contains the (now source-reverted) ceiling. **Restart intentionally held** so it doesn't clear the `account lane stalled` flag and wipe the other agent's live repro.

## Division of labor
- **Other agent:** `resolveIbkrWorkPressure` / `appWorkScheduler` frontend gate; backend account-scheduler lane (what sets/clears `stalled`); hunting cosmetic→real gates. (+ F5 bar-load-timeout-no-backoff, F7 DB-error-pauses-worker.)
- **Me:** durable `option_contracts` cache (`option-metadata-store.ts`) + option-metadata hot-path (architecture Phase 1) — the next bottleneck once realtime is un-gated.
- **Shared — coordinate before editing:** `market-data-admission.ts`, `platform.ts`, line-usage.

## Next
- Verify `option_contracts` durable cache state (read-only) and the metadata hot-path.
- Restart to align live build with reverted source **after** the other agent captures the account-lane repro.
