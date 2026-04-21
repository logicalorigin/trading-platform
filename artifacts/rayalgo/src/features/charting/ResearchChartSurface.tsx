import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  PriceScaleMode,
} from "lightweight-charts";
import type { ChartModel, StudySpec } from "./types";

type ResearchChartTheme = {
  bg2: string;
  bg3: string;
  bg4: string;
  border: string;
  text: string;
  textMuted: string;
  green: string;
  red: string;
  amber: string;
  accent?: string;
  mono: string;
};

type HoverBar = {
  open: number;
  high: number;
  low: number;
  close: number;
};

type ResearchChartSurfaceProps = {
  model: ChartModel;
  theme: ResearchChartTheme;
  themeKey: string;
  drawings?: Array<{ type?: string; price?: number }>;
  referenceLines?: Array<{
    price: number;
    color?: string;
    title?: string;
    lineWidth?: number;
    axisLabelVisible?: boolean;
  }>;
  drawMode?: string | null;
  onAddHorizontalLevel?: (price: number) => void;
};

type StudyRegistryEntry = {
  paneIndex: number;
  seriesType: StudySpec["seriesType"];
  series: any;
};

const withAlpha = (color: string, alpha: string): string => (
  /^#[0-9a-fA-F]{6}$/.test(color)
    ? `${color}${alpha}`
    : color
);

