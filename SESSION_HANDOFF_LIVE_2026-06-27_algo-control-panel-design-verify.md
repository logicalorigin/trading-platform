# Algo Control Panel Design — Visual Verification Live Handoff

- Session ID: `c2b451e9-95bc-4a25-ada1-65f0b4583246` (Claude Code, resume of the algo-control-panel design workstream)
- Saved: 2026-06-27 (evening MT)
- CWD: `/home/runner/workspace`
- Workstream: **Algo control panel design improvements** — visual verification of the uncommitted redesign (the step prior handoffs left as "headless held").

## What this workstream is

The "algo control panel design improvements" effort spans several sessions, all sitting **uncommitted** in the working tree:
- `7b50bfe6` (2026-06-26) — headless-browser recursive polish of the **settings region** (`AlgoSettingsRegion.jsx`): summary-strip grid alignment, compact inputs, chip-rails.
- `f67aed96` (2026-06-27 08:51) — `taste-skill` pass to **maximize space / minimize blank space** on the algo control panel.
- `019f0a2f` → `019f09d0-23ce` → `019f0963` (Codex, 2026-06-27) + live note `algo-kpi-table-density` — KPI/score table redesign: score buckets as **columns** with **All/Buy/Sell rows**, compact stacked metrics, no horizontal scroll.

## Working-tree state (observed)

Entire `artifacts/pyrus/src/screens/algo/` rewritten and uncommitted — **19 files, +2,783 / −626** (HEAD `86ae9bc`). Largest: `AlgoOperationsPrimitives.jsx` (+780), `AlgoSettingsRegion.jsx` (+688), `algoHelpers.js` (+450), `OperationsSignalTable.jsx` (+222), `AlgoLivePage.jsx` (+57). Mixed into a **broadly dirty worktree** (hundreds of unrelated api-server/etc. changes) — any land must isolate the algo files.

## Verification performed this session (observed)

- App live (`runDevApp.mjs` pid 4967); `api/healthz` 200; web 200.
- Algo deep-link confirmed from source: `?screen=algo` (screenRegistry.jsx:167 `{ id: "algo" }`; PlatformApp.jsx:951 `?screen=<id>`).
- `pnpm shot "$REPLIT_DEV_DOMAIN/?screen=algo" --full --wait 9000..15000` at **1440x900, 1920x1080, 1280x800**. Screenshots in session scratchpad (`algo-desktop.png`, `algo-1920b.png`, `algo-1280b.png`).
- Note: headless boot needs **≥9–15s** to render the algo screen; 8s captures stalled at "Preparing first screen 62%".

### Result — PASS
- ✅ KPI table renders score-bucket **columns** (`90-100 … 0-10 · UNKNOWN`) × **All (308) / Buy (277) / Sell (31)** rows, each cell stacking count + move% + hit%. Populated correctly with live cached data (weekend, 1d timeframe). **No horizontal scroll.**
- ✅ Dense settings region (WIRE TRAIL/RISK/SIGNAL/QUOTE/POSITION/INFRA + expanded PREMIUM/CONTRACTS/SYMBOLS/HALT inputs), left watchlist sparklines, center Signals→Actions table (308/308 rows), right Algo Monitor rail — all packed, minimal dead space.
- ✅ Layout holds across 1280 → 1920 with no page-level horizontal scroll.

### Minor observations + polish pass (this session)
1. **Rail SCORE truncation — FIXED.** Measured: candidate-card score value spans had `client=13px` vs `scroll=19px` (clipped 6px), so 2-digit scores like `32.8 / 45.7 / 41.0 / 31.7` rendered as "3…/4…" (indistinguishable). Root cause: `PlatformAlgoMonitorSidebar.jsx` SignalActionRow metric row gave Score the same `58px` min column as Age, but "SCORE" (longest label) + a 4–5 char value needs ~64–72px while "AGE"/"TF" + "1d"/"1m" had ~12px slack. **Fix (one line, ~826):** rebalanced `gridTemplateColumns` from `minmax(44px,0.7fr) minmax(58px,1fr) minmax(58px,1fr)` → `minmax(42px,0.6fr) minmax(50px,0.8fr) minmax(72px,1.3fr)` (net min ~unchanged; room shifted to Score). Verified: scores now `client=27=scroll=27` (no clip) and render full ("SCORE 32.8" etc.); TF/Age unaffected.
2. **1280 Signals→Actions tightness — WORKING AS INTENDED, no change.** `OperationsSignalTable.jsx:2135` already uses `overflowX:auto` + `tableMinWidth` with a compact mode; far-right columns scroll inside the table container, not the page. Not breakage (Surgical/Simplicity — left alone).
3. **Console 404 — CHASED, does not reproduce.** A response listener over a clean 15s algo-screen load (1440) found **zero non-2xx/3xx responses**. `headless-shot.mjs` still reports `consoleErrorCount:1`, but it only captures console text (no URL) and the SSE `ERR_ABORTED` are benign screenshot-teardown aborts. Likely an intermittent/worker-context fetch, **not a steady-state algo-screen resource**. No fix invented. (If we care: add a `page.on("response")` non-2xx logger to `scripts/headless-shot.mjs`.)

## Design-review polish pass — control panel (settings region) 2026-06-27

Scope (per user): **control panel = `AlgoSettingsRegion.jsx` (`algo-settings-region`)** — NOT the watchlist, KPI/Signals→Actions tables, ticker header, or global app header. Adapted the `/design-review` methodology to repo-native tooling (`pnpm shot` + playwright probes), kept edits in the dirty working tree (no per-fix commit), App-UI ruleset.

