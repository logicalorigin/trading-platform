# App Backend Surface Ownership Review - 2026-05-06

This review tracks competing backend and client ownership paths across the app.
The cleanup target is not hidden UI activity by itself; it is duplicate routes,
services, generated clients, stores, hooks, or screen adapters that claim the
same product concept and can surface different truth.

## Ownership Rules

- Every surfaced business concept should have one canonical backend owner and
  one canonical frontend client path.
- Raw `fetch` calls are acceptable for settings/diagnostic endpoints that do
  not have generated clients. When OpenAPI/generated hooks exist, UI code should
  use them instead of rebuilding the same request by hand.
- Shared stores are cache and fan-out layers, not alternate sources of truth.
- Hidden runtime checks are secondary; they matter only when they reveal two
  competing owners for the same backend resource.
- Protected WIP in `REPO_CLEANUP_INVENTORY.md` remains out of cleanup scope.

## Backend Ownership Matrix

| Domain | Canonical owner | Frontend owner | Collision status |
| --- | --- | --- | --- |
| Stock/option bars | `platform.getBars*` via `/bars` | `chartApiBars`, `TradeEquityPanel`, `useOptionChartBars` | Shared chart infrastructure is intentional. Do not add Polygon fallback paths in UI. |
| Stock quote snapshots | `/quote-snapshots` + broker quote stream | `MarketDataSubscriptionProvider`, trade quote streams | Shared quote cache is fan-out, not a competing owner. |
| Market mini charts | Broker-first bars/aggregate stream | `MiniChartCell` -> `TradeEquityPanel` | Mini charts delegate to Trade spot chart path. |
| Flow events | `/flow/events` and broad scanner runtime | `BroadFlowScannerRuntime`, Flow/Header/Market consumers | Broad scanner is the single broad flow owner; shared all-flow runtime stays disabled. |
| Flow premium distribution | Polygon premium-distribution endpoint | `FlowScreen` widgets | Separate WIP-backed summary surface; do not mix with broad scanner event feed. |
| Trade option chains | `/option-chain`, batch chain service, chain store | `TradeScreen` publishes, trade panels read store | Store is the frontend fan-out layer; avoid a second UI-owned chain hydrator. |
| Trade option quotes | IBKR option quote stream/cache | `TradeScreen` quote subscription plan | Visible/execution quote streams share one backend admission path. |
| Signal monitor | `/signal-monitor/*` generated API | `PlatformApp`, `SettingsScreen` | Settings now uses generated hooks/mutations instead of raw duplicate fetches. |
| Signal-options automation | `/algo/deployments/:id/signal-options/*` generated API | `AlgoScreen` | Algo now uses generated hooks/mutations for state, scan, and profile update. |
| Algo cockpit/events | Algo deployment services | `AlgoScreen` generated hooks | Cockpit remains display aggregate; signal-options state remains automation state. |
| Real account | Account services + IBKR account/order streams | `AccountScreen`, platform account/order streams | Previous cleanup keeps stream-backed polling policy canonical. |
| Shadow account | `shadow-account` service | `AccountScreen` shadow mode | Shadow stays page-owned with slower fallback polling. |
| Backtesting | Backtesting services/routes | `BacktestingPanels` generated hooks | Backtest chart surface uses shared chart frame; no alternate broker chart owner. |
| Settings/diagnostics | Settings and diagnostics services | Settings/Diagnostics raw clients where no generated API exists | Keep raw clients only for endpoints outside generated API. |

## Fix Landed In This Pass

- Replaced Settings signal-monitor raw `fetch("/api/signal-monitor/*")` calls
  with the generated query/mutation hooks and shared query keys.
- Replaced Algo signal-options raw state/scan/profile calls with generated
  query/mutation hooks and generated cache keys.
- Confirmed broad Flow scanning is backend-owned always-on work:
  `startOptionsFlowScanner()` starts at API server boot and the frontend broad
  Flow runtime is only the app-level snapshot reader/fan-out layer.
- Added visible-screen ownership gates for hidden-mounted Trade child broker
  queries/streams, Algo list queries, Backtest list/detail queries, and the
  Research live quote refresh effect.
- Added source-level ownership tests so these backend client paths do not fork
  again.

## Deferred Review Targets

- Finish protected Polygon premium-distribution WIP before deciding whether any
  generated flow-premium surfaces should be promoted or removed.
- Review trade option-chain ownership separately after the current option/order
  intent WIP is ready, because chain, quote, and order intent changes overlap.
- Review remaining raw `fetch` settings/diagnostics clients only where generated
  API clients already exist or a product surface is duplicated.
