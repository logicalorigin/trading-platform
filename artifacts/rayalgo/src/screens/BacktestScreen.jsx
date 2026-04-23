import {
  BacktestWorkspace,
} from "../features/backtesting/BacktestingPanels";
import {
  T,
  dim,
  fs,
  sp,
} from "../RayAlgoPlatform";

export const BacktestScreen = ({ watchlists, defaultWatchlistId }) => (
  <BacktestWorkspace
    theme={T}
    scale={{ fs, sp, dim }}
    watchlists={watchlists}
    defaultWatchlistId={defaultWatchlistId}
  />
);

export default BacktestScreen;
