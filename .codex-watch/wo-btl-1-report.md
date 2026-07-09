# WO-BTL-1 Backtest Ledger Separation Report

## Verdict

Observed: the existing backtest family can host watchlist backtests and signal-options replays with additive DDL. `backtest_run_trades` is a closed-trade table with non-null exit fields (`exit_at`, `exit_price`, `exit_value`, `gross_pnl`, `net_pnl`, `net_pnl_percent`, `bars_held`, `exit_reason`), so raw fills, entry-only rows, mark rows, and skipped-event rows cannot share that shape. The minimal structural delta is one new table, `backtest_run_executions`, plus run/point columns.

Observed: no migration was applied.

## Evidence Read

- Design decision and scope: `docs/plans/backtest-ledger-separation-2026-07-09.md:28-42`, `:44-52`, `:56-59`.
- Existing backtest family: `lib/db/src/schema/backtesting.ts:87-145`, `:265-349`, `:351-420`.
- Shadow ledger table shapes: `lib/db/src/schema/trading.ts:207-436`; `execution_events`: `lib/db/src/schema/automation.ts:77-91`.
- Watchlist fill shape and simulation output: `artifacts/api-server/src/services/shadow-account.ts:463-482`, `:13623-13717`, `:13740-13780`, `:14083-14103`, `:14321-14327`.
- Watchlist reset/write/run path: `artifacts/api-server/src/services/shadow-account.ts:14490-14636`, `:14847-14953`, `:15732-16069`.
- Shared shadow order/fill/position writers used by replay: `artifacts/api-server/src/services/shadow-account.ts:4626-4750`, `:6077-6182`, `:16120-16302`.
- Signal-options replay reset/write path: `artifacts/api-server/src/services/shadow-account.ts:14726-14845`; `artifacts/api-server/src/services/signal-options-automation.ts:2486-2535`, `:17475-17633`, `:18738-20380`, `:19870-19915`, `:20412-20442`.
- Payload consumers checked: `artifacts/api-server/src/services/signal-options-automation.ts:6595-6731`, `:7127-7465`, `:7937-7955`, `:9136-9225`, `:17150-17159`, `:17427-17445`; `artifacts/api-server/src/services/shadow-account.ts:4770-4898`, `:5048-5095`, `:10586-10650`.

## Field Mapping

### Run-Level Fields

| Produced field | Destination | Evidence |
| --- | --- | --- |
| Watchlist run id / replay run id | `backtest_runs.id` for new runs; `backtest_runs.source_run_key` for legacy/external string run keys | shadow-account.ts:15751-15753; signal-options-automation.ts:19874-19891 |
| Run kind/source | `backtest_runs.kind` (`study`, `watchlist_backtest`, `signal_options_replay`) | design doc:35-36; schema:91-94 |
| Shadow account id (`shadow`) | `backtest_runs.source_account_id`; per-row copy in `backtest_run_executions.account_id` | shadow-account.ts:14898-14923; schema:118-120, 272 |
| Market date/range (`marketDate`, `marketDateFrom`, `marketDateTo`, `rangeKey`) | `backtest_runs.market_date`, `market_date_from`, `market_date_to`, `range_key`; per-event `market_date`, `position_market_date` where needed | shadow-account.ts:14879-14882, 15381-15385; signal-options-automation.ts:17531-17538 |
| Window start/end | `backtest_runs.window_starts_at`, `window_ends_at` | shadow-account.ts:15776-15781, 15391-15395; signal-options-automation.ts:20414-20420 |
| Watchlist timeframe / signal-options timeframe | existing `backtest_runs.parameters`; per-execution `timeframe` when event/fill-specific | shadow-account.ts:15385; signal-options-automation.ts:18813, 20347-20369 |
| Overlays/config used (`riskOverlay`, `sizingOverlay`, `selectionOverlay`, `entryGateOverlay`, `regimeOverlay`, deployment/profile patch) | existing `backtest_runs.parameters`, `portfolio_rules`, `execution_profile`, plus `config_used_ref` for the config reference | shadow-account.ts:14882-14886, 15386-15412; signal-options-automation.ts:19872-19934 |
| Metrics/summary/errors/open positions | existing `backtest_runs.metrics`, `warnings`, `error_message`, `status`, `started_at`, `finished_at` | shadow-account.ts:15265-15324, 15422-15429; signal-options-automation.ts:19962-19980, 20421-20442 |
| Full/compact retention state | `backtest_runs.fidelity`, `compacted_at` | design doc:46-50; schema:126-131 |

### Watchlist Backtest: `shadow_orders`

