# Agent Run Rules

- Use Replit's default **Run Replit App** entry for full app bring-up.
- Do not use the generated **Configure Your App** workflow as the app runner.
- Do not add repo-defined `.replit` workflows or a root `.replit` `run = [...]` command; `[agent] stack = "PNPM_WORKSPACE"` lets Replit start the PYRUS web artifact.
- Keep the PYRUS artifact development command in `artifacts/pyrus/.replit-artifact/artifact.toml` as the source of truth for dev startup; it owns starting the API and web dev servers.
- Keep Replit startup config locked during routine work with `pnpm run replit:config:lock`; only run `pnpm run replit:config:unlock` for an intentional startup-config maintenance window.
- Keep `SESSION_HANDOFF_CURRENT.md` updated during substantial work: refresh it at session start, after meaningful edits or validation, before risky/long-running actions, and before handing off. It should contain the current request, changed files, validation state, blockers, and next step.
- For validation, run targeted `pnpm` test/typecheck/build commands directly instead of pressing Run.
- If you touch `.replit`, `artifacts/*/.replit-artifact/artifact.toml`, artifact `dev` scripts, database startup config, or `scripts/reap-dev-port.mjs`, run `pnpm run audit:replit-startup` before handing off.
- Do not remove `scripts/check-replit-startup-guards.mjs` from `audit:guards` or root `typecheck`; it is the regression guard for the Replit workflow and artifact startup rules.
