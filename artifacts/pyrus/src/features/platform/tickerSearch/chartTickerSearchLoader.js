import { lazyWithRetry, preloadDynamicImport } from "../../../lib/dynamicImport";

const loadChartTickerSearchModule = () => import("./ChartTickerSearch.jsx");

let chartTickerSearchPreloadPromise = null;

const preloadChartTickerSearchModule = (label) => {
  if (!chartTickerSearchPreloadPromise) {
    chartTickerSearchPreloadPromise = preloadDynamicImport(
      loadChartTickerSearchModule,
      { label },
    ).then((module) => {
      if (!module) {
        chartTickerSearchPreloadPromise = null;
      }
      return module;
    });
  }
  return chartTickerSearchPreloadPromise;
};

export const loadMarketChartTickerSearch = () =>
  loadChartTickerSearchModule().then((module) => ({
    default: module.MarketChartTickerSearch,
  }));

export const loadMiniChartTickerSearch = () =>
  loadChartTickerSearchModule().then((module) => ({
    default: module.MiniChartTickerSearch,
  }));

export const preloadMarketChartTickerSearch = () =>
  preloadChartTickerSearchModule("MarketChartTickerSearch");

export const preloadMiniChartTickerSearch = () =>
  preloadChartTickerSearchModule("TradeMiniChartTickerSearch");

export const preloadWatchlistTickerSearch = () =>
  preloadChartTickerSearchModule("WatchlistTickerSearch");

export const scheduleChartTickerSearchPreload = (
  preload = preloadMarketChartTickerSearch,
) => {
  if (typeof window === "undefined") {
    preload();
    return undefined;
  }

  let cancelled = false;
  const timeoutId = window.setTimeout(() => {
    if (!cancelled) {
      preload();
    }
  }, 0);

  return () => {
    cancelled = true;
    window.clearTimeout(timeoutId);
  };
};

export const LazyMarketChartTickerSearch = lazyWithRetry(
  loadMarketChartTickerSearch,
  { label: "MarketChartTickerSearch" },
);

export const LazyMiniChartTickerSearch = lazyWithRetry(
  loadMiniChartTickerSearch,
  { label: "TradeMiniChartTickerSearch" },
);

export const LazyWatchlistTickerSearch = lazyWithRetry(
  loadMarketChartTickerSearch,
  { label: "WatchlistTickerSearch" },
);
