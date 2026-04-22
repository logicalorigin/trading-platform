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
- Keep handoffs concise, file-specific, and validation-aware.

## Resume Workflow

1. List `SESSION_HANDOFF_*.md` in the repo root, newest first.
2. Read the newest relevant handoff and any older handoff it explicitly references.
3. Compare the handoff against current repo state with `git status --short --branch` and `git diff --stat`.
4. Inspect the referenced files before claiming context is restored.
5. Report:
   - the active workstream
   - validated status
   - blockers, secrets, or missing runtime dependencies
   - the best next step

## Save Workflow

1. If the repo has meaningful code changes, run a lightweight validation first. Prefer `pnpm run typecheck` in this workspace.
2. Generate the handoff scaffold:

```bash
node .agents/skills/session-handoff/scripts/write-session-handoff.mjs
```

Optional custom output path:

```bash
node .agents/skills/session-handoff/scripts/write-session-handoff.mjs --output /abs/path/to/file.md
```

3. Open the generated markdown and replace the scaffold bullets in:
   - `What Changed This Session`
   - `Current Status`
   - `Next Recommended Steps`
4. Keep the metadata sections the script generated:
   - session ID
   - rollout path
   - repo root
   - git status snapshot
   - diff summary
   - recent user messages
5. Mention only validations you actually ran.
6. Link older handoffs instead of copying them wholesale.

## What Good Handoffs Include

- concrete file paths
- route names, scripts, env vars, or commands
- exact session ID
- verification status
- unresolved edges and likely next step

## Avoid

- dumping the full transcript
- vague summaries with no file references
- claiming work is verified when you did not run validation
