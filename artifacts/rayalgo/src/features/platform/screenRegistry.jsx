import { memo } from "react";
import { T, dim, sp } from "../../lib/uiTokens.jsx";
import { lazyWithRetry, preloadDynamicImport } from "../../lib/dynamicImport";

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

const MarketScreen = lazyWithRetry(SCREEN_LOADERS.market, {
  label: "MarketScreen",
});
const FlowScreen = lazyWithRetry(SCREEN_LOADERS.flow, {
  label: "FlowScreen",
});
const GexScreen = lazyWithRetry(SCREEN_LOADERS.gex, {
  label: "GexScreen",
});
const TradeScreen = lazyWithRetry(SCREEN_LOADERS.trade, {
  label: "TradeScreen",
});
const AccountScreen = lazyWithRetry(SCREEN_LOADERS.account, {
  label: "AccountScreen",
});
const ResearchScreen = lazyWithRetry(SCREEN_LOADERS.research, {
  label: "ResearchScreen",
});
const AlgoScreen = lazyWithRetry(SCREEN_LOADERS.algo, {
  label: "AlgoScreen",
});
const BacktestScreen = lazyWithRetry(SCREEN_LOADERS.backtest, {
  label: "BacktestScreen",
});
const DiagnosticsScreen = lazyWithRetry(SCREEN_LOADERS.diagnostics, {
  label: "DiagnosticsScreen",
});
const SettingsScreen = lazyWithRetry(SCREEN_LOADERS.settings, {
  label: "SettingsScreen",
});

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

export const OPERATIONAL_SCREEN_PRELOAD_ORDER = [
  "market",
  "flow",
  "trade",
  "account",
];

export const SCREEN_RENDER_POLICIES = {
  market: { retainInactive: true },
  trade: { retainInactive: true },
  flow: { retainInactive: true },
  gex: { retainInactive: false },
  account: { retainInactive: true },
  research: { retainInactive: false },
  algo: { retainInactive: false },
  backtest: { retainInactive: false },
  diagnostics: { retainInactive: false },
  settings: { retainInactive: false },
};

export const buildMountedScreenState = (activeScreen) =>
  Object.fromEntries(SCREENS.map(({ id }) => [id, id === activeScreen]));

export const preloadScreenModule = (screenId) => {
  const loader = SCREEN_LOADERS[screenId];
  if (!loader) return;
  preloadDynamicImport(loader, { label: `${screenId}ScreenPreload` });
};

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
  <div
    data-testid="screen-loading-fallback"
    style={{
      flex: 1,
      minHeight: 0,
      display: "grid",
      gridTemplateRows: "minmax(180px, 44%) 1fr",
      gap: sp(14),
      padding: sp(20),
      background: T.bg0,
      color: T.textDim,
      fontFamily: T.sans,
    }}
  >
    <style>
      {`
        @keyframes rayalgoScreenFallbackPulse {
          0%, 100% { opacity: 0.55; }
          50% { opacity: 0.85; }
        }
      `}
    </style>
    <div
      style={{
        border: "none",
        borderRadius: dim(12),
        background: T.bg1,
        animation: "rayalgoScreenFallbackPulse 1.45s ease-in-out infinite",
      }}
    />
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
        gap: sp(14),
      }}
    >
      {[0, 1, 2].map((index) => (
        <div
          key={index}
          style={{
            border: "none",
            borderRadius: dim(12),
            background: T.bg1,
            animation: `rayalgoScreenFallbackPulse ${1.55 + index * 0.12}s ease-in-out infinite`,
          }}
        />
      ))}
    </div>
    <span
      style={{
        position: "absolute",
        width: 1,
        height: 1,
        overflow: "hidden",
        clip: "rect(0 0 0 0)",
      }}
    >
      {label}
    </span>
  </div>
);
