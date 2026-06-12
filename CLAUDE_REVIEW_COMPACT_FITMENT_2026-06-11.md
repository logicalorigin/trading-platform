# Claude Review Packet: Compact Metric Strip Fitment

Date: 2026-06-11

Commit under review: `e69405274396bbc3cb359e124f755f8941b199bc`

Commit message: `fix: pack compact metric strips`

## Review Objective

Review the compact-fitment work that reduces wasted horizontal space in small metric/fact strips across PYRUS screens. The core design issue was grid containers using `1fr` tracks for compact facts, which made every metric cell expand to consume all available row width even when the content only needed a small intrinsic width.

The intended design rule after this change:

- Use `repeat(auto-fit, minmax(min(100%, Npx), max-content))` for compact metric strips.
- Pair it with `justifyContent: "start"` so the strip packs at the leading edge instead of stretching across the container.
- Keep `min(100%, Npx)` in the minimum track size so narrow containers can shrink without forcing horizontal overflow.
- Keep `1fr` tracks for true content panels, tables, and layouts that should distribute available space.

## Scope Summary

This commit changes five files:

1. `artifacts/pyrus/src/features/flow/ContractDetailInline.jsx`
2. `artifacts/pyrus/src/screens/DiagnosticsScreen.jsx`
3. `artifacts/pyrus/src/screens/account/CashFundingPanel.jsx`
4. `artifacts/pyrus/src/screens/settings/IbkrLaneArchitecturePanel.jsx`
5. `artifacts/pyrus/src/screens/compactFitment.test.mjs`

Git stat:

```text
5 files changed, 66 insertions(+), 4 deletions(-)
```

No Replit startup files, artifact startup config, environment files, package metadata, or API files were intentionally changed for this work.

## Itemized Actions

1. Identified the root layout rule causing wasted width.

   Observed pattern: compact metrics were laid out with:

   ```jsx
   repeat(auto-fit, minmax(${dim(N)}px, 1fr))
   ```

   The `1fr` maximum makes each track consume leftover horizontal space. That is appropriate for broad panels, but wasteful for short metric labels such as `BID`, `ASK`, `LIMIT`, `QUEUED`, and cash summary values.

2. Defined a compact metric-strip rule.

   Replacement pattern:

   ```jsx
   repeat(auto-fit, minmax(min(100%, ${dim(N)}px), max-content))
   ```

   This keeps a minimum touch/readability width while allowing each metric to size to content instead of stretching to equal row fractions.

3. Added leading alignment to compact strips.

   Added:

   ```jsx
   justifyContent: "start"
   ```

   This prevents the packed grid from distributing remaining row space after tracks shrink to intrinsic width.

4. Applied the rule to Flow inline contract execution quality.

   File: `artifacts/pyrus/src/features/flow/ContractDetailInline.jsx`

   Lines to inspect: 787-793

   Change:

   - Kept `data-testid="flow-inline-execution-quality"`.
   - Replaced `minmax(${dim(110)}px, 1fr)` with `minmax(min(100%, ${dim(110)}px), max-content)`.
   - Added `justifyContent: "start"`.

   Reviewer focus:

   - Confirm the five fact cells (`FILL`, `BID`, `ASK`, `SPREAD`, `SOURCE`) still fit and wrap to additional rows as needed.
   - Confirm value text still truncates where intended. The mapped value element already uses `overflow: "hidden"`, `textOverflow: "ellipsis"`, and `whiteSpace: "nowrap"`.

5. Applied the rule to Diagnostics chart scope facts.

   File: `artifacts/pyrus/src/screens/DiagnosticsScreen.jsx`

   Line to inspect: 1678

   Change:

   - Replaced the chart-scope facts grid from `1fr` tracks to packed intrinsic tracks.
   - Added `justifyContent: "start"` inline with the existing grid style.

   Reviewer focus:

   - Confirm chart scope rows do not overflow when provider names, cursor state, or exhaustion reasons are long.
   - This is the riskiest changed strip because its facts are plain spans, not pre-existing metric cards with explicit ellipsis styling.

6. Applied the rule to Account cash summary metrics.

   File: `artifacts/pyrus/src/screens/account/CashFundingPanel.jsx`

   Lines to inspect: 85-90

   Change:

   - Added `data-testid="account-cash-summary-grid"` for targeted QA.
   - Replaced `minmax(${dim(120)}px, 1fr)` with `minmax(min(100%, ${dim(120)}px), max-content)`.
   - Added `justifyContent: "start"`.

   Reviewer focus:

   - Confirm masked and unmasked money values remain readable.
   - Confirm long localized currency strings or large balances do not clip.

7. Applied the rule to Settings IBKR lane mini metrics.

   File: `artifacts/pyrus/src/screens/settings/IbkrLaneArchitecturePanel.jsx`

   Lines to inspect: 540-546

   Change:

   - Expanded the inline grid into a multiline `div` for readability.
   - Added `data-testid={`settings-ibkr-lane-mini-metrics-${lane.laneId}`}` for targeted QA.
   - Replaced `minmax(${dim(86)}px, 1fr)` with `minmax(min(100%, ${dim(86)}px), max-content)`.
   - Added `justifyContent: "start"`.

   Reviewer focus:

   - Confirm lane cards do not become visually ragged in a way that hurts scanning.
   - Confirm editable lane controls below the metrics do not shift or clip.

