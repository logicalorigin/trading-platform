# Front-End Design Audit + Remediation — Workplan

**Status doc / resumable handoff.** Started 2026-06-10. App: PYRUS (`artifacts/pyrus`).
Living record of findings lives in [`POLISH_BACKLOG.md`](./POLISH_BACKLOG.md); design rubric is [`DESIGN.md`](./DESIGN.md). Original approved plan: `~/.claude/plans/peaceful-singing-eclipse.md`.

## Goal & method (as agreed)
Audit the front-end design across **all pages and elements** and **fully remediate**, screen by screen, via **live browser + source** review, **extending `POLISH_BACKLOG.md`**, across four dimensions:
1. Visual consistency & polish · 2. Design-system adherence · 3. Responsive & layout · 4. Accessibility & state coverage.

Each dimension maps to a `DESIGN.md` section so findings are objective, not taste.

## How to run / verify
- Dev server: pyrus web on **port 18747**. The full app shell only renders when the **backend stack is up** (api-server :8080, IBKR bridge, data). In a bare dev env it boots to a blank gate — bring the full stack up before live verification.
- Live browser: gstack `browse` daemon (`.claude/skills/gstack/browse/dist/browse`). Capture at **1440 (desktop) · 834 (tablet) · 390 (phone)** + key states. The browse tab can reset to `about:blank` after `viewport` changes or HMR reloads — re-`goto` and wait for `.ra-shell` before probing.
- Per change: `pnpm --filter pyrus typecheck` (must stay green) + live re-shoot + check `prefers-reduced-motion`.
- If `.replit` / artifact startup / db config touched: `pnpm run audit:replit-startup` (per CLAUDE.md). Don't touch `scripts/check-replit-startup-guards.mjs`.

---

## ✅ DONE (2026-06-10)

### Phase A — systemic substrate (closed)
The shared layer, fixed first so screen passes don't re-touch it. All build-verified (typecheck green); several live-verified.
- **SYS-02 / SYS-03** — removed all local `cssColorMix` / `CSS_COLOR` copies (35 files, −654 LOC); everything imports the canonical helpers in `lib/uiTokens.jsx`. Verified zero value divergence first.
- **SYS-05** — `.ra-touch-target` now floors **24px desktop / 44px touch** (was phone-only). Live-verified.
- **SYS-09** — global focus ring → `outline: 2px solid var(--ra-color-accent)` + offset (unclippable, high-contrast). Live-verified.
- **SYS-11** — `Button` hover → CSS vars; removed JS mutation + `ActionButton` re-mutation.
- **SYS-04** — **SoT established**: `surfaceStyle()` in `components/platform/primitives.jsx`; `Card`/`SurfacePanel` refactored onto it, zero visual change. Migration of hand-rolled surfaces is **per-screen** (see below).
- **SYS-06 / SYS-07** — all shared widgets + **58 inline transitions across 29 files** mapped to `--ra-motion-*` tokens; **every `transition: all` (7)** expanded to explicit props (no reflow).

### Phase B — global chrome (closed)
3 parallel source audits + live probes, fact-checked. Logged in POLISH_BACKLOG "Global Chrome (Phase B)".
- **GC-01** PlatformShell resize transition → motion token.
- **GC-02** `Drawer` close button → `.ra-touch-target` (44px mobile).
- **GC-03 (chrome)** — chrome already well-labeled; added theme-toggle `aria-label`. Content labels → Tier passes.
- **GC-04** — all **11 chrome hover-mutation sites → CSS hover classes** (`.ra-hover-*` in `index.css`). Live-verified wiring.
- Corrected false findings: `ConfirmDialog`/`ConnectionStatusPill` already exist.

---

## ⏳ REMAINING WORK

### Phase C — per-screen audit→fix loop (Tier order)
Run the repeatable unit (below) for each screen. Feeder redesign docs are the fix specs — don't re-derive.

- **Tier 1: ✅ DONE (2026-06-10)** — ~~Market~~ · ~~Signals~~ · ~~Trade~~ · ~~Account~~
  - Market: MKT-01/03/06/07 fixed. Signals: compliant, no fixes (3 agent P0s false). Trade: TRD-01 ConfirmDialog focus trap fixed (3 false-positives rejected). Account: ACC-01 modal rgba→token (5 state-coverage items logged open).
  - **Recurring pattern:** agent audits over-flag "color-only P&L/direction" — the app uses signed formatters (`+$/−$`, `formatSignedPercent`) + arrow glyphs consistently → multi-cue → compliant. SYS-15 largely mitigated.
  - **Next: Tier 2 → Algo** (Flow + GEX + Research done — see below).
