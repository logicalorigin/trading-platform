import {
  memo,
  useEffect,
  useLayoutEffect,
  useRef,
} from "react";
import {
  AreaSeries,
  BaselineSeries,
  ColorType,
  CrosshairMode,
  LineSeries,
  LineStyle,
  PriceScaleMode,
  createChart,
} from "lightweight-charts";
import {
  CSS_COLOR,
  THEMES,
  PYRUS_WORKSPACE_SETTINGS_EVENT,
  T,
  dim,
} from "../../lib/uiTokens.jsx";
import { TYPE_PX } from "../../lib/typography";
import {
  resolveCanvasAlphaColor,
  resolveCanvasColor,
} from "../../features/charting/chartCanvasColors";
import { formatAccountMoney, formatAccountSignedMoney } from "./accountUtils";

const NAV_PRICE_SCALE_ID = "left";
const BENCHMARK_PRICE_SCALE_ID = "right";

const chartColor = resolveCanvasColor;
const chartColorAlpha = resolveCanvasAlphaColor;

export const sliceFiniteSeries = (data, valueKey) => {
  const pointsBySecond = new Map(
    data
      .map((point) => {
        if (point?.[valueKey] == null || point?.timestampMs == null) return null;
        const value = Number(point?.[valueKey]);
        const timestampMs = Number(point?.timestampMs);
        if (!Number.isFinite(value) || !Number.isFinite(timestampMs)) return null;
        return { timestampMs, time: Math.floor(timestampMs / 1000), value };
      })
      .filter(Boolean)
      .sort((left, right) => left.timestampMs - right.timestampMs)
      .map((point) => [point.time, { time: point.time, value: point.value }]),
  );

  return [...pointsBySecond.values()].sort((left, right) => left.time - right.time);
};

const buildPriceFormatter = (chartMode, currency, maskValues) => (value) =>
  chartMode === "pnl"
    ? formatAccountSignedMoney(value, currency, true, maskValues)
    : formatAccountMoney(value, currency, true, maskValues);

const buildPercentFormatter = () => (value) => {
  if (value == null || Number.isNaN(Number(value))) return "—";
  const numeric = Number(value);
  return `${numeric >= 0 ? "+" : "−"}${Math.abs(numeric).toFixed(1)}%`;
};

const buildChartOptions = ({ compact }) => ({
  // Canvas autowidth protocol (matches ResearchChartSurface.tsx:3442):
  // lightweight-charts' own ResizeObserver fills the container on every
  // viewport/page-width change. Replaces the prior manual
  // getBoundingClientRect -> chart.resize() path, which went stale (sized to
  // the wrong width inside its container) -- the same pattern RCS abandoned.
  autoSize: true,
  layout: {
    background: { type: ColorType.Solid, color: chartColor(CSS_COLOR.bg1, THEMES.dark.bg1) },
    textColor: chartColor(CSS_COLOR.textMuted, THEMES.dark.textMuted),
    fontFamily: T.sans,
    fontSize: compact ? TYPE_PX.micro : TYPE_PX.label,
    attributionLogo: false,
  },
  grid: {
    vertLines: { visible: false },
    horzLines: { color: chartColor(CSS_COLOR.borderLight, THEMES.dark.borderLight), style: LineStyle.Solid, visible: true },
  },
  crosshair: {
    mode: CrosshairMode.Magnet,
    vertLine: {
      color: chartColor(CSS_COLOR.textMuted, THEMES.dark.textMuted),
      width: 1,
      style: LineStyle.Solid,
      visible: true,
      labelVisible: true,
      labelBackgroundColor: chartColor(CSS_COLOR.bg2, THEMES.dark.bg2),
    },
    horzLine: {
      color: chartColor(CSS_COLOR.textMuted, THEMES.dark.textMuted),
      width: 1,
      style: LineStyle.Dashed,
      visible: true,
      labelVisible: true,
      labelBackgroundColor: chartColor(CSS_COLOR.bg2, THEMES.dark.bg2),
    },
  },
  leftPriceScale: {
    visible: true,
    borderVisible: false,
    ticksVisible: false,
    textColor: chartColor(CSS_COLOR.textMuted, THEMES.dark.textMuted),
    minimumWidth: compact ? 48 : 64,
    scaleMargins: { top: 0.12, bottom: 0.08 },
    mode: PriceScaleMode.Normal,
  },
  rightPriceScale: {
    visible: false,
    borderVisible: false,
    ticksVisible: false,
    textColor: chartColor(CSS_COLOR.textMuted, THEMES.dark.textMuted),
    minimumWidth: compact ? 36 : 48,
    scaleMargins: { top: 0.12, bottom: 0.08 },
    mode: PriceScaleMode.Normal,
  },
  timeScale: {
    borderVisible: false,
    ticksVisible: false,
    visible: true,
    timeVisible: true,
    secondsVisible: false,
    rightOffset: compact ? 2 : 4,
    minBarSpacing: 0.1,
    lockVisibleTimeRangeOnResize: true,
  },
  handleScroll: false,
  handleScale: false,
});

