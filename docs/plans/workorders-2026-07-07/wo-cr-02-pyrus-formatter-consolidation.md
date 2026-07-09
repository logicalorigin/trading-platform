# WO-CR-02 — pyrus formatter consolidation + OCC parser (code-reduction lane, Wave 3 of 3)

You are a codex worker in the PYRUS monorepo at /home/runner/workspace, executing Wave 3 of the
approved code-reduction plan. Predecessor: WO-CR-01 (report at `.codex-watch/wo-cr-01-report.md`).

**Prime directive: ZERO functional or visual behavior change.** Divergent implementations may be
consolidated ONLY with a parity proof (below); otherwise they stay or become named variants.
Ponytail discipline binds (`.claude/skills/ponytail/SKILL.md`).

## Gate (check-and-abort)

1. `.codex-watch/wo-cr-01-report.md` exists and its last slice reports a green gate.
2. `pnpm --filter @workspace/pyrus run typecheck` green before starting.
3. `.codex-watch/wo-cr-02-report.md` does not already exist.

## Ownership + tree rules

Read the "Ownership + tree rules" section of
`docs/plans/workorders-2026-07-07/wo-cr-01-apiserver-helper-consolidation.md`; it binds here
verbatim — especially the AUTHORITATIVE SKIP RULE: any file listed by
`git status --porcelain | cut -c4-` at edit time belongs to another lane; skip it entirely,
regardless of any list in this order. Currently-dirty pyrus examples (non-exhaustive):
`src/screens/SignalsScreen.jsx`, `src/screens/algo/{algoHelpers.js, algoSettingsFields.js,
algoTimeframeControls.js, OperationsSignalRow.jsx}` + their `.test.mjs` siblings,
`src/features/platform/PlatformAlgoMonitorSidebar.jsx`, `src/features/backtesting/*`.
NOTE: `src/screens/algo/OvernightControlPanel.jsx` is CLEAN and is a legitimate Slice C target —
the algo directory is not blanket-off-limits, only its dirty files are.
Skipped files' local formatter copies STAY (list them in the report).
KEEP (never touch): brand/marketing cluster (`components/brand/PyrusLogo.tsx`,
`components/LogoLoader.tsx`, `components/marketing/*`), `boot-neural*.tsx` — guard tests read
these from disk.

## Pre-existing failures ledger

Same as WO-CR-01: pyrus `loadingFallbackTheme.test.mjs` "React loaders use the current Pyrus
brand kit assets" fails at HEAD (index.html /brand/ favicon). api-server
`bridge-streams.test.ts` snapshot-bootstrap contract test fails at HEAD. Neither is yours.

## Parity-proof protocol (for every divergent-formatter consolidation)

Write a throwaway comparison script under `/tmp/` (NEVER in the repo) that imports the local
copy's logic and the canonical and compares outputs over this matrix:
`[-1e12, -1.5, -1, -0, 0, 0.4, 1, 1.5, 1e12, NaN, Infinity, -Infinity, null, undefined, "12"]`
plus the family's edges (sign of zero, digit counts, thousands separators, currency symbol,
compact/abbreviated forms, masked/placeholder params). A copy is consolidated ONLY if outputs are
identical across the whole matrix; otherwise keep it or add a named variant/options param that
reproduces its exact outputs. Record the matrix verdict per call-site file in the report.

## Background (verified evidence; all paths relative to `artifacts/pyrus/`)

Canonical homes: `src/lib/formatters.js` (imported ~47×; already exports `formatSignedPercent`
digits=2) and `src/screens/account/accountUtils.jsx` (exports `formatMoney` — currency+compact,
`formatPercent` digits=2, `EmptyState`, `SkeletonRows`).

**Slice A — byte-identical + import swaps (lowest risk, do first):**
- `formatSignedUsd` — BYTE-IDENTICAL ×2: `src/features/platform/algoEventToasts.js:13` and
  `src/features/platform/NotificationsDrawer.jsx:81`
  (`` `${value >= 0 ? "+" : "-"}$${Math.abs(value).toFixed(2)}` ``). Lift to
  `src/lib/formatters.js`, import at both sites.
- `src/screens/AccountScreen.jsx:218` defines inline `finiteAccountNumber` duplicating the
  export of `@workspace/account-math` (ALREADY imported by that screen). Byte-diff the bodies
  first; on match, delete the inline copy and use the package export.
- Commit: `refactor(pyrus): dedupe formatSignedUsd and finiteAccountNumber`

**Slice B — formatPercent ×~8 + formatSignedPercent ×~4 (parity protocol):**
- Known sites (audit 2026-07-07; re-locate before editing): `features/charting/chartWidgetShared.tsx:220`,
  `features/charting/chartPositionOverlays.ts:380`, `screens/account/accountUtils.jsx:102`
  (**canonical exported target — do not move it**), `screens/account/AccountHeroBlock.jsx:28`
  (masked param), `screens/DiagnosticsScreen.jsx:190`,
  `screens/FlowScreen.jsx:317` (digits=1), `features/charting/ChartFloatingCrosshair.tsx:34`
  (**uses `value > 0` — zero renders WITHOUT a sign; must keep exactly that via a preserved
  variant or option**). Skip WIP files (SignalsScreen etc.).
