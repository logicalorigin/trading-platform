---
name: agent-supervisor
description: Coordinate multiple coding agents on a shared repo, recover prior supervisor state, finish an agent task board, audit completed uncommitted work, delegate blockers, and prepare clean commits. Use when the user asks Codex to act as leader, supervisor, foreman, coordinator, reviewer, commit captain, or to keep worker agents moving through AGENT_CHAT/task-board workflows.
---

# Agent Supervisor

## Operating Loop

1. Reconstruct state from durable artifacts before assigning work.
   - Read repo instructions such as `AGENTS.md` or user-provided rules.
   - Read the active handoff when present, then inspect `AGENT_TASK_BOARD.md`, `AGENT_CHAT.md`, and the tail of `AGENT_CHAT_MESSAGES.jsonl`.
   - When artifacts conflict, prefer the latest user/repo instructions, then the newest chat and board evidence, then handoffs as historical context.
   - Confirm the chat endpoint from `.agents/agent-chat/server.json`, source-check the route in `.agents/agent-chat-server.mjs`, and call `GET /health` before posting.
   - If the endpoint is down, restart only when repo rules allow local coordination tooling to be restarted; otherwise report the blocker.
   - Inspect `git status --short --branch`, `git diff --name-status`, and `git ls-files --others --exclude-standard`.

2. Post a leader takeover message.
   - State observed board status, commit/staging freeze, and active constraints.
   - If any durable artifact says staging or commits require user approval, readiness means report-ready, not commit-ready, until that gate is explicitly lifted.
   - Assign at most one active task per worker.
   - Give each worker a disjoint scope, mode (`read-only` or editable files), expected evidence, and "no staging/commit" instruction.

3. Keep workers moving.
   - Acknowledge check-ins.
   - If a worker stalls, request ETA once, then reassign only the smallest unowned remainder.
   - Prevent overlapping edits by naming exact files or modules.
   - When workers report results, verify source, tests, and runtime evidence before accepting.

4. Maintain the board.
   - Update `AGENT_TASK_BOARD.md` only from evidence.
   - Mark tasks complete only when source review and relevant validation pass.
   - Keep facts, inferences, and unknowns separate in board updates and reports.

## Acceptance Gate

Before calling work complete:

- Source-review the changed files and untracked companion files.
- Confirm required tests were added or updated with the behavior.
- Run focused validation directly with `pnpm` or the repo's documented commands.
- For UI/browser behavior, use the repo's browser QA rules and wait for explicit readiness selectors.
- Treat known unrelated runtime failures as non-blocking only when source or environment evidence explains them.
- If any blocker remains, delegate a narrow fix instead of committing.

## Dirty Tree Classification

Classify every changed path before staging:

- `accepted scope`: files and tests required for completed board items.
- `unreviewed WIP`: unrelated or insufficiently validated changes; do not stage.
- `coordination noise`: chat logs, task boards, handoffs, supervisor scratch unless the user explicitly wants them committed.
- `guarded startup/control-plane`: `.replit`, artifact startup config, Replit control-plane files, or dev-run scripts. Exclude unless the user approves a startup maintenance window and the repo's startup audit passes.

Use hunk-level staging when accepted and unreviewed work share a file. After staging, review `git diff --cached --name-status` and `git diff --cached` before committing.

Before staging, produce a board-item-to-path manifest. For each accepted item list:

- Source files.
- Untracked companion files.
- Generated outputs.
- Focused validation.
- Excluded paths and why.

## Delegation Pattern

Use worker agents for bounded fixes and subagents for independent audits only when the user has authorized delegation or parallel agent work.

Good assignment shape:

```text
@agent-name ASSIGNMENT: one task only. Scope: <files/modules>. Start with source audit or implement <small fix>. Do not touch <known conflict areas>. Run <focused tests>. No staging/commit. Report facts, files changed, validation, and residual risks.
```

For code-changing subagents, assign disjoint write ownership and remind them they are not alone in the codebase; they must not revert other edits.

## Commit Readiness

Commit only when:

- The board has no unfinished in-scope items.
- All accepted paths are staged and all excluded paths are intentional.
- Typecheck and focused tests pass, or failures are factual, unrelated, and documented.
- Guarded startup files are not staged unless explicitly approved and audited.
- Any previously observed commit freeze or approval gate has been explicitly lifted.
- The commit message describes the accepted behavior, not the coordination process.

If the tree is not ready, report the exact blocker and who owns the fix.
