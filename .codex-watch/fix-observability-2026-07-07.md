# Work-order A: observability diet + retired-IBKR vestige removal — report (2026-07-07)

Worker: codex-worker (Claude subagent) for claude-lead. Repo: /home/runner/workspace.
All changes left in the working tree, unstaged, uncommitted. No app restart/reload.

Evidence sources: `.codex-watch/db-census-2026-07-07.md` (R1/R3/S3/S12/D5),
`.codex-watch/sta-blocking-audit-2026-07-07.md` (§1 gateway vestige),
`.codex-watch/throttle-audit-2026-07-07.md`.

## Files touched (only these)

Source:
- `artifacts/api-server/src/services/diagnostics.ts` (A1, A3)
- `artifacts/api-server/src/services/runtime-flight-recorder.ts` (A2)
- `artifacts/pyrus/src/screens/algo/algoHelpers.js` (A4 — one isolated hunk)

Tests:
- `artifacts/api-server/src/services/diagnostics-ibkr-metrics.test.ts` (A1, extended)
- `artifacts/api-server/src/services/diagnostics-write-hygiene.test.ts` (A3, new)
- `artifacts/api-server/src/services/runtime-flight-recorder.test.ts` (A2, extended)
- `artifacts/pyrus/src/screens/algo/algoHelpers.test.mjs` (A4, extended)

