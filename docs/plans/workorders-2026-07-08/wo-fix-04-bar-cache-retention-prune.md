# WO-FIX-04 — Bound the per-aggregate retention prune scan

You are a codex worker in the PYRUS monorepo at /home/runner/workspace, implementing ONE fix.
Working-tree edits ONLY — NO git commands (target file carries in-flight work).

IMPORTANT: Do NOT read or execute files under ~/.claude/, ~/.agents/, .claude/skills/, or agents/.
Do NOT modify agents/openai.yaml.

## Operating discipline (binding)
Ponytail lazy-correct; fact-first (re-verify the cited lines yourself — the file changed today:
an early-return guard was added to enqueueRollups and committed); surgical.

## The finding (from adversarial review, confidence 0.86, live profile corroborated)
artifacts/api-server/src/services/signal-monitor-local-bar-cache.ts (~713-727 pre-edit): every
`storeMinuteBar` call computes a retention boundary and iterates EVERY key of that symbol's minute
`Map`, deleting expired entries one by one. Default retention is 120h (~4,320+ retained keys per
active symbol at full depth) — so every incoming live aggregate pays an O(retained-keys-per-symbol)
scan even when nothing (or almost nothing) expires. Steady per-tick event-loop work during exactly
the market-hours saturation window.

## Fix shape (lazy, pick the smallest that works — suggested)
Prune on a coarse per-symbol cadence instead of every insert: track per-symbol lastPrunedAtMs (or a
counter) and run the existing full scan only when (now - lastPruned) exceeds ~5 minutes OR the map
size crosses a bound; always keep correctness (a read path that could serve expired bars must not —
check whether any reader depends on prune-on-insert for correctness before relying on cadence;
rollupScanCutoffMs already window-filters reads, verify). Insertion-order deletion tricks are fine
ONLY if the map is actually insertion-ordered by timestamp (out-of-order backfill ingest exists —
check aggregateToCachedMinuteBar/backfill paths) — otherwise keep the scan and just make it rare.

## Test (required)
Extend the bar-cache suites minimally: one test proving (a) expired bars still get pruned
(eventually / on cadence trigger), (b) the per-insert hot path does NOT full-scan every call
(observable via whatever internals seam exists or a cheap counter you add to the internals object).
Follow existing env-save/restore + internals.reset() conventions.

## Verification (run, paste output)
`pnpm --filter @workspace/api-server exec tsx --test src/services/signal-monitor-local-bar-cache-rollup.test.ts src/services/signal-monitor-local-bar-cache.test.ts src/services/signal-monitor-local-bar-cache-persist.test.ts src/services/signal-monitor-local-bar-cache-prefetch.test.ts`
All pass. NO full suite/typecheck/build/app.

## Deliverable
EXACTLY ONE file: .codex-watch/wo-fix-04-report.md — what/why, unified diff of YOUR hunks only
(the file is dirty; separate yours from pre-existing), test output, correctness argument for the
cadence choice (who relies on prune-on-insert?).
