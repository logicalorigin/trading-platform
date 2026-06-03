import {
  Suspense,
  lazy,
  useEffect,
} from "react";
import {
  CSS_COLOR,
  T,
  dim,
  fs,
  sp,
} from "../lib/uiTokens";
import { retryDynamicImport } from "../lib/dynamicImport";

let backtestingPanelsImport = null;
const loadBacktestingPanels = () => {
  if (!backtestingPanelsImport) {
    backtestingPanelsImport = retryDynamicImport(
      () => import("../features/backtesting/BacktestingPanels"),
      { label: "BacktestingPanels" },
    ).catch((error) => {
      backtestingPanelsImport = null;
      throw error;
    });
  }
  return backtestingPanelsImport;
};

const LazyAlgoDraftStrategiesPanel = lazy(() =>
  loadBacktestingPanels().then((module) => ({
    default: module.AlgoDraftStrategiesPanel,
  })),
);
const LazyBacktestWorkspace = lazy(() =>
  loadBacktestingPanels().then((module) => ({
    default: module.BacktestWorkspace,
  })),
);

export const preloadScreenModules = () => loadBacktestingPanels();

const BacktestWorkspaceFallback = () => (
  <div
    data-testid="backtest-workspace"
    aria-hidden="true"
    style={{
      minHeight: dim(360),
      borderRadius: dim(8),
      background: CSS_COLOR.bg1,
    }}
  />
);

const BacktestDraftStrategiesFallback = () => (
  <div
    data-testid="backtest-draft-strategies-fallback"
    aria-hidden="true"
    style={{
      minHeight: dim(180),
      borderRadius: dim(8),
      background: CSS_COLOR.bg1,
    }}
  />
);

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
      <Suspense fallback={<BacktestDraftStrategiesFallback />}>
        <LazyAlgoDraftStrategiesPanel
          theme={T}
          scale={{ fs, sp, dim }}
          isVisible={isVisible}
        />
      </Suspense>
      <Suspense fallback={<BacktestWorkspaceFallback />}>
        <LazyBacktestWorkspace
          theme={T}
          scale={{ fs, sp, dim }}
          watchlists={watchlists}
          defaultWatchlistId={defaultWatchlistId}
          isVisible={isVisible}
        />
      </Suspense>
    </div>
  );
};

export default BacktestScreen;