No forbidden files edited (signal-monitor*, platform.ts, market-data-store.ts,
shadow-account.ts, services/automation.ts, signal-options-*, backtesting*,
backtest-worker/*, overnight-*, SESSION_HANDOFF*). platform.ts and
signal-options-automation.ts were read only.

---

## A1 (census R1): stop the retired-IBKR diagnostic warning loop

**What changed.** `buildIbkrDiagnosticEvents` (diagnostics.ts:1813) now early-returns
`[]` when `ibkrRaw["bridgeRuntimeStatus"] === "retired"`, before any of the
`ibkr_bridge_required` / health / stream warning branches. That is the exact signal
the census names: `getIbkrBridgeRuntimeSessionState()` hard-codes
`bridgeRuntimeStatus:"retired"` (platform.ts:288, read-only) and it flows into
`runtime.ibkr.bridgeRuntimeStatus` at platform.ts:3379 → `ibkrRaw` at
diagnostics.ts:3975. So every 15s tick previously emitted ≥1 vestigial
`ibkr_bridge_required` upsert/persist-skip line; now it emits none.

**No-consumer re-verify (census claim confirmed).** `rg` for
`ibkr_bridge_required|ibkr_bridge_token_missing|ibkr_bridge_health_stale|ibkr_gateway_socket_disconnected`
across source (excluding tests, diagnostics.ts, and `.codex-watch`) returns only a
SESSION_HANDOFF markdown mention — no automation or route keys on these codes. The
STA audit §2f independently confirms `ibkr_bridge_required` is not an STA per-row
reason. Removing them only stops a permanently-red diagnostics vestige.

**Test evidence.** `diagnostics-ibkr-metrics.test.ts`: "a retired IBKR bridge emits
zero diagnostic events (no perpetual warning loop)" asserts `deepEqual(events, [])`
for a retired-bridge input. The pre-existing runtime-unattached test (no
`bridgeRuntimeStatus`) still passes, proving the guard is scoped to `"retired"`.

Reviewer command:
```
cd artifacts/api-server && npx tsx --test src/services/diagnostics-ibkr-metrics.test.ts
```

---

## A2 (census S3+D5): flight-recorder diet

**What changed.** `appendPostgresPoolDiagnosticEvent`
(runtime-flight-recorder.ts:752), the per-slow-event emit path, now:
1. **Truncates `sql` to 300 chars** (`SLOW_EVENT_SQL_MAX_CHARS`, :733).
2. **Drops `stack`** from the recorded object (verified always `[]` in practice —
   the existing "DB diagnostic flight-recorder events" test passes `stack:[]` and the
   `lib/db` producer sends `[]`; the field is simply omitted, `lib/db` type untouched).
3. **Rate-limits per query-family** (`${type}:${queryName ?? sql[0..60]}`): first
   `SLOW_EVENT_RATE_BURST=5` per rolling minute emit freely; beyond that, at most one
   per `SLOW_EVENT_RATE_THROTTLE_MS=10s`, carrying `suppressedCount` = lines dropped
   since the last emit (only attached when >0).
4. **Intra-day byte cap** (`64MB` default): once the day's recorded slow-event bytes
   exceed the cap, slow events stop being appended and a single
   `api-db-slow-recording-capped` marker is written. Other recorder event kinds
   (heartbeat, memory samples, node-warning, etc.) are unaffected — the cap lives
   only inside this function. Counter resets on dateKey rollover.

The event schema is otherwise identical (same event names, same fields minus
`stack`). An optional `nowMs` param was threaded through
`appendPostgresPoolDiagnosticEvent` and the `__append…ForTests` hook so rate-limit and
cap behaviour is deterministically testable; a
`__resetPostgresPoolDiagnosticRateLimitForTests({byteCap?})` hook (:834) resets state
between tests.

**Test evidence.** `runtime-flight-recorder.test.ts` (3 new tests):
- "truncates SQL to 300 chars and drops the stack field" — asserts recorded
  `sql.length === 300` and `"stack" in event === false`.
- "rate-limits per family and carries a suppressedCount" — 11 same-family events at
  fixed timestamps → exactly 7 recorded (5 burst + 2 throttled), last one carries
  `suppressedCount === 4`, burst lines carry none.
- "stops appending after the intra-day byte cap and flags it once" — 8 distinct
  families with a 200-byte cap → fewer than 8 slow lines recorded and exactly one
  `api-db-slow-recording-capped` (capBytes 200) notice.

The pre-existing context test still passes (single event, family emitted, `context`
intact).

Reviewer command:
```
cd artifacts/api-server && npx tsx --test src/services/runtime-flight-recorder.test.ts
```

---

## A3 (census R3+S12): diagnostics write hygiene

**(1) Retention DELETE cadence.** The two per-tick retention DELETEs
(diagnostics.ts:4415, was ~4336) are now gated by
`shouldRunDiagnosticsRetentionCleanup(now, lastRun, 6h)` — they run on the first tick
after boot and then at most every 6h (`DIAGNOSTIC_RETENTION_CLEANUP_INTERVAL_MS`),
instead of every 15s. Retention behaviour is unchanged (24h window); rows just get
pruned on a 6h cadence, well within the window. **Chosen approach: in-file 6h gate,
not a move into `startSnapshotRetentionScheduler` (index.ts:320).** Rationale: the
work-order offers both ("hook there, or skip when last-run < 6h") and index.ts is
outside my declared file set; the in-file gate is the surgical, self-contained choice
and keeps the change inside diagnostics.ts.

**(2) Skip unchanged diagnostic-event upserts.** `upsertEvent` (diagnostics.ts:3276)
now skips the DB upsert when the event's status+severity+message match the
last-persisted signature AND the persisted `lastSeenAt` is still within a 5-minute
touch window (`DIAGNOSTIC_EVENT_PERSIST_TOUCH_MS`, tracked in
`lastPersistedDiagnosticEventByKey`). The in-memory store and SSE broadcast are
unaffected; only the redundant DB write is dropped.

**lastSeenAt decision (stated explicitly).** I preserve lastSeenAt via a **coarse
5-minute touch**: when nothing material changed but ≥5min has elapsed since the last
persisted write, the upsert still runs (advancing the DB row's lastSeenAt). This
matters because the DB retention DELETE keys on `diagnostic_events.lastSeenAt` — an
active-but-unchanged incident must keep a fresh DB lastSeenAt so it is never pruned as
stale. `rg` confirmed `diagnostic_events` has **no readers outside diagnostics.ts**,
so lastSeenAt only feeds retention + the in-file history/list endpoints; a 5-min drift
is harmless there. eventCount on the DB row now increments coarsely (per persisted
write) rather than per occurrence — accepted, since the work-order scopes "unchanged"
to status+severity+message and the in-memory payload keeps the precise count.

**Resolve→reopen correctness.** `resolveEvent` (diagnostics.ts:3347) deletes the
persisted signature so a later reopen is never skipped as "unchanged" and correctly
flips the DB row back to `open`.

**Test evidence.** `diagnostics-write-hygiene.test.ts` (new, 5 tests) unit-tests the
two pure decision helpers exposed via `__diagnosticsInternalsForTests`:
- persist first-seen; skip unchanged-within-window; coarse-touch past 5m; always
  persist on severity/message/status change.
- retention cleanup runs first tick, skips at 15s and just under 6h, runs again at 6h.

These helpers are the sole gate on the DB write and the DELETE block, so the
predicate tests are the cadence/skip proof without a DB mock.

Reviewer command:
```
cd artifacts/api-server && npx tsx --test src/services/diagnostics-write-hygiene.test.ts
```

---

## A4 (STA audit §1): stop gating shadow operations on IBKR gateway readiness

**What changed (reachable part).** In `deriveSignalOptionsHaltControlStatus`
(algoHelpers.js:3946) the `gatewayNotReady` trigger now also requires
`submitsToBroker`. A deployment submits to a broker only if it is NOT a
signal-options deployment (`resolveAlgoDeploymentKind(cockpit.deployment) !==
SIGNAL_OPTIONS`). This is exact: `buildSignalOptionsActionMapping`
(signal-options-automation.ts:2609, read-only) hard-codes `brokerSubmission:false` /
`executionMode:"shadow"` for **every** signal-options deployment regardless of its
`mode`, so "is a signal-options deployment" ⟺ "never submits to a broker". The
cockpit already carries `deployment.config.parameters.executionMode` (via
`deploymentToResponse`), so this works today with no server dependency.

Effect: for the shadow STA/operations deployment with `readiness.ready===false`, the
"Gateway" control is no longer `FORCED` (when disabled) or `ACTIVE` (when enabled) —
it renders `OFF`/`ARMED`. The un-disable-able red "Gateway" halt driven by the
retired IBKR datapath is gone. Non-signal-options (broker-submitting) deployments keep
the original gate unchanged.

**What I did NOT touch (and why algo-gateway.ts is unchanged).**
`resolveAlgoGatewayReadiness` (algo-gateway.ts:38) is a pure broker-readiness
computation — it has no deployment context and its output is correct as-is
(the broker genuinely is not configured). The bug is that its result is *applied* to
shadow deployments; that application lives in (a) the frontend gate (fixed above) and
(b) the cockpit builder (server, forbidden — hand-off below). So no change to
algo-gateway.ts was warranted; adding brokerSubmission awareness there would be
misplaced.

**Test evidence.** `algoHelpers.test.mjs`: "Gateway halt does not fire on a shadow
signal-options deployment" asserts, for `readiness.ready:false`:
- shadow deployment → `armed` (enabled) and `off` (disabled), NOT active/forced;
- broker deployment (no signal_options) → `active` (enabled) and `forced` (disabled),
  preserving the original behaviour.

Reviewer command:
```
cd artifacts/pyrus && npx tsx --test src/screens/algo/algoHelpers.test.mjs
```

### HAND-OFF NOTE (server-side, owned by the signal-options lane — DO NOT let me edit)

The frontend GateLadder is fixed, but two server surfaces still emit bridge-era copy
for the shadow deployment. Both are in `signal-options-automation.ts` (that lane's
dirty WIP — line numbers may drift):

1. **Cockpit `readiness` payload** (`buildAlgoDeploymentCockpitPayload`,
   ~signal-options-automation.ts:12622). `scanDisabledReason` and
   `enableDisabledReason` are set to the IBKR message whenever `readiness.ready` is
   false, even for shadow. Exact edit: gate them on broker submission, e.g.
   ```ts
   const submitsToBroker = false; // shadow signal-options never submits (buildSignalOptionsActionMapping)
   scanDisabledReason: readiness.ready || !submitsToBroker ? null : readiness.message,
   enableDisabledReason: readiness.ready || !submitsToBroker ? null : readiness.message,
   ```
   Optionally also add `brokerSubmission: submitsToBroker` to the `readiness` object
   so the frontend can key on it directly instead of inferring from deployment kind.

2. **Attention warning** (`buildCockpitAttention`, ~signal-options-automation.ts:9906).
   The `gateway-readiness` attention item (summary "Broker account readiness is
   blocking scans.", action "Start or repair the IBKR account/order bridge before
   running signal-options scans.") is bridge-era copy that inflates the
   `activeBlockers` KPI. Exact edit: skip emitting this attention item when the
   deployment does not submit to a broker (shadow) — i.e. wrap the
   `readiness.ready === false` block with the same `submitsToBroker` guard. This
   finishes what commit `6862f759` ("retire bridge-era copy from attention warnings")
   started.

Both are display/gate-ladder only (shadow scans keep running per the STA audit), so
low risk.

---

## Gates (outputs)

- `pnpm --filter @workspace/api-server run typecheck` → **pass** (clean; one earlier
  run was refused by the shared validation lock held by a sibling lane — retried once
  the lock cleared).
- `pnpm --filter @workspace/pyrus run typecheck` → **pass** (clean).
- `npx tsx --test` on all four touched test files + `readiness.test.ts` (a diagnostics
  consumer, as a regression guard) → **26 + 5 pass, 0 fail** for api-server;
  **57 pass, 0 fail** for pyrus algoHelpers.

One-shot reviewer command (api-server):
```
cd artifacts/api-server && npx tsx --test \
  src/services/diagnostics-ibkr-metrics.test.ts \
  src/services/diagnostics-write-hygiene.test.ts \
  src/services/runtime-flight-recorder.test.ts \
  src/services/algo-gateway.test.ts \
  src/services/readiness.test.ts
```

---

## Gaps / what I could not verify

- **No runtime verification.** Per the work-order I did not restart/reload the app;
  the lead owns runtime proof. The "~11.5k lines/day removed" and "~14k statements/day
  removed" figures are the census's projections, not measured post-change — my tests
  prove the *behaviour* (retired→[], truncate/rate-limit/cap, skip/coarse-touch, gate
  cadence), not the live volume delta.
- **algoHelpers.js carries unrelated working-tree edits that are NOT mine.** The file
  had pre-existing/concurrent uncommitted changes (greek-trail default
  `greekMaxAgeMs 15000→45000` at ~:178; new `formatSignalOptionsPolicyValue`,
  `formatSignalOptionsMtfPattern`, `buildSignalOptionsReadOnlyGateBadges` at ~:290+).
  My A4 change is a single isolated hunk at the `submitsToBroker`/`gatewayNotReady`
  lines (~:3946). To review ONLY my hunk:
  `git diff -- artifacts/pyrus/src/screens/algo/algoHelpers.js | grep -n -B2 -A6 submitsToBroker`.
  I did not author or touch the other regions; flagging in case the lead expected
  algoHelpers.js to be otherwise clean.
- **A4 leaves the server attention/scanDisabledReason vestige until the hand-off
  lands.** The user-visible FORCED "Gateway" halt is fixed frontend-side now; the
  attention-strip warning + cockpit `scanDisabledReason` copy still show until the
  signal-options lane applies the hand-off edits above.
- **A2 byte accounting is approximate** (`JSON.stringify(detail).length`, excluding
  the fixed `schemaVersion/time/event/pid` envelope added by
  `appendRuntimeFlightRecorderEvent`). Adequate for a 64MB soft cap; not an exact
  on-disk byte count.
