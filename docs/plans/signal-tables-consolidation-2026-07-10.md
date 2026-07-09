# Signal-system tables: consolidation plan (analysis only — 2026-07-09 study)

Evidence: live pg catalog/stats census + full code semantics trace (session e2aac502; agents' raw
findings in the session record). No changes made. Line refs are signal-monitor.ts unless noted.

## The question asked: "merge state into the matrix?"

**No — the premise is inverted.** The matrix is not a durable structure: matrix eval cache TTL=0
(:453-454), recomputed per request; every in-memory cache (indicator fold :9433, heavy-eval :9062,
completed-bars :2942) is an evictable LRU that dies on restart. `signal_monitor_symbol_states`
**is the matrix's persistence**: boot/SSE hydration reads it (:14685, :15903) so the matrix renders
without re-evaluating 2,000 symbols. There is nothing durable to merge it into.

Merging it into `signal_monitor_events` also fails: events is append-only/unique-keyed, while
symbol_states mutates per evaluation (trend, latestBar, MFE/MAE, fresh, barsSinceSignal) — storing
those there means a row per eval, i.e. a new firehose. And the per-cell upsert isn't incidental:
the latch/preserve read-modify-write (:7661/:7668) reads the CURRENT row to stop an older re-eval
displacing a newer signal. A periodic snapshot breaks that.

Also: symbol_states is **not a bloat source** — 88MB, upsert-bounded ~45k rows. Verdict: **keep
as-is.** Its signal-identity columns are redundant with events (reconcile :13413 rebuilds them),
which is fine — that redundancy is the crash-recovery path, not mess.

## Where the actual mess/bloat is (census numbers)

| Table | Size | Live rows | Problem |
|---|---|---|---|
| overnight_signal_expectancy_samples | **1,427 MB** | **0** | Emptied study table, never reclaimed; all 5 indexes unused |
| execution_events | 3,357 MB (2,880 TOAST) | 1.09M | jsonb payload ledger; growth now capped (EE-FIREHOSE + 48h retention, 2026-07-09) but backlog TOAST unreclaimed |
| shadow_position_marks | **288 MB** | **396** | Append+prune churn bloat; ~46MB of never-scanned indexes; writes market_value/unrealized_pnl that no reader consumes (hot peak reader :5044 reads only `mark`) |
| bar_cache | ~8.5 GB | 19.4M | Already handled: RET-1, REINDEX, WO-IDX-1 staged |
| signal_monitor_events | 145 MB | 90k | Healthy ledger; symbol_idx never scanned |
| signal_monitor_breadth_snapshots | small | — | Pure read-cache, fully derivable from symbol_states with a documented event-log fallback (:16735) |
| automation_diagnostics | — | — | **Mirrors execution_events column-for-column**, union-read with it (automation.ts:146) — two tables, one shape |

## Plan (tiers; nothing executed)

**Tier 0 — instant reclaim, no design (one maintenance window, ~1.7 GB back):**
1. `TRUNCATE overnight_signal_expectancy_samples, overnight_signal_expectancy_results` — both hold
   0 rows; truncate instantly returns 1.4 GB of pages+indexes. (Writers may run future studies;
   truncating empty tables loses nothing.)
2. `VACUUM FULL shadow_position_marks` — rewrites 396 rows, reclaims ~285 MB. Seconds of lock.

**Tier 1 — already staged elsewhere:** bar_cache natural key (WO-IDX-1, post-soak);
`VACUUM FULL execution_events` again once the 48h diagnostic retention has chewed the candidate-skip
backlog (the 2026-07-09 VACUUM FULL ran before retention had pruned much).

**Tier 2 — small WOs, worth doing (write-amplification + schema hygiene):**
3. Stop writing never-read columns: shadow_position_marks.market_value/unrealized_pnl (latest values
   already duplicated onto the live shadow_positions row in the same tx :6443) and the
   seen_signals debug columns (premium_cap/available/chain_debug_reason/expirations_debug_reason —
   dedup reader :9666 consumes only signal_key/reason/retryability). Writer-side change only;
   columns stay (cheap), rows get thinner.
4. Drop never-scanned indexes AFTER re-verifying over a longer stats window (census counters look
   post-restore, so idx_scan=0 is directional, not proof): shadow_position_marks pkey/account/position
   (~46 MB on 396 rows), signal_monitor_events symbol_idx, execution_events
   overnight_deploy_occurred. Same never-scanned-surrogate-pkey pattern as bar_cache — WO-IDX-1's
   approach generalizes here later if wanted.
5. Merge `automation_diagnostics` into `execution_events`: same shape, already union-read; the
   diagnostic allowlist retention (retention.ts:405) gives the merged table the two-lifecycle
   behavior the split was approximating. One table, one retention policy, one read path.

**Tier 3 — optional simplification:** drop signal_monitor_breadth_snapshots and serve breadth from
its documented event-log fallback; only if the fallback's read cost is acceptable at sparkline
cadence (it exists to avoid replaying events per read — measure first). Small table; low priority.

**Explicit keeps (they look like duplication but earn it):** symbol_states (matrix persistence +
latch semantics); signal_options_seen_signals (typed dedup sidecar that survives the 48h firehose
prune — this is the good pattern); events↔states identity redundancy (crash reconcile).

## Rule of thumb this study surfaced

The mess is never "too many tables" — it's **lifecycle mixing**: per-eval mutable state, per-cycle
telemetry, and forever-ledger rows sharing shapes/tables/retention. Consolidate by lifecycle, not
by subject: mutable-state tables stay upsert-bounded (fine), telemetry gets short retention +
writer coalescing (done for execution_events today), ledgers stay append-only with long retention.
Merging across those lifecycles (state→events) creates firehoses; merging within one
(automation_diagnostics→execution_events) removes real duplication.
