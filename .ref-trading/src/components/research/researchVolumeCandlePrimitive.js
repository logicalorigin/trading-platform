import {
  buildEquivolumeLayout,
  buildVolumeBarGeometry,
  buildVolumeCandleGeometry,
  resolveDisplayVolumeWidthPx,
} from "./researchVolumeCandleUtils.js";

const EMPTY_PANE_VIEWS = [];
const DEFAULT_VOLUME_BULL = "rgba(34,197,94,0.26)";
const DEFAULT_VOLUME_BEAR = "rgba(239,68,68,0.26)";

function resolveVisibleIndexRange(timeScale, barCount) {
  const visibleLogicalRange = timeScale?.getVisibleLogicalRange?.();
  if (!visibleLogicalRange || !barCount) {
    return null;
  }

  const startIndex = Math.max(0, Math.floor(Number(visibleLogicalRange.from) || 0));
  const endIndex = Math.min(
    barCount - 1,
    Math.ceil(Number(visibleLogicalRange.to) || (barCount - 1)),
  );
  if (endIndex < startIndex) {
    return null;
  }

  return { startIndex, endIndex };
}

function resolveVisibleLayout(state) {
  const chart = state.chart;
  const timeScale = chart?.timeScale?.();
  if (!state.visible || !timeScale || !state.candleData.length) {
    return null;
  }

  const visibleIndexRange = resolveVisibleIndexRange(timeScale, state.candleData.length);
  if (!visibleIndexRange) {
    return null;
  }

  const { startIndex, endIndex } = visibleIndexRange;
  const visibleBars = state.candleData.slice(startIndex, endIndex + 1);
  if (!visibleBars.length) {
    return null;
  }

  const leftCenter = Number(timeScale.logicalToCoordinate(startIndex));
  const rightCenter = Number(timeScale.logicalToCoordinate(endIndex));
  if (!Number.isFinite(leftCenter) || !Number.isFinite(rightCenter)) {
    return null;
  }

  const leftNeighbor = startIndex > 0 ? Number(timeScale.logicalToCoordinate(startIndex - 1)) : null;
  const rightNeighbor = endIndex < (state.candleData.length - 1) ? Number(timeScale.logicalToCoordinate(endIndex + 1)) : null;
  const fallbackSlotWidth = visibleBars.length > 1
    ? Math.abs(rightCenter - leftCenter) / Math.max(1, visibleBars.length - 1)
    : 8;
  const leftSlotWidth = Number.isFinite(leftNeighbor) ? Math.abs(leftCenter - leftNeighbor) : fallbackSlotWidth;
  const rightSlotWidth = Number.isFinite(rightNeighbor) ? Math.abs(rightNeighbor - rightCenter) : fallbackSlotWidth;
  const left = leftCenter - (Math.max(1, leftSlotWidth) / 2);
  const right = rightCenter + (Math.max(1, rightSlotWidth) / 2);
  const volumes = visibleBars.map((bar) => Number(state.volumeByTime.get(bar?.time)) || 0);

  return {
    bars: visibleBars,
    layout: buildEquivolumeLayout(visibleBars, {
      volumes,
      left,
      right,
      gapPx: state.gapPx,
      minWidthPx: state.minWidthPx,
    }),
  };
}

function drawPricePane(target, state) {
  const series = state.series;
  const resolvedLayout = resolveVisibleLayout(state);
  if (!series || !resolvedLayout?.layout?.length) {
    return;
  }

  target.useMediaCoordinateSpace(({ context: ctx }) => {
    ctx.save();
    for (const entry of resolvedLayout.layout) {
      const candle = entry.bar;
      if (!candle) {
        continue;
      }
      const displayWidth = resolveDisplayVolumeWidthPx(entry.width, {
        minDisplayWidthPx: state.minDisplayWidthPx,
      });

      const geometry = buildVolumeCandleGeometry({
        x: entry.centerX - (displayWidth / 2),
        openY: series.priceToCoordinate(candle.open),
        highY: series.priceToCoordinate(candle.high),
        lowY: series.priceToCoordinate(candle.low),
        closeY: series.priceToCoordinate(candle.close),
        widthPx: displayWidth,
        minBodyHeightPx: state.minBodyHeightPx,
      });
      if (!geometry) {
        continue;
      }

      const color = candle.close >= candle.open ? state.upColor : state.downColor;
      ctx.strokeStyle = color;
      ctx.lineWidth = geometry.wickWidth;
      ctx.beginPath();
      ctx.moveTo(geometry.wickX, geometry.wickTop);
      ctx.lineTo(geometry.wickX, geometry.wickBottom);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.fillRect(geometry.bodyLeft, geometry.bodyTop, geometry.bodyWidth, geometry.bodyHeight);
    }
    ctx.restore();
  });
}

