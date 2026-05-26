import { memo, useEffect, useState } from "react";
import LogoLoader from "../../components/LogoLoader";
import { retryDynamicImport } from "../../lib/dynamicImport";

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

const SCREEN_ROUTE_SHELL_LABELS = {
  market: {
    title: "Market Pulse",
    sections: ["Breadth", "Watchlist", "Charts"],
  },
  flow: {
    title: "Options Flow",
    sections: ["Tape", "Filters", "Premium"],
  },
  gex: {
    title: "GEX",
    sections: ["Exposure", "Walls", "Expirations"],
  },
  trade: {
    title: "Trade",
    sections: ["Ticket", "Chain", "Execution"],
  },
  account: {
    title: "Account",
    sections: ["Equity", "Positions", "Orders"],
  },
  research: {
    title: "Research",
    sections: ["Universe", "Themes", "Thesis"],
  },
  algo: {
    title: "Algo",
    sections: ["Signals", "Actions", "Risk"],
  },
  backtest: {
    title: "Backtest",
    sections: ["Strategy", "Runs", "Results"],
  },
  diagnostics: {
    title: "Diagnostics",
    sections: ["Health", "Latency", "Runtime"],
  },
  settings: {
    title: "Settings",
    sections: ["Profile", "Runtime", "Preferences"],
  },
};

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
      throw error;
    });

  SCREEN_MODULE_PRELOADS.set(screenId, promise);
  return promise;
};

const RouteScreenShell = ({ screenId, error = null }) => {
  const copy = SCREEN_ROUTE_SHELL_LABELS[screenId] || {
    title: screenId,
    sections: ["Workspace", "Data", "Actions"],
  };
  return (
    <div
      data-testid={`screen-route-shell-${screenId}`}
      aria-busy={error ? "false" : "true"}
      style={{
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        display: "grid",
        gridTemplateRows: "auto minmax(0, 1fr)",
        gap: "12px",
        padding: "16px 24px",
        background: "var(--ra-surface-0)",
        color: "var(--ra-text-primary)",
        fontFamily: "var(--ra-font-sans)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "12px",
          minWidth: 0,
        }}
      >
        <div style={{ display: "grid", gap: "3px", minWidth: 0 }}>
          <span
            style={{
              color: "var(--ra-text-secondary)",
              fontSize: "10px",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            {error ? "Route load interrupted" : "Preparing workspace"}
          </span>
          <span
            style={{
              color: "var(--ra-text-primary)",
              fontSize: "16px",
              fontWeight: 600,
              lineHeight: 1.2,
            }}
          >
            {copy.title}
          </span>
        </div>
        <span
          style={{
            flex: "0 0 auto",
            minHeight: "22px",
            display: "inline-flex",
            alignItems: "center",
            padding: "0 8px",
            border: "1px solid var(--ra-border-light)",
            color: error ? "var(--ra-red-500)" : "var(--ra-text-dim)",
            fontSize: "10px",
            textTransform: "uppercase",
          }}
        >
          {error ? "Retrying" : "Loading"}
        </span>
      </div>
      <div
        style={{
          minWidth: 0,
          minHeight: 0,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: "8px",
        }}
      >
        {copy.sections.map((section) => (
          <div
            key={section}
            style={{
              minHeight: "160px",
              border: "1px solid var(--ra-border-default)",
              background: "var(--ra-surface-1)",
              display: "grid",
              alignContent: "start",
              gap: "10px",
              padding: "12px",
              overflow: "hidden",
            }}
          >
            <span
              style={{
                color: "var(--ra-text-secondary)",
                fontSize: "10px",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              {section}
            </span>
            {[0, 1, 2, 3].map((index) => (
              <span
                key={index}
                style={{
                  display: "block",
                  width: `${92 - index * 13}%`,
                  height: "8px",
                  background: "var(--ra-surface-3)",
                  opacity: 0.62,
                }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
};

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

    return ScreenComponent ? (
      <ScreenComponent {...props} />
    ) : (
      <RouteScreenShell screenId={screenId} error={loadError} />
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

export const ScreenLoadingFallback = ({ label = "Loading" }) => (
  <LogoLoader
    tone="panel"
    label={label}
    minHeight="100%"
    testId="screen-loading-fallback"
  />
);
