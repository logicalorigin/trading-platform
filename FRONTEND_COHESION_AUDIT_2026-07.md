# PYRUS Front-End Cohesion & Direction Audit — 2026-07-08

**What this is.** The complementary layer the 2026-06 doctrine audit (`FRONTEND_DESIGN_AUDIT_WORKPLAN.md`, `POLISH_BACKLOG.md`) did not cover: **cross-screen cohesion**, **friction-through-styling** (hierarchy, glanceability, legibility, affordance), and a proposed **aesthetic direction** ("modern/futuristic" per Riley's ask, resolved in interview to: cohesive · dense · legible · premium, styling-level only — no IA/workflow rework). Deliverables: this report, the findings appended to `POLISH_BACKLOG.md` (§COH + SYS-16…20), a direction proposal with veto pack, and a phased roadmap.

**Method.** 11 screens captured authenticated at 1440×900 + 390×844 dark (plus 3 light) at sha `f24887cc`, 2026-07-08 ~16:00 ET; manifest + all shots in `artifacts/pyrus/docs/design/audit-2026-07/` (open `contact-sheet.html` for the side-by-side). Visual scoring by 3 parallel auditors against a fixed rubric (H hierarchy / L legibility / A affordance / P era-3 adherence, anchored to DESIGN.md's hierarchy matrix), plus a code-evidence sweep and computed WCAG contrast for every text×surface token pair. Labels: `observed` (shot/source/math) · `inferred` · `needs-live-data`. Capture caveats: market had just closed — empty tape/matrix panels were **not** scored as flaws; four first-pass shots caught the boot loader and were re-shot (see manifest `label` field).

---

## 1. Executive summary — the era map

The June audit + follow-up work paid off: **the app is far more cohesive than its raw file stats suggest.** Market, Trade, GEX, Flow, Signals, Algo, Settings and the shell chrome are all recognizably one "era-3 command-center" generation (tokenized, dense, uppercase micro-labels, mono numerals, glow-as-status). The 4,694 inline styles are mostly *token-fed* — a delivery mechanism, not chaos.

The real cohesion breaks are four specific pockets:

| # | Break | Where | Severity |
|---|---|---|---|
| 1 | **Research is a different app.** Own 107-hex palette (olive/terracotta/gold), glyph+emoji icons (◆★⬢🤖🇺🇸📋), 17 JS hover mutations, 0 motion tokens. C11 chrome-seam: **fail**. | `features/research/data/researchThemes.js`, `PhotonicsObservatory.jsx` | P1 |
| 2 | **Account speaks a parallel dialect.** Second `Pill` (:493), second `StatTile` (:533), `ToggleGroup` (:529), 4 bespoke button styles (:282–378) — a shadow component system beside `primitives.jsx`. | `screens/account/accountUtils.jsx` | P2 |
| 3 | **Diagnostics' state diagram is era-2.** `✓ ✕ ◌ ! ⚡ →` glyph vocabulary vs the app's lucide standard; fixed-width SVG **clips at 390px**; JS hover mutation. | `MachineStateDiagram.jsx:200–207,889`; `DiagnosticsScreen.jsx:534–541` | P1 (mobile clip) |
| 4 | **Backtest styles via theme-objects.** `cardStyle(theme,scale)` / `buttonStyle(...)` fn-dialect (era-2), buttons have **no hover state at all**. | `BacktestingPanels.tsx:931,965` | P2 |

And three **cross-cutting friction findings** that directly answer the "UX friction" complaint:

- **Primary reads lose the squint test on 6 of 11 screens.** Account's P&L strip renders labels at 7px/values 9px (the primary read is the *smallest* thing on screen — `AccountHeroBlock.jsx:81,91`); GEX's spot price out-shouts NET GEX; Flow has no directional-pressure headline at all (`compassScore`/`netPrem` computed at FlowScreen.jsx:2467/2458 but never surfaced); Settings leads with a preferences form instead of readiness; Algo scatters readiness across four corners while a wall of saturated toggles wins the eye; Market's center chart drowns in overlapping BUY/SELL/TP annotation bubbles (**the single worst daily-use finding — MKT-11**). The shared watchlist rail's 5+ large bold prices compete with every screen's primary read.
- **Focus/keyboard affordance is systemically suppressed.** 12+ `outline:none` input sites with no replacement ring across Account (6), GEX ticker search, Algo settings (2), HaltStrip, header account strip, watchlist filter → one systemic fix (SYS-16).
- **Interaction feedback is uneven.** Signals is the outlier: ~10 raw `<button>`s + clickable rows with no hover cue and no motion tokens, while Flow/GEX/Market use the full `.ra-*` contract.

**Contrast math (computed, not vibes):** dark theme is healthy — `textMuted #788AA0` passes 4.5:1 on bg0–bg2 (5.65/5.49/5.11), red is large-text-only on elevated surfaces (4.47 on bg3, 3.89 on bg4), purple marginal from bg2 up. **Light theme broadly fails**: textMuted 3.29–4.14 on *every* surface, amber 2.99–3.76 everywhere, red/green marginal on elevated surfaces. Light is currently a second-class theme (decision point #1).

---

## 2. Scorecard matrix (0–2 per criterion; details in §COH backlog rows)

| Screen | Era | H (hierarchy) | L (legibility) | A (affordance) | P (era-3) | C11 seam | Worst finding |
|---|---|---|---|---|---|---|---|
| Market | 3 | 1·2·1·2·2·2 | 1·2·2·2·2 | 2·1·2·—·2 | 2·2·2·2·1·2 | pass | MKT-11 chart annotation overload (P1) |
| Signals | 3− | 1·2·1·2·2·2 | 1·2·1·2·2 | 1·1·1·—·2 | 2·1·2·2·2·2 | pass | SIG-05 no hover/motion contract (P2) |
| Flow | 3 | 1·2·1·2·1·2 | 1·2·1·—·2 | 2·2·2·1·2 | 1·2·2·2·1·2 | pass | FLOW-05 pressure verdict unsurfaced (P2) |
| GEX | 3 | 1·2·1·2·2·2 | 1·2·1·2·2 | 1·2·2·—·1 | 2·2·2·2·2·2 | pass | GEX-08 spot out-weighs primary read (P2) |
| Trade | 3 | 1·1·2·2·—·2 | 1·2·2·1·2 | 1·2·2·2·2 | 2·2·2·2·2·2 | pass | TRD-06 BUY/SELL CTA de-emphasized (P2) |
| Account | 3 (era-2 debt) | **0**·2·2·2·1·2 | 1·2·—·1·2 | 1·1·2·1·**0** | 2·2·2·2·2·2 | partial | ACC-07 primary-read inversion (P1) |
| Research | divergent | 2·2·1·2·2·1 | 1·1·1·**0**·1 | **0**·1·1·1·1 | 1·**0**·1·2·**0**·2 | **fail** | COH-01 off-token world (P1) |
| Algo | 3 (flagship) | 1·2·1·1·2·2 | 1·2·2·1·2 | 2·2·2·2·1 | 2·2·2·2·1·2 | pass | ALG-10 toggle wall vs data (P2) |
| Backtest | 2/3 hybrid | needs-live-data | 2·2·2·2·2 | **0**·2·2·2·2 | 1·2·2·2·2·2 | pass | BT-09 hoverless buttons (P2) |
| Diagnostics | 2 diagram in 3 chrome | 2·2·1·2·1·2 | 1·1·1·**0**·2 | 1·1·2·1·2 | 2·2·2·2·**0**·2 | **fail** | DIAG-05 SVG clips at 390 (P1) |
| Settings | 3 | **0**·2·2·1·1·2 | 1·1·2·2·2 | 2·2·2·2·2 | 2·2·2·2·1·2 | pass | SET-04 readiness demoted (P2) |

Chrome (shell): era-3 quality overall; weak spots = active nav tab under-signaled (`AppHeader.jsx:587–591`), 7px NLV/BP labels (`HeaderAccountStrip.jsx:45`), 2 focus-suppressed inputs, scattered footer.

---

## 3. Direction proposal — **"Luminous Terminal"** (unified era-3)

Not a new look. The direction is the **newest thing already in the building — generalized and tightened**: the Market v3 regime bar, the Algo operations cockpit, the glow-as-status orbs, the mono data voice — applied everywhere, with the audit's specific defects engineered out. "Futuristic" comes from typography, motion, glow-as-status, density and chrome — never decoration (DESIGN.md rejection rules are honored by construction).

### Principles (8)
1. **One primary read per screen, consolidated into a command strip.** Every screen leads with a full-width strip answering its DESIGN.md primary read (regime → Market ✓ already; P&L/exposure → Account; directional pressure → Flow; net GEX → GEX; readiness → Algo/Settings/Diagnostics). Values ≥2× label size, always mono.
2. **Dense but legible.** Reconciled type scale (one source of truth): micro 8 (annotations only — never load-bearing), label 9, caption 10, body 11, values 16/20/26. All numerals IBM Plex Mono + `tabular-nums`, right-aligned in tables.
3. **Color = meaning, glow = status.** Unchanged doctrine: blue bullish/buy, red bearish/sell, green P&L/health only, amber attention; accent only interactive/selected. Glow tokens only on live/stale/error status.
4. **Surfaces: 3-tier ramp, hairlines not boxes.** bg0 canvas → bg1 panel (hairline border + luminous top-highlight on primary panels only) → bg2 controls. Sections inside panels separate by hairline, never nested cards.
5. **Uppercase micro-labels as the app's label voice**; sentence case only for prose.
6. **Motion: enter, flash, never loop.** `ra-panel-enter` on mount, value-flash on live numerics, 90–260ms tokens — adopted uniformly (Signals is currently the gap).
7. **Affordance contract, no exceptions.** Interactive = rest-state cue + `.ra-*` hover + visible focus ring. Buttons: filled accent primary / hairline secondary / text ghost. Rows: hover tint + 2px accent left rail.
8. **One icon language.** lucide everywhere + one sanctioned tokenized `MicroGlyph` primitive (✓ ✕ ▲ ▼) for ≤10px table cells where a 12px icon can't fit.

### Token-level spec (before → after; each row cites what it closes)
| Token / rule | Current | Proposed | Closes |
|---|---|---|---|
| `TYPE_PX` in `typography.ts` vs `--ra-type-*` in `index.css` | two disagreeing sources (7–8px vs 10px) | delete/generate one from the other | SYS-17 |
| micro / label / caption | 7 / 8 / 9 px | 8 / 9 / 10 px (+1 each; spacing untouched — density preserved) | SYS-17, L2 across all screens, CHR-02 |
| Primary-read values | e.g. Account hero value 9px vs label 7px | command-strip values 26px mono, labels 9px caps above | ACC-07, H5 family |
| z-index | inline 10→10020, no scale | `--ra-z-{base:0, raised:10, sticky:100, overlay:1000, toast:1100, max:1200}` | SYS-18 |
| Focus | 12+ `outline:none` inputs, no ring | universal input focus contract: 2px accent ring + 1px offset (extend SYS-09 to all inputs incl. bare ones) | SYS-16, GEX-09 |
| Nav active tab | text color + 1px inset | + 2px accent underline + 10% accent pill bg | CHR-01 |
| Icon | lucide + ~40 glyph/emoji sites | lucide + tokenized `MicroGlyph` | COH-03, RES-15, DIAG-06 |
| Research palette | 107 raw hex (olive/terracotta/gold) | re-map hues onto token anchors, keep the graph's lightness ramp + layout | COH-01 |
| Light theme | textMuted 3.3–4.1:1, amber ≤3.76:1 (fails) | darken textMuted → ≥4.5 on bg0–bg2, amber → ≥4.5, or freeze theme (decision #1) | LIGHT-01 |
| Hover | 19 files JS mutation; Signals/Backtest none | `.ra-interactive`/`.ra-hover-*` only | COH-06, SIG-05, BT-09 |

**What stays (explicitly):** IBM Plex Sans/Mono pairing · blue/red directional semantics · the density model and `sp()`/scale system · all screen layouts, IA, navigation and workflows · RADII/ELEVATION scales · DESIGN.md doctrine in full · the dark bg ramp (#050814…).

**No-fly list (unchanged doctrine):** no decorative gradients/orbs/blobs · no card mosaics or cards-in-cards · no looping motion competing with live data · no icons as decoration.

**Mockup:** `artifacts/pyrus/docs/design/audit-2026-07/account-direction-mockup.html` — the Account screen (deepest era-2 debt + worst hierarchy inversion) restyled under these principles, sample data. Compare against `shots/account--w1440--dark.png`.

### Veto pack — 5 decisions for Riley
1. **Light theme:** fix the contrast floor (~6 token value changes, math in §1) **or** freeze light as best-effort and go dark-first? *Recommend: fix — it's cheap and keeps parity.*
2. **Type floor bump** (+1px on micro/label/caption, app-wide): slightly less cram, notably more legible. *Recommend: yes.*
3. **Research world:** re-map its palette onto token hues (keep the graph/layout identity) **or** sanction it as an intentionally divergent "analysis world"? *Recommend: re-map hues only.*
4. **Icon policy:** pure lucide **or** lucide + `MicroGlyph` for dense cells? *Recommend: lucide + MicroGlyph.*
5. **Track-C screen order** (see roadmap): default Account → Flow → GEX → Signals → Market → Settings → Algo → Diagnostics → Research → Backtest — reorder by your actual usage?

---

## 4. Roadmap (pick tracks, not findings)

| Track | Contents (finding ids) | Effort | Gate |
|---|---|---|---|
| **A — Quick wins** | SYS-16 focus ring sweep · CHR-01 nav active state · SIG-05 `.ra-interactive` adoption · BT-09 button hover · COH-06 hover-mutation removals (Diagnostics, Research) · COH-03 glyph→lucide in era-3 screens (Market ▲▼→, Flow ▲▼■★, Algo ⚠•) · SYS-18 z-index tokens | S each; ~1–2 days batched | none — can start before the veto |
| **B — Foundation** | SYS-17 type-scale reconciliation + floor bump · LIGHT-01 light contrast fixes · COH-02 Account dialect merge into primitives · COH-05 Backtest theme-object migration · COH-04 StatusPill unification · `CommandStrip` primitive (generalize RegimeTopBar — 3 proven usages exist: RegimeTopBar, SettingsStatusStrip, AccountHeroBlock, satisfying DESIGN.md's 2+ rule) · `MicroGlyph` primitive | ~1 week | direction approval |
| **C — Per-screen migration** | One screen per pass, June's "repeatable unit of work" (source fix → live re-shoot 1440/390 → verify): ACC-07 command strip + positions (feeder: `POSITIONS_TABLE_REDESIGN.md`) · FLOW-05 pressure headline · GEX-08 spot demotion · SIG-06/07 motion + bias salience · MKT-11 chart annotation declutter (collision rules, max-density, fade) · SET-04 readiness-first · ALG-10 toggle quieting · DIAG-05/06 responsive SVG + lucide · COH-01 Research re-map · Backtest polish | M per screen | Track B |

---

## 5. Workstream B — Symbol Intel Card (parallel feature; running)

Per the approved plan: app-wide symbol hover-card (candles + timeframe switcher + interactive chart + quick actions; flow summary, signal/STA state, key levels, context) and the same module inline in expanded STA/position rows. **Endpoint map (confirmed from source):** bars `GET /api/bars` (+SSE aggregates) · quotes/levels `GET /api/quotes/snapshot` · per-symbol flow prints `GET /api/flow/events?underlying=` (net premium aggregated client-side — pattern exists in FlowScreen) · signal state via existing `useSignalMonitorStateForSymbol` selector · GEX `GET /api/gex/:underlying` (also carries sector + vol-vs-avg) · earnings via range calendar filtered client-side. **Gaps found:** no per-symbol halt endpoint anywhere; VWAP is client-computed from bars (`indicators.ts:490`) — both worked around, no backend asks. Pilot (panel + hover wrapper on the watchlist) is being built in the current era-3 style; inline row variant and the app-wide trigger sweep follow after the pilot demo.

---

## 6. Honesty appendix

- Every finding row in POLISH_BACKLOG §COH carries `observed` / `inferred` / `needs-live-data` + the capture label. Screens judged at market close: empty tape/matrix/positions panels were excluded from hierarchy scores where the emptiness changed the judgment (marked needs-live-data; re-verify during RTH).
- Boot-loader lesson: `pnpm shot` reports `ok:true` even when `--wait-for` misses — **always check `waitForMissed`** and eyeball the PNG (5 first-pass shots were the boot screen; all re-shot).
- Auth for headless captures: temporary session minted via the server's own `createAuthSession` (approved by Riley), storageState in session scratchpad; expires 2026-07-09 07:52 UTC; **revoke after the next capture batch** (`auth_sessions` row for info@logicalorigins.com created 2026-07-08 19:52 UTC).
- Light-theme forcing via seeded `pyrus:state:v1` localStorage **works** and holds through hydration (verified `data-pyrus-theme="light"` + settle on 3 shots) — server prefs did not flip it.
- Contrast numbers are computed (WCAG 2.x relative luminance) from `THEMES` hexes; `*Dim` tokens are tinted *fills*, not text — their "failures" in the matrix are expected and not findings.
