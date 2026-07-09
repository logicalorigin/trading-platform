# STA row → position "shadow link" trace (2026-07-07)

Read-only investigation. Every claim is tagged **[observed]** (from source / DB / command
output) or **[inferred]** (reasoning over observed facts). Re-verification commands are in the
last section. Nothing was edited.

Symptom under investigation: rows in the STA / operations table don't show the position they
created — the sync column (`resolveCandidateSyncDisplay`) reads `candidate.shadowLink` +
`candidate.syncStatus` and shows "shadow link pending" instead of "Synced".

---

## TL;DR (root cause)

**[observed]** `candidate.shadowLink` is **not stored** on the candidate at entry time. It is
**re-derived on every read** by `buildSignalOptionsShadowIndex`
(`artifacts/api-server/src/services/signal-options-automation.ts:7863`), which JOINs the durable
tables `shadow_orders` / `shadow_fills` / `shadow_positions` back onto the deployment's execution
events. The join keys are fully persisted (see §1), so **the link is never "lost" at the storage
layer, and it is NOT lost by an API restart per se.**

**[observed]** The one thing that *is* window-bounded is which `shadow_orders` rows that read-time
join bothers to LOAD. It loads orders whose `source_event_id` is inside the **most-recent 2,500
`signal_options_%` events** (`SIGNAL_OPTIONS_STATE_EVENT_LIMIT = 2_500`,
`signal-options-automation.ts:305`, loaded at `:11766` via `listDeploymentEvents` `:2189`), **plus**
a symbol-scoped fallback for **currently-open** shadow positions (`:7918`–`:7946`).

**[inferred]** Therefore the "missing link" is structural and appears for a signal row whose entry
order has scrolled out of the 2,500-event window **and** whose position is **closed** (so the
open-position fallback does not rescue it). With **~27,148 `signal_options_%` events emitted today**
on this deployment (**[observed]**, §3), the 2,500-event window covers only a few hours of activity,
so intraday-closed trades age out of the link (and out of the live candidate list) quickly.

**[observed]** For the three symbols named in the ticket, the picture is *not* what the ticket
assumed:
- **DELL** and **LUNR** both have **OPEN** positions right now, both entry events are still inside
  the window, and both are additionally covered by the open-position fallback → they are linkable
  and should show "Synced". They are the robust case.
- **AXTI never entered.** It has **zero** `shadow_orders`, `shadow_fills`, `shadow_positions`. Its
  only events today are `signal_options_candidate_created` then `signal_options_candidate_skipped`
  (`reason = mtf_not_aligned`). Its row correctly has no link because there is no position.
- **Correction to ticket context:** there is no `signal_options_entry_submitted` event type in the
  codebase (grep returns nothing). Entries are `signal_options_shadow_entry`. The "AXTI entered at
  19:21Z" premise is not supported by the DB.

**[inferred]** Restart is an **accelerant / trigger of visibility**, not the root cause: it clears
the in-memory dashboard snapshot cache and forces a cold rebuild. The cold rebuild re-derives links
from the DB over the same 2,500-event window. Open positions survive it; already-aged-out closed
trades were already unlinkable before the restart too. There is **no in-memory-only authoritative
copy** of the link: every `shadowLink` value originates from `buildSignalOptionsShadowIndex`
(attached at `:11819`–`:11842`) and is thereafter only *carried* through merges/caches
(`:11961`, `:11967`) — verified by `rg -n shadowLink` over the file (no other minting site).

---

## 1. Where is the link authored? (in-memory vs persisted)

**Authored durably at entry time — NOT as a candidate field.** The entry writes rows into
`shadow_orders` / `shadow_fills` (`shadow-account.ts:4544`, `:4571`) inside one transaction, storing:

- `source_event_id` = the `signal_options_shadow_entry` execution-event id
  (`shadow-account.ts:4548`, `:4575`; unique index `shadow_orders_source_event_idx`,
  `lib/db/src/schema/trading.ts:266`). **[observed]**
- `payload` = `{ candidate: { id: "SIGOPT-…" }, position: { candidateId: "SIGOPT-…" } }`
  (`shadow-account.ts:4566`). **[observed]**
- `shadow_positions.position_key` = `symbol + contract` key (loaded in full, any status, at
  `signal-options-automation.ts:7873`–`:7876`). **[observed]**

