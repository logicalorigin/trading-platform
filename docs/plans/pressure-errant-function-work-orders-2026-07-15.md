# Implementation Work Orders: Pressure and Errant-Function Remediation

**Date:** 2026-07-15
**Status:** Approved for orchestrated implementation by the user
**Source plan:** `docs/plans/pressure-errant-function-remediation-2026-07-15.md`
**Leader:** `codex-pressure-supervisor-6439`
**Worker vertical:** Codex `gpt-5.6-sol` only, with varied reasoning effort
**Commit policy:** Workers do not stage or commit. The leader reviews and integrates each slice.

## Overview

This document converts the pressure investigation into small, test-first work orders. Each task owns no more than five files, has a failable verification command, and leaves the repository in a working state. Shared hot files are serialized. Independent files may be edited in parallel only after the leader confirms ownership on the local coordination bus.

The first implementation target is the confirmed five-second closed-option reconciliation loop. Signal Matrix startup and serialization come next. Diagnostics, backfill, stream polling, WAL churn, smaller CPU paths, and retained-bar compaction follow in dependency order.

## Architecture decisions

- Remove demand at its creator. Do not increase pool size, heap limits, or pressure thresholds.
- Keep open option expiration and force-stop safety checks on the five-second cadence.
- Make historical closed-position reconciliation exceptional: startup, explicit repair signal, and slow fallback.
- Preserve all six Signal Matrix timeframes on one connection. Deliver critical STA timeframes first inside that connection.
- Keep diagnostic process metrics frequent, but move expensive and mutating probes to slower read-only paths.
- Skip identical metadata writes with database predicates instead of application-side pre-read loops.
- Compact retained bars only after parity fixtures prove source, delayed, partial, daily-close, and signal identity semantics.
- Apply Full Ponytail: reuse current helpers, add no dependencies, choose the shortest root-cause diff, and leave one runnable check for every non-trivial branch or loop.

## Dependency graph

```text
Rule + plan + ownership ledger
  |
  v
Phase 1: option maintenance contract -> bulk reconciliation -> creator invariant
  |
  +------------------------------+
  |                              |
  v                              v
Phase 2: one Signal stream       Phase 3: diagnostics split
  |                              |
  v                              v
shared SSE serialization         bounded diagnostics SSE
  |
  v
minute-ring/currentness reuse -> due-first backfill
  |
  +------------------------------+
  |                              |
  v                              v
Phase 4 DB/WAL fixes             Phase 5 smaller CPU/cache fixes
  |                              |
  +---------------+--------------+
                  |
                  v
Phase 6 parity fixtures -> retained-bar compaction -> matched soak
```

## Worker model matrix

| Work type | Codex profile | Use |
|---|---|---|
| Trading, ledger, signal identity, concurrency | `gpt-5.6-sol`, `high` | Phases 1, 2 shared fanout, 6 |
| Isolated service/cache behavior | `gpt-5.6-sol`, `medium` | Diagnostics, streams, metadata, sparkline |
| Bounded tests, simple loops, plan/diff review | `gpt-5.6-sol`, `low` | Source-shape reductions, queue caps, independent reviews |

Assign the lowest profile that matches task complexity and risk. `high` is the campaign ceiling; never dispatch `ultra`. No worker may spawn a non-Codex agent. If an independent review is needed, the worker returns the review request to the leader, who assigns another pinned Codex worker.

## Standing worker contract

Every editable assignment must include these rules:

- Read `AGENTS.md`, `.claude/skills/ponytail/SKILL.md`, `.agents/skills/test-driven-development/SKILL.md`, and `.agents/skills/incremental-implementation/SKILL.md` before editing.
- Use RED, GREEN, REFACTOR. Show that the new test fails before the production change when practical.
- Touch only assigned files. Preserve unrelated dirty changes and never revert another worker.
- Do not edit `.replit`, startup artifacts, environment variables, handoff pointers, task boards, or coordination logs.
- Do not run live DB/provider writes, app reloads, process signals, staging, or commits.
- Report files changed, diff stat, RED and GREEN evidence, residual risks, and an adversarial self-review verdict.
- Inspect the complete assigned diff, rerun every exact focused check after self-review fixes, and return enough evidence for the leader to perform a targeted integration/risk acceptance instead of repeating the full audit.
- Before any task changes from planned to working, replace every generic test label in that task with the exact selected or newly created test path and runnable command.

## Phase 0: Governance, baseline, and ownership

### Task 0.1: Persist Codex-only delegation rules

**Description:** Record the user's requirement that a Codex leader stays inside the Codex model vertical unless explicitly instructed otherwise.

**Acceptance criteria:**

- [x] `AGENTS.md` requires same-vertical delegation and explicit profile disclosure.
- [x] Worker briefs prohibit silent cross-provider fallback.
- [x] The rule preserves a path for explicitly requested alternate verticals.

**Verification:**

- [ ] `git diff --check -- AGENTS.md`

**Dependencies:** None
**Files likely touched:** `AGENTS.md`
**Estimated scope:** XS

### Task 0.2: Freeze the evidence baseline

**Description:** Preserve the pre-change measurements that will be compared with each phase.

**Acceptance criteria:**

- [x] The source plan records the 60-second CPU profile and passive DB deltas.
- [x] The unsafe `v8.queryObjects` RSS artifact is excluded from steady-state acceptance.
- [x] Backfill and stored-bar plateau counts are recorded.

