# LIVE Handoff — market-demo design/polish

- Session ID: `380dadf0-8c5f-4849-bfea-0d5cf26a87e7` (Claude Code)
- Updated (MT): `2026-06-26 ~14:05 MDT`
- Workstream: design + polish of the **market-demo** page (hidden Market-screen redesign at `?screen=market-demo`)
- Branch: `main` · **Nothing committed** — everything is in the working tree for review.
- Canonical plan: `docs/plans/market-screen-redesign-2026-06-26.md`
- Per-session handoff (bloated, metadata): `SESSION_HANDOFF_2026-06-26_380dadf0-8c5f-4849-bfea-0d5cf26a87e7.md`

## TL;DR — where this stands

The market-demo page is functionally complete and built on the design system. This session: (1) finished the **GEX cost fix**, (2) stood up a **repo-native headless browser tool**, (3) ran a **6-lens design audit** and applied **10 high-confidence fixes** (incl. 2 real bugs). The page has **never been visually verified in a browser** — the user is deliberately holding the headless pass. That visual pass is the next agent's first job.

## Done & VERIFIED this session

### 1. GEX cost fix — bulk endpoint (fully verified incl. runtime curl)
Per-row `/api/gex/{sym}` dashboard calls in the universe table → one bulk `/api/gex-snapshots`.
- `lib/api-spec/openapi.yaml` — new `GET /gex-snapshots?symbols=` (operationId `getGexSnapshots`) + `GexSnapshotsResponse`/`GexNetSnapshot` schemas.
- `artifacts/api-server/src/services/market-data-ingest.ts` — `getLatestGexSnapshotsForSymbols()` (DISTINCT ON over `net_gex`).
- `artifacts/api-server/src/services/gex.ts` — `getGexSnapshots()` service.
- `artifacts/api-server/src/routes/platform.ts` — `GET /gex-snapshots` route (registered before `/gex/:underlying`).
- `lib/api-client-react` + `lib/api-zod` — regenerated (`useGetGexSnapshots`, zod). Codegen: `node lib/api-spec/run-codegen.mjs`.
- `artifacts/pyrus/src/features/market/MarketUniverseTable.jsx` — single `useGetGexSnapshots` query + `netGexBySymbol` map; presentational `GexCell`.
- Verified: api-server+pyrus+libs typecheck ✅, builds ✅, codegen ✅, adversarial review = SHIP ✅, **runtime curl ✅** (bulk netGex == dashboard `snapshots[last].netGex`: SPY -12.4B, QQQ 205.7M).

### 2. Headless browser tool — repo-native, durable (verified working)
Replit provides Chromium natively via `REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE`; libs are already in `replit.nix`; `@playwright/test` already a dep. No `playwright install` needed.
- `scripts/headless-shot.mjs` — CLI: navigate, screenshot, capture console errors + matched/failed network. `pnpm shot "<url>" --out p.png --full --wait-for '<css>' --match '/api/gex' --json`.
- `artifacts/pyrus/playwright.config.ts` — wires native Chromium into the e2e suite (`pnpm --filter @workspace/pyrus run browser:waterfall`).
- `package.json` — `shot` alias. `.gitignore` — `.headless-shots/`. `CLAUDE.md` — documented under Project Run Rules.
- Verified: `pnpm shot https://example.com` ✅; `playwright test --list` ✅.
- NOTE: the app holds open SSE streams → `--networkidle` never settles; use `--wait`/`--wait-for`.

### 3. Design fixes applied (pyrus typecheck ✅; Vite HMR-live; NOT visually verified)
Driven by a 6-lens audit (33 findings). Applied the high-confidence, code-determinable ones:
- **[BUG] No scroll container** — `MarketDemoScreen.jsx` root now `height:100% overflow:hidden` + inner `overflowY:auto`. Previously the activity panel + rails were clipped/unreachable and the sticky hero couldn't stick.
- **[BUG] Notifications crash** — `useNotificationSnapshot()` returns an OBJECT `{toasts,…}`; was passed as an array → `.map` TypeError. Now passes `notifications.toasts`. (Minimal crash-stopper; lane data still thin — see panel decision below.)
- GEX Net γ tone hard-coded green/red → `toneForFinancialDelta(netGex)` (+ fixed `+0`). News sentiment dot → `toneForFinancialDelta`.
- Universe rows: added `role/tabIndex/aria-label/aria-pressed/onKeyDown` (Enter/Space) + `ra-hover-accent-bg` hover.
- Sort arrow showed desc for A–Z → asc for alpha. SegmentedControl → `radioGroup` semantics. Gauge → `ariaLabel`. GEX empty-dash sizing. `fontWeight 800→700` (off-system).
- Earlier in session (also applied): filter `<input>` → system `TextField`; hero Breadth + VIXY chips; tone routing for P/C + Net flow.

