# WO-06: Signal-score expected-move-v2 recalibration follow-up

You are `codex-worker` for `claude-lead` (session f68a9158). Repo `/home/runner/workspace`, branch `main`. Do NOT read `~/.claude/`, `.claude/skills/`, `agents/`. TRADING-BEHAVIOR SENSITIVE: produce analysis + code, but NO active-model/config flip without the user — the flip is a separate user decision.

## Step 0 — reconcile overlap (mandatory)

`git show --stat 7d5445f2` ("calibration, marks-reader and flag-gated tally strands") and skim its diff for signal-quality/calibration content. If it (or any commit since Jul 3 — `git log --oneline --since=2026-07-03 -- artifacts/api-server/src/services/signal-quality-kpis-service.ts artifacts/api-server/src/services/signal-quality-kpis.ts`) already implements parts of the list below, record that in your report and skip those parts.

## Context

Calibration lane lineage: `f4ebf37d` → `7690f9ca` (Jul 1, Python directional features — live verification never done) → `ce6a2d36` (Jul 3, shipped expected-move-v2 as active scorer) → `f890fb57` (Jul 3, left the follow-up list). Display side landed (`1ce0161c`). Live deployment id used previously: `7e2e4e6f-...` (KPI refresh route `/api/algo/deployments/<id>/signal-quality-kpis/refresh`).

Open list from `f890fb57` (verbatim intent):
1. Regenerate observation dumps (`SIGNAL_QUALITY_OBSERVATION_DUMP_PATH` env drives the dump writer).
2. Compute P(score≥90 | MFE≥10/20/30%) big-mover metrics.
3. Fit per-timeframe isotonic/quantile calibration.
4. Fold continuous features into the score.
5. Add a magnitude-alignment axis.
6. Reconcile the active model — recommendation only, no flip.

Prerequisite check from `7690f9ca`: confirm pyrus_compute emits `filterState.directionalFeatures` on LIVE STA rows (`python/pyrus_compute/src/pyrus_compute/jobs.py` has the code; the compute lane restart + live verification never happened). Verify live via the running API (compute binds 18768/18770): query the matrix/STA stream read-only and inspect a row. If the live lane predates jobs.py changes, note "needs compute-lane reload by claude-lead" — do NOT restart anything yourself.

## Task

Work items 1–5 (minus step-0 skips) as analysis scripts + service code where the lineage already established homes: `artifacts/api-server/src/services/signal-quality-kpis-service.ts`, `signal-quality-kpis.ts`, analysis scripts under `scripts/` (commit-worthy, deterministic, documented flags). Then write item 6 as a recommendation with metrics tables.

## SCOPE

The two kpis service files (+ their tests), new files under `scripts/signal-calibration/`, `python/pyrus_compute/tests/` if a directional-features test needs extension. Do NOT touch `signal-options-automation.ts` (live lane), scorer selection config, or `algoHelpers.js`.

## Acceptance / verification

- `pnpm --filter @workspace/api-server test -- signal-quality-kpis` green; `python -m pytest python/pyrus_compute/tests/test_signal_matrix_directional_features.py` green (run via the repo's python env; check `python/pyrus_compute/README` or pyproject for the runner).
- Dumps regenerated to a dated path; metrics + calibration-fit results reproduced by one documented script invocation each.
- Report ends with a keep/adjust recommendation for the active model, clearly marked "decision pending user".
- Scope-check passes; commit the scripts + tests on a `feat(signals): calibration follow-up` themed commit; do NOT push.

## Deliverable

`.codex-watch/wo-06-recalibration-report-2026-07-07.md` with metrics tables, fit quality, directional-features live verdict, and the recommendation.