| Produced field | Destination | Evidence |
| --- | --- | --- |
| `id` | `backtest_run_executions.source_order_id` (execution row has its own `id`) | shadow-account.ts:14867-14919 |
| `accountId` | `backtest_run_executions.account_id`; run-level `source_account_id` | shadow-account.ts:14898-14901 |
| `source` | `backtest_runs.kind`; `backtest_run_executions.source` | shadow-account.ts:14900-14902 |
| `sourceEventId` | `backtest_run_executions.source_event_id` | shadow-account.ts:14900-14903 |
| `clientOrderId` | `backtest_run_executions.client_order_id` | shadow-account.ts:14903 |
| `symbol` | `backtest_run_executions.symbol` | shadow-account.ts:14904 |
| `assetClass` | `backtest_run_executions.asset_class` | shadow-account.ts:14905 |
| `positionType` | `backtest_run_executions.position_type` | shadow-account.ts:14870-14873, 14906 |
| `side` | `backtest_run_executions.side` | shadow-account.ts:14907 |
| `type` | `backtest_run_executions.order_type` | shadow-account.ts:14908 |
| `timeInForce` | `backtest_run_executions.time_in_force` | shadow-account.ts:14909 |
| `status` | `backtest_run_executions.status` | shadow-account.ts:14910 |
| `quantity` | `backtest_run_executions.quantity` | shadow-account.ts:14911 |
| `filledQuantity` | `backtest_run_executions.filled_quantity` | shadow-account.ts:14912 |
| `averageFillPrice` | `backtest_run_executions.average_fill_price`; also `price` for fill price | shadow-account.ts:14913 |
| `fees` | `backtest_run_executions.fees` | shadow-account.ts:14914 |
| `optionContract` | option scalar columns; null for watchlist equity fills | shadow-account.ts:14915 |
| `payload.metadata.source` | `backtest_run_executions.source` | shadow-account.ts:14874-14879 |
| `payload.metadata.runId` | `backtest_runs.source_run_key` or run id | shadow-account.ts:14876-14878 |
| `payload.metadata.rangeKey` | `backtest_runs.range_key` | shadow-account.ts:14878 |
| `payload.metadata.marketDate/from/to` | run date fields and execution `market_date` | shadow-account.ts:14879-14881 |
| `payload.metadata.riskOverlay/sizingOverlay/selectionOverlay/entryGateOverlay` | existing run config JSON fields plus `config_used_ref` | shadow-account.ts:14882-14886 |
| `payload.metadata.positionKey` | `backtest_run_executions.position_key` | shadow-account.ts:14887 |
| `payload.metadata.signalAt/signalPrice/signalClose/signalScore` | `signal_at`, `signal_price`, `signal_close`, `signal_score` | shadow-account.ts:14888-14892 |
| `payload.metadata.signalScoreDetails` | named `signal_score_details` column | shadow-account.ts:14891-14892, 15337-15341 |
| `payload.metadata.fillSource` | `backtest_run_executions.fill_source` | shadow-account.ts:14893 |
| `payload.metadata.watchlists` | named `watchlists` column | shadow-account.ts:14894, 15339-15342 |
| `payload.metadata.regime` | named `regime` column | shadow-account.ts:14895, 15340-15343 |
| `placedAt`, `filledAt` | `placed_at`, `filled_at`, `occurred_at` | shadow-account.ts:14917-14918 |
| `createdAt`, `updatedAt` defaults | execution table timestamps | trading.ts:238-242; backtesting.ts:343-346 |

### Watchlist Backtest: `shadow_fills`

| Produced field | Destination | Evidence |
| --- | --- | --- |
| `id` | `backtest_run_executions.source_fill_id` | shadow-account.ts:14867-14868, 14920-14937 |
| `accountId` | `backtest_run_executions.account_id` | shadow-account.ts:14920-14923 |
| `orderId` | `backtest_run_executions.source_order_id` | shadow-account.ts:14921-14924 |
| `sourceEventId` | `backtest_run_executions.source_event_id` | shadow-account.ts:14923-14925 |
| `symbol`, `assetClass`, `positionType`, `side` | execution `symbol`, `asset_class`, `position_type`, `side` | shadow-account.ts:14925-14928 |
| `quantity`, `price`, `grossAmount`, `fees`, `realizedPnl`, `cashDelta` | execution numeric columns of same meaning | shadow-account.ts:14929-14934 |
| `optionContract` | option scalar columns; null for equity | shadow-account.ts:14935 |
| `occurredAt` | `backtest_run_executions.occurred_at` | shadow-account.ts:14936 |
| `createdAt`, `updatedAt` defaults | execution table timestamps | trading.ts:295-298; backtesting.ts:343-346 |