**Verification:**

- [ ] Source plan contains CPU, DB, retained-bar, and health baselines.

**Dependencies:** None
**Files likely touched:** `docs/plans/pressure-errant-function-remediation-2026-07-15.md`
**Estimated scope:** XS

### Checkpoint 0

- [ ] Plan audit finds no task over five files.
- [ ] Coordination chat confirms no conflicting editor on Phase 1 paths.
- [ ] Worker ledger is initialized before editable dispatch.

## Phase 1: Eliminate five-second historical reconciliation

### Task 1.1a: Separate open safety from closed reconciliation without changing behavior

**Description:** Extract the expiration/force-stop pass and the 30-day closed-repair pass behind separate seams, retaining `runShadowOptionMaintenance()` as an open-then-closed compatibility wrapper.

**Acceptance criteria:**

- [ ] The compatibility wrapper returns the same summary and runs open safety before closed repair.
- [ ] Expiration, force-stop, reconciliation, P&L, and query decisions are unchanged.
- [ ] Open safety can be invoked without scanning closed positions.

**Verification:**

- [ ] `cd artifacts/api-server && node --import tsx --test src/services/shadow-account-maintenance-seams.test.ts`
- [ ] `cd artifacts/api-server && node --import tsx --test src/services/shadow-account-force-stop-failsafe.test.ts`
- [ ] `pnpm --filter @workspace/api-server run typecheck`

**Dependencies:** Checkpoint 0, the owner safety-lock decision, and ownership release from trading-audit session `019f645f-6e27-75d3-aa88-5702906ebbda`
**Files likely touched:**

- `artifacts/api-server/src/services/shadow-account.ts`
- `artifacts/api-server/src/services/shadow-account-maintenance-seams.test.ts`

**Estimated scope:** S
**Worker profile:** `gpt-5.6-sol`, `high`

### Task 1.1b: Schedule closed reconciliation independently

**Description:** Run open safety on every idle worker wake; run closed reconciliation on startup, an explicit repair request, and an exact 15-minute fallback cadence. Ordinary `requestRunSoon()` remains deployment-only.

**Acceptance criteria:**

- [ ] Twelve ordinary wakes run open safety twelve times and closed repair at most once.
- [ ] Explicit repair requests are advisory-lock protected; ordinary `requestRunSoon()` cannot bypass the fallback cooldown.
- [ ] Open and closed run counts/last-run/error state are diagnosed separately without changing deployment due behavior.

**Verification:**

- [ ] `cd artifacts/api-server && node --import tsx --test src/services/background-worker-pressure.test.ts`
- [ ] `pnpm --filter @workspace/api-server run typecheck`

**Dependencies:** Task 1.1a and the owner ruling on whether the slow pass may share the worker lock
**Files likely touched:**

- `artifacts/api-server/src/services/signal-options-worker.ts`
- `artifacts/api-server/src/services/background-worker-pressure.test.ts`

**Estimated scope:** S
**Worker profile:** `gpt-5.6-sol`, `high`

### Task 1.2: Pin lifecycle recovery semantics with failing fixtures

**Description:** Encode the owner-selected lifecycle P&L truth and the existing creator semantics before changing repair queries or failure handling.

**Acceptance criteria:**

- [ ] Partial exits do not suppress a missing final exit, and a reused symbol row resolves only the selected lifecycle.
- [ ] Same-day repair P&L matches its creator; prior-day repair stays outside today's halt.
- [ ] Malformed rows, failed inserts, and duplicate/concurrent attempts are isolated and retryable without double emit.

**Verification:**

- [ ] `cd artifacts/api-server && node --import tsx --test src/services/shadow-account-closed-reconciliation.test.ts`

**Dependencies:** Task 1.1a. Owner selected specific current-lifecycle, creator-equivalent realized P&L.
**Files likely touched:**

- `artifacts/api-server/src/services/shadow-account.ts`
- `artifacts/api-server/src/services/shadow-account-closed-reconciliation.test.ts`

**Estimated scope:** M
**Worker profile:** `gpt-5.6-sol`, `high`

### Task 1.3: Close the proven creator-path durability gaps

**Description:** Make maintenance sell-then-event and ordinary automation event-then-mirror failures durably observable and route exceptional closed-without-exit cases to the explicit repair request without changing normal trading decisions.

**Acceptance criteria:**

- [ ] Expiration, force-stop, and ordinary exits each converge to one close and one matching final exit after either write direction fails once.
- [ ] Recovery uses the Task 1.2 lifecycle/P&L contract and cannot double bank the daily-loss halt.
- [ ] Replay, partial-exit, backfill, and historical semantics remain separate and unchanged.

**Verification:**

- [ ] `cd artifacts/api-server && node --import tsx --test src/services/shadow-account-closed-reconciliation.test.ts`
- [ ] Exact ordinary-automation close/ledger test command is named before dispatch after the worker selects the existing test file.
- [ ] `pnpm --filter @workspace/api-server run typecheck`

**Dependencies:** Tasks 1.1b and 1.2
**Files likely touched:**

- `artifacts/api-server/src/services/shadow-account.ts`
- `artifacts/api-server/src/services/signal-options-automation.ts`
- `artifacts/api-server/src/services/signal-options-worker.ts`
- `artifacts/api-server/src/services/shadow-account-closed-reconciliation.test.ts`
- One existing focused signal-options automation test

