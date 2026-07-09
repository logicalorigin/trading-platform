# WO-BUS2-GAUGES — surface DB-pool admission gauges in runtime diagnostics

> **HEADLESS WORKER PREAMBLE:** Headless fix worker. No SESSION_HANDOFF_*, no ~/.claude//skills/
> agents reading, **no git**, no restarts. Ponytail: smallest correct diff.

## Problem (evidence)
WO-BUS-1 (2fda13f3) landed the per-lane DB pool admission scheduler in `lib/db/src/admission.ts`
and WO-BUS-2 (52ad17d0) tagged the lanes — but the per-lane gauges never got surfaced:
`/api/diagnostics/runtime` has no admission section, so lane queueing (the exact "12-slot pool
saturated, interactive queued 11 deep" pathology from today) is invisible at runtime. The BUS
acceptance targets (interactive p95 wait < 250ms, auth_sessions max < 1s, zero shed) cannot be
verified without this.

## Approved fix
Expose the admission stats getter from lib/db (if not already exported — check `getPoolStats` /
admission.ts for an existing accessor first; prefer reusing it) and wire ONE additive field into the
runtime diagnostics payload built in `artifacts/api-server/src/services/platform.ts` (the same
builder that already embeds `marketDataStreams` around ~:3312; follow the pattern of
`signalMonitorIncrementalEval` added today in platform-market-data-diagnostics.ts): a
`dbPoolAdmission` object with per-lane {lane, queued, inFlight, admitted, shed, maxWaitMs, p95WaitMs
if cheaply available}. Numbers must be read from existing counters — do NOT add new measurement
machinery; if a stat doesn't exist in admission.ts, omit it rather than build it.

## Hard constraints
- Edit ONLY: `lib/db/src/admission.ts` (export-only change if needed),
  `artifacts/api-server/src/services/platform.ts` (one additive field in the diagnostics return),
  plus ONE test (extend an existing admission or diagnostics test file).
- Additive only: no existing field renamed/removed; payload with no admission activity must still
  serialize (empty lanes array, not undefined crash).
- Validation: api-server typecheck + only the test file(s) you touched. rc=75 = shared validation
  lock; wait 30s, retry.

## Deliverable
Report to `.codex-watch/run-wo-bus2-gauges-report.md`: getter used/exported, payload path in the
runtime diagnostics JSON, test result. Final message ≤ 3 lines.
