import { memo, useCallback, useEffect, useState } from "react";
import {
  getPreloadedScreenComponent,
  getScreenModulePreloadSnapshot,
  loadScreenModule,
  preloadScreenModule,
} from "./screenModulePreloader";
import { markScreenReady } from "./performanceMetrics";
export { SCREEN_BOOT_DATA_DEPS } from "./bootPolicy.js";

const createPreloadableScreen = (screenId, label) => {
  return function PreloadableScreen(props) {
    const [ScreenComponent, setScreenComponent] = useState(
      () => getPreloadedScreenComponent(screenId),
    );
    const [loadError, setLoadError] = useState(null);

    useEffect(() => {
      if (ScreenComponent || loadError || props?.isVisible === false) {
        return undefined;
      }
      const cachedScreenComponent = getPreloadedScreenComponent(screenId);
      if (cachedScreenComponent) {
        setScreenComponent(() => cachedScreenComponent);
        return undefined;
      }
      let cancelled = false;
      loadScreenModule(screenId, { label })
        .then((mod) => {
          if (!cancelled && mod?.default) {
            setLoadError(null);
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
    }, [ScreenComponent, loadError, props?.isVisible]);

    useEffect(() => {
      if (!ScreenComponent || props?.isVisible === false) {
        return;
      }
      markScreenReady(screenId);
      props?.onReadinessChange?.({ frameReady: true, error: null });
    }, [ScreenComponent, props?.isVisible, props?.onReadinessChange]);

    useEffect(() => {
      if (!loadError || props?.isVisible === false) {
        return;
      }
      props?.onReadinessChange?.({
        frameReady: true,
        contentReady: true,
        primaryReady: false,
        derivedReady: false,
        backgroundAllowed: false,
        error: loadError,
      });
    }, [loadError, props?.isVisible, props?.onReadinessChange]);

    const retryLoad = useCallback(() => {
      setLoadError(null);
      setScreenComponent(() => null);
    }, []);

    return ScreenComponent ? (
      <ScreenComponent {...props} />
    ) : loadError && props?.isVisible !== false ? (
      <div
        role="alert"
        data-testid={`screen-load-error-${screenId}`}
        style={{
          minHeight: 240,
          display: "grid",
          alignContent: "center",
          justifyItems: "center",
          gap: 10,
          padding: 20,
          color: "var(--foreground, #f8fafc)",
          background: "var(--background, #020617)",
        }}
      >
        <div style={{ fontSize: 15 }}>Screen failed to load</div>
        <div style={{ maxWidth: 520, textAlign: "center", opacity: 0.72 }}>
          {loadError instanceof Error ? loadError.message : String(loadError)}
        </div>
        <button type="button" onClick={retryLoad}>
          Retry
        </button>
      </div>
    ) : props?.isVisible === false ? (
      null
    ) : (
      null
    );
  };
};

const MarketScreen = createPreloadableScreen("market", "MarketScreen");
const SignalsScreen = createPreloadableScreen("signals", "SignalsScreen");
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
  { id: "signals", label: "Signals", icon: "◌" },
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
  "account",
  "signals",
  "flow",
  "gex",
  "trade",
  "research",
  "backtest",
  "diagnostics",
  "settings",
];

export const BOOT_SCREEN_MODULE_PRELOAD_ORDER = [
  "flow",
  "trade",
  "backtest",
];

export const SCREEN_RENDER_POLICIES = {
  market: { retainInactive: true },
  signals: { retainInactive: true },
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

export { getScreenModulePreloadSnapshot, preloadScreenModule };

export const buildMountedScreenState = (activeScreen) =>
  Object.fromEntries(SCREENS.map(({ id }) => [id, id === activeScreen]));

export const skipStableHiddenScreenRender = (prevProps, nextProps) =>
  prevProps?.isVisible === false && nextProps?.isVisible === false;

export const MemoMarketScreen = memo(MarketScreen, skipStableHiddenScreenRender);
export const MemoSignalsScreen = memo(SignalsScreen, skipStableHiddenScreenRender);
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
