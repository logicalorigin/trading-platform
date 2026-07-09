# WO-R4 — Gray-file provenance audit + separate commits (diagnostics, automation, universe schema)

Codex worker, /home/runner/workspace. Apply /ponytail discipline (level: full). You HAVE commit
authority ONLY for units you can prove self-contained AND test-green. NEVER `git add -A`,
`git add .`, or `git commit -a`. Stage by explicit path only. When in doubt: leave dirty + report.

CONTEXT: Three dirty units could not be firmly attributed to session 8939ce3f's workstreams. The
user chose "verify + commit separately": audit each unit's hunks; anything self-contained and green
lands as its OWN clearly-labeled commit; anything entangled with held lanes stays dirty.

## Unit 1 — diagnostics storage census
Files: `artifacts/api-server/src/services/diagnostics.ts`,
`artifacts/api-server/src/services/diagnostics-ibkr-metrics.test.ts`
- Expected hunks: MONITORED_STORAGE_TABLES census addition; test pairing with diagnostics changes.
- Disqualifiers: any hunk referencing SnapTrade/backtest/overnight/flow WIP.
- Verify: api-server typecheck EXIT=0 + `pnpm --filter @workspace/api-server exec vitest run src/services/diagnostics-ibkr-metrics.test.ts`.
- Commit: `chore(diagnostics): monitored storage tables census (WO-R4)`

## Unit 2 — automation execution-events read coalescing
Files: `artifacts/api-server/src/services/automation.ts`,
`artifacts/api-server/src/services/automation.merge-events.test.ts`
- Expected hunks: listExecutionEvents/mergeExecutionEventRows extraction + deploymentListInFlight
  coalescing (read-fanout dedup).
- Verify: typecheck + `pnpm --filter @workspace/api-server exec vitest run src/services/automation.merge-events.test.ts`.
- Commit: `perf(automation): coalesce deployment list reads; extract execution-event merge (WO-R4)`

## Unit 3 — universe optionability schema + migration
Files: `lib/db/src/schema/universe.ts`, `lib/db/src/schema/index.ts`, and the UNTRACKED migration
`lib/db/migrations/20260707_universe_catalog_optionable_partial_idx.sql` (confirm exact path via
`git status --porcelain | grep -i universe`).
- Expected: optionable columns on universeCatalogListingsTable + partial index migration (census
  S14). The migration is manual-apply (CREATE INDEX CONCURRENTLY; drizzle push disabled) — commit
  the file, do NOT apply it to the DB.
- Disqualifier: if schema/index.ts's export line also serves the untracked
  overnight_signal_expectancy migration/feature (a held lane), split: commit only the
  universe-related change if separable, else leave both and report.
- Verify: db package typecheck + api-server typecheck (schema is imported downstream).
- Commit: `feat(db-schema): universe catalog optionability columns + partial index migration, manual-apply (WO-R4)`

## Guardrails
- Do NOT touch anything else — especially: account.ts, backtest-worker/**, flow-universe.ts,
  snaptrade-*, backtesting.ts, overnight-spot-worker.ts, overnight_signal_expectancy* migration,
  artifacts/pyrus/**, SESSION_HANDOFF* / POLISH_BACKLOG.md.
- Each unit commits independently; a failing unit blocks only itself.

Report → `.codex-watch/wo-r4-report.md`: per-unit verdict (committed SHA / left-dirty + why),
verify output tails, provenance evidence per unit.
