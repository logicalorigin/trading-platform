import {
  MemoAccountScreen,
  MemoAlgoScreen,
  MemoBacktestScreen,
  MemoDiagnosticsScreen,
  MemoFlowScreen,
  MemoGexScreen,
  MemoMarketScreen,
  MemoResearchScreen,
  MemoSettingsScreen,
  MemoTradeScreen,
} from "./screenRegistry.jsx";

export const PlatformScreenRouter = ({
  screenId,
  screen,
  sym,
  tradeSymPing,
  marketSymPing,
  session,
  environment,
  accounts,
  primaryAccountId,
  brokerConfigured,
  brokerAuthenticated,
  gatewayTradingReady,
  gatewayTradingMessage,
  watchlistSymbols,
  runtimeWatchlistSymbols,
  signalMonitorSymbols,
  signalMatrixStates,
  marketScreenActive,
  flowScreenActive,
  researchConfigured,
  stockAggregateStreamingEnabled,
  watchlists,
  defaultWatchlist,
  theme,
  sidebarCollapsed,
  onSelectSymbol,
  onFocusMarketChart,
  onSignalAction,
  onScanNow,
  onToggleMonitor,
  onChangeMonitorTimeframe,
  onChangeMonitorWatchlist,
  onJumpToTradeFromFlow,
  onSelectTradingAccount,
  onJumpToTradeFromAccount,
  onJumpToTradeFromResearch,
  onJumpToTradeFromSignalOptionsCandidate,
  onToggleTheme,
  onToggleSidebar,
  onScreenReadiness,
}) => {
  const buildReadinessHandler = (screenId) => (readiness) =>
    onScreenReadiness?.(screenId, readiness);

  const renderMarketScreen = () => (
    <MemoMarketScreen
      sym={sym}
      marketSymPing={marketSymPing}
      onSymClick={onSelectSymbol}
      onChartFocus={onFocusMarketChart}
      symbols={watchlistSymbols}
      signalSuggestionSymbols={signalMonitorSymbols}
      isVisible={marketScreenActive}
      researchConfigured={researchConfigured}
      stockAggregateStreamingEnabled={
        stockAggregateStreamingEnabled && marketScreenActive
      }
      onSignalAction={onSignalAction}
      onScanNow={onScanNow}
      onToggleMonitor={onToggleMonitor}
      onChangeMonitorTimeframe={onChangeMonitorTimeframe}
      onChangeMonitorWatchlist={onChangeMonitorWatchlist}
      watchlists={watchlists}
      onReadinessChange={buildReadinessHandler("market")}
    />
  );

  switch (screenId) {
    case "market":
      return renderMarketScreen();
    case "flow":
    case "unusual":
      return (
        <MemoFlowScreen
          session={session}
          symbols={runtimeWatchlistSymbols}
          isVisible={flowScreenActive}
          onJumpToTrade={onJumpToTradeFromFlow}
          onReadinessChange={buildReadinessHandler("flow")}
        />
      );
    case "gex":
      return (
        <MemoGexScreen
          sym={sym}
          isVisible={screen === "gex"}
          onSelectSymbol={onSelectSymbol}
          onReadinessChange={buildReadinessHandler("gex")}
        />
      );
    case "trade":
      return (
        <MemoTradeScreen
          sym={sym}
          symPing={tradeSymPing}
          session={session}
          environment={environment}
          accountId={primaryAccountId}
          brokerConfigured={brokerConfigured}
          brokerAuthenticated={brokerAuthenticated}
          gatewayTradingReady={gatewayTradingReady}
          gatewayTradingMessage={gatewayTradingMessage}
          isVisible={screen === "trade"}
          isRetained={screen !== "trade"}
          onReadinessChange={buildReadinessHandler("trade")}
        />
      );
    case "account":
      return (
        <MemoAccountScreen
          session={session}
          accounts={accounts}
          selectedAccountId={primaryAccountId}
          onSelectTradingAccount={onSelectTradingAccount}
          environment={environment}
          brokerConfigured={brokerConfigured}
          brokerAuthenticated={brokerAuthenticated}
          gatewayTradingReady={gatewayTradingReady}
          gatewayTradingMessage={gatewayTradingMessage}
          isVisible={screen === "account"}
          onJumpToTrade={onJumpToTradeFromAccount}
          onReadinessChange={buildReadinessHandler("account")}
        />
      );
    case "research":
      return (
        <MemoResearchScreen
          isVisible={screen === "research"}
          onJumpToTrade={onJumpToTradeFromResearch}
          onReadinessChange={buildReadinessHandler("research")}
        />
      );
    case "algo":
      return (
        <MemoAlgoScreen
          session={session}
          environment={environment}
          accounts={accounts}
          selectedAccountId={primaryAccountId}
          signalMatrixStates={signalMatrixStates}
          isVisible={screen === "algo"}
          onJumpToTradeCandidate={onJumpToTradeFromSignalOptionsCandidate}
          onReadinessChange={buildReadinessHandler("algo")}
        />
      );
    case "backtest":
      return (
        <MemoBacktestScreen
          watchlists={watchlists}
          defaultWatchlistId={defaultWatchlist?.id || null}
          isVisible={screen === "backtest"}
          onReadinessChange={buildReadinessHandler("backtest")}
        />
      );
    case "diagnostics":
      return <MemoDiagnosticsScreen isVisible={screen === "diagnostics"} />;
    case "settings":
      return (
        <MemoSettingsScreen
          theme={theme}
          onToggleTheme={onToggleTheme}
          sidebarCollapsed={sidebarCollapsed}
          onToggleSidebar={onToggleSidebar}
          isVisible={screen === "settings"}
        />
      );
    default:
      return renderMarketScreen();
  }
};