function drawVolumePane(target, state) {
  const series = state.series;
  const resolvedLayout = resolveVisibleLayout(state);
  if (!series || !resolvedLayout?.layout?.length) {
    return;
  }

  target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
    const paneBottomY = Number(mediaSize?.height) || 0;
    if (!(paneBottomY > 0)) {
      return;
    }

    ctx.save();
    for (const entry of resolvedLayout.layout) {
      const candle = entry.bar;
      if (!candle) {
        continue;
      }
      const displayWidth = resolveDisplayVolumeWidthPx(entry.width, {
        minDisplayWidthPx: state.minDisplayWidthPx,
      });

      const geometry = buildVolumeBarGeometry({
        x: entry.centerX - (displayWidth / 2),
        widthPx: displayWidth,
        volumeY: series.priceToCoordinate(entry.volume),
        paneBottomY,
      });
      if (!geometry) {
        continue;
      }

      ctx.fillStyle = candle.close >= candle.open ? state.volumeUpColor : state.volumeDownColor;
      ctx.fillRect(geometry.left, geometry.top, geometry.width, geometry.height);
    }
    ctx.restore();
  });
}

export function createVolumeCandlePrimitive(options = {}) {
  const state = {
    chart: null,
    series: null,
    requestUpdate: null,
    pane: options.pane === "volume" ? "volume" : "price",
    candleData: [],
    volumeByTime: new Map(),
    visible: Boolean(options.visible),
    gapPx: Math.max(0, Number(options.gapPx) || 1),
    minWidthPx: Math.max(1, Number(options.minWidthPx) || 2),
    minDisplayWidthPx: Math.max(1, Number(options.minDisplayWidthPx) || 2),
    minBodyHeightPx: Math.max(1, Number(options.minBodyHeightPx) || 2),
    upColor: String(options.upColor || "#22c55e"),
    downColor: String(options.downColor || "#ef4444"),
    volumeUpColor: String(options.volumeUpColor || DEFAULT_VOLUME_BULL),
    volumeDownColor: String(options.volumeDownColor || DEFAULT_VOLUME_BEAR),
  };

  const renderer = {
    draw(target) {
      if (state.pane === "volume") {
        drawVolumePane(target, state);
        return;
      }
      drawPricePane(target, state);
    },
  };

  const paneView = {
    zOrder() {
      return "top";
    },
    renderer() {
      return state.visible && state.candleData.length ? renderer : null;
    },
  };

  return {
    attached(param) {
      state.chart = param?.chart || null;
      state.series = param?.series || null;
      state.requestUpdate = typeof param?.requestUpdate === "function" ? param.requestUpdate : null;
    },
    detached() {
      state.chart = null;
      state.series = null;
      state.requestUpdate = null;
    },
    updateAllViews() {
      // Rendering reads directly from chart viewport state.
    },
    paneViews() {
      return state.visible ? [paneView] : EMPTY_PANE_VIEWS;
    },
    applyOptions(nextOptions = {}) {
      if (Object.prototype.hasOwnProperty.call(nextOptions, "visible")) {
        state.visible = Boolean(nextOptions.visible);
      }
      if (typeof nextOptions.upColor === "string" && nextOptions.upColor) {
        state.upColor = nextOptions.upColor;
      }
      if (typeof nextOptions.downColor === "string" && nextOptions.downColor) {
        state.downColor = nextOptions.downColor;
      }
      if (typeof nextOptions.volumeUpColor === "string" && nextOptions.volumeUpColor) {
        state.volumeUpColor = nextOptions.volumeUpColor;
      }
      if (typeof nextOptions.volumeDownColor === "string" && nextOptions.volumeDownColor) {
        state.volumeDownColor = nextOptions.volumeDownColor;
      }
      if (Object.prototype.hasOwnProperty.call(nextOptions, "minDisplayWidthPx")) {
        state.minDisplayWidthPx = Math.max(1, Number(nextOptions.minDisplayWidthPx) || 2);
      }
      if (Object.prototype.hasOwnProperty.call(nextOptions, "minBodyHeightPx")) {
        state.minBodyHeightPx = Math.max(1, Number(nextOptions.minBodyHeightPx) || 2);
      }
      state.requestUpdate?.();
    },
    setData(candleData = [], volumeByTime = new Map(), nextOptions = {}) {
      state.candleData = Array.isArray(candleData) ? candleData : [];
      state.volumeByTime = volumeByTime instanceof Map ? volumeByTime : new Map();
      this.applyOptions(nextOptions);
    },
  };
}
