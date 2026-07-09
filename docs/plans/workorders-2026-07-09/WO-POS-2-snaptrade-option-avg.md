# WO-POS-2 — Backend SnapTrade option average-cost normalization

Owner: codex worker (xhigh). Dispatcher: Claude positions session (71069931). Status log: `.codex-watch/wo-pos-2.log`.
Discipline: ponytail (full) — the laziest fix that actually works; minimal surgical edits; no drive-by refactors.

## Problem (two provable defects, one function)

File: `artifacts/api-server/src/services/snaptrade-account-portfolio.ts`
Function: `normalizeAveragePurchasePrice` (~line 444) and its call site in `normalizePosition` (~line 535).

SnapTrade option positions arrive with:
- `units` (contracts), `price` (PER-SHARE premium — correct, do NOT touch marketValue math),
- `average_purchase_price` — for E*TRADE this is PER-CONTRACT (e.g. `83.51` = $0.8351/share × 100),
- `cost_basis` — TOTAL for the position.

**Convention is pinned by repo evidence** (do not re-litigate):
`artifacts/pyrus/src/screens/account/snapTradeAccountPanelModel.test.mjs` ("normalizes E*TRADE SnapTrade option positions"): qty **20**, `averagePurchasePrice: 83.51`, `costBasis: 1670.2` → `1670.2 = 20 × 83.51` proves cost_basis is TOTAL and avg is PER-CONTRACT for E*TRADE; the correct per-share premium is `0.8351`.

Defect A — explicit per-contract avg not de-scaled: `normalizeAveragePurchasePrice` only divides by the multiplier when `contractScaled` is true, and `contractScaled` is only set when avg was ABSENT and cost_basis was used as the value. An explicit E*TRADE `average_purchase_price: 83.51` passes through unscaled → `calculatedPositionCostBasis = 20 × 83.51 × 100 = 167,020` (100× real) → `unrealizedPnl` garbage on real connected accounts.

Defect B — fallback misses /quantity: when avg is absent, `value = rawCostBasis` (a TOTAL) and the function returns `value / multiplier`. Missing `/ quantity`: for `units 3, cost_basis 150` it returns `1.5` instead of `0.5`. The existing backend test only covers `units: -1` (qty 1), which masks this.

## Fix design (mirror the frontend's magnitude detection)

Reference implementation: `averageCostForSnapTradePosition` in `artifacts/pyrus/src/screens/account/snapTradeAccountPanelModel.js` (~line 180) — including the `Math.abs(costBasis)` short-credit handling.

In `normalizePosition` / `normalizeAveragePurchasePrice` for option contracts (multiplier > 1):
1. Fallback path (no explicit avg, cost_basis present): per-share avg = `|cost_basis| / |quantity| / multiplier` (guard qty > 0). Fixes B.
2. Explicit-avg path: compute `perContractCost = |cost_basis| / |quantity|` when both present; if `|perContractCost − explicit| <= max(0.01, |explicit| × 0.0001)` the explicit value is PER-CONTRACT → return `explicit / multiplier`. Otherwise keep explicit as-is (IBKR-style per-share avgs must pass through unchanged). Fixes A.
3. Non-option positions: zero behavior change.
4. Downstream: `calculatedPositionCostBasis` (qty × avg × multiplier) then reproduces the true total; `unrealizedPnl` follows. Do NOT change `calculatedPositionMarketValue` — `price` is genuinely per-share (audit-verified; a prior proposal to de-scale it was REJECTED as wrong).

## Required tests (extend `artifacts/api-server/src/services/snaptrade-account-portfolio.test.ts`)

Follow the existing fetch-mock test shape in that file. Cases:
1. E*TRADE explicit per-contract, long: option `units 20`, `average_purchase_price 83.51`, `cost_basis 1670.2`, `price 0.17` → `averagePurchasePrice 0.8351`, `costBasis 1670.2`, `marketValue 340`, `unrealizedPnl -1330.2`.
2. Fallback multi-qty: option `units 3`, no avg, `cost_basis 150` → `averagePurchasePrice 0.5`.
3. Existing case stays green: option `units -1`, `cost_basis 50` → `0.5` (already asserted ~line 233 — must not regress).
4. Per-share explicit passthrough: option `units 2`, `average_purchase_price 0.8`, `cost_basis 160` → stays `0.8` (perContract = 80 ≠ 0.8 → no de-scale).
5. Short credit: option `units -3` (or side short), `average_purchase_price 500`, `cost_basis -1500` → `5` (uses |cost_basis|).

## Verification (all must pass; paste outputs into the report)

```bash
cd /home/runner/workspace/artifacts/api-server
npx tsc -p tsconfig.json --noEmit
node --import tsx --test src/services/snaptrade-account-portfolio.test.ts
```
Also run the frontend model tests to prove no double-normalization regression (backend now emits per-share avg; the frontend heuristic must leave it alone because perContract=83.51 ≠ 0.8351):
```bash
cd /home/runner/workspace/artifacts/pyrus
node --import tsx --test src/screens/account/snapTradeAccountPanelModel.test.mjs
```

## Constraints
- Touch ONLY `snaptrade-account-portfolio.ts` and its test file. Do not commit.
- Do not modify `calculatedPositionMarketValue`, equity paths, or any other file.
- Match surrounding code style; comments explain WHY (unit conventions), not what.

## Report format (final message)
STATUS: DONE | DONE_WITH_CONCERNS | BLOCKED
DIFFSTAT, per-case test results, any deviation from this WO and why.
