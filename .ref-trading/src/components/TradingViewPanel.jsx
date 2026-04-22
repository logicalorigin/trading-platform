import { Component, useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  executeRayAlgoApproval,
  generateLocalRayAlgoSignals,
  getAccounts,
  getMarketOrderFlow,
  getRayAlgoApprovals,
  getRayAlgoParity,
  getRayAlgoPolicy,
  getRayAlgoSignals,
  getSpotQuote,
  getTradingViewAlerts,
  rejectRayAlgoApproval,
  updateRayAlgoPolicy,
} from "../lib/brokerClient.js";
import { isConnectedAccount, isMarketDataReadyAccount } from "../lib/accountStatus.js";
import { normalizeSymbol } from "../lib/marketSymbols.js";
import { createBrokerTradingViewDatafeed } from "../lib/tradingview/brokerDatafeed.js";
import { buildRayAlgoAlertJsonExample } from "../research/rayalgo/presentationModel.js";
import DraftNumberInput from "./shared/DraftNumberInput.jsx";
import LiveWiringBanner from "./LiveWiringBanner.jsx";

const T = {
  bg: "#ffffff",
  card: "#ffffff",
  border: "#d6e0ea",
  text: "#0f172a",
  muted: "#64748b",
  accent: "#0284c7",
  blue: "#2563eb",
  green: "#10b981",
  red: "#ef4444",
  amber: "#f59e0b",
};

const INTERVALS = [
  { value: "1", label: "1m" },
  { value: "3", label: "3m" },
  { value: "5", label: "5m" },
  { value: "15", label: "15m" },
  { value: "30", label: "30m" },
  { value: "60", label: "1h" },
  { value: "1D", label: "1D" },
];

let hostedTradingViewScriptPromise;
let chartingLibraryScriptPromise;
let chartingLibraryLoaded = false;
const DEFAULT_RAYALGO_ALERT_JSON_EXAMPLE = buildRayAlgoAlertJsonExample();

function loadHostedTradingViewScript() {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("TradingView requires a browser environment."));
  }

  if (window.TradingView?.widget) {
    return Promise.resolve();
  }

  if (hostedTradingViewScriptPromise) {
    return hostedTradingViewScriptPromise;
  }

  hostedTradingViewScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/tv.js";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load hosted TradingView widget script."));
    document.head.appendChild(script);
  });

  return hostedTradingViewScriptPromise;
}

function loadChartingLibraryScript() {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("TradingView requires a browser environment."));
  }

  if (chartingLibraryLoaded || window.Datafeeds) {
    chartingLibraryLoaded = true;
    return Promise.resolve();
  }

  if (chartingLibraryScriptPromise) {
    return chartingLibraryScriptPromise;
  }

  chartingLibraryScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "/charting_library/charting_library.js";
    script.async = true;
    script.onload = () => {
      if (window.TradingView?.widget) {
        chartingLibraryLoaded = true;
        resolve();
      } else {
        chartingLibraryScriptPromise = null;
        reject(new Error("Charting Library loaded but TradingView.widget is unavailable."));
      }
    };
    script.onerror = () => {
      chartingLibraryScriptPromise = null;
      reject(new Error("Charting Library script not found at /charting_library/charting_library.js"));
    };
    document.head.appendChild(script);
  });

  return chartingLibraryScriptPromise;
}

async function detectChartingLibraryAvailability() {
  try {
    const response = await fetch("/charting_library/charting_library.js", {
      method: "GET",
      cache: "no-store",
    });
    if (!response.ok) {
      return false;
    }

    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    const body = await response.text();
    const head = body.trimStart().slice(0, 256).toLowerCase();
    const looksLikeHtml = head.startsWith("<!doctype html") || head.startsWith("<html");
    const looksLikeJs = contentType.includes("javascript") || body.includes("TradingView");

    return !looksLikeHtml && looksLikeJs;
  } catch {
    return false;
  }
}

function extractMarketSymbol(value) {
  const normalized = normalizeSymbol(value);
  return normalized.split(":").pop() || "SPY";
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

function toHostedWidgetInterval(value) {
  const raw = String(value || "5").trim().toUpperCase();
  if (raw === "1D" || raw === "D") {
    return "D";
  }
  if (raw === "1W" || raw === "W") {
    return "W";
  }
  const numeric = Number(raw);
  if (Number.isFinite(numeric) && numeric > 0) {
    return String(Math.round(numeric));
  }
  return "5";
}

function clearContainer(container) {
  if (!container) {
    return;
  }
  try {
    if (typeof container.replaceChildren === "function") {
      container.replaceChildren();
      return;
    }
  } catch {
    // Fallback to innerHTML reset.
  }
  container.innerHTML = "";
}

function extractSymbolFromChartPayload(payload) {
  if (typeof payload === "string") {
    return payload;
  }
  if (!payload || typeof payload !== "object") {
    return "";
  }
  return payload.full_name || payload.fullName || payload.name || payload.ticker || payload.symbol || "";
}

function subscribeToSymbolChanges(widget, onSymbolChange) {
  if (!widget || typeof onSymbolChange !== "function") {
    return () => {};
  }

  let cleanup = () => {};
  const bind = () => {
    try {
      const chart = typeof widget.activeChart === "function" ? widget.activeChart() : null;
      const symbolChanged = chart?.onSymbolChanged?.();
      if (!symbolChanged || typeof symbolChanged.subscribe !== "function") {
        return;
      }
      const handleChange = (payload) => {
        const nextRaw = extractSymbolFromChartPayload(payload);
        if (!nextRaw) {
          return;
        }
        onSymbolChange(normalizeSymbol(nextRaw));
      };
      symbolChanged.subscribe(null, handleChange);
      cleanup = () => {
        try {
          symbolChanged.unsubscribe(null, handleChange);
        } catch {
          // Ignore unsubscription failures.
        }
      };
    } catch {
      // Ignore symbol subscription failures.
    }
  };

  if (typeof widget.onChartReady === "function") {
    widget.onChartReady(bind);
  } else {
    bind();
  }

  return () => cleanup();
}

function subscribeToIntervalChanges(widget, onIntervalChange) {
  if (!widget || typeof onIntervalChange !== "function") {
    return () => {};
  }

  let cleanup = () => {};
  const bind = () => {
    try {
      const chart = typeof widget.activeChart === "function" ? widget.activeChart() : null;
      const intervalChanged = chart?.onIntervalChanged?.();
      if (!intervalChanged || typeof intervalChanged.subscribe !== "function") {
        return;
      }
      const handleChange = (payload) => {
        const nextRaw = typeof payload === "string"
          ? payload
          : payload?.interval || payload?.resolution || payload?.value || payload;
        const next = normalizeResolution(nextRaw);
        if (!next) {
          return;
        }
        onIntervalChange(next);
      };
      intervalChanged.subscribe(null, handleChange);
      cleanup = () => {
        try {
          intervalChanged.unsubscribe(null, handleChange);
        } catch {
          // Ignore unsubscription failures.
        }
      };
    } catch {
      // Ignore interval subscription failures.
    }
  };

  if (typeof widget.onChartReady === "function") {
    widget.onChartReady(bind);
  } else {
    bind();
  }

  return () => cleanup();
}

class LocalChartErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, message: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, message: error?.message || "Chart failed to render" };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            border: `1px solid ${T.border}`,
            borderRadius: 8,
            background: "#fff1f2",
            color: "#9f1239",
            padding: "10px 12px",
            fontSize: 12,
          }}
        >
          Chart unavailable: {this.state.message}
        </div>
      );
    }
    return this.props.children;
  }
}