**Estimated scope:** M
**Worker profile:** `gpt-5.6-sol`, `high`

### Task 1.4: Bulk-load closed-repair dependencies

**Description:** Replace per-position order, source-event, lifecycle-fill, and existing-final-exit reads with bounded projections and in-memory matching while retaining the 30-day window and Task 1.2 semantics.

**Acceptance criteria:**

- [ ] Read-query count stays constant as closed-row count grows; no per-position read remains.
- [ ] One real missing final exit heals exactly once with creator-equivalent lifecycle P&L.
- [ ] Historical, backfill, orphan, malformed, partial-exit, and prior-lifecycle cases retain their pinned outcomes.

**Verification:**

- [ ] `cd artifacts/api-server && node --import tsx --test src/services/shadow-account-closed-reconciliation.test.ts`
- [ ] `cd artifacts/api-server && node --import tsx --test src/services/shadow-account-force-stop-failsafe.test.ts`
- [ ] `pnpm --filter @workspace/api-server run typecheck`

**Dependencies:** Task 1.3
**Files likely touched:**

- `artifacts/api-server/src/services/shadow-account.ts`
- `artifacts/api-server/src/services/shadow-account-closed-reconciliation.test.ts`

**Estimated scope:** M
**Worker profile:** `gpt-5.6-sol`, `high`

### Task 1.5: Verify Phase 1 pressure reduction

**Description:** Review the Phase 1 diff, run targeted tests and typecheck, then use one sanctioned reload and matched passive measurements.

**Acceptance criteria:**

- [ ] Maintenance-related `shadow_orders` and `execution_events` probes fall at least 90%.
- [ ] Expiration/force-stop latency and ledger behavior remain unchanged.
- [ ] PostgreSQL row decode and query-submit CPU fall materially in a matched profile.

**Verification:**

- [ ] Same supervisor PID survives sanctioned `SIGUSR2`; `/api/healthz` returns 200.
- [ ] Five-minute passive DB delta and 60-second CPU profile are recorded.

**Dependencies:** Tasks 1.1a through 1.4
**Files likely touched:** None; the leader records evidence in the active plan and session handoff
**Estimated scope:** S
**Worker profile:** Leader plus read-only `gpt-5.6-sol`, `medium` reviewer

### Checkpoint 1

- [ ] Phase 1 source review accepted.
- [ ] Targeted tests and API typecheck pass.
- [ ] Runtime evidence supports the causal model. If not, update the model before continuing.

## Phase 2: Remove duplicate Signal Matrix startup and fanout work

### Task 2.1: Open one final-scope Signal Matrix stream

**Description:** Remove the five-timeframe bootstrap followed by six-timeframe re-key. Open all six timeframes once, ordered as the configured STA execution/MTF priorities followed by the remaining display timeframes, while keeping existing screen and connection-budget gates.

**Acceptance criteria:**

- [ ] Normal mount creates one EventSource and one bootstrap sequence.
- [ ] `1d` remains covered on the same stream.
- [ ] Profile or universe changes cause only one reconnect to the new final scope.

**Verification:**

- [ ] Focused PlatformApp stream-scope test passes.
- [ ] `pnpm --filter @workspace/pyrus run typecheck`

**Dependencies:** Checkpoint 1
**Files likely touched:**

- `artifacts/pyrus/src/features/platform/PlatformApp.jsx`
- One focused PlatformApp test

**Estimated scope:** S
**Worker profile:** `gpt-5.6-sol`, `medium`

### Task 2.2: Deliver configured priority timeframes first on the same connection

**Description:** Preserve the client's normalized scope order in bootstrap shaping so configured STA execution/MTF timeframes arrive before remaining coverage without opening a second stream.

**Acceptance criteria:**

- [ ] The first bootstrap frames follow normalized requested timeframe order, including dynamically configured STA priorities.
- [ ] All six timeframe states arrive by bootstrap completion.
- [ ] Every frame retains the full six-timeframe scope metadata while size and event-loop yielding stay bounded.

**Verification:**

- [ ] `cd artifacts/api-server && node --import tsx --test src/routes/signal-monitor-sse.test.ts`

**Dependencies:** Task 2.1
**Files likely touched:**

- `artifacts/api-server/src/routes/signal-monitor.ts`
- `artifacts/api-server/src/routes/signal-monitor-sse.test.ts`

**Estimated scope:** S
**Worker profile:** `gpt-5.6-sol`, `medium`

### Task 2.3: Remove redundant per-subscriber state signatures

**Description:** Delete `lastStateSignatures` and use the existing field comparator plus `lastDisplayStates` as the single change detector.

**Acceptance criteria:**

- [ ] Date, invalid-number, null/undefined, and filter-state key-order cases retain parity.
- [ ] A changed display field emits once; unchanged state emits nothing.
- [ ] `signalMonitorMatrixStreamStateSignature` is no longer on the hot path.

**Verification:**

- [ ] `cd artifacts/api-server && node --import tsx --test src/services/signal-monitor-stream.test.ts`

**Dependencies:** Checkpoint 1
**Files likely touched:**

- `artifacts/api-server/src/services/signal-monitor.ts`
- `artifacts/api-server/src/services/signal-monitor-stream.test.ts`

**Estimated scope:** S
**Worker profile:** `gpt-5.6-sol`, `medium`

### Task 2.4: Reuse serialized frames across identical subscribers

