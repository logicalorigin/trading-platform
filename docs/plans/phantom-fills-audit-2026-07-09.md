# Phantom exit-fill audit — 2026-07-09 realized P&L

> **EXECUTED 2026-07-09 ~23:40 MDT (Riley-ordered).** Both surgery transactions committed.
> Acceptance: Jul-9 realized −6,912.27 → **−3,586.91** (40 fills); latest NLV 137,511 →
> **140,840**; account cash **117,452.46**; fills-fold vs account-row diff **0.00**; ASTN
> fully voided (0 fills, 0 positions) and still absent after a mirror-repair cycle (the
> backfill-flag exemption held). Rollback path: `_phantom_backup_*_20260709` tables in the
> DB (drop after a clean RTH session).

Audit of the -$6,912 realized P&L booked on 2026-07-09 (42 fills, 17 realizing sells), all
executed BEFORE the degenerate-spread sell fix + stop-floor ruling went live (`c3c5eaab`,
~18:19 MDT). Method: per-fill reconstruction of the quote mid at exit from `shadow_position_marks`
history (pre-exit mark, age-flagged), the one directly captured quote (BRKR, algo-design live
note), and the entry event payloads in `execution_events`.

## Verdict: ≈ $3,270 of the -$6,912 is phantom (range $3,060–$3,590)

| Fill | Booked | Phantom | Evidence |
|------|--------|---------|----------|
| ASTN 14:32 (5x $5C) | -$1,263 | ~$1,200–1,263 | INVALID ENTRY: quote at entry was bid $0 / ask $2.80, **62 min stale**, volume 9 / OI 11; filled $2.57, hard-stopped 18 SECONDS later at $0.05. Should never have opened (see gate bypass below) |
| BRKR 13:33 (4x) | -$567 | $674 | Exact quote captured: bid 2.05 / ask 5.80 / mid 3.925 (gap 0.478 > 0.4) → fixed rule fills at mid 3.925 vs actual 2.24 |
| ZETA 13:33 (10x) | -$707 | ~$610 | Implied gap 0.71 (mid_est 0.95 from 33-min-old mark vs fill 0.34) — understated if true mid higher |
| KTOS 13:55 (9x) | -$996 | ~$414 | Implied gap 0.51 (mid_est 1.00 vs fill 0.54) |
| MULL 13:43 (3x) | -$1,079 | ~$366 | Implied gap 0.66 (mid_est 2.05 vs fill 0.83) |

**Real losses (fresh marks < 1 min, implied gaps ≤ 0.22 — NOT phantom):** CVNA -557, CRCL -453,
IP -418, CG -411, RKLB -411, NBIS -399, AMBQ -532, CAI -309, RGTI -177. Wins (real): TSLA +322,
TSLA +343, ABSI +343, LABU +357.

## Corrected 2026-07-09 numbers

- Realized: booked **-$6,912** → corrected ≈ **-$3,640**
- Whole-account day P&L: pill showed **-$3,736** → corrected ≈ **-$470** (roughly flat day)
- Open-position day change (+$2.0K) unaffected.
- KPI contamination: Max drawdown -23.6% / Current DD / expectancy / win rate include the phantoms.
  Jul 8 realized was only -$227, so contamination is concentrated in Jul 9.

## NEW ROOT CAUSE FOUND: entry liquidity gates fail OPEN on degenerate quotes

The profile's gates were configured strictly (`minBid: 0.5, maxSpreadPctOfMid: 15,
requireBidAsk: true, requireFreshQuote: true`) yet ASTN's entry recorded
`liquidity: {ok: true, reasons: [], bid: 0, spread: null, spreadPctOfMid: null,
fillQuoteSource: "mark"}`. Mechanism (signal-options-automation.ts ~4750–4790):

- bid 0 is treated as "no bid" → `bid != null` guard skips `bid_below_minimum`.
- No usable bid → `spread`/`spreadPctOfMid` are null → `spread_too_wide` skips.
- `requireBidAsk` only binds for delayed two-sided quotes; freshness "mark" bypasses it,
  and a 62-minute-old quote still passed the freshness requirement via the mark path.

Gates that cannot evaluate their input currently PASS. They must FAIL CLOSED: an entry
whose quote can't prove liquidity is exactly the entry the gate exists to block.

## Surgery verification (2026-07-09 ~21:45 MDT, pre-execution — wf_61de3b9f + direct SQL)

- **Shadow-scoped, verified row-by-row**: all 6 fills, the ASTN position/orders, the 4 position
  matches, and all 10,342 affected snapshots are `account_id='shadow'`; script also carries
  explicit shadow filters on every UPDATE.
- **No double-counting**: UI cash/realized fold from `shadow_fills` on every read
  (`buildShadowTotalsFromLedger`); the account row feeds ONLY Cash Activity — both must be
  patched, with deltas equal to the cent (fold +2062 & ASTN reversal +1266.72 = row +3328.72 ✓).
- **Snapshot tolerance filter** (`filterShadowEquityHistoryRowsToLiveLedger`, 0.05 tol) drops
  chart points that disagree with the fills-fold — the per-timestamp snapshot deltas match the
  patched fold cursor by construction, so points stay valid.
- **Resurrection risk found and neutralized (v2 appendix)**: mirror-repair re-creates ledger
  records for any entry/exit event lacking a `shadow_orders.source_event_id` mirror (~60s TTL).
  The ASTN events are flagged `payload.backfill.source` (the designed repair exemption) +
  `voided` annotation; without this the deleted trade would re-book itself within a minute.
- **Daily-loss halt reads exit-event payload pnl** — v2 patches the 6 exit events (incl. KTOS/
  MULL duplicates) to corrected pnl/exitPrice; ASTN's zeroed.
- Precision note: BRKR's corrected price is from its exactly-captured quote; ZETA/KTOS/MULL mids
  come from 10–33-min-old marks (conservative estimates under that morning's pressure).

## Recommendations

1. **Ledger (Riley decision)** — options:
   - (A, recommended) Leave history; this doc + the live note are the annotation. Shadow ledger is
     a simulation; sell-side fix + stop floor are already live; rewriting fills means also patching
     cash deltas, recompute, and 10k+ balance snapshots for the equity curve to agree.
   - (B) Scripted re-price of the 5 fills (+`recomputeShadowAccountFromLedger`) — fixes totals/KPIs,
     leaves the historical equity curve/calendar past-cells slightly inconsistent.
   - (C) Full rewrite incl. snapshot history — heavy, not worth it for paper fills.
2. **Fix-forward (next session, WO-ENTRY-GATE)**: make liquidity gates fail closed
   (bid ≤ 0 ⇒ `bid_below_minimum` when gate enabled; unevaluable spread with requireBidAsk ⇒
   reject; stale-quote age cap regardless of source tag). NOT hot-fixed tonight: it changes live
   entry behavior hours before the open and needs fixture coverage so it can't block ALL entries
   (`signal-options-automation.ts` also carried tandem WIP tonight).
3. Re-read drawdown/expectancy KPIs after the ledger decision.
