import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  Suspense,
  lazy,
  createContext,
  useContext,
  useDeferredValue,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Line,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
  ComposedChart,
} from "recharts";
import * as d3 from "d3";
import {
  getBars as getBarsRequest,
  getOptionChain as getOptionChainRequest,
  getGetSignalMonitorProfileQueryKey,
  getGetSignalMonitorStateQueryKey,
  getListSignalMonitorEventsQueryKey,
  listFlowEvents as listFlowEventsRequest,
  useCancelOrder,
  useEvaluateSignalMonitor,
  useGetNews,
  useGetQuoteSnapshots,
  useGetResearchEarningsCalendar,
  useGetSignalMonitorProfile,
  useGetSignalMonitorState,
  useListAlgoDeployments,
  useListBacktestDraftStrategies,
  useListExecutionEvents,
  useListOrders,
  useListSignalMonitorEvents,
  useSearchUniverseTickers,
  useCreateAlgoDeployment,
  useEnableAlgoDeployment,
  useGetSession,
  useListAccounts,
  useListPositions,
  useListWatchlists,
  usePauseAlgoDeployment,
  usePlaceOrder,
  usePreviewOrder,
  useReplaceOrder,
  useUpdateSignalMonitorProfile,
} from "@workspace/api-client-react";
import {
  ResearchSparkline,
  ResearchChartFrame,
  ResearchChartSurface,
  ResearchChartWidgetHeader,
  ResearchChartWidgetFooter,
  ResearchChartWidgetSidebar,
  RayReplicaSettingsMenu,
  RAY_REPLICA_PINE_SCRIPT_KEY,
  resolveRayReplicaRuntimeSettings,
  buildResearchChartModel,
  getStoredBrokerMinuteAggregates,
  useIndicatorLibrary,
  useDrawingHistory,
  useBrokerStockAggregateStream,
  useBrokerStreamedBars,
  useStockMinuteAggregateStoreVersion,
} from "./features/charting";
import {
  AlgoDraftStrategiesPanel,
  BacktestWorkspace,
} from "./features/backtesting/BacktestingPanels";
import {
  useIbkrAccountSnapshotStream,
  useIbkrOptionChainStream,
  useIbkrOrderSnapshotStream,
  useIbkrQuoteSnapshotStream,
} from "./features/platform/live-streams";

const PhotonicsObservatory = lazy(
  () => import("./features/research/PhotonicsObservatory"),
);

// ═══════════════════════════════════════════════════════════════════
// FONTS
// ═══════════════════════════════════════════════════════════════════
const FONT_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
::-webkit-scrollbar{width:5px;height:5px}
::-webkit-scrollbar-thumb{background:#2a3348;border-radius:3px}
::-webkit-scrollbar-thumb:hover{background:#3a4560}
::-webkit-scrollbar-track{background:transparent}
input[type=range]{accent-color:#3b82f6}
@keyframes toastSlideIn{from{opacity:0;transform:translateX(20px) scale(0.96)}to{opacity:1;transform:translateX(0) scale(1)}}
@keyframes toastSlideOut{from{opacity:1;transform:translateX(0)}to{opacity:0;transform:translateX(20px)}}
@keyframes pulseAlert{0%,100%{box-shadow:0 0 0 0 rgba(245,158,11,0.6)}50%{box-shadow:0 0 0 4px rgba(245,158,11,0)}}
@keyframes pulseAlertLoss{0%,100%{box-shadow:0 0 0 0 rgba(239,68,68,0.6)}50%{box-shadow:0 0 0 4px rgba(239,68,68,0)}}
`;

// ═══════════════════════════════════════════════════════════════════
// DESIGN TOKENS — "Obsidian Terminal"
// Inspired by: IB Desktop (layout), Fincept (architecture),
//              Secured Finance (depth, density, gradients)
// ═══════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════
// THEME SYSTEM — light + dark palettes with same key shape
// ═══════════════════════════════════════════════════════════════════

const THEMES = {
  dark: {
    // Backgrounds (layered depth)
    bg0: "#080b12", // deepest — app bg
    bg1: "#0d1117", // panels, sidebar
    bg2: "#141b27", // cards, elevated surfaces
    bg3: "#1a2235", // hover states, active items
    bg4: "#212d42", // tooltips, dropdowns

    // Borders
    border: "#1e293b",
    borderLight: "#253349",
    borderFocus: "#3b82f6",

    // Text
    text: "#e2e8f0",
    textSec: "#94a3b8",
    textDim: "#64748b",
    textMuted: "#475569",

    // Accents
    accent: "#3b82f6",
    accentDim: "#1e3a5f",

    // Semantic
    green: "#10b981",
    greenDim: "#064e3b",
    greenBg: "rgba(16,185,129,0.08)",
    red: "#ef4444",
    redDim: "#7f1d1d",
    redBg: "rgba(239,68,68,0.08)",
    amber: "#f59e0b",
    amberDim: "#78350f",
    amberBg: "rgba(245,158,11,0.08)",
    blue: "#3b82f6",
    purple: "#8b5cf6",
    cyan: "#06b6d4",
  },
  light: {
    // Light palette tuned for trader UIs — true whites for surfaces, near-black text, slightly darker semantics for contrast on white
    bg0: "#f5f5f4", // app bg — very subtle warm gray so white panels pop
    bg1: "#ffffff", // panels, sidebar — pure white
    bg2: "#ffffff", // cards, elevated surfaces — pure white
    bg3: "#f8fafc", // hover states, active items — barely-tinted (only on interaction)
    bg4: "#ffffff", // tooltips, dropdowns — pure white

    // Borders
    border: "#e2e8f0",
    borderLight: "#cbd5e1",
    borderFocus: "#2563eb",

    // Text — near-black primary for contrast
    text: "#0f172a",
    textSec: "#475569",
    textDim: "#64748b",
    textMuted: "#94a3b8",

    // Accents — slightly darker blue for white bg contrast
    accent: "#2563eb",
    accentDim: "#dbeafe",

    // Semantic — pulled darker/more saturated to read on white
    green: "#059669",
    greenDim: "#a7f3d0",
    greenBg: "rgba(5,150,105,0.10)",
    red: "#dc2626",
    redDim: "#fecaca",
    redBg: "rgba(220,38,38,0.10)",
    amber: "#d97706",
    amberDim: "#fde68a",
    amberBg: "rgba(217,119,6,0.10)",
    blue: "#2563eb",
    purple: "#7c3aed",
    cyan: "#0891b2",
  },
};

// Typography is theme-independent — added to both at runtime via the proxy
const TYPOGRAPHY = {
  mono: "'Inter', system-ui, -apple-system, sans-serif",
  code: "'JetBrains Mono', 'SF Mono', 'Menlo', monospace",
  sans: "'Inter', system-ui, -apple-system, sans-serif",
  display: "'Inter', system-ui, sans-serif",
};

// ─── PERSISTENCE LAYER ───
// Safe localStorage wrapper. Wrapped in try/catch so it degrades gracefully in
// sandboxed iframes (e.g. Claude.ai artifact preview) where storage is blocked.
// On Replit and other standalone deployments, persistence works normally.
const STORAGE_KEY = "rayalgo:state:v1";
const _initialState = (() => {
  try {
    if (typeof window === "undefined" || !window.localStorage) return {};
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
})();
const persistState = (patch) => {
  try {
    if (typeof window === "undefined" || !window.localStorage) return;
    const current = JSON.parse(
      window.localStorage.getItem(STORAGE_KEY) || "{}",
    );
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...current, ...patch }),
    );
  } catch (e) {}
};

const WATCHLISTS_QUERY_KEY = ["/api/watchlists"];
const HEADER_KPI_CONFIG = [
  { symbol: "VIXY", label: "Volatility" },
  { symbol: "IEF", label: "Treasuries" },
  { symbol: "UUP", label: "Dollar" },
  { symbol: "GLD", label: "Gold" },
  { symbol: "USO", label: "Crude" },
];
const HEADER_KPI_SYMBOLS = HEADER_KPI_CONFIG.map((item) => item.symbol);

const platformJsonRequest = async (path, { method = "GET", body } = {}) => {
  const response = await fetch(path, {
    method,
    headers:
      body == null
        ? undefined
        : {
            "Content-Type": "application/json",
          },
    body: body == null ? undefined : JSON.stringify(body),
  });

  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const payload = await response.json();
      message =
        payload?.detail || payload?.message || payload?.error || message;
    } catch (error) {}
    throw new Error(message);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
};

// Mutable current theme name — flipped by setThemeMode, forces re-render via React state at App root
let CURRENT_THEME = _initialState.theme || "dark";

// ─── SIZE SCALE SYSTEM ───
// Mirror of theme system — global mutable scale level, helpers that read from it,
// React state at App root triggers cascade re-render so all fs()/sp()/dim() calls re-evaluate.
const SCALE_LEVELS = {
  xs: 0.85,
  s: 0.92,
  m: 1.0,
  l: 1.12,
  xl: 1.25,
};
let CURRENT_SCALE = "m";
const SCALE_FACTOR = () => SCALE_LEVELS[CURRENT_SCALE];

// fs(n) — scale a font size. Minimum readable size is 10px (matches watchlist price text).
const fs = (n) => Math.max(10, Math.round(n * SCALE_FACTOR()));

// dim(n) — scale a fixed dimension (height, width, gap, border-radius, etc.).
const dim = (n) => Math.round(n * SCALE_FACTOR());

// sp(v) — scale a padding/margin/gap value. Accepts either a number or a CSS string like "4px 6px".
const sp = (v) => {
  if (typeof v === "number") return Math.round(v * SCALE_FACTOR());
  if (typeof v === "string") {
    return v.replace(/(-?\d*\.?\d+)(px|em|rem)?/g, (_, num, unit) => {
      return Math.round(parseFloat(num) * SCALE_FACTOR()) + (unit || "px");
    });
  }
  return v;
};

// Proxy that reads from the current theme on every property access.
// This means components doing `T.bg2` get fresh values whenever React re-renders,
// without any of them needing to import a hook or call useContext.
const T = new Proxy(
  {},
  {
    get(_target, prop) {
      if (prop in TYPOGRAPHY) return TYPOGRAPHY[prop];
      return THEMES[CURRENT_THEME][prop];
    },
  },
);

// React context provides the toggle to children + holds state that triggers re-renders
const ThemeContext = createContext({ theme: "dark", toggle: () => {} });

// Toast notifications — globally accessible via useToast()
const ToastContext = createContext({ push: () => {}, toasts: [] });
const useToast = () => useContext(ToastContext);

// Local position context. Order-entry simulation has been removed, but a small
// UI-local store remains for legacy state paths that may still read this context.
const PositionsContext = createContext({
  positions: [],
  addPosition: () => {},
  closePosition: () => {},
  closeAll: () => {},
  updateStops: () => {},
  rollPosition: () => {},
});
const usePositions = () => useContext(PositionsContext);

// ═══════════════════════════════════════════════════════════════════
// STATIC DATA / GENERATORS
// ═══════════════════════════════════════════════════════════════════

const rng = (seed) => {
  let x = seed;
  return () => {
    x = (x * 16807 + 7) % 2147483647;
    return (x - 1) / 2147483646;
  };
};
const hashSymbol = (symbol = "") =>
  symbol.split("").reduce((acc, char) => acc * 31 + char.charCodeAt(0), 7);

const genSparkline = (seed, points = 48, base = 100, vol = 1) => {
  const r = rng(seed);
  let v = base;
  return Array.from({ length: points }, (_, i) => {
    v += (r() - 0.48) * vol;
    return { i, v: +v.toFixed(2) };
  });
};

const WATCHLIST = [
  {
    sym: "SPY",
    name: "SPDR S&P 500",
    price: null,
    chg: null,
    pct: null,
    spark: [],
  },
  {
    sym: "QQQ",
    name: "Invesco QQQ",
    price: null,
    chg: null,
    pct: null,
    spark: [],
  },
  {
    sym: "IWM",
    name: "iShares Russ 2000",
    price: null,
    chg: null,
    pct: null,
    spark: [],
  },
  {
    sym: "VIXY",
    name: "ProShares VIX Short-Term Futures ETF",
    price: null,
    chg: null,
    pct: null,
    spark: [],
  },
  {
    sym: "AAPL",
    name: "Apple Inc",
    price: null,
    chg: null,
    pct: null,
    spark: [],
  },
  {
    sym: "MSFT",
    name: "Microsoft Corp",
    price: null,
    chg: null,
    pct: null,
    spark: [],
  },
  {
    sym: "NVDA",
    name: "NVIDIA Corp",
    price: null,
    chg: null,
    pct: null,
    spark: [],
  },
  {
    sym: "AMZN",
    name: "Amazon.com",
    price: null,
    chg: null,
    pct: null,
    spark: [],
  },
  {
    sym: "META",
    name: "Meta Platforms",
    price: null,
    chg: null,
    pct: null,
    spark: [],
  },
  {
    sym: "TSLA",
    name: "Tesla Inc",
    price: null,
    chg: null,
    pct: null,
    spark: [],
  },
  {
    sym: "UUP",
    name: "Invesco DB US Dollar Index Bullish Fund",
    price: null,
    chg: null,
    pct: null,
    spark: [],
  },
  {
    sym: "IEF",
    name: "iShares 7-10 Year Treasury Bond ETF",
    price: null,
    chg: null,
    pct: null,
    spark: [],
  },
];
const DEFAULT_WATCHLIST_BY_SYMBOL = Object.fromEntries(
  WATCHLIST.map((item) => [item.sym, { ...item, spark: [...item.spark] }]),
);

const genBars = (seed, count = 78, base = 582) => {
  const r = rng(seed);
  let p = base;
  return Array.from({ length: count }, (_, i) => {
    const drift = (r() - 0.48) * 1.5;
    const o = +p.toFixed(2);
    const c = +(o + drift).toFixed(2);
    const h = +(Math.max(o, c) + r() * 0.8).toFixed(2);
    const l = +(Math.min(o, c) - r() * 0.8).toFixed(2);
    const hr = 9 + Math.floor((i * 6.5) / count);
    const mn = Math.floor(((i * 6.5 * 60) / count) % 60);
    const vol = Math.round(
      (500000 + r() * 800000) * (i < 6 ? 2.5 : i > count - 6 ? 2.0 : 0.6 + r()),
    );
    // UOA overlay: ~15% of bars have UOA activity. Intensity 0.2-0.9 of volume.
    const hasUoa = r() < 0.15;
    const uoa = hasUoa ? +(0.2 + r() * 0.7).toFixed(2) : 0;
    p = c;
    return {
      time: `${hr}:${String(mn).padStart(2, "0")}`,
      o,
      h,
      l,
      c,
      v: vol,
      i,
      uoa,
    };
  });
};

// Tradable ticker info (price + IV + chart identity metadata)
const TRADE_TICKER_INFO = {
  SPY: {
    name: "SPDR S&P 500",
    price: null,
    chg: null,
    pct: null,
    iv: null,
    barSeed: 100,
    chainSeed: 200,
    optSeed: 300,
  },
  QQQ: {
    name: "Invesco QQQ",
    price: null,
    chg: null,
    pct: null,
    iv: null,
    barSeed: 101,
    chainSeed: 201,
    optSeed: 301,
  },
  NVDA: {
    name: "NVIDIA Corp",
    price: null,
    chg: null,
    pct: null,
    iv: null,
    barSeed: 102,
    chainSeed: 202,
    optSeed: 302,
  },
  TSLA: {
    name: "Tesla Inc",
    price: null,
    chg: null,
    pct: null,
    iv: null,
    barSeed: 103,
    chainSeed: 203,
    optSeed: 303,
  },
  AAPL: {
    name: "Apple Inc",
    price: null,
    chg: null,
    pct: null,
    iv: null,
    barSeed: 104,
    chainSeed: 204,
    optSeed: 304,
  },
  META: {
    name: "Meta Platforms",
    price: null,
    chg: null,
    pct: null,
    iv: null,
    barSeed: 105,
    chainSeed: 205,
    optSeed: 305,
  },
  AMZN: {
    name: "Amazon.com",
    price: null,
    chg: null,
    pct: null,
    iv: null,
    barSeed: 106,
    chainSeed: 206,
    optSeed: 306,
  },
  MSFT: {
    name: "Microsoft Corp",
    price: null,
    chg: null,
    pct: null,
    iv: null,
    barSeed: 107,
    chainSeed: 207,
    optSeed: 307,
  },
};

const ensureTradeTickerInfo = (symbol, fallbackName = symbol) => {
  const normalized = symbol.toUpperCase();
  if (!TRADE_TICKER_INFO[normalized]) {
    const hash = hashSymbol(normalized);
    TRADE_TICKER_INFO[normalized] = {
      name: fallbackName,
      price: null,
      chg: null,
      pct: null,
      iv: null,
      barSeed: 400 + (hash % 200),
      chainSeed: 700 + (hash % 200),
      optSeed: 1000 + (hash % 200),
      open: null,
      high: null,
      low: null,
      prevClose: null,
      volume: null,
      updatedAt: null,
      spark: [],
      sparkBars: [],
    };
  } else if (
    fallbackName &&
    (!TRADE_TICKER_INFO[normalized].name ||
      TRADE_TICKER_INFO[normalized].name === normalized)
  ) {
    TRADE_TICKER_INFO[normalized].name = fallbackName;
  }

  if (!Array.isArray(TRADE_TICKER_INFO[normalized].spark)) {
    TRADE_TICKER_INFO[normalized].spark = [];
  }
  if (!Array.isArray(TRADE_TICKER_INFO[normalized].sparkBars)) {
    TRADE_TICKER_INFO[normalized].sparkBars = [];
  }

  return TRADE_TICKER_INFO[normalized];
};

const buildFallbackWatchlistItem = (symbol, index, name) => {
  const existing = DEFAULT_WATCHLIST_BY_SYMBOL[symbol];
  if (existing)
    return {
      ...existing,
      price: null,
      chg: null,
      pct: null,
      spark: [],
      name: existing.name || name || symbol,
      sparkBars: existing.sparkBars || [],
    };

  return {
    sym: symbol,
    name: name || symbol,
    price: null,
    chg: null,
    pct: null,
    spark: [],
    sparkBars: [],
  };
};

const buildSparklineFromHistoricalBars = (bars, fallback) => {
  if (!Array.isArray(bars) || bars.length < 2) {
    return Array.isArray(fallback) ? fallback : [];
  }

  return bars.map((bar, index) => ({
    i: index,
    v: bar.close,
  }));
};

const computeTrailingReturnPercent = (currentPrice, baselinePrice) => {
  if (
    typeof currentPrice !== "number" ||
    Number.isNaN(currentPrice) ||
    typeof baselinePrice !== "number" ||
    Number.isNaN(baselinePrice) ||
    baselinePrice === 0
  ) {
    return null;
  }

  return ((currentPrice - baselinePrice) / baselinePrice) * 100;
};

// Strategy templates — delta target informs strike selection
const TRADE_STRATEGIES = [
  {
    id: "long_call_atm",
    name: "Call ATM",
    desc: "Bullish, ~50Δ",
    cp: "C",
    deltaTarget: 0.5,
    qty: 3,
    dte: 7,
    color: "#10b981",
  },
  {
    id: "long_put_atm",
    name: "Put ATM",
    desc: "Bearish, ~50Δ",
    cp: "P",
    deltaTarget: 0.5,
    qty: 3,
    dte: 7,
    color: "#ef4444",
  },
  {
    id: "long_call_otm",
    name: "Call OTM",
    desc: "Aggressive, 30Δ",
    cp: "C",
    deltaTarget: 0.3,
    qty: 5,
    dte: 7,
    color: "#10b981",
  },
  {
    id: "0dte_lotto",
    name: "0DTE Lotto",
    desc: "High R/R · Δ20",
    cp: "C",
    deltaTarget: 0.2,
    qty: 10,
    dte: 0,
    color: "#f59e0b",
  },
  {
    id: "itm_call",
    name: "ITM Call",
    desc: "Conservative, 70Δ",
    cp: "C",
    deltaTarget: 0.7,
    qty: 2,
    dte: 14,
    color: "#10b981",
  },
  {
    id: "long_put_otm",
    name: "Put OTM",
    desc: "Hedge, 25Δ",
    cp: "P",
    deltaTarget: 0.25,
    qty: 5,
    dte: 7,
    color: "#ef4444",
  },
];

// L2 order book generator — bids + asks for current selection (mock)
const genL2Book = (mid, spread, seed) => {
  const r = rng(seed);
  const tickSize = 0.01;
  const halfSpread = spread / 2;
  const bestBid = +(mid - halfSpread).toFixed(2);
  const bestAsk = +(mid + halfSpread).toFixed(2);
  const bids = [],
    asks = [];
  for (let i = 0; i < 8; i++) {
    const bidPrice = +(bestBid - i * tickSize).toFixed(2);
    const askPrice = +(bestAsk + i * tickSize).toFixed(2);
    const baseBidSize = (5 + i * 8) * (0.5 + r());
    const baseAskSize = (5 + i * 8) * (0.5 + r());
    bids.push({
      price: bidPrice,
      size: Math.round(baseBidSize),
      mm: 1 + Math.floor(r() * 4),
    });
    asks.push({
      price: askPrice,
      size: Math.round(baseAskSize),
      mm: 1 + Math.floor(r() * 4),
    });
  }
  return { bids, asks };
};

// Time & sales — recent prints
const genTradeTape = (mid, seed) => {
  const r = rng(seed);
  const prints = [];
  let t = 14 * 60 + 30;
  for (let i = 0; i < 12; i++) {
    const sec = Math.floor(r() * 30);
    const hh = Math.floor(t / 60);
    const mm = t % 60;
    const time = `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
    const price = +(mid + (r() - 0.5) * 0.06).toFixed(2);
    const size = Math.round(1 + r() * 50);
    const side = r() < 0.55 ? "B" : "A";
    prints.push({ time, price, size, side });
    t -= Math.floor(r() * 5) + 1;
  }
  return prints;
};

// Available expirations for the Trade tab exp selector
const EXPIRATIONS = [
  { v: "04/17", dte: 0, tag: "0DTE" },
  { v: "04/18", dte: 1, tag: "1d" },
  { v: "04/25", dte: 8, tag: "Wkly" },
  { v: "05/02", dte: 15, tag: "2w" },
  { v: "05/16", dte: 29, tag: "Mthly" },
  { v: "06/20", dte: 64, tag: "Qtrly" },
  { v: "09/19", dte: 155, tag: "LEAP" },
];

// Intraday flow prints per ticker — for overlaying on equity chart
const genTradeFlowMarkers = (seed) => {
  const r = rng(seed);
  const n = 5 + Math.floor(r() * 4);
  return Array.from({ length: n }, () => ({
    barIdx: Math.floor(r() * 70) + 2,
    cp: r() > 0.45 ? "C" : "P",
    size: r() > 0.7 ? "lg" : r() > 0.35 ? "md" : "sm",
    golden: r() > 0.82,
  }));
};
const TRADE_FLOW_MARKERS = Object.fromEntries(
  Object.entries(TRADE_TICKER_INFO).map(([sym, info]) => [
    sym,
    genTradeFlowMarkers(info.barSeed + 555),
  ]),
);

const syncRuntimeMarketData = (
  symbols,
  watchlistItems,
  quotes,
  { sparklineBarsBySymbol = {}, performanceBaselineBySymbol = {} } = {},
) => {
  const quoteBySymbol = Object.fromEntries(
    (quotes || []).map((quote) => [quote.symbol.toUpperCase(), quote]),
  );
  const getLatestAggregate = (symbol) => {
    const aggregates = getStoredBrokerMinuteAggregates(symbol);
    return aggregates[aggregates.length - 1] || null;
  };
  const watchlistNameBySymbol = Object.fromEntries(
    (watchlistItems || []).map((item) => {
      const symbol = item.symbol.toUpperCase();
      const fallbackName =
        DEFAULT_WATCHLIST_BY_SYMBOL[symbol]?.name ||
        TRADE_TICKER_INFO[symbol]?.name ||
        symbol;
      return [symbol, fallbackName];
    }),
  );

  const nextItems = symbols.map((symbol, index) => {
    const normalized = symbol.toUpperCase();
    const base = buildFallbackWatchlistItem(
      normalized,
      index,
      watchlistNameBySymbol[normalized],
    );
    const quote = quoteBySymbol[normalized];
    const latestAggregate = getLatestAggregate(normalized);
    const liveAggregatePrice = Number.isFinite(latestAggregate?.close)
      ? latestAggregate.close
      : null;
    const liveAggregateOpen = Number.isFinite(latestAggregate?.open)
      ? latestAggregate.open
      : null;
    const liveAggregateHigh = Number.isFinite(latestAggregate?.high)
      ? latestAggregate.high
      : null;
    const liveAggregateLow = Number.isFinite(latestAggregate?.low)
      ? latestAggregate.low
      : null;
    const liveAggregateVolume = Number.isFinite(latestAggregate?.volume)
      ? latestAggregate.volume
      : null;
    const spark = buildSparklineFromHistoricalBars(
      sparklineBarsBySymbol[normalized],
      base.spark,
    );
    const tradeInfo = ensureTradeTickerInfo(normalized, base.name);
    const prevClose = quote?.prevClose ?? tradeInfo.prevClose ?? null;
    const price =
      liveAggregatePrice ??
      quote?.price ??
      tradeInfo.price ??
      null;
    const chg =
      Number.isFinite(price) && Number.isFinite(prevClose)
        ? price - prevClose
        : (quote?.change ?? tradeInfo.chg ?? null);
    const pct =
      Number.isFinite(price) && Number.isFinite(prevClose) && prevClose !== 0
        ? ((price - prevClose) / prevClose) * 100
        : (quote?.changePercent ?? tradeInfo.pct ?? null);
    const open =
      liveAggregateOpen ?? quote?.open ?? tradeInfo.open ?? null;
    const high =
      liveAggregateHigh ?? quote?.high ?? tradeInfo.high ?? null;
    const low =
      liveAggregateLow ?? quote?.low ?? tradeInfo.low ?? null;
    const volume =
      liveAggregateVolume ??
      quote?.volume ??
      tradeInfo.volume ??
      null;
    const updatedAt =
      quote?.updatedAt ??
      (latestAggregate ? new Date(latestAggregate.endMs) : null) ??
      tradeInfo.updatedAt ??
      null;

    tradeInfo.name = base.name;
    tradeInfo.price = price;
    tradeInfo.chg = chg;
    tradeInfo.pct = pct;
    tradeInfo.open = open;
    tradeInfo.high = high;
    tradeInfo.low = low;
    tradeInfo.prevClose = prevClose;
    tradeInfo.volume = volume;
    tradeInfo.updatedAt = updatedAt;
    tradeInfo.spark = spark;
    tradeInfo.sparkBars = sparklineBarsBySymbol[normalized] || [];

    if (!TRADE_FLOW_MARKERS[normalized]) {
      TRADE_FLOW_MARKERS[normalized] = genTradeFlowMarkers(
        tradeInfo.barSeed + 555,
      );
    }

    return {
      ...base,
      sym: normalized,
      price,
      chg,
      pct,
      spark,
      open,
      high,
      low,
      prevClose,
      volume,
      updatedAt,
      sparkBars: sparklineBarsBySymbol[normalized] || [],
    };
  });

  WATCHLIST.splice(0, WATCHLIST.length, ...nextItems);

  Object.entries(quoteBySymbol).forEach(([symbol, quote]) => {
    const fallbackName =
      watchlistNameBySymbol[symbol] ||
      INDICES.find((item) => item.sym === symbol)?.name ||
      TRADE_TICKER_INFO[symbol]?.name ||
      symbol;
    const tradeInfo = ensureTradeTickerInfo(symbol, fallbackName);
    const runtimeSparkBars = sparklineBarsBySymbol[symbol] || [];

    tradeInfo.name = fallbackName;
    tradeInfo.price = quote.price ?? tradeInfo.price;
    tradeInfo.chg = quote.change ?? tradeInfo.chg;
    tradeInfo.pct = quote.changePercent ?? tradeInfo.pct;
    tradeInfo.open = quote.open ?? tradeInfo.open ?? null;
    tradeInfo.high = quote.high ?? tradeInfo.high ?? null;
    tradeInfo.low = quote.low ?? tradeInfo.low ?? null;
    tradeInfo.prevClose = quote.prevClose ?? tradeInfo.prevClose ?? null;
    tradeInfo.volume = quote.volume ?? tradeInfo.volume ?? null;
    tradeInfo.updatedAt = quote.updatedAt ?? tradeInfo.updatedAt ?? null;
    tradeInfo.spark = buildSparklineFromHistoricalBars(
      runtimeSparkBars,
      tradeInfo.spark,
    );
    tradeInfo.sparkBars = runtimeSparkBars;
  });

  INDICES.forEach((item) => {
    const quote = quoteBySymbol[item.sym.toUpperCase()];
    const latestAggregate = getLatestAggregate(item.sym.toUpperCase());
    const liveAggregatePrice = Number.isFinite(latestAggregate?.close)
      ? latestAggregate.close
      : null;
    const prevClose = quote?.prevClose ?? item.prevClose ?? null;
    item.prevClose = quote?.prevClose ?? item.prevClose ?? null;
    item.price = liveAggregatePrice ?? quote?.price ?? item.price ?? null;
    item.chg =
      Number.isFinite(item.price) && Number.isFinite(prevClose)
        ? item.price - prevClose
        : quote?.change ?? null;
    item.pct =
      Number.isFinite(item.price) &&
      Number.isFinite(prevClose) &&
      prevClose !== 0
        ? ((item.price - prevClose) / prevClose) * 100
        : quote?.changePercent ?? null;
    item.spark = buildSparklineFromHistoricalBars(
      sparklineBarsBySymbol[item.sym.toUpperCase()],
      item.spark,
    );
    item.sparkBars = sparklineBarsBySymbol[item.sym.toUpperCase()] || [];
    const tradeInfo = ensureTradeTickerInfo(item.sym, item.name || item.sym);
    tradeInfo.price = item.price;
    tradeInfo.chg = item.chg;
    tradeInfo.pct = item.pct;
    tradeInfo.prevClose = item.prevClose ?? tradeInfo.prevClose ?? null;
    tradeInfo.spark = item.spark;
    tradeInfo.sparkBars = item.sparkBars;
  });

  MACRO_TICKERS.forEach((item) => {
    const quote = quoteBySymbol[item.sym.toUpperCase()];
    const latestAggregate = getLatestAggregate(item.sym.toUpperCase());
    const liveAggregatePrice = Number.isFinite(latestAggregate?.close)
      ? latestAggregate.close
      : null;
    const prevClose = quote?.prevClose ?? item.prevClose ?? null;
    item.prevClose = quote?.prevClose ?? item.prevClose ?? null;
    item.price = liveAggregatePrice ?? quote?.price ?? item.price ?? null;
    item.chg =
      Number.isFinite(item.price) && Number.isFinite(prevClose)
        ? item.price - prevClose
        : quote?.change ?? null;
    item.pct =
      Number.isFinite(item.price) &&
      Number.isFinite(prevClose) &&
      prevClose !== 0
        ? ((item.price - prevClose) / prevClose) * 100
        : quote?.changePercent ?? null;
    item.spark = buildSparklineFromHistoricalBars(
      sparklineBarsBySymbol[item.sym.toUpperCase()],
      item.spark,
    );
    item.sparkBars = sparklineBarsBySymbol[item.sym.toUpperCase()] || [];
    const tradeInfo = ensureTradeTickerInfo(
      item.sym,
      item.label || item.name || item.sym,
    );
    tradeInfo.price = item.price;
    tradeInfo.chg = item.chg;
    tradeInfo.pct = item.pct;
    tradeInfo.prevClose = item.prevClose ?? tradeInfo.prevClose ?? null;
    tradeInfo.spark = item.spark;
    tradeInfo.sparkBars = item.sparkBars;
  });

  RATES_PROXIES.forEach((item) => {
    const normalized = item.sym.toUpperCase();
    const quote = quoteBySymbol[normalized];
    const currentPrice = quote?.price ?? item.price;
    const baseline = performanceBaselineBySymbol[normalized] ?? null;
    const d5 = computeTrailingReturnPercent(currentPrice, baseline);

    item.price = quote?.price ?? null;
    item.chg = quote?.change ?? null;
    item.pct = quote?.changePercent ?? null;
    item.d5 = d5 ?? null;
  });

  SECTORS.forEach((item) => {
    const normalized = item.sym.toUpperCase();
    const quote = quoteBySymbol[normalized];
    const currentPrice =
      quote?.price ?? TRADE_TICKER_INFO[normalized]?.price ?? null;
    const baseline = performanceBaselineBySymbol[normalized] ?? null;
    const d5 = computeTrailingReturnPercent(currentPrice, baseline);

    item.chg = quote?.changePercent ?? null;
    item.d5 = d5 ?? null;
  });

  TREEMAP_DATA.forEach((sector) => {
    sector.stocks.forEach((stock) => {
      const normalized = stock.sym.toUpperCase();
      const quote = quoteBySymbol[normalized];
      const currentPrice =
        quote?.price ?? TRADE_TICKER_INFO[normalized]?.price ?? null;
      const baseline = performanceBaselineBySymbol[normalized] ?? null;
      const d5 = computeTrailingReturnPercent(currentPrice, baseline);

      stock.d1 = quote?.changePercent ?? null;
      stock.d5 = d5 ?? null;
    });
  });

};

const getRuntimeQuoteDetail = (symbol) => {
  const info =
    TRADE_TICKER_INFO[symbol] || ensureTradeTickerInfo(symbol, symbol);
  const prevClose =
    info.prevClose ??
    (typeof info.price === "number" && typeof info.chg === "number"
      ? info.price - info.chg
      : null);

  return {
    open: info.open,
    prevClose,
    high: info.high,
    low: info.low,
    volume: info.volume,
    iv: info.iv,
    updatedAt: info.updatedAt,
  };
};

const getRuntimeTickerSnapshot = (symbol, fallback = null) => {
  const info = TRADE_TICKER_INFO[symbol];
  if (info) return info;

  return fallback;
};

const buildTrackedBreadthSummary = () => {
  const stocks = TREEMAP_DATA.flatMap((sector) => sector.stocks);
  const observedDaily = stocks.filter((stock) => isFiniteNumber(stock.d1));
  const observedFiveDay = stocks.filter((stock) => isFiniteNumber(stock.d5));
  const observedSectors = SECTORS.filter((sector) => isFiniteNumber(sector.chg));
  const total = observedDaily.length;
  const advancers = observedDaily.filter((stock) => stock.d1 > 0).length;
  const decliners = observedDaily.filter((stock) => stock.d1 < 0).length;
  const unchanged = observedDaily.filter((stock) => stock.d1 === 0).length;
  const positive5d = observedFiveDay.filter((stock) => stock.d5 > 0).length;
  const positiveSectors = observedSectors.filter((sector) => sector.chg > 0).length;
  const sortedSectors = [...observedSectors].sort(
    (left, right) => right.chg - left.chg,
  );
  const leader = sortedSectors[0] || null;
  const laggard = sortedSectors[sortedSectors.length - 1] || null;

  return {
    total,
    advancers,
    decliners,
    unchanged,
    fiveDayCoverage: observedFiveDay.length,
    sectorCoverage: observedSectors.length,
    advancePct: total > 0 ? (advancers / total) * 100 : null,
    positive5dPct:
      observedFiveDay.length > 0
        ? (positive5d / observedFiveDay.length) * 100
        : null,
    positiveSectors,
    leader,
    laggard,
  };
};

const buildRatesProxySummary = () => {
  const sorted = [...RATES_PROXIES]
    .filter((item) => isFiniteNumber(item.pct))
    .sort((left, right) => right.pct - left.pct);
  return {
    leader: sorted[0] || null,
    laggard: sorted[sorted.length - 1] || null,
  };
};

const buildOptionChainRowsFromApi = (contracts, spotPrice) => {
  const rowsByStrike = new Map();

  (contracts || []).forEach((quote) => {
    const strike = quote?.contract?.strike;
    const right = quote?.contract?.right;
    if (typeof strike !== "number" || !right) return;

    const row = rowsByStrike.get(strike) || {
      k: strike,
      cContract: null,
      cPrem: null,
      cBid: null,
      cAsk: null,
      cVol: null,
      cOi: null,
      cIv: null,
      cDelta: null,
      cGamma: null,
      cTheta: null,
      cVega: null,
      pContract: null,
      pPrem: null,
      pBid: null,
      pAsk: null,
      pVol: null,
      pOi: null,
      pIv: null,
      pDelta: null,
      pGamma: null,
      pTheta: null,
      pVega: null,
      isAtm: false,
    };
    const mark =
      quote.mark > 0
        ? quote.mark
        : quote.bid > 0 && quote.ask > 0
          ? (quote.bid + quote.ask) / 2
          : quote.last;

    if (right === "call") {
      row.cContract = quote.contract || null;
      row.cPrem = isFiniteNumber(mark) ? +mark.toFixed(2) : null;
      row.cBid = isFiniteNumber(quote.bid) ? +quote.bid.toFixed(2) : null;
      row.cAsk = isFiniteNumber(quote.ask) ? +quote.ask.toFixed(2) : null;
      row.cVol = isFiniteNumber(quote.volume) ? quote.volume : null;
      row.cOi = isFiniteNumber(quote.openInterest) ? quote.openInterest : null;
      row.cIv = isFiniteNumber(quote.impliedVolatility)
        ? quote.impliedVolatility
        : null;
      row.cDelta = isFiniteNumber(quote.delta) ? quote.delta : null;
      row.cGamma = isFiniteNumber(quote.gamma) ? quote.gamma : null;
      row.cTheta = isFiniteNumber(quote.theta) ? quote.theta : null;
      row.cVega = isFiniteNumber(quote.vega) ? quote.vega : null;
    } else {
      row.pContract = quote.contract || null;
      row.pPrem = isFiniteNumber(mark) ? +mark.toFixed(2) : null;
      row.pBid = isFiniteNumber(quote.bid) ? +quote.bid.toFixed(2) : null;
      row.pAsk = isFiniteNumber(quote.ask) ? +quote.ask.toFixed(2) : null;
      row.pVol = isFiniteNumber(quote.volume) ? quote.volume : null;
      row.pOi = isFiniteNumber(quote.openInterest) ? quote.openInterest : null;
      row.pIv = isFiniteNumber(quote.impliedVolatility)
        ? quote.impliedVolatility
        : null;
      row.pDelta = isFiniteNumber(quote.delta) ? quote.delta : null;
      row.pGamma = isFiniteNumber(quote.gamma) ? quote.gamma : null;
      row.pTheta = isFiniteNumber(quote.theta) ? quote.theta : null;
      row.pVega = isFiniteNumber(quote.vega) ? quote.vega : null;
    }

    rowsByStrike.set(strike, row);
  });

  const rows = Array.from(rowsByStrike.values()).sort(
    (left, right) => left.k - right.k,
  );
  if (!rows.length) return [];

  const fallbackAtmStrike = rows[Math.floor(rows.length / 2)]?.k ?? rows[0].k;
  const atmStrike = isFiniteNumber(spotPrice)
    ? rows.reduce(
        (closest, row) =>
          Math.abs(row.k - spotPrice) < Math.abs(closest - spotPrice)
            ? row.k
            : closest,
        rows[0].k,
      )
    : fallbackAtmStrike;

  return rows.map((row) => ({ ...row, isAtm: row.k === atmStrike }));
};

const buildMarketOrderFlowFromEvents = (events) => {
  const totals = {
    buyXL: 0,
    buyL: 0,
    buyM: 0,
    buyS: 0,
    sellXL: 0,
    sellL: 0,
    sellM: 0,
    sellS: 0,
  };

  (events || []).forEach((evt) => {
    const bucket =
      evt.premium >= 500000
        ? "XL"
        : evt.premium >= 250000
          ? "L"
          : evt.premium >= 100000
            ? "M"
            : "S";
    const amount = evt.premium / 1e6;

    if (evt.side === "BUY") {
      totals[`buy${bucket}`] += amount;
      return;
    }
    if (evt.side === "SELL") {
      totals[`sell${bucket}`] += amount;
      return;
    }

    totals[`buy${bucket}`] += amount / 2;
    totals[`sell${bucket}`] += amount / 2;
  });

  return Object.fromEntries(
    Object.entries(totals).map(([key, value]) => [key, +value.toFixed(1)]),
  );
};

const buildFlowTideFromEvents = (events) => {
  const startMinutes = 9 * 60 + 30;
  const bucketMinutes = 30;
  const bucketCount = 14;
  const buckets = Array.from({ length: bucketCount }, (_, index) => ({
    time: formatSessionBucketLabel(startMinutes + index * bucketMinutes),
    calls: 0,
    puts: 0,
  }));

  (events || []).forEach((evt) => {
    const minutes = toSessionMinutes(evt.occurredAt);
    if (minutes == null) return;
    const clamped = Math.max(
      startMinutes,
      Math.min(startMinutes + bucketMinutes * (bucketCount - 1), minutes),
    );
    const bucketIndex = Math.min(
      bucketCount - 1,
      Math.floor((clamped - startMinutes) / bucketMinutes),
    );
    if (evt.cp === "C") buckets[bucketIndex].calls += evt.premium;
    else buckets[bucketIndex].puts += evt.premium;
  });

  let cumNet = 0;
  return buckets.map((bucket) => {
    const net = bucket.calls - bucket.puts;
    cumNet += net;
    return { ...bucket, net, cumNet };
  });
};

const buildTickerFlowFromEvents = (events) => {
  const grouped = new Map();

  (events || []).forEach((evt) => {
    const entry = grouped.get(evt.ticker) || {
      sym: evt.ticker,
      calls: 0,
      puts: 0,
      contracts: 0,
      scoreTotal: 0,
    };

    if (evt.cp === "C") entry.calls += evt.premium;
    else entry.puts += evt.premium;
    entry.contracts += 1;
    entry.scoreTotal += evt.score;
    grouped.set(evt.ticker, entry);
  });

  return Array.from(grouped.values())
    .map((entry) => {
      const info = ensureTradeTickerInfo(entry.sym, entry.sym);
      return {
        sym: entry.sym,
        calls: entry.calls,
        puts: entry.puts,
        contracts: entry.contracts,
        score: entry.contracts
          ? Math.round(entry.scoreTotal / entry.contracts)
          : 0,
        px: info.price,
        chg: info.pct,
      };
    })
    .sort((left, right) => right.calls + right.puts - (left.calls + left.puts));
};

const buildFlowClockFromEvents = (events) => {
  const startMinutes = 9 * 60 + 30;
  const bucketMinutes = 30;
  const bucketCount = 14;
  const buckets = Array.from({ length: bucketCount }, (_, index) => ({
    time: formatSessionBucketLabel(startMinutes + index * bucketMinutes),
    count: 0,
    prem: 0,
  }));

  (events || []).forEach((evt) => {
    const minutes = toSessionMinutes(evt.occurredAt);
    if (minutes == null) return;
    const clamped = Math.max(
      startMinutes,
      Math.min(startMinutes + bucketMinutes * (bucketCount - 1), minutes),
    );
    const bucketIndex = Math.min(
      bucketCount - 1,
      Math.floor((clamped - startMinutes) / bucketMinutes),
    );
    buckets[bucketIndex].count += 1;
    buckets[bucketIndex].prem += evt.premium;
  });

  return buckets;
};

const FLOW_SECTOR_BY_SYMBOL = {
  AAPL: "Technology",
  AMZN: "Cons Disc",
  META: "Comm Svcs",
  MSFT: "Technology",
  NVDA: "Technology",
  QQQ: "Index",
  SPY: "Index",
  TSLA: "Cons Disc",
  IWM: "Index",
};

const buildSectorFlowFromEvents = (events) => {
  const grouped = new Map();

  (events || []).forEach((evt) => {
    const sector = FLOW_SECTOR_BY_SYMBOL[evt.ticker] || "Other";
    const entry = grouped.get(sector) || { sector, calls: 0, puts: 0 };
    if (evt.cp === "C") entry.calls += evt.premium;
    else entry.puts += evt.premium;
    grouped.set(sector, entry);
  });

  return Array.from(grouped.values()).sort(
    (left, right) =>
      Math.abs(right.calls - right.puts) - Math.abs(left.calls - left.puts),
  );
};

const buildDteBucketsFromEvents = (events) => {
  const buckets = [
    { bucket: "0DTE", calls: 0, puts: 0, count: 0, match: (dte) => dte <= 0 },
    {
      bucket: "1-7d",
      calls: 0,
      puts: 0,
      count: 0,
      match: (dte) => dte >= 1 && dte <= 7,
    },
    {
      bucket: "8-30d",
      calls: 0,
      puts: 0,
      count: 0,
      match: (dte) => dte >= 8 && dte <= 30,
    },
    {
      bucket: "31-90d",
      calls: 0,
      puts: 0,
      count: 0,
      match: (dte) => dte >= 31 && dte <= 90,
    },
    { bucket: "90d+", calls: 0, puts: 0, count: 0, match: (dte) => dte > 90 },
  ];

  (events || []).forEach((evt) => {
    const bucket =
      buckets.find((entry) => entry.match(evt.dte)) ||
      buckets[buckets.length - 1];
    if (evt.cp === "C") bucket.calls += evt.premium;
    else bucket.puts += evt.premium;
    bucket.count += 1;
  });

  return buckets.map(({ match, ...bucket }) => bucket);
};

const FLOW_INDEX_SYMBOLS = new Set(["SPY", "QQQ", "IWM", "DIA"]);

const buildPutCallSummaryFromEvents = (events) => {
  const totals = {
    equities: { calls: 0, puts: 0 },
    indices: { calls: 0, puts: 0 },
  };

  (events || []).forEach((evt) => {
    const bucket = FLOW_INDEX_SYMBOLS.has(evt.ticker)
      ? totals.indices
      : totals.equities;
    if (evt.cp === "C") bucket.calls += evt.premium;
    else bucket.puts += evt.premium;
  });

  const toRatio = ({ calls, puts }) =>
    calls > 0 ? puts / calls : calls === 0 && puts === 0 ? null : null;
  const equities = toRatio(totals.equities);
  const indices = toRatio(totals.indices);
  const calls = totals.equities.calls + totals.indices.calls;
  const puts = totals.equities.puts + totals.indices.puts;
  const total = calls > 0 ? puts / calls : calls === 0 && puts === 0 ? null : null;

  return {
    total,
    equities,
    indices,
    calls,
    puts,
  };
};

const buildTradeOptionFlowByDte = (events) => {
  const buckets = [
    {
      label: "0DTE",
      match: (dte) => dte <= 0,
      callPrem: 0,
      putPrem: 0,
      total: 0,
    },
    {
      label: "1-7d",
      match: (dte) => dte >= 1 && dte <= 7,
      callPrem: 0,
      putPrem: 0,
      total: 0,
    },
    {
      label: "8-30d",
      match: (dte) => dte >= 8 && dte <= 30,
      callPrem: 0,
      putPrem: 0,
      total: 0,
    },
    {
      label: "30d+",
      match: (dte) => dte > 30,
      callPrem: 0,
      putPrem: 0,
      total: 0,
    },
  ];

  (events || []).forEach((evt) => {
    const bucket =
      buckets.find((entry) => entry.match(evt.dte)) ||
      buckets[buckets.length - 1];
    const amount = evt.premium / 1000;
    if (evt.cp === "C") bucket.callPrem += amount;
    else bucket.putPrem += amount;
    bucket.total += amount;
  });

  return buckets.map(({ match, ...bucket }) => ({
    ...bucket,
    callPrem: +bucket.callPrem.toFixed(1),
    putPrem: +bucket.putPrem.toFixed(1),
    total: +bucket.total.toFixed(1),
  }));
};

const buildTradeOptionFlowByStrike = (events, spotPrice) => {
  const grouped = new Map();

  (events || []).forEach((evt) => {
    const entry = grouped.get(evt.strike) || {
      strike: evt.strike,
      callPrem: 0,
      putPrem: 0,
      total: 0,
      isATM: false,
    };
    const amount = evt.premium / 1000;
    if (evt.cp === "C") entry.callPrem += amount;
    else entry.putPrem += amount;
    entry.total += amount;
    grouped.set(evt.strike, entry);
  });

  const rows = Array.from(grouped.values()).sort(
    (left, right) => left.strike - right.strike,
  );
  if (!rows.length) return [];

  const sortedByDistance = isFiniteNumber(spotPrice)
    ? rows
        .slice()
        .sort(
          (left, right) =>
            Math.abs(left.strike - spotPrice) -
            Math.abs(right.strike - spotPrice),
        )
        .slice(0, 15)
    : rows.slice(0, 15);
  const visible = sortedByDistance.sort(
    (left, right) => left.strike - right.strike,
  );
  const atmStrike = isFiniteNumber(spotPrice)
    ? visible.reduce(
        (closest, row) =>
          Math.abs(row.strike - spotPrice) < Math.abs(closest - spotPrice)
            ? row.strike
            : closest,
        visible[0].strike,
      )
    : visible[Math.floor(visible.length / 2)]?.strike ?? visible[0].strike;

  return visible.map((row) => ({
    ...row,
    callPrem: +row.callPrem.toFixed(0),
    putPrem: +row.putPrem.toFixed(0),
    total: +row.total.toFixed(0),
    isATM: row.strike === atmStrike,
  }));
};

const buildTradeOptionFlowTimeline = (events) => {
  const startMinutes = 9 * 60 + 30;
  const bucketMinutes = 15;
  const bucketCount = 26;
  const buckets = Array.from({ length: bucketCount }, (_, index) => ({
    time: formatSessionBucketLabel(startMinutes + index * bucketMinutes),
    t: index,
    callPrem: 0,
    putPrem: 0,
    net: 0,
    cumCall: 0,
    cumPut: 0,
    cumNet: 0,
  }));

  (events || []).forEach((evt) => {
    const minutes = toSessionMinutes(evt.occurredAt);
    if (minutes == null) return;
    const clamped = Math.max(
      startMinutes,
      Math.min(startMinutes + bucketMinutes * (bucketCount - 1), minutes),
    );
    const bucketIndex = Math.min(
      bucketCount - 1,
      Math.floor((clamped - startMinutes) / bucketMinutes),
    );
    const amount = evt.premium / 1000;
    if (evt.cp === "C") buckets[bucketIndex].callPrem += amount;
    else buckets[bucketIndex].putPrem += amount;
  });

  let cumCall = 0;
  let cumPut = 0;
  return buckets.map((bucket) => {
    cumCall += bucket.callPrem;
    cumPut += bucket.putPrem;
    const net = bucket.callPrem - bucket.putPrem;
    return {
      ...bucket,
      callPrem: +bucket.callPrem.toFixed(1),
      putPrem: +bucket.putPrem.toFixed(1),
      net: +net.toFixed(1),
      cumCall: +cumCall.toFixed(1),
      cumPut: +cumPut.toFixed(1),
      cumNet: +(cumCall - cumPut).toFixed(1),
    };
  });
};

const buildTradeFlowMarkersFromEvents = (events, barsLength) => {
  if (!barsLength) return [];

  return (events || [])
    .slice()
    .sort((left, right) => right.premium - left.premium)
    .slice(0, 8)
    .map((evt) => {
      const minutes = toSessionMinutes(evt.occurredAt);
      const normalizedMinutes =
        minutes == null
          ? 9 * 60 + 30
          : Math.max(9 * 60 + 30, Math.min(16 * 60, minutes));
      const ratio =
        (normalizedMinutes - (9 * 60 + 30)) / (16 * 60 - (9 * 60 + 30));
      return {
        barIdx: Math.max(
          0,
          Math.min(barsLength - 1, Math.round(ratio * (barsLength - 1))),
        ),
        cp: evt.cp,
        size:
          evt.premium >= 500000 ? "lg" : evt.premium >= 150000 ? "md" : "sm",
        golden: evt.golden,
      };
    });
};

const resolveApiBarTimestampMs = (value) => {
  if (value instanceof Date) {
    return value.getTime();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 1e12 ? Math.floor(value) : Math.floor(value * 1000);
  }

  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }

  return null;
};

const buildChartBarsFromApi = (bars) =>
  (bars || []).reduce((result, bar, index) => {
    const timeMs = resolveApiBarTimestampMs(
      bar?.timestamp ?? bar?.ts ?? bar?.time,
    );
    if (timeMs == null) {
      return result;
    }

    result.push({
      time: timeMs,
      timestamp: timeMs,
      ts:
        typeof bar?.timestamp === "string"
          ? bar.timestamp
          : typeof bar?.ts === "string"
            ? bar.ts
            : new Date(timeMs).toISOString(),
      o: bar.open,
      h: bar.high,
      l: bar.low,
      c: bar.close,
      v: bar.volume,
      vwap: Number.isFinite(bar?.vwap) ? bar.vwap : null,
      sessionVwap: Number.isFinite(bar?.sessionVwap) ? bar.sessionVwap : null,
      accumulatedVolume: Number.isFinite(bar?.accumulatedVolume)
        ? bar.accumulatedVolume
        : null,
      averageTradeSize: Number.isFinite(bar?.averageTradeSize)
        ? bar.averageTradeSize
        : null,
      source: typeof bar?.source === "string" ? bar.source : null,
      i: index,
      uoa: 0,
    });
    return result;
  }, []);

const buildMiniChartBarsFromApi = (bars) => buildChartBarsFromApi(bars);

const buildTradeBarsFromApi = (bars) => buildChartBarsFromApi(bars);

const CHART_TIMEFRAME_STEP_MS = {
  "1m": 60 * 1000,
  "5m": 5 * 60 * 1000,
  "15m": 15 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "1D": 24 * 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
};

const describeBrokerChartSource = (source) => {
  if (source === "ibkr-websocket-derived") return "WS";
  if (source === "ibkr+massive-gap-fill") return "IBKR + GAP";
  if (source === "ibkr-history") return "IBKR";
  return source ? "REST" : "";
};

const describeBrokerChartStatus = (status, timeframe) =>
  status === "live" ? `IBKR ${timeframe}` : status;

// ═══════════════════════════════════════════════════════════════════
// SCREENS
// ═══════════════════════════════════════════════════════════════════

const SCREENS = [
  { id: "market", label: "Market", icon: "◉" },
  { id: "flow", label: "Flow", icon: "◈" },
  { id: "trade", label: "Trade", icon: "◧" },
  { id: "research", label: "Research", icon: "◎" },
  { id: "algo", label: "Algo", icon: "⬡" },
  { id: "backtest", label: "Backtest", icon: "⏣" },
];

// ═══════════════════════════════════════════════════════════════════
// SMALL COMPONENTS
// ═══════════════════════════════════════════════════════════════════

const Pill = ({ children, active, onClick, color }) => (
  <button
    onClick={onClick}
    style={{
      padding: sp("3px 7px"),
      fontSize: fs(11),
      fontFamily: T.sans,
      fontWeight: 600,
      border: `1px solid ${active ? color || T.accent : T.border}`,
      borderRadius: dim(4),
      cursor: "pointer",
      transition: "all 0.15s",
      background: active ? `${color || T.accent}18` : "transparent",
      color: active ? color || T.accent : T.textDim,
    }}
  >
    {children}
  </button>
);

// Format dollar amount in millions (or thousands if smaller). Module-level so any screen can use it.
const fmtM = (v) =>
  v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${(v / 1e3).toFixed(0)}K`;
const MISSING_VALUE = "----";
const fmtCompactCurrency = (value) => {
  if (value == null || Number.isNaN(value)) return MISSING_VALUE;
  if (Math.abs(value) >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  if (Math.abs(value) >= 1e3) return `$${(value / 1e3).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
};
const fmtCompactNumber = (value) => {
  if (value == null || Number.isNaN(value)) return MISSING_VALUE;
  if (Math.abs(value) >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (Math.abs(value) >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (Math.abs(value) >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return value.toFixed(0);
};
const fmtQuoteVolume = (value) =>
  value == null || Number.isNaN(value) ? MISSING_VALUE : fmtCompactNumber(value);
const isFiniteNumber = (value) =>
  typeof value === "number" && Number.isFinite(value);
const formatPriceValue = (value, digits = 2) =>
  isFiniteNumber(value) ? value.toFixed(digits) : MISSING_VALUE;
const formatQuotePrice = (value) =>
  isFiniteNumber(value)
    ? value < 10
      ? value.toFixed(3)
      : value.toFixed(2)
    : MISSING_VALUE;
const formatSignedPrice = (value, digits = 2) =>
  isFiniteNumber(value)
    ? `${value >= 0 ? "+" : ""}${value.toFixed(digits)}`
    : MISSING_VALUE;
const formatSignedPercent = (value, digits = 2) =>
  isFiniteNumber(value)
    ? `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`
    : MISSING_VALUE;
const getAtmStrikeFromPrice = (price, increment = 5) =>
  isFiniteNumber(price) ? Math.round(price / increment) * increment : null;

const QUERY_DEFAULTS = {
  staleTime: 15_000,
  refetchInterval: 15_000,
  retry: 2,
  retryDelay: (attempt) => Math.min(1_000 * (attempt + 1), 5_000),
  refetchOnMount: true,
};

// Bar/chart data is expensive on the upstream broker (each /api/bars call
// can hold an IBKR history slot for many seconds). Live updates flow in
// through the streaming aggregate hook (`useBrokerStreamedBars`), so we
// don't need React Query to repoll bars on a 15s timer. Use a long
// staleTime, no automatic refetch interval, and an explicit gcTime so
// chart caches for inactive symbols/timeframes are evicted from memory.
const BARS_QUERY_DEFAULTS = {
  staleTime: 60_000,
  gcTime: 5 * 60_000,
  refetchInterval: false,
  refetchOnMount: false,
  retry: 1,
  retryDelay: (attempt) => Math.min(1_000 * (attempt + 1), 5_000),
};

const clampNumber = (value, min, max) =>
  Math.min(max, Math.max(min, value));

const buildApiUrl = (path, params = {}) => {
  const origin =
    typeof window !== "undefined" && window.location?.origin
      ? window.location.origin
      : "http://localhost";
  const url = new URL(path, origin);

  Object.entries(params).forEach(([key, value]) => {
    if (value == null || value === "") return;
    url.searchParams.set(key, String(value));
  });

  return url.toString();
};

const requestPlatformJson = async (path, params = {}) => {
  const response = await fetch(buildApiUrl(path, params), {
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const errorPayload = await response.json().catch(() => null);
    throw new Error(
      errorPayload?.detail ||
        errorPayload?.title ||
        `Request failed with status ${response.status}.`,
    );
  }

  return response.json();
};

const listBrokerExecutionsRequest = (params = {}) =>
  requestPlatformJson("/api/executions", params);

const getBrokerMarketDepthRequest = (params = {}) =>
  requestPlatformJson("/api/market-depth", params);

const FINAL_ORDER_STATUSES = new Set([
  "filled",
  "canceled",
  "rejected",
  "expired",
]);

const formatExecutionContractLabel = (execution) => {
  if (!execution) return MISSING_VALUE;
  if (execution.assetClass === "option") {
    return execution.contractDescription || `${execution.symbol} OPTION`;
  }
  return "EQUITY";
};

const sameOptionContract = (left, right) => {
  if (!left || !right) return false;

  return (
    Number(left.strike) === Number(right.strike) &&
    String(left.right).toLowerCase() === String(right.right).toLowerCase() &&
    formatIsoDate(left.expirationDate) === formatIsoDate(right.expirationDate)
  );
};

const toDateValue = (value) => {
  if (!value) return null;
  if (value instanceof Date)
    return Number.isNaN(value.getTime()) ? null : value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const getEtClockParts = (value) => {
  const date = toDateValue(value);
  if (!date) return null;

  const parts = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "America/New_York",
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(
    parts.find((part) => part.type === "minute")?.value ?? "0",
  );

  return { hour, minute };
};

const formatEtTime = (value, { seconds = false } = {}) => {
  const date = toDateValue(value);
  if (!date) return MISSING_VALUE;

  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    ...(seconds ? { second: "2-digit" } : {}),
    hour12: false,
    timeZone: "America/New_York",
  });
};

const formatExpirationLabel = (value) => {
  if (typeof value === "string" && /^\d{2}\/\d{2}$/.test(value)) return value;

  const date = toDateValue(value);
  if (!date) return value || MISSING_VALUE;

  return `${String(date.getUTCMonth() + 1).padStart(2, "0")}/${String(date.getUTCDate()).padStart(2, "0")}`;
};

const parseExpirationValue = (value) => {
  const parsed = toDateValue(value);
  if (parsed) return parsed;
  if (typeof value !== "string") return null;

  const match = value.match(/^(\d{2})\/(\d{2})$/);
  if (!match) return null;

  const now = new Date();
  const month = Number(match[1]);
  const day = Number(match[2]);
  let candidate = new Date(Date.UTC(now.getUTCFullYear(), month - 1, day));

  if (candidate.getTime() < now.getTime() - 7 * 24 * 60 * 60 * 1000) {
    candidate = new Date(Date.UTC(now.getUTCFullYear() + 1, month - 1, day));
  }

  return candidate;
};

const formatIsoDate = (value) => {
  const date = toDateValue(value);
  if (!date) return null;

  const parts = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "America/New_York",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  return year && month && day ? `${year}-${month}-${day}` : null;
};

const formatShortDate = (value) => {
  const date = toDateValue(value);
  if (!date) return MISSING_VALUE;

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "America/New_York",
  });
};

const formatRelativeTimeShort = (value) => {
  const date = toDateValue(value);
  if (!date) return MISSING_VALUE;

  const deltaMs = Date.now() - date.getTime();
  if (deltaMs < 0) return formatShortDate(date);

  const deltaMinutes = Math.floor(deltaMs / 60_000);
  if (deltaMinutes < 1) return "now";
  if (deltaMinutes < 60) return `${deltaMinutes}m`;

  const deltaHours = Math.floor(deltaMinutes / 60);
  if (deltaHours < 24) return `${deltaHours}h`;

  const deltaDays = Math.floor(deltaHours / 24);
  if (deltaDays < 7) return `${deltaDays}d`;

  return formatShortDate(date);
};

const formatEnumLabel = (value) =>
  String(value || MISSING_VALUE)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());

const orderStatusColor = (status) => {
  switch (status) {
    case "filled":
      return T.green;
    case "accepted":
    case "submitted":
    case "partially_filled":
    case "pending_submit":
      return T.accent;
    case "canceled":
    case "expired":
      return T.textDim;
    case "rejected":
      return T.red;
    default:
      return T.text;
  }
};

const bridgeRuntimeTone = (session) => {
  if (!session?.configured?.ibkr) return { label: "offline", color: T.red };
  if (session?.ibkrBridge?.liveMarketDataAvailable === false) {
    return { label: "delayed", color: T.amber };
  }
  if (session?.ibkrBridge?.authenticated)
    return { label: "authenticated", color: T.green };
  if (session?.ibkrBridge?.connected)
    return { label: "login required", color: T.amber };
  if (session?.ibkrBridge?.lastError) return { label: "error", color: T.red };
  return { label: "configured", color: T.textDim };
};

const bridgeTransportLabel = (session) =>
  session?.ibkrBridge?.transport === "tws"
    ? "IB Gateway / TWS"
    : "Client Portal";

const bridgeRuntimeMessage = (session) => {
  if (!session?.configured?.ibkr) {
    return "Interactive Brokers is not configured in this workspace.";
  }

  const marketDataMode = session?.ibkrBridge?.marketDataMode || null;
  if (session?.ibkrBridge?.authenticated) {
    const accountMeta = session.ibkrBridge.selectedAccountId
      ? ` account ${session.ibkrBridge.selectedAccountId}`
      : "";
    const transportMeta = bridgeTransportLabel(session);
    if (session?.ibkrBridge?.liveMarketDataAvailable === false) {
      const modeMeta = marketDataMode ? ` (${marketDataMode})` : "";
      return `IBKR bridge authenticated via ${transportMeta}${accountMeta}, but market data is delayed${modeMeta}.`;
    }
    return `IBKR bridge authenticated via ${transportMeta}${accountMeta}.`;
  }

  if (session?.ibkrBridge?.connected) {
    return `${bridgeTransportLabel(session)} is reachable, but the broker session still needs login/authorization.`;
  }

  if (session?.ibkrBridge?.lastRecoveryError) {
    return session.ibkrBridge.lastRecoveryError;
  }

  if (session?.ibkrBridge?.lastError) {
    return session.ibkrBridge.lastError;
  }

  return "IBKR connectivity is configured, but the local bridge has not authenticated yet.";
};

const ET_CLOCK_PARTS_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

const ET_WEEKDAY_INDEX = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const formatClockCountdown = (totalSeconds) => {
  const safeSeconds = Math.max(0, Math.round(totalSeconds || 0));
  const days = Math.floor(safeSeconds / 86400);
  const hours = Math.floor((safeSeconds % 86400) / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;
  const hhmmss = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return days > 0 ? `${days}d ${hhmmss}` : hhmmss;
};

const buildMarketClockState = (now = Date.now()) => {
  const parts = Object.fromEntries(
    ET_CLOCK_PARTS_FORMATTER.formatToParts(new Date(now)).map((part) => [
      part.type,
      part.value,
    ]),
  );
  const weekdayIndex = ET_WEEKDAY_INDEX[parts.weekday] ?? 0;
  const hour = Number(parts.hour || 0);
  const minute = Number(parts.minute || 0);
  const second = Number(parts.second || 0);
  const currentSeconds = hour * 3600 + minute * 60 + second;
  const openSeconds = 9 * 3600 + 30 * 60;
  const closeSeconds = 16 * 3600;
  const afterHoursCloseSeconds = 20 * 3600;
  const nextBusinessDayOffset =
    weekdayIndex === 5 ? 3 : weekdayIndex === 6 ? 2 : weekdayIndex === 0 ? 1 : 1;

  const base = {
    timeLabel: `${parts.hour}:${parts.minute}:${parts.second} ET`,
    dateLabel: `${parts.weekday} ${parts.month} ${parts.day}`,
  };

  if (weekdayIndex === 0 || weekdayIndex === 6) {
    const daysUntilOpen = weekdayIndex === 6 ? 2 : 1;
    return {
      ...base,
      phase: "weekend",
      label: "Weekend",
      action: "Opens",
      timerLabel: formatClockCountdown(
        daysUntilOpen * 86400 + openSeconds - currentSeconds,
      ),
      color: T.textDim,
    };
  }

  if (currentSeconds < openSeconds) {
    return {
      ...base,
      phase: "pre",
      label: "Pre-market",
      action: "Opens",
      timerLabel: formatClockCountdown(openSeconds - currentSeconds),
      color: T.amber,
    };
  }

  if (currentSeconds < closeSeconds) {
    return {
      ...base,
      phase: "open",
      label: "Market open",
      action: "Closes",
      timerLabel: formatClockCountdown(closeSeconds - currentSeconds),
      color: T.green,
    };
  }

  if (currentSeconds < afterHoursCloseSeconds) {
    return {
      ...base,
      phase: "post",
      label: "After hours",
      action: "Opens",
      timerLabel: formatClockCountdown(
        nextBusinessDayOffset * 86400 + openSeconds - currentSeconds,
      ),
      color: T.amber,
    };
  }

  return {
    ...base,
    phase: "closed",
    label: "Closed",
    action: "Opens",
    timerLabel: formatClockCountdown(
      nextBusinessDayOffset * 86400 + openSeconds - currentSeconds,
    ),
    color: T.textDim,
  };
};

const parseSymbolUniverseInput = (value) =>
  String(value || "")
    .split(",")
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean)
    .filter((symbol, index, values) => values.indexOf(symbol) === index);

const formatCalendarMeta = (dateValue, timeValue) => {
  const dateLabel = formatShortDate(dateValue);
  if (!timeValue) return dateLabel;

  const normalized = String(timeValue).trim().toUpperCase();
  if (!normalized) return dateLabel;

  return `${dateLabel} · ${normalized}`;
};

const mapNewsSentimentToScore = (sentiment) => {
  const normalized = String(sentiment || "")
    .trim()
    .toLowerCase();
  if (!normalized) return 0;
  if (normalized.includes("bull") || normalized.includes("positive")) return 1;
  if (normalized.includes("bear") || normalized.includes("negative")) return -1;
  return 0;
};

const daysToExpiration = (value) => {
  const date = parseExpirationValue(value);
  if (!date) return 0;

  const now = new Date();
  const start = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  const end = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  );

  return Math.max(0, Math.round((end - start) / (24 * 60 * 60 * 1000)));
};

const toSessionMinutes = (value) => {
  const parts = getEtClockParts(value);
  if (!parts) return null;
  return parts.hour * 60 + parts.minute;
};

const formatSessionBucketLabel = (minutes) => {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${hour}:${String(minute).padStart(2, "0")}`;
};

const flowProviderColor = (provider) =>
  provider === "ibkr" ? T.accent : provider === "polygon" ? T.cyan : T.textDim;

const flowEventSourceLabel = (event) => {
  const provider = (event.provider || "unknown").toUpperCase();
  const basis = event.basis === "trade" ? "TRADE" : "SNAPSHOT";
  return `${provider} ${basis}`;
};

const deriveFlowType = (event) => {
  const conditions = (event.tradeConditions || []).map((condition) =>
    String(condition).toLowerCase(),
  );

  // An "unusual" tag (volume > open interest) trumps the heuristic labels.
  // It is the strongest single signal in the event and what we want to flag.
  if (event.isUnusual) {
    return "UNUSUAL";
  }
  if (event.basis === "snapshot") {
    return event.premium >= 500000 ? "XL" : "ACTIVE";
  }
  if (
    event.premium >= 500000 ||
    conditions.some((condition) => condition.includes("block"))
  ) {
    return "BLOCK";
  }
  if (event.side === "buy" && event.premium >= 100000) {
    return "SWEEP";
  }
  if (conditions.length > 1) {
    return "MULTI";
  }

  return "SPLIT";
};

const deriveFlowScore = (event, dte) => {
  let score = 35;
  score += Math.min(35, event.premium / 20000);
  score += event.side === "buy" ? 12 : event.side === "sell" ? 5 : 0;
  score += event.sentiment === "neutral" ? 0 : 10;
  score -= Math.min(10, dte / 7);
  if (event.isUnusual) {
    // Boost unusual events noticeably so they sort to the top of any
    // score-based view, with extra credit for higher volume/OI ratios.
    score += 18 + Math.min(12, (event.unusualScore || 0) * 4);
  }
  return Math.max(10, Math.min(99, Math.round(score)));
};

const mapFlowEventToUi = (event) => {
  const dte = daysToExpiration(event.expirationDate);
  const cp = event.right === "call" ? "C" : "P";
  const side = (event.side || "mid").toUpperCase();

  return {
    id: event.id,
    time: formatEtTime(event.occurredAt),
    ticker: event.underlying,
    provider: event.provider || "unknown",
    basis: event.basis || "trade",
    sourceLabel: flowEventSourceLabel(event),
    side,
    contract: `${event.underlying} ${event.strike}${cp} ${formatExpirationLabel(event.expirationDate)}`,
    strike: event.strike,
    cp,
    premium: event.premium,
    vol: event.size,
    oi: isFiniteNumber(event.openInterest) ? event.openInterest : null,
    iv: isFiniteNumber(event.impliedVolatility)
      ? event.impliedVolatility
      : null,
    dte,
    type: deriveFlowType(event),
    golden:
      side === "BUY" &&
      event.premium >= 150000 &&
      event.sentiment === "bullish",
    score: deriveFlowScore(event, dte),
    optionTicker: event.optionTicker,
    expirationDate: event.expirationDate,
    occurredAt: event.occurredAt,
    sentiment: event.sentiment,
    tradeConditions: event.tradeConditions || [],
    isUnusual: Boolean(event.isUnusual),
    unusualScore: isFiniteNumber(event.unusualScore) ? event.unusualScore : 0,
  };
};

const useLiveMarketFlow = (
  symbols = [],
  { limit = 16, unusualThreshold } = {},
) => {
  const liveSymbols = useMemo(
    () =>
      [
        ...new Set(
          (symbols || [])
            .map((symbol) => symbol?.toUpperCase())
            .filter(Boolean),
        ),
      ].slice(0, 8),
    [symbols],
  );
  const normalizedThreshold =
    Number.isFinite(unusualThreshold) && unusualThreshold > 0
      ? unusualThreshold
      : undefined;
  const flowQuery = useQuery({
    queryKey: ["market-flow", liveSymbols, limit, normalizedThreshold ?? null],
    enabled: liveSymbols.length > 0,
    queryFn: async () => {
      const results = await Promise.allSettled(
        liveSymbols.map((symbol) =>
          listFlowEventsRequest({
            underlying: symbol,
            limit,
            ...(normalizedThreshold !== undefined
              ? { unusualThreshold: normalizedThreshold }
              : {}),
          }),
        ),
      );

      const responses = [];
      const failures = [];

      results.forEach((result, index) => {
        const symbol = liveSymbols[index];
        if (result.status === "fulfilled") {
          responses.push({
            symbol,
            events: result.value.events || [],
            source: result.value.source || null,
          });
          return;
        }

        failures.push({
          symbol,
          error:
            result.reason instanceof Error
              ? result.reason.message
              : String(result.reason ?? "Flow request failed"),
        });
      });

      return {
        responses,
        failures,
        events: responses.flatMap((response) => response.events || []),
      };
    },
    staleTime: 10_000,
    refetchInterval: 10_000,
    retry: false,
  });

  const hasLiveFlow = (flowQuery.data?.events?.length || 0) > 0;
  const flowEvents = useMemo(() => {
    if (!hasLiveFlow) return [];
    return (flowQuery.data?.events || [])
      .map(mapFlowEventToUi)
      .sort((left, right) => {
        // Float volume-vs-OI "unusual" events to the top so the notifications
        // feed and unusual-options panel surface them ahead of routine high-
        // premium events, then fall back to premium for ranking within bands.
        if (left.isUnusual !== right.isUnusual) {
          return left.isUnusual ? -1 : 1;
        }
        if (left.isUnusual && right.isUnusual && left.unusualScore !== right.unusualScore) {
          return right.unusualScore - left.unusualScore;
        }
        return right.premium - left.premium;
      });
  }, [hasLiveFlow, flowQuery.data]);
  const flowStatus = hasLiveFlow
    ? "live"
    : flowQuery.isPending
      ? "loading"
      : flowQuery.isError
        ? "offline"
        : "empty";
  const providerSummary = useMemo(() => {
    const responses = flowQuery.data?.responses || [];
    const failures = flowQuery.data?.failures || [];
    const events = flowQuery.data?.events || [];
    const providerSet = new Set(events.map((event) => event.provider).filter(Boolean));
    const fallbackUsed = responses.some((response) =>
      Boolean(response.source?.fallbackUsed),
    );
    const erroredSource =
      responses.find((response) => response.source?.status === "error")?.source ||
      null;
    const sourcesBySymbol = Object.fromEntries(
      responses.map((response) => [response.symbol, response.source]),
    );

    let label = "No IBKR flow";
    let color = T.textMuted;
    if (flowQuery.isPending) {
      label = "Loading flow";
      color = T.accent;
    } else if (providerSet.has("ibkr") && providerSet.has("polygon")) {
      label = "Mixed sources";
      color = T.amber;
    } else if (providerSet.has("ibkr")) {
      label = "IBKR snapshot live";
      color = T.accent;
    } else if (providerSet.has("polygon")) {
      label = "Polygon trade fallback";
      color = T.cyan;
    } else if (failures.length || erroredSource) {
      label = "Flow source error";
      color = T.red;
    } else if (fallbackUsed) {
      label = "Fallback empty";
      color = T.textMuted;
    }

    return {
      label,
      color,
      fallbackUsed,
      sourcesBySymbol,
      failures,
      erroredSource,
      providers: Array.from(providerSet),
    };
  }, [flowQuery.data, flowQuery.isPending]);

  return {
    hasLiveFlow,
    flowStatus,
    providerSummary,
    flowEvents,
    flowTide: buildFlowTideFromEvents(flowEvents),
    tickerFlow: buildTickerFlowFromEvents(flowEvents),
    flowClock: buildFlowClockFromEvents(flowEvents),
    sectorFlow: buildSectorFlowFromEvents(flowEvents),
    dteBuckets: buildDteBucketsFromEvents(flowEvents),
    marketOrderFlow: buildMarketOrderFlowFromEvents(flowEvents),
    putCall: buildPutCallSummaryFromEvents(flowEvents),
  };
};

const Badge = ({ children, color = T.textDim }) => (
  <span
    style={{
      display: "inline-block",
      padding: sp("1px 6px"),
      borderRadius: dim(3),
      fontSize: fs(9),
      fontWeight: 700,
      fontFamily: T.mono,
      letterSpacing: "0.04em",
      background: `${color}18`,
      color,
      border: `1px solid ${color}30`,
    }}
  >
    {children}
  </span>
);

const DataUnavailableState = ({
  title = "No live data",
  detail = "This panel is waiting on a live provider response.",
}) => (
  <div
    style={{
      width: "100%",
      height: "100%",
      minHeight: dim(96),
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: sp(12),
      textAlign: "center",
      background: T.bg0,
      border: `1px dashed ${T.border}`,
      borderRadius: dim(4),
      color: T.textDim,
      fontFamily: T.sans,
    }}
  >
    <div style={{ maxWidth: dim(260) }}>
      <div
        style={{
          fontSize: fs(10),
          fontWeight: 700,
          color: T.textSec,
          letterSpacing: "0.04em",
        }}
      >
        {title}
      </div>
      <div
        style={{
          marginTop: sp(4),
          fontSize: fs(9),
          lineHeight: 1.45,
          fontFamily: T.mono,
        }}
      >
        {detail}
      </div>
    </div>
  </div>
);

const extractSparklineValues = (data = []) =>
  (Array.isArray(data) ? data : [])
    .map((point) => {
      if (typeof point === "number" && Number.isFinite(point)) {
        return point;
      }
      if (typeof point?.close === "number" && Number.isFinite(point.close)) {
        return point.close;
      }
      if (typeof point?.c === "number" && Number.isFinite(point.c)) {
        return point.c;
      }
      if (typeof point?.v === "number" && Number.isFinite(point.v)) {
        return point.v;
      }
      return null;
    })
    .filter((value) => Number.isFinite(value));

const MicroSparkline = ({
  data = [],
  positive = null,
  width = 64,
  height = 24,
}) => {
  const values = useMemo(() => extractSparklineValues(data), [data]);

  if (values.length < 2) {
    return null;
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const step = width / Math.max(values.length - 1, 1);
  const inferredPositive = values[values.length - 1] >= values[0];
  const resolvedPositive =
    typeof positive === "boolean" ? positive : inferredPositive;
  const lineColor = resolvedPositive ? T.green : T.red;
  const plottedPoints = values
    .map((value, index) => {
      const x = index * step;
      const y = height - ((value - min) / range) * Math.max(height - 2, 1) - 1;
      return [x.toFixed(2), y.toFixed(2)];
    });
  const points = plottedPoints.map(([x, y]) => `${x},${y}`).join(" ");
  const areaPath = `M ${plottedPoints
    .map(([x, y], index) => `${index === 0 ? "" : "L "}${x},${y}`)
    .join(" ")} L ${width},${height} L 0,${height} Z`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      style={{ display: "block" }}
    >
      <path d={areaPath} fill={`${lineColor}1f`} />
      <polyline
        points={points}
        fill="none"
        stroke={lineColor}
        strokeWidth="1.55"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
};

const HeaderKpiStrip = ({ items = [], onSelect }) => (
  <div
    style={{
      display: "flex",
      alignItems: "stretch",
      gap: 0,
      minWidth: 0,
      overflowX: "auto",
    }}
  >
    {items.map((item, index) => {
      const positive = isFiniteNumber(item?.pct) ? item.pct >= 0 : null;
      return (
        <button
          key={item.sym}
          type="button"
          onClick={() => onSelect?.(item.sym)}
          title={`${item.label} proxy · ${item.sym}`}
          style={{
            minWidth: dim(132),
            padding: sp("5px 10px"),
            display: "flex",
            alignItems: "center",
            gap: sp(8),
            background: "transparent",
            border: "none",
            borderLeft: index === 0 ? "none" : `1px solid ${T.border}`,
            borderRadius: 0,
            color: T.text,
            cursor: "pointer",
            transition: "background 0.12s ease, color 0.12s ease",
          }}
          onMouseEnter={(event) => {
            event.currentTarget.style.background = `${T.bg3}80`;
          }}
          onMouseLeave={(event) => {
            event.currentTarget.style.background = "transparent";
          }}
        >
          <span
            style={{
              minWidth: 0,
              flex: 1,
              textAlign: "left",
              display: "flex",
              flexDirection: "column",
              gap: 1,
            }}
          >
            <span
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: sp(6),
                minWidth: 0,
              }}
            >
              <span
                style={{
                  display: "block",
                  fontSize: fs(7),
                  color: T.textMuted,
                  fontFamily: T.sans,
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  whiteSpace: "nowrap",
                }}
              >
                {item.label}
              </span>
              <span
                style={{
                  display: "block",
                  fontSize: fs(7),
                  fontWeight: 600,
                  color: T.textMuted,
                  fontFamily: T.sans,
                  lineHeight: 1.1,
                  letterSpacing: "0.08em",
                  flexShrink: 0,
                }}
              >
                {item.sym}
              </span>
            </span>
            <span
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: sp(6),
                minWidth: 0,
              }}
            >
              <span
                style={{
                  display: "block",
                  fontSize: fs(12),
                  fontWeight: 700,
                  fontFamily: T.sans,
                  color: T.text,
                  lineHeight: 1.1,
                  whiteSpace: "nowrap",
                }}
              >
                {formatQuotePrice(item.price)}
              </span>
              <span
                style={{
                  display: "block",
                  fontSize: fs(8),
                  fontWeight: 700,
                  fontFamily: T.sans,
                  color:
                    positive == null ? T.textDim : positive ? T.green : T.red,
                  lineHeight: 1.1,
                  whiteSpace: "nowrap",
                }}
              >
                {formatSignedPercent(item.pct)}
              </span>
            </span>
          </span>
          <span style={{ display: "block", flexShrink: 0 }}>
            <MicroSparkline
              data={item.sparkBars?.length ? item.sparkBars : item.spark}
              positive={positive}
              width={46}
              height={16}
            />
          </span>
        </button>
      );
    })}
  </div>
);

const HeaderStatusCluster = ({
  session,
  environment,
  bridgeTone,
  marketClock,
  theme,
  onToggleTheme,
}) => {
  const surfaceStyle = {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    minWidth: dim(130),
    padding: sp("7px 10px"),
    background: T.bg1,
    border: `1px solid ${T.border}`,
    borderRadius: 0,
    transition: "background 0.12s ease, border-color 0.12s ease",
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "stretch",
        justifyContent: "flex-end",
        gap: sp(6),
        flexWrap: "wrap",
      }}
    >
      <div
        title={bridgeRuntimeMessage(session)}
        style={surfaceStyle}
        onMouseEnter={(event) => {
          event.currentTarget.style.background = T.bg3;
          event.currentTarget.style.borderColor = T.textMuted;
        }}
        onMouseLeave={(event) => {
          event.currentTarget.style.background = T.bg1;
          event.currentTarget.style.borderColor = T.border;
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: sp(6),
            fontSize: fs(8),
            fontWeight: 700,
            fontFamily: T.sans,
            color: T.textMuted,
            letterSpacing: "0.08em",
          }}
        >
          <span
            style={{
              width: dim(7),
              height: dim(7),
              background: bridgeTone.color,
              display: "inline-block",
            }}
          />
          IBKR
        </div>
        <div
          style={{
            fontSize: fs(11),
            fontWeight: 700,
            fontFamily: T.sans,
            color: bridgeTone.color,
          }}
        >
          {session?.ibkrBridge?.transport === "tws" ? "TWS" : "CP"} ·{" "}
          {bridgeTone.label.toUpperCase()}
        </div>
        <div
          style={{
            fontSize: fs(8),
            color: T.textDim,
            fontFamily: T.sans,
          }}
        >
          {environment.toUpperCase()} ·{" "}
          {(session?.marketDataProviders?.live || MISSING_VALUE).toUpperCase()}
        </div>
      </div>

      <div
        title={`${marketClock.dateLabel} · ${marketClock.label}`}
        style={surfaceStyle}
        onMouseEnter={(event) => {
          event.currentTarget.style.background = T.bg3;
          event.currentTarget.style.borderColor = T.textMuted;
        }}
        onMouseLeave={(event) => {
          event.currentTarget.style.background = T.bg1;
          event.currentTarget.style.borderColor = T.border;
        }}
      >
        <div
          style={{
            fontSize: fs(8),
            fontWeight: 700,
            fontFamily: T.sans,
            color: T.textMuted,
            letterSpacing: "0.08em",
          }}
        >
          MARKET CLOCK
        </div>
        <div
          style={{
            fontSize: fs(12),
            fontWeight: 700,
            fontFamily: T.sans,
            color: T.text,
          }}
        >
          {marketClock.timeLabel}
        </div>
        <div
          style={{
            fontSize: fs(8),
            color: marketClock.color,
            fontFamily: T.sans,
            fontWeight: 700,
          }}
        >
          {marketClock.label.toUpperCase()} · {marketClock.action.toUpperCase()}{" "}
          {marketClock.timerLabel}
        </div>
      </div>

      <button
        type="button"
        onClick={onToggleTheme}
        title={
          theme === "dark" ? "Switch to light theme" : "Switch to dark theme"
        }
        style={{
          minWidth: dim(56),
          padding: sp("7px 10px"),
          background: T.bg1,
          border: `1px solid ${T.border}`,
          borderRadius: 0,
          color: T.textSec,
          cursor: "pointer",
          fontSize: fs(13),
          lineHeight: 1,
          fontFamily: T.sans,
          fontWeight: 700,
          transition: "background 0.12s ease, border-color 0.12s ease",
        }}
        onMouseEnter={(event) => {
          event.currentTarget.style.background = T.bg3;
          event.currentTarget.style.borderColor = T.textMuted;
        }}
        onMouseLeave={(event) => {
          event.currentTarget.style.background = T.bg1;
          event.currentTarget.style.borderColor = T.border;
        }}
      >
        {theme === "dark" ? "☼" : "☾"}
      </button>
    </div>
  );
};

const HeaderAccountStrip = ({
  accounts = [],
  primaryAccountId,
  primaryAccount,
  onSelectAccount,
}) => {
  const metricSurfaceStyle = {
    minWidth: dim(104),
    padding: sp("7px 10px"),
    background: T.bg1,
    border: `1px solid ${T.border}`,
    borderRadius: 0,
    transition: "background 0.12s ease, border-color 0.12s ease",
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "stretch",
        justifyContent: "flex-end",
        gap: sp(6),
        flexWrap: "wrap",
      }}
    >
      <div
        title="Active broker account for trading, orders, and portfolio views"
        style={{ ...metricSurfaceStyle, minWidth: dim(138) }}
        onMouseEnter={(event) => {
          event.currentTarget.style.background = T.bg3;
          event.currentTarget.style.borderColor = T.textMuted;
        }}
        onMouseLeave={(event) => {
          event.currentTarget.style.background = T.bg1;
          event.currentTarget.style.borderColor = T.border;
        }}
      >
        <div
          style={{
            fontSize: fs(8),
            color: T.textMuted,
            fontWeight: 700,
            letterSpacing: "0.08em",
            fontFamily: T.sans,
            marginBottom: 2,
          }}
        >
          ACCOUNT
        </div>
        {accounts.length ? (
          <select
            value={primaryAccountId || ""}
            onChange={(event) => onSelectAccount(event.target.value || null)}
            style={{
              width: "100%",
              background: "transparent",
              border: "none",
              color: T.text,
              fontSize: fs(11),
              fontFamily: T.sans,
              fontWeight: 700,
              outline: "none",
              padding: 0,
            }}
          >
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.id}
              </option>
            ))}
          </select>
        ) : (
          <div
            style={{
              fontSize: fs(11),
              fontFamily: T.sans,
              fontWeight: 700,
              color: T.textDim,
            }}
          >
            {primaryAccountId || MISSING_VALUE}
          </div>
        )}
      </div>

      {[
        {
          label: "Net Liq",
          value: primaryAccount
            ? fmtCompactCurrency(primaryAccount.netLiquidation)
            : MISSING_VALUE,
          color: T.text,
        },
        {
          label: "Buying Power",
          value: primaryAccount
            ? fmtCompactCurrency(primaryAccount.buyingPower)
            : MISSING_VALUE,
          color: T.green,
        },
        {
          label: "Cash",
          value: primaryAccount
            ? fmtCompactCurrency(primaryAccount.cash)
            : MISSING_VALUE,
          color: T.textSec,
        },
      ].map((metric) => (
        <div
          key={metric.label}
          title={metric.label}
          style={metricSurfaceStyle}
          onMouseEnter={(event) => {
            event.currentTarget.style.background = T.bg3;
            event.currentTarget.style.borderColor = T.textMuted;
          }}
          onMouseLeave={(event) => {
            event.currentTarget.style.background = T.bg1;
            event.currentTarget.style.borderColor = T.border;
          }}
        >
          <div
            style={{
              fontSize: fs(8),
              color: T.textMuted,
              fontWeight: 700,
              letterSpacing: "0.08em",
              fontFamily: T.sans,
              marginBottom: 2,
            }}
          >
            {metric.label}
          </div>
          <div
            style={{
              fontSize: fs(11),
              fontFamily: T.sans,
              fontWeight: 700,
              color: metric.color,
            }}
          >
            {metric.value}
          </div>
        </div>
      ))}
    </div>
  );
};

const Watchlist = ({
  watchlists = [],
  activeWatchlistId = null,
  items = [],
  selected,
  onSelect,
  onSelectWatchlist,
  onCreateWatchlist,
  onRenameWatchlist,
  onDeleteWatchlist,
  onSetDefaultWatchlist,
  onAddSymbol,
  onMoveSymbol,
  onRemoveSymbol,
  onSignalAction,
  signalStatesBySymbol = {},
  busy = false,
}) => {
  const toast = useToast();
  const rootRef = useRef(null);
  const [search, setSearch] = useState("");
  const [watchlistMenuOpen, setWatchlistMenuOpen] = useState(false);
  const [addMode, setAddMode] = useState(false);
  const [addQuery, setAddQuery] = useState("");
  const deferredAddQuery = useDeferredValue(addQuery.trim());
  const activeWatchlist =
    activeWatchlistId != null
      ? watchlists.find((watchlist) => watchlist.id === activeWatchlistId) ||
        null
      : watchlists[0] || null;
  const quickAddSymbols = useMemo(
    () =>
      [...new Set([...WATCHLIST, ...INDICES, ...MACRO_TICKERS].map((item) => item.sym))]
        .filter((symbol) => !items.some((item) => item.sym === symbol))
        .slice(0, 8),
    [items],
  );
  const addSymbolSearch = useSearchUniverseTickers(
    addMode && deferredAddQuery.length > 0
      ? {
          search: deferredAddQuery,
          market: "stocks",
          active: true,
          limit: 8,
        }
      : undefined,
    {
      query: {
        enabled: addMode && deferredAddQuery.length > 0,
        staleTime: 60_000,
        retry: false,
      },
    },
  );
  const filtered = items.filter(
    (w) =>
      w.sym.toLowerCase().includes(search.toLowerCase()) ||
      w.name.toLowerCase().includes(search.toLowerCase()),
  );

  useEffect(() => {
    if (
      typeof document === "undefined" ||
      (!watchlistMenuOpen && !addMode)
    ) {
      return undefined;
    }

    const handlePointerDown = (event) => {
      if (rootRef.current?.contains(event.target)) {
        return;
      }
      setWatchlistMenuOpen(false);
      if (addMode) {
        setAddMode(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [addMode, watchlistMenuOpen]);

  const handleCreateWatchlist = () => {
    const nextName = window.prompt("New watchlist name");
    if (!nextName?.trim()) {
      return;
    }
    onCreateWatchlist?.(nextName.trim());
  };

  const handleRenameWatchlist = () => {
    if (!activeWatchlist) {
      return;
    }
    const nextName = window.prompt("Rename watchlist", activeWatchlist.name);
    if (!nextName?.trim() || nextName.trim() === activeWatchlist.name) {
      return;
    }
    onRenameWatchlist?.(activeWatchlist.id, nextName.trim());
  };

  const handleDeleteWatchlist = () => {
    if (!activeWatchlist) {
      return;
    }
    const confirmed = window.confirm(
      `Delete watchlist "${activeWatchlist.name}"?`,
    );
    if (!confirmed) {
      return;
    }
    onDeleteWatchlist?.(activeWatchlist.id);
  };

  const handleAddQuickSymbol = (symbol) => {
    onAddSymbol?.(symbol, symbol);
    setAddMode(false);
    setAddQuery("");
  };

  return (
    <div
      ref={rootRef}
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: T.bg1,
        borderRight: `1px solid ${T.border}`,
        position: "relative",
      }}
    >
      <div
        style={{
          padding: sp("8px 10px 6px"),
          borderBottom: `1px solid ${T.border}`,
          display: "flex",
          flexDirection: "column",
          gap: sp(6),
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: sp(6) }}>
          <button
            type="button"
            onClick={() => setWatchlistMenuOpen((open) => !open)}
            style={{
              flex: 1,
              minWidth: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: sp(6),
              padding: sp("6px 8px"),
              borderRadius: 0,
              background: T.bg2,
              border: `1px solid ${T.border}`,
              color: T.text,
              cursor: "pointer",
              fontFamily: T.mono,
              fontSize: fs(10),
              fontWeight: 700,
            }}
          >
            <span
              style={{
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {activeWatchlist?.name || "Watchlists"}
            </span>
            <span style={{ color: T.textDim }}>▼</span>
          </button>
          <button
            type="button"
            onClick={handleCreateWatchlist}
            title="New watchlist"
            style={{
              padding: sp("6px 7px"),
              borderRadius: 0,
              background: T.bg2,
              border: `1px solid ${T.border}`,
              color: T.accent,
              cursor: "pointer",
              fontFamily: T.mono,
              fontSize: fs(10),
              fontWeight: 700,
            }}
          >
            NEW
          </button>
        </div>

        <div style={{ display: "flex", gap: sp(4) }}>
          <button
            type="button"
            onClick={handleRenameWatchlist}
            disabled={!activeWatchlist || busy}
            style={{
              flex: 1,
              padding: sp("4px 6px"),
              borderRadius: 0,
              background: "transparent",
              border: `1px solid ${T.border}`,
              color: T.textDim,
              cursor: activeWatchlist && !busy ? "pointer" : "default",
              fontFamily: T.mono,
              fontSize: fs(9),
            }}
          >
            RENAME
          </button>
          <button
            type="button"
            onClick={() => activeWatchlist && onSetDefaultWatchlist?.(activeWatchlist.id)}
            disabled={!activeWatchlist || activeWatchlist.isDefault || busy}
            style={{
              flex: 1,
              padding: sp("4px 6px"),
              borderRadius: 0,
              background: activeWatchlist?.isDefault ? `${T.green}12` : "transparent",
              border: `1px solid ${T.border}`,
              color: activeWatchlist?.isDefault ? T.green : T.textDim,
              cursor:
                activeWatchlist && !activeWatchlist.isDefault && !busy
                  ? "pointer"
                  : "default",
              fontFamily: T.mono,
              fontSize: fs(9),
            }}
          >
            {activeWatchlist?.isDefault ? "DEFAULT" : "SET DEF"}
          </button>
          <button
            type="button"
            onClick={handleDeleteWatchlist}
            disabled={!activeWatchlist || watchlists.length <= 1 || busy}
            style={{
              flex: 1,
              padding: sp("4px 6px"),
              borderRadius: 0,
              background: "transparent",
              border: `1px solid ${T.border}`,
              color: watchlists.length <= 1 ? T.textMuted : T.red,
              cursor:
                activeWatchlist && watchlists.length > 1 && !busy
                  ? "pointer"
                  : "default",
              fontFamily: T.mono,
              fontSize: fs(9),
            }}
          >
            DELETE
          </button>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: sp(6),
            padding: sp("5px 8px"),
            borderRadius: 0,
            background: T.bg2,
            border: `1px solid ${T.border}`,
          }}
        >
          <span style={{ fontSize: fs(12), color: T.textDim }}>⌕</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter watchlist..."
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              fontSize: fs(11),
              fontFamily: T.sans,
              color: T.text,
            }}
          />
        </div>

        {addMode ? (
          <div
          style={{
            border: `1px solid ${T.border}`,
            borderRadius: 0,
            background: T.bg2,
            overflow: "hidden",
          }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: sp(6),
                padding: sp("6px 8px"),
                borderBottom: `1px solid ${T.border}`,
              }}
            >
              <input
                value={addQuery}
                onChange={(e) => setAddQuery(e.target.value)}
                placeholder="Add symbol..."
                style={{
                  flex: 1,
                  background: "transparent",
                  border: "none",
                  outline: "none",
                  fontSize: fs(11),
                  fontFamily: T.mono,
                  color: T.text,
                }}
              />
              <button
                type="button"
                onClick={() => {
                  setAddMode(false);
                  setAddQuery("");
                }}
                style={{
                  border: "none",
                  background: "transparent",
                  color: T.textDim,
                  cursor: "pointer",
                  fontSize: fs(10),
                  fontFamily: T.mono,
                }}
              >
                CLOSE
              </button>
            </div>

            <div style={{ maxHeight: dim(180), overflowY: "auto" }}>
              {deferredAddQuery.length > 0
                ? (addSymbolSearch.data?.results || []).map((result) => (
                    <button
                      key={`${result.ticker}-${result.name}`}
                      type="button"
                      onClick={() => {
                        onAddSymbol?.(result.ticker, result.name || result.ticker);
                        setAddMode(false);
                        setAddQuery("");
                      }}
                      style={{
                        width: "100%",
                        display: "grid",
                        gridTemplateColumns: "56px 1fr",
                        gap: sp(8),
                        alignItems: "center",
                        padding: sp("7px 8px"),
                        background: "transparent",
                        border: "none",
                        borderBottom: `1px solid ${T.border}20`,
                        textAlign: "left",
                        cursor: "pointer",
                      }}
                    >
                      <span
                        style={{
                          fontSize: fs(10),
                          fontWeight: 700,
                          fontFamily: T.mono,
                          color: T.text,
                        }}
                      >
                        {result.ticker}
                      </span>
                      <span
                        style={{
                          fontSize: fs(9),
                          color: T.textSec,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {result.name || result.primaryExchange || "Equity"}
                      </span>
                    </button>
                  ))
                : quickAddSymbols.map((symbol) => (
                    <button
                      key={symbol}
                      type="button"
                      onClick={() => handleAddQuickSymbol(symbol)}
                      style={{
                        width: "100%",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: sp("7px 8px"),
                        background: "transparent",
                        border: "none",
                        borderBottom: `1px solid ${T.border}20`,
                        cursor: "pointer",
                        fontFamily: T.mono,
                        fontSize: fs(10),
                        color: T.text,
                      }}
                    >
                      <span>{symbol}</span>
                      <span style={{ color: T.textMuted }}>QUICK ADD</span>
                    </button>
                  ))}
              {addMode &&
              deferredAddQuery.length > 0 &&
              !addSymbolSearch.isPending &&
              !(addSymbolSearch.data?.results || []).length ? (
                <div
                  style={{
                    padding: sp("10px 8px"),
                    color: T.textDim,
                    fontSize: fs(9),
                    fontFamily: T.mono,
                  }}
                >
                  No matching symbols.
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      {watchlistMenuOpen ? (
        <div
          style={{
            position: "absolute",
            top: dim(42),
            left: sp(10),
            right: sp(10),
            zIndex: 20,
            background: T.bg2,
            border: `1px solid ${T.border}`,
            borderRadius: 0,
            boxShadow: "0 10px 24px rgba(0,0,0,0.3)",
            overflow: "hidden",
          }}
        >
          {watchlists.map((watchlist) => (
            <button
              key={watchlist.id}
              type="button"
              onClick={() => {
                onSelectWatchlist?.(watchlist.id);
                setWatchlistMenuOpen(false);
              }}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: sp(8),
                padding: sp("8px 10px"),
                background:
                  watchlist.id === activeWatchlistId ? T.bg3 : "transparent",
                border: "none",
                borderBottom: `1px solid ${T.border}20`,
                color: T.text,
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <span style={{ minWidth: 0 }}>
                <span
                  style={{
                    display: "block",
                    fontSize: fs(10),
                    fontWeight: 700,
                    fontFamily: T.mono,
                    color: T.text,
                  }}
                >
                  {watchlist.name}
                </span>
                <span
                  style={{
                    display: "block",
                    fontSize: fs(8),
                    color: T.textDim,
                    fontFamily: T.mono,
                    marginTop: 1,
                  }}
                >
                  {watchlist.items.length} symbols
                </span>
              </span>
              {watchlist.isDefault ? (
                <span
                  style={{
                    color: T.green,
                    fontSize: fs(8),
                    fontFamily: T.mono,
                    fontWeight: 700,
                  }}
                >
                  DEFAULT
                </span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0,1fr) 56px 50px 38px 24px 18px",
          gap: sp(4),
          padding: sp("4px 10px"),
          fontSize: fs(9),
          fontWeight: 600,
          color: T.textMuted,
          letterSpacing: "0.08em",
          borderBottom: `1px solid ${T.border}`,
        }}
      >
        <span>SYMBOL</span>
        <span />
        <span style={{ textAlign: "right" }}>LAST</span>
        <span style={{ textAlign: "right" }}>CHG%</span>
        <span />
        <span />
      </div>

      <div style={{ flex: 1, overflowY: "auto" }}>
        {filtered.map((w) => {
          const sel = selected === w.sym;
          const pos = isFiniteNumber(w.pct) ? w.pct >= 0 : null;
          const itemIndex = items.findIndex((item) => item.id === w.id);
          const canMoveUp = itemIndex > 0;
          const canMoveDown = itemIndex >= 0 && itemIndex < items.length - 1;
          const signalState = signalStatesBySymbol[w.sym] || null;
          const signalDirection = signalState?.currentSignalDirection;
          const hasFreshSignal =
            signalState?.fresh &&
            signalState?.status === "ok" &&
            (signalDirection === "buy" || signalDirection === "sell");
          const signalColor = signalDirection === "buy" ? T.green : T.red;
          return (
            <div
              key={w.id || w.sym}
              onClick={() => onSelect?.(w.sym)}
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0,1fr) 56px 50px 38px 24px 18px",
                gap: sp(4),
                padding: sp("7px 10px"),
                cursor: "pointer",
                alignItems: "center",
                background: sel ? T.bg3 : "transparent",
                borderLeft: sel
                  ? `2px solid ${T.accent}`
                  : "2px solid transparent",
                transition: "background 0.1s",
              }}
              onMouseEnter={(e) => {
                if (!sel) e.currentTarget.style.background = T.bg2;
              }}
              onMouseLeave={(e) => {
                if (!sel) e.currentTarget.style.background = "transparent";
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: sp(4),
                    minWidth: 0,
                  }}
                >
                  <span
                    style={{
                      fontSize: fs(12),
                      fontWeight: 700,
                      fontFamily: T.mono,
                      color: T.text,
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {w.sym}
                  </span>
                  {hasFreshSignal ? (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onSignalAction?.(w.sym, signalState);
                      }}
                      title={`${signalDirection.toUpperCase()} signal · ${signalState.timeframe} · ${signalState.barsSinceSignal ?? 0} bars ago`}
                      style={{
                        border: `1px solid ${signalColor}`,
                        background: `${signalColor}18`,
                        color: signalColor,
                        cursor: "pointer",
                        fontFamily: T.mono,
                        fontSize: fs(7),
                        fontWeight: 900,
                        letterSpacing: "0.08em",
                        lineHeight: 1,
                        padding: sp("2px 3px"),
                        borderRadius: 0,
                      }}
                    >
                      {signalDirection.toUpperCase()}
                    </button>
                  ) : null}
                </div>
                <div
                  style={{
                    fontSize: fs(9),
                    color: T.textDim,
                    fontFamily: T.sans,
                    marginTop: sp(1),
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {w.name}
                </div>
              </div>
              <div style={{ width: 56 }}>
                <MicroSparkline
                  data={w.sparkBars?.length ? w.sparkBars : w.spark}
                  positive={pos}
                  width={48}
                  height={16}
                />
              </div>
              <div
                style={{
                  textAlign: "right",
                  fontSize: fs(11),
                  fontFamily: T.mono,
                  fontWeight: 500,
                  color: T.text,
                }}
              >
                {formatQuotePrice(w.price)}
              </div>
              <div
                style={{
                  textAlign: "right",
                  fontSize: fs(10),
                  fontFamily: T.mono,
                  fontWeight: 700,
                  color: pos == null ? T.textDim : pos ? T.green : T.red,
                }}
                >
                  {formatSignedPercent(w.pct)}
                </div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 1,
                }}
              >
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    if (!w.id || !canMoveUp) {
                      return;
                    }
                    onMoveSymbol?.(w.id, "up");
                  }}
                  title={canMoveUp ? `Move ${w.sym} up` : `${w.sym} is already first`}
                  disabled={!w.id || !canMoveUp || busy}
                  style={{
                    width: dim(18),
                    height: dim(9),
                    border: "none",
                    borderRadius: 0,
                    background: "transparent",
                    color:
                      !w.id || !canMoveUp || busy ? T.textMuted : T.textDim,
                    cursor:
                      w.id && canMoveUp && !busy ? "pointer" : "default",
                    fontFamily: T.mono,
                    fontSize: fs(8),
                    lineHeight: 1,
                    padding: 0,
                  }}
                >
                  ▲
                </button>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    if (!w.id || !canMoveDown) {
                      return;
                    }
                    onMoveSymbol?.(w.id, "down");
                  }}
                  title={
                    canMoveDown
                      ? `Move ${w.sym} down`
                      : `${w.sym} is already last`
                  }
                  disabled={!w.id || !canMoveDown || busy}
                  style={{
                    width: dim(18),
                    height: dim(9),
                    border: "none",
                    borderRadius: 0,
                    background: "transparent",
                    color:
                      !w.id || !canMoveDown || busy ? T.textMuted : T.textDim,
                    cursor:
                      w.id && canMoveDown && !busy ? "pointer" : "default",
                    fontFamily: T.mono,
                    fontSize: fs(8),
                    lineHeight: 1,
                    padding: 0,
                  }}
                >
                  ▼
                </button>
              </div>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  if (!w.id) {
                    toast.push({
                      title: "Symbol missing watchlist item id",
                      kind: "warn",
                    });
                    return;
                  }
                  onRemoveSymbol?.(w.id, w.sym);
                }}
                title={`Remove ${w.sym}`}
                style={{
                  width: dim(18),
                  height: dim(18),
                  border: "none",
                  borderRadius: 0,
                  background: "transparent",
                  color: T.textMuted,
                  cursor: "pointer",
                  fontFamily: T.mono,
                  fontSize: fs(10),
                }}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>

      <div
        style={{
          padding: sp("6px 10px"),
          borderTop: `1px solid ${T.border}`,
          fontSize: fs(9),
          color: T.textMuted,
          fontFamily: T.mono,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: sp(8),
        }}
      >
        <span>{filtered.length} symbols</span>
        <button
          type="button"
          onClick={() => setAddMode((current) => !current)}
          style={{
            border: "none",
            background: "transparent",
            color: T.accent,
            cursor: "pointer",
            fontFamily: T.mono,
            fontSize: fs(9),
            fontWeight: 700,
          }}
        >
          {addMode ? "CLOSE" : "+ ADD"}
        </button>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════
// CONTEXT PANEL (Right Column) — adapts per screen
// ═══════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════
// SCREEN: MARKET
// ═══════════════════════════════════════════════════════════════════

const INDICES = [
  {
    sym: "SPY",
    name: "S&P 500",
    price: null,
    chg: null,
    pct: null,
    spark: [],
  },
  {
    sym: "QQQ",
    name: "Nasdaq 100",
    price: null,
    chg: null,
    pct: null,
    spark: [],
  },
  {
    sym: "IWM",
    name: "Russell 2k",
    price: null,
    chg: null,
    pct: null,
    spark: [],
  },
  {
    sym: "DIA",
    name: "Dow Jones",
    price: null,
    chg: null,
    pct: null,
    spark: [],
  },
];

const MACRO_TICKERS = [
  { sym: "VIXY", price: null, chg: null, pct: null, label: "Volatility" },
  { sym: "IEF", price: null, chg: null, pct: null, label: "Treasuries" },
  { sym: "UUP", price: null, chg: null, pct: null, label: "Dollar" },
  { sym: "GLD", price: null, chg: null, pct: null, label: "Gold" },
  { sym: "USO", price: null, chg: null, pct: null, label: "Crude" },
];

const RATES_PROXIES = [
  { term: "1-3M", sym: "BIL", price: null, chg: null, pct: null, d5: null },
  {
    term: "1-3Y",
    sym: "SHY",
    price: null,
    chg: null,
    pct: null,
    d5: null,
  },
  { term: "3-7Y", sym: "IEI", price: null, chg: null, pct: null, d5: null },
  { term: "7-10Y", sym: "IEF", price: null, chg: null, pct: null, d5: null },
  { term: "20Y+", sym: "TLT", price: null, chg: null, pct: null, d5: null },
];

const SECTORS = [
  { name: "Technology", sym: "XLK", chg: null, d5: null },
  { name: "Financials", sym: "XLF", chg: null, d5: null },
  { name: "Healthcare", sym: "XLV", chg: null, d5: null },
  { name: "Industrials", sym: "XLI", chg: null, d5: null },
  { name: "Energy", sym: "XLE", chg: null, d5: null },
  { name: "Cons Disc", sym: "XLY", chg: null, d5: null },
  { name: "Utilities", sym: "XLU", chg: null, d5: null },
  { name: "Comm Svcs", sym: "XLC", chg: null, d5: null },
  { name: "Materials", sym: "XLB", chg: null, d5: null },
  { name: "Staples", sym: "XLP", chg: null, d5: null },
  { name: "Real Estate", sym: "XLRE", chg: null, d5: null },
];

// Finviz-style treemap data: sector → stocks with market cap (billions) and performance
const TREEMAP_DATA = [
  {
    sector: "TECHNOLOGY",
    stocks: [
      { sym: "MSFT", cap: 3100, d1: null, d5: null },
      { sym: "AAPL", cap: 2900, d1: null, d5: null },
      { sym: "NVDA", cap: 2800, d1: null, d5: null },
      { sym: "AVGO", cap: 680, d1: null, d5: null },
      { sym: "ORCL", cap: 420, d1: null, d5: null },
      { sym: "CRM", cap: 310, d1: null, d5: null },
      { sym: "AMD", cap: 260, d1: null, d5: null },
      { sym: "QCOM", cap: 210, d1: null, d5: null },
      { sym: "INTC", cap: 120, d1: null, d5: null },
      { sym: "IBM", cap: 195, d1: null, d5: null },
    ],
  },
  {
    sector: "COMM SVCS",
    stocks: [
      { sym: "GOOGL", cap: 2100, d1: null, d5: null },
      { sym: "META", cap: 1500, d1: null, d5: null },
      { sym: "NFLX", cap: 380, d1: null, d5: null },
      { sym: "TMUS", cap: 280, d1: null, d5: null },
      { sym: "DIS", cap: 200, d1: null, d5: null },
      { sym: "VZ", cap: 175, d1: null, d5: null },
    ],
  },
  {
    sector: "CONS DISC",
    stocks: [
      { sym: "AMZN", cap: 2000, d1: null, d5: null },
      { sym: "TSLA", cap: 800, d1: null, d5: null },
      { sym: "HD", cap: 380, d1: null, d5: null },
      { sym: "MCD", cap: 210, d1: null, d5: null },
      { sym: "NKE", cap: 120, d1: null, d5: null },
      { sym: "SBUX", cap: 110, d1: null, d5: null },
    ],
  },
  {
    sector: "FINANCIAL",
    stocks: [
      { sym: "BRK.B", cap: 880, d1: null, d5: null },
      { sym: "JPM", cap: 620, d1: null, d5: null },
      { sym: "V", cap: 580, d1: null, d5: null },
      { sym: "MA", cap: 440, d1: null, d5: null },
      { sym: "BAC", cap: 310, d1: null, d5: null },
      { sym: "GS", cap: 160, d1: null, d5: null },
    ],
  },
  {
    sector: "HEALTHCARE",
    stocks: [
      { sym: "LLY", cap: 750, d1: null, d5: null },
      { sym: "UNH", cap: 520, d1: null, d5: null },
      { sym: "JNJ", cap: 380, d1: null, d5: null },
      { sym: "ABBV", cap: 340, d1: null, d5: null },
      { sym: "MRK", cap: 280, d1: null, d5: null },
      { sym: "ABT", cap: 200, d1: null, d5: null },
    ],
  },
  {
    sector: "INDUSTRIAL",
    stocks: [
      { sym: "GE", cap: 200, d1: null, d5: null },
      { sym: "CAT", cap: 180, d1: null, d5: null },
      { sym: "RTX", cap: 155, d1: null, d5: null },
      { sym: "UNP", cap: 145, d1: null, d5: null },
      { sym: "BA", cap: 130, d1: null, d5: null },
      { sym: "HON", cap: 140, d1: null, d5: null },
    ],
  },
  {
    sector: "ENERGY",
    stocks: [
      { sym: "XOM", cap: 480, d1: null, d5: null },
      { sym: "CVX", cap: 290, d1: null, d5: null },
      { sym: "COP", cap: 130, d1: null, d5: null },
      { sym: "SLB", cap: 65, d1: null, d5: null },
    ],
  },
  {
    sector: "STAPLES",
    stocks: [
      { sym: "WMT", cap: 580, d1: null, d5: null },
      { sym: "PG", cap: 380, d1: null, d5: null },
      { sym: "COST", cap: 340, d1: null, d5: null },
      { sym: "KO", cap: 260, d1: null, d5: null },
    ],
  },
];

const TREEMAP_SYMBOLS = [
  ...new Set(
    TREEMAP_DATA.flatMap((sector) => sector.stocks.map((stock) => stock.sym)),
  ),
];
const MARKET_SNAPSHOT_SYMBOLS = [
  ...new Set([
    ...INDICES.map((item) => item.sym),
    ...MACRO_TICKERS.map((item) => item.sym),
    ...RATES_PROXIES.map((item) => item.sym),
    ...SECTORS.map((item) => item.sym),
    ...TREEMAP_SYMBOLS,
  ]),
];
const MARKET_PERFORMANCE_SYMBOLS = [
  ...new Set([
    ...MACRO_TICKERS.map((item) => item.sym),
    ...RATES_PROXIES.map((item) => item.sym),
    ...SECTORS.map((item) => item.sym),
    ...TREEMAP_SYMBOLS,
  ]),
];

// TreemapHeatmap — SVG-rendered, D3-powered, Finviz-quality
// Drop-in replacement for the current broken treemap

// Color scale matching Finviz: deep green → neutral → deep red
// Green/red colors stay saturated in both themes (they're vivid against any bg)
// Neutral cell + text adapt via T proxy
const heatColor = (val) => {
  if (!isFiniteNumber(val)) return T.bg3;
  if (val >= 3) return "#1a7a3c";
  if (val >= 2) return "#228b45";
  if (val >= 1) return "#2f9c51";
  if (val >= 0.5) return "#4ea866";
  if (val >= 0.1) return "#6fb481";
  if (val > -0.1) return T.bg3; // theme-aware neutral cell
  if (val >= -0.5) return "#b36a6a";
  if (val >= -1) return "#b55050";
  if (val >= -2) return "#b03838";
  if (val >= -3) return "#982828";
  return "#7d1f1f";
};
// Neutral cells use theme-aware muted text; saturated cells always use white
const heatText = (val) =>
  !isFiniteNumber(val) || Math.abs(val) < 0.1 ? T.textDim : "#ffffff";

const TreemapHeatmap = ({ data, period, onSymClick }) => {
  const VW = 1000,
    VH = 480;

  // Build D3 hierarchy
  const root = useMemo(() => {
    const hierarchy = d3
      .hierarchy({
        name: "root",
        children: data.map((s) => ({
          name: s.sector,
          children: s.stocks.map((st) => ({
            name: st.sym,
            value: st.cap,
            chg: period === "1d" ? st.d1 : st.d5,
          })),
        })),
      })
      .sum((d) => d.value)
      .sort((a, b) => b.value - a.value);

    d3
      .treemap()
      .size([VW, VH])
      .paddingOuter(3)
      .paddingTop(20)
      .paddingInner(2)
      .round(true)
      .tile(d3.treemapSquarify.ratio(1.2))(hierarchy);

    return hierarchy;
  }, [data, period]);

  const sectors = root.children || [];

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${VW} ${VH}`}
      preserveAspectRatio="xMidYMid meet"
      style={{
        display: "block",
        borderRadius: 0,
        aspectRatio: `${VW} / ${VH}`,
      }}
    >
      {/* Background */}
      <rect width={VW} height={VH} fill={T.bg1} rx="0" />

      {sectors.map((sector, si) => {
        const sx = sector.x0,
          sy = sector.y0;
        const sw = sector.x1 - sector.x0,
          sh = sector.y1 - sector.y0;

        return (
          <g key={si}>
            {/* Sector background with thin border */}
            <rect
              x={sx}
              y={sy}
              width={sw}
              height={sh}
              fill="none"
              stroke={T.border}
              strokeWidth="1"
              rx="0"
            />

            {/* Sector label bar */}
            <rect x={sx} y={sy} width={sw} height={18} fill={T.bg2} rx="0" />
            <text
              x={sx + 6}
              y={sy + 12}
              style={{
                fontSize: fs(10),
                fontWeight: 700,
                fontFamily: T.sans,
                fill: T.textSec,
                letterSpacing: "0.06em",
              }}
            >
              {sector.data.name}
            </text>

            {/* Stock cells */}
            {(sector.children || []).map((leaf, li) => {
              const lx = leaf.x0,
                ly = leaf.y0;
              const lw = leaf.x1 - leaf.x0,
                lh = leaf.y1 - leaf.y0;
              const val = leaf.data.chg;
              const bg = heatColor(val);
              const tc = heatText(val);

              // Adaptive font sizes based on cell pixel dimensions
              const symSize =
                lw > 90 ? 14 : lw > 60 ? 12 : lw > 40 ? 10 : lw > 25 ? 8 : 0;
              const pctSize = lw > 60 ? 11 : lw > 40 ? 9 : lw > 25 ? 7 : 0;
              const showSym = symSize > 0 && lh > 18;
              const showPct = pctSize > 0 && lh > 28;
              const cx = lx + lw / 2;
              const cy = ly + lh / 2;

              return (
                <g
                  key={li}
                  style={{ cursor: "pointer" }}
                  onClick={() => onSymClick && onSymClick(leaf.data.name)}
                >
                  <rect
                    x={lx}
                    y={ly}
                    width={lw}
                    height={lh}
                    fill={bg}
                    rx="0"
                    onMouseEnter={(e) =>
                      e.target.setAttribute("opacity", "0.8")
                    }
                    onMouseLeave={(e) => e.target.setAttribute("opacity", "1")}
                  />
                  {showSym && (
                    <text
                      x={cx}
                      y={showPct ? cy - 2 : cy + 1}
                      textAnchor="middle"
                      dominantBaseline="central"
                      style={{
                        fontSize: symSize,
                        fontWeight: 800,
                        fontFamily: T.mono,
                        fill: tc,
                        pointerEvents: "none",
                      }}
                    >
                      {leaf.data.name}
                    </text>
                  )}
                  {showPct && (
                    <text
                      x={cx}
                      y={cy + symSize * 0.6 + 2}
                      textAnchor="middle"
                      dominantBaseline="central"
                      style={{
                        fontSize: pctSize,
                        fontWeight: 600,
                        fontFamily: T.mono,
                        fill: tc,
                        opacity: 0.85,
                        pointerEvents: "none",
                      }}
                    >
                      {isFiniteNumber(val)
                        ? `${val >= 0 ? "+" : ""}${val.toFixed(2)}%`
                        : MISSING_VALUE}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        );
      })}
    </svg>
  );
};

// Sector-level heatmap: just sector ETFs as proportional blocks
const SectorTreemap = ({ sectors, period }) => {
  const VW = 1000,
    VH = 60;

  const root = useMemo(() => {
    const weights = {
      XLK: 30,
      XLF: 13,
      XLV: 12,
      XLY: 10,
      XLC: 9,
      XLI: 9,
      XLP: 6,
      XLE: 4,
      XLRE: 3,
      XLU: 2,
      XLB: 2,
    };
    const hierarchy = d3
      .hierarchy({
        name: "root",
        children: sectors.map((s) => ({
          name: s.sym,
          fullName: s.name,
          value: weights[s.sym] || 3,
          chg: period === "1d" ? s.chg : s.d5,
        })),
      })
      .sum((d) => d.value)
      .sort((a, b) => b.value - a.value);

    d3.treemap().size([VW, VH]).padding(1).round(true).tile(d3.treemapSquarify)(
      hierarchy,
    );

    return hierarchy;
  }, [sectors, period]);

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${VW} ${VH}`}
      style={{ display: "block", borderRadius: 0 }}
    >
      <rect width={VW} height={VH} fill={T.bg1} rx="0" />
      {(root.children || []).map((leaf, i) => {
        const lx = leaf.x0,
          ly = leaf.y0;
        const lw = leaf.x1 - leaf.x0,
          lh = leaf.y1 - leaf.y0;
        const val = leaf.data.chg;
        const bg = heatColor(val);
        const cx = lx + lw / 2,
          cy = ly + lh / 2;
        return (
          <g key={i} style={{ cursor: "pointer" }}>
            <rect
              x={lx}
              y={ly}
              width={lw}
              height={lh}
              fill={bg}
              rx="0"
              onMouseEnter={(e) => e.target.setAttribute("opacity", "0.8")}
              onMouseLeave={(e) => e.target.setAttribute("opacity", "1")}
            />
            <text
              x={cx}
              y={cy - 4}
              textAnchor="middle"
              dominantBaseline="central"
              style={{
                fontSize: lw > 80 ? 10 : 8,
                fontWeight: 700,
                fontFamily: T.mono,
                fill: heatText(val),
                pointerEvents: "none",
              }}
            >
              {leaf.data.name}
            </text>
            <text
              x={cx}
              y={cy + 8}
              textAnchor="middle"
              dominantBaseline="central"
              style={{
                fontSize: lw > 80 ? 9 : 7,
                fontWeight: 600,
                fontFamily: T.mono,
                fill: heatText(val),
                opacity: 0.8,
                pointerEvents: "none",
              }}
            >
              {isFiniteNumber(val)
                ? `${val >= 0 ? "+" : ""}${val.toFixed(2)}%`
                : MISSING_VALUE}
            </text>
          </g>
        );
      })}
    </svg>
  );
};

const NEWS = [
  {
    text: "Fed's Waller signals support for gradual rate cuts despite sticky services inflation",
    time: "2h",
    tag: "FED",
    s: 0,
  },
  {
    text: "NVIDIA Blackwell Ultra shipments to begin Q2; partners confirm record orders",
    time: "4h",
    tag: "NVDA",
    s: 1,
  },
  {
    text: "Intel posts surprise loss, guides Q1 below estimates as AI competition intensifies",
    time: "5h",
    tag: "INTC",
    s: -1,
  },
  {
    text: "PayPal bets on agentic commerce, acquires Israel-based Cymbio",
    time: "5h",
    tag: "PYPL",
    s: 1,
  },
  {
    text: "US initial jobless claims fall to 215K vs 225K expected, labor market remains tight",
    time: "7h",
    tag: "MACRO",
    s: 1,
  },
  {
    text: "Treasury 10Y yield climbs to 4.29% as markets digest hawkish Fed commentary",
    time: "9h",
    tag: "BONDS",
    s: -1,
  },
];

const EVENTS = [
  { date: "Apr 18", label: "Good Friday — Closed", type: "holiday" },
  { date: "Apr 23", label: "S&P PMI Flash", type: "econ" },
  { date: "Apr 25", label: "MSFT, GOOGL Earnings", type: "earnings" },
  { date: "May 1", label: "AAPL, AMZN Earnings", type: "earnings" },
  { date: "May 2", label: "Nonfarm Payrolls", type: "econ" },
  { date: "May 6-7", label: "FOMC Meeting", type: "fomc" },
  { date: "May 13", label: "CPI Release", type: "cpi" },
];

const COND = [
  {
    key: "vol",
    label: "Volatility",
    score: 72,
    color: T.cyan,
    items: [
      ["VIX", "16.82", "↓"],
      ["VIX %ile", "22nd", "↓"],
      ["VVIX", "14.2", "↓"],
      ["IV Rank", "18%", "↓"],
    ],
  },
  {
    key: "trend",
    label: "Trend",
    score: 78,
    color: T.green,
    items: [
      ["vs 20 SMA", "Above", "↑"],
      ["vs 50 SMA", "Above", "↑"],
      ["Duration", "14d", "→"],
      ["HH/HL", "3/3", "↑"],
    ],
  },
  {
    key: "breadth",
    label: "Breadth",
    score: 62,
    color: T.amber,
    items: [
      [">20d", "62%", "↓"],
      [">50d", "58%", "↓"],
      ["A/D", "1.82", "↑"],
      ["NH/NL", "3.3:1", "→"],
    ],
  },
  {
    key: "mom",
    label: "Momentum",
    score: 69,
    color: T.purple,
    items: [
      ["Spread", "1.82%", "→"],
      ["Lead", "XLU XLI", "↑"],
      ["%HH", "41%", "↓"],
      ["Part.", "Narrow", "↓"],
    ],
  },
];

const Card = ({ children, style = {}, noPad }) => (
  <div
    style={{
      background: T.bg1,
      border: `1px solid ${T.border}`,
      borderRadius: 0,
      padding: noPad ? 0 : "8px 10px",
      overflow: "hidden",
      ...style,
    }}
  >
    {children}
  </div>
);

const CardTitle = ({ children, right }) => (
  <div
    style={{
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 4,
    }}
  >
    <span
      style={{
        fontSize: fs(10),
        fontWeight: 700,
        fontFamily: T.display,
        color: T.textSec,
        letterSpacing: "0.03em",
      }}
    >
      {children}
    </span>
    {right}
  </div>
);

// ─── ORDER FLOW DONUT ───
// Multi-segment donut showing buy/sell volume by trade size bracket.
// Segments arranged: top→clockwise: buyXL, buyL, buyM, buyS, sellS, sellM, sellL, sellXL
// Greens shade darker for larger buy sizes, reds shade darker for larger sells
const OrderFlowDonut = ({ flow, size = 110, thickness = 18 }) => {
  const totalBuy = flow.buyXL + flow.buyL + flow.buyM + flow.buyS;
  const totalSell = flow.sellXL + flow.sellL + flow.sellM + flow.sellS;
  const total = totalBuy + totalSell || 1;
  const net = totalBuy - totalSell;

  // 8 segments — buys (greens, light to dark) then sells (reds, dark to light)
  // ordered around the ring so XL sit at the "edges" and S sit closer to neutral
  const segs = [
    { value: flow.buyXL, color: "#047857" },
    { value: flow.buyL, color: "#10b981" },
    { value: flow.buyM, color: "#34d399" },
    { value: flow.buyS, color: "#6ee7b7" },
    { value: flow.sellS, color: "#fca5a5" },
    { value: flow.sellM, color: "#f87171" },
    { value: flow.sellL, color: "#ef4444" },
    { value: flow.sellXL, color: "#b91c1c" },
  ];

  const cx = size / 2,
    cy = size / 2;
  const r = size / 2 - 4;
  const innerR = r - thickness;

  let cumAngle = -Math.PI / 2;
  const paths = segs.map((seg, i) => {
    const angle = (seg.value / total) * 2 * Math.PI;
    if (angle <= 0) return null;
    const startAngle = cumAngle;
    const endAngle = cumAngle + angle;
    cumAngle = endAngle;

    const x1 = cx + r * Math.cos(startAngle);
    const y1 = cy + r * Math.sin(startAngle);
    const x2 = cx + r * Math.cos(endAngle);
    const y2 = cy + r * Math.sin(endAngle);
    const x3 = cx + innerR * Math.cos(endAngle);
    const y3 = cy + innerR * Math.sin(endAngle);
    const x4 = cx + innerR * Math.cos(startAngle);
    const y4 = cy + innerR * Math.sin(startAngle);
    const largeArc = angle > Math.PI ? 1 : 0;
    const d = `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} L ${x3} ${y3} A ${innerR} ${innerR} 0 ${largeArc} 0 ${x4} ${y4} Z`;
    return (
      <path key={i} d={d} fill={seg.color} stroke={T.bg2} strokeWidth={1} />
    );
  });

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {paths}
      <text
        x={cx}
        y={cy - 4}
        textAnchor="middle"
        fontSize={fs(7)}
        fill={T.textMuted}
        fontFamily={T.mono}
        letterSpacing="0.08em"
      >
        NET
      </text>
      <text
        x={cx}
        y={cy + fs(11)}
        textAnchor="middle"
        fontSize={fs(11)}
        fontWeight={700}
        fill={net >= 0 ? T.green : T.red}
        fontFamily={T.mono}
      >
        {net >= 0 ? "+" : ""}${Math.abs(net).toFixed(0)}M
      </text>
    </svg>
  );
};

// ─── SIZE BUCKET ROW ───
// Mirrored bar chart row — buy bar grows right-to-left, sell bar grows left-to-right
// Visual at-a-glance "is XL flow biased buy or sell?"
const SizeBucketRow = ({ label, buy, sell, maxValue }) => {
  const buyPct = (buy / maxValue) * 100;
  const sellPct = (sell / maxValue) * 100;
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "44px 1fr 22px 1fr 44px",
        gap: sp(4),
        alignItems: "center",
        padding: sp("2px 0"),
        fontFamily: T.mono,
        fontSize: fs(9),
      }}
    >
      <span style={{ color: T.green, fontWeight: 600, textAlign: "right" }}>
        {buy.toFixed(1)}
      </span>
      <div
        style={{ display: "flex", justifyContent: "flex-end", height: dim(8) }}
      >
        <div
          style={{
            width: `${buyPct}%`,
            height: "100%",
            background: T.green,
            opacity: 0.85,
            borderRadius: dim(1),
          }}
        />
      </div>
      <span style={{ textAlign: "center", color: T.textSec, fontWeight: 700 }}>
        {label}
      </span>
      <div
        style={{
          display: "flex",
          justifyContent: "flex-start",
          height: dim(8),
        }}
      >
        <div
          style={{
            width: `${sellPct}%`,
            height: "100%",
            background: T.red,
            opacity: 0.85,
            borderRadius: dim(1),
          }}
        />
      </div>
      <span style={{ color: T.red, fontWeight: 600 }}>{sell.toFixed(1)}</span>
    </div>
  );
};

// ─── ORDER FLOW DISTRIBUTION CARD ───
// Combined donut + size bucket bars. Reusable across Market and Trade tabs.
const OrderFlowDistribution = ({ flow, donutSize = 96 }) => {
  const totalBuy = flow.buyXL + flow.buyL + flow.buyM + flow.buyS;
  const totalSell = flow.sellXL + flow.sellL + flow.sellM + flow.sellS;
  const buyPct = ((totalBuy / (totalBuy + totalSell)) * 100).toFixed(1);
  const maxBucket = Math.max(
    flow.buyXL,
    flow.buyL,
    flow.buyM,
    flow.buyS,
    flow.sellXL,
    flow.sellL,
    flow.sellM,
    flow.sellS,
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: sp(4) }}>
      <div style={{ display: "flex", alignItems: "center", gap: sp(8) }}>
        <OrderFlowDonut flow={flow} size={donutSize} thickness={14} />
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            gap: sp(2),
          }}
        >
          <div
            style={{
              fontSize: fs(8),
              color: T.textMuted,
              letterSpacing: "0.08em",
            }}
          >
            BUY / SELL
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontFamily: T.mono,
              fontSize: fs(10),
            }}
          >
            <span style={{ color: T.green, fontWeight: 700 }}>
              ${totalBuy.toFixed(0)}M
            </span>
            <span style={{ color: T.red, fontWeight: 700 }}>
              ${totalSell.toFixed(0)}M
            </span>
          </div>
          <div
            style={{
              display: "flex",
              height: dim(4),
              borderRadius: dim(2),
              overflow: "hidden",
              background: T.bg3,
            }}
          >
            <div
              style={{
                width: `${buyPct}%`,
                background: T.green,
                opacity: 0.85,
              }}
            />
            <div
              style={{
                width: `${100 - buyPct}%`,
                background: T.red,
                opacity: 0.85,
              }}
            />
          </div>
          <div
            style={{ fontSize: fs(8), color: T.textMuted, fontFamily: T.mono }}
          >
            {buyPct}% buy pressure
          </div>
        </div>
      </div>
      <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: sp(4) }}>
        <SizeBucketRow
          label="XL"
          buy={flow.buyXL}
          sell={flow.sellXL}
          maxValue={maxBucket}
        />
        <SizeBucketRow
          label="L"
          buy={flow.buyL}
          sell={flow.sellL}
          maxValue={maxBucket}
        />
        <SizeBucketRow
          label="M"
          buy={flow.buyM}
          sell={flow.sellM}
          maxValue={maxBucket}
        />
        <SizeBucketRow
          label="S"
          buy={flow.buyS}
          sell={flow.sellS}
          maxValue={maxBucket}
        />
      </div>
    </div>
  );
};

const MULTI_CHART_LAYOUTS = {
  "1x1": { cols: 1, rows: 1, count: 1 },
  "2x2": { cols: 2, rows: 2, count: 4 },
  "2x3": { cols: 3, rows: 2, count: 6 },
  "3x3": { cols: 3, rows: 3, count: 9 },
};

const MULTI_CHART_LAYOUT_CARD_WIDTH = {
  "1x1": 720,
  "2x2": 420,
  "2x3": 360,
  "3x3": 340,
};

const MULTI_CHART_LAYOUT_CARD_HEIGHT = {
  "1x1": 450,
  "2x2": 275,
  "2x3": 252,
  "3x3": 248,
};

const MINI_CHART_TIMEFRAMES = ["1m", "5m", "15m", "1h", "1D"];
const MINI_CHART_BAR_LIMITS = {
  "1m": 390,
  "5m": 312,
  "15m": 260,
  "1h": 220,
  "1D": 252,
};
const MARKET_CHART_STUDIES = [
  { id: "ema-21", label: "E21" },
  { id: "ema-55", label: "E55" },
  { id: "vwap", label: "VWAP" },
  { id: "rsi-14", label: "RSI" },
  { id: "macd-12-26-9", label: "MACD" },
];
const MAX_MULTI_CHART_SLOTS = Math.max(
  ...Object.values(MULTI_CHART_LAYOUTS).map((layout) => layout.count),
);
const MARKET_GRID_INDICATOR_PRESET_VERSION = 2;
const TRADE_EQUITY_INDICATOR_PRESET_VERSION = 1;
const TRADE_OPTION_INDICATOR_PRESET_VERSION = 1;
const DEFAULT_MINI_CHART_STUDIES = [
  RAY_REPLICA_PINE_SCRIPT_KEY,
  "ema-21",
  "vwap",
];
const DEFAULT_TRADE_EQUITY_STUDIES = [
  RAY_REPLICA_PINE_SCRIPT_KEY,
  "ema-21",
  "ema-55",
];
const DEFAULT_TRADE_OPTION_STUDIES = [RAY_REPLICA_PINE_SCRIPT_KEY];

const normalizeTickerSymbol = (value) => value?.trim?.().toUpperCase?.() || "";

const normalizeIndicatorSelection = (value, fallback = []) => {
  const source = Array.isArray(value) ? value : fallback;
  const seen = new Set();
  return source.filter((indicatorId) => {
    if (typeof indicatorId !== "string" || !indicatorId.trim()) {
      return false;
    }
    if (seen.has(indicatorId)) {
      return false;
    }
    seen.add(indicatorId);
    return true;
  });
};

const mergeIndicatorSelections = (...selections) =>
  normalizeIndicatorSelection(selections.flat(), []);

const normalizeMiniChartStudies = (value, includeRayReplicaByDefault = false) => {
  const fallback = includeRayReplicaByDefault
    ? DEFAULT_MINI_CHART_STUDIES
    : DEFAULT_MINI_CHART_STUDIES.filter(
        (studyId) => studyId !== RAY_REPLICA_PINE_SCRIPT_KEY,
      );
  const normalized = normalizeIndicatorSelection(value, fallback);
  return includeRayReplicaByDefault
    ? mergeIndicatorSelections(DEFAULT_MINI_CHART_STUDIES, normalized)
    : normalized;
};

const resolvePersistedIndicatorPreset = ({
  indicators,
  defaults,
  persistedVersion,
  currentVersion,
}) => {
  const normalized = normalizeIndicatorSelection(indicators, defaults);
  return persistedVersion === currentVersion
    ? normalized
    : mergeIndicatorSelections(defaults, normalized);
};

const resolvePersistedRayReplicaSettings = (value) =>
  resolveRayReplicaRuntimeSettings(
    value && typeof value === "object" ? value : undefined,
  );

const buildRayReplicaIndicatorSettings = (settings) => ({
  [RAY_REPLICA_PINE_SCRIPT_KEY]: settings,
});

const isRayReplicaIndicatorSelected = (selectedIndicators = []) =>
  selectedIndicators.includes(RAY_REPLICA_PINE_SCRIPT_KEY);

const buildDefaultMiniChartSymbols = (
  activeSym,
  count = MAX_MULTI_CHART_SLOTS,
) => {
  const seed = normalizeTickerSymbol(activeSym) || WATCHLIST[0]?.sym || "SPY";
  const watchlistSymbols = WATCHLIST.map((item) =>
    normalizeTickerSymbol(item.sym),
  ).filter(Boolean);
  const ordered = [
    seed,
    ...watchlistSymbols.filter((symbol) => symbol !== seed),
  ];

  return Array.from(
    { length: count },
    (_, index) => ordered[index] || ordered[index % ordered.length] || seed,
  );
};

const hydrateMiniChartSlot = (
  slot,
  fallbackTicker,
  includeRayReplicaByDefault = false,
) => ({
  ticker:
    normalizeTickerSymbol(slot?.ticker) ||
    fallbackTicker ||
    WATCHLIST[0]?.sym ||
    "SPY",
  tf: MINI_CHART_TIMEFRAMES.includes(slot?.tf) ? slot.tf : "15m",
  studies: normalizeMiniChartStudies(
    slot?.studies,
    includeRayReplicaByDefault,
  ),
  rayReplicaSettings: resolvePersistedRayReplicaSettings(
    slot?.rayReplicaSettings,
  ),
});

const buildInitialMiniChartSlots = (activeSym) => {
  const persisted = Array.isArray(_initialState.marketGridSlots)
    ? _initialState.marketGridSlots
    : [];
  const defaults = buildDefaultMiniChartSymbols(
    activeSym,
    MAX_MULTI_CHART_SLOTS,
  );
  return defaults.map((fallbackTicker, index) =>
    hydrateMiniChartSlot(
      persisted[index],
      fallbackTicker,
      _initialState.marketGridIndicatorPresetVersion !==
        MARKET_GRID_INDICATOR_PRESET_VERSION,
    ),
  );
};

const normalizeTickerSearchQuery = (value) => value?.trim?.().toLowerCase?.() || "";

const buildTickerSearchRowKey = (result) =>
  [
    normalizeTickerSymbol(result?.ticker),
    result?.primaryExchange?.trim?.().toUpperCase?.() || "",
    result?.providerContractId || "",
    result?.provider || "",
    result?.market || "",
  ].join("|");

const scoreTickerSearchResult = (
  result,
  { query, currentTicker, recentTickerSet, defaultTickerSet },
) => {
  const normalizedTicker = normalizeTickerSymbol(result?.ticker);
  const normalizedName = result?.name?.trim?.().toLowerCase?.() || "";
  if (!query || !normalizedTicker) {
    return Number.NEGATIVE_INFINITY;
  }

  let score = 0;
  if (normalizedTicker === query.toUpperCase()) score += 1500;
  else if (normalizedTicker.startsWith(query.toUpperCase())) score += 1050;
  else if (normalizedTicker.includes(query.toUpperCase())) score += 780;

  if (normalizedName === query) score += 720;
  else if (normalizedName.startsWith(query)) score += 560;
  else if (
    normalizedName
      .split(/[\s./-]+/)
      .some((part) => part && part.startsWith(query))
  ) {
    score += 500;
  } else if (normalizedName.includes(query)) {
    score += 320;
  }

  if (normalizedTicker === normalizeTickerSymbol(currentTicker)) score += 40;
  if (recentTickerSet.has(normalizedTicker)) score += 140;
  if (defaultTickerSet.has(normalizedTicker)) score += 55;
  if (result?.provider === "ibkr") score += 35;
  if (result?.providerContractId) score += 20;
  if (result?.primaryExchange) score += 10;

  return score;
};

const useTickerSearchController = ({
  open,
  query,
  currentTicker,
  recentTickers = [],
  limit = 8,
}) => {
  const deferredQuery = useDeferredValue(query.trim());
  const normalizedQuery = normalizeTickerSearchQuery(deferredQuery);
  const searchEnabled = open && normalizedQuery.length >= 2;
  const quickPicks = useMemo(
    () =>
      Array.from(
        new Set([
          normalizeTickerSymbol(currentTicker),
          ...recentTickers.map((symbol) => normalizeTickerSymbol(symbol)),
          ...WATCHLIST.map((item) => normalizeTickerSymbol(item.sym)),
        ]),
      )
        .filter(Boolean)
        .slice(0, 10)
        .map((symbol) => ({
          ticker: symbol,
          name: DEFAULT_WATCHLIST_BY_SYMBOL[symbol]?.name || symbol,
          market: "stocks",
          type: "stock",
          primaryExchange: null,
          provider: null,
          providerContractId: null,
          _kind: "quick-pick",
        })),
    [currentTicker, recentTickers],
  );
  const searchQuery = useSearchUniverseTickers(
    searchEnabled
      ? {
          search: deferredQuery,
          market: "stocks",
          active: true,
          limit: Math.max(limit * 2, 16),
        }
      : undefined,
    {
      query: {
        enabled: searchEnabled,
        staleTime: 60_000,
        retry: false,
      },
    },
  );
  const rankedResults = useMemo(() => {
    if (!searchEnabled) {
      return [];
    }

    const recentTickerSet = new Set(
      recentTickers.map((symbol) => normalizeTickerSymbol(symbol)).filter(Boolean),
    );
    const defaultTickerSet = new Set(
      WATCHLIST.map((item) => normalizeTickerSymbol(item.sym)).filter(Boolean),
    );
    const deduped = new Map();
    for (const result of searchQuery.data?.results || []) {
      const key = buildTickerSearchRowKey(result);
      if (!deduped.has(key)) {
        deduped.set(key, result);
      }
    }

    return Array.from(deduped.values())
      .map((result) => ({
        ...result,
        _kind: "result",
        _score: scoreTickerSearchResult(result, {
          query: normalizedQuery,
          currentTicker,
          recentTickerSet,
          defaultTickerSet,
        }),
      }))
      .filter((result) => Number.isFinite(result._score))
      .sort((left, right) => {
        if (right._score !== left._score) {
          return right._score - left._score;
        }
        const tickerDiff = left.ticker.localeCompare(right.ticker);
        if (tickerDiff !== 0) return tickerDiff;
        return (left.primaryExchange || "").localeCompare(right.primaryExchange || "");
      })
      .slice(0, limit);
  }, [
    currentTicker,
    limit,
    normalizedQuery,
    recentTickers,
    searchEnabled,
    searchQuery.data?.results,
  ]);

  return {
    deferredQuery,
    normalizedQuery,
    searchEnabled,
    searchQuery,
    quickPicks,
    results: rankedResults,
    selectableResults: searchEnabled ? rankedResults : quickPicks,
  };
};

const MiniChartTickerSearch = ({
  open,
  ticker,
  recentTickers = [],
  onClose,
  onSelectTicker,
}) => {
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const {
    deferredQuery,
    searchEnabled,
    searchQuery,
    quickPicks,
    results,
    selectableResults,
  } = useTickerSearchController({
    open,
    query,
    currentTicker: ticker,
    recentTickers,
    limit: 8,
  });

  useEffect(() => {
    if (!open) {
      setQuery("");
      setActiveIndex(0);
      return undefined;
    }

    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });

    return () => cancelAnimationFrame(frame);
  }, [open, ticker]);

  useEffect(() => {
    setActiveIndex(0);
  }, [open, deferredQuery, selectableResults.length]);

  useEffect(() => {
    if (!open || typeof document === "undefined") {
      return undefined;
    }

    const handlePointerDown = (event) => {
      if (rootRef.current?.contains(event.target)) {
        return;
      }
      onClose?.();
    };

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        onClose?.();
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, open]);

  const handleSelect = useCallback(
    (result) => {
      if (!result) {
        return;
      }
      onSelectTicker?.(result);
    },
    [onSelectTicker],
  );

  const handleInputKeyDown = useCallback(
    (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((current) =>
          selectableResults.length
            ? Math.min(current + 1, selectableResults.length - 1)
            : 0,
        );
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((current) =>
          selectableResults.length ? Math.max(current - 1, 0) : 0,
        );
        return;
      }
      if (event.key === "Enter") {
        if (selectableResults[activeIndex]) {
          event.preventDefault();
          handleSelect(selectableResults[activeIndex]);
        }
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        onClose?.();
      }
    },
    [activeIndex, handleSelect, onClose, selectableResults],
  );

  if (!open) {
    return null;
  }

  return (
    <div
      ref={rootRef}
      onClick={(event) => event.stopPropagation()}
      style={{
        position: "absolute",
        top: dim(34),
        left: sp(6),
        right: sp(6),
        zIndex: 12,
      }}
    >
      <div
        style={{
          background: T.bg2,
          border: `1px solid ${T.border}`,
          borderRadius: 0,
          boxShadow: "0 18px 36px rgba(0,0,0,0.32)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: sp(6),
            padding: sp("8px 8px 6px"),
            borderBottom: `1px solid ${T.border}`,
          }}
        >
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder={`Search symbol or company for ${ticker}…`}
            style={{
              width: "100%",
              background: T.bg3,
              border: `1px solid ${T.border}`,
              borderRadius: 0,
              padding: sp("6px 8px"),
              color: T.text,
              fontSize: fs(10),
              fontFamily: T.sans,
              outline: "none",
            }}
          />
          <button
            onClick={onClose}
            title="Close search"
            style={{
              background: "transparent",
              border: "none",
              color: T.textMuted,
              cursor: "pointer",
              fontSize: fs(12),
              lineHeight: 1,
              padding: 0,
            }}
          >
            ×
          </button>
        </div>
        <div
          style={{ maxHeight: dim(180), overflowY: "auto", background: T.bg1 }}
        >
          {!searchEnabled && quickPicks.length ? (
            <div
              style={{
                padding: sp("6px 10px 4px"),
                fontSize: fs(8),
                color: T.textMuted,
                fontFamily: T.sans,
                fontWeight: 700,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
              }}
            >
              Recent and default symbols
            </div>
          ) : null}
          {!searchEnabled &&
            quickPicks.map((result, index) => {
              return (
                <button
                  key={buildTickerSearchRowKey(result)}
                  role="option"
                  aria-selected={index === activeIndex}
                  onClick={() => handleSelect(result)}
                  style={{
                    width: "100%",
                    display: "grid",
                    gridTemplateColumns: "64px 1fr auto",
                    gap: sp(8),
                    alignItems: "center",
                    padding: sp("8px 10px"),
                    background: index === activeIndex ? T.bg3 : "transparent",
                    border: "none",
                    borderBottom: `1px solid ${T.border}20`,
                    textAlign: "left",
                    cursor: "pointer",
                  }}
                  onMouseEnter={(event) => {
                    event.currentTarget.style.background = T.bg3;
                    setActiveIndex(index);
                  }}
                >
                  <span
                    style={{
                      fontSize: fs(10),
                      fontWeight: 700,
                      fontFamily: T.sans,
                      color: T.text,
                    }}
                  >
                    {result.ticker}
                  </span>
                  <span
                    style={{
                      minWidth: 0,
                      fontSize: fs(9),
                      color: T.textSec,
                      fontFamily: T.sans,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {result.name || "Watchlist symbol"}
                  </span>
                  <span
                    style={{
                      fontSize: fs(8),
                      color: T.textMuted,
                      fontFamily: T.sans,
                    }}
                  >
                    recent
                  </span>
                </button>
              );
            })}
          {searchEnabled && searchQuery.isPending && (
            <div
              style={{
                padding: sp("12px 10px"),
                fontSize: fs(9),
                color: T.textDim,
                fontFamily: T.sans,
              }}
            >
              Searching active ticker universe…
            </div>
          )}
          {searchEnabled && !searchQuery.isPending && !results.length && (
            <div
              style={{
                padding: sp("12px 10px"),
                fontSize: fs(9),
                color: T.textDim,
                fontFamily: T.sans,
              }}
            >
              No active stock tickers matched "{deferredQuery}".
            </div>
          )}
          {searchEnabled && results.length ? (
            <div
              style={{
                padding: sp("6px 10px 4px"),
                fontSize: fs(8),
                color: T.textMuted,
                fontFamily: T.sans,
                fontWeight: 700,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
              }}
            >
              Live matches
            </div>
          ) : null}
          {results.map((result, index) => (
            <button
              key={buildTickerSearchRowKey(result)}
              role="option"
              aria-selected={index === activeIndex}
              onClick={() => handleSelect(result)}
              style={{
                width: "100%",
                display: "grid",
                gridTemplateColumns: "64px 1fr auto",
                gap: sp(8),
                alignItems: "center",
                padding: sp("8px 10px"),
                background: index === activeIndex ? T.bg3 : "transparent",
                border: "none",
                borderBottom: `1px solid ${T.border}20`,
                textAlign: "left",
                cursor: "pointer",
              }}
              onMouseEnter={() => setActiveIndex(index)}
            >
              <span
                style={{
                  fontSize: fs(10),
                  fontWeight: 700,
                  fontFamily: T.sans,
                  color: T.text,
                }}
              >
                {result.ticker}
              </span>
              <span style={{ minWidth: 0 }}>
                <span
                  style={{
                    display: "block",
                    fontSize: fs(9),
                    color: T.textSec,
                    fontFamily: T.sans,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {result.name}
                </span>
                <span
                  style={{
                    display: "block",
                    fontSize: fs(8),
                    color: T.textDim,
                    fontFamily: T.sans,
                  }}
                  >
                    {[result.type, result.primaryExchange]
                      .filter(Boolean)
                      .join(" · ") || "stock"}
                  </span>
                </span>
                <span
                  style={{
                    fontSize: fs(8),
                    color: T.textMuted,
                    fontFamily: T.sans,
                    textTransform: "uppercase",
                  }}
                >
                  {result.provider || result.market?.toUpperCase?.() || "US"}
                </span>
              </button>
            ))}
        </div>
      </div>
    </div>
  );
};

// ─── MINI CHART CELL ───
// Single chart cell for the multi-chart grid. Compact: ticker header, candles, volume strip.
const MiniChartCell = ({
  slot,
  quote,
  onFocus,
  onEnterSoloMode,
  onChangeTicker,
  onChangeTimeframe,
  onChangeStudies,
  onChangeRayReplicaSettings,
  recentTickers = [],
  onRememberTicker,
  isActive,
  dense = false,
  stockAggregateStreamingEnabled = false,
}) => {
  const { studies: availableStudies, indicatorRegistry } =
    useIndicatorLibrary();
  const ticker = slot?.ticker || WATCHLIST[0]?.sym || "SPY";
  const tf = MINI_CHART_TIMEFRAMES.includes(slot?.tf) ? slot.tf : "15m";
  const selectedIndicators = normalizeMiniChartStudies(slot?.studies);
  const rayReplicaSettings = useMemo(
    () => resolvePersistedRayReplicaSettings(slot?.rayReplicaSettings),
    [slot?.rayReplicaSettings],
  );
  const indicatorSettings = useMemo(
    () => buildRayReplicaIndicatorSettings(rayReplicaSettings),
    [rayReplicaSettings],
  );
  const minuteAggregateStoreVersion = useStockMinuteAggregateStoreVersion();
  const [searchOpen, setSearchOpen] = useState(false);
  const [drawMode, setDrawMode] = useState(null);
  const { drawings, addDrawing, clearDrawings } = useDrawingHistory();
  const fallbackInfo =
    DEFAULT_WATCHLIST_BY_SYMBOL[ticker] ||
    WATCHLIST.find((item) => item.sym === ticker) ||
    WATCHLIST[0];
  const tfBars = MINI_CHART_BAR_LIMITS[tf] || MINI_CHART_BAR_LIMITS["15m"];
  const barsQuery = useQuery({
    queryKey: ["market-mini-bars", ticker, tf, tfBars],
    queryFn: () =>
      getBarsRequest({
        symbol: ticker,
        timeframe: tf === "1D" ? "1d" : tf,
        limit: tfBars,
        outsideRth: tf !== "1D",
        source: "trades",
      }),
    ...BARS_QUERY_DEFAULTS,
  });
  const streamedSourceBars = useBrokerStreamedBars({
    symbol: ticker,
    timeframe: tf === "1D" ? "1d" : tf,
    bars: barsQuery.data?.bars,
    enabled: Boolean(stockAggregateStreamingEnabled && ticker),
  });
  const latestAggregateSpotPrice = useMemo(() => {
    const aggregates = getStoredBrokerMinuteAggregates(ticker);
    const latest = aggregates[aggregates.length - 1];
    return Number.isFinite(latest?.close) ? latest.close : null;
  }, [ticker, minuteAggregateStoreVersion]);
  const liveBars = useMemo(
    () => buildMiniChartBarsFromApi(streamedSourceBars),
    [streamedSourceBars],
  );
  const bars = useMemo(() => liveBars, [liveBars]);
  const chartModel = useMemo(
    () =>
      buildResearchChartModel({
        bars,
        timeframe: tf === "1D" ? "1d" : tf,
        selectedIndicators,
        indicatorSettings,
        indicatorRegistry,
      }),
    [bars, indicatorRegistry, indicatorSettings, selectedIndicators, tf],
  );
  const barsStatus = liveBars.length
    ? "live"
    : barsQuery.isPending
      ? "loading"
      : "empty";
  const latestBar = bars[bars.length - 1];
  const displayPrice =
    latestAggregateSpotPrice ??
    (Number.isFinite(quote?.price) ? quote.price : null) ??
    null;
  const quotePrevClose = Number.isFinite(quote?.prevClose)
    ? quote.prevClose
    : null;
  const displayChange =
    Number.isFinite(displayPrice) && Number.isFinite(quotePrevClose)
      ? displayPrice - quotePrevClose
      : Number.isFinite(quote?.change)
        ? quote.change
        : null;
  const displayPct =
    Number.isFinite(displayPrice) &&
    Number.isFinite(quotePrevClose) &&
    quotePrevClose !== 0
      ? (displayChange / quotePrevClose) * 100
      : Number.isFinite(quote?.changePercent)
        ? quote.changePercent
        : null;
  const chartSourceLabel =
    describeBrokerChartSource(latestBar?.source) || barsStatus.toUpperCase();
  const handleFramePointerDownCapture = useCallback(
    (event) => {
      if (isActive || typeof onFocus !== "function") {
        return;
      }
      if (event.button != null && event.button !== 0) {
        return;
      }
      if (
        event.target instanceof HTMLElement &&
        event.target.closest("button,input,select,[role='menuitem']")
      ) {
        return;
      }
      onFocus(ticker);
    },
    [isActive, onFocus, ticker],
  );
  const handleDoubleClick = useCallback(
    (event) => {
      event.preventDefault();
      event.stopPropagation();
      onEnterSoloMode?.(ticker);
    },
    [onEnterSoloMode, ticker],
  );
  const rememberTicker = useCallback(
    (nextTicker) => {
      const normalized = normalizeTickerSymbol(nextTicker);
      if (!normalized) {
        return;
      }
      onRememberTicker?.(normalized);
    },
    [onRememberTicker],
  );

  return (
    <div
      onPointerDownCapture={handleFramePointerDownCapture}
      onClick={() => onFocus && onFocus(ticker)}
      onDoubleClick={handleDoubleClick}
      style={{
        position: "relative",
        height: "100%",
        cursor: "pointer",
        transition: "border-color 0.15s",
      }}
    >
      <ResearchChartFrame
        theme={T}
        themeKey={CURRENT_THEME}
        model={chartModel}
        compact={dense}
        drawings={drawings}
        drawMode={drawMode}
        onAddDrawing={addDrawing}
        showSurfaceToolbar={false}
        showLegend={false}
        hideTimeScale={false}
        referenceLines={
          typeof bars[0]?.o === "number"
            ? [
                {
                  price: bars[0].o,
                  color: T.textMuted,
                  lineWidth: 1,
                  axisLabelVisible: false,
                  title: "",
                },
              ]
            : []
        }
        style={{
          borderColor: isActive ? T.accent : T.border,
          boxShadow: isActive ? `0 0 0 1px ${T.accent}33` : "none",
        }}
        surfaceTopOverlay={(controls) => (
          <ResearchChartWidgetHeader
            theme={T}
            controls={controls}
            symbol={ticker}
            name={fallbackInfo?.name || ticker}
            price={displayPrice}
            priceLabel="Spot"
            changePercent={displayPct}
            statusLabel={describeBrokerChartStatus(barsStatus, tf)}
            timeframe={tf}
            timeframeOptions={MINI_CHART_TIMEFRAMES.map((timeframe) => ({
              value: timeframe,
              label: timeframe,
            }))}
            onChangeTimeframe={(timeframe) => onChangeTimeframe?.(timeframe)}
            onOpenSearch={() => setSearchOpen((current) => !current)}
            dense={dense}
            studies={availableStudies}
            selectedStudies={selectedIndicators}
            studySpecs={chartModel.studySpecs}
            showSnapshotButton={false}
            showUndoRedo={false}
            onFocusChart={() => onFocus?.(ticker)}
            focusChartActive={isActive}
            focusChartTitle={`Focus ${ticker} chart`}
            onEnterSoloMode={() => onEnterSoloMode?.(ticker)}
            soloChartTitle={`Show ${ticker} in solo layout`}
            rightSlot={
              <RayReplicaSettingsMenu
                theme={T}
                settings={rayReplicaSettings}
                onChange={(next) => onChangeRayReplicaSettings?.(next)}
                dense={dense}
                disabled={!isRayReplicaIndicatorSelected(selectedIndicators)}
              />
            }
            onToggleStudy={(studyId) => {
              const active = selectedIndicators.includes(studyId);
              const next = active
                ? selectedIndicators.filter((value) => value !== studyId)
                : [...selectedIndicators, studyId];
              onChangeStudies?.(next);
            }}
            meta={{
              open: latestBar?.o,
              high: latestBar?.h,
              low: latestBar?.l,
              close: latestBar?.c,
              volume: latestBar?.v,
              vwap: latestBar?.vwap,
              sessionVwap: latestBar?.sessionVwap,
              accumulatedVolume: latestBar?.accumulatedVolume,
              averageTradeSize: latestBar?.averageTradeSize,
              timestamp: latestBar?.ts,
              sourceLabel: chartSourceLabel,
            }}
          />
        )}
        surfaceTopOverlayHeight={dense ? 28 : 40}
        surfaceLeftOverlay={(controls) => (
          <ResearchChartWidgetSidebar
            theme={T}
            controls={controls}
            drawMode={drawMode}
            drawingCount={drawings.length}
            onToggleDrawMode={setDrawMode}
            onClearDrawings={() => {
              clearDrawings();
              setDrawMode(null);
            }}
            dense={dense}
          />
        )}
        surfaceLeftOverlayWidth={dense ? 28 : 40}
        surfaceBottomOverlay={(controls) => (
          <ResearchChartWidgetFooter
            theme={T}
            controls={controls}
            studies={availableStudies}
            selectedStudies={selectedIndicators}
            studySpecs={chartModel.studySpecs}
            onToggleStudy={(studyId) => {
              const active = selectedIndicators.includes(studyId);
              const next = active
                ? selectedIndicators.filter((value) => value !== studyId)
                : [...selectedIndicators, studyId];
              onChangeStudies?.(next);
            }}
            dense={dense}
            statusText={`${describeBrokerChartStatus(barsStatus, tf)}  ${chartSourceLabel}`}
          />
        )}
        surfaceBottomOverlayHeight={dense ? 14 : 22}
      />
      <MiniChartTickerSearch
        open={searchOpen}
        ticker={ticker}
        recentTickers={recentTickers}
        onClose={() => setSearchOpen(false)}
        onSelectTicker={(result) => {
          const nextTicker = normalizeTickerSymbol(result?.ticker);
          if (!nextTicker) {
            return;
          }
          ensureTradeTickerInfo(nextTicker, result?.name || nextTicker);
          rememberTicker(nextTicker);
          onChangeTicker?.(nextTicker);
          setSearchOpen(false);
        }}
      />
    </div>
  );
};

// ─── MULTI CHART GRID ───
// Configurable grid of mini chart cells. Layout selector + independent ticker ownership per slot.
const MultiChartGrid = ({
  activeSym,
  onSymClick,
  stockAggregateStreamingEnabled = false,
}) => {
  const queryClient = useQueryClient();
  const gridBodyRef = useRef(null);
  const defaultSymbolsRef = useRef(
    buildDefaultMiniChartSymbols(activeSym, MAX_MULTI_CHART_SLOTS),
  );
  const [layout, setLayout] = useState(_initialState.marketGridLayout || "2x3");
  const [soloSlotIndex, setSoloSlotIndex] = useState(
    Number.isFinite(_initialState.marketGridSoloSlotIndex)
      ? Math.max(0, _initialState.marketGridSoloSlotIndex)
      : 0,
  );
  const [syncTimeframes, setSyncTimeframes] = useState(
    Boolean(_initialState.marketGridSyncTimeframes),
  );
  const [slots, setSlots] = useState(() =>
    buildInitialMiniChartSlots(activeSym),
  );
  const [recentTickers, setRecentTickers] = useState(() =>
    Array.isArray(_initialState.marketGridRecentTickers)
      ? _initialState.marketGridRecentTickers
          .map((symbol) => normalizeTickerSymbol(symbol))
          .filter(Boolean)
          .slice(0, 10)
      : [],
  );
  const [gridBodyWidth, setGridBodyWidth] = useState(0);
  const cfg = MULTI_CHART_LAYOUTS[layout] || MULTI_CHART_LAYOUTS["2x3"];
  const defaults = defaultSymbolsRef.current;
  const visibleSlotEntries = useMemo(() => {
    if (!slots.length) {
      return [];
    }
    if (layout === "1x1") {
      const clampedIndex = Math.max(
        0,
        Math.min(slots.length - 1, soloSlotIndex || 0),
      );
      return slots[clampedIndex]
        ? [{ slot: slots[clampedIndex], index: clampedIndex }]
        : [];
    }

    return slots
      .slice(0, cfg.count)
      .map((slot, index) => ({ slot, index }));
  }, [cfg.count, layout, slots, soloSlotIndex]);
  const quoteSymbols = useMemo(
    () =>
      Array.from(
        new Set(
          visibleSlotEntries
            .map((entry) => entry.slot?.ticker)
            .filter(Boolean),
        ),
      ).join(","),
    [visibleSlotEntries],
  );
  const streamedSymbols = useMemo(
    () =>
      Array.from(
        new Set(
          visibleSlotEntries
            .map((entry) => normalizeTickerSymbol(entry.slot?.ticker))
            .filter(Boolean),
        ),
      ),
    [visibleSlotEntries],
  );
  const gridQuotesQuery = useGetQuoteSnapshots(
    quoteSymbols ? { symbols: quoteSymbols } : undefined,
    {
      query: {
        enabled: Boolean(quoteSymbols),
        staleTime: 60_000,
        retry: false,
      },
    },
  );
  useIbkrQuoteSnapshotStream({
    symbols: streamedSymbols,
    enabled: Boolean(stockAggregateStreamingEnabled && streamedSymbols.length > 0),
  });
  const quotesBySymbol = useMemo(
    () =>
      Object.fromEntries(
        (gridQuotesQuery.data?.quotes || []).map((quote) => [
          normalizeTickerSymbol(quote.symbol),
          quote,
        ]),
      ),
    [gridQuotesQuery.data],
  );

  useBrokerStockAggregateStream({
    symbols: streamedSymbols,
    enabled: Boolean(stockAggregateStreamingEnabled && streamedSymbols.length > 0),
    onAggregate: (aggregate) => {
      queryClient.invalidateQueries({
        queryKey: ["market-mini-bars", aggregate.symbol],
      });
    },
  });

  useEffect(() => {
    setSlots((current) => {
      let changed = current.length !== MAX_MULTI_CHART_SLOTS;
      const next = Array.from({ length: MAX_MULTI_CHART_SLOTS }, (_, index) => {
        const hydrated = hydrateMiniChartSlot(current[index], defaults[index]);
        const previous = current[index];
        if (
          !previous ||
          previous.ticker !== hydrated.ticker ||
          previous.tf !== hydrated.tf ||
          JSON.stringify(previous.studies || []) !==
            JSON.stringify(hydrated.studies || []) ||
          JSON.stringify(previous.rayReplicaSettings || {}) !==
            JSON.stringify(hydrated.rayReplicaSettings || {})
        ) {
          changed = true;
        }
        return hydrated;
      });
      return changed ? next : current;
    });
  }, [defaults]);

  useEffect(() => {
    persistState({
      marketGridLayout: layout,
      marketGridSoloSlotIndex: soloSlotIndex,
      marketGridSyncTimeframes: syncTimeframes,
      marketGridIndicatorPresetVersion: MARKET_GRID_INDICATOR_PRESET_VERSION,
      marketGridSlots: slots,
      marketGridRecentTickers: recentTickers,
    });
  }, [layout, recentTickers, soloSlotIndex, syncTimeframes, slots]);

  useEffect(() => {
    if (!gridBodyRef.current || typeof ResizeObserver === "undefined") {
      return undefined;
    }

    const element = gridBodyRef.current;
    let frame = 0;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      const nextWidth = Math.round(entry?.contentRect?.width || 0);
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        setGridBodyWidth((current) =>
          current === nextWidth ? current : nextWidth,
        );
      });
    });

    observer.observe(element);
    setGridBodyWidth(Math.round(element.clientWidth || 0));

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  const denseGrid = cfg.count > 4;
  const gridGap = sp(denseGrid ? 4 : 6);
  const cardMinWidth = dim(
    MULTI_CHART_LAYOUT_CARD_WIDTH[layout] ||
      MULTI_CHART_LAYOUT_CARD_WIDTH["2x3"],
  );
  const cellHeight = dim(
    MULTI_CHART_LAYOUT_CARD_HEIGHT[layout] ||
      MULTI_CHART_LAYOUT_CARD_HEIGHT["2x3"],
  );
  const fittedCols = Math.max(
    1,
    Math.min(
      cfg.cols,
      Math.floor(((gridBodyWidth || 0) + gridGap) / (cardMinWidth + gridGap)) ||
        1,
    ),
  );
  const updateSlot = (slotIndex, patch) => {
    if (patch?.ticker) {
      setRecentTickers((current) => {
        const nextTicker = normalizeTickerSymbol(patch.ticker);
        if (!nextTicker) {
          return current;
        }
        return [nextTicker, ...current.filter((value) => value !== nextTicker)].slice(
          0,
          10,
        );
      });
    }
    setSlots((current) =>
      current.map((slot, index) =>
        index === slotIndex
          ? hydrateMiniChartSlot({ ...slot, ...patch }, defaults[index])
          : slot,
      ),
    );
  };
  const updateSlotTimeframe = (slotIndex, tf) => {
    setSlots((current) =>
      current.map((slot, index) =>
        syncTimeframes || index === slotIndex
          ? hydrateMiniChartSlot({ ...slot, tf }, defaults[index])
          : slot,
      ),
    );
  };
  const focusedLabel =
    layout === "1x1"
      ? visibleSlotEntries[0]?.slot?.ticker || activeSym
      : `${cfg.count} visible`;

  return (
    <Card noPad style={{ flexShrink: 0, overflow: "visible" }}>
      <div
        style={{
          padding: sp(denseGrid ? "5px 8px" : "6px 10px"),
          borderBottom: `1px solid ${T.border}`,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: sp(8) }}>
          <span
            style={{
              fontSize: fs(10),
              fontWeight: 700,
              fontFamily: T.display,
              color: T.textSec,
              letterSpacing: "0.04em",
            }}
          >
            CHARTS
          </span>
          <span
            style={{ fontSize: fs(9), color: T.textMuted, fontFamily: T.mono }}
          >
            {syncTimeframes ? "sync tf" : "independent"} · broker-backed bars ·{" "}
            {focusedLabel}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: sp(6) }}>
          <button
            type="button"
            onClick={() => {
              setSyncTimeframes((current) => {
                const next = !current;
                if (next) {
                  const anchorTf = visibleSlotEntries[0]?.slot?.tf || "15m";
                  setSlots((slotList) =>
                    slotList.map((slot, index) =>
                      hydrateMiniChartSlot(
                        {
                          ...slot,
                          tf: anchorTf,
                        },
                        defaults[index],
                      ),
                    ),
                  );
                }
                return next;
              });
            }}
            style={{
              padding: sp("3px 8px"),
              fontSize: fs(9),
              fontFamily: T.mono,
              fontWeight: 700,
              background: syncTimeframes ? T.accent : T.bg3,
              color: syncTimeframes ? "#fff" : T.textDim,
              border: "none",
              borderRadius: 0,
              cursor: "pointer",
              letterSpacing: "0.04em",
            }}
          >
            SYNC TF
          </button>
          <div
            style={{
              display: "flex",
              gap: 2,
              padding: sp(denseGrid ? 1 : 2),
              background: T.bg3,
              borderRadius: 0,
            }}
          >
            {Object.keys(MULTI_CHART_LAYOUTS).map((key) => (
              <button
                key={key}
                onClick={() => setLayout(key)}
                title={`${MULTI_CHART_LAYOUTS[key].count} charts`}
                style={{
                  padding: sp("3px 8px"),
                  fontSize: fs(9),
                  fontFamily: T.mono,
                  fontWeight: 700,
                  background: layout === key ? T.accent : "transparent",
                  color: layout === key ? "#fff" : T.textDim,
                  border: "none",
                  borderRadius: 0,
                  cursor: "pointer",
                  letterSpacing: "0.04em",
                }}
              >
                {key}
              </button>
            ))}
          </div>
        </div>
      </div>
      {/* Grid */}
      <div
        ref={gridBodyRef}
        style={{ padding: sp(denseGrid ? 4 : 6), overflow: "visible" }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${fittedCols}, minmax(0, 1fr))`,
            gridAutoRows: `${cellHeight}px`,
            gap: gridGap,
            width: "100%",
          }}
        >
          {visibleSlotEntries.map(({ slot, index }) => (
            <MiniChartCell
              key={`market-chart-slot-${index}`}
              slot={slot}
              quote={quotesBySymbol[slot.ticker]}
              isActive={slot.ticker === activeSym}
              dense={denseGrid}
              stockAggregateStreamingEnabled={stockAggregateStreamingEnabled}
              onFocus={onSymClick}
              onEnterSoloMode={() => {
                setSoloSlotIndex(index);
                setLayout("1x1");
                onSymClick?.(slot.ticker);
              }}
              onChangeTicker={(ticker) => updateSlot(index, { ticker })}
              onChangeTimeframe={(tf) => updateSlotTimeframe(index, tf)}
              onChangeStudies={(studies) => updateSlot(index, { studies })}
              onChangeRayReplicaSettings={(rayReplicaSettings) =>
                updateSlot(index, { rayReplicaSettings })
              }
              recentTickers={recentTickers}
              onRememberTicker={(ticker) =>
                setRecentTickers((current) =>
                  [ticker, ...current.filter((value) => value !== ticker)].slice(
                    0,
                    10,
                  ),
                )
              }
            />
          ))}
        </div>
      </div>
    </Card>
  );
};

const UNUSUAL_THRESHOLD_OPTIONS = [
  { value: 1, label: "1× OI" },
  { value: 2, label: "2× OI" },
  { value: 3, label: "3× OI" },
  { value: 5, label: "5× OI" },
  { value: 10, label: "10× OI" },
];

const MarketActivityPanel = ({
  notifications = [],
  highlightedUnusualFlow = [],
  signalEvents = [],
  signalStates = [],
  signalMonitorProfile = null,
  signalMonitorPending = false,
  newsItems = [],
  calendarItems = [],
  onSymClick,
  onSignalAction,
  onScanNow,
  onToggleMonitor,
  onChangeMonitorTimeframe,
  unusualThreshold = 1,
  onChangeUnusualThreshold,
}) => {
  const [activityFilter, setActivityFilter] = useState("all");
  const feedItemsRaw = useMemo(
    () =>
      [
        ...notifications.map((item) => ({
          id: item.id,
          title: item.label,
          detail: item.detail,
          meta: item.tone === "profit" ? "Portfolio alert" : "Risk alert",
          color: item.tone === "profit" ? T.green : T.red,
          symbol: item.symbol,
          kind: "alert",
          priority: 0,
        })),
        ...signalEvents.slice(0, 10).map((event) => {
          const direction = String(event.direction || "").toUpperCase();
          const isBuy = event.direction === "buy";
          return {
            id: `signal_${event.id}`,
            title: `${direction} signal · ${event.symbol}`,
            detail: `${event.timeframe} RayReplica · ${formatQuotePrice(event.signalPrice ?? event.close)}`,
            meta: formatRelativeTimeShort(event.signalAt),
            color: isBuy ? T.green : T.red,
            symbol: event.symbol,
            kind: "signal",
            priority: 0.25,
            signalEvent: event,
          };
        }),
        ...highlightedUnusualFlow.slice(0, 12).map((event) => {
          const ratioLabel =
            event.isUnusual && event.unusualScore > 0
              ? ` · ${event.unusualScore.toFixed(event.unusualScore >= 10 ? 0 : 1)}× OI`
              : "";
          return {
            id: `flow_${event.ticker}_${event.contract}_${event.occurredAt}`,
            title: `${event.isUnusual ? "UOA · " : ""}${event.ticker} ${event.contract}`,
            detail: `${event.side} ${event.type} · ${fmtM(event.premium)}${ratioLabel}`,
            meta: formatRelativeTimeShort(event.occurredAt),
            color: event.isUnusual
              ? T.amber
              : event.cp === "C"
                ? T.green
                : T.red,
            symbol: event.ticker,
            kind: "flow",
            // Bubble unusual events above generic flow but still under
            // explicit portfolio risk/profit alerts.
            priority: event.isUnusual ? 0.5 : 1,
          };
        }),
        ...newsItems.slice(0, 6).map((item) => ({
          id: `news_${item.id}`,
          title: item.text,
          detail: item.publisher || item.tag,
          meta: item.time,
          color: T.accent,
          symbol: item.tag,
          articleUrl: item.articleUrl,
          kind: "news",
          priority: 2,
        })),
        ...calendarItems.slice(0, 6).map((item) => ({
          id: `calendar_${item.id}`,
          title: item.label,
          detail: item.date,
          meta: "Calendar",
          color: item.type === "earnings" ? T.green : T.amber,
          symbol: item.label.split(" ")[0] || null,
          kind: "calendar",
          priority: 3,
        })),
      ]
        .sort((left, right) => left.priority - right.priority)
        .slice(0, 30),
    [
      calendarItems,
      highlightedUnusualFlow,
      newsItems,
      notifications,
      signalEvents,
    ],
  );
  const filterOptions = useMemo(
    () => [
      { id: "all", label: "All", count: feedItemsRaw.length },
      {
        id: "signal",
        label: "Signals",
        count: feedItemsRaw.filter((item) => item.kind === "signal").length,
      },
      {
        id: "flow",
        label: "UOA",
        count: feedItemsRaw.filter((item) => item.kind === "flow").length,
      },
      {
        id: "alert",
        label: "Alerts",
        count: feedItemsRaw.filter((item) => item.kind === "alert").length,
      },
      {
        id: "news",
        label: "News",
        count: feedItemsRaw.filter((item) => item.kind === "news").length,
      },
      {
        id: "calendar",
        label: "Calendar",
        count: feedItemsRaw.filter((item) => item.kind === "calendar").length,
      },
    ],
    [feedItemsRaw],
  );
  const feedItems = useMemo(
    () =>
      feedItemsRaw
        .filter((item) => activityFilter === "all" || item.kind === activityFilter)
        .slice(0, 12),
    [activityFilter, feedItemsRaw],
  );
  const freshSignalCount = signalStates.filter(
    (state) =>
      state?.fresh &&
      state?.status === "ok" &&
      (state?.currentSignalDirection === "buy" ||
        state?.currentSignalDirection === "sell"),
  ).length;
  const monitorMeta = signalMonitorPending
    ? "SCANNING"
    : signalMonitorProfile?.enabled
      ? `${freshSignalCount} FRESH`
      : "PAUSED";

  useEffect(() => {
    if (
      activityFilter === "all" ||
      filterOptions.some(
        (option) => option.id === activityFilter && option.count > 0,
      )
    ) {
      return;
    }
    setActivityFilter("all");
  }, [activityFilter, filterOptions]);

  return (
    <Card
      style={{
        padding: "8px 10px",
        minHeight: dim(340),
        height: "100%",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <CardTitle
        right={
          <span
            style={{
              fontSize: fs(8),
              color: signalMonitorPending ? T.amber : T.textDim,
              fontFamily: T.sans,
              fontWeight: 700,
              letterSpacing: "0.08em",
            }}
          >
            {monitorMeta}
          </span>
        }
      >
        Activity & Notifications
      </CardTitle>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr auto auto",
          gap: sp(4),
          marginBottom: sp(6),
          alignItems: "center",
        }}
      >
        <button
          type="button"
          onClick={onToggleMonitor}
          style={{
            border: `1px solid ${signalMonitorProfile?.enabled ? T.green : T.border}`,
            background: signalMonitorProfile?.enabled ? `${T.green}14` : T.bg2,
            color: signalMonitorProfile?.enabled ? T.green : T.textDim,
            cursor: "pointer",
            fontFamily: T.mono,
            fontSize: fs(8),
            fontWeight: 900,
            letterSpacing: "0.08em",
            padding: sp("5px 6px"),
            borderRadius: 0,
            textAlign: "left",
          }}
        >
          {signalMonitorProfile?.enabled ? "MONITOR ON" : "MONITOR OFF"}
        </button>
        <select
          value={signalMonitorProfile?.timeframe || "15m"}
          onChange={(event) => onChangeMonitorTimeframe?.(event.target.value)}
          style={{
            background: T.bg2,
            border: `1px solid ${T.border}`,
            color: T.textSec,
            fontFamily: T.mono,
            fontSize: fs(8),
            fontWeight: 800,
            padding: sp("5px 4px"),
            borderRadius: 0,
            outline: "none",
          }}
        >
          {["1m", "5m", "15m", "1h", "1d"].map((timeframe) => (
            <option key={timeframe} value={timeframe}>
              {timeframe.toUpperCase()}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={onScanNow}
          disabled={signalMonitorPending}
          style={{
            border: `1px solid ${signalMonitorPending ? T.amber : T.accent}`,
            background: signalMonitorPending ? `${T.amber}14` : T.accentDim,
            color: signalMonitorPending ? T.amber : T.accent,
            cursor: signalMonitorPending ? "wait" : "pointer",
            fontFamily: T.mono,
            fontSize: fs(8),
            fontWeight: 900,
            letterSpacing: "0.08em",
            padding: sp("5px 7px"),
            borderRadius: 0,
          }}
        >
          {signalMonitorPending ? "SCAN..." : "SCAN"}
        </button>
      </div>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: sp(4),
          marginBottom: sp(6),
        }}
      >
        {filterOptions.map((option) => {
          const active = activityFilter === option.id;
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => setActivityFilter(option.id)}
              style={{
                border: `1px solid ${active ? T.accent : T.border}`,
                background: active ? T.accentDim : T.bg2,
                color: active ? T.text : T.textDim,
                cursor: "pointer",
                fontFamily: T.mono,
                fontSize: fs(8),
                fontWeight: 800,
                letterSpacing: "0.06em",
                padding: sp("4px 6px"),
                borderRadius: 0,
              }}
            >
              {option.label} {option.count}
            </button>
          );
        })}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: sp(6),
          marginBottom: sp(6),
        }}
      >
        <span
          style={{
            fontSize: fs(8),
            color: T.textDim,
            fontFamily: T.mono,
            fontWeight: 700,
            letterSpacing: "0.08em",
          }}
          title="Volume / open interest ratio at which a print is flagged as unusual."
        >
          UOA THRESHOLD
        </span>
        <select
          value={String(unusualThreshold)}
          onChange={(event) =>
            onChangeUnusualThreshold?.(Number(event.target.value))
          }
          aria-label="Unusual options activity threshold"
          title="Volume / open interest ratio at which a print is flagged as unusual."
          style={{
            background: T.bg2,
            border: `1px solid ${T.border}`,
            color: T.textSec,
            fontFamily: T.mono,
            fontSize: fs(8),
            fontWeight: 800,
            padding: sp("4px 6px"),
            borderRadius: 0,
            outline: "none",
          }}
        >
          {UNUSUAL_THRESHOLD_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {feedItems.length ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: sp(4),
            overflowY: "auto",
            minHeight: 0,
          }}
        >
          {feedItems.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                if (item.articleUrl && typeof window !== "undefined") {
                  window.open(item.articleUrl, "_blank", "noopener,noreferrer");
                  return;
                }
                if (item.kind === "signal" && item.symbol) {
                  onSignalAction?.(item.symbol, item.signalEvent);
                  return;
                }
                if (item.symbol && item.kind !== "news") {
                  onSymClick?.(item.symbol);
                }
              }}
              title={item.title}
              style={{
                width: "100%",
                display: "grid",
                gridTemplateColumns: "8px 1fr auto",
                gap: sp(8),
                alignItems: "start",
                padding: sp("8px 0"),
                border: "none",
                borderBottom: `1px solid ${T.border}10`,
                background: "transparent",
                textAlign: "left",
                cursor:
                  item.articleUrl || (item.symbol && item.kind !== "news")
                    ? "pointer"
                    : "default",
              }}
              onMouseEnter={(event) => {
                event.currentTarget.style.background = T.bg3;
              }}
              onMouseLeave={(event) => {
                event.currentTarget.style.background = "transparent";
              }}
            >
              <span
                style={{
                  width: dim(8),
                  height: dim(8),
                  background: item.color,
                  marginTop: sp(4),
                  display: "inline-block",
                }}
              />
              <span style={{ minWidth: 0 }}>
                <span
                  style={{
                    display: "block",
                    fontSize: fs(10),
                    fontWeight: 700,
                    color: T.text,
                    fontFamily: T.sans,
                    lineHeight: 1.35,
                  }}
                >
                  {item.title}
                </span>
                <span
                  style={{
                    display: "block",
                    fontSize: fs(9),
                    color: T.textSec,
                    fontFamily: T.sans,
                    lineHeight: 1.35,
                    marginTop: 1,
                  }}
                >
                  {item.detail}
                </span>
              </span>
              <span
                style={{
                  fontSize: fs(8),
                  color: T.textMuted,
                  fontFamily: T.sans,
                  whiteSpace: "nowrap",
                  textAlign: "right",
                }}
              >
                {item.meta}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <DataUnavailableState
          title="No matching market activity"
          detail="Use the filters above to switch between RayReplica signals, unusual options activity, alerts, news, and calendar events."
        />
      )}
    </Card>
  );
};

const MarketScreen = ({
  sym,
  onSymClick,
  symbols = [],
  researchConfigured = false,
  stockAggregateStreamingEnabled = false,
  marketNotifications = [],
  signalEvents = [],
  signalStates = [],
  signalMonitorProfile = null,
  signalMonitorPending = false,
  onSignalAction,
  onScanNow,
  onToggleMonitor,
  onChangeMonitorTimeframe,
}) => {
  const [sectorTf, setSectorTf] = useState(_initialState.marketSectorTf || "1d");
  const [activityPanelWidth, setActivityPanelWidth] = useState(() =>
    Number.isFinite(_initialState.marketActivityPanelWidth)
      ? clampNumber(_initialState.marketActivityPanelWidth, 320, 720)
      : 420,
  );
  const [unusualThreshold, setUnusualThreshold] = useState(() => {
    const stored = _initialState.marketUnusualThreshold;
    return Number.isFinite(stored) && stored > 0
      ? clampNumber(stored, 0.1, 100)
      : 1;
  });
  useEffect(() => {
    persistState({ marketSectorTf: sectorTf });
  }, [sectorTf]);
  useEffect(() => {
    persistState({ marketActivityPanelWidth: activityPanelWidth });
  }, [activityPanelWidth]);
  useEffect(() => {
    persistState({ marketUnusualThreshold: unusualThreshold });
  }, [unusualThreshold]);
  const handleChangeUnusualThreshold = useCallback((next) => {
    if (!Number.isFinite(next) || next <= 0) return;
    setUnusualThreshold(clampNumber(next, 0.1, 100));
  }, []);
  const handleStartActivityPanelResize = useCallback(
    (event) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = activityPanelWidth;
      const handlePointerMove = (moveEvent) => {
        const delta = moveEvent.clientX - startX;
        setActivityPanelWidth(clampNumber(startWidth - delta, 320, 720));
      };
      const handlePointerUp = () => {
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
      };

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
    },
    [activityPanelWidth],
  );
  const { putCall, sectorFlow, flowStatus, flowEvents, flowTide } =
    useLiveMarketFlow(symbols, { unusualThreshold });
  const calendarWindow = useMemo(() => {
    const from = new Date();
    const to = new Date(from);
    to.setUTCDate(to.getUTCDate() + 14);

    return {
      from: formatIsoDate(from),
      to: formatIsoDate(to),
    };
  }, []);
  const newsQuery = useGetNews(
    { limit: 6 },
    {
      query: {
        staleTime: 60_000,
        refetchInterval: 60_000,
        retry: false,
      },
    },
  );
  const earningsQuery = useGetResearchEarningsCalendar(calendarWindow, {
    query: {
      enabled: Boolean(
        researchConfigured && calendarWindow.from && calendarWindow.to,
      ),
      staleTime: 300_000,
      refetchInterval: 300_000,
      retry: false,
    },
  });
  const breadth = buildTrackedBreadthSummary();
  const ratesSummary = buildRatesProxySummary();
  const volatilityProxy =
    MACRO_TICKERS.find((item) => item.sym === "VIXY") || MACRO_TICKERS[0];
  const putCallBullish = isFiniteNumber(putCall.total) ? putCall.total <= 1 : null;
  const putCallMarkerPct = isFiniteNumber(putCall.total)
    ? Math.max(8, Math.min(92, (putCall.total / 2) * 100))
    : 50;
  const upPct = isFiniteNumber(breadth.advancePct) ? breadth.advancePct : 0;
  const downPct = breadth.total ? 100 - upPct : 0;
  const analysisLeader = breadth.leader;
  const analysisLaggard = breadth.laggard;
  const selectedFlowEvents = useMemo(
    () =>
      flowEvents.filter(
        (event) => normalizeTickerSymbol(event.ticker) === normalizeTickerSymbol(sym),
      ),
    [flowEvents, sym],
  );
  const selectedFlowTide = useMemo(
    () =>
      selectedFlowEvents.length
        ? buildFlowTideFromEvents(selectedFlowEvents)
        : flowTide,
    [flowTide, selectedFlowEvents],
  );
  const selectedCallPremium = selectedFlowEvents.reduce(
    (sum, event) => sum + (event.cp === "C" ? event.premium : 0),
    0,
  );
  const selectedPutPremium = selectedFlowEvents.reduce(
    (sum, event) => sum + (event.cp === "P" ? event.premium : 0),
    0,
  );
  const highlightedUnusualFlow = useMemo(
    () => flowEvents.slice(0, 12),
    [flowEvents],
  );
  const newsItems = useMemo(() => {
    const articles = newsQuery.data?.articles || [];
    return articles.map((article) => ({
      id: article.id,
      text: article.title,
      time: formatRelativeTimeShort(article.publishedAt),
      tag:
        article.tickers?.[0] ||
        article.publisher?.name?.slice(0, 8)?.toUpperCase() ||
        "NEWS",
      s: mapNewsSentimentToScore(article.sentiment),
      articleUrl: article.articleUrl,
      publisher: article.publisher?.name || null,
    }));
  }, [newsQuery.data]);
  const calendarItems = useMemo(() => {
    const entries = earningsQuery.data?.entries || [];

    if (!researchConfigured || !entries.length) {
      return [];
    }

    const deduped = [];
    const seen = new Set();

    entries
      .filter((entry) => entry?.symbol && entry?.date)
      .sort((left, right) => {
        const leftValue = left.date
          ? Date.parse(left.date)
          : Number.POSITIVE_INFINITY;
        const rightValue = right.date
          ? Date.parse(right.date)
          : Number.POSITIVE_INFINITY;
        return leftValue - rightValue;
      })
      .forEach((entry) => {
        const key = `${entry.symbol}_${entry.date}_${entry.time || ""}`;
        if (seen.has(key)) return;
        seen.add(key);
        deduped.push({
          id: key,
          label: `${entry.symbol} earnings`,
          date: formatCalendarMeta(entry.date, entry.time),
          type: "earnings",
        });
      });

    return deduped.slice(0, 7);
  }, [earningsQuery.data, researchConfigured]);
  const newsStatusLabel = newsQuery.data?.articles?.length
    ? "live · news"
    : newsQuery.isError
      ? "offline"
      : newsQuery.isPending
        ? "loading"
        : "empty";
  const calendarStatusLabel = researchConfigured
    ? earningsQuery.data?.entries?.length
      ? "earnings · live"
      : earningsQuery.isError
        ? "offline"
        : earningsQuery.isPending
          ? "loading"
          : "empty"
    : "research off";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: sp(8),
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        {/* ── ROW 1: Chart workspace + activity feed ── */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `minmax(0, 1fr) 6px ${activityPanelWidth}px`,
            gap: 6,
            alignItems: "start",
          }}
        >
          <MultiChartGrid
            activeSym={sym}
            onSymClick={onSymClick}
            stockAggregateStreamingEnabled={stockAggregateStreamingEnabled}
          />
          <div
            role="separator"
            aria-label="Resize activity and notifications panel"
            onPointerDown={handleStartActivityPanelResize}
            title="Drag to resize activity panel"
            style={{
              alignSelf: "stretch",
              minHeight: dim(340),
              cursor: "col-resize",
              background: `linear-gradient(180deg, transparent, ${T.borderLight}, transparent)`,
              borderLeft: `1px solid ${T.border}55`,
              borderRight: `1px solid ${T.border}55`,
            }}
          />
          <MarketActivityPanel
            notifications={marketNotifications}
            highlightedUnusualFlow={highlightedUnusualFlow}
            signalEvents={signalEvents}
            signalStates={signalStates}
            signalMonitorProfile={signalMonitorProfile}
            signalMonitorPending={signalMonitorPending}
            newsItems={newsItems}
            calendarItems={calendarItems}
            onSymClick={onSymClick}
            onSignalAction={onSignalAction}
            onScanNow={onScanNow}
            onToggleMonitor={onToggleMonitor}
            onChangeMonitorTimeframe={onChangeMonitorTimeframe}
            unusualThreshold={unusualThreshold}
            onChangeUnusualThreshold={handleChangeUnusualThreshold}
          />
        </div>

        {/* ── ROW 2: Selected ticker premium tide ── */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr",
            gap: 6,
          }}
        >
          <Card style={{ padding: "8px 10px" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 6,
                gap: sp(8),
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: fs(10),
                    fontWeight: 700,
                    fontFamily: T.display,
                    color: T.textSec,
                  }}
                >
                  Premium Tide · {sym}
                </div>
                <div
                  style={{
                    fontSize: fs(8),
                    color: T.textDim,
                    fontFamily: T.mono,
                    marginTop: 1,
                  }}
                >
                  Intraday premium flow follows the selected ticker
                </div>
              </div>
              <div
                style={{
                  display: "flex",
                  gap: sp(8),
                  fontSize: fs(9),
                  fontFamily: T.mono,
                  flexWrap: "wrap",
                  justifyContent: "flex-end",
                }}
              >
                <span style={{ color: T.green }}>
                  Calls {fmtM(selectedCallPremium)}
                </span>
                <span style={{ color: T.red }}>
                  Puts {fmtM(selectedPutPremium)}
                </span>
                <span style={{ color: T.accent, fontWeight: 700 }}>
                  Net{" "}
                  {selectedCallPremium - selectedPutPremium >= 0 ? "+" : ""}
                  {fmtM(Math.abs(selectedCallPremium - selectedPutPremium))}
                </span>
              </div>
            </div>
            {selectedFlowTide.length ? (
              <div style={{ height: dim(190), width: "100%" }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={selectedFlowTide}>
                    <XAxis
                      dataKey="time"
                      tick={{ fontSize: fs(9), fill: T.textMuted }}
                    />
                    <YAxis
                      tick={{ fontSize: fs(9), fill: T.textMuted }}
                      tickFormatter={(value) => `${(value / 1e6).toFixed(1)}M`}
                    />
                    <Tooltip
                      contentStyle={{
                        background: T.bg4,
                        border: `1px solid ${T.border}`,
                        borderRadius: 0,
                        fontSize: fs(10),
                        fontFamily: T.mono,
                      }}
                      formatter={(value) =>
                        `${value >= 0 ? "+" : ""}$${(value / 1e6).toFixed(2)}M`
                      }
                    />
                    <ReferenceLine
                      y={0}
                      stroke={T.textMuted}
                      strokeDasharray="2 2"
                    />
                    <Area
                      type="monotone"
                      dataKey="cumNet"
                      stroke={T.accent}
                      strokeWidth={2}
                      fill={T.accent}
                      fillOpacity={0.28}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <DataUnavailableState
                title={`No live flow for ${sym}`}
                detail="Select another ticker or wait for new options activity."
              />
            )}
          </Card>

          <Card style={{ display: "none" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 6,
                gap: sp(8),
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: fs(10),
                    fontWeight: 700,
                    fontFamily: T.display,
                    color: T.textSec,
                  }}
                >
                  Unusual Options Activity
                </div>
                <div
                  style={{
                    fontSize: fs(8),
                    color: T.textDim,
                    fontFamily: T.mono,
                    marginTop: 1,
                  }}
                >
                  Highest premium options activity across the tracked universe
                </div>
              </div>
              <span
                style={{ fontSize: fs(8), color: T.textMuted, fontFamily: T.mono }}
              >
                {highlightedUnusualFlow.length} events
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: sp(5) }}>
              {highlightedUnusualFlow.length ? (
                highlightedUnusualFlow.map((event) => {
                  const positive =
                    event.side === "BUY" ? event.cp === "C" : event.cp === "P";
                  const tone =
                    event.side === "BUY"
                      ? event.cp === "C"
                        ? T.green
                        : T.red
                      : T.textSec;
                  const selectedTicker = normalizeTickerSymbol(event.ticker) ===
                    normalizeTickerSymbol(sym);
                  return (
                    <button
                      key={`${event.ticker}-${event.contract}-${event.occurredAt}`}
                      type="button"
                      onClick={() => onSymClick?.(event.ticker)}
                      style={{
                        width: "100%",
                        display: "grid",
                        gridTemplateColumns: "52px 1fr auto",
                        gap: sp(8),
                        alignItems: "center",
                        padding: sp("7px 8px"),
                        background: selectedTicker ? T.bg3 : T.bg0,
                        border: `1px solid ${selectedTicker ? T.accent : T.border}`,
                        borderRadius: 0,
                        cursor: "pointer",
                        textAlign: "left",
                      }}
                      onMouseEnter={(event) => {
                        if (selectedTicker) return;
                        event.currentTarget.style.background = T.bg2;
                        event.currentTarget.style.borderColor = T.textMuted;
                      }}
                      onMouseLeave={(event) => {
                        if (selectedTicker) return;
                        event.currentTarget.style.background = T.bg0;
                        event.currentTarget.style.borderColor = T.border;
                      }}
                    >
                      <span style={{ minWidth: 0 }}>
                        <span
                          style={{
                            display: "block",
                            fontSize: fs(10),
                            fontWeight: 700,
                            fontFamily: T.mono,
                            color: T.text,
                          }}
                        >
                          {event.ticker}
                        </span>
                        <span
                          style={{
                            display: "block",
                            fontSize: fs(8),
                            fontFamily: T.mono,
                            color: tone,
                            marginTop: 1,
                          }}
                        >
                          {event.type}
                        </span>
                      </span>
                      <span style={{ minWidth: 0 }}>
                        <span
                          style={{
                            display: "flex",
                            gap: sp(4),
                            alignItems: "center",
                            fontSize: fs(9),
                            color: T.textSec,
                            overflow: "hidden",
                            whiteSpace: "nowrap",
                          }}
                        >
                          <span
                            style={{
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              minWidth: 0,
                            }}
                          >
                            {event.contract}
                          </span>
                          {event.isUnusual ? (
                            <Badge color={T.amber}>
                              UNUSUAL{" "}
                              {event.unusualScore > 0
                                ? `${event.unusualScore.toFixed(
                                    event.unusualScore >= 10 ? 0 : 1,
                                  )}×`
                                : ""}
                            </Badge>
                          ) : null}
                        </span>
                        <span
                          style={{
                            display: "block",
                            fontSize: fs(8),
                            color: T.textDim,
                            fontFamily: T.mono,
                            marginTop: 1,
                          }}
                        >
                          {formatRelativeTimeShort(event.occurredAt)} ·{" "}
                          {event.side}
                          {isFiniteNumber(event.oi) ? ` · OI ${fmtCompactNumber(event.oi)}` : ""}
                          {isFiniteNumber(event.vol) ? ` · Vol ${fmtCompactNumber(event.vol)}` : ""}
                        </span>
                      </span>
                      <span
                        style={{
                          textAlign: "right",
                          fontSize: fs(9),
                          fontWeight: 700,
                          fontFamily: T.mono,
                          color: positive ? T.green : T.red,
                        }}
                      >
                        {fmtM(event.premium)}
                      </span>
                    </button>
                  );
                })
              ) : (
                <DataUnavailableState
                  title="No unusual options activity"
                  detail="Live options flow is currently unavailable for the tracked universe."
                />
              )}
            </div>
          </Card>
        </div>

        {/* ── ROW 4: S&P 500 Equity Heatmap ── */}
        <Card noPad style={{ overflow: "visible", flexShrink: 0 }}>
          <div
            style={{
              padding: sp("6px 10px"),
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              borderBottom: `1px solid ${T.border}`,
            }}
          >
            <span
              style={{
                fontSize: fs(10),
                fontWeight: 700,
                fontFamily: T.display,
                color: T.textSec,
              }}
            >
              S&P 500 Heatmap
            </span>
            <div style={{ display: "flex", gap: 2 }}>
              {["1d", "5d"].map((v) => (
                <button
                  key={v}
                  onClick={() => setSectorTf(v)}
                  style={{
                    padding: sp("2px 7px"),
                    fontSize: fs(8),
                    fontFamily: T.mono,
                    fontWeight: 600,
                    background: sectorTf === v ? T.accentDim : "transparent",
                    border: `1px solid ${sectorTf === v ? T.accent : "transparent"}`,
                    borderRadius: 0,
                    color: sectorTf === v ? T.accent : T.textDim,
                    cursor: "pointer",
                  }}
                >
                  {v.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
          <TreemapHeatmap
            data={TREEMAP_DATA}
            period={sectorTf}
            onSymClick={onSymClick}
          />
        </Card>

        {/* Sector ETF Heatmap */}
        <SectorTreemap sectors={SECTORS} period={sectorTf} />

        {/* ── ROW 4: P/C + Yield Curve + Breadth ── */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: 6,
          }}
        >
          <Card style={{ padding: "5px 10px" }}>
            <CardTitle>Put / Call</CardTitle>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: sp(4),
                marginBottom: 3,
              }}
            >
              <span
                style={{
                  fontSize: fs(18),
                  fontWeight: 800,
                  fontFamily: T.mono,
                  color: T.text,
                }}
              >
                {isFiniteNumber(putCall.total)
                  ? putCall.total.toFixed(2)
                  : MISSING_VALUE}
              </span>
              <span
                style={{
                  fontSize: fs(8),
                  fontFamily: T.mono,
                  color:
                    putCallBullish == null
                      ? T.textDim
                      : putCallBullish
                        ? T.green
                        : T.red,
                }}
              >
                {isFiniteNumber(putCall.total)
                  ? `${putCallBullish ? "▼" : "▲"} ${Math.abs(putCall.total - 1).toFixed(2)}`
                  : MISSING_VALUE}
              </span>
              <span style={{ fontSize: fs(7), color: T.textMuted }}>
                neutral 1.00
              </span>
            </div>
            <div
              style={{
                display: "flex",
                height: dim(6),
                borderRadius: dim(3),
                overflow: "hidden",
                marginBottom: 4,
              }}
            >
              <div
                style={{
                  flex: 1,
                  background: `linear-gradient(to right, ${T.red}, ${T.amber})`,
                }}
              />
              <div
                style={{
                  flex: 1,
                  background: `linear-gradient(to right, ${T.amber}, ${T.green})`,
                }}
              />
            </div>
            <div
              style={{ position: "relative", height: dim(5), marginTop: -3 }}
            >
              {isFiniteNumber(putCall.total) ? (
                <div
                  style={{
                    position: "absolute",
                    left: `${putCallMarkerPct}%`,
                    transform: "translateX(-50%)",
                    borderLeft: "3px solid transparent",
                    borderRight: "3px solid transparent",
                    borderBottom: `4px solid ${T.text}`,
                  }}
                />
              ) : null}
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginTop: sp(3),
                fontSize: fs(8),
                fontFamily: T.mono,
              }}
            >
              <span style={{ color: T.textMuted }}>
                Eq{" "}
                <span style={{ color: T.textSec }}>
                  {isFiniteNumber(putCall.equities)
                    ? putCall.equities.toFixed(2)
                    : MISSING_VALUE}
                </span>
              </span>
              <span style={{ color: T.textMuted }}>
                Idx{" "}
                <span style={{ color: T.textSec }}>
                  {isFiniteNumber(putCall.indices)
                    ? putCall.indices.toFixed(2)
                    : MISSING_VALUE}
                </span>
              </span>
              <span style={{ color: T.textMuted }}>
                Tot{" "}
                <span style={{ color: T.textSec }}>
                  {isFiniteNumber(putCall.total)
                    ? putCall.total.toFixed(2)
                    : MISSING_VALUE}
                </span>
              </span>
            </div>
          </Card>
          <Card style={{ padding: "5px 10px" }}>
            <CardTitle>Rates Proxies</CardTitle>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: sp(3),
                minHeight: 72,
              }}
            >
              {RATES_PROXIES.map((item) => {
                const pos = isFiniteNumber(item.pct) ? item.pct >= 0 : null;
                const width = isFiniteNumber(item.pct)
                  ? Math.max(6, Math.min(100, Math.abs(item.pct) * 48))
                  : 0;
                return (
                  <div
                    key={item.sym}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "46px 40px 1fr 40px",
                      alignItems: "center",
                      gap: sp(4),
                      fontSize: fs(7),
                      fontFamily: T.mono,
                    }}
                  >
                    <span style={{ color: T.textDim }}>{item.term}</span>
                    <span style={{ color: T.textSec, fontWeight: 600 }}>
                      {item.sym}
                    </span>
                    <div
                      style={{
                        height: dim(6),
                        position: "relative",
                        background: T.bg3,
                        borderRadius: dim(3),
                      }}
                    >
                      <div
                        style={{
                          position: "absolute",
                          top: 0,
                          bottom: 0,
                          left: 0,
                          width: `${width}%`,
                          borderRadius: dim(3),
                          background:
                            pos == null ? T.textMuted : pos ? T.green : T.red,
                          opacity: 0.85,
                        }}
                      />
                    </div>
                    <span
                      style={{
                        color:
                          pos == null ? T.textDim : pos ? T.green : T.red,
                        textAlign: "right",
                        fontWeight: 700,
                      }}
                    >
                      {formatSignedPercent(item.pct)}
                    </span>
                  </div>
                );
              })}
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: fs(7),
                fontFamily: T.mono,
              }}
            >
              <span style={{ color: T.textMuted }}>
                Lead{" "}
                <span style={{ color: T.textSec }}>
                  {ratesSummary.leader?.sym || MISSING_VALUE}
                </span>
              </span>
              <span style={{ color: T.textMuted }}>
                Lag{" "}
                <span style={{ color: T.textSec }}>
                  {ratesSummary.laggard?.sym || MISSING_VALUE}
                </span>
              </span>
            </div>
          </Card>
          <Card style={{ padding: "5px 10px" }}>
            <CardTitle>Breadth</CardTitle>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: sp(4),
                marginBottom: 3,
              }}
            >
              <span
                style={{
                  fontSize: fs(10),
                  fontFamily: T.mono,
                  fontWeight: 800,
                  color: T.green,
                }}
              >
                {breadth.total ? breadth.advancers : MISSING_VALUE}
              </span>
              <div
                style={{
                  flex: 1,
                  display: "flex",
                  height: dim(7),
                  borderRadius: dim(3),
                  overflow: "hidden",
                }}
              >
                <div style={{ width: `${upPct}%`, background: T.green }} />
                <div style={{ width: `${downPct}%`, background: T.red }} />
              </div>
              <span
                style={{
                  fontSize: fs(10),
                  fontFamily: T.mono,
                  fontWeight: 800,
                  color: T.red,
                }}
              >
                {breadth.total ? breadth.decliners : MISSING_VALUE}
              </span>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: sp(1),
                fontSize: fs(7),
                fontFamily: T.mono,
              }}
            >
              {[
                [
                  "Up",
                  breadth.total ? `${upPct.toFixed(0)}%` : MISSING_VALUE,
                  breadth.total ? T.green : T.textDim,
                ],
                [
                  "5D+",
                  isFiniteNumber(breadth.positive5dPct)
                    ? `${breadth.positive5dPct.toFixed(0)}%`
                    : MISSING_VALUE,
                  isFiniteNumber(breadth.positive5dPct)
                    ? breadth.positive5dPct >= 50
                      ? T.green
                      : T.amber
                    : T.textDim,
                ],
                [
                  "Unchg",
                  breadth.total ? `${breadth.unchanged}` : MISSING_VALUE,
                  breadth.total ? T.text : T.textDim,
                ],
                [
                  "Sectors+",
                  breadth.sectorCoverage
                    ? `${breadth.positiveSectors}/${breadth.sectorCoverage}`
                    : MISSING_VALUE,
                  breadth.sectorCoverage
                    ? breadth.positiveSectors >=
                      Math.ceil(breadth.sectorCoverage / 2)
                      ? T.green
                      : T.amber
                    : T.textDim,
                ],
                [
                  "Lead",
                  breadth.leader?.sym || MISSING_VALUE,
                  isFiniteNumber(breadth.leader?.chg)
                    ? breadth.leader.chg >= 0
                      ? T.green
                      : T.red
                    : T.textDim,
                ],
                [
                  "Lag",
                  breadth.laggard?.sym || MISSING_VALUE,
                  isFiniteNumber(breadth.laggard?.chg)
                    ? breadth.laggard.chg >= 0
                      ? T.green
                      : T.red
                    : T.textDim,
                ],
              ].map(([l, v, c], i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    padding: sp("1px 3px"),
                    background: i % 2 === 0 ? `${T.bg3}40` : "transparent",
                    borderRadius: 2,
                  }}
                >
                  <span style={{ color: T.textDim }}>{l}</span>
                  <span style={{ color: c, fontWeight: 600 }}>{v}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* ── ROW 4.5: Sector Flow (full width, horizontal layout) — sector rotation read ── */}
        <Card style={{ padding: "8px 12px", flexShrink: 0 }}>
          <CardTitle
            right={
              <span
                style={{
                  fontSize: fs(8),
                  color: flowStatus === "live" ? T.accent : T.textMuted,
                  fontFamily: T.mono,
                }}
              >
                {flowStatus === "live"
                  ? "live option premium · today · sector rotation"
                  : `flow ${flowStatus}`}
              </span>
            }
          >
            Sector Flow
          </CardTitle>
          {sectorFlow.length ? (
            (() => {
              const absMax = Math.max(
                1,
                ...sectorFlow.map((x) => Math.abs(x.calls - x.puts)),
              );
              // Sort by net flow magnitude — strongest signals first
              const sorted = [...sectorFlow]
                .map((s) => ({ ...s, net: s.calls - s.puts }))
                .sort((a, b) => b.net - a.net);
              const half = Math.ceil(sorted.length / 2);
              const left = sorted.slice(0, half);
              const right = sorted.slice(half);
              const renderBar = (s, i) => {
                const widthPct = (Math.abs(s.net) / absMax) * 50;
                const netStr = (s.net >= 0 ? "+" : "-") + fmtM(Math.abs(s.net));
                return (
                  <div
                    key={i}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "85px 1fr 56px",
                      alignItems: "center",
                      gap: sp(6),
                      marginBottom: sp(3),
                      fontSize: fs(10),
                      fontFamily: T.mono,
                    }}
                  >
                    <span style={{ color: T.textSec, fontWeight: 600 }}>
                      {s.sector}
                    </span>
                    <div
                      style={{
                        position: "relative",
                        height: dim(10),
                        background: T.bg3,
                        borderRadius: dim(2),
                      }}
                    >
                      {/* Center divider */}
                      <div
                        style={{
                          position: "absolute",
                          top: 0,
                          bottom: 0,
                          left: "50%",
                          width: dim(1),
                          background: T.textMuted,
                          opacity: 0.4,
                        }}
                      />
                      {/* Direction bar */}
                      {s.net >= 0 ? (
                        <div
                          style={{
                            position: "absolute",
                            left: "50%",
                            top: 0,
                            bottom: 0,
                            width: `${widthPct}%`,
                            background: T.green,
                            opacity: 0.85,
                            borderRadius: `0 ${dim(2)}px ${dim(2)}px 0`,
                          }}
                        />
                      ) : (
                        <div
                          style={{
                            position: "absolute",
                            right: "50%",
                            top: 0,
                            bottom: 0,
                            width: `${widthPct}%`,
                            background: T.red,
                            opacity: 0.85,
                            borderRadius: `${dim(2)}px 0 0 ${dim(2)}px`,
                          }}
                        />
                      )}
                    </div>
                    <span
                      style={{
                        color: s.net >= 0 ? T.green : T.red,
                        fontWeight: 700,
                        textAlign: "right",
                      }}
                    >
                      {netStr}
                    </span>
                  </div>
                );
              };
              return (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: sp(20),
                  }}
                >
                  <div>{left.map(renderBar)}</div>
                  <div>{right.map(renderBar)}</div>
                </div>
              );
            })()
          ) : (
            <DataUnavailableState
              title="No live sector flow"
              detail={
                flowStatus === "loading"
                  ? "Waiting on live options flow snapshots for the tracked market symbols."
                  : "Sector rotation is hidden until a live options flow provider returns current data."
              }
            />
          )}
        </Card>

        {/* ── ROW 5: News + Calendar + AI ── */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1.4fr 0.7fr 1fr",
            gap: 6,
          }}
        >
          <Card style={{ padding: "6px 10px" }}>
            <CardTitle
              right={
                <span
                  style={{
                    fontSize: fs(7),
                    color:
                      newsStatusLabel === "live · news"
                        ? T.accent
                        : T.textDim,
                    fontFamily: T.mono,
                  }}
                >
                  {newsStatusLabel}
                </span>
              }
            >
              News
            </CardTitle>
            {newsItems.length ? (
              newsItems.map((item, index) => (
                <div
                  key={item.id}
                  style={{
                    display: "flex",
                    gap: sp(5),
                    padding: sp("3px 0"),
                    alignItems: "flex-start",
                    borderBottom:
                      index < newsItems.length - 1
                        ? `1px solid ${T.border}06`
                        : "none",
                    cursor: item.articleUrl ? "pointer" : "default",
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background = T.bg3)
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = "transparent")
                  }
                  onClick={() => {
                    if (!item.articleUrl || typeof window === "undefined")
                      return;
                    window.open(
                      item.articleUrl,
                      "_blank",
                      "noopener,noreferrer",
                    );
                  }}
                  title={item.publisher || undefined}
                >
                  <Badge color={T.accent}>{item.tag}</Badge>
                  <div
                    style={{
                      width: dim(4),
                      height: dim(4),
                      borderRadius: "50%",
                      background:
                        item.s === 1
                          ? T.green
                          : item.s === -1
                            ? T.red
                            : T.textDim,
                      marginTop: sp(4),
                      flexShrink: 0,
                    }}
                  />
                  <span
                    style={{
                      flex: 1,
                      fontSize: fs(10),
                      color: T.textSec,
                      fontFamily: T.sans,
                      lineHeight: 1.4,
                    }}
                  >
                    {item.text}
                  </span>
                  <span
                    style={{
                      fontSize: fs(8),
                      color: T.textMuted,
                      fontFamily: T.mono,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {item.time}
                  </span>
                </div>
              ))
            ) : (
              <DataUnavailableState
                title="No live news feed"
                detail={
                  newsStatusLabel === "loading"
                    ? "Waiting on the live news provider."
                    : "The news card only shows provider-backed headlines now; no authored fallback feed is rendered."
                }
              />
            )}
          </Card>
          <Card style={{ padding: "6px 10px" }}>
            <CardTitle
              right={
                <span
                  style={{
                    fontSize: fs(7),
                    color:
                      calendarStatusLabel === "earnings · live"
                        ? T.accent
                        : T.textDim,
                    fontFamily: T.mono,
                  }}
                >
                  {calendarStatusLabel}
                </span>
              }
            >
              Calendar
            </CardTitle>
            {calendarItems.length ? (
              calendarItems.map((ev, i) => {
                const tc =
                  ev.type === "fomc" || ev.type === "cpi"
                    ? T.amber
                    : ev.type === "earnings"
                      ? T.green
                      : ev.type === "holiday"
                        ? T.red
                        : T.accent;
                return (
                  <div
                    key={ev.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: sp(4),
                      padding: sp("3px 0"),
                      borderBottom:
                        i < calendarItems.length - 1
                          ? `1px solid ${T.border}06`
                          : "none",
                    }}
                  >
                    <div
                      style={{
                        width: dim(2),
                        height: dim(16),
                        borderRadius: dim(1),
                        background: tc,
                        flexShrink: 0,
                      }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: fs(10),
                          fontWeight: 600,
                          fontFamily: T.sans,
                          color: T.text,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {ev.label}
                      </div>
                      <div
                        style={{
                          fontSize: fs(8),
                          color: T.textMuted,
                          fontFamily: T.mono,
                        }}
                      >
                        {ev.date}
                      </div>
                    </div>
                  </div>
                );
              })
            ) : (
              <DataUnavailableState
                title="No live calendar data"
                detail={
                  calendarStatusLabel === "loading"
                    ? "Waiting on the earnings calendar provider."
                    : researchConfigured
                      ? "The calendar is empty because no live entries were returned for the current window."
                      : "Research calendar access is not configured for this environment."
                }
              />
            )}
          </Card>
          <Card
            style={{
              display: "flex",
              flexDirection: "column",
              padding: "6px 10px",
            }}
          >
            <CardTitle right={<Badge color={T.purple}>AI</Badge>}>
              Analysis
            </CardTitle>
            <div
              style={{
                flex: 1,
                fontSize: fs(10),
                fontFamily: T.sans,
                color: T.textSec,
                lineHeight: 1.5,
                padding: sp("5px 8px"),
                background: T.bg0,
                borderRadius: 0,
                border: `1px solid ${T.border}`,
              }}
            >
              <span
                style={{
                  color: !isFiniteNumber(volatilityProxy?.pct)
                    ? T.textDim
                    : volatilityProxy.pct <= 0
                      ? T.green
                      : T.amber,
                }}
              >
                ▸
              </span>{" "}
              {volatilityProxy?.label || "Volatility"} proxy{" "}
              {isFiniteNumber(volatilityProxy?.pct)
                ? volatilityProxy.pct >= 0
                  ? "firming"
                  : "easing"
                : "is unavailable"}{" "}
              at {formatQuotePrice(volatilityProxy?.price)}; flow is strongest
              in {analysisLeader?.sym || MISSING_VALUE} and weakest in{" "}
              {analysisLaggard?.sym || MISSING_VALUE}.{"\n\n"}
              <span
                style={{
                  color: !isFiniteNumber(breadth.advancePct)
                    ? T.textDim
                    : breadth.advancePct >= 55
                      ? T.green
                      : T.amber,
                }}
              >
                ▸
              </span>{" "}
              {breadth.total
                ? `Tracked breadth is ${breadth.advancers}/${breadth.total} green with ${isFiniteNumber(breadth.positive5dPct) ? breadth.positive5dPct.toFixed(0) : MISSING_VALUE}% of names positive over 5 sessions.`
                : "Tracked breadth is unavailable until broker quotes populate the equity heatmap universe."}
              {"\n\n"}
              <span style={{ color: T.accent }}>▸</span> Treasury proxies are
              led by {ratesSummary.leader?.sym || MISSING_VALUE} and lagged by{" "}
              {ratesSummary.laggard?.sym || MISSING_VALUE}; keep the tape read anchored to
              live ETF proxies until direct index and futures entitlements are
              enabled.
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════
// SCREEN: FLOW (UOA Scanner)
// ═══════════════════════════════════════════════════════════════════

const ContractDetailInline = ({ evt, onBack, onJumpToTrade }) => {
  const toast = useToast();
  const [alertSet, setAlertSet] = useState(false);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onBack]);

  if (!evt) return null;

  const isCall = evt.cp === "C";
  const cpColor = isCall ? T.green : T.red;
  const typeColor =
    evt.type === "SWEEP" ? T.amber : evt.type === "BLOCK" ? T.accent : T.purple;
  const isSnapshotFlow = evt.basis === "snapshot";
  const voi =
    isFiniteNumber(evt.vol) && isFiniteNumber(evt.oi) && evt.oi > 0
      ? evt.vol / evt.oi
      : null;
  const sentimentScore = mapNewsSentimentToScore(evt.sentiment);
  const sideRead = isSnapshotFlow
    ? "Side inferred from bid/ask snapshot"
    : evt.side === "BUY"
      ? "Buyer initiated"
      : evt.side === "SELL"
        ? "Seller initiated"
        : "Side unavailable";
  const flowRead = isSnapshotFlow
    ? "Snapshot-derived active contract"
    : evt.type === "BLOCK"
      ? "Large negotiated block"
      : evt.type === "SWEEP"
        ? "Aggressive routed sweep"
        : "Single reported print";

  const Stat = ({ label, value, color = T.text, mono = true }) => (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: sp(8),
        padding: sp("6px 8px"),
        background: T.bg3,
        borderRadius: dim(3),
      }}
    >
      <span
        style={{ fontSize: fs(9), color: T.textMuted, fontFamily: T.mono }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: fs(10),
          color,
          fontWeight: 700,
          fontFamily: mono ? T.mono : T.sans,
          textAlign: "right",
        }}
      >
        {value}
      </span>
    </div>
  );

  return (
    <div style={{ animation: "fadeIn 0.15s ease-out" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: sp(8),
          padding: sp("8px 12px"),
          marginBottom: sp(6),
          background: T.bg2,
          border: `1px solid ${T.border}`,
          borderRadius: dim(6),
          flexWrap: "wrap",
        }}
      >
        <button
          onClick={onBack}
          title="Back to flow (Esc)"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: sp(4),
            padding: sp("5px 10px"),
            background: "transparent",
            border: `1px solid ${T.border}`,
            borderRadius: dim(4),
            color: T.textSec,
            fontSize: fs(10),
            fontWeight: 600,
            fontFamily: T.sans,
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: fs(12) }}>←</span> Back to flow
        </button>
        <div
          style={{
            width: dim(1),
            height: dim(22),
            background: T.border,
            flexShrink: 0,
          }}
        />
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: sp(6),
            minWidth: 0,
            flexWrap: "wrap",
          }}
        >
          {evt.golden && (
            <span style={{ color: T.amber, fontSize: fs(14) }}>★</span>
          )}
          <span
            style={{
              fontSize: fs(16),
              fontWeight: 800,
              fontFamily: T.display,
              color: T.text,
              letterSpacing: "-0.01em",
              whiteSpace: "nowrap",
            }}
          >
            {evt.ticker} {evt.strike} {isCall ? "Call" : "Put"}
          </span>
          <span
            style={{
              fontSize: fs(10),
              fontFamily: T.mono,
              color: T.textDim,
              whiteSpace: "nowrap",
            }}
          >
            Exp {formatExpirationLabel(evt.expirationDate)}
          </span>
          <span
            style={{
              fontSize: fs(10),
              fontFamily: T.mono,
              color: evt.dte <= 1 ? T.red : evt.dte <= 7 ? T.amber : T.textDim,
              fontWeight: 600,
            }}
          >
            {evt.dte}DTE
          </span>
          <span
            style={{
              fontSize: fs(10),
              fontFamily: T.mono,
              color: typeColor,
              fontWeight: 700,
              padding: sp("1px 6px"),
              background: T.bg3,
              borderRadius: dim(2),
            }}
          >
            {evt.type}
          </span>
          <Badge color={flowProviderColor(evt.provider)}>
            {evt.sourceLabel}
          </Badge>
        </div>
        <span style={{ flex: 1 }} />
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            gap: sp(2),
            flexShrink: 0,
          }}
        >
          <span
            style={{
              fontSize: fs(18),
              fontWeight: 800,
              fontFamily: T.mono,
              color: T.text,
            }}
          >
            {evt.premium >= 1e6
              ? `$${(evt.premium / 1e6).toFixed(2)}M`
              : `$${(evt.premium / 1e3).toFixed(0)}K`}
          </span>
          <span
            style={{
              fontSize: fs(9),
              fontFamily: T.mono,
              color: T.textDim,
            }}
          >
            Flow premium • {evt.time} ET
          </span>
        </div>
        <div
          style={{
            width: dim(1),
            height: dim(22),
            background: T.border,
            flexShrink: 0,
          }}
        />
        <button
          onClick={() => onJumpToTrade && onJumpToTrade(evt)}
          style={{
            padding: sp("5px 10px"),
            background: T.accent,
            color: "#fff",
            border: "none",
            borderRadius: dim(4),
            cursor: "pointer",
            fontSize: fs(10),
            fontWeight: 700,
            fontFamily: T.sans,
            flexShrink: 0,
          }}
        >
          Open in Trade
        </button>
        <button
          onClick={() => {
            const next = !alertSet;
            setAlertSet(next);
            toast.push({
              kind: next ? "success" : "info",
              title: next ? "Alert set" : "Alert removed",
              body: next
                ? `${evt.ticker} ${evt.strike}${evt.cp} · Notify on next big activity (>$100K)`
                : `${evt.ticker} ${evt.strike}${evt.cp} · No longer watching this contract`,
            });
          }}
          style={{
            padding: sp("5px 10px"),
            background: alertSet ? `${T.amber}20` : "transparent",
            color: alertSet ? T.amber : T.textSec,
            border: `1px solid ${alertSet ? T.amber : T.border}`,
            borderRadius: dim(4),
            cursor: "pointer",
            fontSize: fs(10),
            fontWeight: 600,
            fontFamily: T.sans,
            flexShrink: 0,
          }}
        >
          🔔 {alertSet ? "Alert active" : "Set alert"}
        </button>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 440px) minmax(0, 1fr)",
          gap: sp(6),
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: sp(6),
            minWidth: 0,
          }}
        >
          <Card style={{ padding: sp(8) }}>
            <div
              style={{
                fontSize: fs(10),
                fontWeight: 700,
                fontFamily: T.display,
                color: T.textSec,
                letterSpacing: "0.04em",
                marginBottom: sp(4),
              }}
            >
              CONTRACT SNAPSHOT
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: sp(4),
              }}
            >
              <Stat label="SIDE" value={evt.side} color={evt.side === "BUY" ? T.green : evt.side === "SELL" ? T.red : T.textDim} />
              <Stat label="TYPE" value={evt.type} color={typeColor} />
              <Stat label="VOL" value={fmtCompactNumber(evt.vol)} />
              <Stat label="OI" value={fmtCompactNumber(evt.oi)} />
              <Stat
                label="V/OI"
                value={isFiniteNumber(voi) ? `${voi.toFixed(2)}x` : MISSING_VALUE}
                color={isFiniteNumber(voi) && voi > 1 ? T.amber : T.text}
              />
              <Stat
                label="IV"
                value={isFiniteNumber(evt.iv) ? `${(evt.iv * 100).toFixed(1)}%` : MISSING_VALUE}
                color={isFiniteNumber(evt.iv) ? T.cyan : T.textDim}
              />
              <Stat label="PREM" value={fmtM(evt.premium)} color={T.amber} />
              <Stat label="SCORE" value={evt.score} color={evt.score >= 80 ? T.amber : evt.score >= 60 ? T.green : T.text} />
            </div>
          </Card>

          <Card style={{ padding: sp(8) }}>
            <div
              style={{
                fontSize: fs(10),
                fontWeight: 700,
                fontFamily: T.display,
                color: T.textSec,
                letterSpacing: "0.04em",
                marginBottom: sp(4),
              }}
            >
              EVENT READ
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: sp(6),
                fontSize: fs(10),
                lineHeight: 1.45,
                color: T.textSec,
                fontFamily: T.sans,
              }}
            >
              <div>
                <span style={{ color: cpColor, fontWeight: 700 }}>
                  {isCall ? "Call flow" : "Put flow"}
                </span>{" "}
                with a provider-reported {evt.side.toLowerCase()} side. This panel
                now shows only event fields that came back from the live flow
                provider.
              </div>
              <div>
                <span style={{ color: T.text, fontWeight: 700 }}>{flowRead}</span>
                {" · "}
                <span
                  style={{
                    color:
                      sentimentScore > 0
                        ? T.green
                        : sentimentScore < 0
                          ? T.red
                          : T.textDim,
                    fontWeight: 700,
                  }}
                >
                  {evt.sentiment || "sentiment unavailable"}
                </span>
              </div>
              <div style={{ color: T.textDim, fontFamily: T.mono }}>
                {sideRead}
                {evt.tradeConditions?.length
                  ? ` • cond ${evt.tradeConditions.join(", ")}`
                  : ""}
              </div>
            </div>
          </Card>
        </div>

        <Card
          style={{
            padding: sp(10),
            display: "flex",
            flexDirection: "column",
            minWidth: 0,
            minHeight: dim(420),
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: sp(5),
            }}
          >
            <span
              style={{
                fontSize: fs(10),
                fontWeight: 700,
                fontFamily: T.display,
                color: T.textSec,
                letterSpacing: "0.04em",
              }}
            >
              BROKER CHART
            </span>
            <span
              style={{ fontSize: fs(9), color: T.textDim, fontFamily: T.mono }}
            >
              no synthetic reconstruction
            </span>
          </div>
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <DataUnavailableState
              title="No broker-backed contract chart here"
              detail="The flow detail view no longer invents intraday contract tape or candles. Use Open in Trade to load the live broker contract chart and book data."
            />
          </div>
        </Card>
      </div>
    </div>
  );
};

const FlowScreen = ({ onJumpToTrade, session, symbols = [] }) => {
  // ── Saved scans persisted in localStorage ──
  const [savedScans, setSavedScans] = useState(
    _initialState.flowSavedScans || [],
  );
  const [activeScanId, setActiveScanId] = useState(
    _initialState.flowActiveScanId || null,
  );
  useEffect(() => {
    persistState({ flowSavedScans: savedScans });
  }, [savedScans]);

  const [filter, setFilter] = useState(_initialState.flowFilter || "all");
  const [minPrem, setMinPrem] = useState(
    Number.isFinite(_initialState.flowMinPrem) ? _initialState.flowMinPrem : 0,
  );
  const [sortBy, setSortBy] = useState(_initialState.flowSortBy || "time");
  const [selectedEvt, setSelectedEvt] = useState(null); // currently inspected contract
  useEffect(() => {
    persistState({
      flowActiveScanId: activeScanId,
      flowFilter: filter,
      flowMinPrem: minPrem,
      flowSortBy: sortBy,
    });
  }, [activeScanId, filter, minPrem, sortBy]);
  useEffect(() => {
    if (!activeScanId) {
      return;
    }
    if (!savedScans.some((scan) => scan.id === activeScanId)) {
      setActiveScanId(null);
    }
  }, [activeScanId, savedScans]);
  const {
    hasLiveFlow,
    flowStatus,
    providerSummary,
    flowEvents,
    flowTide,
    tickerFlow,
    flowClock,
    dteBuckets,
    marketOrderFlow,
  } = useLiveMarketFlow(symbols);

  // ── CLUSTER DETECTION ──
  // Group activity by (ticker + strike + cp). Any group with 2+ events = cluster.
  // We surface cluster size + total premium on each row that's part of a cluster.
  const clusters = useMemo(() => {
    const map = {};
    for (const e of flowEvents) {
      const key =
        e.optionTicker ||
        `${e.ticker}_${e.strike}_${e.cp}_${formatExpirationLabel(e.expirationDate)}`;
      if (!map[key])
        map[key] = {
          count: 0,
          totalPrem: 0,
          ids: [],
          firstTime: e.time,
          lastTime: e.time,
        };
      map[key].count += 1;
      map[key].totalPrem += e.premium;
      map[key].ids.push(e.id);
      if (e.time < map[key].firstTime) map[key].firstTime = e.time;
      if (e.time > map[key].lastTime) map[key].lastTime = e.time;
    }
    return map;
  }, [flowEvents]);
  // Build per-event lookup for fast row rendering
  const clusterFor = (e) => {
    const key =
      e.optionTicker ||
      `${e.ticker}_${e.strike}_${e.cp}_${formatExpirationLabel(e.expirationDate)}`;
    const c = clusters[key];
    return c && c.count >= 2 ? c : null;
  };

  // ── TOP CONTRACTS BY VOLUME, per ticker ──
  // For each ticker, group live flow events by (strike + cp), sum volume + premium, pick top 3.
  // Clicking a contract chip opens the Contract Detail Drawer for the biggest event in that group.
  const topContractsByTicker = useMemo(() => {
    const byTicker = {};
    for (const e of flowEvents) {
      if (!byTicker[e.ticker]) byTicker[e.ticker] = {};
      const key =
        e.optionTicker ||
        `${e.strike}_${e.cp}_${formatExpirationLabel(e.expirationDate)}`;
      if (!byTicker[e.ticker][key]) {
        byTicker[e.ticker][key] = {
          strike: e.strike,
          cp: e.cp,
          dte: e.dte,
          vol: 0,
          premium: 0,
          count: 0,
          biggestEvt: e,
        };
      }
      const g = byTicker[e.ticker][key];
      g.vol += e.vol;
      g.premium += e.premium;
      g.count += 1;
      if (e.premium > g.biggestEvt.premium) g.biggestEvt = e;
    }
    // Convert to sorted-top-3 arrays
    const result = {};
    for (const [ticker, contracts] of Object.entries(byTicker)) {
      result[ticker] = Object.values(contracts)
        .sort((a, b) => b.vol - a.vol)
        .slice(0, 3);
    }
    return result;
  }, [flowEvents]);

  // Aggregate stats
  const totalCallPrem = flowEvents
    .filter((e) => e.cp === "C")
    .reduce((a, e) => a + e.premium, 0);
  const totalPutPrem = flowEvents
    .filter((e) => e.cp === "P")
    .reduce((a, e) => a + e.premium, 0);
  const netPrem = totalCallPrem - totalPutPrem;
  const goldenCount = flowEvents.filter((e) => e.golden).length;
  const blockCount = flowEvents.filter((e) => e.type === "BLOCK").length;
  const sweepCount = flowEvents.filter((e) => e.type === "SWEEP").length;
  const zeroDteCount = flowEvents.filter((e) => e.dte <= 1).length;
  const zeroDtePrem = flowEvents
    .filter((e) => e.dte <= 1)
    .reduce((a, e) => a + e.premium, 0);
  const cpRatio = totalCallPrem ? totalPutPrem / totalCallPrem : 0;
  const mostActive = [...tickerFlow].sort(
    (a, b) => b.calls + b.puts - (a.calls + a.puts),
  )[0] || { sym: MISSING_VALUE, calls: 0, puts: 0 };

  // ── SMART MONEY COMPASS ──
  // Institutional bias = net premium from XL trades (>$250K) on calls vs puts.
  // Score range -100 (max bearish) to +100 (max bullish).
  const xlTrades = flowEvents.filter((e) => e.premium >= 250000);
  const xlCallPrem =
    xlTrades
      .filter((e) => e.cp === "C" && e.side === "BUY")
      .reduce((s, e) => s + e.premium, 0) -
    xlTrades
      .filter((e) => e.cp === "C" && e.side === "SELL")
      .reduce((s, e) => s + e.premium, 0);
  const xlPutPrem =
    xlTrades
      .filter((e) => e.cp === "P" && e.side === "BUY")
      .reduce((s, e) => s + e.premium, 0) -
    xlTrades
      .filter((e) => e.cp === "P" && e.side === "SELL")
      .reduce((s, e) => s + e.premium, 0);
  const xlNet = xlCallPrem - xlPutPrem;
  const xlTotalAbs = Math.abs(xlCallPrem) + Math.abs(xlPutPrem) || 1;
  const compassScore = Math.round((xlNet / xlTotalAbs) * 100); // -100 to +100
  const compassVerdict =
    compassScore >= 50
      ? "BULLISH"
      : compassScore >= 20
        ? "LEAN BULL"
        : compassScore >= -20
          ? "NEUTRAL"
          : compassScore >= -50
            ? "LEAN BEAR"
            : "BEARISH";
  const compassColor =
    compassScore >= 20 ? T.green : compassScore >= -20 ? T.amber : T.red;

  // Filter + sort
  let filtered = flowEvents
    .filter((e) => {
      if (filter === "calls") return e.cp === "C";
      if (filter === "puts") return e.cp === "P";
      if (filter === "golden") return e.golden;
      if (filter === "sweep") return e.type === "SWEEP";
      if (filter === "block") return e.type === "BLOCK";
      if (filter === "cluster") return clusterFor(e) !== null; // new: clusters-only filter
      return true;
    })
    .filter((e) => e.premium >= minPrem);
  if (sortBy === "premium")
    filtered = [...filtered].sort((a, b) => b.premium - a.premium);
  else if (sortBy === "score")
    filtered = [...filtered].sort((a, b) => b.score - a.score);

  const maxTickerPrem = Math.max(1, ...tickerFlow.map((t) => t.calls + t.puts));
  const bridgeTone = bridgeRuntimeTone(session);
  const ibkrLoginRequired =
    Boolean(session?.configured?.ibkr) &&
    !session?.ibkrBridge?.authenticated &&
    !providerSummary.providers.includes("polygon");
  const flowDisplayLabel =
    !hasLiveFlow && ibkrLoginRequired
      ? "IBKR login required"
      : providerSummary.label === "IBKR snapshot live" &&
          session?.ibkrBridge?.liveMarketDataAvailable === false
        ? "IBKR delayed"
        : providerSummary.label;
  const flowDisplayColor =
    !hasLiveFlow && ibkrLoginRequired
      ? T.amber
      : flowDisplayLabel === "IBKR delayed"
        ? T.amber
        : providerSummary.color;
  const flowClockActiveBuckets = flowClock.filter((bucket) => bucket.count > 0);
  const flowClockPeak =
    flowClockActiveBuckets.reduce(
      (best, bucket) =>
        !best || bucket.count > best.count || bucket.prem > best.prem
          ? bucket
          : best,
      null,
    )?.time || MISSING_VALUE;
  const flowClockAverage = Math.round(
    flowEvents.length / Math.max(1, flowClock.length),
  );
  const emptyFlowDetail =
    flowStatus === "loading"
      ? "Waiting on current options activity snapshots for the tracked symbols."
      : ibkrLoginRequired
        ? bridgeRuntimeMessage(session)
        : providerSummary.erroredSource?.errorMessage
          ? providerSummary.erroredSource.errorMessage
          : providerSummary.failures[0]?.error
            ? providerSummary.failures[0].error
            : providerSummary.fallbackUsed
              ? "IBKR returned no active snapshot flow and the Polygon trade fallback was empty."
              : "IBKR returned no active snapshot flow for the tracked symbols.";
  const flowHeader = (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: sp(8),
        padding: sp("2px 2px 0"),
        fontSize: fs(8),
        fontFamily: T.mono,
        color: T.textDim,
      }}
    >
      <span>
        Flow source ·{" "}
        <span style={{ color: flowDisplayColor, fontWeight: 700 }}>
          {flowDisplayLabel}
        </span>
      </span>
      <span
        title={bridgeRuntimeMessage(session)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: sp(5),
          color: bridgeTone.color,
        }}
      >
        <span
          style={{
            width: dim(6),
            height: dim(6),
            background: bridgeTone.color,
            display: "inline-block",
          }}
        />
        IBKR {bridgeTone.label.toUpperCase()}
      </span>
    </div>
  );

  if (!flowEvents.length) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          height: "100%",
          overflow: "hidden",
          position: "relative",
        }}
      >
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: sp(8),
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          {flowHeader}
          <Card
            style={{
              padding: sp(10),
              minHeight: dim(220),
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <DataUnavailableState
              title="No live options activity"
              detail={emptyFlowDetail}
            />
          </Card>
        </div>
      </div>
    );
  }

  // ── SAVED SCAN HELPERS ──
  const saveCurrentScan = () => {
    const name = prompt(
      "Name this scan:",
      filter === "golden"
        ? "★ Golden plays"
        : filter === "block"
          ? "Block trades"
          : `${filter} ≥${(minPrem / 1000) | 0}K`,
    );
    if (!name) return;
    const newScan = { id: Date.now(), name, filter, minPrem, sortBy };
    setSavedScans((s) => [...s, newScan].slice(-8)); // cap at 8
    setActiveScanId(newScan.id);
  };
  const loadScan = (scan) => {
    setFilter(scan.filter);
    setMinPrem(scan.minPrem);
    setSortBy(scan.sortBy);
    setActiveScanId(scan.id);
  };
  const deleteScan = (id) => {
    setSavedScans((s) => s.filter((x) => x.id !== id));
    if (activeScanId === id) setActiveScanId(null);
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
        position: "relative",
      }}
    >
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: sp(8),
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        {flowHeader}

        {/* ── ROW 1: KPI Bar ── */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(7, 1fr)",
            gap: 6,
          }}
        >
          {[
            {
              label: "TOTAL PREMIUM",
              value: fmtM(totalCallPrem + totalPutPrem),
              sub: `${flowEvents.length} contracts`,
              color: T.text,
            },
            {
              label: "NET PREMIUM",
              value: (netPrem >= 0 ? "+" : "") + fmtM(Math.abs(netPrem)),
              sub: cpRatio < 1 ? "Bullish" : "Bearish",
              color: netPrem >= 0 ? T.green : T.red,
            },
            {
              label: "P/C RATIO",
              value: cpRatio.toFixed(2),
              sub: cpRatio < 0.7 ? "Greed" : cpRatio < 1 ? "Neutral" : "Fear",
              color: cpRatio < 0.7 ? T.green : cpRatio < 1 ? T.amber : T.red,
            },
            {
              label: "★ GOLDEN SWEEPS",
              value: goldenCount,
              sub: "High conv.",
              color: T.amber,
            },
            {
              label: "⚡ 0DTE",
              value: zeroDteCount,
              sub: fmtM(zeroDtePrem),
              color: T.cyan,
            },
            {
              label: "MOST ACTIVE",
              value: mostActive.sym,
              sub: fmtM(mostActive.calls + mostActive.puts),
              color: T.purple,
            },
          ].map((k, i) => (
            <Card key={i} style={{ padding: "5px 9px" }}>
              <div
                style={{
                  fontSize: fs(7),
                  fontWeight: 600,
                  color: T.textDim,
                  letterSpacing: "0.06em",
                  fontVariant: "all-small-caps",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  lineHeight: 1,
                }}
              >
                {k.label}
              </div>
              <div
                style={{
                  fontSize: fs(18),
                  fontWeight: 800,
                  fontFamily: T.mono,
                  color: k.color,
                  marginTop: sp(2),
                  lineHeight: 1,
                }}
              >
                {k.value}
              </div>
              <div
                style={{
                  fontSize: fs(8),
                  color: T.textDim,
                  fontFamily: T.sans,
                  marginTop: sp(1),
                  lineHeight: 1,
                }}
              >
                {k.sub}
              </div>
            </Card>
          ))}
          {/* ── SMART MONEY COMPASS ── institutional bias gauge from XL trades */}
          <Card style={{ padding: "5px 9px" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span
                style={{
                  fontSize: fs(7),
                  fontWeight: 600,
                  color: T.textDim,
                  letterSpacing: "0.06em",
                  fontVariant: "all-small-caps",
                  whiteSpace: "nowrap",
                  lineHeight: 1,
                }}
              >
                SMART MONEY
              </span>
              <span
                style={{
                  fontSize: fs(7),
                  color: T.textDim,
                  fontFamily: T.mono,
                }}
              >
                {xlTrades.length} XL
              </span>
            </div>
            {/* Bias gauge: half-circle with needle pointing to institutional direction */}
            <div
              style={{
                position: "relative",
                width: "100%",
                height: dim(28),
                marginTop: sp(2),
              }}
            >
              <svg
                width="100%"
                height="100%"
                viewBox="0 0 100 36"
                preserveAspectRatio="xMidYMid meet"
              >
                {/* Track segments: red (bearish), amber (neutral), green (bullish) */}
                <path
                  d="M 8 30 A 28 28 0 0 1 36 6"
                  fill="none"
                  stroke={T.red}
                  strokeWidth="3.5"
                  opacity="0.65"
                />
                <path
                  d="M 36 6 A 28 28 0 0 1 64 6"
                  fill="none"
                  stroke={T.amber}
                  strokeWidth="3.5"
                  opacity="0.65"
                />
                <path
                  d="M 64 6 A 28 28 0 0 1 92 30"
                  fill="none"
                  stroke={T.green}
                  strokeWidth="3.5"
                  opacity="0.65"
                />
                {/* Needle: angle in degrees, -90° (left/bearish) to +90° (right/bullish) */}
                {(() => {
                  const angle = (compassScore / 100) * 90; // -90 to +90
                  const rad = ((angle - 90) * Math.PI) / 180;
                  const cx = 50,
                    cy = 30,
                    len = 22;
                  const x2 = cx + len * Math.cos(rad);
                  const y2 = cy + len * Math.sin(rad);
                  return (
                    <>
                      <line
                        x1={cx}
                        y1={cy}
                        x2={x2}
                        y2={y2}
                        stroke={compassColor}
                        strokeWidth="2"
                        strokeLinecap="round"
                      />
                      <circle cx={cx} cy={cy} r="2.2" fill={compassColor} />
                    </>
                  );
                })()}
              </svg>
            </div>
            <div
              style={{
                fontSize: fs(11),
                fontWeight: 800,
                fontFamily: T.display,
                color: compassColor,
                marginTop: sp(1),
                letterSpacing: "0.04em",
              }}
            >
              {compassVerdict}
            </div>
            <div
              style={{
                fontSize: fs(8),
                color: T.textDim,
                fontFamily: T.mono,
                marginTop: 1,
              }}
            >
              {compassScore >= 0 ? "+" : ""}
              {compassScore} bias
            </div>
          </Card>
        </div>

        {/* ── ROW 2: Premium Tide + Ticker Flow Leaderboard ── */}
        <div
          style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 6 }}
        >
          {/* Premium Tide Chart */}
          <div
            style={{
              background: T.bg2,
              border: `1px solid ${T.border}`,
              borderRadius: dim(6),
              padding: sp("8px 10px"),
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 6,
              }}
            >
              <span
                style={{
                  fontSize: fs(10),
                  fontWeight: 700,
                  fontFamily: T.display,
                  color: T.textSec,
                }}
              >
                Premium Tide · Intraday
              </span>
              <div
                style={{
                  display: "flex",
                  gap: sp(8),
                  fontSize: fs(9),
                  fontFamily: T.mono,
                }}
              >
                <span style={{ color: T.green }}>
                  ■ Calls {fmtM(totalCallPrem)}
                </span>
                <span style={{ color: T.red }}>
                  ■ Puts {fmtM(totalPutPrem)}
                </span>
                <span style={{ color: T.accent, fontWeight: 700 }}>
                  Net {netPrem >= 0 ? "+" : ""}
                  {fmtM(Math.abs(netPrem))}
                </span>
              </div>
            </div>
            <div style={{ height: dim(200), width: "100%" }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={flowTide}>
                  <XAxis
                    dataKey="time"
                    tick={{ fontSize: fs(9), fill: T.textMuted }}
                  />
                  <YAxis
                    tick={{ fontSize: fs(9), fill: T.textMuted }}
                    tickFormatter={(v) => `${(v / 1e6).toFixed(1)}M`}
                  />
                  <Tooltip
                    contentStyle={{
                      background: T.bg4,
                      border: `1px solid ${T.border}`,
                      borderRadius: dim(6),
                      fontSize: fs(10),
                      fontFamily: T.mono,
                    }}
                    formatter={(v) =>
                      `${v >= 0 ? "+" : ""}$${(v / 1e6).toFixed(2)}M`
                    }
                  />
                  <ReferenceLine
                    y={0}
                    stroke={T.textMuted}
                    strokeDasharray="2 2"
                  />
                  <Area
                    type="monotone"
                    dataKey="cumNet"
                    stroke={T.accent}
                    strokeWidth={2}
                    fill={T.accent}
                    fillOpacity={0.4}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Ticker Flow Leaderboard with top contracts per ticker */}
          <Card style={{ padding: "8px 10px" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 6,
              }}
            >
              <span
                style={{
                  fontSize: fs(10),
                  fontWeight: 700,
                  fontFamily: T.display,
                  color: T.textSec,
                }}
              >
                Top Tickers by Flow
              </span>
              <span
                style={{
                  fontSize: fs(8),
                  color: T.textDim,
                  fontFamily: T.mono,
                }}
              >
                Top 3 contracts · click to inspect
              </span>
            </div>
            {tickerFlow.map((t) => {
              const total = t.calls + t.puts;
              const net = t.calls - t.puts;
              const callPct = (t.calls / total) * 100;
              const barW = (total / maxTickerPrem) * 100;
              const topContracts = topContractsByTicker[t.sym] || [];
              return (
                <div
                  key={t.sym}
                  style={{
                    marginBottom: sp(6),
                    paddingBottom: sp(4),
                    borderBottom: `1px solid ${T.border}30`,
                  }}
                >
                  {/* Ticker row: symbol + net premium */}
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      fontSize: fs(9),
                      fontFamily: T.mono,
                      marginBottom: sp(1),
                    }}
                  >
                    <span style={{ fontWeight: 700, color: T.text }}>
                      {t.sym}
                    </span>
                    <span
                      style={{
                        color: net >= 0 ? T.green : T.red,
                        fontWeight: 600,
                      }}
                    >
                      {net >= 0 ? "+" : "-"}
                      {fmtM(Math.abs(net))}
                    </span>
                  </div>
                  {/* Call/put ratio bar */}
                  <div
                    style={{
                      display: "flex",
                      height: dim(8),
                      borderRadius: dim(2),
                      overflow: "hidden",
                      background: T.bg3,
                      width: `${barW}%`,
                      marginBottom: sp(3),
                    }}
                  >
                    <div
                      style={{
                        width: `${callPct}%`,
                        background: T.green,
                        height: "100%",
                      }}
                    />
                    <div
                      style={{ flex: 1, background: T.red, height: "100%" }}
                    />
                  </div>
                  {/* Top 3 contracts by volume */}
                  {topContracts.length > 0 && (
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(3, 1fr)",
                        gap: sp(3),
                      }}
                    >
                      {topContracts.map((c, i) => {
                        const cpColor = c.cp === "C" ? T.green : T.red;
                        const volStr =
                          c.vol >= 1000
                            ? `${(c.vol / 1000).toFixed(1)}K`
                            : `${c.vol}`;
                        return (
                          <div
                            key={i}
                            onClick={() =>
                              setSelectedEvt((prev) =>
                                prev && prev.id === c.biggestEvt.id
                                  ? null
                                  : c.biggestEvt,
                              )
                            }
                            title={`${t.sym} ${c.strike}${c.cp} · ${c.count} event${c.count === 1 ? "" : "s"} · ${fmtM(c.premium)} premium · ${volStr} vol`}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: sp(4),
                              padding: sp("4px 6px"),
                              background: `${cpColor}08`,
                              border: `1px solid ${cpColor}30`,
                              borderLeft: `2px solid ${cpColor}`,
                              borderRadius: dim(2),
                              cursor: "pointer",
                              transition: "background 0.1s, transform 0.1s",
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.background = `${cpColor}16`;
                              e.currentTarget.style.transform =
                                "translateY(-1px)";
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.background = `${cpColor}08`;
                              e.currentTarget.style.transform = "translateY(0)";
                            }}
                          >
                            <span
                              style={{
                                fontSize: fs(10),
                                fontWeight: 800,
                                fontFamily: T.mono,
                                color: cpColor,
                                lineHeight: 1,
                              }}
                            >
                              {c.cp}
                              {c.strike}
                            </span>
                            <div
                              style={{
                                flex: 1,
                                display: "flex",
                                justifyContent: "space-between",
                                fontSize: fs(8),
                                fontFamily: T.mono,
                                color: T.textDim,
                                lineHeight: 1,
                              }}
                            >
                              <span>{volStr}</span>
                              <span>{c.dte}d</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </Card>
        </div>

        {/* ── ROW 2B: Flow Analytics (Clock + Sector + DTE) ── */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: 6,
          }}
        >
          {/* Flow Clock */}
          <div
            style={{
              background: T.bg2,
              border: `1px solid ${T.border}`,
              borderRadius: dim(6),
              padding: "6px 10px",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 4,
              }}
            >
              <span
                style={{
                  fontSize: fs(10),
                  fontWeight: 700,
                  fontFamily: T.display,
                  color: T.textSec,
                }}
              >
                Flow Clock
              </span>
              <span
                style={{
                  fontSize: fs(8),
                  color: T.textDim,
                  fontFamily: T.mono,
                }}
              >
                Activity by time
              </span>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "flex-end",
                gap: sp(2),
                height: dim(72),
                padding: "0 2px",
              }}
            >
              {flowClock.map((bucket, i) => {
                const maxCount = Math.max(...flowClock.map((b) => b.count), 1);
                const heightPct = (bucket.count / maxCount) * 100;
                const color =
                  bucket.prem > 1500000
                    ? T.amber
                    : bucket.prem > 1000000
                      ? T.accent
                      : T.textDim;
                return (
                  <div
                    key={i}
                    style={{
                      flex: 1,
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "flex-end",
                      height: "100%",
                    }}
                  >
                    <div
                      style={{
                        height: `${heightPct}%`,
                        background: color,
                        borderRadius: "2px 2px 0 0",
                        minHeight: 2,
                        opacity: 0.85,
                      }}
                    />
                  </div>
                );
              })}
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: fs(7),
                color: T.textMuted,
                fontFamily: T.mono,
                marginTop: sp(2),
                padding: "0 2px",
              }}
            >
              <span>9:30</span>
              <span>12:00</span>
              <span>16:00</span>
            </div>
            <div
              style={{
                marginTop: sp(2),
                padding: sp("3px 6px"),
                background: T.bg3,
                borderRadius: dim(3),
                fontSize: fs(8),
                fontFamily: T.mono,
                color: T.textDim,
                display: "flex",
                justifyContent: "space-between",
              }}
            >
              <span>
                Peak:{" "}
                <span style={{ color: T.amber, fontWeight: 600 }}>
                  {flowClockPeak}
                </span>
              </span>
              <span>
                Avg:{" "}
                <span style={{ color: T.textSec, fontWeight: 600 }}>
                  {flowClockAverage} / 30min
                </span>
              </span>
            </div>
          </div>

          {/* Order Flow Distribution — moved from Market tab where it was cramped */}
          <div
            style={{
              background: T.bg2,
              border: `1px solid ${T.border}`,
              borderRadius: dim(6),
              padding: "6px 10px",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 4,
              }}
            >
              <span
                style={{
                  fontSize: fs(10),
                  fontWeight: 700,
                  fontFamily: T.display,
                  color: T.textSec,
                }}
              >
                Order Flow
              </span>
              <span
                style={{
                  fontSize: fs(8),
                  color: T.textDim,
                  fontFamily: T.mono,
                }}
              >
                $M · by trade size
              </span>
            </div>
            {(() => {
              const buy =
                marketOrderFlow.buyXL +
                marketOrderFlow.buyL +
                marketOrderFlow.buyM +
                marketOrderFlow.buyS;
              const sell =
                marketOrderFlow.sellXL +
                marketOrderFlow.sellL +
                marketOrderFlow.sellM +
                marketOrderFlow.sellS;
              const buyPct = (buy / (buy + sell)) * 100;
              const max = Math.max(
                marketOrderFlow.buyXL,
                marketOrderFlow.buyL,
                marketOrderFlow.buyM,
                marketOrderFlow.buyS,
                marketOrderFlow.sellXL,
                marketOrderFlow.sellL,
                marketOrderFlow.sellM,
                marketOrderFlow.sellS,
                1,
              );
              return (
                <>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: sp(8),
                      marginBottom: sp(2),
                    }}
                  >
                    <OrderFlowDonut
                      flow={marketOrderFlow}
                      size={dim(64)}
                      thickness={dim(10)}
                    />
                    <div
                      style={{
                        flex: 1,
                        display: "flex",
                        flexDirection: "column",
                        gap: sp(2),
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          fontFamily: T.mono,
                          fontSize: fs(10),
                        }}
                      >
                        <span style={{ color: T.green, fontWeight: 700 }}>
                          ${buy.toFixed(0)}M
                        </span>
                        <span style={{ color: T.red, fontWeight: 700 }}>
                          ${sell.toFixed(0)}M
                        </span>
                      </div>
                      <div
                        style={{
                          display: "flex",
                          height: dim(4),
                          borderRadius: dim(2),
                          overflow: "hidden",
                          background: T.bg3,
                        }}
                      >
                        <div
                          style={{
                            width: `${buyPct}%`,
                            background: T.green,
                            opacity: 0.85,
                          }}
                        />
                        <div
                          style={{
                            width: `${100 - buyPct}%`,
                            background: T.red,
                            opacity: 0.85,
                          }}
                        />
                      </div>
                      <div
                        style={{
                          fontSize: fs(8),
                          color: T.textDim,
                          fontFamily: T.mono,
                        }}
                      >
                        {buyPct.toFixed(1)}% buy ·{" "}
                        <span
                          style={{
                            color: buy >= sell ? T.green : T.red,
                            fontWeight: 600,
                          }}
                        >
                          {buy >= sell ? "BULLISH" : "BEARISH"}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div
                    style={{
                      borderTop: `1px solid ${T.border}`,
                      paddingTop: sp(2),
                    }}
                  >
                    <SizeBucketRow
                      label="XL"
                      buy={marketOrderFlow.buyXL}
                      sell={marketOrderFlow.sellXL}
                      maxValue={max}
                    />
                    <SizeBucketRow
                      label="L"
                      buy={marketOrderFlow.buyL}
                      sell={marketOrderFlow.sellL}
                      maxValue={max}
                    />
                    <SizeBucketRow
                      label="M"
                      buy={marketOrderFlow.buyM}
                      sell={marketOrderFlow.sellM}
                      maxValue={max}
                    />
                    <SizeBucketRow
                      label="S"
                      buy={marketOrderFlow.buyS}
                      sell={marketOrderFlow.sellS}
                      maxValue={max}
                    />
                  </div>
                </>
              );
            })()}
          </div>

          {/* DTE Buckets */}
          <div
            style={{
              background: T.bg2,
              border: `1px solid ${T.border}`,
              borderRadius: dim(6),
              padding: "6px 10px",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 4,
              }}
            >
              <span
                style={{
                  fontSize: fs(10),
                  fontWeight: 700,
                  fontFamily: T.display,
                  color: T.textSec,
                }}
              >
                Expiration Buckets
              </span>
              <span
                style={{
                  fontSize: fs(8),
                  color: T.textDim,
                  fontFamily: T.mono,
                }}
              >
                C vs P premium
              </span>
            </div>
            <div>
              {dteBuckets.map((b, i) => {
                const total = b.calls + b.puts;
                const callPct = (b.calls / total) * 100;
                const maxTotal = Math.max(
                  1,
                  ...dteBuckets.map((x) => x.calls + x.puts),
                );
                const barWidth = (total / maxTotal) * 100;
                return (
                  <div key={i} style={{ marginBottom: 2 }}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        fontSize: fs(8),
                        fontFamily: T.mono,
                        marginBottom: 1,
                      }}
                    >
                      <span style={{ color: T.textSec, fontWeight: 600 }}>
                        {b.bucket === "0DTE" && (
                          <span style={{ color: T.amber, marginRight: 3 }}>
                            ⚡
                          </span>
                        )}
                        {b.bucket}
                      </span>
                      <span style={{ color: T.textDim }}>
                        {b.count} events · {fmtM(total)}
                      </span>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        height: dim(7),
                        borderRadius: dim(2),
                        overflow: "hidden",
                        background: T.bg3,
                        width: `${barWidth}%`,
                      }}
                    >
                      <div
                        style={{
                          width: `${callPct}%`,
                          background: T.green,
                          opacity: 0.85,
                        }}
                      />
                      <div
                        style={{ flex: 1, background: T.red, opacity: 0.85 }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* ── ROW 2C: Top Activity Spotlight (hidden when contract detail is up) ── */}
        {!selectedEvt && (
          <div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: sp(6),
                marginBottom: sp(4),
                padding: "0 2px",
              }}
            >
              <span
                style={{
                  fontSize: fs(10),
                  fontWeight: 700,
                  fontFamily: T.display,
                  color: T.textSec,
                  letterSpacing: "0.02em",
                }}
              >
                Top Activity Today
              </span>
              <div style={{ flex: 1, height: dim(1), background: T.border }} />
              <span
                style={{
                  fontSize: fs(8),
                  color: T.textDim,
                  fontFamily: T.mono,
                }}
              >
                sorted by premium
              </span>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, 1fr)",
                gap: 6,
              }}
            >
              {[...flowEvents]
                .sort((a, b) => b.premium - a.premium)
                .slice(0, 4)
                .map((evt) => {
                  const sideColor =
                    evt.side === "BUY"
                      ? T.green
                      : evt.side === "SELL"
                        ? T.red
                        : T.textDim;
                  const cpColor = evt.cp === "C" ? T.green : T.red;
                  const typeColor =
                    evt.type === "SWEEP"
                      ? T.amber
                      : evt.type === "BLOCK"
                        ? T.accent
                        : T.purple;
                  const scoreColor =
                    evt.score >= 80
                      ? T.amber
                      : evt.score >= 60
                        ? T.green
                        : T.textDim;
                  const context =
                    evt.basis === "snapshot"
                      ? "Snapshot-derived option activity"
                      : evt.golden
                        ? "Golden sweep · High conviction"
                        : evt.type === "BLOCK"
                      ? "Institutional block · Off-exchange"
                      : evt.type === "SWEEP"
                        ? "Aggressive multi-exchange sweep"
                        : evt.type === "SPLIT"
                          ? "Split fill · Multiple prices"
                          : "Multi-leg strategy";
                  return (
                    <div
                      key={evt.id}
                      onClick={() =>
                        setSelectedEvt((prev) =>
                          prev && prev.id === evt.id ? null : evt,
                        )
                      }
                      style={{
                        background: T.bg2,
                        border: `1px solid ${evt.golden ? T.amber : T.border}`,
                        borderRadius: dim(6),
                        padding: sp("6px 10px"),
                        borderLeft: `3px solid ${evt.golden ? T.amber : cpColor}`,
                        position: "relative",
                        cursor: "pointer",
                        transition: "transform 0.1s, box-shadow 0.1s",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.transform = "translateY(-1px)";
                        e.currentTarget.style.boxShadow = `0 4px 12px ${T.bg0}80`;
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.transform = "translateY(0)";
                        e.currentTarget.style.boxShadow = "none";
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "flex-start",
                          marginBottom: 3,
                        }}
                      >
                        <div>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 4,
                            }}
                          >
                            {evt.golden && (
                              <span
                                style={{ color: T.amber, fontSize: fs(11) }}
                              >
                                ★
                              </span>
                            )}
                            <span
                              style={{
                                fontSize: fs(14),
                                fontWeight: 800,
                                fontFamily: T.mono,
                                color: T.text,
                              }}
                            >
                              {evt.ticker}
                            </span>
                            <span
                              style={{
                                fontSize: fs(11),
                                fontWeight: 700,
                                fontFamily: T.mono,
                                color: cpColor,
                              }}
                            >
                              {evt.cp}
                              {evt.strike}
                            </span>
                          </div>
                          <div
                            style={{
                              fontSize: fs(8),
                              color: T.textDim,
                              fontFamily: T.mono,
                              marginTop: 1,
                            }}
                          >
                            exp {evt.dte}d · IV{" "}
                            {isFiniteNumber(evt.iv)
                              ? `${(evt.iv * 100).toFixed(1)}%`
                              : MISSING_VALUE}
                          </div>
                        </div>
                        <Badge color={scoreColor}>{evt.score}</Badge>
                      </div>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: sp(4),
                          marginBottom: 3,
                          flexWrap: "wrap",
                        }}
                      >
                        <span
                          style={{
                            fontSize: fs(18),
                            fontWeight: 800,
                            fontFamily: T.mono,
                            color: evt.premium > 400000 ? T.amber : T.text,
                          }}
                        >
                          {evt.premium >= 1e6
                            ? `$${(evt.premium / 1e6).toFixed(2)}M`
                            : `$${(evt.premium / 1e3).toFixed(0)}K`}
                        </span>
                        <Badge color={sideColor}>{evt.side}</Badge>
                        <Badge color={typeColor}>{evt.type}</Badge>
                        <Badge color={flowProviderColor(evt.provider)}>
                          {evt.sourceLabel}
                        </Badge>
                      </div>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          fontSize: fs(7),
                          color: T.textDim,
                          fontFamily: T.mono,
                          paddingTop: sp(3),
                          borderTop: `1px solid ${T.border}08`,
                        }}
                      >
                        <span>{evt.time} ET</span>
                        <span>
                          Vol {fmtCompactNumber(evt.vol)} / OI{" "}
                          {fmtCompactNumber(evt.oi)}
                        </span>
                      </div>
                      <div
                        style={{
                          fontSize: fs(7),
                          color: T.textMuted,
                          fontFamily: T.sans,
                          fontStyle: "italic",
                          marginTop: 2,
                        }}
                      >
                        {context}
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        )}

        {/* ── ROW 3a: Saved Scans bar (only renders if user has saved any) ── */}
        {savedScans.length > 0 && (
          <div
            style={{
              display: "flex",
              gap: sp(4),
              alignItems: "center",
              flexWrap: "wrap",
              padding: "2px 0",
            }}
          >
            <span
              style={{
                fontSize: fs(8),
                fontWeight: 700,
                color: T.textMuted,
                letterSpacing: "0.08em",
                marginRight: 2,
              }}
            >
              SAVED
            </span>
            {savedScans.map((scan) => (
              <div
                key={scan.id}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: sp(3),
                  padding: sp("3px 6px 3px 8px"),
                  borderRadius: 0,
                  background:
                    activeScanId === scan.id ? `${T.accent}20` : T.bg2,
                  border: `1px solid ${activeScanId === scan.id ? T.accent : T.border}`,
                  cursor: "pointer",
                  transition:
                    "background 0.12s ease, border-color 0.12s ease, transform 0.12s ease",
                }}
                onClick={() => loadScan(scan)}
                onMouseEnter={(event) => {
                  if (activeScanId !== scan.id) {
                    event.currentTarget.style.background = T.bg3;
                    event.currentTarget.style.borderColor = T.textMuted;
                  }
                  event.currentTarget.style.transform = "translateY(-1px)";
                }}
                onMouseLeave={(event) => {
                  event.currentTarget.style.background =
                    activeScanId === scan.id ? `${T.accent}20` : T.bg2;
                  event.currentTarget.style.borderColor =
                    activeScanId === scan.id ? T.accent : T.border;
                  event.currentTarget.style.transform = "translateY(0)";
                }}
                title={`${scan.name} · ${scan.filter} · min ${scan.minPrem} · sort ${scan.sortBy}`}
              >
                <span
                  style={{
                    fontSize: fs(9),
                    fontWeight: 600,
                    color: activeScanId === scan.id ? T.accent : T.textSec,
                    fontFamily: T.sans,
                  }}
                >
                  {scan.name}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteScan(scan.id);
                  }}
                  title="Delete scan"
                  style={{
                    background: "transparent",
                    border: "none",
                    color: T.textMuted,
                    cursor: "pointer",
                    fontSize: fs(11),
                    padding: 0,
                    lineHeight: 1,
                  }}
                >
                  ×
                </button>
              </div>
            ))}
            <span style={{ flex: 1 }} />
            <span
              style={{ fontSize: fs(8), color: T.textDim, fontFamily: T.mono }}
            >
              {savedScans.length} of 8
            </span>
          </div>
        )}

        {/* ── ROW 3: Filter Bar ── */}
        <div
          style={{
            display: "flex",
            gap: sp(4),
            alignItems: "center",
            flexWrap: "wrap",
            padding: "2px 0",
          }}
        >
          <span
            style={{
              fontSize: fs(7),
              fontWeight: 600,
              color: T.textDim,
              letterSpacing: "0.06em",
              fontVariant: "all-small-caps",
            }}
          >
            Type
          </span>
          {[
            ["all", "All"],
            ["calls", "Calls"],
            ["puts", "Puts"],
            ["golden", "★ Golden"],
            ["sweep", "Sweep"],
            ["block", "Block"],
            ["cluster", "🔁 Cluster"],
          ].map(([k, l]) => (
            <Pill
              key={k}
              active={filter === k}
              onClick={() => {
                setFilter(k);
                setActiveScanId(null);
              }}
              color={
                k === "golden" ? T.amber : k === "cluster" ? T.cyan : undefined
              }
            >
              {l}
            </Pill>
          ))}
          <div
            style={{
              width: dim(1),
              height: dim(16),
              background: T.border,
              margin: "0 2px",
            }}
          />
          <span
            style={{
              fontSize: fs(7),
              fontWeight: 600,
              color: T.textDim,
              letterSpacing: "0.06em",
              fontVariant: "all-small-caps",
            }}
          >
            Min $
          </span>
          {[
            [0, "All"],
            [50000, "$50K"],
            [100000, "$100K"],
            [250000, "$250K"],
          ].map(([v, l]) => (
            <Pill
              key={v}
              active={minPrem === v}
              onClick={() => {
                setMinPrem(v);
                setActiveScanId(null);
              }}
            >
              {l}
            </Pill>
          ))}
          <div
            style={{
              width: dim(1),
              height: dim(16),
              background: T.border,
              margin: "0 2px",
            }}
          />
          <span
            style={{
              fontSize: fs(7),
              fontWeight: 600,
              color: T.textDim,
              letterSpacing: "0.06em",
              fontVariant: "all-small-caps",
            }}
          >
            Sort
          </span>
          {[
            ["time", "Time"],
            ["premium", "Premium"],
            ["score", "Score"],
          ].map(([k, l]) => (
            <Pill
              key={k}
              active={sortBy === k}
              onClick={() => {
                setSortBy(k);
                setActiveScanId(null);
              }}
            >
              {l}
            </Pill>
          ))}
          <div
            style={{
              width: dim(1),
              height: dim(16),
              background: T.border,
              margin: "0 2px",
            }}
          />
          <button
            onClick={saveCurrentScan}
            title="Save current filter as a named scan"
            style={{
              padding: sp("3px 7px"),
              fontSize: fs(10),
              fontWeight: 600,
              fontFamily: T.sans,
              background: "transparent",
              color: T.accent,
              border: `1px solid ${T.accent}`,
              borderRadius: 0,
              cursor: "pointer",
              transition: "background 0.12s ease, color 0.12s ease",
            }}
            onMouseEnter={(event) => {
              event.currentTarget.style.background = `${T.accent}14`;
            }}
            onMouseLeave={(event) => {
              event.currentTarget.style.background = "transparent";
            }}
          >
            + Save
          </button>
          <span style={{ flex: 1 }} />
          <span
            style={{ fontSize: fs(9), color: T.textDim, fontFamily: T.mono }}
          >
            {filtered.length} / {flowEvents.length}
          </span>
        </div>

        {/* ── ROW 4: Flow Tape (default) or Contract Detail (when a contract is selected) ── */}
        {selectedEvt ? (
          <ContractDetailInline
            evt={selectedEvt}
            onBack={() => setSelectedEvt(null)}
            onJumpToTrade={(evt) => {
              setSelectedEvt(null);
              onJumpToTrade && onJumpToTrade(evt);
            }}
          />
        ) : (
          <Card
            noPad
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              minHeight: 300,
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns:
                  "48px 40px 40px 60px 130px 52px 72px 56px 56px 48px 52px 42px",
                padding: sp("6px 10px"),
                fontSize: fs(8),
                fontWeight: 700,
                color: T.textMuted,
                letterSpacing: "0.08em",
                borderBottom: `1px solid ${T.border}`,
                gap: sp(3),
                flexShrink: 0,
              }}
            >
              <span>TIME</span>
              <span>SIDE</span>
              <span>TYPE</span>
              <span>TICK</span>
              <span>CONTRACT</span>
              <span style={{ textAlign: "right" }}>DTE</span>
              <span style={{ textAlign: "right" }}>PREMIUM</span>
              <span style={{ textAlign: "right" }}>VOL</span>
              <span style={{ textAlign: "right" }}>OI</span>
              <span style={{ textAlign: "right" }}>V/OI</span>
              <span style={{ textAlign: "right" }}>IV</span>
              <span style={{ textAlign: "center" }}>SCORE</span>
            </div>

            <div style={{ flex: 1, overflowY: "auto" }}>
              {filtered.map((evt) => {
                const sideColor =
                  evt.side === "BUY"
                    ? T.green
                    : evt.side === "SELL"
                      ? T.red
                      : T.textDim;
                const cpColor = evt.cp === "C" ? T.green : T.red;
                const premStr =
                  evt.premium >= 1e6
                    ? `$${(evt.premium / 1e6).toFixed(2)}M`
                    : `$${(evt.premium / 1e3).toFixed(0)}K`;
                const voi =
                  isFiniteNumber(evt.vol) && isFiniteNumber(evt.oi) && evt.oi > 0
                    ? evt.vol / evt.oi
                    : null;
                const scoreColor =
                  evt.score >= 80
                    ? T.amber
                    : evt.score >= 60
                      ? T.green
                      : T.textDim;
                const typeColor =
                  evt.type === "SWEEP"
                    ? T.amber
                    : evt.type === "BLOCK"
                      ? T.accent
                      : T.purple;
                return (
                  <div
                    key={evt.id}
                    onClick={() =>
                      setSelectedEvt((prev) =>
                        prev && prev.id === evt.id ? null : evt,
                      )
                    }
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        "48px 40px 40px 60px 130px 52px 72px 56px 56px 48px 52px 42px",
                      padding: sp("5px 10px"),
                      fontSize: fs(10),
                      fontFamily: T.mono,
                      gap: sp(3),
                      alignItems: "center",
                      borderBottom: `1px solid ${T.border}08`,
                      background: evt.golden ? `${T.amber}10` : "transparent",
                      borderLeft: evt.golden
                        ? `2px solid ${T.amber}`
                        : "2px solid transparent",
                      cursor: "pointer",
                      transition: "background 0.1s",
                    }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.background = evt.golden
                        ? `${T.amber}18`
                        : T.bg3)
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background = evt.golden
                        ? `${T.amber}10`
                        : "transparent")
                    }
                  >
                    <span style={{ color: T.textDim }}>{evt.time}</span>
                    <Badge color={sideColor}>{evt.side}</Badge>
                    <Badge color={typeColor}>{evt.type}</Badge>
                    <span
                      style={{
                        fontWeight: 700,
                        color: T.text,
                        display: "flex",
                        alignItems: "center",
                        gap: 3,
                      }}
                    >
                      {evt.golden && (
                        <span style={{ color: T.amber, fontSize: fs(10) }}>
                          ★
                        </span>
                      )}
                      {evt.ticker}
                    </span>
                    <span
                      style={{
                        color: T.textSec,
                        display: "flex",
                        alignItems: "center",
                        gap: sp(3),
                      }}
                    >
                      <span
                        style={{
                          color: cpColor,
                          fontWeight: 600,
                          marginRight: 2,
                        }}
                      >
                        {evt.cp}
                      </span>
                      {evt.strike}{" "}
                      <span style={{ color: T.textDim }}>
                        {formatExpirationLabel(evt.expirationDate)}
                      </span>
                      {(() => {
                        const c = clusterFor(evt);
                        if (!c) return null;
                        return (
                          <span
                            title={`${c.count} events on this contract today · total $${(c.totalPrem / 1e6).toFixed(2)}M`}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 1,
                              padding: sp("0px 4px"),
                              borderRadius: dim(2),
                              background: `${T.cyan}20`,
                              border: `1px solid ${T.cyan}50`,
                              color: T.cyan,
                              fontWeight: 700,
                              fontSize: fs(8),
                              fontFamily: T.mono,
                              marginLeft: sp(2),
                            }}
                          >
                            🔁 {c.count}×
                          </span>
                        );
                      })()}
                      <Badge color={flowProviderColor(evt.provider)}>
                        {evt.sourceLabel}
                      </Badge>
                    </span>
                    <span style={{ textAlign: "right", color: T.textDim }}>
                      {evt.dte}d
                    </span>
                    <span
                      style={{
                        textAlign: "right",
                        fontWeight: 700,
                        color:
                          evt.premium > 250000
                            ? T.amber
                            : evt.premium > 100000
                              ? T.text
                              : T.textSec,
                      }}
                    >
                      {premStr}
                    </span>
                    <span style={{ textAlign: "right", color: T.textSec }}>
                      {fmtCompactNumber(evt.vol)}
                    </span>
                    <span style={{ textAlign: "right", color: T.textDim }}>
                      {fmtCompactNumber(evt.oi)}
                    </span>
                    <span
                      style={{
                        textAlign: "right",
                        color: isFiniteNumber(voi) && voi > 1 ? T.amber : T.textDim,
                        fontWeight: isFiniteNumber(voi) && voi > 1 ? 600 : 400,
                      }}
                    >
                      {isFiniteNumber(voi) ? voi.toFixed(2) : MISSING_VALUE}
                    </span>
                    <span style={{ textAlign: "right", color: T.textDim }}>
                      {isFiniteNumber(evt.iv)
                        ? `${(evt.iv * 100).toFixed(1)}%`
                        : MISSING_VALUE}
                    </span>
                    <span style={{ textAlign: "center" }}>
                      <Badge color={scoreColor}>{evt.score}</Badge>
                    </span>
                  </div>
                );
              })}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════
// SCREEN: TRADE
// ═══════════════════════════════════════════════════════════════════

// ─── Trade tab sub-components ───

const TRADE_TIMEFRAMES = [
  { v: "1m", bars: 390, tag: "1m" },
  { v: "5m", bars: 312, tag: "5m" },
  { v: "15m", bars: 260, tag: "15m" },
  { v: "1h", bars: 220, tag: "1h" },
];

// Custom SVG candlestick chart (Recharts has no native candle component).
// Renders OHLC candles with wicks, Y-axis price labels, day-open ref line,
// flow markers as vertical dashed lines, optional drawing layer (horizontal levels),
// and a crosshair with price label on hover.
const CandleChart = ({
  bars,
  markers,
  drawings,
  onAddDrawing,
  drawMode,
  height,
}) => {
  const w = 800;
  const H = height || 240;
  const padL = 38,
    padR = 8,
    padT = 6,
    padB = 16;
  const chartW = w - padL - padR;
  const chartH = H - padT - padB;

  const lo = Math.min(...bars.map((b) => b.l));
  const hi = Math.max(...bars.map((b) => b.h));
  const range = hi - lo;
  const pad = range * 0.05;
  const yMin = lo - pad,
    yMax = hi + pad;
  const yScale = (p) => padT + chartH - ((p - yMin) / (yMax - yMin)) * chartH;
  const xScale = (i) => padL + (i / (bars.length - 1)) * chartW;
  const candleW = Math.max(2, (chartW / bars.length) * 0.7);

  const [hover, setHover] = useState(null);
  const svgRef = useRef(null);

  const handleMouseMove = (e) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const sx = ((e.clientX - rect.left) / rect.width) * w;
    const sy = ((e.clientY - rect.top) / rect.height) * H;
    if (sx < padL || sx > w - padR) {
      setHover(null);
      return;
    }
    const i = Math.round(((sx - padL) / chartW) * (bars.length - 1));
    const idx = Math.max(0, Math.min(bars.length - 1, i));
    const price = yMin + ((padT + chartH - sy) / chartH) * (yMax - yMin);
    setHover({ idx, sx, sy, price });
  };
  const handleMouseLeave = () => setHover(null);

  const handleClick = (e) => {
    if (!drawMode || !onAddDrawing) return;
    e.stopPropagation();
    if (hover) {
      onAddDrawing({ type: drawMode, price: hover.price, barIdx: hover.idx });
    }
  };

  const yTicks = [];
  for (let t = 0; t < 5; t++) {
    yTicks.push(yMin + ((yMax - yMin) * t) / 4);
  }
  const dayOpen = bars[0]?.o;

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${w} ${H}`}
        preserveAspectRatio="none"
        style={{
          width: "100%",
          height: "100%",
          display: "block",
          cursor: drawMode ? "crosshair" : "default",
        }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
      >
        {/* Y-axis grid + labels */}
        {yTicks.flatMap((p, i) => [
          <line
            key={`yg${i}`}
            x1={padL}
            y1={yScale(p)}
            x2={w - padR}
            y2={yScale(p)}
            stroke={T.border}
            strokeWidth={0.5}
            strokeOpacity={0.5}
          />,
          <text
            key={`yt${i}`}
            x={padL - 4}
            y={yScale(p) + 3}
            fill={T.textMuted}
            fontSize={9}
            fontFamily={T.mono}
            textAnchor="end"
          >
            {p.toFixed(2)}
          </text>,
        ])}
        {/* Day open ref line */}
        <line
          x1={padL}
          y1={yScale(dayOpen)}
          x2={w - padR}
          y2={yScale(dayOpen)}
          stroke={T.textMuted}
          strokeWidth={0.5}
          strokeDasharray="2 2"
        />
        {/* Flow markers (vertical) */}
        {(markers || []).map((m, i) => (
          <line
            key={`mk${i}`}
            x1={xScale(m.barIdx)}
            y1={padT}
            x2={xScale(m.barIdx)}
            y2={padT + chartH}
            stroke={m.cp === "C" ? T.green : T.red}
            strokeWidth={m.golden ? 1.5 : m.size === "lg" ? 1 : 0.6}
            strokeDasharray={m.golden ? "0" : m.size === "sm" ? "2 3" : "3 2"}
            strokeOpacity={m.golden ? 0.85 : m.size === "lg" ? 0.6 : 0.35}
          />
        ))}
        {/* Candles (wick + body, two elements per bar) */}
        {bars.flatMap((b, i) => {
          const up = b.c >= b.o;
          const c = up ? T.green : T.red;
          const x = xScale(i);
          const bodyTop = yScale(Math.max(b.o, b.c));
          const bodyBot = yScale(Math.min(b.o, b.c));
          return [
            <line
              key={`cw${i}`}
              x1={x}
              y1={yScale(b.h)}
              x2={x}
              y2={yScale(b.l)}
              stroke={c}
              strokeWidth={1}
            />,
            <rect
              key={`cb${i}`}
              x={x - candleW / 2}
              y={bodyTop}
              width={candleW}
              height={Math.max(1, bodyBot - bodyTop)}
              fill={c}
              stroke={c}
              strokeWidth={0.5}
            />,
          ];
        })}
        {/* Drawings (horizontal levels) */}
        {(drawings || []).map((d, i) =>
          d.type === "horizontal" ? (
            <line
              key={`dr${i}`}
              x1={padL}
              y1={yScale(d.price)}
              x2={w - padR}
              y2={yScale(d.price)}
              stroke={T.amber}
              strokeWidth={1.2}
              strokeDasharray="5 3"
            />
          ) : null,
        )}
        {/* Crosshair */}
        {hover && [
          <line
            key="chx"
            x1={hover.sx}
            y1={padT}
            x2={hover.sx}
            y2={padT + chartH}
            stroke={T.textSec}
            strokeWidth={0.5}
            strokeDasharray="3 3"
          />,
          <line
            key="chy"
            x1={padL}
            y1={hover.sy}
            x2={w - padR}
            y2={hover.sy}
            stroke={T.textSec}
            strokeWidth={0.5}
            strokeDasharray="3 3"
          />,
          <rect
            key="chr"
            x={w - padR - 50}
            y={hover.sy - 8}
            width={48}
            height={16}
            fill={T.bg4}
            stroke={T.border}
          />,
          <text
            key="cht"
            x={w - padR - 4}
            y={hover.sy + 3}
            fill={T.text}
            fontSize={9}
            fontFamily={T.mono}
            textAnchor="end"
            fontWeight={600}
          >
            {hover.price.toFixed(2)}
          </text>,
        ]}
      </svg>
      {/* OHLCV tooltip */}
      {hover && bars[hover.idx] && (
        <div
          style={{
            position: "absolute",
            top: 4,
            left: padL + 4,
            background: `${T.bg4}ee`,
            border: `1px solid ${T.border}`,
            borderRadius: dim(3),
            padding: sp("3px 8px"),
            fontSize: fs(9),
            fontFamily: T.mono,
            color: T.textSec,
            pointerEvents: "none",
            display: "flex",
            gap: sp(6),
          }}
        >
          <span>
            O{" "}
            <span style={{ color: T.text }}>
              {bars[hover.idx].o.toFixed(2)}
            </span>
          </span>
          <span>
            H{" "}
            <span style={{ color: T.green }}>
              {bars[hover.idx].h.toFixed(2)}
            </span>
          </span>
          <span>
            L{" "}
            <span style={{ color: T.red }}>{bars[hover.idx].l.toFixed(2)}</span>
          </span>
          <span>
            C{" "}
            <span style={{ color: T.text, fontWeight: 600 }}>
              {bars[hover.idx].c.toFixed(2)}
            </span>
          </span>
        </div>
      )}
    </div>
  );
};

const TradeOptionChart = ({
  bars,
  color,
  contract,
  holding,
  timeframe = "5m",
  sourceLabel = "no live chart data",
  onChangeTimeframe,
}) => {
  const { studies: availableStudies, indicatorRegistry } =
    useIndicatorLibrary();
  const [selectedIndicators, setSelectedIndicators] = useState(() =>
    resolvePersistedIndicatorPreset({
      indicators: _initialState.tradeOptionSelectedIndicators,
      defaults: DEFAULT_TRADE_OPTION_STUDIES,
      persistedVersion: _initialState.tradeOptionIndicatorPresetVersion,
      currentVersion: TRADE_OPTION_INDICATOR_PRESET_VERSION,
    }),
  );
  const [rayReplicaSettings, setRayReplicaSettings] = useState(() =>
    resolvePersistedRayReplicaSettings(_initialState.tradeOptionRayReplicaSettings),
  );
  const indicatorSettings = useMemo(
    () => buildRayReplicaIndicatorSettings(rayReplicaSettings),
    [rayReplicaSettings],
  );
  const chartModel = useMemo(
    () =>
      buildResearchChartModel({
        bars,
        timeframe,
        selectedIndicators,
        indicatorSettings,
        indicatorRegistry,
      }),
    [bars, indicatorRegistry, indicatorSettings, selectedIndicators, timeframe],
  );
  const referenceLines = useMemo(
    () =>
      Number.isFinite(holding?.entry)
        ? [
            {
              price: holding.entry,
              color: T.amber,
              title: "ENTRY",
              lineWidth: 2,
              axisLabelVisible: true,
            },
          ]
        : [],
    [holding],
  );
  const latestBar = bars[bars.length - 1];
  const previousClose =
    bars.length > 1 ? (bars[bars.length - 2]?.c ?? null) : null;
  const lastPrice = latestBar?.c ?? bars[bars.length - 1]?.p ?? null;
  const changePercent =
    Number.isFinite(lastPrice) &&
    Number.isFinite(previousClose) &&
    previousClose !== 0
      ? ((lastPrice - previousClose) / previousClose) * 100
      : null;
  const toggleIndicator = (indicatorId) => {
    setSelectedIndicators((current) =>
      current.includes(indicatorId)
        ? current.filter((value) => value !== indicatorId)
        : [...current, indicatorId],
    );
  };

  useEffect(() => {
    persistState({
      tradeOptionSelectedIndicators: selectedIndicators,
      tradeOptionIndicatorPresetVersion: TRADE_OPTION_INDICATOR_PRESET_VERSION,
    });
  }, [selectedIndicators]);

  useEffect(() => {
    persistState({ tradeOptionRayReplicaSettings: rayReplicaSettings });
  }, [rayReplicaSettings]);

  return (
    <ResearchChartFrame
      theme={T}
      themeKey={`${CURRENT_THEME}-trade-option`}
      model={chartModel}
      referenceLines={referenceLines}
      showSurfaceToolbar={false}
      showLegend={false}
      surfaceTopOverlay={(controls) => (
        <ResearchChartWidgetHeader
          theme={T}
          controls={controls}
          symbol={contract}
          name={holding ? "Held option contract" : "Option contract"}
          price={lastPrice}
          changePercent={changePercent}
          statusLabel={sourceLabel}
          timeframe={timeframe}
          timeframeOptions={TRADE_TIMEFRAMES.map((entry) => ({
            value: entry.v,
            label: entry.tag,
          }))}
          onChangeTimeframe={onChangeTimeframe}
          studies={availableStudies}
          selectedStudies={selectedIndicators}
          studySpecs={chartModel.studySpecs}
          onToggleStudy={toggleIndicator}
          meta={{
            open: latestBar?.o,
            high: latestBar?.h,
            low: latestBar?.l,
            close: latestBar?.c,
            volume: latestBar?.v,
            timestamp: latestBar?.ts,
            sourceLabel,
          }}
          rightSlot={
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: sp(6),
              }}
            >
              {holding ? (
                <span
                  style={{
                    fontSize: fs(7),
                    padding: sp("1px 4px"),
                    borderRadius: dim(2),
                    background: `${T.amber}20`,
                    color: T.amber,
                    border: `1px solid ${T.amber}40`,
                    fontWeight: 700,
                    letterSpacing: "0.05em",
                  }}
                >
                  ★ HOLDING
                </span>
              ) : null}
              <RayReplicaSettingsMenu
                theme={T}
                settings={rayReplicaSettings}
                onChange={setRayReplicaSettings}
                disabled={!isRayReplicaIndicatorSelected(selectedIndicators)}
              />
            </div>
          }
        />
      )}
      surfaceTopOverlayHeight={40}
      surfaceBottomOverlay={(controls) => (
        <ResearchChartWidgetFooter
          theme={T}
          controls={controls}
          studies={availableStudies}
          selectedStudies={selectedIndicators}
          studySpecs={chartModel.studySpecs}
          onToggleStudy={toggleIndicator}
          statusText={sourceLabel}
        />
      )}
      surfaceBottomOverlayHeight={22}
    />
  );
};

const TradeOptionsChain = ({ chain, selected, onSelect, heldStrikes }) => {
  const scrollRef = useRef(null);
  const gridTemplateColumns =
    "48px 48px 52px 48px 56px 60px 60px 68px 72px 68px 60px 60px 56px 48px 52px 48px 48px";
  const chainWindowKey = `${chain.length}:${chain[0]?.k ?? "na"}:${chain[chain.length - 1]?.k ?? "na"}`;

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return undefined;

    const frame = requestAnimationFrame(() => {
      node.scrollLeft = Math.max(0, (node.scrollWidth - node.clientWidth) / 2);
    });

    return () => cancelAnimationFrame(frame);
  }, [chainWindowKey]);

  const formatGreek = (value) =>
    value == null || Number.isNaN(value) ? MISSING_VALUE : value.toFixed(3);
  const formatIv = (value) =>
    value == null || Number.isNaN(value)
      ? MISSING_VALUE
      : `${(value * 100).toFixed(1)}%`;
  const formatPrice = (value, held) =>
    value == null || Number.isNaN(value)
      ? MISSING_VALUE
      : `${held ? "★ " : ""}${value.toFixed(2)}`;
  const formatVolume = (value, hot) =>
    value == null || Number.isNaN(value)
      ? MISSING_VALUE
      : `${hot ? "⚡" : ""}${fmtCompactNumber(value)}`;
  const columns = [
    {
      key: "cGamma",
      label: "Γ",
      side: "C",
      align: "right",
      color: T.purple,
      format: formatGreek,
    },
    {
      key: "cTheta",
      label: "Θ",
      side: "C",
      align: "right",
      color: T.red,
      format: formatGreek,
    },
    {
      key: "cVega",
      label: "V",
      side: "C",
      align: "right",
      color: T.cyan,
      format: formatGreek,
    },
    {
      key: "cDelta",
      label: "Δ",
      side: "C",
      align: "right",
      color: T.textSec,
      format: (value) => (value == null ? MISSING_VALUE : value.toFixed(2)),
    },
    {
      key: "cIv",
      label: "IV",
      side: "C",
      align: "right",
      color: T.textDim,
      format: formatIv,
    },
    {
      key: "cOi",
      label: "OI",
      side: "C",
      align: "right",
      color: T.textDim,
      format: (value) => fmtCompactNumber(value),
    },
    {
      key: "cVol",
      label: "VOL",
      side: "C",
      align: "right",
      color: T.textDim,
      hot: true,
      format: (value, row) =>
        formatVolume(value, row.cVol / Math.max(row.cOi, 1) > 0.5),
    },
    {
      key: "cPrem",
      label: "LAST",
      side: "C",
      align: "right",
      color: T.green,
      heldAware: true,
      format: (value, _row, held) => formatPrice(value, held),
    },
    {
      key: "k",
      label: "STRIKE",
      side: null,
      align: "center",
      strike: true,
      format: (value) => value,
    },
    {
      key: "pPrem",
      label: "LAST",
      side: "P",
      align: "left",
      color: T.red,
      heldAware: true,
      format: (value, _row, held) => formatPrice(value, held),
    },
    {
      key: "pVol",
      label: "VOL",
      side: "P",
      align: "left",
      color: T.textDim,
      hot: true,
      format: (value, row) =>
        formatVolume(value, row.pVol / Math.max(row.pOi, 1) > 0.5),
    },
    {
      key: "pOi",
      label: "OI",
      side: "P",
      align: "left",
      color: T.textDim,
      format: (value) => fmtCompactNumber(value),
    },
    {
      key: "pIv",
      label: "IV",
      side: "P",
      align: "left",
      color: T.textDim,
      format: formatIv,
    },
    {
      key: "pDelta",
      label: "Δ",
      side: "P",
      align: "left",
      color: T.textSec,
      format: (value) => (value == null ? MISSING_VALUE : value.toFixed(2)),
    },
    {
      key: "pVega",
      label: "V",
      side: "P",
      align: "left",
      color: T.cyan,
      format: formatGreek,
    },
    {
      key: "pTheta",
      label: "Θ",
      side: "P",
      align: "left",
      color: T.red,
      format: formatGreek,
    },
    {
      key: "pGamma",
      label: "Γ",
      side: "P",
      align: "left",
      color: T.purple,
      format: formatGreek,
    },
  ];

  return (
    <div
      ref={scrollRef}
      style={{
        height: "100%",
        overflow: "auto",
        fontSize: fs(9),
        fontFamily: T.mono,
        touchAction: "pan-x pan-y",
      }}
    >
      <div style={{ minWidth: 980 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns,
            gap: sp(2),
            padding: sp("3px 6px"),
            borderBottom: `1px solid ${T.border}`,
            position: "sticky",
            top: 0,
            background: T.bg2,
            zIndex: 1,
          }}
        >
          {columns.map((column) => (
            <span
              key={column.key}
              style={{
                color: T.textMuted,
                fontSize: fs(7),
                textAlign: column.align,
                letterSpacing: "0.06em",
                fontWeight: column.strike ? 700 : 600,
              }}
            >
              {column.label}
            </span>
          ))}
        </div>
        {chain.map((row) => (
          <div
            key={row.k}
            style={{
              display: "grid",
              gridTemplateColumns,
              gap: sp(2),
              padding: sp("2px 6px"),
              borderBottom: `1px solid ${T.border}10`,
              background: row.isAtm ? `${T.accent}08` : "transparent",
            }}
          >
            {columns.map((column) => {
              if (column.strike) {
                return (
                  <span
                    key={column.key}
                    style={{
                      color: row.isAtm ? T.accent : T.text,
                      fontWeight: 700,
                      textAlign: "center",
                    }}
                  >
                    {column.format(row[column.key], row, false)}
                  </span>
                );
              }

              const isSelected =
                selected &&
                selected.strike === row.k &&
                selected.cp === column.side;
              const held = Boolean(
                heldStrikes &&
                heldStrikes.find(
                  (item) => item.strike === row.k && item.cp === column.side,
                ),
              );
              const background = isSelected
                ? `${column.side === "C" ? T.green : T.red}25`
                : held && column.heldAware
                  ? `${T.amber}18`
                  : "transparent";
              const border =
                held && column.heldAware
                  ? `1px solid ${T.amber}60`
                  : "1px solid transparent";
              const value = row[column.key];

              return (
                <span
                  key={column.key}
                  onClick={() => onSelect(row.k, column.side)}
                  style={{
                    color: column.hot
                      ? (column.side === "C"
                          ? row.cVol / Math.max(row.cOi, 1)
                          : row.pVol / Math.max(row.pOi, 1)) > 0.5
                        ? T.amber
                        : column.color
                      : column.color,
                    fontWeight:
                      column.key.endsWith("Prem") || column.hot ? 600 : 500,
                    textAlign: column.align,
                    cursor: "pointer",
                    padding: sp("0 2px"),
                    background,
                    borderRadius: dim(2),
                    border,
                  }}
                >
                  {column.format(value, row, held)}
                </span>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
};

// ─── PAYOFF DIAGRAM ───
// SVG visualization of the option's P&L at expiration as a function of underlying price.
// Replaces the static breakeven/max-loss/POP grid with a payoff curve.
// Side-aware: BUY (long) vs SELL (short) flip the curve.
const PayoffDiagram = ({
  optType,
  strike,
  premium,
  qty,
  currentPrice,
  side,
}) => {
  const isCall = optType === "C";
  const isLong = side === "BUY";
  const debit = premium * qty * 100;

  // P&L at expiration for any underlying price S
  const pnl = (S) => {
    const intrinsic = isCall
      ? Math.max(0, S - strike)
      : Math.max(0, strike - S);
    const longPnl = (intrinsic - premium) * qty * 100;
    return isLong ? longPnl : -longPnl;
  };

  // X range: 25% above and below current price gives enough room for visible breakeven
  const xMin = currentPrice * 0.75;
  const xMax = currentPrice * 1.25;
  const STEPS = 80;
  const points = [];
  for (let i = 0; i <= STEPS; i++) {
    const S = xMin + (xMax - xMin) * (i / STEPS);
    points.push({ s: S, p: pnl(S) });
  }

  // Y range
  const yMax = Math.max(...points.map((p) => p.p));
  const yMin = Math.min(...points.map((p) => p.p));
  const yRange = Math.max(yMax - yMin, 1);
  const yPad = yRange * 0.18;
  const yTop = yMax + yPad;
  const yBot = yMin - yPad;

  // Breakeven price
  const breakeven = isCall ? strike + premium : strike - premium;

  // Determine if max profit/loss is theoretically capped or unlimited
  // BUY CALL: max loss = debit (capped), max profit = ∞
  // BUY PUT:  max loss = debit (capped), max profit = (strike - prem) * qty * 100 (capped)
  // SELL CALL: max profit = credit (capped), max loss = ∞
  // SELL PUT:  max profit = credit (capped), max loss = (strike - prem) * qty * 100 (capped)
  const maxProfitUnlimited =
    (isLong && isCall) || (!isLong && !isCall && false); // selling put has capped loss but profit is the credit
  const maxLossUnlimited = !isLong && isCall; // selling naked call

  const visibleMaxProfit = Math.max(...points.map((p) => p.p));
  const visibleMaxLoss = Math.min(...points.map((p) => p.p));

  // SVG dimensions
  const W = 280,
    H = 120;
  const padL = 6,
    padR = 6,
    padT = 18,
    padB = 18;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const xOf = (s) => padL + ((s - xMin) / (xMax - xMin)) * innerW;
  const yOf = (p) => padT + ((yTop - p) / (yTop - yBot)) * innerH;
  const y0 = yOf(0);

  // Split curve into segments at zero crossings, color each by sign
  const segments = [];
  let currentSeg = [];
  let currentSign = null;
  points.forEach((p) => {
    const sign = p.p >= 0 ? "+" : "-";
    if (currentSign === null) {
      currentSign = sign;
      currentSeg.push(p);
    } else if (sign === currentSign) {
      currentSeg.push(p);
    } else {
      const prev = currentSeg[currentSeg.length - 1];
      // Linear interpolation to find zero crossing
      const t = -prev.p / (p.p - prev.p);
      const crossX = prev.s + t * (p.s - prev.s);
      const crossPoint = { s: crossX, p: 0 };
      currentSeg.push(crossPoint);
      segments.push({ sign: currentSign, points: currentSeg });
      currentSeg = [crossPoint, p];
      currentSign = sign;
    }
  });
  if (currentSeg.length > 0)
    segments.push({ sign: currentSign, points: currentSeg });

  // Tick prices for the x-axis: just current and strike (those are the anchors that matter)
  const fmtMoney = (v) =>
    v >= 1000 ? `$${(v / 1000).toFixed(1)}K` : `$${Math.round(v)}`;

  return (
    <div style={{ background: T.bg3, borderRadius: dim(3), padding: sp(4) }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: sp("0 4px 2px"),
          fontSize: fs(7),
          fontFamily: T.mono,
          color: T.textMuted,
          letterSpacing: "0.06em",
        }}
      >
        <span>P&L AT EXPIRATION</span>
        <span style={{ display: "flex", gap: sp(6) }}>
          <span>
            <span style={{ color: T.accent }}>━</span> now $
            {currentPrice.toFixed(2)}
          </span>
          <span>
            <span style={{ color: T.amber }}>┃</span> strike ${strike}
          </span>
        </span>
      </div>
      <svg
        width="100%"
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
      >
        {/* Zero P&L line */}
        <line
          x1={padL}
          x2={padL + innerW}
          y1={y0}
          y2={y0}
          stroke={T.textMuted}
          strokeWidth={0.5}
          strokeDasharray="2 2"
          opacity={0.5}
        />

        {/* Filled areas under each segment */}
        {segments.map((seg, i) => {
          if (seg.points.length < 2) return null;
          const fillColor = seg.sign === "+" ? T.green : T.red;
          const linePath = seg.points
            .map((p) => `${xOf(p.s).toFixed(1)},${yOf(p.p).toFixed(1)}`)
            .join(" L ");
          const firstX = xOf(seg.points[0].s).toFixed(1);
          const lastX = xOf(seg.points[seg.points.length - 1].s).toFixed(1);
          const fillD = `M ${firstX},${y0} L ${linePath} L ${lastX},${y0} Z`;
          return (
            <path
              key={`fill-${i}`}
              d={fillD}
              fill={fillColor}
              fillOpacity={0.13}
            />
          );
        })}

        {/* Strike vertical line */}
        {strike >= xMin && strike <= xMax && (
          <line
            x1={xOf(strike)}
            x2={xOf(strike)}
            y1={padT}
            y2={padT + innerH}
            stroke={T.amber}
            strokeWidth={0.8}
            strokeDasharray="2 2"
            opacity={0.7}
          />
        )}

        {/* Breakeven vertical line */}
        {breakeven >= xMin && breakeven <= xMax && (
          <>
            <line
              x1={xOf(breakeven)}
              x2={xOf(breakeven)}
              y1={padT}
              y2={padT + innerH}
              stroke={T.textDim}
              strokeWidth={0.6}
              strokeDasharray="3 2"
            />
            <text
              x={xOf(breakeven)}
              y={padT - 4}
              fontSize={fs(8)}
              fontFamily={T.mono}
              fill={T.textDim}
              textAnchor="middle"
              fontWeight={600}
            >
              BE ${breakeven.toFixed(2)}
            </text>
          </>
        )}

        {/* Current price vertical line */}
        {currentPrice >= xMin && currentPrice <= xMax && (
          <line
            x1={xOf(currentPrice)}
            x2={xOf(currentPrice)}
            y1={padT}
            y2={padT + innerH}
            stroke={T.accent}
            strokeWidth={1.2}
            opacity={0.9}
          />
        )}

        {/* Curve segments */}
        {segments.map((seg, i) => {
          if (seg.points.length < 2) return null;
          const lineColor = seg.sign === "+" ? T.green : T.red;
          const lineD =
            "M " +
            seg.points
              .map((p) => `${xOf(p.s).toFixed(1)},${yOf(p.p).toFixed(1)}`)
              .join(" L ");
          return (
            <path
              key={`line-${i}`}
              d={lineD}
              fill="none"
              stroke={lineColor}
              strokeWidth={1.8}
              strokeLinejoin="round"
            />
          );
        })}

        {/* Top right: max profit label */}
        <text
          x={W - padR - 2}
          y={padT - 2}
          fontSize={fs(8)}
          fontFamily={T.mono}
          fill={T.green}
          textAnchor="end"
          fontWeight={700}
        >
          {maxProfitUnlimited ? "Max +∞" : `Max +${fmtMoney(visibleMaxProfit)}`}
        </text>
        {/* Bottom right: max loss label */}
        <text
          x={W - padR - 2}
          y={H - 4}
          fontSize={fs(8)}
          fontFamily={T.mono}
          fill={T.red}
          textAnchor="end"
          fontWeight={700}
        >
          {maxLossUnlimited ? "Max −∞" : `Max ${fmtMoney(visibleMaxLoss)}`}
        </text>

        {/* X axis baseline */}
        <line
          x1={padL}
          x2={padL + innerW}
          y1={padT + innerH}
          y2={padT + innerH}
          stroke={T.border}
          strokeWidth={0.5}
        />
        {/* X axis ticks */}
        <text
          x={padL}
          y={H - 4}
          fontSize={fs(7)}
          fontFamily={T.mono}
          fill={T.textMuted}
        >
          ${xMin.toFixed(0)}
        </text>
        <text
          x={padL + innerW}
          y={H - 4}
          fontSize={fs(7)}
          fontFamily={T.mono}
          fill={T.textMuted}
          textAnchor="end"
        >
          ${xMax.toFixed(0)}
        </text>
      </svg>
    </div>
  );
};

const TradeOrderTicket = ({
  slot,
  chainRows = [],
  expiration,
  accountId,
  environment,
  brokerConfigured,
  brokerAuthenticated,
}) => {
  const toast = useToast();
  const queryClient = useQueryClient();
  const info = ensureTradeTickerInfo(slot.ticker, slot.ticker);
  const row = chainRows.find((r) => r.k === slot.strike);
  const prem = row ? (slot.cp === "C" ? row.cPrem : row.pPrem) : null;
  const bid = row ? (slot.cp === "C" ? row.cBid : row.pBid) : null;
  const ask = row ? (slot.cp === "C" ? row.cAsk : row.pAsk) : null;
  const rawDelta = row ? (slot.cp === "C" ? row.cDelta : row.pDelta) : null;
  const spread =
    isFiniteNumber(ask) && isFiniteNumber(bid) ? ask - bid : null;
  const spreadPct =
    isFiniteNumber(spread) && isFiniteNumber(prem) && prem > 0
      ? (spread / prem) * 100
      : null;
  const delta = isFiniteNumber(rawDelta) ? Math.abs(rawDelta) : null;
  const contractColor = slot.cp === "C" ? T.green : T.red;
  const expInfo = expiration || {
    value: slot.exp,
    label: slot.exp,
    dte: daysToExpiration(slot.exp),
    actualDate: parseExpirationValue(slot.exp),
  };
  const selectedContractMeta =
    slot.cp === "C" ? row?.cContract : row?.pContract;
  const liveBrokerReady = Boolean(brokerAuthenticated && accountId);
  const liveExecutionReady = Boolean(
    liveBrokerReady && selectedContractMeta && expInfo.actualDate,
  );
  const placeOrderMutation = usePlaceOrder({
    mutation: {
      onSuccess: (order) => {
        queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
        queryClient.invalidateQueries({ queryKey: ["/api/positions"] });
        toast.push({
          kind: "success",
          title: `Submitted ${slot.ticker} ${slot.strike}${slot.cp}`,
          body: `${order.quantity} × ${order.type.toUpperCase()} · ${order.status.toUpperCase()} · ${order.id}`,
        });
      },
      onError: (error) => {
        toast.push({
          kind: "error",
          title: "Order rejected",
          body: error?.message || "The broker rejected the order.",
        });
      },
    },
  });
  const [previewSnapshot, setPreviewSnapshot] = useState(null);
  const previewOrderMutation = usePreviewOrder({
    mutation: {
      onSuccess: (preview) => {
        setPreviewSnapshot(preview);
        toast.push({
          kind: "success",
          title: "IBKR preview ready",
          body: `${preview.symbol} · contract ${preview.resolvedContractId} · ${preview.accountId}`,
        });
      },
      onError: (error) => {
        toast.push({
          kind: "error",
          title: "Preview failed",
          body:
            error?.message ||
            "The bridge could not build an IBKR order payload.",
        });
      },
    },
  });
  const [liveConfirmState, setLiveConfirmState] = useState(null);
  const [liveConfirmPending, setLiveConfirmPending] = useState(false);

  // ── CONTROLLED STATE ──
  const [side, setSide] = useState("BUY");
  const [orderType, setOrderType] = useState("LMT"); // LMT / MKT / STP
  const [tif, setTif] = useState("DAY"); // DAY / GTC / IOC / FOK
  const [qty, setQty] = useState(3);
  const [limitPrice, setLimitPrice] = useState(isFiniteNumber(prem) ? prem : "");
  const [stopLoss, setStopLoss] = useState(
    isFiniteNumber(prem) ? +(prem * 0.65).toFixed(2) : "",
  );
  const [takeProfit, setTakeProfit] = useState(
    isFiniteNumber(prem) ? +(prem * 1.75).toFixed(2) : "",
  );

  // When the contract changes, reset prices (but not qty — user might want same size)
  useEffect(() => {
    setLimitPrice(isFiniteNumber(prem) ? prem : "");
    setStopLoss(isFiniteNumber(prem) ? +(prem * 0.65).toFixed(2) : "");
    setTakeProfit(isFiniteNumber(prem) ? +(prem * 1.75).toFixed(2) : "");
  }, [prem, slot.ticker, slot.strike, slot.cp]);

  useEffect(() => {
    setPreviewSnapshot(null);
  }, [
    side,
    orderType,
    tif,
    qty,
    limitPrice,
    slot.ticker,
    slot.strike,
    slot.cp,
    slot.exp,
    expInfo.value,
    environment,
    accountId,
    brokerConfigured,
    brokerAuthenticated,
  ]);
  const closeLiveConfirm = () => {
    if (liveConfirmPending) {
      return;
    }

    setLiveConfirmState(null);
  };
  const runLiveConfirm = async () => {
    if (!liveConfirmState?.onConfirm) {
      return;
    }

    setLiveConfirmPending(true);
    try {
      await liveConfirmState.onConfirm();
      setLiveConfirmState(null);
    } finally {
      setLiveConfirmPending(false);
    }
  };

  if (
    !row ||
    !isFiniteNumber(prem) ||
    !isFiniteNumber(bid) ||
    !isFiniteNumber(ask) ||
    !isFiniteNumber(rawDelta)
  ) {
    return (
      <div
        style={{
          background: T.bg2,
          border: `1px solid ${T.border}`,
          borderRadius: dim(6),
          padding: sp("8px 10px"),
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        <div
          style={{
            fontSize: fs(9),
            fontWeight: 700,
            color: T.textSec,
            fontFamily: T.display,
            letterSpacing: "0.08em",
            borderBottom: `1px solid ${T.border}`,
            paddingBottom: 4,
          }}
        >
          ORDER TICKET
        </div>
        <DataUnavailableState
          title="No live contract quote"
          detail="The order ticket only opens once the selected option contract has a live chain row with bid, ask, and greeks."
        />
      </div>
    );
  }

  const isLong = side === "BUY";
  const qtyNum = Number(qty) || 0;
  const fillPrice =
    orderType === "MKT" ? prem : parseFloat(limitPrice) || prem;
  const cost = fillPrice * qtyNum * 100;
  const breakeven =
    slot.cp === "C" ? slot.strike + fillPrice : slot.strike - fillPrice;
  const beMovePct =
    isFiniteNumber(info.price) && info.price !== 0
      ? ((breakeven - info.price) / info.price) * 100
      : null;
  const pop = isFiniteNumber(delta)
    ? Math.max(15, Math.min(75, (0.5 - Math.abs(delta - 0.5)) * 100 + 25))
    : null;
  const slPct =
    fillPrice > 0 && Number.isFinite(+stopLoss)
      ? ((+stopLoss - fillPrice) / fillPrice) * 100
      : null;
  const tpPct =
    fillPrice > 0 && Number.isFinite(+takeProfit)
      ? ((+takeProfit - fillPrice) / fillPrice) * 100
      : null;
  const orderRequest = liveExecutionReady
    ? {
        accountId,
        mode: environment,
        symbol: slot.ticker,
        assetClass: "option",
        side: side.toLowerCase(),
        type:
          orderType === "MKT"
            ? "market"
            : orderType === "STP"
              ? "stop"
              : "limit",
        quantity: qtyNum,
        limitPrice: orderType === "LMT" ? fillPrice : null,
        stopPrice: orderType === "STP" ? fillPrice : null,
        timeInForce: tif.toLowerCase(),
        optionContract: {
          ticker: selectedContractMeta.ticker,
          underlying: selectedContractMeta.underlying,
          expirationDate: expInfo.actualDate,
          strike: selectedContractMeta.strike,
          right: selectedContractMeta.right,
          multiplier: selectedContractMeta.multiplier,
          sharesPerContract: selectedContractMeta.sharesPerContract,
          providerContractId: selectedContractMeta.providerContractId,
        },
      }
    : null;
  const previewPayload =
    previewSnapshot?.orderPayload &&
    typeof previewSnapshot.orderPayload === "object"
      ? previewSnapshot.orderPayload
      : null;
  const previewOrderPayload = previewPayload;

  const validateTicket = () => {
    if (qtyNum <= 0) {
      toast.push({
        kind: "error",
        title: "Invalid quantity",
        body: "Enter a positive number of contracts.",
      });
      return false;
    }
    if (
      orderType !== "MKT" &&
      (!Number.isFinite(fillPrice) || fillPrice <= 0)
    ) {
      toast.push({
        kind: "error",
        title: "Invalid price",
        body: `Enter a positive ${orderType === "STP" ? "stop" : "limit"} price.`,
      });
      return false;
    }
    return true;
  };

  const previewOrder = () => {
    if (!validateTicket()) {
      return;
    }

    if (!brokerConfigured) {
      toast.push({
        kind: "info",
        title: "IBKR required",
        body: "Local preview simulation has been removed. Connect the IBKR bridge to preview a live order.",
      });
      return;
    }

    if (!brokerAuthenticated) {
      toast.push({
        kind: "warn",
        title: "IBKR login required",
        body: "Bring the local IBKR bridge online before previewing a live order.",
      });
      return;
    }

    if (!accountId) {
      toast.push({
        kind: "warn",
        title: "No broker account selected",
        body: "The bridge is authenticated, but no IBKR account is active yet.",
      });
      return;
    }

    if (!liveExecutionReady || !orderRequest) {
      toast.push({
        kind: "info",
        title: "Contract loading",
        body: "Wait for the live option chain to finish loading before previewing a broker order.",
      });
      return;
    }

    previewOrderMutation.mutate({ data: orderRequest });
  };

  const submitOrder = () => {
    if (!validateTicket()) {
      return;
    }

    if (!brokerConfigured) {
      toast.push({
        kind: "warn",
        title: "IBKR required",
        body: "Local order fills are disabled. Connect the IBKR bridge to submit this order.",
      });
      return;
    }

    if (brokerConfigured && !brokerAuthenticated) {
      toast.push({
        kind: "warn",
        title: "IBKR login required",
        body: "Bring the local IBKR bridge online before submitting live broker orders.",
      });
      return;
    }

    if (brokerConfigured && !accountId) {
      toast.push({
        kind: "warn",
        title: "No broker account selected",
        body: "The bridge is authenticated, but no IBKR account is active yet.",
      });
      return;
    }

    if (brokerConfigured && accountId && !liveExecutionReady) {
      toast.push({
        kind: "info",
        title: "Contract loading",
        body: "Wait for the live option chain to finish loading before submitting a broker order.",
      });
      return;
    }

    setLiveConfirmState({
      title: `${side} ${slot.ticker} ${slot.strike}${slot.cp}`,
      detail: `Submit this ${environment.toUpperCase()} broker order to Interactive Brokers for immediate routing.`,
      confirmLabel: `${side} LIVE ORDER`,
      confirmTone: isLong ? T.green : T.red,
      lines: [
        { label: "ACCOUNT", value: accountId || MISSING_VALUE },
        { label: "SYMBOL", value: slot.ticker },
        { label: "CONTRACT", value: `${slot.strike}${slot.cp} ${expInfo.label || slot.exp}` },
        { label: "TYPE", value: orderType },
        { label: "TIF", value: tif },
        { label: "QTY", value: String(qtyNum || 0) },
        {
          label: orderType === "STP" ? "STOP" : orderType === "MKT" ? "MARK" : "LIMIT",
          value: `$${fillPrice.toFixed(2)}`,
        },
        {
          label: isLong ? "EST COST" : "EST CREDIT",
          value: `$${cost.toFixed(0)}`,
          valueColor: isLong ? T.red : T.green,
        },
      ],
      onConfirm: async () => {
        await placeOrderMutation.mutateAsync({
          data: {
            ...orderRequest,
            confirm: true,
          },
        });
      },
    });
  };

  return (
    <>
      <div
      style={{
        background: T.bg2,
        border: `1px solid ${T.border}`,
        borderRadius: dim(6),
        padding: sp("8px 10px"),
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      <div
        style={{
          fontSize: fs(9),
          fontWeight: 700,
          color: T.textSec,
          fontFamily: T.display,
          letterSpacing: "0.08em",
          borderBottom: `1px solid ${T.border}`,
          paddingBottom: 4,
        }}
      >
        ORDER TICKET
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: sp(8),
          padding: sp("2px 0 1px"),
        }}
      >
        <span
          style={{
            fontSize: fs(8),
            color: brokerConfigured
              ? brokerAuthenticated
                ? T.green
                : T.amber
              : T.textDim,
            fontFamily: T.mono,
            fontWeight: 700,
          }}
        >
          {brokerConfigured
            ? brokerAuthenticated
              ? `IBKR ${environment.toUpperCase()}`
              : "IBKR LOGIN REQUIRED"
            : "IBKR REQUIRED"}
        </span>
        <span style={{ fontSize: fs(7), color: T.textDim, fontFamily: T.mono }}>
          {brokerConfigured ? accountId || MISSING_VALUE : MISSING_VALUE}
        </span>
      </div>
      {brokerConfigured && !brokerAuthenticated && (
        <div
          style={{
            background: `${T.amber}12`,
            border: `1px solid ${T.amber}35`,
            borderRadius: dim(4),
            padding: sp("6px 8px"),
            fontSize: fs(8),
            color: T.amber,
            fontFamily: T.sans,
            lineHeight: 1.35,
          }}
        >
          Live trading is configured, but the local IBKR bridge still needs an
          authenticated IBKR bridge session.
        </div>
      )}
      <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
        <span
          style={{
            fontSize: fs(13),
            fontWeight: 800,
            fontFamily: T.mono,
            color: T.text,
          }}
        >
          {slot.ticker}
        </span>
        <span
          style={{
            fontSize: fs(12),
            fontWeight: 700,
            fontFamily: T.mono,
            color: contractColor,
          }}
        >
          {slot.strike}
          {slot.cp}
        </span>
        <span style={{ fontSize: fs(9), color: T.textDim, fontFamily: T.mono }}>
          {expInfo.label || slot.exp} · {expInfo.dte}d
        </span>
      </div>
      {/* Bid × Ask spread strip */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: sp(4),
          padding: sp("4px 6px"),
          background: T.bg3,
          borderRadius: dim(3),
          fontFamily: T.mono,
        }}
      >
        <div>
          <div
            style={{
              fontSize: fs(6),
              color: T.textMuted,
              letterSpacing: "0.08em",
            }}
          >
            BID
          </div>
          <div
            style={{
              fontSize: fs(12),
              fontWeight: 700,
              color: T.red,
              lineHeight: 1,
            }}
          >
            ${bid.toFixed(2)}
          </div>
        </div>
        <div style={{ textAlign: "center" }}>
          <div
            style={{
              fontSize: fs(6),
              color: T.textMuted,
              letterSpacing: "0.08em",
            }}
          >
            MID
          </div>
          <div
            style={{
              fontSize: fs(12),
              fontWeight: 700,
              color: T.text,
              lineHeight: 1,
            }}
          >
            ${prem.toFixed(2)}
          </div>
          <div
            style={{
              fontSize: fs(7),
              color: isFiniteNumber(spreadPct) && spreadPct > 3 ? T.amber : T.textDim,
            }}
          >
            {isFiniteNumber(spread) && isFiniteNumber(spreadPct)
              ? `${spread.toFixed(2)} (${spreadPct.toFixed(1)}%)`
              : MISSING_VALUE}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div
            style={{
              fontSize: fs(6),
              color: T.textMuted,
              letterSpacing: "0.08em",
            }}
          >
            ASK
          </div>
          <div
            style={{
              fontSize: fs(12),
              fontWeight: 700,
              color: T.green,
              lineHeight: 1,
            }}
          >
            ${ask.toFixed(2)}
          </div>
        </div>
      </div>
      {/* Side + Order type */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 3 }}>
        <div style={{ display: "flex", gap: 2 }}>
          <button
            onClick={() => setSide("BUY")}
            style={{
              flex: 1,
              padding: sp("4px 0"),
              background: isLong ? `${T.green}20` : "transparent",
              border: `1px solid ${isLong ? T.green + "60" : T.border}`,
              borderRadius: dim(3),
              color: isLong ? T.green : T.textDim,
              fontSize: fs(10),
              fontFamily: T.sans,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            BUY
          </button>
          <button
            onClick={() => setSide("SELL")}
            style={{
              flex: 1,
              padding: sp("4px 0"),
              background: !isLong ? `${T.red}20` : "transparent",
              border: `1px solid ${!isLong ? T.red + "60" : T.border}`,
              borderRadius: dim(3),
              color: !isLong ? T.red : T.textDim,
              fontSize: fs(10),
              fontFamily: T.sans,
              fontWeight: !isLong ? 700 : 600,
              cursor: "pointer",
            }}
          >
            SELL
          </button>
        </div>
        <div style={{ display: "flex", gap: 2 }}>
          {["LMT", "MKT", "STP"].map((t) => (
            <button
              key={t}
              onClick={() => setOrderType(t)}
              style={{
                flex: 1,
                padding: sp("4px 0"),
                background: orderType === t ? T.accentDim : "transparent",
                border: `1px solid ${orderType === t ? T.accent : T.border}`,
                borderRadius: dim(3),
                color: orderType === t ? T.accent : T.textDim,
                fontSize: fs(9),
                fontFamily: T.mono,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {t}
            </button>
          ))}
        </div>
      </div>
      {/* QTY presets + input + LIMIT */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "auto 1fr 1fr",
          gap: sp(4),
          alignItems: "end",
        }}
      >
        <div style={{ display: "flex", gap: 2 }}>
          {[1, 3, 5, 10].map((n) => (
            <button
              key={n}
              onClick={() => setQty(n)}
              style={{
                padding: sp("4px 7px"),
                background: qtyNum === n ? T.accentDim : "transparent",
                border: `1px solid ${qtyNum === n ? T.accent : T.border}`,
                borderRadius: dim(3),
                color: qtyNum === n ? T.accent : T.textDim,
                fontSize: fs(9),
                fontFamily: T.mono,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              {n}
            </button>
          ))}
        </div>
        <div>
          <div
            style={{
              fontSize: fs(6),
              color: T.textMuted,
              letterSpacing: "0.08em",
              marginBottom: 1,
            }}
          >
            QTY
          </div>
          <input
            type="number"
            min="1"
            value={qty}
            onChange={(e) =>
              setQty(e.target.value === "" ? "" : Math.max(0, +e.target.value))
            }
            style={{
              width: "100%",
              background: T.bg3,
              border: `1px solid ${T.border}`,
              borderRadius: dim(3),
              padding: sp("3px 6px"),
              color: T.text,
              fontSize: fs(11),
              fontFamily: T.mono,
              fontWeight: 600,
            }}
          />
        </div>
        <div>
          <div
            style={{
              fontSize: fs(6),
              color: T.textMuted,
              letterSpacing: "0.08em",
              marginBottom: 1,
            }}
          >
            {orderType === "MKT"
              ? "MID"
              : orderType === "STP"
                ? "STOP"
                : "LIMIT"}
          </div>
          <input
            type="number"
            step="0.01"
            value={orderType === "MKT" ? formatPriceValue(prem) : limitPrice}
            disabled={orderType === "MKT"}
            onChange={(e) => setLimitPrice(e.target.value)}
            style={{
              width: "100%",
              background: orderType === "MKT" ? T.bg2 : T.bg3,
              border: `1px solid ${T.border}`,
              borderRadius: dim(3),
              padding: sp("3px 6px"),
              color: orderType === "MKT" ? T.textDim : T.text,
              fontSize: fs(11),
              fontFamily: T.mono,
              fontWeight: 600,
            }}
          />
        </div>
      </div>
      {/* SL / TP */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
        <div>
          <div
            style={{
              fontSize: fs(6),
              color: T.textMuted,
              letterSpacing: "0.08em",
              marginBottom: sp(1),
              display: "flex",
              justifyContent: "space-between",
            }}
          >
            <span>STOP LOSS</span>
            <span style={{ color: T.red, fontWeight: 700 }}>
              {isFiniteNumber(slPct)
                ? `${slPct >= 0 ? "+" : ""}${slPct.toFixed(0)}%`
                : MISSING_VALUE}
            </span>
          </div>
          <input
            type="number"
            step="0.01"
            value={stopLoss}
            onChange={(e) => setStopLoss(e.target.value)}
            style={{
              width: "100%",
              background: T.bg3,
              border: `1px solid ${T.red}30`,
              borderRadius: dim(3),
              padding: sp("3px 6px"),
              color: T.red,
              fontSize: fs(11),
              fontFamily: T.mono,
              fontWeight: 600,
            }}
          />
        </div>
        <div>
          <div
            style={{
              fontSize: fs(6),
              color: T.textMuted,
              letterSpacing: "0.08em",
              marginBottom: sp(1),
              display: "flex",
              justifyContent: "space-between",
            }}
          >
            <span>TAKE PROFIT</span>
            <span style={{ color: T.green, fontWeight: 700 }}>
              {isFiniteNumber(tpPct)
                ? `${tpPct >= 0 ? "+" : ""}${tpPct.toFixed(0)}%`
                : MISSING_VALUE}
            </span>
          </div>
          <input
            type="number"
            step="0.01"
            value={takeProfit}
            onChange={(e) => setTakeProfit(e.target.value)}
            style={{
              width: "100%",
              background: T.bg3,
              border: `1px solid ${T.green}30`,
              borderRadius: dim(3),
              padding: sp("3px 6px"),
              color: T.green,
              fontSize: fs(11),
              fontFamily: T.mono,
              fontWeight: 600,
            }}
          />
        </div>
      </div>
      {/* TIF */}
      <div style={{ display: "flex", gap: 2 }}>
        {["DAY", "GTC", "IOC", "FOK"].map((t) => (
          <button
            key={t}
            onClick={() => setTif(t)}
            style={{
              flex: 1,
              padding: sp("3px 0"),
              background: tif === t ? T.accentDim : "transparent",
              border: `1px solid ${tif === t ? T.accent : T.border}`,
              borderRadius: dim(2),
              color: tif === t ? T.accent : T.textDim,
              fontSize: fs(8),
              fontFamily: T.mono,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {t}
          </button>
        ))}
      </div>
      {/* Payoff diagram — uses fillPrice so limit changes update the curve live */}
      <PayoffDiagram
        optType={slot.cp}
        strike={slot.strike}
        premium={fillPrice}
        qty={qtyNum || 1}
        currentPrice={info.price}
        side={side}
      />
      {/* Compact risk row below diagram — keeps the BE/POP scalars accessible */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          padding: sp("2px 4px"),
          fontSize: fs(8),
          fontFamily: T.mono,
        }}
      >
        <span style={{ color: T.textMuted }}>
          BE{" "}
          <span style={{ color: T.text, fontWeight: 600 }}>
            ${breakeven.toFixed(2)}
          </span>{" "}
          <span style={{ color: T.textDim }}>
            {beMovePct == null
              ? `(${MISSING_VALUE})`
              : `(${beMovePct >= 0 ? "+" : ""}${beMovePct.toFixed(1)}%)`}
          </span>
        </span>
        <span style={{ color: T.textMuted }}>
          {isLong ? "Risk" : "Credit"}{" "}
          <span style={{ color: isLong ? T.red : T.green, fontWeight: 600 }}>
            ${cost.toFixed(0)}
          </span>
        </span>
        <span style={{ color: T.textMuted }}>
          POP{" "}
          <span
            style={{
              color: !isFiniteNumber(pop)
                ? T.textDim
                : pop >= 50
                  ? T.green
                  : pop >= 30
                    ? T.amber
                    : T.red,
              fontWeight: 600,
            }}
          >
            {isFiniteNumber(pop) ? `${pop.toFixed(0)}%` : MISSING_VALUE}
          </span>
        </span>
      </div>
      {previewSnapshot && (
        <div
          style={{
            background: T.bg3,
            border: `1px solid ${T.border}`,
            borderRadius: dim(4),
            padding: sp("6px 8px"),
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: sp(4),
            fontSize: fs(8),
            fontFamily: T.mono,
          }}
        >
          <div>
            <span style={{ color: T.textMuted }}>PREVIEW</span>{" "}
            <span style={{ color: T.text, fontWeight: 700 }}>
              {previewSnapshot.accountId}
            </span>
          </div>
          <div>
            <span style={{ color: T.textMuted }}>CONID</span>{" "}
            <span style={{ color: T.accent, fontWeight: 700 }}>
              {previewSnapshot.resolvedContractId}
            </span>
          </div>
          <div>
            <span style={{ color: T.textMuted }}>TYPE</span>{" "}
            <span style={{ color: T.text }}>
              {formatEnumLabel(previewOrderPayload?.orderType || orderType)}
            </span>
          </div>
          <div>
            <span style={{ color: T.textMuted }}>TIF</span>{" "}
            <span style={{ color: T.text }}>
              {String(previewOrderPayload?.tif || tif).toUpperCase()}
            </span>
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <span style={{ color: T.textMuted }}>PAYLOAD</span>{" "}
            <span style={{ color: T.textSec }}>
              {String(previewOrderPayload?.side || side).toUpperCase()}{" "}
              {previewOrderPayload?.quantity ?? qtyNum} {previewSnapshot.symbol}
              {previewOrderPayload?.price != null
                ? ` @ ${previewOrderPayload.price}`
                : ""}
            </span>
          </div>
        </div>
      )}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1.2fr",
          gap: sp(4),
          marginTop: "auto",
        }}
      >
        <button
          onClick={previewOrder}
          disabled={previewOrderMutation.isPending}
          style={{
            padding: sp("7px 0"),
            background: T.bg3,
            border: `1px solid ${T.border}`,
            borderRadius: dim(4),
            color: T.textSec,
            fontSize: fs(10),
            fontFamily: T.sans,
            fontWeight: 700,
            cursor: previewOrderMutation.isPending ? "wait" : "pointer",
            letterSpacing: "0.04em",
            opacity: previewOrderMutation.isPending ? 0.7 : 1,
          }}
        >
          {previewOrderMutation.isPending
            ? "PREVIEWING..."
            : brokerConfigured
              ? "PREVIEW IBKR"
              : "SIM PREVIEW"}
        </button>
        <button
          onClick={submitOrder}
          disabled={placeOrderMutation.isPending}
          style={{
            padding: sp("7px 0"),
            background: isLong ? T.green : T.red,
            border: "none",
            borderRadius: dim(4),
            color: "#fff",
            fontSize: fs(11),
            fontFamily: T.sans,
            fontWeight: 700,
            cursor: placeOrderMutation.isPending ? "wait" : "pointer",
            letterSpacing: "0.04em",
            opacity: placeOrderMutation.isPending ? 0.7 : 1,
          }}
        >
          {placeOrderMutation.isPending
            ? "SUBMITTING..."
            : `${side} ${qtyNum || 0} × $${fillPrice.toFixed(2)} · ${isLong ? "−" : "+"}$${cost.toFixed(0)}`}
        </button>
      </div>
      </div>
      <BrokerActionConfirmDialog
        open={Boolean(liveConfirmState)}
        title={liveConfirmState?.title || "Confirm live order"}
        detail={
          liveConfirmState?.detail ||
          "Submit this live Interactive Brokers order."
        }
        lines={liveConfirmState?.lines || []}
        confirmLabel={liveConfirmState?.confirmLabel || "CONFIRM LIVE ORDER"}
        confirmTone={liveConfirmState?.confirmTone || T.red}
        pending={liveConfirmPending}
        onCancel={closeLiveConfirm}
        onConfirm={runLiveConfirm}
      />
    </>
  );
};

const TradeStrategyGreeksPanel = ({
  slot,
  chainRows = [],
  onApplyStrategy,
}) => {
  const row = chainRows.find((r) => r.k === slot.strike);
  if (!row) {
    return (
      <div
        style={{
          background: T.bg2,
          border: `1px solid ${T.border}`,
          borderRadius: dim(6),
          padding: sp("8px 10px"),
          display: "flex",
          flexDirection: "column",
          gap: sp(6),
          overflow: "hidden",
        }}
      >
        <div
          style={{
            fontSize: fs(9),
            fontWeight: 700,
            color: T.textSec,
            fontFamily: T.display,
            letterSpacing: "0.08em",
            borderBottom: `1px solid ${T.border}`,
            paddingBottom: sp(4),
          }}
        >
          STRATEGY
        </div>
        <DataUnavailableState
          title="No live greeks"
          detail="Strategy presets stay available after the selected contract resolves to a live option chain row with greeks."
        />
      </div>
    );
  }
  const delta = slot.cp === "C" ? row.cDelta : row.pDelta;
  const gamma = slot.cp === "C" ? row.cGamma : row.pGamma;
  const theta = slot.cp === "C" ? row.cTheta : row.pTheta;
  const vega = slot.cp === "C" ? row.cVega : row.pVega;
  if (
    !isFiniteNumber(delta) ||
    !isFiniteNumber(gamma) ||
    !isFiniteNumber(theta) ||
    !isFiniteNumber(vega)
  ) {
    return (
      <div
        style={{
          background: T.bg2,
          border: `1px solid ${T.border}`,
          borderRadius: dim(6),
          padding: sp("8px 10px"),
          display: "flex",
          flexDirection: "column",
          gap: sp(6),
          overflow: "hidden",
        }}
      >
        <div
          style={{
            fontSize: fs(9),
            fontWeight: 700,
            color: T.textSec,
            fontFamily: T.display,
            letterSpacing: "0.08em",
            borderBottom: `1px solid ${T.border}`,
            paddingBottom: sp(4),
          }}
        >
          STRATEGY
        </div>
        <DataUnavailableState
          title="No live greeks"
          detail="Strategy presets stay hidden until the selected contract includes broker-backed delta, gamma, theta, and vega."
        />
      </div>
    );
  }
  const absDelta = Math.abs(delta);
  const qty = 3;

  const GreekBar = ({ label, value, color, max, desc }) => {
    const pct = Math.min(1, Math.abs(value) / max);
    return (
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "32px 1fr 64px",
          alignItems: "center",
          gap: sp(4),
          padding: "2px 0",
        }}
      >
        <span
          style={{
            fontSize: fs(9),
            color: T.textSec,
            fontFamily: T.mono,
            fontWeight: 600,
          }}
        >
          {label}
        </span>
        <div
          style={{
            position: "relative",
            height: dim(12),
            background: T.bg3,
            borderRadius: dim(2),
            overflow: "hidden",
          }}
        >
          <div
            style={{
              position: "absolute",
              left: value < 0 ? `${50 - pct * 50}%` : "50%",
              width: `${pct * 50}%`,
              height: "100%",
              background: color,
              opacity: 0.85,
              borderRadius: dim(1),
            }}
          />
          <div
            style={{
              position: "absolute",
              left: "50%",
              top: 0,
              bottom: 0,
              width: dim(1),
              background: T.border,
            }}
          />
          <span
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left:
                value < 0
                  ? `${Math.max(0, 50 - pct * 50 - 0.5)}%`
                  : `${Math.min(95, 50 + pct * 50 + 1)}%`,
              transform: value < 0 ? "translateX(-100%)" : "none",
              fontSize: fs(8),
              fontFamily: T.mono,
              fontWeight: 700,
              color: T.text,
              display: "flex",
              alignItems: "center",
              paddingLeft: value < 0 ? 0 : 3,
              paddingRight: value < 0 ? 3 : 0,
            }}
          >
            {value.toFixed(3)}
          </span>
        </div>
        <span
          style={{
            fontSize: fs(9),
            color: T.textDim,
            fontFamily: T.sans,
            fontStyle: "italic",
            textAlign: "right",
          }}
        >
          {desc}
        </span>
      </div>
    );
  };

  return (
    <div
      style={{
        background: T.bg2,
        border: `1px solid ${T.border}`,
        borderRadius: dim(6),
        padding: sp("8px 10px"),
        display: "flex",
        flexDirection: "column",
        gap: sp(6),
        overflow: "hidden",
      }}
    >
      <div>
        <div
          style={{
            fontSize: fs(9),
            fontWeight: 700,
            color: T.textSec,
            fontFamily: T.display,
            letterSpacing: "0.08em",
            borderBottom: `1px solid ${T.border}`,
            paddingBottom: sp(4),
            marginBottom: 5,
          }}
        >
          STRATEGY
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: 3,
          }}
        >
          {TRADE_STRATEGIES.map((s) => (
            <button
              key={s.id}
              onClick={(e) => {
                e.stopPropagation();
                onApplyStrategy(s);
              }}
              style={{
                padding: sp("4px 6px"),
                background: "transparent",
                border: `1px solid ${s.color}40`,
                borderLeft: `3px solid ${s.color}`,
                borderRadius: dim(3),
                color: T.text,
                fontSize: fs(9),
                fontFamily: T.sans,
                fontWeight: 600,
                textAlign: "left",
                cursor: "pointer",
                lineHeight: 1.2,
              }}
            >
              <div style={{ color: s.color, fontWeight: 700 }}>{s.name}</div>
              <div
                style={{
                  color: T.textDim,
                  fontSize: fs(8),
                  marginTop: sp(1),
                  fontStyle: "italic",
                }}
              >
                {s.desc}
              </div>
            </button>
          ))}
        </div>
      </div>
      <div>
        <div
          style={{
            fontSize: fs(9),
            fontWeight: 700,
            color: T.textSec,
            fontFamily: T.display,
            letterSpacing: "0.08em",
            borderBottom: `1px solid ${T.border}`,
            paddingBottom: sp(4),
            marginBottom: sp(5),
            display: "flex",
            justifyContent: "space-between",
          }}
        >
          <span>GREEKS</span>
          <span style={{ fontSize: fs(7), color: T.textDim, fontWeight: 400 }}>
            PER CONTRACT
          </span>
        </div>
        <GreekBar
          label="Δ"
          value={delta}
          color={T.accent}
          max={1.0}
          desc={
            absDelta >= 0.5 ? "Strong" : absDelta >= 0.3 ? "Moderate" : "Weak"
          }
        />
        <GreekBar
          label="Γ"
          value={gamma}
          color={T.purple}
          max={0.1}
          desc={gamma > 0.05 ? "High γ-risk" : "Moderate γ"}
        />
        <GreekBar
          label="Θ"
          value={theta}
          color={T.red}
          max={0.15}
          desc={`$${Math.abs(theta * 100).toFixed(0)}/day`}
        />
        <GreekBar
          label="V"
          value={vega}
          color={T.cyan}
          max={0.2}
          desc={`$${(vega * 100).toFixed(0)}/1% IV`}
        />
      </div>
      <div
        style={{ padding: sp("4px 6px"), background: T.bg3, borderRadius: 3 }}
      >
        <div
          style={{
            fontSize: fs(6),
            color: T.textMuted,
            letterSpacing: "0.08em",
            marginBottom: 2,
          }}
        >
          POSITION × {qty}
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr 1fr",
            gap: sp(4),
            fontSize: fs(9),
            fontFamily: T.mono,
          }}
        >
          <div>
            <span style={{ color: T.textDim, fontSize: fs(7) }}>Δ </span>
            <span style={{ color: T.accent, fontWeight: 700 }}>
              {(delta * qty).toFixed(2)}
            </span>
          </div>
          <div>
            <span style={{ color: T.textDim, fontSize: fs(7) }}>Γ </span>
            <span style={{ color: T.purple, fontWeight: 700 }}>
              {(gamma * qty).toFixed(2)}
            </span>
          </div>
          <div>
            <span style={{ color: T.textDim, fontSize: fs(7) }}>Θ </span>
            <span style={{ color: T.red, fontWeight: 700 }}>
              {(theta * qty).toFixed(2)}
            </span>
          </div>
          <div>
            <span style={{ color: T.textDim, fontSize: fs(7) }}>V </span>
            <span style={{ color: T.cyan, fontWeight: 700 }}>
              {(vega * qty).toFixed(2)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

const TradeL2Panel = ({
  slot,
  chainRows = [],
  flowEvents = [],
  accountId,
  brokerConfigured,
  brokerAuthenticated,
}) => {
  const queryClient = useQueryClient();
  const row = chainRows.find((r) => r.k === slot.strike);
  const mid = row ? (slot.cp === "C" ? row.cPrem : row.pPrem) : 3.0;
  const bid = row ? (slot.cp === "C" ? row.cBid : row.pBid) : mid - 0.04;
  const ask = row ? (slot.cp === "C" ? row.cAsk : row.pAsk) : mid + 0.04;
  const spread = ask - bid;
  const tickerFlow = useMemo(
    () => buildMarketOrderFlowFromEvents(flowEvents),
    [flowEvents],
  );
  const contractColor = slot.cp === "C" ? T.green : T.red;
  const [tab, setTab] = useState("book");
  const selectedContractMeta =
    slot.cp === "C" ? row?.cContract : row?.pContract;
  const depthQuery = useQuery({
    queryKey: [
      "trade-market-depth",
      accountId,
      slot.ticker,
      selectedContractMeta?.providerContractId,
    ],
    queryFn: () =>
      getBrokerMarketDepthRequest({
        accountId,
        symbol: slot.ticker,
        assetClass: "option",
        providerContractId: selectedContractMeta?.providerContractId,
        exchange: "SMART",
      }),
    enabled: Boolean(
      brokerAuthenticated && accountId && selectedContractMeta?.providerContractId,
    ),
    staleTime: 5_000,
    refetchInterval: false,
    retry: false,
  });
  const tapeQuery = useQuery({
    queryKey: [
      "trade-contract-executions",
      accountId,
      slot.ticker,
      selectedContractMeta?.providerContractId,
    ],
    queryFn: () =>
      listBrokerExecutionsRequest({
        accountId,
        symbol: slot.ticker,
        providerContractId: selectedContractMeta?.providerContractId,
        days: 2,
        limit: 24,
      }),
    enabled: Boolean(
      brokerAuthenticated && accountId && selectedContractMeta?.providerContractId,
    ),
    staleTime: 5_000,
    refetchInterval: false,
    retry: false,
  });
  useEffect(() => {
    if (
      !brokerAuthenticated ||
      !accountId ||
      !selectedContractMeta?.providerContractId ||
      typeof window === "undefined" ||
      typeof window.EventSource === "undefined"
    ) {
      return undefined;
    }

    const params = new URLSearchParams({
      accountId,
      symbol: slot.ticker,
      assetClass: "option",
      providerContractId: selectedContractMeta.providerContractId,
      exchange: "SMART",
    });
    const source = new EventSource(`/api/streams/market-depth?${params.toString()}`);
    const handleDepth = (event) => {
      try {
        const payload = JSON.parse(event.data);
        queryClient.setQueryData(
          [
            "trade-market-depth",
            accountId,
            slot.ticker,
            selectedContractMeta.providerContractId,
          ],
          payload,
        );
      } catch {}
    };

    source.addEventListener("depth", handleDepth);
    return () => {
      source.removeEventListener("depth", handleDepth);
      source.close();
    };
  }, [
    accountId,
    brokerAuthenticated,
    queryClient,
    selectedContractMeta?.providerContractId,
    slot.ticker,
  ]);
  useEffect(() => {
    if (
      !brokerAuthenticated ||
      !accountId ||
      !selectedContractMeta?.providerContractId ||
      typeof window === "undefined" ||
      typeof window.EventSource === "undefined"
    ) {
      return undefined;
    }

    const params = new URLSearchParams({
      accountId,
      symbol: slot.ticker,
      providerContractId: selectedContractMeta.providerContractId,
      days: "2",
      limit: "24",
    });
    const source = new EventSource(`/api/streams/executions?${params.toString()}`);
    const handleExecutions = (event) => {
      try {
        const payload = JSON.parse(event.data);
        queryClient.setQueryData(
          [
            "trade-contract-executions",
            accountId,
            slot.ticker,
            selectedContractMeta.providerContractId,
          ],
          payload,
        );
      } catch {}
    };

    source.addEventListener("executions", handleExecutions);
    return () => {
      source.removeEventListener("executions", handleExecutions);
      source.close();
    };
  }, [
    accountId,
    brokerAuthenticated,
    queryClient,
    selectedContractMeta?.providerContractId,
    slot.ticker,
  ]);
  const depthLevels = depthQuery.data?.depth?.levels || [];
  const contractExecutions = tapeQuery.data?.executions || [];
  const liveStatusLabel =
    tab === "flow"
      ? flowEvents.length
        ? "flow: external options flow"
        : "flow unavailable"
      : brokerConfigured
        ? brokerAuthenticated
          ? "IBKR book + fills"
          : "IBKR login required"
        : "broker off";

  const TabBtn = ({ id, label }) => (
    <button
      onClick={() => setTab(id)}
      style={{
        background: "transparent",
        border: "none",
        padding: 0,
        fontSize: fs(9),
        fontWeight: 700,
        color: tab === id ? T.text : T.textMuted,
        fontFamily: T.display,
        letterSpacing: "0.08em",
        cursor: "pointer",
        borderBottom:
          tab === id ? `2px solid ${T.accent}` : "2px solid transparent",
        paddingBottom: sp(2),
      }}
    >
      {label}
    </button>
  );

  const renderBrokerGate = (title, detail) => (
    <DataUnavailableState title={title} detail={detail} />
  );

  const renderBookPanel = () => {
    if (!row) {
      return renderBrokerGate(
        "No live contract market depth",
        "This panel unlocks once the selected contract resolves to a live chain row.",
      );
    }

    if (!brokerConfigured) {
      return renderBrokerGate(
        "IBKR book unavailable",
        "Depth-of-book is only available when the broker bridge is configured.",
      );
    }

    if (!brokerAuthenticated) {
      return renderBrokerGate(
        "IBKR login required",
        "Bring the local IBKR bridge online to load live price ladder data.",
      );
    }

    if (!accountId) {
      return renderBrokerGate(
        "No broker account selected",
        "Select an IBKR account to request contract depth.",
      );
    }

    if (!selectedContractMeta?.providerContractId) {
      return renderBrokerGate(
        "Contract still loading",
        "Wait for the selected option contract to resolve to a broker contract id.",
      );
    }

    if (depthQuery.isPending && !depthLevels.length) {
      return (
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: T.textDim,
            fontSize: fs(10),
            fontFamily: T.sans,
          }}
        >
          Loading IBKR depth…
        </div>
      );
    }

    if (!depthLevels.length) {
      return renderBrokerGate(
        "No broker depth returned",
        "IBKR did not return any price ladder rows for this contract yet. This panel shows live book depth, not synthetic levels.",
      );
    }

    const bestBidLevel =
      depthLevels.find(
        (level) => typeof level.bidSize === "number" && level.bidSize > 0,
      ) || null;
    const bestAskLevel =
      depthLevels.find(
        (level) => typeof level.askSize === "number" && level.askSize > 0,
      ) || null;

    return (
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: sp(4),
            padding: sp("4px 0 6px"),
            borderBottom: `1px solid ${T.border}`,
            fontFamily: T.mono,
          }}
        >
          <div>
            <div
              style={{
                fontSize: fs(7),
                color: T.textMuted,
                letterSpacing: "0.08em",
              }}
            >
              BEST BID
            </div>
            <div style={{ fontSize: fs(11), fontWeight: 700, color: T.green }}>
              {formatQuotePrice(bestBidLevel?.price ?? bid)}
            </div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div
              style={{
                fontSize: fs(7),
                color: T.textMuted,
                letterSpacing: "0.08em",
              }}
            >
              LEVELS
            </div>
            <div style={{ fontSize: fs(11), fontWeight: 700, color: T.text }}>
              {depthLevels.length}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div
              style={{
                fontSize: fs(7),
                color: T.textMuted,
                letterSpacing: "0.08em",
              }}
            >
              BEST ASK
            </div>
            <div style={{ fontSize: fs(11), fontWeight: 700, color: T.red }}>
              {formatQuotePrice(bestAskLevel?.price ?? ask)}
            </div>
          </div>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "42px 58px 42px 34px",
            gap: sp(4),
            padding: sp("4px 0"),
            fontSize: fs(7),
            color: T.textMuted,
            letterSpacing: "0.08em",
            fontFamily: T.mono,
          }}
        >
          <span style={{ textAlign: "right" }}>BID SZ</span>
          <span style={{ textAlign: "right" }}>PRICE</span>
          <span style={{ textAlign: "right" }}>ASK SZ</span>
          <span style={{ textAlign: "right" }}>ROW</span>
        </div>
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: sp(2),
          }}
        >
          {depthLevels.map((level) => (
            <div
              key={`${level.row}_${level.price}`}
              style={{
                display: "grid",
                gridTemplateColumns: "42px 58px 42px 34px",
                gap: sp(4),
                alignItems: "center",
                padding: sp("3px 0"),
                fontSize: fs(9),
                fontFamily: T.mono,
                borderBottom: `1px solid ${T.border}08`,
                background: level.isLastTrade ? `${T.accent}10` : "transparent",
              }}
            >
              <span
                style={{
                  color:
                    typeof level.bidSize === "number" && level.bidSize > 0
                      ? T.green
                      : T.textDim,
                  textAlign: "right",
                  fontWeight: typeof level.bidSize === "number" ? 700 : 400,
                }}
              >
                {level.bidSize != null ? level.bidSize.toFixed(0) : MISSING_VALUE}
              </span>
              <span
                style={{
                  color: level.isLastTrade ? T.accent : T.text,
                  textAlign: "right",
                  fontWeight: 700,
                }}
              >
                {formatQuotePrice(level.price)}
              </span>
              <span
                style={{
                  color:
                    typeof level.askSize === "number" && level.askSize > 0
                      ? T.red
                      : T.textDim,
                  textAlign: "right",
                  fontWeight: typeof level.askSize === "number" ? 700 : 400,
                }}
              >
                {level.askSize != null ? level.askSize.toFixed(0) : MISSING_VALUE}
              </span>
              <span
                style={{
                  color: T.textDim,
                  textAlign: "right",
                  fontSize: fs(8),
                }}
              >
                {level.isLastTrade && level.totalSize != null
                  ? `T ${level.totalSize.toFixed(0)}`
                  : level.row}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderTapePanel = () => {
    if (!row) {
      return renderBrokerGate(
        "No live contract fills",
        "This panel unlocks once the selected contract resolves to a live chain row.",
      );
    }

    if (!brokerConfigured) {
      return renderBrokerGate(
        "IBKR fills unavailable",
        "The tape tab shows broker executions for this contract once the bridge is configured.",
      );
    }

    if (!brokerAuthenticated) {
      return renderBrokerGate(
        "IBKR login required",
        "Bring the local IBKR bridge online to load broker executions.",
      );
    }

    if (!accountId) {
      return renderBrokerGate(
        "No broker account selected",
        "Select an IBKR account to load this contract's execution history.",
      );
    }

    if (!selectedContractMeta?.providerContractId) {
      return renderBrokerGate(
        "Contract still loading",
        "Wait for the selected option contract to resolve to a broker contract id.",
      );
    }

    if (tapeQuery.isPending && !contractExecutions.length) {
      return (
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: T.textDim,
            fontSize: fs(10),
            fontFamily: T.sans,
          }}
        >
          Loading IBKR fills…
        </div>
      );
    }

    if (!contractExecutions.length) {
      return renderBrokerGate(
        "No broker fills yet",
        "This tab shows IBKR executions for the selected contract. It is not a public market-wide tape.",
      );
    }

    return (
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "28px 24px 52px 56px 44px",
            gap: sp(4),
            padding: sp("4px 0"),
            fontSize: fs(7),
            color: T.textMuted,
            letterSpacing: "0.08em",
            fontFamily: T.mono,
          }}
        >
          <span>SIDE</span>
          <span style={{ textAlign: "right" }}>QTY</span>
          <span style={{ textAlign: "right" }}>PRICE</span>
          <span style={{ textAlign: "right" }}>NET</span>
          <span style={{ textAlign: "right" }}>TIME</span>
        </div>
        {contractExecutions.map((execution) => (
          <div
            key={execution.id}
            style={{
              display: "grid",
              gridTemplateColumns: "28px 24px 52px 56px 44px",
              gap: sp(4),
              alignItems: "center",
              padding: sp("4px 0"),
              fontSize: fs(9),
              fontFamily: T.mono,
              borderBottom: `1px solid ${T.border}08`,
            }}
            title={`${formatExecutionContractLabel(execution)}${execution.exchange ? ` · ${execution.exchange}` : ""}`}
          >
            <span
              style={{
                color: execution.side === "buy" ? T.green : T.red,
                fontWeight: 700,
              }}
            >
              {execution.side === "buy" ? "BUY" : "SELL"}
            </span>
            <span style={{ color: T.textDim, textAlign: "right" }}>
              {isFiniteNumber(execution.quantity)
                ? execution.quantity.toFixed(0)
                : MISSING_VALUE}
            </span>
            <span style={{ color: T.text, textAlign: "right", fontWeight: 700 }}>
              {formatQuotePrice(execution.price)}
            </span>
            <span
              style={{
                color:
                  !isFiniteNumber(execution.netAmount)
                    ? T.textDim
                    : execution.netAmount >= 0
                      ? T.green
                      : T.red,
                textAlign: "right",
              }}
            >
              {execution.netAmount != null
                ? `${execution.netAmount >= 0 ? "+" : "-"}$${Math.abs(
                    execution.netAmount,
                  ).toFixed(0)}`
                : MISSING_VALUE}
            </span>
            <span
              style={{
                color: T.textDim,
                textAlign: "right",
                fontSize: fs(8),
              }}
            >
              {formatRelativeTimeShort(execution.executedAt)}
            </span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div
      style={{
        background: T.bg2,
        border: `1px solid ${T.border}`,
        borderRadius: dim(6),
        padding: sp("8px 10px"),
        display: "flex",
        flexDirection: "column",
        gap: sp(4),
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          borderBottom: `1px solid ${T.border}`,
          paddingBottom: sp(4),
        }}
      >
        <div style={{ display: "flex", gap: sp(8), alignItems: "center" }}>
          <TabBtn id="book" label="BOOK" />
          <TabBtn id="flow" label="FLOW" />
          <TabBtn id="tape" label="TAPE" />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: sp(8) }}>
          <span
            style={{
              fontSize: fs(8),
              color:
                tab === "flow"
                  ? flowEvents.length
                    ? T.accent
                    : T.textDim
                  : brokerAuthenticated
                    ? T.green
                    : T.textDim,
              fontFamily: T.mono,
            }}
          >
            {liveStatusLabel}
          </span>
          <span
            style={{
              fontSize: fs(9),
              fontFamily: T.mono,
              color: contractColor,
              fontWeight: 700,
            }}
          >
            {slot.strike}
            {slot.cp}
          </span>
          <span
            style={{ fontSize: fs(8), color: T.textDim, fontFamily: T.mono }}
          >
            ${spread.toFixed(2)} sprd
          </span>
        </div>
      </div>

      {tab === "book" && renderBookPanel()}

      {tab === "flow" &&
        (flowEvents.length ? (
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              gap: sp(4),
              minHeight: 0,
              overflowY: "auto",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: sp(8),
                padding: sp("4px 0"),
              }}
            >
              <OrderFlowDonut flow={tickerFlow} size={70} thickness={11} />
              <div
                style={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  gap: sp(2),
                }}
              >
                <div
                  style={{
                    fontSize: fs(8),
                    color: T.textMuted,
                    letterSpacing: "0.08em",
                  }}
                >
                  {slot.ticker} BUY / SELL
                </div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontFamily: T.mono,
                    fontSize: fs(10),
                  }}
                >
                  <span style={{ color: T.green, fontWeight: 700 }}>
                    $
                    {(
                      tickerFlow.buyXL +
                      tickerFlow.buyL +
                      tickerFlow.buyM +
                      tickerFlow.buyS
                    ).toFixed(0)}
                    M
                  </span>
                  <span style={{ color: T.red, fontWeight: 700 }}>
                    $
                    {(
                      tickerFlow.sellXL +
                      tickerFlow.sellL +
                      tickerFlow.sellM +
                      tickerFlow.sellS
                    ).toFixed(0)}
                    M
                  </span>
                </div>
                {(() => {
                  const buy =
                    tickerFlow.buyXL +
                    tickerFlow.buyL +
                    tickerFlow.buyM +
                    tickerFlow.buyS;
                  const sell =
                    tickerFlow.sellXL +
                    tickerFlow.sellL +
                    tickerFlow.sellM +
                    tickerFlow.sellS;
                  const buyPct = (buy / Math.max(buy + sell, 1)) * 100;
                  return (
                    <>
                      <div
                        style={{
                          display: "flex",
                          height: dim(4),
                          borderRadius: dim(2),
                          overflow: "hidden",
                          background: T.bg3,
                        }}
                      >
                        <div
                          style={{
                            width: `${buyPct}%`,
                            background: T.green,
                            opacity: 0.85,
                          }}
                        />
                        <div
                          style={{
                            width: `${100 - buyPct}%`,
                            background: T.red,
                            opacity: 0.85,
                          }}
                        />
                      </div>
                      <div
                        style={{
                          fontSize: fs(8),
                          color: T.textDim,
                          fontFamily: T.mono,
                        }}
                      >
                        {buyPct.toFixed(1)}% buy
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>
            <div
              style={{ borderTop: `1px solid ${T.border}`, paddingTop: sp(3) }}
            >
              <div
                style={{
                  fontSize: fs(8),
                  color: T.textMuted,
                  letterSpacing: "0.08em",
                  marginBottom: sp(2),
                }}
              >
                BY SIZE
              </div>
              {(() => {
                const max = Math.max(
                  tickerFlow.buyXL,
                  tickerFlow.buyL,
                  tickerFlow.buyM,
                  tickerFlow.buyS,
                  tickerFlow.sellXL,
                  tickerFlow.sellL,
                  tickerFlow.sellM,
                  tickerFlow.sellS,
                );
                return (
                  <>
                    <SizeBucketRow
                      label="XL"
                      buy={tickerFlow.buyXL}
                      sell={tickerFlow.sellXL}
                      maxValue={max}
                    />
                    <SizeBucketRow
                      label="L"
                      buy={tickerFlow.buyL}
                      sell={tickerFlow.sellL}
                      maxValue={max}
                    />
                    <SizeBucketRow
                      label="M"
                      buy={tickerFlow.buyM}
                      sell={tickerFlow.sellM}
                      maxValue={max}
                    />
                    <SizeBucketRow
                      label="S"
                      buy={tickerFlow.buyS}
                      sell={tickerFlow.sellS}
                      maxValue={max}
                    />
                  </>
                );
              })()}
            </div>
          </div>
        ) : (
          <DataUnavailableState
            title="No live flow tape"
            detail={`Spot flow for ${slot.ticker} is hidden until current prints are returned from the external flow provider.`}
          />
        ))}

      {tab === "tape" && renderTapePanel()}
    </div>
  );
};

const TradePositionsPanel = ({
  accountId,
  environment,
  brokerConfigured,
  brokerAuthenticated,
  onLoadPosition,
}) => {
  const toast = useToast();
  const pos = usePositions();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState("open");
  const positionsQuery = useListPositions(
    { accountId, mode: environment },
    {
      query: {
        enabled: Boolean(brokerAuthenticated && accountId),
        ...QUERY_DEFAULTS,
        refetchInterval: false,
      },
    },
  );
  const ordersQuery = useListOrders(
    { accountId, mode: environment },
    {
      query: {
        enabled: Boolean(brokerAuthenticated && accountId),
        ...QUERY_DEFAULTS,
        refetchInterval: false,
      },
    },
  );
  useIbkrOrderSnapshotStream({
    accountId,
    mode: environment,
    enabled: Boolean(brokerAuthenticated && accountId),
  });
  const executionsQuery = useQuery({
    queryKey: ["broker-executions", accountId, environment],
    queryFn: () =>
      listBrokerExecutionsRequest({
        accountId,
        days: 7,
        limit: 64,
      }),
    enabled: Boolean(brokerAuthenticated && accountId),
    staleTime: 5_000,
    refetchInterval: false,
    retry: false,
  });
  useEffect(() => {
    if (
      !brokerAuthenticated ||
      !accountId ||
      typeof window === "undefined" ||
      typeof window.EventSource === "undefined"
    ) {
      return undefined;
    }

    const params = new URLSearchParams({
      accountId,
      days: "7",
      limit: "64",
    });
    const source = new EventSource(`/api/streams/executions?${params.toString()}`);
    const handleExecutions = (event) => {
      try {
        const payload = JSON.parse(event.data);
        queryClient.setQueryData(
          ["broker-executions", accountId, environment],
          payload,
        );
      } catch {}
    };

    source.addEventListener("executions", handleExecutions);
    return () => {
      source.removeEventListener("executions", handleExecutions);
      source.close();
    };
  }, [accountId, brokerAuthenticated, environment, queryClient]);
  const refreshBrokerQueries = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
    queryClient.invalidateQueries({ queryKey: ["/api/positions"] });
    queryClient.invalidateQueries({ queryKey: ["broker-executions"] });
  }, [queryClient]);
  const placeOrderMutation = usePlaceOrder({
    mutation: {
      onSuccess: () => {
        refreshBrokerQueries();
      },
    },
  });
  const previewOrderMutation = usePreviewOrder();
  const replaceOrderMutation = useReplaceOrder({
    mutation: {
      onSuccess: () => {
        refreshBrokerQueries();
      },
    },
  });
  const cancelOrderMutation = useCancelOrder({
    mutation: {
      onSuccess: (response) => {
        refreshBrokerQueries();
        toast.push({
          kind: "success",
          title: "Cancel submitted",
          body: `${response.orderId} · ${response.message}`,
        });
      },
      onError: (error) => {
        toast.push({
          kind: "error",
          title: "Cancel failed",
          body:
            error?.message || "The broker did not accept the cancel request.",
        });
      },
    },
  });
  const [liveConfirmState, setLiveConfirmState] = useState(null);
  const [liveConfirmPending, setLiveConfirmPending] = useState(false);
  const closeLiveConfirm = () => {
    if (liveConfirmPending) {
      return;
    }

    setLiveConfirmState(null);
  };
  const runLiveConfirm = async () => {
    if (!liveConfirmState?.onConfirm) {
      return;
    }

    setLiveConfirmPending(true);
    try {
      await liveConfirmState.onConfirm();
      setLiveConfirmState(null);
    } finally {
      setLiveConfirmPending(false);
    }
  };

  const openPositions = useMemo(() => {
    if (brokerConfigured) {
      if (!brokerAuthenticated || !accountId) {
        return [];
      }

      return (positionsQuery.data?.positions || []).map((position) => {
        const isOption = Boolean(position.optionContract);
        const expiration = isOption
          ? formatExpirationLabel(position.optionContract.expirationDate)
          : "EQUITY";
        const contract = isOption
          ? `${position.optionContract.strike} ${position.optionContract.right === "call" ? "C" : "P"} ${expiration}`
          : "EQUITY";

        return {
          _isUser: false,
          _isLive: true,
          _id: position.id,
          _brokerPosition: position,
          ticker: position.symbol,
          side: position.quantity >= 0 ? "LONG" : "SHORT",
          contract,
          qty: Math.abs(position.quantity),
          entry: position.averagePrice,
          mark: position.marketPrice,
          pnl: position.unrealizedPnl,
          pct: position.unrealizedPnlPercent,
          sl: null,
          tp: null,
        };
      });
    }

    return pos.positions.map((p) => ({
        _isUser: true,
        _isLive: false,
        _id: p.id,
        _position: p,
        ticker: p.ticker,
        side:
          p.kind === "option" ? (p.side === "BUY" ? "LONG" : "SHORT") : p.side,
        contract:
          p.kind === "option"
            ? `${p.strike} ${p.cp} ${p.exp}`
            : `${p.side} EQUITY`,
        qty: p.qty,
        entry: p.entry,
        mark: null,
        pnl: null,
        pct: null,
        sl: p.stopLoss ?? +(p.entry * 0.65).toFixed(2),
        tp: p.takeProfit ?? +(p.entry * 1.75).toFixed(2),
      }));
  }, [
    accountId,
    brokerAuthenticated,
    brokerConfigured,
    pos.positions,
    positionsQuery.data,
  ]);
  const liveOrders = useMemo(
    () =>
      [...(ordersQuery.data?.orders || [])].sort((left, right) => {
        return (
          new Date(right.updatedAt).getTime() -
          new Date(left.updatedAt).getTime()
        );
      }),
    [ordersQuery.data],
  );
  const executionRows = useMemo(
    () =>
      (executionsQuery.data?.executions || []).map((execution) => ({
        id: execution.id,
        ticker: execution.symbol,
        side: String(execution.side || "").toLowerCase() === "buy" ? "BUY" : "SELL",
        contract: formatExecutionContractLabel(execution),
        qty: execution.quantity,
        price: execution.price,
        netAmount: execution.netAmount,
        exchange: execution.exchange,
        executedAt: execution.executedAt,
      })),
    [executionsQuery.data],
  );

  const totalOpenPnl = openPositions.reduce(
    (sum, position) =>
      sum + (isFiniteNumber(position.pnl) ? position.pnl : 0),
    0,
  );
  const hasOpenPnl = openPositions.some((position) => isFiniteNumber(position.pnl));
  const pendingOrderCount = liveOrders.filter(
    (order) => !FINAL_ORDER_STATUSES.has(order.status),
  ).length;
  const parseContract = (str) => {
    const parts = str.split(" ");
    return { strike: parseFloat(parts[0]), cp: parts[1], exp: parts[2] };
  };
  const buildOptionContractPayload = (optionContract) =>
    optionContract
      ? {
          ticker: optionContract.ticker,
          underlying: optionContract.underlying,
          expirationDate: optionContract.expirationDate,
          strike: optionContract.strike,
          right: optionContract.right,
          multiplier: optionContract.multiplier,
          sharesPerContract: optionContract.sharesPerContract,
          providerContractId: optionContract.providerContractId,
        }
      : null;
  const buildCloseOrderRequest = (position) => ({
    accountId,
    mode: environment,
    symbol: position.symbol,
    assetClass: position.assetClass,
    side: position.quantity >= 0 ? "sell" : "buy",
    type: "market",
    quantity: Math.abs(position.quantity),
    timeInForce: "day",
    optionContract: buildOptionContractPayload(position.optionContract),
  });
  const buildStopOrderRequest = (position, stopPrice) => ({
    accountId,
    mode: environment,
    symbol: position.symbol,
    assetClass: position.assetClass,
    side: position.quantity >= 0 ? "sell" : "buy",
    type: "stop",
    quantity: Math.abs(position.quantity),
    stopPrice,
    timeInForce: "gtc",
    optionContract: buildOptionContractPayload(position.optionContract),
  });
  const findExistingStopOrder = (position) =>
    liveOrders.find((order) => {
      if (FINAL_ORDER_STATUSES.has(order.status) || order.type !== "stop") {
        return false;
      }
      if (order.symbol !== position.symbol) {
        return false;
      }
      if (order.side !== (position.quantity >= 0 ? "sell" : "buy")) {
        return false;
      }
      if (position.optionContract || order.optionContract) {
        return sameOptionContract(order.optionContract, position.optionContract);
      }
      return true;
    }) || null;
  const historyCount = executionRows.length;
  const headerSummaryColor =
    tab === "orders"
      ? pendingOrderCount > 0
        ? T.amber
        : T.textDim
      : tab === "history" && brokerConfigured
        ? historyCount > 0
          ? T.accent
          : T.textDim
        : hasOpenPnl
          ? totalOpenPnl >= 0
            ? T.green
            : T.red
          : T.textDim;
  const headerSummaryValue =
    tab === "orders"
      ? `${pendingOrderCount} LIVE`
      : tab === "history" && brokerConfigured
        ? `${historyCount} FILLS`
        : hasOpenPnl
          ? `${totalOpenPnl >= 0 ? "+" : ""}$${totalOpenPnl.toFixed(0)}`
          : MISSING_VALUE;

  const closeRow = async (p) => {
    if (brokerConfigured && !brokerAuthenticated) {
      toast.push({
        kind: "warn",
        title: "IBKR login required",
        body: "Bring the local IBKR bridge online before managing live positions.",
      });
      return;
    }

    if (p._isLive && p._brokerPosition) {
      setLiveConfirmState({
        title: `Flatten ${p.ticker} ${p.contract}`,
        detail: "Submit a live market order to close this broker position.",
        confirmLabel: "SEND LIVE CLOSE",
        confirmTone: T.red,
        lines: [
          { label: "ACCOUNT", value: accountId || MISSING_VALUE },
          { label: "SYMBOL", value: p.ticker },
          { label: "CONTRACT", value: p.contract },
          { label: "SIDE", value: p.side },
          { label: "QTY", value: String(p.qty) },
        ],
        onConfirm: async () => {
          await placeOrderMutation.mutateAsync({
            data: {
              ...buildCloseOrderRequest(p._brokerPosition),
              confirm: true,
            },
          });
          toast.push({
            kind: "success",
            title: "Close submitted",
            body: `${p.ticker} ${p.contract} · ${p.qty} to flatten`,
          });
        },
      });
      return;
    }

    if (p._isUser) {
      pos.closePosition(p._id);
    }
    toast.push({
      kind: "success",
      title: "Position closed",
      body: `${p.ticker} ${p.contract}`,
    });
  };

  const handleCloseAll = async () => {
    if (brokerConfigured && !brokerAuthenticated) {
      toast.push({
        kind: "warn",
        title: "IBKR login required",
        body: "Authenticate the bridge before flattening live positions.",
      });
      return;
    }
    if (brokerConfigured && !accountId) {
      toast.push({
        kind: "warn",
        title: "No broker account selected",
        body: "The bridge is authenticated, but no IBKR account is active yet.",
      });
      return;
    }
    if (openPositions.length === 0) {
      toast.push({
        kind: "info",
        title: "Nothing to close",
        body: "No open positions.",
      });
      return;
    }

    if (brokerConfigured) {
      const livePositions = openPositions.filter((position) => position._isLive);
      setLiveConfirmState({
        title: `Flatten ${livePositions.length} live position${livePositions.length === 1 ? "" : "s"}`,
        detail:
          "Submit live broker orders to flatten every open IBKR position in the active account.",
        confirmLabel: "FLATTEN LIVE POSITIONS",
        confirmTone: T.red,
        lines: [
          { label: "ACCOUNT", value: accountId || MISSING_VALUE },
          { label: "POSITIONS", value: String(livePositions.length) },
        ],
        onConfirm: async () => {
          const results = await Promise.allSettled(
            livePositions.map((position) =>
              placeOrderMutation.mutateAsync({
                data: {
                  ...buildCloseOrderRequest(position._brokerPosition),
                  confirm: true,
                },
              }),
            ),
          );
          const successCount = results.filter(
            (result) => result.status === "fulfilled",
          ).length;
          toast.push({
            kind: successCount === livePositions.length ? "success" : "warn",
            title: `Submitted ${successCount}/${livePositions.length} close order${livePositions.length === 1 ? "" : "s"}`,
            body:
              successCount === livePositions.length
                ? "All live positions received flatten requests."
                : "Some live positions could not be flattened.",
          });
        },
      });
      return;
    }

    pos.closeAll();
    toast.push({
      kind: "success",
      title: `Closed ${openPositions.length} position${openPositions.length === 1 ? "" : "s"}`,
      body: "Local positions removed.",
    });
  };

  const handleSetStops = async () => {
    if (brokerConfigured && !brokerAuthenticated) {
      toast.push({
        kind: "warn",
        title: "IBKR login required",
        body: "Authenticate the bridge before modifying live risk controls.",
      });
      return;
    }
    if (brokerConfigured && !accountId) {
      toast.push({
        kind: "warn",
        title: "No broker account selected",
        body: "The bridge is authenticated, but no IBKR account is active yet.",
      });
      return;
    }
    if (openPositions.length === 0) {
      toast.push({
        kind: "info",
        title: "No positions",
        body: "Nothing to protect.",
      });
      return;
    }

    if (brokerConfigured) {
      const livePositions = (positionsQuery.data?.positions || []).filter(
        (position) => Math.abs(position.quantity) > 0,
      );
      setLiveConfirmState({
        title: `Protect ${livePositions.length} live position${livePositions.length === 1 ? "" : "s"}`,
        detail:
          "Preview and synchronize live protective stop orders for every open broker position.",
        confirmLabel: "SYNC LIVE STOPS",
        confirmTone: T.amber,
        lines: [
          { label: "ACCOUNT", value: accountId || MISSING_VALUE },
          { label: "POSITIONS", value: String(livePositions.length) },
        ],
        onConfirm: async () => {
          let protectedCount = 0;
          let failedCount = 0;

          for (const position of livePositions) {
            const referencePrice =
              isFiniteNumber(position.marketPrice) && position.marketPrice > 0
                ? position.marketPrice
                : position.averagePrice;
            if (!isFiniteNumber(referencePrice) || referencePrice <= 0) {
              failedCount += 1;
              continue;
            }

            const stopPrice = +(
              position.quantity >= 0
                ? referencePrice * 0.8
                : referencePrice * 1.2
            ).toFixed(2);
            const stopRequest = buildStopOrderRequest(position, stopPrice);

            try {
              const preview = await previewOrderMutation.mutateAsync({
                data: stopRequest,
              });
              const existingStop = findExistingStopOrder(position);

              if (existingStop && preview?.orderPayload) {
                await replaceOrderMutation.mutateAsync({
                  orderId: existingStop.id,
                  data: {
                    accountId,
                    mode: environment,
                    confirm: true,
                    order: preview.orderPayload,
                  },
                });
              } else {
                await placeOrderMutation.mutateAsync({
                  data: {
                    ...stopRequest,
                    confirm: true,
                  },
                });
              }

              protectedCount += 1;
            } catch (error) {
              failedCount += 1;
            }
          }

          toast.push({
            kind:
              failedCount === 0 ? "success" : protectedCount ? "warn" : "error",
            title: `Stops updated ${protectedCount}/${livePositions.length}`,
            body:
              failedCount === 0
                ? "Protective broker stop orders are in sync."
                : "Some positions could not be protected.",
          });
        },
      });
      return;
    }

    const userPositions = openPositions.filter((p) => p._isUser);
    userPositions.forEach((p) => {
      pos.updateStops(p._id, {
        stopLoss: +(p.entry * 0.8).toFixed(2),
        takeProfit: +(p.entry * 1.5).toFixed(2),
      });
    });
    toast.push({
      kind: "success",
      title: "Stops applied",
      body: `Protected ${userPositions.length} local position${userPositions.length === 1 ? "" : "s"}.`,
    });
  };

  const handleRollAll = () => {
    if (brokerConfigured && !brokerAuthenticated) {
      toast.push({
        kind: "warn",
        title: "IBKR login required",
        body: "Authenticate the bridge before attempting a live roll workflow.",
      });
      return;
    }
    if (brokerConfigured && !accountId) {
      toast.push({
        kind: "warn",
        title: "No broker account selected",
        body: "The bridge is authenticated, but no IBKR account is active yet.",
      });
      return;
    }
    if (brokerConfigured && accountId) {
      toast.push({
        kind: "info",
        title: "Live roll workflow disabled",
        body: "Rolling live positions remains disabled until a multi-leg IBKR workflow is implemented.",
      });
      return;
    }
    const userPositions = pos.positions.filter((p) => p.kind === "option");
    if (userPositions.length === 0) {
      toast.push({
        kind: "info",
        title: "Nothing to roll",
        body: "No option positions.",
      });
      return;
    }
    userPositions.forEach((p) => pos.rollPosition(p.id));
    toast.push({
      kind: "success",
      title: `Rolled ${userPositions.length} position${userPositions.length === 1 ? "" : "s"}`,
      body: `Extended expiration to next cycle`,
    });
  };

  const handleCancelOrder = (order) => {
    if (!brokerAuthenticated) {
      toast.push({
        kind: "warn",
        title: "IBKR login required",
        body: "Authenticate the bridge before canceling live orders.",
      });
      return;
    }

    if (!accountId) {
      toast.push({
        kind: "warn",
        title: "No broker account selected",
        body: "The bridge is authenticated, but no IBKR account is active yet.",
      });
      return;
    }

    setLiveConfirmState({
      title: `Cancel ${order.symbol} ${order.type.toUpperCase()} order`,
      detail: "Send a live broker cancellation request for this working IBKR order.",
      confirmLabel: "CANCEL LIVE ORDER",
      confirmTone: T.red,
      lines: [
        { label: "ACCOUNT", value: accountId || MISSING_VALUE },
        { label: "SYMBOL", value: order.symbol },
        { label: "SIDE", value: order.side.toUpperCase() },
        { label: "TYPE", value: order.type.toUpperCase() },
        { label: "QTY", value: String(order.quantity) },
        { label: "STATUS", value: formatEnumLabel(order.status) },
      ],
      onConfirm: async () => {
        await cancelOrderMutation.mutateAsync({
          orderId: order.id,
          data: {
            accountId,
            manualIndicator: true,
            confirm: true,
          },
        });
      },
    });
  };

  return (
    <div
      style={{
        background: T.bg2,
        border: `1px solid ${T.border}`,
        borderRadius: dim(6),
        padding: sp("8px 10px"),
        display: "flex",
        flexDirection: "column",
        gap: sp(4),
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          borderBottom: `1px solid ${T.border}`,
          paddingBottom: 4,
          gap: sp(4),
        }}
      >
        <div
          style={{
            display: "flex",
            gap: sp(5),
            alignItems: "center",
            minWidth: 0,
          }}
        >
          <button
            onClick={() => setTab("open")}
            style={{
              background: "transparent",
              border: "none",
              padding: sp(0),
              fontSize: fs(9),
              fontWeight: 700,
              color: tab === "open" ? T.text : T.textMuted,
              fontFamily: T.display,
              letterSpacing: "0.04em",
              cursor: "pointer",
              borderBottom:
                tab === "open"
                  ? `2px solid ${T.accent}`
                  : "2px solid transparent",
              paddingBottom: 2,
              whiteSpace: "nowrap",
            }}
          >
            OPEN{" "}
            <span style={{ color: T.textMuted, fontWeight: 400 }}>
              {openPositions.length}
            </span>
          </button>
          <button
            onClick={() => setTab("history")}
            style={{
              background: "transparent",
              border: "none",
              padding: sp(0),
              fontSize: fs(9),
              fontWeight: 700,
              color: tab === "history" ? T.text : T.textMuted,
              fontFamily: T.display,
              letterSpacing: "0.04em",
              cursor: "pointer",
              borderBottom:
                tab === "history"
                  ? `2px solid ${T.accent}`
                  : "2px solid transparent",
              paddingBottom: 2,
              whiteSpace: "nowrap",
            }}
          >
            HIST{" "}
            <span style={{ color: T.textMuted, fontWeight: 400 }}>
              {historyCount}
            </span>
          </button>
          <button
            onClick={() => setTab("orders")}
            style={{
              background: "transparent",
              border: "none",
              padding: sp(0),
              fontSize: fs(9),
              fontWeight: 700,
              color: tab === "orders" ? T.text : T.textMuted,
              fontFamily: T.display,
              letterSpacing: "0.04em",
              cursor: "pointer",
              borderBottom:
                tab === "orders"
                  ? `2px solid ${T.accent}`
                  : "2px solid transparent",
              paddingBottom: 2,
              whiteSpace: "nowrap",
            }}
          >
            ORDERS{" "}
            <span style={{ color: T.textMuted, fontWeight: 400 }}>
              {brokerConfigured ? liveOrders.length : 0}
            </span>
          </button>
        </div>
        <span
          style={{
            fontSize: fs(10),
            fontWeight: 700,
            fontFamily: T.mono,
            color: headerSummaryColor,
            whiteSpace: "nowrap",
          }}
        >
          {headerSummaryValue}
        </span>
      </div>
      {tab === "open" ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            minHeight: 0,
            overflow: "auto",
          }}
        >
          {brokerConfigured && !brokerAuthenticated ? (
            <div
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: T.amber,
                fontSize: fs(10),
                fontFamily: T.sans,
                padding: sp(16),
                textAlign: "center",
                lineHeight: 1.45,
              }}
            >
              IBKR is configured, but live positions stay hidden until the local
              bridge authenticates.
            </div>
          ) : brokerConfigured && !accountId ? (
            <div
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: T.amber,
                fontSize: fs(10),
                fontFamily: T.sans,
                padding: sp(16),
                textAlign: "center",
                lineHeight: 1.45,
              }}
            >
              The bridge is authenticated, but no IBKR account is active yet.
            </div>
          ) : openPositions.length === 0 ? (
            <div
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: T.textDim,
                fontSize: fs(10),
                fontFamily: T.sans,
                padding: sp(16),
              }}
            >
              No open positions
            </div>
          ) : (
            <>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    "34px 32px 78px 22px 48px 48px 44px 42px 18px",
                  gap: sp(3),
                  fontSize: fs(7),
                  color: T.textMuted,
                  letterSpacing: "0.08em",
                  padding: "0 4px",
                }}
              >
                <span>TICK</span>
                <span>SIDE</span>
                <span>CONTRACT</span>
                <span style={{ textAlign: "right" }}>QTY</span>
                <span style={{ textAlign: "right" }}>ENTRY</span>
                <span style={{ textAlign: "right" }}>MARK</span>
                <span style={{ textAlign: "right" }}>P&L</span>
                <span style={{ textAlign: "right" }}>%</span>
                <span></span>
              </div>
              {openPositions.map((p) => {
                const isLoadable =
                  p.contract && p.contract.match(/\d+\s[CP]\s/);
                return (
                  <div
                    key={p._id}
                    onClick={() => {
                      if (isLoadable) {
                        const parsed = parseContract(p.contract);
                        onLoadPosition({ ticker: p.ticker, ...parsed });
                      }
                    }}
                    title={
                      isLoadable
                        ? `Click to load ${p.ticker} ${p.contract} into Order Ticket`
                        : `${p.ticker} equity position`
                    }
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        "34px 32px 78px 22px 48px 48px 44px 42px 18px",
                      gap: sp(3),
                      padding: sp("3px 4px"),
                      fontSize: fs(9),
                      fontFamily: T.mono,
                      borderBottom: `1px solid ${T.border}08`,
                      cursor: isLoadable ? "pointer" : "default",
                      alignItems: "center",
                      transition: "background 0.1s",
                      background: p._isUser ? `${T.accent}08` : "transparent",
                    }}
                    onMouseEnter={(e) => {
                      if (isLoadable) e.currentTarget.style.background = T.bg3;
                    }}
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background = p._isUser
                        ? `${T.accent}08`
                        : "transparent")
                    }
                  >
                    <span style={{ fontWeight: 700, color: T.text }}>
                      {p.ticker}
                    </span>
                    <span
                      style={{
                        color: p.side === "LONG" ? T.green : T.red,
                        fontWeight: 600,
                        fontSize: fs(7),
                        padding: sp("1px 4px"),
                        background:
                          p.side === "LONG" ? `${T.green}15` : `${T.red}15`,
                        borderRadius: dim(2),
                        border: `1px solid ${p.side === "LONG" ? T.green : T.red}30`,
                        textAlign: "center",
                        alignSelf: "center",
                      }}
                    >
                      {p.side}
                    </span>
                    <span style={{ color: T.textSec, fontSize: fs(8) }}>
                      {p.contract}
                    </span>
                    <span style={{ color: T.textDim, textAlign: "right" }}>
                      {p.qty}
                    </span>
                    <span style={{ color: T.textDim, textAlign: "right" }}>
                      {formatPriceValue(p.entry)}
                    </span>
                    <span
                      style={{
                        color: T.text,
                        fontWeight: 600,
                        textAlign: "right",
                      }}
                    >
                      {isFiniteNumber(p.mark)
                        ? `$${p.mark.toFixed(2)}`
                        : MISSING_VALUE}
                    </span>
                    <span
                      style={{
                        color:
                          !isFiniteNumber(p.pnl)
                            ? T.textDim
                            : p.pnl >= 0
                              ? T.green
                              : T.red,
                        fontWeight: 700,
                        textAlign: "right",
                      }}
                    >
                      {isFiniteNumber(p.pnl)
                        ? `${p.pnl >= 0 ? "+" : ""}$${p.pnl.toFixed(0)}`
                        : MISSING_VALUE}
                    </span>
                    <span
                      style={{
                        color:
                          !isFiniteNumber(p.pct)
                            ? T.textDim
                            : p.pct >= 0
                              ? T.green
                              : T.red,
                        fontWeight: 600,
                        textAlign: "right",
                        fontSize: fs(8),
                      }}
                    >
                      {formatSignedPercent(p.pct, 1)}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        closeRow(p);
                      }}
                      title={p._isLive ? "Submit broker close-out order" : "Close position"}
                      style={{
                        background: "transparent",
                        border: `1px solid ${T.red}40`,
                        color: T.red,
                        fontSize: fs(9),
                        fontFamily: T.mono,
                        fontWeight: 700,
                        borderRadius: dim(2),
                        cursor: "pointer",
                        padding: sp("1px 0"),
                        lineHeight: 1,
                        opacity: 1,
                      }}
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
            </>
          )}
        </div>
      ) : tab === "history" ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            minHeight: 0,
            overflow: "auto",
          }}
        >
          {!brokerConfigured ? (
            <div
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: T.textDim,
                fontSize: fs(10),
                fontFamily: T.sans,
              padding: sp(16),
              textAlign: "center",
            }}
          >
              No broker history is available until the IBKR bridge is configured and fills exist on the selected account.
            </div>
          ) : !brokerAuthenticated ? (
            <div
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: T.amber,
                fontSize: fs(10),
                fontFamily: T.sans,
                padding: sp(16),
                textAlign: "center",
                lineHeight: 1.45,
              }}
            >
              Bring the local IBKR bridge online to load broker fills.
            </div>
          ) : !accountId ? (
            <div
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: T.amber,
                fontSize: fs(10),
                fontFamily: T.sans,
                padding: sp(16),
                textAlign: "center",
                lineHeight: 1.45,
              }}
            >
              The bridge is authenticated, but no IBKR account is active yet.
            </div>
          ) : executionsQuery.isPending && !executionRows.length ? (
            <div
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: T.textDim,
                fontSize: fs(10),
                fontFamily: T.sans,
                padding: sp(16),
              }}
            >
              Loading broker fills…
            </div>
          ) : !executionRows.length ? (
            <div
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: T.textDim,
                fontSize: fs(10),
                fontFamily: T.sans,
                padding: sp(16),
              }}
            >
              No broker executions
            </div>
          ) : (
            <>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    "40px 30px minmax(0,1fr) 24px 50px 64px 42px",
                  gap: sp(3),
                  fontSize: fs(7),
                  color: T.textMuted,
                  letterSpacing: "0.08em",
                  padding: "0 4px",
                }}
              >
                <span>SYM</span>
                <span>SIDE</span>
                <span>CONTRACT</span>
                <span style={{ textAlign: "right" }}>QTY</span>
                <span style={{ textAlign: "right" }}>PRICE</span>
                <span style={{ textAlign: "right" }}>NET</span>
                <span style={{ textAlign: "right" }}>TIME</span>
              </div>
              {executionRows.map((execution) => (
                <div
                  key={execution.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns:
                      "40px 30px minmax(0,1fr) 24px 50px 64px 42px",
                    gap: sp(3),
                    padding: sp("3px 4px"),
                    fontSize: fs(9),
                    fontFamily: T.mono,
                    borderBottom: `1px solid ${T.border}08`,
                    alignItems: "center",
                  }}
                >
                  <span style={{ fontWeight: 700, color: T.text }}>
                    {execution.ticker}
                  </span>
                  <span
                    style={{
                      color: execution.side === "BUY" ? T.green : T.red,
                      fontWeight: 700,
                    }}
                  >
                    {execution.side}
                  </span>
                  <span
                    style={{
                      color: T.textSec,
                      fontSize: fs(8),
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                    title={execution.contract}
                  >
                    {execution.contract}
                  </span>
                  <span style={{ color: T.textDim, textAlign: "right" }}>
                    {execution.qty}
                  </span>
                  <span style={{ color: T.textDim, textAlign: "right" }}>
                    {isFiniteNumber(execution.price)
                      ? `$${execution.price.toFixed(2)}`
                      : MISSING_VALUE}
                  </span>
                  <span
                    style={{
                      color:
                        !isFiniteNumber(execution.netAmount)
                          ? T.textDim
                          : execution.netAmount >= 0
                            ? T.green
                            : T.red,
                      textAlign: "right",
                    }}
                    >
                      {isFiniteNumber(execution.netAmount)
                        ? `${execution.netAmount >= 0 ? "+" : "-"}$${Math.abs(execution.netAmount).toFixed(0)}`
                        : MISSING_VALUE}
                  </span>
                  <span
                    style={{
                      color: T.textDim,
                      textAlign: "right",
                      fontSize: fs(7),
                    }}
                  >
                    {formatEtTime(execution.executedAt)}
                  </span>
                </div>
              ))}
            </>
          )}
        </div>
      ) : (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            minHeight: 0,
            overflow: "auto",
          }}
        >
          {!brokerConfigured ? (
            <div
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: T.textDim,
                fontSize: fs(10),
                fontFamily: T.sans,
                padding: sp(16),
                textAlign: "center",
                lineHeight: 1.45,
              }}
            >
              The live order blotter activates after IBKR is configured.
            </div>
          ) : !brokerAuthenticated ? (
            <div
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: T.amber,
                fontSize: fs(10),
                fontFamily: T.sans,
                padding: sp(16),
                textAlign: "center",
                lineHeight: 1.45,
              }}
            >
              Bring the local IBKR bridge online to load live IBKR
              orders.
            </div>
          ) : !accountId ? (
            <div
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: T.amber,
                fontSize: fs(10),
                fontFamily: T.sans,
                padding: sp(16),
                textAlign: "center",
                lineHeight: 1.45,
              }}
            >
              The bridge is authenticated, but no IBKR account is active yet.
            </div>
          ) : ordersQuery.isPending && !liveOrders.length ? (
            <div
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: T.textDim,
                fontSize: fs(10),
                fontFamily: T.sans,
                padding: sp(16),
              }}
            >
              Loading live orders…
            </div>
          ) : !liveOrders.length ? (
            <div
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: T.textDim,
                fontSize: fs(10),
                fontFamily: T.sans,
                padding: sp(16),
              }}
            >
              No broker orders
            </div>
          ) : (
            <>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    "42px 30px 44px 22px 28px 58px 42px 24px",
                  gap: sp(3),
                  fontSize: fs(7),
                  color: T.textMuted,
                  letterSpacing: "0.08em",
                  padding: "0 4px",
                }}
              >
                <span>SYM</span>
                <span>SIDE</span>
                <span>TYPE</span>
                <span style={{ textAlign: "right" }}>QTY</span>
                <span style={{ textAlign: "right" }}>FILL</span>
                <span style={{ textAlign: "right" }}>STATUS</span>
                <span style={{ textAlign: "right" }}>TIME</span>
                <span></span>
              </div>
              {liveOrders.map((order) => {
                const isTerminal = FINAL_ORDER_STATUSES.has(order.status);
                const isOption = Boolean(order.optionContract);
                return (
                  <div
                    key={order.id}
                    onClick={() => {
                      if (!isOption) return;
                      onLoadPosition({
                        ticker: order.symbol,
                        strike: order.optionContract.strike,
                        cp: order.optionContract.right === "call" ? "C" : "P",
                        exp: formatExpirationLabel(
                          order.optionContract.expirationDate,
                        ),
                      });
                    }}
                    title={
                      isOption
                        ? `Load ${order.symbol} ${order.optionContract.strike}${order.optionContract.right === "call" ? "C" : "P"} into Order Ticket`
                        : order.id
                    }
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        "42px 30px 44px 22px 28px 58px 42px 24px",
                      gap: sp(3),
                      padding: sp("3px 4px"),
                      fontSize: fs(9),
                      fontFamily: T.mono,
                      borderBottom: `1px solid ${T.border}08`,
                      cursor: isOption ? "pointer" : "default",
                      alignItems: "center",
                    }}
                  >
                    <span style={{ fontWeight: 700, color: T.text }}>
                      {order.symbol}
                    </span>
                    <span
                      style={{
                        color: order.side === "buy" ? T.green : T.red,
                        fontWeight: 700,
                      }}
                    >
                      {order.side === "buy" ? "BUY" : "SELL"}
                    </span>
                    <span style={{ color: T.textSec }}>
                      {order.type.toUpperCase()}
                    </span>
                    <span style={{ color: T.textDim, textAlign: "right" }}>
                      {order.quantity}
                    </span>
                    <span style={{ color: T.textDim, textAlign: "right" }}>
                      {order.filledQuantity}
                    </span>
                    <span
                      style={{
                        color: orderStatusColor(order.status),
                        textAlign: "right",
                        fontSize: fs(8),
                        fontWeight: 700,
                      }}
                    >
                      {formatEnumLabel(order.status)}
                    </span>
                    <span
                      style={{
                        color: T.textDim,
                        textAlign: "right",
                        fontSize: fs(7),
                      }}
                    >
                      {formatRelativeTimeShort(order.updatedAt)}
                    </span>
                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        handleCancelOrder(order);
                      }}
                      disabled={isTerminal || cancelOrderMutation.isPending}
                      title={isTerminal ? "Terminal order" : "Cancel order"}
                      style={{
                        background: "transparent",
                        border: `1px solid ${isTerminal ? T.border : T.red}40`,
                        color: isTerminal ? T.textDim : T.red,
                        fontSize: fs(9),
                        fontFamily: T.mono,
                        fontWeight: 700,
                        borderRadius: dim(2),
                        cursor:
                          isTerminal || cancelOrderMutation.isPending
                            ? "not-allowed"
                            : "pointer",
                        padding: sp("1px 0"),
                        lineHeight: 1,
                        opacity: isTerminal ? 0.45 : 1,
                      }}
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}
      {tab !== "orders" ? (
        <div
          style={{
            display: "flex",
            gap: sp(4),
            borderTop: `1px solid ${T.border}`,
            paddingTop: sp(5),
            marginTop: "auto",
          }}
        >
          <button
            onClick={handleCloseAll}
            style={{
              flex: 1,
              padding: sp("4px 0"),
              background: "transparent",
              border: `1px solid ${T.red}40`,
              borderRadius: dim(3),
              color: T.red,
              fontSize: fs(9),
              fontFamily: T.sans,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Close All
          </button>
          <button
            onClick={handleSetStops}
            style={{
              flex: 1,
              padding: sp("4px 0"),
              background: "transparent",
              border: `1px solid ${T.border}`,
              borderRadius: dim(3),
              color: T.textSec,
              fontSize: fs(9),
              fontFamily: T.sans,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Set Stops
          </button>
          <button
            onClick={handleRollAll}
            style={{
              flex: 1,
              padding: sp("4px 0"),
              background: "transparent",
              border: `1px solid ${T.amber}40`,
              borderRadius: dim(3),
              color: T.amber,
              fontSize: fs(9),
              fontFamily: T.sans,
              fontWeight: 600,
              cursor:
                brokerConfigured && brokerAuthenticated && accountId
                  ? "not-allowed"
                  : "pointer",
              opacity:
                brokerConfigured && brokerAuthenticated && accountId ? 0.6 : 1,
            }}
          >
            Roll
          </button>
        </div>
      ) : (
        <div
          style={{
            borderTop: `1px solid ${T.border}`,
            paddingTop: sp(5),
            marginTop: "auto",
            fontSize: fs(8),
            color: T.textDim,
            fontFamily: T.mono,
          }}
        >
          {brokerConfigured
            ? `${pendingOrderCount} non-terminal order${pendingOrderCount === 1 ? "" : "s"}`
            : "Connect IBKR to enable live order management."}
        </div>
      )}
      <BrokerActionConfirmDialog
        open={Boolean(liveConfirmState)}
        title={liveConfirmState?.title || "Confirm live broker action"}
        detail={
          liveConfirmState?.detail ||
          "Confirm this live Interactive Brokers action before sending it."
        }
        lines={liveConfirmState?.lines || []}
        confirmLabel={liveConfirmState?.confirmLabel || "CONFIRM LIVE ACTION"}
        confirmTone={liveConfirmState?.confirmTone || T.red}
        pending={liveConfirmPending}
        onCancel={closeLiveConfirm}
        onConfirm={runLiveConfirm}
      />
    </div>
  );
};

const TickerUniverseSearchPanel = ({ open, onSelectTicker, onClose }) => {
  const inputRef = useRef(null);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const { deferredQuery, searchEnabled, searchQuery, results, selectableResults } =
    useTickerSearchController({
      open,
      query,
      currentTicker: "",
      recentTickers: [],
      limit: 12,
    });

  useEffect(() => {
    if (!open) {
      setQuery("");
      setActiveIndex(0);
      return undefined;
    }

    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });

    return () => cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [open, deferredQuery, selectableResults.length]);

  const handleSelect = useCallback(
    (result) => {
      if (!result) {
        return;
      }
      onSelectTicker(result);
    },
    [onSelectTicker],
  );

  const handleInputKeyDown = useCallback(
    (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((current) =>
          selectableResults.length
            ? Math.min(current + 1, selectableResults.length - 1)
            : 0,
        );
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((current) =>
          selectableResults.length ? Math.max(current - 1, 0) : 0,
        );
        return;
      }
      if (event.key === "Enter") {
        if (selectableResults[activeIndex]) {
          event.preventDefault();
          handleSelect(selectableResults[activeIndex]);
        }
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        onClose?.();
      }
    },
    [activeIndex, handleSelect, onClose, selectableResults],
  );

  if (!open) {
    return null;
  }

  return (
    <div
      style={{
        padding: sp("6px 6px 0"),
        background: T.bg1,
        borderBottom: `1px solid ${T.border}`,
        flexShrink: 0,
      }}
    >
      <div
        style={{
          background: T.bg2,
          border: `1px solid ${T.border}`,
          borderRadius: dim(6),
          padding: sp("8px 10px"),
          display: "flex",
          flexDirection: "column",
          gap: sp(6),
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: sp(8),
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
            <span
              style={{
                fontSize: fs(10),
                fontWeight: 700,
                fontFamily: T.display,
                color: T.textSec,
                letterSpacing: "0.06em",
              }}
            >
              SEARCH UNIVERSE
            </span>
            <span
              style={{ fontSize: fs(8), color: T.textDim, fontFamily: T.mono }}
            >
              Provider-backed ticker search · active stocks
            </span>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: T.textMuted,
              cursor: "pointer",
              fontSize: fs(12),
              lineHeight: 1,
              padding: 0,
            }}
            title="Close search"
          >
            ×
          </button>
        </div>
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleInputKeyDown}
          placeholder="Search ticker or company..."
          style={{
            width: "100%",
            background: T.bg3,
            border: `1px solid ${T.border}`,
            borderRadius: dim(4),
            padding: sp("7px 10px"),
            color: T.text,
            fontSize: fs(11),
            fontFamily: T.sans,
            outline: "none",
          }}
        />
        <div
          style={{
            minHeight: dim(150),
            maxHeight: dim(220),
            overflowY: "auto",
            border: `1px solid ${T.border}`,
            borderRadius: dim(4),
            background: T.bg1,
          }}
        >
          {!searchEnabled && (
            <div
              style={{
                padding: sp("12px 10px"),
                fontSize: fs(10),
                color: T.textDim,
                fontFamily: T.sans,
              }}
            >
              Type at least two characters to search the ticker universe.
            </div>
          )}
          {searchEnabled && searchQuery.isPending && (
            <div
              style={{
                padding: sp("12px 10px"),
                fontSize: fs(10),
                color: T.textDim,
                fontFamily: T.sans,
              }}
            >
              Searching active stock universe…
            </div>
          )}
          {searchEnabled && !searchQuery.isPending && !results.length && (
            <div
              style={{
                padding: sp("12px 10px"),
                fontSize: fs(10),
                color: T.textDim,
                fontFamily: T.sans,
              }}
            >
              No active stock tickers matched "{deferredQuery}".
            </div>
          )}
          {results.map((result, index) => (
            <button
              key={buildTickerSearchRowKey(result)}
              role="option"
              aria-selected={index === activeIndex}
              onClick={() => handleSelect(result)}
              style={{
                width: "100%",
                display: "grid",
                gridTemplateColumns: "72px 1fr auto",
                gap: sp(8),
                alignItems: "center",
                padding: sp("9px 10px"),
                background: index === activeIndex ? T.bg3 : "transparent",
                border: "none",
                borderBottom: `1px solid ${T.border}20`,
                textAlign: "left",
                cursor: "pointer",
              }}
              onMouseEnter={() => setActiveIndex(index)}
            >
              <span
                style={{
                  fontSize: fs(11),
                  fontWeight: 700,
                  fontFamily: T.mono,
                  color: T.text,
                }}
              >
                {result.ticker}
              </span>
              <span style={{ minWidth: 0 }}>
                <span
                  style={{
                    display: "block",
                    fontSize: fs(10),
                    color: T.textSec,
                    fontFamily: T.sans,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {result.name}
                </span>
                <span
                  style={{
                    display: "block",
                    fontSize: fs(8),
                    color: T.textDim,
                    fontFamily: T.mono,
                  }}
                >
                  {[result.type, result.primaryExchange]
                    .filter(Boolean)
                    .join(" · ") || "stock"}
                </span>
              </span>
              <span
                style={{
                  fontSize: fs(8),
                  color: T.textMuted,
                  fontFamily: T.mono,
                  textTransform: "uppercase",
                }}
              >
                {result.provider || result.market.toUpperCase()}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

// ─── TICKER TAB STRIP ───
// Browser-style horizontal tabs of recently-viewed/pinned tickers.
// Click to switch the focused ticker. ✕ removes from strip.
const TickerTabStrip = ({ recent, active, onSelect, onClose, onAddNew }) => {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "stretch",
        gap: sp(1),
        padding: sp("4px 6px 0"),
        background: T.bg1,
        borderBottom: `1px solid ${T.border}`,
        overflowX: "auto",
        flexShrink: 0,
      }}
    >
      {recent.map((ticker) => {
        const info = ensureTradeTickerInfo(ticker, ticker);
        const pos = isFiniteNumber(info.pct) ? info.pct >= 0 : null;
        const isActive = ticker === active;
        return (
          <div
            key={ticker}
            onClick={() => onSelect(ticker)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: sp(5),
              padding: sp("4px 8px 5px"),
              background: isActive ? T.bg2 : "transparent",
              borderTop: isActive
                ? `2px solid ${T.accent}`
                : "2px solid transparent",
              borderLeft: `1px solid ${isActive ? T.border : "transparent"}`,
              borderRight: `1px solid ${isActive ? T.border : "transparent"}`,
              borderTopLeftRadius: dim(4),
              borderTopRightRadius: dim(4),
              cursor: "pointer",
              flexShrink: 0,
              position: "relative",
              top: 1,
            }}
          >
            <span
              style={{
                fontSize: fs(11),
                fontWeight: 700,
                fontFamily: T.mono,
                color: isActive ? T.text : T.textSec,
              }}
            >
              {ticker}
            </span>
            <span
              style={{
                fontSize: fs(9),
                fontFamily: T.mono,
                color: pos == null ? T.textDim : pos ? T.green : T.red,
                fontWeight: 600,
              }}
            >
              {formatSignedPercent(info.pct)}
            </span>
            {recent.length > 1 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onClose && onClose(ticker);
                }}
                title="Close"
                style={{
                  background: "transparent",
                  border: "none",
                  color: T.textMuted,
                  cursor: "pointer",
                  fontSize: fs(11),
                  padding: 0,
                  lineHeight: 1,
                  marginLeft: sp(2),
                }}
              >
                ×
              </button>
            )}
          </div>
        );
      })}
      <button
        onClick={onAddNew}
        title="Add ticker"
        style={{
          background: "transparent",
          border: "none",
          color: T.textDim,
          cursor: "pointer",
          fontSize: fs(13),
          padding: sp("3px 8px"),
          fontWeight: 600,
          lineHeight: 1,
        }}
      >
        +
      </button>
    </div>
  );
};

// ─── COMPACT TICKER HEADER ───
// One row showing ticker + price + key stats. Replaces the wide account strip on Trade tab.
const TradeTickerHeader = ({
  ticker,
  chainRows = [],
  expiration,
  chainStatus = "empty",
}) => {
  const info = ensureTradeTickerInfo(ticker, ticker);
  const pos = isFiniteNumber(info.pct) ? info.pct >= 0 : null;
  const atmRow = chainRows.find((r) => r.isAtm);
  const impMove =
    atmRow && isFiniteNumber(atmRow.cPrem) && isFiniteNumber(atmRow.pPrem)
      ? (atmRow.cPrem + atmRow.pPrem) * 0.85
      : null;
  const impPct =
    impMove != null && isFiniteNumber(info.price) && info.price > 0
      ? (impMove / info.price) * 100
      : null;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: sp(16),
        background: T.bg2,
        border: `1px solid ${T.border}`,
        borderRadius: dim(6),
        padding: sp("8px 14px"),
        flexShrink: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: sp(8) }}>
        <span
          style={{
            fontSize: fs(20),
            fontWeight: 800,
            fontFamily: T.display,
            color: T.text,
            letterSpacing: "-0.02em",
          }}
        >
          {ticker}
        </span>
        <span
          style={{ fontSize: fs(11), color: T.textDim, fontFamily: T.sans }}
        >
          {info.name || ticker}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: sp(8) }}>
        <span
          style={{
            fontSize: fs(22),
            fontWeight: 700,
            fontFamily: T.mono,
            color: T.text,
          }}
        >
          {formatQuotePrice(info.price)}
        </span>
        <span
          style={{
            fontSize: fs(12),
            fontWeight: 600,
            fontFamily: T.mono,
            color: pos == null ? T.textDim : pos ? T.green : T.red,
          }}
        >
          {isFiniteNumber(info.chg)
            ? `${info.chg >= 0 ? "▲ +" : "▼ "}${Math.abs(info.chg).toFixed(2)}`
            : MISSING_VALUE}
        </span>
        <span
          style={{
            fontSize: fs(12),
            fontWeight: 600,
            fontFamily: T.mono,
            color: pos == null ? T.textDim : pos ? T.green : T.red,
          }}
        >
          {isFiniteNumber(info.pct)
            ? `(${formatSignedPercent(info.pct)})`
            : MISSING_VALUE}
        </span>
      </div>
      <span style={{ flex: 1 }} />
      <div
        style={{
          display: "flex",
          gap: sp(14),
          fontSize: fs(10),
          fontFamily: T.mono,
        }}
      >
        <div>
          <span style={{ color: T.textMuted }}>VOL </span>
          <span style={{ color: T.text, fontWeight: 600 }}>
            {fmtQuoteVolume(info.volume)}
          </span>
        </div>
        <div>
          <span style={{ color: T.textMuted }}>IV </span>
          <span style={{ color: T.text, fontWeight: 600 }}>
            {isFiniteNumber(info.iv)
              ? `${(info.iv * 100).toFixed(1)}%`
              : MISSING_VALUE}
          </span>
        </div>
        <div>
          <span style={{ color: T.textMuted }}>IMP </span>
          <span
            style={{
              color: impMove != null ? T.cyan : T.textDim,
              fontWeight: 700,
            }}
          >
            {impMove != null ? `±$${impMove.toFixed(2)}` : MISSING_VALUE}
          </span>{" "}
          <span style={{ color: T.textDim }}>
            {impPct != null ? `(${impPct.toFixed(2)}%)` : ""}
          </span>
        </div>
        <div>
          <span style={{ color: T.textMuted }}>ATM </span>
          <span style={{ color: T.accent, fontWeight: 600 }}>
            {atmRow?.k ?? getAtmStrikeFromPrice(info.price) ?? MISSING_VALUE}
          </span>
        </div>
        <div>
          <span style={{ color: T.textMuted }}>CHAIN </span>
          <span
            style={{
              color: chainStatus === "live" ? T.accent : T.textDim,
              fontWeight: 600,
            }}
          >
            {chainStatus}
          </span>
        </div>
      </div>
    </div>
  );
};

// ─── FOCUSED EQUITY CHART PANEL ───
// Big equity chart with full controls: timeframes, drawing tools, candles, crosshair, flow markers.
// Always large (no expand toggle needed in single-ticker mode).
const EQUITY_CHART_STUDIES = [
  { id: "ema-21", label: "EMA21" },
  { id: "ema-55", label: "EMA55" },
  { id: "vwap", label: "VWAP" },
  { id: "sma-20", label: "SMA20" },
  { id: "bb-20", label: "BB20" },
  { id: "rsi-14", label: "RSI" },
  { id: "macd-12-26-9", label: "MACD" },
  { id: "atr-14", label: "ATR" },
];

const TradeEquityPanel = ({
  ticker,
  flowEvents = [],
  stockAggregateStreamingEnabled = false,
}) => {
  const { studies: availableStudies, indicatorRegistry } =
    useIndicatorLibrary();
  const [tf, setTf] = useState("5m");
  const [drawMode, setDrawMode] = useState(null);
  const [selectedIndicators, setSelectedIndicators] = useState(() =>
    resolvePersistedIndicatorPreset({
      indicators: _initialState.tradeEquitySelectedIndicators,
      defaults: DEFAULT_TRADE_EQUITY_STUDIES,
      persistedVersion: _initialState.tradeEquityIndicatorPresetVersion,
      currentVersion: TRADE_EQUITY_INDICATOR_PRESET_VERSION,
    }),
  );
  const [rayReplicaSettings, setRayReplicaSettings] = useState(() =>
    resolvePersistedRayReplicaSettings(_initialState.tradeEquityRayReplicaSettings),
  );
  const indicatorSettings = useMemo(
    () => buildRayReplicaIndicatorSettings(rayReplicaSettings),
    [rayReplicaSettings],
  );
  const { drawings, addDrawing, clearDrawings, undo, redo, canUndo, canRedo } =
    useDrawingHistory();
  const tfMeta =
    TRADE_TIMEFRAMES.find((x) => x.v === tf) || TRADE_TIMEFRAMES[1];
  const barsQuery = useQuery({
    queryKey: ["trade-equity-bars", ticker, tf, tfMeta.bars],
    queryFn: () =>
      getBarsRequest({
        symbol: ticker,
        timeframe: tf,
        limit: tfMeta.bars,
        outsideRth: tf !== "1d",
        source: "trades",
      }),
    ...BARS_QUERY_DEFAULTS,
  });
  const streamedSourceBars = useBrokerStreamedBars({
    symbol: ticker,
    timeframe: tf,
    bars: barsQuery.data?.bars,
    enabled: Boolean(stockAggregateStreamingEnabled && ticker),
  });
  const liveBars = useMemo(
    () => buildTradeBarsFromApi(streamedSourceBars),
    [streamedSourceBars],
  );
  const bars = useMemo(() => liveBars, [liveBars]);
  const barsStatus = liveBars.length
    ? "live"
    : barsQuery.isPending
      ? "loading"
      : "empty";
  const markers = useMemo(
    () =>
      flowEvents.length
        ? buildTradeFlowMarkersFromEvents(flowEvents, bars.length)
        : [],
    [bars.length, flowEvents],
  );
  const chartMarkers = useMemo(
    () =>
      markers.flatMap((marker, index) => {
        const targetBar = bars[marker?.barIdx];
        const rawTime = targetBar?.time;
        const time =
          typeof rawTime === "number"
            ? rawTime > 1e12
              ? Math.floor(rawTime / 1000)
              : Math.floor(rawTime)
            : null;
        if (!time) return [];

        const isCall = marker.cp === "C";
        return [
          {
            id: `trade-flow-${ticker}-${index}-${time}`,
            time,
            barIndex: marker.barIdx,
            position: isCall ? "belowBar" : "aboveBar",
            shape: isCall ? "arrowUp" : "arrowDown",
            color: marker.golden ? T.amber : isCall ? T.green : T.red,
            size: marker.golden
              ? 1.6
              : marker.size === "lg"
                ? 1.25
                : marker.size === "md"
                  ? 1
                  : 0.8,
            text: marker.golden ? "G" : "",
          },
        ];
      }),
    [bars, markers, ticker],
  );
  const chartModel = useMemo(
    () =>
      buildResearchChartModel({
        bars,
        timeframe: tf,
        selectedIndicators,
        indicatorSettings,
        indicatorRegistry,
        indicatorMarkers: chartMarkers,
      }),
    [
      bars,
      chartMarkers,
      indicatorRegistry,
      indicatorSettings,
      selectedIndicators,
      tf,
    ],
  );
  const latestBar = bars[bars.length - 1];
  const previousClose =
    bars.length > 1 ? (bars[bars.length - 2]?.c ?? null) : null;
  const displayPrice = Number.isFinite(latestBar?.c) ? latestBar.c : null;
  const displayChange =
    Number.isFinite(displayPrice) && Number.isFinite(previousClose)
      ? displayPrice - previousClose
      : null;
  const displayPct =
    Number.isFinite(displayChange) &&
    Number.isFinite(previousClose) &&
    previousClose !== 0
      ? (displayChange / previousClose) * 100
      : null;
  const callFlows = markers.filter((m) => m.cp === "C").length;
  const putFlows = markers.filter((m) => m.cp === "P").length;
  const toggleIndicator = (indicatorId) => {
    setSelectedIndicators((current) =>
      current.includes(indicatorId)
        ? current.filter((value) => value !== indicatorId)
        : [...current, indicatorId],
    );
  };

  useEffect(() => {
    persistState({
      tradeEquitySelectedIndicators: selectedIndicators,
      tradeEquityIndicatorPresetVersion: TRADE_EQUITY_INDICATOR_PRESET_VERSION,
    });
  }, [selectedIndicators]);

  useEffect(() => {
    persistState({ tradeEquityRayReplicaSettings: rayReplicaSettings });
  }, [rayReplicaSettings]);

  return (
    <ResearchChartFrame
      dataTestId="trade-equity-chart"
      theme={T}
      themeKey={CURRENT_THEME}
      model={chartModel}
      showSurfaceToolbar={false}
      showLegend={false}
      drawings={drawings}
      drawMode={drawMode}
      onAddDrawing={addDrawing}
      surfaceTopOverlay={(controls) => (
        <ResearchChartWidgetHeader
          theme={T}
          controls={controls}
          symbol={ticker}
          name="Equity chart"
          price={displayPrice}
          changePercent={displayPct}
          statusLabel={describeBrokerChartStatus(barsStatus, tf)}
          timeframe={tf}
          timeframeOptions={TRADE_TIMEFRAMES.map((timeframe) => ({
            value: timeframe.v,
            label: timeframe.tag,
          }))}
          onChangeTimeframe={setTf}
          onUndo={undo}
          onRedo={redo}
          canUndo={canUndo}
          canRedo={canRedo}
          showUndoRedo
          studies={availableStudies}
          selectedStudies={selectedIndicators}
          studySpecs={chartModel.studySpecs}
          onToggleStudy={toggleIndicator}
          rightSlot={
            <RayReplicaSettingsMenu
              theme={T}
              settings={rayReplicaSettings}
              onChange={setRayReplicaSettings}
              disabled={!isRayReplicaIndicatorSelected(selectedIndicators)}
            />
          }
          meta={{
            open: latestBar?.o,
            high: latestBar?.h,
            low: latestBar?.l,
            close: latestBar?.c,
            volume: latestBar?.v,
            vwap: latestBar?.vwap,
            sessionVwap: latestBar?.sessionVwap,
            accumulatedVolume: latestBar?.accumulatedVolume,
            averageTradeSize: latestBar?.averageTradeSize,
            timestamp: latestBar?.ts,
            sourceLabel: describeBrokerChartSource(latestBar?.source),
          }}
        />
      )}
      surfaceTopOverlayHeight={40}
      surfaceLeftOverlay={(controls) => (
        <ResearchChartWidgetSidebar
          theme={T}
          controls={controls}
          drawMode={drawMode}
          drawingCount={drawings.length}
          onToggleDrawMode={setDrawMode}
          onClearDrawings={() => {
            clearDrawings();
            setDrawMode(null);
          }}
        />
      )}
      surfaceLeftOverlayWidth={40}
      surfaceBottomOverlay={(controls) => (
        <ResearchChartWidgetFooter
          theme={T}
          controls={controls}
          studies={availableStudies}
          selectedStudies={selectedIndicators}
          studySpecs={chartModel.studySpecs}
          onToggleStudy={toggleIndicator}
          statusText={`${describeBrokerChartStatus(barsStatus, tf)}  C ${callFlows}  P ${putFlows}  UOA amber`}
        />
      )}
      surfaceBottomOverlayHeight={22}
    />
  );
};

// ─── FOCUSED OPTIONS CHAIN PANEL ───
// Taller chain panel. Header has expiration selector + implied move + ATM strike.
const TradeChainPanel = ({
  ticker,
  contract,
  chainRows = [],
  expirations = [],
  onSelectContract,
  onChangeExp,
  heldContracts = [],
  chainStatus = "empty",
}) => {
  const info = ensureTradeTickerInfo(ticker, ticker);
  const chain = chainRows;
  const expirationOptions = expirations.length
    ? expirations
    : [
        {
          value: contract.exp,
          label: contract.exp,
          dte: daysToExpiration(contract.exp),
        },
      ];
  const expInfo = expirationOptions.find((e) => e.value === contract.exp) ||
    expirationOptions[0] || {
      value: contract.exp,
      label: contract.exp,
      dte: daysToExpiration(contract.exp),
    };
  const heldForTicker = heldContracts.filter((holding) => holding.exp === contract.exp);

  return (
    <div
      style={{
        background: T.bg2,
        border: `1px solid ${T.border}`,
        borderRadius: dim(6),
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        height: "100%",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          padding: sp("6px 10px"),
          borderBottom: `1px solid ${T.border}`,
          gap: sp(8),
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: fs(10),
            fontWeight: 700,
            fontFamily: T.display,
            color: T.textSec,
            letterSpacing: "0.06em",
          }}
        >
          OPTIONS CHAIN
        </span>
        <select
          value={expInfo.value}
          onChange={(e) => onChangeExp(e.target.value)}
          style={{
            background: T.bg3,
            border: `1px solid ${T.border}`,
            color: T.text,
            fontSize: fs(9),
            fontFamily: T.mono,
            fontWeight: 600,
            cursor: "pointer",
            padding: sp("2px 6px"),
            borderRadius: dim(3),
            outline: "none",
          }}
        >
          {expirationOptions.map((ex) => (
            <option key={ex.value} value={ex.value}>
              {ex.label} · {ex.dte}d
            </option>
          ))}
        </select>
        <span
          style={{
            fontSize: fs(9),
            color: expInfo.dte === 0 ? T.amber : T.textDim,
            fontFamily: T.mono,
            fontWeight: expInfo.dte === 0 ? 700 : 400,
          }}
        >
          {expInfo.dte}d
        </span>
        <span style={{ flex: 1 }} />
        {(() => {
          const atmRow = chain.find((r) => r.isAtm);
          const impMove =
            atmRow && isFiniteNumber(atmRow.cPrem) && isFiniteNumber(atmRow.pPrem)
              ? (atmRow.cPrem + atmRow.pPrem) * 0.85
              : null;
          const impPct =
            impMove != null && isFiniteNumber(info.price) && info.price > 0
              ? (impMove / info.price) * 100
              : null;
          return (
            <span style={{ fontSize: fs(9), fontFamily: T.mono }}>
              IMP{" "}
              <span
                style={{
                  color: impMove != null ? T.cyan : T.textDim,
                  fontWeight: 700,
                }}
              >
                {impMove != null ? `±$${impMove.toFixed(2)}` : MISSING_VALUE}
              </span>{" "}
              <span style={{ color: T.textDim }}>
                {impPct != null ? `(${impPct.toFixed(2)}%)` : ""}
              </span>
            </span>
          );
        })()}
        <span style={{ fontSize: fs(9), fontFamily: T.mono }}>
          ATM{" "}
          <span style={{ color: T.accent, fontWeight: 700 }}>
            {chain.find((row) => row.isAtm)?.k ??
              getAtmStrikeFromPrice(info.price) ??
              MISSING_VALUE}
          </span>
        </span>
        <span
          style={{
            fontSize: fs(8),
            color: chainStatus === "live" ? T.accent : T.textDim,
            fontFamily: T.mono,
          }}
        >
          {chainStatus === "live" ? "pan ↔ for Γ Θ V" : `chain ${chainStatus}`}
        </span>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
        {chain.length ? (
          <TradeOptionsChain
            chain={chain}
            selected={{ strike: contract.strike, cp: contract.cp }}
            onSelect={(k, cp) => onSelectContract(k, cp)}
            heldStrikes={heldForTicker}
          />
        ) : (
          <DataUnavailableState
            title="No live option chain"
            detail={`The ${ticker} chain table is hidden until the live provider returns quotes and greeks for this expiration.`}
          />
        )}
      </div>
    </div>
  );
};

// ─── FOCUSED CONTRACT DETAIL PANEL ───
// Selected contract chart with entry line + HOLDING badge.
const TradeContractDetailPanel = ({
  ticker,
  contract,
  chainRows = [],
  heldContracts = [],
  chainStatus = "empty",
}) => {
  const selectedRow = chainRows.find((r) => r.k === contract.strike);
  const contractStrikeLabel = isFiniteNumber(contract.strike)
    ? contract.strike
    : MISSING_VALUE;
  const basePrem = selectedRow
    ? contract.cp === "C"
      ? selectedRow.cPrem
      : selectedRow.pPrem
    : null;
  const contractMeta =
    contract.cp === "C" ? selectedRow?.cContract : selectedRow?.pContract;
  const [tf, setTf] = useState("5m");
  const tfMeta =
    TRADE_TIMEFRAMES.find((x) => x.v === tf) || TRADE_TIMEFRAMES[1];
  const optionBarsQuery = useQuery({
    queryKey: [
      "trade-option-bars",
      contractMeta?.ticker,
      contractMeta?.providerContractId,
      tf,
      tfMeta.bars,
    ],
    queryFn: () =>
      getBarsRequest({
        symbol: contractMeta.ticker,
        timeframe: tf,
        limit: tfMeta.bars,
        assetClass: "option",
        providerContractId: contractMeta?.providerContractId,
        outsideRth: tf !== "1d",
        source: "trades",
      }),
    enabled: Boolean(contractMeta?.ticker),
    ...BARS_QUERY_DEFAULTS,
  });
  const optionDailyBarsQuery = useQuery({
    queryKey: [
      "trade-option-bars-daily",
      contractMeta?.ticker,
      contractMeta?.providerContractId,
    ],
    queryFn: () =>
      getBarsRequest({
        symbol: contractMeta.ticker,
        timeframe: "1d",
        limit: 180,
        assetClass: "option",
        providerContractId: contractMeta?.providerContractId,
        outsideRth: false,
        source: "trades",
      }),
    enabled: Boolean(contractMeta?.ticker) && tf !== "1d",
    ...BARS_QUERY_DEFAULTS,
  });
  const liveIntradayBars = buildTradeBarsFromApi(optionBarsQuery.data?.bars);
  const liveDailyBars = buildTradeBarsFromApi(optionDailyBarsQuery.data?.bars);
  const optBars = useMemo(() => {
    if (liveIntradayBars.length) return liveIntradayBars;
    if (liveDailyBars.length) return liveDailyBars;
    return [];
  }, [liveDailyBars, liveIntradayBars]);
  const contractColor = contract.cp === "C" ? T.green : T.red;
  const contractStr = `${ticker} ${contractStrikeLabel}${contract.cp} ${contract.exp}`;
  const activeHolding = heldContracts.find(
    (hp) =>
      hp.strike === contract.strike &&
      hp.cp === contract.cp &&
      hp.exp === contract.exp,
  );
  const hasLiveIntradayBars = liveIntradayBars.length > 0;
  const hasLiveDailyBars = liveDailyBars.length > 0;
  const resolvedChartTimeframe = hasLiveIntradayBars
    ? tf
    : hasLiveDailyBars
      ? "1d"
      : tf;
  const latestOptionBar = optBars[optBars.length - 1];
  const optionSourceLabel = describeBrokerChartSource(latestOptionBar?.source);
  const sourceLabel = !contractMeta
    ? chainStatus === "loading"
      ? "waiting on live chain"
      : "no live contract selected"
    : hasLiveIntradayBars || hasLiveDailyBars
      ? optionSourceLabel || `IBKR ${resolvedChartTimeframe}`
      : optionBarsQuery.isPending || optionDailyBarsQuery.isPending
        ? `loading ${tf}`
        : "no live contract bars";
  const contractBarsStatusText = hasLiveIntradayBars
    ? "ibkr contract bars"
    : hasLiveDailyBars
      ? "ibkr daily bars"
      : optionBarsQuery.isPending || optionDailyBarsQuery.isPending
        ? "loading contract bars"
        : "no live contract bars";

  return (
    <div
      style={{
        background: T.bg2,
        border: `1px solid ${T.border}`,
        borderRadius: dim(6),
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        height: "100%",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          padding: sp("6px 10px"),
          borderBottom: `1px solid ${T.border}`,
          gap: sp(8),
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: fs(10),
            fontWeight: 700,
            fontFamily: T.display,
            color: T.textSec,
            letterSpacing: "0.06em",
          }}
        >
          CONTRACT
        </span>
        <span
          style={{
            fontSize: fs(11),
            fontWeight: 700,
            fontFamily: T.mono,
            color: contractColor,
          }}
        >
          {contractStrikeLabel}
          {contract.cp}
        </span>
        <span style={{ fontSize: fs(9), color: T.textDim, fontFamily: T.mono }}>
          {contract.exp}
        </span>
        <span style={{ flex: 1 }} />
        <span
          style={{
            fontSize: fs(8),
            color: hasLiveIntradayBars
              ? T.green
              : hasLiveDailyBars
                ? T.cyan
                : optionBarsQuery.isPending || optionDailyBarsQuery.isPending
                  ? T.accent
                  : T.textDim,
            fontFamily: T.mono,
          }}
        >
          {contractBarsStatusText}
        </span>
        {activeHolding && (
          <span
            style={{
              padding: sp("2px 6px"),
              background: `${T.amber}18`,
              border: `1px solid ${T.amber}50`,
              borderRadius: dim(3),
              fontSize: fs(9),
              fontFamily: T.mono,
              fontWeight: 700,
              color: T.amber,
            }}
          >
            ★ HOLDING {activeHolding.qty || ""}
          </span>
        )}
        {activeHolding && (
          <span
            style={{
              fontSize: fs(11),
              fontFamily: T.mono,
              fontWeight: 700,
              color: activeHolding.pnl >= 0 ? T.green : T.red,
            }}
          >
            {activeHolding.pnl >= 0 ? "+" : ""}${activeHolding.pnl}
          </span>
        )}
        <span
          style={{
            fontSize: fs(13),
            fontWeight: 700,
            fontFamily: T.mono,
            color: contractColor,
          }}
        >
          {typeof basePrem === "number" ? `$${basePrem.toFixed(2)}` : MISSING_VALUE}
        </span>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        {optBars.length ? (
          <TradeOptionChart
            bars={optBars}
            color={contractColor}
            contract={contractStr}
            holding={activeHolding}
            timeframe={resolvedChartTimeframe}
            sourceLabel={sourceLabel}
            onChangeTimeframe={setTf}
          />
        ) : (
          <DataUnavailableState
            title="No live contract bars"
            detail="The selected contract has no broker-backed intraday or daily bars yet."
          />
        )}
      </div>
    </div>
  );
};

// ─── OPTIONS ORDER FLOW: 3 visualizations side-by-side ───
// 1. DTE donut — premium split by expiration bucket
// 2. Strike heatmap — premium concentration by strike (vertical bars centered on ATM)
// 3. Net flow timeline — intraday cumulative net premium (calls minus puts)

// Sub-component: DTE donut visualization
const DTEDonut = ({ data, size = 90, thickness = 16 }) => {
  const total = data.reduce((s, b) => s + b.callPrem + b.putPrem, 0) || 1;
  const totalCall = data.reduce((s, b) => s + b.callPrem, 0);
  const totalPut = data.reduce((s, b) => s + b.putPrem, 0);
  const cx = size / 2,
    cy = size / 2;
  const r = size / 2 - 4;
  const innerR = r - thickness;

  // Colors: 0DTE bright, longer-dated darker
  const callShades = ["#34d399", "#10b981", "#059669", "#047857"];
  const putShades = ["#fca5a5", "#f87171", "#ef4444", "#b91c1c"];

  // Build segments: all call buckets first (clockwise from top), then put buckets (counter-clockwise)
  const segs = [];
  data.forEach((b, i) =>
    segs.push({ value: b.callPrem, color: callShades[i] }),
  );
  data
    .slice()
    .reverse()
    .forEach((b, i) =>
      segs.push({ value: b.putPrem, color: putShades[data.length - 1 - i] }),
    );

  let cumAngle = -Math.PI / 2;
  const paths = segs.map((seg, i) => {
    const angle = (seg.value / total) * 2 * Math.PI;
    if (angle <= 0.001) return null;
    const startAngle = cumAngle;
    const endAngle = cumAngle + angle;
    cumAngle = endAngle;
    const x1 = cx + r * Math.cos(startAngle),
      y1 = cy + r * Math.sin(startAngle);
    const x2 = cx + r * Math.cos(endAngle),
      y2 = cy + r * Math.sin(endAngle);
    const x3 = cx + innerR * Math.cos(endAngle),
      y3 = cy + innerR * Math.sin(endAngle);
    const x4 = cx + innerR * Math.cos(startAngle),
      y4 = cy + innerR * Math.sin(startAngle);
    const largeArc = angle > Math.PI ? 1 : 0;
    const d = `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} L ${x3} ${y3} A ${innerR} ${innerR} 0 ${largeArc} 0 ${x4} ${y4} Z`;
    return (
      <path key={i} d={d} fill={seg.color} stroke={T.bg2} strokeWidth={1} />
    );
  });

  const callPct = ((totalCall / total) * 100).toFixed(0);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {paths}
      <text
        x={cx}
        y={cy - 3}
        textAnchor="middle"
        fontSize={fs(7)}
        fill={T.textMuted}
        fontFamily={T.mono}
        letterSpacing="0.08em"
      >
        C/P
      </text>
      <text
        x={cx}
        y={cy + fs(11)}
        textAnchor="middle"
        fontSize={fs(11)}
        fontWeight={700}
        fill={callPct >= 60 ? T.green : callPct <= 40 ? T.red : T.amber}
        fontFamily={T.mono}
      >
        {callPct}/{100 - callPct}
      </text>
    </svg>
  );
};

// Sub-component: Strike heatmap (vertical bars centered on ATM)
const StrikeHeatmap = ({ data, height = 130 }) => {
  const maxPrem = Math.max(...data.map((d) => d.total)) || 1;
  const cellW = 100 / data.length;
  return (
    <div
      style={{
        width: "100%",
        height,
        display: "flex",
        flexDirection: "column",
        gap: sp(2),
      }}
    >
      {/* Bars area — for each strike, two stacked bars (call top half, put bottom half) */}
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          borderBottom: `1px solid ${T.border}`,
          position: "relative",
        }}
      >
        {/* ATM marker line */}
        {(() => {
          const atmIdx = data.findIndex((d) => d.isATM);
          const atmLeft = (atmIdx + 0.5) * cellW;
          return (
            <div
              style={{
                position: "absolute",
                left: `${atmLeft}%`,
                top: 0,
                bottom: 0,
                width: 1,
                background: T.accent,
                opacity: 0.6,
                zIndex: 1,
              }}
            />
          );
        })()}
        {data.map((d, i) => {
          const callH = (d.callPrem / maxPrem) * 50;
          const putH = (d.putPrem / maxPrem) * 50;
          const intensity = d.total / maxPrem;
          return (
            <div
              key={i}
              title={`${d.strike}: C $${d.callPrem}K / P $${d.putPrem}K`}
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                height: "100%",
                gap: 1,
                position: "relative",
              }}
            >
              {/* Call bar grows up from middle */}
              <div
                style={{
                  width: "75%",
                  height: `${callH}%`,
                  background: T.green,
                  opacity: 0.4 + intensity * 0.55,
                  borderRadius: `${dim(2)}px ${dim(2)}px 0 0`,
                  marginTop: "auto",
                }}
              />
              {/* Put bar grows down from middle */}
              <div
                style={{
                  width: "75%",
                  height: `${putH}%`,
                  background: T.red,
                  opacity: 0.4 + intensity * 0.55,
                  borderRadius: `0 0 ${dim(2)}px ${dim(2)}px`,
                  marginBottom: "auto",
                }}
              />
            </div>
          );
        })}
      </div>
      {/* Strike labels along bottom — show every other to avoid crowding */}
      <div
        style={{
          display: "flex",
          fontSize: fs(7),
          fontFamily: T.mono,
          color: T.textMuted,
        }}
      >
        {data.map((d, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              textAlign: "center",
              color: d.isATM ? T.accent : T.textMuted,
              fontWeight: d.isATM ? 700 : 400,
            }}
          >
            {i % 2 === 0 || d.isATM ? d.strike : ""}
          </div>
        ))}
      </div>
    </div>
  );
};

// Sub-component: Cumulative net premium flow timeline
const NetFlowTimeline = ({ data, height = 130 }) => {
  const maxAbs = Math.max(...data.map((d) => Math.abs(d.cumNet))) || 1;
  const yMin = -maxAbs * 1.1,
    yMax = maxAbs * 1.1;
  const w = 320,
    h = height - 22; // reserve space for x-axis labels
  const padL = 30,
    padR = 4,
    padT = 4,
    padB = 0;
  const chartW = w - padL - padR;
  const chartH = h - padT - padB;
  const xScale = (i) => padL + (i / (data.length - 1)) * chartW;
  const yScale = (v) => padT + chartH - ((v - yMin) / (yMax - yMin)) * chartH;
  const zeroY = yScale(0);

  // Build path strings for above-zero (green) and below-zero (red) areas
  const cumNetVals = data.map((d) => d.cumNet);
  const buildArea = (vals, sign) => {
    let path = `M ${padL} ${zeroY}`;
    vals.forEach((v, i) => {
      const y =
        sign > 0 ? Math.min(yScale(v), zeroY) : Math.max(yScale(v), zeroY);
      path += ` L ${xScale(i)} ${y}`;
    });
    path += ` L ${xScale(vals.length - 1)} ${zeroY} Z`;
    return path;
  };
  const linePath = data
    .map((d, i) => `${i === 0 ? "M" : "L"} ${xScale(i)} ${yScale(d.cumNet)}`)
    .join(" ");
  const finalNet = data[data.length - 1].cumNet;

  return (
    <div
      style={{
        width: "100%",
        height,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <svg
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        style={{ width: "100%", flex: 1, overflow: "visible" }}
      >
        {/* Y-axis labels */}
        <text
          x={padL - 3}
          y={yScale(maxAbs) + 3}
          fontSize={fs(7)}
          fill={T.textMuted}
          fontFamily={T.mono}
          textAnchor="end"
        >
          +{maxAbs.toFixed(0)}
        </text>
        <text
          x={padL - 3}
          y={zeroY + 3}
          fontSize={fs(7)}
          fill={T.textMuted}
          fontFamily={T.mono}
          textAnchor="end"
        >
          0
        </text>
        <text
          x={padL - 3}
          y={yScale(-maxAbs) + 3}
          fontSize={fs(7)}
          fill={T.textMuted}
          fontFamily={T.mono}
          textAnchor="end"
        >
          -{maxAbs.toFixed(0)}
        </text>
        {/* Zero line */}
        <line
          x1={padL}
          y1={zeroY}
          x2={w - padR}
          y2={zeroY}
          stroke={T.border}
          strokeWidth={0.5}
        />
        {/* Green area above zero */}
        <path d={buildArea(cumNetVals, 1)} fill={T.green} fillOpacity={0.25} />
        {/* Red area below zero */}
        <path d={buildArea(cumNetVals, -1)} fill={T.red} fillOpacity={0.25} />
        {/* Line on top */}
        <path
          d={linePath}
          fill="none"
          stroke={finalNet >= 0 ? T.green : T.red}
          strokeWidth={1.5}
        />
        {/* Final value dot */}
        <circle
          cx={xScale(data.length - 1)}
          cy={yScale(finalNet)}
          r={3}
          fill={finalNet >= 0 ? T.green : T.red}
          stroke={T.bg2}
          strokeWidth={1}
        />
      </svg>
      {/* Time axis labels (3 ticks: open, mid, close) */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          padding: sp("0 4px 0 24px"),
          fontSize: fs(7),
          fontFamily: T.mono,
          color: T.textMuted,
          marginTop: sp(2),
        }}
      >
        <span>9:30</span>
        <span>12:45</span>
        <span>16:00</span>
      </div>
    </div>
  );
};

const TradeOptionsFlowPanel = ({ ticker, flowEvents = [] }) => {
  const info = ensureTradeTickerInfo(ticker, ticker);
  const dteData = useMemo(
    () => buildTradeOptionFlowByDte(flowEvents),
    [flowEvents],
  );
  const strikeData = useMemo(
    () => buildTradeOptionFlowByStrike(flowEvents, info.price),
    [flowEvents, info.price],
  );
  const timelineData = useMemo(
    () => buildTradeOptionFlowTimeline(flowEvents),
    [flowEvents],
  );

  if (
    !flowEvents.length ||
    !dteData.length ||
    !strikeData.length ||
    !timelineData.length
  ) {
    return (
      <div
        style={{
          background: T.bg2,
          border: `1px solid ${T.border}`,
          borderRadius: dim(6),
          padding: sp("8px 10px"),
          display: "flex",
          flexDirection: "column",
          gap: sp(4),
          overflow: "hidden",
          height: "100%",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            borderBottom: `1px solid ${T.border}`,
            paddingBottom: sp(4),
          }}
        >
          <span
            style={{
              fontSize: fs(10),
              fontWeight: 700,
              fontFamily: T.display,
              color: T.textSec,
              letterSpacing: "0.06em",
            }}
          >
            OPTIONS ORDER FLOW
          </span>
          <span
            style={{ fontSize: fs(9), color: T.textDim, fontFamily: T.mono }}
          >
            {ticker} · no live data
          </span>
        </div>
        <DataUnavailableState
          title="No live options flow"
          detail={`Strike heatmaps and DTE buckets are hidden until live options prints are returned for ${ticker}.`}
        />
      </div>
    );
  }

  const totalCall = dteData.reduce((s, b) => s + b.callPrem, 0);
  const totalPut = dteData.reduce((s, b) => s + b.putPrem, 0);
  const finalNet = timelineData[timelineData.length - 1].cumNet;

  return (
    <div
      style={{
        background: T.bg2,
        border: `1px solid ${T.border}`,
        borderRadius: dim(6),
        padding: sp("8px 10px"),
        display: "flex",
        flexDirection: "column",
        gap: sp(4),
        overflow: "hidden",
        height: "100%",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          borderBottom: `1px solid ${T.border}`,
          paddingBottom: sp(4),
        }}
      >
        <span
          style={{
            fontSize: fs(10),
            fontWeight: 700,
            fontFamily: T.display,
            color: T.textSec,
            letterSpacing: "0.06em",
          }}
        >
          OPTIONS ORDER FLOW
        </span>
        <div
          style={{
            display: "flex",
            gap: sp(8),
            fontSize: fs(9),
            fontFamily: T.mono,
          }}
        >
          <span style={{ color: T.green, fontWeight: 600 }}>
            C ${(totalCall / 1000).toFixed(2)}M
          </span>
          <span style={{ color: T.red, fontWeight: 600 }}>
            P ${(totalPut / 1000).toFixed(2)}M
          </span>
          <span
            style={{ color: finalNet >= 0 ? T.green : T.red, fontWeight: 700 }}
          >
            NET {finalNet >= 0 ? "+" : ""}${(finalNet / 1000).toFixed(2)}M
          </span>
        </div>
        <span style={{ fontSize: fs(9), color: T.textDim, fontFamily: T.mono }}>
          {ticker} · today
        </span>
      </div>

      {/* 3 visualizations in a row */}
      <div
        style={{
          flex: 1,
          display: "grid",
          gridTemplateColumns: "auto 1fr 1fr",
          gap: sp(8),
          minHeight: 0,
        }}
      >
        {/* DTE Donut on left */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: sp(3),
            justifyContent: "space-between",
          }}
        >
          <div
            style={{
              fontSize: fs(8),
              color: T.textMuted,
              letterSpacing: "0.08em",
              whiteSpace: "nowrap",
            }}
          >
            BY DTE
          </div>
          <DTEDonut data={dteData} size={dim(94)} thickness={dim(15)} />
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 1,
              fontSize: fs(8),
              fontFamily: T.mono,
              width: "100%",
            }}
          >
            {dteData.map((b, i) => (
              <div
                key={i}
                style={{
                  display: "grid",
                  gridTemplateColumns: "32px 1fr 1fr",
                  gap: sp(3),
                  alignItems: "center",
                }}
              >
                <span style={{ color: T.textMuted, fontWeight: 600 }}>
                  {b.label}
                </span>
                <span style={{ color: T.green, textAlign: "right" }}>
                  {b.callPrem.toFixed(0)}
                </span>
                <span style={{ color: T.red, textAlign: "right" }}>
                  {b.putPrem.toFixed(0)}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Strike Heatmap in middle */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: sp(3),
            minWidth: 0,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div
              style={{
                fontSize: fs(8),
                color: T.textMuted,
                letterSpacing: "0.08em",
                whiteSpace: "nowrap",
              }}
            >
              STRIKE · ATM
            </div>
            <div
              style={{
                display: "flex",
                gap: sp(6),
                fontSize: fs(7),
                fontFamily: T.mono,
              }}
            >
              <span style={{ color: T.green }}>▲ calls</span>
              <span style={{ color: T.red }}>▼ puts</span>
            </div>
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            <StrikeHeatmap data={strikeData} height={dim(130)} />
          </div>
        </div>

        {/* Timeline on right */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: sp(3),
            minWidth: 0,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div
              style={{
                fontSize: fs(8),
                color: T.textMuted,
                letterSpacing: "0.08em",
                whiteSpace: "nowrap",
              }}
            >
              NET · intraday
            </div>
            <span
              style={{
                fontSize: fs(9),
                fontFamily: T.mono,
                color: finalNet >= 0 ? T.green : T.red,
                fontWeight: 700,
              }}
            >
              {finalNet >= 0 ? "+" : ""}${(finalNet / 1000).toFixed(2)}M
            </span>
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            <NetFlowTimeline data={timelineData} height={dim(130)} />
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── SPOT ORDER FLOW PANEL ───
// Compact wrapper around the existing OrderFlowDistribution component for use in Trade tab.
const TradeSpotFlowPanel = ({ ticker, flowEvents = [] }) => {
  const tickerFlow = useMemo(
    () => buildMarketOrderFlowFromEvents(flowEvents),
    [flowEvents],
  );
  if (!flowEvents.length) {
    return (
      <div
        style={{
          background: T.bg2,
          border: `1px solid ${T.border}`,
          borderRadius: dim(6),
          padding: sp("8px 10px"),
          display: "flex",
          flexDirection: "column",
          gap: sp(4),
          overflow: "hidden",
          height: "100%",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            borderBottom: `1px solid ${T.border}`,
            paddingBottom: sp(4),
          }}
        >
          <span
            style={{
              fontSize: fs(10),
              fontWeight: 700,
              fontFamily: T.display,
              color: T.textSec,
              letterSpacing: "0.06em",
            }}
          >
            SPOT FLOW
          </span>
          <span
            style={{ fontSize: fs(9), color: T.textDim, fontFamily: T.mono }}
          >
            {ticker} · no live data
          </span>
        </div>
        <DataUnavailableState
          title="No live spot flow"
          detail={`This panel only renders API-backed buy and sell flow for ${ticker}.`}
        />
      </div>
    );
  }
  const totalBuy =
    tickerFlow.buyXL + tickerFlow.buyL + tickerFlow.buyM + tickerFlow.buyS;
  const totalSell =
    tickerFlow.sellXL + tickerFlow.sellL + tickerFlow.sellM + tickerFlow.sellS;
  const buyPct = ((totalBuy / Math.max(totalBuy + totalSell, 1)) * 100).toFixed(
    1,
  );
  const max = Math.max(
    tickerFlow.buyXL,
    tickerFlow.buyL,
    tickerFlow.buyM,
    tickerFlow.buyS,
    tickerFlow.sellXL,
    tickerFlow.sellL,
    tickerFlow.sellM,
    tickerFlow.sellS,
  );
  return (
    <div
      style={{
        background: T.bg2,
        border: `1px solid ${T.border}`,
        borderRadius: dim(6),
        padding: sp("8px 10px"),
        display: "flex",
        flexDirection: "column",
        gap: sp(4),
        overflow: "hidden",
        height: "100%",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          borderBottom: `1px solid ${T.border}`,
          paddingBottom: sp(4),
        }}
      >
        <span
          style={{
            fontSize: fs(10),
            fontWeight: 700,
            fontFamily: T.display,
            color: T.textSec,
            letterSpacing: "0.06em",
          }}
        >
          SPOT FLOW
        </span>
        <span style={{ fontSize: fs(9), color: T.textDim, fontFamily: T.mono }}>
          {ticker} · today
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: sp(8) }}>
        <OrderFlowDonut flow={tickerFlow} size={dim(78)} thickness={dim(12)} />
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            gap: sp(3),
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontFamily: T.mono,
              fontSize: fs(10),
            }}
          >
            <span style={{ color: T.green, fontWeight: 700 }}>
              ${totalBuy.toFixed(0)}M
            </span>
            <span style={{ color: T.red, fontWeight: 700 }}>
              ${totalSell.toFixed(0)}M
            </span>
          </div>
          <div
            style={{
              display: "flex",
              height: dim(4),
              borderRadius: dim(2),
              overflow: "hidden",
              background: T.bg3,
            }}
          >
            <div
              style={{
                width: `${buyPct}%`,
                background: T.green,
                opacity: 0.85,
              }}
            />
            <div
              style={{
                width: `${100 - buyPct}%`,
                background: T.red,
                opacity: 0.85,
              }}
            />
          </div>
          <div
            style={{ fontSize: fs(9), color: T.textDim, fontFamily: T.mono }}
          >
            {buyPct}% buy ·{" "}
            <span
              style={{
                color: totalBuy >= totalSell ? T.green : T.red,
                fontWeight: 600,
              }}
            >
              {totalBuy >= totalSell ? "BULLISH" : "BEARISH"}
            </span>
          </div>
        </div>
      </div>
      <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: sp(3) }}>
        <SizeBucketRow
          label="XL"
          buy={tickerFlow.buyXL}
          sell={tickerFlow.sellXL}
          maxValue={max}
        />
        <SizeBucketRow
          label="L"
          buy={tickerFlow.buyL}
          sell={tickerFlow.sellL}
          maxValue={max}
        />
        <SizeBucketRow
          label="M"
          buy={tickerFlow.buyM}
          sell={tickerFlow.sellM}
          maxValue={max}
        />
        <SizeBucketRow
          label="S"
          buy={tickerFlow.buyS}
          sell={tickerFlow.sellS}
          maxValue={max}
        />
      </div>
    </div>
  );
};

const TradeScreen = ({
  sym,
  symPing,
  session,
  environment,
  accountId,
  brokerConfigured,
  brokerAuthenticated,
}) => {
  const toast = useToast();
  const queryClient = useQueryClient();
  const positions = usePositions();
  // Initialize from persisted state, falling back to sym prop or sensible defaults
  const initialTicker = (() => {
    const persistedActive = _initialState.tradeActiveTicker;
    if (persistedActive) {
      ensureTradeTickerInfo(persistedActive, persistedActive);
      return persistedActive;
    }
    if (sym) {
      ensureTradeTickerInfo(sym, sym);
      return sym;
    }
    return "SPY";
  })();
  const initialRecent = (() => {
    const persistedRecent = _initialState.tradeRecentTickers;
    if (Array.isArray(persistedRecent) && persistedRecent.length > 0) {
      const valid = persistedRecent
        .map((ticker) => {
          ensureTradeTickerInfo(ticker, ticker);
          return ticker;
        })
        .filter(Boolean);
      if (valid.length > 0) return valid;
    }
    return [initialTicker, "QQQ", "NVDA"].filter(
      (t, i, a) => a.indexOf(t) === i,
    );
  })();
  const initialContracts = (() => {
    const persistedContracts = _initialState.tradeContracts;
    return persistedContracts && typeof persistedContracts === "object"
      ? persistedContracts
      : {};
  })();
  const [activeTicker, setActiveTicker] = useState(initialTicker);
  const [recentTickers, setRecentTickers] = useState(initialRecent);
  const [contracts, setContracts] = useState(initialContracts);
  const [showUniverseSearch, setShowUniverseSearch] = useState(false);
  const stockAggregateStreamingEnabled = Boolean(
    brokerConfigured && brokerAuthenticated,
  );
  const activeTickerInfo = ensureTradeTickerInfo(activeTicker, activeTicker);
  const contract =
    contracts[activeTicker] ||
    (() => {
      return {
        strike: getAtmStrikeFromPrice(activeTickerInfo.price) ?? null,
        cp: "C",
        exp: "",
      };
    })();
  const updateContract = (patch) =>
    setContracts((c) => ({ ...c, [activeTicker]: { ...contract, ...patch } }));
  const activeQuoteQuery = useGetQuoteSnapshots(
    { symbols: activeTicker },
    {
      query: {
        enabled: Boolean(activeTicker),
        staleTime: 60_000,
        retry: false,
      },
    },
  );
  useIbkrQuoteSnapshotStream({
    symbols: activeTicker ? [activeTicker] : [],
    enabled: Boolean(stockAggregateStreamingEnabled && activeTicker),
  });
  const optionChainQuery = useQuery({
    queryKey: ["trade-option-chain", activeTicker],
    queryFn: () => getOptionChainRequest({ underlying: activeTicker }),
    ...QUERY_DEFAULTS,
    refetchInterval: false,
  });
  useIbkrOptionChainStream({
    underlying: activeTicker,
    enabled: Boolean(stockAggregateStreamingEnabled && activeTicker),
  });
  const expirationOptions = useMemo(() => {
    if (optionChainQuery.data?.contracts?.length) {
      const unique = new Map();
      optionChainQuery.data.contracts.forEach((quote) => {
        const actualDate = parseExpirationValue(quote.contract?.expirationDate);
        const value = formatExpirationLabel(quote.contract?.expirationDate);
        if (!unique.has(value)) {
          unique.set(value, {
            value,
            label: value,
            dte: daysToExpiration(actualDate),
            actualDate,
          });
        }
      });
      return Array.from(unique.values()).sort(
        (left, right) =>
          (left.actualDate?.getTime() ?? 0) -
          (right.actualDate?.getTime() ?? 0),
      );
    }

    return [];
  }, [optionChainQuery.data]);
  const chainRowsByExpiration = useMemo(() => {
    if (optionChainQuery.data?.contracts?.length) {
      const grouped = {};
      optionChainQuery.data.contracts.forEach((quote) => {
        const expiration = formatExpirationLabel(
          quote.contract?.expirationDate,
        );
        if (!grouped[expiration]) grouped[expiration] = [];
        grouped[expiration].push(quote);
      });

      return Object.fromEntries(
        Object.entries(grouped).map(([expiration, quotes]) => [
          expiration,
          buildOptionChainRowsFromApi(
            quotes,
            activeTickerInfo.price,
          ),
        ]),
      );
    }

    return {};
  }, [optionChainQuery.data, activeTickerInfo.price]);
  const activeExpiration = expirationOptions.find(
    (option) => option.value === contract.exp,
  ) ||
    expirationOptions[0] || {
      value: contract.exp,
      label: contract.exp,
      dte: daysToExpiration(contract.exp),
      actualDate: parseExpirationValue(contract.exp),
    };
  const activeChainRows =
    chainRowsByExpiration[activeExpiration.value] ||
    chainRowsByExpiration[contract.exp] ||
    [];
  const optionChainStatus = optionChainQuery.data?.contracts?.length
    ? "live"
    : optionChainQuery.isPending
      ? "loading"
      : optionChainQuery.isError
        ? "offline"
        : "empty";
  const tickerFlowQuery = useQuery({
    queryKey: ["trade-flow", activeTicker],
    queryFn: () =>
      listFlowEventsRequest({ underlying: activeTicker, limit: 80 }),
    staleTime: 10_000,
    refetchInterval: 10_000,
    retry: false,
  });
  const tickerFlowEvents = useMemo(() => {
    const liveEvents =
      tickerFlowQuery.data?.events?.map(mapFlowEventToUi) || [];
    if (liveEvents.length) {
      return liveEvents.sort((left, right) => right.premium - left.premium);
    }
    return [];
  }, [tickerFlowQuery.data, activeTicker]);
  const tradeFlowStatus = tickerFlowEvents.length
    ? "live"
    : tickerFlowQuery.isPending
      ? "loading"
      : tickerFlowQuery.isError
        ? "offline"
        : "empty";
  const tradePositionsQuery = useListPositions(
    { accountId, mode: environment },
    {
      query: {
        enabled: Boolean(brokerAuthenticated && accountId),
        ...QUERY_DEFAULTS,
        refetchInterval: false,
      },
    },
  );
  const heldContracts = useMemo(() => {
    if (brokerConfigured) {
      if (!brokerAuthenticated || !accountId) {
        return [];
      }

      return (tradePositionsQuery.data?.positions || [])
        .filter(
          (position) =>
            position.symbol === activeTicker &&
            position.assetClass === "option" &&
            position.optionContract,
        )
        .map((position) => ({
          strike: position.optionContract.strike,
          cp: position.optionContract.right === "call" ? "C" : "P",
          exp: formatExpirationLabel(position.optionContract.expirationDate),
          entry: position.averagePrice,
          qty: Math.abs(position.quantity),
          pnl: position.unrealizedPnl,
          pct: position.unrealizedPnlPercent,
        }));
    }

    return positions.positions
      .filter(
        (position) =>
          position.kind === "option" && position.ticker === activeTicker,
      )
      .map((position) => ({
        strike: position.strike,
        cp: position.cp,
        exp: position.exp,
        entry: position.entry,
        qty: position.qty,
        pnl: null,
        pct: null,
      }));
  }, [
    accountId,
    activeTicker,
    brokerAuthenticated,
    brokerConfigured,
    environment,
    positions.positions,
    tradePositionsQuery.data,
  ]);

  useBrokerStockAggregateStream({
    symbols: activeTicker ? [activeTicker] : [],
    enabled: Boolean(stockAggregateStreamingEnabled && activeTicker),
    onAggregate: (aggregate) => {
      queryClient.invalidateQueries({
        queryKey: ["trade-equity-bars", aggregate.symbol],
      });
    },
  });

  // Persist trade state changes
  useEffect(() => {
    persistState({ tradeActiveTicker: activeTicker });
  }, [activeTicker]);
  useEffect(() => {
    persistState({ tradeRecentTickers: recentTickers });
  }, [recentTickers]);
  useEffect(() => {
    persistState({ tradeContracts: contracts });
  }, [contracts]);

  useEffect(() => {
    const quote = activeQuoteQuery.data?.quotes?.find(
      (item) => item.symbol?.toUpperCase() === activeTicker,
    );
    if (!quote) return;

    const tradeInfo = ensureTradeTickerInfo(
      activeTicker,
      activeTickerInfo.name || activeTicker,
    );
    tradeInfo.price = quote.price ?? tradeInfo.price;
    tradeInfo.chg = quote.change ?? tradeInfo.chg;
    tradeInfo.pct = quote.changePercent ?? tradeInfo.pct;
    tradeInfo.open = quote.open ?? tradeInfo.open ?? null;
    tradeInfo.high = quote.high ?? tradeInfo.high ?? null;
    tradeInfo.low = quote.low ?? tradeInfo.low ?? null;
    tradeInfo.prevClose = quote.prevClose ?? tradeInfo.prevClose ?? null;
    tradeInfo.volume = quote.volume ?? tradeInfo.volume ?? null;
    tradeInfo.updatedAt = quote.updatedAt ?? tradeInfo.updatedAt ?? null;
  }, [activeQuoteQuery.data, activeTicker, activeTickerInfo.name]);

  // Helper: focus a ticker, and add to recent strip if not present
  const focusTicker = (ticker, fallbackName = ticker) => {
    const normalized = ticker?.toUpperCase?.() || ticker;
    if (!normalized) return;
    ensureTradeTickerInfo(normalized, fallbackName);
    setActiveTicker(normalized);
    setRecentTickers((prev) =>
      prev.includes(normalized) ? prev : [...prev, normalized].slice(-8),
    );
  };
  const closeTicker = (ticker) => {
    setRecentTickers((prev) => {
      const filtered = prev.filter((t) => t !== ticker);
      if (ticker === activeTicker && filtered.length > 0)
        setActiveTicker(filtered[0]);
      return filtered;
    });
  };

  // Watchlist sync
  useEffect(() => {
    if (!symPing || symPing.n === 0) return;
    ensureTradeTickerInfo(symPing.sym, symPing.sym);
    focusTicker(symPing.sym);
    if (symPing.contract) {
      const incoming = symPing.contract;
      setContracts((current) => {
        const info = ensureTradeTickerInfo(symPing.sym, symPing.sym);
        const existing = current[symPing.sym] || {
          strike: getAtmStrikeFromPrice(info.price) ?? null,
          cp: "C",
          exp: incoming.exp || "",
        };

        return {
          ...current,
          [symPing.sym]: {
            ...existing,
            ...incoming,
          },
        };
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symPing && symPing.n]);

  useEffect(() => {
    if (!expirationOptions.length) return;
    if (expirationOptions.some((option) => option.value === contract.exp))
      return;

    const nextExpiration = expirationOptions[0];
    const atmRow = (chainRowsByExpiration[nextExpiration.value] || []).find(
      (row) => row.isAtm,
    );
    updateContract({
      exp: nextExpiration.value,
      strike: atmRow?.k ?? contract.strike,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTicker, expirationOptions, chainRowsByExpiration]);

  useEffect(() => {
    if (!activeChainRows.length) return;
    if (activeChainRows.some((row) => row.k === contract.strike)) return;

    const atmRow =
      activeChainRows.find((row) => row.isAtm) ||
      activeChainRows[Math.floor(activeChainRows.length / 2)];
    updateContract({ strike: atmRow?.k ?? contract.strike });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTicker, activeExpiration.value, activeChainRows, contract.strike]);

  // Strategy → pick a strike near the desired delta on the active ticker's chain
  const applyStrategy = (strategy) => {
    if (!activeChainRows.length) {
      toast.push({
        kind: "info",
        title: "Chain still loading",
        body: "Wait for a live option chain before applying a strategy preset.",
      });
      return;
    }
    const chain = activeChainRows;
    let bestStrike = chain[0].k;
    let bestDist = Infinity;
    for (const row of chain) {
      const d = Math.abs(strategy.cp === "C" ? row.cDelta : row.pDelta);
      const dist = Math.abs(d - strategy.deltaTarget);
      if (dist < bestDist) {
        bestDist = dist;
        bestStrike = row.k;
      }
    }
    const targetExpiration = expirationOptions.length
      ? expirationOptions.reduce(
          (closest, option) =>
            Math.abs(option.dte - strategy.dte) <
            Math.abs(closest.dte - strategy.dte)
              ? option
              : closest,
          expirationOptions[0],
        ).value
      : contract.exp;
    updateContract({
      strike: bestStrike,
      cp: strategy.cp,
      exp: targetExpiration,
    });
  };

  // Slot prop adapter for existing components that expect { ticker, strike, cp, exp }
  const slot = { ticker: activeTicker, ...contract };

  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Tab strip */}
      <TickerTabStrip
        recent={recentTickers}
        active={activeTicker}
        onSelect={focusTicker}
        onClose={closeTicker}
        onAddNew={() => setShowUniverseSearch((open) => !open)}
      />
      <TickerUniverseSearchPanel
        open={showUniverseSearch}
        onClose={() => setShowUniverseSearch(false)}
        onSelectTicker={(result) => {
          ensureTradeTickerInfo(result.ticker, result.name || result.ticker);
          focusTicker(result.ticker, result.name || result.ticker);
          setShowUniverseSearch(false);
        }}
      />
      {/* Main workspace */}
      <div
        style={{
          flex: 1,
          padding: sp(6),
          display: "flex",
          flexDirection: "column",
          gap: sp(6),
          overflow: "auto",
        }}
      >
        {/* Compact ticker header */}
        <TradeTickerHeader
          ticker={activeTicker}
          chainRows={activeChainRows}
          expiration={activeExpiration}
          chainStatus={optionChainStatus}
        />
        {brokerConfigured && !brokerAuthenticated && (
          <div
            style={{
              background: `${T.amber}12`,
              border: `1px solid ${T.amber}35`,
              borderRadius: dim(6),
              padding: sp("8px 10px"),
              display: "flex",
              justifyContent: "space-between",
              gap: sp(12),
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <div
              style={{ display: "flex", flexDirection: "column", gap: sp(2) }}
            >
              <span
                style={{
                  fontSize: fs(10),
                  fontWeight: 700,
                  fontFamily: T.display,
                  color: T.amber,
                  letterSpacing: "0.05em",
                }}
              >
                IBKR BRIDGE ACTION REQUIRED
              </span>
              <span
                style={{
                  fontSize: fs(9),
                  color: T.textSec,
                  fontFamily: T.sans,
                  lineHeight: 1.45,
                }}
              >
                {bridgeRuntimeMessage(session)}
              </span>
            </div>
            <div
              style={{
                fontSize: fs(8),
                color: T.textDim,
                fontFamily: T.mono,
                textAlign: "right",
              }}
            >
              {session?.ibkrBridge?.competing
                ? "competing session detected"
                : session?.ibkrBridge?.connected
                  ? "bridge online"
                  : "bridge offline"}
              <br />
              {(session?.ibkrBridge?.transport || "bridge").replace(/_/g, " ")}{" "}
              {session?.ibkrBridge?.connectionTarget || MISSING_VALUE}
              {session?.ibkrBridge?.sessionMode
                ? ` · ${session.ibkrBridge.sessionMode}`
                : ""}
              <br />
              last heartbeat{" "}
              {formatRelativeTimeShort(session?.ibkrBridge?.lastTickleAt)}
              {session?.ibkrBridge?.lastRecoveryAttemptAt ? (
                <>
                  <br />
                  recovery{" "}
                  {formatRelativeTimeShort(
                    session.ibkrBridge.lastRecoveryAttemptAt,
                  )}
                </>
              ) : null}
            </div>
          </div>
        )}
        {/* Top zone: Equity chart + Options chain side by side */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1.5fr 1fr",
            gap: sp(6),
            height: dim(340),
            flexShrink: 0,
          }}
        >
          <TradeEquityPanel
            ticker={activeTicker}
            flowEvents={tickerFlowEvents}
            stockAggregateStreamingEnabled={stockAggregateStreamingEnabled}
          />
          <TradeChainPanel
            ticker={activeTicker}
            contract={contract}
            chainRows={activeChainRows}
            expirations={expirationOptions}
            heldContracts={heldContracts}
            chainStatus={optionChainStatus}
            onSelectContract={(strike, cp) => updateContract({ strike, cp })}
            onChangeExp={(exp) => updateContract({ exp })}
          />
        </div>
        {/* Middle zone: Contract chart + Spot flow + Options flow */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1.2fr 1fr 1.5fr",
            gap: sp(6),
            height: dim(260),
            flexShrink: 0,
          }}
        >
          <TradeContractDetailPanel
            ticker={activeTicker}
            contract={contract}
            chainRows={activeChainRows}
            heldContracts={heldContracts}
            chainStatus={optionChainStatus}
          />
          <TradeSpotFlowPanel
            ticker={activeTicker}
            flowEvents={tickerFlowEvents}
          />
          <TradeOptionsFlowPanel
            ticker={activeTicker}
            flowEvents={tickerFlowEvents}
          />
        </div>
        {/* Bottom zone: Order ticket + Strategy/Greeks + L2/Tape/Flow tabs + Positions */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              "minmax(260px, 1fr) minmax(280px, 1fr) minmax(280px, 1fr) minmax(360px, 1.4fr)",
            gap: sp(6),
            height: dim(290),
            flexShrink: 0,
          }}
        >
          <TradeOrderTicket
            slot={slot}
            chainRows={activeChainRows}
            expiration={activeExpiration}
            accountId={accountId}
            environment={environment}
            brokerConfigured={brokerConfigured}
            brokerAuthenticated={brokerAuthenticated}
          />
          <TradeStrategyGreeksPanel
            slot={slot}
            chainRows={activeChainRows}
            onApplyStrategy={applyStrategy}
          />
          <TradeL2Panel
            slot={slot}
            chainRows={activeChainRows}
            flowEvents={tickerFlowEvents}
            accountId={accountId}
            brokerConfigured={brokerConfigured}
            brokerAuthenticated={brokerAuthenticated}
          />
          <TradePositionsPanel
            accountId={accountId}
            environment={environment}
            brokerConfigured={brokerConfigured}
            brokerAuthenticated={brokerAuthenticated}
            onLoadPosition={({ ticker, strike, cp, exp }) => {
              focusTicker(ticker);
              setContracts((c) => ({ ...c, [ticker]: { strike, cp, exp } }));
            }}
          />
        </div>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════
// SCREEN: RESEARCH (Photonics Dashboard — Emerging Themes)
// ═══════════════════════════════════════════════════════════════════
// SCAFFOLDING — ready to receive the Photonics Dashboard content.
//
// When photonics-dashboard.jsx becomes available:
//   1. Port its components (THEMES registry, COMPANIES data, Graph, CalendarView,
//      MarketSummary, PhotonicsObservatory main app) into this file OR import them
//      from a separate module.
//   2. Replace the placeholder body below with <PhotonicsObservatory />.
//   3. Theme-port: light→dark via T proxy, Arial/Instrument Serif → T.sans/T.display,
//      hardcoded sizes → fs()/dim()/sp() (respecting 10px font floor).
//   4. Cross-nav is already wired: call props.onJumpToTrade(ticker) from any
//      ticker click to jump to Trade tab with that symbol loaded.
//
// Theme tokens available inside ResearchScreen: T, fs(), dim(), sp(), all standard.
// Container below hides the right rail (see App render) so Research gets full width.
//
const RESEARCH_THEMES_PLANNED = [
  {
    id: "ai",
    title: "The AI Trade",
    subtitle: "AI Infrastructure · Full Ecosystem",
    icon: "◆",
    accent: "#CDA24E",
  },
  {
    id: "aerospace_defense",
    title: "Aerospace & Defense",
    subtitle: "Primes · Electronics · Drones · Space",
    icon: "✈",
    accent: "#556b2f",
    meta: true,
  },
  {
    id: "nuclear",
    title: "Nuclear Renaissance",
    subtitle: "Utilities · SMR · Fuel Cycle",
    icon: "☢",
    accent: "#2a9a70",
  },
  {
    id: "space",
    title: "Space & Orbital",
    subtitle: "Launch · Satellites · EO/SAR",
    icon: "★",
    accent: "#4872d8",
  },
  {
    id: "robotics",
    title: "Robotics & Automation",
    subtitle: "Humanoid · Industrial · Logistics",
    icon: "⬡",
    accent: "#d86840",
  },
  {
    id: "quantum",
    title: "Quantum Computing",
    subtitle: "Hardware · Software · PQC",
    icon: "⚛",
    accent: "#8e44ad",
  },
];

const ResearchScreen = ({ onJumpToTrade }) => (
  <Suspense fallback={null}>
    <PhotonicsObservatory onJumpToTrade={onJumpToTrade} />
  </Suspense>
);

// ═══════════════════════════════════════════════════════════════════
// SCREEN: ALGO (EDGE Algorithm Config)
// ═══════════════════════════════════════════════════════════════════

const AlgoScreen = ({
  session,
  environment,
  accounts = [],
  selectedAccountId = null,
}) => {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [selectedDraftId, setSelectedDraftId] = useState("");
  const [deploymentName, setDeploymentName] = useState("");
  const [symbolUniverseInput, setSymbolUniverseInput] = useState("");
  const [focusedDeploymentId, setFocusedDeploymentId] = useState(null);
  const brokerConfigured = Boolean(session?.configured?.ibkr);
  const brokerAuthenticated = Boolean(session?.ibkrBridge?.authenticated);
  const bridgeTone = bridgeRuntimeTone(session);
  const activeAccount =
    accounts.find((account) => account.id === selectedAccountId) ||
    accounts[0] ||
    null;
  const activeAccountId =
    activeAccount?.id ||
    selectedAccountId ||
    session?.ibkrBridge?.selectedAccountId ||
    null;
  const draftsQuery = useListBacktestDraftStrategies({
    query: {
      ...QUERY_DEFAULTS,
      retry: false,
    },
  });
  const deploymentsQuery = useListAlgoDeployments(
    { mode: environment },
    {
      query: {
        ...QUERY_DEFAULTS,
        retry: false,
      },
    },
  );
  const deployments = deploymentsQuery.data?.deployments || [];
  const candidateDrafts = useMemo(() => {
    const drafts = draftsQuery.data?.drafts || [];
    const matchingMode = drafts.filter((draft) => draft.mode === environment);
    return matchingMode.length ? matchingMode : drafts;
  }, [draftsQuery.data, environment]);
  const selectedDraft =
    candidateDrafts.find((draft) => draft.id === selectedDraftId) ||
    candidateDrafts[0] ||
    null;
  const focusedDeployment =
    deployments.find((deployment) => deployment.id === focusedDeploymentId) ||
    deployments[0] ||
    null;
  const eventsQuery = useListExecutionEvents(
    focusedDeployment
      ? { deploymentId: focusedDeployment.id, limit: 20 }
      : { limit: 20 },
    {
      query: {
        ...QUERY_DEFAULTS,
        retry: false,
      },
    },
  );
  const events = eventsQuery.data?.events || [];
  const enabledDeployments = deployments.filter(
    (deployment) => deployment.enabled,
  );
  const latestEvent = events[0] || null;

  useEffect(() => {
    if (!candidateDrafts.length) {
      setSelectedDraftId("");
      return;
    }

    if (!candidateDrafts.some((draft) => draft.id === selectedDraftId)) {
      setSelectedDraftId(candidateDrafts[0].id);
    }
  }, [candidateDrafts, selectedDraftId]);

  useEffect(() => {
    if (!selectedDraft) {
      setDeploymentName("");
      setSymbolUniverseInput("");
      return;
    }

    setDeploymentName(`${selectedDraft.name} ${environment.toUpperCase()}`);
    setSymbolUniverseInput(selectedDraft.symbolUniverse.join(", "));
  }, [selectedDraft?.id, environment]);

  useEffect(() => {
    if (!deployments.length) {
      setFocusedDeploymentId(null);
      return;
    }

    if (
      !focusedDeploymentId ||
      !deployments.some((deployment) => deployment.id === focusedDeploymentId)
    ) {
      setFocusedDeploymentId(deployments[0].id);
    }
  }, [deployments, focusedDeploymentId]);

  const refreshAlgoQueries = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/algo/deployments"] });
    queryClient.invalidateQueries({ queryKey: ["/api/algo/events"] });
  };

  const createDeploymentMutation = useCreateAlgoDeployment({
    mutation: {
      onSuccess: (deployment) => {
        refreshAlgoQueries();
        setFocusedDeploymentId(deployment.id);
        toast.push({
          kind: "success",
          title: "Deployment created",
          body: `${deployment.name} · ${deployment.providerAccountId} · ${deployment.mode.toUpperCase()}`,
        });
      },
      onError: (error) => {
        toast.push({
          kind: "error",
          title: "Create failed",
          body: error?.message || "The deployment could not be created.",
        });
      },
    },
  });
  const enableDeploymentMutation = useEnableAlgoDeployment({
    mutation: {
      onSuccess: (deployment) => {
        refreshAlgoQueries();
        toast.push({
          kind: "success",
          title: "Deployment enabled",
          body: deployment.name,
        });
      },
      onError: (error) => {
        toast.push({
          kind: "error",
          title: "Enable failed",
          body: error?.message || "The deployment could not be enabled.",
        });
      },
    },
  });
  const pauseDeploymentMutation = usePauseAlgoDeployment({
    mutation: {
      onSuccess: (deployment) => {
        refreshAlgoQueries();
        toast.push({
          kind: "success",
          title: "Deployment paused",
          body: deployment.name,
        });
      },
      onError: (error) => {
        toast.push({
          kind: "error",
          title: "Pause failed",
          body: error?.message || "The deployment could not be paused.",
        });
      },
    },
  });

  const handleCreateDeployment = () => {
    if (!selectedDraft) {
      toast.push({
        kind: "warn",
        title: "No promoted strategy",
        body: "Promote a completed backtest run before creating a deployment.",
      });
      return;
    }

    if (!brokerConfigured) {
      toast.push({
        kind: "warn",
        title: "IBKR not configured",
        body: "Broker connectivity must be configured before deploying an algorithm.",
      });
      return;
    }

    if (!brokerAuthenticated) {
      toast.push({
        kind: "warn",
        title: "IBKR login required",
        body: "Authenticate the local bridge before creating a live deployment.",
      });
      return;
    }

    if (!activeAccountId) {
      toast.push({
        kind: "warn",
        title: "No broker account selected",
        body: "The bridge is authenticated, but no IBKR account is active yet.",
      });
      return;
    }

    createDeploymentMutation.mutate({
      data: {
        strategyId: selectedDraft.id,
        name:
          deploymentName.trim() ||
          `${selectedDraft.name} ${environment.toUpperCase()}`,
        providerAccountId: activeAccountId,
        mode: environment,
        symbolUniverse: parseSymbolUniverseInput(symbolUniverseInput),
        config: {
          sourceDraftId: selectedDraft.id,
          sourceRunId: selectedDraft.runId,
          sourceStudyId: selectedDraft.studyId,
          promotedAt: selectedDraft.promotedAt,
        },
      },
    });
  };

  const handleToggleDeployment = (deployment) => {
    if (!brokerAuthenticated) {
      toast.push({
        kind: "warn",
        title: "IBKR login required",
        body: "Authenticate the local bridge before changing deployment state.",
      });
      return;
    }

    if (deployment.enabled) {
      pauseDeploymentMutation.mutate({ deploymentId: deployment.id });
      return;
    }

    enableDeploymentMutation.mutate({ deploymentId: deployment.id });
  };

  return (
    <div
      style={{
        padding: sp(12),
        display: "flex",
        flexDirection: "column",
        gap: sp(10),
        height: "100%",
        overflowY: "auto",
      }}
    >
      {brokerConfigured && !brokerAuthenticated && (
        <div
          style={{
            background: `${T.amber}12`,
            border: `1px solid ${T.amber}35`,
            borderRadius: dim(6),
            padding: sp("10px 12px"),
            display: "flex",
            justifyContent: "space-between",
            gap: sp(12),
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: sp(2) }}>
            <span
              style={{
                fontSize: fs(11),
                fontWeight: 700,
                fontFamily: T.display,
                color: T.amber,
                letterSpacing: "0.05em",
              }}
            >
              ALGO DEPLOYMENTS BLOCKED
            </span>
            <span
              style={{
                fontSize: fs(9),
                color: T.textSec,
                fontFamily: T.sans,
                lineHeight: 1.45,
              }}
            >
              {bridgeRuntimeMessage(session)}
            </span>
          </div>
          <div
            style={{
              fontSize: fs(8),
              color: T.textDim,
              fontFamily: T.mono,
              textAlign: "right",
            }}
          >
            bridge {bridgeTone.label}
            <br />
            {activeAccountId || "no active account"}
          </div>
        </div>
      )}

      <div
        style={{
          background: T.bg2,
          border: `1px solid ${T.border}`,
          borderRadius: dim(6),
          padding: sp("12px 14px"),
        }}
      >
        <div
          style={{
            fontSize: fs(12),
            fontWeight: 700,
            fontFamily: T.display,
            color: T.text,
            marginBottom: 10,
          }}
        >
          Execution Control Plane
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
            gap: sp(8),
          }}
        >
          {[
            {
              label: "Promoted Drafts",
              value: `${draftsQuery.data?.drafts?.length || 0}`,
              detail: selectedDraft
                ? `${selectedDraft.name} · ${selectedDraft.mode}`
                : "awaiting promotion",
              color: T.accent,
            },
            {
              label: "Deployments",
              value: `${deployments.length}`,
              detail: deployments.length
                ? `${enabledDeployments.length} enabled`
                : "none created",
              color: deployments.length ? T.green : T.textDim,
            },
            {
              label: "Bridge",
              value: bridgeTone.label.toUpperCase(),
              detail:
                session?.ibkrBridge?.transport === "tws"
                  ? `tws ${session?.ibkrBridge?.sessionMode || ""} · ${activeAccountId || "no account"}`
                  : `${session?.ibkrBridge?.transport || "bridge"} · ${activeAccountId || "no account"}`,
              color: bridgeTone.color,
            },
            {
              label: "Environment",
              value: environment.toUpperCase(),
              detail: session?.marketDataProviders?.live
                ? `live md ${session.marketDataProviders.live}`
                : "session loading",
              color: environment === "live" ? T.red : T.green,
            },
            {
              label: "Latest Event",
              value: latestEvent
                ? formatEnumLabel(latestEvent.eventType)
                : "NONE",
              detail: latestEvent
                ? formatRelativeTimeShort(latestEvent.occurredAt)
                : "no execution events yet",
              color: latestEvent ? T.cyan : T.textDim,
            },
          ].map((metric) => (
            <div
              key={metric.label}
              style={{
                padding: sp("10px 12px"),
                borderRadius: dim(6),
                background: T.bg0,
                border: `1px solid ${T.border}`,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: sp(4),
                  marginBottom: 4,
                }}
              >
                <div
                  style={{
                    width: dim(6),
                    height: dim(6),
                    borderRadius: "50%",
                    background: metric.color,
                  }}
                />
                <span
                  style={{
                    fontSize: fs(9),
                    fontWeight: 700,
                    fontFamily: T.sans,
                    color: T.text,
                  }}
                >
                  {metric.label}
                </span>
              </div>
              <div
                style={{
                  fontSize: fs(11),
                  fontWeight: 700,
                  fontFamily: T.mono,
                  color: metric.color,
                  marginBottom: 3,
                }}
              >
                {metric.value}
              </div>
              <div
                style={{
                  fontSize: fs(8),
                  color: T.textDim,
                  fontFamily: T.mono,
                }}
              >
                {metric.detail}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(320px, 0.95fr) minmax(420px, 1.35fr)",
          gap: sp(10),
        }}
      >
        <div
          style={{
            background: T.bg2,
            border: `1px solid ${T.border}`,
            borderRadius: dim(6),
            padding: sp("12px 14px"),
            display: "flex",
            flexDirection: "column",
            gap: sp(8),
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              gap: sp(8),
            }}
          >
            <div>
              <div
                style={{
                  fontSize: fs(12),
                  fontWeight: 700,
                  fontFamily: T.display,
                  color: T.text,
                }}
              >
                Create Deployment
              </div>
              <div
                style={{
                  fontSize: fs(9),
                  color: T.textDim,
                  fontFamily: T.mono,
                }}
              >
                Promoted strategy -&gt; IBKR execution account
              </div>
            </div>
            <Badge
              color={
                brokerAuthenticated
                  ? T.green
                  : brokerConfigured
                    ? T.amber
                    : T.textDim
              }
            >
              {bridgeTone.label.toUpperCase()}
            </Badge>
          </div>

          {!candidateDrafts.length ? (
            <div
              style={{
                padding: sp("18px 10px"),
                border: `1px dashed ${T.border}`,
                borderRadius: dim(5),
                fontSize: fs(10),
                color: T.textDim,
                fontFamily: T.sans,
                lineHeight: 1.5,
              }}
            >
              No promoted draft strategies are available yet. Promote a
              completed backtest run first, then return here to create an
              execution deployment.
            </div>
          ) : (
            <>
              <div>
                <div
                  style={{
                    fontSize: fs(7),
                    color: T.textMuted,
                    letterSpacing: "0.08em",
                    marginBottom: 2,
                  }}
                >
                  PROMOTED STRATEGY
                </div>
                <select
                  value={selectedDraft?.id || ""}
                  onChange={(event) => setSelectedDraftId(event.target.value)}
                  style={{
                    width: "100%",
                    background: T.bg3,
                    border: `1px solid ${T.border}`,
                    borderRadius: dim(4),
                    padding: sp("7px 10px"),
                    color: T.text,
                    fontSize: fs(10),
                    fontFamily: T.mono,
                    fontWeight: 600,
                    outline: "none",
                  }}
                >
                  {candidateDrafts.map((draft) => (
                    <option key={draft.id} value={draft.id}>
                      {draft.name} · {draft.mode} ·{" "}
                      {draft.symbolUniverse.length} syms
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <div
                  style={{
                    fontSize: fs(7),
                    color: T.textMuted,
                    letterSpacing: "0.08em",
                    marginBottom: 2,
                  }}
                >
                  DEPLOYMENT NAME
                </div>
                <input
                  value={deploymentName}
                  onChange={(event) => setDeploymentName(event.target.value)}
                  placeholder="Deployment name"
                  style={{
                    width: "100%",
                    background: T.bg3,
                    border: `1px solid ${T.border}`,
                    borderRadius: dim(4),
                    padding: sp("7px 10px"),
                    color: T.text,
                    fontSize: fs(10),
                    fontFamily: T.sans,
                    outline: "none",
                  }}
                />
              </div>

              <div>
                <div
                  style={{
                    fontSize: fs(7),
                    color: T.textMuted,
                    letterSpacing: "0.08em",
                    marginBottom: 2,
                  }}
                >
                  SYMBOL UNIVERSE
                </div>
                <input
                  value={symbolUniverseInput}
                  onChange={(event) =>
                    setSymbolUniverseInput(event.target.value)
                  }
                  placeholder="SPY, QQQ, NVDA"
                  style={{
                    width: "100%",
                    background: T.bg3,
                    border: `1px solid ${T.border}`,
                    borderRadius: dim(4),
                    padding: sp("7px 10px"),
                    color: T.text,
                    fontSize: fs(10),
                    fontFamily: T.mono,
                    outline: "none",
                  }}
                />
              </div>

              <div
                style={{
                  background: T.bg3,
                  border: `1px solid ${T.border}`,
                  borderRadius: dim(5),
                  padding: sp("8px 10px"),
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: sp(4),
                  fontSize: fs(8),
                  fontFamily: T.mono,
                }}
              >
                <div>
                  <span style={{ color: T.textMuted }}>ACCOUNT</span>{" "}
                  <span style={{ color: activeAccountId ? T.text : T.amber }}>
                    {activeAccountId || "waiting"}
                  </span>
                </div>
                <div>
                  <span style={{ color: T.textMuted }}>MODE</span>{" "}
                  <span
                    style={{ color: environment === "live" ? T.red : T.green }}
                  >
                    {environment.toUpperCase()}
                  </span>
                </div>
                <div>
                  <span style={{ color: T.textMuted }}>RUN</span>{" "}
                  <span style={{ color: T.textSec }}>
                    {selectedDraft?.runId
                      ? selectedDraft.runId.slice(0, 8)
                      : MISSING_VALUE}
                  </span>
                </div>
                <div>
                  <span style={{ color: T.textMuted }}>PROMOTED</span>{" "}
                  <span style={{ color: T.textSec }}>
                    {selectedDraft
                      ? formatRelativeTimeShort(selectedDraft.promotedAt)
                      : MISSING_VALUE}
                  </span>
                </div>
              </div>

              <button
                onClick={handleCreateDeployment}
                disabled={createDeploymentMutation.isPending}
                style={{
                  padding: sp("8px 0"),
                  background: T.accent,
                  border: "none",
                  borderRadius: dim(4),
                  color: "#fff",
                  fontSize: fs(10),
                  fontFamily: T.sans,
                  fontWeight: 700,
                  cursor: createDeploymentMutation.isPending
                    ? "wait"
                    : "pointer",
                  opacity: createDeploymentMutation.isPending ? 0.7 : 1,
                  letterSpacing: "0.04em",
                }}
              >
                {createDeploymentMutation.isPending
                  ? "CREATING..."
                  : `CREATE ${environment.toUpperCase()} DEPLOYMENT`}
              </button>
            </>
          )}
        </div>

        <div
          style={{
            background: T.bg2,
            border: `1px solid ${T.border}`,
            borderRadius: dim(6),
            padding: sp("12px 14px"),
            display: "flex",
            flexDirection: "column",
            gap: sp(8),
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              gap: sp(8),
            }}
          >
            <div>
              <div
                style={{
                  fontSize: fs(12),
                  fontWeight: 700,
                  fontFamily: T.display,
                  color: T.text,
                }}
              >
                Deployments
              </div>
              <div
                style={{
                  fontSize: fs(9),
                  color: T.textDim,
                  fontFamily: T.mono,
                }}
              >
                {environment.toUpperCase()} execution profiles
              </div>
            </div>
            <span
              style={{ fontSize: fs(9), color: T.textDim, fontFamily: T.mono }}
            >
              {enabledDeployments.length}/{deployments.length} enabled
            </span>
          </div>

          {!deployments.length ? (
            <div
              style={{
                padding: sp("18px 10px"),
                border: `1px dashed ${T.border}`,
                borderRadius: dim(5),
                fontSize: fs(10),
                color: T.textDim,
                fontFamily: T.sans,
                lineHeight: 1.5,
              }}
            >
              No deployments exist for this environment yet.
            </div>
          ) : (
            <div
              style={{ display: "flex", flexDirection: "column", gap: sp(6) }}
            >
              {deployments.map((deployment) => {
                const tone = deployment.enabled
                  ? T.green
                  : deployment.lastError
                    ? T.red
                    : T.textDim;
                return (
                  <div
                    key={deployment.id}
                    onClick={() => setFocusedDeploymentId(deployment.id)}
                    style={{
                      background:
                        focusedDeployment?.id === deployment.id ? T.bg3 : T.bg0,
                      border: `1px solid ${focusedDeployment?.id === deployment.id ? T.accent : T.border}`,
                      borderRadius: dim(5),
                      padding: sp("10px 12px"),
                      display: "flex",
                      justifyContent: "space-between",
                      gap: sp(10),
                      cursor: "pointer",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: sp(4),
                        minWidth: 0,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: sp(6),
                          flexWrap: "wrap",
                        }}
                      >
                        <span
                          style={{
                            fontSize: fs(10),
                            fontWeight: 700,
                            fontFamily: T.sans,
                            color: T.text,
                          }}
                        >
                          {deployment.name}
                        </span>
                        <Badge color={tone}>
                          {deployment.enabled ? "ENABLED" : "PAUSED"}
                        </Badge>
                        <span
                          style={{
                            fontSize: fs(8),
                            color: T.textDim,
                            fontFamily: T.mono,
                          }}
                        >
                          {deployment.providerAccountId}
                        </span>
                      </div>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(4, minmax(0, auto))",
                          gap: sp(8),
                          fontSize: fs(8),
                          fontFamily: T.mono,
                          color: T.textSec,
                        }}
                      >
                        <span>
                          <span style={{ color: T.textMuted }}>SYMS</span>{" "}
                          {deployment.symbolUniverse.length}
                        </span>
                        <span>
                          <span style={{ color: T.textMuted }}>EVAL</span>{" "}
                          {formatRelativeTimeShort(deployment.lastEvaluatedAt)}
                        </span>
                        <span>
                          <span style={{ color: T.textMuted }}>SIGNAL</span>{" "}
                          {formatRelativeTimeShort(deployment.lastSignalAt)}
                        </span>
                        <span>
                          <span style={{ color: T.textMuted }}>UPDATED</span>{" "}
                          {formatRelativeTimeShort(deployment.updatedAt)}
                        </span>
                      </div>
                      {deployment.lastError && (
                        <div
                          style={{
                            fontSize: fs(8),
                            color: T.red,
                            fontFamily: T.sans,
                            lineHeight: 1.4,
                          }}
                        >
                          {deployment.lastError}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        handleToggleDeployment(deployment);
                      }}
                      disabled={
                        enableDeploymentMutation.isPending ||
                        pauseDeploymentMutation.isPending
                      }
                      style={{
                        alignSelf: "center",
                        padding: sp("6px 10px"),
                        background: deployment.enabled
                          ? "transparent"
                          : T.green,
                        border: deployment.enabled
                          ? `1px solid ${T.amber}50`
                          : "none",
                        borderRadius: dim(4),
                        color: deployment.enabled ? T.amber : "#fff",
                        fontSize: fs(9),
                        fontFamily: T.sans,
                        fontWeight: 700,
                        cursor:
                          enableDeploymentMutation.isPending ||
                          pauseDeploymentMutation.isPending
                            ? "wait"
                            : "pointer",
                        whiteSpace: "nowrap",
                        opacity:
                          enableDeploymentMutation.isPending ||
                          pauseDeploymentMutation.isPending
                            ? 0.7
                            : 1,
                      }}
                    >
                      {deployment.enabled ? "PAUSE" : "ENABLE"}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div
        style={{
          background: T.bg2,
          border: `1px solid ${T.border}`,
          borderRadius: dim(6),
          padding: sp("12px 14px"),
          flex: 1,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            gap: sp(8),
            marginBottom: sp(8),
          }}
        >
          <div>
            <div
              style={{
                fontSize: fs(12),
                fontWeight: 700,
                fontFamily: T.display,
                color: T.text,
              }}
            >
              Execution Events
            </div>
            <div
              style={{ fontSize: fs(9), color: T.textDim, fontFamily: T.mono }}
            >
              {focusedDeployment
                ? `filtered to ${focusedDeployment.name}`
                : "latest automation events"}
            </div>
          </div>
          <span
            style={{ fontSize: fs(8), color: T.textDim, fontFamily: T.mono }}
          >
            {events.length} rows
          </span>
        </div>

        {!events.length ? (
          <div
            style={{
              padding: sp("18px 10px"),
              border: `1px dashed ${T.border}`,
              borderRadius: dim(5),
              fontSize: fs(10),
              color: T.textDim,
              fontFamily: T.sans,
              lineHeight: 1.5,
            }}
          >
            No execution events have been recorded yet.
          </div>
        ) : (
          events.map((event) => (
            <div
              key={event.id}
              style={{
                display: "grid",
                gridTemplateColumns: "64px 132px 1fr 88px",
                gap: sp(8),
                alignItems: "start",
                padding: sp("8px 0"),
                borderBottom: `1px solid ${T.border}08`,
                fontSize: fs(9),
              }}
            >
              <span style={{ color: T.textDim, fontFamily: T.mono }}>
                {formatEtTime(event.occurredAt)}
              </span>
              <span
                style={{ color: T.accent, fontFamily: T.mono, fontWeight: 700 }}
              >
                {formatEnumLabel(event.eventType)}
              </span>
              <span
                style={{
                  color: T.textSec,
                  fontFamily: T.sans,
                  lineHeight: 1.4,
                }}
              >
                {event.summary}
              </span>
              <span
                style={{
                  color: event.symbol ? T.text : T.textDim,
                  fontFamily: T.mono,
                  textAlign: "right",
                }}
              >
                {event.symbol || event.providerAccountId || "system"}
              </span>
            </div>
          ))
        )}
      </div>

      <AlgoDraftStrategiesPanel theme={T} scale={{ fs, sp, dim }} />
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════
// SCREEN: BACKTEST
// ═══════════════════════════════════════════════════════════════════

const BacktestScreen = ({ watchlists, defaultWatchlistId }) => (
  <BacktestWorkspace
    theme={T}
    scale={{ fs, sp, dim }}
    watchlists={watchlists}
    defaultWatchlistId={defaultWatchlistId}
  />
);

// ═══════════════════════════════════════════════════════════════════
// LIVE BROKER CONFIRMATION
// ═══════════════════════════════════════════════════════════════════

const BrokerActionConfirmDialog = ({
  open,
  title,
  detail,
  lines = [],
  confirmLabel = "CONFIRM LIVE ACTION",
  confirmTone = T.red,
  pending = false,
  onConfirm,
  onCancel,
}) => {
  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 210,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: sp(16),
        background: "rgba(4, 10, 18, 0.72)",
        backdropFilter: "blur(10px)",
      }}
    >
      <div
        style={{
          width: "min(100%, 520px)",
          background: T.bg1,
          border: `1px solid ${confirmTone}55`,
          borderRadius: dim(8),
          boxShadow: "0 24px 72px rgba(0,0,0,0.45)",
          padding: sp("14px 16px"),
          display: "flex",
          flexDirection: "column",
          gap: sp(10),
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: sp(3) }}>
          <span
            style={{
              fontSize: fs(10),
              fontWeight: 800,
              color: confirmTone,
              fontFamily: T.display,
              letterSpacing: "0.08em",
            }}
          >
            LIVE IBKR CONFIRMATION
          </span>
          <span
            style={{
              fontSize: fs(14),
              fontWeight: 800,
              color: T.text,
              fontFamily: T.sans,
            }}
          >
            {title}
          </span>
          <span
            style={{
              fontSize: fs(9),
              color: T.textSec,
              fontFamily: T.sans,
              lineHeight: 1.45,
            }}
          >
            {detail}
          </span>
        </div>
        {lines.length > 0 && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr) auto",
              gap: sp(6),
              padding: sp("8px 10px"),
              background: T.bg2,
              border: `1px solid ${T.border}`,
              borderRadius: dim(5),
              fontFamily: T.mono,
            }}
          >
            {lines.map((line) => (
              <Fragment key={line.label}>
                <span
                  style={{
                    fontSize: fs(8),
                    color: T.textMuted,
                    letterSpacing: "0.06em",
                  }}
                >
                  {line.label}
                </span>
                <span
                  style={{
                    fontSize: fs(8),
                    color: line.valueColor || T.text,
                    fontWeight: 700,
                    textAlign: "right",
                  }}
                >
                  {line.value}
                </span>
              </Fragment>
            ))}
          </div>
        )}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: sp(10),
            fontSize: fs(8),
            color: T.textDim,
            fontFamily: T.sans,
            lineHeight: 1.4,
          }}
        >
          <span>
            This sends a live broker instruction. Review the account,
            instrument, side, size, and price before continuing.
          </span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: sp(8) }}>
          <button
            onClick={onCancel}
            disabled={pending}
            style={{
              padding: sp("8px 0"),
              background: T.bg2,
              border: `1px solid ${T.border}`,
              borderRadius: dim(5),
              color: T.textSec,
              fontSize: fs(10),
              fontFamily: T.sans,
              fontWeight: 700,
              cursor: pending ? "not-allowed" : "pointer",
              opacity: pending ? 0.65 : 1,
            }}
          >
            CANCEL
          </button>
          <button
            onClick={onConfirm}
            disabled={pending}
            style={{
              padding: sp("8px 0"),
              background: confirmTone,
              border: "none",
              borderRadius: dim(5),
              color: "#fff",
              fontSize: fs(10),
              fontFamily: T.sans,
              fontWeight: 800,
              cursor: pending ? "wait" : "pointer",
              opacity: pending ? 0.75 : 1,
            }}
          >
            {pending ? "SUBMITTING..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════
// TOAST STACK — bottom-right stacked notifications
// ═══════════════════════════════════════════════════════════════════

const ToastStack = ({ toasts, onDismiss }) => {
  if (!toasts.length) return null;
  return (
    <div
      style={{
        position: "fixed",
        bottom: dim(20),
        right: dim(20),
        zIndex: 200,
        display: "flex",
        flexDirection: "column",
        gap: sp(6),
        pointerEvents: "none",
      }}
    >
      {toasts.map((t) => {
        const kindColor =
          t.kind === "success"
            ? T.green
            : t.kind === "error"
              ? T.red
              : t.kind === "warn"
                ? T.amber
                : T.accent;
        const kindIcon =
          t.kind === "success"
            ? "✓"
            : t.kind === "error"
              ? "✕"
              : t.kind === "warn"
                ? "⚠"
                : "ⓘ";
        return (
          <div
            key={t.id}
            onClick={() => onDismiss && onDismiss(t.id)}
            title="Click to dismiss"
            style={{
              background: T.bg2,
              border: `1px solid ${kindColor}`,
              borderLeft: `3px solid ${kindColor}`,
              borderRadius: dim(4),
              padding: sp("8px 12px"),
              minWidth: dim(260),
              maxWidth: dim(340),
              boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
              animation: t.leaving
                ? "toastSlideOut 0.2s ease-in forwards"
                : "toastSlideIn 0.22s ease-out",
              pointerEvents: "auto",
              cursor: "pointer",
              transition: "transform 0.1s, background 0.1s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = T.bg3;
              e.currentTarget.style.transform = "translateX(-2px)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = T.bg2;
              e.currentTarget.style.transform = "translateX(0)";
            }}
          >
            <div
              style={{ display: "flex", alignItems: "flex-start", gap: sp(8) }}
            >
              <span
                style={{
                  fontSize: fs(14),
                  color: kindColor,
                  fontWeight: 700,
                  lineHeight: 1,
                  marginTop: 1,
                }}
              >
                {kindIcon}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: fs(11),
                    fontWeight: 700,
                    color: T.text,
                    marginBottom: t.body ? sp(2) : 0,
                  }}
                >
                  {t.title}
                </div>
                {t.body && (
                  <div
                    style={{
                      fontSize: fs(10),
                      color: T.textSec,
                      fontFamily: T.mono,
                      lineHeight: 1.4,
                    }}
                  >
                    {t.body}
                  </div>
                )}
              </div>
              <span
                style={{
                  fontSize: fs(11),
                  color: T.textMuted,
                  fontWeight: 600,
                  opacity: 0.6,
                  marginLeft: sp(4),
                  marginTop: 1,
                }}
              >
                ✕
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════════

export default function RayAlgoPlatform() {
  const queryClient = useQueryClient();
  const [screen, setScreen] = useState(_initialState.screen || "market");
  const [sym, setSym] = useState(_initialState.sym || "SPY");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    _initialState.sidebarCollapsed || false,
  );
  const [theme, setTheme] = useState(_initialState.theme || "dark");
  const [activeWatchlistId, setActiveWatchlistId] = useState(
    _initialState.activeWatchlistId || null,
  );
  const [selectedAccountId, setSelectedAccountId] = useState(
    _initialState.selectedAccountId || null,
  );
  // Pending sym hand-off to Trade tab — bumped each time a watchlist item is clicked
  // so TradeScreen can react even when the same sym is clicked twice
  const [tradeSymPing, setTradeSymPing] = useState({
    sym: _initialState.sym || "SPY",
    n: 0,
    contract: null,
  });
  const [marketClockNow, setMarketClockNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setMarketClockNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const sessionQuery = useGetSession({
    query: {
      staleTime: 60_000,
      refetchInterval: 60_000,
      retry: false,
    },
  });
  const watchlistsQuery = useListWatchlists({
    query: {
      staleTime: 60_000,
      refetchInterval: 60_000,
      retry: false,
    },
  });
  const defaultWatchlist = useMemo(() => {
    if (!watchlistsQuery.data?.watchlists?.length) return null;
    return (
      watchlistsQuery.data.watchlists.find((w) => w.isDefault) ||
      watchlistsQuery.data.watchlists[0]
    );
  }, [watchlistsQuery.data]);
  const activeWatchlist = useMemo(() => {
    if (!watchlistsQuery.data?.watchlists?.length) {
      return defaultWatchlist;
    }

    if (activeWatchlistId) {
      return (
        watchlistsQuery.data.watchlists.find(
          (watchlist) => watchlist.id === activeWatchlistId,
        ) || null
      );
    }

    return defaultWatchlist || watchlistsQuery.data.watchlists[0] || null;
  }, [activeWatchlistId, defaultWatchlist, watchlistsQuery.data]);
  const watchlistSymbols = useMemo(() => {
    const apiSymbols =
      activeWatchlist?.items
        ?.map((item) => item.symbol?.toUpperCase())
        .filter(Boolean) || [];
    const fallback = watchlistsQuery.data?.watchlists?.length
      ? []
      : WATCHLIST.map((item) => item.sym);
    const unique = [...new Set(apiSymbols.length ? apiSymbols : fallback)];
    return unique.length ? unique : ["SPY"];
  }, [activeWatchlist, watchlistsQuery.data]);
  const quoteSymbols = useMemo(() => {
    return [
      ...new Set(
        [
          ...watchlistSymbols,
          ...MARKET_SNAPSHOT_SYMBOLS,
          ...HEADER_KPI_SYMBOLS,
          sym,
        ].filter(Boolean),
      ),
    ];
  }, [sym, watchlistSymbols]);
  const sparklineSymbols = useMemo(() => {
    const indexSymbols = INDICES.map((item) => item.sym);
    return [
      ...new Set(
        [...watchlistSymbols, ...indexSymbols, ...HEADER_KPI_SYMBOLS].filter(
          Boolean,
        ),
      ),
    ];
  }, [watchlistSymbols]);
  const streamedMarketSymbols = useMemo(
    () => [
      ...new Set(
        [...quoteSymbols, ...sparklineSymbols]
          .map(normalizeTickerSymbol)
          .filter(Boolean),
      ),
    ],
    [quoteSymbols, sparklineSymbols],
  );
  const quotesQuery = useGetQuoteSnapshots(
    { symbols: quoteSymbols.join(",") },
    {
      query: {
        staleTime: 60_000,
        retry: false,
      },
    },
  );
  const sparklineQuery = useQuery({
    queryKey: ["market-sparklines", sparklineSymbols],
    enabled: sparklineSymbols.length > 0,
    queryFn: async () => {
      const results = await Promise.allSettled(
        sparklineSymbols.map((symbol) =>
          getBarsRequest({
            symbol,
            timeframe: "15m",
            limit: 48,
            outsideRth: true,
            source: "trades",
          }),
        ),
      );

      return Object.fromEntries(
        results.map((result, index) => [
          sparklineSymbols[index],
          result.status === "fulfilled" ? result.value.bars || [] : [],
        ]),
      );
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
    retry: false,
  });
  const marketPerformanceQuery = useQuery({
    queryKey: ["market-performance-baselines", MARKET_PERFORMANCE_SYMBOLS],
    enabled: MARKET_PERFORMANCE_SYMBOLS.length > 0,
    queryFn: async () => {
      const results = await Promise.allSettled(
        MARKET_PERFORMANCE_SYMBOLS.map((symbol) =>
          getBarsRequest({
            symbol,
            timeframe: "1d",
            limit: 6,
            outsideRth: false,
            source: "trades",
          }),
        ),
      );

      return Object.fromEntries(
        results.map((result, index) => {
          const bars =
            result.status === "fulfilled" ? result.value.bars || [] : [];
          const baselineBar = bars.length > 5 ? bars[bars.length - 6] : bars[0];
          return [
            MARKET_PERFORMANCE_SYMBOLS[index],
            baselineBar?.close ?? null,
          ];
        }),
      );
    },
    staleTime: 300_000,
    refetchInterval: 300_000,
    retry: false,
  });
  const accountsQuery = useListAccounts(
    { mode: sessionQuery.data?.environment || "paper" },
    {
      query: {
        enabled: Boolean(sessionQuery.data?.ibkrBridge?.authenticated),
        staleTime: 60_000,
        retry: false,
      },
    },
  );
  const accounts = accountsQuery.data?.accounts || [];
  const marketStockAggregateStreamingEnabled = Boolean(
    sessionQuery.data?.configured?.ibkr &&
      sessionQuery.data?.ibkrBridge?.authenticated,
  );
  useIbkrQuoteSnapshotStream({
    symbols: streamedMarketSymbols,
    enabled: Boolean(
      marketStockAggregateStreamingEnabled && streamedMarketSymbols.length > 0,
    ),
  });
  useIbkrAccountSnapshotStream({
    accountId:
      selectedAccountId ?? sessionQuery.data?.ibkrBridge?.selectedAccountId ?? null,
    mode: sessionQuery.data?.environment || "paper",
    enabled: Boolean(sessionQuery.data?.ibkrBridge?.authenticated),
  });

  useEffect(() => {
    if (!accounts.length) {
      return;
    }

    if (
      selectedAccountId &&
      accounts.some((account) => account.id === selectedAccountId)
    ) {
      return;
    }

    const bridgeSelectedAccountId = sessionQuery.data?.ibkrBridge?.selectedAccountId;
    const nextAccountId =
      bridgeSelectedAccountId &&
      accounts.some((account) => account.id === bridgeSelectedAccountId)
        ? bridgeSelectedAccountId
        : accounts[0]?.id || null;

    if (nextAccountId && nextAccountId !== selectedAccountId) {
      setSelectedAccountId(nextAccountId);
    }
  }, [accounts, selectedAccountId, sessionQuery.data?.ibkrBridge?.selectedAccountId]);

  useBrokerStockAggregateStream({
    symbols: streamedMarketSymbols,
    enabled: Boolean(
      marketStockAggregateStreamingEnabled && streamedMarketSymbols.length > 0,
    ),
    onAggregate: () => {
      queryClient.invalidateQueries({ queryKey: ["market-sparklines"] });
    },
  });

  // ── TOAST SYSTEM ──
  const [toasts, setToasts] = useState([]);
  const toastIdRef = useRef(0);
  const timeoutMapRef = useRef({}); // tracks outer auto-dismiss timeout per toast, so manual dismiss can cancel it
  const dismissToast = useCallback((id) => {
    const timers = timeoutMapRef.current[id];
    if (timers) {
      clearTimeout(timers.dismiss);
      clearTimeout(timers.remove);
      delete timeoutMapRef.current[id];
    }
    setToasts((prev) =>
      prev.map((t) => (t.id === id ? { ...t, leaving: true } : t)),
    );
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 220);
  }, []);
  const pushToast = useCallback(
    ({ title, body, kind = "info", duration = 3500 }) => {
      const id = ++toastIdRef.current;
      setToasts((prev) => [...prev, { id, title, body, kind, leaving: false }]);
      const dismissTimer = setTimeout(() => {
        setToasts((prev) =>
          prev.map((t) => (t.id === id ? { ...t, leaving: true } : t)),
        );
        const removeTimer = setTimeout(
          () => setToasts((prev) => prev.filter((t) => t.id !== id)),
          220,
        );
        timeoutMapRef.current[id] = {
          ...(timeoutMapRef.current[id] || {}),
          remove: removeTimer,
        };
      }, duration);
      timeoutMapRef.current[id] = { dismiss: dismissTimer };
    },
    [],
  );
  const toastValue = useMemo(
    () => ({ push: pushToast, toasts }),
    [pushToast, toasts],
  );

  const upsertWatchlistInCache = useCallback(
    (watchlist) => {
      if (!watchlist?.id) {
        return;
      }

      queryClient.setQueryData(WATCHLISTS_QUERY_KEY, (current) => {
        const currentWatchlists = Array.isArray(current?.watchlists)
          ? current.watchlists
          : [];
        const nextWatchlists = [
          ...currentWatchlists.filter((item) => item.id !== watchlist.id),
          watchlist,
        ].sort((left, right) => {
          if (left.isDefault !== right.isDefault) {
            return left.isDefault ? -1 : 1;
          }
          return left.name.localeCompare(right.name);
        });

        return {
          ...(current || {}),
          watchlists: nextWatchlists,
        };
      });
    },
    [queryClient],
  );
  const removeWatchlistFromCache = useCallback(
    (watchlistId) => {
      if (!watchlistId) {
        return;
      }

      queryClient.setQueryData(WATCHLISTS_QUERY_KEY, (current) => {
        const currentWatchlists = Array.isArray(current?.watchlists)
          ? current.watchlists
          : [];
        return {
          ...(current || {}),
          watchlists: currentWatchlists.filter(
            (watchlist) => watchlist.id !== watchlistId,
          ),
        };
      });
    },
    [queryClient],
  );
  const invalidateWatchlists = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: WATCHLISTS_QUERY_KEY });
  }, [queryClient]);
  const createWatchlistMutation = useMutation({
    mutationFn: (name) =>
      platformJsonRequest("/api/watchlists", {
        method: "POST",
        body: { name },
      }),
    onSuccess: (watchlist) => {
      upsertWatchlistInCache(watchlist);
      invalidateWatchlists();
      if (watchlist?.id) {
        setActiveWatchlistId(watchlist.id);
      }
      pushToast({ title: "Watchlist created", kind: "success" });
    },
    onError: (error) => {
      pushToast({
        title: "Unable to create watchlist",
        body: error?.message || "Request failed",
        kind: "error",
      });
    },
  });
  const updateWatchlistMutation = useMutation({
    mutationFn: ({ watchlistId, body }) =>
      platformJsonRequest(`/api/watchlists/${watchlistId}`, {
        method: "PATCH",
        body,
      }),
    onSuccess: (watchlist) => {
      upsertWatchlistInCache(watchlist);
      invalidateWatchlists();
      pushToast({ title: "Watchlist updated", kind: "success" });
    },
    onError: (error) => {
      pushToast({
        title: "Unable to update watchlist",
        body: error?.message || "Request failed",
        kind: "error",
      });
    },
  });
  const deleteWatchlistMutation = useMutation({
    mutationFn: (watchlistId) =>
      platformJsonRequest(`/api/watchlists/${watchlistId}`, {
        method: "DELETE",
      }),
    onSuccess: (_result, watchlistId) => {
      removeWatchlistFromCache(watchlistId);
      setActiveWatchlistId((current) =>
        current === watchlistId ? null : current,
      );
      invalidateWatchlists();
      pushToast({ title: "Watchlist deleted", kind: "success" });
    },
    onError: (error) => {
      pushToast({
        title: "Unable to delete watchlist",
        body: error?.message || "Request failed",
        kind: "error",
      });
    },
  });
  const addWatchlistSymbolMutation = useMutation({
    mutationFn: ({ watchlistId, symbol, name }) =>
      platformJsonRequest(`/api/watchlists/${watchlistId}/items`, {
        method: "POST",
        body: { symbol, name },
      }),
    onSuccess: (watchlist, variables) => {
      upsertWatchlistInCache(watchlist);
      invalidateWatchlists();
      if (variables?.symbol) {
        const nextSym = variables.symbol.toUpperCase();
        setSym(nextSym);
        setTradeSymPing((prev) => ({
          sym: nextSym,
          n: prev.n + 1,
          contract: null,
        }));
      }
      pushToast({
        title: `Added ${variables?.symbol?.toUpperCase?.() || "symbol"}`,
        kind: "success",
      });
    },
    onError: (error) => {
      pushToast({
        title: "Unable to add symbol",
        body: error?.message || "Request failed",
        kind: "error",
      });
    },
  });
  const removeWatchlistSymbolMutation = useMutation({
    mutationFn: ({ watchlistId, itemId }) =>
      platformJsonRequest(`/api/watchlists/${watchlistId}/items/${itemId}`, {
        method: "DELETE",
      }),
    onSuccess: (watchlist, variables) => {
      upsertWatchlistInCache(watchlist);
      invalidateWatchlists();
      pushToast({
        title: `Removed ${variables?.symbol || "symbol"}`,
        kind: "success",
      });
    },
    onError: (error) => {
      pushToast({
        title: "Unable to remove symbol",
        body: error?.message || "Request failed",
        kind: "error",
      });
    },
  });
  const reorderWatchlistMutation = useMutation({
    mutationFn: ({ watchlistId, itemIds }) =>
      platformJsonRequest(`/api/watchlists/${watchlistId}/items/reorder`, {
        method: "PUT",
        body: { itemIds },
      }),
    onSuccess: (watchlist) => {
      upsertWatchlistInCache(watchlist);
      invalidateWatchlists();
    },
    onError: (error) => {
      pushToast({
        title: "Unable to reorder watchlist",
        body: error?.message || "Request failed",
        kind: "error",
      });
    },
  });

  // ── LOCAL POSITION CONTEXT ──
  // Session-only UI state. Live broker positions are queried separately.
  const [positions, setPositions] = useState([]);
  const [marketDataVersion, setMarketDataVersion] = useState(0);
  const addPosition = useCallback((pos) => {
    setPositions((prev) => [
      {
        ...pos,
        id: `pos_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        openedAt: Date.now(),
      },
      ...prev,
    ]);
  }, []);
  const closePosition = useCallback((id) => {
    setPositions((prev) => prev.filter((p) => p.id !== id));
  }, []);
  const closeAllPositions = useCallback(() => {
    setPositions([]);
  }, []);
  const updateStops = useCallback((id, stops) => {
    setPositions((prev) =>
      prev.map((p) => (p.id === id ? { ...p, ...stops } : p)),
    );
  }, []);
  const rollPosition = useCallback((id) => {
    setPositions((prev) =>
      prev.map((p) =>
        p.id === id
          ? {
              ...p,
              rolledAt: Date.now(),
              exp: p.exp === "04/25" ? "05/16" : "06/20",
            }
          : p,
      ),
    );
  }, []);
  const positionsValue = useMemo(
    () => ({
      positions,
      addPosition,
      closePosition,
      closeAll: closeAllPositions,
      updateStops,
      rollPosition,
    }),
    [
      positions,
      addPosition,
      closePosition,
      closeAllPositions,
      updateStops,
      rollPosition,
    ],
  );

  useEffect(() => {
    syncRuntimeMarketData(
      watchlistSymbols,
      activeWatchlist?.items,
      quotesQuery.data?.quotes,
      {
        sparklineBarsBySymbol: sparklineQuery.data,
        performanceBaselineBySymbol: marketPerformanceQuery.data,
      },
    );
    setMarketDataVersion((version) => version + 1);
  }, [
    watchlistSymbols,
    activeWatchlist,
    quotesQuery.data,
    sparklineQuery.data,
    marketPerformanceQuery.data,
  ]);

  useEffect(() => {
    if (!watchlistsQuery.data?.watchlists?.length) {
      return;
    }
    if (
      activeWatchlistId &&
      watchlistsQuery.data.watchlists.some(
        (watchlist) => watchlist.id === activeWatchlistId,
      )
    ) {
      return;
    }
    const nextWatchlistId =
      defaultWatchlist?.id || watchlistsQuery.data.watchlists[0]?.id || null;
    if (nextWatchlistId) {
      setActiveWatchlistId(nextWatchlistId);
    }
  }, [activeWatchlistId, defaultWatchlist, watchlistsQuery.data]);

  useEffect(() => {
    if (!activeWatchlistId) return;
    persistState({ activeWatchlistId });
  }, [activeWatchlistId]);
  useEffect(() => {
    persistState({ selectedAccountId });
  }, [selectedAccountId]);

  useEffect(() => {
    if (screen === "trade") return;
    if (sym || !watchlistSymbols.length) return;

    const nextSym = watchlistSymbols[0];
    setSym(nextSym);
    setTradeSymPing((prev) => ({ sym: nextSym, n: prev.n + 1 }));
  }, [screen, watchlistSymbols, sym]);

  useEffect(() => {
    if (!activeWatchlist?.items?.length) {
      return;
    }
    if (activeWatchlist.items.some((item) => item.symbol === sym)) {
      return;
    }

    const nextSym = activeWatchlist.items[0]?.symbol;
    if (!nextSym) {
      return;
    }

    setSym(nextSym);
    setTradeSymPing((prev) => ({ sym: nextSym, n: prev.n + 1, contract: null }));
  }, [activeWatchlist, sym]);

  const session = sessionQuery.data || null;
  const environment = sessionQuery.data?.environment || "paper";
  const brokerConfigured = Boolean(session?.configured?.ibkr);
  const brokerAuthenticated = Boolean(session?.ibkrBridge?.authenticated);
  const stockAggregateStreamingEnabled = Boolean(
    brokerConfigured && brokerAuthenticated,
  );
  const bridgeTone = bridgeRuntimeTone(session);
  const primaryAccount =
    accounts.find((account) => account.id === selectedAccountId) ||
    accounts[0] ||
    null;
  const primaryAccountId =
    primaryAccount?.id ||
    session?.ibkrBridge?.selectedAccountId ||
    selectedAccountId ||
    null;
  const positionAlertsQuery = useListPositions(
    { accountId: primaryAccountId, mode: environment },
    {
      query: {
        enabled: Boolean(brokerAuthenticated && primaryAccountId),
        ...QUERY_DEFAULTS,
        refetchInterval: false,
      },
    },
  );
  const alertingPositions = useMemo(() => {
    if (!brokerConfigured || !brokerAuthenticated || !primaryAccountId) {
      return [];
    }

    return (positionAlertsQuery.data?.positions || []).flatMap((position) => {
      const pct = position.unrealizedPnlPercent;
      if (!isFiniteNumber(pct)) {
        return [];
      }
      if (pct >= 50) {
        return [{ id: position.id, pct, kind: "profit" }];
      }
      if (pct <= -25) {
        return [{ id: position.id, pct, kind: "loss" }];
      }
      return [];
    });
  }, [
    brokerAuthenticated,
    brokerConfigured,
    primaryAccountId,
    positionAlertsQuery.data,
  ]);
  const winAlerts = alertingPositions.filter((a) => a.kind === "profit").length;
  const lossAlerts = alertingPositions.filter((a) => a.kind === "loss").length;
  const totalAlerts = winAlerts + lossAlerts;
  const marketAlertItems = useMemo(() => {
    if (!brokerConfigured || !brokerAuthenticated || !primaryAccountId) {
      return [];
    }

    return (positionAlertsQuery.data?.positions || [])
      .flatMap((position) => {
        const pct = position.unrealizedPnlPercent;
        if (!isFiniteNumber(pct)) {
          return [];
        }

        if (pct >= 50) {
          return [
            {
              id: `alert_${position.id}`,
              symbol: position.symbol,
              label: `${position.symbol} profit alert`,
              detail: `${formatSignedPercent(pct, 1)} unrealized PnL`,
              tone: "profit",
            },
          ];
        }

        if (pct <= -25) {
          return [
            {
              id: `alert_${position.id}`,
              symbol: position.symbol,
              label: `${position.symbol} risk alert`,
              detail: `${formatSignedPercent(pct, 1)} unrealized PnL`,
              tone: "risk",
            },
          ];
        }

        return [];
      })
      .slice(0, 6);
  }, [
    brokerAuthenticated,
    brokerConfigured,
    positionAlertsQuery.data,
    primaryAccountId,
  ]);
  const signalMonitorParams = useMemo(() => ({ environment }), [environment]);
  const signalMonitorEventsParams = useMemo(
    () => ({ environment, limit: 100 }),
    [environment],
  );
  const signalMonitorProfileQuery = useGetSignalMonitorProfile(
    signalMonitorParams,
    {
      query: {
        staleTime: 60_000,
        refetchInterval: 60_000,
        retry: false,
      },
    },
  );
  const signalMonitorProfile = signalMonitorProfileQuery.data || null;
  const signalMonitorPollMs = clampNumber(
    (signalMonitorProfile?.pollIntervalSeconds || 60) * 1000,
    15_000,
    3_600_000,
  );
  const signalMonitorStateQuery = useGetSignalMonitorState(
    signalMonitorParams,
    {
      query: {
        staleTime: 15_000,
        refetchInterval: signalMonitorProfile?.enabled
          ? signalMonitorPollMs
          : false,
        retry: false,
      },
    },
  );
  const signalMonitorEventsQuery = useListSignalMonitorEvents(
    signalMonitorEventsParams,
    {
      query: {
        staleTime: 15_000,
        refetchInterval: signalMonitorProfile?.enabled
          ? signalMonitorPollMs
          : false,
        retry: false,
      },
    },
  );
  const signalMonitorEvaluationInFlightRef = useRef(false);
  const updateSignalMonitorProfileMutation = useUpdateSignalMonitorProfile({
    mutation: {
      onSuccess: (profile) => {
        queryClient.setQueryData(
          getGetSignalMonitorProfileQueryKey({
            environment: profile.environment,
          }),
          profile,
        );
        queryClient.invalidateQueries({
          queryKey: getGetSignalMonitorStateQueryKey({
            environment: profile.environment,
          }),
        });
      },
      onError: (error) => {
        pushToast({
          title: "Unable to update signal monitor",
          body: error?.message || "Request failed",
          kind: "error",
        });
      },
    },
  });
  const evaluateSignalMonitorMutation = useEvaluateSignalMonitor({
    mutation: {
      onSuccess: (data) => {
        queryClient.setQueryData(
          getGetSignalMonitorStateQueryKey({
            environment: data.profile.environment,
          }),
          data,
        );
        queryClient.invalidateQueries({
          queryKey: getListSignalMonitorEventsQueryKey({
            environment: data.profile.environment,
            limit: 100,
          }),
        });
      },
      onError: (error) => {
        pushToast({
          title: "Signal monitor scan failed",
          body: error?.message || "Request failed",
          kind: "error",
        });
      },
      onSettled: () => {
        signalMonitorEvaluationInFlightRef.current = false;
      },
    },
  });
  const runSignalMonitorEvaluation = useCallback(
    (mode = "incremental") => {
      if (!activeWatchlist?.id || signalMonitorEvaluationInFlightRef.current) {
        return;
      }
      signalMonitorEvaluationInFlightRef.current = true;
      evaluateSignalMonitorMutation.mutate({
        data: {
          environment,
          mode,
          watchlistId: activeWatchlist.id,
        },
      });
    },
    [activeWatchlist?.id, environment, evaluateSignalMonitorMutation.mutate],
  );
  useEffect(() => {
    if (!activeWatchlist?.id || !signalMonitorProfile) {
      return;
    }
    if (signalMonitorProfile.watchlistId === activeWatchlist.id) {
      return;
    }
    if (updateSignalMonitorProfileMutation.isPending) {
      return;
    }

    updateSignalMonitorProfileMutation.mutate({
      data: {
        environment,
        watchlistId: activeWatchlist.id,
      },
    });
  }, [
    activeWatchlist?.id,
    environment,
    signalMonitorProfile,
    updateSignalMonitorProfileMutation.isPending,
    updateSignalMonitorProfileMutation.mutate,
  ]);
  useEffect(() => {
    if (!activeWatchlist?.id || !signalMonitorProfile?.enabled) {
      return undefined;
    }

    runSignalMonitorEvaluation("incremental");
    const timer = window.setInterval(
      () => runSignalMonitorEvaluation("incremental"),
      signalMonitorPollMs,
    );
    return () => window.clearInterval(timer);
  }, [
    activeWatchlist?.id,
    runSignalMonitorEvaluation,
    signalMonitorPollMs,
    signalMonitorProfile?.enabled,
    signalMonitorProfile?.timeframe,
  ]);
  const signalMonitorStates = signalMonitorStateQuery.data?.states || [];
  const signalMonitorEvents = signalMonitorEventsQuery.data?.events || [];
  const signalStatesBySymbol = useMemo(
    () =>
      Object.fromEntries(
        signalMonitorStates
          .filter((state) => state?.symbol)
          .map((state) => [state.symbol.toUpperCase(), state]),
      ),
    [signalMonitorStates],
  );
  const watchlistSidebarItems = useMemo(() => {
    const sourceItems =
      activeWatchlist?.items?.length
        ? activeWatchlist.items
        : watchlistSymbols.map((symbol) => ({ id: symbol, symbol }));

    return sourceItems.map((item, index) => {
      const symbol = item.symbol.toUpperCase();
      const fallback = buildFallbackWatchlistItem(
        symbol,
        index,
        item.name || symbol,
      );
      const snapshot = getRuntimeTickerSnapshot(symbol, fallback) || fallback;
      return {
        id: item.id || symbol,
        sym: symbol,
        name: item.name || snapshot.name || fallback.name || symbol,
        price: snapshot.price,
        chg: snapshot.chg,
        pct: snapshot.pct,
        spark: snapshot.spark || fallback.spark,
        sparkBars: snapshot.sparkBars || fallback.sparkBars || [],
        signalState: signalStatesBySymbol[symbol] || null,
      };
    });
  }, [activeWatchlist, marketDataVersion, signalStatesBySymbol, watchlistSymbols]);
  const headerKpiItems = useMemo(
    () =>
      HEADER_KPI_CONFIG.map(({ symbol, label }, index) => {
        const fallback = buildFallbackWatchlistItem(symbol, index, label);
        const snapshot = getRuntimeTickerSnapshot(symbol, fallback) || fallback;
        return {
          sym: symbol,
          label,
          name: snapshot.name || fallback.name || label,
          price: snapshot.price,
          pct: snapshot.pct,
          spark: snapshot.spark || fallback.spark,
          sparkBars: snapshot.sparkBars || fallback.sparkBars || [],
        };
      }),
    [marketDataVersion],
  );
  const marketClock = useMemo(
    () => buildMarketClockState(marketClockNow),
    [marketClockNow],
  );
  // Persist state changes (debounced via useEffect — fires after each commit)
  useEffect(() => {
    persistState({ screen });
  }, [screen]);
  useEffect(() => {
    persistState({ sym });
  }, [sym]);
  useEffect(() => {
    persistState({ sidebarCollapsed });
  }, [sidebarCollapsed]);
  useEffect(() => {
    persistState({ theme });
  }, [theme]);
  // Toggle theme: flip module-level CURRENT_THEME so the T proxy resolves to the new palette,
  // then update React state to force the entire tree to re-render and re-read T.foo
  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    CURRENT_THEME = next;
    setTheme(next);
  };

  const handleSelectWatchlist = (watchlistId) => {
    setActiveWatchlistId(watchlistId);
  };

  // Watchlist sync: clicking a sidebar item updates sym AND signals Trade tab
  // to load it into the active slot
  const handleSelectSymbol = (newSym) => {
    setSym(newSym);
    setTradeSymPing((prev) => ({ sym: newSym, n: prev.n + 1, contract: null }));
  };

  const handleSignalAction = (ticker, signal) => {
    const normalized = normalizeTickerSymbol(ticker);
    if (!normalized) {
      return;
    }

    ensureTradeTickerInfo(normalized, normalized);
    setSym(normalized);
    setTradeSymPing((prev) => ({
      sym: normalized,
      n: prev.n + 1,
      contract: null,
    }));
    setScreen("trade");
    pushToast({
      title: `${normalized} ${String(signal?.currentSignalDirection || signal?.direction || "signal").toUpperCase()} signal`,
      body: signal?.timeframe
        ? `${signal.timeframe} RayReplica monitor signal loaded into Trade.`
        : "RayReplica monitor signal loaded into Trade.",
      kind:
        signal?.currentSignalDirection === "sell" || signal?.direction === "sell"
          ? "warn"
          : "success",
      duration: 2600,
    });
  };

  const handleToggleSignalMonitor = () => {
    updateSignalMonitorProfileMutation.mutate({
      data: {
        environment,
        enabled: !signalMonitorProfile?.enabled,
        watchlistId: activeWatchlist?.id || signalMonitorProfile?.watchlistId || null,
      },
    });
  };

  const handleChangeSignalMonitorTimeframe = (timeframe) => {
    updateSignalMonitorProfileMutation.mutate({
      data: {
        environment,
        timeframe,
        watchlistId: activeWatchlist?.id || signalMonitorProfile?.watchlistId || null,
      },
    });
  };

  const handleCreateWatchlist = (name) => {
    createWatchlistMutation.mutate(name);
  };

  const handleRenameWatchlist = (watchlistId, name) => {
    updateWatchlistMutation.mutate({ watchlistId, body: { name } });
  };

  const handleDeleteWatchlist = (watchlistId) => {
    deleteWatchlistMutation.mutate(watchlistId);
  };

  const handleSetDefaultWatchlist = (watchlistId) => {
    updateWatchlistMutation.mutate({
      watchlistId,
      body: { isDefault: true },
    });
  };

  const handleAddSymbolToWatchlist = (symbol, name) => {
    if (!activeWatchlist?.id) {
      pushToast({
        title: "No active watchlist selected",
        kind: "warn",
      });
      return;
    }
    addWatchlistSymbolMutation.mutate({
      watchlistId: activeWatchlist.id,
      symbol,
      name,
    });
  };

  const handleRemoveSymbolFromWatchlist = (itemId, symbol) => {
    if (!activeWatchlist?.id) {
      return;
    }
    removeWatchlistSymbolMutation.mutate({
      watchlistId: activeWatchlist.id,
      itemId,
      symbol,
    });
  };
  const handleMoveSymbolInWatchlist = (itemId, direction) => {
    if (!activeWatchlist?.id || !activeWatchlist.items?.length) {
      return;
    }

    const orderedIds = activeWatchlist.items
      .map((item) => item.id)
      .filter((id) => typeof id === "string" && id.length > 0);
    const currentIndex = orderedIds.indexOf(itemId);
    if (currentIndex < 0) {
      return;
    }

    const targetIndex =
      direction === "up" ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= orderedIds.length) {
      return;
    }

    const nextIds = [...orderedIds];
    const [movedId] = nextIds.splice(currentIndex, 1);
    nextIds.splice(targetIndex, 0, movedId);

    reorderWatchlistMutation.mutate({
      watchlistId: activeWatchlist.id,
      itemIds: nextIds,
    });
  };

  // Jump to Trade tab from Flow drawer with a contract preloaded
  const handleJumpToTradeFromFlow = (evt) => {
    const ticker = evt.ticker?.toUpperCase?.() || evt.ticker;
    if (!ticker) return;

    ensureTradeTickerInfo(ticker, ticker);
    setSym(ticker);
    setTradeSymPing((prev) => ({
      sym: ticker,
      n: prev.n + 1,
      contract: {
        strike: evt.strike,
        cp: evt.cp,
        exp: formatExpirationLabel(evt.expirationDate || evt.exp),
      },
    }));
    setScreen("trade");
  };

  // Jump to Trade tab from Research with a ticker preloaded.
  // Research passes a plain ticker string rather than a flow event.
  const handleJumpToTradeFromResearch = (ticker) => {
    const normalized = ticker?.toUpperCase?.() || ticker;
    if (!normalized) return;

    ensureTradeTickerInfo(normalized, normalized);
    setSym(normalized);
    setTradeSymPing((prev) => ({
      sym: normalized,
      n: prev.n + 1,
      contract: null,
    }));
    setScreen("trade");
  };

  const renderScreen = () => {
    switch (screen) {
      case "market":
        return (
          <MarketScreen
            sym={sym}
            onSymClick={handleSelectSymbol}
            symbols={watchlistSymbols}
            researchConfigured={Boolean(
              sessionQuery.data?.configured?.research,
            )}
            stockAggregateStreamingEnabled={stockAggregateStreamingEnabled}
            marketNotifications={marketAlertItems}
            signalEvents={signalMonitorEvents}
            signalStates={signalMonitorStates}
            signalMonitorProfile={signalMonitorProfile}
            signalMonitorPending={evaluateSignalMonitorMutation.isPending}
            onSignalAction={handleSignalAction}
            onScanNow={() => runSignalMonitorEvaluation("incremental")}
            onToggleMonitor={handleToggleSignalMonitor}
            onChangeMonitorTimeframe={handleChangeSignalMonitorTimeframe}
          />
        );
      case "flow":
        return (
          <FlowScreen
            session={session}
            symbols={watchlistSymbols}
            onJumpToTrade={handleJumpToTradeFromFlow}
          />
        );
      case "trade":
        return (
          <TradeScreen
            sym={sym}
            symPing={tradeSymPing}
            session={session}
            environment={environment}
            accountId={primaryAccountId}
            brokerConfigured={brokerConfigured}
            brokerAuthenticated={brokerAuthenticated}
          />
        );
      case "research":
        return <ResearchScreen onJumpToTrade={handleJumpToTradeFromResearch} />;
      case "algo":
        return (
          <AlgoScreen
            session={session}
            environment={environment}
            accounts={accounts}
            selectedAccountId={primaryAccountId}
          />
        );
      case "backtest":
        return (
          <BacktestScreen
            watchlists={watchlistsQuery.data?.watchlists || []}
            defaultWatchlistId={defaultWatchlist?.id || null}
          />
        );
      default:
        return (
          <MarketScreen
            sym={sym}
            onSymClick={handleSelectSymbol}
            symbols={watchlistSymbols}
            researchConfigured={Boolean(
              sessionQuery.data?.configured?.research,
            )}
            stockAggregateStreamingEnabled={stockAggregateStreamingEnabled}
            marketNotifications={marketAlertItems}
            signalEvents={signalMonitorEvents}
            signalStates={signalMonitorStates}
            signalMonitorProfile={signalMonitorProfile}
            signalMonitorPending={evaluateSignalMonitorMutation.isPending}
            onSignalAction={handleSignalAction}
            onScanNow={() => runSignalMonitorEvaluation("incremental")}
            onToggleMonitor={handleToggleSignalMonitor}
            onChangeMonitorTimeframe={handleChangeSignalMonitorTimeframe}
          />
        );
    }
  };

  return (
    <ThemeContext.Provider value={{ theme, toggle: toggleTheme }}>
      <ToastContext.Provider value={toastValue}>
        <PositionsContext.Provider value={positionsValue}>
          <div
            style={{
              height: "100vh",
              display: "flex",
              flexDirection: "column",
              background: T.bg0,
              color: T.text,
              fontFamily: T.sans,
            }}
          >
            <style>{FONT_CSS}</style>
            <ToastStack toasts={toasts} onDismiss={dismissToast} />

            {/* ══════ TOP ANCHOR BAR ══════ */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                background: T.bg1,
                borderBottom: `1px solid ${T.border}`,
                flexShrink: 0,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: sp(12),
                  padding: sp("8px 12px"),
                  borderBottom: `1px solid ${T.border}`,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    gap: 1,
                    minWidth: 0,
                    flexWrap: "wrap",
                  }}
                >
                  {SCREENS.map((s) => {
                    const isTradeTab = s.id === "trade";
                    const hasAlerts = isTradeTab && totalAlerts > 0;
                    const alertColor = lossAlerts > winAlerts ? T.red : T.amber;
                    const pulseAnim = hasAlerts
                      ? lossAlerts > winAlerts
                        ? "pulseAlertLoss 1.8s ease-in-out infinite"
                        : "pulseAlert 1.8s ease-in-out infinite"
                      : "none";
                    return (
                      <button
                        key={s.id}
                        onClick={() => setScreen(s.id)}
                        style={{
                          padding: sp("6px 14px"),
                          fontSize: fs(11),
                          fontWeight: 600,
                          fontFamily: T.sans,
                          background: screen === s.id ? T.bg3 : "transparent",
                          border: `1px solid ${screen === s.id ? T.accent : T.border}`,
                          borderRadius: 0,
                          cursor: "pointer",
                          color: screen === s.id ? T.text : T.textDim,
                          transition:
                            "background 0.15s ease, color 0.15s ease, border-color 0.15s ease",
                          animation: pulseAnim,
                          position: "relative",
                        }}
                        onMouseEnter={(e) => {
                          if (screen === s.id) return;
                          e.currentTarget.style.color = T.textSec;
                          e.currentTarget.style.background = T.bg2;
                          e.currentTarget.style.borderColor = T.textMuted;
                        }}
                        onMouseLeave={(e) => {
                          if (screen === s.id) return;
                          e.currentTarget.style.color = T.textDim;
                          e.currentTarget.style.background = "transparent";
                          e.currentTarget.style.borderColor = T.border;
                        }}
                        title={
                          hasAlerts
                            ? `${totalAlerts} position${totalAlerts === 1 ? "" : "s"} at alert threshold (${winAlerts} win · ${lossAlerts} loss)`
                            : undefined
                        }
                      >
                        <span style={{ marginRight: sp(4), fontSize: fs(10) }}>
                          {s.icon}
                        </span>
                        {s.label}
                        {hasAlerts && (
                          <span
                            style={{
                              marginLeft: sp(4),
                              padding: sp("1px 5px"),
                              borderRadius: 0,
                              background: alertColor,
                              color: "#fff",
                              fontSize: fs(8),
                              fontWeight: 800,
                              fontFamily: T.sans,
                              letterSpacing: "0.04em",
                              verticalAlign: "middle",
                            }}
                          >
                            {totalAlerts}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>

                <span style={{ flex: 1, minWidth: 0 }} />

                <HeaderStatusCluster
                  session={session}
                  environment={environment}
                  bridgeTone={bridgeTone}
                  marketClock={marketClock}
                  theme={theme}
                  onToggleTheme={toggleTheme}
                />
              </div>

              <div
                style={{
                  display: "flex",
                  alignItems: "stretch",
                  gap: sp(12),
                  padding: sp("8px 12px"),
                  flexWrap: "wrap",
                  justifyContent: "space-between",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <HeaderKpiStrip
                    items={headerKpiItems}
                    onSelect={handleSelectSymbol}
                  />
                </div>

                <HeaderAccountStrip
                  accounts={accounts}
                  primaryAccountId={primaryAccountId}
                  primaryAccount={primaryAccount}
                  onSelectAccount={setSelectedAccountId}
                />
              </div>
            </div>

            {/* ══════ MAIN CONTENT (3 columns) ══════ */}
            <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
              {/* Left: Watchlist */}
              <div
                style={{
                  width: sidebarCollapsed ? 40 : 200,
                  transition: "width 0.2s",
                  flexShrink: 0,
                  overflow: "hidden",
                }}
              >
                {sidebarCollapsed ? (
                  <div
                    style={{
                      height: "100%",
                      background: T.bg1,
                      borderRight: `1px solid ${T.border}`,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      paddingTop: sp(8),
                    }}
                  >
                    <button
                      onClick={() => setSidebarCollapsed(false)}
                      style={{
                        width: dim(28),
                        height: dim(28),
                        border: "none",
                        borderRadius: 0,
                        background: T.bg2,
                        color: T.textDim,
                        cursor: "pointer",
                        fontSize: fs(12),
                      }}
                    >
                      ☰
                    </button>
                  </div>
                ) : (
                  <div style={{ position: "relative", height: "100%" }}>
                    <button
                      onClick={() => setSidebarCollapsed(true)}
                      style={{
                        position: "absolute",
                        top: 8,
                        right: 6,
                        zIndex: 2,
                        width: dim(18),
                        height: dim(18),
                        border: "none",
                        borderRadius: 0,
                        background: T.bg3,
                        color: T.textDim,
                        cursor: "pointer",
                        fontSize: fs(9),
                      }}
                    >
                      ◂
                    </button>
                    <Watchlist
                      watchlists={watchlistsQuery.data?.watchlists || []}
                      activeWatchlistId={activeWatchlist?.id || null}
                      items={watchlistSidebarItems}
                      selected={sym}
                      onSelect={handleSelectSymbol}
                      onSelectWatchlist={handleSelectWatchlist}
                      onCreateWatchlist={handleCreateWatchlist}
                      onRenameWatchlist={handleRenameWatchlist}
                      onDeleteWatchlist={handleDeleteWatchlist}
                      onSetDefaultWatchlist={handleSetDefaultWatchlist}
                      onAddSymbol={handleAddSymbolToWatchlist}
                      onMoveSymbol={handleMoveSymbolInWatchlist}
                      onRemoveSymbol={handleRemoveSymbolFromWatchlist}
                      onSignalAction={handleSignalAction}
                      signalStatesBySymbol={signalStatesBySymbol}
                      busy={
                        createWatchlistMutation.isPending ||
                        updateWatchlistMutation.isPending ||
                        deleteWatchlistMutation.isPending ||
                        addWatchlistSymbolMutation.isPending ||
                        removeWatchlistSymbolMutation.isPending ||
                        reorderWatchlistMutation.isPending
                      }
                    />
                  </div>
                )}
              </div>

              {/* Center: Active Screen */}
              <div
                style={{
                  flex: 1,
                  overflow: "hidden",
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                {renderScreen()}
              </div>
            </div>

            {/* ══════ STATUS BAR ══════ */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                height: dim(24),
                padding: sp("0 12px"),
                background: T.bg1,
                borderTop: `1px solid ${T.border}`,
                flexShrink: 0,
                fontSize: fs(9),
                fontFamily: T.sans,
                gap: sp(12),
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <div
                  style={{
                    width: dim(6),
                    height: dim(6),
                    borderRadius: "50%",
                    background: environment === "live" ? T.red : T.green,
                  }}
                />
                <span
                  style={{
                    color: environment === "live" ? T.red : T.green,
                    fontWeight: 600,
                  }}
                >
                  {environment.toUpperCase()}
                </span>
              </div>
              <span style={{ color: T.textMuted }}>
                WL {(activeWatchlist?.name || "Core").toUpperCase()}
              </span>
              <span style={{ color: T.textMuted }}>
                SYM {sym}
              </span>
              <span
                style={{ color: session?.configured?.ibkr ? T.green : T.red }}
              >
                {session?.ibkrBridge?.liveMarketDataAvailable === false
                  ? "DELAYED"
                  : "LIVE"}{" "}
                {(session?.marketDataProviders?.live || MISSING_VALUE).toUpperCase()}
              </span>
              <span
                style={{
                  color: session?.configured?.ibkr ? T.green : T.red,
                }}
              >
                HIST{" "}
                {(
                  session?.marketDataProviders?.historical || MISSING_VALUE
                ).toUpperCase()}
              </span>
              <span
                style={{
                  color: session?.configured?.research ? T.green : T.red,
                }}
              >
                RSCH{" "}
                {(session?.marketDataProviders?.research || MISSING_VALUE).toUpperCase()}
              </span>
              <span style={{ color: bridgeTone.color }}>
                BRIDGE {session?.ibkrBridge?.transport === "tws" ? "TWS" : "CP"} ·{" "}
                {bridgeTone.label.toUpperCase()}
              </span>
              <span style={{ flex: 1 }} />
              <span style={{ color: T.textMuted }}>v0.1.0</span>
            </div>
          </div>
        </PositionsContext.Provider>
      </ToastContext.Provider>
    </ThemeContext.Provider>
  );
}
