Implemented and committed WO-R1 as two isolated commits:

- Commit A: `c3eae073b6a901f86bb38c7d2940763b55fcadfe`
- Commit B: `5287fabf32f2bdb8456fc36d8b47a234cbc2a3d9`

Report written to [.codex-watch/wo-r1-report.md](/home/runner/workspace/.codex-watch/wo-r1-report.md).

Observed verification:
- `pnpm --filter @workspace/db exec tsc --noEmit -p tsconfig.json` passed for both units.
- `pnpm --filter @workspace/db exec tsx --test --test-force-exit src/retention.test.ts` passed: 11/11 tests.
- `rg -n 'dbTrading' --type ts` shows only the new additive export.

Observed work-order tooling mismatch: `@workspace/db` has no `typecheck` script, and `vitest` is not installed; I captured both in the report and used the repo/source-confirmed commands. Schema files under `lib/db/src/schema/*` remain uncommitted per WO-R4 exclusion. No staged changes remain.