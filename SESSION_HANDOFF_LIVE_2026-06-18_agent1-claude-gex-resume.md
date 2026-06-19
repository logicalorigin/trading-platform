# LIVE Recovery Note — agent1-claude (Claude worker resume)

- Session ID: `pending` (Claude per-session transcript for the dropped worker is gone — `~/.claude/projects/-home-runner-workspace/` holds only the live leader session; resume by **workstream identity**)
- Created (MT): `2026-06-18 17:07 MDT`
- Worker terminal: Claude Code (separate terminal session). Adopt chat handle **`agent1-claude`**.
- Leader / coordinator: **`leader-claude`** (this session). Coordinate only via the chat endpoint.
- Chat endpoint: `http://127.0.0.1:8765` — `GET /messages`, `POST /messages {from,text}`, `GET /stream`.

## ⚠️ CRITICAL — handoff-overwrite hook (root-caused by prior agent1-claude, seq391)
`.claude/settings.json` registers `scripts/claude-autosave-handoff.mjs` on **SessionStart / Stop / PreCompact / SessionEnd**. It rewrites `SESSION_HANDOFF_CURRENT.md` (line ~274) and `SESSION_HANDOFF_MASTER.md` (line ~389) using the **running** session's id. As a worker this will clobber the leader's recovery pointer.
- Report status ONLY through the chat (`AGENT_CHAT_MESSAGES.jsonl` via the endpoint).
- Do NOT hand-write `SESSION_HANDOFF_CURRENT.md` / `SESSION_HANDOFF_MASTER.md` / the supervisor handoff.
- If you can, disable that autosave hook for your worker session (`/hooks`) so your Stop events don't repoint the leader's recovery.

## Authority (this round)
- ✅ Implement fixes. ✅ Spin up your own sub-agents / independent reviews.
- ❌ Do NOT `git add` / stage / commit. **leader-claude stages & commits** after your verified report.
- ❌ No app restart / browser / live endpoints unless leader approves.

## Workstream — GEX projection-cone overlay + G1 commit-readiness
User-reported issues:
1. Chart overlay appears to show **two GEX cones** — confirm single mount/builder vs. true double-render.
2. **No green center-line dot per expiration** looking forward on the projection cone.

### In-flight leader work to VERIFY (not re-author)
- Leader patched the **center-dot renderer** locally (seq389). Verify it now renders exactly one green dot per expiration on the cone center line, and that the "two cones" appearance is resolved.
- New backend file **`artifacts/api-server/src/services/gex-zero-gamma-simulation.ts`** is untracked (`??`) — Black-Scholes gamma spot-sweep (121 pts over spot×0.85..1.15) + bisection refinement for simulated zero-gamma (gamma-flip). Has a `.test.ts`. Must be included when leader commits.

### Render path (source-confirmed by prior agent1-claude, seq388)
`useGexProjectionConeOverlay` (`artifacts/pyrus/src/features/gex/useGexProjection.js:115`) → `TradeEquityPanel.jsx:179,186` (projectionCone) → `ResearchChartFrame.tsx:282` → `ResearchChartSurface.tsx:6417` → `buildGexProjectionConeSvgOverlay` (@2937, single call @10035) — one builder, one mount.

### Validation gap to close
`.js/.jsx/.mjs` are NOT covered by `tsc` (allowJs off), so frontend GEX wiring/copy is unverified by typecheck. Propose/add a `node --test` regression on `buildGexProjectionConeSvgOverlay` (center-dot per expiration + single-cone invariant).

## Definition of done
- Verify leader's center-dot patch + resolve two-cone appearance.
- Add the `node --test` regression for the cone builder.
- Independent review (sub-agent) of the GEX projection math + zero-gamma simulation.
- Post PASS/FAIL + `git diff --stat` (incl. untracked GEX files) to `leader-claude` in chat for commit.

## Key files
`artifacts/pyrus/src/features/gex/{useGexProjection.js, gexModel.js, gexGlossary.js}`, `artifacts/pyrus/src/screens/GexScreen.jsx`, `ResearchChartSurface.tsx`, `ResearchChartFrame.tsx`, `TradeEquityPanel.jsx`, `artifacts/api-server/src/services/gex-zero-gamma-simulation.ts(.test.ts)`.

## Carryover source
Full prior transcript archived at `AGENT_CHAT_MESSAGES_archive_2026-06-17_to_18.jsonl` (seq365–391 cover this workstream).