// Fields shared by the NAV (area) and PnL (baseline) price series. Each builder
// spreads this then adds/overrides its own series-type-specific options.
const buildPriceSeriesBase = (chartMode, currency, maskValues) => ({
  priceScaleId: NAV_PRICE_SCALE_ID,
  lineWidth: 2,
  priceLineVisible: false,
  lastValueVisible: true,
  crosshairMarkerVisible: true,
  crosshairMarkerRadius: 4,
  crosshairMarkerBorderColor: chartColor(CSS_COLOR.bg1, THEMES.dark.bg1),
  priceFormat: {
    type: "custom",
    formatter: buildPriceFormatter(chartMode, currency, maskValues),
    minMove: 0.01,
  },
});

const buildNavSeriesOptions = (accentColor, currency, maskValues, chartMode) => {
  const resolvedAccent = chartColor(accentColor, THEMES.dark.accent);
  return {
    ...buildPriceSeriesBase(chartMode, currency, maskValues),
    lineColor: resolvedAccent,
    topColor: chartColorAlpha(accentColor, "48", THEMES.dark.accent),
    bottomColor: chartColorAlpha(accentColor, "05", THEMES.dark.accent),
    lineType: 0,
    crosshairMarkerBackgroundColor: resolvedAccent,
  };
};

const buildPnlSeriesOptions = (currency, maskValues, chartMode) => ({
  ...buildPriceSeriesBase(chartMode, currency, maskValues),
  baseValue: { type: "price", price: 0 },
  topLineColor: chartColor(CSS_COLOR.green, THEMES.dark.green),
  topFillColor1: chartColorAlpha(CSS_COLOR.green, "3b", THEMES.dark.green),
  topFillColor2: chartColorAlpha(CSS_COLOR.green, "05", THEMES.dark.green),
  bottomLineColor: chartColor(CSS_COLOR.red, THEMES.dark.red),
  bottomFillColor1: chartColorAlpha(CSS_COLOR.red, "05", THEMES.dark.red),
  bottomFillColor2: chartColorAlpha(CSS_COLOR.red, "3b", THEMES.dark.red),
});

const buildBenchmarkSeriesOptions = (benchmark) => ({
  priceScaleId: BENCHMARK_PRICE_SCALE_ID,
  color: chartColor(benchmark.color, THEMES.dark.accent),
  lineWidth: 1.5,
  lineStyle: LineStyle.Dashed,
  priceLineVisible: false,
  lastValueVisible: false,
  crosshairMarkerVisible: false,
  priceFormat: {
    type: "custom",
    formatter: buildPercentFormatter(),
    minMove: 0.01,
  },
});