**The `shadowLink` object itself is derived, not stored.** `shadowLinkFromParts`
(`signal-options-automation.ts:7799`) builds `{ orderId, fillId, positionId, sourceEventId,
quantity, … }` from an `order` + `fill` + `position` triple. `buildSignalOptionsShadowIndex`
(`:7863`) produces two lookup maps:
- `byEventId` keyed by `shadow_orders.source_event_id` (`:7994`). **[observed]**
- `byCandidateId` keyed by `order.payload.candidate.id` ?? `order.payload.position.candidateId`
  (`:7980`–`:7999`). **[observed]**

The candidate id is a **deterministic** string, `buildCandidateId` (`:2503`):
`SIGOPT-<deploymentId[:8]>-<SYMBOL>-<direction>-<epochms(signalAt)>` (`:2509`–`:2515`). Because it is
a pure function of `(deploymentId, symbol, direction, signalAt)`, the shell rebuilt from a live
signal on boot produces the **same** id that was frozen into the order payload at entry — *provided
the same signalAt is still surfaced*. **[observed code] / [inferred behavior]**

**Attachment to the row** happens at read time in `buildStatePayload` (`:11816`–`:11853`):
`shadowLink = shadowIndex.byCandidateId.get(candidate.id) ?? (events for candidate)→byEventId ?? null`
(`:11819`–`:11824`). The `/state` and `/cockpit` refresh (`withFreshSignalOptionsStateSignals`,
`:12515`–`:12563`) does **not** rebuild the index; it merges fresh signal shells over the cached
`snapshot.state.candidates` by id and preserves whatever `shadowLink` the cached candidate already
had (`mergeSignalOptionsCandidate` spreads `...candidate` last so `shadowLink` is retained,
`:6534`–`:6536`; `signalOptionsCandidateToDashboardCandidate` reads `candidate.shadowLink ?? null`,
`:11967`). **[observed]**

`signal_options_seen_signals` (`lib/db/src/schema/automation.ts:182`) is a durable dedup store with
`eventId`, `symbol`, `signalKey`, `candidateMatchKey` — but it stores **no order/position id**, so it
is *not* a candidate↔position link table (only a potential row-rehydration seam). **[observed]**

## 2. What happens across an API restart? (the actual gap)

**[observed] Storage-level: nothing is lost.** Restart clears only the in-memory dashboard snapshot
cache. `shadow_orders/fills/positions` and `execution_events` are untouched; the next request
cold-rebuilds via `buildStatePayload` → `buildSignalOptionsShadowIndex`, re-deriving the link from
the DB.

The re-derivation succeeds **iff the read-time join still loads the order**:

| Case | Order load path | Row survives? | Link survives restart? |
|---|---|---|---|
| Position **open** | symbol in `openPositionSymbols` → `:7918`–`:7946` (window-independent) | yes — mark events in-window + open-position rescue `:9305`–`:9310` | **Yes (robust)** [inferred, strongly supported] |
| Position closed, entry event **in** 2,500-window | `source_event_id IN windowEventIds` `:7910`–`:7917` | yes (entry/exit events in-window) | Yes |
| Position closed, entry event **aged out** of window | neither path loads it | **no** (no in-window event, no shell, not position-bearing → not rescued `:9316`–`:9321`) | **No — permanently unlinkable** [inferred] |

**[inferred] The real gap** is the bottom row: a closed trade whose `signal_options_shadow_entry`
event is no longer among the 2,500 most-recent `signal_options_%` events. Its durable link keys still
exist in `shadow_orders` (candidate id + source_event_id) and `shadow_positions` (all statuses are
loaded), but `buildSignalOptionsShadowIndex` never LOADS that order (it filters orders by the event
window or by open symbol), so `byCandidateId`/`byEventId` never contain it — and the display list has
no row to hang it on either. Restart makes this visible immediately (cold cache) rather than at the
next natural cache expiry, which is why it *correlates* with restarts without being *caused* by them.

## 3. Live evidence (DB, read-only, 2026-07-07 ~21:18Z)

Deployment = `7e2e4e6f-749f-4e65-a011-87d3559a23b0` (prefix `7e2e4e6f` matches every candidate id).
**27,148** `signal_options_%` events today / **1,066,060** all-time → 2,500-event window ≈ a few hours.

