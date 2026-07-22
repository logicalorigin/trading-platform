import { memo, useCallback, useEffect, useState } from "react";
import { NeuralLoader } from "../../components/neural/NeuralLoader";
import { summarizeErrorSignature } from "../../components/platform/PlatformErrorBoundary";
import { Button } from "../../components/ui/Button.jsx";
import {
  getPreloadedScreenComponent,
  getScreenModulePreloadSnapshot,
  loadScreenModule,
  preloadScreenModule,
} from "./screenModulePreloader";
import { markScreenReady } from "./performanceMetrics";

const createPreloadableScreen = (screenId, label) => {
  return function PreloadableScreen(props) {
    const [ScreenComponent, setScreenComponent] = useState(
      () => getPreloadedScreenComponent(screenId),
    );
    const [loadError, setLoadError] = useState(null);
    const ResolvedScreenComponent =
      ScreenComponent || getPreloadedScreenComponent(screenId);
    const implementationVisible = props?.isHostVisible ?? props?.isVisible;

    useEffect(() => {
      if (
        ResolvedScreenComponent ||
        loadError ||
        implementationVisible === false
      ) {
        return undefined;
      }
      let cancelled = false;
      loadScreenModule(screenId)
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
    }, [ResolvedScreenComponent, implementationVisible, loadError]);

    useEffect(() => {
      if (!ResolvedScreenComponent || props?.isVisible === false) {
        return;
      }
      markScreenReady(screenId);
      props?.onReadinessChange?.({ frameReady: true, error: null });
    }, [ResolvedScreenComponent, props?.isVisible, props?.onReadinessChange]);

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
    const loadingLabel = label.replace(/Screen$/, "");

    return ResolvedScreenComponent ? (
      <ResolvedScreenComponent {...props} />
    ) : loadError && implementationVisible !== false ? (
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
          color: "var(--ra-text-primary, #101827)",
          background: "var(--ra-surface-0, #F7FAFF)",
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 600 }}>
          {loadingLabel} could not load
        </div>
        {/* Keep raw chunk URLs out of user-facing copy. The compact signature
            remains available on hover for support without exposing the URL. */}
        <div
          title={summarizeErrorSignature(
            loadError instanceof Error ? loadError : new Error(String(loadError)),
          )}
          style={{ maxWidth: 520, textAlign: "center", opacity: 0.72 }}
        >
          Retry to load this workspace again.
        </div>
        <Button
          dataTestId={`screen-load-retry-${screenId}`}
          variant="secondary"
          size="md"
          onClick={retryLoad}
        >
          Retry
        </Button>
      </div>
    ) : implementationVisible === false ? (
      null
    ) : (
      <NeuralLoader
        label={`Loading ${loadingLabel}`}
        minHeight={160}
        testId={`screen-loading-${screenId}`}
        tone="panel"
        variant="workspace"
      />
    );
  };
};

const MarketScreen = createPreloadableScreen("market", "MarketDemoScreen");
const MarketDemoScreen = createPreloadableScreen("market-demo", "MarketDemoScreen");
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
  // Compatibility alias for saved/deep links created while the promoted Market
  // screen was still a demo. It stays hidden from visible navigation.
  { id: "market-demo", label: "Market Demo", icon: "◉", hidden: true },
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

const WATCHLIST_MANAGEMENT_SCREEN_IDS = new Set([
  "market",
  "market-demo",
  "signals",
  "flow",
  "gex",
  "trade",
]);

export const resolveWatchlistDensityForScreen = (screenId) =>
  WATCHLIST_MANAGEMENT_SCREEN_IDS.has(screenId) ? "default" : "passive";

export const SCREEN_MODULE_PRELOAD_ORDER = [
  // The compatibility alias resolves to the production Market module, so one
  // preload warms both route IDs.
  "market-demo",
  "account",
  "signals",
  "algo",
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

export { getScreenModulePreloadSnapshot, preloadScreenModule };

export const buildMountedScreenState = (activeScreen) =>
  Object.fromEntries(SCREENS.map(({ id }) => [id, id === activeScreen]));

export const skipStableHiddenScreenRender = (prevProps, nextProps) => {
  if (
    prevProps?.isVisible === false &&
    nextProps?.isVisible === false &&
    Object.is(prevProps?.isHostVisible, nextProps?.isHostVisible)
  ) {
    return true;
  }

  const previousKeys = Object.keys(prevProps);
  const nextKeys = Object.keys(nextProps);
  return (
    previousKeys.length === nextKeys.length &&
    previousKeys.every((key) => Object.is(prevProps[key], nextProps[key]))
  );
};

export const MemoMarketScreen = memo(MarketScreen, skipStableHiddenScreenRender);
export const MemoMarketDemoScreen = memo(
  MarketDemoScreen,
  skipStableHiddenScreenRender,
);
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