- **Tier 1 (original list):** ~~Market~~ · ~~Signals~~ · ~~Trade~~ · ~~Account~~
  - **Market: ✅ DONE (2026-06-10)** — full 4-dim audit; fixed MKT-01/03/06/07 (decorative gradient→token, padding→`sp()`, hardcoded rgba→token, sector-flow touch target); 6 P2/P3 findings logged open (MKT-02/04/05/08/09/10). SYS-04 down-payment confirmed no-op. See POLISH_BACKLOG Tier 1 Market.
  - Feeder docs: Market→`WATCHLIST_CARD_REDESIGN.md`; Account/Trade positions→`POSITIONS_TABLE_REDESIGN.md`.
  - **Screenshots: WORKING** (corrected 2026-06-10). Plain `browse screenshot <path>` captures real PNGs (uses CDP, not sharp). Sharp's native lib (`libstdc++.so.6`) fails to load so **annotated (`-a`) and `responsive` (stitched multi-width) are broken** — workaround: set `viewport WxH` then plain `screenshot` per width. To fully fix sharp: relaunch the browse daemon with `LD_LIBRARY_PATH=/nix/store/04344hrpsbjzy7wq7vhwgcyarpbliz1l-gcc-14.2.1.20250322-lib/lib` (the persistent daemon resisted a clean restart this session). Capture flow: `goto` → poll until `.ra-shell` + buttons>50 → `screenshot`.
