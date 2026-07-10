# WO-RH-TICKET — Add Robinhood as a selectable broker for EQUITY orders in the existing TradeOrderTicket

Owner: codex worker (gpt-5.6-sol, xhigh, full access). Dispatcher: Claude session f19220d5.
Discipline: ponytail (full) — SURGICAL edits to a mature 3615-line component; do NOT rewrite it.
Log: `.codex-watch/wo-rh-ticket.log`. Do NOT commit; dispatcher reviews + lands.

## Goal
Let an authorized user review + place a **Robinhood equity** order from the app's EXISTING order ticket
(`artifacts/pyrus/src/features/trade/TradeOrderTicket.jsx`), by adding Robinhood as a **selectable broker for
share (equity) orders**. Today equity auto-routes to SnapTrade only. OPTIONS ARE OUT OF SCOPE (Robinhood
agentic options are entitlement-blocked / equities-only beta) — do not touch the options/IBKR path.

## Integration map (verified anchors — study these regions first)
- `ticketIsShares` (line 368) / `ticketIsOptions` (369) — asset mode.
- `liveBrokerRoute = ticketIsShares ? "snaptrade" : "ibkr"` (line 462) — the route. You will make the
  SHARES route selectable between `"snaptrade"` and `"robinhood"` (options stays `"ibkr"`, untouched).
- `snapTradeExecutionState = useSnapTradeExecutionAccountState()` (459), `snapTradeAccount` (460),
  `snapTradeAccountReady` (461) — the SnapTrade account-selection model (see
  `../broker/snapTradeExecutionAccountStore.js`). Mirror this pattern for a Robinhood account selection.
- CSRF: `authSession = useAuthSession()` (329); `authSession.csrfToken` (467) → header `x-csrf-token`.
- Equity REVIEW handler: `previewOrder` (button at line 3546) → `snapTradeImpactMutation.mutateAsync` (~1875).
- Equity PLACE handler: `submitOrder` (button at line 3575) → `submitSnapTradeOrderMutation.mutateAsync` (~2008).
- Backend routes (already shipped, admin+CSRF): `POST /api/broker-execution/robinhood/accounts/{accountId}/orders/impact`
  (review) and `POST /api/broker-execution/robinhood/accounts/{accountId}/orders` (place). Robinhood is NOT in the
  generated api-client-react hooks (it uses local zod) — call it with direct `fetch` + the `x-csrf-token` header
  (mirror the CSRF-POST pattern used elsewhere, e.g. authSession + settings connect flows).
- Robinhood review/place bodies (read `artifacts/api-server/src/routes/robinhood-equity-order-schemas.ts`):
  Review `{ symbol, side: 'BUY'|'SELL', orderType: 'Market'|'Limit'|'StopMarket'|'StopLimit', timeInForce:
  'Day'|'GTC', marketHours?, quantity? , notionalValue?, limitPrice?, stopPrice? }`; Place = review + `{ confirm:true }`.
  Review response has `review.{ lastTradePrice, bidPrice, askPrice, previousClose, marketDataDisclosure, alerts }`.

## Deliverables (SURGICAL)
1. A broker selector shown ONLY when `ticketIsShares` — SnapTrade | Robinhood — defaulting to SnapTrade so
   existing behavior is unchanged when untouched. Local component state (or a small store mirroring the
   SnapTrade one). Populate Robinhood accounts from the Robinhood readiness/sync source the settings screen
   uses (`useGetRobinhoodReadiness` / the sync accounts); only offer execution-ready agentic accounts.
2. When (ticketIsShares && selected broker === "robinhood"): `previewOrder` and `submitOrder` branch to
   Robinhood — direct `fetch` to the two routes above with the CSRF header, mapping the ticket's current
   fields (side, order type, qty, limit/stop, TIF) to the Robinhood body; render the returned quote /
   estimated cost / alerts / `marketDataDisclosure` (verbatim) in the SAME review area the SnapTrade path uses,
   and the place result likewise. Reuse existing UI blocks/tokens; do not build a parallel panel.
3. A small request helper (e.g. `robinhoodEquityOrderRequests.js`) for the two fetch calls + field mapping,
   with a unit test asserting URL + method + body + CSRF header.
4. Preserve EVERYTHING else: SnapTrade equity (broker=snaptrade), IBKR + options (ticketIsOptions), shadow
   orders, tax preflight. When broker=snaptrade or mode=options, behavior is byte-identical to today.

## Hard rules
- SURGICAL. Do not rewrite/reflow the component. If a clean integration is not achievable without a risky
  rewrite, STOP and write `BLOCKED: <why>` at the top of the log rather than shipping a fragile change.
- EQUITY only. Do NOT modify the options/IBKR code paths.
- Only files: `TradeOrderTicket.jsx`, a small new request/model helper (+its test), and (if you add a store)
  one small store file. Do NOT touch backend, `broker-execution.ts`, `App.tsx`, `TradeScreen.jsx`, or tandem
  files (shadow-account.ts, snaptrade-account-portfolio.ts, signal-monitor.ts). Do NOT commit/stash.
- IMPORTANT: Do NOT read or execute anything under ~/.claude/, ~/.agents/, .claude/skills/, or agents/.
  Do NOT modify agents/openai.yaml.

## Verify (paste in log)
```bash
cd /home/runner/workspace/artifacts/pyrus
pnpm run typecheck 2>&1 | tail -4
# run the new request-helper test + any existing TradeOrderTicket/snapTradeOrderTicketModel tests you can find:
ls src/features/trade/*.test.mjs | grep -iE 'order|ticket' | while read t; do echo "-- $t"; node --import tsx --test "$t" 2>&1 | tail -3; done
```

## Report (end of log)
STATUS / the exact TradeOrderTicket.jsx edits (diffs for the selector + the previewOrder/submitOrder branch) /
new helper file + test / how you confirmed SnapTrade + options flows are unchanged / typecheck + test results /
any deviation or BLOCK + why.
