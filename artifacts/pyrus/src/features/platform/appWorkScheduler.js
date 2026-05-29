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
  if (value === "critical" || value === "high" || value === "watch") {
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
    signalMatrixWideSymbolLimit: 250,
    signalMatrixNarrowSymbolLimit: 48,
    signalDisplayPollMinMs: 0,
    signalMatrixPollMinMs: 0,
    sparklineEnabled: true,
    sparklineConcurrency: 4,
    prioritySparklineSymbolLimit: null,
  },
  watch: {
    broadMarketSymbolLimit: 48,
    broadFlowSymbolLimit: 160,
    broadFlowRuntimeEnabled: true,
    broadFlowScannerConfig: {
      maxSymbols: 160,
      batchSize: 20,
      intervalMs: 30_000,
      concurrency: 4,
      limit: 20,
    },
    signalMatrixWideSymbolLimit: 96,
    signalMatrixNarrowSymbolLimit: 32,
    signalDisplayPollMinMs: 60_000,
    signalMatrixPollMinMs: 60_000,
    sparklineEnabled: true,
    sparklineConcurrency: 2,
    prioritySparklineSymbolLimit: null,
  },
  high: {
    broadMarketSymbolLimit: 16,
    broadFlowSymbolLimit: 48,
    broadFlowRuntimeEnabled: true,
    broadFlowScannerConfig: {
      maxSymbols: 48,
      batchSize: 8,
      intervalMs: 60_000,
      concurrency: 2,
      limit: 8,
    },
    signalMatrixWideSymbolLimit: 32,
    signalMatrixNarrowSymbolLimit: 16,
    signalDisplayPollMinMs: 120_000,
    signalMatrixPollMinMs: 120_000,
    sparklineEnabled: true,
    sparklineConcurrency: 1,
    prioritySparklineSymbolLimit: 8,
  },
  critical: {
    broadMarketSymbolLimit: 0,
    broadFlowSymbolLimit: 1,
    broadFlowRuntimeEnabled: true,
    broadFlowScannerConfig: {
      maxSymbols: 1,
      batchSize: 1,
      intervalMs: 120_000,
      concurrency: 1,
      limit: 1,
    },
    signalMatrixWideSymbolLimit: 8,
    signalMatrixNarrowSymbolLimit: 8,
    signalDisplayPollMinMs: 120_000,
    signalMatrixPollMinMs: 120_000,
    sparklineEnabled: false,
    sparklineConcurrency: 1,
    prioritySparklineSymbolLimit: 0,
  },
};

export const buildPlatformPressureCaps = (level) => ({
  ...PRESSURE_CAPS[normalizeMemoryPressureLevel(level)],
});

const memoryHydrationPressureState = (memoryPressureLevel) => {
  if (memoryPressureLevel === "critical") return "stalled";
  if (memoryPressureLevel === "high") return "backoff";
  if (memoryPressureLevel === "watch") return "degraded";
  return "normal";
};

const maxHydrationPressureState = (...states) =>
  states.reduce(
    (current, next) =>
      PRESSURE_RANK[next] > PRESSURE_RANK[current] ? next : current,
    "normal",
  );

