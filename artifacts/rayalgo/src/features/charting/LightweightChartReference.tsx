import { useLayoutEffect, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
} from "lightweight-charts";
import type { ChartModel, StudySpec } from "./types";
import { registerChart, unregisterChart } from "./chartLifecycle";

type ResearchChartTheme = {
  bg2: string;
  bg3: string;
  border: string;
  text: string;
  textMuted: string;
  green: string;
  red: string;
  mono: string;
};

type LightweightChartReferenceProps = {
  model: ChartModel;
  theme: ResearchChartTheme;
  dataTestId?: string;
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
    const seriesData = spec.data.map((point) => {
      if (!Number.isFinite(point.value)) {
        return { time: point.time };
      }

      return point.color
        ? { time: point.time, value: point.value, color: point.color }
        : { time: point.time, value: point.value };
    });

    if (!existing || existing.paneIndex !== spec.paneIndex || existing.seriesType !== spec.seriesType) {
      if (existing?.series) {
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

export const LightweightChartReference = ({
  model,
  theme,
  dataTestId,
}: LightweightChartReferenceProps) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const registryRef = useRef<Record<string, StudyRegistryEntry>>({});
  const [chartError, setChartError] = useState<string | null>(null);

  useLayoutEffect(() => {
    if (!containerRef.current || !model.chartBars.length) {
      return undefined;
    }

    let chart: any = null;

    try {
      setChartError(null);
      chart = createChart(containerRef.current, {
        autoSize: true,
        layout: {
          background: { type: ColorType.Solid, color: theme.bg2 },
          textColor: theme.textMuted,
          fontFamily: theme.mono,
          attributionLogo: true,
        },
        grid: {
          vertLines: { color: withAlpha(theme.border, "30"), visible: true },
          horzLines: { color: withAlpha(theme.border, "50"), visible: true },
        },
        crosshair: {
          mode: CrosshairMode.MagnetOHLC,
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
        timeScale: {
          borderColor: theme.border,
          timeVisible: true,
          secondsVisible: false,
          rightBarStaysOnScroll: true,
          lockVisibleTimeRangeOnResize: true,
        },
      });
      registerChart(chart);

      const candleSeries = chart.addSeries(CandlestickSeries, {
        upColor: theme.green,
        downColor: theme.red,
        wickUpColor: theme.green,
        wickDownColor: theme.red,
        borderVisible: false,
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

      candleSeries.setData(model.chartBars.map((bar) => ({
        time: bar.time,
        open: bar.o,
        high: bar.h,
        low: bar.l,
        close: bar.c,
        color: bar.color,
        wickColor: bar.wickColor,
        borderColor: bar.borderColor,
      })));
      volumeSeries.setData(model.chartBars.map((bar) => ({
        time: bar.time,
        value: bar.v,
        color: bar.c >= bar.o ? withAlpha(theme.green, "55") : withAlpha(theme.red, "55"),
      })));

      registryRef.current = syncStudySeries(chart, registryRef.current, model.studySpecs);

      createSeriesMarkers(
        candleSeries,
        model.indicatorMarkerPayload.overviewMarkers.map((marker) => ({
          time: marker.time,
          position: marker.position,
          shape: marker.shape,
          color: marker.color,
          text: marker.text,
          size: marker.size,
        })),
      );

      chart.timeScale().fitContent();
    } catch (error) {
      setChartError(error instanceof Error ? error.message : "reference unavailable");
      unregisterChart(chart);
      chart = null;
    }

    return () => {
      unregisterChart(chart);
      chart = null;
      registryRef.current = {};
    };
  }, [model, theme]);

  if (!model.chartBars.length) {
    return (
      <div
        data-testid={dataTestId}
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
          background: withAlpha(theme.bg3, "70"),
        }}
      >
        no fixture bars available
      </div>
    );
  }

  if (chartError) {
    return (
      <div
        data-testid={dataTestId}
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
          background: withAlpha(theme.bg3, "70"),
        }}
      >
        {chartError}
      </div>
    );
  }

  return <div ref={containerRef} data-testid={dataTestId} style={{ width: "100%", height: "100%" }} />;
};
