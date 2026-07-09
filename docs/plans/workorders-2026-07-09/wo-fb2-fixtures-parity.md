# WO-FB2-FIXTURES — Golden parity-fixture harness for evaluatePyrusSignalsSignals (gate for s3b + the warmup audit)

> **HEADLESS WORKER PREAMBLE (overrides AGENTS.md session rituals):** You are a headless fix worker,
> not an interactive session. (1) Do NOT create/update any SESSION_HANDOFF_* file. (2) Do NOT read
> ~/.claude/, ~/.agents/, .claude/skills/, .agents/skills/, agents/, or AGENTS.md session sections.
> (3) NEVER restart/rebuild/reload the app, never signal the supervisor, never run
> REPLIT_MODE=workflow, never `git push`. (4) The box has 2 cores and a LIVE trading app: run ONLY
> the validations listed below. (5) Edit ONLY files under "Files you may touch" — you add NEW files
> plus one package.json script; you make NO behavior change to lib/pyrus-signals-core/src/index.ts
> (read-only reference). The worktree carries OTHER agents' uncommitted work — never `git add -A`;
> stage exactly your files. If `.git/index.lock` exists, sleep 10s and retry. (6) Discipline:
> minimum code that works; node:test only (vitest is NOT installed); no new dependencies.

## Why (context you need, already established — do not re-derive)

`docs/plans/signal-monitor-gc-pool-rootcause-2026-07-09.md` cause #3 + the held WO
`docs/plans/workorders-2026-07-08/wo-fb-s3b-incremental-agg.md`: `evaluatePyrusSignalsSignals`
(`lib/pyrus-signals-core/src/index.ts:1149`) rebuilds ~15 full-length indicator arrays from scratch
per evaluation. Two follow-up levers are BLOCKED on a byte-identical parity gate:

- **s3b (incremental aggregation)**: an incremental engine must produce outputs `===` the
  from-scratch engine at every append step.
- **F1c (warmup reduction)**: universe evaluation loads `PYRUS_SIGNALS_SIGNAL_WARMUP_BARS = 1000`
  bars per (symbol, 15m/1h/1d) cell from the DB. Indicator-math analysis (2026-07-09): SMA/WMA/StdDev
  are WINDOWED (exact after `period` bars), but ATR (`computePyrusSignalsAtr`, index.ts:573-601) and
  ADX (`computePyrusSignalsAdx`, :603+) are WILDER-RECURSIVE — seeded from the series head, the
  running value carries FULL precision (only `result[]` entries round via `toFixed(6)`), so a-priori
  byte-identity across warmup lengths is impossible. HOWEVER the seed error decays geometrically
  (ATR-14: ×(13/14) per bar → below the 6-decimal rounding grain after roughly ~200 bars; ADX's
  double smoothing roughly doubles that), so a shorter warmup CAN be output-identical — an
  EMPIRICAL question your harness must answer, not a design assumption.

This WO builds the harness + goldens + the warmup-sensitivity report. It changes NO runtime behavior.

## Deliverable 1 — fixture generator + committed goldens

New files under `lib/pyrus-signals-core/` (follow the package's existing test layout — inspect it
first; if it has no test dir convention, use `src/__fixtures__/` + `src/parity-fixtures.test.ts`):

- A DETERMINISTIC synthetic series generator (seeded PRNG implemented inline — mulberry32 or
  equivalent, no dependency; fixed seeds committed in the file). Generate OHLCV bar series of
  length 1000 for these cases (one seed each, minimum):
  1. steady uptrend, 2. downtrend, 3. choppy/mean-reverting, 4. gappy (randomly delete 10% of bars —
  timestamps jump), 5. low-liquidity (many zero-volume bars), 6. extreme values (prices ~1e4 and
  ~1e-2), 7. flat (identical bars), 8. short series (length exactly `period-1`, `period`, and
  `2*period+1` for the ADX guard, using the DEFAULT periods you find in the settings — read the
  defaults from the code, do not guess), 9. a series with non-finite values if the bar type permits
  them (if the type forbids NaN, note that and skip).
- First READ `evaluatePyrusSignalsSignals`'s input settings shape and defaults; run each fixture
  through the CURRENT implementation with default settings and store the COMPLETE output (every
  series array, every scalar) as committed golden JSON (one file per fixture, stable key order —
  `JSON.stringify` with sorted keys or a stable serializer you write inline).
- A regeneration script wired as a package.json script in lib/pyrus-signals-core
  (`"fixtures:regen"`) so a DELIBERATE behavior change can re-bless goldens; the test must FAIL if
  the current implementation drifts from the committed goldens.

## Deliverable 2 — append-parity harness API (for s3b to consume later)

Export from the test-support module a helper:
`assertAppendParity(series, evaluateIncremental)` — for k from (smallest valid length) to
series.length: compares `evaluateIncremental(prefix k)` against fresh
`evaluatePyrusSignalsSignals(prefix k)` with deep byte-equality (the stable serializer), throwing
with the first divergent key + index. Include a self-test that runs it with the from-scratch
function itself as the "incremental" candidate over 2 fixtures (must trivially pass — proves the
harness). Full 1000-step × all-fixtures runs are for the future s3b worker; keep the committed
self-test to 2 fixtures to stay fast.

## Deliverable 3 — warmup-sensitivity report (the F1c empirical answer)

A script (package script `"fixtures:warmup-report"`) that, for each fixture and for
N ∈ {240, 300, 380, 460, 540, 700, 1000}: evaluates the FULL 1000-bar series and the LAST-N slice,
then compares the outputs over the last 240 bars (the signal-consuming window — verify from
signal-monitor usage whether the consumer reads more than the tail; cite what you find). Report per
(fixture, N): IDENTICAL or first-divergent (key, index, |Δ|). Write the result table to
`docs/plans/warmup-sensitivity-2026-07-09.md` with a 3-line conclusion: the smallest N that is
byte-identical across ALL fixtures, or "none below 1000". Do NOT change any runtime constant —
report only.

## Validation (report exact outputs)

1. `pnpm --filter @workspace/pyrus-signals-core run typecheck` if the package has a typecheck
   script; otherwise `pnpm --filter @workspace/pyrus-signals-core exec tsc -p tsconfig.json --noEmit`
   (verify the package name from its package.json first — do not guess the filter name).
2. `pnpm --filter <pkg> exec tsx --test --test-force-exit <your new test file>` → 0 fail.
3. The warmup report script runs to completion and the md file exists.

## Files you may touch

- NEW files under `lib/pyrus-signals-core/` (fixtures, goldens, test, scripts) + its package.json
  (scripts section only)
- NEW `docs/plans/warmup-sensitivity-2026-07-09.md`
- NOTHING else. `lib/pyrus-signals-core/src/index.ts` is read-only reference.

## Commit (one commit, only after validations pass)

```
test(pyrus-signals-core): golden parity fixtures + append-parity harness + warmup-sensitivity report (WO-FB2-FIXTURES)

<3-5 lines: fixture cases, golden count, the harness API, and the warmup conclusion number>
```

Do NOT push. Do NOT reload the app.

## Report

`.codex-watch/wo-fb2-fixtures-report.md`: what was built (files), the warmup-sensitivity conclusion
(the decisive number), the settings defaults you found (file:line), validation outputs, commit SHA.
Final message: 3 lines max (rc, SHA, warmup conclusion).
