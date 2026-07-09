# STA "action candidate pending" / "shadow link pending" / "Candidate missing" — root-cause trace

Author: codex-worker (Claude subagent) for claude-lead. INVESTIGATION ONLY — no code/DB writes made.
Date: 2026-07-07. Symptom window: ~12:00–12:12 PM MT = **18:00–18:12Z**.
Scope: the automation STATE MACHINE (why candidates don't advance to entries/links). The blocking-reason
DISPLAY layer is a separate parallel audit (`.codex-watch/sta-blocking-audit-2026-07-07.md`) — not duplicated here.

Labels: **[OBSERVED]** = from source/logs/DB/runtime; **[INFERRED]** = reasoning over evidence; **[UNKNOWN]** = not verified.
Every root-cause claim carries a "**re-verify:**" command/path a skeptic can run.

---

## 1. String → field → route → state-machine map (all file:line OBSERVED)

The three badges are three COLUMNS of one STA row, and for the user's rows they all reduce to the **same
condition: no action candidate exists for an action-eligible signal.**

| UI string | file:line | Condition that emits it | Source field |
|---|---|---|---|
| `Queued` / `action candidate pending` | `artifacts/pyrus/src/screens/algo/OperationsSignalRow.jsx:520-528` and `:696-702` | `resolveSelectionStageDisplay`: `candidateRecord` is empty `{}` (line 520) OR falls through with no status/contract/demand (line 696) | `signal.candidate` absent/empty |
| `Candidate missing` | `OperationsSignalRow.jsx:900-906` and `:1054-1061` | `signal.actionEligible === true` AND no `candidate` | `signal.actionEligible` true + `candidate` null |
| `shadow link pending` | `artifacts/pyrus/src/screens/algo/algoHelpers.js:2229-2235` | `resolveCandidateSyncDisplay` fallback: candidate's `shadowLink` has no `fillId`/`orderId`/`positionId` and no `syncStatus` (an EMPTY candidate lands here too → label "Pending", detail "shadow link pending") | `candidate.shadowLink` empty |

Server-side field origins (OBSERVED):
- `signal.actionEligible` ← `artifacts/api-server/src/services/signal-monitor-actionability.ts:77` (`actionEligible: actionBlocker == null`), surfaced at `signal-monitor.ts:1301,1386,9325`.
- `candidate` (the action candidate: contract selection, actionStatus, shadowLink) ← built by the signal-options **entry scan** inside `artifacts/api-server/src/services/signal-options-automation.ts`, in the "heavy entry work" that runs **only after** line 19494. Event types written: `signal_options_candidate_created` / `signal_options_shadow_entry` (`signal-options-automation.ts:141-146`).
- `candidate.shadowLink` ← link to the shadow order/fill/position, produced during/after entry (`SignalOptionsShadowLink`).

State machine: **action-eligible signal → (entry scan builds) candidate → (entry/link builds) shadowLink.**
The user's rows are stuck at the very first hop: the entry scan never built a candidate.

---

## 2. The gate that stops the first hop (all OBSERVED)

1. `artifacts/api-server/src/services/signal-options-worker.ts:740`
   `const skipEntryWork = isApiResourcePressureHardBlock(pressure);` — evaluated at the START of every worker tick, from the current pressure snapshot. (Comment `:733-739` documents the "positions-only degrade".)
2. `runDeployment` → `runDeploymentScanWithTimeout` passes it into `scanDeployment({ skipEntryWork })` (`signal-options-worker.ts:450, 513`).
3. `artifacts/api-server/src/services/signal-options-automation.ts:19454-19493`: when `input.skipEntryWork === true`, the scan **returns early** with `candidateCount: 0, blockedCandidateCount: 0` and `heavyWorkDeferred: true`, **before** the entry work below line 19494 that builds candidates. It remembers a resume cursor (`:19462-19473`) and still emits the positions-only marks done above.
4. `isApiResourcePressureHardBlock` (`artifacts/api-server/src/services/resource-pressure.ts:603-607`) returns `snapshot.hardResourceLevel === "high"`.
5. `hardResourceLevel = maxLevel(rssLevel, heapLevel, poolLevel)` (`resource-pressure.ts:428`) — **excludes** event-loop delay/utilization and request latency.
6. `poolLevel === "high"` iff `waiting >= DB_POOL_HIGH_MIN_WAITERS (=6) AND active >= max` (`resource-pressure.ts:300-314`, threshold `:297-298`).
7. Hysteresis ENTER=2 / EXIT=2 (`resource-pressure.ts:109-110`, `applyResourceLevelHysteresis :177-215`): to LEAVE "high" you need **2 consecutive** non-high samples.

`skipEntryWork` is set to the hard-block **only in the two background workers** (`signal-options-worker.ts` and `overnight-spot-worker.ts`); no HTTP route sets it — so viewing/refreshing the STA table never forces an on-demand candidate rebuild (the table reads the last worker scan's persisted state). [OBSERVED: `rg -n "skipEntryWork" artifacts/api-server/src` shows assignment only in those two workers.]

---

## 3. Observed timeline (18:00–18:12Z symptom window)

Data sources: flight recorder `.pyrus-runtime/flight-recorder/api-events-2026-07-07.jsonl`, `api-current.json`,
and `execution_events` / `signal_options_seen_signals` / `shadow_orders` for the active shadow deployment
`7e2e4e6f-749f-4e65-a011-87d3559a23b0`.

**Pressure (OBSERVED, `api-memory-sample` events):** the DB pool was pinned at **12/12 active with 3–37 waiters on essentially every 30 s sample from 17:40Z through 18:17Z.** `poolLevel` = high in nearly all samples; the few "watch" dips (5w/4w/3w) never occurred twice in a row, so with EXIT=2 hysteresis `hardResourceLevel` stayed **latched high continuously**. RSS ~1965–2296 MB (< 4608 high line) and heap < 80% throughout, so **the DB pool was the SOLE hard driver.** A process restart at **18:17:31Z** (rss 2289 → 214 MB) is the only break.

**Automation events for the deployment since 17:00Z (OBSERVED, DB):**

| event_type | count | first | last |
|---|---|---|---|
| `signal_options_shadow_mark` (positions-only) | 724 | 17:00:04 | 19:22:38 |
| `signal_options_candidate_skipped` | 9 | 17:15:04 | 19:21:26 |
| `signal_options_candidate_created` | 4 | 17:28:30 | 19:21:16 |
| `signal_options_shadow_entry` (actual entry) | **1** | 18:52:57 (DELL) | 18:52:57 |

- **Position marks ran continuously (724 events) while entry/candidate work almost entirely stopped** — the exact positions-only-degrade signature.
- **There is an 84-minute gap in ALL candidate/entry events from 17:28:32Z → 18:52:49Z. That gap fully contains the user's symptom window (18:00–18:12Z).** During it the worker was ticking (marks every few seconds) but every tick took the `skipEntryWork` early-return.
- The three symptom symbols **AXTX, OPEN, ROK have ZERO `execution_events` rows since 17:00Z** — no candidate built, and (crucially) no skip recorded either, i.e. the entry scan never reached them.

**The two entry bursts coincide exactly with pool dips below the high threshold (OBSERVED):**
- DELL candidate+entry at 18:52:49–57 ← pool dipped to `9/12+0w` (18:50:17), `8/12+0w` (18:52:16) — two consecutive non-high samples cleared the hysteresis, so `skipEntryWork` briefly went false; pool went high again at 18:52:47.
- AXTI candidate at 19:21:16 ← pool dipped to `12/12+4w` (19:21:09) and `+5w` (19:21:40), waiters < 6 → non-high.

**Live state now (OBSERVED, `api-current.json` @ 19:21:04Z):** `hardResourceLevel: "high"`, driven solely by `db-pool: 12/12 active, 14 waiting`; heap 6.3 %, rss 1816 MB. `scannerPressure.activeLongScanCount: 0`. So the block is **still active**, and the pool saturation is **real and current, not a stale latch.**

---

## 4. ROOT CAUSE verdict

**The signal-options worker degrades to positions-only (`skipEntryWork = true`) on every tick because
`hardResourceLevel` was latched "high" for the entire symptom window — driven exclusively by DB-pool
exhaustion (12/12 active + ≥6 waiters). The `skipEntryWork` early-return (`signal-options-automation.ts:19454-19493`)
returns with `candidateCount: 0` before the entry work that builds action candidates. Action-eligible signals
therefore never get a candidate, so the STA row shows "action candidate pending" / "Candidate missing", and the
sync column shows the empty-candidate fallback "shadow link pending".**

Strongest single piece of evidence: the **84-minute total blackout of candidate/entry events (17:28:32Z → 18:52:49Z) while 724 position marks kept flowing**, with the two entry bursts landing precisely in the only two pool-below-high dips. This is exactly what the code path predicts and cannot be explained by dedup, timeouts, or a stuck scan.

Re-verify commands (a skeptic can run each):
- Gate exists & shape: `sed -n '733,749p' artifacts/api-server/src/services/signal-options-worker.ts`; `sed -n '603,607p;300,314p;428p;109,110p' artifacts/api-server/src/services/resource-pressure.ts`; `sed -n '19450,19494p' artifacts/api-server/src/services/signal-options-automation.ts`.
- Pool latched high in window:
  `rg '"event":"api-memory-sample"' .pyrus-runtime/flight-recorder/api-events-2026-07-07.jsonl | python3 -c "import sys,json;[print(json.loads(l)['time'][11:19], json.loads(l)['dbPool']) for l in sys.stdin if '2026-07-07T18:0' in json.loads(l)['time']]"` (expect active=12,max=12,waiting≥6 across 18:00–18:12Z).
- Current block still on: `python3 -c "import json;d=json.load(open('.pyrus-runtime/flight-recorder/api-current.json'));print(d['apiPressure']['hardResourceLevel'], d['apiPressure']['inputs']['dbPoolActive'], d['apiPressure']['inputs']['dbPoolWaiting'])"` (expect `high 12 14`).
- Event blackout + burst correlation (DB, SELECT-only):
  `cd lib/db && node -e "const{Pool}=require('pg');const p=new Pool({connectionString:process.env.DATABASE_URL,max:2});p.query(\"SELECT event_type,symbol,occurred_at FROM execution_events WHERE deployment_id='7e2e4e6f-749f-4e65-a011-87d3559a23b0' AND event_type IN ('signal_options_candidate_created','signal_options_candidate_skipped','signal_options_shadow_entry') AND occurred_at>='2026-07-07T17:00:00Z' ORDER BY occurred_at\").then(r=>{console.table(r.rows);return p.end()})"` (expect no rows 17:28:32→18:52:49).
- Symptom symbols never processed:
  same harness, `WHERE symbol IN ('AXTX','OPEN','ROK') AND occurred_at>='2026-07-07T17:00:00Z'` → zero rows.

### Alternatives considered and how each was ruled out (OBSERVED unless noted)
- **Stuck "1 long scan" serializing candidate work — RULED OUT.** `scannerPressure.activeLongScanCount = 0` now (`api-current.json:52`); 724 marks flowed continuously through the window, so the worker was ticking, not blocked on one held scan. (The `scanner.activeDeepScanCount:1` in `get_runtime_diagnostics` is the MARKET-DATA scanner — a different subsystem — not the signal-options worker.)
- **seen-signals dedup drift after restarts — RULED OUT for these rows.** `signal_options_seen_signals` has AXTX last at 07-06, OPEN never, ROK last 07-07 08:42Z (a 1m signal, not the 5m the user saw) — no rows in the symptom window. A dedup skip WRITES a seen-signals row after processing; the absence proves the scan never processed them, so dedup is not the blocker.
- **15 s statement timeout killing candidate/link queries — RULED OUT as the gate.** Marks succeeded continuously and the DELL entry succeeded during a dip; a timeout path would emit errors/skip events for these symbols (none exist). [INFERRED] statement timeouts are a *contributor to* pool saturation, not the entry-skip mechanism.
- **shadow-account slow reads / stale caches starving the LINK stage — RULED OUT for these rows.** For AXTX/OPEN/ROK there is no candidate, so "shadow link pending" is the empty-candidate sync fallback (`algoHelpers.js:2229-2235`), not link starvation. When an entry actually occurred (DELL 18:52:57) it linked immediately: `shadow_orders` row `status=filled` with `source_event_id` set. So the link stage works once entries run.
- **Market-session / entitlement gate — RULED OUT.** `get_runtime_diagnostics.marketSession` = XNYS RTH, `regularTrading:true` during the window.

---

## 5. Block classification & recovery (deliverable §4)

**Not (c) stuck-latched-after-recovery:** the pool is genuinely 12/12 + 14 waiters right now (`api-current.json`), so `hardResourceLevel="high"` is a true reading, not a stale latch.

**Closest to (b) too aggressive under CHRONIC (vs transient) saturation — [INFERRED from OBSERVED data]:**
the degrade is written for a transient "pressure window" (`signal-options-worker.ts:733-739`), but the DB pool
has been saturated near-continuously **all day** (a `12/12+13w` sample exists as early as 00:00:26Z and it is
still `12/12+14w` at 19:21Z). Under persistent saturation the all-or-nothing gate becomes a **de-facto
indefinite entry freeze**: entries only slip through in the rare moments the pool holds < 6 waiters for two
consecutive samples. There is no floor guaranteeing a periodic entry pass, so a chronically-saturated pool
starves entries indefinitely while positions keep being marked. It correctly sheds during genuine pressure
(design intent holds), but it lacks a starvation guard for the chronic case.

**Recovery path (OBSERVED in code):** automatic. When `hardResourceLevel` drops (2 consecutive samples with
pool waiters < 6 AND active < max, or rss/heap below thresholds), the next worker tick sets `skipEntryWork=false`
and resumes from the remembered cursor (`signal-options-automation.ts:19462-19473`); the queued rows then get
candidates built and self-heal. **Caveat:** this depends entirely on the DB pool draining. The *cause of the pool
saturation itself* (slow-query firehose: 264k `api-db-query-slow` + 237k `api-db-pool-acquire-slow` events today)
is upstream and belongs to the infra/display audit lane — not traced here. If the pool never drains, entries stay
frozen indefinitely.

---

## 6. Minimal-fix options, ranked (no implementation)

1. **Entry-scan starvation floor (recommended).** Track consecutive `skipEntryWork` ticks (or wall time since the
   last entry pass) per deployment; when it exceeds a bound, force ONE throttled entry pass (small
   `actionWorkItemLimit`, tight timeout) even under hard block. Preserves the transient-shed intent while
   guaranteeing chronic saturation cannot indefinitely halt entries. Lowest blast radius.
2. **Cap consecutive skips instead of a pure level gate.** Change the gate at `signal-options-worker.ts:740` from
   "high ⇒ skip" to "high ⇒ skip unless N ticks skipped", i.e. a leaky-bucket that lets 1 in N entry scans through.
3. **Give entry work a dedicated small pool budget** so it doesn't need all-or-nothing shedding — run entries on a
   reserved 1–2 connection lane rather than competing with the saturated main pool. Larger change.
4. **Relieve the upstream pool saturation** (out of this lane's scope; infra/display audit). If the pool drains,
   the degrade self-limits as designed and no state-machine change is needed.

Options 1–3 are in the other lane's dirty WIP files (`signal-options-worker.ts` / `signal-options-automation.ts`)
— coordinate before touching. Option 4 is elsewhere.