**Description:** Add a serialized-event writer that shares only proven-identical `data:` bytes; event IDs, queues, timers, cleanup, backpressure, and subscriber latches remain connection-local.

**Acceptance criteria:**

- [ ] Bootstrap reuse is keyed by snapshot identity, normalized scope, profile/actionability inputs, priority order, and frame boundary.
- [ ] Delta bytes are shared only after subscriber-local latch/dedup produces equivalent output; reconnecting, missed-delta, different-scope/profile, and stalled subscribers remain isolated.
- [ ] Shared bytes match the pre-change `JSON.stringify` baseline for dates, `undefined`, invalid numbers, nulls, property order, and frame ordering while IDs/queues remain local.

**Verification:**

- [ ] Signal-monitor route and stream tests pass.
- [ ] API typecheck passes.

**Dependencies:** Tasks 2.2, 2.3, and 2.5; shared-byte fanout runs last on the serialized backend lane
**Files likely touched:**

- `artifacts/api-server/src/routes/signal-monitor.ts`
- `artifacts/api-server/src/services/signal-monitor.ts`
- `artifacts/api-server/src/routes/signal-monitor-sse.test.ts`
- `artifacts/api-server/src/services/signal-monitor-stream.test.ts`

**Estimated scope:** M
**Worker profile:** `gpt-5.6-sol`, `high`

### Task 2.5: Reuse one minute-ring snapshot per symbol

**Description:** Load the widest required minute window once per symbol/revision during a shaping pass and derive narrower currentness views in memory.

**Acceptance criteria:**

- [ ] Sparse, corrected, provisional, and session-boundary currentness remains identical.
- [ ] All timeframe latest-completed timestamps derive from one symbol snapshot.
- [ ] The redundant recent-history sort is removed only if writer ordering is proven.

**Verification:**

- [ ] Signal-monitor stream and completed-bars-cache tests pass.
- [ ] API typecheck passes.

**Dependencies:** Checkpoint 1. It runs after Task 2.3 and before Task 2.4 solely to serialize ownership of `signal-monitor.ts`.
**Files likely touched:**

- `artifacts/api-server/src/services/signal-monitor.ts`
- `artifacts/api-server/src/services/signal-monitor-stream.test.ts`
- `artifacts/api-server/src/services/signal-monitor-stream-completed-bars-cache.test.ts`

**Estimated scope:** M
**Worker profile:** `gpt-5.6-sol`, `high`

### Checkpoint 2

- [ ] One EventSource and one bootstrap are observed on normal app startup.
- [ ] Signal Matrix route/service tests and both typechecks pass.
- [ ] Matched startup profile shows no second shaping/serialization cycle.

## Phase 3: Stop no-op schedulers and observer pressure

### Task 3.1: Select due backfill cells before readiness DB work

**Description:** Identify cold or cadence-due cells with non-touching map reads, return on warm no-due wakes, and query readiness only for exact due cells.

**Acceptance criteria:**

- [ ] A warm plus-60-second wake performs zero readiness queries.
- [ ] Cold and invalidated cells still load immediately.
- [ ] Readiness priority, fairness, quiet-producer, memory, and pressure behavior remains unchanged.

**Verification:**

- [ ] Backfill-base and DB-demand tests pass.
- [ ] API typecheck passes.

**Dependencies:** Task 2.5
**Files likely touched:**

- `artifacts/api-server/src/services/signal-monitor.ts`
- `artifacts/api-server/src/services/signal-monitor-backfill-base.test.ts`
- `artifacts/api-server/src/services/signal-monitor-db-demand.test.ts`

**Estimated scope:** M
**Worker profile:** `gpt-5.6-sol`, `high`

### Task 3.2: Split cheap diagnostics from expensive probes

**Description:** Keep process/ELU/pool metrics at 15 seconds while single-flighting expensive ingest, account, storage, and historical-event probes on slower cadences.

**Acceptance criteria:**

- [ ] Four collection ticks yield four fresh process samples but at most one expensive probe cycle.
- [ ] Slow DB probes cannot stall process/ELU freshness.
- [ ] Warning transitions remain immediately visible.

**Verification:**

- [ ] Focused diagnostics cadence and account-probe tests pass.
- [ ] API typecheck passes.

**Dependencies:** Checkpoint 1
**Files likely touched:**

- `artifacts/api-server/src/services/diagnostics.ts`
- `artifacts/api-server/src/index.ts`
- Up to three existing diagnostics tests

**Estimated scope:** M
**Worker profile:** `gpt-5.6-sol`, `medium`

### Task 3.3: Make ingest diagnostics read-only

**Description:** Move stale-ingest archival into the existing retention/maintenance scheduler so calling the diagnostic getter performs no update.

**Acceptance criteria:**

- [ ] `getMarketDataIngestDiagnostics()` issues no mutation.
- [ ] Archival still runs from the maintenance owner at its intended cadence.
- [ ] Ingest status and warning payloads remain equal.

**Verification:**

- [ ] `cd artifacts/api-server && node --import tsx --test src/services/market-data-ingest-lifecycle.test.ts`
- [ ] Relevant retention scheduler test passes.

**Dependencies:** Task 3.2
**Files likely touched:**

- `artifacts/api-server/src/services/market-data-ingest.ts`
- `artifacts/api-server/src/services/market-data-ingest-lifecycle.test.ts`
- `artifacts/api-server/src/services/snapshot-retention-scheduler.ts`
- `artifacts/api-server/src/services/snapshot-retention-scheduler.test.ts`

