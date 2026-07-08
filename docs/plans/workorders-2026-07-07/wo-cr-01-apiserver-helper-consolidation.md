# WO-CR-01 — api-server duplicate-helper consolidation (code-reduction lane, Wave 2 of 3)

You are a codex worker in the PYRUS monorepo at /home/runner/workspace. You are executing
Wave 2 of an approved code-reduction plan. The lead (claude-lead) has already landed Wave 1
(dead files, commits `8cef8121, 1677acaf, 12aa4346, b68abe94`) and the first two Wave-2 slices
(`f831ed76` formatDateOnly→toIsoDateString, `67ddfd2f` lib/env.ts consolidation).

**Prime directive: ZERO functional behavior change.** A local helper copy may be deleted ONLY
if its body byte-matches the canonical (whitespace/bound-variable-rename insensitive). Anything
divergent stays local or becomes a separately-named variant. When in doubt, leave it and note it.
Ponytail discipline binds (`.claude/skills/ponytail/SKILL.md`): reuse what exists, shortest diff.

## Gate (check-and-abort)

Abort with a report (see Deliverable) if any of these fail:
0. Write `.codex-watch/wo-cr-01-STARTED` as your very first action; if it ALREADY exists, another
   worker is (or was) on this order — abort immediately.
1. `git merge-base --is-ancestor 67ddfd2f HEAD` succeeds (predecessor landed; robust to
   later commits from other lanes).
2. `pnpm --filter @workspace/api-server run typecheck` is green BEFORE you start. If red, check
   whether errors are confined to another lane's dirty files (signal-options-*, signal-monitor*,
   shadow-account, services/platform.ts — see Ownership); if so proceed, else abort.
3. `.codex-watch/wo-cr-01-report.md` does not already exist (no duplicate run).

## Ownership + tree rules (STRICT — a stash incident already happened today)

- The working tree is SHARED with live lanes. NEVER edit, stage, or revert files you don't own.
- **AUTHORITATIVE SKIP RULE (live, not frozen): before selecting ANY file to edit, run
  `git status --porcelain | cut -c4-`. Any file that appears there is another lane's in-flight
  work — skip it entirely (do not edit, stage, or commit it), no matter what any list in this
  order says.** The enumerations below are non-exhaustive EXAMPLES; the frozen
  `wip-paths.txt` baseline is historical reference only. Lanes commit continuously, so a file
  dirty an hour ago may be clean now and vice versa — re-check per slice.
  Currently-dirty examples that ARE consolidation candidates you must nonetheless SKIP:
  `snaptrade-account-history.ts` (+ its `.test.ts`; equity-curves lane, dirty again after
  ca212fc3), `overnight-spot-worker.ts` (has a local `asRecord`), `flow-universe.ts` (has a
  local `toNumber`), `account-equity-history-model.ts`, `robinhood-account-history.ts`.
  Off-limits lane examples: `signal-options-*.ts`, `signal-monitor*.ts`, `shadow-account.ts`,
  `services/platform.ts`, `automation.ts`, `market-data-store.ts`, `runtime-flight-recorder.ts`,
  `backtesting.ts`, everything under `artifacts/backtest-worker/`, `lib/backtest-core/`,
  `lib/db/`, `lib/market-calendar/`, `pnpm-lock.yaml`, any `package.json`.
- Refresh the dirty list IMMEDIATELY before every commit:
  `git status --porcelain | cut -c4- > /tmp/wip-now.txt`
  and assert your staged set is exactly your intended paths:
  `git diff --cached --name-only` must equal your list and must NOT intersect /tmp/wip-now.txt
  minus your own staged edits.
- Stage ONLY explicit paths (`git add -- <path>...`). NEVER `git add -A`, `-a`, `.`,
  NEVER `git stash`, `git reset`, `git checkout --`, `git rebase`.
- This WO AUTHORIZES commits (small, one per slice below, conventional-commit style, to `main`).
  Do NOT push. Do NOT restart/reload the dev app in this WO.
- Baselines from the lead are in `.codex-watch/code-reduction-baselines/` (knip deadcode output,
  guard-test output, the frozen WIP list `wip-paths.txt`, and `head-sha.txt`).

## Known pre-existing failures (NOT yours to fix; do not "fix" them into your diff)

- `src/services/bridge-streams.test.ts` → "stock quote stream snapshot bootstrap uses platform
  snapshots, not websocket cache only" FAILS at HEAD (contract test vs earlier massive-repoint
  work; `fetchQuoteSnapshotPayload` no longer contains `isMassiveStocksRealtimeConfigured()`).
  Expected to keep failing; any OTHER failure you introduce must be fixed or your slice reverted.
- pyrus `loadingFallbackTheme.test.mjs` → "React loaders use the current Pyrus brand kit assets"
  fails at HEAD (index.html `/brand/pyrus-mark.svg` favicon). Irrelevant to this WO.

