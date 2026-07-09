# WO-SME-1 — /signal-monitor/events route: bound the 13.2s read

> **HEADLESS WORKER PREAMBLE (overrides AGENTS.md session rituals):** Headless fix worker. No
> SESSION_HANDOFF_* writes; don't read ~/.claude/, .claude/skills/, agents/, AGENTS.md session
> sections. NEVER restart/reload/signal the app (no REPLIT_MODE=workflow — retired), never
> `git push`, no DB maintenance. 2-core live box: only listed validations; you MAY run read-only
> `EXPLAIN (ANALYZE, BUFFERS)` via psql "$DATABASE_URL". PRECONDITION: target files clean or wait
> 60s ×15 then BLOCKED. Never `git add -A`. index.lock → sleep 10s, retry. Minimum diff;
> byte-identical responses for identical data.

## Measured evidence

- Runtime monitor (2026-07-09): `/signal-monitor/events` route p95 **13,209ms**.
- `signal_monitor_events` table: 83,271 rows / 134 MB (same diagnostic-heavy write pattern family
  as execution_events); firehose #10: signal_monitor_events INSERTs 3,840s pool-time in one
  morning.
- Related landed context: execution_events read-shape work is WO-EE-FIREHOSE (separate); do not
  duplicate it — this WO is the /signal-monitor/events ROUTE and its query shape.

## Mandate

1. **Trace the route** (routes/signal-monitor.ts → service): exact query shape, columns
   (jsonb payloads?), window/limit, ordering, and the index it uses (EXPLAIN it live — cite plan).
2. Bound it: project only consumed columns; enforce a windowed limit that matches what the consumer
   renders/folds (cite the frontend/consumer evidence — grep artifacts/pyrus for the API client
   call); add the supporting index ONLY if EXPLAIN proves it's missing AND write it as a
   manual-apply migration SQL (bef57303 precedent — never apply it yourself).
3. If the route ALSO triggers evaluation work inline (not just a read), document the chain and
   split/bound only with evidence — no speculative restructuring.
4. Response byte-identical for identical data + parameters.

## Tests
- Query-shape regression (bounded window, projected columns) per existing signal-monitor test style.
- Existing signal-monitor suites green.

## Validation
1. `pnpm --filter @workspace/api-server run typecheck` → EXIT 0.
2. `pnpm --filter @workspace/api-server exec tsx --test --test-force-exit src/services/signal-monitor*.test.ts` → 0 fail; counts.

## Files you may touch
- `artifacts/api-server/src/routes/signal-monitor.ts`, `artifacts/api-server/src/services/signal-monitor.ts` (+ ONE test file; + NEW migration SQL only if EXPLAIN-proven)

## Commit
`perf(signal-monitor): bound the /signal-monitor/events route read (was 13.2s p95) (WO-SME-1)` + evidence lines.

Do NOT push. Report: `.codex-watch/wo-sme-1-report.md`; final message 3 lines.
