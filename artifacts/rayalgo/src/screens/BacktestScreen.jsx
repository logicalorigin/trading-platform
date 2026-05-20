import {
  AlgoDraftStrategiesPanel,
  BacktestWorkspace,
} from "../features/backtesting/BacktestingPanels";
import { useEffect } from "react";
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
  onReadinessChange,
}) => {
  useEffect(() => {
    onReadinessChange?.({
      criticalReady: Boolean(isVisible),
      derivedReady: Boolean(isVisible),
      backgroundAllowed: Boolean(isVisible),
    });
  }, [isVisible, onReadinessChange]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: sp(10),
        minWidth: 0,
      }}
    >
      <AlgoDraftStrategiesPanel
        theme={T}
        scale={{ fs, sp, dim }}
        isVisible={isVisible}
      />
      <BacktestWorkspace
        theme={T}
        scale={{ fs, sp, dim }}
        watchlists={watchlists}
        defaultWatchlistId={defaultWatchlistId}
        isVisible={isVisible}
      />
    </div>
  );
};

export default BacktestScreen;
