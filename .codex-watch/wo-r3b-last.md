Done.

Created commits:

- `80f081f8b703b37bd045b49a4cf420fc553fea1b`
- `441a95959a0036f5e0d808be260bdca210de2d05`
- `594d46be66536fc0da5c6865b0220da37a4f761d`

Wrote the required report: [.codex-watch/wo-r3b-report.md](/home/runner/workspace/.codex-watch/wo-r3b-report.md)

Observed verification:
- Commit A: typecheck passed, dead-symbol search no matches, targeted suites `54/54`.
- Commit B: typecheck passed, dead-symbol search no matches, targeted suites `54/54`.
- Commit C: standalone rider `3/3`, typecheck passed, dead-symbol search no matches, final targeted command exited 0 with `49/49`.

Final index is clean. I left the carried exclusions unstaged, and also left a new post-Commit-B dirty `artifacts/api-server/src/services/signal-monitor.ts` diff unstaged as reported.