**Estimated scope:** M
**Worker profile:** `gpt-5.6-sol`, `medium`

### Task 3.4: Bound diagnostics SSE backpressure

**Description:** Add latest-wins snapshot coalescing, a small pending cap, a drain timeout, and complete cleanup to the diagnostics stream.

**Acceptance criteria:**

- [ ] A client that never drains cannot grow an unbounded promise/payload queue.
- [ ] Timeout closes the connection and removes subscriber/heartbeat state.
- [ ] Normal event ordering and heartbeat behavior remain unchanged.

**Verification:**

- [ ] `cd artifacts/api-server && node --import tsx --test src/routes/sse-route-diagnostics.test.ts`

**Dependencies:** Checkpoint 1
**Files likely touched:**

- `artifacts/api-server/src/routes/diagnostics.ts`
- `artifacts/api-server/src/routes/sse-route-diagnostics.test.ts`

**Estimated scope:** S
**Worker profile:** `gpt-5.6-sol`, `low`

### Task 3.5a: Remove no-op automatic-request retention

**Description:** Delete the automatic request timestamp map while debounce is zero.

**Acceptance criteria:**

- [ ] Ten thousand automatic request keys leave no retained timestamp entries.
- [ ] Automatic metadata remains `automatic: true, debounced: false`.
- [ ] Manual request debounce behavior remains unchanged.

**Verification:**

- [ ] Exact automatic-request test command is named when the worker selects or adds the focused test file.

**Dependencies:** Task 3.1
**Files likely touched:**

- `artifacts/api-server/src/services/signal-monitor.ts`
- One focused signal-monitor automatic-request test

**Estimated scope:** S
**Worker profile:** `gpt-5.6-sol`, `low`

### Task 3.5b: Guard breadth-worker overlap

**Description:** Add the smallest existing-pattern single-flight guard to the breadth worker.

**Acceptance criteria:**

- [ ] A never-resolving breadth run cannot overlap a second run.
- [ ] A settled run permits the next scheduled run.
- [ ] Existing breadth output and scheduling cadence remain unchanged.

**Verification:**

- [ ] Exact breadth-worker test command is named when the worker selects or adds the focused test file.

**Dependencies:** Task 3.5a, because both tasks edit `signal-monitor.ts`
**Files likely touched:**

- `artifacts/api-server/src/services/signal-monitor.ts`
- One focused signal-monitor breadth-worker test

**Estimated scope:** S
**Worker profile:** `gpt-5.6-sol`, `low`

### Checkpoint 3

- [ ] Warm no-due producer wakes show zero readiness work.
- [ ] Diagnostic getters are read-only and stalled clients are bounded.
- [ ] Targeted tests and API typecheck pass.

## Phase 4: Reduce recurring DB, WAL, and idle-stream churn

### Task 4.1: Skip identical option-contract updates

**Description:** Add null-safe changed-value predicates to batch and fallback option-contract updates while preserving identity resolution.

**Acceptance criteria:**

- [ ] Repeating identical contract input produces zero second-pass updates.
- [ ] Changed aliases or metadata update correctly.
- [ ] Unchanged conflicts still resolve contract IDs in one bounded query/cache path.

**Verification:**

- [ ] Option metadata cache and exact-expiration tests pass.
- [ ] API typecheck passes.

**Dependencies:** Checkpoint 1
**Files likely touched:**

- `artifacts/api-server/src/services/option-metadata-store.ts`
- `artifacts/api-server/src/services/option-metadata-store-cache.test.ts`
- `artifacts/api-server/src/services/option-metadata-store-exact-expiration.test.ts`

**Estimated scope:** M
**Worker profile:** `gpt-5.6-sol`, `medium`

### Task 4.2: Skip identical equal-timestamp option quote writes

**Description:** Update latest quotes only for newer `as_of`, or equal `as_of` with changed payload fields.

**Acceptance criteria:**

- [ ] Equal timestamp and identical values perform no update.
- [ ] Equal timestamp and changed values update.
- [ ] Newer timestamps preserve freshness semantics.

**Verification:**

- [ ] Focused latest-snapshot persistence tests pass.

**Dependencies:** Task 4.1
**Files likely touched:**

- `artifacts/api-server/src/services/option-metadata-store.ts`
- One focused option metadata test

**Estimated scope:** S
**Worker profile:** `gpt-5.6-sol`, `medium`

### Task 4.3: Invalidate sparkline history by changed cell

**Description:** Replace synchronized five-minute seed expiry with exact symbol/timeframe invalidation and a staggered stale-while-revalidate fallback.

**Acceptance criteria:**

- [ ] Warm page mounts perform zero deep-history seed reads.
- [ ] One history write invalidates and reloads only its cell once.
- [ ] Sparkline bytes and live-memory merge remain unchanged.

**Verification:**

- [ ] Focused sparkline/cache test passes.
- [ ] API typecheck passes.

**Dependencies:** Checkpoint 1
**Files likely touched:**

- `artifacts/api-server/src/services/platform.ts`
- `artifacts/api-server/src/services/market-data-store.ts`
- One focused cache test

**Estimated scope:** M
**Worker profile:** `gpt-5.6-sol`, `medium`

### Task 4.4: Share shadow-account polling by account and revision

