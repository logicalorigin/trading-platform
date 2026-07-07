# Plan — Push-native redesign of the signal-options worker (stop rebuilding every tick)

Status: **DECIDED — building Approach A (in-memory running tally). NO new DB tables.** Trading-critical.
Source: multi-agent design investigation (workflow `wf_49327635-fcf`) + live-DB verification.

## DECISION (2026-07-06, owner-directed)

- **Fix C (the compact `signal_options_seen_signals` sidecar table) is RIPPED OUT** — owner rejected
  sidecar tables as "cheap tricks; improve the process, not relocate the cost." Fully removed from the
  working tree (schema reverted to HEAD, migration/test/docs deleted, `automation.ts` code excised;
  tsc 0 errors, 33 tests pass). It was never applied to the live DB.
- **Also rejected:** the "firehose → `automation_diagnostics`" pivot (another sidecar/relocation).
- **BUILD: Approach A — the in-memory running tally.** The worker keeps per-deployment derived state
  (positions, seen-signals, allowance) in its existing in-memory `deploymentRuntime` Map and folds each
  new event as a delta instead of re-reading + re-deriving 2,500 rows every tick. Shadow ledger stays
  the sole source of truth; reconcile on every position open/close; full-rebuild fallback on restart
  (Replit rotates the VM ~6h, so one rebuild per restart is negligible). NO new tables.
- **Firehose at the source:** once dedup lives in the in-memory tally, investigate dropping most of the
  ~78k/day `signal_options_candidate_skipped` writes entirely (they're within-session dedup + telemetry;
  on restart the worker re-evaluates signals fresh and idempotently re-skips) — cut at the source, not
  relocated.

## Build plan (test-first, incremental, real-money-safe)

1. **Fold module + equivalence test FIRST (no wiring):** pure fold functions that apply ENTRY/EXIT/MARK
   (and position-mark skips) as deltas to a positions Map; a golden test asserts
   `foldEvents(events) === deriveActivePositions(events)` across a corpus (byte-identical). This is the
   correctness gate — mirror `deriveActivePositions` (6122) exactly (symbol flips, re-entry after close,
   closedCandidateIds/closedPositionIds, actionable-session filters).
