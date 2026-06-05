import {
  Suspense,
  lazy,
  useEffect,
  useState,
} from "react";
import {
  CSS_COLOR,
  T,
  dim,
  fs,
  sp,
} from "../lib/uiTokens";
import { retryDynamicImport } from "../lib/dynamicImport";

const BACKTEST_PANEL_HYDRATION_DELAY_MS = 650;

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

export const preloadScreenModules = () => Promise.resolve();

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
  const [panelsHydrationReady, setPanelsHydrationReady] = useState(false);

  useEffect(() => {
    onReadinessChange?.({
      criticalReady: Boolean(isVisible),
      derivedReady: Boolean(isVisible),
      backgroundAllowed: Boolean(isVisible),
    });
  }, [isVisible, onReadinessChange]);

  useEffect(() => {
    if (!isVisible || panelsHydrationReady) {
      return undefined;
    }

    const hydrationTimer = window.setTimeout(
      () => setPanelsHydrationReady(true),
      BACKTEST_PANEL_HYDRATION_DELAY_MS,
    );
    return () => window.clearTimeout(hydrationTimer);
  }, [isVisible, panelsHydrationReady]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: sp(10),
        minWidth: 0,
      }}
    >
      {panelsHydrationReady ? (
        <Suspense fallback={<BacktestDraftStrategiesFallback />}>
          <LazyAlgoDraftStrategiesPanel
            theme={T}
            scale={{ fs, sp, dim }}
            isVisible={isVisible}
          />
        </Suspense>
      ) : (
        <BacktestDraftStrategiesFallback />
      )}
      {panelsHydrationReady ? (
        <Suspense fallback={<BacktestWorkspaceFallback />}>
          <LazyBacktestWorkspace
            theme={T}
            scale={{ fs, sp, dim }}
            watchlists={watchlists}
            defaultWatchlistId={defaultWatchlistId}
            isVisible={isVisible}
          />
        </Suspense>
      ) : (
        <BacktestWorkspaceFallback />
      )}
    </div>
  );
};

export default BacktestScreen;
