import {
  WORK_PRESSURE_STATE,
  isBackgroundWorkAllowed,
  isForegroundWorkAllowed,
} from "./workPressureModel.js";

const normalizeScreen = (screen) =>
  typeof screen === "string" && screen.trim() ? screen.trim() : "market";

const normalizeMemoryPressureLevel = (value) => {
  if (value === "high" || value === "watch") {
    return value;
  }
  return "normal";
};

const PLATFORM_WORK_CAPS = {
  broadMarketSymbolLimit: null,
  broadFlowSymbolLimit: null,
  broadFlowRuntimeEnabled: true,
  broadFlowScannerConfig: {},
  signalMatrixWideSymbolLimit: null,
  signalMatrixNarrowSymbolLimit: null,
  // The stock-aggregate stream front-loads recent minute history per symbol.
  // Keep that attributable socket/snapshot budget separate from matrix truth.
  signalRealtimeAggregateSymbolLimit: 500,
  signalDisplayPollMinMs: 0,
  signalMatrixPollMinMs: 0,
  sparklineEnabled: true,
  sparklineConcurrency: 4,
  prioritySparklineSymbolLimit: null,
};

export const buildPlatformPressureCaps = () => ({ ...PLATFORM_WORK_CAPS });

export const shouldRunSignalMonitorDisplay = ({
  workVisible = false,
  firstScreenReady = false,
  foregroundReady = false,
  profileEnabled = false,
  profileFetched = false,
  profileError = false,
} = {}) => {
  if (!workVisible || !firstScreenReady) return false;
  if (foregroundReady) return true;
  if (profileEnabled) return true;
  return !profileFetched && !profileError;
};

export const shouldRunSignalMatrixStream = ({
  profileUniverse = false,
  universeSymbolCount = 0,
  screen = "market",
  foregroundReady = false,
  backgroundAllowed = false,
  screenWarmupPhase = "initial",
  startupProtectionActive = false,
  criticalApiMutationPaused = false,
} = {}) => {
  const activeScreen = normalizeScreen(screen);
  const foregroundSignalSurface = Boolean(
    foregroundReady && (activeScreen === "signals" || activeScreen === "algo"),
  );

  return Boolean(
    (profileUniverse || universeSymbolCount > 0) &&
      activeScreen !== "trade" &&
      (backgroundAllowed || foregroundSignalSurface) &&
      screenWarmupPhase === "ready" &&
      !startupProtectionActive &&
      !criticalApiMutationPaused,
  );
};

