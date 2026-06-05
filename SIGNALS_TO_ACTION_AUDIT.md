# Signals to Action — Visual Audit

**Surface:** Algo Live page, "Signals to Action" table
**Code:** `artifacts/pyrus/src/screens/algo/OperationsSignalTable.jsx`, `OperationsSignalRow.jsx`, `OperationsSignalDrill.jsx`
**Lenses applied:** density & scannability · decision affordance · color & tone system · mobile
**Method:** static code audit (no live screenshot captured this pass)

---

## Ranked summary

| # | Finding | Lens | Severity | Effort | Fix in one line |
|---|---------|------|----------|--------|-----------------|
| 1 | Decision column is the narrowest (`0.9fr`) yet carries the most important signal | Decision | **P0** | M | Re-balance grid to `1.0 / 0.45 / 1.0 / 0.95 / 1.1` and bump `VerdictGlyph` to size 18 with a tinted background pill |
| 2 | No inline action on the row — every "act" requires expand-then-drill-then-confirm | Decision | **P0** | M | Add a single trailing Action button column (e.g. "Submit" for Ready, "Why?" for Blocked) that opens the ticket pre-filled |
| 3 | Information-importance inversion: dollar/qty/limit live on the dim *detail* line | Density | **P0** | S | Swap main/detail in Action and Execution so `1ct @ $2.10 · $210 risk` is the bright line and the action verb the dim modifier |
| 4 | 9+ tones, 5+ icon systems, and a glow gradient compete on the same row | Color | **P1** | M | Pin a 4-tone semantic palette (ready/blocked/stale/neutral); reserve direction tone only for the BUY/SELL label + left accent; demote everything else to neutral |
| 5 | 25+ visual atoms in a 50px row with two-line cells under default text scale | Density | **P1** | S | Increase row height to 56px on desktop, drop one redundant atom (ConfluenceChip OR SignalDots — they encode overlapping info) |
| 6 | Sort affordance is a 10px arrow at 72% opacity on inactive — invisible to new users | Affordance | **P1** | S | Use a triangle/caret with sort direction and "Sorted by …" microcopy in the header strip; show a faint underline on hoverable column labels |
| 7 | No symbol search/filter — 30 rows/page with no jump-to-symbol | Affordance | **P1** | S | Add a `⌘K`-style search input next to the filter pills, scoped to symbol/strategy |
| 8 | Filter pills wrap to a second row at narrow widths and shove the title block up | Density | **P1** | S | Collapse pills into a `Filter [All ▾]` dropdown below ~960px; keep counts in the dropdown menu |
| 9 | Phone row packs 10–12 atoms into one cell + a status pill | Mobile | **P1** | M | Replace mobile row with a 3-line layout: line 1 = symbol + direction + verdict pill, line 2 = action plan, line 3 = decision detail. Drop sparkline; keep dots only if direction is mixed |
| 10 | "Fresh & hot" gradient + direction-toned left accent + tone-colored text + ConfluenceChip all push the same dimension (direction) | Color | **P2** | S | Pick one channel for direction (the left accent), use the others for orthogonal axes (verdict, freshness) |
| 11 | No batch actions despite groupable filters | Affordance | **P2** | L | Allow multi-select on Ready rows with a "Submit selected" bar |
| 12 | Sticky header is light caption-cased; easy to lose orientation when scrolling | Density | **P2** | S | Add a thin underline + slightly higher contrast on column labels; consider showing the current sort key in the header strip |
| 13 | `ConfluenceChip` ("4/5") and `SignalDots` (per-timeframe colored dots) overlap conceptually | Density | **P2** | S | Keep `SignalDots` (richer); show the agreement count as a small superscript instead of a chip |
| 14 | Pagination footer doesn't show total filtered count in a glance-friendly way | Affordance | **P2** | S | Header strip should show `"Ready 12 of 234 signals · last scan 1m ago"` as a single live status line |

**Legend:** P0 = act now, P1 = act this iteration, P2 = next time we touch this surface. Effort: S < 1 day, M = 1–3 days, L > 3 days.

---

## Strengths to preserve

