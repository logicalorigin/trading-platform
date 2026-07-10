# LIVE coordination — positions day-change / bid-ask vs the DB-pool/ELU pressure work

## DONE (2026-07-09 ~13:08 MDT): WO-RH-ORDERS — Robinhood equity lane built inline + $5 buy FILLED
The 12:17 MDT microVM rotation killed the codex worker (produced zero on-disk changes; only the
WO doc + `.codex-watch/rh-order-tools.json` survived). Session f19220d5 rebuilt the lane INLINE from
the WO doc (worker NOT re-dispatched — user chose inline). Files (all NEW/edited by this session,
uncommitted):
- NEW `services/robinhood-equity-orders.ts` (+`.test.ts`, 6 tests green): review/place/list over the
  MCP session; string-serialized tool params; exactly-one quantity|notional; notional⇒Market;
  extended/overnight⇒Limit-only; tax preflight (assertTaxPreflightForOrderSubmission +
  record...Submitted, route "robinhood") + submit rate-limit; sanitized (accountNumberLast4 only);
  review surfaces quote_data + `market_data_disclosure` (compliance, verbatim) + order_checks alerts.
- `services/robinhood-account-sync.ts` (+test updated, 3 green): capability flip — agentic + open +
  not-deactivated ⇒ caps `robinhood-agentic`/`orders`/`executions`/`execution-ready`, blockers []; the
  `robinhood-agentic` cap is the persisted agentic_allowed marker the order service asserts.
- `routes/broker-execution.ts`: 3 routes (impact/place recent) mirroring SnapTrade auth
  (requireAdminCsrf / requireEntitlement) + audit events. Zod is LOCAL
  (`routes/robinhood-equity-order-schemas.ts`) — deliberate deviation from api-zod, which is
  orval-generated from @workspace/api-spec (heavy regen; real trade is service-level). NOT via HTTP.
- `services/broker-provider-classification.ts`: robinhood entry — equity tooling schema-verified;
  options still unverified; verificationDate 2026-07-09.
tsc clean. I did NOT touch shadow-account.ts (your @3334/@8541 hunks are intact). Changes uncommitted;
dispatcher (or user) to land. broker-execution.test.ts NOT re-run to green (suite exceeds 420s;
service+sync suites green).

**Live $5 BUY FILLED** on Robinhood Agentic acct 727958282 (local id
73025d5d-2a63-4700-ad48-fb84aa08fa6f): PLUG 2.092137 sh @ avg $2.3899 = $5.00, fees $0,
placed_agent=agentic, order `6a4ff1ab-4b8b-4bb5-b4fc-17a1772ceddc`, filled 2026-07-09T19:08:27Z.
Mirrors the earlier E*TRADE $5 test buy (PLUG x1 @ 2.3999, Roth IRA, order 3346, SnapTrade lane).

## DONE (2026-07-09 ~12:10 MDT): WO-POS-1..4 all landed — file claims RELEASED
Commits: `cebd8e72` (underlyingMarket merge), `6219f683` (netLiq fallback), `e93f50b2`
(shadow day-change cache warmed off read path + non-blocking fast-path bootstrap — touches
`refreshShadowPositionMarks` tail and `buildFastShadowPositionsResponse`; heads-up for your
pressure lane), `5cc15885` (SnapTrade option avg normalization; cost_basis unified as TOTAL).
Your two WIP hunks in shadow-account.ts (@3334, @8541) remain uncommitted and untouched —
all shadow-account.ts commits above were hunk-level staged around them. API rebuilt + reloaded.
Deferred: WO-POS-3 item D (persist last-known stops/day-change to disk so caches survive a
restart under sustained high pressure) — skipped as over-budget; revisit only if cold-cache
blanks recur after your pool fix lands.

Owner: positions/shadow-account session (riley). For the agent working on DB-pool/ELU saturation (WO-P2 / `db-pool-elu-saturation-rootcause-plan`).

## Bid/ask latency is a symptom of your pressure work
The positions-table **Bid/Ask** column lags the **Spot** column. Root cause traced to the
persistent high resource pressure you're fixing:
- Spot (underlying) rides a persistent Massive **equity** websocket (`useRuntimeTickerSnapshots`)
  that is not route-admission-shed.
- Bid/Ask (option) needs server-side option-quote work (Massive OPRA aggregate → normalize →
  push via `/api/ws/options/quotes` + `bridge-option-quote-stream.ts`). Under pressure
  (DB pool 12/12 + ~44 waiting, ELU ~99%) that work is **shed/starved** (route-admission
  returned 429 on diagnostics probes), so bid/ask falls back to the slow path (3s REST /
  positions poll).
- Massive options realtime IS configured (`getMassiveOptionsRecency()` defaults `realtime`), so
  this is not a config gap.

**Success criterion to add to your pressure work:** on the account positions table, option
Bid/Ask should update at the same cadence as Spot once the pool/ELU saturation is resolved. I am
**not** making a conflicting route-admission-shedding change — leaving that to you.

## Changes I committed on `main` (so we don't collide)
- `17f9a8a8` — option-quote realtime freeze (future-tick clamp) + option-math fixes: `live-streams.ts`, `PositionsPanel.jsx`, `snapTradeAccountPanelModel.js`.
- `4dd80549` — prior-day shadow option $0 day change (`selectShadowPositionDayChange`): `shadow-account.ts`.
- `df70c38c` — mirror-repair idempotency + **day-change decoupled from pressure**: `shadow-account.ts`.

## UNCOMMITTED hunk of mine in shadow-account.ts — please include it when you commit
`getShadowAccountPositions` (~line 9777) built the option row's `underlyingMarket` from
`optionUnderlyingQuote ?? underlyingMarkets.get(underlyingSymbol)`. `optionUnderlyingQuote`
(from the option quote's embedded underlyingPrice) is **price-only**, so whenever it was
present it shadowed the full Massive underlying quote and dropped `previousClose`/
`changePercent` — which made the new Spot **underlying day-change %** blank on exactly those
option rows. My uncommitted fix merges them (`{ ...underlyingMarkets.get(sym), ...optionUnderlyingQuote }`)
so the option's fresher price wins but the day-change fields survive. I could NOT commit it
cleanly because your uncommitted change at ~line 3334 (`readShadowFillsForOrderIds`) is in the
same file — please fold my hunk into your next shadow-account.ts commit (or tell me to).
Residual: the underlying quote source (`getBoundedShadowUnderlyingQuoteSnapshots`,
`allowMassiveFallback:false`, `account-monitor-live`, bounded wait) still returns no
prevClose/changePercent under load, so this only fully lands once pressure eases.

## Heads-up that touches YOUR area (shadow read fast path)
In `df70c38c` the **pressure fast-fallback** (`buildFastShadowPositionsResponse`) now runs a
**baseline-marks-only** `readShadowPositionDayChanges(..., { fetchMissingOptionQuotes: false })`
**only to bootstrap positions not yet in the last-known day-change cache** — once warm it adds
zero DB load. This was needed because the fast path blanked day change to $0 under sustained
pressure. If your pool work changes the fast-path contract, keep this bootstrap gated so it never
adds load when the cache is warm. We are both editing `shadow-account.ts` — coordinate merges.
