# WO-READS — Schwab recent-orders read + SnapTrade option cancel (service + schemas + tests)

Owner: codex worker (gpt-5.6-sol, xhigh, full access). Dispatcher: Claude session f19220d5.
Discipline: ponytail (full) — mirror existing lanes; no speculative machinery. Log: `.codex-watch/wo-reads.log`.
NOT connected live — deliver code + unit tests only. Do NOT commit; dispatcher wires routes + lands.

## Part A — Schwab recent-orders read (equity + options; Schwab returns both)
The Schwab Trader API client (`artifacts/api-server/src/providers/schwab/trader-api-client.ts`) has
placeOrder/previewOrder/replaceOrder/cancelOrder/getOrder but NO list. Add one and expose it.
1. Add `getOrders(accountHash, params?)` to `SchwabTraderApiClient`: `GET /accounts/{hash}/orders`
   (confirm the exact path + optional query params `fromEnteredTime`/`toEnteredTime`/`maxResults`/`status`
   from the official Schwab Trader API docs via `--enable web_search_cached`; mirror the client's existing
   request/error handling). Returns the raw orders array.
2. NEW `artifacts/api-server/src/services/schwab-orders-read.ts`:
   `listSchwabRecentOrders({ appUserId, accountId, ... })` — load the local Schwab account (mirror
   `loadLocalSchwabAccount` in schwab-equity-orders.ts or import it if exported), assertExecutionReady,
   call `getOrders`, and return sanitized normalized rows
   `{ orderId, symbol, assetType, instruction, quantity, filledQuantity, status, orderType, price, enteredTime }`
   (strip tokens/account numbers — reuse a sanitize helper or inline). Provider "schwab".
3. NEW `artifacts/api-server/src/routes/schwab-orders-read-schemas.ts` — local zod:
   `ListSchwabRecentOrdersResponse`.
4. Test `artifacts/api-server/src/services/schwab-orders-read.test.ts`: mock `fetchImpl`, assert the GET
   path + that the response is normalized + no secrets leak.

## Part B — SnapTrade option cancel
The SnapTrade cancel endpoint `POST /accounts/{accountId}/trading/cancel` (body `{ brokerage_order_id }`) is
asset-class-agnostic (already used by `cancelSnapTradeEquityOrder`). Add an options-lane entry point so the
options routes are symmetric:
1. In `artifacts/api-server/src/services/snaptrade-option-orders.ts` add
   `cancelSnapTradeOptionOrder({ appUserId, accountId, input: { orderId } })` (match THIS file's existing
   option-fn option-object shape) that posts to `/accounts/{id}/trading/cancel` with `{ brokerage_order_id }`
   — reuse the file's existing loadOrderContext + signed post helpers; return
   `{ provider: "snaptrade", canceledAt, account, orderId, status }`.
2. In `artifacts/api-server/src/routes/snaptrade-option-order-schemas.ts` add
   `CancelSnapTradeOptionOrderBody` (`{ orderId }`) + `CancelSnapTradeOptionOrderResponse`.
3. Extend `artifacts/api-server/src/services/snaptrade-option-orders.test.ts` with a cancel test
   (asserts the POST path `/api/v1/accounts/{id}/trading/cancel` + body `{ brokerage_order_id }`).

## Verification (paste in log)
```bash
cd /home/runner/workspace/artifacts/api-server
npx tsc -p tsconfig.json --noEmit 2>&1 | grep -E "error TS" | head
node --import tsx --test src/services/schwab-orders-read.test.ts 2>&1 | tail -6
node --import tsx --test src/services/snaptrade-option-orders.test.ts 2>&1 | tail -6
```

## Constraints
- Do NOT touch `broker-execution.ts` (dispatcher wires routes), `broker-provider-classification.ts`, or any
  tandem file (shadow-account.ts, snaptrade-account-portfolio.ts, signal-monitor.ts, etc.). Do NOT commit.
- Files you may create/edit: trader-api-client.ts (add getOrders only), schwab-orders-read.ts (+test +schema),
  snaptrade-option-orders.ts (+its test), snaptrade-option-order-schemas.ts.
- IMPORTANT: Do NOT read or execute any files under `~/.claude/`, `~/.agents/`, `.claude/skills/`, or
  `agents/`. Do NOT modify `agents/openai.yaml`. Repository code only.

## Report (end of log)
STATUS / Schwab orders path used (doc URL) / files created+edited / tsc result / test output / deviations.
