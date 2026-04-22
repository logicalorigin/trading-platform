# Session Handoff

Use this file as a quick repo-level resume summary. The per-session ledger in `.agents/sessions` remains the primary recovery source.

## Current Handoff
- session_id: `019d639f-d764-74b3-ba10-909786a4f503`
- updated_at_utc: `2026-04-06T18:44:34Z`
- branch: `main`
- scope:
  - `main` now contains the RayAlgo staged-runtime/chart-control foundation and the DB-backed score-study operator workflow.
  - Score-study catalog reads now avoid hydrating large saved payloads by default, and the frontend only fetches full run artifacts when `Research` or compare `Detailed Playback` is explicitly opened.
  - Stale git worktree metadata was pruned. `/home/runner/workspace` is the only active worktree.

## Key Files
- `/home/runner/workspace/server/services/researchScoreStudyService.js`
- `/home/runner/workspace/src/research/hooks/useResearchExecution.js`
- `/home/runner/workspace/src/components/research/insights/ResearchInsightsScoreStudyTab.jsx`
- `/home/runner/workspace/server/services/researchBacktestJobManager.js`
- `/home/runner/workspace/src/research/engine/rayalgoScoring.js`

## Verification
- `npm run build`
- `node --test server/services/researchBacktestJobManager.test.js server/services/researchSpotHistory.test.js server/services/rayalgoParity.test.js server/services/researchScoreStudyService.test.js src/research/engine/rayalgoScoring.test.js src/research/engine/runtimeBacktestV2Parity.test.js src/research/config/backtestV2RuntimeBridge.test.js src/research/hooks/useResearchControls.test.js src/research/hooks/useResearchExecution.scoreStudySelection.test.js src/research/analysis/rayalgoScoreStudyResearchModel.test.js`
- Live request-path check confirmed:
  - normal score-tuning mount requests only `/api/research/score-studies/runs` and `/api/research/score-studies/artifacts/local`
  - `/api/research/score-studies/runs/:id` is now loaded on demand only from `Research` and compare `Detailed Playback`

## Important Notes
- `main` is the canonical resume surface now; the previously referenced isolated worktree no longer exists.
- The explicit full run-detail endpoint is still large, about 36.5 MB for the sampled run, but it is no longer part of the default page-load path.
- `npm run build` still reports large client chunks for the research workbench bundle; this is a warning, not a failing check.

## Deferred / Incomplete
- If terminal or browser responsiveness still regresses after this branch is deployed, the next diagnostic surface should be long-lived streaming traffic rather than saved-run catalog hydration.
- Research workbench bundle splitting remains an optional follow-up if startup size becomes a priority.

## Remaining Uncommitted Worktree
- No product-code changes are intended to remain after the final meta commit and push.

## Next Actions
- Push `main` after the final meta commit.
- If needed later, profile streaming traffic under active backtest/score-study sessions rather than the saved-run catalog path.
