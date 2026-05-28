import { memo, useEffect, useState } from "react";
import LogoLoader from "../../components/LogoLoader";
import {
  BOOT_SCREEN_MODULE_PRELOAD_TASK_BY_SCREEN_ID,
  completeBootProgressTask,
  failBootProgressTask,
  startBootProgressTask,
} from "../../app/bootProgress";
import { retryDynamicImport } from "../../lib/dynamicImport";
import { markScreenReady } from "./performanceMetrics";

const SCREEN_LOADERS = {
  market: () => import("../../screens/MarketScreen.jsx"),
  flow: () => import("../../screens/FlowScreen.jsx"),
  gex: () => import("../../screens/GexScreen.jsx"),
  trade: () => import("../../screens/TradeScreen.jsx"),
  account: () => import("../../screens/AccountScreen.jsx"),
  research: () => import("../../screens/ResearchScreen.jsx"),
  algo: () => import("../../screens/AlgoScreen.jsx"),
  backtest: () => import("../../screens/BacktestScreen.jsx"),
  diagnostics: () => import("../../screens/DiagnosticsScreen.jsx"),
  settings: () => import("../../screens/SettingsScreen.jsx"),
};

const SCREEN_MODULE_PRELOADS = new Map();
const SCREEN_MODULE_PRELOAD_STATE = new Map();
const SCREEN_MODULE_COMPONENTS = new Map();

const screenModuleLabel = (screenId) => `${screenId}ScreenPreload`;

const loadScreenModule = (
  screenId,
  { label = screenModuleLabel(screenId), reloadOnFailure = true } = {},
) => {
  const loader = SCREEN_LOADERS[screenId];
  if (!loader) return Promise.resolve(null);
  const existing = SCREEN_MODULE_PRELOADS.get(screenId);
  if (existing) return existing;

  SCREEN_MODULE_PRELOAD_STATE.set(screenId, {
    status: "loading",
    startedAt: Date.now(),
    label,
  });
  const bootProgressTaskId = BOOT_SCREEN_MODULE_PRELOAD_TASK_BY_SCREEN_ID[screenId];
  if (bootProgressTaskId) {
    startBootProgressTask(bootProgressTaskId);
  }
  const promise = retryDynamicImport(loader, {
    label,
    reloadOnFailure,
  })
    .then((mod) => {
      if (mod?.default) {
        SCREEN_MODULE_COMPONENTS.set(screenId, mod.default);
      }
      SCREEN_MODULE_PRELOAD_STATE.set(screenId, {
        status: "ready",
        startedAt: SCREEN_MODULE_PRELOAD_STATE.get(screenId)?.startedAt || null,
        completedAt: Date.now(),
        label,
      });
      if (bootProgressTaskId) {
        completeBootProgressTask(bootProgressTaskId);
      }
      return mod;
    })
    .catch((error) => {
      SCREEN_MODULE_PRELOADS.delete(screenId);
      SCREEN_MODULE_PRELOAD_STATE.set(screenId, {
        status: "failed",
        startedAt: SCREEN_MODULE_PRELOAD_STATE.get(screenId)?.startedAt || null,
        completedAt: Date.now(),
        label,
        error: error instanceof Error ? error.message : String(error),
      });
      if (bootProgressTaskId) {
        failBootProgressTask(bootProgressTaskId, error);
      }
      throw error;
    });

  SCREEN_MODULE_PRELOADS.set(screenId, promise);
  return promise;
};

export const ScreenLoadingFallback = ({ screenId, error = null }) => (
  <LogoLoader
    tone="panel"
    label={error ? `Retrying ${screenId}` : `Loading ${screenId}`}
    minHeight="100%"
    testId="screen-loading-fallback"
  />
);

const createPreloadableScreen = (screenId, label) => {
  return function PreloadableScreen(props) {
    const [ScreenComponent, setScreenComponent] = useState(
      () => SCREEN_MODULE_COMPONENTS.get(screenId) || null,
    );
    const [loadError, setLoadError] = useState(null);

    useEffect(() => {
      if (ScreenComponent || props?.isVisible === false) {
        return undefined;
      }
      const cachedScreenComponent = SCREEN_MODULE_COMPONENTS.get(screenId);
      if (cachedScreenComponent) {
        setScreenComponent(() => cachedScreenComponent);
        return undefined;
      }
      let cancelled = false;
      setLoadError(null);
      loadScreenModule(screenId, { label })
        .then((mod) => {
          if (!cancelled && mod?.default) {
            setScreenComponent(() => mod.default);
          }
        })
        .catch((error) => {
          if (!cancelled) {
            setLoadError(error);
          }
        });
      return () => {
        cancelled = true;
      };
    }, [ScreenComponent, props?.isVisible]);

    useEffect(() => {
      if (!ScreenComponent || props?.isVisible === false) {
        return;
      }
      markScreenReady(screenId);
      props?.onReadinessChange?.({ frameReady: true });
    }, [ScreenComponent, props?.isVisible, props?.onReadinessChange]);

    return ScreenComponent ? (
      <ScreenComponent {...props} />
    ) : props?.isVisible === false ? (
      null
    ) : (
      <ScreenLoadingFallback screenId={screenId} error={loadError} />
    );
  };
};

