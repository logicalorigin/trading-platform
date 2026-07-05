# LIVE Recovery Note — Workstream A: Signal-Scoring Calibration Resume

- Session ID: `7ef83d19-c55c-49d4-8ad9-e26dd0290f69` (Claude Code, current; resumed from `aa463a04-7e97-4d7a-bc87-a1989311550d`)
- Created (MT): 2026-07-02 ~12:30 MDT · Updated 2026-07-02 ~14:10 MDT
- CWD: `/home/runner/workspace` · Branch `main` · HEAD `28314c4`
- Resuming: **workstream A** = dropped session `721909f1-b112-4479-8d29-91ed96a2a54b` (ends `…6a2a54b`), which resumed predecessor `f6f727e3-…-2f5aa75`.

## ROOT CAUSE FOUND + FIXED (session 7ef83d19, 2026-07-02 ~13:50-14:05 MDT — all observed)
- **D1 exact cause (Phase 0 answered): a THROW, not a skip.** `refreshSignalUniverseRanking()` failed every run in `persistSignalUniverseRanking` (signal-universe-ranking.ts:436) with PG `21000` "ON CONFLICT DO UPDATE command cannot affect row a second time": the optionable catalog had 3,288 active rows but only 3,280 distinct `normalized_ticker` (8 dups: AAL,B,BL,DVQQ,MSFT,QQQT,QQQY,TQQY — foreign listings sharing a US ticker + STK/ETF variants), and `computeSignalUniverseRanking` emitted one row PER LISTING → duplicate symbols in one upsert command. Scheduler's `.catch` only pino-warned (invisible to flight-recorder) → table stayed 0 rows forever.
- **Fix (landed in working tree + live runtime):** dedupe to one listing per normalized symbol in `computeSignalUniverseRanking` (admissible listing beats an excluded duplicate). Files: `signal-universe-ranking.ts` (+ new test in `signal-universe-ranking.test.ts`, 5/5 pass, api-server tsc clean). **NOT committed** (dirty multi-lane tree).
- **Rankings populated:** one-off tsx probe (scratchpad phase0-refresh-ranking.mts) ran the refresh → `{status:"refreshed", scored:3219, members:1900, sessions:20, rankedAt:2026-07-01T20:00Z}`. Table: 3,283 rows / 1,900 members; head = MUU,AAOI,NBIS,CRDO,… (liquidity×volatility blend, by design not pure megacaps). NOTE for one-off runs: service `wait()` timers are unref'd — a standalone script needs a ref'd keepalive interval or node exits mid-run.
- **Deployment universe re-synced automatically** (no explicit re-sync needed): `ensureDefaultSignalOptionsPaperDeployment` → `resolveDefaultSignalOptionsSymbols` → monitor profile universe → curated expansion. Deployment `7e2e4e6f` universe = 100 flow seeds + all 1,900 members (verified by JOIN: 1900/2000 member rows, 0 unranked).
- **API reloaded via SIGUSR2** (supervisor 89698, pid2-owned) → healthz 200 local+public; dedup fix confirmed in live dist bundle. Tomorrow's scheduled refresh will no longer throw; today skips `already_current`.
- **Post-fix KPI measurement 14:03 MDT** (`scratchpad/kpis-after-fix.json`, this session's scratchpad): evaluated=2000, symbolsWithBars=947 (**coverage 0.474**, was 0.344), timedOut=0, resolvedTimeframe=**15m** (was 1d), totalBars=624,987. calibration.state=`uncalibrated`, reasons=**[`coverage_degraded`] only — `min_observation_count` CLEARED**. candidateModelKey=`evidence-weighted-v2`.
- **Phase 3 justified + firing (observed ~14:20-14:30 MDT):** per-timeframe massive-history coverage of the new 2000-universe: 1m=1334, 15m=947, 1d=482, 5m=464, 2m=78. Monitor MTF only evaluates [1m,2m,5m] and the KPI chain reads 5m (RTH) / 15m (after-hours freshness fallback) — NOTHING routinely hydrates 15m broadly, so organic convergence to 0.98 won't happen. KPI read facts: barsPerSymbolCap=720, BAR_FETCH_HARD_BUDGET_MS=480s, gate = coverage≥0.98 AND timeoutRatio≤0.01 (signal-quality-kpis-service.ts:584-617; when unsupported it forces recommendedModelKey=null).
- **Backfill run 1 (blvfw3oan, killed by 55-min watchdog at ~15:21 MDT):** got through ~850/1053 of the 15m pass → **15m coverage 1,763/2000 (0.88)**, 5m pass never started. Two failure modes observed: (a) intermittent DB statement timeouts (PG 57014) on batched bar_cache upserts trigger the store's 15s backoff during which persistMarketDataBars returns false (64 symbols "skipped"); (b) pace degraded mid-run under DB pressure so 55 min wasn't enough.
- **In flight — backfill run 2 (task bvtlqbl13, ~15:30 MDT):** same script (`scratchpad/phase3-backfill-bars.mts`, this session's scratchpad) with persist-retry (wait out the 15s backoff, retry ×2 from memory, no refetch) and 100-min watchdog. Fresh lists: 15m missing=237 (runs first — the after-hours gate reads 15m), 5m missing=1537. Monitor b77m0vvle on pass boundaries. Phase 4 after the 15m pass: KPI route with retry-until-admitted (route sheds 429 under pressure; single attempts at 14:15/14:25/14:35 all shed), expect coverage ≥0.98 after-hours, then read calibration.state/reasons/recommendedModelKey.

## Why this note exists
A container reset at ~12:17 MDT wiped `721909f1`'s transcript AND its `subagents/workflows/` dir.
Workflow resume is **same-session-only**, so its in-flight diagnostic **`wf_39bc9501-69a`** (6 investigators, ~50% done) is **unrecoverable** — it can only be re-run. The predecessor's committed work is intact in git.

## The workstream (goal + blocker)
- **Goal:** signal-quality KPI **coverage ≥ 0.98** (+ timeout ratio under `MAX_CALIBRATION_SYMBOL_TIMEOUT_RATIO`) on deployment **`7e2e4e6f-749f-4e65-a011-87d3559a23b0`** ("Pyrus Signals Options Shadow") so the calibration gate clears `state: "coverage_degraded"` and **`balanced-sot-v2`** can become `recommendedModelKey`.
- **Blocker:** ~**536 of 2000** universe symbols return ZERO bars → coverage stuck < 0.98 (536/2000 ≈ 26.8%, far above the 2% structural-exclusion threshold → smells like a hydration/gating bug, not benign delistings).

## Verified coordinates (source @ HEAD 4fd20ca)
- Coverage service: `artifacts/api-server/src/services/signal-quality-kpis-service.ts`
  - `getDeploymentSignalQualityKpis` (~715-838): `coverage.symbolsWithBars / evaluatedSymbolCount` vs `MIN_CALIBRATION_SYMBOL_COVERAGE_RATIO=0.98` (~line 60). Covered iff `loadBarsForSymbols` returns `bars.length>0`.
  - Bars read: `loadSymbolBarsChunk` (428-497) → table **`bar_cache`** filtered by `(symbol, timeframe=<resolved tf>, source=BAR_CACHE_SOURCE, starts_at >= now − ROLLING_WINDOW_DAYS)`. Zero-bar = no matching rows. **Suspect: a read/write (timeframe,source) mismatch vs the ingest writers.**
  - Timeframe fallback chain 744-776; timedOut path when `BAR_FETCH_HARD_BUDGET_MS` deadline hit.
- Universe: `deployment.symbolUniverse` (2000), `selectSignalQualitySymbols` (MAX_SYMBOLS=2000). Source: `signal-universe-ranking.ts`; table `signalUniverseRankingsTable` (`lib/db/src/schema/signal-monitor.ts:180`).
- Massive provider suspects: `providers/massive/market-data.ts`, `services/market-data-admission.ts`, `market-data-ingest.ts`, `market-data-work-planner.ts`, `scripts/run-market-data-worker.mjs`.
- DB: external Postgres, `DATABASE_URL` set, `psql "$DATABASE_URL"` works. Route: `GET /api/algo/deployments/:id/signal-quality-kpis` (`routes/automation.ts:263`).

## Current live state
- App UP (healthz 200, supervisor pid 450, API child restarted ~12.5 min before 12:28 MDT).
- API was under **HIGH resource pressure** (KPI route shed with 429) until ~12:50 MDT; poll `bllihedj4` got the route ADMITTED on attempt 9 → pressure easing, quiet window opening.
- **AUTHORITATIVE coverage measured 12:50 MDT** (`scratchpad/kpis-now.json`): evaluated=2000, **symbolsWithBars=688 → 1,312 ZERO-BAR (coverage 0.344)**, symbolsTimedOut=**0** (NOT a timeout problem), resolvedTimeframe=**1d** (usedFallback=true), totalBars=40,955. **calibration.state=`uncalibrated`**, recommendedModelKey=None, reasons=[`coverage_degraded`, `min_observation_count`].
- REVISION vs handoff: the blocker is **1,312 zero-bar (66%)**, not 536 — coverage collapsed to 34%. Two gates now fail (coverage + min_observation_count). Timeout ruled out → genuinely missing/mis-keyed `bar_cache` rows at (1d, source, window).

## In-flight background jobs (this session)
- **Diagnostic workflow** `wf_8a8e14b5-b24` (task `w8hepyj9d`) — replaces wiped `wf_39bc9501`. Transcript dir: `/home/runner/.claude/projects/-home-runner-workspace/aa463a04-…/subagents/workflows/wf_8a8e14b5-b24`. Script: `…/workflows/scripts/zero-bar-hydration-rootcause-wf_8a8e14b5-b24.js`.
- **Coverage poll** background bash `bllihedj4` → writes `…/scratchpad/kpis-now.json` + `kpi-poll.log` (retries KPI route until non-429, up to ~50 min).

## CONSOLIDATED DIAGNOSIS (verified from source + live DB `heliumdb`, 4/6 investigators + own reads)
Coverage is 34% (688/2000), calibration.state=`uncalibrated`, reasons=[`coverage_degraded`,`min_observation_count`]. THREE compounding defects; **D1 is causal, D2/D3 are largely downstream of it.**

- **D1 (ROOT) — universe is alphabetical junk, not liquid.** `signal_universe_rankings` = **0 rows**. `loadSignalMonitorCatalogExpansionSymbols` (`signal-monitor.ts:3764-3814`) builds the universe via `LEFT JOIN signal_universe_rankings ORDER BY member DESC NULLS LAST, rank ASC NULLS LAST, normalizedTicker ASC`. Empty table → all member/rank NULL → order collapses to **pure alphabetical** (A=487,B=241,C=256… N–Z≈40). Tail = illiquid never-requested names. Scheduler IS wired (`index.ts:310`, import :37) but `refreshSignalUniverseRanking` (`signal-universe-ranking.ts:464-545`) is skipping/erroring. Ruled out: `no_optionable_listings` (3,235 optionable exist) and `massive_not_configured` (MASSIVE_API_KEY set). Prime suspects: `insufficient_sessions` (fetchTrailingSessions < SIGNAL_UNIVERSE_MIN_SESSIONS) or a throw. **Exact reason = Phase 0.**
- **D2 (amplifier) — on-demand-only hydration.** massive-history bars written ONLY on the getBars path (`platform.ts:10311` → persistMarketDataBars `:10693`), fire-and-forget, NO bulk backfill, NO provider gate/negative-cache (massive-gating lens confirmed). Illiquid alphabetical-fill names never requested → 227/2000 zero bars under ANY source over 90d; union ceiling only 90%. NOT warmup (persistent).
- **D3 (amplifier) — coverage read-path timeframe/freshness.** Fallback chain `[5m,15m,1h,1d]` (`signal-quality-kpis-service.ts:744-776`) never reads **1m** (where 1581 symbols have data); market-hours freshness gate `signalQualityBarWindowFresh` rejects lagged 5m/15m/1h → resolves to **1d = 0.343**. `timedOut=0`. Constants: BAR_CACHE_SOURCE='massive-history' (:35), ROLLING_WINDOW_DAYS=90 (:42), gate 0.98 (:60).

Cascade insight: fixing D1 → liquid top-2000 are actively evaluated by the monitor (hydrate on-demand → D2 shrinks) AND have fresh fine-timeframe bars (read-path resolves off 1d → D3 shrinks). So sequence the fix.

## FIX PLAN (sequential; re-measure between phases)
- **Phase 0 — pin the skip reason (decisive).** Invoke `refreshSignalUniverseRanking()` once (one-off tsx/node script importing the service, or a guarded dev trigger); capture returned `{status,reason}`. `refreshed`→jump to Phase 2. `skipped:insufficient_sessions`→fix `fetchTrailingSessions`/massive grouped-daily. Throw→read error.
- **Phase 1 — populate rankings + propagate to deployment.** Resolve the Phase-0 blocker so the table fills (ranked liquid members). Confirm `count(*)>0`. Then verify whether deployment `symbol_universe` auto-regenerates from `loadSignalMonitorExpansionUniverse` (`signal-monitor.ts:3826`) or is a frozen snapshot needing an explicit re-sync; ensure the deployment evaluates the liquid top-2000 (head = SPY/NVDA/… not AQST/AQWA…).
- **Phase 2 — re-measure** KPI endpoint in a quiet window: coverage, resolvedTimeframe, calibration.state, reasons, recommendedModelKey.
- **Phase 3 (only if coverage still <0.98):** D3 read-path — add 1m / pick best-covered fresh (tf,source), or fix market-hours freshness. CAVEAT: changing read timeframe alters KPI observation-horizon semantics (outcomeHorizonBars in bars) and interacts with `min_observation_count`. D2 backstop — bounded one-shot bulk backfill of the 2000 universe.
- **Phase 4 — verify calibration clears:** coverage≥0.98, timeoutRatio≤gate, state≠coverage_degraded, `min_observation_count` cleared, and whether `balanced-sot-v2` becomes recommendedModelKey.

Open risks: exact skip reason (Phase 0); deployment universe auto-sync vs frozen; the second `min_observation_count` gate may need separate attention; read-timeframe change vs horizon correctness. NOTE: workflow synth+verifiers did not run (stopped at 4/6); the two load-bearing mechanisms were independently source-verified and warmup was ruled out by evidence.

## Next steps (from 721909f1 handoff)
1. Read workflow root cause → confirm (verified) the cause of the 536 zero-bar failures → apply remediation (fix massive gating / clear negative cache / extend `signal_universe_rankings` exclusions only if structurally barless AND >2%).
2. Re-hydrate missing symbols; re-run KPI warm; target ≥98% coverage & ≤1% timeouts → check `calibration.state` + whether `balanced-sot-v2` becomes recommended.
3. Deferred (from f6f727e3): python signal_matrix offload idle; post-warm quiet-window runtime (steady ELU vs 0.75 gate, 1m emission latency median <15s); `index.ts` wiring for `startSignalUniverseRankingScheduler`; cost-hurdle wiring + spread units; `mtfFilteredOutCount` tooltip copy.

---

## ZERO-SELLS ROOT CAUSE — VERIFIED (session d88afe9c, 2026-07-04 evening, all observed unless tagged inferred)

Resumed the dropped `6dcb43c8` sub-thread ("diff why no sells vs a few days ago"). Full causal chain now proven from DB + deterministic replay:

**Data diff (observed, DB):** buy_put shadow entries fired 2026-06-29 (4) and 2026-07-01 (4); ZERO on 07-02/07-03. Last sell = META 07-01 15:54 ET. Sell SIGNALS were still generated 07-02 (1m sell=1643) and reached the gate as candidates.

**Why blocked (observed, production's own entryGate records):** July-2 live sell candidates were blocked `mtf_not_aligned`. The gate consults the LIVE matrix trend (`getTrendDirectionsForSymbol`), and it saw falling symbols as BULLISH: `[1,1,1]`=157 events/38 syms, `[0,1,1]`=91/33; NOT ONE reached `[-1,-1,-1]`; most `matches=0`. `requiredMtfCount=3` (config `signalOptions.entryGate.mtfAlignment.requiredCount=3`).

**Matrix was wrong (observed):** frozen `signal_monitor_symbol_states` shows VICR(-5%), RGC(-5.5%), CODX(-5.2%), TROO, STEX(-9.9%), ELTX all `trend_direction=bullish` on 1m/2m/5m despite hard declines. Two coverage failure modes visible in `latest_bar_at`: some cells went STALE mid-afternoon (OM/STEX 5m frozen 16:25 ET), others updated through close but still bullish (unwarmed-basis case).

**Mechanism (proven, replay):** `basisLength=80` ⇒ `evaluation.trendBasisComputable` false below ~85 bars. Window sweep (`__replay-window-sweep.mts`): below 85 bars OLD rule returns bullish-from-seed for fallers; the shipped NEW rule (`trendBasisComputable` guard, signal-monitor.ts ~5683-5697) returns null (or bearish where CHoCH latched); at ≥90 bars both return the true BEARISH trend. On dense 240-bar July-2 slices, old==new on 40/40 decliners (attribution replay `__replay-sell-attribution.mts`: req3→29-32 pass, req2→37 pass; 0 frames flipped).

**Root cause (inferred, high confidence):** ticker-2000 rollout `533b76c` landed 07-02 09:09 MDT — same session sells died. The 2000-symbol universe starved matrix cells of bars (<85 → unwarmed → bullish seed, or stale), painting the book bullish; the gate correctly refused to sell a "bullish" book. Sells worked 06-29/07-01 on the smaller/more-liquid universe (cells stayed warm). This is the SAME coverage problem as Workstream A's KPI coverage<0.98.

**Implication:** the shipped trend-basis fix converts false-bullish→null (stops false BUYS; live-confirmed — cells re-hydrated 07-04 read null not bullish) and yields bearish via CHoCH pre-warmup, but reliable SELL restoration needs ≥85 dense bars/cell (coverage). `requiredCount=3` is a secondary strictness lever. All fixes are BUILT INTO LIVE DIST (14:15 build, API child born ~14:16) but UNCOMMITTED (signal-monitor.ts +324, signal-options-automation.ts +637 in the dirty tree).

**Artifacts (this session's api-server/src/services, temp __replay-*.mts):** `__replay-sell-gate.mts`, `__replay-sell-attribution.mts`, `__replay-window-sweep.mts`. Adversarial verification workflow `wf_299a2a8f-7b6` running (source-truth path faithfulness, alternative-cause, fix-efficacy/regime).

**Unverified link:** live-time (07-02) bar counts per cell were <85 — inferred from book-wide-bullish signature + known poor coverage + rollout timing; not directly proven (current bar_cache is post-backfill dense). A live-market Monday check or a historical bar-count snapshot would confirm.
