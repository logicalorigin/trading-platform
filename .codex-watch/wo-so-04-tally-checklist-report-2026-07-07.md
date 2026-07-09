# WO-SO-04 Tally Checklist Report

Worker: `codex-worker` for `claude-lead` session `ea30b14a`.

## Observed Current Bake State

- Repo branch: `main`.
- Short HEAD: `bb752f69`.
- Env flag: `SIGNAL_OPTIONS_TALLY=shadow` in `.pyrus-runtime/dev-env.local`.
- Diagnostics route confirmed from source:
  `artifacts/api-server/src/routes/platform.ts:1739` registers
  `/diagnostics/runtime`; `artifacts/api-server/src/app.ts:259` mounts routes
  under `/api`, so the live route is
  `http://127.0.0.1:8080/api/diagnostics/runtime`.
- Runtime sample at `2026-07-08T01:04:09.410Z`:
  `mode=shadow`, `projections=1`, `drift=0`, `dedupDrift=0`, `pnlDrift=0`,
  `controlDrift=0`, `compares=6`, `rebuilds=0`.
- Flight-recorder sample:
  `.pyrus-runtime/flight-recorder/api-current.json` had `pid=33336`,
  `ppid=33324`, `updatedAt=2026-07-08T01:04:06.887Z`, `uptimeMs=417925`,
  derived process start `2026-07-08T00:57:08.962Z`.

## Inferred

- Bake time accumulated since the latest process reset was about 7m00s at the
  runtime diagnostics sample.
- Current zero counters are useful as a first baseline, but they do not satisfy a
  VM-rotation bake gate.
- The one live projection implies the process has completed at least one
  projection read for the deployment in this process window.

## Unknown

- `lastFullRebuildReason`: unknown. The current diagnostics export does not
  expose it. Source exports `mode`, `projections`, `drift`, `dedupDrift`,
  `pnlDrift`, `controlDrift`, `compares`, and `rebuilds` only
  (`artifacts/api-server/src/services/signal-options-automation.ts:220-239`).
- Signal-options test-suite status: unknown. No tests or typecheck were run by
  this work order.
- Clean bake SHA/state: unknown. The worktree was already dirty with unrelated
  lane work at the start of this analysis.

## Fix C Verdict

Verdict: IMPLEMENTED as a lazy cold-projection seed, not as an eager boot hook.

Evidence:

- `updateSignalOptionsPositionProjection` does a full `listDeploymentEvents`
  read when there is no projection, the config signature changed, or the
  watermark is null (`artifacts/api-server/src/services/signal-options-automation.ts:7484-7488`).
- During that cold rebuild, it iterates all read events and calls
  `recordSignalOptionsRecentSkip` for entry-candidate skips before folding the
  projection (`artifacts/api-server/src/services/signal-options-automation.ts:7489-7496`).
- The recent-skip classifier excludes replay events and position-mark/feed
  degraded skip reasons (`artifacts/api-server/src/services/signal-options-automation.ts:7301-7315`).
- The shadow dedup comparator then reads `listSignalOptionsRecentSkips` and
  compares full seen-signal keys against non-firehose events plus the seeded
  buffer (`artifacts/api-server/src/services/signal-options-automation.ts:20010-20024`).

Practical classification: an empty-buffer restart asymmetry should no longer
produce dedup drift after the first successful cold projection update. If dedup
drift appears after that seed path succeeds, classify it as REAL until proven
otherwise.

## Drift-Source Classification

| Counter or signal | What increments it | REAL vs BENIGN-EXPECTED classification |
|---|---|---|
| `drift` in shadow mode | Position diff between full `deriveActivePositions(eventsAfterMarksRuntime)` and `updateSignalOptionsPositionProjection(...)` (`signal-options-automation.ts:19896-19913`). | REAL by default: fold/tail/watermark/event-ordering bug. BENIGN-EXPECTED only if timestamped to an intentional mid-bake position-event shape rollout, such as WO-SO-01 partial exits, and the final source/tests define the new semantics. Current source still deletes the position on any actionable exit (`signal-options-automation.ts:6739-6754`), so partial residual semantics are not observed implemented here. |
| `drift` in authoritative mode | Full-derive verification diff in `readSignalOptionsAuthoritativeDecisionState`; increments `drift` and `rebuilds` before rebuilding (`signal-options-automation.ts:7600-7618`). | REAL. Roll back immediately if this happens after flip. |
| `rebuilds` | Only increments with authoritative drift self-repair (`signal-options-automation.ts:7611-7612`). | REAL after flip. Initial cold projection rebuilds are not counted here. |
| `dedupDrift` | Missing/extra seen-signal keys between full seen-signal computation and non-firehose events plus recent-skip buffer (`signal-options-automation.ts:20010-20024`). | REAL by default. BENIGN-EXPECTED only for a documented first-tick restart seed failure or a timestamped firehose/write-cut transition with source evidence. With current Fix C seed path, normal post-restart empty-buffer drift is not expected. |
| `pnlDrift` | Difference greater than `1e-6` between `projectionDailyPnl(...)` and full `computeSignalOptionsDailyPnl(...)` (`signal-options-automation.ts:20053-20068`). | REAL by default: projected event retention or daily-P&L fold bug. Previous pre-fix `pnlDrift` before the clean restart is not evidence against the current bake. |
| `controlDrift` | Difference between `projectionControlUpdatedAt(...)` and `latestSignalOptionsControlUpdatedAt(...)` (`signal-options-automation.ts:19925-19943`). | REAL by default: projected event retention/control-event ordering bug. BENIGN-EXPECTED only for a documented control-event shape transition during a planned reload window. |
| `compares` | Incremented for each shadow or authoritative comparison (`signal-options-automation.ts:19906`, `19930`, `20020`, `20062`, `7605`). | Not a drift signal. It is the denominator proving the comparator actually ran. |
| Compare failure logs | Caught exceptions log `shadow-compare failed`, `dedup shadow-compare failed`, `dailyPnl compare failed`, etc. | UNKNOWN until logs are inspected. They do not increment drift counters and should block gate flip if recurring. |

## Checklist And Snapshot

- Checklist doc:
  `docs/plans/2026-07-07-tally-gate-flip-checklist.md`.
- First snapshot:
  `.codex-watch/tally-snapshots/2026-07-08T010409Z.md`.

## Go/No-Go Summary

Current state is NO-GO for flipping to `SIGNAL_OPTIONS_TALLY=on`.

Observed counters are clean, Fix C is implemented, and diagnostics are visible.
The blocker is evidence duration: the live process had only about 7 minutes of
counter history at the snapshot, while the live-money T17 gate requires zero
REAL drift across a bake that includes VM rotations. The checklist recommends
28 consecutive rotation windows, matching about one week at 6h rotations, with
pre- and post-rotation snapshots so counter resets do not erase evidence.
