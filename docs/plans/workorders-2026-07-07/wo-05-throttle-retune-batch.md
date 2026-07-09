# WO-05: Throttle RETUNE batch — GATED (root fixes + user OK)

You are `codex-worker` for `claude-lead` (session f68a9158). Repo `/home/runner/workspace`, branch `main`. Do NOT read `~/.claude/`, `.claude/skills/`, `agents/`.

## Gate (check first, abort politely if it fails)

Proceed ONLY if ALL hold, else write your report stating what's missing and STOP:
1. `.codex-watch/wo-03-barcache-persist-report-2026-07-07.md` exists and its change has landed (`git log --oneline -5 -- artifacts/api-server/src/services/signal-monitor.ts` shows it committed).
2. The tally authority flip has landed per the ownership matrix (`.codex-watch/wo-02-ownership-matrix-2026-07-07.md` or a newer report) — the audit's RETUNE items are explicitly "change only after CPU/DB root fixes land".
3. A user go-ahead is recorded in this file's dispatch note or the completion plan.

## Context

`.codex-watch/throttle-audit-2026-07-07.md` (Jul 7, 13:02) inventoried every man-made throttle/cap/shed. Verdict summary: nothing is REMOVE-now; the RETUNE-after-root-fixes set is the actionable batch:

- Scanner batch size 4 → 16 (`platform.ts:~11376`; 755-symbol horizon currently ~47min, target coverage 5min)
- Scanner interval 15000ms (`platform.ts:~11287`) — retune per the audit's cycle math
- Scanner ELU-consumption gating (`platform.ts:1331-1362`) — split watch/high behavior per audit
- `/sparklines/seed` forced-deferred class (`route-admission.ts:278-283`) — relax per audit once pool pressure subsides

## Task

1. Re-read the audit's per-item RETUNE rationale and proposed values; verify each cited file:line still matches HEAD (the file may have moved — re-locate by symbol, not line).
2. Apply the RETUNE set as ONE coherent change with constants documented via the audit's incident citations.
3. Update/extend the guard tests the audit cites (`options-flow-scanner-pressure.test.ts`, `route-admission.test.ts`) to pin the new values.
4. Measure: before/after `estimatedCycleMs` and coverageHealth from the live diagnostics snapshot (read-only HTTP; no restarts — claude-lead performs the SIGUSR2 reload after landing).

## SCOPE

`artifacts/api-server/src/services/platform.ts` (scanner constants/gating only), `artifacts/api-server/src/services/route-admission.ts` + its test, `options-flow-scanner-pressure.test.ts`. Nothing else.

## Acceptance / verification

- Both test files green; `pnpm --filter @workspace/api-server run typecheck` clean in SCOPE.
- Report shows the audit-item → change mapping and predicted cycle-time math.
- Scope-check passes. Do NOT commit; leave for claude-lead review (pressure changes get human eyes).

## Deliverable

`.codex-watch/wo-05-retune-report-2026-07-07.md`.
