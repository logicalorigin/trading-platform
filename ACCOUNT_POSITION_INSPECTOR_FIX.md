# Fix: Account Position Inspector Not Populating on Hover

## Context

On the Account page, the **Positions Inspector** (`PositionsAtDateInspector`,
`artifacts/pyrus/src/screens/account/PositionsPanel.jsx:2265`) is meant to fill with a date's
positions + balance when you hover or pin the equity curve. It **never populates on hover** in
normal use.

**Root cause (verified):** the inspector's `positions-at-date` query
(`AccountScreen.jsx:1094–1111`) is gated by:

```js
enabled: Boolean(secondaryAccountQueriesEnabled && activeEquityInspectionDate)
```

and `secondaryAccountQueriesEnabled = derivedAccountQueriesEnabled` (line 941), which is:

```js
accountQueriesEnabled &&
  (!accountPageStreamEnabled ||
   (accountDerivedFallbackReady && !accountPageStreamFreshness.accountDerivedFresh))
```

So whenever the realtime account stream is **enabled and fresh** — the normal healthy state —
`derivedAccountQueriesEnabled` is **false**, which **disables** the query. The hover wiring is fine
(`onHoverInspectionDate={setHoveredEquityDate}`, line 1629) — `activeEquityInspectionDate` does get
set — but the query is suppressed, so the inspector switches off its placeholder and shows an empty
"0 positions" body. That gate is correct for *derived panels that have a streaming equivalent* (REST
suppressed while the stream is fresh), but **`positions-at-date` is an on-demand historical fetch
keyed by the hovered/pinned date — it has no stream equivalent**, so it must fire whenever a date is
active (subject only to the base account-access gate).

**Secondary cleanup (decided):** the inspector's **Bid/Ask**, **Last**, and **Greeks** columns read
`row.optionQuote.*` (PositionsPanel.jsx:2423–2438), a field only present on rows enriched by the
live pipeline (`applyLiveOptionQuoteToRow`, 399–448). The inspector's `positions-at-date` rows are
never enriched and the backend supplies no quote for them, so those columns are always blank →
**drop them** rather than wire quotes for historical snapshots.

## Fix

### 1. Re-gate the query (primary fix) — `AccountScreen.jsx` ~1101–1109
Change the inspector query's `enabled` from `secondaryAccountQueriesEnabled` to the base
`accountQueriesEnabled` (defined line 562 = visible + accountRequestId + broker/shadow/accounts):

```js
enabled: Boolean(accountQueriesEnabled && activeEquityInspectionDate),
```

Leave `retry:false`, `staleTime`, and `placeholderData` as-is. This lets the inspector fetch
whenever a date is hovered/pinned, regardless of stream freshness. (`accountQueriesEnabled` is the
right base gate because the by-date fetch has no streaming source to defer to.)

### 2. Drop Bid/Ask, Last, Greeks columns — `PositionsPanel.jsx`
- `historicalPositionHeaders` (line 2254): remove `"Bid / Ask"` and `"Greeks"` → leaves
  `Position · Qty / Avg · Price · Day · Unreal · Exposure` (6).
- In the row map (~2412–2540): delete the **Bid/Ask** `<td>` (2501–2507) and the **Greeks** `<td>`
  (2531–2537); in the **Price** `<td>`, drop the quote-derived `Last` secondary (keep `mark` from
  `row.mark`). Remove the now-dead locals: `display`/`quote`/`bidAsk`/`quoteHasBidAsk`/`quoteDetail`/
  `lastValue`/`greeksPrimary`/`greeksSecondary`; simplify `markValue` to `row.mark`.
- Reduce the table `minWidth` (line 2401, currently `940`) to fit 6 columns.
- Prune imports/helpers that become unused **only in this file** (e.g. `formatGreek`, `formatIv`,
  `formatPositionBidAskPair`, `hasPositionBidAsk`, spread/freshness formatters) — most are shared
  with the main table, so keep any still referenced elsewhere.

## Files to modify

- `artifacts/pyrus/src/screens/AccountScreen.jsx` — inspector query `enabled` gate (~1105).
- `artifacts/pyrus/src/screens/account/PositionsPanel.jsx` — `historicalPositionHeaders` (2254) +
  `PositionsAtDateInspector` row rendering (drop columns + dead quote/greeks code, adjust minWidth).

No backend or schema changes. (Backend `getAccountPositionsAtDate` already returns
`positions/activity/totals.balance/status` correctly — only the live-quote/greeks fields were never
part of historical rows, which is why we drop those columns.)

## Verification

1. `pnpm --filter @workspace/pyrus typecheck`.
2. `pnpm --filter @workspace/pyrus run test` — add/adjust a test asserting the `positions-at-date`
   query is enabled when `activeEquityInspectionDate` is set **regardless of stream freshness** (not
   gated by `secondaryAccountQueriesEnabled`); update any `PositionsPanel` test that asserts the
   inspector column set to the new 6-column header list.
3. **Manual (key check):** open the Account page with a healthy/fresh account stream (the state that
   currently breaks it). Hover the equity curve → the inspector now populates that date's balance
   boxes, position rows, and activity; pin a date → stays pinned; Clear Pin → reverts to the
   placeholder. Confirm the Bid/Ask, Last, and Greeks columns are gone and no blank quote cells
   remain. Also verify the broken-stream path (stream disabled / stale) still works.
4. If any Replit startup file is touched (it won't be), run `pnpm run audit:replit-startup`.

## Note (out of scope)

The `row.optionQuote`-vs-`row.quote` inconsistency at `PositionsPanel.jsx:1180` (vs the tolerant
fallback at line 292) is a real latent issue for any non-enriched consumer, but it is not the cause
of this symptom, and the column-drop removes the inspector's dependence on it. Flagging for a
separate cleanup if desired.