### Watchlist Backtest: Positions, Marks, Points

| Produced field | Destination | Evidence |
| --- | --- | --- |
| `shadow_positions.id` | `backtest_run_executions.source_position_id` when migrated from legacy rows | shadow-account.ts:6143-6160 |
| `positionKey`, `symbol`, `assetClass`, `positionType` | execution `position_key`, `symbol`, `asset_class`, `position_type` | shadow-account.ts:6077-6112, 6143-6148 |
| `quantity` (post-fill position quantity) | `backtest_run_executions.position_quantity` | shadow-account.ts:6114-6139, 6165-6180 |
| `averageCost`, `mark`, `marketValue`, `unrealizedPnl`, `realizedPnl`, `fees` | execution position/numeric columns | shadow-account.ts:6122-6139, 6149-6159, 6165-6180 |
| `optionContract` | option scalar columns | shadow-account.ts:6156 |
| `openedAt`, `closedAt`, `asOf`, `status` | execution `position_opened_at`, `position_closed_at`, `position_as_of`, `position_status` | shadow-account.ts:6134-6139, 6157-6159, 6177-6180 |
| `shadow_position_marks.id` | `backtest_run_executions.source_position_mark_id` for mark rows | shadow-account.ts:16288-16296 |
| mark row `mark`, `marketValue`, `unrealizedPnl`, `source`, `asOf` | execution `mark`, `market_value`, `unrealized_pnl`, `source`, `position_as_of` | shadow-account.ts:16288-16296 |
| Watchlist simulation snapshot `asOf`, `cash`, `netLiquidation`, `realizedPnl`, `unrealizedPnl`, `fees` | `backtest_run_points.occurred_at`, `cash`, `equity`, `realized_pnl`, `unrealized_pnl`, `fees`; `gross_exposure` can carry computed exposure | shadow-account.ts:13640-13717 |
| Shadow balance snapshot `currency`, `cash`, `buyingPower`, `netLiquidation`, `realizedPnl`, `unrealizedPnl`, `fees`, `source`, `asOf` | `backtest_run_points.currency`, `cash`, `buying_power`, `equity`, `realized_pnl`, `unrealized_pnl`, `fees`, `source`, `occurred_at` | shadow-account.ts:3903-3924 |

### Signal-Options Replay: `execution_events`

| Produced field | Destination | Evidence |
| --- | --- | --- |
| `id` | `backtest_run_executions.source_event_id` | signal-options-automation.ts:2512-2524 |
| `deploymentId` | `backtest_run_executions.deployment_id` | signal-options-automation.ts:2515 |
| `providerAccountId` | `backtest_run_executions.provider_account_id` | signal-options-automation.ts:2516 |
| `symbol` | `backtest_run_executions.symbol` | signal-options-automation.ts:2517 |
| `eventType` | `backtest_run_executions.event_type` | signal-options-automation.ts:2518 |
| `summary` | `backtest_run_executions.summary` | signal-options-automation.ts:2519 |
| `occurredAt` | `backtest_run_executions.occurred_at` | signal-options-automation.ts:2521 |
| `payload.metadata.sourceType/runId/marketDate/positionMarketDate/deploymentId/deploymentName/positionKey` | source/run/date/deployment/position columns; `deploymentName` can live in run metrics/config, not per-event payload | signal-options-automation.ts:17525-17558 |
| `payload.backfillEventKey` | `backtest_run_executions.signal_key` if reused as event identity, otherwise run migration-local identity | signal-options-automation.ts:17542, 17427-17435 |
| `payload.reason` / `skipReason` | `backtest_run_executions.reason` | signal-options-automation.ts:18767-18777, 9141-9173 |
| `payload.signalKey` | `backtest_run_executions.signal_key` | signal-options-automation.ts:18767-18776, 18991-19013, 20347-20374 |
| `payload.candidate.id` / `payload.position.candidateId` | `backtest_run_executions.candidate_id` | signal-options-automation.ts:6595-6632, 17438-17445 |
| `payload.candidate.direction` / position direction | `backtest_run_executions.direction`; order mirror `side` | signal-options-automation.ts:6636-6649, 7137-7185 |
| `payload.candidate.timeframe` / position timeframe | `backtest_run_executions.timeframe` | signal-options-automation.ts:6672-6674, 7183-7185 |
| `payload.selectedContract` / position selected contract | option scalar columns | signal-options-automation.ts:6651-6657, 7130-7136 |
| Entry `orderPlan.quantity`, `simulatedFillPrice`, `premiumAtRisk` | `quantity`, `average_fill_price`/`price`, and metrics/position numeric fields | signal-options-automation.ts:18801-18824, 20347-20374 |
| Exit `exitPrice`, `exitMarkPrice`, `pnl` | execution `price`/`mark`/`realized_pnl` | signal-options-automation.ts:18938-19013, 17150-17159 |
| Mark `position.lastMarkPrice`, `quote.mark`, stop context | execution `mark`, `price`, position fields, and `reason` when actionable | signal-options-automation.ts:19176-19216 |
| `createdAt`, `updatedAt` defaults | execution table timestamps | automation.ts:88-91; backtesting.ts:343-346 |
| `algoRunId` | Not produced by replay writer; no Phase-1 column | automation.ts:81-87; signal-options-automation.ts:2512-2522 |

