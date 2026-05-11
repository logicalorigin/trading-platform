# Agent Run Rules

- Use Replit's default **Run Replit App** entry for full app bring-up.
- Do not use the generated **Configure Your App** workflow as the app runner.
- Do not add repo-defined `.replit` workflows or a root `.replit` `run = [...]` command; `[agent] stack = "PNPM_WORKSPACE"` lets Replit start the API and web artifact services.
- Keep artifact development commands in `artifacts/*/.replit-artifact/artifact.toml` as the source of truth for dev startup.
- For validation, run targeted `pnpm` test/typecheck/build commands directly instead of pressing Run.