2. **Watermark tail-read:** read only events with `occurred_at >= watermark` (with a safety overlap +
   dedup-by-id, since event ids are random UUIDs and occurred_at isn't unique).
3. **Projection in `deploymentRuntime`:** {positions, seenSignals, allowance cache keyed to last fill,
   dailyRealized keyed by UTC date, watermark}; fold the tail each tick; full-rebuild on restart /
   config-signature change / retention gap / reconcile mismatch.
4. **Reconcile-on-state-change:** any folded ENTRY/EXIT re-runs the existing shadow-ledger reconcile for
   that deployment and diffs; mismatch → drift metric + full rebuild that tick.
5. **Shadow-mode bake:** run fold-vs-full-derive in parallel every tick behind a flag; require a hard
   ZERO drift counter across restarts/VM-rotations before flipping authority. Instant env-flag rollback.
6. **Then** cut the firehose writes at the source (separate, gated step).

---

_Prior scoping context (retained for reference):_

## The problem, plainly

Every time the options worker runs — on a signal push OR on the 60-second position-management
timer — it **rebuilds its entire picture from scratch**: it re-reads up to 2,500 history rows (twice)
and re-derives positions, dedup, and the trading-allowance budget. The CPU cost is the database
driver parsing those payloads, which pins DB connections. Fix C made the *dedup* part of that rebuild
cheap. This scope asks: can we stop rebuilding at all — keep a running tally instead?

## Verified ground truth (don't re-litigate)

- **Trigger:** push-driven (reacts to signal-monitor events immediately) **plus** a 60s timer that
  does position management (marks/stops/exits) — the timer is *not* legacy.
- **Authority:** the shadow ledger (`execution_events` + `shadow_positions/orders/fills`) is the
  ONLY source of truth. Any in-memory tally must be a **cache**, never authoritative.
- **Restart:** in-memory state is lost on restart and rebuilt from the ledger next tick. **Replit
  rotates the VM ~every 6h**, so restarts are routine — one full rebuild per 6h is negligible.
- **A cursor already exists** (`signalOptionsActionCursors`) proving cross-tick state works; it
  resets on restart. `shadow_positions` is **already** a materialized current-positions store.

## The three approaches (a risk/reward ladder)

### A — Incremental in-memory projection
Keep a running per-deployment tally in the worker's existing in-memory map; each tick reads only the
*new* events (a watermark tail-read) and folds them as deltas. Reconcile against the shadow ledger on
any position open/close (the exact moment drift would cost money). Restart falls back to today's full
rebuild (no new stored state). **Effort ≈ 2–3 days code + ~1 week shadow-bake.** Main risk: the fold
must exactly match today's `deriveActivePositions`. Depends on and reuses Fix C.

### B — Persisted materialized-state ("Fix C Phase 2")
Generalize Fix C's store pattern: add DB tables for the position overlay (peak/stop/Greeks) and the
allowance snapshot, written transactionally with each trade event; read cheaply each tick; survives
restart. **Effort ≈ multi-week gated rollout.** Risks: couples the trade-ledger write's availability
to a cache write; adds schema + invalidation surface. **Its one unique benefit is surviving restart —
which is worth almost nothing at a 6h restart cadence.**

### C — Fingerprint-and-memoize
Keep the rebuild, but first run a **cheap metadata-only check** (count + newest timestamps + a digest
of the row IDs). If nothing changed since last tick, reuse the cached result and skip the expensive
read + rebuild + reconcile entirely. **Effort ≈ 1–2 days + ~1 week canary.** Lowest risk: it's a pure
cache of a deterministic result — worst case is a stale reuse, and it's discardable at any instant
(restart just recomputes). Strictly additive on top of Fix C.

## Recommendation: **C first, A only if needed, skip B**

1. **Keep Fix C Phase 1 as the foundation** (it's done + proven). Both A and C reuse its
   firehose-excluded read; A reuses its dedup store. The redesign builds *on* Fix C, it doesn't
   replace it. (What we're *not* doing is bolting on more stores — that's option B.)
2. **Phase 1 = C (memoize).** The dominant load is idle 60s polls where *nothing changed* — C makes
   those near-free, and removes the redundant pre-marks rebuild on active ticks. Cheapest, safest,
   biggest immediate win, zero new source of truth. Ship behind a flag, canary-bake, then default on.
3. **Measure.** Fix C + C together may already end the pool-pinning. Only if *active-trading* ticks
   are still too heavy do we go to Phase 2.
4. **Phase 2 (conditional) = A (incremental projection).** Folds deltas so even changed ticks stop
   rebuilding. In-memory only; restart falls back to today's path (fine at 6h).
5. **Skip B.** Its restart-survival edge is worthless at 6h cadence, and it adds the most risk. Steal
   only its one good idea — *allowance as a "recompute only when a new fill exists" cache* — which A
   already incorporates.

## The correctness risks (and how each is handled)

Every approach keeps the shadow ledger authoritative, the cache discardable, and today's full-rebuild
retained as the fallback — with a shadow/canary bake (compute both old + new, require **zero drift**)
behind an env flag with instant rollback before anything goes authoritative.

1. **Tally/fold must exactly match today's derive (A).** → shadow-mode diff every tick; drift counter
   must be a hard zero across restarts before flipping.
2. **No unique ordering key** — event IDs are random UUIDs and `occurred_at` isn't unique (A). →
   watermark with a safety overlap + dedup already-seen events by ID.
3. **Events are NOT strictly append-only** — one path edits a row in place (gateway-blocked
   coalescing) (C). → the fingerprint must include `max(updated_at)`, not just IDs. *(Load-bearing.)*
4. **Shadow-ledger changes the fingerprint doesn't see** (reconcile/allowance read shadow tables). →
   a second fingerprint over the shadow tables + a max-age backstop that forces a recompute at least
   every N ticks.
5. **Allowance = real money.** → never an incremented counter; a cache keyed to the latest fill, so a
   new fill always forces a fresh authoritative recompute.
6. **Daily-P&L reset at UTC midnight** — key the accumulator by UTC date.

## Effort & disposition

- **Fix C Phase 1:** keep, finish, ship (it's the base). ~done.
- **Redesign Phase 1 (C):** ~1–2 days + ~1 week canary bake.
- **Redesign Phase 2 (A), only if needed:** ~2–3 days + ~1 week shadow bake.
- **B:** not recommended.

## LIVE-DB FINDINGS (2026-07-06, EXPLAIN gate) — reshaped the plan

Ran `EXPLAIN ANALYZE` against the live ledger before shipping Fix C. Results:
- **Fix C's firehose-excluded read is the WRONG mechanism.** Filtering on `payload->>'reason'`
  forces Postgres to detoast the big jsonb payload on every row — the exact cost we're avoiding.
  Warm ≈ 4ms vs 1.5ms baseline; **cold ≈ 1,800ms** (detoast from disk). Reverted it (2026-07-06).
- **Load is bursty.** 24h: 78,711 firehose skips vs 16,096 marks (firehose dominant). Last hour:
  10 skips vs 1,036 marks (quiet). Recent read windows are mark-dominated off-peak, firehose-heavy
  during market-hours universe scans.
- **The firehose is mostly historical bloat in the ledger** — for a position-holding deployment only
  61 of the newest 2,500 rows were firehose (96% were marks).

### The pivot (chosen): firehose OUT of the ledger — this is Fix C "Phase 2"
Commit `78cf01e0` already split 88% of telemetry into **`automation_diagnostics`** and left
`candidate_skipped` in `execution_events` as an explicit **deferred follow-up**. That follow-up is
the fix:
- **Write** entry-candidate (firehose) skips to `automation_diagnostics` (full payload, for display)
  + the compact `signal_options_seen_signals` store (scalar, for dedup) — **NOT** `execution_events`.
- The per-tick worker reads (`execution_events`) then go firehose-free **naturally, no filter, no
  detoast** — and the bloat ages out.
- **Dedup** → compact store (already built; keep the `computeSignalOptionsSeenSignals` union).
- **Display repoint (the real work):** ~5 consumers read the full firehose payload from the ledger —
  `candidateFromEvent`, `signalOptionsReadModelSummary`, `buildCockpitDiagnostics`,
  `buildRuleAdherence`, `buildSignalOptionsPerformanceFromInputs`. Each must read
  `automation_diagnostics` instead (there is already an `execution_events` ∪ `automation_diagnostics`
  union-read path — `listExecutionEvents` — to lean on). `deriveActivePositions` is UNAFFECTED (it
  only consumes position-mark skips, which stay in the ledger).
- **Retention prune** for the store + diagnostics firehose.
- Ship behind a flag; verify writes land in the new home and display still shows skipped candidates.

**Disposition:** the compact store + write-path + union are the reusable foundation and stay. The
firehose-excluded read is reverted. `computeSignalOptionsSeenSignals`/`seenSignalKeysFromStoreRows`/
`extractSignalOptionsSeenSignalRow` remain wired for the union.

## Open questions for the owner

1. Ship **Fix C Phase 1 live first** (it's the foundation the rest needs), or hold everything until
   the redesign path is chosen?
2. Are you OK starting with **C (memoize)** and only escalating to **A** if measurement shows active
   ticks still hurt — or do you want to commit to A up front?
3. Is the ~1-week **shadow/canary bake** (run old + new in parallel, prove zero drift before flipping)
   acceptable, given it's the main safety guarantee against duplicate/missed trades?