const EquityCurveChartInner = ({
  data,
  chartMode,
  benchmarks,
  visibleBenchmarks,
  availableBenchmarkKeys,
  accentColor,
  currency,
  maskValues,
  compact,
  height,
  onHoverPoint,
  onClickPoint,
  onChartReady,
}) => {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const mainSeriesRef = useRef(null);
  const mainSeriesModeRef = useRef(null);
  const benchmarkSeriesMapRef = useRef(new Map());
  const dataRef = useRef([]);
  dataRef.current = data;

  useLayoutEffect(() => {
    if (!containerRef.current) return undefined;
    const chart = createChart(
      containerRef.current,
      buildChartOptions({ compact }),
    );
    chartRef.current = chart;

    // autoSize:true (see buildChartOptions) lets lightweight-charts' own
    // ResizeObserver size the canvas to the container on every viewport/page
    // resize; no manual getBoundingClientRect -> chart.resize() needed.
    onChartReady?.(chart);

    return () => {
      try {
        chart.remove();
      } catch (error) {
        // ignore disposal errors during HMR
      }
      chartRef.current = null;
      mainSeriesRef.current = null;
      mainSeriesModeRef.current = null;
      benchmarkSeriesMapRef.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.applyOptions(buildChartOptions({ compact }));
  }, [compact, currency, maskValues, chartMode]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const applyTheme = () => {
      const chart = chartRef.current;
      if (!chart) return;
      chart.applyOptions(buildChartOptions({ compact }));
      if (mainSeriesRef.current) {
        if (mainSeriesModeRef.current === "nav") {
          mainSeriesRef.current.applyOptions(buildNavSeriesOptions(accentColor, currency, maskValues, chartMode));
        } else {
          mainSeriesRef.current.applyOptions(buildPnlSeriesOptions(currency, maskValues, chartMode));
        }
      }
      benchmarkSeriesMapRef.current.forEach((series, key) => {
        const benchmark = benchmarks.find((entry) => entry.key === key);
        if (benchmark) series.applyOptions(buildBenchmarkSeriesOptions(benchmark));
      });
    };
    window.addEventListener(PYRUS_WORKSPACE_SETTINGS_EVENT, applyTheme);
    return () => {
      window.removeEventListener(PYRUS_WORKSPACE_SETTINGS_EVENT, applyTheme);
    };
  }, [accentColor, benchmarks, chartMode, compact, currency, maskValues]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const valueKey = chartMode === "pnl" ? "cumulativePnl" : "netLiquidation";
    const seriesData = sliceFiniteSeries(data, valueKey);

    if (mainSeriesModeRef.current !== chartMode) {
      if (mainSeriesRef.current) {
        try {
          chart.removeSeries(mainSeriesRef.current);
        } catch (error) {
          // ignore stale removal
        }
        mainSeriesRef.current = null;
      }
      const seriesApi =
        chartMode === "pnl"
          ? chart.addSeries(BaselineSeries, buildPnlSeriesOptions(currency, maskValues, chartMode))
          : chart.addSeries(AreaSeries, buildNavSeriesOptions(accentColor, currency, maskValues, chartMode));
      mainSeriesRef.current = seriesApi;
      mainSeriesModeRef.current = chartMode;
    } else if (mainSeriesRef.current) {
      mainSeriesRef.current.applyOptions(
        chartMode === "pnl"
          ? buildPnlSeriesOptions(currency, maskValues, chartMode)
          : buildNavSeriesOptions(accentColor, currency, maskValues, chartMode),
      );
    }

    if (mainSeriesRef.current) {
      mainSeriesRef.current.setData(seriesData);
      if (seriesData.length) {
        chart.timeScale().fitContent();
      }
    }
  }, [accentColor, chartMode, currency, data, maskValues]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const desired = new Map();
    benchmarks.forEach((benchmark) => {
      if (!visibleBenchmarks[benchmark.key]) return;
      if (!availableBenchmarkKeys.has(benchmark.key)) return;
      desired.set(benchmark.key, benchmark);
    });

    benchmarkSeriesMapRef.current.forEach((series, key) => {
      if (desired.has(key)) return;
      try {
        chart.removeSeries(series);
      } catch (error) {
        // ignore stale removal
      }
      benchmarkSeriesMapRef.current.delete(key);
    });

    desired.forEach((benchmark, key) => {
      let series = benchmarkSeriesMapRef.current.get(key);
      if (!series) {
        series = chart.addSeries(LineSeries, buildBenchmarkSeriesOptions(benchmark));
        benchmarkSeriesMapRef.current.set(key, series);
      } else {
        series.applyOptions(buildBenchmarkSeriesOptions(benchmark));
      }
      series.setData(sliceFiniteSeries(data, benchmark.dataKey));
    });

    const hasBenchmark = desired.size > 0;
    chart.priceScale(BENCHMARK_PRICE_SCALE_ID).applyOptions({
      visible: hasBenchmark,
      autoScale: true,
    });
    chart.applyOptions({
      rightPriceScale: { visible: hasBenchmark },
    });
  }, [availableBenchmarkKeys, benchmarks, data, visibleBenchmarks]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !onHoverPoint) return undefined;
    const handler = (param) => {
      if (!param || param.time == null) {
        onHoverPoint(null);
        return;
      }
      const targetTimestampMs = Number(param.time) * 1000;
      const points = dataRef.current;
      if (!points?.length) {
        onHoverPoint(null);
        return;
      }
      let nearest = null;
      let nearestDelta = Infinity;
      for (let index = 0; index < points.length; index += 1) {
        const point = points[index];
        const delta = Math.abs(point.timestampMs - targetTimestampMs);
        if (delta < nearestDelta) {
          nearestDelta = delta;
          nearest = point;
        }
      }
      onHoverPoint(nearest);
    };
    chart.subscribeCrosshairMove(handler);
    return () => {
      try {
        chart.unsubscribeCrosshairMove(handler);
      } catch (error) {
        // ignore unsubscribe errors during HMR
      }
    };
  }, [onHoverPoint]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !onClickPoint) return undefined;
    const handler = (param) => {
      if (!param || param.time == null) return;
      const targetTimestampMs = Number(param.time) * 1000;
      const points = dataRef.current;
      if (!points?.length) return;
      let nearest = null;
      let nearestDelta = Infinity;
      for (let index = 0; index < points.length; index += 1) {
        const point = points[index];
        const delta = Math.abs(point.timestampMs - targetTimestampMs);
        if (delta < nearestDelta) {
          nearestDelta = delta;
          nearest = point;
        }
      }
      if (nearest) onClickPoint(nearest);
    };
    chart.subscribeClick(handler);
    return () => {
      try {
        chart.unsubscribeClick(handler);
      } catch (error) {
        // ignore unsubscribe errors during HMR
      }
    };
  }, [onClickPoint]);

  return (
    <div
      ref={containerRef}
      style={{ width: "100%", height: dim(height) }}
    />
  );
};

export const EquityCurveChart = memo(EquityCurveChartInner);
EquityCurveChart.displayName = "EquityCurveChart";

export default EquityCurveChart;
