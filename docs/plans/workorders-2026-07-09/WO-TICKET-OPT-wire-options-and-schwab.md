# WO-TICKET-OPT — Wire options ordering (+ Schwab equity) into TradeOrderTicket

Owner: codex worker (gpt-5.6-sol, xhigh, full access). Dispatcher: Claude session f19220d5.
Discipline: ponytail (full) — SURGICAL edits to the mature `TradeOrderTicket.jsx`; mirror the just-landed
Robinhood-EQUITY integration (commit 25dff33f). Log: `.codex-watch/wo-ticket-opt.log`. Do NOT commit.

## Context — the pattern already exists
Commit 25dff33f added Robinhood as a selectable EQUITY broker: `const [equityBroker, setEquityBroker] =
useState("snaptrade")`; `liveBrokerRoute = ticketIsShares ? equityBroker : "ibkr"`; when
`equityBroker === "robinhood"`, `previewOrder`/`submitOrder` branch to direct fetch of the Robinhood order
routes via `robinhoodEquityOrderRequests.js` (+ CSRF from `authSession.csrfToken`). STUDY that diff first —
you are replicating its shape for (1) Schwab equity and (2) options.

## Deliverable 1 — Schwab as a 3rd EQUITY broker
Add `"schwab"` to the `equityBroker` selector. When selected, source Schwab accounts the same way the settings
screen does (`useGetSchwabReadiness` / the schwab sync accounts; execution-ready only) and branch
`previewOrder`/`submitOrder` to the Schwab equity routes (`POST /api/broker-execution/schwab/accounts/{id}/orders/preview`
and `.../orders`) via a small direct-fetch helper (mirror `robinhoodEquityOrderRequests.js`) + CSRF. Schwab is
not currently connected, so the account list may be empty — show it as "(not ready)" like other unready
accounts; do not special-case.

## Deliverable 2 — Options broker selector (the main ask)
Today `liveBrokerRoute = ... : "ibkr"` for options (the IBKR/TWS path). Add an OPTIONS broker selector shown
only when `ticketIsOptions`, defaulting to `"ibkr"` so the existing IBKR options flow (bracket orders, greeks,
payoff, `usePreviewOrder`/`usePlaceOrder`/`useSubmitOrders`) is BYTE-IDENTICAL when untouched. Options:
`IBKR | SnapTrade | Robinhood | Schwab`. When a non-IBKR broker is selected, branch the option
review/submit to that broker's option lane via direct fetch (all option routes use local zod → plain fetch +
`x-csrf-token`), mapping the ticket's selected option contract (underlying/chainSymbol, expiration, strike,
right→Call/Put) + side + order type + qty + limit to the broker body. Read the bodies from:
- `artifacts/api-server/src/routes/robinhood-option-order-schemas.ts` (Review: chainSymbol, underlyingType?,
  expiration, strike, optionType, side, positionEffect (Open/Close), orderType, timeInForce, quantity, limitPrice?)
- `artifacts/api-server/src/routes/snaptrade-option-order-schemas.ts` (impact: underlyingSymbol, expiration,
  strike, optionType, action, orderType, timeInForce, units, price?)
- `artifacts/api-server/src/routes/schwab-option-order-schemas.ts` (preview: underlyingSymbol, expiration,
  strike, optionType, instruction, orderType, duration, session, quantity, limitPrice?)
Render the returned review (cost/alerts/disclosure) + place result in the SAME review area, reusing existing
blocks. Put the option fetch/mapping in a helper (e.g. `brokerOptionOrderRequests.js`) with a unit test.

## Hard rules
- SURGICAL + additive. Preserve every existing flow byte-for-byte when the default broker (snaptrade equity /
  ibkr options) is selected: SnapTrade equity, IBKR equity+options, shadow, tax preflight, greeks, payoff.
- If the ticket's option-contract model makes a clean, non-fragile options integration infeasible, STOP and
  write `BLOCKED: <why>` at the top of the log rather than shipping a risky change. Partial is OK: if only some
  brokers' options map cleanly, do those and note the rest.
- Only files: `TradeOrderTicket.jsx`, small new request/helper file(s) (+tests). Do NOT touch backend,
  `broker-execution.ts`, `App.tsx`, `TradeScreen.jsx`, `SnapTradeConnectPanel.jsx`, or tandem files. No commit.
- IMPORTANT: do not read/execute under ~/.claude/, ~/.agents/, .claude/skills/, agents/; do not modify
  agents/openai.yaml.

## Verify (paste in log)
```bash
cd /home/runner/workspace/artifacts/pyrus
pnpm run typecheck 2>&1 | tail -4
for t in $(ls src/features/trade/*.test.mjs | grep -iE 'order|ticket'); do echo "-- $t"; node --import tsx --test "$t" 2>&1 | grep -E 'ℹ (tests|pass|fail)'; done
```
All existing ticket/order tests (incl. `TradeOrderTicket.shadowBrokerGate.test.mjs`) MUST still pass.

## Report (end of log)
STATUS / exact TradeOrderTicket.jsx edits (selector + branch diffs) / new helper(s)+tests / how you confirmed
IBKR-options + SnapTrade-equity flows are unchanged / typecheck + all ticket test results / any BLOCK/partial.