export function TradingViewWidget({
  symbol,
  interval = "5",
  theme = "light",
  height = "100%",
  showSideToolbar = false,
  showTopToolbar = true,
  showLegend = true,
  onSymbolChange,
  onIntervalChange,
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const chartContainerId = useRef(`tv_widget_${Math.random().toString(36).slice(2, 10)}`);
  const widgetRef = useRef(null);

  useEffect(() => {
    let disposed = false;

    const mountWidget = async () => {
      setError(null);
      setLoading(true);

      try {
        await loadHostedTradingViewScript();
        if (disposed) {
          return;
        }

        const container = document.getElementById(chartContainerId.current);
        if (!container) {
          throw new Error("TradingView container not found.");
        }

        widgetRef.current = null;
        clearContainer(container);

        widgetRef.current = new window.TradingView.widget({
          autosize: true,
          symbol,
          interval: toHostedWidgetInterval(interval),
          timezone: "America/New_York",
          theme,
          style: "1",
          locale: "en",
          enable_publishing: false,
          withdateranges: true,
          hide_side_toolbar: !showSideToolbar,
          hide_top_toolbar: !showTopToolbar,
          hide_legend: !showLegend,
          allow_symbol_change: true,
          save_image: true,
          container_id: chartContainerId.current,
        });
        const stopSymbolListening = subscribeToSymbolChanges(widgetRef.current, onSymbolChange);
        const stopIntervalListening = subscribeToIntervalChanges(widgetRef.current, onIntervalChange);
        if (disposed) {
          stopSymbolListening();
          stopIntervalListening();
        }
        widgetRef.current.__symbolUnsubscribe = stopSymbolListening;
        widgetRef.current.__intervalUnsubscribe = stopIntervalListening;
      } catch (mountError) {
        if (!disposed) {
          setError(mountError.message);
        }
      } finally {
        if (!disposed) {
          setLoading(false);
        }
      }
    };

    mountWidget();

    return () => {
      disposed = true;
      const widget = widgetRef.current;
      try {
        widget?.__symbolUnsubscribe?.();
      } catch {
        // Ignore cleanup failures.
      }
      try {
        widget?.__intervalUnsubscribe?.();
      } catch {
        // Ignore cleanup failures.
      }
      try {
        widget?.remove?.();
      } catch {
        // Ignore TradingView teardown failures.
      }
      widgetRef.current = null;
      clearContainer(document.getElementById(chartContainerId.current));
    };
  }, [interval, onIntervalChange, onSymbolChange, showLegend, showSideToolbar, showTopToolbar, symbol, theme]);

  return (
    <div
      style={{
        position: "relative",
        background: T.card,
        border: `1px solid ${T.border}`,
        borderRadius: 8,
        height,
        minHeight: 360,
        overflow: "hidden",
      }}
    >
      {loading && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: T.muted,
            fontSize: 13,
            background: "#ffffffd9",
            zIndex: 2,
          }}
        >
          Loading TradingView chart...
        </div>
      )}
      {error && (
        <div
          style={{
            position: "absolute",
            left: 12,
            right: 12,
            top: 12,
            zIndex: 3,
            background: "#fee2e2",
            border: "1px solid #ef4444",
            color: "#991b1b",
            borderRadius: 6,
            fontSize: 12,
            padding: "8px 10px",
          }}
        >
          {error}
        </div>
      )}
      <div id={chartContainerId.current} style={{ width: "100%", height: "100%" }} />
    </div>
  );
}