- Commit: `refactor(pyrus): consolidate percent formatters`

**Slice C — formatMoney ×~5 (riskiest family, own commit):**
- `accountUtils.jsx:44` is the most complete but "most complete ≠ equivalent": the parity matrix
  decides per call site; keep variants where reachable outputs differ. Known other sites:
  `AccountHeroBlock.jsx:22`, `chartPositionOverlays.ts:372`, `screens/algo/OvernightControlPanel.jsx:20`.
  (`algoHelpers.js:2562` is WIP-owned — skip.)
- Commit: `refactor(pyrus): consolidate money formatters`

**Slice D — formatNumber ×~4 + formatDuration ×~3 (same protocol):**
- Commit: `refactor(pyrus): consolidate number/duration formatters`

**Slice E — collapse dual Button: SUPERSEDED 2026-07-08.** The login-redesign lane
(`docs/plans/workorders-2026-07-08/wo-login-01-split-panel-redesign.md`) performs this exact
migration (house Button + delete `button.tsx`) as part of an INTENTIONAL login redesign; the
`shot-login-before.png` baseline is stale by design. Skip this slice entirely and record it as
superseded in the report.
- `src/components/ui/button.tsx` (shadcn `Button` + `buttonVariants`) has ONE consumer:
  `src/features/auth/LoginGate.jsx`. The house component is `src/components/ui/Button.jsx`
  (~20 consumers). Migrate LoginGate to the house Button with a manual prop mapping
  (variant/size/asChild differ — map to closest house API, preserving rendered classes as
  closely as possible), then delete `button.tsx`.
- Visual gate: `pnpm shot "http://127.0.0.1:18747/?screen=login" --out /tmp/login-after.png
  --wait 9000 --json` → status 200, consoleErrorCount 0, and Read the PNG: the login card
  (email/password/Sign in) must look unchanged vs the reference
  `.codex-watch/code-reduction-baselines/shot-login-before.png`. If 18747 is unreachable,
  record it and mark this visual gate BLOCKED in the report — do NOT restart or launch anything.
- Commit: `refactor(pyrus): single Button component; migrate LoginGate`

**Slice F — parseOccOptionSymbol, api-server ONLY (cross-package copy stays):**
- **Run-time gate: `snaptrade-account-history.ts` must be CLEAN in `git status` when this slice
  runs (it is dirty with equity-curves lane work as of authoring). If still dirty: SKIP this
  slice entirely, record it as deferred, and move on.**
- Two near-identical parsers: `artifacts/api-server/src/services/snaptrade-account-history.ts`
  (~line 428 pre-drift) and `.../snaptrade-account-portfolio.ts` (~line 367, adds
  `Number.isInteger` guards — the strictest). Regex family `^([A-Z0-9.]+)(\d{6})([CP])(\d{8})$`.
- Proof obligation: show the stricter guards are redundant given the regex (8-digit `\d{8}`
  parseInt is always a non-negative integer, etc.) via a shared-vector test comparing BOTH old
  implementations over valid + malformed OCC strings; only on identical verdicts consolidate to
  one shared function. Home: `snaptrade-shared.ts` if WO-CR-01 created it; if that file does not
  exist, export the parser from `snaptrade-account-portfolio.ts` and import it in
  `snaptrade-account-history.ts` — do not abort on this. Keep the shared-vector test as a small
  colocated `*.test.ts` if it earns its keep; otherwise /tmp.
- The pyrus JS copy (`src/screens/account/snapTradeAccountPanelModel.js:40`) STAYS; add a one-line
  pointer comment referencing the api-server canonical.
- Commit: `refactor(api-server): single OCC option-symbol parser for snaptrade`

## Acceptance gate (after EACH slice)

1. `pnpm --filter @workspace/pyrus run typecheck` (+ api-server typecheck for Slice F) green.
2. `pnpm --filter @workspace/pyrus run build` green (Slices A–E);
   `pnpm --filter @workspace/api-server run build` (Slice F).
3. For every touched file, run ONLY its basename-matching sibling test (`<name>.test.mjs` /
   `<name>.test.ts`) if one exists — NOT the whole directory (dirty WIP tests live alongside).
   `.ts` tests: `node --import tsx --test --test-reporter=spec`; `.mjs`: plain `node --test`.
   Only ledger failures may fail; failures inside other lanes' dirty test files are not yours —
   record and move on.
4. Parity-matrix verdicts recorded per consolidated call site (Slices B–D).

## Deliverable

`.codex-watch/wo-cr-02-report.md`: per slice — commit sha, files touched, per-site parity
verdicts (identical / variant-kept / skipped-WIP), copies left in WIP files for later, gate
results verbatim tails, screenshot verdict for Slice E. Do NOT dispatch WO-CR-03 yourself.
