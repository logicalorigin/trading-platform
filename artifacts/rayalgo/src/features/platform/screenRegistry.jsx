import { memo } from "react";
import { T, sp } from "../../lib/uiTokens.jsx";
import { lazyWithRetry } from "../../lib/dynamicImport";

const MarketScreen = lazyWithRetry(() => import("../../screens/MarketScreen.jsx"), {
  label: "MarketScreen",
});
const FlowScreen = lazyWithRetry(() => import("../../screens/FlowScreen.jsx"), {
  label: "FlowScreen",
});
const GexScreen = lazyWithRetry(() => import("../../screens/GexScreen.jsx"), {
  label: "GexScreen",
});
const TradeScreen = lazyWithRetry(() => import("../../screens/TradeScreen.jsx"), {
  label: "TradeScreen",
});
const AccountScreen = lazyWithRetry(() => import("../../screens/AccountScreen.jsx"), {
  label: "AccountScreen",
});
const ResearchScreen = lazyWithRetry(() => import("../../screens/ResearchScreen.jsx"), {
  label: "ResearchScreen",
});
const AlgoScreen = lazyWithRetry(() => import("../../screens/AlgoScreen.jsx"), {
  label: "AlgoScreen",
});
const BacktestScreen = lazyWithRetry(() => import("../../screens/BacktestScreen.jsx"), {
  label: "BacktestScreen",
});
const DiagnosticsScreen = lazyWithRetry(
  () => import("../../screens/DiagnosticsScreen.jsx"),
  { label: "DiagnosticsScreen" },
);
const SettingsScreen = lazyWithRetry(() => import("../../screens/SettingsScreen.jsx"), {
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

export const OPERATIONAL_SCREEN_PRELOAD_ORDER = ["market", "account", "trade"];

export const SCREEN_RENDER_POLICIES = {
  market: { retainInactive: true },
  trade: { retainInactive: true },
  flow: { retainInactive: false },
  gex: { retainInactive: false },
  account: { retainInactive: false },
  research: { retainInactive: false },
  algo: { retainInactive: false },
  backtest: { retainInactive: false },
  diagnostics: { retainInactive: false },
  settings: { retainInactive: false },
};

export const buildMountedScreenState = (activeScreen) =>
  Object.fromEntries(SCREENS.map(({ id }) => [id, id === activeScreen]));

export const MemoMarketScreen = memo(MarketScreen);
export const MemoFlowScreen = memo(FlowScreen);
export const MemoGexScreen = memo(GexScreen);
export const MemoTradeScreen = memo(TradeScreen);
export const MemoAccountScreen = memo(AccountScreen);
export const MemoResearchScreen = memo(ResearchScreen);
export const MemoAlgoScreen = memo(AlgoScreen);
export const MemoBacktestScreen = memo(BacktestScreen);
export const MemoDiagnosticsScreen = memo(DiagnosticsScreen);
export const MemoSettingsScreen = memo(SettingsScreen);

export const ScreenLoadingFallback = ({ label = "Loading" }) => (
  <div
    data-testid="screen-loading-fallback"
    style={{
      flex: 1,
      minHeight: 0,
      display: "grid",
      gridTemplateRows: "minmax(180px, 44%) 1fr",
      gap: sp(10),
      padding: sp(12),
      background: T.bg0,
      color: T.textDim,
      fontFamily: T.sans,
    }}
  >
    <style>
      {`
        @keyframes rayalgoScreenFallbackPulse {
          0%, 100% { opacity: 0.42; }
          50% { opacity: 0.86; }
        }
      `}
    </style>
    <div
      style={{
        border: `1px solid ${T.border}`,
        background: T.bg1,
        animation: "rayalgoScreenFallbackPulse 1.45s ease-in-out infinite",
      }}
    />
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
        gap: sp(10),
      }}
    >
      {[0, 1, 2].map((index) => (
        <div
          key={index}
          style={{
            border: `1px solid ${T.border}`,
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
