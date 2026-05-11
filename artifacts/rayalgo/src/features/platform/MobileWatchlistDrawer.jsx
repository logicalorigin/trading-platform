import { Drawer } from "../../components/platform/Drawer.jsx";
import { T, dim } from "../../lib/uiTokens.jsx";

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
    >
      <div
        style={{
          minHeight: "100%",
          background: T.bg0,
          borderLeft: `1px solid ${T.border}`,
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
          />
        </div>
      </div>
    </Drawer>
  );
};

export default MobileWatchlistDrawer;