| Symbol | Position (shadow_positions) | Entry order | source_event_id / entry event | payload candidate id | Entry event window rank | Expected sync column |
|---|---|---|---|---|---|---|
| **DELL** | **OPEN** `a9b3f7d7…`, qty 1, opened `18:52:57Z`, `option:DELL:2026-07-10:422.5:call` | `2752d97a…` filled `18:52:57Z` | `26a7e2d6-ec3a-43d7-93cd-68b2c3ca197e` (= `signal_options_shadow_entry` @ 18:52:57Z) | `SIGOPT-7e2e4e6f-DELL-buy-1783448700000` (signalAt 18:25:00Z) | **706** newer sigopt events → **in** window | **Synced** (window + open-position paths) |
| **LUNR** | **OPEN** `e650646f…`, qty 10, opened `15:30:49Z`, `option:LUNR:2026-07-10:18:call` | `e9538063…` filled `15:30:49Z` | `1230426e-42d8-40b3-8270-665e640e22c3` (= `signal_options_shadow_entry` @ 15:30:49Z) | `SIGOPT-7e2e4e6f-LUNR-buy-1783437000000` (signalAt 15:10:00Z) | **1,761** newer → in window now, **approaching** the 2,500 cut (1,253 marks emitted today) | **Synced** (open-position fallback holds even after it ages out) |
| **AXTI** | **NONE** (0 rows) | **NONE** (0 orders, 0 fills) | no `shadow_entry` event; `candidate_created` @ 19:21:16Z + `candidate_skipped` @ 19:21:18Z `reason=mtf_not_aligned` | `SIGOPT-7e2e4e6f-AXTI-sell-1783451100000` (signalAt 19:05:00Z) | n/a | **Pending / no link — CORRECT** (never entered) |

**[observed]** Historical DELL/LUNR closed trades (e.g. DELL entry `46d86d9d…` @ 2026-05-27, LUNR
entry `780e29ff…` @ 2026-06-29) report **1,036,626 / 973,952 newer events → far outside** the 2,500
window. Their `shadow_orders` rows still carry intact `payload.candidate.id` + `source_event_id`, yet
the read-time index would not load them → they are the concrete instances of the permanently
unlinkable / disappeared-row case.

**[inferred]** Would the CURRENT in-memory state carry `shadowLink` for these rows? DELL & LUNR:
**yes** (open-position order load seeds `byCandidateId`, and flowing mark events reconstruct the
candidate row with the matching deterministic id). AXTI: correctly **no** (nothing to link). Any
symbol closed earlier today and aged out: **no** — that is the bug surface.

## 4. Where the fix should go (minimal seams — ranked, no implementation)

The durable join key already exists on both sides (`shadow_orders.payload.candidate.id` +
`source_event_id`; `shadow_positions` loaded at any status). The defect is purely that the read-time
**order load** is scoped to the event-count window. Ranked by minimality:

1. **Broaden the open-position fallback to recently-closed positions** *(smallest change, reuses the
   existing pattern).* `buildSignalOptionsShadowIndex` already loads orders for open-position symbols
   window-independently (`:7918`–`:7946`); extend the same symbol/positionKey load to `shadow_positions`
   rows with `closed_at >= <session/day start>` (the table is already fully loaded at `:7873`). This
   re-seeds `byCandidateId` for intraday-closed trades so their link survives aging-out.
   *File: `signal-options-automation.ts` — the signal-options lane's territory (see §5).*

2. **Join the index by durable candidate id, not by event window** *(direct fix of the root defect).*
   After the display candidate ids are known, additionally load `shadow_orders` where
   `payload->'candidate'->>'id' IN (renderedCandidateIds)` (bounded IN-list) and index by candidate id.
   Requires threading candidate ids into the index build (currently it runs before candidates exist at
   `:11766`) or a second targeted pass. *File: `signal-options-automation.ts` (lane territory).*

3. **Rehydrate the ROW for aged-out closed trades from durable data**, then attach via #1/#2. Reconstruct
   candidate shells from recent `shadow_orders.payload.candidate` + `option_contract` (or from
   `signal_options_seen_signals` keyed by `signalKey`/`eventId`) so the operations table still shows the
   trade at all. Needed only if the product wants aged-out closed trades to remain visible (not just
   linked when present). *File: `signal-options-automation.ts` (lane territory).*

