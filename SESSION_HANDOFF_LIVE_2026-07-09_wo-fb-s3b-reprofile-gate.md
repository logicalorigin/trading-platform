# Session Handoff Live: perf root-cause program (resume of f834d411) — FLEET STATE ~10:55 MDT

- Session ID: `addde099-628b-4ac6-bc1b-04197cb22d86` (resuming workstream from `f834d411`)

## AUTOSAVE ~12:20 MDT — LATEST STATE (append; supersedes older fleet block below)
- **5m signal fix (the deliverable) IN PROGRESS**: root cause = retention sweeper's 6h cadence never survived today's ~12 restarts → 2.6M stale intraday bar_cache rows never drained → 8.3GB table → slow 5m/15m reads → 15m cells starving (138/6701 fresh). Manual batched psql drain RUNNING (scratchpad/drain-loop.sh, 20k/batch): dead_tup 390k→1.89M, live 20.5M→19.09M. VACUUM(ANALYZE) watcher armed → auto-fires on drain end → writes 5m EXPLAIN timing to .codex-watch/run-vacuum.log (THE acceptance number). RET-1 (drain-to-done scheduler, commit 11811b78) prevents recurrence.
- **Adversarial review of all landed commits DONE** (parts 1+2 + P2 re-derive). 9/11 SOLID. Found: P1 live-order guard gap (SEC-1 — LANDED, verify commit); P2s: BTL studyId NOT NULL (folded into BTL-2), account-detail user-scope (WO-P2-ACCTSCOPE, gated), expanded-limits save button (WO-P2-EXPLIMITS, running). Flex dispute RESOLVED — codex c7d3ad67 correct, my AM verifier wrong.
- **240-vs-1000 signal finding**: TWO evaluators — universe eval=1000 bars (authoritative), matrix/live-grid eval=240 bars (:10654 slice). Indicator warmup diff negligible (~5e-8); real edge = structure/regime LOOKBACK differs → grid could disagree with authoritative on structure signals. Riley APPROVED an output-diff investigation (read-only) — dispatching now as WO-SIGDIFF.
- **LOGJAM**: 6 hot service files (shadow-account/signal-monitor/platform/account/signal-options-automation/market-data-store) held by sibling sessions 71069931 (mirror-repair) + 9627dd6f (QA fix-shards) → gates EQH-1, EE-FIREHOSE, SHD-FANOUT, SME-1, PRS-1, ACCTSCOPE, S3B-2/3, BTL-2 (all auto-fire on clean). Highest-leverage unblock = those sessions committing.
- **AGENTS.md fixed (bab66419)**: REPLIT_MODE=workflow restart retired repo-wide (was the kill-storm mechanism). Reloads = SIGUSR2 + same-supervisor-pid check.
- 9 unpushed commits. Decisions pending Riley: (1) execution_events VACUUM FULL window after EE-FIREHOSE+retention; (2) incremental-eval shadow→on flip after soak (runbook docs/plans/incremental-eval-rollout-runbook-2026-07-09.md).

## CURRENT FLEET (dispatch ticker: .codex-watch/fb2-chain-status.log; WOs in docs/plans/workorders-2026-07-09/)
- LANDED (isolated commits, reports in .codex-watch/): 241e047d+3f89d51f (algo SSE/empty-state + hotfix),
  5e19cc84 (recompute memo), 26f1fba5 (F2A LRU bound), 193cd181 (parity fixtures; warmup verdict "none
  below 1000" — F1c dead), 18d151af (F4A fingerprint memo), fe6217e2 (F1B split counters; diagnosis =
  cycle starvation, cache layer sound), dffa255e (S3B-1 incremental evaluator, byte-identical),
  2fda13f3 (BUS-1 admission scheduler), c96f6c8e (BUS-3A auth memo). F1A resolved-DISPROVEN (no commit).
- RUNNING: BUS-2 (lane tagging; census-final table in its WO), BTL-1 (backtest-ledger mapping+schema),
  S3B-2 (incremental wiring; gated on signal-monitor.ts clean), EE-BLOAT (gated on codex-lane files),
  review-part-1 (adversarial review over the 10 landed commits).
