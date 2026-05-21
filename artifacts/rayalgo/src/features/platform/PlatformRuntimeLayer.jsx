export const PlatformRuntimeLayer = ({
  MarketDataSubscriptionProviderComponent,
  SharedMarketFlowRuntimeComponent,
  BroadFlowScannerRuntimeComponent,
  watchlistSymbols,
  broadFlowWatchlistSymbols = watchlistSymbols,
  activeWatchlistItems,
  quoteSymbols,
  sparklineSymbols,
  prioritySparklineSymbols = [],
  streamedQuoteSymbols,
  streamedAggregateSymbols,
  quoteStreamRuntimeEnabled,
  marketStockAggregateStreamingEnabled,
  marketScreenActive,
  lowPriorityHistoryEnabled,
  flowRuntimeEnabled,
  flowRuntimeIntervalMs,
  broadFlowRuntimeEnabled,
  broadFlowStartupDelayMs,
  children,
}) => (
  <MarketDataSubscriptionProviderComponent
    watchlistSymbols={watchlistSymbols}
    activeWatchlistItems={activeWatchlistItems}
    quoteSymbols={quoteSymbols}
    sparklineSymbols={sparklineSymbols}
    prioritySparklineSymbols={prioritySparklineSymbols}
    streamedQuoteSymbols={streamedQuoteSymbols}
    streamedAggregateSymbols={streamedAggregateSymbols}
    quoteStreamRuntimeEnabled={quoteStreamRuntimeEnabled}
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
      enabled={broadFlowRuntimeEnabled}
      startupDelayMs={broadFlowStartupDelayMs}
    />
    {children}
  </MarketDataSubscriptionProviderComponent>
);