const buildChartOptions = (theme: ResearchChartTheme) => ({
  autoSize: true,
  layout: {
    background: { type: ColorType.Solid, color: theme.bg2 },
    textColor: theme.textMuted,
    fontFamily: theme.mono,
  },
  grid: {
    vertLines: { color: withAlpha(theme.border, "30"), visible: true },
    horzLines: { color: withAlpha(theme.border, "50"), visible: true },
  },
  crosshair: {
    mode: CrosshairMode.Normal,
    vertLine: {
      color: withAlpha(theme.textMuted, "90"),
      width: 1,
      style: LineStyle.Dashed,
      visible: true,
      labelVisible: true,
    },
    horzLine: {
      color: withAlpha(theme.textMuted, "90"),
      width: 1,
      style: LineStyle.Dashed,
      visible: true,
      labelVisible: true,
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
    visible: true,
    timeVisible: true,
    secondsVisible: false,
    ticksVisible: true,
    minBarSpacing: 6,
  },
});

const SERIES_TYPE_MAP = {
  line: LineSeries,
  histogram: HistogramSeries,
} satisfies Record<StudySpec["seriesType"], typeof LineSeries | typeof HistogramSeries>;

const syncStudySeries = (
  chart: any,
  registry: Record<string, StudyRegistryEntry>,
  specs: StudySpec[],
): Record<string, StudyRegistryEntry> => {
  const nextRegistry = { ...registry };
  const nextKeys = new Set(specs.map((spec) => spec.key));

  specs.forEach((spec) => {
    const existing = nextRegistry[spec.key];
    const SeriesCtor = SERIES_TYPE_MAP[spec.seriesType];
    const seriesData = spec.data.map((point) => (
      point.color
        ? { time: point.time, value: point.value, color: point.color }
        : { time: point.time, value: point.value }
    ));

    if (
      !existing ||
      existing.paneIndex !== spec.paneIndex ||
      existing.seriesType !== spec.seriesType
    ) {
      if (existing) {
        chart.removeSeries(existing.series);
      }

      const series = chart.addSeries(SeriesCtor, spec.options, spec.paneIndex);
      series.setData(seriesData);

      nextRegistry[spec.key] = {
        series,
        paneIndex: spec.paneIndex,
        seriesType: spec.seriesType,
      };
      return;
    }

    existing.series.applyOptions(spec.options);
    existing.series.setData(seriesData);
  });

  Object.keys(nextRegistry).forEach((key) => {
    if (nextKeys.has(key)) {
      return;
    }

    chart.removeSeries(nextRegistry[key].series);
    delete nextRegistry[key];
  });

  return nextRegistry;
};

export const ResearchChartSurface = ({
  model,
  theme,
  themeKey,
  drawings = [],
  referenceLines = [],
  drawMode = null,
  onAddHorizontalLevel,
}: ResearchChartSurfaceProps) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<any>(null);
  const candleSeriesRef = useRef<any>(null);
  const lineSeriesRef = useRef<any>(null);
  const volumeSeriesRef = useRef<any>(null);
  const candleMarkerApiRef = useRef<any>(null);
  const lineMarkerApiRef = useRef<any>(null);
  const studyRegistryRef = useRef<Record<string, StudyRegistryEntry>>({});
  const visibleLogicalRangeRef = useRef<any>(null);
  const initializedRangeRef = useRef(false);
  const drawingLinesRef = useRef<{ candle: any[]; line: any[] }>({ candle: [], line: [] });
  const activePriceSeriesRef = useRef<any>(null);
  const barLookupRef = useRef<Map<number, HoverBar>>(new Map());
  const interactionRef = useRef({
    drawMode,
    onAddHorizontalLevel,
  });
  const [hoverBar, setHoverBar] = useState<HoverBar | null>(null);
  const [chartError, setChartError] = useState<string | null>(null);
  const [baseSeriesType, setBaseSeriesType] = useState<"candles" | "line">("candles");
  const [showVolume, setShowVolume] = useState(true);
  const [scaleMode, setScaleMode] = useState<"linear" | "log">("linear");

  useEffect(() => {
    interactionRef.current = {
      drawMode,
      onAddHorizontalLevel,
    };
  }, [drawMode, onAddHorizontalLevel]);

  useEffect(() => {
    barLookupRef.current = new Map(
      model.chartBars.map((bar) => [
        bar.time,
        {
          open: bar.o,
          high: bar.h,
          low: bar.l,
          close: bar.c,
        },
      ]),
    );
  }, [model.chartBars]);

  useEffect(() => {
    activePriceSeriesRef.current = baseSeriesType === "line"
      ? (lineSeriesRef.current || candleSeriesRef.current)
      : candleSeriesRef.current;
  }, [baseSeriesType]);

  useLayoutEffect(() => {
    if (!containerRef.current || !model.chartBars.length) {
      return undefined;
    }

    let chart: any = null;
    let handleVisibleRangeChange: ((range: any) => void) | null = null;
    let handleCrosshairMove: ((param: any) => void) | null = null;
    let handleClick: ((param: any) => void) | null = null;

    try {
      setChartError(null);
      chart = createChart(containerRef.current, buildChartOptions(theme) as any);

      const candleSeries = chart.addSeries(CandlestickSeries, {
        upColor: theme.green,
        downColor: theme.red,
        wickUpColor: theme.green,
        wickDownColor: theme.red,
        borderVisible: false,
        priceLineVisible: false,
      });
      const lineSeries = chart.addSeries(LineSeries, {
        color: theme.accent || theme.text,
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
        visible: false,
      });
      const volumeSeries = chart.addSeries(HistogramSeries, {
        priceScaleId: "",
        priceFormat: { type: "volume" },
        priceLineVisible: false,
        lastValueVisible: false,
      });

      volumeSeries.priceScale().applyOptions({
        scaleMargins: { top: 0.78, bottom: 0 },
      });

      candleMarkerApiRef.current = createSeriesMarkers(candleSeries, []);
      lineMarkerApiRef.current = createSeriesMarkers(lineSeries, []);
      chartRef.current = chart;
      candleSeriesRef.current = candleSeries;
      lineSeriesRef.current = lineSeries;
      volumeSeriesRef.current = volumeSeries;
      activePriceSeriesRef.current = candleSeries;

      handleVisibleRangeChange = (range: any) => {
        visibleLogicalRangeRef.current = range;
      };
      handleCrosshairMove = (param: any) => {
        const rawTime = param?.time;
        const time = typeof rawTime === "number" ? rawTime : null;
        if (time == null) {
          setHoverBar(null);
          return;
        }

        const bar = barLookupRef.current.get(time);
        setHoverBar(bar || null);
      };
      handleClick = (param: any) => {
        if (
          interactionRef.current.drawMode !== "horizontal" ||
          typeof interactionRef.current.onAddHorizontalLevel !== "function" ||
          !param?.point
        ) {
          return;
        }

        const price = activePriceSeriesRef.current?.coordinateToPrice?.(param.point.y);
        if (typeof price === "number" && Number.isFinite(price)) {
          interactionRef.current.onAddHorizontalLevel(price);
        }
      };

      chart.timeScale().subscribeVisibleLogicalRangeChange(handleVisibleRangeChange);
      chart.subscribeCrosshairMove(handleCrosshairMove);
      chart.subscribeClick(handleClick);
    } catch (error) {
      setChartError(error instanceof Error ? error.message : "chart unavailable");
      if (chart) {
        chart.remove();
      }
      chart = null;
    }

    return () => {
      if (chart && handleVisibleRangeChange) {
        chart.timeScale().unsubscribeVisibleLogicalRangeChange(handleVisibleRangeChange);
      }
      if (chart && handleCrosshairMove) {
        chart.unsubscribeCrosshairMove(handleCrosshairMove);
      }
      if (chart && handleClick) {
        chart.unsubscribeClick(handleClick);
      }
      if (chart) {
        chart.remove();
      }

      chartRef.current = null;
      candleSeriesRef.current = null;
      lineSeriesRef.current = null;
      volumeSeriesRef.current = null;
      candleMarkerApiRef.current = null;
      lineMarkerApiRef.current = null;
      studyRegistryRef.current = {};
      drawingLinesRef.current = { candle: [], line: [] };
      activePriceSeriesRef.current = null;
      visibleLogicalRangeRef.current = null;
      initializedRangeRef.current = false;
    };
  }, [model.chartBars.length, theme, themeKey]);

  useLayoutEffect(() => {
    if (!chartRef.current || !candleSeriesRef.current || !lineSeriesRef.current || !volumeSeriesRef.current) {
      return;
    }

    const candleSeries = candleSeriesRef.current;
    const lineSeries = lineSeriesRef.current;
    const volumeSeries = volumeSeriesRef.current;

    candleSeries.setData(model.chartBars.map((bar) => ({
      time: bar.time,
      open: bar.o,
      high: bar.h,
      low: bar.l,
      close: bar.c,
      color: bar.color,
      borderColor: bar.borderColor,
      wickColor: bar.wickColor,
    })));
    lineSeries.setData(model.chartBars.map((bar) => ({
      time: bar.time,
      value: bar.c,
    })));
    volumeSeries.setData(showVolume ? model.chartBars.map((bar) => ({
      time: bar.time,
      value: bar.v,
      color: bar.c >= bar.o
        ? withAlpha(theme.green, "55")
        : withAlpha(theme.red, "55"),
    })) : []);

    candleSeries.applyOptions({ visible: baseSeriesType === "candles" });
    lineSeries.applyOptions({
      visible: baseSeriesType === "line",
      color: theme.accent || theme.text,
    });
    volumeSeries.applyOptions({ visible: showVolume });
    chartRef.current.priceScale("right").applyOptions({
      mode: scaleMode === "log" ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal,
    });
    activePriceSeriesRef.current = baseSeriesType === "line" ? lineSeries : candleSeries;

    if (visibleLogicalRangeRef.current) {
      chartRef.current.timeScale().setVisibleLogicalRange(visibleLogicalRangeRef.current);
      return;
    }

    if (!initializedRangeRef.current && model.defaultVisibleLogicalRange) {
      chartRef.current.timeScale().setVisibleLogicalRange(model.defaultVisibleLogicalRange);
      initializedRangeRef.current = true;
      return;
    }

    chartRef.current.timeScale().fitContent();
    initializedRangeRef.current = true;
  }, [
    baseSeriesType,
    model.chartBars,
    model.defaultVisibleLogicalRange,
    scaleMode,
    showVolume,
    theme.accent,
    theme.green,
    theme.red,
    theme.text,
  ]);

  useLayoutEffect(() => {
    if (!chartRef.current) {
      return;
    }

    studyRegistryRef.current = syncStudySeries(
      chartRef.current,
      studyRegistryRef.current,
      model.studySpecs,
    );
  }, [model.studySpecs]);

  useLayoutEffect(() => {
    if (!candleMarkerApiRef.current || !lineMarkerApiRef.current) {
      return;
    }

    const markers = model.indicatorMarkerPayload.overviewMarkers.map((marker) => ({
      time: marker.time,
      position: marker.position,
      shape: marker.shape,
      color: marker.color,
      text: marker.text,
      size: marker.size,
    }));
    candleMarkerApiRef.current.setMarkers(markers);
    lineMarkerApiRef.current.setMarkers(markers);
  }, [model.indicatorMarkerPayload]);

  useLayoutEffect(() => {
    if (!candleSeriesRef.current || !lineSeriesRef.current) {
      return;
    }

    const candleSeries = candleSeriesRef.current;
    const lineSeries = lineSeriesRef.current;
    drawingLinesRef.current.candle.forEach((line) => candleSeries.removePriceLine(line));
    drawingLinesRef.current.line.forEach((line) => lineSeries.removePriceLine(line));
    drawingLinesRef.current = { candle: [], line: [] };

    const addPriceLine = (series: any, lineConfig: any, key: "candle" | "line") => {
      drawingLinesRef.current[key].push(series.createPriceLine(lineConfig));
    };

    const sessionOpen = model.chartBars[0]?.o;
    if (typeof sessionOpen === "number" && Number.isFinite(sessionOpen)) {
      const sessionLine = {
        price: sessionOpen,
        color: withAlpha(theme.textMuted, "b0"),
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: false,
        title: "",
      };
      addPriceLine(candleSeries, sessionLine, "candle");
      addPriceLine(lineSeries, sessionLine, "line");
    }

    drawings
      .filter((drawing) => drawing?.type === "horizontal" && Number.isFinite(drawing?.price))
      .forEach((drawing) => {
        const drawingLine = {
          price: Number(drawing.price),
          color: theme.amber,
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: "L",
        };
        addPriceLine(candleSeries, drawingLine, "candle");
        addPriceLine(lineSeries, drawingLine, "line");
      });

    referenceLines
      .filter((line) => typeof line?.price === "number" && Number.isFinite(line.price))
      .forEach((line) => {
        const referenceLine = {
          price: line.price,
          color: line.color || theme.amber,
          lineWidth: line.lineWidth ?? 2,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: line.axisLabelVisible ?? true,
          title: line.title || "",
        };
        addPriceLine(candleSeries, referenceLine, "candle");
        addPriceLine(lineSeries, referenceLine, "line");
      });
  }, [drawings, model.chartBars, referenceLines, theme.amber, theme.textMuted]);

  const displayBar = hoverBar || (() => {
    const lastBar = model.chartBars[model.chartBars.length - 1];
    if (!lastBar) {
      return null;
    }

    return {
      open: lastBar.o,
      high: lastBar.h,
      low: lastBar.l,
      close: lastBar.c,
    };
  })();

  if (!model.chartBars.length) {
    return (
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
        no live chart data
      </div>
    );
  }

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      <div
        style={{
          position: "absolute",
          top: 6,
          right: 8,
          zIndex: 3,
          display: "flex",
          gap: 4,
        }}
      >
        {[
          { key: "candles", label: "CND", active: baseSeriesType === "candles", onClick: () => setBaseSeriesType("candles") },
          { key: "line", label: "LINE", active: baseSeriesType === "line", onClick: () => setBaseSeriesType("line") },
          { key: "volume", label: "VOL", active: showVolume, onClick: () => setShowVolume((value) => !value) },
          { key: "scale", label: scaleMode === "log" ? "LOG" : "LIN", active: scaleMode === "log", onClick: () => setScaleMode((value) => value === "log" ? "linear" : "log") },
          { key: "fit", label: "FIT", active: false, onClick: () => chartRef.current?.timeScale?.().fitContent?.() },
        ].map((control) => (
          <button
            key={control.key}
            type="button"
            onClick={control.onClick}
            style={{
              border: `1px solid ${control.active ? withAlpha(theme.accent || theme.text, "aa") : theme.border}`,
              background: control.active ? withAlpha(theme.accent || theme.text, "18") : withAlpha(theme.bg4, "f0"),
              color: control.active ? (theme.accent || theme.text) : theme.textMuted,
              borderRadius: 4,
              padding: "2px 7px",
              fontSize: 10,
              fontFamily: theme.mono,
              cursor: "pointer",
            }}
          >
            {control.label}
          </button>
        ))}
      </div>
      {chartError ? (
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
          {chartError}
        </div>
      ) : (
        <div
          ref={containerRef}
          style={{ width: "100%", height: "100%", cursor: drawMode ? "crosshair" : "default" }}
        />
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
            color: theme.text,
            display: "flex",
            gap: 10,
            pointerEvents: "none",
          }}
        >
          <span>O <span>{displayBar.open.toFixed(2)}</span></span>
          <span>H <span style={{ color: theme.green }}>{displayBar.high.toFixed(2)}</span></span>
          <span>L <span style={{ color: theme.red }}>{displayBar.low.toFixed(2)}</span></span>
          <span>C <span style={{ fontWeight: 700 }}>{displayBar.close.toFixed(2)}</span></span>
        </div>
      )}
      {drawMode === "horizontal" && (
        <div
          style={{
            position: "absolute",
            top: 34,
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