- **Five-column narrative reads left-to-right** like a sentence: *what / when / what to do / what it costs / should I act?* — keep that backbone.
- **Direction-toned left accent (`boxShadow inset 3px`)** is a strong, restrained directional cue. Cheaper than a colored row background and doesn't fight other tones.
- **Sticky header inside a `maxHeight 520` scroll body** keeps column labels visible without locking the table to the viewport.
- **Filter pills carry their own counts** (`Ready 12`, `Blocked 14`) — saves a scan.
- **Header subtitle's freshness ticker** (`Signal 3m · Scan 1m`) gives you tape liveness at a glance — keep, just promote.
- **Sortable columns hint at responsiveness** (Symbol / Newest / Score) — keep the sort verbs, just make the affordance louder.
- **Glow row gating is restrained** — only fires when `signal.fresh && score >= SCORE_FRESH_ROW_GLOW`. That conservatism is the right instinct; don't loosen it.
- **Empty state is well-shaped** with title + detail + icon + loading hint.
- **Bottom-sheet drill on phone** is the right pattern — preserve it.
- **`TableExpandableRow` abstraction** keeps row + expanded body coordinated. Reuse for any new affordances rather than inventing.

---

## Findings by lens

### A. Density & scannability

#### A1. Row carries 25+ atoms at 50px height
**Observation.** Within a 50px desktop row, the Signal column alone renders: `BigDirectionGlyph` + `StrategyTag` + symbol + direction label + `ConfluenceChip` + `SignalDots` + price + `MicroSparkline` + signal-move detail. The other four columns each contribute another 4–6 atoms. Total per row ≈ 25+ discrete visual elements. (See `OperationsSignalRow.jsx:1062–1311` and `SignalHeroCell` at lines 591–732.)
**Why it hurts.** Visual density that high prevents the eye from "landing" — every row demands a saccade across the full width before the user knows what they're looking at. For a *Signals to Action* surface, the user should be able to answer "is this row interesting?" within ~200 ms.
**Proposed fix.** Two complementary moves:
1. **Cut one atom.** `ConfluenceChip` and `SignalDots` both encode multi-timeframe agreement. `SignalDots` is more informative (it shows *which* timeframes agree, not just how many). Drop the chip on desktop or move it inside the dots' tooltip; line ~664–668 of `OperationsSignalRow.jsx`.
2. **Bump row height to 56px** (still inside compact density norms) — gives breathing room without dropping data.
**Risk.** None significant. Tests at `OperationsSignalRow.validation.js` only enforce 5-column structure, not individual atoms.

#### A2. Two-line cell pattern inverts importance
**Observation.** The `DataCell` pattern is `main` (11px, fs(11)) on top and `detail` (caption ~10px, dim) below. In **Action** (`OperationsSignalRow.jsx:1258–1274`), `main = "BUY 1c PUT NVDA $115 5/24"` and `detail = "1ct @ $2.10 · $210"`. The price/risk numbers a trader cares about are on the dim line. Same in **Execution** (mid/spread on main, age + Greeks on detail) and in **Since** (relative time on main, bars+timeframe on detail — and bars-from-signal is often the more decision-relevant fact).
**Why it hurts.** Hierarchy fights meaning. The brightest text should be the *thing the user uses to decide*, not the *label that names it*.
**Proposed fix.** Adopt a global rule: **numeric/quantitative facts go on the main line; qualitative/labels go on detail.** Then swap in three places:
- Action: main = `1ct @ $2.10 · $210 risk`, detail = `BUY 1c PUT NVDA $115 5/24`. (Or keep the action label as a leading chip + numbers as the main text.)
- Execution: main = `2.05/2.15 · 5%`, detail = `mid 2.10 · age 1.2s · Δ-0.31`.
- Since: main = `12 bars · 5m`, detail = `5m timeframe`.
**Risk.** Tooltip titles built from `compactJoin([...])` will need re-keying to preserve hover info. Update `signalSinceDisplay`, `actionPlanDisplay`, and `formatQuoteSummary` accordingly (in `OperationsSignalRow.jsx` and `algoHelpers.js`).

#### A3. Header strip wraps at mid widths
**Observation.** `OperationsSignalTable.jsx:252–352` lays out a flex row with a title block on the left and four filter pills on the right (`flexWrap: "wrap"`). At ~960–1100px the pills wrap to a second row beneath the title, which then pushes the title block vertically and creates rhythm jitter when the page resizes or a sidebar opens.
**Why it hurts.** Layout reflow on resize is anti-trust. The table looks differently anchored at different widths.
**Proposed fix.** Collapse the four pills into a single `Filter [All ▾]` segmented control or dropdown when `width < 960px`; otherwise keep pills. Lock the title block to a fixed line-count.
**Risk.** None — this is a header-only change.

#### A4. Sticky header is quiet
**Observation.** Header at `OperationsSignalRow.jsx:843–943` uses `textSize("caption")`, uppercase, `T.textMuted`, with a 10px `ArrowUpDown` icon at 72% opacity on inactive columns.
**Why it hurts.** When you scroll past 6–7 rows, the header recedes into the table grid and stops anchoring orientation.
**Proposed fix.** Slightly stronger contrast (`T.text` for the active sort, `T.textSec` for inactive), 11px caret with rotation that visually communicates direction (▼ vs. ▲), and a 1px underline on hover for the three sortable headers.
**Risk.** None.

