# WO-P2P3-RECOVERY — regenerate the lost P2/P3 review backlog (READ-ONLY, report only)

Codex worker, /home/runner/workspace. READ-ONLY: do NOT edit any code, do NOT run mutating git.
The prior whole-codebase review workflow journal (wf_3eda40c2-8ca) was lost on VM rotation; its
~49 P2 + ~109 P3 findings are gone. Regenerate an equivalent P2/P3 backlog by re-reviewing the code.

FIRST read `docs/plans/2026-07-08-review-session-findings-plan.md` to learn what is ALREADY tracked.
EXCLUDE from your report: any P1; anything already listed in that plan's Phase 1/1b/1c/2/4/5; anything
already fixed in `git log 7a517820..HEAD`.

Sweep these trees: artifacts/api-server/src (services, routes, providers), artifacts/pyrus/src,
artifacts/backtest-worker/src, lib/. Look for genuine P2 (should-fix-soon) and P3 (nice-to-fix) issues
across dimensions: perf / duplicated work; silent failures (swallowed errors, dropped rejections);
unbounded growth (module-level maps/caches without eviction); minor correctness (null/off-by-one/
inverted conditions); time & session semantics (UTC vs NY session, holidays/half-days); money math
(commissions/rounding/sign/P&L window); retry/timeout/feedback (no timeout, no backoff/jitter/cap,
overlapping polls); frontend render/effect perf; dead code / zombie config; test-integrity (tests that
assert call-shape / source-text instead of behavior); concurrency/races.

For EACH finding: `file:line` — severity (P2|P3) — category — one-line summary — the real failure/waste
mechanism (why it is a genuine defect, not a guess) — confidence 0..1. Group by dimension. Favor
breadth; be honest about confidence; skip style nits.

Deliverable: write the full report to `.codex-watch/wo-p2p3-recovery-report.md`. No code changes.