**Description:** Replace per-subscriber polling/signatures with one account-scoped snapshot revision and seed subscriptions from the route's initial payload.

**Acceptance criteria:**

- [ ] Two idle subscribers cause one bootstrap computation and no duplicate startup payload.
- [ ] Existing account-change events refresh the shared snapshot once.
- [ ] Unchanged freshness events use heartbeat cadence, not two-second cadence.

**Verification:**

- [ ] Shadow-account stream tests pass.
- [ ] API typecheck passes.

**Dependencies:** Checkpoint 1
**Files likely touched:**

- `artifacts/api-server/src/services/shadow-account-streams.ts`
- `artifacts/api-server/src/routes/platform.ts`
- `artifacts/api-server/src/services/shadow-account-streams.test.ts`

**Estimated scope:** M
**Worker profile:** `gpt-5.6-sol`, `medium`

### Task 4.5: Cache cockpit components by invalidation source

**Description:** Recompute cockpit payload components only when their owning deployment/account events change, retaining the timer as a safety heartbeat.

**Acceptance criteria:**

- [ ] Idle subscribers repeat no component DB reads after bootstrap.
- [ ] A cockpit change refreshes only affected components.
- [ ] Full payload parity remains exact.

**Verification:**

- [ ] Algo-cockpit stream tests pass.

**Dependencies:** Checkpoint 1
**Files likely touched:**

- `artifacts/api-server/src/services/algo-cockpit-streams.ts`
- `artifacts/api-server/src/services/algo-cockpit-streams.test.ts`

**Estimated scope:** S
**Worker profile:** `gpt-5.6-sol`, `medium`

### Task 4.6: Stop synthetic marketing changes

**Description:** Derive marketing timestamps from real ledger rows and cache pure analytics by validated ledger identity.

**Acceptance criteria:**

- [ ] Repeated unchanged builds retain the same signature and emit nothing.
- [ ] Ledger mutations invalidate immediately.
- [ ] Legacy branding and payload parity remain unchanged.

**Verification:**

- [ ] Marketing shadow dashboard tests pass.

**Dependencies:** Checkpoint 1. Must complete before Task 5.1 because both touch `shadow-account.ts`.
**Files likely touched:**

- `artifacts/api-server/src/services/marketing-shadow-dashboard.ts`
- `artifacts/api-server/src/services/marketing-shadow-dashboard.test.ts`
- `artifacts/api-server/src/services/shadow-account.ts`

**Estimated scope:** M
**Worker profile:** `gpt-5.6-sol`, `medium`

### Checkpoint 4

- [ ] Identical option-chain refreshes show materially fewer updates/WAL waits.
- [ ] Idle stream subscribers cause no repeated slow DB reads.
- [ ] Targeted tests and API typecheck pass.

## Phase 5: Smaller CPU paths and retained-key bounds

### Task 5.1: Narrow the fast-risk cache identity

**Description:** Use an existing content revision if available; otherwise hash only exact risk-consumed position and trade fields.

**Acceptance criteria:**

- [ ] Every risk-consumed field changes the key.
- [ ] Irrelevant metadata and timestamp decoration do not change the key.
- [ ] Cache entries remain bounded and stale values cannot collide.

**Verification:**

- [ ] Focused shadow risk-cache tests pass.

**Dependencies:** Checkpoint 1 and Task 4.6, because Task 4.6 also touches `shadow-account.ts`
**Files likely touched:**

- `artifacts/api-server/src/services/shadow-account.ts`
- Up to two focused shadow-account tests

**Estimated scope:** S
**Worker profile:** `gpt-5.6-sol`, `medium`

### Task 5.2: Convert candidate timestamps once before sorting

**Description:** Decorate candidate activity time once, sort by the numeric value, and remove the decoration.

**Acceptance criteria:**

- [ ] Candidate ordering and tie-breaks remain identical.
- [ ] Each candidate timestamp is parsed once.
- [ ] Invalid timestamp behavior remains unchanged.

**Verification:**

- [ ] Focused signal-options automation test passes.

**Dependencies:** Checkpoint 1
**Files likely touched:**

- `artifacts/api-server/src/services/signal-options-automation.ts`
- `artifacts/api-server/src/services/signal-options-automation.test.ts`

**Estimated scope:** S
**Worker profile:** `gpt-5.6-sol`, `low`

### Task 5.3: Replace repeated market-day sorts with linear scans

**Description:** Reverse-scan sorted bars for the latest positive close and reduce latest-day P&L without spreading and sorting every point.

**Acceptance criteria:**

- [ ] Output matches fixtures across session boundaries and missing/invalid values.
- [ ] Existing chronological input assumptions are asserted.
- [ ] No new allocation-heavy intermediate arrays remain.

**Verification:**

- [ ] Focused shadow market-day tests pass.

**Dependencies:** Task 5.1, because both touch `shadow-account.ts`
**Files likely touched:**

- `artifacts/api-server/src/services/shadow-account.ts`
- Up to two focused shadow-account tests

**Estimated scope:** S
**Worker profile:** `gpt-5.6-sol`, `low`

### Task 5.4: Prune removed-deployment runtime maps

**Description:** Centralize deletion of removed deployment tick snapshots and recent-skip arrays, including stop cleanup.

**Acceptance criteria:**

- [ ] Removing 10,000 deployments leaves only active deployment state.
- [ ] `stop()` clears owned runtime maps.
- [ ] Active deployment behavior remains unchanged.

