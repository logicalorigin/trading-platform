# WO-02: Lane-ownership matrix — running tally + pressure stack (READ-ONLY)

You are `codex-worker` for `claude-lead` (session f68a9158). Repo `/home/runner/workspace`. INVESTIGATION ONLY — no code changes, no commits, no restarts. Do NOT read `~/.claude/`, `.claude/skills/`, `agents/`.

## Context

Two live agent lanes overlap the remaining signal-options/pressure work; before dispatching fixes we need an evidence-based ownership matrix.

- PICKUP doc: `docs/plans/2026-07-06-running-tally-PICKUP.md` (+ `2026-07-06-approach-a-running-tally-tasks.md`, `2026-07-06-signal-options-push-native-redesign-scope.md`). Remaining steps it lists: firehose write-cut → authority flip → optional allowance cache → deploy shadow bake → flag on.
- Landed since: `7d5445f2` (calibration, marks-reader, flag-gated tally strands), `929fcb94` (tally drift self-repair, final-quote delta gate, bake diagnostics, seen-signal store), `cd1e3eb2` (daily-pnl dedup, flip-close exit claim, synthetic entry-greek baseline).
- Review doc: `docs/reviews/2026-07-07-signal-options-system-review.md` — plan candidates 5–8; candidate 6 = "tally bake gate-flip checklist", held by live session `4f0c846b` (its codex-watch dispatches cover finding #7 peak-floor TTL and one more task).
- Throttle audit: `.codex-watch/throttle-audit-2026-07-07.md` (owned by live session `dbf9de08`) — RETUNE items gated on "CPU/DB root fixes".
- `SIGNAL_OPTIONS_TALLY=shadow` reportedly set in `.pyrus-runtime/dev-env.local`.

## Task

1. For EACH remaining PICKUP step (write-cut, authority flip, allowance cache, bake, flip-on): determine landed / in-progress / not-started, citing commits (`git log -p --oneline -15 -- artifacts/api-server/src/services/signal-options-automation.ts`, grep for `SIGNAL_OPTIONS_TALLY`, firehose/authority code paths) and current flag state in `.pyrus-runtime/dev-env.local` (do not print secrets — flag names/values for SIGNAL_OPTIONS_TALLY only).
2. Read the newest `.codex-watch/*2026-07-07*.md` reports and repo-root `SESSION_HANDOFF_2026-07-07_4f0c846b*.md` / `..._dbf9de08*.md` to list what those lanes have claimed or dispatched.
3. Produce the matrix: rows = remaining work items (PICKUP steps, review candidates 5–8, throttle RETUNE batch, bar-cache persist scope from WO-03), columns = owner (4f0c846b / dbf9de08 / UNOWNED), evidence, and safe-to-dispatch verdict for WO-03 and WO-05.
4. Specifically for WO-03: report whether `artifacts/api-server/src/services/signal-monitor.ts` still carries another lane's uncommitted events-cache residue (`git diff` it) and whether lines around `persistSignalMonitorMatrixStatesBestEffort` (~8954, call ~9230) are inside that residue.

## Deliverable

`.codex-watch/wo-02-ownership-matrix-2026-07-07.md` with the matrix, per-cell evidence (commit hash / file:line / report filename), and a one-paragraph dispatch recommendation. Facts only; label anything unverified as unknown.