---

### B. Decision affordance

#### B1. Decision column is under-allocated and under-styled
**Observation.** `COMPACT_COLUMNS` at `OperationsSignalRow.jsx:61–67` gives Decision `minmax(0, 0.9fr)` — the smallest of the five columns. Its content (`VerdictGlyph` size 14 + status label + sync detail + latest time) is rendered with the same DataCell pattern as everything else. The user's primary question ("should I act?") lives in the narrowest, quietest column.
**Why it hurts.** The visual hierarchy says "this column is least important." That's the opposite of what the table title ("Signals to Action") promises.
**Proposed fix.**
- Rebalance grid tracks to `1.0 / 0.45 / 1.0 / 0.95 / 1.1`.
- Render the verdict as a **tinted pill** with the verdict glyph at size 18 and verdict label in 12px medium weight (so it visually outranks neighbors). Pill background = `${verdict.tone}1c` (matching the current accent treatment elsewhere).
- Move sync/latest microcopy into the cell tooltip or a smaller second line below the pill.
**Risk.** `OperationsSignalRow.validation.js` (lines validating 5-col layout) and the matching helpers will need a snapshot refresh.

#### B2. No inline action — every act requires expand → drill → confirm
**Observation.** The row is `TableExpandableRow`-wrapped; toggling sets `algoFocus` and renders the drill underneath. There is no inline "Submit" / "Approve" / "Block" affordance.
**Why it hurts.** A trader noticing a Ready signal still needs 3 clicks (row → drill tab → confirm) to act. For a table whose name is "Signals to Action," friction is paying interest.
**Proposed fix.** Add a sixth trailing micro-column (~40px) with a context-specific button:
- Ready → "Submit" (opens ticket pre-filled).
- Blocked → "Why?" (opens the drill on the gate/blocker tab).
- Unavailable → no button; show a `–`.
The button can be a 24px icon-only IconButton with tooltip on desktop, full text on tablet+.
**Risk.** Requires the ticket-open flow to accept a candidate payload — should already be possible since the drill renders execution UI. Confirm with the team that an "open prefilled ticket" entrypoint exists or needs a small new affordance.

