# WO-FIX-09 — Relic kills + worker signal_refresh uses the scoped reader

Codex worker, PYRUS monorepo /home/runner/workspace, TWO small related fixes (separate hunk sets).
Verify target files CLEAN first (`git status --porcelain --`), edit directly, `git add -- <paths>`
per fix is NOT needed — leave both unstaged; orchestrator stages/commits separately per fix.
No ~/.claude/, .claude/skills/, agents/ reads; never modify agents/openai.yaml.

Discipline: ponytail; fact-first (verify cites — lines shifted in today's landing); the trading
worker path — behavior changes ONLY as specified.

## FIX A — relic kills (from the approved decision doc)
1. artifacts/api-server/src/services/signal-options-worker.ts: remove the dead `getResourcePressure`
   dependency (injected ~:71, stored ~:440, never called — verify with grep before removing; if it
   IS called somewhere now, STOP and report).
2. Remove the exported-but-dead `requestSignalOptionsWorkerScanSoon` (verify zero importers repo-wide
   first; if any importer exists, STOP and report it instead).

## FIX B — scoped reader for signal_refresh
artifacts/api-server/src/services/signal-options-automation.ts: the worker's signal_refresh path
(getSignalMonitorStoredState ~:6312 reached from ~:20361) does a full-universe ~12k-row read; a
deployment-scoped reader exists: `listSignalOptionsStoredSignalStatesFast` (~:5917, SQL-filters
status=ok + signalled + universe inArray + limit 500). Route the WORKER's refresh through the scoped
reader for the deployment's symbol universe. Preserve exact downstream shape: the mapped states must
carry every field the scan consumes (trace consumers of the refresh result before swapping; if any
consumed field is missing from the fast reader's projection, extend the fast reader's SELECT rather
than falling back). The cockpit/display path is OUT of scope (known semantic gaps — do not touch).

## Tests
FIX A: existing worker suites still green. FIX B: one test proving the worker refresh path issues
the scoped query (statement/seam per existing suite conventions) + downstream fields intact.
Run: `pnpm --filter @workspace/api-server exec tsx --test src/services/signal-options-automation.test.ts src/services/background-worker-pressure.test.ts src/services/signal-options-mtf-alignment.test.ts` — all pass, paste output.

## Deliverable
.codex-watch/wo-fix-09-report.md — per-fix what/why + SEPARATE unified diffs + test output.
