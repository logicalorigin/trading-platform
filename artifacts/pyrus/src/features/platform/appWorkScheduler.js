import {
  WORK_PRESSURE_STATE,
  isBackgroundWorkAllowed,
  isForegroundWorkAllowed,
  toHydrationPressureState,
} from "./workPressureModel.js";

const normalizeScreen = (screen) =>
  typeof screen === "string" && screen.trim() ? screen.trim() : "market";

const PRESSURE_RANK = {
  normal: 0,
  degraded: 1,
  backoff: 2,
  stalled: 3,
};

const normalizeMemoryPressureLevel = (value) => {
  if (value === "high" || value === "watch") {
    return value;
  }
  return "normal";
};

const PRESSURE_CAPS = {
  normal: {
    broadMarketSymbolLimit: null,
    broadFlowSymbolLimit: null,
    broadFlowRuntimeEnabled: true,
    broadFlowScannerConfig: {},
    signalMatrixWideSymbolLimit: 500,
    signalMatrixNarrowSymbolLimit: 500,
    signalDisplayPollMinMs: 0,
    signalMatrixPollMinMs: 0,
    sparklineEnabled: true,
    sparklineConcurrency: 4,
    prioritySparklineSymbolLimit: null,
  },
  watch: {
    broadMarketSymbolLimit: null,
    broadFlowSymbolLimit: null,
    broadFlowRuntimeEnabled: true,
    broadFlowScannerConfig: {},
    signalMatrixWideSymbolLimit: 500,
    signalMatrixNarrowSymbolLimit: 500,
    signalDisplayPollMinMs: 0,
    signalMatrixPollMinMs: 0,
    sparklineEnabled: true,
    sparklineConcurrency: 2,
    prioritySparklineSymbolLimit: null,
  },
  high: {
    broadMarketSymbolLimit: null,
    broadFlowSymbolLimit: null,
    broadFlowRuntimeEnabled: true,
    broadFlowScannerConfig: {},
    signalMatrixWideSymbolLimit: 500,
    signalMatrixNarrowSymbolLimit: 500,
    signalDisplayPollMinMs: 30_000,
    signalMatrixPollMinMs: 60_000,
    sparklineEnabled: false,
    sparklineConcurrency: 0,
    prioritySparklineSymbolLimit: 0,
  },
};

export const buildPlatformPressureCaps = (level) => ({
  ...PRESSURE_CAPS[normalizeMemoryPressureLevel(level)],
});

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

const memoryHydrationPressureState = (memoryPressureLevel) => {
  const level = normalizeMemoryPressureLevel(memoryPressureLevel);
  if (level === "high") return "backoff";
  if (level === "watch") return "degraded";
  return "normal";
};

const maxHydrationPressureState = (...states) =>
  states.reduce(
    (current, next) =>
      PRESSURE_RANK[next] > PRESSURE_RANK[current] ? next : current,
    "normal",
  );

export const buildPlatformWorkSchedule = ({
  runtimeActive = true,
  sessionMetadataSettled = false,
  activeScreen = "market",
  screenWarmupPhase = "initial",
  activeScreenBackgroundAllowed = true,
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
  const memoryAllowsForeground = true;
  const memoryAllowsBackground = memoryPressureObserved;
  const ibkrReady = Boolean(brokerConfigured && brokerAuthenticated);
  const foregroundIbkr = Boolean(
    runtimeEnabled &&
      ibkrReady &&
      memoryAllowsForeground &&
      isForegroundWorkAllowed(ibkrWorkPressure),
  );
  const foregroundStockAggregates = Boolean(
    runtimeEnabled &&
      (ibkrReady || massiveStockRealtimeConfigured) &&
      memoryAllowsForeground &&
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
      memoryAllowsBackground &&
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
  const pressureCaps = buildPlatformPressureCaps(memoryPressureLevel);
  const activeBackgroundReady = Boolean(activeScreenBackgroundAllowed);
  const dataStreamReady = Boolean(
    sessionReady &&
      activeBackgroundReady &&
      firstScreenReady &&
      !startupProtected,
  );
  const broadFlowAllowed = Boolean(
    // Only run the heavy broad-flow scanner where flow is actually shown. Trade
    // has its own flow runtime after the primary chart hydrates; starting the
    // broad scanner there competes with visible bar hydration.
    (market || flow) &&
      dataStreamReady &&
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
      activeBackgroundReady &&
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
      activeBackgroundReady &&
      memoryAllowsBackground,
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
    hydrationPressure: maxHydrationPressureState(
      toHydrationPressureState(ibkrWorkPressure),
      memoryHydrationPressureState(memoryPressureLevel),
    ),
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
      memoryAllowsForeground,
      memoryAllowsBackground,
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
      passiveVisuals: Boolean(
        pressureCaps.sparklineEnabled && memoryAllowsForeground,
      ),
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
