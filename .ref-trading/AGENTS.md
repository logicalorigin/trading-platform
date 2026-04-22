# AGENTS

## Codex Session Recovery Standard

For every Codex session in this repo:

1. Resolve `CODEX_THREAD_ID` and `REPLIT_SESSION` from the shell environment at session start.
2. Create or update `.agents/sessions/<CODEX_THREAD_ID>.md` before substantial work begins.
3. Treat that per-session markdown file as the canonical recovery ledger for the session.
4. Update the ledger at these points:
   - when the session starts
   - after important decisions or scope changes
   - before or after major edits
   - after verification steps
   - before ending a session or when crash/deharness risk appears
5. Keep `.agents/SESSION_INDEX.md` current so the newest relevant sessions are easy to discover.
6. On resume or deharness recovery, read `.agents/SESSION_INDEX.md` and the relevant `.agents/sessions/*.md` files before falling back to git diffs, CLI logs, or timestamp inference.
7. Prefer the helper commands:
   - `npm run session:start -- --goal "<current goal>"`
   - `npm run session:note -- "<checkpoint note>"`
   - `npm run session:show`
8. `SESSION_HANDOFF.md` is optional rollup context. It is not the primary recovery source when a per-session ledger exists.

If the helper script is unavailable, update the session markdown files manually. The recovery docs must remain repo-local and visible in the working tree.

## UI Design Workflow

For UI, dashboard, layout, chart, or visual polish tasks in this repo:

1. Do not start by inventing a design from scratch.
2. First inspect the existing local UI so new work stays consistent where consistency matters.
3. Then gather 2-3 visual references before making substantive UI changes.
   - Prefer real product references or strong implementation references over vague inspiration.
   - For charting, trading, analytics, or portfolio views, prefer references from finance or data-dense products.
4. State the chosen direction briefly before implementing.
5. Only then make UI changes.
6. If browsing is unavailable, say that explicitly and fall back to local screenshots or existing in-repo references instead of improvising blindly.

Default principle:
- reference first
- implementation second
- avoid reinventing common UI patterns without a reason