**Verification:**

- [ ] Position-tick manager and automation tests pass.

**Dependencies:** Checkpoint 1 and Task 5.2, because Task 5.2 also touches `signal-options-automation.ts`
**Files likely touched:**

- `artifacts/api-server/src/services/signal-options-position-tick-manager.ts`
- `artifacts/api-server/src/services/signal-options-position-tick-manager.test.ts`
- `artifacts/api-server/src/services/signal-options-automation.ts`
- One focused automation test

**Estimated scope:** M
**Worker profile:** `gpt-5.6-sol`, `medium`

### Task 5.5: Prune aggregate history outside active symbol scope

**Description:** Remove stale per-symbol history and accumulator state after a grace period when the symbol leaves the subscriber union.

**Acceptance criteria:**

- [ ] Ten thousand churned symbols settle near active scope plus grace entries.
- [ ] Re-subscribing inside grace preserves continuity.
- [ ] Active symbols never lose required history.

**Verification:**

- [ ] Stock aggregate stream tests pass.

**Dependencies:** Checkpoint 2
**Files likely touched:**

- `artifacts/api-server/src/services/stock-aggregate-stream.ts`
- `artifacts/api-server/src/services/stock-aggregate-stream.test.ts`

**Estimated scope:** S
**Worker profile:** `gpt-5.6-sol`, `medium`

### Task 5.6: Add a byte ceiling to the runtime flight recorder

**Description:** Bound files by bytes as well as lines so a few large records cannot create disk-stall pressure.

**Acceptance criteria:**

- [ ] Oversized records rotate or truncate according to existing safety semantics.
- [ ] Line and byte limits both hold.
- [ ] Valid JSONL records are preserved.

**Verification:**

- [ ] Runtime flight recorder tests pass.

**Dependencies:** Checkpoint 3
**Files likely touched:**

- `artifacts/api-server/src/services/runtime-flight-recorder.ts`
- `artifacts/api-server/src/services/runtime-flight-recorder.test.ts`

**Estimated scope:** S
**Worker profile:** `gpt-5.6-sol`, `low`

### Task 5.7: Report cache pressure from churn, not ordinary fullness

**Description:** Keep fixed-cap LRU occupancy visible while deriving watch state from eviction, miss, byte, or in-flight pressure.

**Acceptance criteria:**

- [ ] A healthy full LRU reports capacity without a pressure headline.
- [ ] High eviction/miss churn can report a cache-specific watch driver.
- [ ] Cache state remains excluded from consequential resource gates.

**Verification:**

- [ ] Diagnostics resource-pressure and resource-pressure tests pass.

**Dependencies:** Task 3.2
**Files likely touched:**

- `artifacts/api-server/src/services/diagnostics.ts`
- `artifacts/api-server/src/services/resource-pressure.ts`
- `artifacts/api-server/src/services/diagnostics-resource-pressure.test.ts`
- `artifacts/api-server/src/services/resource-pressure.test.ts`

**Estimated scope:** M
**Worker profile:** `gpt-5.6-sol`, `medium`

### Checkpoint 5

- [ ] Focused CPU functions disappear or materially shrink in a matched profile.
- [ ] Churn tests settle near active sets/caps.
- [ ] Targeted tests and API typecheck pass.

## Phase 6: Retained-bar compaction behind parity gates

### Task 6.1: Pin the minimal retained-bar contract

**Description:** Add fixtures for the fields and precedence rules that a compact base representation must preserve before production representation changes.

**Acceptance criteria:**

- [ ] Fixtures cover final-bar closed, partial, delayed, source integrity, and same-timestamp precedence.
- [ ] Fixtures cover daily close, gap replay, and stream promotion.
- [ ] Current implementation passes before compaction begins.

**Verification:**

- [ ] Bar metadata, completed-bars, backfill-base, and stream parity suites pass.

**Dependencies:** Checkpoint 5
**Files likely touched:**

- Up to five existing signal-monitor parity test files

**Estimated scope:** M
**Worker profile:** `gpt-5.6-sol`, `high`

### Task 6.2: Store the backfilled base in a narrow numeric shape

**Description:** Retain epoch milliseconds, OHLCV, exact source, partial, canonical delayed, and `dataUpdatedAt` presence/value; decorate only at consumer boundaries.

**Acceptance criteria:**

- [ ] All Task 6.1 fixtures remain byte/identity equal.
- [ ] No packed-array abstraction or new dependency is introduced.
- [ ] Resident-bar counts remain equal while old-space and major-GC cost fall.

**Verification:**

- [ ] Targeted signal-monitor parity suites pass.
- [ ] API typecheck passes.

**Dependencies:** Task 6.1
**Files likely touched:**

- `artifacts/api-server/src/services/signal-monitor.ts`
- `artifacts/api-server/src/services/signal-monitor-local-bar-cache.ts`
- Up to three parity test files

**Estimated scope:** M
**Worker profile:** `gpt-5.6-sol`, `high`

### Task 6.3: Run the final matched soak

**Description:** Reload once, warm normally, and compare pressure using cheap counters and profiles only.

**Acceptance criteria:**

- [ ] API health remains 200 with the same supervisor PID.
- [ ] Old-space, GC share, busy CPU, DB admission, and stream serialization all improve from recorded baselines.
- [ ] No signal, trading, or stream-parity regression appears.

