# WO-EE-FIREHOSE — execution_events: stop the diagnostic-event firehose, per-type retention, then reclaim

> **HEADLESS WORKER PREAMBLE (overrides AGENTS.md session rituals):** You are a headless fix worker,
> not an interactive session. (1) Do NOT create/update any SESSION_HANDOFF_* file. (2) Do NOT read
> ~/.claude/, ~/.agents/, .claude/skills/, .agents/skills/, agents/, or AGENTS.md session sections.
> (3) NEVER restart/rebuild/reload the app, never signal the supervisor, never `git push`, never
> run VACUUM/VACUUM FULL or apply retention deletes to the live DB yourself. (4) 2-core box, LIVE
> trading app: run ONLY the listed validations. (5) Edit ONLY files under "Files you may touch"; if
> a target file is dirty from another lane, wait 60s up to 10 tries then report BLOCKED for that
> file. Never `git add -A`. If `.git/index.lock` exists, sleep 10s and retry. (6) Minimum diff;
> reuse existing patterns (the automation_diagnostics 7-day prune and the retention-scheduler are
> the in-repo precedents).

## Corrected diagnosis (measured 2026-07-09 ~11:10 MDT — supersedes any earlier "dead-space bloat" claim)

`execution_events` = 3,384 MB / **1,086,718 LIVE rows** (earlier "~4k rows" readings were a
stats-reset artifact). Age distribution: 92% of all rows written in the LAST 7 DAYS (~143k/day —
140× the historical ~1k/day rate; the jump began ~2026-07-02 and widened with commit `d55d8bfe`).
Last-7-day composition:

- `signal_options_candidate_skipped`: **853,124 rows / 1,672 MB payload** — one ~2KB event per
  candidate per scan cycle. The events API already excludes its payload unless `view=full`
  (automation.ts:1257) and the frontend filters it from toasts as "high-frequency"
  (algoEventToasts.js:18). Nobody consumes 853k persisted rows.
- `signal_options_shadow_mark`: 146,243 rows / 489 MB — per-position per-tick mark events.
- REAL trade history is tiny: entries 53, exits 42, candidates_created 3,103.

Owner decisions (Riley, confirmed): skip-event debugging is same-day/last-hour only → coalesce the
writes; diagnostic event types get 48h retention; trade events keep forever.

## Deliverable 1 — coalesce `signal_options_candidate_skipped` writes at the source

In `signal-options-automation.ts` (writer of SIGNAL_OPTIONS_SKIPPED_EVENT, constant at :158):
- One row per (deploymentId, symbol, skip-reason) per 15-minute window (env
  `SIGNAL_OPTIONS_SKIP_EVENT_COALESCE_MS`, default 900_000): first skip in a window INSERTs;
  subsequent identical skips UPDATE that row's `count`, `lastSeenAt`, and occurredAt — reuse the
  EXISTING blocked-scan coalescing pattern in this file (the gateway-blocked update path) rather
  than inventing one. Keep the in-memory window index bounded (LRU ≤ 4,096 keys).
- The payload keeps ONLY what the same-day debugging view needs (reason, readiness details of the
  LAST skip, count, firstSeenAt) — do not accumulate arrays of every skip.
- Read paths (diagnostics.ts:58 consumer, events API view=full) must keep working — verify their
  shape expectations before changing payload fields; cite what they read.

## Deliverable 2 — rate-bound `signal_options_shadow_mark` events

Find the writer; marks already persist to the shadow mark tables — the EVENT-stream copy gets a
per-position floor (env `SIGNAL_OPTIONS_MARK_EVENT_MIN_INTERVAL_MS`, default 300_000 = one event
per position per 5 min; always write entry/exit-adjacent marks regardless of the floor if the code
distinguishes them). Cite the consumer(s) of mark EVENTS before choosing what survives.

## Deliverable 3 — per-type retention (scheduler code only; NO manual deletes by you)

Extend the existing retention-scheduler pattern (the bar_cache prune / automation_diagnostics
7-day precedent): diagnostic event types (`signal_options_candidate_skipped`,
`signal_options_shadow_mark`, gateway-blocked, and any other diagnostics-class types you find —
list them in the report) pruned past 48h (env `EXECUTION_EVENTS_DIAGNOSTIC_RETENTION_HOURS`),
batched deletes (bounded batch size, pool-pressure-aware like the bar_cache pruner), running on the
background DB lane (`runInDbLane("background", ...)` — available since commit 2fda13f3). Trade/
lifecycle event types are NEVER pruned. First sweep will delete ~1M rows in batches — the batch
size + pause pattern must match the bar_cache pruner's.

## Deliverable 4 — bounded hot read shapes (unchanged from the prior WO)

The wide full-row event reads: `listDeploymentEvents` family (signal-options-automation.ts:2242,
up to 10k rows incl. payload), `buildRealPositionAttribution` (account.ts:6103, LIMIT 1000 jsonb
rows on the interactive positions path). Project needed columns / split payload fetch to rendered
rows; outputs byte-identical for the same data; cite each consumer.

## Deliverable 5 — reclaim RUNBOOK update (do NOT execute)

Update/write `docs/plans/execution-events-reclaim-runbook-2026-07-09.md`: AFTER the retention
sweep has drained the backlog (table down to ~days of coalesced events), a `VACUUM FULL
execution_events` becomes cheap (small rewrite) — sequence, verification, lock note. Riley
schedules it.

## Validation

1. `pnpm --filter @workspace/api-server run typecheck` → EXIT 0.
2. `pnpm --filter @workspace/api-server exec tsx --test --test-force-exit <touched test files>` → 0 fail
   (add coalescing-window, retention-selection, and read-shape tests following sibling patterns).

## Files you may touch

- `artifacts/api-server/src/services/signal-options-automation.ts`
- `artifacts/api-server/src/services/account.ts` (read shape only)
- the retention-scheduler file you find (cite it)
- ONE test file per touched source file
- `docs/plans/execution-events-reclaim-runbook-2026-07-09.md`

## Commit (one commit; runbook may ride along)

```
perf(execution-events): coalesce candidate-skip firehose (853k rows/7d), rate-bound mark events, 48h diagnostic retention (WO-EE-FIREHOSE)

<4-6 lines: measured composition, coalescing/floor semantics, retention types list, runbook pointer>
```

Do NOT push. Do NOT reload. Do NOT run any DB maintenance.

## Report

`.codex-watch/wo-ee-firehose-report.md`: consumers found for skip/mark events (file:line),
diagnostics-class type list, batch-prune parameters chosen, validation outputs, commit SHA. Final
message: 3 lines max.
