# WO-FB2-F4A — Memoize per-flush fingerprint + state-signature churn (byte-identical outputs)

> **HEADLESS WORKER PREAMBLE (overrides AGENTS.md session rituals):** You are a headless fix worker,
> not an interactive session. (1) Do NOT create/update any SESSION_HANDOFF_* file. (2) Do NOT read
> ~/.claude/, ~/.agents/, .claude/skills/, .agents/skills/, agents/, or AGENTS.md session sections.
> (3) NEVER restart/rebuild/reload the app, never signal the supervisor, never run
> REPLIT_MODE=workflow, never `git push`. (4) The box has 2 cores and a LIVE trading app: run ONLY
> the validations listed below. (5) Edit ONLY the files under "Files you may touch". The worktree
> carries OTHER agents' uncommitted work — never `git add -A`; stage exactly your files. If
> `.git/index.lock` exists, sleep 10s and retry. (6) Discipline: minimum diff that works; reuse
> existing helpers/patterns; no new abstractions or dependencies; every changed line traces to this
> mandate.

## Context (measured, 2026-07-09)

Root-cause doc: `docs/plans/signal-monitor-gc-pool-rootcause-2026-07-09.md` (cause #3). Per SSE
flush (1s cadence with subscribers), per cell (~12,000 at full universe), the matrix stream path
allocates even on 100% cache hit:

- `fingerprintSignalMonitorMatrixCompletedBars` (near `signal-monitor.ts:9223-9248`): one 6-element
  temp array PER BAR (~240/call), called unconditionally per cell per flush (near `:9380`) and
  again for the snapshot base (near `:6807`). Allocation profile: part of the 40.5MB-inclusive
  flush cluster.
- `signalMonitorMatrixStreamStateSignature` (near `:10688-10713`): fresh ~18-field object +
  `JSON.stringify` string per state per subscriber per flush (via `changedSignalMonitorMatrixStreamStates`
  near `:10838` and `recordSnapshot` near `:10824`). Measured 3.5MB self in a 20s window.

Precedent IN THE SAME FILE: `barsToPyrusSignalsBarEntries` is WeakMap-memoized on the bars-array
reference (near `:6518`/`:6526`) — and the completed-bars caches return the SAME array reference on
hits (`completedBars = cachedCell.bars`, near `:10525`), which is exactly what makes array-identity
memoization effective here.

## Mandate — two memoizations, each gated on identity stability you must VERIFY first

1. **Fingerprint memo**: WeakMap<bars-array, fingerprint> around
   `fingerprintSignalMonitorMatrixCompletedBars`, following the `barsToPyrusSignalsBarEntries`
   pattern exactly. PRECONDITION you must verify from source before implementing: every call site
   passes the CACHED array reference on unchanged cells (i.e. the array is not rebuilt per flush).
   If any hot call site rebuilds the array each flush, the memo is dead weight there — say so in
   the report and memoize only where identity is stable.
2. **Signature churn**: first VERIFY whether the state objects passed to
   `signalMonitorMatrixStreamStateSignature` are reference-stable across flushes when nothing
   changed (read the latch path — `latchSignalMonitorMatrixStreamState` near `:10730`). Then:
   - If stable → WeakMap<state, signature>.
   - If NOT stable (fresh objects per flush) → memoizing on object identity is useless; instead
     hoist the signature to where the latched state is (re)created so it is computed once per state
     CHANGE, not once per flush per subscriber — but ONLY if you can do it with a small, obviously
     correct diff. If the small diff does not exist, implement the fingerprint memo alone and
     document the signature finding with file:line evidence for a follow-up WO.

HARD identity constraint (failable): emitted SSE payloads and change-detection behavior must be
byte-identical. The signature exists to detect state changes — a memo must never return a stale
signature for a state whose FIELDS differ (that would suppress a real emission: user-visible signal
loss). When in doubt, prefer the fingerprint memo alone and report.

## Tests (RED-first where practical)

- Fingerprint: same array reference twice → one underlying computation (observable via a
  test-internals hook if the file has one — check for existing `__signalMonitor...ForTests`
  export patterns — otherwise assert value equality + add the memo-hit counter to an existing
  diagnostics getter if one is exported); different array with same content → still CORRECT value.
- Signature path: two states differing in exactly one signature field → different signatures
  (no false-stale). Unchanged state across two flushes → identical signature value.
- Existing stream identity suites must stay green untouched.

## Validation (all required; report exact outputs)

1. `pnpm --filter @workspace/api-server run typecheck` → EXIT 0.
2. `pnpm --filter @workspace/api-server exec tsx --test --test-force-exit src/services/signal-monitor*.test.ts src/services/signal-options*.test.ts`
   → 0 fail; report counts. (vitest is NOT installed.)

## Files you may touch

- `artifacts/api-server/src/services/signal-monitor.ts`
- ONE test file (existing signal-monitor stream test file or new `src/services/signal-monitor-*.test.ts`)

## Commit (only after validations pass)

```
perf(signal-monitor): memoize completed-bars fingerprint on array identity; cut per-flush signature churn (WO-FB2-F4A)

<3-5 lines: measured churn numbers, which memo(s) landed, the identity-stability evidence, byte-identity guarantee>
```

Do NOT push. Do NOT reload the app.

## Report

`.codex-watch/wo-fb2-f4a-report.md`: identity-stability findings (file:line evidence for both
targets), what landed vs deferred, validation outputs, commit SHA, risks. Final message: 3 lines
max (rc, SHA, counts).
