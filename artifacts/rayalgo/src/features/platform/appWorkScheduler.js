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
  ibkrWorkPressure = WORK_PRESSURE_STATE.normal,
  memoryPressure = null,
  brokerConfigured = false,
  brokerAuthenticated = false,
  automationEnabled = false,
  tradingEnabled = false,
} = {}) => {
  const screen = normalizeScreen(activeScreen);
  const visible = Boolean(pageVisible);
  const sessionReady = Boolean(sessionMetadataSettled);
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
  const criticalIbkr = Boolean(
    visible &&
      ibkrReady &&
      ibkrWorkPressure !== WORK_PRESSURE_STATE.stalled,
  );
  const backgroundIbkr = Boolean(
    visible &&
      ibkrReady &&
      memoryAllowsBackground &&
      isBackgroundWorkAllowed(ibkrWorkPressure),
  );
  const firstScreenReady = screenWarmupPhase !== "initial";
  const broadFlowAllowed = Boolean(visible && sessionReady);
  const market = screen === "market";
  const flow = screen === "flow";
  const trade = screen === "trade";
  const account = screen === "account";
  const accountRealtimeCritical = Boolean(
    criticalIbkr &&
      (account ||
        trade ||
        automationEnabled ||
        tradingEnabled ||
        foregroundIbkr),
  );

  return {
    pressure: ibkrWorkPressure,
    memoryPressure: {
      level: memoryPressureLevel,
      observed: memoryPressureObserved,
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
      backgroundIbkr,
      criticalIbkr,
      idle: Boolean(sessionReady && backgroundIbkr),
      memoryAllowsForeground,
      memoryAllowsBackground,
    },
    streams: {
      marketStockAggregates: Boolean(foregroundIbkr && market),
      accountRealtime: accountRealtimeCritical,
      accountRealtimeCritical,
      shadowAccountRealtime: Boolean(backgroundIbkr && account),
      sharedFlowRuntime: false,
      broadFlowRuntime: broadFlowAllowed,
      lowPriorityHistory: Boolean(
        sessionReady && backgroundIbkr && firstScreenReady,
      ),
    },
    resume: {
      immediateChartRefresh: visible,
      backgroundRefresh: backgroundIbkr,
      delayedOptionsRefresh: backgroundIbkr,
    },
    hiddenScreenPreload: {
      codeOnly: Boolean(sessionReady && firstScreenReady && memoryAllowsForeground),
      mountScreens: Boolean(backgroundIbkr && firstScreenReady),
    },
  };
};