const MarketScreen = createPreloadableScreen("market", "MarketScreen");
const FlowScreen = createPreloadableScreen("flow", "FlowScreen");
const GexScreen = createPreloadableScreen("gex", "GexScreen");
const TradeScreen = createPreloadableScreen("trade", "TradeScreen");
const AccountScreen = createPreloadableScreen("account", "AccountScreen");
const ResearchScreen = createPreloadableScreen("research", "ResearchScreen");
const AlgoScreen = createPreloadableScreen("algo", "AlgoScreen");
const BacktestScreen = createPreloadableScreen("backtest", "BacktestScreen");
const DiagnosticsScreen = createPreloadableScreen("diagnostics", "DiagnosticsScreen");
const SettingsScreen = createPreloadableScreen("settings", "SettingsScreen");

export const SCREENS = [
  { id: "market", label: "Market", icon: "◉" },
  { id: "flow", label: "Flow", icon: "◈" },
  { id: "gex", label: "GEX", icon: "✳" },
  { id: "trade", label: "Trade", icon: "◧" },
  { id: "account", label: "Account", icon: "▣" },
  { id: "research", label: "Research", icon: "◎" },
  { id: "algo", label: "Algo", icon: "⬡" },
  { id: "backtest", label: "Backtest", icon: "⏣" },
  { id: "diagnostics", label: "Diagnostics", icon: "▤" },
  { id: "settings", label: "Settings", icon: "⚙" },
];

export const SCREEN_MODULE_PRELOAD_ORDER = [
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

export const BOOT_SCREEN_MODULE_PRELOAD_ORDER = [
  "flow",
  "trade",
  "algo",
  "backtest",
];

export const SCREEN_RENDER_POLICIES = {
  market: { retainInactive: true },
  trade: { retainInactive: true },
  flow: { retainInactive: true },
  gex: { retainInactive: true },
  account: { retainInactive: true },
  research: { retainInactive: false },
  algo: { retainInactive: true },
  backtest: { retainInactive: true },
  diagnostics: { retainInactive: false },
  settings: { retainInactive: false },
};

export const SCREEN_SHELL_WARM_MOUNT_ORDER = SCREEN_MODULE_PRELOAD_ORDER.filter(
  (screenId) => SCREEN_RENDER_POLICIES[screenId]?.retainInactive === true,
);

export const buildMountedScreenState = (activeScreen) =>
  Object.fromEntries(SCREENS.map(({ id }) => [id, id === activeScreen]));

export const preloadScreenModule = (screenId) => {
  if (!SCREEN_LOADERS[screenId]) return Promise.resolve(null);
  return loadScreenModule(screenId, {
    label: screenModuleLabel(screenId),
    reloadOnFailure: false,
  });
};

export const getScreenModulePreloadSnapshot = () =>
  Object.fromEntries(SCREEN_MODULE_PRELOAD_STATE.entries());

export const skipStableHiddenScreenRender = (prevProps, nextProps) =>
  prevProps?.isVisible === false && nextProps?.isVisible === false;

export const MemoMarketScreen = memo(MarketScreen, skipStableHiddenScreenRender);
export const MemoFlowScreen = memo(FlowScreen, skipStableHiddenScreenRender);
export const MemoGexScreen = memo(GexScreen, skipStableHiddenScreenRender);
export const MemoTradeScreen = memo(TradeScreen, skipStableHiddenScreenRender);
export const MemoAccountScreen = memo(AccountScreen, skipStableHiddenScreenRender);
export const MemoResearchScreen = memo(ResearchScreen, skipStableHiddenScreenRender);
export const MemoAlgoScreen = memo(AlgoScreen, skipStableHiddenScreenRender);
export const MemoBacktestScreen = memo(BacktestScreen, skipStableHiddenScreenRender);
export const MemoDiagnosticsScreen = memo(
  DiagnosticsScreen,
  skipStableHiddenScreenRender,
);
export const MemoSettingsScreen = memo(SettingsScreen, skipStableHiddenScreenRender);
