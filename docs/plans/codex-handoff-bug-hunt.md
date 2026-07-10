# Handoff → Codex: pyrus bug hunt + fixes (2026-06-11)

Context for whoever (Codex) continues this. A session investigated "Replit keeps
disconnecting," fixed the real cause (DB bloat / unscheduled retention), then ran
a trading-correctness bug hunt. This doc is the work-list + how to work here.

---

## TL;DR status

- **Container disconnects**: root-caused as **Replit infrastructure recycling the
  container on a ~6h clock**, NOT app code. See `docs/plans/pyrus-container-drop-*`
  and the memory note. The real lever is a Replit always-on/reserved deployment
  (account-side), not a code change. The DB cleanup below was a separate, real
  problem that was also fixed.
- **DB retention**: one-time cleanup executed live (bar_cache 90d / option_chain 7d);
  recurring auto-cleanup **merged to main** (was branch
  `fix/market-data-retention-sweep`, commit `8cdce49`).
- **Bug hunt**: 4 parallel hunters, findings adversarially verified. **Three fixes
  are merged to `main`** (below); the rest are an open TODO further down.

## Fixes already merged to `main` (all on `origin/main`, branches deleted)

| Commit | What | Test |
|---|---|---|
| `8cdce49` | market-data-worker scheduled batched retention (6h) + bar default 90d | (Rust) |
| `8d7d7a4` | realized P&L uses the contract multiplier (not hardcoded 100), matches the unrealized path; daily P&L now coherent for non-100 contracts | `node:test` realized-pnl test |
| `67960ca` | CRITICAL: dedup guard for duplicate exit events / double-counted realized P&L (worker scan vs tick-manager race) | `node:test` race-guard test |

The two signal-options fixes share `signal-options-automation.ts`; they were merged
in order (multiplier ff, then dedup cherry-picked + conflicts resolved) so the
merged exit branch is `dedup guard → try → insert(multiplier pnl) → catch(release
claim) → exited`. Current `main` head: `67960ca`. Full suite (15 tests) +
api-server typecheck pass on the merged tree.

## How to work in this repo

- **Run the signal-options tests**:
  `cd artifacts/api-server && node --import tsx --test src/services/signal-options-automation.test.ts`
- **Typecheck api-server**: `pnpm --filter @workspace/api-server run typecheck`
- **Rust worker**: build via `node scripts/run-market-data-worker.mjs check -p market-data-worker`
  (uses nix-shell for cargo; `build --release -p market-data-worker` for the binary).
