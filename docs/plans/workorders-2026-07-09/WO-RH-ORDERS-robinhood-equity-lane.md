# WO-RH-ORDERS — Robinhood equity order lane (review → place via agentic MCP)

Owner: codex worker (xhigh, full permissions). Dispatcher: Claude positions session (71069931). Log: `.codex-watch/wo-rh-orders.log`.
Discipline: ponytail (full) — mirror the existing SnapTrade lane's shape; no speculative machinery. Do NOT commit; dispatcher lands.

## Goal
Enable a real ~$5 notional BUY on the Robinhood "Agentic" account (account_number `727958282`, `agentic_allowed: true`, verified live). Today NO order path exists: sync hard-codes blocker `robinhood.order_tooling_unverified` and never grants `orders`/`execution-ready`.

## Verified live facts (do not re-derive)
- MCP tools exist and schemas are captured in `.codex-watch/rh-order-tools.json` (read it): `review_equity_order`, `place_equity_order`, `get_equity_orders`, `cancel_equity_order`, `get_equity_tradability`.
- Params (strings!): `account_number`, `symbol`, `side` ('buy'|'sell'), `type` ('market'|'limit'|'stop_market'|'stop_limit'), exactly one of `quantity` | `dollar_amount` (dollar_amount ⇒ type=market), `limit_price`/`stop_price` when applicable, `time_in_force` ('gfd' default | 'gtc'), `market_hours` ('regular_hours' default). `place_equity_order` adds `ref_id` (fresh UUID per logical order; SAME ref_id on transient retries).
- Session mechanics proven: `getRobinhoodAccessToken({ appUserId })` (services/robinhood-oauth.ts:331) → `new RobinhoodMcpSession({ accessToken })` → `session.callTool({ name, arguments })` (providers/robinhood/mcp-client.ts). get_accounts returns `{ data: { accounts: [{ account_number, nickname, agentic_allowed, state, deactivated, ... }] } }`.
- Non-agentic accounts are REJECTED by the tools; only `agentic_allowed=true` may trade.

## Deliverables

### 1. `artifacts/api-server/src/services/robinhood-equity-orders.ts` (new)
Mirror `snaptrade-equity-orders.ts` conventions (types, HttpError codes, normalize/validate helpers) but keep it lean:
- `reviewRobinhoodEquityOrder({ appUserId, accountId, input })` — input: `{ symbol, side: 'BUY'|'SELL', orderType: 'Market'|'Limit'|'StopMarket'|'StopLimit', timeInForce: 'Day'|'GTC', marketHours?: 'regular_hours'|'extended_hours'|'all_day_hours', quantity?: number|null, notionalValue?: number|null, limitPrice?: number|null, stopPrice?: number|null }`. Validate exactly-one of quantity|notionalValue; notional ⇒ Market. Load the LOCAL broker account row by `accountId` (broker_accounts.id), assert provider robinhood, mode live, not deactivated, and `agentic_allowed` (see 3). Derive `account_number` from `provider_account_id` (strip `robinhood:` prefix). Call `review_equity_order`; parse the payload (quote, estimated cost/shares, alerts) into a structured response; surface alerts verbatim in an `alerts` array.
- `placeRobinhoodEquityOrder({ appUserId, accountId, input })` — input adds `confirm: true` (409 `robinhood_order_confirmation_required` when absent — copy SnapTrade), `refId?` (generate `randomUUID()` when absent), `taxPreflightToken`, `taxAcknowledgements`. REQUIRED: call `assertTaxPreflightForOrderSubmission` (services/tax-planning.ts:959) with a `TaxOrderLike` mapped like `snapTradeSubmitToTaxOrder` (route: "robinhood", mode: "live", type lowercase mapping) and `recordTaxPreflightOrderSubmitted` after success. Add a submit rate-limit mirroring `assertSubmitRateLimit`. Call `place_equity_order` with `ref_id`; parse order id/state.
- `listRobinhoodEquityOrders({ appUserId, accountId })` — `get_equity_orders` for the account, normalized minimal rows (id, symbol, side, state, quantity, average_price, created_at) for fill polling.
- All numeric tool params serialized as STRINGS per schema.

### 2. Routes in `artifacts/api-server/src/routes/broker-execution.ts`
Mirror the SnapTrade order routes (~lines 618-668) exactly (same auth middleware/admin gating, body validation, response `.parse(...)` conventions):
- `POST /broker-execution/robinhood/accounts/:accountId/orders/impact` → review
- `POST /broker-execution/robinhood/accounts/:accountId/orders` → place
- `GET  /broker-execution/robinhood/accounts/:accountId/orders/recent` → list
Add response schemas beside the SnapTrade ones (follow whatever schema module pattern those use).

### 3. Capability flip in `artifacts/api-server/src/services/robinhood-account-sync.ts`
Replace the hardcoded `robinhood.order_tooling_unverified` blocker (~line 245): an account gets `orders`, `executions`, `execution-ready` capabilities and `executionReady: true` **iff** its get_accounts row has `agentic_allowed === true` and state active/not deactivated. Non-agentic accounts keep today's blocked behavior (blocker code `robinhood.agentic_not_allowed`). Persist `agentic_allowed` (e.g. in the account row's existing metadata/capabilities json) so the order service can assert it without an extra MCP call — follow the existing row-shape conventions in that file.
Also update `broker-provider-classification.ts` (~line 277) robinhood entry: reflect that agentic order tooling is now schema-verified for review/place/cancel equity; keep options trading listed as unverified.

### 4. Tests
- `robinhood-equity-orders.test.ts`: mock MCP via `fetchImpl` (the session takes fetchImpl) or a session factory seam — cover: review happy path (dollar_amount string serialization, alerts passthrough), place requires confirm (409), place requires tax preflight for live (mint via test-db like snaptrade tests OR mock assert — follow the least-machinery approach that actually runs), non-agentic account rejected, quantity XOR notional validation.
- Extend `robinhood-account-sync` tests if they exist for the capability flip (agentic → execution-ready; non-agentic → blocked).
- `npx tsc -p tsconfig.json --noEmit` clean.

## Verification (paste outputs in report)
```bash
cd /home/runner/workspace/artifacts/api-server
npx tsc -p tsconfig.json --noEmit
node --import tsx --test src/services/robinhood-equity-orders.test.ts
node --import tsx --test src/services/robinhood-account-sync.test.ts 2>/dev/null || true
node --import tsx --test src/routes/broker-execution.test.ts 2>&1 | tail -5
```

## Constraints
- Do NOT touch snaptrade-*/schwab-* services, shadow-account.ts, signal-monitor, or any file not named above.
- No commits/stash. Real placement will be driven by the dispatcher service-level after review.
- Keep the MCP `guide` fields out of parsed responses; parse `data` payloads defensively (tool results may be JSON-in-text content blocks — check how callTool returns and how robinhood-account-sync extracts payloads, e.g. extractAccountsPayload).

## Report format
STATUS / DIFFSTAT / test outputs / any deviation + why / exact service call shape the dispatcher should use for a $5.00 notional PLUG buy review+place on account_number 727958282.
