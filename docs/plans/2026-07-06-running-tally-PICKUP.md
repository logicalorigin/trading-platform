# PICKUP — signal-options push-native running tally (Approach A)

**Read this first.** Single source of truth for the next agent. Companion docs:
`docs/plans/2026-07-06-approach-a-running-tally-tasks.md` (task detail) and
`docs/plans/2026-07-06-signal-options-push-native-redesign-scope.md` (why + rejected approaches).

## TL;DR

Replacing the signal-options worker's "re-read + rebuild 2×2,500 ledger rows every tick" with an
**in-memory running tally** that folds only NEW events. This is the root-cause fix for the DB-pool
pressure / false-blocker glitches. **Owner constraint: NO new DB tables** (a prior "compact store"
sidecar approach was built then RIPPED OUT — do not reintroduce tables). Everything is behind the env
flag `SIGNAL_OPTIONS_TALLY` (off|shadow|on, default `off`). **Nothing is live** — no migration, no
reload, flag defaults off; the running app behaves exactly as before.

## Owner decisions (locked — do not re-litigate)

- No sidecar/derived-state DB tables. Improve the process (in-memory tally), don't relocate cost.
- Keep the live "why did it skip this?" view via a bounded **in-memory recent-skips buffer** (not a
  table); old skip history may fade.
- Flip all deployments at once (no canary). Everything in one push. Compressed bake — trust rests on
  the automated equivalence tests + reconcile auto-repair + instant flag rollback, not a long soak.
