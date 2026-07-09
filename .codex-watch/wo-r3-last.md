Observed: Commit verification failed before staging. Typecheck passed, dead-symbol search had 0 hits, but the required Vitest command failed with `Command "vitest" not found` and exit 254.

Per the work order, I made no commits and staged nothing. I wrote the required report here: [wo-r3-report.md](/home/runner/workspace/.codex-watch/wo-r3-report.md:1).

Unknown: why `vitest` is unavailable via the exact required `pnpm --filter @workspace/api-server exec vitest ...` command; I did not work around it because the work order said to report verbatim on verify failure.