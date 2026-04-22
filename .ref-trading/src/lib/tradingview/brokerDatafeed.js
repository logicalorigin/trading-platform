import { getMarketBars, getSpotQuote } from "../brokerClient.js";

const SUPPORTED_RESOLUTIONS = ["1", "3", "5", "15", "30", "60", "120", "240", "1D", "1W"];

export function createBrokerTradingViewDatafeed({ accountId = null, getAccountId, defaultSymbol = "SPY" } = {}) {
  const subscriptions = new Map();
  const realtimeStreams = new Map();
  const lastBarsByKey = new Map();

  function resolveAccountId() {
    if (typeof getAccountId === "function") {
      const value = getAccountId();
      if (value) {
        return value;
      }
    }
    return accountId || undefined;
  }

  function releaseSubscription(subscriberUID) {
    const subscription = subscriptions.get(subscriberUID);
    if (!subscription) {
      return;
    }
    subscriptions.delete(subscriberUID);
    const stream = realtimeStreams.get(subscription.streamKey);
    if (!stream) {
      return;
    }
    stream.callbacks.delete(subscriberUID);
    if (stream.callbacks.size === 0) {
      if (stream.timerId) {
        clearInterval(stream.timerId);
      }
      realtimeStreams.delete(subscription.streamKey);
      lastBarsByKey.delete(subscription.streamKey);
    }
  }

  return {
    onReady(callback) {
      setTimeout(() => {
        callback({
          supports_search: true,
          supports_group_request: false,
          supports_marks: false,
          supports_timescale_marks: false,
          supports_time: true,
          supported_resolutions: SUPPORTED_RESOLUTIONS,
        });
      }, 0);
    },

    searchSymbols(userInput, exchange, symbolType, onResultReadyCallback) {
      const requested = String(userInput || "").trim();
      const symbol = extractMarketSymbol(requested || defaultSymbol);
      const tvSymbol = normalizeTvSymbol(symbol);
      onResultReadyCallback([
        {
          symbol: tvSymbol,
          full_name: tvSymbol,
          description: `${symbol} broker feed`,
          exchange: "AMEX",
          ticker: tvSymbol,
          type: "stock",
        },
      ]);
    },

    resolveSymbol(symbolName, onSymbolResolvedCallback, onResolveErrorCallback) {
      try {
        const symbol = extractMarketSymbol(symbolName || defaultSymbol);
        const tvSymbol = normalizeTvSymbol(symbol);
        onSymbolResolvedCallback({
          name: symbol,
          ticker: tvSymbol,
          full_name: tvSymbol,
          description: `${symbol} (Broker live feed)`,
          exchange: "AMEX",
          listed_exchange: "AMEX",
          type: "stock",
          session: "0930-1600",
          timezone: "America/New_York",
          minmov: 1,
          pricescale: 100,
          has_intraday: true,
          has_daily: true,
          has_weekly_and_monthly: true,
          volume_precision: 0,
          supported_resolutions: SUPPORTED_RESOLUTIONS,
          data_status: "streaming",
        });
      } catch (error) {
        onResolveErrorCallback(error?.message || "Failed to resolve symbol");
      }
    },

    async getBars(symbolInfo, resolution, periodParams, onHistoryCallback, onErrorCallback) {
      try {
        const symbol = extractMarketSymbol(symbolInfo?.ticker || symbolInfo?.name || defaultSymbol);
        const normalizedResolution = normalizeResolution(resolution);
        const account = resolveAccountId();
        const response = await getMarketBars({
          accountId: account,
          symbol,
          resolution: normalizedResolution,
          from: periodParams?.from,
          to: periodParams?.to,
          countBack: periodParams?.countBack,
        });

        const bars = (response?.bars || [])
          .map((bar) => ({
            time: toEpochMs(bar.time),
            open: Number(bar.open),
            high: Number(bar.high),
            low: Number(bar.low),
            close: Number(bar.close),
            volume: Number(bar.volume || 0),
          }))
          .filter((bar) => Number.isFinite(bar.time) && Number.isFinite(bar.open) && Number.isFinite(bar.close))
          .sort((a, b) => a.time - b.time);

        if (!bars.length) {
          onHistoryCallback([], { noData: true });
          return;
        }

        const cacheKey = buildBarKey(symbol, normalizedResolution);
        lastBarsByKey.set(cacheKey, bars[bars.length - 1]);

        onHistoryCallback(bars, { noData: false });
      } catch (error) {
        onErrorCallback(error?.message || "Failed to load historical bars");
      }
    },

    subscribeBars(
      symbolInfo,
      resolution,
      onRealtimeCallback,
      subscriberUID,
      _onResetCacheNeededCallback,
    ) {
      const symbol = extractMarketSymbol(symbolInfo?.ticker || symbolInfo?.name || defaultSymbol);
      const normalizedResolution = normalizeResolution(resolution);
      const streamKey = buildBarKey(symbol, normalizedResolution);
      let stream = realtimeStreams.get(streamKey);
      if (!stream) {
        const intervalMs = resolutionToMs(normalizedResolution);
        const pollMs = resolveRealtimePollMs(normalizedResolution);
        stream = {
          streamKey,
          symbol,
          intervalMs,
          pollMs,
          callbacks: new Map(),
          inFlight: false,
          timerId: null,
          poll: null,
        };
        stream.poll = async () => {
          if (stream.inFlight) {
            return;
          }
          if (typeof document !== "undefined" && document.visibilityState === "hidden") {
            return;
          }
          stream.inFlight = true;
          try {
            const quote = await getSpotQuote({
              accountId: resolveAccountId(),
              symbol: stream.symbol,
            });
            const last = Number(quote?.last);
            if (!Number.isFinite(last)) {
              return;
            }

            const bucket = Math.floor(Date.now() / stream.intervalMs) * stream.intervalMs;
            const previous = lastBarsByKey.get(stream.streamKey);

            let nextBar;
            if (!previous) {
              nextBar = {
                time: bucket,
                open: last,
                high: last,
                low: last,
                close: last,
                volume: estimateTickVolume(last, last),
              };
            } else if (previous.time === bucket) {
              nextBar = {
                ...previous,
                high: Math.max(previous.high, last),
                low: Math.min(previous.low, last),
                close: last,
                volume: Number(previous.volume || 0) + estimateTickVolume(last, previous.close),
              };
            } else if (previous.time < bucket) {
              nextBar = {
                time: bucket,
                open: previous.close,
                high: Math.max(previous.close, last),
                low: Math.min(previous.close, last),
                close: last,
                volume: estimateTickVolume(last, previous.close),
              };
            } else {
              return;
            }

            lastBarsByKey.set(stream.streamKey, nextBar);
            for (const callback of stream.callbacks.values()) {
              callback(nextBar);
            }
          } catch {
            // Ignore intermittent polling failures. Next cycle will retry.
          } finally {
            stream.inFlight = false;
          }
        };
        stream.timerId = setInterval(() => {
          stream.poll().catch(() => {});
        }, pollMs);
        realtimeStreams.set(streamKey, stream);
      }

      if (subscriptions.has(subscriberUID)) {
        releaseSubscription(subscriberUID);
      }
      stream.callbacks.set(subscriberUID, onRealtimeCallback);
      subscriptions.set(subscriberUID, { streamKey });
      stream.poll().catch(() => {});
    },

    unsubscribeBars(subscriberUID) {
      releaseSubscription(subscriberUID);
    },
  };
}

