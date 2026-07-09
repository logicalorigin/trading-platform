# WO-FB-S3A — Memoize pure hot fns normalizeSymbol + resolveSignalMonitorReferenceBar

> **HEADLESS WORKER PREAMBLE (overrides AGENTS.md session rituals for this run):** You are a
> headless work-order worker, not an interactive session. (1) Do NOT create or update any
> SESSION_HANDOFF_* file — the orchestrator owns handoffs. (2) Do NOT read ~/.claude/, ~/.agents/,
> .claude/skills/, .agents/skills/, or agents/ — skill definitions are for other tooling and waste
> your run. (3) NEVER restart, rebuild, or reload the app; never run REPLIT_MODE=workflow, never
> signal the supervisor (no SIGUSR2) — the orchestrator owns runtime. (4) AGENTS.md coding
> discipline (lazy-minimal, stdlib-first, smallest diff) still applies. Work ONLY the order below.


Codex worker (xhigh), /home/runner/workspace. Brief: `docs/plans/signal-monitor-db-load-rootcause-2026-07-08.md`
(NEXT / Stage 3 lever (a)). Warm-regime signal-monitor eval CPU is the pin; two PURE per-eval fns show
in the live CPU profile — `normalizeSymbol` 1.6% and `resolveSignalMonitorReferenceBar` 2.7% of busy CPU
— recomputing identical work per tick over ~2000 symbols. Memoize them (bounded). Signal outputs MUST
stay byte-identical.

PURITY (verified by reading current tree; no clock/state reads):
- `normalizeSymbol` (lib/values.ts:197): `trim().toUpperCase()` + one regex test + optional `.replace`.
- `resolveSignalMonitorReferenceBar` (signal-monitor.ts:4454): depends only on `input.bar` /
  `input.referenceBars` via pure helpers (`signalMonitorBarTimestampMs`, `isSignalMonitorLiveEdgeBar`,
  `signalMonitorBarClose`).

## Files + anchors (VERIFIED; re-locate by snippet if lines drift)
FILE 1 `artifacts/api-server/src/lib/values.ts` (CLEAN). L197 `export function normalizeSymbol(symbol: string): string {`
…L206 `}`. Imported + called 69× in signal-monitor.ts hot loop — memoize at the DEFINITION (1-fn diff),
NOT the 69 call sites.
FILE 2 `artifacts/api-server/src/services/signal-monitor.ts` (DIRTY — other lanes' WIP). L4454
`function resolveSignalMonitorReferenceBar(input: {`; expensive filter→map→sort pipeline is L4462–4474
(`const references = input.referenceBars … .sort(...)`). Only caller path reuses a STABLE
`input.baseBars` array across a per-bar loop (`filterSignalMonitorLiveEdgeBarsForTrustedMove` L4555 →
`resolveSignalMonitorSourceIntegrity` L4521).

## Change
1. `normalizeSymbol`: add a module-level `Map<string,string>`. Return cached value for raw `symbol` key
   if present; else run the EXISTING logic verbatim, store, return. Bound it: before insert, if
   `size >= 8192` call `.clear()`. Do NOT change the computed output.
2. `resolveSignalMonitorReferenceBar`: hoist the referenceBars-only work into a
   `WeakMap<SignalMonitorBarSnapshot[], {reference; timestampMs:number}[]>` keyed by `input.referenceBars`
   identity. Cached value = the sorted list from `[filter !isLiveEdge → filter close!=null → map
   {reference,timestampMs} → filter timestampMs!=null → sort asc]`, i.e. everything EXCEPT the
   `reference !== input.bar` filter. Per call: get-or-compute the list, then apply
   `entry.reference !== input.bar` as a linear filter to rebuild the original `references` array; keep the
   rest of the fn (barMs guard, `prior` pick, nearest fallback) UNCHANGED. WeakMap = inherently bounded;
   no size cap.
   Byte-identical: the four filters are independent predicates (commute); V8 sort is stable and removing
   `input.bar` from the sorted superset does not reorder survivors → `references` is object- and
   order-identical to today's.

## MUST-NOT
- Signal identity/timing/trading safety byte-identical: which signals fire and when must NOT change; do
  not alter reference-selection outcome or `normalizeSymbol` output.
- Laziest solution: minimal diff, stdlib only (`Map`/`WeakMap`), NO new deps/LRU lib, no config flags, no
  abstraction. Memoize at each definition, not the 69 call sites.
- No unbounded growth (active repo hunt): the `normalizeSymbol` Map MUST be capped (clear at 8192); the
  reference cache MUST be a WeakMap.
- Touch ONLY the two named functions/regions. signal-monitor.ts is dirty with other lanes — do NOT
  revert/reformat/clean up outside your hunks. NEVER `git checkout`/`restore`.
- Do NOT commit. Do NOT `git add`. Leave changes in the working tree; the orchestrator commits.
- signal-monitor.ts may be concurrently edited — run `git diff --stat` on it at start, note its state.

## Acceptance + verification (run before the report)
1. `cd /home/runner/workspace && pnpm --filter @workspace/api-server run typecheck` → exit 0.
2. `pnpm --filter @workspace/api-server exec tsx --test src/services/signal-monitor*.test.ts src/services/signal-options*.test.ts`
   — baseline measured 2026-07-08 ~18:50 MDT is **442 pass / 0 fail**. It must stay 442+/0. ANY red IS yours.
3. No new test required (existing identity/parity tests are the guard).

## Report → `.codex-watch/wo-fb-s3a-memoize-report.md`
what changed (file:line for both), verbatim tails of typecheck + tests (must be 442+/0), purity
confirmation, the byte-identical argument for the reference-cache reorder, risks, and
`git diff --stat` of both touched files + starting dirty-state of signal-monitor.ts.
