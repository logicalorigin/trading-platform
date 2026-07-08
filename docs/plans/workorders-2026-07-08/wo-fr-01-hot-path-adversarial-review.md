# WO-FR-01 — Adversarial review: ELU hot-path + incident-adjacent services (READ-ONLY)

You are a codex worker in the PYRUS monorepo at /home/runner/workspace, running an adversarial
code review. This order is STRICTLY READ-ONLY: do not modify, create, or delete any repo file;
do not run tests, builds, or the app (2-core box shared with a LIVE trading platform); do not
touch git state. Your only output is the report file named below.

IMPORTANT: Do NOT read or execute any files under ~/.claude/, ~/.agents/, .claude/skills/, or
agents/. Do NOT modify agents/openai.yaml. Stay focused on repository code only.

## Operating discipline (binding)
- Fact-first: every finding cites file:line you actually read; re-read the cited lines before
  reporting to verify them. Separate observed vs inferred. A causal claim is a hypothesis until
  traced in source.
- Refute your own findings before reporting; only defensible findings ship. Precision over volume.
- Suggested fixes follow ponytail discipline: the laziest correct fix — reuse existing helpers,
  one guard at the shared root, deletion over addition. One sentence each.
- Severity: P0 live-trading/money/data-corruption; P1 user-visible breakage/wrong data;
  P2 real defect low blast radius; P3 batch-worthy cleanup.

## Live evidence (captured 2026-07-08 12:43–12:59 MDT, market hours)
- Event loop pinned ELU~1.0; DB pool 12/12 with up to 28 waiting; 400 slow queries ≥2s in 3 min.
- CPU profile (52,576 samples, pid 5820): GC 15.8% self-time (allocation churn, doubled vs 07-02);
  _parseRowAsArray 8.7%; minute-bar aggregation cluster ~12–15% (aggregateStockMinuteBarsForTimeframe,
  stockMinuteAggregateToSignalMonitorBar, loadSignalMonitorStreamSourceMinuteBars,
  getRecentStockMinuteAggregateHistory, getCurrentStockMinuteAggregates); SSE serialization ~6%
  (serializeSseEventData, handleRawMessage, stableStringify3); normalizeLegacyAlgoBranding 1.6%.
- Live incidents: signal_options_worker_failure (scan timed out after 120000ms),
  signal_options_scan_stale, api p95 2941ms — all self-attributed "resource-pressure-high".

## Scope (these files ONLY)
- artifacts/api-server/src/services/stock-aggregate-stream.ts
- artifacts/api-server/src/services/sse-stream-diagnostics.ts
- artifacts/api-server/src/services/massive-stock-quote-stream.ts
- artifacts/api-server/src/services/signal-options-worker.ts
- artifacts/api-server/src/services/signal-monitor-local-bar-cache.ts

## Hunt
1. Correctness bugs: async races, unawaited promises, error paths that wedge stream/worker state,
   listener/subscription leaks, backpressure absent on SSE writes, reconnect storms.
2. Allocation churn feeding the 15.8% GC: per-tick array/object rebuilds, spread-in-loop,
   re-sorting/re-aggregating full windows on every tick where incremental update is possible,
   per-call RegExp/Intl/Date construction, JSON.stringify on hot paths.
3. The 120s scan-timeout path in signal-options-worker.ts: cancellation vs detached-run pile-up,
   recovery/staleness clearing, idempotency of resumed scans.

## Deliverable
Write EXACTLY ONE file: .codex-watch/wo-fr-01-report.md
Format: one section per finding — `file:line | severity | category | summary`, then evidence
(observed), failure scenario, laziest fix (one sentence), confidence 0-1. End with a coverage
note (what you read fully vs skimmed) and a one-paragraph verdict on whether these files can
plausibly account for the profile's GC + aggregation dominance (label inference as inference).