8. Added a focused regression test.

   File: `artifacts/pyrus/src/screens/compactFitment.test.mjs`

   Lines to inspect: 1-51

   Test behavior:

   - Reads the four source files directly.
   - Asserts each selected compact strip contains the packed grid pattern.
   - Asserts each selected strip has the expected `data-testid` where needed.
   - Asserts each selected strip includes `justifyContent: "start"`.

   Reviewer focus:

   - This is a source-level regression guard, not a full browser layout test.
   - It is intentionally narrow so accidental reintroduction of `1fr` metric strips fails quickly.

9. Deferred one possible target because of unrelated dirty work.

   File not changed: `artifacts/pyrus/src/features/platform/HeaderStatusCluster.jsx`

   Reason:

   - The file already had unrelated dirty changes in the worktree.
   - I did not touch it to avoid mixing unrelated work into this commit.

## Verification Performed

Pre-commit checks:

```bash
pnpm --filter @workspace/pyrus exec tsx --test src/screens/compactFitment.test.mjs
pnpm --filter @workspace/pyrus run typecheck
pnpm --filter @workspace/pyrus run build
git diff --staged --check
```

Observed results:

- `compactFitment.test.mjs` passed.
- `typecheck` passed.
- `build` passed.
- `git diff --staged --check` was clean.
- The build still emitted existing Vite warnings about dynamic/static imports and chunk size. Those were not introduced by this commit.

Post-rebuild checks after the user rebuilt the app:

```bash
pnpm --filter @workspace/pyrus exec tsx --test src/screens/compactFitment.test.mjs
pnpm --filter @workspace/pyrus run typecheck
curl -I --max-time 3 http://127.0.0.1:18747/?pyrusQa=safe
```

Observed results:

- `compactFitment.test.mjs` passed.
- `typecheck` passed.
- App responded with HTTP 200 at `http://127.0.0.1:18747/?pyrusQa=safe`.

Safe-mode browser smoke:

- Flow screen mounted, but state remained `FLOW IDLE`; `flow-inline-execution-quality` did not render.
- Account screen mounted, but Cash & Funding stayed in loading state; `account-cash-summary-grid` did not render.
- Settings screen mounted, but IBKR Data Lanes stayed loading; `settings-ibkr-lane-mini-metrics-*` did not render.
- Diagnostics screen mounted, but no chart-scope rows rendered.

Conclusion from browser QA:

- Page-level mounting was observed in safe mode.
- Exact target strip runtime fitment was not observed because the relevant data-gated components did not mount in safe mode.

## Known Review Gaps

1. Runtime visual overflow for the exact changed strips still needs either live data or seeded fixtures.

   Safe mode did not render the target strips. A complete visual review should force or seed data for:

   - Flow inline contract details.
   - Account Cash & Funding summary.
   - Settings IBKR lane architecture.
   - Diagnostics Browser tab chart scopes.

2. The new regression test is string-based.

   It catches accidental source regression of the compact grid rule, but it does not measure layout boxes, clipping, or overflow at runtime.

3. Diagnostics chart scope facts deserve extra scrutiny.

   The diagnostics strip uses plain spans. If any fact has very long unbroken text, `max-content` may create wider tracks than desired. If that appears in real data, the follow-up fix should add `minWidth: 0`, `overflow: "hidden"`, `textOverflow: "ellipsis"`, and `whiteSpace: "nowrap"` to those fact spans or wrap them in a small metric component.

## Suggested Claude Review Checklist

1. Inspect the commit:

   ```bash
   git show --stat e69405274396bbc3cb359e124f755f8941b199bc
   git show e69405274396bbc3cb359e124f755f8941b199bc -- artifacts/pyrus/src/features/flow/ContractDetailInline.jsx artifacts/pyrus/src/screens/DiagnosticsScreen.jsx artifacts/pyrus/src/screens/account/CashFundingPanel.jsx artifacts/pyrus/src/screens/settings/IbkrLaneArchitecturePanel.jsx artifacts/pyrus/src/screens/compactFitment.test.mjs
   ```

2. Re-run the focused guard:

   ```bash
   pnpm --filter @workspace/pyrus exec tsx --test src/screens/compactFitment.test.mjs
   ```

3. Re-run typecheck:

   ```bash
   pnpm --filter @workspace/pyrus run typecheck
   ```

4. If live/seeded data is available, inspect the changed containers at desktop and mobile widths.

   Use the app URL with safe mode unless the user explicitly approves live full-app navigation:

   ```text
   http://127.0.0.1:18747/?pyrusQa=safe
   ```

5. For each changed strip, check:

   - No clipped text.
   - No horizontal page overflow.
   - Metric cells pack left instead of stretching across the row.
   - Metrics wrap cleanly to a second row on narrow widths.
   - Touch/click targets, if any, remain large enough.

## Files Not To Attribute To This Commit

The worktree had many unrelated dirty files before and after this commit. Do not attribute unrelated changes to this compact-fitment work unless they appear in:

```text
git show --name-only e69405274396bbc3cb359e124f755f8941b199bc
```

Expected file list:

```text
artifacts/pyrus/src/features/flow/ContractDetailInline.jsx
artifacts/pyrus/src/screens/DiagnosticsScreen.jsx
artifacts/pyrus/src/screens/account/CashFundingPanel.jsx
artifacts/pyrus/src/screens/compactFitment.test.mjs
artifacts/pyrus/src/screens/settings/IbkrLaneArchitecturePanel.jsx
```
