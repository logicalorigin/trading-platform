export const PlatformRuntimeLayer = ({
  MarketDataSubscriptionProviderComponent,
  SharedMarketFlowRuntimeComponent,
  BroadFlowScannerRuntimeComponent,
  watchlistSymbols,
  broadFlowWatchlistSymbols = watchlistSymbols,
  broadFlowActiveSymbols = watchlistSymbols,
  activeWatchlistItems,
  quoteSymbols,
  sparklineSymbols,
  streamedQuoteSymbols,
  streamedAggregateSymbols,
  marketStockAggregateStreamingEnabled,
  marketScreenActive,
  lowPriorityHistoryEnabled,
  flowRuntimeEnabled,
  flowRuntimeIntervalMs,
  broadFlowRuntimeEnabled,
  children,
}) => (
  <MarketDataSubscriptionProviderComponent
    watchlistSymbols={watchlistSymbols}
    activeWatchlistItems={activeWatchlistItems}
    quoteSymbols={quoteSymbols}
    sparklineSymbols={sparklineSymbols}
    streamedQuoteSymbols={streamedQuoteSymbols}
    streamedAggregateSymbols={streamedAggregateSymbols}
    marketStockAggregateStreamingEnabled={marketStockAggregateStreamingEnabled}
    marketScreenActive={marketScreenActive}
    lowPriorityHistoryEnabled={lowPriorityHistoryEnabled}
  >
    <SharedMarketFlowRuntimeComponent
      symbols={watchlistSymbols}
      enabled={flowRuntimeEnabled}
      intervalMs={flowRuntimeIntervalMs}
    />
    <BroadFlowScannerRuntimeComponent
      symbols={broadFlowWatchlistSymbols}
      activeSymbols={broadFlowActiveSymbols}
      enabled={broadFlowRuntimeEnabled}
    />
    {children}
  </MarketDataSubscriptionProviderComponent>
);
