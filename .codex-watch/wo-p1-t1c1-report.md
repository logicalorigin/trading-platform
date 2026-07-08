# WO-P1-T1c1 Report

## Result

Implemented a per-request Schwab Trader API timeout with abort signaling and a distinct timeout code:

- Default timeout: 15,000 ms.
- Overrides: `SchwabTraderApiClientOptions.requestTimeoutMs`, internal `RequestOptions.timeoutMs`, and Schwab order service `requestTimeoutMs`.
- Timeout code: `schwab_trader_api_timeout_reconcile_required`.

Live Schwab order submit now treats a timed-out `placeOrder` as unknown/reconcile-needed, not submitted and not retryable:

- Service raises `409` with `code: "schwab_order_submit_reconcile_required"`.
- Problem `data` includes `status: "reconcile_required"`, `outcome: "unknown"`, `reconcileRequired: true`, and `retryable: false`.
- The broker-execution submit route passes that reconcile problem through instead of parsing it as a normal submit success.

## Files Touched

- `artifacts/api-server/src/providers/schwab/trader-api-client.ts`
- `artifacts/api-server/src/services/schwab-equity-orders.ts`
- `artifacts/api-server/src/routes/broker-execution.ts`
- `.codex-watch/wo-p1-t1c1-report.md`

## Verification

Persistent new test file was not added because the hard constraint limited edits to files named in the work order, and no test file was named. I ran the requested behavior as lightweight inline node/tsx unit checks instead.

### Existing Schwab Trader Client Unit

Command:

```sh
pnpm --filter @workspace/api-server exec node --import tsx --test src/providers/schwab/trader-api-client.test.ts
```

Output:

```text
✔ extractOrderIdFromLocation pulls the trailing id, ignoring query/trailing slash (0.962686ms)
✔ GET reads send the bearer token and no body (321.671686ms)
✔ placeOrder POSTs the JSON order and returns the id from the Location header (2.879358ms)
✔ placeOrder returns orderId null when no Location header is present (0.437082ms)
✔ replaceOrder PUTs to the order id and prefers the new Location id (0.562037ms)
✔ replaceOrder falls back to the original id when no Location returned (2.352044ms)
✔ cancelOrder DELETEs the order path (7.987127ms)
✔ previewOrder POSTs to /previewOrder and returns the parsed body (0.981833ms)
✔ getOrders serializes query params and requires an array (0.862533ms)
✔ getAccountWithPositions requests fields=positions (1.33401ms)
✔ getTransactions serializes date/type query params (0.463878ms)
✔ account hash and order id are URL-encoded in paths (0.83063ms)
✔ non-2xx responses throw an HttpError with the status (1.637181ms)
ℹ tests 13
ℹ suites 0
ℹ pass 13
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 809.496465
```

### Inline Hung Fetch Client Check

Command:

```sh
pnpm --filter @workspace/api-server exec node --import tsx -e '<inline SchwabTraderApiClient hung fetch assertion>'
```

Output:

```text
hung fetch aborted in 41ms; calls=1; status=unknown
```

Observed assertions:

- Hanging `fetchImpl` received an `AbortSignal`.
- Signal was aborted within the configured 25 ms timeout.
- `placeOrder` returned `status: "unknown"`.
- `reconcileRequired` was `true`.
- No second submit call occurred (`calls=1`).

### Inline Submit Caller Reconcile Check

Command:

```sh
pnpm --filter @workspace/api-server exec node --import tsx -e '<inline submitSchwabEquityOrder DB-backed timeout assertion>'
```

Output:

```text
submit caller marked reconcile; calls=1; aborted=true
```

Observed assertions:

- DB-backed live submit path reached the Schwab order submit call.
- Hanging order submit fetch was aborted by the configured 25 ms timeout.
- `submitSchwabEquityOrder` rejected with `409`.
- Error code was `schwab_order_submit_reconcile_required`.
- Error data had `status: "reconcile_required"`, `reconcileRequired: true`, and `retryable: false`.
- No retry-stacking occurred (`calls=1`).

### Existing Schwab Equity Orders Unit

Command:

```sh
pnpm --filter @workspace/api-server exec node --import tsx --test src/services/schwab-equity-orders.test.ts
```

Output:

```text
✔ normalizeSchwabSymbol upper-cases, trims, and rejects invalid symbols (1.416323ms)
✔ formatPrice renders a Schwab-friendly string, trimming trailing zeros (0.351644ms)
✔ validate accepts a market buy and defaults session to Normal (0.988218ms)
✔ validate requires limit/stop prices for the relevant order types (0.717214ms)
✔ validate rejects bad symbol, action, and quantity (0.428406ms)
✔ buildSchwabOrderRequest matches the Schwab doc market-BUY example (0.582062ms)
✔ buildSchwabOrderRequest matches the Schwab doc limit-SELL example (price as string) (0.429386ms)
✔ buildSchwabOrderRequest emits both price and stopPrice for a stop-limit (0.215701ms)
✔ executionReady requires the capability, no blockers, and an open/undefined status (3.41202ms)
✔ assertExecutionReady throws 409 with the blockers while Schwab is blocked (0.643933ms)
✔ assertExecutionReady passes through when the account is execution-ready (0.38697ms)
✔ submitSchwabEquityOrder requires tax preflight before provider calls (22555.801597ms)
ℹ tests 12
ℹ suites 0
ℹ pass 12
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 33787.710036
```

## Not Run

- No browser, Playwright, e2e, project-wide typecheck, or full-suite tests, per hard constraint.
- No git commands were run.