- Build the flip, **do NOT deploy yet** (owner's latest choice): build write-cut + daily-P&L-in-tally +
  flip, all flag-gated, deploy the whole thing later.

## Mechanics (how this is being built)

- **Implementation is Codex-driven** to conserve Claude budget. Codex's normal sandbox (bwrap) is
  BROKEN in this container, so it runs unsandboxed (owner-approved):
  `codex exec --dangerously-bypass-approvals-and-sandbox -C /home/runner/workspace "$(cat prompt.txt)"`
  Run it via the Bash tool with `run_in_background: true` — tsc takes ~300s and the foreground Bash
  2-min default will kill it mid-run.
- **The gate is the equivalence tests, not who wrote it.** After each Codex task: (1) scope-check —
  `git rev-parse HEAD` unchanged + `git status` shows only `signal-options-automation.ts` (M) +
  `signal-options-position-fold.test.ts` (the test file); `signal-options-worker.ts` (M) is a SEPARATE
  pre-existing pressure-fix workstream, NOT this work — leave it. (2) run the tests. (3) run tsc and
  confirm **no `signal-options` errors** (a concurrent session sometimes breaks OTHER files like
  `bridge-option-quote-stream.ts` / `tax-planning.ts` — not ours; gate on signal-options only).
- Prompt files live in the scratchpad:
  `/tmp/claude-1000/-home-runner-workspace/711bf96b-b23a-40de-9246-ba1216e8050e/scratchpad/codex-task-*.txt`

## Files

- **`artifacts/api-server/src/services/signal-options-automation.ts`** — ALL the tally code (the ~19k
  line service). This file also carries a SEPARATE pre-existing pressure-fix workstream diff (#A/#B/#4/
  #E/#D) from prior sessions — do not touch those hunks.
- **`artifacts/api-server/src/services/signal-options-position-fold.test.ts`** — all equivalence goldens.
- NO `lib/db` / schema / migration changes (constraint).

## DONE + VERIFIED (all flag-gated, zero behavior change)

Verify commands:
`cd artifacts/api-server && node --import tsx --test src/services/signal-options-position-fold.test.ts`
`cd artifacts/api-server && pnpm exec tsc -p tsconfig.json --noEmit`  (gate: no signal-options errors)

1. **Position fold (Step 1).** `deriveActivePositions` refactored to delegate to a reusable fold —
   `SignalOptionsPositionFoldState`, `createSignalOptionsPositionFoldState`,
   `foldSignalOptionsPositionEvent` (exact per-event transcription of the old body),
   `foldSignalOptionsPositionEvents`. Full derive === fold-from-empty by construction. 33 existing
   automation tests confirm no behavior change.
2. **Position projection + incremental update (2.2).** `signalOptionsPositionProjections` Map,
   `SignalOptionsPositionProjection` type, `createSignalOptionsPositionProjection`,
   `foldTailIntoSignalOptionsProjection` (dedup-by-id via `recentlyFoldedIds` + `SIGNAL_OPTIONS_PROJECTION_OVERLAP_MS`
   watermark), `updateSignalOptionsPositionProjection` (full-rebuild on empty/config-change/null-watermark,
   else tail-read via `listDeploymentEventsSince`). Golden: incremental tail-folds === full derive.
3. **Watermark tail-read (2.1).** `listDeploymentEventsSince(deploymentId, since, limit)` — occurred_at
   >= since, ASC, index-driven, NO payload filter (the `payload->>'reason'` SQL filter is a DETOAST
   DEAD-END — see the scope doc's live-DB EXPLAIN; cold 1.8s spike. Do not use it).
4. **Dual-run drift metric (2.3).** `signalOptionsTallyMode()` reads `SIGNAL_OPTIONS_TALLY`;
   `signalOptionsPositionsDrift`, drift/compare counters, `getSignalOptionsTallyDriftStats`. Hooked
   after `activePositionsAfterMarks` (guarded; flag-off = true no-op; full rebuild authoritative).
5. **Recent-skips buffer (5.2a).** `signalOptionsRecentSkips` Map, `SIGNAL_OPTIONS_RECENT_SKIPS_LIMIT`
   (= `SIGNAL_OPTIONS_STATE_EVENT_LIMIT`), `isSignalOptionsEntryCandidateSkip` (firehose = SKIPPED,
   not replay, not position-mark, not feed-degraded), `recordSignalOptionsRecentSkip` (idempotent by
   id, newest-trimmed), `listSignalOptionsRecentSkips`. Hooked into `insertSignalOptionsEvent` (additive
   — still writes the ledger row too).
6. **Dedup reads the buffer (re-entry gate).** After-marks `seenSignals` options hoisted to
   `seenSignalsOptions`; guarded dual-run compares `seenSignalKeys(non-firehose events + buffer skips)`
   vs the ledger `seenSignals` and counts `dedupDrift`. Cold-start: `updateSignalOptionsPositionProjection`
   full-rebuild seeds the buffer from the ledger. **Golden partition test passes**: `seenSignalKeys(all)
   === seenSignalKeys(non-firehose + buffer)` across reason/option variants — the duplicate-trade guard.

7. **Projection retains events window + daily-P&L/control dual-run (VERIFIED).** `recentEvents` added
   to the projection (maintained in `foldTailIntoSignalOptionsProjection` with id-dedup + trim);
   `projectionDailyPnl`, `projectionControlUpdatedAt`; flag-gated diffs at the dailyPnl (~18553) +
   control (~18463) sites with `pnlDrift`/`controlDrift` counters. Golden: projection-window dailyPnl +
   control-updated-at === full. **10/10 tests pass; full tsc EXIT=0.** This was the last flip
   prerequisite — the tally can now serve positions, dedup, dailyPnl, and control from memory.

## IN FLIGHT

- None. (The projection-retains-events task above landed and is verified.)

## NEXT (remaining, in order)

1. **Firehose write-cut (flag-gated).** When `SIGNAL_OPTIONS_TALLY==="on"`, make `insertSignalOptionsEvent`
   SKIP the `execution_events` insert for entry-candidate (firehose) skips — write them ONLY to the
   in-memory buffer. Off/shadow: write both (as now). This makes the tail read naturally firehose-free
   (the ONLY clean way — the SQL filter is the detoast dead-end). Repoint the display/analytics
   consumers (`candidateFromEvent`, `signalOptionsReadModelSummary`, `buildCockpitDiagnostics`,
   `buildRuleAdherence`, `buildSignalOptionsPerformanceFromInputs`) to see skips from the buffer —
   cleanest via a central "merge buffer skips into the events list, dedup by id" helper at the read
   points, so consumers stay unchanged. Dual-run verify before relying on it.
2. **Flip authority (flag=on).** Route positions ← projection (then through the EXISTING
   `reconcileActivePositionsWithShadowLedger`, which is the anti-drift backstop — it pulls shadow-ledger
   truth and is already called each tick), dedup ← buffer + non-firehose, dailyPnl ← projection,
   control ← projection; replace the two `listDeploymentEvents(2500)` full reads with the projection's
   tail read. Keep a periodic full-rebuild backstop + config/gap invalidation (already in
   `updateSignalOptionsPositionProjection`). Instant rollback = flag back to shadow/off.
3. **Allowance cache (optional tail).** Cache `computeSignalOptionsLedgerRealizedForDeployment`'s
   realizedNet keyed to `max(shadow_fills.id)`; it's a SEPARATE small shadow-ledger query, not the
   2,500 read, so it's not a flip blocker.
4. **Then deploy:** flag `shadow` live (bake — watch `getSignalOptionsTallyDriftStats` drift stay
   zero), then flag `on`. Reload is SIGUSR2 to the pid2-owned `runDevApp.mjs` supervisor (see CLAUDE.md
   — never a shell-launched supervisor). Prod-DB access is classifier-gated (owner approved reads this
   session).

## Gotchas

- Concurrent Claude sessions edit this shared tree; `signal-options-worker.ts`,
  `signal-options-position-tick-manager.ts`, and occasional broken files (`bridge-option-quote-stream.ts`,
  `tax-planning.ts`, `platform.ts`, `shadow-account.ts`) are NOT this work — leave them.
- A concurrent session is renaming `ibkr-live-demand-coordinator` → `option-quote-demand-coordinator`
  (`subscribeIbkrLiveDemand`→`subscribeOptionQuoteDemand`, `IbkrLiveDemandDeclaration`→
  `OptionQuoteDemandDeclaration`). Mid-rename it can throw a TRANSIENT `ERR_MODULE_NOT_FOUND` for
  `./ibkr-live-demand-coordinator` when running the tests — re-run; it clears once their edit settles.
  Full tsc was EXIT=0 as of last check.
- Nothing committed; on branch `main`. **Owner decided (2026-07-06) to leave committing to the next
  agent** — it was offered and deferred, not forgotten. When you commit, branch off `main` and stage
  ONLY the tally hunks in `signal-options-automation.ts` + the whole `signal-options-position-fold.test.ts`;
  do NOT sweep in the concurrent workstreams' hunks (worker.ts, position-tick-manager.ts, the
  live-demand rename, etc.). The tally code is self-contained and flag-gated, so it's safe to isolate.
- The projection/buffer are per-process in-memory → empty on restart → `updateSignalOptionsPositionProjection`
  full-rebuilds + seeds. Replit rotates the VM ~6h, so one rebuild/restart is fine.
