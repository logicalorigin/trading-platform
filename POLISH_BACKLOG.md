# PYRUS Frontend Polish & Finish — Backlog

Recursive page-by-page polish review toward a launch-ready, outside-audience-facing frontend, enforcing the existing design system (`uiTokens.jsx` / `--ra-*` + shared primitives). The **review** captures everything; only *execution* of heavy redesigns is deferred per-item. Methodology: `~/.claude/plans/merry-crunching-lightning.md`.

## Conventions
- **Finding fields:** `id` · `finding` · `evidence` (`file:line` / `screenshot` + `{state, source}`) · `confidence` (high|low) · `severity` (P0 launch-blocking / P1 fix-now / P2 next-touch / P3 nice) · `scope` (polish | systemic | system-evolution | redesign) · `effort` (S<1d / M 1–3d / L>3d) · `reach` (#pages) · `parent` (SYS-NN) · `doc-ref` · `status` (open|planned|approved|done|wontfix).
- **Dedup:** a systemic nit lives once as a `SYS-NN` (§0); pages reference it and bump its `reach` — never re-logged per page.
- **Screenshot labels:** `forced-fixture` (authoritative) · `live-after-hours` (low confidence) · `source-only`.

---

## §0 — Systemic register (Pass 0 — 15 findings)
Cross-cutting findings in the shared substrate (tokens, primitives, shell, motion, a11y policy). Pages append their id to `reach` rather than re-logging. **Auto-promote rule:** reach≥5 & effort≤M ⇒ do-now (marked ⭑).

| id | title | systemic root | scope | sev | effort | reach |
|----|-------|---------------|-------|-----|--------|-------|
| ⭑SYS-01 | `fs()` 10px floor collapses 6 sub-10 type roles (micro/label/control/tableHeader/tableCell/caption → all 10px at default scale) — small-text hierarchy flattened. **✅ FIXED — floor 10→7, typecheck green** | `uiTokens.jsx:356` vs `:175-180` | systemic | P1 | S | most (91 files) |
| ⭑SYS-02 | `cssColorMix` redeclared in ~23 files (local copies drop the canonical `Math.round`) | `uiTokens.jsx:150` | systemic | P1 | S | many |
| ⭑SYS-03 | Local `CSS_COLOR` maps re-hardcode `var(--ra-*)` in ~20 files; already drifting | `uiTokens.jsx:114` | systemic | P1 | M | many |
| ⭑SYS-04 | Two divergent card surfaces (`Card` vs `SurfacePanel`) + ~35 hand-rolled; no single card source of truth | `primitives.jsx:1526/1561` | systemic | P1 | M | most |
| ⭑SYS-05 | `.ra-touch-target` enforces 44px only on phone — no desktop/tablet min target (name implies a guarantee it doesn't give) | `index.css:829` | systemic | P1 | S | most |
| ⭑SYS-06 | ~60 inline transitions hardcode durations/`all`, bypassing the `--ra-motion-*` tokens the code calls authoritative | `index.css:406-412` | systemic | P1 | M | many |
| SYS-07 | `transition: all` on shared `Pill` (+others) animates layout → reflow jank | `primitives.jsx:823` | systemic | P2 | S | some |
| SYS-08 | Two tab systems (`TabBar` vs `SegmentedControl`) — divergent markup/motion/a11y | `tabs.jsx:19` vs `primitives.jsx:1213` | system-evolution | P2 | M | many |
| ⭑SYS-09 | Focus ring = low-contrast 2px box-shadow, no offset → clipped by `overflow:hidden` cards; `outline:none` global leaves no fallback | `index.css:424` | systemic | P2 | S | most |
| SYS-10 | No card/list loading-skeleton composites; two loading idioms; `Skeleton` lacks `role=status` | `primitives.jsx:1498` | system-evolution | P2 | M | many |
| ⭑SYS-11 | `Button` hover via imperative JS style mutation (fragile; `ActionButton` must re-mutate to undo) | `Button.jsx:134` | systemic | P2 | M | most |
| SYS-12 | value-flash duration mismatch (motion table 620ms vs impl `680`); non-token | `motion.jsx:25/32` | polish | P3 | S | some |
| SYS-13 | Inconsistent selection callback naming (`onChange`/`onSelect`/`onValueChange`/`onToggle`) | `components/ui/*` | systemic | P3 | M | many |
| SYS-14 | Duplicate `@keyframes raSkeletonShimmer` in index.css (drift risk) | `index.css:1186/1914` | polish | P3 | S | few |
| SYS-15 | P&L/direction by color alone at the format layer (no sign/▲▼ helper) — colorblind gap | `formatters.js:31` | system-evolution | P3 | M | most |

---

## §DOCS — Existing audit/redesign docs (completion audit)
The 8 curated docs feeding this review. Item-level Done/Partial/Open status is verified during each page's completion-audit step.

| doc | primary pages | type | status |
|-----|---------------|------|--------|
| APP_RESPONSIVENESS_AUDIT_2026-06-09.md | Flow, Account, Signals, Trade, Market, * | perf/responsiveness | partial (some 2026-06-09 fixes verified) |
| PAGE_LOAD_PERFORMANCE_AUDIT.md | Account, Trade, Flow, Research | perf | pending |
| AUDIT_FINDINGS_2026-05-13.md | Flow, platform | mixed | pending |
| SIGNALS_TO_ACTION_AUDIT.md | Algo (OperationsSignalTable) | UX/redesign | pending |
| POSITIONS_TABLE_REDESIGN.md | Account, Algo, Trade | redesign | pending |
| ALGO_RIGHT_RAIL_REDESIGN.md | Algo | redesign | pending |
| WATCHLIST_CARD_REDESIGN.md | Market (watchlist) | redesign | pending |
| CONNECTION_ACTION_UX_PLAN.md | platform-wide | UX | pending |

---

## Tier 1 — Market · Signals · Trade · Account
_(pending — review begins after Pass 0)_

## Tier 2 — Flow · GEX · Research · Algo · Backtest
_(pending)_

## Tier 3 — Diagnostics · Settings  _(lower "functional-and-clean" bar)_
_(pending)_