### Signal-Options Replay: Shadow Mirror Rows

| Produced field | Destination | Evidence |
| --- | --- | --- |
| Mirrored order fields (`id`, `source`, `sourceEventId`, `clientOrderId`, symbol/order/price fields) | `backtest_run_executions` source/order/price columns | shadow-account.ts:4626-4750, 16143-16204 |
| Mirrored fill fields (`id`, `orderId`, fill price/quantity/PnL/cashDelta) | `source_fill_id`, `source_order_id`, execution numeric columns | shadow-account.ts:4714-4731 |
| Mirrored position fields | execution position columns | shadow-account.ts:4733-4745, 6077-6182 |
| Mark updates and `shadow_position_marks` rows | execution mark/position columns | shadow-account.ts:16224-16302 |
| Balance snapshots after entry/exit/mark | `backtest_run_points` source/currency/cash/equity/buying_power/PnL/fees columns | shadow-account.ts:4750, 3903-3924, 16297-16300 |

## Event Payload Consumer Findings

Observed consumers that read replay payload fields today:

- Replay reset matches `payload.replay`, `payload.metadata`, and event dates: `shadow-account.ts:14661-14693`, `:14726-14845`.
- Shadow mirror writers read `payload.position`, `payload.orderPlan`, `payload.selectedContract`, `payload.fillPrice`, `payload.exitPrice`, `payload.markPrice`, `payload.quote`: `shadow-account.ts:16120-16302`.
- Signal-options read model reconstructs candidates/positions from `payload.candidate`, `payload.position`, `payload.selectedContract`, `payload.signal`, `payload.action`, `payload.quote`, `payload.orderPlan`, `payload.liquidity`, `payload.stop`, `payload.reEntryWatch`: `signal-options-automation.ts:6595-6731`, `:7127-7465`.
- Seen-signal extraction reads `reason`, `skipReason`, `signalKey`, candidate symbol/direction, retry/preflight/premium/available/debug reasons: `signal-options-automation.ts:9136-9225`.
- Backfill/replay dedupe reads `backfillEventKey`: `signal-options-automation.ts:17427-17435`.
- Exit PnL reads `pnl` and fee aliases: `signal-options-automation.ts:17150-17159`.

DDL response: Phase 1 hosts the scalar identity, timing, price, PnL, option-contract, reason, and position-state fields as real columns. It does not add a generic event payload blob. Bounded watchlist fill metadata that current responses expose (`signalScoreDetails`, `watchlists`, `regime`) gets named columns, not a catch-all payload column. Large diagnostic objects (`signal`, `action`, `profile`, `quote`, `liquidity`, `stop`, `postExitOutcome`, raw trade snapshots) are deliberately not copied as payload blobs; if BTL-3 keeps a UI consumer that needs a specific member of those objects, the next DDL should add that member as a targeted scalar/named column.

## DDL Summary

- `backtest_runs`: added `kind`, source account/run key, date/range/window fields, `config_used_ref`, `fidelity`, `compacted_at`, and kind+created listing index.
- `backtest_run_points`: added `source`, `currency`, `buying_power`, `realized_pnl`, `unrealized_pnl`, `fees`.
- New `backtest_run_executions`: one raw per-run host for order/fill/event/mark rows with lean scalar fields plus named bounded metadata columns.
- Migration file: `lib/db/migrations/20260709_backtest_ledger_separation.sql`; additive/manual-apply; not applied.

## Validation

- `pnpm --filter @workspace/db exec tsc -p tsconfig.json --noEmit` (fallback because `lib/db/package.json` has no `typecheck` script): exit 0.
- `pnpm --filter @workspace/api-server run typecheck`: exit 0.
- `pnpm --filter @workspace/api-server exec tsx --test --test-force-exit src/services/shadow-account-recompute.test.ts`: exit 0; 5 pass, 0 fail.

## Commit

Commit SHA: self-referential; record the final SHA from `git rev-parse HEAD` after the commit containing this report.