## Key uncommitted files (this workstream)
`artifacts/pyrus/src/screens/MarketDemoScreen.jsx`, `artifacts/pyrus/src/features/market/MarketUniverseTable.jsx`, `artifacts/pyrus/src/features/market/MarketInternalsRail.jsx`, `artifacts/pyrus/src/features/platform/PlatformScreenRouter.jsx`, plus the GEX-fix + headless-tool files above. (Note: many OTHER unrelated files were already modified in the working tree before this session — `git status` is large; scope commits carefully.)

## NEXT STEPS (in order)

1. **Lift the headless hold + visually verify.** `pnpm shot "https://$REPLIT_DEV_DOMAIN/?screen=market-demo" --out /tmp/demo.png --full --wait-for '[data-testid="market-demo-screen"]' --match '/api/gex-snapshots' --match '/api/gex/' --json` then Read the PNG. Confirm: hero (gauge + Breadth/P/C/VIXY/Net-flow chips), universe table renders with Net γ, ONE `/api/gex-snapshots` call and ZERO `/api/gex/<SYM>`, scroll reaches the rails, no console errors.
2. **MarketActivityPanel keep-vs-backout decision** (the big open call). It's wired into `MarketDemoScreen` but the audit found: unusual-flow lane is permanently empty + its threshold `<select>` is a dead no-op (`onChangeUnusualThreshold` not passed; no setter on this screen), NEWS/CAL header chips always read 0, and it conceptually duplicates the News rail. Either properly feed it (real unusual-flow source + alerts + a threshold setter) or back it out (remove from `MarketDemoScreen` render + the monitor-callback props threaded to `MemoMarketDemoScreen` in `PlatformScreenRouter.jsx`). Recommend back-out unless real data is wired. Needs pixels to decide.
3. **Deferred design items** (audit, code-fixable but judgment/visual — NOT yet done):
   - Hero: point the gauge at **Breadth** (plan intent) and drop the now-redundant Breadth chip; the gauge currently triple-encodes the same call/put flow as P/C + Net flow.
   - Net-flow tone language mismatch: hero chip is green/red (`toneForFinancialDelta`), per-row Flow-heat is blue/red (`toneForDirectionalIntent`) for the same quantity — pick one.
   - Raw-px `fontSize`/`fontWeight` across all 3 files bypass `textSize()`/`FONT_WEIGHTS` (sibling files use `textSize` 27×, zero raw) — scales wrong vs the rest of the platform.
   - Spacing rhythm: page padding 12 vs section gap 10; hero intra-cluster gaps (16/12/6/10); rail column rhythm (3 vs 4/6); filter `width:150` raw → `dim()`.
   - Loading skeleton (8 rows h26 + 6px gap) doesn't match loaded rows (h34, no gap, + header) → reflow on hydration.
   - "MARKET" hero label is redundant with nav (kept it; only demoted weight).
   - Touch targets on movers/news below 24px (`ra-touch-target`); news rail is a divider-less flat stack (`ra-hairline-h`).
   - Responsive (needs pixels): chart `minHeight:360` ↔ table `44vh` not fluid (try `clamp(260px,38vh,520px)`); filter fixed-width non-shrinking in `overflow:hidden` panel; universe columns sum ~574px min, `overflowX:hidden` → right columns (Trend/Net γ) clip < ~468px width; Leaders/Laggards rail restates the table head/tail when sorted by %.

## Validation snapshot
- pyrus typecheck ✅ (latest, after design fixes). api-server + libs typecheck ✅ (earlier). pyrus + api-server build ✅ (earlier). GEX endpoint runtime curl ✅. Design fixes **NOT** visually verified (headless held by user).

## Operational notes
- **Memory pressure is real**: host hit ~234MB free during this session and the dev supervisor crash-restarted. The API process alone is ~1.65GB RSS. Avoid running full `build`s + headless Chromium concurrently with the live app — prefer targeted `typecheck`; run `pnpm shot` sparingly. (Reaped 13 orphaned `gstack browse` daemons this session; freed ~260MB.)
- App lifecycle: if the supervisor (`node ./scripts/runDevApp.mjs`) is down, only the Run button (pid2) can bootstrap it. Backend reload = `kill -USR2 <runDevApp pid>`; web (Vite) HMRs frontend automatically.
- Design audit full output was at `/tmp/.../tasks/wy0jkwcgj.output` (ephemeral — its key findings are captured in NEXT STEPS above).
