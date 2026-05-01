---
name: session-handoff
description: Save or resume repo work using dated handoff markdown files that capture the Codex session ID, repo snapshot, recent user messages, and next steps. Use when the user asks to save a handoff, recover where prior work stopped, continue from an earlier session, or create a resumable project snapshot.
---

# Session Handoff

Use this skill for three cases:

- Resume prior work from existing handoff markdown files and current repo state.
- Save the current session into a new handoff markdown file for later pickup.
- Autosave in-flight session state while work is still progressing, so crashes leave a usable handoff.

## Non-Negotiable Autosave Rule

For any substantial implementation, investigation, test run, multi-terminal task, or user-described workstream, create or refresh the markdown handoff at the start of the work, then keep it current as the work changes. Treat the markdown as the durable session state, not as a final report.

- Do not wait for the end of the session to create the first handoff.
- Do not rely on Codex/Replit terminal state as the only recovery source. Terminals, shells, browser tabs, and Replit can reset before a rollout or thread row is durable.
- If a persisted Codex session ID exists, use it immediately and write `SESSION_HANDOFF_YYYY-MM-DD_<full-session-id>.md`.
- If no persisted session ID exists yet, create a temporary repo-root live recovery note named `SESSION_HANDOFF_LIVE_YYYY-MM-DD_<workstream-slug>.md`.
- The live note must include `Session ID: pending`, current CWD, observed PID/TTY/lock path if available, user request, active files, current step, next step, and validation status.
- As soon as a real session ID appears, move the useful live-note content into the canonical `SESSION_HANDOFF_YYYY-MM-DD_<full-session-id>.md` and add the master-index row.
- When multiple agents or terminals are active, each distinct workstream must have its own progressively updated markdown note. The master index is only a locator; the per-session file is the source of truth.
- Update the handoff before risky or long-running actions, after meaningful edits, after validation, after a blocker is discovered, and before switching to another workstream.

## Conventions

- Put the skill in `.agents/skills/session-handoff/`.
- Put handoff markdown files in the repo root.
- Name new handoff files `SESSION_HANDOFF_YYYY-MM-DD_<full-session-id>.md`.
- Legacy short-prefix handoff files may still exist; do not rename them unless explicitly asked.
- Include the full session ID inside every markdown handoff.
- Keep one handoff file per unique Codex session ID. If a session continues, update that same file; do not create another handoff for the same session.
- Maintain a repo-root master index named `SESSION_HANDOFF_MASTER.md`.
- Add or update one master-index row for each unique session ID. The master is an index, not the full handoff narrative.
- Use Mountain Time for handoff dates and master timestamps. Use `America/Denver` semantics and label them `MT`; include UTC only as secondary metadata when useful.
- Keep handoffs concise, file-specific, and validation-aware.
- In multi-terminal work, default to saving every persisted Codex thread whose CWD belongs to the current repo.
- For long or risky sessions, start progressive autosave immediately after initial repo/workstream context is known.
- A live Codex terminal without a persisted thread row or rollout path is not fully resumable by session ID. Record its PID/TTY/lock path in a temporary live recovery note instead of creating a fake canonical session handoff.

## Resume Workflow

1. Open `SESSION_HANDOFF_MASTER.md` first if it exists.
2. Identify the relevant session ID and handoff file from the master index.
3. Also list `SESSION_HANDOFF_LIVE_*.md` newest first. A live note may be the only durable record if a terminal reset happened before Codex persisted a session ID.
4. Read the relevant session/live handoff and any older handoff it explicitly references.
5. Scan `.codex/state_5.sqlite` for newer persisted Codex threads whose CWD belongs to this repo and report any session IDs missing from the master index.
6. If the master is missing or stale, list `SESSION_HANDOFF_*.md` in the repo root, newest first, and rebuild enough context from the per-session files plus the Codex state scan.
7. If the user references a workstream rather than a session ID, search recent handoffs, live notes, rollout JSONL, workflow logs, and recently modified files for the user’s terms and changed-file evidence.
8. Compare the handoff against current repo state with `git status --short --branch` and `git diff --stat`.
9. Inspect the referenced files before claiming context is restored.
10. Report:
   - the active workstream
   - any newer unsaved Codex sessions discovered in state
   - any live notes with pending session IDs
   - validated status
   - blockers, secrets, or missing runtime dependencies
   - the best next step

## Progressive Autosave Workflow

Use this workflow when a session may involve substantial implementation, multi-terminal work, external runtime setup, or anything the user explicitly wants recoverable if Codex drops.

1. Determine whether the current thread has a persisted session ID. If it does, generate/update the canonical handoff immediately:

```bash
node .agents/skills/session-handoff/scripts/write-session-handoff.mjs --session <full-session-id>
```