#### B3. Sort affordance is invisible
**Observation.** Sortable columns (Signal, Since, Decision) show a 10px `ArrowUpDown` icon at 72% opacity on inactive columns (`OperationsSignalRow.jsx:874–889`). The "active" treatment is the same icon at full opacity + `T.accent` color.
**Why it hurts.** New users won't realize they can click. Even repeat users may struggle to see *which* column is the current sort.
**Proposed fix.**
- Replace `ArrowUpDown` with `ChevronDown` rotated 0°/180° to indicate sort direction explicitly (the current sort logic is single-direction, so this is also an opportunity to add toggle-direction support if it doesn't already exist — see `sortRows` at `OperationsSignalTable.jsx:88–127`).
- Add a single-line sort summary in the header strip: `Sorted by Newest · 234 rows`.
- Increase inactive caret opacity to 100% but at `T.textMuted`; opacity is a weaker channel than color in this dark UI.
**Risk.** If the team wants to keep sort single-direction, skip the chevron-rotation part and only add the header summary.

#### B4. No symbol search
**Observation.** The only ways to slice the table are filter pills (4 statuses) and sort (3 keys). With 30 rows/page across many pages, there's no symbol-search input.
**Why it hurts.** Power users will copy the symbol from somewhere else and ⌘F the browser, which doesn't survive pagination.
**Proposed fix.** Add a slim search input next to the filter pills (or behind a `⌘K` shortcut), filtering by symbol + strategy substring. Lives alongside `filter` and `sortKey` state in `OperationsSignalTable.jsx:138–140`.
**Risk.** None. Existing memoized `rows` pipeline can absorb the search as another filter step.

#### B5. No batch action despite groupable filters
**Observation.** Filters cleanly group rows into Ready / Blocked / Unavailable. But there's no "act on this group" affordance.
**Why it hurts.** When five Ready signals come in at once, the user clicks five times. This is exactly the workflow algos are supposed to remove.
**Proposed fix (P2, exploratory).** Multi-select checkbox column on Ready rows with a footer action bar ("Submit 3 selected · est. $810 risk · est. fill 1.4s"). Hide for Blocked/Unavailable.
**Risk.** Significant UX work (selection model, undo, confirmation). Worth it if "burst Ready" is a real workflow.

---

### C. Color & tone system

#### C1. Tone inventory is large and partly decorative
**Observation.** A single row references: `T.green`, `T.red`, `T.amber`, `T.cyan`, `T.accent`, `T.text`, `T.textSec`, `T.textMuted`, `T.textDim`. Plus the direction-toned left accent (`boxShadow inset 3px`), plus the conditional gradient background on "fresh & hot." That's ≥ 9 tones + 2 background channels active on one row.
**Why it hurts.** Without a documented rubric, contributors will keep reaching for whatever tone is closest. Color stops *meaning* anything.
**Proposed fix.** Pin a 4-tone semantic palette and document it in `signal-language.{js,jsx}`:
| Channel | Tones | Meaning |
|---|---|---|
| Direction | green / red | BUY / SELL only — used on direction label + left accent |
| Freshness | green / amber / dim | Fresh / stale / unavailable — used on `Since` + verdict tinge |
| Verdict | green / amber / red | Ready / waiting / blocked — used on Decision pill background |
| Neutral | text / textSec / textMuted | Everything else |
Drop `T.cyan` from the row entirely (reserve for global accents like links). Audit each `tone={...}` usage against the rubric.
**Risk.** Touches `DataCell`, `SignalHeroCell`, `DecisionCell`, and several helpers in `algoHelpers.js`. Medium effort but high clarity payoff.

#### C2. Direction signal is over-encoded
**Observation.** A row's directional meaning is encoded on at least five channels simultaneously: `BigDirectionGlyph`, direction-toned label text, direction-toned left accent boxShadow, direction-toned freshness ratio on the glyph, and (when fresh & hot) the direction-toned gradient background.
**Why it hurts.** Five channels for one fact = noise. And it crowds out other axes that *aren't* getting visual representation (verdict, freshness, gate state).
**Proposed fix.** Pick **one** primary direction channel (the left accent) and **one** secondary (the BUY/SELL label text). Demote the glyph fill to a neutral tone, drop the gradient background, and reclaim those channels for verdict tinge.
**Risk.** Loss of the "fresh & hot" celebratory glow. If the team values that signal, keep it but use a *verdict-toned* gradient instead of a direction-toned one.

#### C3. Glow row gating is conservative — keep
**Observation.** `ra-signal-row-glow` fires only when `signal.fresh && score >= SCORE_FRESH_ROW_GLOW` (`OperationsSignalRow.jsx:1020–1024`).
**Why it doesn't hurt.** Good gating. Leave as-is. If you implement the verdict-toned tinge from C2, the glow becomes a Ready+Fresh+High-Score conjunction — even more meaningful.

---

### D. Mobile

#### D1. Phone row packs everything into one cell
**Observation.** `OperationsSignalRow.jsx:1097–1216` collapses the row to a single content cell + a trailing `StatusPill`. The cell renders, in one wrap: glyph + strategy tag + symbol + direction word + SignalDots + price + sparkline + (timeframe · age · score · gate/blocker · move%). Below ~360px width this is almost certainly unreadable.
**Why it hurts.** A user who pulls up the Algo screen on a phone is usually triaging in real time, between meetings, on the train. They need three glanceable lines, not one tag-soup line.
**Proposed fix.** 3-line mobile layout:
- Line 1: `glyph · SYMBOL · BUY · [verdict pill]` (right-aligned pill)
- Line 2: `1ct @ $2.10 · $210 risk` (action plan)
- Line 3: `5m · 12 bars · gate clear` (since + gate)
Drop the sparkline (or move to drill); keep `SignalDots` only when timeframes disagree, otherwise drop it.
**Risk.** Touches the mobile fork at `OperationsSignalRow.jsx:1097–1232`. Test on iOS Safari + Android Chrome at 320 / 375 / 414 widths.

#### D2. StatusPill carries all decision weight on phone — make sure it can hold it
**Observation.** With the desktop's Decision column collapsed away on mobile, the `StatusPill` is the only verdict surface. Its `compact` variant should still encode Ready vs. Blocked vs. Unavailable unambiguously.
**Why it hurts.** If the pill ever degrades to a generic glyph (e.g., when `verdict.Icon` is null), the phone user has no actionable verdict at all.
**Proposed fix.** Audit `StatusPill` (in `signal-language` or `primitives`) for missing-data paths; ensure the compact pill always renders either a verdict glyph + 1–2-char status label or a neutral "—" — never a blank.
**Risk.** Low.

#### D3. Bottom-sheet drill is the right pattern — keep, but verify thumb reach
**Observation.** Phone tap-to-expand opens `BottomSheet` (`OperationsSignalTable.jsx:422–445`). Good.
**Why it doesn't hurt much.** Right pattern. Just verify on real devices: (a) the drill's primary action button is in the thumb-reachable bottom half, (b) the sheet's close affordance is one-tap.

---

## Cross-cutting themes

### CT1. "Detail is more important than main" repeats across cells
A1, A2, and the "Since" column all surface the same underlying pattern: the **detail line frequently contains the more decision-relevant fact.** A one-line policy ("numbers on main, labels on detail") fixes Action, Execution, and Since simultaneously. Worth doing once across `DataCell` consumers rather than patching column-by-column.

### CT2. Direction is over-encoded; verdict is under-encoded
B1 + C2: the table spends a lot of visual budget repeating "direction" and very little on "verdict." Rebalancing both — strip direction back to 2 channels, lift verdict to a tinted pill — recovers the budget. **This is the single highest-leverage change in the audit.**

### CT3. The header strip is doing three jobs (title, freshness, filtering) and they fight at mid widths
A3 + B3 + B4 + #14 (header status line): replace the strip with a layered structure:
- Title row: `Signals to Action · 234 signals · Scan 1m ago`
- Tool row: search input · filter dropdown · sort summary
This consolidates everything we want above the table and resolves the wrap-jitter.

### CT4. Iconography crowds — pick a primary
`BigDirectionGlyph`, `ConfluenceChip`, `SignalDots`, `VerdictGlyph`, `QuoteIcon`, `StrategyTag`, `SpreadGauge` all coexist in one row. Each is good in isolation. Together they form a "logo soup." The audit suggests dropping `ConfluenceChip` (overlaps `SignalDots`) and moving `QuoteIcon` to the tooltip on hover (it already encodes information the spread gauge shows in a more useful form).

---

## Suggested next steps

### Quick wins (P0 + S, ship now)
1. **A2 / CT1** — Swap main/detail in Action, Execution, Since (numbers up). One-line policy + 3 helper edits.
2. **B3** — Sort affordance fix (chevron + header summary).
3. **B4** — Add symbol/strategy search input to header strip.
4. **A3** — Collapse filter pills to dropdown below ~960px.
5. **C3 audit** — Don't touch glow; just document why it's gated.

### Structural (P0/P1 + M, this iteration)
6. **B1 + B2 + CT2** — Decision column rebalance + verdict pill + inline action button. **Single highest-leverage change.** Touches grid tracks, `DecisionCell`, and adds a 6th trailing micro-column.
7. **A1 / A2 / D1** — Drop `ConfluenceChip` on desktop, drop sparkline on phone; bump desktop row height to 56px; restructure phone row to 3 lines.
8. **C1** — Pin and document the 4-tone semantic palette in `signal-language`. Sweep `DataCell` / `DecisionCell` / `SignalHeroCell` to enforce it.
9. **CT3** — Reorganize header strip into title row + tool row.

### Exploratory (P2 + L, when there's appetite)
10. **B5** — Multi-select / batch Submit for Ready rows.
11. **C2 light** — Replace direction-toned "fresh & hot" gradient with a verdict-toned one.
12. **Telemetry** — Instrument click-to-act latency from "row appears" → "ticket submitted" so improvements are measurable.

---

## Files most likely to change

- `artifacts/pyrus/src/screens/algo/OperationsSignalRow.jsx` — column tracks, `DataCell` swap, `DecisionCell` rebuild, phone fork rewrite, header chevron.
- `artifacts/pyrus/src/screens/algo/OperationsSignalTable.jsx` — header strip layout, search input, filter dropdown, status line.
- `artifacts/pyrus/src/screens/algo/algoHelpers.js` — `signalSinceDisplay`, `actionPlanDisplay`, quote/Greeks formatters (main/detail flip).
- `artifacts/pyrus/src/components/platform/signal-language.{jsx,js}` — palette documentation, verdict pill variant.
- `artifacts/pyrus/src/screens/algo/OperationsSignalRow.validation.js` — snapshot/contract updates.

## Verification path for any fix

1. Run the app and screenshot the Algo Live page at desktop (≥1440px), tablet (~1024px), phone (≤414px) — before and after.
2. Eyeball at default and at the system's largest text-scale setting.
3. `pnpm --filter @pyrus/pyrus run test` (or workspace equivalent) — update `OperationsSignalRow.validation.js` as needed.
4. Per `CLAUDE.md`: if any Replit startup file is touched in the process, run `pnpm run audit:replit-startup`.
