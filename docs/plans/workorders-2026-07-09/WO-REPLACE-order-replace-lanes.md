# WO-REPLACE — Order replace/modify lanes (SnapTrade + Schwab; Robinhood N/A)

Owner: codex worker (gpt-5.6-sol, xhigh, full access). Dispatcher: Claude session f19220d5.
Discipline: ponytail (full) — mirror the existing equity/cancel lanes. Log: `.codex-watch/wo-replace.log`.
Deliver code + unit tests only; do NOT commit (dispatcher wires routes + lands). NOT connected live for Schwab.

## Scope
Add order **replace/modify** where the broker supports it. Robinhood documents NO replace tool
(cancel + re-place) — do NOT build a Robinhood replace; note it in the log. Build SnapTrade + Schwab.

## Part A — Schwab replace (client method already exists)
`SchwabTraderApiClient.replaceOrder(accountHash, orderId, order)` (PUT `/accounts/{hash}/orders/{orderId}`)
is already implemented (`providers/schwab/trader-api-client.ts`). Add a service wrapper mirroring
`submitSchwabEquityOrder` + `cancelSchwabEquityOrder` in `schwab-equity-orders.ts`:
- `replaceSchwabEquityOrder({ appUserId, accountId, orderId, input })` — validate + build the SchwabOrderRequest
  (reuse `validateSchwabEquityOrderInput` + `buildSchwabOrderRequest`), require `confirm:true`, run the tax
  preflight for the NEW order (the replacement is a live order), assert execution-ready, call
  `client.replaceOrder(accountHash, orderId, request)`, return `{ provider:"schwab", replacedAt, account,
  orderId: <new id>, previousOrderId: <old>, status:"replaced" }`. Sanitize.

## Part B — SnapTrade replace (research the exact contract)
Confirm from https://docs.snaptrade.com/reference/Trading/Trading_replaceOrder (+ web_search_cached) the exact
HTTP method, path (likely `PUT`/`PATCH /accounts/{accountId}/trading/{brokerageOrderId}` or similar) and body.
Record the exact path + fields in the log before coding. Then add
`replaceSnapTradeEquityOrder({ appUserId, accountId, orderId, input })` to `snaptrade-equity-orders.ts`,
reusing the file's signing/user-scoped-query/postSnapTradeJson helpers + `normalizeSubmitInput`; require
`confirm:true`, run tax preflight for the new order, assert execution-ready; return
`{ provider:"snaptrade", replacedAt, account, orderId: <returned brokerage_order_id>, previousOrderId, status }`.
If the exact endpoint/body cannot be confirmed, write `BLOCKED: <what's missing>` at the top of the log
instead of inventing it.

## Schemas + tests
- Local zod: add `ReplaceSchwabEquityOrderBody`/`Response` to a new
  `routes/schwab-equity-order-schemas.ts` (Schwab equity currently uses generated api-zod for other ops — put
  the new replace body/response here as local zod), and `ReplaceSnapTradeEquityOrderBody`/`Response` to a new
  `routes/snaptrade-equity-order-schemas.ts` (extend the existing one if present — it already holds the cancel
  schema). Body ~= the submit body + no `orderId` (orderId is a path param).
- Tests: extend `schwab-equity-orders.test.ts` and `snaptrade-equity-orders.test.ts` with a replace happy-path
  (assert method/path/body) + confirm-required (409) + no-secret-leak.

## Verify (paste in log)
```bash
cd /home/runner/workspace/artifacts/api-server
npx tsc -p tsconfig.json --noEmit 2>&1 | grep -E "error TS" | grep -iE "schwab-equity|snaptrade-equity|equity-order-schemas" || echo "(clean)"
node --import tsx --test src/services/schwab-equity-orders.test.ts 2>&1 | tail -5
node --import tsx --test src/services/snaptrade-equity-orders.test.ts 2>&1 | tail -5
```

## Constraints + route suggestion for the dispatcher
- Do NOT touch `broker-execution.ts` (dispatcher wires routes), `broker-provider-classification.ts`, the option
  services, or tandem files. No commit. IMPORTANT: do not read/execute under ~/.claude/, ~/.agents/,
  .claude/skills/, agents/; do not modify agents/openai.yaml.
- Suggested routes (dispatcher will add): `POST /broker-execution/{schwab,snaptrade}/accounts/:accountId/orders/:orderId/replace`,
  auth **broker_connect + CSRF** (matches WO-SEC-1 replace gating). Report the exact service call shape.

## Report (end of log)
STATUS / SnapTrade replace endpoint used (doc URL + method/path/body) / files changed / tsc + test results /
the exact route shapes for the dispatcher / any BLOCK or deviation.