function BrokerChartingLibraryWidget({
  symbol,
  interval,
  theme,
  height = "100%",
  accountId,
  onSymbolChange,
  onIntervalChange,
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const containerId = useRef(`tv_charting_${Math.random().toString(36).slice(2, 10)}`);
  const widgetRef = useRef(null);
  const accountIdRef = useRef(accountId);

  useEffect(() => {
    accountIdRef.current = accountId;
  }, [accountId]);

  useEffect(() => {
    let disposed = false;

    const mount = async () => {
      setLoading(true);
      setError(null);

      try {
        await loadChartingLibraryScript();
        if (disposed) {
          return;
        }

        const container = document.getElementById(containerId.current);
        if (!container) {
          throw new Error("TradingView charting container not found.");
        }

        widgetRef.current = null;
        clearContainer(container);

        const marketSymbol = extractMarketSymbol(symbol);
        const datafeed = createBrokerTradingViewDatafeed({
          defaultSymbol: marketSymbol,
          getAccountId: () => accountIdRef.current,
        });

        widgetRef.current = new window.TradingView.widget({
          autosize: true,
          symbol: normalizeSymbol(marketSymbol),
          interval: normalizeResolution(interval),
          timezone: "America/New_York",
          theme,
          locale: "en",
          datafeed,
          library_path: "/charting_library/",
          container_id: containerId.current,
          allow_symbol_change: true,
          save_image: true,
          disabled_features: ["header_compare"],
          enabled_features: ["study_templates"],
        });

        const stopSymbolListening = subscribeToSymbolChanges(widgetRef.current, onSymbolChange);
        const stopIntervalListening = subscribeToIntervalChanges(widgetRef.current, onIntervalChange);
        if (disposed) {
          stopSymbolListening();
          stopIntervalListening();
        }
        widgetRef.current.__symbolUnsubscribe = stopSymbolListening;
        widgetRef.current.__intervalUnsubscribe = stopIntervalListening;

        if (typeof widgetRef.current?.onChartReady === "function") {
          widgetRef.current.onChartReady(() => {
            if (!disposed) {
              setLoading(false);
            }
          });
        } else {
          setLoading(false);
        }
      } catch (mountError) {
        if (!disposed) {
          setError(mountError?.message || "Failed to initialize TradingView charting library.");
          setLoading(false);
        }
      }
    };

    mount();

    return () => {
      disposed = true;
      const widget = widgetRef.current;
      try {
        widget?.__symbolUnsubscribe?.();
      } catch {
        // Ignore cleanup failures.
      }
      try {
        widget?.__intervalUnsubscribe?.();
      } catch {
        // Ignore cleanup failures.
      }
      try {
        widget?.remove?.();
      } catch {
        // Ignore TradingView teardown failures.
      }
      widgetRef.current = null;
      clearContainer(document.getElementById(containerId.current));
    };
  }, [interval, onIntervalChange, onSymbolChange, symbol, theme]);

  return (
    <div
      style={{
        position: "relative",
        background: T.card,
        border: `1px solid ${T.border}`,
        borderRadius: 8,
        height,
        minHeight: 360,
        overflow: "hidden",
      }}
    >
      {loading && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: T.muted,
            fontSize: 13,
            background: "#ffffffd9",
            zIndex: 2,
          }}
        >
          Loading broker chart...
        </div>
      )}
      {error && (
        <div
          style={{
            position: "absolute",
            left: 12,
            right: 12,
            top: 12,
            zIndex: 3,
            background: "#fee2e2",
            border: "1px solid #ef4444",
            color: "#991b1b",
            borderRadius: 6,
            fontSize: 12,
            padding: "8px 10px",
          }}
        >
          {error}
        </div>
      )}
      <div id={containerId.current} style={{ width: "100%", height: "100%" }} />
    </div>
  );
}

