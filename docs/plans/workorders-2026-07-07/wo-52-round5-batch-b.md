# WO-52: Round-5 Batch B — primitive / loading-state migrations

You are `codex-worker` for `claude-lead` (session f68a9158). Repo `/home/runner/workspace`, branch `main`. Do NOT read `~/.claude/`, `.claude/skills/`, `agents/`. Doctrine: `DESIGN.md` + `artifacts/pyrus/src/components/platform/primitives.jsx`. Match existing primitive API style exactly; smallest API addition that unblocks the migrations.

## Task — Batch B from `.codex-watch/wo-07-round5-triage-2026-07-07.md`

1. `artifacts/pyrus/src/features/charting/ResearchChartSurface.tsx:~13942` — chart loading/empty state renders an elevated bordered card over the skeleton. Replace with a flat centered label on the skeleton (no border/bg/shadow; merge eyebrow/title).
2. `artifacts/pyrus/src/features/trade/TradeChainPanel.jsx:~812` — chain loading uses an amber `DataUnavailableState`; align its loading treatment with the sibling spot/option chart panels (one standard loading paradigm across the three).
3. `artifacts/pyrus/src/features/backtesting/PatternDiscoveryPanel.tsx:~229` — custom `FamilyChip` exists only because canonical `Badge` lacks title passthrough. Add `title` support to `Badge` (or a static-chip primitive), then migrate.
4. `artifacts/pyrus/src/features/research/PhotonicsObservatory.jsx:~1338` — static period-return chip is hand-rolled; prior `Pill` swap was skipped because Pill is interactive. Migrate to the static `Badge`/`MetricChip` variant from item 3 — do NOT use interactive `Pill`.
5. `artifacts/pyrus/src/components/platform/primitives.jsx` (or `components/ui/*`) — only the minimal primitive change items 3-4 need; preserve non-interactive semantics (no hover/focus affordances on static chips).

Line numbers may have drifted — re-locate by symbol. If an item is already fixed at HEAD, skip and note.

## SCOPE

The five files above + primitive test file(s) + touched components' tests. NOT `BacktestingPanels.tsx` (live lane owns backtesting), and no Batch-C structural work.

## Acceptance / verification

- `pnpm --filter @workspace/pyrus test` green; pyrus typecheck green.
- One `pnpm shot` screenshot of the Research chart loading state and Trade chain loading state (use `--wait-for`/`--settle`, never networkidle); if the login gate blocks, note it and rely on tests.
- Scope-check clean. Commit as `fix(web): Round-5 batch B primitive/loading-state migrations`; do NOT push.

## Deliverable

`.codex-watch/wo-52-round5-batch-b-2026-07-07.md`: per-item before→after, primitive API change description, test/screenshot evidence, commit hash.
