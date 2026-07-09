# WO-07: Round-5 frontend audit triage + batch proposal (READ-ONLY)

You are `codex-worker` for `claude-lead` (session f68a9158). Repo `/home/runner/workspace`. INVESTIGATION ONLY — no code changes, no commits. Do NOT read `~/.claude/`, `.claude/skills/`, `agents/`.

## Context

Design-audit lineage: Round 2 (`FRONTEND_AUDIT_ROUND2.md`, 54 ranked findings, 2 won't-fix tie-breaks resolved by Riley) → Round 3/4 (`docs/audits/frontend-audit-round4-2026-07-05.raw.json`) → Round 5 (`FRONTEND_AUDIT_ROUND5.md` + `docs/audits/frontend-audit-round5-2026-07-06.raw.json`; handoff `242a10dc` said ~21/22 open after #01 was fixed). Since then, recolor/fix batches landed (`68298501` batch-5 blue glyphs, `1ce0161c`, landing2 commits `0e6aa6c0..1d5e0b9d`) — stale counts are expected. Doctrine: `DESIGN.md`, primitives in `artifacts/pyrus/src/components/platform/primitives.jsx`. Prior won't-fix rulings (GEX heatmap diverging scale; news-sentiment green/red) must be honored.

Also fold in two dangling decisions from `b03ee9be` (Jul 3): the inert protan color mode (`rg -n 'data-pyrus-color-mode|protan' artifacts/pyrus/src` — is it wired to anything?) and the deferred live-eyeball pass.

## Task

1. Re-derive the OPEN set: for every Round-5 finding (and any Round-2/4 finding not marked fixed/won't-fix), check the cited file:line against HEAD — classify fixed / still-open / moved (re-locate by symbol) / obsolete.
2. Group still-open findings into ≤4 dispatch batches: (a) mechanical color/tone swaps, (b) primitive/`surfaceStyle` migrations, (c) structural (de-card, layout), (d) judgment calls needing Riley. Each batch entry: file:line, issue, canonical replacement, effort.
3. Protan verdict: wired or inert, usages, and a wire-vs-delete recommendation with effort.
4. Estimate per-batch size (files touched) so batches can become WO-5x work orders directly.

## Deliverable

`.codex-watch/wo-07-round5-triage-2026-07-07.md`: open-set table, the 4 batches ready to paste into follow-up work orders, protan verdict, and counts (fixed-since-audit vs still-open) so the user can pick batches. No secrets, no file dumps.
