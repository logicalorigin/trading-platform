# Agent Run Rules

- Use Replit's default **Run Replit App** entry for full app bring-up.
- Do not use the generated **Configure Your App** workflow as the app runner.
- Do not add repo-defined `.replit` workflows or a root `.replit` `run = [...]` command; `[agent] stack = "PNPM_WORKSPACE"` lets Replit start the PYRUS web artifact.
- Keep the PYRUS artifact development command in `artifacts/pyrus/.replit-artifact/artifact.toml` as the source of truth for dev startup; it owns starting the API and web dev servers.
- Keep Replit startup config locked during routine work with `pnpm run replit:config:lock`; only run `pnpm run replit:config:unlock` for an intentional startup-config maintenance window.
- Do not set/delete Replit environment variables, create/update/remove Replit artifacts, or run other Replit control-plane actions during routine work. These can rewrite `/run/replit/env/latest.json` and `/run/replit/toolchain.json`, trigger PNPM_WORKSPACE artifact reconciliation, and bounce the PYRUS supervisor. Use them only in an explicit startup maintenance window with user approval.
- Keep the active per-session handoff updated during substantial work: refresh it at session start, after meaningful edits or validation, before risky/long-running actions, and before handing off. Each durable handoff belongs in its own `SESSION_HANDOFF_YYYY-MM-DD_<full-codex-session-id>.md`; `SESSION_HANDOFF_MASTER.md` is the changelog/table of contents; `SESSION_HANDOFF_CURRENT.md` is only a compact pointer to the active handoff.
- For validation, run targeted `pnpm` test/typecheck/build commands directly instead of pressing Run.
- For PYRUS browser QA, open the app with `?pyrusQa=safe`, wait on explicit readiness selectors instead of `networkidle`, avoid raw generated click targets like `@e*`, and get explicit approval before live full-app navigation.
- If you touch `.replit`, `artifacts/*/.replit-artifact/artifact.toml`, artifact `dev` scripts, database startup config, or `scripts/reap-dev-port.mjs`, run `pnpm run audit:replit-startup` before handing off.
- Do not remove `scripts/check-replit-startup-guards.mjs` from `audit:guards` or root `typecheck`; it is the regression guard for the Replit workflow and artifact startup rules.
- When a request has ambiguous product/UI semantics, especially wording like "share", "separate", "combine", "source", "pressure", or "footer", stop after repo inspection and ask a clarifying question before editing. Do not guess layout intent from implementation details alone; flatten ambiguity first, then implement.

## Fact-first operating rules

- Never guess when a fact can be checked locally. Before calling an endpoint, route, script, workflow, file path, or tool target, confirm it from source, generated clients, tests, route registration, or existing repo documentation.
- Separate facts, inferences, and unknowns in status updates and final reports. Say "observed" only for evidence from commands, source, logs, tests, browser/runtime output, or user-provided data. Say "inferred" when connecting evidence. Say "unknown" when not verified.
- Challenge assumptions before acting. For each non-trivial bug, plan, or implementation, identify the assumption that could be wrong and run the smallest factual check to confirm or reject it before expanding scope.
- If a request is even slightly ambiguous in a way that could change product behavior, data semantics, trading behavior, startup/runtime state, user-visible UI meaning, or the user's larger goals, stop after repo inspection and ask a concise clarifying question. Do not silently choose the most convenient interpretation.
- If instructions, existing code, runtime evidence, or prior handoffs conflict, surface the conflict with file/line or command evidence and ask which source of truth should win unless the repo already contains an explicit precedence rule.
- Stay inside the user's stated scope. Do not broaden from diagnosis to fixes, from scoped validation to full-app QA, or from source-confirmed probes to exploratory endpoint guessing without saying why and getting confirmation when scope is uncertain.
- Do not use speculative probes as discovery. Use `rg`, generated clients, route files, tests, or docs to find the correct command/URL/schema first; then run the probe.
- When evidence disproves the current theory, update the theory explicitly instead of forcing the data to fit the original plan.

## Karpathy-inspired operating rules

Behavioral guidelines from https://github.com/multica-ai/andrej-karpathy-skills. These bias toward caution over speed; use judgment for trivial one-line work.

- Think before coding. State assumptions, surface ambiguity and tradeoffs, push back when warranted, and ask when uncertainty would change the implementation.
- Keep solutions simple. Ship the minimum code that solves the request; do not add speculative features, one-off abstractions, or configurability that was not requested.
- Make surgical changes. Touch only what the task requires, match existing style, avoid drive-by refactors, and clean up only unused imports or code made obsolete by your own change.
- Work from verifiable goals. For non-trivial changes, define success criteria, use tests or focused checks where practical, and loop until the stated checks pass or a blocker is factual.
- For recurring bugs, remove the source. Identify the persisted state, creator path, and reader path; block stale state from re-entering before treating cleanup as permanent.

## Skill routing

When the user's request matches an available skill, invoke it. When in doubt, invoke the skill.

Key routing rules:
- Product ideas/brainstorming -> invoke `/office-hours`
- Strategy/scope -> invoke `/plan-ceo-review`
- Architecture -> invoke `/plan-eng-review`
- Design system/plan review -> invoke `/design-consultation` or `/plan-design-review`
- Full review pipeline -> invoke `/autoplan`
- Bugs/errors -> invoke `/investigate`
- QA/testing site behavior -> invoke `/qa` or `/qa-only`
- Code review/diff check -> invoke `/review`
- Visual polish -> invoke `/design-review`
- Ship/deploy/PR -> invoke `/ship` or `/land-and-deploy`
- Save progress -> invoke `/context-save`
- Resume context -> invoke `/context-restore`
- Author a backlog-ready spec/issue -> invoke `/spec`
- Question tuning, developer profile, or "stop asking me that" -> invoke `/plan-tune`