4. **Persist the link explicitly at entry** (heaviest; least minimal). Add order/position ids to
   `signal_options_seen_signals` (or a new small link table) keyed by candidate id, written on entry, and
   join by candidate id at read time. Touches the write path in `shadow-account.ts` **(currently clean)**
   and schema in `lib/db/src/schema/automation.ts` / `trading.ts` **(clean)**. Avoid unless #1–#3 prove
   insufficient — the join key is already durable, so new persistence is redundant.

**Recommended:** #1 (or #1+#2) — it fixes the observed gap with the least surface and mirrors code the
lane already trusts for open positions.

## 5. Which fixes touch the other lane's WIP vs clean files

- `artifacts/api-server/src/services/signal-options-automation.ts` — **the file that hosts fixes
  #1–#3.** It was the other lane's dirty WIP at session start; the lane is actively editing sibling
  files right now (`signal-options-worker.ts`, `artifacts/pyrus/src/screens/algo/OperationsSignalRow.jsx`
  are both `M`, plus `.codex-watch/handoff-signal-options-lane-2026-07-07.md`). **Treat as that lane's
  territory — coordinate before touching.** **[observed via git status]**
- `artifacts/pyrus/src/screens/algo/OperationsSignalRow.jsx` — STA row renderer, **currently the other
  lane's WIP (`M`)**. No fix needs it, but note the overlap.
- `artifacts/pyrus/src/screens/algo/algoHelpers.js` (`resolveCandidateSyncDisplay` `:2206`) and
  `AlgoScreen.jsx` — **clean**, pure display; no change needed (they render `shadowLink` faithfully).
- `artifacts/api-server/src/services/shadow-account.ts` — **clean**; only fix #4 (entry-time
  persistence) would touch it.
- `lib/db/src/schema/automation.ts`, `lib/db/src/schema/trading.ts` — **clean**; only fix #4 would touch
  them.

## Re-verification commands

Shadow-index / window logic (source):
```
rg -n "buildSignalOptionsShadowIndex|SIGNAL_OPTIONS_STATE_EVENT_LIMIT|openPositionSymbols|byCandidateId" \
  artifacts/api-server/src/services/signal-options-automation.ts
sed -n '7863,8005p;11744,11860p' artifacts/api-server/src/services/signal-options-automation.ts
```

Confirm the ticket's event name is wrong (should return nothing):
```
rg -l "signal_options_entry_submitted" --glob '!**/node_modules/**'
```

Live DB evidence (read-only). ESM resolves `pg` from an absolute path because the script is outside
`lib/db`; run from `lib/db` so `$DATABASE_URL` and pooling match the app:
```
cd /home/runner/workspace/lib/db && node --input-type=module -e '
import pg from "/home/runner/workspace/node_modules/.pnpm/pg@8.20.0/node_modules/pg/lib/index.js";
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl:{ rejectUnauthorized:false } });
await c.connect();
for (const s of ["DELL","AXTI","LUNR"]) {
  const pos = await c.query("select status,quantity,opened_at,closed_at,position_key from shadow_positions where account_id=\x27shadow\x27 and symbol=$1 order by opened_at desc limit 3",[s]);
  const ord = await c.query("select id,source_event_id,status,side,asset_class,placed_at,payload->\x27candidate\x27->>\x27id\x27 cand from shadow_orders where account_id=\x27shadow\x27 and symbol=$1 and side=\x27buy\x27 and asset_class=\x27option\x27 order by placed_at desc limit 3",[s]);
  const ent = await c.query("select id,occurred_at,payload->\x27candidate\x27->>\x27id\x27 cand from execution_events where symbol=$1 and event_type=\x27signal_options_shadow_entry\x27 order by occurred_at desc limit 3",[s]);
  console.log(s, "positions", pos.rows, "orders", ord.rows, "entryEvents", ent.rows);
  for (const e of ent.rows) {
    const n = await c.query("select count(*)::int newer from execution_events where deployment_id=(select deployment_id from execution_events where id=$1) and event_type like \x27signal_options_%\x27 and occurred_at > $2",[e.id, e.occurred_at]);
    console.log("  ", s, e.id, "newer sigopt events:", n.rows[0].newer, "inWindow<2500:", n.rows[0].newer < 2500);
  }
}
await c.end();'
```
