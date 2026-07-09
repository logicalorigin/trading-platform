# WO-53: Round-5 Batch C — structural single-source UI cleanups (QUEUED behind WO-51/52)

You are `codex-worker` for `claude-lead` (session f68a9158). Repo `/home/runner/workspace`, branch `main`. Do NOT read `~/.claude/`, `.claude/skills/`, `agents/`. Doctrine: `DESIGN.md` + `primitives.jsx`. Work screen-by-screen, committing per screen so a mid-run drop loses nothing. Re-locate all line refs by symbol (they're from `.codex-watch/wo-07-round5-triage-2026-07-07.md` at an older HEAD).

## Items (from triage Batch C) — in this order

1. **Settings theme duplication** — `SettingsScreen.jsx:~1545` (Dark/Light segmented) vs `~1640` (System/Dark/Light Select): keep Appearance System/Dark/Light as the single source, remove the duplicate row, migrate any persisted-preference mismatch gracefully.
2. **Algo broker-status duplication** — `AlgoLivePage.jsx:~940` + `AlgoStatusBar.jsx:~155`: one authoritative status chip; the other surface references it instead of recomputing (`broker off` vs `BROKER OFF` divergence dies).
3. **Signals interval hydration duplication** — `SignalsScreen.jsx:~3023` chips vs interval tiles/header: single home for per-interval hydration state; summary only in the header.
4. **Flow presets vs filters** — `FlowScreen.jsx:~4397` presets + `~3763` filter pills: presets visibly set the filter panel; one active-filter summary. Also the tape-count/header mismatch from finding #18 (`~4606`).
5. **GEX headings/grids + weak symbol selector** — `GexScreen.jsx:~2000/~2060/~2079`: consistent top-level section headings, one predictable analytics grid; `~1606`: prominent bordered symbol/search field with top-left symbol title.
6. **Watchlist management chrome** — `PlatformWatchlist.jsx:~1484-1668`: overflow-menu the management controls; passive Account-rail context.
7. **Flow scanner width vs idle Algo Monitor** — `FlowScannerStatusPanel.jsx:~243` + `PlatformAlgoMonitorSidebar.jsx:~1540`: allocate width to the scanner; collapse the idle monitor.
8. **Account KPI rail** — `AccountHeroBlock.jsx:~164`: 2-3 headline stat tiles, secondary metrics into a labeled cluster/disclosure.
9. **Market per-cell toolbar chrome** — `MarketChartCell.jsx:~528` + `ResearchChartSurface.tsx:~12214`: rest state shows ticker/timeframe/expand only; tools reveal on hover/focus; overflow for secondary actions. (Largest item — do last.)

**EXCLUDED (live-lane owned):** the `BacktestingPanels.tsx` items (Promoted Drafts lead, duplicate create-study) — backtesting files belong to the overnight-expectancy lane. Report them as deferred.

## SCOPE

Only the files named per item + their tests. Before editing any file, `git diff -- <file>`: if it carries uncommitted foreign hunks, skip that item and report the collision instead.

## Acceptance / verification

- Per-screen commit (`fix(web): Round-5 batch C — <screen>`), pyrus tests + typecheck green before each commit.
- After all items: one `pnpm shot` pass over Settings/Algo/Signals/Flow/GEX (login gate may block — note it; tests are the gate then).
- Scope-check per commit; do NOT push.

## Deliverable

`.codex-watch/wo-53-round5-batch-c-2026-07-07.md`: per-item before→after + commit hashes, skips/collisions, deferred backtesting items.
