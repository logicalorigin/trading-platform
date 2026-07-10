# WO-EQH-FIX — bounded bucket-first equity-history reads + stop the read→write feedback (task #10)

Dispatched by Claude session 26888663 (2026-07-09 ~14:35 MDT), Riley-approved. Worker: Opus agent.
Report to `.codex-watch/wo-eqh-fix-report.md`. Edits UNCOMMITTED; dispatcher lands.

This is the single biggest event-loop demand reducer left: equity-history rebuilds currently
materialize the ENTIRE shadow_balance_snapshots table (285,264 full rows, no LIMIT/projection,
~30MB/605ms DB-side each) at ~2.3 rebuilds/min, and reads kick mark-refresh writes growing that
table 14,141 rows/day (~5× lifetime average).

## Required reading (in order)
1. `.codex-watch/wo-elu-shadow-equity-report.md` — BOTH parts (Part 1 codex source analysis, Part 2
   Claude live-evidence pass) + codex's §7 verification gates.
2. `.codex-watch/wo-positions-stream-parity-report.md` — the positions fixer JUST landed uncommitted
   edits in shadow-account.ts (mark refresh, fast-path totals, mirror repair, closed-position
   invalidation, source scoping). Some EQH sub-items may already be partially fixed — build on those
   edits, NEVER revert them, and do not re-implement what they already cover.
3. `docs/plans/workorders-2026-07-09/wo-eqh-1-bucket-first-reads.md` — the sibling session's earlier
   gated WO for the bucket-first read; reconcile with its design + row-count anchors rather than
   inventing a divergent one.

## Deliverables (demand-reducing, no band-aids, /ponytail full)
1. **Bucket-first, projected snapshot reads**: replace the full-table materialization in
   `getShadowAccountEquityHistory` (shadow-account.ts ~:8485, select ~:8563-8567) with SQL-side
   `date_bin`/`DISTINCT ON` bucketing at the 5-minute resolution the pipeline already discards to,
   selecting only needed columns. Target: ≤~800 rows for 1D, ≤~400 for 1Y (WO-EQH-1 anchors);
   semantics-safe per the adversarial mixed-source fixture requirement (report §7 gate 1).
2. **Stop the read→write feedback**: remove read/GET-triggered mark-refresh kicks from
   history/summary/positions read paths (report Part 2 items: :8182, :9429, :9498 — CHECK whether
   the positions fixer already fixed some) so unchanged quotes produce zero shadow_position_marks
   and zero balance-snapshot inserts (§7 gates 2-3). Mark production moves to its own schedule if
   removal would orphan it — smallest correct mechanism.
3. **Write-side snapshot coalescing**: stop inserting a balance snapshot per source per tick when
   content is unchanged (the 14k/day growth); coalesce to changed-content-only or per-bucket.
4. **Cache-key defect**: fix the account-prefixed-write vs unprefixed-read mismatch
   (shadow-account.ts ~:9993-10006; summary cache measured 2/19 hits).
5. **Summary→1D coupling + default-range base**: stop the account-page default 1M range from
   rebuilding the 285k-row 1Y base, and the summary path from forcing 1D rebuilds (Part 2 item 2),
   with one shared versioned base build per ledger version (§7 gate 4).

## Verification (required)
- Focused tests for each deliverable (adversarial mixed-source fixtures per §7 gate 1; zero-write
  assertions for gates 2-3). All existing shadow-account/equity-history tests green.
- `pnpm --filter @workspace/api-server run typecheck` clean (if the pnpm wrapper hits another
  session's validation lock, use direct tsc like the auth-lane agent did and say so).
- Do NOT restart the app; do NOT run DB migrations. Dispatcher owns reload + the §7 gate-6 profile
  acceptance (row volume by family, ELU, GC, pool waiters, positions/equity-history p95 in the same
  window).

## Report
Per deliverable: what the positions fixer already covered vs what you changed, files/hunks, test
results, row-count before/after evidence for gate 1, exact modified-file list for staging.