export function LiveBrokerTradingViewWidget({
  symbol,
  interval = "5",
  theme = "light",
  height = "100%",
  accountId,
  enginePreference = "auto",
  showSideToolbar = false,
  showTopToolbar = true,
  showLegend = true,
  showAssetHint = false,
  onSymbolChange,
  onIntervalChange,
}) {
  const [chartingLibraryAvailable, setChartingLibraryAvailable] = useState(null);
  const normalizedSymbol = useMemo(() => normalizeSymbol(symbol), [symbol]);
  const normalizedTheme = theme === "dark" ? "dark" : "light";

  const effectiveEngine = useMemo(() => {
    if (enginePreference === "widget") {
      return "widget";
    }
    if (enginePreference === "broker") {
      return chartingLibraryAvailable ? "broker" : "widget";
    }
    return chartingLibraryAvailable ? "broker" : "widget";
  }, [chartingLibraryAvailable, enginePreference]);

  useEffect(() => {
    let mounted = true;
    detectChartingLibraryAvailability().then((available) => {
      if (mounted) {
        setChartingLibraryAvailable(available);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <>
      {showAssetHint && enginePreference !== "widget" && chartingLibraryAvailable === false && (
        <div
          style={{
            background: `${T.amber}14`,
            border: `1px solid ${T.amber}55`,
            color: "#92400e",
            borderRadius: 8,
            fontSize: 12,
            lineHeight: 1.45,
            padding: "8px 10px",
            marginBottom: 10,
          }}
        >
          Live broker chart mode needs TradingView Charting Library assets under
          <code style={{ marginLeft: 4, marginRight: 4 }}>/charting_library</code>.
        </div>
      )}
      <LocalChartErrorBoundary>
        {effectiveEngine === "broker" ? (
          <BrokerChartingLibraryWidget
            symbol={normalizedSymbol}
            interval={interval}
            theme={normalizedTheme}
            accountId={accountId}
            height={height}
            onSymbolChange={onSymbolChange}
            onIntervalChange={onIntervalChange}
          />
        ) : (
          <TradingViewWidget
            symbol={normalizedSymbol}
            interval={interval}
            theme={normalizedTheme}
            height={height}
            showSideToolbar={showSideToolbar}
            showTopToolbar={showTopToolbar}
            showLegend={showLegend}
            onSymbolChange={onSymbolChange}
            onIntervalChange={onIntervalChange}
          />
        )}
      </LocalChartErrorBoundary>
    </>
  );
}

export default function TradingViewPanel({ isActive = true } = {}) {
  const [viewportWidth, setViewportWidth] = useState(() => (
    typeof window === "undefined" ? 1440 : window.innerWidth
  ));
  const [symbolInput, setSymbolInput] = useState("AMEX:SPY");
  const [interval, setInterval] = useState("5");
  const [theme, setTheme] = useState("light");
  const [enginePreference, setEnginePreference] = useState("auto");
  const [chartingLibraryAvailable, setChartingLibraryAvailable] = useState(null);

  const [accounts, setAccounts] = useState([]);
  const [selectedAccountId, setSelectedAccountId] = useState("all");
  const [quote, setQuote] = useState(null);
  const [quoteError, setQuoteError] = useState(null);
  const [orderFlow, setOrderFlow] = useState(null);
  const [orderFlowError, setOrderFlowError] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [alertsError, setAlertsError] = useState(null);
  const [raySignals, setRaySignals] = useState([]);
  const [rayParity, setRayParity] = useState(null);
  const [rayPolicy, setRayPolicy] = useState(null);
  const [rayApprovals, setRayApprovals] = useState([]);
  const [rayError, setRayError] = useState(null);
  const [rayBusy, setRayBusy] = useState(false);
  const [policyDraft, setPolicyDraft] = useState({
    liveAuto: false,
    liveManual: true,
    quantity: 1,
    maxSignalsPerSymbolPerDay: 3,
  });
  const [policyTouched, setPolicyTouched] = useState(false);
  const [approvalBusyId, setApprovalBusyId] = useState(null);
  const quoteRefreshInFlightRef = useRef(false);
  const orderFlowRefreshInFlightRef = useRef(false);
  const alertsRefreshInFlightRef = useRef(false);
  const rayAlgoRefreshInFlightRef = useRef(false);

  const symbol = useMemo(() => normalizeSymbol(symbolInput), [symbolInput]);
  const marketSymbol = useMemo(() => extractMarketSymbol(symbol), [symbol]);
  const handleChartSymbolChange = useCallback((nextSymbolValue) => {
    const normalized = normalizeSymbol(nextSymbolValue);
    if (!normalized) {
      return;
    }
    setSymbolInput((previous) => {
      const previousNormalized = normalizeSymbol(previous);
      return previousNormalized === normalized ? previous : normalized;
    });
  }, []);
  const chartUrl = useMemo(
    () => `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(symbol)}`,
    [symbol],
  );
  const webhookUrl = useMemo(() => {
    if (typeof window === "undefined") {
      return "/api/tradingview/alerts";
    }
    return `${window.location.origin}/api/tradingview/alerts`;
  }, []);

  const effectiveAccountId = useMemo(() => {
    if (selectedAccountId && selectedAccountId !== "all") {
      return selectedAccountId;
    }
    const connected = accounts.find((account) => isMarketDataReadyAccount(account))
      || accounts.find((account) => isConnectedAccount(account));
    return connected?.accountId || accounts[0]?.accountId || undefined;
  }, [accounts, selectedAccountId]);

  const effectiveEngine = useMemo(() => {
    if (enginePreference === "widget") {
      return "widget";
    }
    if (enginePreference === "broker") {
      return chartingLibraryAvailable ? "broker" : "widget";
    }
    return chartingLibraryAvailable ? "broker" : "widget";
  }, [chartingLibraryAvailable, enginePreference]);
  const compactControls = viewportWidth < 940;
  const compactPadding = viewportWidth < 640 ? 12 : 16;

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }
    const handleResize = () => {
      setViewportWidth(window.innerWidth);
    };
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  const refreshAccounts = useCallback(async () => {
    try {
      const rows = await getAccounts();
      setAccounts(rows);
      if (selectedAccountId === "all" && rows.length) {
        const connected = rows.find((row) => isMarketDataReadyAccount(row))
          || rows.find((row) => isConnectedAccount(row));
        if (connected) {
          setSelectedAccountId(connected.accountId);
        }
      }
    } catch {
      // Keep chart usable even if account listing fails.
    }
  }, [selectedAccountId]);

  const refreshQuote = useCallback(async () => {
    if (quoteRefreshInFlightRef.current) {
      return;
    }
    quoteRefreshInFlightRef.current = true;
    try {
      const nextQuote = await getSpotQuote({
        accountId: effectiveAccountId,
        symbol: marketSymbol,
      });
      setQuote(nextQuote);
      setQuoteError(null);
    } catch (error) {
      setQuoteError(error?.message || "Quote unavailable");
    } finally {
      quoteRefreshInFlightRef.current = false;
    }
  }, [effectiveAccountId, marketSymbol]);

  const refreshOrderFlow = useCallback(async () => {
    if (orderFlowRefreshInFlightRef.current) {
      return;
    }
    orderFlowRefreshInFlightRef.current = true;
    try {
      const flow = await getMarketOrderFlow({
        accountId: effectiveAccountId,
        symbol: marketSymbol,
        resolution: interval,
        countBack: 40,
      });
      setOrderFlow(flow);
      setOrderFlowError(null);
    } catch (error) {
      setOrderFlowError(error?.message || "Order-flow unavailable");
    } finally {
      orderFlowRefreshInFlightRef.current = false;
    }
  }, [effectiveAccountId, interval, marketSymbol]);

  const refreshAlerts = useCallback(async () => {
    if (alertsRefreshInFlightRef.current) {
      return;
    }
    alertsRefreshInFlightRef.current = true;
    try {
      const rows = await getTradingViewAlerts({ limit: 25 });
      setAlerts(rows);
      setAlertsError(null);
    } catch (error) {
      setAlertsError(error?.message || "Alert feed unavailable");
    } finally {
      alertsRefreshInFlightRef.current = false;
    }
  }, []);

  const refreshRayAlgo = useCallback(async () => {
    if (rayAlgoRefreshInFlightRef.current) {
      return;
    }
    rayAlgoRefreshInFlightRef.current = true;
    try {
      const [signals, parity, policy, approvals] = await Promise.all([
        getRayAlgoSignals({
          source: "all",
          symbol,
          timeframe: interval,
          limit: 120,
        }),
        getRayAlgoParity({
          symbol,
          timeframe: interval,
          limit: 2000,
          windowSec: interval === "1D" ? 86400 : Number(interval) * 60 || 300,
        }),
        getRayAlgoPolicy(),
        getRayAlgoApprovals({
          status: "pending",
          limit: 20,
        }),
      ]);

      setRaySignals(signals);
      setRayParity(parity);
      setRayPolicy(policy);
      setRayApprovals(approvals);
      setRayError(null);
    } catch (error) {
      setRayError(error?.message || "RayAlgo feed unavailable");
    } finally {
      rayAlgoRefreshInFlightRef.current = false;
    }
  }, [interval, symbol]);

  const runLocalRayAlgo = useCallback(async () => {
    setRayBusy(true);
    setRayError(null);
    try {
      await generateLocalRayAlgoSignals({
        accountId: effectiveAccountId,
        symbol: marketSymbol,
        resolution: interval,
        countBack: 320,
      });
      await refreshRayAlgo();
      setNotice("RayAlgo local generation complete.");
    } catch (error) {
      setRayError(error?.message || "Failed to generate local RayAlgo signals");
    } finally {
      setRayBusy(false);
    }
  }, [effectiveAccountId, interval, marketSymbol, refreshRayAlgo]);

  const saveRayPolicy = useCallback(async () => {
    setRayBusy(true);
    setRayError(null);
    try {
      const next = await updateRayAlgoPolicy(policyDraft);
      setRayPolicy(next);
      setPolicyTouched(false);
      setNotice("RayAlgo policy updated.");
    } catch (error) {
      setRayError(error?.message || "Failed to save RayAlgo policy");
    } finally {
      setRayBusy(false);
    }
  }, [policyDraft]);

  const executeApproval = useCallback(async (approvalId) => {
    setApprovalBusyId(approvalId);
    setRayError(null);
    try {
      await executeRayAlgoApproval(approvalId, {});
      await refreshRayAlgo();
      setNotice("Live approval executed.");
    } catch (error) {
      setRayError(error?.message || "Failed to execute live approval");
    } finally {
      setApprovalBusyId(null);
    }
  }, [refreshRayAlgo]);

  const rejectApproval = useCallback(async (approvalId) => {
    setApprovalBusyId(approvalId);
    setRayError(null);
    try {
      await rejectRayAlgoApproval(approvalId, { reason: "Rejected from TradingView panel" });
      await refreshRayAlgo();
      setNotice("Live approval rejected.");
    } catch (error) {
      setRayError(error?.message || "Failed to reject live approval");
    } finally {
      setApprovalBusyId(null);
    }
  }, [refreshRayAlgo]);

  useEffect(() => {
    detectChartingLibraryAvailability().then((available) => {
      setChartingLibraryAvailable(available);
    });
  }, []);

  useEffect(() => {
    if (!isActive) {
      return undefined;
    }
    refreshAccounts().catch(() => {});
    return undefined;
  }, [isActive, refreshAccounts]);

  useEffect(() => {
    if (!isActive) {
      return undefined;
    }
    refreshQuote().catch(() => {});
    const timer = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }
      refreshQuote().catch(() => {});
    }, 3000);
    return () => clearInterval(timer);
  }, [isActive, refreshQuote]);

  useEffect(() => {
    if (!isActive) {
      return undefined;
    }
    refreshOrderFlow().catch(() => {});
    const timer = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }
      refreshOrderFlow().catch(() => {});
    }, 3000);
    return () => clearInterval(timer);
  }, [isActive, refreshOrderFlow]);

  useEffect(() => {
    if (!isActive) {
      return undefined;
    }
    refreshAlerts().catch(() => {});
    const timer = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }
      refreshAlerts().catch(() => {});
    }, 5000);
    return () => clearInterval(timer);
  }, [isActive, refreshAlerts]);

  useEffect(() => {
    if (!isActive) {
      return undefined;
    }
    refreshRayAlgo().catch(() => {});
    const timer = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }
      refreshRayAlgo().catch(() => {});
    }, 5000);
    return () => clearInterval(timer);
  }, [isActive, refreshRayAlgo]);

  useEffect(() => {
    if (!rayPolicy || policyTouched) {
      return;
    }
    setPolicyDraft({
      liveAuto: Boolean(rayPolicy.liveAuto),
      liveManual: Boolean(rayPolicy.liveManual),
      quantity: Number(rayPolicy.quantity || 1),
      maxSignalsPerSymbolPerDay: Number(rayPolicy.maxSignalsPerSymbolPerDay || 3),
    });
  }, [policyTouched, rayPolicy]);

  return (
    <div style={{ minHeight: "100vh", background: T.bg, color: T.text, padding: compactPadding }}>
      <LiveWiringBanner symbol={marketSymbol} enabled={isActive} />
      <div
        style={{
          background: T.card,
          border: `1px solid ${T.border}`,
          borderRadius: 8,
          padding: 12,
          display: "flex",
          flexWrap: "wrap",
          gap: 10,
          alignItems: "center",
          overflowX: "hidden",
          marginBottom: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, flex: compactControls ? "1 1 100%" : "0 1 auto", minWidth: 0 }}>
          <span style={{ color: T.muted }}>Symbol</span>
          <div
            style={{
              background: "#ffffff",
              border: `1px solid ${T.border}`,
              color: T.text,
              borderRadius: 6,
              padding: "6px 8px",
              minWidth: compactControls ? 0 : 170,
              flex: compactControls ? 1 : "0 1 auto",
              display: "flex",
              justifyContent: "space-between",
              gap: 10,
            }}
          >
            <span>{symbol}</span>
            <span style={{ color: T.muted, fontSize: 10 }}>chart search</span>
          </div>
        </div>

        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, flex: compactControls ? "1 1 100%" : "0 1 auto", minWidth: 0 }}>
          <span style={{ color: T.muted }}>Interval</span>
          <select
            value={interval}
            onChange={(event) => setInterval(event.target.value)}
            style={{
              background: "#ffffff",
              border: `1px solid ${T.border}`,
              color: T.text,
              borderRadius: 6,
              padding: "6px 8px",
            }}
          >
            {INTERVALS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, flex: compactControls ? "1 1 100%" : "0 1 auto", minWidth: 0 }}>
          <span style={{ color: T.muted }}>Theme</span>
          <select
            value={theme}
            onChange={(event) => setTheme(event.target.value)}
            style={{
              background: "#ffffff",
              border: `1px solid ${T.border}`,
              color: T.text,
              borderRadius: 6,
              padding: "6px 8px",
            }}
          >
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>

        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, flex: compactControls ? "1 1 100%" : "0 1 auto", minWidth: 0 }}>
          <span style={{ color: T.muted }}>Account</span>
          <select
            value={selectedAccountId}
            onChange={(event) => setSelectedAccountId(event.target.value)}
            style={{
              background: "#ffffff",
              border: `1px solid ${T.border}`,
              color: T.text,
              borderRadius: 6,
              padding: "6px 8px",
              minWidth: compactControls ? 0 : 150,
              flex: compactControls ? 1 : "0 1 auto",
            }}
          >
            <option value="all">Auto (best market-data account)</option>
            {accounts.map((account) => (
              <option key={account.accountId} value={account.accountId}>
                {account.label}
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, flex: compactControls ? "1 1 100%" : "0 1 auto", minWidth: 0 }}>
          <span style={{ color: T.muted }}>Chart Engine</span>
          <select
            value={enginePreference}
            onChange={(event) => setEnginePreference(event.target.value)}
            style={{
              background: "#ffffff",
              border: `1px solid ${T.border}`,
              color: T.text,
              borderRadius: 6,
              padding: "6px 8px",
            }}
          >
            <option value="auto">Auto</option>
            <option value="broker">Broker Live Feed</option>
            <option value="widget">Hosted Widget</option>
          </select>
        </label>

        <button
          onClick={() => {
            refreshAccounts().catch(() => {});
            refreshQuote().catch(() => {});
            refreshOrderFlow().catch(() => {});
          }}
          style={{
            border: `1px solid ${T.border}`,
            borderRadius: 6,
            padding: "7px 10px",
            background: "#ffffff",
            color: T.muted,
            cursor: "pointer",
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          Refresh
        </button>

        <a
          href={chartUrl}
          target="_blank"
          rel="noreferrer"
          style={{
            marginLeft: compactControls ? 0 : "auto",
            width: compactControls ? "100%" : "auto",
            textAlign: "center",
            textDecoration: "none",
            background: `${T.accent}1f`,
            border: `1px solid ${T.accent}55`,
            color: T.accent,
            fontSize: 12,
            borderRadius: 6,
            padding: "7px 10px",
            fontWeight: 600,
          }}
        >
          Open In TradingView
        </a>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 10,
          marginBottom: 12,
        }}
      >
        <StatusBox
          label="Engine"
          value={effectiveEngine === "broker" ? "Broker live feed" : "Hosted widget"}
          tone={effectiveEngine === "broker" ? T.green : T.accent}
          detail={
            effectiveEngine === "broker"
              ? "Bars + realtime updates via /api/market/bars and /api/market/spot"
              : "Uses TradingView-hosted market feed"
          }
        />
        <StatusBox
          label="Spot"
          value={Number.isFinite(Number(quote?.last)) ? `${Number(quote.last).toFixed(2)}` : "--"}
          tone={quoteError ? T.red : T.text}
          detail={quoteError || quote?.source || "Quote unavailable"}
        />
        <StatusBox
          label="Order Flow"
          value={
            Number.isFinite(Number(orderFlow?.score))
              ? Number(orderFlow.score).toFixed(2)
              : "--"
          }
          tone={orderFlowTone(orderFlow?.score)}
          detail={
            orderFlowError
            || (orderFlow
              ? `${Number(orderFlow?.metrics?.aggressorBuyPct || 0).toFixed(1)}% buy · ${orderFlow.classification || "neutral"}`
              : "Order-flow unavailable")
          }
        />
        <StatusBox
          label="Charting Library Assets"
          value={chartingLibraryAvailable ? "Detected" : "Missing"}
          tone={chartingLibraryAvailable ? T.green : T.amber}
          detail={
            chartingLibraryAvailable
              ? "Found /charting_library/charting_library.js"
              : "Add Charting Library assets to enable true broker datafeed mode"
          }
        />
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          gap: 10,
          marginBottom: 12,
        }}
      >
        <div
          style={{
            border: `1px solid ${T.border}`,
            borderRadius: 8,
            background: T.card,
            padding: "10px 12px",
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 700, color: T.text, marginBottom: 6 }}>
            Invite-Only Bridge
          </div>
          <div style={{ fontSize: 11, color: T.muted, lineHeight: 1.45, marginBottom: 6 }}>
            Use a TradingView alert webhook from your invite-only indicator to send signals here.
          </div>
          <div style={{ fontSize: 11, color: T.muted, marginBottom: 4 }}>Webhook URL</div>
          <div
            style={{
              border: `1px solid ${T.border}`,
              borderRadius: 6,
              background: "#f8fafc",
              fontSize: 11,
              color: T.text,
              fontFamily: "'JetBrains Mono', monospace",
              padding: "7px 8px",
              marginBottom: 6,
              wordBreak: "break-all",
            }}
          >
            {webhookUrl}
          </div>
          <div style={{ fontSize: 11, color: T.muted, marginBottom: 4 }}>
            Alert JSON example
          </div>
          <pre
            style={{
              margin: 0,
              border: `1px solid ${T.border}`,
              borderRadius: 6,
              background: "#f8fafc",
              fontSize: 10,
              lineHeight: 1.35,
              color: T.text,
              fontFamily: "'JetBrains Mono', monospace",
              padding: 8,
              whiteSpace: "pre-wrap",
            }}
          >
            {DEFAULT_RAYALGO_ALERT_JSON_EXAMPLE}
          </pre>
          <div style={{ fontSize: 10, color: T.muted, marginTop: 6 }}>
            Use <code>eventType: "signal"</code> for parity entries. Non-signal events (e.g. heartbeat, exit)
            are stored but skipped for pine-shadow signal parity. Add optional <code>signalClass: "trend_change"</code>
            when you want class-aware parity.
          </div>
          <div style={{ fontSize: 10, color: T.muted, marginTop: 4 }}>
            Optional auth: set <code>TRADINGVIEW_WEBHOOK_SECRET</code> on server.
          </div>
        </div>

        <div
          style={{
            border: `1px solid ${T.border}`,
            borderRadius: 8,
            background: T.card,
            padding: "10px 12px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: T.text }}>Recent Webhook Alerts</div>
            <button
              onClick={() => refreshAlerts().catch(() => {})}
              style={{
                border: `1px solid ${T.border}`,
                borderRadius: 6,
                padding: "4px 7px",
                background: "#ffffff",
                color: T.muted,
                cursor: "pointer",
                fontSize: 11,
                fontWeight: 600,
              }}
            >
              Refresh
            </button>
          </div>
          {alertsError && (
            <div
              style={{
                background: "#fee2e2",
                border: "1px solid #ef4444",
                color: "#991b1b",
                borderRadius: 6,
                fontSize: 11,
                padding: "6px 8px",
                marginBottom: 8,
              }}
            >
              {alertsError}
            </div>
          )}
          <div
            style={{
              maxHeight: 170,
              overflowY: "auto",
              overflowX: "auto",
              border: `1px solid ${T.border}`,
              borderRadius: 6,
            }}
          >
            {alerts.length === 0 ? (
              <div style={{ color: T.muted, fontSize: 11, padding: 10 }}>
                No webhook alerts yet.
              </div>
            ) : (
              alerts.map((alert) => (
                <div
                  key={alert.alertId}
                  style={{
                    borderBottom: `1px solid ${T.border}`,
                    padding: "7px 9px",
                    fontSize: 11,
                    display: "grid",
                    gridTemplateColumns: "82px 78px minmax(140px, 1fr) auto",
                    gap: 8,
                    alignItems: "center",
                    minWidth: 420,
                  }}
                >
                  <span style={{ color: T.muted }}>
                    {new Date(alert.receivedAt).toLocaleTimeString()}
                  </span>
                  <span style={{ color: T.accent, fontWeight: 700 }}>{alert.symbol || "--"}</span>
                  <span style={{ color: T.text }}>
                    {alert.action || alert.scriptName || alert.message || "signal"}
                  </span>
                  <span style={{ color: T.text }}>
                    {alert.price != null ? `$${Number(alert.price).toFixed(2)}` : ""}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          gap: 10,
          marginBottom: 12,
        }}
      >
        <div
          style={{
            border: `1px solid ${T.border}`,
            borderRadius: 8,
            background: T.card,
            padding: "10px 12px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: T.text }}>RayAlgo Shadow Parity</div>
            <button
              onClick={() => runLocalRayAlgo().catch(() => {})}
              disabled={rayBusy}
              style={{
                border: `1px solid ${T.border}`,
                borderRadius: 6,
                padding: "4px 8px",
                background: "#ffffff",
                color: T.muted,
                cursor: rayBusy ? "wait" : "pointer",
                fontSize: 11,
                fontWeight: 600,
              }}
            >
              {rayBusy ? "Running..." : "Generate Local"}
            </button>
          </div>

          {rayError && (
            <div
              style={{
                background: "#fee2e2",
                border: "1px solid #ef4444",
                color: "#991b1b",
                borderRadius: 6,
                fontSize: 11,
                padding: "6px 8px",
                marginBottom: 8,
              }}
            >
              {rayError}
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(96px, 1fr))", gap: 8, marginBottom: 8 }}>
            <StatusBox
              label="Overall F1"
              value={rayParity ? `${(Number(rayParity.overall?.f1 || 0) * 100).toFixed(1)}%` : "--"}
              tone={Number(rayParity?.overall?.f1 || 0) >= 0.88 ? T.green : T.amber}
              detail={`Match ${rayParity?.counts?.matched ?? 0}`}
            />
            <StatusBox
              label="Buy F1"
              value={rayParity ? `${(Number(rayParity.buy?.f1 || 0) * 100).toFixed(1)}%` : "--"}
              tone={Number(rayParity?.buy?.f1 || 0) >= 0.85 ? T.green : T.amber}
              detail={`P:${rayParity?.buy?.pine ?? 0} L:${rayParity?.buy?.local ?? 0}`}
            />
            <StatusBox
              label="Sell F1"
              value={rayParity ? `${(Number(rayParity.sell?.f1 || 0) * 100).toFixed(1)}%` : "--"}
              tone={Number(rayParity?.sell?.f1 || 0) >= 0.85 ? T.green : T.amber}
              detail={`P:${rayParity?.sell?.pine ?? 0} L:${rayParity?.sell?.local ?? 0}`}
            />
            <StatusBox
              label="Conv MAE"
              value={rayParity ? Number(rayParity.overall?.convictionMae || 0).toFixed(3) : "--"}
              tone={Number(rayParity?.overall?.convictionMae ?? 1) <= 0.08 ? T.green : T.amber}
              detail="Lower is better"
            />
            <StatusBox
              label="Regime Match"
              value={rayParity ? `${(Number(rayParity.overall?.regimeMatchRate || 0) * 100).toFixed(1)}%` : "--"}
              tone={Number(rayParity?.overall?.regimeMatchRate ?? 0) >= 0.8 ? T.green : T.amber}
              detail="Matched pairs"
            />
            <StatusBox
              label="Components"
              value={rayParity ? `${(Number(rayParity.overall?.componentMatchRate || 0) * 100).toFixed(1)}%` : "--"}
              tone={Number(rayParity?.overall?.componentMatchRate ?? 0) >= 0.75 ? T.green : T.amber}
              detail="Structure alignment"
            />
          </div>

          <div style={{ fontSize: 11, color: T.muted, marginBottom: 6 }}>
            Execution policy (live auto + manual approval)
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(120px, 1fr))", gap: 8, alignItems: "center" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: T.text }}>
              <input
                type="checkbox"
                checked={Boolean(policyDraft.liveAuto)}
                onChange={(event) => {
                  setPolicyTouched(true);
                  setPolicyDraft((prev) => ({ ...prev, liveAuto: event.target.checked }));
                }}
              />
              Live auto
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: T.text }}>
              <input
                type="checkbox"
                checked={Boolean(policyDraft.liveManual)}
                onChange={(event) => {
                  setPolicyTouched(true);
                  setPolicyDraft((prev) => ({ ...prev, liveManual: event.target.checked }));
                }}
              />
              Live manual
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: T.text }}>
              Qty
              <DraftNumberInput
                min={1}
                value={policyDraft.quantity}
                onCommit={(nextValue) => {
                  setPolicyTouched(true);
                  setPolicyDraft((prev) => ({
                    ...prev,
                    quantity: nextValue,
                  }));
                }}
                normalizeOnBlur={(numeric) => Math.max(1, Math.round(numeric))}
                style={{
                  width: 72,
                  background: "#ffffff",
                  border: `1px solid ${T.border}`,
                  borderRadius: 6,
                  padding: "4px 6px",
                }}
              />
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: T.text }}>
              Daily cap
              <DraftNumberInput
                min={1}
                value={policyDraft.maxSignalsPerSymbolPerDay}
                onCommit={(nextValue) => {
                  setPolicyTouched(true);
                  setPolicyDraft((prev) => ({
                    ...prev,
                    maxSignalsPerSymbolPerDay: nextValue,
                  }));
                }}
                normalizeOnBlur={(numeric) => Math.max(1, Math.round(numeric))}
                style={{
                  width: 72,
                  background: "#ffffff",
                  border: `1px solid ${T.border}`,
                  borderRadius: 6,
                  padding: "4px 6px",
                }}
              />
            </label>
          </div>
          <div style={{ marginTop: 8 }}>
            <button
              onClick={() => saveRayPolicy().catch(() => {})}
              disabled={rayBusy}
              style={{
                border: `1px solid ${T.border}`,
                borderRadius: 6,
                padding: "5px 9px",
                background: "#ffffff",
                color: T.muted,
                cursor: rayBusy ? "wait" : "pointer",
                fontSize: 11,
                fontWeight: 600,
              }}
            >
              Save Policy
            </button>
            {rayPolicy?.updatedAt && (
              <span style={{ marginLeft: 8, color: T.muted, fontSize: 10 }}>
                Updated {new Date(rayPolicy.updatedAt).toLocaleTimeString()}
              </span>
            )}
          </div>
        </div>

        <div
          style={{
            border: `1px solid ${T.border}`,
            borderRadius: 8,
            background: T.card,
            padding: "10px 12px",
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 700, color: T.text, marginBottom: 6 }}>
            Pending Live Approvals
          </div>
          <div style={{ maxHeight: 130, overflowY: "auto", overflowX: "auto", border: `1px solid ${T.border}`, borderRadius: 6, marginBottom: 8 }}>
            {rayApprovals.length === 0 ? (
              <div style={{ color: T.muted, fontSize: 11, padding: 10 }}>No pending approvals.</div>
            ) : (
              rayApprovals.map((approval) => (
                <div
                  key={approval.approvalId}
                  style={{
                    borderBottom: `1px solid ${T.border}`,
                    padding: "7px 9px",
                    fontSize: 11,
                    display: "grid",
                    gridTemplateColumns: "70px 72px minmax(120px, 1fr) auto",
                    gap: 8,
                    alignItems: "center",
                    minWidth: 390,
                  }}
                >
                  <span style={{ color: T.muted }}>{new Date(approval.createdAt).toLocaleTimeString()}</span>
                  <span style={{ color: T.accent, fontWeight: 700 }}>{approval.symbol || "--"}</span>
                  <span style={{ color: T.text }}>{approval.direction || "signal"}</span>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button
                      onClick={() => executeApproval(approval.approvalId).catch(() => {})}
                      disabled={approvalBusyId === approval.approvalId}
                      style={{
                        border: `1px solid ${T.green}55`,
                        borderRadius: 5,
                        padding: "2px 6px",
                        background: "#ecfdf5",
                        color: "#065f46",
                        cursor: "pointer",
                        fontSize: 10,
                        fontWeight: 700,
                      }}
                    >
                      Go Live
                    </button>
                    <button
                      onClick={() => rejectApproval(approval.approvalId).catch(() => {})}
                      disabled={approvalBusyId === approval.approvalId}
                      style={{
                        border: `1px solid ${T.red}55`,
                        borderRadius: 5,
                        padding: "2px 6px",
                        background: "#fef2f2",
                        color: "#991b1b",
                        cursor: "pointer",
                        fontSize: 10,
                        fontWeight: 700,
                      }}
                    >
                      Reject
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          <div style={{ fontSize: 12, fontWeight: 700, color: T.text, marginBottom: 6 }}>
            Recent RayAlgo Signals
          </div>
          <div style={{ maxHeight: 150, overflowY: "auto", overflowX: "auto", border: `1px solid ${T.border}`, borderRadius: 6 }}>
            {raySignals.length === 0 ? (
              <div style={{ color: T.muted, fontSize: 11, padding: 10 }}>No RayAlgo signals yet.</div>
            ) : (
              raySignals.slice(0, 60).map((signal) => (
                <div
                  key={signal.signalId}
                  style={{
                    borderBottom: `1px solid ${T.border}`,
                    padding: "7px 9px",
                    fontSize: 11,
                    display: "grid",
                    gridTemplateColumns: "70px 44px 56px minmax(100px, 1fr) auto",
                    gap: 8,
                    alignItems: "center",
                    minWidth: 390,
                  }}
                >
                  <span style={{ color: T.muted }}>{new Date(signal.ts).toLocaleTimeString()}</span>
                  <span style={{ color: signal.source === "pine" ? "#7c3aed" : T.blue, fontWeight: 700 }}>
                    {signal.source === "pine" ? "PINE" : "LOCAL"}
                  </span>
                  <span style={{ color: signal.direction === "buy" ? T.green : T.red, fontWeight: 700 }}>
                    {signal.direction?.toUpperCase() || "--"}
                  </span>
                  <span style={{ color: T.text }}>{signal.symbol || "--"}</span>
                  <span style={{ color: T.muted }}>
                    {signal.conviction != null ? Number(signal.conviction).toFixed(2) : ""}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {!chartingLibraryAvailable && (
        <div
          style={{
            background: `${T.amber}14`,
            border: `1px solid ${T.amber}55`,
            color: "#92400e",
            borderRadius: 8,
            fontSize: 12,
            lineHeight: 1.45,
            padding: "10px 12px",
            marginBottom: 12,
          }}
        >
          Broker live-feed chart mode needs local TradingView Charting Library assets under
          <code style={{ marginLeft: 4, marginRight: 4 }}>/charting_library</code>
          . Until then, the panel uses the hosted widget.
        </div>
      )}

      {isActive ? (
        effectiveEngine === "broker" ? (
          <BrokerChartingLibraryWidget
            symbol={symbol}
            interval={interval}
            theme={theme}
            accountId={effectiveAccountId}
            height="clamp(360px, 60vh, 780px)"
            onSymbolChange={handleChartSymbolChange}
          />
        ) : (
          <TradingViewWidget
            symbol={symbol}
            interval={interval}
            theme={theme}
            height="clamp(360px, 60vh, 780px)"
            showSideToolbar
            showTopToolbar
            showLegend
            onSymbolChange={handleChartSymbolChange}
          />
        )
      ) : (
        <div
          style={{
            minHeight: "clamp(360px, 60vh, 780px)",
            border: `1px solid ${T.border}`,
            borderRadius: 8,
            background: T.card,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: T.muted,
            fontSize: 12,
          }}
        >
          Chart paused while TradingView is inactive.
        </div>
      )}
    </div>
  );
}

function StatusBox({ label, value, detail, tone }) {
  return (
    <div
      style={{
        border: `1px solid ${T.border}`,
        borderRadius: 7,
        background: T.card,
        padding: "8px 10px",
      }}
    >
      <div style={{ fontSize: 10, color: T.muted, textTransform: "uppercase", letterSpacing: "0.06em" }}>
        {label}
      </div>
      <div style={{ fontSize: 16, fontWeight: 700, color: tone || T.text, marginTop: 2 }}>
        {value}
      </div>
      <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>{detail}</div>
    </div>
  );
}

function orderFlowTone(score) {
  const numeric = Number(score);
  if (!Number.isFinite(numeric)) {
    return T.muted;
  }
  if (numeric >= 0.15) {
    return T.green;
  }
  if (numeric <= -0.15) {
    return T.red;
  }
  return T.accent;
}
