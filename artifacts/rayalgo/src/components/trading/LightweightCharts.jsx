import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  AreaSeries,
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  CrosshairMode,
  HistogramSeries,
  LineStyle,
} from "lightweight-charts";

const DEFAULT_STEP_SECONDS = 60;

// Module-level registry of every live Lightweight Charts instance created from
// this module. Each component effect registers/unregisters itself so we have
// a single source of truth for "what charts are alive right now". This lets
// us proactively dispose orphaned instances when Vite hot-reloads this module
// in development (the React effect cleanup would otherwise miss any chart
// captured by the previous module instance).
const liveChartRegistry = new Set();
const registerChart = (chart) => {
  if (chart) liveChartRegistry.add(chart);
};
const unregisterChart = (chart) => {
  if (!chart) return;
  liveChartRegistry.delete(chart);
  try {
    chart.remove();
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn("[rayalgo] chart disposal failed", error);
    }
  }
};

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    liveChartRegistry.forEach((chart) => {
      try {
        chart.remove();
      } catch (error) {
        // best-effort dispose during hot reload
      }
    });
    liveChartRegistry.clear();
  });
}

const withAlpha = (color, alpha) => (
  typeof color === "string" && /^#[0-9a-fA-F]{6}$/.test(color)
    ? `${color}${alpha}`
    : color
);

const toUnixTime = (value) => {
  if (value instanceof Date) {
    return Math.floor(value.getTime() / 1000);
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 1e12 ? Math.floor(value / 1000) : Math.floor(value);
  }

  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return Math.floor(parsed / 1000);
    }
  }

  return null;
};

const normalizeTimeline = (points, stepSeconds = DEFAULT_STEP_SECONDS) => {
  const safePoints = Array.isArray(points) ? points : [];
  const lastTime = Math.floor(Date.now() / 1000);

  return safePoints.map((point, index) => {
    const fallbackTime = lastTime - (safePoints.length - 1 - index) * stepSeconds;
    const time = toUnixTime(point?.time ?? point?.timestamp ?? point?.t) ?? fallbackTime;
    return { ...(point || {}), time };
  });
};

const createBaseChartOptions = (theme, { compact = false, hideTimeScale = false } = {}) => ({
  autoSize: true,
  attributionLogo: !compact,
  layout: {
    background: { type: ColorType.Solid, color: theme.bg2 },
    textColor: theme.textMuted,
    fontFamily: theme.mono,
  },
  grid: {
    vertLines: { color: withAlpha(theme.border, "30"), visible: !compact },
    horzLines: { color: withAlpha(theme.border, "50"), visible: true },
  },
  crosshair: {
    mode: CrosshairMode.Normal,
    vertLine: {
      color: withAlpha(theme.textMuted, "90"),
      width: 1,
      style: LineStyle.Dashed,
      visible: !compact,
      labelVisible: !compact,
    },
    horzLine: {
      color: withAlpha(theme.textMuted, "90"),
      width: 1,
      style: LineStyle.Dashed,
      visible: !compact,
      labelVisible: !compact,
    },
  },
  rightPriceScale: {
    borderColor: theme.border,
  },
  leftPriceScale: {
    visible: false,
    borderColor: theme.border,
  },
  timeScale: {
    borderColor: theme.border,
    visible: !hideTimeScale,
    timeVisible: !hideTimeScale,
    secondsVisible: false,
    ticksVisible: !compact,
    minBarSpacing: compact ? 1 : 6,
  },
});

const buildAreaSeriesData = (bars, valueKey = "c") => normalizeTimeline(bars).map((bar) => ({
  time: bar.time,
  value: Number(bar?.[valueKey] ?? bar?.value ?? bar?.p ?? 0),
}));

const buildCandleSeriesData = (bars, stepSeconds = 300) => normalizeTimeline(bars, stepSeconds).map((bar) => ({
  time: bar.time,
  open: Number(bar?.o ?? bar?.open ?? bar?.close ?? 0),
  high: Number(bar?.h ?? bar?.high ?? bar?.close ?? 0),
  low: Number(bar?.l ?? bar?.low ?? bar?.close ?? 0),
  close: Number(bar?.c ?? bar?.close ?? bar?.open ?? 0),
}));

