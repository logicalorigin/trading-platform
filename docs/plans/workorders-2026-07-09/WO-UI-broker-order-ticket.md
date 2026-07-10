# WO-UI — Broker order ticket (frontend, connected brokers, equity MVP)

Owner: codex worker (gpt-5.6-sol, xhigh, full access). Dispatcher: Claude session f19220d5.
Discipline: ponytail (full) — match the existing pyrus trade-feature conventions; no speculative machinery.
Log: `.codex-watch/wo-ui.log`. Do NOT commit; dispatcher reviews + lands.

## Goal
Make the broker equity order lanes usable from the app. Today `features/trade/tradeBrokerRequests.js`
only reads `/api/executions`. Add order request functions + a self-contained order-ticket panel that lets a
user review then place an equity order on a connected broker account, see recent orders, and cancel one.
Scope MVP to EQUITY on the connected brokers: Robinhood + SnapTrade. (Schwab/options are follow-ups.)

## Backend contract (already shipped; do NOT change the backend)
Routes (prefix `/api`): for provider in {robinhood, snaptrade}:
- Review/impact: `POST /api/broker-execution/{provider}/accounts/{accountId}/orders/impact`
- Place: `POST /api/broker-execution/{provider}/accounts/{accountId}/orders`
- Recent: `GET  /api/broker-execution/{provider}/accounts/{accountId}/orders/recent`
- Cancel: `POST /api/broker-execution/{provider}/accounts/{accountId}/orders/cancel`
Request/response field names: read the local zod in
`artifacts/api-server/src/routes/robinhood-equity-order-schemas.ts` and the generated SnapTrade schemas used
in `artifacts/api-server/src/routes/broker-execution.ts` (Review/Place bodies differ slightly per provider —
Robinhood: {symbol, side, orderType, timeInForce, marketHours?, quantity|notionalValue, limitPrice?,
stopPrice?}; SnapTrade impact needs {action, universalSymbolId, orderType, timeInForce, units|notionalValue,
price?, stop?} — surface a provider-appropriate form). Impact/place are **admin + CSRF** gated; recent is
`broker_connect`; cancel is `broker_connect` + CSRF. So the ticket works for authorized users; enforce nothing
client-side beyond sending credentials + CSRF.

## Research first
- CSRF + credentialed POST pattern: read `artifacts/pyrus/src/screens/settings/robinhoodConnectModel.js` and
  `schwabConnectModel.js` (they POST to CSRF-gated connect endpoints). Reuse the exact CSRF token acquisition
  + header + `credentials` the app already uses. Do NOT invent a new auth mechanism.
- UI conventions: match `features/trade/` components (`TradePositionsPanel.jsx`, `TradeL2Panel.jsx`) and
  `lib/uiTokens` (CSS_COLOR, T). Reuse the account list source the Account/Trade screens already use to
  populate the broker-account selector (find it; do not hardcode account ids).

## Deliverables
1. `artifacts/pyrus/src/features/trade/brokerOrderRequests.js` (new): CSRF-aware helpers +
   `reviewBrokerEquityOrder({provider, accountId, input})`, `placeBrokerEquityOrder(...)`,
   `listBrokerRecentOrders({provider, accountId})`, `cancelBrokerOrder({provider, accountId, orderId})`.
2. `artifacts/pyrus/src/features/trade/BrokerOrderTicket.jsx` (new): broker-account selector, symbol + order
   fields, **Review** (shows quote / estimated cost / alerts / disclosure verbatim), **Place** (disabled
   until a successful review; confirm step), and a recent-orders list with per-row Cancel. Loading/error
   states. Match app styling.
3. Mount it with the SMALLEST possible additive edit into `artifacts/pyrus/src/screens/TradeScreen.jsx`
   (one import + one rendered panel/tab). Keep the edit surgical — another agent may be editing this screen.
4. `artifacts/pyrus/src/features/trade/brokerOrderRequests.test.mjs`: mock `fetch`; assert each function hits
   the correct URL + method + body + CSRF header for both providers.

## Verification (paste in log)
```bash
cd /home/runner/workspace/artifacts/pyrus
pnpm run typecheck 2>&1 | tail -4
node --import tsx --test src/features/trade/brokerOrderRequests.test.mjs 2>&1 | tail -6   # or the repo's .mjs test runner
```
(If the app is running, a screenshot is a bonus but not required.)

## Constraints
- Frontend only. Do NOT touch any `artifacts/api-server` file, `broker-execution.ts`, or backend contracts.
- Do NOT touch tandem-owned frontend files beyond the single surgical TradeScreen mount (AccountScreen.jsx,
  App.tsx, PlatformShell.jsx, BootShellLayout.tsx, LoginGate.jsx are off-limits). Do NOT commit.
- IMPORTANT: Do NOT read or execute any files under `~/.claude/`, `~/.agents/`, `.claude/skills/`, or
  `agents/`. Do NOT modify `agents/openai.yaml`.

## Report (end of log)
STATUS / files created + the exact TradeScreen mount edit / CSRF source used / typecheck + test output /
any deviation + why.
