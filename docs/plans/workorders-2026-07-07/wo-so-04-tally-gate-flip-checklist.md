# WO-SO-04: Running-tally gate-flip checklist (analysis + doc; NO code changes)

You are `codex-worker` (xhigh) for `claude-lead` (session ea30b14a, signal-options lane). Repo `/home/runner/workspace`, branch `main`. Do NOT read `~/.claude/`, `.claude/skills/`, `agents/`. READ-ONLY on all source files — your only writes are the two deliverable markdown files. Do not restart anything, do not send signals to processes, do not modify env files.

## Background

The signal-options running tally is baking in shadow mode: `SIGNAL_OPTIONS_TALLY=shadow` (set in `.pyrus-runtime/dev-env.local`). Shadow bake = fold/tally computes alongside; the full derive from the shadow ledger stays authoritative; a comparator tracks drift. Context docs: `docs/plans/2026-07-06-running-tally-PICKUP.md` (step list: firehose write-cut → authority flip → allowance cache → shadow bake → flip on), `docs/plans/2026-07-07-signal-options-live-money-plan.md` (T17 = bake evaluation + readiness checklist; architecture rules: shadow ledger is SOLE source of truth, tally is a cache, NO new tables). Known caveats from prior sessions: drift counters RESET on every restart/VM rotation (~every 6h at ~:17 past 00/06/12/18 UTC); the in-memory recent-skips comparator buffer starts empty each restart vs the durable store, so post-restart drift can be expected-and-benign ("Fix C" note: seed the buffer from the store at boot or expose lastDriftSample — that fix may or may not be implemented; VERIFY, don't assume). The bake was restarted clean on a pnlDrift fix ~15:00 MDT 2026-07-07 with counters all zero.

## Task

1. **Verify current bake state** (read-only): confirm the env flag is still set and what the live process reports — use the diagnostics HTTP surface on `http://127.0.0.1:8080` (find the runtime-diagnostics/flight-recorder route in `artifacts/api-server/src/routes/` — the fold/tally counters were exposed there per plan T5) and `.pyrus-runtime/flight-recorder/api-current.json`. Record: fold mode, drift counters, last full-rebuild reason, process start time (how much bake time has accumulated since the last reset).
2. **Establish the drift-evidence trail**: figure out from source (`signal-options-automation.ts` tally/fold code — read-only) what exactly increments each drift counter and whether the comparator-seeding fix ("Fix C") is implemented. Classify each possible drift source as REAL (fold bug) vs BENIGN-EXPECTED (restart buffer asymmetry, partial-exit shape changes if WO-SO-01 landed mid-bake).
3. **Author the go/no-go checklist** at `docs/plans/2026-07-07-tally-gate-flip-checklist.md`:
   - Preconditions (each with its exact verification command/route + current PASS/FAIL/UNKNOWN status as of your run): zero REAL drift across ≥N VM rotations (recommend N with reasoning given counters reset — e.g. snapshot-before-rotation procedure), comparator seeding fixed or drift-classification documented, all signal-options suites green, no unexplained tally/ledger divergence in the shadow comparator, live-money plan checkpoints that gate T17.
   - Snapshot procedure: how to capture counter state periodically so rotation resets don't destroy evidence (where to store snapshots — a `.codex-watch/tally-snapshots/` file per rotation is fine; NO new DB tables).
   - The flip procedure itself: exact env change, reload method (state that claude-lead performs SIGUSR2 reload — you do NOT), what to watch in the first hour, and the rollback (flip back to shadow) trigger criteria.
4. **Take the first snapshot** now per your own procedure.

## SCOPE

Writes: `docs/plans/2026-07-07-tally-gate-flip-checklist.md`, `.codex-watch/wo-so-04-tally-checklist-report-2026-07-07.md`, `.codex-watch/tally-snapshots/*`. Everything else read-only.

## Deliverable

`.codex-watch/wo-so-04-tally-checklist-report-2026-07-07.md`: current bake state (observed values), Fix C verdict (implemented or not, with file:line), drift-source classification table, link to the checklist doc, and the first snapshot. Label observed vs inferred vs unknown throughout.
