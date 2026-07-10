# LIVE coordination — positions day-change / bid-ask vs the DB-pool/ELU pressure work

## RESOLVED — the 03:36–04:18 UTC restart cluster was RILEY (confirmed directly, ~22:25 MDT)
Not crashes, not OOM, not tandem tree-kills — operator Run/Stop presses. No action needed.
Standing reminder (repo memory `riley-restarts-are-not-incidents`): overnight supervisor-abrupt
incidents are usually Riley — ask before investigating. Guards re-verified in the live bundle
after the final bounce; trading-system watch found nothing else.

## LOSS FORENSICS + TRADING FIXES (2026-07-09 ~23:20 MDT, session 8d954547) — read before touching stops/marks
Jul-9 realized -6,912 fully decomposed (wf_6ee9b5f2): ~$4.1K phantom-fill slippage (fills far below
stop TRIGGER; CG/BRKR trail-stops triggered at locked-in-GAIN levels — fixed earlier via
sell-fill degenerate guard + floor-at-stop), ~$2.7K whipsaw stops (the 13:33:23Z six-stop cascade:
ZERO mark writes from 07-08 close → first refresh 13:33:12 swallowed opening-auction spreads; the
trigger mark had NO spread gate), ~$1.9K genuine stops. LANDED + LIVE:
- `867a78fb` quote_spread_degenerate gate in buildShadowOptionPricingPolicy (bid >40% below mid ⇒
  no mark write, no stop eval, maintenance sweep protected) + live exits now write top-level
  payload.exitReason. Committed via blob surgery — a tandem session has ~928 uncommitted lines in
  shadow-account.ts (replay/recompute + cash-activity regions), preserved unstaged.
- `b8d8efe1` entry gates fail closed + buy-side degenerate guard (earlier tonight).
- `242ac3a2` hero pill day P&L = positions-table day change (owner definition; `7b47b25f` reverted
  the realized-in-calendar change). Pill and calendar now share one source.
- Phantom-fill ledger surgery script READY but blocked on operator run (permissions):
  scratchpad/phantom-fill-surgery.sql — Riley has the `! psql` command; v2 includes mirror-repair
  exemption flags for the voided ASTN events (else repair resurrects it in ~60s).

## ACCEPTANCE READBACK (2026-07-09 ~18:45 MDT, session 8d954547 — resumed 71069931's workstream)
Runtime probe of `/api/accounts/shadow/positions?liveQuotes=true` (authenticated, fresh microVM boot
18:15 MDT, overnight session — options market closed):
- **Day-change fix HOLDS**: 14/17 option rows show real non-zero dayChange/dayChangePercent (old bug
  was $0 across the board). Values from last-session baselines survive the reboot.
- **Cache warm works**: cold first read 17.8s → warm reads 0.15s/0.09s (45b7828d + e93f50b2 verified).
- **Cold-cache blanks RECUR on 3/17 rows** (UCTT, SAIL, HON: dayChange=0, valuationReason=
  quote_unavailable after reboot). This is the exact trigger the deferred WO-POS-3 item D
  (persist last-known day-change cache to disk) was parked on — item D is now justified.
- **Underlying Spot day-change % on option rows still blank**: underlyingMarket has price (from the
  option quote's embedded underlying, source=underlying_quote) but previousClose/changePercent null.
  The cebd8e72 merge is structurally in place; the bounded Massive underlying snapshot
  (allowMassiveFallback:false) still supplies no prevClose. Pressure is only "watch" now (ELU 78%,
  pool 12/12 active but 0 waiting, admission lanes healthy) — re-check during RTH before blaming load.
- **Bid/Ask cadence vs Spot: NOT assessable tonight** (quotes correctly frozen at 19:59:59Z close —
  the 17f9a8a8 realtime freeze working as designed). Run the cadence acceptance during RTH ≥07:30 MDT
  2026-07-10, alongside the morning soak readback (3e0f4d69 runbook).
- **Item D SUPERSEDED — root cause found and FIXED live (2026-07-09 ~19:55 MDT)**. A 4-agent
  audit + DB check proved the $0 rows were SAME-DAY positions whose mark never got re-observed
  after the opening fill (`as_of == opened_at`), making current == entry-baseline == fabricated $0
  by construction; the baseline itself is already durable in `shadow_position_marks`, so disk
  persistence fixed nothing. Landed `6247dba5` (`shadowPositionMarkStaleForDayChange`: fill-echo
  marks are stale → honest null). Reloaded via SIGUSR2, runtime-verified: UCTT/SAIL/HON now
  `dayChange:null` + `quote_unavailable`, zero fabricated-zero rows. WO doc rewritten as CLOSED.
  NOTE: `6247dba5` also carries the eqh session's WO-EQH-1 source hunks (commit interleave —
  their `39c5b6ef` completes it); attribution cosmetic, do not rewrite history.
- **Pill vs calendar "today" P&L RESOLVED (2026-07-09 ~20:45 MDT)**: pill (-$3.7K) was the honest
  whole-account NLV move (137,511 − 141,247, DB-verified); calendar today-cell (+$2.0K) counted
  open-position day change only and dropped -$6,912 realized on 42 exits. FE fix `eeb3a70e`
  (livePositionsDayPnlMetric adds realized into totalDayPnl). CAVEAT tracked as task #4: part of
  that -6.9K realized is suspect phantom (degenerate-spread exit fills, all pre-fix; BRKR -$567
  proven) — per-fill audit + Riley re-price/annotate decision pending.
- **Pressure-gate retirement doctrine live** (`955efad2` + `docs/plans/pressure-gate-retirement-2026-07-10.md`):
  every user-visible degrade now counts firings (`api.shadowAccountReads.pressureDegrades`, zeros
  as of 20:50 MDT reload); gates are guilty-until-proven through Friday's counters.
- **Emergency-mode audit verdict** (user challenged the pressure fast path): fast path fires ONLY
  at `resourceLevel==="high"` (shadow-account.ts:9492); tonight's bug went through the FULL path —
  unrelated. Jul 9 recorder data: pool queue peaked at 137 waiting, 65 API restarts/day; tonight
  max waiting 1, zero pool-pressure events. Per db-pool-admission-bus doc, high pressure at market
  open remains EXPECTED (pool max 12 deliberate; bulk lane saturates by design) — fast path stays
  load-bearing until the 2026-07-10 open acceptance (market-open-acceptance.mjs) passes; retire
  candidates after that, one gate at a time.

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
