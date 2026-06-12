# Fix: Trade option-chain hydration — reserve line budget so the flow scanner can't starve it

**Status:** Ready for implementation (Codex). Root cause proven with live evidence. One prerequisite already landed on `main`.
**Owner context:** Diagnosed 2026-06-11. Scope is deliberately small — the labeling/admission stack is sound; do NOT do the full demand-controller rewrite (`docs/plans/ibkr-data-line-architecture-plan.md`).

## Context / why

The Trade page option chain was not hydrating reliably. Two things were wrong:

1. **(ALREADY FIXED, on `main` `b0c9c07`)** The chain *metadata* request `GET /api/options/chains` (request-family `trade-option-chain` / `trade-option-chain-batch`) was missing from the route-admission protected allowlist, so under resource pressure it was classified `deferred-analytics` and shed (HTTP 429). Fixed by adding those two families to `activeRequestFamilies` in `artifacts/api-server/src/services/route-admission.ts`. **Keep this.**

2. **(THIS FIX)** Even with metadata flowing, the chain warms up slowly (~12s to first live quote) and the metadata endpoint intermittently returns empty, because the **flow scanner is allowed to consume the entire option line budget**, leaving no reserved headroom for the user-facing Trade chain. The connection popover's "Visible" line pool correctly shows the chain demand *when a chain is actually open* — it is not a labeling bug — but the chain's lines have to fight the scanner for budget.

## Proven diagnosis (live evidence — do not re-litigate)

Driving the exact `visible-live` WS subscription the Trade screen sends (`/api/ws/options/quotes`, 22 SPY chain ids, intent `visible-live`, owner `trade-option-visible:SPY`) while sampling `/api/settings/ibkr-line-usage`:

| | baseline | @5s | @15s | @25s |
|---|---|---|---|---|
| `poolUsage.visible.activeLineCount` | 0 | **23** | 23 | 23 |
| `bridge.activeLineCount` | 28 | 28 | **55** | 55 |
| quotes received over WS | — | 0 | 88 | **264** |

- All 22 ids **accepted, 0 rejected** → the `visible` pool is NOT being starved at admission *in isolation*; it has cap 200 and registers demand correctly (`visible-live` → `visible` pool mapping in `market-data-admission.ts` is correct).
- Bridge lines actually open (28 → 55), quotes flow (first ~12s, 264 by 25s).
- The popover read 0 only because **nothing was streaming** (no Trade screen open) — expected.

But baseline line-usage under normal load showed the real pressure:
- `pressure.activeLineCount: 170 / usableLineCount: 200` (85% utilization, `usableRemainingLineCount: 30`).
- `scannerActiveLineCount: 144` — the flow scanner owns the budget.
- `budget.visibleOptionQuoteLineReserve: 41` is **configured but never enforced** against the scanner.
- `/api/options/chains` returned empty on ~2 of 3 polls (options upstream contended by the scanner).

## Root cause (exact line)

`artifacts/api-server/src/services/market-data-admission.ts`, function `buildFlowScannerDynamicLineCap` (around **lines 1783-1789**):

```ts
const optionBudgetLineCount = budget.targetFillLines;          // 200
const optionReserveLineCount = 0;                              // ← HARDCODED 0
const protectedPriorityLineCount = nonScannerLineIds.size;     // only lines ALREADY open
const dynamicScannerLineCap = Math.max(
  0,
  optionBudgetLineCount - protectedPriorityLineCount,          // 200 - ~24 = ~176
);
```

`optionReserveLineCount` is hardcoded to `0`, and the scanner cap only subtracts lines that are **already open**. So the scanner is permitted to fill up to ~176 lines while the Trade chain is closed; when the chain then opens it must wait for the scanner to release lines (the ~12s warm-up) or gets starved (empty chain). The reserve the system was designed to honor (`budget.visibleOptionQuoteLineReserve`, currently 41) is computed but dropped on the floor here.

## The fix (primary — small, surgical)

Enforce the configured visible reserve in the scanner's dynamic cap so the scanner always leaves headroom for the user-facing chain (and execution/account) even before those lines are open.

In `buildFlowScannerDynamicLineCap` (`market-data-admission.ts`):

```ts
const optionReserveLineCount = Math.max(
  0,
  budget.visibleOptionQuoteLineReserve ?? 0,   // currently 41; was hardcoded 0
);
// Reserve AT LEAST `optionReserveLineCount` of non-scanner headroom, OR the
// non-scanner lines already open, whichever is larger — never double-reserve.
const reservedNonScannerLineCount = Math.max(
  protectedPriorityLineCount,
  optionReserveLineCount,
);
const dynamicScannerLineCap = Math.max(
  0,
  optionBudgetLineCount - reservedNonScannerLineCount,
);
```

