# WO-FB-T14 — slice 1b: O(tail) latest-completed-bucket for state reads (owner-greenlit)

> **HEADLESS WORKER PREAMBLE (overrides AGENTS.md session rituals for this run):** You are a
> headless work-order worker, not an interactive session. (1) Do NOT create or update any
> SESSION_HANDOFF_* file — the orchestrator owns handoffs. (2) Do NOT read ~/.claude/, ~/.agents/,
> .claude/skills/, .agents/skills/, or agents/ — skill definitions are for other tooling and waste
> your run. (3) NEVER restart, rebuild, or reload the app; never run REPLIT_MODE=workflow, never
> signal the supervisor (no SIGUSR2) — the orchestrator owns runtime. (4) AGENTS.md coding
> discipline (lazy-minimal, stdlib-first, smallest diff) still applies. Work ONLY the order below.


Codex worker (xhigh), /home/runner/workspace. Design: `docs/plans/elu-p3-proposal.md` §4 Slice 1 → **1b**
and §5 step 2. Greenlight: `docs/plans/2026-07-08-review-session-findings-plan.md` T14 ("GREENLIT by
owner; dispatch when signal-monitor.ts is free"). READ PROPOSAL §4-1b FIRST — it is the authoritative
design; do not invent another.

## The change (transcribed from proposal §4-1b; verify anchors yourself)
`signalMonitorStreamLaneLatestCompletedBarAt` needs only the **latest completed bucket's close time** —
today it bucket-groups 120-300 bars into Maps/Sets/sorted arrays (limit 64) PER STATE ROW to derive it.
Replace with either:
  (a) direct O(tail) derivation from the ring tail (walk back from the newest bar only as far as needed), or
  (b) an incrementally-maintained per-(symbol,timeframe) "latest completed bucket end" updated on aggregate
      ingest.
Pick the smaller-diff option that provably preserves semantics; justify the choice in the report.

## Semantics that MUST be preserved (proposal's own risk note: medium, trading-adjacent)
- `isSignalMonitorBarComplete` semantics exactly — provisional/delayed bars must not count as completed.
- Currentness gates staleness relabels — a wrong value flips cells stale/fresh incorrectly. PARITY TEST
  FIRST: before changing the implementation, write a test asserting new derivation === old derivation over
  fixtures covering: mid-bucket live edge, delayed/provisional tail bars, empty ring, exact bucket boundary,
  and a gapped tail. Then swap the implementation and keep the old path callable from the test (or inline
  its logic in the fixture) so the parity assertion stays meaningful.

## MUST-NOT
- Byte-identical signal + staleness outputs. Trading safety untouched.
- Touch ONLY signal-monitor.ts (+ tests). Dirty tree: no reverts/reformats outside your hunks; NEVER
  `git checkout`/`restore`. No commits, no `git add`.
- Minimal diff; no config flags.
- `git diff --stat -- artifacts/api-server/src/services/signal-monitor.ts` at start AND end → report.

## Verification (paste tails)
1. `pnpm --filter @workspace/api-server run typecheck` → exit 0
2. `pnpm --filter @workspace/api-server exec tsx --test src/services/signal-monitor*.test.ts src/services/signal-options*.test.ts`
   → baseline 442/0; must stay green (+ your parity tests).
3. Note for the orchestrator's re-profile (§5 step 2 target): incl share of
   `signalMonitorStreamLaneLatestCompletedBarAt` → <3% via `scripts/diag/cpu-profile-running-api.mjs`.

## Report → `.codex-watch/wo-fb-t14-bucket-report.md`
option chosen (a/b) + why, semantics-preservation argument, parity-test coverage list, what changed
(file:line), test/typecheck tails, risks, start+end diff --stat.