export const buildPlatformWorkSchedule = ({
  pageVisible = true,
  sessionMetadataSettled = false,
  activeScreen = "market",
  screenWarmupPhase = "initial",
  activeScreenBackgroundAllowed = true,
  ibkrWorkPressure = WORK_PRESSURE_STATE.normal,
  memoryPressure = null,
  brokerConfigured = false,
  brokerAuthenticated = false,
  automationEnabled = false,
  tradingEnabled = false,
  mobileViewport = false,
  startupProtectionActive = false,
} = {}) => {
  const screen = normalizeScreen(activeScreen);
  const visible = Boolean(pageVisible);
  const sessionReady = Boolean(sessionMetadataSettled);
  const startupProtected = Boolean(startupProtectionActive);
  const memoryPressureLevel = normalizeMemoryPressureLevel(memoryPressure?.level);
  const memoryPressureObserved =
    !memoryPressure ||
    Boolean(memoryPressure.observedAt || memoryPressure.measurement);
  const memoryAllowsForeground = memoryPressureLevel !== "critical";
  const memoryAllowsBackground =
    memoryPressureObserved && memoryPressureLevel === "normal";
  const ibkrReady = Boolean(brokerConfigured && brokerAuthenticated);
  const foregroundIbkr = Boolean(
    visible &&
      ibkrReady &&
      memoryAllowsForeground &&
      isForegroundWorkAllowed(ibkrWorkPressure),
  );
  const realtimeIbkr = Boolean(
    visible &&
      ibkrReady &&
      ibkrWorkPressure !== WORK_PRESSURE_STATE.stalled,
  );
  const quoteStreamIbkr = Boolean(visible && ibkrReady);
  const criticalIbkr = Boolean(
    visible &&
      ibkrReady &&
      ibkrWorkPressure !== WORK_PRESSURE_STATE.stalled,
  );
  const backgroundIbkr = Boolean(
    visible &&
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
  const historyScreen = market || flow || trade || account;
  const pressureCaps = buildPlatformPressureCaps(memoryPressureLevel);
  const activeBackgroundReady = Boolean(activeScreenBackgroundAllowed);
  const mobileBroadFlowAllowed = !mobileViewport || flow;
  const passiveMarketDiscoveryAllowed = Boolean(
    market &&
      screenWarmupPhase === "ready" &&
      activeBackgroundReady &&
      memoryPressureLevel === "normal" &&
      ibkrWorkPressure === WORK_PRESSURE_STATE.normal,
  );
  const broadFlowAllowed = Boolean(
    sessionReady &&
      visible &&
      !startupProtected &&
      mobileBroadFlowAllowed &&
      (flow || passiveMarketDiscoveryAllowed) &&
      pressureCaps.broadFlowRuntimeEnabled,
  );
  const backgroundHistoryReady = screenWarmupPhase === "ready" && !startupProtected;
  const pressureBlocksBackgroundAccountRealtime =
    startupProtected ||
    memoryPressureLevel === "high" ||
    memoryPressureLevel === "critical";
  const foregroundAccountRealtime = Boolean(
    account || trade || tradingEnabled,
  );
  const backgroundAccountRealtime = Boolean(automationEnabled || foregroundIbkr);
  const accountRealtimeCritical = Boolean(
    criticalIbkr &&
      (foregroundAccountRealtime ||
        (!pressureBlocksBackgroundAccountRealtime && backgroundAccountRealtime)),
  );
  const watchlistQuoteStream = Boolean(sessionReady && quoteStreamIbkr);
  const idleCodePreloadAllowed = Boolean(
    sessionReady &&
      firstScreenReady &&
      !startupProtected &&
      visible &&
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
      criticalIbkr,
      idle: Boolean(sessionReady && backgroundIbkr),
      memoryAllowsForeground,
      memoryAllowsBackground,
    },
    streams: {
      watchlistQuoteStream,
      marketStockAggregates: Boolean(foregroundIbkr && market),
      accountRealtime: accountRealtimeCritical,
      accountRealtimeCritical,
      shadowAccountRealtime: Boolean(backgroundIbkr && account),
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
      immediateChartRefresh: visible,
      backgroundRefresh: backgroundIbkr,
      delayedOptionsRefresh: backgroundIbkr,
    },
    hiddenScreenPreload: {
      codeOnly: idleCodePreloadAllowed,
      mountScreens: false,
    },
    leases: {
      activeQuotes: watchlistQuoteStream,
      activeTrading: accountRealtimeCritical,
      activeCharting: Boolean(foregroundIbkr && (market || trade)),
      flowDiscovery: broadFlowAllowed,
      passiveVisuals: Boolean(pressureCaps.sparklineEnabled && memoryAllowsForeground),
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
