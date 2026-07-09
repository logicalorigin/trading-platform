# WO-PRS-1 — Pressure plumbing: persist-queue shedding + correct RSS attribution

> **HEADLESS WORKER PREAMBLE (overrides AGENTS.md session rituals):** Headless fix worker. No
> SESSION_HANDOFF_* writes; don't read ~/.claude/, .claude/skills/, agents/, AGENTS.md session
> sections. NEVER restart/reload/signal the app (no REPLIT_MODE=workflow — retired), never
> `git push`, no DB maintenance. 2-core live box: only listed validations. PRECONDITION: target
> files clean or wait 60s ×15 then BLOCKED. Never `git add -A`. index.lock → sleep 10s, retry.
> Minimum diff.

## Measured evidence

1. **Persist queue under pressure**: runtime showed the bars background-persist worker at
   3 active / **229 queued** while apiPressure was high — the queue (bounded 512, key-deduped,
   commit b9da851a) keeps accumulating and competing with foreground reads instead of shedding.
   Unit: platform.ts barsBackgroundPersistWorker (~:9073) + the persist path in
   signal-monitor-local-bar-cache.ts / market-data-store.ts (persistMarketDataBars*).
2. **RSS attribution bug**: the resource-pressure inputs reported `rssMb: 540.2` while the API
   process RSS was ~1,234MB at the same moment — the pressure sampler reads a stale or WRONG
   process sample, so pressure decisions fire on fiction. Find the sampler
   (`getApiResourcePressureSnapshot` / the apiPressure producer in the flight-recorder/diagnostics
   path) and determine WHERE the number comes from (which pid, which cadence, which field).

## Mandate

1. **Shed, don't hoard**: when resource pressure is high/watch AND the persist queue exceeds a
   threshold (env `BARS_PERSIST_SHED_QUEUE_DEPTH`, default 128), drop best-effort persist entries
   OLDEST-first with a counter + reason in the existing persist diagnostics
   (enqueued/completed/skipped/coalesced/dropped already exist — extend `dropped` with a
   `droppedForPressure` counter). Bars are re-fetchable from the provider (the durable store is a
   cache, not a ledger) — cite the code comment/consumer that confirms this before shedding; if
   ANY persist consumer treats bar_cache as source-of-truth for something non-refetchable, STOP
   and report instead.
2. **Fix the RSS sample**: pressure inputs must read the CURRENT process RSS (process.memoryUsage
   of the API process itself, not a cached/foreign sample). Report the bug's mechanism (file:line)
   and the before/after field values from a live diagnostics read.
3. Surface both in `getRuntimeDiagnostics()` if not already visible.

## Tests
- Shedding: queue past threshold under simulated pressure → oldest dropped, counter increments,
  foreground unaffected; below threshold → no shedding.
- RSS: the pressure-input sampler returns the live process value (test via the module's seam).
- Existing platform persist tests green (platform-bars-background-persist.test.ts).

## Validation
1. `pnpm --filter @workspace/api-server run typecheck` → EXIT 0.
2. `pnpm --filter @workspace/api-server exec tsx --test --test-force-exit src/services/platform-bars-background-persist.test.ts <touched tests>` → 0 fail; counts.

## Files you may touch
- `artifacts/api-server/src/services/platform.ts`, the pressure-sampler module you identify,
  `signal-monitor-local-bar-cache.ts`/`market-data-store.ts` ONLY if the shed threshold lives there
  (+ test files)

## Commit
`fix(pressure): shed best-effort bar persists under pressure (was 229 queued); pressure RSS reads the live process (was 540 vs actual 1234) (WO-PRS-1)` + evidence lines.

Do NOT push. Report: `.codex-watch/wo-prs-1-report.md`; final message 3 lines.
