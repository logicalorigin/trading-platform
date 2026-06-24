# Implementation Plan: split the telemetry firehose from the P&L ledger (execution_events)

**Status:** Phase 0 (backlog delete) DONE. Phase 1 (Tasks 1–3) IMPLEMENTED + APPLIED (2026-06-24):
`automation_diagnostics` table + indexes created in heliumdb; telemetry/lifecycle writes redirected;
`listExecutionEvents` + `findExistingEventByClientOrderId` union both tables. **Sink = Option A.**
Phase 2 (retention) is next; window = **7 days** (owner-decided 2026-06-24). See "Application record" below.

## Application record (2026-06-24)
- Migration applied to heliumdb via psql (drizzle-kit push disabled on shared DB):
  `psql "$DATABASE_URL" -f lib/db/migrations/20260624_automation_diagnostics_table.sql`
  then `PGOPTIONS="-c statement_timeout=0" psql ... -f 20260624_automation_diagnostics_indexes.sql`.
- Why it was urgent: the rebuilt bundle (built 11:05 with the split code) ran ahead of the migration,
  so the live API threw `relation "automation_diagnostics" does not exist` (4,544 errors; `/algo/events`
  HTTP 500; DB pool saturated). Applying the table/indexes resolved it (0 errors after 17:48Z).
- Post-apply: `execution_events` ≈ 89.8K rows (down from ~869K); reader/writer audit found 0 silent gaps.
- `signal_options_candidate_skipped` was INTENTIONALLY left in `execution_events` (dual-purpose: some
  rows carry load-bearing position-mark state). Its own bloat is therefore NOT addressed by this split —
  it is a deferred, separate follow-up.
**Parent workstream:** helium-Postgres app-pool saturation (Layer 2 of
`docs/plans/db-pool-saturation-index-fix.md`). Sibling: `docs/plans/bar-cache-write-contention-fix.md`.
**Confirmed intent (interview, 2026-06-24):** durable ROOT fix, not bandaids. The root is that
one table is doing two opposite jobs; the fix is to **separate them**. Keep the transition-level
"why blocked" events for strategy tuning; drop the redundant repeats. Deploy now is fine (no
market-close wait). Break nothing that reads real-trade history (shadow P&L).

## Plain-English summary
`execution_events` is one table doing two jobs: a **ledger** of real trades (entry/exit/mark —
the source of truth for your shadow P&L) and a **firehose** of "did nothing / blocked" telemetry
(~88% of 869K rows). The firehose bloats the ledger, evicts chart data from cache, slows the
ledger's own reads, and broke its dedup. The durable fix: pull the telemetry out of the ledger,
write it only when a block *starts or changes* (not every 30 min), keep it bounded, and let the
ledger stay small and permanent. First, clear the ~735K rows of existing noise.

## Root cause (confirmed)
One generic event-log table conflates two profiles with opposite needs:

| | **Ledger** (entry/exit/mark, order_failed) | **Telemetry** (blocked/skipped/tracked) |
|---|---|---|
| Volume | low | very high (~88%) |
| Value | high — replayed to reconstruct P&L/positions (`signal-options-automation.ts:5662-5696`) | low — "why we did nothing" |
| Read | replayed, indexed, permanent | ~never read (only the broken self-dedup, `overnight-spot-execution.ts:907-935`) |
| Needs | durability + permanence | cheap, bounded, disposable |

Mechanism of growth: blocked rows re-logged every 30 min per still-blocked symbol
(`shouldSkipDuplicateBlockedPlan`, `:358-382`, `OVERNIGHT_SPOT_BLOCKED_EVENT_DEDUPE_MS`, `:43`),
and the dedup lookup only scans the newest 1,000 rows so it misses as the table grows
(self-reinforcing). Nothing references `execution_events.id` (FK check, 2026-06-24) and nothing
reads the blocked rows — so removing them is safe.

## THE design decision (owner) — where do the kept transition diagnostics live?
We keep transition events (first-block-per-episode / reason change) for tuning; the question is
the sink:

- **Option A — separate `automation_diagnostics` table (RECOMMENDED).** Transition-level
  diagnostics go to their own table with aggressive retention/partitioning; `execution_events`
  becomes a pure ledger. Keeps "why blocked" relationally queryable and showable in the cockpit;
  fully decouples firehose from ledger. Cost: one new table + wiring the readers.
- **Option B — don't persist to the DB; flight recorder only.** Simplest, zero DB write for
  telemetry (you already have a flight recorder built for diagnostics). Cost: loses relational /
  cockpit access to blocked history — you'd grep the recorder for occasional tuning.

Recommendation: **A**, because you said you want to look back at why a symbol was blocked, and a
table keeps that queryable and in the UI. B is the right call only if recorder-grepping is enough.

## Event-type classification (first task of Phase 1)
- **Ledger (stay in execution_events):** `signal_options_shadow_entry` / `_exit` / `_mark`,
  `overnight_spot_order_failed`, and any real order/action events.
- **Telemetry (move to the sink + on-transition only):** `overnight_spot_signal_blocked`,
  `signal_options_candidate_skipped`, `overnight_spot_signal_tracked`.
- Audit each type against its readers before moving (acceptance criterion of Task 1).

---

## Task List

