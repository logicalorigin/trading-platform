# WO-FIX-12 — Durable intent record BEFORE broker order placement (overnight-spot)

Codex worker, /home/runner/workspace. overnight-spot-execution.ts clean (verify). Edit directly;
`git add -- <paths>`; NO commit. No ~/.claude/, .claude/skills/, agents/ access. LIVE MONEY PATH —
maximum care; behavior change is exactly and only the write ordering + recovery.

Finding (review P1, ~:517): a live order is placed at the broker BEFORE any durable ledger record
exists; a crash between placement and the success-path write leaves a real broker order with no
local record.

GATE: first verify the finding yourself — read the full placement flow (who calls it, what's
written on success/failure, any existing reconciliation that would catch an orphaned order later —
if a reconcile sweep already repairs this, STOP and report that instead).
Fix (standard intent-record pattern, laziest fit to existing schema): write a durable
pending-intent row (existing table if one fits — check for an execution/order-intent table before
adding schema; if a migration would be required, STOP and report) BEFORE the broker call; mark it
filled/failed after; on startup or the existing sweep, flag intents with no terminal state for
reconciliation. Preserve idempotency (no double-submit on retry).
Tests: intent-before-placement ordering + orphan-flagging, in the existing overnight-spot test
style. Run touched suites; paste output.
Deliverable: .codex-watch/wo-fix-12-report.md (include your verification of the finding).