- **Tests use** Node's built-in `node:test` + an `__signalOptionsAutomationInternalsForTests`
  export. `insertSignalOptionsEvent` / DB writers are NOT injectable, so prefer
  factoring pure helpers and unit-testing those (that's how both fixes here were verified).
- **Constraints**: this is a LIVE trading app on a remote shared Postgres
  (`PGHOST=helium`). Destructive DB ops are classifier-blocked for the agent and
  must run as the user. Do trading-logic changes on a branch + regression test +
  human review, never auto-merge. Markets-open caution for anything heavy.
- Do NOT touch `.replit`, `artifacts/*/.replit-artifact/artifact.toml`, dev scripts,
  or `scripts/reap-dev-port.mjs` without running `pnpm run audit:replit-startup`.

---

## TODO — verified findings, not yet fixed (prioritized)

Each is verified (file:line confirmed). Same delivery pattern: branch + regression
test + typecheck + leave for review.

### 1. Rust worker: HTTP client has no timeout (job lease wedges forever) — LOW risk, clear
`crates/market-data-worker/src/main.rs` ~341, ~403: `reqwest::Client::new()` sets no
timeout. A hung provider fetch holds the job lease (renewed every `lease_ms/3` with
no max-runtime cap) indefinitely, blocking that symbol's pipeline.
**Fix**: `reqwest::Client::builder().timeout(Duration::from_secs(N)).build()`
(N ~ 30). Consider a max-attempts/total-runtime cap on the heartbeat renew.

### 2. Harden the just-merged retention sweep — LOW risk, my own code
`crates/market-data-worker/src/{retention.rs,main.rs}`. The 6h background sweep:
(a) dies silently+permanently if `run_retention` ever panics (detached `tokio::spawn`,
only `Err` is logged, a panic kills the task with no respawn); (b) inner delete loop
has no per-table iteration cap (could spin on a hot table that backdates `as_of`);
(c) no advisory lock vs. concurrent worker instances on the 2-conn pool.
**Fix**: wrap the loop body so a panic is caught + the loop continues (or supervise +
respawn); add a per-table max-iterations break; wrap the sweep in
`pg_try_advisory_lock`. Bump `MARKET_DATA_WORKER_DB_POOL_MAX` (currently 2) as a
follow-up after checking remote `max_connections`.

### 3. Option-chain > 80 pages drops the ENTIRE chain + fails permanently — MED risk (changes ingest semantics)
`crates/market-data-worker/src/main.rs:449` (`ensure_complete_option_chain` `bail!`s
BEFORE `persist_option_chain_snapshots`); truncation flagged in
`providers/massive.rs:188`; error classified non-transient at ~589. For wide names
(SPX/SPY) GEX gets no fresh chain at all.
**Fix**: persist the partial chain and mark source_status `partial` instead of bailing
(or raise `option_chain_max_pages`). Confirm GEX consumers tolerate partial chains
before changing.

### 4. Backtest Sharpe/Sortino/vol use √252 on per-minute equity (~20× off) — MED, verify first
`lib/backtest-core/src/analytics.ts:92-115,299-300`; per-minute equity built in
`artifacts/backtest-worker/src/index.ts:928-940`. Annualization assumes 1 return =
1 day, but options runs use 1-minute quote-replay (~390 pts/day).
**Fix**: derive periods-per-year from the study timeframe (e.g. `252*390` for 1m).
**Verify** the per-minute claim against a real run before changing; this moves every
options backtest's headline risk stat (ranking unaffected, absolute values change).

### 5. Stale IBKR positions/balances shown to UI as "live" — RESOLVED 2026-07-10
The Account bridge now keeps only its short fresh TTL and in-flight joining. Expired
account, position, execution, and order reads wait for the current broker result and
propagate upstream failures; the stream and route layers no longer replay stale rows
or turn failures into empty successful payloads.

### 6. `tightenAtFiveX` trailing giveback (30%) looser than base (25/20%) — LOW, config
`signal-options-exit-policy.ts:432-437`; defaults `lib/backtest-core/src/signal-options.ts:267-269,358-360`.
The 5× "tighten" tier gives back MORE of peak than the base tier (inverted). 10× tier
(15%) is correctly tighter.
**Fix**: set `tightenAtFiveXGivebackPct ≤ trailGivebackPct` (e.g. 20), or assert
`tenX ≤ fiveX ≤ base` when resolving the profile. Changes live exit timing — confirm
intent with the strategy owner.

### 7. Lower-priority (verified, smaller blast radius)
- Live dashboard `netGex`/zero-gamma include EXPIRED contracts; persisted path filters
  them → flip strike disagrees by source. `gex.ts:1490-1493` vs `:1273-1276`.
- Massive authoritative bars vs quote-derived bars collide on the same `symbol:startMs`
  key and clobber non-deterministically. `stock-aggregate-stream.ts:597-608`.
- Shared completed-bars in-flight promise bakes in one caller's AbortSignal; a
  disconnect rejects it for other SSE clients. `signal-monitor.ts:4862-4868`.
- Covered-call validation falsely blocked (HTTP 409) under order-read contention
  (`orders` governor concurrency 1). `platform.ts:2967-2988` → `:4421-4438`. Safe
  direction (blocks rather than mis-classifies), availability bug only.
- ×100 entry/premium sizing (`premiumAtRisk`) — `signal-options-automation.ts:3873,5585,14122`
  and `:14547` (candidate preview). Same latent multiplier question as fix #2 above
  but in SIZING, deliberately left out of the merged realized-P&L multiplier fix
  (`8d7d7a4`). Decide whether sizing should track the real multiplier before
  touching (affects position sizing / risk limits).

## Cleared as correct (don't re-flag)
Order placement is single-shot (no retry/dup); overnight auto-executor reads LIVE
positions + sound deterministic `clientOrderId` dedup; paper/live cache isolation
(keys include `mode`); core GEX sign math (call=+1/put=-1, `spot²·0.01`); backtest
×multiplier applied once with no same-instant lookahead.

## Diagnostic-tool caveat
`.pyrus-runtime/flight-recorder/incidents.jsonl` mislabels abrupt supervisor kills as
`api-child-exit code=143` (stale `lastRelevantChildExit` fallback in
`flightRecorder.mjs`). Don't trust that label. Real evidence: per-run console in
`.local/state/workflow-logs/<runId>/`, `scripts/diagnose-agent-restarts.mjs`,
`/api/diagnostics/latest` (storage stats).
