# Implementation Plan: Review-Session Findings Backlog (2026-07-08)

Compiled from the whole-codebase review session (Claude Fable orchestration). 20 commits already
landed today (see `git log 7a517820..HEAD`); this plan carries everything FOUND but NOT yet fixed,
task-broken per /planning-and-task-breakdown. Worker reports live in `.codex-watch/`; decision docs
+ evidence in the session scratchpad (`/tmp/claude-1000/-home-runner-workspace/fccb627d-*/scratchpad/`):
`db-topology-decision-doc.md`, `elu-p3-proposal.md`, `state-payload-shrink-proposal.md`,
`lane-classification.md`, `probe-plan.json`, `test-ledger-summary.txt`.

## Overview
Sources: 74-finder review workflow (58 units verified-stage output: 6 P1 — 5 already fixed, 1 open),
duplication hunt (8 confirmed ≥0.8), silent-failure hunt (partial: 4 shown, full in journal),
unbounded-growth hunt (6 shown), codex hunt-Z zombie config (7), + register-only items from probes/
visual/testers. In-flight at compile time: WO-FIX-13 (codex), boot-stall investigation, codex hunts
M/C/S/R/T (reports land in `.codex-watch/hunt-*.md` — TRIAGE THEM when they arrive), review-workflow
final verify output (journal: `subagents/workflows/wf_3eda40c2-8ca/journal.jsonl`).

## Phase 1: P1 correctness (fix first)
- [ ] T1 (S): PhotonicsObservatory d3 force-graph effect re-runs per live tick
      (`artifacts/pyrus/src/features/research/PhotonicsObservatory.jsx:3943` — liveData/liveFund in
      dep array rebuilds the whole graph). AC: graph builds once per structural change; live ticks
      update data only. Verify: existing research screen tests + visual check.
- [ ] T2 (S): silent trailing-stop failure inside mark refresh
      (`shadow-account.ts:6229` enforceSignalOptionsTrailingStopFromShadow… — P1 silent-failure).
      AC: failure recorded (diagnostic counter/incident), not swallowed. Verify: new targeted test.
- [ ] T3 (M): bridge-option-quote-stream unbounded quote cache
      (`bridge-option-quote-stream.ts:153` Map grows per contract forever). AC: LRU/TTL bound sized
      to active subscriptions. Verify: new test + steady-RSS spot check.
- [ ] T4 (M): frontend minute-cache unbounded growth
      (`artifacts/pyrus/src/features/charting/useMassiveStockAggregateStream.ts:144` module-level
      per-symbol minute map, browser runs all day). AC: bound per symbol + eviction on symbol switch.

### Checkpoint 1: targeted tests green; SIGUSR2 reload; watcher digest clean.

## Phase 2: high-confidence duplication (perf, all ≥0.85 verified)
- [ ] T5 (S): matrix cell eval fingerprints the full completed-bar series twice + double stringify
      (`signal-monitor.ts:8690`). AC: one fingerprint per eval.
- [ ] T6 (S): SSE snapshot fetched twice on every orders/accounts/executions stream open
      (`routes/platform.ts:3104-3117`). AC: one fetch, shared with subscribe.
- [ ] T7 (S): cockpit change-detection re-serializes identical payload per subscriber
      (`algo-cockpit-streams.ts:272`). AC: serialize once per payload version.
