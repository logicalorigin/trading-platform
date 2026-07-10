# WO-MTX-0 — matrix serve-path mismatch counter (Phase 0 of serve-from-states)

> **HEADLESS WORKER PREAMBLE:** Headless fix worker. No SESSION_HANDOFF_*, no ~/.claude//skills/
> agents reading, **no git**, no restarts, no DDL. Ponytail: smallest correct diff.
> Program context: docs/plans/signal-tables-consolidation-2026-07-10.md (the matrix's four serving
> paths disagree; Riley approved a phased consolidation to serve the UI from
> signal_monitor_symbol_states). Phase 0 = measure the disagreement, change nothing else.

## The measurement
In the symbol-states persist path, the code ALREADY reads the current stored row per cell for the
latch/preserve logic (applyStoredSignalDirectionLatch used ~signal-monitor.ts:7661;
shouldPreserveExistingSignalMonitorSymbolState ~:7668 reading `existing`). Piggyback on that read —
do NOT add any new DB reads:

When a freshly evaluated cell is about to be persisted and an `existing` stored row is present,
compare the DISPLAY-identity fields the UI renders: currentSignalDirection, currentSignalAt,
status, fresh, trendDirection. If any differ from what evaluation just produced (i.e., a user
reading the stored row a moment ago saw something different from what evaluation now says), count:
- `matrixServeMismatchCount` (total), and a per-field breakdown map (direction/at/status/fresh/trend)
- `lastMatrixServeMismatchAt` + last mismatched cell key (profile|symbol|timeframe) for log grep
Exclude cells where the latch/preserve logic itself keeps the stored value (that path is working as
designed — count it separately as `latchPreservedCount` so we learn how often the latch fires).

Expose all counters via the existing signal-monitor diagnostics surface (same pattern as
getSignalMonitorIncrementalEvalStats — reachable from /api/diagnostics/runtime under
marketDataStreams). Reset with the other counters in the tests-internals reset.

## Hard constraints
- Files: ONLY artifacts/api-server/src/services/signal-monitor.ts + ONE test file (extend
  signal-monitor-matrix-eval-cache.test.ts or the symbol-states persist test — read them first,
  pick the one already covering the persist path).
- Zero behavior change: counters and diagnostics only. No new DB reads/writes, no new env flags.
- Validation: api-server typecheck + only the touched test file. rc=75 = shared validation lock;
  wait 30s, retry.

## Deliverable
Report to `.codex-watch/run-wo-mtx-0-report.md`: counter locations (file:line), diagnostics path in
the runtime JSON, test result. Final message ≤ 3 lines.