function normalizeTvSymbol(symbol) {
  const normalized = extractMarketSymbol(symbol);
  return `AMEX:${normalized}`;
}

function extractMarketSymbol(value) {
  const raw = String(value || "").trim().toUpperCase();
  if (!raw) {
    return "SPY";
  }
  const symbol = raw.includes(":") ? raw.split(":").pop() : raw;
  return symbol || "SPY";
}

function normalizeResolution(value) {
  const raw = String(value || "5").trim().toUpperCase();
  if (raw === "D" || raw === "1D") {
    return "1D";
  }
  if (raw === "W" || raw === "1W") {
    return "1W";
  }
  const numeric = Number(raw);
  if (Number.isFinite(numeric) && numeric > 0) {
    return String(Math.round(numeric));
  }
  return "5";
}

function resolutionToMs(resolution) {
  if (resolution === "1D") {
    return 86400000;
  }
  if (resolution === "1W") {
    return 7 * 86400000;
  }

  const minutes = Number(resolution);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return 5 * 60000;
  }
  return Math.max(1, Math.round(minutes)) * 60000;
}

function resolveRealtimePollMs(resolution) {
  if (resolution === "1D" || resolution === "1W") {
    return 15000;
  }

  const minutes = Number(resolution);
  if (!Number.isFinite(minutes) || minutes <= 1) {
    return 1000;
  }
  if (minutes <= 5) {
    return 1500;
  }
  if (minutes <= 15) {
    return 3000;
  }
  if (minutes <= 60) {
    return 5000;
  }
  return 10000;
}

function buildBarKey(symbol, resolution) {
  return `${symbol}:${resolution}`;
}

function toEpochMs(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return NaN;
  }
  if (numeric > 100000000000) {
    return Math.round(numeric);
  }
  return Math.round(numeric * 1000);
}

function estimateTickVolume(next, previous) {
  const delta = Math.abs(Number(next || 0) - Number(previous || 0));
  return Math.max(1, Math.round(50 + delta * 400));
}
