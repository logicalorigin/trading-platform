# WO-FIX-13 — STA pipeline trio: bootstrap, overlay, P&L window (3 fixes, separate hunk sets)

Codex worker, /home/runner/workspace. Verify each target clean (`git status --porcelain --`); edit
directly; `git add` per fix NOT needed — leave unstaged. NO commit. No ~/.claude/, .claude/skills/,
agents/ access. Report: .codex-watch/wo-fix-13-report.md (per-fix what/why, diff, test output).

FIX A — matrix SSE bootstrap serves the cached snapshot (signal-monitor.ts): under pressure the
stream bootstrap emitted nothing for 22s+ because it awaited the full stored-state read; non-1m STA
dots hydrate only from it. Serve the existing bootstrap snapshot cache (30s TTL,
readSignalMonitorStreamBootstrapSnapshot ~:10337) even when stale-but-present (emit cached
immediately, refresh in background); first-ever bootstrap may still await. Test: bootstrap emits
from cache without awaiting a fresh read.

FIX B — sparkline/audit overlay drops contradicting event markers (artifacts/pyrus/src/screens/
algo/OperationsSignalRow.jsx ~:2542-2558 buildSignalSparklinePointColors area): drop execution-event
markers older than or opposite-direction to the row's state signal (state is authoritative). Test in
the existing .test.mjs style.

FIX C — dashboard realized P&L uses a day-bounded read, not last-100-events
(signal-options-automation.ts ~:12955): verify the finding (window vs day boundary), then make the
read cover the full trading day (bounded query by occurredAt >= session start — reuse existing
session helpers; keep a sane row cap with overflow flag). Test: >100-event day computes correct P&L.

Run each fix's touched suites; paste outputs.