### Phase 0 — clear the backlog noise (immediate relief; authorized, gated)
#### Task 0: Delete the ~735K `overnight_spot_signal_blocked` rows
**Description:** Batched delete (10k/batch) of the blocked-noise rows from `execution_events`,
then `VACUUM (ANALYZE)`. Real-trade rows untouched. Safe: nothing references these rows (FK check
clean) and nothing reads them.
**Acceptance:** blocked-row count → 0; ledger rows intact; table size/dead-tuples reclaimed;
recorder shows execution_events scans shrink.
**Verification:** post-delete `count(*) WHERE event_type='overnight_spot_signal_blocked'` = 0;
shadow P&L/positions unchanged (cockpit spot-check).
**Status blocker:** destructive-op safety gate — needs owner authorization (run via `!`, grant a
Bash allow rule, or explicit "go"). Optional backup-table-first variant if zero-risk wanted.
**Files:** none (data op); record the command in the PR/handoff.
**Scope:** S (operational)

### Phase 1 — stop the firehose at the source + route telemetry to its sink
#### Task 1: Classify event types (ledger vs telemetry) and confirm readers
**Description:** Lock the ledger-vs-telemetry split above by auditing each event_type's writers
and readers (cockpit `/algo/events`, `listDeploymentEvents`, shadow reconstruction, reassign).
**Acceptance:** documented mapping; confirmation that moving the telemetry types out of
`execution_events` breaks no ledger/P&L/reconcile reader.
**Dependencies:** None.
**Files:** this doc + a short audit note.
**Scope:** S

#### Task 2: Log telemetry only on state-transition, with a reliable lookup
**Description:** Drop the 30-minute re-log window (`shouldSkipDuplicateBlockedPlan`
`overnight-spot-execution.ts:358-382`) so an unchanged block is suppressed at any age; only a new
block / changed reason / clear writes. Replace the newest-1,000-row dedup scan
(`findExistingEventByClientOrderId` `:907-935`) with an indexed "latest state per (deployment,
symbol)" query so transition detection can't silently fail and re-bloat.
**Acceptance:** a still-blocked symbol writes one row per episode, not one/30min (update test
`overnight-spot-execution.test.ts:31-54`); lookup uses an index scan (EXPLAIN), no `LIMIT 1000`
heap scan; block→unblock→block still records the new episode.
**Dependencies:** Task 1.
**Files:** `artifacts/api-server/src/services/overnight-spot-execution.ts`, test.
**Scope:** S–M

#### Task 3: Route telemetry to the chosen sink (per the design decision)
**Description (Option A):** create `automation_diagnostics` (deployment_id, symbol, event_type,
summary, payload, occurred_at + retention-friendly partition key), redirect the telemetry writes
there, and update the cockpit/events feed to read ledger + diagnostics as needed. **(Option B):**
replace the telemetry inserts with flight-recorder/structured-log emits; remove the DB write.
**Acceptance:** telemetry no longer inserts into `execution_events`; "why blocked" still
available via the chosen sink; cockpit feed behaves per the decision.
**Dependencies:** Task 1 (+ owner's A/B choice). Pairs with Task 2.
**Files:** `overnight-spot-execution.ts`, signal-options writers, (Option A) `lib/db/src/schema/*`
+ migration + readers; (Option B) recorder emit.
**Scope:** M (A) / S (B)

### Checkpoint: Phase 1
- [ ] execution_events receives only ledger events; telemetry flows to its sink, on-transition only.
- [ ] After deploy: execution_events write rate collapses; it stops growing on idle nights.

### Phase 2 — retention on the telemetry sink (Option A only)
#### Task 4: Retention/partitioning for `automation_diagnostics`
**Description:** Time-partition or TTL-prune the diagnostics table so it stays bounded; one-time
cleanup of any seeded history. (Option B: N/A — recorder handles its own rotation.)
**Acceptance:** diagnostics row count/age bounded; nothing that reads it starves.
**Dependencies:** Task 3 (Option A). Design window with owner (longest tuning lookback).
**Scope:** M

### Phase 3 — read-side, MEASURE FIRST (ledger is now small)
#### Task 5: Re-measure, fix only what's still hot
With telemetry gone and the backlog cleared, the ledger is ~1/10th its size. Re-measure the
former hot reads before touching them:
- shadow mirror-repair `event_type IN (...)` (`shadow-account.ts:1261`) — likely fine on a small
  table; if not, two-phase + partial index.
- `listDeploymentEvents` `LIKE 'signal_options_%'` (`signal-options-automation.ts:2019`) — if
  still slow, column projection (drop `payload`) and/or a position-state projection.
- Drop the dead `execution_events_deployment_idx` (n_distinct=1) after confirming idx_scan ~0.
**Acceptance:** recorder confirms execution_events is no longer a multi-second slow-query source;
only do sub-fixes that the measurement still justifies.
**Scope:** XS (measure) + M each (conditional).

---

## Risks and mitigations
| Risk | Impact | Mitigation |
|---|---|---|
| Moving a type out of the ledger breaks a P&L/reconcile reader | High | Task 1 audits every reader before the move |
| Transition-detection silently fails → bloat returns | High | Task 2 indexed lookup (no bounded scan); ship with Task 2 |
| Backlog delete during market hours adds load | Med | Batched + vacuum; FK-clean; overnight writer dormant in RTH |
| Cockpit feed loses "blocked" visibility (Option B) | Med→Low | That's the explicit A/B tradeoff; A keeps it |
| New table without retention re-bloats | Med | Phase 2 retention is mandatory for Option A |

## Open questions (owner)
1. ~~Sink: A or B?~~ **DECIDED 2026-06-24: Option A** (separate `automation_diagnostics` table).
2. ~~Backlog delete authorization?~~ **DONE 2026-06-24:** owner granted; batched delete executed.
3. ~~Retention window for the diagnostics sink?~~ **DECIDED 2026-06-24: 7 days** (aggressive; recorder
   covers deeper history). Implement in Phase 2 (Task 4).

## Suggested order
Task 0 (now, on authorization) → 1 → 2 (+3 per A/B) → 4 (if A) → 5 (measure, then conditional).