**Verification:**

- [ ] Five-minute passive DB delta, 60-second CPU profile, and retained-bar counters are recorded.
- [ ] No heap-wide object census or live heap snapshot is run.

**Dependencies:** Task 6.2
**Files likely touched:** Plan/handoff evidence only
**Estimated scope:** S
**Worker profile:** Leader plus read-only `gpt-5.6-sol`, `medium` reviewer

### Checkpoint 6: Complete

- [ ] Every phase's acceptance criteria are met.
- [ ] API and Pyrus typechecks pass.
- [ ] Focused tests pass with no skipped tests.
- [ ] Runtime health and matched pressure evidence are recorded.
- [ ] Accepted paths are separated from unrelated dirty work; no staging or commit occurs without explicit authority.

## Conditional investigations

These do not authorize speculative fixes.

1. GEX projection/zero-gamma latency: run source-confirmed read-only `EXPLAIN (ANALYZE, BUFFERS)` before choosing query, index, or cache work.
2. Historical 401 retry cycle: requires explicit approval for controlled browser navigation/session expiry testing before any auth behavior change.
3. Subscriber multiplier: add only cheap aggregate counters if Phase 2 acceptance cannot be established from existing stream diagnostics.

## Parallelization map

| Can run together | Must not overlap |
|---|---|
| Task 2.1 frontend and Task 2.3 backend | Tasks 2.2 and 2.4 both edit the Signal Matrix route |
| Task 3.4 diagnostics SSE and Task 4.1 option metadata | Tasks 3.1, 3.5a, 3.5b, and Phase 2 backend edit `signal-monitor.ts` |
| Task 4.5 cockpit and Task 4.1 metadata | Any workers that actually select the same concrete `platform.ts` path after source inspection |
| Task 5.5 aggregate history and Task 5.6 flight recorder | Tasks 1.1a, 1.2, 1.3, 1.4, 4.6, 5.1, and 5.3 edit `shadow-account.ts` |
| Task 5.5 aggregate history and Task 5.6 flight recorder | Tasks 5.2 and 5.4 edit `signal-options-automation.ts` |
| Read-only review may accompany one editable task | Never run two editable workers on the same file |

Heavy typechecks, builds, runtime profiles, and reloads are serialized by the leader.

## Worker result ledger

| Assignment | Scope | Expected | State | Last seen | Leader action |
|---|---|---|---|---|---|
| `PLAN-LOW-01` | Read-only plan size/dependency audit | Missing dependencies, tasks over five files, invalid commands | accepted with dispatch gate | 2026-07-15 | Structural fixes applied; resolve generic commands per task before dispatch |
| `PLAN-MED-02` | Read-only Phase 1/2 safety audit | Trading/signal correctness gaps and sequencing issues | reported | 2026-07-15 | Corrections applied; owner rulings required |
| `ARCH-HIGH-03` | Read-only adversarial review of recurring closed-repair deprecation | Counterexample, crash matrix, stable-hash verdict, exact preconditions | working | 2026-07-15 | Await fresh-context `gpt-5.6-sol/high` report |
| `P1-HIGH-01` | Task 1.1a editable files only | RED/GREEN behavior-preserving seam extraction | quarantined: external trading thread active | 2026-07-15 | Wait for session `019f645f-6e27-75d3-aa88-5702906ebbda` completion and exact ownership release |

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Shared dirty files contain user work | High | Exact file ownership, baseline diff review, no resets/reverts, leader hunk review |
| Closed-repair change misses a live safety path | High | Preserve fast open checks, TDD lifecycle cases, startup and slow fallback |
| One-stream startup delays critical STA data | High | Priority-order frames inside the final-scope connection |
| Serialize-once leaks data across scopes | High | Key by normalized scope/snapshot identity; keep IDs and queues connection-local |
| Diagnostics cadence hides incidents | Medium | Process metrics stay at 15 seconds; persist material transitions immediately |
| Retained-bar compaction changes signal identity | High | Parity fixtures before representation changes; stop on any mismatch |
| Concurrent Codex sessions collide | High | Local chat ownership notice, disjoint files, one active task per worker |
| Validation itself increases pressure | Medium | Serialize heavy commands; no heap-wide diagnostics; one reload per checkpoint |

## Open questions and stop gates

- **Resolved — repair P&L:** owner selected specific current-lifecycle, creator-equivalent P&L; never reuse cumulative `shadow_positions.realizedPnl` across lifecycles.
- **Owner decision required — safety serialization:** keep the 15-minute closed repair under the current advisory lock (recommended; one scheduled wake may wait), or build a separate serialized lane with a hard five-second open-safety wall-clock target.
- **Owner decision required — Matrix priority:** use the dynamic configured STA execution/MTF order followed by remaining display timeframes (recommended), or retain the fixed `1m,2m,5m,15m,1h` order before `1d`.
- **Active ownership stop:** no pressure worker may touch `shadow-account.ts`, `signal-options-automation.ts`, their lifecycle/P&L/exit tests, or the shadow audit/correction scripts until trading-audit session `019f645f-6e27-75d3-aa88-5702906ebbda` completes final review/verification and releases those paths.
- If durable diagnostics retention has an external consumer requiring 15-second rows, stop before reducing persistence.
- If any retained-bar parity fixture disagrees with the proposed minimal shape, keep the field and update the plan instead of forcing compaction.