- **Tier 2:** ~~Flow~~ · ~~GEX~~ · ~~Research~~ · **Algo (next)** · Backtest
  - **Research: ✅ AUDITED + quick wins (2026-06-11)** — 4-dim source audit of `PhotonicsObservatory.jsx` (4.8k LOC) + `features/research/*` via 3 parallel agents, fact-checked. Fixed RES-01 (**real CSS bug**: `padding: sp(0)` un-interpolated in a `<style>` literal → broken reset), RES-02 (**closes SYS-06 "PhotonicsObservatory template-CSS block" edge**: inline `fadeIn 0.3s` overriding tokenized+reduced-motion `.ra-panel-enter` on 4 nodes), RES-03 (button transition→`--ra-motion-fast`), RES-04 (search-clear `aria-label`). **No directional-green drift** (unlike Flow — Research's read is "analysis conclusion," green is financial-outcome/health/data-viz). **Two systematic a11y clusters logged open** — RES-05 ~16 keyboard-unreachable `div/tr onClick`, RES-06 8 charts missing `aria-label` — recommend a focused a11y sub-pass w/ live keyboard+SR verification. Plus state-coverage (RES-08–12, incl. a real **stuck-loading peer sparkline** data-plumbing bug) + orb-removal screenshot call (RES-13) + **SYS-04 NOT no-op here** (RES-14, STYLE_CARD recipe ×8). See POLISH_BACKLOG Tier 2 Research.
  - **Flow: ✅ DONE (2026-06-11)** — full 4-dim source audit of `FlowScreen.jsx` (6.5k LOC) + `features/flow/*`. Fixed FLOW-01 (**directional-green→blue drift, 11 sites** routed through canonical `FLOW_*_TONE`/`toneForOptionSide`; multi-cue-safe). FLOW-02/03 left open for **live screenshot judgment** (quote-ladder book-side red, news-sentiment doctrine call); FLOW-04 wontfix (ProgressBar `width 0.4s` data-motion → **closes SYS-06 FlowScannerStatusPanel edge**). SYS-04 no-op. Feeder doc `AUDIT_FINDINGS_2026-05-13.md` is a runtime/DB bug report, **not design** — nothing to fold. See POLISH_BACKLOG Tier 2 Flow.
  - **GEX: ✅ DONE (2026-06-11)** — full 4-dim audit of `GexScreen.jsx` (2.3k LOC) + `features/gex/*`. No directional-green drift (already blue). Fixed GEX-01 (touch targets), GEX-02 (decorative icon `aria-hidden`). GEX-03–07 logged **open** — error-retry wants visual judgment, the rest **need live stale/empty/refetch data** to verify. SYS-04 no-op. See POLISH_BACKLOG Tier 2 GEX.
  - Feeder docs: Algo right rail→`ALGO_RIGHT_RAIL_REDESIGN.md`; Algo signal table→`SIGNALS_TO_ACTION_AUDIT.md`; perf→`APP_RESPONSIVENESS_AUDIT_2026-06-09.md` + `PAGE_LOAD_PERFORMANCE_AUDIT.md`.
  - **Live-state tail (Flow + GEX + Research):** FLOW-02/03, GEX-03/04/05/06/07, RES-07/11/13/17 all need a live browser session (stale/empty/error/refetch states, touch widths, orb screenshot) to close — batch when the full stack is up.
  - **A11y sub-pass (Research):** RES-05 (~16 keyboard-unreachable clickables) + RES-06 (8 unlabeled charts) are systematic zero-coverage gaps — do as one focused pass with live keyboard + screen-reader verification.
- **Tier 3:** Diagnostics · Settings (lower "functional-and-clean" bar)
- Platform-wide UX: `CONNECTION_ACTION_UX_PLAN.md` (note: `ConfirmDialog`/`ConnectionStatusPill` already exist — verify against spec, don't rebuild).

#### Repeatable unit of work (per screen)
1. **Source review** — screen file + its `screens/<name>/*` and `features/<name>/*` against all 4 dimensions.
2. **Live capture** — dev server up; screenshot at 1440 / 834 / 390 + loading/empty/error/stale states. Label `forced-fixture` / `live-after-hours` / `source-only`.
3. **Log findings** — append to the screen's Tier section in `POLISH_BACKLOG.md` (schema: `id · finding · evidence(file:line/screenshot) · confidence · severity · scope · effort · reach · parent(SYS-NN) · doc-ref · status`). Reference SYS-NN / GC-NN instead of re-logging.
4. **Remediate** — quick wins inline; redesigns per feeder doc. Reuse `sp()`/`fs()`/`RADII`/`T` (`uiTokens.jsx`), primitives incl. `surfaceStyle()` (`primitives.jsx`), motion classes (`motion.jsx`/`index.css`). Surgical changes only.
5. **Verify** — typecheck + re-shoot 3 widths + reduced-motion + no layout jump. Mark findings `done`.
6. **Checkpoint** — summarize, pause for review before next screen.

### Deferred tails to fold into the Tier passes
These were intentionally left per-screen (need live, in-context verification):
- **SYS-04 hand-rolled surfaces** — migrate genuine card surfaces to `surfaceStyle()` per screen. NOT a blind sweep: most `bg1` usages are controls/chrome/chart-cells (`RADII.xs`), not cards. Only convert true card recipes (border + `RADII.md/sm` + bg1, no custom shadow) and live-verify.
- **SYS-06 edge cases** — 2× `width 0.4s` (FlowScannerStatusPanel, account/RiskDashboardPanel — no token > 260ms) + 1 PhotonicsObservatory template-CSS block. Decide per screen.
- **GC-03 content labels** — ~dozens of unnamed icon-only buttons in screen content (ticker chips, watchlist rows, chart controls). Add `aria-label`s during each screen's a11y dimension.
- **GC-05** — non-`<button>` interactive elements get no focus ring (SYS-09 covers `button`/`[tabindex]` only): `HeaderAccountStrip` selector div, `PlatformShell` resize handle. Add `tabIndex`/convert to button.
- **GC-06** — `PlatformAlgoMonitorSidebar` CompactMetric / signal-row hand-rolled `bg1`/gradient → `surfaceStyle()`; ensure direction isn't color-only (Algo Tier-2 pass).
- **GC-07** — `HeaderAccountStrip` bare `MISSING_VALUE` lacks loading/error distinction (state-coverage).

### Non-star systemic P2/P3 (opportunistic — fix when touching the owning file)
- **SYS-08** two tab systems (`TabBar` vs `SegmentedControl`).
- **SYS-10** no card/list loading-skeleton composites; `Skeleton` lacks `role=status`.
- **SYS-12** value-flash duration mismatch (motion table 620ms vs impl 680).
- **SYS-13** inconsistent selection callback naming (`onChange`/`onSelect`/`onValueChange`/`onToggle`).
- **SYS-14** duplicate `@keyframes raSkeletonShimmer` in `index.css`.
- **SYS-15** P&L/direction by color alone at format layer (no sign/▲▼ helper) — colorblind gap.

### Won't-fix (noted)
- **GC-08 / animation loops** — infinite `animation:` durations (1.8s pulse, 820–860ms spins) are outside the 90–260ms transition-token scale. Leave unless a loop-token scale is introduced.

---

## Key files
| Area | Files |
|------|-------|
| Rubric / record | `DESIGN.md`, `POLISH_BACKLOG.md`, `CSS_VARS_MIGRATION_PLAN.md` |
| Systemic substrate | `artifacts/pyrus/src/index.css`, `src/lib/uiTokens.jsx`, `src/lib/motion.jsx`, `src/components/platform/primitives.jsx` (incl. `surfaceStyle()`), `src/components/ui/Button.jsx` |
| Shell / chrome | `src/features/platform/{AppHeader,PlatformShell,Footer,ToastStack,CommandPalette,PlatformWatchlist,PlatformAlgoMonitorSidebar,Header*,Mobile*}.jsx`, `src/components/brand/*` |
| Screens | `src/screens/*Screen.jsx` + `src/screens/<name>/*` + `src/features/<name>/*` |
| Routing | `src/features/platform/PlatformScreenRouter.jsx`, `screenRegistry.jsx` |

## Program-level "done" definition
`POLISH_BACKLOG.md` §0 systemic register closed; Global Chrome + every Tier 1–3 screen section has findings all at `done`/`wontfix`; live screenshots of all 11 screens at 3 widths conform to `DESIGN.md`.
