import {
  useEffect,
  useMemo,
  useState,
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
  MemoTradeScreen,
} from "./screenRegistry.jsx";

const SCREEN_IDS = [
  "market",
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

const useDeferredActiveScreen = (screen) => {
  const [deferredScreen, setDeferredScreen] = useState(screen);

  useEffect(() => {
    if (typeof window === "undefined") {
      setDeferredScreen(screen);
      return undefined;
    }

    let cancelled = false;
    const activate = () => {
      if (!cancelled) {
        setDeferredScreen(screen);
      }
    };

    if (typeof window.requestAnimationFrame === "function") {
      const frameId = window.requestAnimationFrame(activate);
      return () => {
        cancelled = true;
        window.cancelAnimationFrame?.(frameId);
      };
    }

    const timerId = window.setTimeout(activate, 16);
    return () => {
      cancelled = true;
      window.clearTimeout(timerId);
    };
  }, [screen]);

  return deferredScreen;
};

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
  onJumpToTradeFromFlow,
  onSelectTradingAccount,
  onJumpToTradeFromAccount,
  onJumpToTradeFromResearch,
  onJumpToTradeFromSignalOptionsCandidate,
  onToggleTheme,
  onToggleSidebar,
  onToggleActivitySidebar,
  onScreenReadiness,
}) => {
  const deferredActiveScreen = useDeferredActiveScreen(screen);
  const marketDataActive = screen === "market" && deferredActiveScreen === "market";
  const flowDataActive = screen === "flow" && deferredActiveScreen === "flow";
  const gexDataActive = screen === "gex" && deferredActiveScreen === "gex";
  const tradeDataActive = screen === "trade" && deferredActiveScreen === "trade";
  const accountDataActive =
    screen === "account" && deferredActiveScreen === "account";
  const researchDataActive =
    screen === "research" && deferredActiveScreen === "research";
  const algoDataActive = screen === "algo" && deferredActiveScreen === "algo";
  const backtestDataActive =
    screen === "backtest" && deferredActiveScreen === "backtest";
  const diagnosticsDataActive =
    screen === "diagnostics" && deferredActiveScreen === "diagnostics";
  const settingsDataActive =
    screen === "settings" && deferredActiveScreen === "settings";
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
      stockAggregateStreamingEnabled={
        stockAggregateStreamingEnabled && marketDataActive
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
          onSelectTradingAccount={onSelectTradingAccount}
          environment={environment}
          brokerConfigured={brokerConfigured}
          brokerAuthenticated={brokerAuthenticated}
          gatewayTradingReady={gatewayTradingReady}
          gatewayTradingMessage={gatewayTradingMessage}
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
          signalMatrixStates={signalMatrixStates}
          isVisible={algoDataActive}
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
      return <MemoDiagnosticsScreen isVisible={diagnosticsDataActive} />;
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
        />
      );
    default:
      return renderMarketScreen();
  }
};
