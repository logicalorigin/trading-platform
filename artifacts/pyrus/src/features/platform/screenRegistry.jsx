import { memo, useEffect, useState } from "react";
import LogoLoader from "../../components/LogoLoader";
import {
  getPreloadedScreenComponent,
  getScreenModulePreloadSnapshot,
  loadScreenModule,
  preloadScreenModule,
} from "./screenModulePreloader";
import { markScreenReady } from "./performanceMetrics";
export { SCREEN_BOOT_DATA_DEPS } from "./bootPolicy.js";

export const ScreenLoadingFallback = ({ screenId, error = null }) => (
  <ScreenRouteShell screenId={screenId} error={error} />
);

const SCREEN_ROUTE_SHELLS = {
  market: {
    title: "Market",
    eyebrow: "Market workspace",
    detail: "Loading quote context, chart frame, and market activity.",
    lanes: ["Chart", "Activity", "Market context"],
  },
  account: {
    title: "Account",
    eyebrow: "Portfolio workspace",
    detail: "Loading balances, positions, and account charts.",
    lanes: ["Equity curve", "Exposure", "Positions"],
  },
  flow: {
    title: "Flow",
    eyebrow: "Options tape",
    detail: "Loading flow scanner controls and premium charts.",
    lanes: ["Tape", "Premium tide", "Contract detail"],
  },
  signals: {
    title: "Signals",
    eyebrow: "Pyrus Signals",
    detail: "Loading signal monitor state and ticker coverage.",
    lanes: ["Tracked tickers", "Signal matrix", "Coverage"],
  },
  gex: {
    title: "GEX",
    eyebrow: "Gamma workspace",
    detail: "Loading gamma controls and strike profile charts.",
    lanes: ["Strike profile", "Expiry", "Intraday"],
  },
  trade: {
    title: "Trade",
    eyebrow: "Chart workspace",
    detail: "Loading the active spot chart before secondary panels.",
    lanes: ["Spot chart", "Option chain", "Ticket"],
  },
  research: {
    title: "Research",
    eyebrow: "Research workspace",
    detail: "Loading market research, earnings context, and news panels.",
    lanes: ["Research stream", "Earnings", "News"],
  },
  algo: {
    title: "Algo",
    eyebrow: "Automation cockpit",
    detail: "Loading deployment controls, signal candidates, and operations state.",
    lanes: ["Deployments", "Signal candidates", "Operations"],
  },
  backtest: {
    title: "Backtest",
    eyebrow: "Strategy lab",
    detail: "Loading draft strategies, validation tools, and backtest results.",
    lanes: ["Drafts", "Validation", "Results"],
  },
  diagnostics: {
    title: "Diagnostics",
    eyebrow: "System diagnostics",
    detail: "Loading runtime health, API traces, and debugging controls.",
    lanes: ["Runtime", "API traces", "Controls"],
  },
  settings: {
    title: "Settings",
    eyebrow: "Workspace settings",
    detail: "Loading preferences, layout controls, and account configuration.",
    lanes: ["Preferences", "Layout", "Connections"],
  },
};

const ScreenRouteShell = ({ screenId, error = null }) => {
  const shell = SCREEN_ROUTE_SHELLS[screenId];
  if (!shell) {
    return (
      <LogoLoader
        tone="panel"
        label={error ? `Retrying ${screenId}` : `Loading ${screenId}`}
        minHeight="100%"
        testId="screen-loading-fallback"
      />
    );
  }
  // Show the page's structural layout directly — no "Loading <X> route module"
  // takeover header/status. We know each page's shape, so render it immediately
  // and let the real screen swap in the instant its chunk is ready.
  return (
    <section
      data-testid="screen-loading-fallback"
      data-screen-route-shell={screenId}
      aria-busy="true"
      aria-label={error ? `Retrying ${shell.title}` : `Loading ${shell.title}`}
      style={{
        minHeight: "100%",
        display: "grid",
        alignContent: "start",
        gap: 12,
        padding: "16px",
        background: "var(--ra-surface-0)",
        color: "var(--ra-text-primary)",
        fontFamily: "var(--ra-font-sans)",
      }}
    >
      {error ? (
        <div style={{ color: "var(--ra-color-status-warn)", fontSize: 13, lineHeight: 1.35 }}>
          {shell.title} failed to load; retrying…
        </div>
      ) : null}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 8,
          minWidth: 0,
        }}
      >
        {shell.lanes.map((lane, index) => (
          <div
            key={lane}
            style={{
              minHeight: index === 0 ? 180 : 116,
              border: "1px solid var(--ra-border-default)",
              background: "var(--ra-surface-1)",
              borderRadius: 8,
              padding: "10px",
              display: "grid",
              alignContent: "space-between",
              gap: 10,
              minWidth: 0,
            }}
          >
            <div style={{ color: "var(--ra-text-secondary)", fontSize: 12 }}>
              {lane}
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <span
                className="ra-skeleton-shimmer"
                style={{
                  display: "block",
                  width: "72%",
                  height: 8,
                  borderRadius: 4,
                  background: "var(--ra-surface-3)",
                }}
              />
              <span
                className="ra-skeleton-shimmer"
                style={{
                  display: "block",
                  width: "48%",
                  height: 8,
                  borderRadius: 4,
                  background: "var(--ra-surface-3)",
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};

const createPreloadableScreen = (screenId, label) => {
  return function PreloadableScreen(props) {
    const [ScreenComponent, setScreenComponent] = useState(
      () => getPreloadedScreenComponent(screenId),
    );
    const [loadError, setLoadError] = useState(null);

    useEffect(() => {
      if (ScreenComponent || props?.isVisible === false) {
        return undefined;
      }
      const cachedScreenComponent = getPreloadedScreenComponent(screenId);
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
