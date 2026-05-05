import {
  BacktestWorkspace,
} from "../features/backtesting/BacktestingPanels";
import {
  T,
  dim,
  fs,
  sp,
} from "../lib/uiTokens";

export const BacktestScreen = ({
  watchlists,
  defaultWatchlistId,
  isVisible = false,
  onJumpToTrade,
}) => (
  <BacktestWorkspace
    theme={T}
    scale={{ fs, sp, dim }}
    watchlists={watchlists}
    defaultWatchlistId={defaultWatchlistId}
    isVisible={isVisible}
    onJumpToTrade={onJumpToTrade}
  />
);

export default BacktestScreen;
