# WO-51: Round-5 Batch A — mechanical color/tone/label swaps

You are `codex-worker` for `claude-lead` (session f68a9158). Repo `/home/runner/workspace`, branch `main`. Do NOT read `~/.claude/`, `.claude/skills/`, `agents/`. Doctrine: `DESIGN.md` + `artifacts/pyrus/src/components/platform/primitives.jsx`. Honor recorded won't-fix rulings (GEX heatmap diverging scale; news-sentiment green/red; Research ambient orbs) — do not "fix" those.

## Task — exactly these five, from `.codex-watch/wo-07-round5-triage-2026-07-07.md` Batch A

| file:line | Issue | Canonical replacement |
|---|---|---|
| `artifacts/pyrus/src/features/market/MarketActivityPanel.jsx:760` | Signal-row buy direction still `CSS_COLOR.green` | `toneForDirectionalIntent("buy")` / `SEMANTIC_TONE.directionBuy`; keep red for sell |
| `artifacts/pyrus/src/features/platform/PlatformWatchlist.jsx:1399` | Menu "Default" label green | `CSS_COLOR.accent` |
| `artifacts/pyrus/src/screens/diagnostics/MachineStateDiagram.jsx:723` | `n/o` abbreviation | plain `not observed` (or `no data`), keep truncation readable |
| `artifacts/pyrus/src/screens/diagnostics/MachineStateDiagram.jsx:200-207` | Unknown glyph `?` reads as help | less help-like treatment backed by the legend at ~:1598 |
| `artifacts/pyrus/src/screens/algo/PipelineStrip.jsx:255` | Raw `fontWeight: 600` | `FONT_WEIGHTS.label` |

Line numbers are from HEAD `1d5e0b9d` + two commits — re-locate by symbol/content if drifted. If a site was already fixed, skip and note it.

## SCOPE

Only the files above (+ their test files if snapshots/tests pin the old values). No adjacent refactors.

## Acceptance / verification

- `pnpm --filter @workspace/pyrus test` green; pyrus typecheck green.
- Scope-check clean. Commit as `fix(web): Round-5 batch A mechanical tone/label fixes`; do NOT push.

## Deliverable

`.codex-watch/wo-51-round5-batch-a-2026-07-07.md`: per-item before→after (file:line), skips with reason, test output summary, commit hash.
