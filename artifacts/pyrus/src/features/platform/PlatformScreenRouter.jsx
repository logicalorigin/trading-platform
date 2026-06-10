import {
  useMemo,
} from "react";
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
  MemoSignalsScreen,
  MemoTradeScreen,
} from "./screenRegistry.jsx";

const SCREEN_IDS = [
  "market",
  "signals",
  "flow",
  "gex",
  "trade",
  "account",
  "research",
  "algo",
  "backtest",
  "diagnostics",
  "settings",
];

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
  signalMonitorEnvironment,
  signalMonitorSymbols,
  signalMonitorDisplaySymbols,
  signalMonitorProfile,
  signalMonitorProfileLoading,
  signalMonitorProfileError,
  signalMonitorState,
  signalMonitorStateLoaded,
  signalMonitorStateLoading,
  signalMonitorStateError,
  signalMonitorDataManagedByPlatform = false,
  signalMonitorEvents,
  signalMonitorEventsSourceStatus,
  signalMonitorEventsLoaded,
  signalMatrixStates,
  signalMatrixCoverage,
  marketScreenActive,
  flowScreenActive,
  researchConfigured,
  safeQaMode = false,
  stockAggregateStreamingEnabled,
  watchlists,
  defaultWatchlist,
  marketUnusualThreshold,
  theme,
  sidebarCollapsed,
  activitySidebarCollapsed,
  onSelectSymbol,
  onFocusMarketChart,
  onSignalAction,
  onScanNow,
  onToggleMonitor,
  onChangeMonitorTimeframe,
  onChangeMonitorWatchlist,
  onChangeMonitorFreshWindowBars,
  onChangeMonitorMaxSymbols,
  onApplyPyrusSignalsSettings,
  onRequestSignalMatrixHydration,
  onJumpToTradeFromSignals,
  onJumpToTradeFromFlow,
  onJumpToTradeFromAccount,
  onJumpToTradeFromResearch,
  onJumpToTradeFromSignalOptionsCandidate,
  onToggleTheme,
  onToggleSidebar,
  onToggleActivitySidebar,
  onScreenReadiness,
}) => {
  const marketDataActive = screen === "market";
  const signalsDataActive = screen === "signals";
  const flowDataActive = screen === "flow";
  const gexDataActive = screen === "gex";
  const tradeDataActive = screen === "trade";
  const accountDataActive = screen === "account";
  const researchDataActive = screen === "research";
  const algoDataActive = screen === "algo";
  const backtestDataActive = screen === "backtest";
  const diagnosticsDataActive = screen === "diagnostics";
  const settingsDataActive = screen === "settings";
  const readinessHandlers = useMemo(
    () =>
      Object.fromEntries(
        SCREEN_IDS.map((id) => [
          id,
          (readiness) => onScreenReadiness?.(id, readiness),
        ]),
      ),
    [onScreenReadiness],
  );
  const buildReadinessHandler = (screenId) => readinessHandlers[screenId];

  const renderMarketScreen = () => (
    <MemoMarketScreen
      sym={sym}
      marketSymPing={marketSymPing}
      onSymClick={onSelectSymbol}
      onChartFocus={onFocusMarketChart}
      symbols={watchlistSymbols}
      signalSuggestionSymbols={signalMonitorSymbols}
      isVisible={marketDataActive}
      researchConfigured={researchConfigured}
      safeQaMode={safeQaMode}
      stockAggregateStreamingEnabled={
        stockAggregateStreamingEnabled && marketDataActive && !safeQaMode
      }
      onSignalAction={onSignalAction}
      onScanNow={onScanNow}
      onToggleMonitor={onToggleMonitor}
      onChangeMonitorTimeframe={onChangeMonitorTimeframe}
      onChangeMonitorWatchlist={onChangeMonitorWatchlist}
      watchlists={watchlists}
      unusualThreshold={marketUnusualThreshold}
      onReadinessChange={buildReadinessHandler("market")}
    />
  );

  switch (screenId) {
    case "market":
      return renderMarketScreen();
    case "signals":
      return (
        <MemoSignalsScreen
          environment={signalMonitorEnvironment || environment}
          watchlists={watchlists}
          defaultWatchlist={defaultWatchlist}
          signalMonitorSymbols={
            signalMonitorDisplaySymbols?.length
              ? signalMonitorDisplaySymbols
              : signalMonitorSymbols
          }
          signalMonitorProfile={signalMonitorProfile}
          signalMonitorProfileLoading={signalMonitorProfileLoading}
          signalMonitorProfileError={signalMonitorProfileError}
          signalMonitorState={signalMonitorState}
          signalMonitorStateLoaded={signalMonitorStateLoaded}
          signalMonitorStateLoading={signalMonitorStateLoading}
          signalMonitorStateError={signalMonitorStateError}
          signalMonitorDataManagedByPlatform={signalMonitorDataManagedByPlatform}
          signalMatrixStates={signalMatrixStates}
          signalMatrixCoverage={signalMatrixCoverage}
          signalMonitorEvents={signalMonitorEvents}
          signalMonitorEventsLoaded={signalMonitorEventsLoaded}
          isVisible={signalsDataActive}
          safeQaMode={safeQaMode}
          onSelectSymbol={onSelectSymbol}
          onJumpToTrade={onJumpToTradeFromSignals}
          onScanNow={onScanNow}
          onToggleMonitor={onToggleMonitor}
          onChangeMonitorTimeframe={onChangeMonitorTimeframe}
          onChangeMonitorWatchlist={onChangeMonitorWatchlist}
          onChangeMonitorFreshWindowBars={onChangeMonitorFreshWindowBars}
          onChangeMonitorMaxSymbols={onChangeMonitorMaxSymbols}
          onApplyPyrusSignalsSettings={onApplyPyrusSignalsSettings}
          onRequestSignalMatrixHydration={onRequestSignalMatrixHydration}
          onReadinessChange={buildReadinessHandler("signals")}
        />
      );
    case "flow":
    case "unusual":
      return (
        <MemoFlowScreen
          session={session}
          symbols={runtimeWatchlistSymbols}
          isVisible={flowDataActive}
          onJumpToTrade={onJumpToTradeFromFlow}
          onReadinessChange={buildReadinessHandler("flow")}
        />
      );
    case "gex":
      return (
        <MemoGexScreen
          sym={sym}
          isVisible={gexDataActive}
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
          safeQaMode={safeQaMode}
          isVisible={tradeDataActive}
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
          environment={environment}
          brokerConfigured={brokerConfigured}
          brokerAuthenticated={brokerAuthenticated}
          gatewayTradingReady={gatewayTradingReady}
          gatewayTradingMessage={gatewayTradingMessage}
          safeQaMode={safeQaMode}
          isVisible={accountDataActive}
          onJumpToTrade={onJumpToTradeFromAccount}
          onReadinessChange={buildReadinessHandler("account")}
        />
      );
    case "research":
      return (
        <MemoResearchScreen
          isVisible={researchDataActive}
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
          signalMonitorEvents={signalMonitorEvents}
          signalMonitorEventsSourceStatus={signalMonitorEventsSourceStatus}
          signalMonitorEventsLoaded={signalMonitorEventsLoaded}
          signalMonitorState={signalMonitorState}
          signalMatrixStates={signalMatrixStates}
          isVisible={algoDataActive}
          safeQaMode={safeQaMode}
          onRequestSignalMatrixHydration={onRequestSignalMatrixHydration}
          onJumpToTradeCandidate={onJumpToTradeFromSignalOptionsCandidate}
          onReadinessChange={buildReadinessHandler("algo")}
        />
      );
    case "backtest":
      return (
        <MemoBacktestScreen
          watchlists={watchlists}
          defaultWatchlistId={defaultWatchlist?.id || null}
          isVisible={backtestDataActive}
          onReadinessChange={buildReadinessHandler("backtest")}
        />
      );
    case "diagnostics":
      return (
        <MemoDiagnosticsScreen
          isVisible={diagnosticsDataActive}
          onReadinessChange={buildReadinessHandler("diagnostics")}
        />
      );
    case "settings":
      return (
        <MemoSettingsScreen
          theme={theme}
          onToggleTheme={onToggleTheme}
          sidebarCollapsed={sidebarCollapsed}
          onToggleSidebar={onToggleSidebar}
          activitySidebarCollapsed={activitySidebarCollapsed}
          onToggleActivitySidebar={onToggleActivitySidebar}
          isVisible={settingsDataActive}
          onReadinessChange={buildReadinessHandler("settings")}
        />
      );
    default:
      return renderMarketScreen();
  }
};