- PARKED: BUS-3B — premise disproven live (8 upserts/min vs claimed 2-3.5k/min); re-measure at open.
- NEXT: review-part-2 (stragglers) → reload + docs/plans/runtime-verification-runbook-2026-07-09.md
  (task #8; NEW same-supervisor-pid-after-SIGUSR2 guard) → incremental-eval rollout (shadow soak → on)
  → BTL-2..5 per docs/plans/backtest-ledger-separation-2026-07-09.md (PnL-identity proof gates purge).
- RILEY DECISIONS PENDING: VACUUM FULL window for execution_events; push of ~15 unpushed commits.
- Coordination file: .codex-watch/qa-campaign-2026-07-09/COORDINATION-claude-addde099.md. DB census:
  workflow wf_d46c26fe-e6a (122 ops). Instability: 9 supervisor tree-kills 14:00-15:02Z then quiet —
  see rootcause doc instability appendix.

## (original gate note follows)
- Saved at: 2026-07-09 07:31 MDT
- CWD: `/home/runner/workspace`
- Workstream: signal-monitor perf ("Fable-B"). The only open item from f834d411 was the **s3b re-profile decision gate** (Steps 1 & 5 already landed by later sessions: gap-throttle = commit `970d0d19`; gapped-cell emission decision = `5c90f88e` "leave as-is").

## Done this resume
- Warm CPU profile of live API pid 325 at market open (`scripts/diag/cpu-profile-running-api.mjs 325 20000`).
- **s3b gate MET** → decision recorded in `.codex-watch/wo-fb-s3b-decision.md`. Headline: **GC 32.6%** of busy CPU (≫10% gate), aggregation-inclusive cluster ~20%, heap 2163/2752 MB (79%), DB pool pegged 12/12 + ~44 waiters, apiPressure=high at open.
- Profiler gotcha found: its 500ms settle is too short on the saturated event loop; SIGUSR1 needs ~2s to bring up :9229. Re-signal is idempotent — run it twice or bump the wait.

## Direction change (Riley, 2026-07-09 ~07:40 MDT)
Riley: NO band-aid fixes (no heap-cap raise, no pool widening) — identify/trace the errant code and app behavior. Saved to Claude memory (`no-bandaid-fixes-root-cause-only`). The repo agrees: `lib/db/src/index.ts:206` — pool of 12 is deliberate; "relief comes from reducing demand, not raising this."

## Root-cause evidence gathered (live API pid 325, market open)
- Allocation sampling (scratchpad `alloc-profile-running-api.mjs`, 20s, CDP HeapProfiler): **50.7% of ALL allocation = node-postgres `_parseRowAsArray`** — DB row materialization dominates GC churn. Second cluster: signal recompute (`evaluatePyrusSignalsSignals` 17.8MB incl, `flushSignalMonitorMatrixStreamAggregates` 40.5MB incl).
- Heap spaces (`process.report`): old_space used **1596MB retained**, large_object_space 65MB, limit 2752MB. Heap sawtooth 1680↔2000MB → ~1.6-1.7GB long-lived retained set makes every major GC expensive.
- pg_stat_activity (3 samples): concurrent `select "starts_at","open"::float8,... from "bar_cache"` pinned IO:DataFileRead 2-3.5s; bar_cache INSERTs in LWLock:WALWrite; **one orders-like query 15s in Client:ClientWrite then 19s `idle in transaction (aborted)`** — Postgres blocked sending results because the saturated node loop isn't draining the socket (feedback loop pinning pool connections).
- pg_stat_statements not loadable (needs shared_preload_libraries).

## FIXES LANDED (session addde099, ~08:00-08:50 MDT)
- `241e047d` fix(algo): shared SSE freshness registry (sidebar's permanent "polling" + 30s REST catch-up ends; algo empty-state distinguishes failed fetch from empty list — the "should be seeded at startup" false message).
- `5e19cc84` perf(shadow-account): per-order analytics-classification memo — recompute stops re-reading all 1,894 orders' ~4KB payloads (8.8MB) per execution event; generation-guarded invalidation at the one mutation site. Tests 5/5, tsc 0.
- SIGUSR2 in-place reload at 14:35:56Z loaded both. **Post-fix profile (measured independently by the codex QA agent on the new pid): GC 9.1% (was 32.6%), _parseRowAsArray 8.8% (was 50.7%).** Pressure still "high" (pool 12 active / ~24 waiting) — remaining demand = F1 universe re-reads + execution_events bloat.
- Coordination with codex QA campaign: `.codex-watch/qa-campaign-2026-07-09/COORDINATION-claude-addde099.md` (advisory locks, reload segmentation notice, execution_events correction: 2,188 rows / 3,365 MB, bloat is heap/TOAST not indexes — remediation owner unassigned).
- Tasks #3-#8 (F1a/F2a/F4a/F1b, gated F1c+s3b, runtime verify) still open; F1a next.

## COMPLETE — root cause traced end-to-end
- Workflow `wf_e1e132c6-00f` (4 readers) returned file:line-grounded traces for all four threads.
- **Full synthesis written to `docs/plans/signal-monitor-gc-pool-rootcause-2026-07-09.md`** — verified causal chain: universe warmup re-reads (limit=1000, 15m/1h/1d always miss memory; universe completed-bars cache still keyed on queryTo — a876dd01-class bug) → _parseRowAsArray 50.7% alloc → GC 32.6% (expensive due to ~1.6GB retained across 3 overlapping bar caches, one UNBOUNDED: signalMonitorBackfilledBaseByCell signal-monitor.ts:5485) → loop saturation → ClientWrite stalls/57014/aborted-tx (shadow-account.ts:14232 unbounded full-row orders select inside placeShadowOrder tx; tradingPool is DEAD CODE) → pool pinned, waiters 28-65.
- LIVE INCIDENT during the session: API pid 325 died ~14:00Z with no exit event; supervisor tree replaced abruptly 14:00:03Z AND 14:03:04Z (lifecycle log `previous-run-classified: supervisor abrupt`); replacement API re-inflated to 1.9GB RSS in <3 min. Kill mechanism UNVERIFIED. Current supervisor pid2-owned, preview attached, web/api 200.
- s3b gate result recorded in `.codex-watch/wo-fb-s3b-decision.md` (gate MET; from-scratch recompute now also CONFIRMED at source: pyrus-signals-core index.ts:1164-1200).
- Fix directions F1-F4 (demand-reducing, ranked) in the rootcause doc — AWAITING RILEY SIGN-OFF on which to dispatch. Quick unverified items worth closing first: prefetch-fallback counters (signal-monitor-local-bar-cache.ts:1515-1517), live cache hit-rates (signal-monitor.ts:9205,9298).
