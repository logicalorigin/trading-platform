import { Drawer } from "../../components/platform/Drawer.jsx";
import { T, dim } from "../../lib/uiTokens.jsx";

const CSS_COLOR = Object.freeze({
  bg0: "var(--ra-surface-0)",
  bg1: "var(--ra-surface-1)",
  bg2: "var(--ra-surface-2)",
  bg3: "var(--ra-surface-3)",
  bg4: "var(--ra-surface-4)",
  border: "var(--ra-border-default)",
  borderLight: "var(--ra-border-light)",
  borderFocus: "var(--ra-border-focus)",
  text: "var(--ra-text-primary)",
  textSec: "var(--ra-text-secondary)",
  textDim: "var(--ra-text-dim)",
  textMuted: "var(--ra-text-muted)",
  accent: "var(--ra-color-accent)",
  accentDim: "var(--ra-accent-dim)",
  accentHoverBg: "var(--ra-accent-hover-bg)",
  accentActiveBg: "var(--ra-accent-active-bg)",
  blue: "var(--ra-blue-500)",
  purple: "var(--ra-purple-500)",
  cyan: "var(--ra-cyan-500)",
  pink: "var(--ra-pink-500)",
  green: "var(--ra-green-500)",
  greenDim: "var(--ra-green-dim)",
  greenBg: "var(--ra-green-bg)",
  red: "var(--ra-red-500)",
  redDim: "var(--ra-red-dim)",
  redBg: "var(--ra-red-bg)",
  amber: "var(--ra-amber-500)",
  amberDim: "var(--ra-amber-dim)",
  amberBg: "var(--ra-amber-bg)",
  pulseLive: "var(--ra-green-500)",
  pulseAlert: "var(--ra-amber-500)",
  pulseLoss: "var(--ra-red-500)",
  onAccent: "var(--ra-on-accent)",
});

export const MobileWatchlistDrawer = ({
  open,
  onClose,
  WatchlistComponent,
  activeWatchlist,
  watchlistSymbols,
  signalMonitorStates,
  signalMatrixStates,
  selectedSymbol,
  onSelectSymbol,
  onFocusMarketChart,
  onSelectWatchlist,
  onCreateWatchlist,
  onRenameWatchlist,
  onDeleteWatchlist,
  onSetDefaultWatchlist,
  onAddSymbolToWatchlist,
  onReorderSymbolInWatchlist,
  onRemoveSymbolFromWatchlist,
  onSignalAction,
  watchlists,
  watchlistsBusy,
}) => {
  const handleSymbolSelect = (...args) => {
    onSelectSymbol?.(...args);
    onClose?.();
  };
  const handleChartFocus = (...args) => {
    onFocusMarketChart?.(...args);
    onClose?.();
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      side="right"
      title={activeWatchlist?.name ? `Watchlist · ${activeWatchlist.name}` : "Watchlist"}
      width={380}
      testId="mobile-watchlist-drawer"
      fullBleed
    >
      <div
        style={{
          minHeight: "100%",
          background: CSS_COLOR.bg0,
          borderLeft: `1px solid ${CSS_COLOR.border}`,
        }}
      >
        <div style={{ minHeight: dim(540) }}>
          <WatchlistComponent
            watchlists={watchlists}
            activeWatchlist={activeWatchlist}
            watchlistSymbols={watchlistSymbols}
            signalStates={signalMonitorStates}
            signalMatrixStates={signalMatrixStates}
            selected={selectedSymbol}
            onSelect={handleSymbolSelect}
            onChartFocus={handleChartFocus}
            onSelectWatchlist={onSelectWatchlist}
            onCreateWatchlist={onCreateWatchlist}
            onRenameWatchlist={onRenameWatchlist}
            onDeleteWatchlist={onDeleteWatchlist}
            onSetDefaultWatchlist={onSetDefaultWatchlist}
            onAddSymbol={onAddSymbolToWatchlist}
            onReorderSymbol={onReorderSymbolInWatchlist}
            onRemoveSymbol={onRemoveSymbolFromWatchlist}
            onSignalAction={onSignalAction}
            busy={Boolean(watchlistsBusy?.mutating)}
            density="mobile-dense"
          />
        </div>
      </div>
    </Drawer>
  );
};

export default MobileWatchlistDrawer;