Effect:
- Chain closed: scanner cap = `200 - max(24, 41)` = **159** → 41 lines reserved for the chain/execution. Chain opens instantly into reserved headroom (no ~12s scanner-eviction wait, no empty-chain starvation).
- Chain open (visible 23 + other ~24 = ~47 non-scanner): cap = `200 - max(47, 41)` = **153** → no double-reserve.

Keep returning `optionReserveLineCount` in the diagnostics object (it is already a field) so `pressure.optionReserveLineCount` and `pressure.scannerEffectiveLineCap` reflect the enforced reserve in the connection popover and `/api/settings/ibkr-line-usage`.

**Make the reserve configurable / safe:** `visibleOptionQuoteLineReserve` already derives from config (see `budget` construction in `ibkr-line-usage.ts` / the admission budget). Confirm it is clamped so `optionReserveLineCount < optionBudgetLineCount` (e.g. cap the reserve at, say, 50% of `targetFillLines`) so a misconfig can't drive the scanner cap to 0.

## The fix (secondary, optional — only if warm-up still feels slow after the reserve)

Pre-warm the visible lines the instant the chain opens rather than lazily. The frontend already builds the visible id set in `artifacts/pyrus/src/features/trade/optionQuoteHydrationPlan.js` (cap `TRADE_OPTION_VISIBLE_QUOTE_CONTRACT_LIMIT = 40`) and subscribes via `useIbkrOptionQuoteStream` (`artifacts/pyrus/src/features/platform/live-streams.ts`). With the reserve in place the lines should open immediately, so do this only if measurement still shows a multi-second gap. Do NOT raise the 40-contract cap without confirming budget headroom.

## Files & functions

- **Change:** `artifacts/api-server/src/services/market-data-admission.ts` → `buildFlowScannerDynamicLineCap` (≈L1760-1814). The 3-line change above.
- **Read for context (do not change):**
  - `route-admission.ts` `activeRequestFamilies` — the prerequisite fix (already landed); the chain families must stay in the allowlist.
  - `market-data-admission.ts` `INTENT_POOL` / `POOL_INTENTS` — `visible-live`→`visible` mapping (correct, leave it).
  - `ibkr-line-usage.ts` — where `budget.visibleOptionQuoteLineReserve` / `visibleOptionQuoteContractLineCap` are derived.
  - `bridge-option-quote-stream.ts` (`admitMarketDataLeases`, `getDesiredProviderContractIds`) and `artifacts/ibkr-bridge/src/tws-provider.ts` (`ensureOptionQuoteSubscription`, `limitQuoteDemandForBudget` ≈L4111) — the line→bridge path (sound; leave it).

## Verification

1. **Typecheck:** `pnpm --filter @workspace/api-server typecheck`.
2. **Static check the cap:** with the app running, `GET /api/settings/ibkr-line-usage` → `pressure.scannerEffectiveLineCap` should now be `targetFillLines − reserve` (≈159 when the chain is closed and the scanner is busy), `pressure.optionReserveLineCount` should be ~41 (was 0), and `pressure.usableRemainingLineCount` should hold ≥ reserve even while the scanner is hot.
3. **End-to-end (the diagnostic that proved the bug):** open a `visible-live` WS subscription with real chain ids and confirm the chain warms faster and stays fed under scanner load. Repro script outline (uses the `ws` client in `artifacts/api-server/node_modules`):
   - Fetch ids: `GET /api/options/chains?underlying=SPY&expirationDate=<near>&strikesAroundMoney=5` with header `x-pyrus-request-family: trade-option-chain`, take `contracts[].contract.providerContractId`.
   - Open WS `ws://127.0.0.1:8080/api/ws/options/quotes`, send `{type:"subscribe", underlying:"SPY", providerContractIds:[...], owner:"trade-option-visible:SPY", intent:"visible-live", requiresGreeks:true}`.
   - Sample `/api/settings/ibkr-line-usage` over ~25s: `poolUsage.visible.activeLineCount` should rise to ≈ id count, `bridge.activeLineCount` should rise by ≈ that, and first quotes should arrive sooner than the pre-fix ~12s.
   - Pass criterion vs baseline: with the scanner hot, the chain still gets its lines (no rejection, lower time-to-first-quote) AND `/api/options/chains` stops intermittently returning empty.
4. **UI:** open the Trade screen with a liquid ticker (e.g. SPY) during market hours; the option chain should populate within a couple seconds and the connection popover "Visible" pool should show ≈ the visible strike count.

## Out of scope / do NOT do

- Do **not** implement the full `IbkrLiveLineDemandController` rewrite (`docs/plans/ibkr-data-line-architecture-plan.md`) — that is a separate, larger project.
- Do **not** touch the `visible-live`→`visible` intent mapping, the route-admission allowlist (keep the chain families), or the `twsopt:`/conid id resolution — all verified correct.
- Do **not** raise pool caps blindly; the fix is *reserving* existing budget for the user-facing chain, not adding lines.
