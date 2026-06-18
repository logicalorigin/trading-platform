---
name: agent-supervisor
description: Coordinate multiple Codex, Claude, or sub-agent workers on a shared repo; recover prior supervisor state; finish an agent task board; audit completed uncommitted work; retrieve task-specific skills; delegate blockers; and prepare clean commits. Use when the user asks Codex to act as leader, supervisor, foreman, coordinator, reviewer, commit captain, skill dispatcher, or to keep worker agents moving through AGENT_CHAT/task-board workflows.
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
   - Establish a worker result ledger before assigning work. Track `worker`, `assignment seq/id`, `scope`, `expected report`, `state` (`assigned`, `acknowledged`, `working`, `reported`, `accepted`, `superseded`, `parked`), `last seen chat seq`, and `next action`.
   - Assign at most one active task per worker.
   - Give each worker a disjoint scope, mode (`read-only` or editable files), expected evidence, and "no staging/commit" instruction.
   - Define done before delegation: measurable outcome, acceptance criteria, validation command or runtime check, and board item owner.

3. Keep workers moving.
   - Acknowledge every check-in and update the worker result ledger immediately.
   - Poll or tail chat from the last seen seq before status reports, before accepting work, before reassigning a task, and before sending a final response. Do not rely on memory of recent chat while other agents can report asynchronously.
   - Treat late ACKs and superseded-work notices as actionable reports: mark the assignment `superseded` or `parked`, confirm the worker did not edit/stage/commit, and clear or reassign ownership explicitly.
   - If a worker stalls, request ETA once, then reassign only the smallest unowned remainder.
   - Prevent overlapping edits by naming exact files or modules.
   - When workers report results, verify source, tests, and runtime evidence before accepting.

4. Maintain the board.
   - Update `AGENT_TASK_BOARD.md` only from evidence.
   - Mark tasks complete only when source review and relevant validation pass.
   - Keep facts, inferences, and unknowns separate in board updates and reports.

5. Run an integration pass.
   - Sweep `AGENT_CHAT_MESSAGES.jsonl` or `/messages?since=<last-seen>` for worker replies and audit reports before summarizing done state.
   - Compare worker reports against git diff, tests, browser evidence, and task-board acceptance criteria.
   - Reconcile overlapping findings before assigning more work.
   - Send narrow follow-ups when reports omit changed paths, validation output, residual risks, or blocker ownership.
   - Do not close a board item with outstanding `assigned`, `acknowledged`, or `working` ledger entries unless they are explicitly superseded, parked, or reassigned in chat.

## Worker Result Intake

Maintain a small, durable-enough ledger in the active handoff, task board, or supervisor scratch when coordinating more than one worker or when any worker may report asynchronously.

Required ledger rows:

- `assignment`: chat seq/id plus the worker name.
- `scope`: exact files, modules, or read-only question.
- `expected`: what report or artifact is due.
- `state`: one of `assigned`, `acknowledged`, `working`, `reported`, `needs-follow-up`, `accepted`, `superseded`, or `parked`.
- `last seen`: latest chat seq, timestamp, or subagent id observed for that worker.
- `leader action`: verify, ask follow-up, reassign, park, accept, or close.

Use this intake loop:

1. After every assignment, add or update a ledger row.
2. When a worker ACKs, mark `acknowledged`; when they report results, mark `reported`.
3. Before claiming a task is complete, sweep chat/subagent results since the ledger's latest `last seen` value.
4. Verify every `reported` item against source/tests before `accepted`.
5. If a report arrives after the leader has already moved on, process it anyway: capture facts, decide whether it changes the current plan, then mark it `accepted`, `superseded`, or `parked`.
6. Mention unresolved ledger rows in the final/status message with owner and next action.

## Worker Brief Contract

Before assigning work, build a short brief with:

- `Observations`: facts already in context from the user, repo artifacts, logs, or prior agents. Mark hypotheses as hypotheses.
- `Definition of success`: WHAT must be true, WHY it matters, and how completion will be verified.
- `Context`: WHERE to look, scope boundaries, relevant board item, file ownership, and constraints from the user or repo.
- `Available resources`: authenticated CLIs, local scripts, source docs, MCP/tools, and relevant skills. Describe capabilities; avoid dictating HOW unless a repo rule or user instruction requires it.
- `Reporting format`: files changed, evidence collected, validation run, blockers, and residual risks.

Before posting the assignment, run a pre-delegation check:

- Claims are observations from the user, repo artifacts, logs, or prior workers; hypotheses are labeled.
- Success criteria are observable and include a validation method.
- The brief defines WHERE, WHAT, and WHY while leaving HOW to the worker unless the user or repo requires a method.
- Context is pass-through only; do not pre-gather data the worker is expected to discover.

Use Codex subagents for independent audits or forked implementation. Use Claude or chat workers when coordination must happen through `AGENT_CHAT`. In all cases, preserve worker autonomy on implementation while keeping write ownership, validation, and safety constraints explicit.

## Skill Discovery And Retrieval

When the user's task would benefit from specialized procedural knowledge:

- Check the available skill list and local `.agents/skills` first.
- If a relevant skill is absent or stale, inspect user-provided sources, trusted catalogs, or the repo named by the user before installing or copying anything.
- Keep `https://github.com/CommandCodeAI/agent-skills.git` as the general skill repo for requested task skills across coding-agent workflows. Retrieve it with `gh repo clone CommandCodeAI/agent-skills` from a scratch/tools location unless the user asks to vendor it into the current repo.
- Keep `npx skillfish add jamie-bitflight/claude_skills agent-orchestration` as the back-pocket retrieval command for the Jamie-BitFlight agent-orchestration skill. Treat it as an install recipe, not an automatic action, unless the user asks to install or the current environment is an approved skill workspace.
- For Codex, prefer installed local skills or the Codex skill-installer path. For Claude workers, provide the skillfish or plugin install command in their assignment when they need that skill.
- Before adopting an external skill, read its `SKILL.md`, check source/repo trust and license when practical, note whether it was used as a reference or installed, and validate any Codex skill folder with `quick_validate.py`.
- When a task maps to a specialized skill, include a worker skill handoff: skill name, status (`local`, `retrieved`, `reference-only`, or `unavailable`), source path/URL/command, and the instruction to read `SKILL.md` before using it.

## Dispatch Decisions

When parallel worker use is authorized, split independent work by disjoint files, modules, or validation targets. Dispatch in parallel only when workers do not share write ownership or output state. Serialize tasks that touch the same files, depend on another worker's result, or require one integration decision.

When a user reports one concrete bug, smell, or failure location, treat it as a possible pattern. Ask the worker to audit the nearest bounded scope for related instances unless the user explicitly limits the fix to one location.

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

`@agent-name ASSIGNMENT: one task only. Observations: <facts, not guesses>. Success: <measurable done state and validation>. Context: <WHERE/WHAT/WHY, board item, file ownership>. Available resources: <skills/tools/docs/CLIs>. Constraints: <no staging/commit; do not touch conflict areas>. Report facts, files changed, validation, blockers, and residual risks.`

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
