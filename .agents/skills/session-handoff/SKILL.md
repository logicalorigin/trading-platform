---
name: session-handoff
description: Save or resume repo work using dated handoff markdown files that capture the Codex session ID, repo snapshot, recent user messages, and next steps. Use when the user asks to save a handoff, recover where prior work stopped, continue from an earlier session, or create a resumable project snapshot.
---

# Session Handoff

Use this skill for two cases:

- Resume prior work from existing handoff markdown files and current repo state.
- Save the current session into a new handoff markdown file for later pickup.

## Conventions

- Put the skill in `.agents/skills/session-handoff/`.
- Put handoff markdown files in the repo root.
- Name handoff files `SESSION_HANDOFF_YYYY-MM-DD_<session-id-prefix>.md`.
- Include the full session ID inside the markdown even if the filename uses a short prefix.
- Keep one handoff file per unique Codex session ID. If a session continues, update that same file; do not create another handoff for the same session.
- Maintain a repo-root master index named `SESSION_HANDOFF_MASTER.md`.
- Add or update one master-index row for each unique session ID. The master is an index, not the full handoff narrative.
- Keep handoffs concise, file-specific, and validation-aware.

## Resume Workflow

1. Open `SESSION_HANDOFF_MASTER.md` first if it exists.
2. Identify the relevant session ID and handoff file from the master index.
3. Read that session handoff and any older handoff it explicitly references.
4. If the master is missing or stale, list `SESSION_HANDOFF_*.md` in the repo root, newest first, and rebuild enough context from the per-session files.
5. Compare the handoff against current repo state with `git status --short --branch` and `git diff --stat`.
6. Inspect the referenced files before claiming context is restored.
7. Report:
   - the active workstream
   - validated status
   - blockers, secrets, or missing runtime dependencies
   - the best next step

## Save Workflow

1. If the repo has meaningful code changes, run a lightweight validation first. Prefer `pnpm run typecheck` in this workspace.
2. Resolve the current Codex session ID and its handoff path. Reuse the existing `SESSION_HANDOFF_YYYY-MM-DD_<session-id-prefix>.md` for this session if it already exists.
3. Generate the handoff scaffold if the session file does not already exist:

```bash
node .agents/skills/session-handoff/scripts/write-session-handoff.mjs
```

By default, the script does not overwrite an existing handoff for the same session ID. Use `--overwrite` only when you intentionally want to regenerate the scaffold and will immediately restore any needed hand-written details.

Optional custom output path:

```bash
node .agents/skills/session-handoff/scripts/write-session-handoff.mjs --output /abs/path/to/file.md
node .agents/skills/session-handoff/scripts/write-session-handoff.mjs --output /abs/path/to/file.md --overwrite
```

Optional custom master index path or skip:

```bash
node .agents/skills/session-handoff/scripts/write-session-handoff.mjs --master /abs/path/to/SESSION_HANDOFF_MASTER.md
node .agents/skills/session-handoff/scripts/write-session-handoff.mjs --no-master
```

4. Open the generated markdown and replace the scaffold bullets in:
   - `What Changed This Session`
   - `Current Status`
   - `Next Recommended Steps`
5. Keep the metadata sections the script generated:
   - session ID
   - rollout path
   - repo root
   - git status snapshot
   - diff summary
   - recent user messages
6. Mention only validations you actually ran.
7. Link older handoffs instead of copying them wholesale.
8. Add or update the session row in `SESSION_HANDOFF_MASTER.md`:
   - full session ID
   - handoff filename
   - saved/updated timestamp
   - short workstream label
   - validation/current status
   - next step
9. Keep the master row short. Put details in the per-session handoff.

## What Good Handoffs Include

- concrete file paths
- route names, scripts, env vars, or commands
- exact session ID
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
