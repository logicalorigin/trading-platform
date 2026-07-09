# WO-FB-S3D — slice 1a: activate the existing minute-bars memo on state-row shaping + lazy streamLatestBarAt

> **HEADLESS WORKER PREAMBLE (overrides AGENTS.md session rituals for this run):** You are a
> headless work-order worker, not an interactive session. (1) Do NOT create or update any
> SESSION_HANDOFF_* file — the orchestrator owns handoffs. (2) Do NOT read ~/.claude/, ~/.agents/,
> .claude/skills/, .agents/skills/, or agents/ — skill definitions are for other tooling and waste
> your run. (3) NEVER restart, rebuild, or reload the app; never run REPLIT_MODE=workflow, never
> signal the supervisor (no SIGUSR2) — the orchestrator owns runtime. (4) AGENTS.md coding
> discipline (lazy-minimal, stdlib-first, smallest diff) still applies. Work ONLY the order below.


Codex worker (xhigh), /home/runner/workspace. Design (owner-greenlit path): `docs/plans/elu-p3-proposal.md`
§4 Slice 1 → **1a** and §5 step 1. READ THAT SECTION FIRST — it is the authoritative design; do not invent
another. Goal: collapse the per-state-row minute-bar load+copy to once per symbol, and stop computing
`streamLatestBarAt` when unused.

## The change (transcribed from proposal §4-1a; verify anchors yourself)
1. Wrap the row-mapping in `readSignalMonitorStateFresh` (and its passive variant) in
   `withSignalMonitorStreamSourceMinuteBarsMemo` — the memo mechanism already exists at
   `signal-monitor.ts:4852` and is currently only used at `:10652`. Timeframes of the same symbol share
   the load.
2. Compute `streamLatestBarAt` lazily in `stateToResponseForSnapshot` (`:1331` computes it even when
   `markNonCurrentStale` is false and the value is unused).
Proposal's own risk note: low — same `evaluatedAt` across the read; memo is call-scoped. The memo does NOT
cover `aggregateStockMinuteBarsForTimeframe` itself (that is a later, separate lever — do not attempt here).

## MUST-NOT
- Response payloads byte-identical for all consumers (state route, snapshots). Trading behavior untouched.
- Touch ONLY signal-monitor.ts (+ test). Dirty tree: no reverts/reformats outside your hunks; NEVER
  `git checkout`/`restore`. No commits, no `git add`.
- Minimal diff; the memo mechanism exists — activate it, don't rebuild it.
- `git diff --stat -- artifacts/api-server/src/services/signal-monitor.ts` at start AND end → report.

## Verification (paste tails)
1. `pnpm --filter @workspace/api-server run typecheck` → exit 0
2. `pnpm --filter @workspace/api-server exec tsx --test src/services/signal-monitor*.test.ts src/services/signal-options*.test.ts`
   → baseline 442/0; must stay 442+/0.
3. Memo effectiveness: `getSignalMonitorStreamSourceMinuteBarsMemoStats` (`:4862`) — show hits accrue on a
   state read covering multiple timeframes of one symbol (targeted test or instrumented check).

## Report → `.codex-watch/wo-fb-s3d-row-memo-report.md`
what changed (file:line), memo stats evidence, test/typecheck tails, risks, start+end diff --stat.

---
## CLOSED WITHOUT DISPATCH (2026-07-08 ~20:05 MDT, orchestrator)
Slice 1a already landed on main as `c5053999` "perf(signal-monitor): memoize per-row ring loads on
stored-state read paths (P3v2 1a)" (earlier-evening session, pre-dating this WO's authoring; verified:
readSignalMonitorStateFresh / withSignalMonitorStreamSourceMinuteBarsMemo / streamLatestBarAt all
present in that commit). No work remains under this order.