## Background (verified evidence — do not re-diagnose, but DO byte-verify each copy before deleting)

Canonical helper home exists: `src/services/../lib/values.ts` (exports `asArray`, `asRecord`
(returns `Record|null`), `asString`, `asNumber`, `toDate`, `toIsoDateString`, `compact`,
`normalizeSymbol`, ...). All paths below are relative to `artifacts/api-server/`.

Slice inventory (counts from a 2026-07-07 audit; the live tree may have drifted — your byte-diff
per copy is the source of truth, and WIP-lane files are ALWAYS skipped):

**Slice A — snaptrade shared helpers → new `src/services/snaptrade-shared.ts`:**
- `readJsonSafely` — ~11 identical copies across `snaptrade-*.ts` (guarded `await res.text()`
  → `JSON.parse`).
- `configuredSnapTradeCredentials` — ~7 copies across the snaptrade cluster.
- `snapTradeAccountIdFromProviderAccountId` — ~3 copies.
- The snaptrade cluster (`snaptrade-account-portfolio/sync`, `snaptrade-equity-orders`,
  `snaptrade-connection-portal`, `snaptrade-user-registration`, `snaptrade-readiness`,
  `snaptrade-brokerages`, `snaptrade-user-custody`, ...) is generally not lane-owned — but the
  AUTHORITATIVE SKIP RULE governs: `snaptrade-account-history.ts` is currently dirty
  (equity-curves lane) — leave its copies in place and record them in the report.
- The new module may import `readEnvString` from `../lib/env` (landed in 67ddfd2f).
- Commit message: `refactor(api-server): extract shared snaptrade helpers`

**Slice B — value helpers → `src/lib/values.ts`:**
- Candidates (audit counts, non-WIP copies only): `readString` ×13, `finiteNumber` ×8,
  `nonEmptyString` ×7, `readNumber`/`numberOrNull`/`dateOrNull` ×6 each, `asArray`/`isRecord`
  ×5 each, `toNumber`/`isFiniteNumber`/`normalizeCurrency` ×4 each, `clampNumber` ×3.
- Rule: if a copy byte-matches an EXISTING values.ts export → swap to import. If several copies
  byte-match EACH OTHER but no existing export, add ONE new export with exactly that body, then
  swap. If a copy diverges (different null-handling, trimming, coercion) → LEAVE IT, list it in
  the report. Do not add options parameters.
- If the total diff exceeds ~25 files, split into two commits by helper family.
- Commit message: `refactor(api-server): consolidate duplicated value helpers into lib/values`

**Slice C — `asRecord` two-variant split (HIGHEST RISK — do last):**
- ~33 local `asRecord` definitions with TWO distinct behaviors: canonical returns
  `Record<string,unknown> | null` (already in values.ts); many locals return `{}` on mismatch.
- Add `asRecordOrEmpty` to values.ts (`{}` fallback). Route each local copy by BYTE-DIFFING its
  body against the two canonical bodies — never by reading call-site intent. A null-copy routed
  to `asRecordOrEmpty` silently typechecks and flips truthy guards — that is the failure mode
  this rule exists to prevent. Copies matching neither body stay local (list them).
- SKIP the lane-owned files entirely (they keep their copies): signal-monitor*.ts,
  signal-options-*.ts, shadow-account.ts, services/platform.ts, automation.ts, index.ts if dirty.
- Commit message: `refactor(api-server): split asRecord into null and empty-object variants`

## Acceptance gate (after EACH slice commit)

1. `pnpm --filter @workspace/api-server run typecheck` green (or red ONLY in other-lane files —
   record exactly which).
2. `pnpm --filter @workspace/api-server run build` green.
3. Run the node:test files colocated with every file you touched:
   `node --import tsx --test --test-reporter=spec <files...>` (any cwd; file args relative to it).
   Only pre-existing failures listed above may fail; failures inside other lanes' dirty test
   files are also not yours — record and move on.
4. After the LAST slice: run the full api-server test sweep
   (`cd artifacts/api-server && node --import tsx --test --test-reporter=spec src/**/*.test.ts`
   — expand the glob via the shell or a file list; ~2-core box, run it once, be patient) and
   `pnpm run deadcode` from repo root; diff against
   `.codex-watch/code-reduction-baselines/deadcode-baseline.txt` — no NEW unused files/exports
   attributable to your changes.

## Deliverable

Write `.codex-watch/wo-cr-01-report.md`: per slice — commit sha, files touched, copies removed
vs copies left (with the divergence reason), test/typecheck/build results (observed, verbatim
tail), any other-lane red you excluded, and anything you aborted. Keep chat-style prose out;
facts only. Do NOT dispatch WO-CR-02 yourself.