2. If the current thread is not persisted yet, create a temporary `SESSION_HANDOFF_LIVE_YYYY-MM-DD_<workstream-slug>.md` with the current user request, active files, current step, next step, and any PID/TTY/lock-path warning. Keep this live note updated manually until a canonical session ID exists.

3. Start the watcher as soon as there is enough repo context to know the current CWD is correct:

```bash
node .agents/skills/session-handoff/scripts/write-session-handoff.mjs --watch --interval-ms 60000
```

4. If you know the exact current session ID and only want this thread refreshed, scope the watcher:

```bash
node .agents/skills/session-handoff/scripts/write-session-handoff.mjs --watch --session <full-session-id> --interval-ms 60000
```

5. The watcher refreshes generated metadata, recent user messages, transcript activity, validation detections, `git status`, `git diff --stat`, and the master index on every interval.
6. The watcher preserves hand-written `What Changed This Session`, `Current Status`, and `Next Recommended Steps` sections unless `--overwrite` is supplied.
7. If the watcher reports a live Codex terminal without a persisted thread row or rollout path, record that warning in the live note and in the user-facing handoff response.
8. For bounded smoke tests, use `--max-cycles <count>` so the watcher exits on its own.
9. Stop the watcher only when the session is fully handed off or no longer needs crash recovery.

## In-Flight Update Triggers

Refresh the relevant handoff markdown whenever any of these happen:

- A new workstream starts or the user corrects the workstream identity.
- Before editing files.
- After a coherent patch lands.
- Before and after a long-running command, soak, server run, browser test, bridge restart, or external runtime step.
- After validation passes or fails.
- When a blocker, runtime dependency, missing secret, port conflict, stale tunnel, or external service issue is discovered.
- Before pausing, switching tasks, spawning agents, handing off, or ending the turn.

Each update should include exact file paths, commands, validation results, unresolved edge cases, and the next concrete step. Prefer short, current notes over broad transcript summaries.

## Save Workflow

1. If the repo has meaningful code changes, run a lightweight validation first. Prefer `pnpm run typecheck` in this workspace.
2. Resolve persisted Codex threads for this repo from `.codex/state_5.sqlite`.
3. Generate or update handoffs for all persisted repo threads:

```bash
node .agents/skills/session-handoff/scripts/write-session-handoff.mjs
```

By default, the script refreshes generated metadata sections and preserves existing hand-written content in `What Changed This Session`, `Current Status`, and `Next Recommended Steps`. Use `--overwrite` only when you intentionally want to regenerate the full file and replace those editable sections.

Optional single-session save:

```bash
node .agents/skills/session-handoff/scripts/write-session-handoff.mjs --session <full-session-id>
```

Optional custom output path for a single session:

```bash
node .agents/skills/session-handoff/scripts/write-session-handoff.mjs --session <full-session-id> --output /abs/path/to/file.md
node .agents/skills/session-handoff/scripts/write-session-handoff.mjs --session <full-session-id> --output /abs/path/to/file.md --overwrite
```

Optional custom output directory for all sessions:

```bash
node .agents/skills/session-handoff/scripts/write-session-handoff.mjs --output-dir /abs/path/to/dir
```

Optional custom master index path or skip:

```bash
node .agents/skills/session-handoff/scripts/write-session-handoff.mjs --master /abs/path/to/SESSION_HANDOFF_MASTER.md
node .agents/skills/session-handoff/scripts/write-session-handoff.mjs --no-master
```

4. Review script output for warnings about live Codex terminals with no persisted session row; those terminals cannot be resumed from handoff until they produce a real session ID/rollout.
5. Open the generated markdown and replace the scaffold bullets in:
   - `What Changed This Session`
   - `Current Status`
   - `Next Recommended Steps`
6. Keep the metadata sections the script generated:
   - session ID
   - rollout path
   - repo root
   - Mountain Time saved-at timestamp
   - UTC saved-at timestamp
   - git status snapshot
   - diff summary
   - recent user messages
   - transcript-derived session activity summary
   - validations detected in the transcript
7. Mention only validations you actually ran.
8. Link older handoffs instead of copying them wholesale.
9. Add or update the session row in `SESSION_HANDOFF_MASTER.md`:
   - full session ID
   - handoff filename
   - saved/updated timestamp in MT
   - short workstream label
   - validation/current status
   - next step
10. Keep the master row short. Put details in the per-session handoff.

## What Good Handoffs Include

- concrete file paths
- route names, scripts, env vars, or commands
- exact session ID
- temporary live-note identity when the exact session ID is not yet available
- verification status
- unresolved edges and likely next step
- a master-index entry that makes the handoff discoverable by session ID

## Avoid

- dumping the full transcript
- copying shell environment output or secrets into handoffs
- vague summaries with no file references
- claiming work is verified when you did not run validation
- creating duplicate handoff files for the same session ID
- using the master index as the detailed handoff body
