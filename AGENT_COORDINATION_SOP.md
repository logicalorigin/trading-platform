# Agent Coordination SOP

Last updated: 2026-06-18T00:24:00Z

## Purpose

Keep multi-agent work moving without losing quality, duplicating edits, or committing incomplete work.

## Source Of Truth

- `AGENT_TASK_BOARD.md` is the task board.
- `AGENT_CHAT.md` is the shared transcript generated from `AGENT_CHAT_MESSAGES.jsonl`.
- The leader posts task changes to the chat endpoint so the transcript refreshes.
- No commits or staging until every in-scope task is 100% or explicitly removed from scope by the user.
- These chat and board files are local runtime state by default; commit reusable tooling and SOP changes, not generated coordination logs.

## Roles

- Leader: assigns tasks, resolves scope decisions, reviews work, runs validation, updates the board, and authorizes commit prep.
- Worker: owns one task at a time, posts audit/proposal before edits when semantics are ambiguous, implements only its assigned scope, and does not stage or commit.
- Reviewer: audits source, tests, runtime evidence, and commit grouping. Review output is advisory until accepted by the leader.

## Task Lifecycle

1. Assignment
   - Leader assigns one task to one worker.
   - Assignment includes scope, forbidden files/areas, expected output, and whether edits are allowed.
   - Worker must acknowledge in `AGENT_CHAT.md`.

2. Audit
   - For ambiguous UI/product/data/runtime behavior, worker posts observed facts, root cause, and minimal proposed fix before editing.
   - Leader resolves tradeoffs and explicitly permits implementation.

3. Implementation
   - Worker edits only assigned files/area.
   - Worker does not revert unrelated dirty work.
   - Worker does not stage or commit.

4. Worker Handoff
   - Worker posts changed files, tests run, known risks, and screenshots/runtime evidence if UI-facing.
   - Worker reports blockers early instead of waiting.

5. Leader Review
   - Leader reviews correctness, simplicity, architecture, performance, and verification.
   - Required issues are sent back to the worker for correction.
   - Accepted work moves the task progress forward on `AGENT_TASK_BOARD.md`.

6. Validation
   - Focused tests first.
   - Typecheck/build when scope justifies it.
   - Browser/runtime QA for visible UI or data-flow behavior.
   - Facts, inferences, and unknowns stay separated in updates.

7. Commit Readiness
   - Only after all in-scope tasks are 100%.
   - Ramanujan/commit-prep proposes hunk-level grouping.
   - Leader verifies grouping excludes `.replit`, chat logs, unrelated handoffs, and unrelated generated/docs work unless explicitly approved.

## Progress Rules

- 0%: assigned or queued, no audit accepted.
- 20%: audit posted and direction chosen.
- 50%: implementation underway or patch reported.
- 80%: implementation complete with focused tests.
- 95%: leader source review plus tests pass; runtime/manual check remains or commit grouping pending.
- 100%: leader accepted source, tests, and required runtime/manual evidence.

## Escalation Rules

- If a worker is silent after a reasonable interval, leader pings once in chat.
- If still silent, leader reassigns the task and marks the worker inactive for that task.
- If workers disagree, leader asks for concrete evidence and reconciles based on source/runtime facts.
- If a task scope conflicts with user intent or existing repo rules, pause edits and ask the user.

## Current Commit Freeze

Commits and staging are blocked until the board is fully green. Commit-prep may produce grouping proposals only.
