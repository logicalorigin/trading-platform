# Agent Run Rules

- Use Replit's default **Run Replit App** entry for full app bring-up.
- Do not use the generated **Configure Your App** workflow as the app runner.
- Do not add repo-defined `.replit` workflows or a root `.replit` `run = [...]` command; `[agent] stack = "PNPM_WORKSPACE"` lets Replit start the PYRUS web artifact.
- Keep the PYRUS artifact development command in `artifacts/pyrus/.replit-artifact/artifact.toml` as the source of truth for dev startup; it owns starting the API and web dev servers.
- Keep Replit startup config locked during routine work with `pnpm run replit:config:lock`; only run `pnpm run replit:config:unlock` for an intentional startup-config maintenance window.
- Keep the active per-session handoff updated during substantial work: refresh it at session start, after meaningful edits or validation, before risky/long-running actions, and before handing off. Each durable handoff belongs in its own `SESSION_HANDOFF_YYYY-MM-DD_<full-codex-session-id>.md`; `SESSION_HANDOFF_MASTER.md` is the changelog/table of contents; `SESSION_HANDOFF_CURRENT.md` is only a compact pointer to the active handoff.
- For validation, run targeted `pnpm` test/typecheck/build commands directly instead of pressing Run.
- For PYRUS browser QA, open the app with `?pyrusQa=safe`, wait on explicit readiness selectors instead of `networkidle`, avoid raw generated click targets like `@e*`, and get explicit approval before live full-app navigation.
- If you touch `.replit`, `artifacts/*/.replit-artifact/artifact.toml`, artifact `dev` scripts, database startup config, or `scripts/reap-dev-port.mjs`, run `pnpm run audit:replit-startup` before handing off.
- Do not remove `scripts/check-replit-startup-guards.mjs` from `audit:guards` or root `typecheck`; it is the regression guard for the Replit workflow and artifact startup rules.
- When a request has ambiguous product/UI semantics, especially wording like "share", "separate", "combine", "source", "pressure", or "footer", stop after repo inspection and ask a clarifying question before editing. Do not guess layout intent from implementation details alone; flatten ambiguity first, then implement.

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