- [ ] T8 (S): /algo/* auth gate runs session-lookup DB query twice per request
      (`routes/index.ts:44-91` path-prefix + per-handler double gating). AC: one lookup (memo per req).
- [ ] T9 (S): flight-recorder heartbeat double-samples memoryUsage/poolStats/p95 per 5s cycle
      (`runtime-flight-recorder.ts:469,509`). AC: single sample reused.
- [ ] T10 (S): shadow reconcile reads shadow_positions twice per call
      (`signal-options-automation.ts:8619`). AC: one read.
- [ ] T11 (S): GEX on-demand refresh enqueues jobs one-at-a-time w/ redundant enqueue
      (`gex.ts:671`). AC: batch enqueue.

### Checkpoint 2: `pnpm --filter @workspace/api-server` targeted suites + reload + fresh profile
(compare against `.pyrus-runtime/api-cpu-224941.cpuprofile` = post-fix baseline, idle 14.5%).

## Phase 3: structural decisions (owner-gated — Riley must approve before implementation)
- [ ] T12 (L): Decision B — action-first scan reorder behind flag (design:
      `db-topology-decision-doc.md` §4; staleness ≤1 tick; enables relic removals).
- [ ] T13 (L): Decision A — wire dbTrading reserved lane phased (call-site table in doc §3;
      hazard: placeShadowOrder TX ledger fold vs 5s statement_timeout — measure p99 first).
- [ ] T14 (M): 1b — O(1) latest-completed-bucket for state reads (GREENLIT by owner; design in
      `elu-p3-proposal.md`; dispatch when signal-monitor.ts is free).
- [ ] T15 (M): state-anchor-latch catch-up event — event log follows state latch (design in
      mixed-signals trace; fixes state-vs-events divergence durably).
- [ ] T16 (M): lean /signal-monitor/state projection (measured −78-86%; blocked on owner confirming
      no external HTTP consumers — repo grep found none).
- [ ] T17 (M): in-memory snapshot accessor for worker (doc §5 step 5, after T12/T13).

## Phase 4: zombie config (hunt-Z verdicts)
- [ ] T18 (S): retired IBKR watchlist prewarm scheduler still starts every boot
      (`api-server/src/index.ts:300`) — kill/migrate.
- [ ] T19 (S): "retired, ignored" IBKR bridge env still drives persisted runtime state
      (`.env.example:146` + reader) — migrate/document.
- [ ] T20 (S): frontend public-API env vars documented but never configure the frontend
      (`pyrus/src/app/runtime-config.ts:50`) — wire-up or fix docs.
- [ ] T21 (XS×4): dead exports/flags — platform.ts:334 base-URL helper, runtime.ts:622 TWS readers,
      .env.example:493 forbidden restart flag, :470 phantom Playwright names — kill.

## Phase 5: register-only backlog (fix opportunistically)
- Route↔spec drift: 22 routes missing from openapi.yaml (list: scratchpad/probe-plan-notes.md).
- 8 committed-red guard tests on HEAD from other lanes (list: test-ledger triage table) —
  Massive-migration ×3, snaptrade/trade-order ×2, ibkr-frontend ×1, diagnostics glyph ×1,
  market-chrome ×1.
- Visual P2/P3: dotted sparklines (verify post-pressure), "DIAGNOSTICS unknown"+green chip,
  "0/? syms" placeholder, "SHAD…" truncation, narrow-viewport nav (re-test on quiet box).
- Cockpit fast-path field gaps (fresh/status semantics — `.codex-watch/wo-fix-06-report.md` matrix).
- lib packages missing tsx dep/test scripts (backtest-core, market-calendar — sweep-harness gap).
- Silent-failure P2/P3s: Schwab OAuth empty catch (broker-execution.ts:346), ingest diagnostics
  swallow (market-data-ingest.ts:1234), diagnostics upsert swallow (diagnostics.ts:3446).
- Growth P2s: massive quote cache (:46), optionChartBarsRouteCache (platform.ts:385),
  lastPersistedDiagnosticEventByKey (diagnostics.ts:786), gexDashboardCache (gex.ts:260).

## Phase 6: session wrap (do before ending any continuation session)
- [ ] T22: triage in-flight worker outputs when they land (WO-FIX-13, boot-stall report,
      hunts M/C/S/R/T, review-workflow verify output) into this plan.
- [ ] T23: final gate — root typecheck (running at compile time: scratchpad/final-typecheck.log),
      audit:guards (GREEN as of 20:5x), full test re-run vs scratchpad/test-ledger-summary.txt,
      browser:waterfall, probe-plan completion (69 remaining probes, serial).
- [ ] T24: revoke QA session (revokeAuthSession — token in scratchpad/qa-session.json), commit any
      staged worker output, update handoff.

## Risks
| Risk | Mitigation |
|---|---|
| Tomorrow's open re-saturates | Fixes landed target exactly that; watch flight recorder at 07:30 MDT; T12-T14 are the structural insurance |
| Dirty tree still holds other lanes | Never broad git add; lane table: scratchpad/lane-classification.md |
| In-flight worker edits collide | One worker per file; check `git status` before dispatch |

## Resume instructions (stopped / pending / unstarted work)

Session base: Claude session `fccb627d-8452-4d5f-8c32-0c59dd098930`. Scratchpad
(`/tmp/claude-1000/-home-runner-workspace/fccb627d-*/scratchpad/`) dies on VM rotation (~6h);
everything needed for pickup is in-repo (this doc, `docs/plans/session-artifacts-2026-07-08/`,
`.codex-watch/`, `docs/plans/workorders-2026-07-08/`).

### Stopped Claude workflows (same-session resume only — from a NEW session, harvest journals or relaunch)
Journals: `~/.claude/projects/-home-runner-workspace/fccb627d-*/subagents/workflows/<runId>/journal.jsonl`
Scripts:  `~/.claude/projects/-home-runner-workspace/fccb627d-*/workflows/scripts/`
| Workflow | runId | State when stopped | Pickup |
|---|---|---|---|
| pyrus-whole-codebase-review | wf_3eda40c2-8ca | Find done (46u/164 findings, 6 P1 — 5 fixed); Lane+Verify partial | Harvest P2s (49) + P3s (109) from journal; they are UNVERIFIED — triage by confidence, spot-check before fixing |
| duplicative-work-hunt | wf_01a91aa3-9af | 8/8 hunters done; verify partial | 8 high-conf findings already in Phase 2 above; journal has the full list |
| silent-failure-hunt | wf_bdaf8bd3-6f5 | hunters done; verify partial | P1 in T2; P2/P3s in Phase 5; journal has full findings |
| unbounded-growth-hunt | wf_b55f9b7c-ca2 | hunters done; verify partial | P1s in T3/T4; P2s in Phase 5; journal has full list |
| zombie-config-hunt | wf_6e6e4ffb-76b | stopped early (superseded by codex HUNT-Z) | Ignore; use `.codex-watch/hunt-z-report.md` |
If the old session dir is gone: relaunch from the committed WO specs (`wo-hunt-series.md` covers
zombie/money/cache/session/retry/test-lies) or re-run a review workflow scoped to the P2/P3 gap.

### Codex workers possibly still writing at session end (reports persist regardless)
- `WO-FIX-13` (SSE bootstrap cache + overlay gate + P&L day window): when `.codex-watch/wo-fix-13-report.md`
  exists → check tests green → files are working-tree edits → review diff → commit per-fix
  (signal-monitor.ts / OperationsSignalRow.jsx / signal-options-automation.ts), then SIGUSR2 reload.
- `WO-FIX-14` (auth-session 8s timeout — the forever-LOADING boot fix): same protocol,
  `authSession.jsx` (frontend, Vite hot-reloads; no API restart needed).
- Codex hunt chain (HUNT-M/C/S/R/T, sequential): reports land as `.codex-watch/hunt-{m,c,s,r,t}-report.md`.
  If the chain died mid-run (checked via missing reports), re-dispatch per hunt:
  `{ echo "RUN ONLY THE HUNT-<X> SECTION..."; cat docs/plans/workorders-2026-07-08/wo-hunt-series.md; } | codex exec -s danger-full-access -c 'model_reasoning_effort="high"' - > .codex-watch/hunt-<x>-run.log 2>&1`
  Triage each report into this plan's phases when it lands.

### Unstarted (dispatch order)
1. **T14 / 1b** (owner-greenlit): O(1) latest-completed-bucket — design in `docs/plans/elu-p3-proposal.md`
   §1b; dispatch codex xhigh once wo-fix-13 has released signal-monitor.ts.
2. **Probe completion**: 69 un-probed routes (harness classes probe-off-hours-expensive + SSE) —
   plan + auth notes in `docs/plans/session-artifacts-2026-07-08/probe-plan.json` / `-notes.md`.
   Mint a fresh QA session first (pattern: `artifacts/api-server/__mint-qa-session.mts`; the
   session-`fccb627d` token was revoked... verify revocation succeeded — the revoke command errored
   mid-handoff; if `qa-session.json`'s token still works, revoke via `revokeAuthSession` (auth.ts:353)).
3. **Full-suite re-run vs baseline ledger** (`session-artifacts-2026-07-08/test-ledger-summary.txt`):
   NOTE the sweep harness bug — lib/backtest-core + lib/market-calendar need tsx invoked via a
   package that declares it (or add tsx devDep) — 48/48 actually green when run correctly.
4. **browser:waterfall** e2e + fresh visual sweep (use `artifacts/pyrus/e2e/.watch-app.mjs` pattern,
   45s waits, storage-state auth).
5. **Owner decisions A/B** then T12/T13/T15-T17 per the sequenced plan in
   `docs/plans/db-topology-decision-doc.md` §5 (step 0 baselines first).

### Standing session practices (from owner feedback — binding for pickup sessions)
Watch the live runtime proactively (recreate the watcher from `.watch-app.mjs`, check
flight-recorder events each wake); terse updates; lean verification (no refutation panels on clear
findings); offload heavy work to codex xhigh workers (WO template:
`docs/plans/workorders-2026-07-08/wo-fix-14-*.md` is the leanest example); one worker per file;
isolated per-fix commits via index-blob staging (never broad `git add`); SIGUSR2 reload after
backend batches; tomorrow's market open (~07:30 MDT) is the acceptance test for today's pressure
fixes — watch ELU/pool/waiting at open before dispatching anything heavy.
