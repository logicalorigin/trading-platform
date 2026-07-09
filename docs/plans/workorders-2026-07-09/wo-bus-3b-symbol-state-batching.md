# WO-BUS-3B — Batch the signal-monitor symbol-state write storm — **GATED: DO NOT DISPATCH until re-measured**

> **DISPATCH GATE (2026-07-09 ~10:15 MDT):** the census cadence claim (~2,000-3,500/min) was
> DISPROVEN in the live midday window — measured 8 upserts/min over 60s
> (pg_stat_user_tables n_tup_upd delta on signal_monitor_symbol_states). Historical total (525k
> updates since the 07-07 stats reset) says it HAS run hot, so re-measure the same 60s delta at
> MARKET OPEN (~07:31 MDT); dispatch only if sustained ≥300 upserts/min. First dispatch attempt was
> killed on this evidence.

> **HEADLESS WORKER PREAMBLE (overrides AGENTS.md session rituals):** You are a headless fix worker,
> not an interactive session. (1) Do NOT create/update any SESSION_HANDOFF_* file. (2) Do NOT read
> ~/.claude/, ~/.agents/, .claude/skills/, .agents/skills/, agents/, or AGENTS.md session sections.
> (3) NEVER restart/rebuild/reload the app, never signal the supervisor, never `git push`. (4) 2-core
> box, LIVE trading app: run ONLY the listed validations. (5) Edit ONLY files under "Files you may
> touch". **PRECONDITION: `git status --short -- artifacts/api-server/src/services/signal-monitor.ts`
> must be clean** (another chain may be finishing in it) — if dirty, wait 60s up to 10 tries, then
> BLOCKED. Never `git add -A`. If `.git/index.lock` exists, sleep 10s and retry. (6) Minimum diff;
> reuse the file's existing batching/coalescing patterns (the bars-persist unit is the in-repo
> precedent: window-key coalescing, bounded queue — commit b9da851a).

## Context (measured, census 2026-07-09)

`upsertSymbolState` (`artifacts/api-server/src/services/signal-monitor.ts:7677` — verify by grep)
issues ~2,000-3,500 SINGLE-ROW upserts/min at market open (per-symbol state after evaluation:
current_signal_direction, trend_direction, ... — the firehose #9 signal_monitor state shape). Each
is a full pool acquisition + round trip. This is the largest CONNECTION-ACQUISITION-COUNT consumer
in the census — the pool queue pays 2-3.5k admissions/min for tiny rows.

## Mandate

Coalesce into windowed multi-row upserts:

- Buffer state writes in a module map keyed by the row's unique key (symbol/timeframe/profile —
  read the actual conflict target from the existing upsert). Last write per key wins within a
  window (that is already the semantic end-state of racing single-row upserts).
- Flush every FLUSH_MS (default 1000ms, env `SIGNAL_MONITOR_STATE_FLUSH_MS`) OR when the buffer
  reaches 500 keys, whichever first, as ONE `INSERT .. ON CONFLICT DO UPDATE` with N rows (chunk at
  the repo's existing bar-cache write batch size if a shared constant exists).
- Preserve every column and the exact conflict-update SET list of the current single-row statement.
- Durability semantics change: a crash can now lose up to FLUSH_MS of state rows. State is
  recomputed every evaluation cycle, so this is acceptable — SAY SO in a comment and flush the
  buffer on graceful shutdown (find the existing shutdown hook; if none exists for this module,
  note it in the report rather than building one).
- Read-your-writes: check whether anything READS symbol state within the same cycle expecting the
  just-written row (grep readers of the table in signal-monitor.ts). If yes, serve pending-buffer
  values to those readers or flush-before-read — evidence in the report either way.
- Failure isolation: a failed flush must not throw into the evaluation loop (log + retain buffer for
  the next flush, bounded: drop-oldest beyond 5,000 keys with a counter).

## Tests (RED-first where practical; follow the persist unit's test style)

- N writes to the same key within a window → ONE row in the flushed statement, last value.
- Mixed keys → one multi-row statement, all rows present.
- Flush failure → values retained and flushed next window; evaluation loop unaffected.
- Cap: buffer never exceeds 5,000 keys; drop counter increments.
- Read-your-writes behavior per your findings.

## Validation

1. `pnpm --filter @workspace/api-server run typecheck` → EXIT 0.
2. `pnpm --filter @workspace/api-server exec tsx --test --test-force-exit src/services/signal-monitor*.test.ts` → 0 fail; report counts.

## Files you may touch

- `artifacts/api-server/src/services/signal-monitor.ts`
- ONE test file (existing signal-monitor test file or new focused one)

## Commit

```
perf(signal-monitor): coalesce symbol-state upserts into windowed multi-row flushes (WO-BUS-3B)

<3-5 lines: the 2-3.5k/min measurement, window/cap semantics, durability note, read-your-writes finding>
```

Do NOT push. Do NOT reload.

## Report

`.codex-watch/wo-bus-3b-report.md`: the conflict target + SET list preserved, read-your-writes
finding, validation outputs, commit SHA. Final message: 3 lines max.
