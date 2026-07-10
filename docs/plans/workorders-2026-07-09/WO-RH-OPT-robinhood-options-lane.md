# WO-RH-OPT — Robinhood options order lane (service + schemas + tests)

Owner: codex worker (gpt-5.6-sol, xhigh, full access). Dispatcher: Claude session f19220d5.
Discipline: ponytail (full) — mirror the just-shipped Robinhood **equity** lane; no speculative machinery.
Log: `.codex-watch/wo-rh-opt.log`.

## Goal
Add a Robinhood **options** order lane over the agentic-trading MCP session, mirroring the equity lane
in `artifacts/api-server/src/services/robinhood-equity-orders.ts` (READ IT FIRST — copy its structure,
HttpError codes, sanitization, tax-preflight + rate-limit, string-serialized params, defensive parsing).

## Verified facts (do not re-derive)
- Full live MCP tool schemas are in `/home/runner/workspace/.codex-watch/rh-tools-full.json` (READ IT).
  Relevant tools: `get_option_chains`, `get_option_instruments`, `get_option_quotes`,
  `review_option_order`, `place_option_order`, `get_option_orders`, `cancel_option_order`,
  `get_option_positions`.
- Session mechanics identical to equity: `getRobinhoodAccessToken({ appUserId })` →
  `new RobinhoodMcpSession({ accessToken, fetchImpl?, mcpUrl? })` → `session.callTool({ name, arguments })`
  (providers/robinhood/mcp-client.ts). All numeric tool params are STRINGS.
- Account gating: reuse the equity lane's `loadLocalRobinhoodAccount` + agentic/execution-ready assertion
  (account already carries `robinhood-agentic` + `execution-ready` caps after equity sync). Derive
  `account_number` by stripping the `robinhood:` prefix from `provider_account_id`.
- `review_option_order`/`place_option_order` are legs-based (exactly one leg here):
  `legs: [{ option_id, side: 'buy'|'sell', position_effect: 'open'|'close', ratio_quantity? }]`,
  `type` ('limit' default | 'market' | 'stop_limit' | 'stop_market'), `quantity` (contract count string),
  `price`/`stop_price` per contract, `time_in_force` ('gfd'|'gtc'), `market_hours`, `chain_symbol` +
  `underlying_type` ('equity'|'index') for fees/collateral. `place_` adds `ref_id` (UUID).
- `option_id` is resolved via `get_option_instruments` from
  `{ chain_symbol, expiration_dates: 'YYYY-MM-DD', strike_price, type: 'call'|'put', state: 'active', tradability: 'tradable' }`.

## Deliverables (create ONLY these files)
1. `artifacts/api-server/src/services/robinhood-option-orders.ts`
   - `resolveRobinhoodOptionInstrument({ appUserId, accountId, input })` (or private helper): resolve
     `option_id` from `{ chainSymbol, expiration, strike, optionType }` via `get_option_instruments`; throw
     a clear HttpError if 0 or >1 tradable match.
   - `reviewRobinhoodOptionOrder({ appUserId, accountId, input })` — input:
     `{ chainSymbol, underlyingType?: 'equity'|'index', expiration, strike, optionType: 'Call'|'Put',
        side: 'Buy'|'Sell', positionEffect: 'Open'|'Close', orderType: 'Limit'|'Market'|'StopLimit'|'StopMarket',
        timeInForce: 'Day'|'GTC', marketHours?, quantity: number (contracts), limitPrice?, stopPrice? }`.
     Validate: limit/stop_limit require limitPrice; stop_* require stopPrice; market/stop_market omit limitPrice;
     market must be gfd; extended sessions limit+immediate only. Resolve option_id, call `review_option_order`,
     surface `order_checks`/alerts + any `market_data_disclosure` verbatim + the estimate/quote defensively.
   - `placeRobinhoodOptionOrder(...)` — adds `confirm: true` (409 `robinhood_option_order_confirmation_required`
     when absent), `refId?` (randomUUID default), `taxPreflightToken`, `taxAcknowledgements`. REQUIRED: call
     `assertTaxPreflightForOrderSubmission` with a `TaxOrderLike` where `assetClass: 'option'` and
     `optionContract` populated (underlying/expiration/strike/right — see tax-planning-model
     `normalizeOptionContractForFingerprint`), then `recordTaxPreflightOrderSubmitted(..., provider:'robinhood')`.
     Add a submit rate-limit mirroring the equity lane. Call `place_option_order` with `ref_id`; parse order id/state.
   - `listRobinhoodOptionOrders({ appUserId, accountId })` via `get_option_orders`; `cancelRobinhoodOptionOrder`
     via `cancel_option_order`. Minimal normalized rows.
   - Sanitize responses (account last-4 only). Numeric tool params serialized as STRINGS.
2. `artifacts/api-server/src/routes/robinhood-option-order-schemas.ts` — local zod (like
   `robinhood-equity-order-schemas.ts`), exports EXACTLY:
   `ReviewRobinhoodOptionOrderBody`, `PlaceRobinhoodOptionOrderBody`, `ReviewRobinhoodOptionOrderResponse`,
   `PlaceRobinhoodOptionOrderResponse`, `ListRobinhoodOptionOrdersResponse`, `CancelRobinhoodOptionOrderBody`,
   `CancelRobinhoodOptionOrderResponse`.
3. `artifacts/api-server/src/services/robinhood-option-orders.test.ts` — mock MCP via `fetchImpl`
   (mirror `robinhood-equity-orders.test.ts` / `robinhood-account-sync.test.ts` transport stub). Cover:
   option_id resolution (get_option_instruments args + single-match), review happy path (string params +
   alerts/disclosure), place requires confirm (409), place requires tax preflight (mint via
   `createTaxOrderPreflight` under `runAsAppUser`, assetClass 'option'), leg validation, price-required rules.

## Verification (paste outputs in the log)
```bash
cd /home/runner/workspace/artifacts/api-server
npx tsc -p tsconfig.json --noEmit 2>&1 | grep -E "error TS" | head
node --import tsx --test src/services/robinhood-option-orders.test.ts 2>&1 | tail -8
```

## Constraints
- Create ONLY the 3 files above. Do NOT touch `broker-execution.ts`, `broker-provider-classification.ts`,
  `robinhood-account-sync.ts`, `robinhood-equity-orders.ts`, or any file another lane owns.
- Do NOT commit or stash. The dispatcher wires routes + lands.
- IMPORTANT: Do NOT read or execute any files under `~/.claude/`, `~/.agents/`, `.claude/skills/`, or
  `agents/`. Do NOT modify `agents/openai.yaml`. Stay focused on repository code only.

## Report (end of log)
STATUS / files created / tsc result / test output / any deviation + why / the exact service call shape the
dispatcher should use for a Review of a single-leg long call.
