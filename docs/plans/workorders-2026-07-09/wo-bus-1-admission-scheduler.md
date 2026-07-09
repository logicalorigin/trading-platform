# WO-BUS-1 — DB pool admission scheduler ("the bus"): per-lane QoS in front of the shared 12-slot pool

> **HEADLESS WORKER PREAMBLE (overrides AGENTS.md session rituals):** You are a headless fix worker,
> not an interactive session. (1) Do NOT create/update any SESSION_HANDOFF_* file. (2) Do NOT read
> ~/.claude/, ~/.agents/, .claude/skills/, .agents/skills/, agents/, or AGENTS.md session sections.
> (3) NEVER restart/rebuild/reload the app, never signal the supervisor, never run
> REPLIT_MODE=workflow, never `git push`. (4) The box has 2 cores and a LIVE trading app: run ONLY
> the validations listed below. (5) Edit ONLY the files under "Files you may touch".
> **PRECONDITION:** run `git status --short -- lib/db/src/` first; if `lib/db/src/index.ts` or
> `lib/db/src/testing.ts` is dirty (another lane is wiring dbTrading), wait 60s and re-check, up to
> 10 times; if still dirty, STOP and report BLOCKED — do not edit shared dirty files. The worktree
> carries other agents' work — never `git add -A`; stage exactly your files. If `.git/index.lock`
> exists, sleep 10s and retry. (6) Discipline: minimum code that works; no new dependencies
> (node:async_hooks AsyncLocalStorage is stdlib); every changed line traces to this mandate.

## Context (measured; design doc: docs/plans/db-pool-admission-bus-2026-07-09.md — READ IT FIRST)

The shared pg pool (max 12, deliberate — lib/db/src/index.ts:206-214) runs 28-65 waiters at market
open. pg.Pool's FIFO has no QoS: 60-second-queued `auth_sessions` point reads (measured) sit behind
1000-row bar_cache reads and 61s batch inserts. This WO builds the admission layer ONLY — it is
**behavior-neutral when nothing is tagged** (default lane `interactive` is uncapped). Entry-point
tagging is a separate WO (WO-BUS-2, census-gated); do NOT tag any callers in this WO.

## Deliverable — `lib/db/src/admission.ts` (new) + minimal wiring in `lib/db/src/index.ts`

### 1. Pure, injectable scheduler core (unit-testable without a DB)

```
type DbLane = "interactive" | "bulk" | "background";
createDbAdmissionScheduler(config, acquireUnderlying)  // acquireUnderlying injected for tests
```

Semantics (each is a failable test):
- Per-lane in-flight caps from config; `interactive` uncapped (bounded by the pool itself).
  Defaults: `bulk: 6`, `background: 2`; env overrides `PYRUS_DB_LANE_BULK_MAX`,
  `PYRUS_DB_LANE_BACKGROUND_MAX` following the file's existing env-reader helpers.
- FIFO within a lane. Admission order across lanes: any queued entry older than
  `agingMs` (default 5_000, env `PYRUS_DB_LANE_AGING_MS`) is admitted before younger entries of
  any lane — starvation-proof both directions.
- One admission = one slot from checkout until release; a held transaction therefore counts as one
  slot for its whole life. Double-release must be idempotent (guard, count once).
- NO shedding in this WO: a capped lane's entry simply waits (the pool's existing
  connectionTimeoutMillis remains the only timeout authority). Shedding is config-reserved
  (`shedAfterMs` per lane, default off) but NOT enforced yet — implement the config field, leave
  enforcement for a follow-up so no existing background writer can start receiving a new error
  type unreviewed.
- Diagnostics: `getDbAdmissionDiagnostics()` → per lane `{queued, inFlight, admittedTotal,
  maxWaitMs, recentWaitMsP95}` (p95 over a fixed 256-entry ring; integers only, zero allocation on
  the hot path beyond the ring). Also expose the scheduler on the existing pool-diagnostics
  surface: index.ts has a pool diagnostic listener seam (grep `setPostgresPoolDiagnosticListener`
  / the dbPool counters that feed the flight recorder) — add the lane gauges beside the existing
  `dbPool` object so the flight recorder picks them up without api-server changes if the shape
  allows; otherwise just export the getter (api-server wiring is BUS-2).

### 2. Lane context — AsyncLocalStorage

- `runInDbLane(lane: DbLane, fn)` and `currentDbLane()` (default `"interactive"`), exported from
  `@workspace/db`. ALS from `node:async_hooks`.
- Document (comment) the propagation caveat: work enqueued into queues/timers executes OUTSIDE the
  enqueuer's ALS context — drain loops must tag themselves (that is BUS-2's job).

### 3. Wiring to the real pool (`lib/db/src/index.ts`, minimal diff)

- Wrap connection acquisition for the MAIN `pool` only (NOT `tradingPool` — it is the hard trading
  lane). Interception point: the pool instance's `connect`. VERIFY against the installed pg
  version (node_modules/.pnpm/pg@*/) that `pool.query` routes through `this.connect` so one
  interception covers drizzle one-off queries, drizzle transactions, AND raw `pool.query` — cite
  the pg source file:line in your report. Cover both promise and callback call forms of `connect`.
- Release accounting: wrap the checked-out client's `release` (once per checkout) to decrement.
- The existing `instrumentQuery` seam and `__setPoolQueryForTests` must keep working unchanged.

## Tests (new `lib/db/src/admission.test.ts`, node:test; scheduler core via injected fake acquire)

- cap enforcement: bulk cap 2 → 5 concurrent bulk acquisitions run max 2 in flight, FIFO order.
- interactive bypasses caps and is admitted while bulk queue is deep.
- aging: a bulk entry older than agingMs is admitted before a fresh interactive burst.
- tx-holds-slot: an unreleased acquisition keeps its slot; release frees exactly one; double
  release frees exactly one.
- default lane: acquisitions outside runInDbLane are interactive.
- stress: 200 randomized mixed acquisitions/releases — invariants: per-lane inFlight ≤ cap,
  total ≤ injected pool size, every acquisition eventually admitted, counters consistent.
- integration smoke (PGlite not needed): wire the scheduler to a fake pool of size 3 and run
  drizzle-SHAPED usage (acquire→query fn→release) to prove the wiring contract.

## Validation (report exact outputs)

1. `pnpm --filter @workspace/db run typecheck` (verify the package's actual name/script from its
   package.json first; if no typecheck script: `pnpm --filter <pkg> exec tsc -p tsconfig.json --noEmit`).
2. `pnpm --filter <db-pkg> exec tsx --test --test-force-exit src/admission.test.ts` → 0 fail.
3. `pnpm --filter @workspace/api-server run typecheck` → EXIT 0 (proves the export surface change
   breaks nothing downstream).

## Files you may touch

- NEW `lib/db/src/admission.ts`, NEW `lib/db/src/admission.test.ts`
- `lib/db/src/index.ts` (wiring + exports only — respect the PRECONDITION above)

## Commit (only after validations pass)

```
feat(db): per-lane admission scheduler in front of the shared pool (WO-BUS-1)

<3-6 lines: the QoS problem (28-65 waiters, auth 60s queue victim), the lane/caps/aging semantics,
behavior-neutral default, pg interception evidence (file:line), test counts>
```

Do NOT push. Do NOT reload the app.

## Report

`.codex-watch/wo-bus-1-report.md`: pg interception evidence (pg source file:line for
query→connect routing), what changed, validation outputs, commit SHA, follow-ups. Final message:
3 lines max (rc, SHA, counts) — or "BLOCKED: <reason>".