const buildVolumeSeriesData = (bars, stepSeconds = 300, colors) => normalizeTimeline(bars, stepSeconds).map((bar) => {
  const open = Number(bar?.o ?? bar?.open ?? bar?.close ?? 0);
  const close = Number(bar?.c ?? bar?.close ?? open);
  const totalVolume = Number(bar?.v ?? bar?.volume ?? 0);
  const unusualRatio = Math.max(0, Math.min(1, Number(bar?.uoa ?? 0)));

  return {
    normal: {
      time: bar.time,
      value: +(totalVolume * (1 - unusualRatio)).toFixed(2),
      color: close >= open ? withAlpha(colors.up, "66") : withAlpha(colors.down, "66"),
    },
    unusual: unusualRatio > 0
      ? {
          time: bar.time,
          value: +(totalVolume * unusualRatio).toFixed(2),
          color: colors.highlight,
        }
      : null,
  };
});

const ChartFallback = ({ theme, message = "chart unavailable" }) => (
  <div
    style={{
      width: "100%",
      height: "100%",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      border: `1px dashed ${theme.border}`,
      borderRadius: 6,
      color: theme.textMuted,
      fontFamily: theme.mono,
      fontSize: 11,
      background: withAlpha(theme.bg3, "80"),
    }}
  >
    {message}
  </div>
);

