# WO-S3B-3 — Incremental evaluator: parameterize lastBarClosed (fixes review P1)

> **HEADLESS WORKER PREAMBLE (overrides AGENTS.md session rituals):** You are a headless fix worker,
> not an interactive session. (1) Do NOT create/update any SESSION_HANDOFF_* file. (2) Do NOT read
> ~/.claude/, ~/.agents/, .claude/skills/, .agents/skills/, agents/, or AGENTS.md session sections.
> (3) NEVER restart/rebuild/reload the app, never signal the supervisor, never `git push`. (4) 2-core
> box, LIVE trading app: run ONLY the listed validations. (5) Edit ONLY files under "Files you may
> touch" (all in lib/pyrus-signals-core — do NOT touch artifacts/api-server). Never `git add -A`.
> If `.git/index.lock` exists, sleep 10s and retry. (6) Minimum diff; byte-identity beats elegance.

## The defect (adversarial review of commit dffa255e — P1)

`lib/pyrus-signals-core/src/incremental.ts:499` hardcodes `private readonly lastBarClosed = true;`
(used at `:759`). The public evaluator takes `lastBarClosed?: boolean` (index.ts:1159, default
FALSE = forming-bar suppression, gate at `:1387`), and PRODUCTION passes it DYNAMICALLY — it is
even part of the heavy-eval cache-key identity (`"lc1"/"lc0"`, signal-monitor.ts:9351; computed via
`signalMonitorLastBarClosed(...)` at :8621/:9481). With the hardcode, the incremental engine emits
final-bar signals in states where the from-scratch engine suppresses them — a trade-firing
divergence the moment the wiring goes live. The parity fixtures missed it because they pin
`lastBarClosed: true` (parity-fixtures.ts:402).

## Mandate

1. `createIncrementalPyrusSignalsEvaluator` accepts the SAME evaluation options the public
   evaluator takes for this semantic — study index.ts:1149-1170 for the exact option names
   (`lastBarClosed`, and check whether `includeProvisionalSignals` or a related option also
   interacts with the `:1387` gate; handle every option that changes per-call in production).
   Because these change PER EVALUATION in production (not per instance), the API shape must let the
   caller supply them per `append()`/`result()` call OR make them immutable per instance and
   documented as part of instance identity (matching how production keys its cache with lc0/lc1) —
   choose whichever matches the from-scratch arithmetic EXACTLY with the smaller diff, and justify
   the choice in the report. CAUTION: `lastBarClosed` affects only final-bar emission logic — if it
   toggles between appends for the same instance, verify from index.ts whether earlier-bar outputs
   are unaffected (the gate at :1387 references `index < chartBars.length - 1`, i.e. only the LAST
   bar's actionability); prove it rather than assuming.
2. Extend the parity coverage: `assertAppendParity` (or a variant) must run with
   `lastBarClosed: false`, `lastBarClosed: true`, AND a mixed sequence that mirrors production
   (false while a provisional tail exists, true on close) — byte-identical at every step against
   from-scratch called with the same options.
3. Re-bless nothing: committed goldens pin `lastBarClosed: true` — they must still pass untouched.

## Validation

1. Package typecheck (lib/pyrus-signals-core).
2. `pnpm --filter <pkg> exec tsx --test --test-force-exit src/parity-fixtures.test.ts <your test file>` → 0 fail; report counts.

## Files you may touch

- `lib/pyrus-signals-core/src/incremental.ts`
- `lib/pyrus-signals-core/src/__fixtures__/parity-fixtures.ts` (harness variant only; goldens untouched)
- test file(s) in lib/pyrus-signals-core

## Commit

```
fix(pyrus-signals-core): incremental evaluator honors lastBarClosed semantics per production usage (WO-S3B-3, review P1)

<3-5 lines: the hardcode, the API choice made and why, parity coverage added>
```

Do NOT push. Do NOT reload.

## Report

`.codex-watch/wo-s3b-3-report.md`: the API-shape decision + the :1387 gate analysis, parity counts,
commit SHA. Final message: 3 lines max.
