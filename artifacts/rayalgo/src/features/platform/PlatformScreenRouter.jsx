import {
  MemoAccountScreen,
  MemoAlgoScreen,
  MemoBacktestScreen,
  MemoDiagnosticsScreen,
  MemoFlowScreen,
  MemoMarketScreen,
  MemoResearchScreen,
  MemoSettingsScreen,
  MemoTradeScreen,
} from "./screenRegistry.jsx";

export const PlatformScreenRouter = ({
  screenId,
  screen,
  sym,
  tradeSym,
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
  onJumpToTradeFromMarket,
  onJumpToTradeFromFlow,
  onSelectTradingAccount,
  onJumpToTradeFromAccount,
  onJumpToTradeFromResearch,
  onJumpToTradeFromSignalOptionsCandidate,
  marketLinkedContext,
  tradeLinkedContext,
  flowLinkedContext,
  accountLinkedContext,
  researchLinkedContext,
  onSetLinkedWorkspacePanelGroup,
  onMarketLinkedContextChange,
  onTradeLinkedContextChange,
  onFlowLinkedContextChange,
  onAccountLinkedContextChange,
  onResearchLinkedContextChange,
  onToggleTheme,
  onToggleSidebar,
}) => {
  const renderMarketScreen = () => (
    <MemoMarketScreen
      sym={sym}
      marketSymPing={marketSymPing}
      onSymClick={onSelectSymbol}
      onChartFocus={onFocusMarketChart}
      symbols={watchlistSymbols}
      flowSymbols={runtimeWatchlistSymbols}
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
      onOpenTrade={onJumpToTradeFromMarket}
      watchlists={watchlists}
      linkedContext={marketLinkedContext}
      onLinkedWorkspaceGroupChange={onSetLinkedWorkspacePanelGroup}
      onLinkedContextChange={onMarketLinkedContextChange}
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
          linkedContext={flowLinkedContext}
          onLinkedWorkspaceGroupChange={onSetLinkedWorkspacePanelGroup}
          onLinkedContextChange={onFlowLinkedContextChange}
        />
      );
    case "trade":
      return (
        <MemoTradeScreen
          sym={tradeSym || sym}
          symPing={tradeSymPing}
          session={session}
          environment={environment}
          accountId={primaryAccountId}
          brokerConfigured={brokerConfigured}
          brokerAuthenticated={brokerAuthenticated}
          gatewayTradingReady={gatewayTradingReady}
          gatewayTradingMessage={gatewayTradingMessage}
          isVisible={screen === "trade"}
          researchConfigured={researchConfigured}
          linkedContext={tradeLinkedContext}
          onLinkedWorkspaceGroupChange={onSetLinkedWorkspacePanelGroup}
          onLinkedContextChange={onTradeLinkedContextChange}
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
          linkedContext={accountLinkedContext}
          onLinkedWorkspaceGroupChange={onSetLinkedWorkspacePanelGroup}
          onLinkedContextChange={onAccountLinkedContextChange}
        />
      );
    case "research":
      return (
        <MemoResearchScreen
          isVisible={screen === "research"}
          onJumpToTrade={onJumpToTradeFromResearch}
          linkedContext={researchLinkedContext}
          onLinkedWorkspaceGroupChange={onSetLinkedWorkspacePanelGroup}
          onLinkedContextChange={onResearchLinkedContextChange}
        />
      );
    case "algo":
      return (
        <MemoAlgoScreen
          session={session}
          environment={environment}
          accounts={accounts}
          selectedAccountId={primaryAccountId}
          isVisible={screen === "algo"}
          onJumpToTradeCandidate={onJumpToTradeFromSignalOptionsCandidate}
        />
      );
    case "backtest":
      return (
        <MemoBacktestScreen
          watchlists={watchlists}
          defaultWatchlistId={defaultWatchlist?.id || null}
          isVisible={screen === "backtest"}
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