export const LightweightMiniChart = ({
  theme,
  bars,
  bullish,
  openPrice,
  stepSeconds = 300,
  volumeHeight = 22,
}) => {
  const containerRef = useRef(null);
  const [chartError, setChartError] = useState(null);

  useLayoutEffect(() => {
    if (!containerRef.current || !Array.isArray(bars) || bars.length === 0) {
      return undefined;
    }

    setChartError(null);
    let chart = null;
    try {
      chart = createChart(
        containerRef.current,
        createBaseChartOptions(theme, { compact: true, hideTimeScale: true }),
      );
      registerChart(chart);

      const candleSeries = chart.addSeries(CandlestickSeries, {
        upColor: theme.green,
        downColor: theme.red,
        wickUpColor: theme.green,
        wickDownColor: theme.red,
        borderVisible: false,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      const volumeSeries = chart.addSeries(HistogramSeries, {
        priceScaleId: "",
        priceFormat: { type: "volume" },
        priceLineVisible: false,
        lastValueVisible: false,
      });
      volumeSeries.priceScale().applyOptions({
        scaleMargins: { top: 0.8, bottom: 0 },
      });

      const candleData = buildCandleSeriesData(bars, stepSeconds);
      candleSeries.setData(candleData);
      volumeSeries.setData(normalizeTimeline(bars, stepSeconds).map((bar) => {
        const open = Number(bar?.o ?? bar?.open ?? bar?.close ?? 0);
        const close = Number(bar?.c ?? bar?.close ?? open);
        return {
          time: bar.time,
          value: Number(bar?.v ?? bar?.volume ?? 0),
          color: close >= open
            ? withAlpha(theme.green, "55")
            : withAlpha(theme.red, "55"),
        };
      }));

      if (Number.isFinite(openPrice)) {
        candleSeries.createPriceLine({
          price: openPrice,
          color: withAlpha(theme.textMuted, "a0"),
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: false,
          title: "",
        });
      }

      chart.timeScale().fitContent();
    } catch (error) {
      console.error("LightweightMiniChart init failed", error);
      setChartError(error instanceof Error ? error.message : "chart unavailable");
      unregisterChart(chart);
      chart = null;
    }

    return () => {
      unregisterChart(chart);
      chart = null;
    };
  }, [bars, bullish, openPrice, stepSeconds, theme, volumeHeight]);

  if (chartError) {
    return <ChartFallback theme={theme} message={chartError} />;
  }

  return <div ref={containerRef} style={{ width: "100%", height: "100%" }} />;
};

export const LightweightCandleChart = ({
  theme,
  bars,
  markers = [],
  drawings = [],
  onAddHorizontalLevel,
  drawMode,
  stepSeconds = 300,
  volumeHeight = 52,
}) => {
  const containerRef = useRef(null);
  const [hoverBar, setHoverBar] = useState(null);
  const [chartError, setChartError] = useState(null);

  useLayoutEffect(() => {
    if (!containerRef.current || !Array.isArray(bars) || bars.length === 0) {
      return undefined;
    }

    setChartError(null);
    let chart = null;
    let handleCrosshairMove = null;
    let handleClick = null;

    try {
      chart = createChart(
        containerRef.current,
        createBaseChartOptions(theme, { compact: false, hideTimeScale: false }),
      );
      registerChart(chart);

      const candleData = buildCandleSeriesData(bars, stepSeconds);
      const candleSeries = chart.addSeries(CandlestickSeries, {
        upColor: theme.green,
        downColor: theme.red,
        wickUpColor: theme.green,
        wickDownColor: theme.red,
        borderVisible: false,
        priceLineVisible: false,
      });
      candleSeries.setData(candleData);

      const dayOpen = candleData[0]?.open;
      if (Number.isFinite(dayOpen)) {
        candleSeries.createPriceLine({
          price: dayOpen,
          color: withAlpha(theme.textMuted, "b0"),
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: false,
          title: "",
        });
      }

      const activeDrawings = drawings.filter((drawing) => drawing?.type === "horizontal" && Number.isFinite(drawing?.price));
      activeDrawings.forEach((drawing) => {
        candleSeries.createPriceLine({
          price: drawing.price,
          color: theme.amber,
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: "L",
        });
      });

      try {
        createSeriesMarkers(
          candleSeries,
          markers.flatMap((marker, index) => {
            const targetBar = candleData[marker?.barIdx];
            if (!targetBar) {
              return [];
            }

            const isCall = marker.cp === "C";
            return [{
              id: `flow-${index}`,
              time: targetBar.time,
              position: isCall ? "belowBar" : "aboveBar",
              shape: isCall ? "arrowUp" : "arrowDown",
              color: marker.golden ? theme.amber : isCall ? theme.green : theme.red,
              size: marker.golden ? 1.6 : marker.size === "lg" ? 1.25 : marker.size === "md" ? 1 : 0.8,
              text: marker.golden ? "G" : "",
            }];
          }),
        );
      } catch (error) {
        console.error("LightweightCandleChart markers failed", error);
      }

      handleCrosshairMove = (param) => {
        const seriesData = param.seriesData.get(candleSeries);
        if (!seriesData) {
          setHoverBar(null);
          return;
        }

        setHoverBar(seriesData);
      };

      handleClick = (param) => {
        if (drawMode !== "horizontal" || typeof onAddHorizontalLevel !== "function" || !param.point) {
          return;
        }

        const price = candleSeries.coordinateToPrice(param.point.y);
        if (Number.isFinite(price)) {
          onAddHorizontalLevel(price);
        }
      };

      chart.subscribeCrosshairMove(handleCrosshairMove);
      chart.subscribeClick(handleClick);
      chart.timeScale().fitContent();
    } catch (error) {
      console.error("LightweightCandleChart init failed", error);
      setChartError(error instanceof Error ? error.message : "chart unavailable");
      unregisterChart(chart);
      chart = null;
    }

    return () => {
      if (chart && handleCrosshairMove) {
        try { chart.unsubscribeCrosshairMove(handleCrosshairMove); } catch (e) {}
      }
      if (chart && handleClick) {
        try { chart.unsubscribeClick(handleClick); } catch (e) {}
      }
      unregisterChart(chart);
      chart = null;
    };
  }, [bars, drawings, drawMode, markers, onAddHorizontalLevel, stepSeconds, theme, volumeHeight]);

  const displayBar = hoverBar || (() => {
    const last = bars?.[bars.length - 1];
    if (!last) {
      return null;
    }

    return {
      open: Number(last?.o ?? last?.open ?? last?.close ?? 0),
      high: Number(last?.h ?? last?.high ?? last?.close ?? 0),
      low: Number(last?.l ?? last?.low ?? last?.close ?? 0),
      close: Number(last?.c ?? last?.close ?? last?.open ?? 0),
    };
  })();

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      {chartError ? (
        <ChartFallback theme={theme} message={chartError} />
      ) : (
      <div ref={containerRef} style={{ width: "100%", height: "100%", cursor: drawMode ? "crosshair" : "default" }} />
      )}
      {displayBar && (
        <div
          style={{
            position: "absolute",
            top: 6,
            left: 8,
            background: withAlpha(theme.bg4, "f0"),
            border: `1px solid ${theme.border}`,
            borderRadius: 4,
            padding: "4px 8px",
            fontSize: 11,
            fontFamily: theme.mono,
            color: theme.textSec,
            display: "flex",
            gap: 10,
            pointerEvents: "none",
          }}
        >
          <span>O <span style={{ color: theme.text }}>{displayBar.open.toFixed(2)}</span></span>
          <span>H <span style={{ color: theme.green }}>{displayBar.high.toFixed(2)}</span></span>
          <span>L <span style={{ color: theme.red }}>{displayBar.low.toFixed(2)}</span></span>
          <span>C <span style={{ color: theme.text, fontWeight: 700 }}>{displayBar.close.toFixed(2)}</span></span>
        </div>
      )}
      {drawMode === "horizontal" && (
        <div
          style={{
            position: "absolute",
            top: 6,
            right: 8,
            background: withAlpha(theme.amber, "18"),
            border: `1px solid ${withAlpha(theme.amber, "66")}`,
            borderRadius: 4,
            padding: "3px 8px",
            fontSize: 11,
            fontFamily: theme.mono,
            color: theme.amber,
            pointerEvents: "none",
          }}
        >
          click chart to place level
        </div>
      )}
    </div>
  );
};

export const LightweightAreaPriceChart = ({
  theme,
  points,
  color,
  baselinePrice,
  referencePrice,
  stepSeconds = 300,
}) => {
  const containerRef = useRef(null);
  const [hoverValue, setHoverValue] = useState(null);
  const [chartError, setChartError] = useState(null);

  useLayoutEffect(() => {
    if (!containerRef.current || !Array.isArray(points) || points.length === 0) {
      return undefined;
    }

    setChartError(null);
    let chart = null;
    let handleCrosshairMove = null;
    try {
      chart = createChart(
        containerRef.current,
        createBaseChartOptions(theme, { compact: false, hideTimeScale: false }),
      );
      registerChart(chart);

      const areaSeries = chart.addSeries(AreaSeries, {
        lineColor: color,
        topColor: withAlpha(color, "38"),
        bottomColor: withAlpha(color, "05"),
        lineWidth: 2,
        priceLineVisible: false,
      });
      const areaData = normalizeTimeline(points, stepSeconds).map((point) => ({
        time: point.time,
        value: Number(point?.p ?? point?.value ?? point?.c ?? 0),
      }));
      areaSeries.setData(areaData);

      [baselinePrice, referencePrice].filter((price) => Number.isFinite(price)).forEach((price, index) => {
        areaSeries.createPriceLine({
          price,
          color: index === 0 ? withAlpha(theme.textMuted, "a0") : theme.amber,
          lineWidth: index === 0 ? 1 : 2,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: index === 0 ? "" : "ENTRY",
        });
      });

      handleCrosshairMove = (param) => {
        const seriesData = param.seriesData.get(areaSeries);
        setHoverValue(Number.isFinite(seriesData?.value) ? seriesData.value : null);
      };

      chart.subscribeCrosshairMove(handleCrosshairMove);
      chart.timeScale().fitContent();
    } catch (error) {
      console.error("LightweightAreaPriceChart init failed", error);
      setChartError(error instanceof Error ? error.message : "chart unavailable");
      unregisterChart(chart);
      chart = null;
    }

    return () => {
      if (chart && handleCrosshairMove) {
        try { chart.unsubscribeCrosshairMove(handleCrosshairMove); } catch (e) {}
      }
      unregisterChart(chart);
      chart = null;
    };
  }, [baselinePrice, color, points, referencePrice, stepSeconds, theme]);

  const lastPoint = points?.[points.length - 1];
  const displayValue = Number.isFinite(hoverValue) ? hoverValue : Number(lastPoint?.p ?? lastPoint?.value ?? lastPoint?.c ?? 0);

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      {chartError ? (
        <ChartFallback theme={theme} message={chartError} />
      ) : (
        <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
      )}
      {Number.isFinite(displayValue) && (
        <div
          style={{
            position: "absolute",
            top: 6,
            left: 8,
            background: withAlpha(theme.bg4, "f0"),
            border: `1px solid ${theme.border}`,
            borderRadius: 4,
            padding: "3px 8px",
            fontSize: 11,
            fontFamily: theme.mono,
            color,
            fontWeight: 700,
            pointerEvents: "none",
          }}
        >
          ${displayValue.toFixed(2)}
        </div>
      )}
    </div>
  );
};