User picked two tracks; outcomes:
1. **Unify status chips + toggle colors → mostly no-op (already semantic).** Toggles are uniform `CompactSwitch` (accent-on / gray-off). Panel colors are semantic, not inconsistent: CALLS=blue/PUTS=red (directional), `BLOCKED` red (count), `GATEWAY`/`READINESS` amber (warnings), the "Allowance" amber note (caution, AlgoSettingsRegion.jsx:685). WARNING/SHADOW/BROKER OFF/OFFLINE chips are on the **operations header**, outside the panel. **Correction/uncertainty:** the `Gateway` (INFRA) control renders red in the live UI; I could not pin a red path in `CompactSwitch` (teal/gray only) — likely a gateway-health indicator adjacent to the toggle, not the toggle's own color. Not changed; needs a DOM color probe to confirm if pursued.
2. **Legibility floor → FIXED (modest 7→9).** Measured (scoped to `algo-settings-region`): **before = 7px ×87, 9px ×67, 10px ×1**. Root cause: panel uses `textSize("micro")` (=7px per uiTokens.jsx:161) for 87 rendered elements — below the app's own `--ra-type-micro:10px` CSS token. **Fix:** remapped `textSize("micro")` → `textSize("caption")` (=9px) in `AlgoSettingsRegion.jsx` only (`replace_all`, ~30 call sites). **After = 9px ×154, 10px ×1 (zero at 7px), `newClips: []`** (no new truncation). Pyrus typecheck clean. Verified visually (`algo-after.png`): labels readable, panel intact, slight expected reflow (taller).

### Continued incremental hierarchy/redundancy passes (user: "keep going incrementally")
- **Pass 1 — section-header hierarchy.** `SettingsSectionHeader.jsx` labelStyle: `caption`(9px)→`bodyStrong`(11px), color `textDim`→`textSec`; helperStyle `micro`(7)→`caption`(9). Expanded section headers (SIGNAL/RISK/CONTRACT/FILLS/EXITS/DIAGNOSTICS) now clearly outrank field labels. Verified visually (`h2-risk.png`), typecheck clean.
- **Pass 2 — redundancy dedupe.** `AlgoSettingsRegion.jsx` main render (~3153): `SectionSummaryStrip` now renders only when the section is **collapsed** (`{!open ? ... : null}`). Open sections show just the editable fields; collapsed sections show the summary chips as a value preview. Kills the "PREMIUM $1,500 chip + Max Premium 1500 input" duplication. Verified, typecheck clean.

**Correction (important):** the panel toggles are NOT a flat teal/gray binary — `Daily`/`Allowance` render **amber**, `Gateway` renders **red**: a teal/amber/red = ok/caution/alert semantic system. Earlier notes (and my statements) wrongly said "no red toggles." Preserve these colors.

**Open / not done:** the **compact toggle pocket** (`RISK/SIGNAL/QUOTE/POSITION/INFRA` tiny category labels) is the remaining flat-hierarchy item. It is a SEPARATE component from `algo-settings-region` (which only renders expanded `SETTINGS_SECTIONS`), composed via `AlgoRightRail`/`AlgoLivePage`. Not located yet — repo identifiers come through `rg`/Bash mangled (brand token → `ln`/`n`), so grep on the literals fails; needs tracing via `Read` of the panel composition. Other un-done items: `Pyrus · Pyrus` doubled sub-header; WIRE TRAIL micro-stat clarity; casing is intentional (compactLabel Title-case vs label UPPER-case).

**Headless note:** the algo screen boot is flaky under repeated headless hits (stalls at "Preparing first screen 62%", 502 bursts on the public preview when hit too fast). Space out `pnpm shot`; crop the panel from a full-page shot with ImageMagick (`magick … -crop`) instead of flaky element screenshots.

Net code change this session: **4 edits** — (a) rail SCORE grid in `PlatformAlgoMonitorSidebar.jsx`; (b) `micro`→`caption` legibility in `AlgoSettingsRegion.jsx`; (c) section-header hierarchy in `SettingsSectionHeader.jsx`; (d) summary-strip dedupe in `AlgoSettingsRegion.jsx`. All uncommitted, in the broader algo working-tree set. All typecheck-clean.

## Next step(s)

1. **(verification done)** — the "headless held" flag is lifted; redesign confirmed.
2. **(minor polish done)** — rail SCORE truncation fixed; 1280 table left as-intended; 404 chased (no repro).
3. **Open decision: isolate + land the algo-only design changes** — now **20 files**: the 19 `screens/algo/` files + the new 1-line `features/platform/PlatformAlgoMonitorSidebar.jsx` rail fix (already dirty from prior sessions) + their tests — separated from the unrelated worktree churn → focused Pyrus tests + typecheck → commit/PR. (Recurring next-step across `f67aed96`/`019f0a2f` handoffs.)

## Validation status

- Visual: PASS (1280/1440/1920, populated data) — this session.
- Rail fix: PASS — measured no clip (client=27=scroll=27) + visual "SCORE 32.8/45.7/41.0/31.7" full; focused `PlatformAlgoMonitorSidebar.test.mjs` **16/16**; `@workspace/pyrus` typecheck **clean** — this session.
- Prior: focused Algo tests **75 pass** + Pyrus typecheck (per `algo-kpi-table-density` live note). Not re-run this session.