export const buildPlatformWorkSchedule = ({
  runtimeActive = true,
  sessionMetadataSettled = false,
  activeScreen = "market",
  screenWarmupPhase = "initial",
  activeScreenBackgroundAllowed = true,
  foregroundFlowAllowed = false,
  accountRealtimeAllowed = null,
  ibkrWorkPressure = WORK_PRESSURE_STATE.normal,
  memoryPressure = null,
  brokerConfigured = false,
  brokerAuthenticated = false,
  massiveStockRealtimeConfigured = false,
  automationEnabled = false,
  tradingEnabled = false,
  mobileViewport = false,
  startupProtectionActive = false,
} = {}) => {
  const screen = normalizeScreen(activeScreen);
  const runtimeEnabled = Boolean(runtimeActive);
  const sessionReady = Boolean(sessionMetadataSettled);
  const startupProtected = Boolean(startupProtectionActive);
  const memoryPressureLevel = normalizeMemoryPressureLevel(
    memoryPressure?.level,
  );
  const memoryPressureObserved =
    !memoryPressure ||
    Boolean(memoryPressure.observedAt || memoryPressure.measurement);
  const ibkrReady = Boolean(brokerConfigured && brokerAuthenticated);
  const foregroundIbkr = Boolean(
    runtimeEnabled &&
      ibkrReady &&
      isForegroundWorkAllowed(ibkrWorkPressure),
  );
  const foregroundStockAggregates = Boolean(
    runtimeEnabled &&
      (ibkrReady || massiveStockRealtimeConfigured) &&
      (massiveStockRealtimeConfigured ||
        isForegroundWorkAllowed(ibkrWorkPressure)),
  );
  const realtimeIbkr = Boolean(
    runtimeEnabled &&
      ibkrReady &&
      ibkrWorkPressure !== WORK_PRESSURE_STATE.stalled,
  );
  const quoteStreamAvailable = Boolean(
    runtimeEnabled && (ibkrReady || massiveStockRealtimeConfigured),
  );
  const quoteStreamIbkr = Boolean(runtimeEnabled && ibkrReady);
  const accountRealtimeIbkr = Boolean(
    runtimeEnabled &&
      ibkrReady &&
      ibkrWorkPressure !== WORK_PRESSURE_STATE.stalled,
  );
  const backgroundIbkr = Boolean(
    runtimeEnabled &&
      ibkrReady &&
      !startupProtected &&
      isBackgroundWorkAllowed(ibkrWorkPressure),
  );
  const firstScreenReady = screenWarmupPhase !== "initial";
  const market = screen === "market";
  const flow = screen === "flow";
  const trade = screen === "trade";
  const account = screen === "account";
  const signals = screen === "signals";
  const algo = screen === "algo";
  const signalMatrixSurface = signals || algo;
  const historyScreen = market || flow || trade || account;
  const pressureCaps = buildPlatformPressureCaps();
  const activeBackgroundReady = Boolean(activeScreenBackgroundAllowed);
  const accountRealtimeReady =
    accountRealtimeAllowed == null
      ? activeBackgroundReady
      : Boolean(accountRealtimeAllowed);
  const dataStreamReady = Boolean(
    sessionReady &&
      activeBackgroundReady &&
      firstScreenReady &&
      !startupProtected,
  );
  const foregroundFlowReady = Boolean(
    flow &&
      foregroundFlowAllowed &&
      sessionReady &&
      firstScreenReady &&
      !startupProtected,
  );
  const broadFlowAllowed = Boolean(
    // Only run the heavy broad-flow scanner where flow is actually shown. Trade
    // has its own flow runtime after the primary chart hydrates; starting the
    // broad scanner there competes with visible bar hydration.
    (market || flow) &&
      (dataStreamReady || foregroundFlowReady) &&
      runtimeEnabled &&
      pressureCaps.broadFlowRuntimeEnabled,
  );
  const backgroundHistoryReady =
    screenWarmupPhase === "ready" && !startupProtected;
  const startupBlocksBackgroundAccountRealtime = startupProtected;
  const foregroundAccountRealtime = Boolean(account || trade || tradingEnabled);
  const backgroundAccountRealtime = Boolean(
    automationEnabled || foregroundIbkr,
  );
  const accountRealtime = Boolean(
    accountRealtimeIbkr &&
      accountRealtimeReady &&
      (foregroundAccountRealtime ||
        (!startupBlocksBackgroundAccountRealtime && backgroundAccountRealtime)),
  );
  const watchlistQuoteStream = Boolean(dataStreamReady && quoteStreamAvailable);
  const idleCodePreloadAllowed = Boolean(
    sessionReady &&
      runtimeEnabled &&
      firstScreenReady &&
      !startupProtected &&
      !mobileViewport &&
      activeBackgroundReady,
  );

  return {
    pressure: ibkrWorkPressure,
    memoryPressure: {
      level: memoryPressureLevel,
      observed: memoryPressureObserved,
    },
    pressureCaps,
    startupProtection: {
      active: startupProtected,
    },
    // Generic hydration spans Massive, local/API caches, and broker-backed data.
    // Provider-specific availability is owned by the IBKR classes below.
    hydrationPressure: "normal",
    screens: {
      active: screen,
      market,
      flow,
      trade,
      account,
    },
    classes: {
      foregroundIbkr,
      realtimeIbkr,
      backgroundIbkr,
      accountRealtimeIbkr,
      idle: Boolean(sessionReady && backgroundIbkr),
      memoryAllowsForeground: true,
      memoryAllowsBackground: true,
    },
    streams: {
      watchlistQuoteStream,
      marketStockAggregates: Boolean(
        dataStreamReady &&
          foregroundStockAggregates &&
          (market || signalMatrixSurface),
      ),
      accountRealtime,
      shadowAccountRealtime: Boolean(
        backgroundIbkr && activeBackgroundReady && account,
      ),
      sharedFlowRuntime: false,
      broadFlowRuntime: broadFlowAllowed,
      lowPriorityHistory: Boolean(
        sessionReady &&
          backgroundIbkr &&
          backgroundHistoryReady &&
          activeBackgroundReady &&
          historyScreen,
      ),
    },
    resume: {
      immediateChartRefresh: runtimeEnabled,
      backgroundRefresh: backgroundIbkr,
      delayedOptionsRefresh: backgroundIbkr,
    },
    hiddenScreenPreload: {
      codeOnly: idleCodePreloadAllowed,
      mountScreens: false,
    },
    leases: {
      activeQuotes: watchlistQuoteStream,
      activeTrading: accountRealtime,
      activeCharting: Boolean(
        (foregroundIbkr || foregroundStockAggregates) && (market || trade),
      ),
      flowDiscovery: broadFlowAllowed,
      passiveVisuals: pressureCaps.sparklineEnabled,
      lowPriorityHistory: Boolean(
        sessionReady &&
          backgroundIbkr &&
          backgroundHistoryReady &&
          activeBackgroundReady &&
          historyScreen,
      ),
      idlePreload: idleCodePreloadAllowed,
      hiddenMount: false,
    },
  };
};
