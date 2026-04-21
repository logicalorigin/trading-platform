import { useState, useEffect, useRef, useCallback, useMemo, createContext, useContext, useDeferredValue } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Line, AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ReferenceLine, ComposedChart } from "recharts";
import * as d3 from "d3";
import {
  getBars as getBarsRequest,
  getOptionChain as getOptionChainRequest,
  listFlowEvents as listFlowEventsRequest,
  useGetNews,
  useGetQuoteSnapshots,
  useGetResearchEarningsCalendar,
  useSearchUniverseTickers,
  useGetSession,
  useListAccounts,
  useListPositions,
  useListWatchlists,
  usePlaceOrder,
} from "@workspace/api-client-react";
import PhotonicsObservatory from "./features/research/PhotonicsObservatory";
import {
  ResearchSparkline,
  ResearchChartFrame,
  ResearchChartSurface,
  ResearchChartWidgetHeader,
  ResearchChartWidgetFooter,
  buildResearchChartModel,
  getStoredStockMinuteAggregates,
  useMassiveStockAggregateStream,
  useMassiveStreamedStockBars,
} from "./features/charting";

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
    bg0: "#080b12",       // deepest — app bg
    bg1: "#0d1117",       // panels, sidebar
    bg2: "#141b27",       // cards, elevated surfaces
    bg3: "#1a2235",       // hover states, active items
    bg4: "#212d42",       // tooltips, dropdowns

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
    bg0: "#f5f5f4",       // app bg — very subtle warm gray so white panels pop
    bg1: "#ffffff",       // panels, sidebar — pure white
    bg2: "#ffffff",       // cards, elevated surfaces — pure white
    bg3: "#f8fafc",       // hover states, active items — barely-tinted (only on interaction)
    bg4: "#ffffff",       // tooltips, dropdowns — pure white

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
  mono: "'JetBrains Mono', 'SF Mono', 'Menlo', monospace",
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
  } catch (e) { return {}; }
})();
const persistState = (patch) => {
  try {
    if (typeof window === "undefined" || !window.localStorage) return;
    const current = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "{}");
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, ...patch }));
  } catch (e) {}
};

// Mutable current theme name — flipped by setThemeMode, forces re-render via React state at App root
let CURRENT_THEME = _initialState.theme || "dark";

// ─── SIZE SCALE SYSTEM ───
// Mirror of theme system — global mutable scale level, helpers that read from it,
// React state at App root triggers cascade re-render so all fs()/sp()/dim() calls re-evaluate.
const SCALE_LEVELS = {
  xs: 0.85,
  s:  0.92,
  m:  1.00,
  l:  1.12,
  xl: 1.25,
};
let CURRENT_SCALE = _initialState.scale || "m";
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
const T = new Proxy({}, {
  get(_target, prop) {
    if (prop in TYPOGRAPHY) return TYPOGRAPHY[prop];
    return THEMES[CURRENT_THEME][prop];
  }
});

// React context provides the toggle to children + holds state that triggers re-renders
const ThemeContext = createContext({ theme: "dark", toggle: () => {} });

// Toast notifications — globally accessible via useToast()
const ToastContext = createContext({ push: () => {}, toasts: [] });
const useToast = () => useContext(ToastContext);

// Mock positions — filled orders flow here, Positions panel reads from here
const PositionsContext = createContext({
  positions: [], addPosition: () => {}, closePosition: () => {}, closeAll: () => {}, updateStops: () => {}, rollPosition: () => {},
});
const usePositions = () => useContext(PositionsContext);

// ═══════════════════════════════════════════════════════════════════
// MOCK DATA
// ═══════════════════════════════════════════════════════════════════

const rng = (seed) => { let x = seed; return () => { x = (x * 16807 + 7) % 2147483647; return (x - 1) / 2147483646; }; };
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
  { sym: "SPY", name: "SPDR S&P 500", price: 582.41, chg: +1.87, pct: +0.32, spark: genSparkline(1, 48, 582, 0.8) },
  { sym: "QQQ", name: "Invesco QQQ", price: 498.23, chg: -2.14, pct: -0.43, spark: genSparkline(2, 48, 498, 1.1) },
  { sym: "IWM", name: "iShares Russ 2000", price: 221.05, chg: +0.62, pct: +0.28, spark: genSparkline(3, 48, 221, 0.5) },
  { sym: "VIXY", name: "ProShares VIX Short-Term Futures ETF", price: 28.68, chg: +0.28, pct: +0.99, spark: genSparkline(4, 48, 29, 0.35) },
  { sym: "AAPL", name: "Apple Inc", price: 228.34, chg: +3.12, pct: +1.38, spark: genSparkline(5, 48, 228, 1.5) },
  { sym: "MSFT", name: "Microsoft Corp", price: 441.67, chg: -1.23, pct: -0.28, spark: genSparkline(6, 48, 441, 2.0) },
  { sym: "NVDA", name: "NVIDIA Corp", price: 135.89, chg: +4.56, pct: +3.47, spark: genSparkline(7, 48, 136, 3.0) },
  { sym: "AMZN", name: "Amazon.com", price: 198.45, chg: +0.89, pct: +0.45, spark: genSparkline(8, 48, 198, 1.2) },
  { sym: "META", name: "Meta Platforms", price: 612.30, chg: -5.67, pct: -0.92, spark: genSparkline(9, 48, 612, 3.5) },
  { sym: "TSLA", name: "Tesla Inc", price: 248.91, chg: +7.23, pct: +2.99, spark: genSparkline(10, 48, 249, 4.0) },
  { sym: "UUP", name: "Invesco DB US Dollar Index Bullish Fund", price: 27.385, chg: +0.065, pct: +0.24, spark: genSparkline(11, 48, 27.4, 0.08) },
  { sym: "IEF", name: "iShares 7-10 Year Treasury Bond ETF", price: 95.54, chg: -0.28, pct: -0.29, spark: genSparkline(12, 48, 95.5, 0.18) },
];
const DEFAULT_WATCHLIST_BY_SYMBOL = Object.fromEntries(
  WATCHLIST.map(item => [item.sym, { ...item, spark: [...item.spark] }])
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
    const vol = Math.round((500000 + r() * 800000) * (i < 6 ? 2.5 : i > count - 6 ? 2.0 : 0.6 + r()));
    // UOA overlay: ~15% of bars have UOA activity. Intensity 0.2-0.9 of volume.
    const hasUoa = r() < 0.15;
    const uoa = hasUoa ? +(0.2 + r() * 0.7).toFixed(2) : 0;
    p = c;
    return { time: `${hr}:${String(mn).padStart(2, "0")}`, o, h, l, c, v: vol, i, uoa };
  });
};

const genFlowEvents = (seed) => {
  const r = rng(seed);
  const types = ["SWEEP", "BLOCK", "SPLIT", "MULTI"];
  const sides = ["BUY", "SELL", "MID"];
  const tickers = ["SPY", "QQQ", "AAPL", "NVDA", "TSLA", "META", "MSFT", "AMZN"];
  return Array.from({ length: 50 }, (_, i) => {
    const tk = tickers[Math.floor(r() * tickers.length)];
    const side = sides[Math.floor(r() * 3)];
    const cp = r() > 0.45 ? "C" : "P";
    const strike = Math.round((400 + r() * 300) / 5) * 5;
    const prem = Math.round(10000 + r() * 500000);
    const vol = Math.round(50 + r() * 2000);
    const oi = Math.round(500 + r() * 15000);
    const iv = +(0.15 + r() * 0.4).toFixed(3);
    const isGolden = side === "BUY" && prem > 150000 && r() > 0.7;
    const hr = 9 + Math.floor(r() * 7);
    const mn = Math.floor(r() * 60);
    return {
      id: i, time: `${hr}:${String(mn).padStart(2, "0")}`, ticker: tk,
      side, contract: `${tk} ${strike}${cp} 04/25`, strike, cp,
      premium: prem, vol, oi, iv, dte: Math.floor(1 + r() * 30),
      type: types[Math.floor(r() * types.length)],
      golden: isGolden, score: Math.round(20 + r() * 80),
    };
  }).sort((a, b) => b.premium - a.premium);
};

const FLOW_EVENTS = genFlowEvents(777);

// ─── CONTRACT PRINT HISTORY (for detail drawer) ───
// Given a flow event, generate ~30-50 individual prints distributed across the day,
// plus a 5-min binned series for the dual-axis chart.
// Volume hits at-ask/at-bid/at-mid based on the event's side (BUY → mostly at-ask).
const genContractPrintHistory = (evt) => {
  const r = rng(evt.id * 17 + 31);
  // Parse killshot time (the FLOW_EVENTS row time is "HH:MM")
  const [killHr, killMin] = evt.time.split(":").map(Number);
  const killBar = Math.max(0, Math.min(77, ((killHr - 9) * 60 + killMin - 30) / 5)); // 5-min bar index 0-77

  // Bias for hit side: BUY = mostly at-ask, SELL = mostly at-bid, MID = balanced
  const askBias = evt.side === "BUY" ? 0.78 : evt.side === "SELL" ? 0.18 : 0.40;
  const midShare = evt.side === "MID" ? 0.45 : 0.10;

  // Generate option price path: 78 5-min bars (9:30 → 16:00)
  // Price drifts toward implied final state (bigger drift if BUY at $XL premium)
  const optPath = [];
  // Starting price ~ today's open of the contract (rough estimate from premium/size)
  const startPrice = evt.premium / (evt.vol * 100) * (0.6 + r() * 0.5);
  let p = startPrice;
  for (let i = 0; i < 78; i++) {
    // Small random walk
    const noise = (r() - 0.5) * 0.04 * p;
    p = Math.max(0.01, p + noise);
    // Killshot: at the killBar, big jump in evt.side direction
    if (i === Math.floor(killBar)) {
      const direction = evt.side === "BUY" ? 1 : evt.side === "SELL" ? -1 : 0.3;
      p = p * (1 + direction * (0.10 + r() * 0.15));
    }
    optPath.push(+p.toFixed(2));
  }

  // Generate individual prints
  const prints = [];
  const numPrints = 30 + Math.floor(r() * 25);
  let totalVolUsed = 0;
  for (let i = 0; i < numPrints; i++) {
    // Most prints scattered randomly; ~30% cluster near killBar
    const isCluster = r() < 0.30;
    const barIdx = isCluster
      ? Math.floor(Math.max(0, Math.min(77, killBar + (r() - 0.5) * 4)))
      : Math.floor(r() * 78);
    const hr = 9 + Math.floor((30 + barIdx * 5) / 60);
    const min = (30 + barIdx * 5) % 60;
    // Print size: most are small, killshot bin gets big ones
    const isKillPrint = i === 0; // first print = the killshot
    const size = isKillPrint
      ? Math.floor(evt.vol * 0.65) // killshot accounts for 65% of total vol
      : Math.floor(50 + r() * 800);
    totalVolUsed += size;
    // Side: bias by askBias
    const sideRoll = r();
    const hitSide = sideRoll < midShare ? "MID" : sideRoll < midShare + askBias * (1 - midShare) ? "ASK" : "BID";
    // Price for this print: snap to optPath[barIdx] with small noise
    const basePrice = optPath[barIdx] ?? optPath[Math.min(77, Math.max(0, barIdx))] ?? startPrice;
    const price = +(basePrice * (0.97 + r() * 0.06)).toFixed(2);
    prints.push({
      id: i,
      time: `${String(hr).padStart(2, "0")}:${String(min).padStart(2, "0")}`,
      barIdx,
      size,
      hitSide,    // "ASK" / "BID" / "MID"
      price,
      premium: size * price * 100,
    });
  }
  prints.sort((a, b) => a.barIdx - b.barIdx || a.id - b.id);

  // Bin into 5-min buckets for the chart
  const bins = Array.from({ length: 78 }, (_, i) => {
    const hr = 9 + Math.floor((30 + i * 5) / 60);
    const min = (30 + i * 5) % 60;
    const inBin = prints.filter(p => p.barIdx === i);
    return {
      idx: i,
      time: `${String(hr).padStart(2, "0")}:${String(min).padStart(2, "0")}`,
      ask: inBin.filter(p => p.hitSide === "ASK").reduce((s, p) => s + p.size, 0),
      bid: inBin.filter(p => p.hitSide === "BID").reduce((s, p) => s + p.size, 0),
      mid: inBin.filter(p => p.hitSide === "MID").reduce((s, p) => s + p.size, 0),
      optPrice: optPath[i],
    };
  });

  // Aggregates
  const totalAsk = prints.filter(p => p.hitSide === "ASK").reduce((s, p) => s + p.size, 0);
  const totalBid = prints.filter(p => p.hitSide === "BID").reduce((s, p) => s + p.size, 0);
  const totalMid = prints.filter(p => p.hitSide === "MID").reduce((s, p) => s + p.size, 0);
  const total = totalAsk + totalBid + totalMid || 1;

  return {
    prints,
    bins,
    optPath,
    askVol: totalAsk,
    bidVol: totalBid,
    midVol: totalMid,
    askPct: (totalAsk / total) * 100,
    bidPct: (totalBid / total) * 100,
    midPct: (totalMid / total) * 100,
  };
};

// Intraday premium tide (net premium throughout the session, 13 half-hour buckets from 9:30 to 16:00)
const FLOW_TIDE = (() => {
  const r = rng(555);
  const times = ["9:30","10:00","10:30","11:00","11:30","12:00","12:30","13:00","13:30","14:00","14:30","15:00","15:30","16:00"];
  let cumNet = 0;
  return times.map((t, i) => {
    const calls = Math.round(400000 + r() * 1800000);
    const puts = Math.round(200000 + r() * 1400000);
    const net = calls - puts;
    cumNet += net;
    return { time: t, calls, puts: -puts, net, cumNet };
  });
})();

// Per-ticker flow aggregates (call vs put premium, score)
const TICKER_FLOW = [
  { sym: "SPY",  calls: 8.4e6, puts: 3.2e6, contracts: 142, score: 82, px: 582.41, chg: +0.32 },
  { sym: "NVDA", calls: 6.2e6, puts: 1.8e6, contracts: 98,  score: 91, px: 135.89, chg: +3.47 },
  { sym: "TSLA", calls: 4.8e6, puts: 2.1e6, contracts: 76,  score: 79, px: 248.91, chg: +2.99 },
  { sym: "QQQ",  calls: 3.1e6, puts: 4.2e6, contracts: 88,  score: 68, px: 498.23, chg: -0.43 },
  { sym: "AAPL", calls: 2.8e6, puts: 1.4e6, contracts: 62,  score: 71, px: 228.34, chg: +1.38 },
  { sym: "META", calls: 1.9e6, puts: 2.6e6, contracts: 54,  score: 64, px: 612.30, chg: -0.92 },
  { sym: "AMZN", calls: 2.2e6, puts: 0.9e6, contracts: 41,  score: 74, px: 198.45, chg: +0.45 },
  { sym: "MSFT", calls: 1.6e6, puts: 2.1e6, contracts: 48,  score: 61, px: 441.67, chg: -0.28 },
];

// Intraday flow activity histogram (30-min buckets)
const FLOW_CLOCK = (() => {
  const r = rng(888);
  const times = ["9:30","10:00","10:30","11:00","11:30","12:00","12:30","13:00","13:30","14:00","14:30","15:00","15:30","16:00"];
  return times.map(t => ({
    time: t,
    count: Math.round(8 + r() * 35),
    prem: Math.round(300000 + r() * 2500000),
  }));
})();

// Sector flow breakdown (net call vs put premium)
const SECTOR_FLOW = [
  { sector: "Technology",  calls: 14.2e6, puts: 5.1e6 },
  { sector: "Comm Svcs",   calls: 4.8e6,  puts: 6.9e6 },
  { sector: "Cons Disc",   calls: 7.1e6,  puts: 3.0e6 },
  { sector: "Financials",  calls: 3.2e6,  puts: 2.4e6 },
  { sector: "Healthcare",  calls: 2.1e6,  puts: 3.8e6 },
  { sector: "Energy",      calls: 1.4e6,  puts: 2.9e6 },
  { sector: "Industrial",  calls: 1.8e6,  puts: 1.5e6 },
  { sector: "Staples",     calls: 0.9e6,  puts: 1.2e6 },
];

// DTE bucket distribution
const DTE_BUCKETS = [
  { bucket: "0DTE",   calls: 4.2e6, puts: 3.8e6, count: 34 },
  { bucket: "1-7d",   calls: 6.8e6, puts: 4.1e6, count: 58 },
  { bucket: "8-30d",  calls: 8.4e6, puts: 6.2e6, count: 76 },
  { bucket: "31-90d", calls: 3.1e6, puts: 2.8e6, count: 42 },
  { bucket: "90d+",   calls: 1.2e6, puts: 0.8e6, count: 18 },
];

// Tradable ticker info (price + IV + seeds for mock data)
const TRADE_TICKER_INFO = {
  SPY:  { name: "SPDR S&P 500",       price: 582.41, chg: +1.87, pct: +0.32, iv: 0.178, barSeed: 100, chainSeed: 200, optSeed: 300 },
  QQQ:  { name: "Invesco QQQ",        price: 498.23, chg: -2.14, pct: -0.43, iv: 0.192, barSeed: 101, chainSeed: 201, optSeed: 301 },
  NVDA: { name: "NVIDIA Corp",        price: 135.89, chg: +4.56, pct: +3.47, iv: 0.412, barSeed: 102, chainSeed: 202, optSeed: 302 },
  TSLA: { name: "Tesla Inc",          price: 248.91, chg: +7.23, pct: +2.99, iv: 0.488, barSeed: 103, chainSeed: 203, optSeed: 303 },
  AAPL: { name: "Apple Inc",          price: 228.34, chg: +3.12, pct: +1.38, iv: 0.221, barSeed: 104, chainSeed: 204, optSeed: 304 },
  META: { name: "Meta Platforms",     price: 612.30, chg: -5.67, pct: -0.92, iv: 0.285, barSeed: 105, chainSeed: 205, optSeed: 305 },
  AMZN: { name: "Amazon.com",         price: 198.45, chg: +0.89, pct: +0.45, iv: 0.248, barSeed: 106, chainSeed: 206, optSeed: 306 },
  MSFT: { name: "Microsoft Corp",     price: 441.67, chg: -1.23, pct: -0.28, iv: 0.204, barSeed: 107, chainSeed: 207, optSeed: 307 },
};

const ensureTradeTickerInfo = (symbol, fallbackName = symbol) => {
  const normalized = symbol.toUpperCase();
  if (!TRADE_TICKER_INFO[normalized]) {
    const hash = hashSymbol(normalized);
    const basePrice = 40 + (hash % 360);
    TRADE_TICKER_INFO[normalized] = {
      name: fallbackName,
      price: basePrice,
      chg: 0,
      pct: 0,
      iv: 0.18 + ((hash % 18) / 100),
      barSeed: 400 + (hash % 200),
      chainSeed: 700 + (hash % 200),
      optSeed: 1000 + (hash % 200),
      open: null,
      high: null,
      low: null,
      prevClose: null,
      volume: null,
      updatedAt: null,
    };
  } else if (fallbackName && (!TRADE_TICKER_INFO[normalized].name || TRADE_TICKER_INFO[normalized].name === normalized)) {
    TRADE_TICKER_INFO[normalized].name = fallbackName;
  }

  return TRADE_TICKER_INFO[normalized];
};

const buildFallbackWatchlistItem = (symbol, index, name) => {
  const existing = DEFAULT_WATCHLIST_BY_SYMBOL[symbol];
  if (existing) return { ...existing, name: existing.name || name || symbol, sparkBars: existing.sparkBars || [] };

  const hash = hashSymbol(symbol);
  const basePrice = 40 + (hash % 360);
  return {
    sym: symbol,
    name: name || symbol,
    price: basePrice,
    chg: 0,
    pct: 0,
    spark: genSparkline(2000 + hash + index, 48, basePrice, Math.max(0.5, basePrice * 0.01)),
    sparkBars: [],
  };
};

const buildSparklineFromHistoricalBars = (bars, fallback) => {
  if (!Array.isArray(bars) || bars.length < 2) {
    return fallback;
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

// Open positions across all trades
const OPEN_POSITIONS = [
  { ticker: "SPY",  side: "LONG",  contract: "585 C 04/25", qty: 5, entry: 3.45, mark: 3.82, pnl: +185, pct: +10.7, sl: 2.24, tp: 6.04 },
  { ticker: "NVDA", side: "LONG",  contract: "135 C 04/25", qty: 3, entry: 2.10, mark: 3.15, pnl: +315, pct: +50.0, sl: 1.37, tp: 3.68 },
  { ticker: "QQQ",  side: "SHORT", contract: "495 P 04/18", qty: 2, entry: 1.80, mark: 1.25, pnl: +110, pct: +30.6, sl: 2.43, tp: 0.45 },
];

// Closed positions / trade history (last 10)
const TRADE_HISTORY = [
  { ticker: "SPY",  side: "LONG",  contract: "580 C 04/22", qty: 3, entry: 4.20, exit: 5.85, pnl: +495, pct: +39.3, time: "14:32", closed: "Today" },
  { ticker: "META", side: "LONG",  contract: "615 C 04/22", qty: 2, entry: 5.40, exit: 4.10, pnl: -260, pct: -24.1, time: "13:18", closed: "Today" },
  { ticker: "QQQ",  side: "SHORT", contract: "500 C 04/22", qty: 4, entry: 2.80, exit: 1.45, pnl: +540, pct: +48.2, time: "11:47", closed: "Today" },
  { ticker: "NVDA", side: "LONG",  contract: "130 C 04/22", qty: 5, entry: 3.50, exit: 4.78, pnl: +640, pct: +36.6, time: "10:15", closed: "Today" },
  { ticker: "AAPL", side: "LONG",  contract: "225 P 04/22", qty: 3, entry: 2.20, exit: 1.95, pnl: -75,  pct: -11.4, time: "09:52", closed: "Today" },
  { ticker: "TSLA", side: "LONG",  contract: "245 C 04/19", qty: 2, entry: 4.10, exit: 6.20, pnl: +420, pct: +51.2, time: "15:28", closed: "Yest" },
  { ticker: "SPY",  side: "SHORT", contract: "583 P 04/19", qty: 4, entry: 1.55, exit: 0.78, pnl: +308, pct: +49.7, time: "13:05", closed: "Yest" },
];

// Strategy templates — delta target informs strike selection
const TRADE_STRATEGIES = [
  { id: "long_call_atm", name: "Call ATM",    desc: "Bullish, ~50Δ",     cp: "C", deltaTarget: 0.50, qty: 3,  dte: 7,  color: "#10b981" },
  { id: "long_put_atm",  name: "Put ATM",     desc: "Bearish, ~50Δ",     cp: "P", deltaTarget: 0.50, qty: 3,  dte: 7,  color: "#ef4444" },
  { id: "long_call_otm", name: "Call OTM",    desc: "Aggressive, 30Δ",   cp: "C", deltaTarget: 0.30, qty: 5,  dte: 7,  color: "#10b981" },
  { id: "0dte_lotto",    name: "0DTE Lotto",  desc: "High R/R · Δ20",    cp: "C", deltaTarget: 0.20, qty: 10, dte: 0,  color: "#f59e0b" },
  { id: "itm_call",      name: "ITM Call",    desc: "Conservative, 70Δ", cp: "C", deltaTarget: 0.70, qty: 2,  dte: 14, color: "#10b981" },
  { id: "long_put_otm",  name: "Put OTM",     desc: "Hedge, 25Δ",        cp: "P", deltaTarget: 0.25, qty: 5,  dte: 7,  color: "#ef4444" },
];

// L2 order book generator — bids + asks for current selection (mock)
const genL2Book = (mid, spread, seed) => {
  const r = rng(seed);
  const tickSize = 0.01;
  const halfSpread = spread / 2;
  const bestBid = +(mid - halfSpread).toFixed(2);
  const bestAsk = +(mid + halfSpread).toFixed(2);
  const bids = [], asks = [];
  for (let i = 0; i < 8; i++) {
    const bidPrice = +(bestBid - i * tickSize).toFixed(2);
    const askPrice = +(bestAsk + i * tickSize).toFixed(2);
    const baseBidSize = (5 + i * 8) * (0.5 + r());
    const baseAskSize = (5 + i * 8) * (0.5 + r());
    bids.push({ price: bidPrice, size: Math.round(baseBidSize), mm: 1 + Math.floor(r() * 4) });
    asks.push({ price: askPrice, size: Math.round(baseAskSize), mm: 1 + Math.floor(r() * 4) });
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
    const time = `${String(hh).padStart(2,"0")}:${String(mm).padStart(2,"0")}:${String(sec).padStart(2,"0")}`;
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
  { v: "04/17", dte: 0,   tag: "0DTE" },
  { v: "04/18", dte: 1,   tag: "1d" },
  { v: "04/25", dte: 8,   tag: "Wkly" },
  { v: "05/02", dte: 15,  tag: "2w" },
  { v: "05/16", dte: 29,  tag: "Mthly" },
  { v: "06/20", dte: 64,  tag: "Qtrly" },
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
  Object.entries(TRADE_TICKER_INFO).map(([sym, info]) => [sym, genTradeFlowMarkers(info.barSeed + 555)])
);

const syncRuntimeMarketData = (
  symbols,
  watchlistItems,
  quotes,
  {
    sparklineBarsBySymbol = {},
    performanceBaselineBySymbol = {},
  } = {},
) => {
  const quoteBySymbol = Object.fromEntries((quotes || []).map(quote => [quote.symbol.toUpperCase(), quote]));
  const getLatestDelayedAggregate = (symbol) => {
    const aggregates = getStoredStockMinuteAggregates(symbol);
    return aggregates[aggregates.length - 1] || null;
  };
  const getLatestBarValue = (symbol, field) => {
    const bars = sparklineBarsBySymbol[symbol] || [];
    const latest = bars[bars.length - 1];
    if (!latest) {
      return null;
    }

    return latest[field] ?? null;
  };
  const watchlistNameBySymbol = Object.fromEntries(
    (watchlistItems || []).map(item => {
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
    const latestAggregate = getLatestDelayedAggregate(normalized);
    const delayedStreamPrice = Number.isFinite(latestAggregate?.close) ? latestAggregate.close : null;
    const delayedStreamOpen = Number.isFinite(latestAggregate?.open) ? latestAggregate.open : null;
    const delayedStreamHigh = Number.isFinite(latestAggregate?.high) ? latestAggregate.high : null;
    const delayedStreamLow = Number.isFinite(latestAggregate?.low) ? latestAggregate.low : null;
    const delayedStreamVolume = Number.isFinite(latestAggregate?.volume) ? latestAggregate.volume : null;
    const delayedPrice = getLatestBarValue(normalized, "close");
    const delayedOpen = getLatestBarValue(normalized, "open");
    const delayedHigh = getLatestBarValue(normalized, "high");
    const delayedLow = getLatestBarValue(normalized, "low");
    const delayedVolume = getLatestBarValue(normalized, "volume");
    const spark = buildSparklineFromHistoricalBars(
      sparklineBarsBySymbol[normalized],
      base.spark,
    );
    const tradeInfo = ensureTradeTickerInfo(normalized, base.name);
    const prevClose = quote?.prevClose ?? tradeInfo.prevClose ?? null;
    const price = delayedStreamPrice ?? delayedPrice ?? quote?.price ?? base.price;
    const chg = Number.isFinite(price) && Number.isFinite(prevClose)
      ? price - prevClose
      : quote?.change ?? base.chg;
    const pct = Number.isFinite(price) && Number.isFinite(prevClose) && prevClose !== 0
      ? ((price - prevClose) / prevClose) * 100
      : quote?.changePercent ?? base.pct;
    const open = delayedStreamOpen ?? delayedOpen ?? quote?.open ?? tradeInfo.open ?? null;
    const high = delayedStreamHigh ?? delayedHigh ?? quote?.high ?? tradeInfo.high ?? null;
    const low = delayedStreamLow ?? delayedLow ?? quote?.low ?? tradeInfo.low ?? null;
    const volume = delayedStreamVolume ?? delayedVolume ?? quote?.volume ?? tradeInfo.volume ?? null;
    const updatedAt = quote?.updatedAt ?? tradeInfo.updatedAt ?? null;

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

    if (!TRADE_FLOW_MARKERS[normalized]) {
      TRADE_FLOW_MARKERS[normalized] = genTradeFlowMarkers(tradeInfo.barSeed + 555);
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
      INDICES.find(item => item.sym === symbol)?.name ||
      TRADE_TICKER_INFO[symbol]?.name ||
      symbol;
    const tradeInfo = ensureTradeTickerInfo(symbol, fallbackName);

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
  });

  INDICES.forEach((item) => {
    const quote = quoteBySymbol[item.sym.toUpperCase()];
    const latestAggregate = getLatestDelayedAggregate(item.sym.toUpperCase());
    const delayedPrice =
      (Number.isFinite(latestAggregate?.close) ? latestAggregate.close : null) ??
      getLatestBarValue(item.sym.toUpperCase(), "close");
    const prevClose = quote?.prevClose ?? item.prevClose ?? null;
    if (quote) {
      item.price = delayedPrice ?? quote.price;
      item.chg = Number.isFinite(item.price) && Number.isFinite(prevClose)
        ? item.price - prevClose
        : quote.change;
      item.pct = Number.isFinite(item.price) && Number.isFinite(prevClose) && prevClose !== 0
        ? ((item.price - prevClose) / prevClose) * 100
        : quote.changePercent;
    }
    item.spark = buildSparklineFromHistoricalBars(
      sparklineBarsBySymbol[item.sym.toUpperCase()],
      item.spark,
    );
    item.sparkBars = sparklineBarsBySymbol[item.sym.toUpperCase()] || [];
  });

  MACRO_TICKERS.forEach((item) => {
    const quote = quoteBySymbol[item.sym.toUpperCase()];
    const latestAggregate = getLatestDelayedAggregate(item.sym.toUpperCase());
    const delayedPrice =
      (Number.isFinite(latestAggregate?.close) ? latestAggregate.close : null) ??
      getLatestBarValue(item.sym.toUpperCase(), "close");
    const prevClose = quote?.prevClose ?? item.prevClose ?? null;
    if (!quote) return;

    item.price = delayedPrice ?? quote.price;
    item.chg = Number.isFinite(item.price) && Number.isFinite(prevClose)
      ? item.price - prevClose
      : quote.change;
    item.pct = Number.isFinite(item.price) && Number.isFinite(prevClose) && prevClose !== 0
      ? ((item.price - prevClose) / prevClose) * 100
      : quote.changePercent;
  });

  RATES_PROXIES.forEach((item) => {
    const normalized = item.sym.toUpperCase();
    const quote = quoteBySymbol[normalized];
    const currentPrice = quote?.price ?? item.price;
    const baseline = performanceBaselineBySymbol[normalized] ?? null;
    const d5 = computeTrailingReturnPercent(currentPrice, baseline);
    if (!quote && d5 == null) return;

    if (quote) {
      item.price = quote.price;
      item.chg = quote.change;
      item.pct = quote.changePercent;
    }
    if (d5 != null) {
      item.d5 = d5;
    }
  });

  SECTORS.forEach((item) => {
    const normalized = item.sym.toUpperCase();
    const quote = quoteBySymbol[normalized];
    const currentPrice = quote?.price ?? TRADE_TICKER_INFO[normalized]?.price ?? null;
    const baseline = performanceBaselineBySymbol[normalized] ?? null;
    const d5 = computeTrailingReturnPercent(currentPrice, baseline);

    if (quote) {
      item.chg = quote.changePercent;
    }
    if (d5 != null) {
      item.d5 = d5;
    }
  });

  TREEMAP_DATA.forEach((sector) => {
    sector.stocks.forEach((stock) => {
      const normalized = stock.sym.toUpperCase();
      const quote = quoteBySymbol[normalized];
      const currentPrice = quote?.price ?? TRADE_TICKER_INFO[normalized]?.price ?? null;
      const baseline = performanceBaselineBySymbol[normalized] ?? null;
      const d5 = computeTrailingReturnPercent(currentPrice, baseline);

      if (quote) {
        stock.d1 = quote.changePercent;
      }
      if (d5 != null) {
        stock.d5 = d5;
      }
    });
  });

  TICKER_FLOW.forEach((item) => {
    const info = TRADE_TICKER_INFO[item.sym];
    if (!info) return;

    item.px = info.price;
    item.chg = info.pct;
  });
};

const getRuntimeQuoteDetail = (symbol) => {
  const info = TRADE_TICKER_INFO[symbol] || ensureTradeTickerInfo(symbol, symbol);
  const prevClose = info.prevClose ?? (
    typeof info.price === "number" && typeof info.chg === "number"
      ? info.price - info.chg
      : null
  );

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
  const stocks = TREEMAP_DATA.flatMap(sector => sector.stocks);
  const total = stocks.length || 1;
  const advancers = stocks.filter(stock => stock.d1 > 0).length;
  const decliners = stocks.filter(stock => stock.d1 < 0).length;
  const unchanged = total - advancers - decliners;
  const positive5d = stocks.filter(stock => stock.d5 > 0).length;
  const positiveSectors = SECTORS.filter(sector => sector.chg > 0).length;
  const sortedSectors = [...SECTORS].sort((left, right) => right.chg - left.chg);
  const leader = sortedSectors[0] || null;
  const laggard = sortedSectors[sortedSectors.length - 1] || null;

  return {
    total,
    advancers,
    decliners,
    unchanged,
    advancePct: (advancers / total) * 100,
    positive5dPct: (positive5d / total) * 100,
    positiveSectors,
    leader,
    laggard,
  };
};

const buildRatesProxySummary = () => {
  const sorted = [...RATES_PROXIES].sort((left, right) => right.pct - left.pct);
  return {
    leader: sorted[0] || null,
    laggard: sorted[sorted.length - 1] || null,
  };
};

const buildOptionChainRowsFromApi = (contracts, spotPrice, fallbackIv) => {
  const rowsByStrike = new Map();

  (contracts || []).forEach((quote) => {
    const strike = quote?.contract?.strike;
    const right = quote?.contract?.right;
    if (typeof strike !== "number" || !right) return;

    const defaultCallGreeks = deriveApproxGreeksFromDelta(0.5);
    const defaultPutGreeks = deriveApproxGreeksFromDelta(-0.5);
    const row = rowsByStrike.get(strike) || {
      k: strike,
      cContract: null,
      cPrem: 0,
      cBid: 0,
      cAsk: 0,
      cVol: 0,
      cOi: 0,
      cIv: fallbackIv,
      cDelta: 0.5,
      cGamma: defaultCallGreeks.gamma,
      cTheta: defaultCallGreeks.theta,
      cVega: defaultCallGreeks.vega,
      pContract: null,
      pPrem: 0,
      pBid: 0,
      pAsk: 0,
      pVol: 0,
      pOi: 0,
      pIv: fallbackIv,
      pDelta: -0.5,
      pGamma: defaultPutGreeks.gamma,
      pTheta: defaultPutGreeks.theta,
      pVega: defaultPutGreeks.vega,
      isAtm: false,
    };
    const mark = quote.mark > 0 ? quote.mark : ((quote.bid > 0 && quote.ask > 0) ? (quote.bid + quote.ask) / 2 : quote.last);

    if (right === "call") {
      row.cContract = quote.contract || null;
      row.cPrem = +(mark || 0).toFixed(2);
      row.cBid = +(quote.bid || 0).toFixed(2);
      row.cAsk = +(quote.ask || 0).toFixed(2);
      row.cVol = quote.volume || 0;
      row.cOi = quote.openInterest || 0;
      row.cIv = quote.impliedVolatility ?? fallbackIv;
      row.cDelta = quote.delta ?? row.cDelta;
      {
        const fallbackGreeks = deriveApproxGreeksFromDelta(row.cDelta);
        row.cGamma = quote.gamma ?? fallbackGreeks.gamma;
        row.cTheta = quote.theta ?? fallbackGreeks.theta;
        row.cVega = quote.vega ?? fallbackGreeks.vega;
      }
    } else {
      row.pContract = quote.contract || null;
      row.pPrem = +(mark || 0).toFixed(2);
      row.pBid = +(quote.bid || 0).toFixed(2);
      row.pAsk = +(quote.ask || 0).toFixed(2);
      row.pVol = quote.volume || 0;
      row.pOi = quote.openInterest || 0;
      row.pIv = quote.impliedVolatility ?? fallbackIv;
      row.pDelta = quote.delta ?? row.pDelta;
      {
        const fallbackGreeks = deriveApproxGreeksFromDelta(row.pDelta);
        row.pGamma = quote.gamma ?? fallbackGreeks.gamma;
        row.pTheta = quote.theta ?? fallbackGreeks.theta;
        row.pVega = quote.vega ?? fallbackGreeks.vega;
      }
    }

    rowsByStrike.set(strike, row);
  });

  const rows = Array.from(rowsByStrike.values()).sort((left, right) => left.k - right.k);
  if (!rows.length) return [];

  const atmStrike = rows.reduce((closest, row) => (
    Math.abs(row.k - spotPrice) < Math.abs(closest - spotPrice) ? row.k : closest
  ), rows[0].k);

  return rows.map((row) => ({ ...row, isAtm: row.k === atmStrike }));
};

const buildMarketOrderFlowFromEvents = (events) => {
  const totals = {
    buyXL: 0, buyL: 0, buyM: 0, buyS: 0,
    sellXL: 0, sellL: 0, sellM: 0, sellS: 0,
  };

  (events || []).forEach((evt) => {
    const bucket = evt.premium >= 500000 ? "XL"
      : evt.premium >= 250000 ? "L"
      : evt.premium >= 100000 ? "M"
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
    const clamped = Math.max(startMinutes, Math.min(startMinutes + bucketMinutes * (bucketCount - 1), minutes));
    const bucketIndex = Math.min(bucketCount - 1, Math.floor((clamped - startMinutes) / bucketMinutes));
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
      const info = TRADE_TICKER_INFO[entry.sym] || TRADE_TICKER_INFO.SPY;
      return {
        sym: entry.sym,
        calls: entry.calls,
        puts: entry.puts,
        contracts: entry.contracts,
        score: entry.contracts ? Math.round(entry.scoreTotal / entry.contracts) : 0,
        px: info.price,
        chg: info.pct,
      };
    })
    .sort((left, right) => (right.calls + right.puts) - (left.calls + left.puts));
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
    const clamped = Math.max(startMinutes, Math.min(startMinutes + bucketMinutes * (bucketCount - 1), minutes));
    const bucketIndex = Math.min(bucketCount - 1, Math.floor((clamped - startMinutes) / bucketMinutes));
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
    (left, right) => Math.abs((right.calls - right.puts)) - Math.abs((left.calls - left.puts)),
  );
};

const buildDteBucketsFromEvents = (events) => {
  const buckets = [
    { bucket: "0DTE", calls: 0, puts: 0, count: 0, match: (dte) => dte <= 0 },
    { bucket: "1-7d", calls: 0, puts: 0, count: 0, match: (dte) => dte >= 1 && dte <= 7 },
    { bucket: "8-30d", calls: 0, puts: 0, count: 0, match: (dte) => dte >= 8 && dte <= 30 },
    { bucket: "31-90d", calls: 0, puts: 0, count: 0, match: (dte) => dte >= 31 && dte <= 90 },
    { bucket: "90d+", calls: 0, puts: 0, count: 0, match: (dte) => dte > 90 },
  ];

  (events || []).forEach((evt) => {
    const bucket = buckets.find((entry) => entry.match(evt.dte)) || buckets[buckets.length - 1];
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
    const bucket = FLOW_INDEX_SYMBOLS.has(evt.ticker) ? totals.indices : totals.equities;
    if (evt.cp === "C") bucket.calls += evt.premium;
    else bucket.puts += evt.premium;
  });

  const toRatio = ({ calls, puts }) => (calls > 0 ? puts / calls : 0);
  const equities = toRatio(totals.equities);
  const indices = toRatio(totals.indices);
  const calls = totals.equities.calls + totals.indices.calls;
  const puts = totals.equities.puts + totals.indices.puts;
  const total = calls > 0 ? puts / calls : 0;

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
    { label: "0DTE", match: (dte) => dte <= 0, callPrem: 0, putPrem: 0, total: 0 },
    { label: "1-7d", match: (dte) => dte >= 1 && dte <= 7, callPrem: 0, putPrem: 0, total: 0 },
    { label: "8-30d", match: (dte) => dte >= 8 && dte <= 30, callPrem: 0, putPrem: 0, total: 0 },
    { label: "30d+", match: (dte) => dte > 30, callPrem: 0, putPrem: 0, total: 0 },
  ];

  (events || []).forEach((evt) => {
    const bucket = buckets.find((entry) => entry.match(evt.dte)) || buckets[buckets.length - 1];
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

  const rows = Array.from(grouped.values()).sort((left, right) => left.strike - right.strike);
  if (!rows.length) return [];

  const sortedByDistance = rows
    .slice()
    .sort((left, right) => Math.abs(left.strike - spotPrice) - Math.abs(right.strike - spotPrice))
    .slice(0, 15);
  const visible = sortedByDistance.sort((left, right) => left.strike - right.strike);
  const atmStrike = visible.reduce((closest, row) => (
    Math.abs(row.strike - spotPrice) < Math.abs(closest - spotPrice) ? row.strike : closest
  ), visible[0].strike);

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
    const clamped = Math.max(startMinutes, Math.min(startMinutes + bucketMinutes * (bucketCount - 1), minutes));
    const bucketIndex = Math.min(bucketCount - 1, Math.floor((clamped - startMinutes) / bucketMinutes));
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
      const normalizedMinutes = minutes == null ? (9 * 60 + 30) : Math.max(9 * 60 + 30, Math.min(16 * 60, minutes));
      const ratio = (normalizedMinutes - (9 * 60 + 30)) / ((16 * 60) - (9 * 60 + 30));
      return {
        barIdx: Math.max(0, Math.min(barsLength - 1, Math.round(ratio * (barsLength - 1)))),
        cp: evt.cp,
        size: evt.premium >= 500000 ? "lg" : evt.premium >= 150000 ? "md" : "sm",
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

const buildChartBarsFromApi = (bars) => (
  (bars || []).reduce((result, bar, index) => {
    const timeMs = resolveApiBarTimestampMs(bar?.timestamp ?? bar?.ts ?? bar?.time);
    if (timeMs == null) {
      return result;
    }

    result.push({
      time: timeMs,
      timestamp: timeMs,
      ts: typeof bar?.timestamp === "string"
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
      accumulatedVolume: Number.isFinite(bar?.accumulatedVolume) ? bar.accumulatedVolume : null,
      averageTradeSize: Number.isFinite(bar?.averageTradeSize) ? bar.averageTradeSize : null,
      source: typeof bar?.source === "string" ? bar.source : null,
      i: index,
      uoa: 0,
    });
    return result;
  }, [])
);

const buildMiniChartBarsFromApi = (bars) => buildChartBarsFromApi(bars);

const buildTradeBarsFromApi = (bars) => buildChartBarsFromApi(bars);

// Options chain generator — strike ladder with greeks approximation
const genOptionsChain = (basePrice, baseIv, seed) => {
  const r = rng(seed);
  const atm = Math.round(basePrice / 5) * 5;
  const strikes = [];
  for (let i = -7; i <= 7; i++) {
    const k = atm + i * 5;
    const moneyness = (basePrice - k) / basePrice;
    const extrinsic = Math.max(0.35, 3.5 * Math.exp(-Math.abs(moneyness) * 12)) + r() * 0.4;
    const callIntrinsic = Math.max(0, basePrice - k);
    const putIntrinsic = Math.max(0, k - basePrice);
    const callDelta = moneyness > 0.04 ? Math.min(0.99, 0.72 + moneyness * 2)
      : moneyness > 0 ? 0.52 + moneyness * 5
      : moneyness > -0.04 ? 0.48 + moneyness * 5
      : Math.max(0.02, 0.28 + moneyness * 3);
    const putDelta = -(1 - callDelta);
    const callGreeks = deriveApproxGreeksFromDelta(callDelta);
    const putGreeks = deriveApproxGreeksFromDelta(putDelta);
    const cPrem = callIntrinsic + extrinsic;
    const pPrem = putIntrinsic + extrinsic * 1.05;
    // Bid/Ask spread — tight ATM, wider OTM
    const cSpread = Math.max(0.02, Math.min(0.25, 0.03 + Math.abs(moneyness) * 0.35)) * (0.9 + r() * 0.2);
    const pSpread = Math.max(0.02, Math.min(0.25, 0.03 + Math.abs(moneyness) * 0.35)) * (0.9 + r() * 0.2);
    strikes.push({
      k,
      cPrem: +cPrem.toFixed(2),
      cBid: +(cPrem - cSpread / 2).toFixed(2),
      cAsk: +(cPrem + cSpread / 2).toFixed(2),
      cVol: Math.round(r() * 2500),
      cOi: Math.round(500 + r() * 12000),
      cIv: +(baseIv + Math.abs(moneyness) * 0.12 + r() * 0.02).toFixed(3),
      cDelta: +callDelta.toFixed(2),
      cGamma: callGreeks.gamma,
      cTheta: callGreeks.theta,
      cVega: callGreeks.vega,
      pPrem: +pPrem.toFixed(2),
      pBid: +(pPrem - pSpread / 2).toFixed(2),
      pAsk: +(pPrem + pSpread / 2).toFixed(2),
      pVol: Math.round(r() * 2500),
      pOi: Math.round(500 + r() * 12000),
      pIv: +(baseIv + Math.abs(moneyness) * 0.15 + r() * 0.02).toFixed(3),
      pDelta: +putDelta.toFixed(2),
      pGamma: putGreeks.gamma,
      pTheta: putGreeks.theta,
      pVega: putGreeks.vega,
      isAtm: Math.abs(k - basePrice) < 2.5,
    });
  }
  return strikes;
};

// Option price intraday bars
const genOptionPriceBars = (basePremium, seed) => {
  const r = rng(seed);
  let p = basePremium;
  const stepMs = 5 * 60 * 1000;
  const startTime = Date.now() - (78 * stepMs);
  return Array.from({ length: 78 }, (_, i) => {
    const o = p;
    const chg = (r() - 0.48) * Math.max(o, 0.05) * 0.025;
    const c = Math.max(0.05, o + chg);
    const wiggle = Math.max(o, c) * (0.008 + r() * 0.01);
    const h = Math.max(o, c) + wiggle;
    const l = Math.max(0.01, Math.min(o, c) - wiggle);
    const v = Math.round(40 + r() * 900);
    p = c;
    return {
      time: startTime + i * stepMs,
      o: +o.toFixed(2),
      h: +h.toFixed(2),
      l: +l.toFixed(2),
      c: +c.toFixed(2),
      v,
      p: +c.toFixed(2),
    };
  });
};

// Equity bars scaled by price — used in Trade tab where multiple tickers at different price levels
const genTradeBars = (seed, basePrice) => {
  const r = rng(seed);
  let p = basePrice;
  const trend = (r() - 0.5) * 0.0003;
  const n = 78;
  return Array.from({ length: n }, (_, i) => {
    const o = p;
    const chg = (r() - 0.5) * basePrice * 0.0025 + trend * basePrice;
    const c = o + chg;
    const hi = Math.max(o, c) + r() * basePrice * 0.0015;
    const lo = Math.min(o, c) - r() * basePrice * 0.0015;
    const openClose = i < 6 || i > n - 8 ? 1.8 : 0.6 + r() * 0.8;
    const v = Math.round((400000 + r() * 800000) * openClose);
    // UOA overlay: ~15% of bars have UOA. Intensity 0.2-0.9 of volume.
    const hasUoa = r() < 0.15;
    const uoa = hasUoa ? +(0.2 + r() * 0.7).toFixed(2) : 0;
    p = c;
    return { t: i, o: +o.toFixed(2), h: +hi.toFixed(2), l: +lo.toFixed(2), c: +c.toFixed(2), v, uoa };
  });
};

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
  <button onClick={onClick} style={{
    padding: sp("3px 7px"), fontSize: fs(11), fontFamily: T.sans, fontWeight: 600,
    border: `1px solid ${active ? (color || T.accent) : T.border}`,
    borderRadius: dim(4), cursor: "pointer", transition: "all 0.15s",
    background: active ? `${color || T.accent}18` : "transparent",
    color: active ? (color || T.accent) : T.textDim,
  }}>{children}</button>
);

// Format dollar amount in millions (or thousands if smaller). Module-level so any screen can use it.
const fmtM = (v) => v >= 1e6 ? `$${(v/1e6).toFixed(1)}M` : `$${(v/1e3).toFixed(0)}K`;
const fmtCompactCurrency = (value) => {
  if (value == null || Number.isNaN(value)) return "—";
  if (Math.abs(value) >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  if (Math.abs(value) >= 1e3) return `$${(value / 1e3).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
};
const fmtCompactNumber = (value) => {
  if (value == null || Number.isNaN(value)) return "—";
  if (Math.abs(value) >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (Math.abs(value) >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (Math.abs(value) >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return value.toFixed(0);
};
const fmtQuoteVolume = (value) => (value == null || Number.isNaN(value) ? "—" : fmtCompactNumber(value));

const QUERY_DEFAULTS = {
  staleTime: 15_000,
  refetchInterval: 15_000,
  retry: 2,
  retryDelay: (attempt) => Math.min(1_000 * (attempt + 1), 5_000),
  refetchOnMount: true,
};

const toDateValue = (value) => {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
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
  const hour = Number(parts.find(part => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find(part => part.type === "minute")?.value ?? "0");

  return { hour, minute };
};

const formatEtTime = (value, { seconds = false } = {}) => {
  const date = toDateValue(value);
  if (!date) return "—";

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
  if (!date) return value || "—";

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
  const year = parts.find(part => part.type === "year")?.value;
  const month = parts.find(part => part.type === "month")?.value;
  const day = parts.find(part => part.type === "day")?.value;

  return year && month && day ? `${year}-${month}-${day}` : null;
};

const formatShortDate = (value) => {
  const date = toDateValue(value);
  if (!date) return "—";

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "America/New_York",
  });
};

const formatRelativeTimeShort = (value) => {
  const date = toDateValue(value);
  if (!date) return "—";

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

const formatCalendarMeta = (dateValue, timeValue) => {
  const dateLabel = formatShortDate(dateValue);
  if (!timeValue) return dateLabel;

  const normalized = String(timeValue).trim().toUpperCase();
  if (!normalized) return dateLabel;

  return `${dateLabel} · ${normalized}`;
};

const mapNewsSentimentToScore = (sentiment) => {
  const normalized = String(sentiment || "").trim().toLowerCase();
  if (!normalized) return 0;
  if (normalized.includes("bull") || normalized.includes("positive")) return 1;
  if (normalized.includes("bear") || normalized.includes("negative")) return -1;
  return 0;
};

const deriveApproxGreeksFromDelta = (deltaValue) => {
  const absDelta = Math.abs(deltaValue ?? 0.5);
  const gamma = Math.max(0.005, 0.08 - Math.abs(absDelta - 0.5) * 0.12);
  const theta = Math.max(0.01, 0.06 + Math.abs(absDelta - 0.5) * 0.05);
  const vega = Math.max(0.02, 0.15 - Math.abs(absDelta - 0.5) * 0.08);

  return {
    gamma: +gamma.toFixed(3),
    theta: -+theta.toFixed(3),
    vega: +vega.toFixed(3),
  };
};

const daysToExpiration = (value) => {
  const date = parseExpirationValue(value);
  if (!date) return 0;

  const now = new Date();
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const end = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());

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

const deriveFlowType = (event) => {
  const conditions = (event.tradeConditions || []).map(condition => String(condition).toLowerCase());

  if (event.premium >= 500000 || conditions.some(condition => condition.includes("block"))) {
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
    side,
    contract: `${event.underlying} ${event.strike}${cp} ${formatExpirationLabel(event.expirationDate)}`,
    strike: event.strike,
    cp,
    premium: event.premium,
    vol: event.size,
    oi: event.openInterest ?? 0,
    iv: event.impliedVolatility ?? 0,
    dte,
    type: deriveFlowType(event),
    golden: side === "BUY" && event.premium >= 150000 && event.sentiment === "bullish",
    score: deriveFlowScore(event, dte),
    optionTicker: event.optionTicker,
    expirationDate: event.expirationDate,
    occurredAt: event.occurredAt,
    sentiment: event.sentiment,
    tradeConditions: event.tradeConditions || [],
  };
};

const useLiveMarketFlow = (symbols = [], { limit = 16 } = {}) => {
  const liveSymbols = useMemo(
    () => [...new Set((symbols || []).map(symbol => symbol?.toUpperCase()).filter(Boolean))].slice(0, 8),
    [symbols],
  );
  const flowQuery = useQuery({
    queryKey: ["market-flow", liveSymbols, limit],
    enabled: liveSymbols.length > 0,
    queryFn: async () => {
      const results = await Promise.allSettled(
        liveSymbols.map((symbol) => listFlowEventsRequest({ underlying: symbol, limit })),
      );

      return results.flatMap((result) => (
        result.status === "fulfilled" ? (result.value.events || []) : []
      ));
    },
    staleTime: 10_000,
    refetchInterval: 10_000,
    retry: false,
  });

  const hasLiveFlow = (flowQuery.data?.length || 0) > 0;
  const flowEvents = useMemo(() => {
    if (!hasLiveFlow) return [];
    return (flowQuery.data || [])
      .map(mapFlowEventToUi)
      .sort((left, right) => right.premium - left.premium);
  }, [hasLiveFlow, flowQuery.data]);
  const flowStatus = hasLiveFlow
    ? "live"
    : flowQuery.isPending
      ? "loading"
      : flowQuery.isError
        ? "offline"
        : "empty";

  return {
    hasLiveFlow,
    flowStatus,
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
  <span style={{
    display: "inline-block", padding: sp("1px 6px"), borderRadius: dim(3),
    fontSize: fs(9), fontWeight: 700, fontFamily: T.mono, letterSpacing: "0.04em",
    background: `${color}18`, color, border: `1px solid ${color}30`,
  }}>{children}</span>
);

const DataUnavailableState = ({ title = "No live data", detail = "This panel is waiting on a live provider response." }) => (
  <div style={{
    width: "100%", height: "100%", minHeight: dim(96),
    display: "flex", alignItems: "center", justifyContent: "center",
    padding: sp(12), textAlign: "center",
    background: T.bg0, border: `1px dashed ${T.border}`, borderRadius: dim(4),
    color: T.textDim, fontFamily: T.sans,
  }}>
    <div style={{ maxWidth: dim(260) }}>
      <div style={{ fontSize: fs(10), fontWeight: 700, color: T.textSec, letterSpacing: "0.04em" }}>{title}</div>
      <div style={{ marginTop: sp(4), fontSize: fs(9), lineHeight: 1.45, fontFamily: T.mono }}>{detail}</div>
    </div>
  </div>
);

const Watchlist = ({ items, selected, onSelect }) => {
  const [search, setSearch] = useState("");
  const filtered = items.filter(w =>
    w.sym.toLowerCase().includes(search.toLowerCase()) ||
    w.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: T.bg1, borderRight: `1px solid ${T.border}` }}>
      {/* Search */}
      <div style={{ padding: sp("8px 10px"), borderBottom: `1px solid ${T.border}` }}>
        <div style={{
          display: "flex", alignItems: "center", gap: sp(6),
          padding: sp("5px 8px"), borderRadius: dim(5),
          background: T.bg2, border: `1px solid ${T.border}`,
        }}>
          <span style={{ fontSize: fs(12), color: T.textDim }}>⌕</span>
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search..."
            style={{
              flex: 1, background: "transparent", border: "none", outline: "none",
              fontSize: fs(11), fontFamily: T.sans, color: T.text,
            }}
          />
        </div>
      </div>

      {/* Header */}
      <div style={{
        display: "grid", gridTemplateColumns: "1fr 58px 42px",
        padding: sp("4px 10px"), fontSize: fs(9), fontWeight: 600,
        color: T.textMuted, letterSpacing: "0.08em", borderBottom: `1px solid ${T.border}`,
      }}>
        <span>SYMBOL</span>
        <span style={{ textAlign: "right" }}>LAST</span>
        <span style={{ textAlign: "right" }}>CHG%</span>
      </div>

      {/* Rows */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {filtered.map(w => {
          const sel = selected === w.sym;
          const pos = w.chg >= 0;
          return (
            <div
              key={w.sym}
              onClick={() => onSelect(w.sym)}
              style={{
                display: "grid", gridTemplateColumns: "1fr 58px 42px",
                padding: sp("7px 10px"), cursor: "pointer", alignItems: "center",
                background: sel ? T.bg3 : "transparent",
                borderLeft: sel ? `2px solid ${T.accent}` : "2px solid transparent",
                transition: "background 0.1s",
              }}
              onMouseEnter={e => { if (!sel) e.currentTarget.style.background = T.bg2; }}
              onMouseLeave={e => { if (!sel) e.currentTarget.style.background = "transparent"; }}
            >
              <div>
                <div style={{ fontSize: fs(12), fontWeight: 600, fontFamily: T.mono, color: T.text }}>{w.sym}</div>
                <div style={{ fontSize: fs(9), color: T.textDim, fontFamily: T.sans, marginTop: sp(1), overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 100 }}>{w.name}</div>
              </div>
              <div style={{ textAlign: "right", fontSize: fs(11), fontFamily: T.mono, fontWeight: 500, color: T.text }}>
                {w.price < 10 ? w.price.toFixed(3) : w.price.toFixed(2)}
              </div>
              <div style={{
                textAlign: "right", fontSize: fs(10), fontFamily: T.mono, fontWeight: 600,
                color: pos ? T.green : T.red,
              }}>
                {pos ? "+" : ""}{w.pct.toFixed(2)}%
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div style={{
        padding: sp("6px 10px"), borderTop: `1px solid ${T.border}`,
        fontSize: fs(9), color: T.textMuted, fontFamily: T.mono,
        display: "flex", justifyContent: "space-between",
      }}>
        <span>{filtered.length} symbols</span>
        <span style={{ cursor: "pointer", color: T.accent }}>+ Add</span>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════
// CONTEXT PANEL (Right Column) — adapts per screen
// ═══════════════════════════════════════════════════════════════════

const QuoteStat = ({ label, value }) => (
  <div style={{ display: "flex", justifyContent: "space-between", padding: sp("3px 0"), borderBottom: `1px solid ${T.border}08` }}>
    <span style={{ fontSize: fs(10), color: T.textDim, fontFamily: T.sans }}>{label}</span>
    <span style={{ fontSize: fs(10), color: T.text, fontFamily: T.mono, fontWeight: 500 }}>{value}</span>
  </div>
);

const ContextPanel = ({ screen, sym, watchlist }) => {
  const toast = useToast();
  const positions = usePositions();
  const w = watchlist.find(x => x.sym === sym) || watchlist[0];
  const pos = w.chg >= 0;
  const quoteDetail = getRuntimeQuoteDetail(w.sym);
  const marketFlow = useLiveMarketFlow(screen === "market" ? watchlist.map(item => item.sym) : []);
  const [orderSide, setOrderSide] = useState("buy");
  const [orderType, setOrderType] = useState("limit");
  const [qty, setQty] = useState(100);
  const [limitPrice, setLimitPrice] = useState(w.price.toFixed(2));
  const [alertFilter, setAlertFilter] = useState("all");
  // Alerts become local state so "Mark read" + dismiss can mutate them
  const [alerts, setAlerts] = useState(() => ALERTS.map(a => ({ ...a })));

  // Reset limit price whenever the selected ticker changes
  useEffect(() => { setLimitPrice(w.price.toFixed(2)); }, [w.sym, w.price]);

  const filteredAlerts = alerts.filter(a => alertFilter === "all" || a.type === alertFilter);
  const unreadCount = alerts.filter(a => !a.read).length;
  const markAllRead = () => setAlerts(prev => prev.map(a => ({ ...a, read: true })));
  const quoteStats = [
    ["Open", quoteDetail.open != null ? quoteDetail.open.toFixed(w.price < 10 ? 3 : 2) : "—"],
    ["Prev Close", quoteDetail.prevClose != null ? quoteDetail.prevClose.toFixed(w.price < 10 ? 3 : 2) : "—"],
    ["High", quoteDetail.high != null ? quoteDetail.high.toFixed(w.price < 10 ? 3 : 2) : "—"],
    ["Low", quoteDetail.low != null ? quoteDetail.low.toFixed(w.price < 10 ? 3 : 2) : "—"],
    ["Volume", fmtQuoteVolume(quoteDetail.volume)],
    ["Impl. Vol", `${(quoteDetail.iv * 100).toFixed(1)}%`],
    ["Updated", quoteDetail.updatedAt ? formatEtTime(quoteDetail.updatedAt, { seconds: true }) : "—"],
  ];

  // ── MARKET SCREEN: Should I Trade strip + Alert Center as primary content ──
  if (screen === "market") return (
    <div style={{
      display: "flex", flexDirection: "column", height: "100%",
      background: T.bg1, borderLeft: `1px solid ${T.border}`, width: dim(280), flexShrink: 0,
    }}>
      {/* Should I Trade compressed strip */}
      <ShouldITradeStrip sym={sym} />
      {/* Header */}
      <div style={{ padding: sp("8px 12px"), borderBottom: `1px solid ${T.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ fontSize: fs(11), fontWeight: 700, fontFamily: T.display, color: T.text }}>Alert Center</span>
          {unreadCount > 0 && <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: dim(16), height: dim(16), borderRadius: "50%", fontSize: fs(8), fontWeight: 800, background: SEV_COLORS.critical, color: "#fff", fontFamily: T.mono }}>{unreadCount}</span>}
        </div>
        <span
          onClick={markAllRead}
          style={{ fontSize: fs(10), color: unreadCount ? T.accent : T.textDim, cursor: unreadCount ? "pointer" : "default" }}
        >Mark read</span>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: sp(2), padding: sp("5px 10px"), borderBottom: `1px solid ${T.border}06`, flexWrap: "wrap" }}>
        {[["all","All"],["flow","Flow"],["trade","Trades"],["signal","Signals"],["risk","Risk"],["event","Events"],["price","Price"]].map(([k,l]) => (
          <button key={k} onClick={() => setAlertFilter(k)} style={{
            padding: sp("3px 8px"), fontSize: fs(9), fontWeight: 600, fontFamily: T.sans,
            border: `1px solid ${alertFilter === k ? T.accent : "transparent"}`, borderRadius: dim(3), cursor: "pointer",
            background: alertFilter === k ? T.accentDim : "transparent", color: alertFilter === k ? T.accent : T.textDim,
          }}>{l}</button>
        ))}
      </div>

      {/* Alert list */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {filteredAlerts.map(a => {
          const sevColor = SEV_COLORS[a.sev] || T.textDim;
          return (
            <div key={a.id} style={{
              padding: sp("6px 10px"), borderBottom: `1px solid ${T.border}06`,
              background: !a.read ? `${sevColor}06` : "transparent",
              borderLeft: `2px solid ${!a.read ? sevColor : "transparent"}`,
              cursor: "pointer", transition: "background 0.1s",
            }}
            onMouseEnter={e => e.currentTarget.style.background = T.bg3}
            onMouseLeave={e => e.currentTarget.style.background = !a.read ? `${sevColor}06` : "transparent"}>
              <div style={{ display: "flex", alignItems: "center", gap: sp(4), marginBottom: 2 }}>
                <span style={{ fontSize: fs(10), color: sevColor }}>{ALERT_ICONS[a.type]}</span>
                <span style={{ fontSize: fs(11), fontWeight: 600, fontFamily: T.sans, color: T.text, flex: 1 }}>{a.title}</span>
                <span style={{ fontSize: fs(7), fontFamily: T.mono, color: T.textMuted }}>{a.time}</span>
              </div>
              <div style={{ fontSize: fs(10), fontFamily: T.sans, color: T.textSec, lineHeight: 1.35, paddingLeft: 14 }}>{a.body}</div>
            </div>
          );
        })}
      </div>

      {/* Options flow summary pinned at bottom */}
      <div style={{ padding: sp("6px 10px"), borderTop: `1px solid ${T.border}`, background: T.bg0 }}>
        <div style={{ fontSize: fs(7), fontWeight: 700, color: T.textMuted, letterSpacing: "0.1em", marginBottom: 3 }}>NET PREMIUM FLOW</div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: fs(9), fontFamily: T.mono }}>
          <span style={{ color: T.green }}>Calls {fmtM(marketFlow.putCall.calls)}</span>
          <span style={{ color: T.red }}>Puts {fmtM(marketFlow.putCall.puts)}</span>
          <span style={{ color: marketFlow.putCall.calls >= marketFlow.putCall.puts ? T.green : T.red, fontWeight: 700 }}>
            {marketFlow.putCall.calls >= marketFlow.putCall.puts ? "+" : "-"}{fmtM(Math.abs(marketFlow.putCall.calls - marketFlow.putCall.puts))}
          </span>
        </div>
        <div style={{ display: "flex", height: dim(4), borderRadius: dim(2), marginTop: sp(3), overflow: "hidden" }}>
          <div style={{ width: `${(marketFlow.putCall.calls / Math.max(1, marketFlow.putCall.calls + marketFlow.putCall.puts)) * 100}%`, background: T.green }} />
          <div style={{ width: `${(marketFlow.putCall.puts / Math.max(1, marketFlow.putCall.calls + marketFlow.putCall.puts)) * 100}%`, background: T.red }} />
        </div>
      </div>

      {/* Position summary pinned at bottom */}
      <div style={{ padding: sp("6px 10px"), borderTop: `1px solid ${T.border}` }}>
        <div style={{ fontSize: fs(7), fontWeight: 700, color: T.textMuted, letterSpacing: "0.1em", marginBottom: 3 }}>OPEN POSITION</div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: fs(9), fontFamily: T.mono }}>
          <span style={{ color: T.textSec }}>5× SPY 585C</span>
          <span style={{ color: T.green, fontWeight: 600 }}>+$165 (+9.6%)</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: fs(8), fontFamily: T.mono, marginTop: 2 }}>
          <span style={{ color: T.textMuted }}>Avg $3.45 · Mkt $3.78</span>
          <span style={{ color: T.textMuted }}>Trail L1 on</span>
        </div>
      </div>
    </div>
  );

  // ── ALL OTHER SCREENS: Quote + Order Entry ──
  return (
    <div style={{
      display: "flex", flexDirection: "column", height: "100%",
      background: T.bg1, borderLeft: `1px solid ${T.border}`, width: dim(270), flexShrink: 0, overflowY: "auto",
    }}>
      {/* Quote Header */}
      <div style={{ padding: sp("12px 14px"), borderBottom: `1px solid ${T.border}` }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
          <span style={{ fontSize: fs(13), fontWeight: 700, fontFamily: T.display, color: T.text }}>{w.sym}</span>
          <span style={{ fontSize: fs(9), color: T.textDim, fontFamily: T.sans }}>{w.name}</span>
        </div>
        <div style={{ fontSize: fs(26), fontWeight: 700, fontFamily: T.mono, color: T.text, letterSpacing: "-0.02em", marginTop: 4 }}>
          {w.price < 10 ? w.price.toFixed(3) : w.price.toFixed(2)}
        </div>
        <div style={{ display: "flex", gap: sp(8), marginTop: sp(2), alignItems: "center" }}>
          <span style={{ fontSize: fs(12), fontFamily: T.mono, fontWeight: 600, color: pos ? T.green : T.red }}>
            {pos ? "+" : ""}{w.chg.toFixed(2)} ({pos ? "+" : ""}{w.pct.toFixed(2)}%)
          </span>
          <div style={{ width: 50, height: 16 }}>
            <ResearchSparkline
              bars={w.sparkBars}
              theme={T}
              themeKey={CURRENT_THEME}
            />
          </div>
        </div>
      </div>

      {/* Order Entry (Chart/Flow) */}
      {(screen === "trade" || screen === "flow") && (
        <div style={{ padding: sp("10px 14px"), borderBottom: `1px solid ${T.border}` }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: sp(4), marginBottom: 10 }}>
            {["buy","sell"].map(s => (
              <button key={s} onClick={() => setOrderSide(s)} style={{
                padding: sp("7px 0"), fontSize: fs(12), fontWeight: 700, fontFamily: T.sans,
                border: "none", borderRadius: dim(5), cursor: "pointer",
                background: orderSide===s ? (s==="buy"?T.green:T.red) : T.bg2,
                color: orderSide===s ? "#fff" : T.textDim,
              }}>{s==="buy"?"Buy":"Sell"}</button>
            ))}
          </div>
          <div style={{ display: "flex", gap: sp(4), marginBottom: 10 }}>
            {["limit","market","stop"].map(t => (
              <Pill key={t} active={orderType===t} onClick={() => setOrderType(t)}>{t.charAt(0).toUpperCase()+t.slice(1)}</Pill>
            ))}
          </div>
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: fs(10), color: T.textDim, fontFamily: T.sans, marginBottom: 3 }}>Quantity</div>
            <input value={qty} onChange={e => setQty(+e.target.value)} type="number" style={{
              width: "100%", padding: sp("6px 8px"), fontSize: fs(13), fontFamily: T.mono, fontWeight: 600,
              background: T.bg2, border: `1px solid ${T.border}`, borderRadius: dim(4), color: T.text, outline: "none",
            }} />
          </div>
          {orderType !== "market" && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: fs(10), color: T.textDim, marginBottom: 3 }}>{orderType === "limit" ? "Limit Price" : "Stop Price"}</div>
              <input
                value={limitPrice}
                onChange={e => setLimitPrice(e.target.value)}
                style={{
                  width: "100%", padding: sp("6px 8px"), fontSize: fs(13), fontFamily: T.mono, fontWeight: 600,
                  background: T.bg2, border: `1px solid ${T.border}`, borderRadius: dim(4), color: T.text, outline: "none",
                }} />
            </div>
          )}
          <div style={{ display: "flex", gap: 4 }}>
            <button
              onClick={() => {
                const priceStr = orderType === "market" ? "MKT" : `@ $${limitPrice}`;
                toast.push({
                  kind: "info",
                  title: "Order preview",
                  body: `${orderSide.toUpperCase()} ${qty} ${w.sym} ${priceStr} · ${orderType.toUpperCase()}`,
                });
              }}
              style={{ flex: 1, padding: sp("8px 0"), border: "none", borderRadius: dim(5), background: T.bg3, color: T.textSec, fontSize: fs(12), fontWeight: 700, fontFamily: T.sans, cursor: "pointer" }}
            >Preview</button>
            <button
              onClick={() => {
                const fillPrice = orderType === "market" ? w.price : parseFloat(limitPrice);
                if (!Number.isFinite(fillPrice) || fillPrice <= 0) {
                  toast.push({ kind: "error", title: "Invalid price", body: "Enter a valid limit price." });
                  return;
                }
                if (!qty || qty <= 0) {
                  toast.push({ kind: "error", title: "Invalid quantity", body: "Enter a positive quantity." });
                  return;
                }
                positions.addPosition({
                  kind: "equity",
                  ticker: w.sym,
                  side: orderSide === "buy" ? "LONG" : "SHORT",
                  qty,
                  entry: fillPrice,
                  orderType: orderType.toUpperCase(),
                });
                toast.push({
                  kind: "success",
                  title: `Order filled`,
                  body: `${orderSide === "buy" ? "Bought" : "Sold"} ${qty} ${w.sym} @ $${fillPrice.toFixed(2)}`,
                });
              }}
              style={{ flex: 2, padding: sp("8px 0"), border: "none", borderRadius: dim(5), background: orderSide==="buy"?T.green:T.red, color: "#fff", fontSize: fs(12), fontWeight: 700, fontFamily: T.sans, cursor: "pointer" }}
            >Submit</button>
          </div>
        </div>
      )}

      {/* Quote Stats */}
      <div style={{ padding: sp("10px 14px"), borderBottom: `1px solid ${T.border}` }}>
        <div style={{ fontSize: fs(9), fontWeight: 700, color: T.textMuted, letterSpacing: "0.1em", marginBottom: 6 }}>QUOTE DETAIL</div>
        {quoteStats.map(([l,v]) => (
          <QuoteStat key={l} label={l} value={v} />
        ))}
      </div>

      {/* Risk Warden (Algo) */}
      {screen === "algo" && (
        <div style={{ padding: sp("10px 14px"), borderBottom: `1px solid ${T.border}` }}>
          <div style={{ fontSize: fs(9), fontWeight: 700, color: T.textMuted, letterSpacing: "0.1em", marginBottom: 8 }}>RISK WARDEN</div>
          {[{label:"Daily P&L",value:"+$342",color:T.green},{label:"Drawdown",value:"2.1%",color:T.amber},{label:"Positions",value:"2 / 4 max",color:T.text},{label:"Consec. Losses",value:"0",color:T.green}].map(r => (
            <div key={r.label} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}>
              <span style={{ fontSize: fs(10), color: T.textDim }}>{r.label}</span>
              <span style={{ fontSize: fs(10), color: r.color, fontFamily: T.mono, fontWeight: 600 }}>{r.value}</span>
            </div>
          ))}
          <div style={{ marginTop: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: fs(9), color: T.textDim, marginBottom: 3 }}><span>Account Risk</span><span>Low</span></div>
            <div style={{ height: dim(6), borderRadius: dim(3), background: T.bg3, overflow: "hidden" }}>
              <div style={{ width: "18%", height: "100%", borderRadius: dim(3), background: T.green }} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════
// SCREEN: MARKET
// ═══════════════════════════════════════════════════════════════════

const INDICES = [
  { sym: "SPY", name: "S&P 500", price: 582.41, chg: +1.87, pct: +0.32, spark: genSparkline(101, 48, 582, 0.8), callPrem: 4.2, putPrem: 2.8 },
  { sym: "QQQ", name: "Nasdaq 100", price: 498.23, chg: -2.14, pct: -0.43, spark: genSparkline(102, 48, 498, 1.2), callPrem: 1.6, putPrem: 2.9 },
  { sym: "IWM", name: "Russell 2k", price: 221.05, chg: +0.62, pct: +0.28, spark: genSparkline(103, 48, 221, 0.5), callPrem: 0.8, putPrem: 0.6 },
  { sym: "DIA", name: "Dow Jones", price: 427.83, chg: +3.41, pct: +0.80, spark: genSparkline(104, 48, 428, 1.0), callPrem: 0.5, putPrem: 0.3 },
];

// Order flow distribution by trade size — for "smart money" reads
// XL = institutional block trades, S = retail
// Each value in $M of notional traded
const MARKET_ORDER_FLOW = {
  buyXL: 380, buyL: 314, buyM: 102, buyS: 599,
  sellXL: 620, sellL: 293, sellM: 140, sellS: 484,
};

// Per-ticker order flow, generated deterministically by seed
const genTickerFlow = (seed, bullishBias = 0.5) => {
  const r = rng(seed);
  const totalVolM = 200 + r() * 800; // total notional in $M
  const buyShare = bullishBias + (r() - 0.5) * 0.2;
  const totalBuy = totalVolM * buyShare;
  const totalSell = totalVolM - totalBuy;
  // Distribute across size buckets — XL is rarer, S is most common
  const dist = [0.40, 0.25, 0.15, 0.20]; // XL, L, M, S — XL gets larger share by notional
  return {
    buyXL: +(totalBuy * dist[0] * (0.7 + r() * 0.6)).toFixed(1),
    buyL:  +(totalBuy * dist[1] * (0.7 + r() * 0.6)).toFixed(1),
    buyM:  +(totalBuy * dist[2] * (0.7 + r() * 0.6)).toFixed(1),
    buyS:  +(totalBuy * dist[3] * (0.7 + r() * 0.6)).toFixed(1),
    sellXL: +(totalSell * dist[0] * (0.7 + r() * 0.6)).toFixed(1),
    sellL:  +(totalSell * dist[1] * (0.7 + r() * 0.6)).toFixed(1),
    sellM:  +(totalSell * dist[2] * (0.7 + r() * 0.6)).toFixed(1),
    sellS:  +(totalSell * dist[3] * (0.7 + r() * 0.6)).toFixed(1),
  };
};

// ─── OPTIONS ORDER FLOW DATA GENERATORS ───
// 1. genOptionsFlowByDTE — call/put premium grouped by DTE bucket
const genOptionsFlowByDTE = (seed, bullish = 0.55) => {
  const r = rng(seed);
  const buckets = [
    { label: "0DTE",  dte: "0d"     },
    { label: "1-7d",  dte: "1-7d"   },
    { label: "8-30d", dte: "8-30d"  },
    { label: "30d+",  dte: "30d+"   },
  ];
  // 0DTE/short tend to be biggest by count, longer-dated bigger by premium
  const totalPrem = 800 + r() * 1200;
  const dist = [0.32, 0.28, 0.24, 0.16];
  return buckets.map((b, i) => {
    const total = totalPrem * dist[i] * (0.7 + r() * 0.6);
    const callShare = bullish + (r() - 0.5) * 0.2;
    return {
      ...b,
      callPrem: +(total * callShare).toFixed(1),
      putPrem:  +(total * (1 - callShare)).toFixed(1),
      total:    +total.toFixed(1),
    };
  });
};

// 2. genOptionsFlowByStrike — premium concentration at each strike (heatmap data)
// Returns rows centered around current price, each with call+put premium volume.
const genOptionsFlowByStrike = (seed, atmPrice) => {
  const r = rng(seed);
  const strikeStep = atmPrice >= 200 ? 5 : atmPrice >= 100 ? 2.5 : 1;
  const strikes = [];
  for (let offset = -7; offset <= 7; offset++) {
    const k = Math.round((atmPrice + offset * strikeStep) / strikeStep) * strikeStep;
    // Premium concentrates near ATM (gaussian-ish), with a "pin" at round numbers
    const distFromATM = Math.abs(offset);
    const baseFalloff = Math.exp(-distFromATM * distFromATM / 12);
    const pinBonus = (Math.round(k) === k && k % 10 === 0) ? 1.4 : 1.0;
    const callPrem = (50 + r() * 200) * baseFalloff * pinBonus;
    const putPrem  = (50 + r() * 200) * baseFalloff * pinBonus;
    strikes.push({
      strike: k,
      callPrem: +callPrem.toFixed(0),
      putPrem:  +putPrem.toFixed(0),
      total:    +(callPrem + putPrem).toFixed(0),
      isATM: offset === 0,
    });
  }
  return strikes;
};

// 3. genOptionsFlowTimeline — intraday net premium flow (cumulative)
// Returns 26 bars (one per 15-min bucket from 9:30 to 16:00)
const genOptionsFlowTimeline = (seed, bullish = 0.55) => {
  const r = rng(seed);
  const bars = [];
  let cumCall = 0, cumPut = 0;
  for (let i = 0; i < 26; i++) {
    const minutes = 9 * 60 + 30 + i * 15;
    const hh = Math.floor(minutes / 60);
    const mm = minutes % 60;
    const time = `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
    // Volume highest at open and close
    const sessionMul = i < 4 ? 1.8 : i > 22 ? 1.6 : 0.6 + r() * 0.7;
    const totalPrem = (15 + r() * 35) * sessionMul;
    const callShare = bullish + (r() - 0.5) * 0.3;
    const callPrem = totalPrem * callShare;
    const putPrem  = totalPrem * (1 - callShare);
    cumCall += callPrem;
    cumPut += putPrem;
    bars.push({
      time, t: i,
      callPrem: +callPrem.toFixed(1),
      putPrem:  +putPrem.toFixed(1),
      net:      +(callPrem - putPrem).toFixed(1),
      cumCall:  +cumCall.toFixed(1),
      cumPut:   +cumPut.toFixed(1),
      cumNet:   +(cumCall - cumPut).toFixed(1),
    });
  }
  return bars;
};

const MACRO_TICKERS = [
  { sym: "VIXY", price: 28.68, chg: +0.28, pct: +0.99, label: "Volatility" },
  { sym: "IEF", price: 95.54, chg: -0.28, pct: -0.29, label: "Treasuries" },
  { sym: "UUP", price: 27.385, chg: +0.065, pct: +0.24, label: "Dollar" },
  { sym: "GLD", price: 434.83, chg: -6.79, pct: -1.54, label: "Gold" },
  { sym: "USO", price: 123.9488, chg: +2.455, pct: +2.02, label: "Crude" },
];

const RATES_PROXIES = [
  { term: "1-3M", sym: "BIL", price: 91.565, chg: +0.0096, pct: +0.01, d5: 0 },
  { term: "1-3Y", sym: "SHY", price: 82.530838, chg: -0.065, pct: -0.08, d5: 0 },
  { term: "3-7Y", sym: "IEI", price: 118.675, chg: -0.235, pct: -0.20, d5: 0 },
  { term: "7-10Y", sym: "IEF", price: 95.5401, chg: -0.28, pct: -0.29, d5: 0 },
  { term: "20Y+", sym: "TLT", price: 86.67, chg: -0.35, pct: -0.40, d5: 0 },
];

const SECTORS = [
  { name: "Technology", sym: "XLK", chg: +0.69, d5: +1.84 },
  { name: "Financials", sym: "XLF", chg: +0.75, d5: +1.21 },
  { name: "Healthcare", sym: "XLV", chg: +0.38, d5: +0.92 },
  { name: "Industrials", sym: "XLI", chg: +0.76, d5: +1.56 },
  { name: "Energy", sym: "XLE", chg: -0.88, d5: -1.34 },
  { name: "Cons Disc", sym: "XLY", chg: -0.58, d5: -0.87 },
  { name: "Utilities", sym: "XLU", chg: +0.94, d5: +2.12 },
  { name: "Comm Svcs", sym: "XLC", chg: +0.82, d5: +1.43 },
  { name: "Materials", sym: "XLB", chg: -0.40, d5: -0.72 },
  { name: "Staples", sym: "XLP", chg: +0.29, d5: +0.64 },
  { name: "Real Estate", sym: "XLRE", chg: +0.68, d5: +1.08 },
].sort((a, b) => b.chg - a.chg);

// Finviz-style treemap data: sector → stocks with market cap (billions) and performance
const TREEMAP_DATA = [
  { sector: "TECHNOLOGY", stocks: [
    { sym: "MSFT", cap: 3100, d1: +2.13, d5: +4.2 }, { sym: "AAPL", cap: 2900, d1: +1.38, d5: +3.1 },
    { sym: "NVDA", cap: 2800, d1: +3.47, d5: +8.2 }, { sym: "AVGO", cap: 680, d1: +1.22, d5: +3.8 },
    { sym: "ORCL", cap: 420, d1: -0.45, d5: +1.1 }, { sym: "CRM", cap: 310, d1: -1.82, d5: -0.4 },
    { sym: "AMD", cap: 260, d1: +2.01, d5: +5.3 }, { sym: "QCOM", cap: 210, d1: +0.87, d5: +2.1 },
    { sym: "INTC", cap: 120, d1: -2.34, d5: -4.8 }, { sym: "IBM", cap: 195, d1: +0.34, d5: +1.2 },
  ]},
  { sector: "COMM SVCS", stocks: [
    { sym: "GOOGL", cap: 2100, d1: -0.92, d5: -1.8 }, { sym: "META", cap: 1500, d1: -0.58, d5: +2.4 },
    { sym: "NFLX", cap: 380, d1: +1.67, d5: +5.1 }, { sym: "TMUS", cap: 280, d1: +0.42, d5: +1.3 },
    { sym: "DIS", cap: 200, d1: -1.23, d5: -2.6 }, { sym: "VZ", cap: 175, d1: +0.28, d5: +0.8 },
  ]},
  { sector: "CONS DISC", stocks: [
    { sym: "AMZN", cap: 2000, d1: +0.45, d5: +1.9 }, { sym: "TSLA", cap: 800, d1: +2.99, d5: +7.8 },
    { sym: "HD", cap: 380, d1: -0.67, d5: -1.4 }, { sym: "MCD", cap: 210, d1: +0.34, d5: +0.9 },
    { sym: "NKE", cap: 120, d1: -1.45, d5: -3.2 }, { sym: "SBUX", cap: 110, d1: -0.89, d5: -1.7 },
  ]},
  { sector: "FINANCIAL", stocks: [
    { sym: "BRK.B", cap: 880, d1: +0.75, d5: +1.2 }, { sym: "JPM", cap: 620, d1: +1.34, d5: +2.8 },
    { sym: "V", cap: 580, d1: +0.92, d5: +1.9 }, { sym: "MA", cap: 440, d1: +0.67, d5: +1.5 },
    { sym: "BAC", cap: 310, d1: +1.12, d5: +2.3 }, { sym: "GS", cap: 160, d1: +0.56, d5: +1.1 },
  ]},
  { sector: "HEALTHCARE", stocks: [
    { sym: "LLY", cap: 750, d1: +1.45, d5: +3.4 }, { sym: "UNH", cap: 520, d1: -2.67, d5: -5.1 },
    { sym: "JNJ", cap: 380, d1: +0.34, d5: +0.7 }, { sym: "ABBV", cap: 340, d1: +0.89, d5: +1.8 },
    { sym: "MRK", cap: 280, d1: -0.45, d5: -0.9 }, { sym: "ABT", cap: 200, d1: +0.23, d5: +0.5 },
  ]},
  { sector: "INDUSTRIAL", stocks: [
    { sym: "GE", cap: 200, d1: +1.56, d5: +3.2 }, { sym: "CAT", cap: 180, d1: +0.78, d5: +1.9 },
    { sym: "RTX", cap: 155, d1: +0.45, d5: +1.1 }, { sym: "UNP", cap: 145, d1: -0.34, d5: +0.6 },
    { sym: "BA", cap: 130, d1: -1.23, d5: -2.8 }, { sym: "HON", cap: 140, d1: +0.56, d5: +1.4 },
  ]},
  { sector: "ENERGY", stocks: [
    { sym: "XOM", cap: 480, d1: -0.88, d5: -1.3 }, { sym: "CVX", cap: 290, d1: -1.12, d5: -2.1 },
    { sym: "COP", cap: 130, d1: -0.67, d5: -1.8 }, { sym: "SLB", cap: 65, d1: -1.34, d5: -2.9 },
  ]},
  { sector: "STAPLES", stocks: [
    { sym: "WMT", cap: 580, d1: +0.29, d5: +0.6 }, { sym: "PG", cap: 380, d1: +0.45, d5: +0.9 },
    { sym: "COST", cap: 340, d1: +0.67, d5: +1.4 }, { sym: "KO", cap: 260, d1: +0.12, d5: +0.3 },
  ]},
];

const TREEMAP_SYMBOLS = [...new Set(TREEMAP_DATA.flatMap(sector => sector.stocks.map(stock => stock.sym)))];
const MARKET_SNAPSHOT_SYMBOLS = [
  ...new Set([
    ...INDICES.map(item => item.sym),
    ...MACRO_TICKERS.map(item => item.sym),
    ...RATES_PROXIES.map(item => item.sym),
    ...SECTORS.map(item => item.sym),
    ...TREEMAP_SYMBOLS,
  ]),
];
const MARKET_PERFORMANCE_SYMBOLS = [
  ...new Set([
    ...MACRO_TICKERS.map(item => item.sym),
    ...RATES_PROXIES.map(item => item.sym),
    ...SECTORS.map(item => item.sym),
    ...TREEMAP_SYMBOLS,
  ]),
];

// TreemapHeatmap — SVG-rendered, D3-powered, Finviz-quality
// Drop-in replacement for the current broken treemap

// Color scale matching Finviz: deep green → neutral → deep red
// Green/red colors stay saturated in both themes (they're vivid against any bg)
// Neutral cell + text adapt via T proxy
const heatColor = (val) => {
  if (val >= 3) return "#1a7a3c";
  if (val >= 2) return "#228b45";
  if (val >= 1) return "#2f9c51";
  if (val >= 0.5) return "#4ea866";
  if (val >= 0.1) return "#6fb481";
  if (val > -0.1) return T.bg3;       // theme-aware neutral cell
  if (val >= -0.5) return "#b36a6a";
  if (val >= -1) return "#b55050";
  if (val >= -2) return "#b03838";
  if (val >= -3) return "#982828";
  return "#7d1f1f";
};
// Neutral cells use theme-aware muted text; saturated cells always use white
const heatText = (val) => Math.abs(val) < 0.1 ? T.textDim : "#ffffff";

const TreemapHeatmap = ({ data, period, onSymClick }) => {
  const VW = 1000, VH = 480;

  // Build D3 hierarchy
  const root = useMemo(() => {
    const hierarchy = d3.hierarchy({
      name: "root",
      children: data.map(s => ({
        name: s.sector,
        children: s.stocks.map(st => ({
          name: st.sym,
          value: st.cap,
          chg: period === "1d" ? st.d1 : st.d5,
        })),
      })),
    })
    .sum(d => d.value)
    .sort((a, b) => b.value - a.value);

    d3.treemap()
      .size([VW, VH])
      .paddingOuter(3)
      .paddingTop(20)
      .paddingInner(2)
      .round(true)
      .tile(d3.treemapSquarify.ratio(1.2))
      (hierarchy);

    return hierarchy;
  }, [data, period]);

  const sectors = root.children || [];

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${VW} ${VH}`}
      preserveAspectRatio="xMidYMid meet"
      style={{ display: "block", borderRadius: 4, aspectRatio: `${VW} / ${VH}` }}
    >
      {/* Background */}
      <rect width={VW} height={VH} fill={T.bg1} rx="4" />

      {sectors.map((sector, si) => {
        const sx = sector.x0, sy = sector.y0;
        const sw = sector.x1 - sector.x0, sh = sector.y1 - sector.y0;

        return (
          <g key={si}>
            {/* Sector background with thin border */}
            <rect x={sx} y={sy} width={sw} height={sh}
              fill="none" stroke={T.border} strokeWidth="1" rx="2" />

            {/* Sector label bar */}
            <rect x={sx} y={sy} width={sw} height={18}
              fill={T.bg2} rx="2" />
            <text x={sx + 6} y={sy + 12}
              style={{ fontSize: fs(10), fontWeight: 700, fontFamily: T.sans, fill: T.textSec, letterSpacing: "0.06em" }}>
              {sector.data.name}
            </text>

            {/* Stock cells */}
            {(sector.children || []).map((leaf, li) => {
              const lx = leaf.x0, ly = leaf.y0;
              const lw = leaf.x1 - leaf.x0, lh = leaf.y1 - leaf.y0;
              const val = leaf.data.chg;
              const bg = heatColor(val);
              const tc = heatText(val);

              // Adaptive font sizes based on cell pixel dimensions
              const symSize = lw > 90 ? 14 : lw > 60 ? 12 : lw > 40 ? 10 : lw > 25 ? 8 : 0;
              const pctSize = lw > 60 ? 11 : lw > 40 ? 9 : lw > 25 ? 7 : 0;
              const showSym = symSize > 0 && lh > 18;
              const showPct = pctSize > 0 && lh > 28;
              const cx = lx + lw / 2;
              const cy = ly + lh / 2;

              return (
                <g key={li} style={{ cursor: "pointer" }}
                  onClick={() => onSymClick && onSymClick(leaf.data.name)}>
                  <rect x={lx} y={ly} width={lw} height={lh}
                    fill={bg} rx="1"
                    onMouseEnter={e => e.target.setAttribute("opacity", "0.8")}
                    onMouseLeave={e => e.target.setAttribute("opacity", "1")} />
                  {showSym && (
                    <text x={cx} y={showPct ? cy - 2 : cy + 1}
                      textAnchor="middle" dominantBaseline="central"
                      style={{ fontSize: symSize, fontWeight: 800, fontFamily: T.mono, fill: tc, pointerEvents: "none" }}>
                      {leaf.data.name}
                    </text>
                  )}
                  {showPct && (
                    <text x={cx} y={cy + symSize * 0.6 + 2}
                      textAnchor="middle" dominantBaseline="central"
                      style={{ fontSize: pctSize, fontWeight: 600, fontFamily: T.mono, fill: tc, opacity: 0.85, pointerEvents: "none" }}>
                      {val >= 0 ? "+" : ""}{val.toFixed(2)}%
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
  const VW = 1000, VH = 60;

  const root = useMemo(() => {
    const weights = { XLK: 30, XLF: 13, XLV: 12, XLY: 10, XLC: 9, XLI: 9, XLP: 6, XLE: 4, XLRE: 3, XLU: 2, XLB: 2 };
    const hierarchy = d3.hierarchy({
      name: "root",
      children: sectors.map(s => ({
        name: s.sym,
        fullName: s.name,
        value: weights[s.sym] || 3,
        chg: period === "1d" ? s.chg : s.d5,
      })),
    }).sum(d => d.value).sort((a, b) => b.value - a.value);

    d3.treemap()
      .size([VW, VH])
      .padding(1)
      .round(true)
      .tile(d3.treemapSquarify)
      (hierarchy);

    return hierarchy;
  }, [sectors, period]);

  return (
    <svg width="100%" viewBox={`0 0 ${VW} ${VH}`} style={{ display: "block", borderRadius: 4 }}>
      <rect width={VW} height={VH} fill={T.bg1} rx="3" />
      {(root.children || []).map((leaf, i) => {
        const lx = leaf.x0, ly = leaf.y0;
        const lw = leaf.x1 - leaf.x0, lh = leaf.y1 - leaf.y0;
        const val = leaf.data.chg;
        const bg = heatColor(val);
        const cx = lx + lw / 2, cy = ly + lh / 2;
        return (
          <g key={i} style={{ cursor: "pointer" }}>
            <rect x={lx} y={ly} width={lw} height={lh} fill={bg} rx="2"
              onMouseEnter={e => e.target.setAttribute("opacity", "0.8")}
              onMouseLeave={e => e.target.setAttribute("opacity", "1")} />
            <text x={cx} y={cy - 4} textAnchor="middle" dominantBaseline="central"
              style={{ fontSize: lw > 80 ? 10 : 8, fontWeight: 700, fontFamily: T.mono, fill: heatText(val), pointerEvents: "none" }}>
              {leaf.data.name}
            </text>
            <text x={cx} y={cy + 8} textAnchor="middle" dominantBaseline="central"
              style={{ fontSize: lw > 80 ? 9 : 7, fontWeight: 600, fontFamily: T.mono, fill: heatText(val), opacity: 0.8, pointerEvents: "none" }}>
              {val >= 0 ? "+" : ""}{val.toFixed(2)}%
            </text>
          </g>
        );
      })}
    </svg>
  );
};


const NEWS = [
  { text: "Fed's Waller signals support for gradual rate cuts despite sticky services inflation", time: "2h", tag: "FED", s: 0 },
  { text: "NVIDIA Blackwell Ultra shipments to begin Q2; partners confirm record orders", time: "4h", tag: "NVDA", s: 1 },
  { text: "Intel posts surprise loss, guides Q1 below estimates as AI competition intensifies", time: "5h", tag: "INTC", s: -1 },
  { text: "PayPal bets on agentic commerce, acquires Israel-based Cymbio", time: "5h", tag: "PYPL", s: 1 },
  { text: "US initial jobless claims fall to 215K vs 225K expected, labor market remains tight", time: "7h", tag: "MACRO", s: 1 },
  { text: "Treasury 10Y yield climbs to 4.29% as markets digest hawkish Fed commentary", time: "9h", tag: "BONDS", s: -1 },
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
  { key: "vol", label: "Volatility", score: 72, color: T.cyan, items: [
    ["VIX", "16.82", "↓"], ["VIX %ile", "22nd", "↓"], ["VVIX", "14.2", "↓"], ["IV Rank", "18%", "↓"],
  ]},
  { key: "trend", label: "Trend", score: 78, color: T.green, items: [
    ["vs 20 SMA", "Above", "↑"], ["vs 50 SMA", "Above", "↑"], ["Duration", "14d", "→"], ["HH/HL", "3/3", "↑"],
  ]},
  { key: "breadth", label: "Breadth", score: 62, color: T.amber, items: [
    [">20d", "62%", "↓"], [">50d", "58%", "↓"], ["A/D", "1.82", "↑"], ["NH/NL", "3.3:1", "→"],
  ]},
  { key: "mom", label: "Momentum", score: 69, color: T.purple, items: [
    ["Spread", "1.82%", "→"], ["Lead", "XLU XLI", "↑"], ["%HH", "41%", "↓"], ["Part.", "Narrow", "↓"],
  ]},
];

// Platform alerts — aggregated from all modules
const ALERTS = [
  { id: 1, time: "14:42", type: "flow", sev: "critical", title: "Golden Sweep Detected", body: "NVDA 140C 05/16 · $482K at ask · Score 94", read: false },
  { id: 2, time: "14:38", type: "trade", sev: "info", title: "Exit Governor: Trail L1 Active", body: "SPY 585C 04/25 · +12.4% from entry · Floor $3.82", read: false },
  { id: 3, time: "14:21", type: "flow", sev: "high", title: "Repeat Flow × 4", body: "SPY 590C 04/25 · 4 prints · $318K cumulative · at ask", read: false },
  { id: 4, time: "14:15", type: "risk", sev: "warning", title: "Drawdown Watch", body: "Daily drawdown at 1.8% — approaching 3% throttle threshold", read: true },
  { id: 5, time: "13:58", type: "trade", sev: "success", title: "Order Filled: BUY", body: "5× SPY 585C 04/25 @ $3.45 · Edge 1.32× · Conf 0.78", read: true },
  { id: 6, time: "13:45", type: "signal", sev: "info", title: "BOS Long Signal", body: "SPY 5m · Confluence 0.78 · Regime: Trending · Action: FULL", read: true },
  { id: 7, time: "13:30", type: "system", sev: "info", title: "Data Feed Connected", body: "Finnhub WebSocket streaming — 12 symbols subscribed", read: true },
  { id: 8, time: "13:12", type: "flow", sev: "high", title: "Block Trade", body: "QQQ 510P 05/16 · $225K · at bid · Bearish hedge", read: true },
  { id: 9, time: "12:55", type: "event", sev: "warning", title: "FOMC in 19 Days", body: "May 6-7 meeting — consider reducing new position sizing", read: true },
  { id: 10, time: "12:30", type: "trade", sev: "success", title: "Exit Governor: Profit Lock", body: "SPY 580C 04/22 closed @ $4.12 · +$165 (+38.2%)", read: true },
  { id: 11, time: "11:48", type: "signal", sev: "info", title: "CHoCH Short — SKIP", body: "SPY 5m · Confluence 0.45 · Regime: Trending · Below threshold", read: true },
  { id: 12, time: "11:15", type: "price", sev: "info", title: "SPY Crossed VWAP", body: "SPY reclaimed VWAP at 581.62 — bullish intraday signal", read: true },
];

const ALERT_ICONS = { flow: "◈", trade: "◉", risk: "⚠", signal: "◧", system: "⚙", event: "◷", price: "◆" };
const SEV_COLORS = { critical: T.amber, high: T.red, warning: "#f97316", success: T.green, info: T.accent };

const Card = ({ children, style = {}, noPad }) => (
  <div style={{
    background: T.bg2, border: `1px solid ${T.border}`, borderRadius: dim(6),
    padding: noPad ? 0 : "8px 10px", overflow: "hidden", ...style,
  }}>{children}</div>
);

const CardTitle = ({ children, right }) => (
  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
    <span style={{ fontSize: fs(10), fontWeight: 700, fontFamily: T.display, color: T.textSec, letterSpacing: "0.03em" }}>{children}</span>
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
    { value: flow.buyL,  color: "#10b981" },
    { value: flow.buyM,  color: "#34d399" },
    { value: flow.buyS,  color: "#6ee7b7" },
    { value: flow.sellS, color: "#fca5a5" },
    { value: flow.sellM, color: "#f87171" },
    { value: flow.sellL, color: "#ef4444" },
    { value: flow.sellXL, color: "#b91c1c" },
  ];

  const cx = size / 2, cy = size / 2;
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
    return <path key={i} d={d} fill={seg.color} stroke={T.bg2} strokeWidth={1} />;
  });

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {paths}
      <text x={cx} y={cy - 4} textAnchor="middle" fontSize={fs(7)} fill={T.textMuted} fontFamily={T.mono} letterSpacing="0.08em">NET</text>
      <text x={cx} y={cy + fs(11)} textAnchor="middle" fontSize={fs(11)} fontWeight={700} fill={net >= 0 ? T.green : T.red} fontFamily={T.mono}>
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
    <div style={{ display: "grid", gridTemplateColumns: "44px 1fr 22px 1fr 44px", gap: sp(4), alignItems: "center", padding: sp("2px 0"), fontFamily: T.mono, fontSize: fs(9) }}>
      <span style={{ color: T.green, fontWeight: 600, textAlign: "right" }}>{buy.toFixed(1)}</span>
      <div style={{ display: "flex", justifyContent: "flex-end", height: dim(8) }}>
        <div style={{ width: `${buyPct}%`, height: "100%", background: T.green, opacity: 0.85, borderRadius: dim(1) }} />
      </div>
      <span style={{ textAlign: "center", color: T.textSec, fontWeight: 700 }}>{label}</span>
      <div style={{ display: "flex", justifyContent: "flex-start", height: dim(8) }}>
        <div style={{ width: `${sellPct}%`, height: "100%", background: T.red, opacity: 0.85, borderRadius: dim(1) }} />
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
  const maxBucket = Math.max(flow.buyXL, flow.buyL, flow.buyM, flow.buyS, flow.sellXL, flow.sellL, flow.sellM, flow.sellS);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: sp(4) }}>
      <div style={{ display: "flex", alignItems: "center", gap: sp(8) }}>
        <OrderFlowDonut flow={flow} size={donutSize} thickness={14} />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: sp(2) }}>
          <div style={{ fontSize: fs(8), color: T.textMuted, letterSpacing: "0.08em" }}>BUY / SELL</div>
          <div style={{ display: "flex", justifyContent: "space-between", fontFamily: T.mono, fontSize: fs(10) }}>
            <span style={{ color: T.green, fontWeight: 700 }}>${totalBuy.toFixed(0)}M</span>
            <span style={{ color: T.red, fontWeight: 700 }}>${totalSell.toFixed(0)}M</span>
          </div>
          <div style={{ display: "flex", height: dim(4), borderRadius: dim(2), overflow: "hidden", background: T.bg3 }}>
            <div style={{ width: `${buyPct}%`, background: T.green, opacity: 0.85 }} />
            <div style={{ width: `${100 - buyPct}%`, background: T.red, opacity: 0.85 }} />
          </div>
          <div style={{ fontSize: fs(8), color: T.textMuted, fontFamily: T.mono }}>{buyPct}% buy pressure</div>
        </div>
      </div>
      <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: sp(4) }}>
        <SizeBucketRow label="XL" buy={flow.buyXL} sell={flow.sellXL} maxValue={maxBucket} />
        <SizeBucketRow label="L"  buy={flow.buyL}  sell={flow.sellL}  maxValue={maxBucket} />
        <SizeBucketRow label="M"  buy={flow.buyM}  sell={flow.sellM}  maxValue={maxBucket} />
        <SizeBucketRow label="S"  buy={flow.buyS}  sell={flow.sellS}  maxValue={maxBucket} />
      </div>
    </div>
  );
};


// ─── SHOULD I TRADE STRIP ───
// Compressed condition card for the Alert Center right rail.
// Replaces the large gauge + 4 condition cards that previously took ~180px on Market tab.
// Scores recalc based on the currently-selected ticker — TSLA has high vol + strong momentum,
// SPY is baseline, MSFT is lower vol, etc. Driven off TRADE_TICKER_INFO + synthetic per-sym nudges.
const ShouldITradeStrip = ({ sym = "SPY" }) => {
  // Per-ticker score computation.
  // Base scores from COND, then shifted based on the active ticker's character.
  const tickerScores = (() => {
    const info = TRADE_TICKER_INFO[sym] || TRADE_TICKER_INFO.SPY;
    const breadth = buildTrackedBreadthSummary();
    const volProxy = MACRO_TICKERS.find(item => item.sym === "VIXY") || MACRO_TICKERS[0];
    const goldProxy = MACRO_TICKERS.find(item => item.sym === "GLD") || MACRO_TICKERS[3];
    const crudeProxy = MACRO_TICKERS.find(item => item.sym === "USO") || MACRO_TICKERS[4];
    // Ticker "character" map — hand-tuned to reflect typical regime personality of each name
    const tilt = {
      SPY:  { vol:  0, trend:  0, breadth:  0, mom:  0 },
      QQQ:  { vol: +5, trend: +2, breadth: -3, mom: +3 },
      NVDA: { vol: +18, trend: +14, breadth: +8, mom: +18 },
      TSLA: { vol: +22, trend:  0, breadth: -5, mom: +12 },
      AAPL: { vol: -5, trend: +4, breadth: +3, mom: +2 },
      MSFT: { vol: -8, trend: +2, breadth: +4, mom: -2 },
      META: { vol: +10, trend: -4, breadth: -2, mom:  0 },
      AMZN: { vol: +4, trend: +6, breadth: +2, mom: +5 },
      IWM:  { vol: +12, trend: -10, breadth: -14, mom: -6 },
      DIA:  { vol: -6, trend: +3, breadth: +5, mom: +1 },
      VIX:  { vol: +35, trend: -20, breadth: -25, mom: -10 },
      VIXY: { vol: +24, trend: -12, breadth: -18, mom: -8 },
      IEF:  { vol: -10, trend: -4, breadth: +6, mom: -3 },
      UUP:  { vol: +6, trend: +2, breadth: -2, mom: +1 },
    };
    const t = tilt[sym] || { vol: 0, trend: 0, breadth: 0, mom: 0 };
    // Also nudge based on the ticker's day performance (green day lifts trend/mom)
    const dayNudge = Math.round(info.pct * 2); // e.g. +3% day adds 6 points
    const dynamicItems = {
      vol: [
        [volProxy?.sym || "VIXY", typeof volProxy?.price === "number" ? volProxy.price.toFixed(2) : "—", volProxy?.pct >= 0 ? "↑" : "↓"],
        ["Vol 1D", typeof volProxy?.pct === "number" ? `${volProxy.pct >= 0 ? "+" : ""}${volProxy.pct.toFixed(2)}%` : "—", volProxy?.pct >= 0 ? "↑" : "↓"],
        [goldProxy?.sym || "GLD", typeof goldProxy?.pct === "number" ? `${goldProxy.pct >= 0 ? "+" : ""}${goldProxy.pct.toFixed(2)}%` : "—", goldProxy?.pct >= 0 ? "↑" : "↓"],
        [crudeProxy?.sym || "USO", typeof crudeProxy?.pct === "number" ? `${crudeProxy.pct >= 0 ? "+" : ""}${crudeProxy.pct.toFixed(2)}%` : "—", crudeProxy?.pct >= 0 ? "↑" : "↓"],
      ],
      trend: [
        ["vs Open", info.open != null ? (info.price >= info.open ? "Above" : "Below") : "—", info.open != null ? (info.price >= info.open ? "↑" : "↓") : "→"],
        ["vs Prev", info.prevClose != null ? (info.price >= info.prevClose ? "Above" : "Below") : "—", info.prevClose != null ? (info.price >= info.prevClose ? "↑" : "↓") : "→"],
        ["Day High", info.high != null ? info.high.toFixed(2) : "—", "→"],
        ["Day Low", info.low != null ? info.low.toFixed(2) : "—", "→"],
      ],
      breadth: [
        ["A/D", `${breadth.advancers}:${breadth.decliners}`, breadth.advancers >= breadth.decliners ? "↑" : "↓"],
        ["5D+", `${breadth.positive5dPct.toFixed(0)}%`, breadth.positive5dPct >= 50 ? "↑" : "↓"],
        ["Sectors+", `${breadth.positiveSectors}/${SECTORS.length}`, breadth.positiveSectors >= Math.ceil(SECTORS.length / 2) ? "↑" : "↓"],
        ["Lead", breadth.leader?.sym || "—", breadth.leader?.chg >= 0 ? "↑" : "↓"],
      ],
      mom: [
        ["Lead", breadth.leader?.sym || "—", breadth.leader?.chg >= 0 ? "↑" : "↓"],
        ["Lag", breadth.laggard?.sym || "—", breadth.laggard?.chg >= 0 ? "↑" : "↓"],
        ["Gold", typeof goldProxy?.pct === "number" ? `${goldProxy.pct >= 0 ? "+" : ""}${goldProxy.pct.toFixed(2)}%` : "—", goldProxy?.pct >= 0 ? "↑" : "↓"],
        ["Crude", typeof crudeProxy?.pct === "number" ? `${crudeProxy.pct >= 0 ? "+" : ""}${crudeProxy.pct.toFixed(2)}%` : "—", crudeProxy?.pct >= 0 ? "↑" : "↓"],
      ],
    };
    // Build condition cards with recomputed scores
    return COND.map(c => {
      const key = c.key === "trend" ? "trend" : c.key === "breadth" ? "breadth" : c.key === "mom" ? "mom" : "vol";
      const delta = t[key] || 0;
      const perfAdjust = (key === "trend" || key === "mom") ? dayNudge : 0;
      const score = Math.max(10, Math.min(95, c.score + delta + perfAdjust));
      // Dynamically recolor based on the score rather than carrying the static color
      const color = score >= 75 ? T.green : score >= 55 ? T.amber : T.red;
      return { ...c, score, color, items: dynamicItems[key] || c.items };
    });
  })();

  const mqScore = Math.round(tickerScores.reduce((a, c) => a + c.score, 0) / tickerScores.length);
  const mqColor = mqScore >= 70 ? T.green : mqScore >= 50 ? T.amber : T.red;
  const verdict = mqScore >= 70 ? "FAVORABLE" : mqScore >= 50 ? "CAUTION" : "AVOID";
  const [expanded, setExpanded] = useState(false);

  return (
    <div style={{ borderBottom: `1px solid ${T.border}`, background: T.bg2 }}>
      {/* Headline row — always visible */}
      <div
        onClick={() => setExpanded(e => !e)}
        style={{
          display: "flex", alignItems: "center", gap: sp(8),
          padding: sp("8px 12px"), cursor: "pointer",
          transition: "background 0.1s",
        }}
        onMouseEnter={e => e.currentTarget.style.background = T.bg3}
        onMouseLeave={e => e.currentTarget.style.background = T.bg2}
      >
        {/* Score circle + verdict */}
        <div style={{ display: "flex", alignItems: "center", gap: sp(6) }}>
          <div style={{
            width: dim(28), height: dim(28), borderRadius: "50%",
            background: `${mqColor}20`, border: `2px solid ${mqColor}`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: fs(11), fontWeight: 800, color: mqColor, fontFamily: T.mono,
            transition: "background 0.3s, border-color 0.3s",
          }}>{mqScore}</div>
          <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.1 }}>
            <span style={{ fontSize: fs(7), color: T.textMuted, letterSpacing: "0.04em", fontWeight: 700, whiteSpace: "nowrap" }}>TRADE {sym}?</span>
            <span style={{ fontSize: fs(11), fontWeight: 700, color: mqColor }}>{verdict}</span>
          </div>
        </div>
        {/* Inline condition pills — now reactive */}
        <div style={{ flex: 1, display: "flex", justifyContent: "flex-end", gap: sp(3) }}>
          {tickerScores.map(c => (
            <div key={c.key} title={`${c.label} ${c.score}`} style={{
              display: "flex", flexDirection: "column", alignItems: "center", gap: 1,
              padding: sp("2px 4px"), borderRadius: dim(3), background: `${c.color}10`,
              transition: "background 0.3s", minWidth: dim(30),
            }}>
              <span style={{ fontSize: fs(7), color: T.textMuted, fontWeight: 600, letterSpacing: "0.02em" }}>{c.label.slice(0, 3).toUpperCase()}</span>
              <span style={{ fontSize: fs(11), fontWeight: 800, color: c.color, fontFamily: T.mono, lineHeight: 1 }}>{c.score}</span>
            </div>
          ))}
        </div>
        <span style={{ fontSize: fs(11), color: T.textMuted, transform: expanded ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>›</span>
      </div>
      {/* Expanded breakdown */}
      {expanded && (
        <div style={{ padding: sp("4px 12px 8px"), background: T.bg1 }}>
          {tickerScores.map(c => (
            <div key={c.key} style={{ marginBottom: sp(6) }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: sp(2) }}>
                <span style={{ fontSize: fs(9), fontWeight: 700, color: c.color, letterSpacing: "0.04em" }}>{c.label.toUpperCase()}</span>
                <span style={{ fontSize: fs(10), fontWeight: 800, color: c.color, fontFamily: T.mono }}>{c.score}</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 1, fontFamily: T.mono }}>
                {c.items.map(([l, v, d], j) => (
                  <div key={j} style={{ display: "grid", gridTemplateColumns: "1fr 14px 50px", gap: sp(4), fontSize: fs(9), padding: sp("1px 0") }}>
                    <span style={{ color: T.textDim }}>{l}</span>
                    <span style={{ textAlign: "center", color: d === "↑" ? T.green : d === "↓" ? T.red : T.textDim }}>{d}</span>
                    <span style={{ textAlign: "right", color: T.text, fontWeight: 600 }}>{v}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const MULTI_CHART_LAYOUTS = {
  "1x1": { cols: 1, rows: 1, count: 1 },
  "2x2": { cols: 2, rows: 2, count: 4 },
  "2x3": { cols: 3, rows: 2, count: 6 },
  "3x3": { cols: 3, rows: 3, count: 9 },
};

const MINI_CHART_TIMEFRAMES = ["1m", "5m", "15m", "1h", "1D"];
const MINI_CHART_BAR_LIMITS = {
  "1m": 120,
  "5m": 78,
  "15m": 52,
  "1h": 39,
  "1D": 60,
};
const MARKET_CHART_STUDIES = [
  { id: "ema-21", label: "E21" },
  { id: "ema-55", label: "E55" },
  { id: "vwap", label: "VWAP" },
  { id: "rsi-14", label: "RSI" },
  { id: "macd-12-26-9", label: "MACD" },
];
const MAX_MULTI_CHART_SLOTS = Math.max(...Object.values(MULTI_CHART_LAYOUTS).map(layout => layout.count));

const normalizeTickerSymbol = (value) => value?.trim?.().toUpperCase?.() || "";
const DEFAULT_MINI_CHART_STUDIES = ["ema-21", "vwap"];
const normalizeMiniChartStudies = (value) => {
  const allowed = new Set(MARKET_CHART_STUDIES.map(study => study.id));
  if (!Array.isArray(value)) {
    return [...DEFAULT_MINI_CHART_STUDIES];
  }
  return value.filter(studyId => allowed.has(studyId));
};

const buildDefaultMiniChartSymbols = (activeSym, count = MAX_MULTI_CHART_SLOTS) => {
  const seed = normalizeTickerSymbol(activeSym) || WATCHLIST[0]?.sym || "SPY";
  const watchlistSymbols = WATCHLIST
    .map(item => normalizeTickerSymbol(item.sym))
    .filter(Boolean);
  const ordered = [seed, ...watchlistSymbols.filter(symbol => symbol !== seed)];

  return Array.from({ length: count }, (_, index) => ordered[index] || ordered[index % ordered.length] || seed);
};

const hydrateMiniChartSlot = (slot, fallbackTicker) => ({
  ticker: normalizeTickerSymbol(slot?.ticker) || fallbackTicker || WATCHLIST[0]?.sym || "SPY",
  tf: MINI_CHART_TIMEFRAMES.includes(slot?.tf) ? slot.tf : "15m",
  studies: normalizeMiniChartStudies(slot?.studies),
});

const buildInitialMiniChartSlots = (activeSym) => {
  const persisted = Array.isArray(_initialState.marketGridSlots) ? _initialState.marketGridSlots : [];
  const defaults = buildDefaultMiniChartSymbols(activeSym, MAX_MULTI_CHART_SLOTS);
  return defaults.map((fallbackTicker, index) => hydrateMiniChartSlot(persisted[index], fallbackTicker));
};

const MiniChartTickerSearch = ({ open, ticker, onClose, onSelectTicker }) => {
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim());
  const searchEnabled = open && deferredQuery.length >= 1;
  const quickPicks = useMemo(
    () => Array.from(new Set([
      normalizeTickerSymbol(ticker),
      ...WATCHLIST.map(item => normalizeTickerSymbol(item.sym)),
    ])).filter(Boolean).slice(0, 8),
    [ticker],
  );
  const searchQuery = useSearchUniverseTickers(
    searchEnabled
      ? {
          search: deferredQuery,
          market: "stocks",
          active: true,
          limit: 8,
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
  const results = searchQuery.data?.results || [];

  useEffect(() => {
    if (!open) {
      setQuery("");
      return undefined;
    }

    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });

    return () => cancelAnimationFrame(frame);
  }, [open, ticker]);

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
      if (event.key === "Enter" && results[0]) {
        onSelectTicker?.(results[0]);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose, onSelectTicker, results]);

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
      <div style={{
        background: T.bg2,
        border: `1px solid ${T.border}`,
        borderRadius: dim(6),
        boxShadow: "0 18px 36px rgba(0,0,0,0.32)",
        overflow: "hidden",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: sp(6), padding: sp("8px 8px 6px"), borderBottom: `1px solid ${T.border}` }}>
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`Search Massive universe for ${ticker}…`}
            style={{
              width: "100%",
              background: T.bg3,
              border: `1px solid ${T.border}`,
              borderRadius: dim(4),
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
        <div style={{ maxHeight: dim(180), overflowY: "auto", background: T.bg1 }}>
          {!searchEnabled && quickPicks.map((symbol) => {
            const info = DEFAULT_WATCHLIST_BY_SYMBOL[symbol];
            return (
              <button
                key={symbol}
                onClick={() => onSelectTicker?.({ ticker: symbol, name: info?.name || symbol })}
                style={{
                  width: "100%",
                  display: "grid",
                  gridTemplateColumns: "64px 1fr auto",
                  gap: sp(8),
                  alignItems: "center",
                  padding: sp("8px 10px"),
                  background: "transparent",
                  border: "none",
                  borderBottom: `1px solid ${T.border}20`,
                  textAlign: "left",
                  cursor: "pointer",
                }}
              >
                <span style={{ fontSize: fs(10), fontWeight: 700, fontFamily: T.mono, color: T.text }}>{symbol}</span>
                <span style={{ minWidth: 0, fontSize: fs(9), color: T.textSec, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {info?.name || "Watchlist symbol"}
                </span>
                <span style={{ fontSize: fs(8), color: T.textMuted, fontFamily: T.mono }}>quick</span>
              </button>
            );
          })}
          {searchEnabled && searchQuery.isPending && (
            <div style={{ padding: sp("12px 10px"), fontSize: fs(9), color: T.textDim, fontFamily: T.sans }}>
              Searching Massive ticker universe…
            </div>
          )}
          {searchEnabled && !searchQuery.isPending && !results.length && (
            <div style={{ padding: sp("12px 10px"), fontSize: fs(9), color: T.textDim, fontFamily: T.sans }}>
              No active stock tickers matched "{deferredQuery}".
            </div>
          )}
          {results.map((result) => (
            <button
              key={`${result.market}-${result.ticker}`}
              onClick={() => onSelectTicker?.(result)}
              style={{
                width: "100%",
                display: "grid",
                gridTemplateColumns: "64px 1fr auto",
                gap: sp(8),
                alignItems: "center",
                padding: sp("8px 10px"),
                background: "transparent",
                border: "none",
                borderBottom: `1px solid ${T.border}20`,
                textAlign: "left",
                cursor: "pointer",
              }}
            >
              <span style={{ fontSize: fs(10), fontWeight: 700, fontFamily: T.mono, color: T.text }}>{result.ticker}</span>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: "block", fontSize: fs(9), color: T.textSec, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{result.name}</span>
                <span style={{ display: "block", fontSize: fs(8), color: T.textDim, fontFamily: T.mono }}>
                  {[result.type, result.primaryExchange].filter(Boolean).join(" · ") || "stock"}
                </span>
              </span>
              <span style={{ fontSize: fs(8), color: T.textMuted, fontFamily: T.mono }}>{result.market?.toUpperCase?.() || "US"}</span>
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
  onChangeTicker,
  onChangeTimeframe,
  onChangeStudies,
  isActive,
  dense = false,
}) => {
  const ticker = slot?.ticker || WATCHLIST[0]?.sym || "SPY";
  const tf = MINI_CHART_TIMEFRAMES.includes(slot?.tf) ? slot.tf : "15m";
  const selectedIndicators = normalizeMiniChartStudies(slot?.studies);
  const [searchOpen, setSearchOpen] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const fallbackInfo = DEFAULT_WATCHLIST_BY_SYMBOL[ticker] || WATCHLIST.find(item => item.sym === ticker) || WATCHLIST[0];
  const tfBars = MINI_CHART_BAR_LIMITS[tf] || MINI_CHART_BAR_LIMITS["15m"];
  const barsQuery = useQuery({
    queryKey: ["market-mini-bars", ticker, tf, tfBars],
    queryFn: () => getBarsRequest({
      symbol: ticker,
      timeframe: tf === "1D" ? "1d" : tf,
      limit: tfBars,
    }),
    ...QUERY_DEFAULTS,
  });
  const streamedSourceBars = useMassiveStreamedStockBars({
    symbol: ticker,
    timeframe: tf === "1D" ? "1d" : tf,
    bars: barsQuery.data?.bars,
    enabled: Boolean(ticker),
  });
  const bars = useMemo(
    () => buildMiniChartBarsFromApi(streamedSourceBars),
    [streamedSourceBars],
  );
  const chartModel = useMemo(
    () => buildResearchChartModel({
      bars,
      timeframe: tf === "1D" ? "1d" : tf,
      selectedIndicators,
    }),
    [bars, selectedIndicators, tf],
  );
  const barsStatus = bars.length
    ? "live"
    : barsQuery.isPending
      ? "loading"
      : barsQuery.isError
        ? "offline"
        : "empty";
  const latestBar = bars[bars.length - 1];
  const delayedChartPrice = Number.isFinite(latestBar?.c) ? latestBar.c : null;
  const displayPrice = delayedChartPrice ?? (
    Number.isFinite(quote?.price)
      ? quote.price
      : fallbackInfo?.price ?? null
  );
  const quotePrevClose = Number.isFinite(quote?.prevClose) ? quote.prevClose : null;
  const displayChange = Number.isFinite(displayPrice) && Number.isFinite(quotePrevClose)
    ? displayPrice - quotePrevClose
    : Number.isFinite(quote?.change)
      ? quote.change
      : bars.length > 1
        ? (latestBar?.c ?? 0) - (bars[0]?.o ?? latestBar?.c ?? 0)
        : fallbackInfo?.chg ?? 0;
  const displayPct = Number.isFinite(displayPrice) && Number.isFinite(quotePrevClose) && quotePrevClose !== 0
    ? (displayChange / quotePrevClose) * 100
    : Number.isFinite(quote?.changePercent)
      ? quote.changePercent
      : bars.length > 1 && Number.isFinite(bars[0]?.o) && bars[0].o !== 0
        ? (((latestBar?.c ?? 0) - bars[0].o) / bars[0].o) * 100
        : fallbackInfo?.pct ?? 0;
  const pos = displayChange >= 0;
  const showAdvancedChrome = !dense || isActive || isHovered;
  const formatCellPrice = (value) => (
    typeof value === "number" && Number.isFinite(value)
      ? value.toFixed(value < 10 ? 3 : 2)
      : "—"
  );
  const chartSourceLabel = latestBar?.source === "massive-delayed-stream-derived"
    ? "STREAM"
    : latestBar?.source
      ? "REST"
      : barsStatus.toUpperCase();

  return (
    <div
      onClick={() => onFocus && onFocus(ticker)}
      style={{
        position: "relative",
        height: "100%",
        cursor: "pointer",
        transition: "border-color 0.15s",
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <ResearchChartFrame
        theme={T}
        themeKey={CURRENT_THEME}
        model={chartModel}
        showSurfaceToolbar={false}
        showLegend={false}
        hideTimeScale={false}
        referenceLines={typeof bars[0]?.o === "number"
          ? [{
              price: bars[0].o,
              color: T.textMuted,
              lineWidth: 1,
              axisLabelVisible: false,
              title: "",
            }]
          : []}
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
            changePercent={displayPct}
            statusLabel={barsStatus === "live" ? `Massive ${tf}` : barsStatus}
            timeframe={tf}
            timeframeOptions={MINI_CHART_TIMEFRAMES.map((timeframe) => ({ value: timeframe, label: timeframe }))}
            onChangeTimeframe={(timeframe) => onChangeTimeframe?.(timeframe)}
            onOpenSearch={() => setSearchOpen((current) => !current)}
            dense={!showAdvancedChrome}
            meta={showAdvancedChrome ? {
              open: latestBar?.o,
              high: latestBar?.h,
              low: latestBar?.l,
              close: latestBar?.c,
              volume: latestBar?.v,
              sourceLabel: chartSourceLabel,
            } : null}
          />
        )}
        surfaceTopOverlayHeight={showAdvancedChrome ? 58 : 34}
        surfaceBottomOverlay={showAdvancedChrome ? ((controls) => (
          <ResearchChartWidgetFooter
            theme={T}
            controls={controls}
            studies={MARKET_CHART_STUDIES}
            selectedStudies={selectedIndicators}
            onToggleStudy={(studyId) => {
              const active = selectedIndicators.includes(studyId);
              const next = active
                ? selectedIndicators.filter((value) => value !== studyId)
                : [...selectedIndicators, studyId];
              onChangeStudies?.(next);
            }}
            dense
          />
        )) : null}
        surfaceBottomOverlayHeight={showAdvancedChrome ? 28 : 0}
      />
      <MiniChartTickerSearch
        open={searchOpen}
        ticker={ticker}
        onClose={() => setSearchOpen(false)}
        onSelectTicker={(result) => {
          const nextTicker = normalizeTickerSymbol(result?.ticker);
          if (!nextTicker) {
            return;
          }
          onChangeTicker?.(nextTicker);
          setSearchOpen(false);
        }}
      />
    </div>
  );
};

// ─── MULTI CHART GRID ───
// Configurable grid of mini chart cells. Layout selector + independent ticker ownership per slot.
const MultiChartGrid = ({ activeSym, onSymClick }) => {
  const queryClient = useQueryClient();
  const [layout, setLayout] = useState(_initialState.marketGridLayout || "2x3");
  const [slots, setSlots] = useState(() => buildInitialMiniChartSlots(activeSym));
  const cfg = MULTI_CHART_LAYOUTS[layout] || MULTI_CHART_LAYOUTS["2x3"];
  const defaults = useMemo(
    () => buildDefaultMiniChartSymbols(activeSym, MAX_MULTI_CHART_SLOTS),
    [activeSym],
  );
  const visibleSlots = useMemo(
    () => slots.slice(0, cfg.count),
    [cfg.count, slots],
  );
  const quoteSymbols = useMemo(
    () => Array.from(new Set(visibleSlots.map(slot => slot.ticker).filter(Boolean))).join(","),
    [visibleSlots],
  );
  const streamedSymbols = useMemo(
    () => Array.from(new Set(visibleSlots.map(slot => normalizeTickerSymbol(slot?.ticker)).filter(Boolean))),
    [visibleSlots],
  );
  const gridQuotesQuery = useGetQuoteSnapshots(
    quoteSymbols
      ? { symbols: quoteSymbols }
      : undefined,
    {
      query: {
        enabled: Boolean(quoteSymbols),
        staleTime: 10_000,
        refetchInterval: 10_000,
        retry: false,
      },
    },
  );
  const quotesBySymbol = useMemo(
    () => Object.fromEntries(
      (gridQuotesQuery.data?.quotes || []).map(quote => [normalizeTickerSymbol(quote.symbol), quote]),
    ),
    [gridQuotesQuery.data],
  );

  useMassiveStockAggregateStream({
    symbols: streamedSymbols,
    enabled: streamedSymbols.length > 0,
    onAggregate: (aggregate) => {
      queryClient.invalidateQueries({ queryKey: ["market-mini-bars", aggregate.symbol] });
      queryClient.invalidateQueries({ queryKey: ["/api/quotes/snapshot"] });
    },
  });

  useEffect(() => {
    setSlots((current) => {
      let changed = current.length !== MAX_MULTI_CHART_SLOTS;
      const next = Array.from({ length: MAX_MULTI_CHART_SLOTS }, (_, index) => {
        const hydrated = hydrateMiniChartSlot(current[index], defaults[index]);
        const previous = current[index];
        if (!previous || previous.ticker !== hydrated.ticker || previous.tf !== hydrated.tf) {
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
      marketGridSlots: slots,
    });
  }, [layout, slots]);

  const cellHeight = layout === "1x1" ? dim(360) : layout === "2x2" ? dim(190) : layout === "2x3" ? dim(180) : dim(140);
  const updateSlot = (slotIndex, patch) => {
    setSlots((current) => current.map((slot, index) => (
      index === slotIndex
        ? hydrateMiniChartSlot({ ...slot, ...patch }, defaults[index])
        : slot
    )));
  };

  return (
    <Card noPad style={{ flexShrink: 0, overflow: "visible" }}>
      <div style={{ padding: sp("6px 10px"), borderBottom: `1px solid ${T.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: sp(8) }}>
          <span style={{ fontSize: fs(10), fontWeight: 700, fontFamily: T.display, color: T.textSec, letterSpacing: "0.04em" }}>CHARTS</span>
          <span style={{ fontSize: fs(9), color: T.textMuted, fontFamily: T.mono }}>independent slots · Massive delayed spot · {cfg.count} visible</span>
        </div>
        <div style={{ display: "flex", gap: 2, padding: sp(2), background: T.bg3, borderRadius: dim(4) }}>
          {Object.keys(MULTI_CHART_LAYOUTS).map(key => (
            <button
              key={key}
              onClick={() => setLayout(key)}
              title={`${MULTI_CHART_LAYOUTS[key].count} charts`}
              style={{
                padding: sp("3px 8px"), fontSize: fs(9), fontFamily: T.mono, fontWeight: 700,
                background: layout === key ? T.accent : "transparent",
                color: layout === key ? "#fff" : T.textDim,
                border: "none", borderRadius: dim(3), cursor: "pointer", letterSpacing: "0.04em",
              }}
            >{key}</button>
          ))}
        </div>
      </div>
      {/* Grid */}
      <div style={{
        padding: sp(6),
        display: "grid",
        gridTemplateColumns: `repeat(${cfg.cols}, 1fr)`,
        gridAutoRows: `${cellHeight}px`,
        gap: sp(6),
      }}>
        {visibleSlots.map((slot, index) => (
          <MiniChartCell
            key={`market-chart-slot-${index}`}
            slot={slot}
            quote={quotesBySymbol[slot.ticker]}
            isActive={slot.ticker === activeSym}
            dense={cfg.count > 4}
            onFocus={onSymClick}
            onChangeTicker={(ticker) => updateSlot(index, { ticker })}
            onChangeTimeframe={(tf) => updateSlot(index, { tf })}
            onChangeStudies={(studies) => updateSlot(index, { studies })}
          />
        ))}
      </div>
    </Card>
  );
};


const MarketScreen = ({ sym, onSymClick, symbols = [], researchConfigured = false }) => {
  const [sectorTf, setSectorTf] = useState("1d");
  const { putCall, sectorFlow, tickerFlow, flowStatus } = useLiveMarketFlow(symbols);
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
  const earningsQuery = useGetResearchEarningsCalendar(
    calendarWindow,
    {
      query: {
        enabled: Boolean(researchConfigured && calendarWindow.from && calendarWindow.to),
        staleTime: 300_000,
        refetchInterval: 300_000,
        retry: false,
      },
    },
  );
  const breadth = buildTrackedBreadthSummary();
  const ratesSummary = buildRatesProxySummary();
  const volatilityProxy = MACRO_TICKERS.find(item => item.sym === "VIXY") || MACRO_TICKERS[0];
  const putCallBullish = putCall.total <= 1;
  const putCallMarkerPct = Math.max(8, Math.min(92, (putCall.total / 2) * 100));
  const upPct = breadth.advancePct;
  const downPct = 100 - upPct;
  const analysisLeader = breadth.leader;
  const analysisLaggard = breadth.laggard;
  const newsItems = useMemo(() => {
    const articles = newsQuery.data?.articles || [];
    return articles.map((article) => ({
      id: article.id,
      text: article.title,
      time: formatRelativeTimeShort(article.publishedAt),
      tag: article.tickers?.[0] || article.publisher?.name?.slice(0, 8)?.toUpperCase() || "NEWS",
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
        const leftValue = left.date ? Date.parse(left.date) : Number.POSITIVE_INFINITY;
        const rightValue = right.date ? Date.parse(right.date) : Number.POSITIVE_INFINITY;
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
    ? "live · Massive"
    : newsQuery.isError
      ? "offline"
      : newsQuery.isPending
        ? "loading"
        : "empty";
  const calendarStatusLabel = researchConfigured
    ? (earningsQuery.data?.entries?.length
      ? "earnings · live"
      : earningsQuery.isError
        ? "offline"
        : earningsQuery.isPending
          ? "loading"
          : "empty")
    : "research off";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* ── TICKER RIBBON ── */}
      <div style={{ display: "flex", alignItems: "center", height: dim(26), padding: sp("0 10px"), borderBottom: `1px solid ${T.border}`, gap: sp(10), overflow: "hidden", flexShrink: 0, background: `linear-gradient(to right, ${T.bg1}, ${T.bg2})` }}>
        {MACRO_TICKERS.map(m => {
          const pos = m.chg >= 0;
          return (<div key={m.sym} style={{ display: "flex", alignItems: "center", gap: sp(4), flexShrink: 0 }}>
            <span style={{ fontSize: fs(8), fontWeight: 700, fontFamily: T.mono, color: T.textSec }}>{m.label || m.sym}</span>
            <span style={{ fontSize: fs(9), fontFamily: T.mono, fontWeight: 600, color: T.text }}>{m.price >= 10 ? m.price.toFixed(2) : m.price.toFixed(3)}</span>
            <span style={{ fontSize: fs(8), fontFamily: T.mono, fontWeight: 600, color: pos ? T.green : T.red }}>{pos ? "+" : ""}{m.pct.toFixed(2)}%</span>
            <div style={{ width: dim(1), height: dim(12), background: T.border }} />
          </div>);
        })}
      </div>

      {/* ── SCROLLABLE BODY ── */}
      <div style={{ flex: 1, overflowY: "auto", padding: sp(8), display: "flex", flexDirection: "column", gap: 6 }}>

        {/* ── ROW 1: Index Cards (gauge moved to right rail) ── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 5 }}>
          {INDICES.map(idx => {
            const liveTickerFlow = tickerFlow.find(item => item.sym === idx.sym);
            const callPrem = liveTickerFlow?.calls ?? 0;
            const putPrem = liveTickerFlow?.puts ?? 0;
            const p = idx.chg >= 0;
            const totalPrem = Math.max(callPrem + putPrem, 1);
            const callPct = (callPrem / totalPrem) * 100;
            const putPct = 100 - callPct;
            const flowDir = callPrem - putPrem;
            return (<Card key={idx.sym} style={{ padding: "5px 8px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontSize: fs(10), fontWeight: 700, fontFamily: T.mono, color: T.text }}>{idx.sym}</div>
                <div style={{ width: 44, height: 16 }}>
                  <ResearchSparkline
                    bars={idx.sparkBars}
                    theme={T}
                    themeKey={CURRENT_THEME}
                  />
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: sp(5), marginTop: sp(2) }}>
                <span style={{ fontSize: fs(14), fontWeight: 700, fontFamily: T.mono, color: T.text, lineHeight: 1 }}>{idx.price.toFixed(2)}</span>
                <span style={{ fontSize: fs(8), fontFamily: T.mono, fontWeight: 600, color: p ? T.green : T.red, lineHeight: 1 }}>{p?"▲":"▼"} {p?"+":""}{idx.pct.toFixed(2)}%</span>
              </div>
              {/* Net premium flow bar */}
              <div style={{ marginTop: sp(3), paddingTop: sp(3), borderTop: `1px solid ${T.border}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: fs(7), fontFamily: T.mono, marginBottom: sp(2) }}>
                  <span style={{ color: T.green, fontWeight: 600 }}>C ${callPrem.toFixed(1)}M</span>
                  <span style={{ color: flowDir >= 0 ? T.green : T.red, fontWeight: 700 }}>{flowDir >= 0 ? "+" : ""}${flowDir.toFixed(1)}M</span>
                  <span style={{ color: T.red, fontWeight: 600 }}>P ${putPrem.toFixed(1)}M</span>
                </div>
                <div style={{ display: "flex", height: dim(4), borderRadius: dim(2), overflow: "hidden", background: T.bg3 }}>
                  <div style={{ width: `${callPct}%`, background: T.green, opacity: 0.85 }} />
                  <div style={{ width: `${putPct}%`, background: T.red, opacity: 0.85 }} />
                </div>
              </div>
            </Card>);
          })}
        </div>

        {/* ── ROW 2: Multi-chart grid (replaces big chart + VIX panel) ── */}
        <MultiChartGrid activeSym={sym} onSymClick={onSymClick} />

        {/* ── ROW 3: S&P 500 Equity Heatmap ── */}
        <Card noPad style={{ overflow: "visible", flexShrink: 0 }}>
          <div style={{ padding: sp("6px 10px"), display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: `1px solid ${T.border}` }}>
            <span style={{ fontSize: fs(10), fontWeight: 700, fontFamily: T.display, color: T.textSec }}>S&P 500 Heatmap</span>
            <div style={{ display: "flex", gap: 2 }}>
              {["1d","5d"].map(v => (
                <button key={v} onClick={() => setSectorTf(v)} style={{ padding: sp("2px 7px"), fontSize: fs(8), fontFamily: T.mono, fontWeight: 600, background: sectorTf===v ? T.accentDim : "transparent", border: `1px solid ${sectorTf===v ? T.accent : "transparent"}`, borderRadius: dim(3), color: sectorTf===v ? T.accent : T.textDim, cursor: "pointer" }}>{v.toUpperCase()}</button>
              ))}
            </div>
          </div>
          <TreemapHeatmap data={TREEMAP_DATA} period={sectorTf} onSymClick={onSymClick} />
        </Card>

        {/* Sector ETF Heatmap */}
        <SectorTreemap sectors={SECTORS} period={sectorTf} />

        {/* ── ROW 4: P/C + Yield Curve + Breadth ── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
          <Card style={{ padding: "5px 10px" }}>
            <CardTitle>Put / Call</CardTitle>
            <div style={{ display: "flex", alignItems: "baseline", gap: sp(4), marginBottom: 3 }}>
              <span style={{ fontSize: fs(18), fontWeight: 800, fontFamily: T.mono, color: T.text }}>{putCall.total.toFixed(2)}</span>
              <span style={{ fontSize: fs(8), fontFamily: T.mono, color: putCallBullish ? T.green : T.red }}>
                {putCallBullish ? "▼" : "▲"} {Math.abs(putCall.total - 1).toFixed(2)}
              </span>
              <span style={{ fontSize: fs(7), color: T.textMuted }}>neutral 1.00</span>
            </div>
            <div style={{ display: "flex", height: dim(6), borderRadius: dim(3), overflow: "hidden", marginBottom: 4 }}>
              <div style={{ flex: 1, background: `linear-gradient(to right, ${T.red}, ${T.amber})` }} />
              <div style={{ flex: 1, background: `linear-gradient(to right, ${T.amber}, ${T.green})` }} />
            </div>
            <div style={{ position: "relative", height: dim(5), marginTop: -3 }}><div style={{ position: "absolute", left: `${putCallMarkerPct}%`, transform: "translateX(-50%)", borderLeft: "3px solid transparent", borderRight: "3px solid transparent", borderBottom: `4px solid ${T.text}` }} /></div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: sp(3), fontSize: fs(8), fontFamily: T.mono }}>
              <span style={{ color: T.textMuted }}>Eq <span style={{ color: T.textSec }}>{putCall.equities.toFixed(2)}</span></span>
              <span style={{ color: T.textMuted }}>Idx <span style={{ color: T.textSec }}>{putCall.indices.toFixed(2)}</span></span>
              <span style={{ color: T.textMuted }}>Tot <span style={{ color: T.textSec }}>{putCall.total.toFixed(2)}</span></span>
            </div>
          </Card>
          <Card style={{ padding: "5px 10px" }}>
            <CardTitle>Rates Proxies</CardTitle>
            <div style={{ display: "flex", flexDirection: "column", gap: sp(3), minHeight: 72 }}>
              {RATES_PROXIES.map((item) => {
                const pos = item.pct >= 0;
                const width = Math.max(6, Math.min(100, Math.abs(item.pct) * 48));
                return (
                  <div key={item.sym} style={{ display: "grid", gridTemplateColumns: "46px 40px 1fr 40px", alignItems: "center", gap: sp(4), fontSize: fs(7), fontFamily: T.mono }}>
                    <span style={{ color: T.textDim }}>{item.term}</span>
                    <span style={{ color: T.textSec, fontWeight: 600 }}>{item.sym}</span>
                    <div style={{ height: dim(6), position: "relative", background: T.bg3, borderRadius: dim(3) }}>
                      <div style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: `${width}%`, borderRadius: dim(3), background: pos ? T.green : T.red, opacity: 0.85 }} />
                    </div>
                    <span style={{ color: pos ? T.green : T.red, textAlign: "right", fontWeight: 700 }}>{pos ? "+" : ""}{item.pct.toFixed(2)}%</span>
                  </div>
                );
              })}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: fs(7), fontFamily: T.mono }}>
              <span style={{ color: T.textMuted }}>Lead <span style={{ color: T.textSec }}>{ratesSummary.leader?.sym || "—"}</span></span>
              <span style={{ color: T.textMuted }}>Lag <span style={{ color: T.textSec }}>{ratesSummary.laggard?.sym || "—"}</span></span>
            </div>
          </Card>
          <Card style={{ padding: "5px 10px" }}>
            <CardTitle>Breadth</CardTitle>
            <div style={{ display: "flex", alignItems: "center", gap: sp(4), marginBottom: 3 }}>
              <span style={{ fontSize: fs(10), fontFamily: T.mono, fontWeight: 800, color: T.green }}>{breadth.advancers}</span>
              <div style={{ flex: 1, display: "flex", height: dim(7), borderRadius: dim(3), overflow: "hidden" }}><div style={{ width: `${upPct}%`, background: T.green }} /><div style={{ width: `${downPct}%`, background: T.red }} /></div>
              <span style={{ fontSize: fs(10), fontFamily: T.mono, fontWeight: 800, color: T.red }}>{breadth.decliners}</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: sp(1), fontSize: fs(7), fontFamily: T.mono }}>
              {[
                ["Up", `${upPct.toFixed(0)}%`, T.green],
                ["5D+", `${breadth.positive5dPct.toFixed(0)}%`, breadth.positive5dPct >= 50 ? T.green : T.amber],
                ["Unchg", `${breadth.unchanged}`, T.text],
                ["Sectors+", `${breadth.positiveSectors}/${SECTORS.length}`, breadth.positiveSectors >= Math.ceil(SECTORS.length / 2) ? T.green : T.amber],
                ["Lead", breadth.leader?.sym || "—", breadth.leader?.chg >= 0 ? T.green : T.red],
                ["Lag", breadth.laggard?.sym || "—", breadth.laggard?.chg >= 0 ? T.green : T.red],
              ].map(([l,v,c],i)=>(
                <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: sp("1px 3px"), background: i%2===0?`${T.bg3}40`:"transparent", borderRadius: 2 }}><span style={{ color: T.textDim }}>{l}</span><span style={{ color: c, fontWeight: 600 }}>{v}</span></div>
              ))}
            </div>
          </Card>
        </div>

        {/* ── ROW 4.5: Sector Flow (full width, horizontal layout) — sector rotation read ── */}
        <Card style={{ padding: "8px 12px", flexShrink: 0 }}>
          <CardTitle right={<span style={{ fontSize: fs(8), color: flowStatus === "live" ? T.accent : T.textMuted, fontFamily: T.mono }}>{flowStatus === "live" ? "live option premium · today · sector rotation" : `flow ${flowStatus}`}</span>}>Sector Flow</CardTitle>
          {sectorFlow.length ? (() => {
            const absMax = Math.max(1, ...sectorFlow.map(x => Math.abs(x.calls - x.puts)));
            // Sort by net flow magnitude — strongest signals first
            const sorted = [...sectorFlow].map(s => ({ ...s, net: s.calls - s.puts })).sort((a, b) => b.net - a.net);
            const half = Math.ceil(sorted.length / 2);
            const left = sorted.slice(0, half);
            const right = sorted.slice(half);
            const renderBar = (s, i) => {
              const widthPct = (Math.abs(s.net) / absMax) * 50;
              const netStr = (s.net >= 0 ? "+" : "-") + fmtM(Math.abs(s.net));
              return (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "85px 1fr 56px", alignItems: "center", gap: sp(6), marginBottom: sp(3), fontSize: fs(10), fontFamily: T.mono }}>
                  <span style={{ color: T.textSec, fontWeight: 600 }}>{s.sector}</span>
                  <div style={{ position: "relative", height: dim(10), background: T.bg3, borderRadius: dim(2) }}>
                    {/* Center divider */}
                    <div style={{ position: "absolute", top: 0, bottom: 0, left: "50%", width: dim(1), background: T.textMuted, opacity: 0.4 }} />
                    {/* Direction bar */}
                    {s.net >= 0 ? (
                      <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: `${widthPct}%`, background: T.green, opacity: 0.85, borderRadius: `0 ${dim(2)}px ${dim(2)}px 0` }} />
                    ) : (
                      <div style={{ position: "absolute", right: "50%", top: 0, bottom: 0, width: `${widthPct}%`, background: T.red, opacity: 0.85, borderRadius: `${dim(2)}px 0 0 ${dim(2)}px` }} />
                    )}
                  </div>
                  <span style={{ color: s.net >= 0 ? T.green : T.red, fontWeight: 700, textAlign: "right" }}>{netStr}</span>
                </div>
              );
            };
            return (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: sp(20) }}>
                <div>{left.map(renderBar)}</div>
                <div>{right.map(renderBar)}</div>
              </div>
            );
          })() : (
            <DataUnavailableState
              title="No live sector flow"
              detail={flowStatus === "loading"
                ? "Waiting on live options flow snapshots for the tracked market symbols."
                : "Sector rotation is hidden until a live options flow provider returns current data."}
            />
          )}
        </Card>

        {/* ── ROW 5: News + Calendar + AI ── */}
        <div style={{ display: "grid", gridTemplateColumns: "1.4fr 0.7fr 1fr", gap: 6 }}>
          <Card style={{ padding: "6px 10px" }}>
            <CardTitle right={<span style={{ fontSize: fs(7), color: newsStatusLabel === "live · Massive" ? T.accent : T.textDim, fontFamily: T.mono }}>{newsStatusLabel}</span>}>News</CardTitle>
            {newsItems.length ? newsItems.map((item, index) => (
              <div
                key={item.id}
                style={{ display: "flex", gap: sp(5), padding: sp("3px 0"), alignItems: "flex-start", borderBottom: index < newsItems.length - 1 ? `1px solid ${T.border}06` : "none", cursor: item.articleUrl ? "pointer" : "default" }}
                onMouseEnter={e => e.currentTarget.style.background = T.bg3}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                onClick={() => {
                  if (!item.articleUrl || typeof window === "undefined") return;
                  window.open(item.articleUrl, "_blank", "noopener,noreferrer");
                }}
                title={item.publisher || undefined}
              >
                <Badge color={T.accent}>{item.tag}</Badge>
                <div style={{ width: dim(4), height: dim(4), borderRadius: "50%", background: item.s === 1 ? T.green : item.s === -1 ? T.red : T.textDim, marginTop: sp(4), flexShrink: 0 }} />
                <span style={{ flex: 1, fontSize: fs(10), color: T.textSec, fontFamily: T.sans, lineHeight: 1.4 }}>{item.text}</span>
                <span style={{ fontSize: fs(8), color: T.textMuted, fontFamily: T.mono, whiteSpace: "nowrap" }}>{item.time}</span>
              </div>
            )) : (
              <DataUnavailableState
                title="No live news feed"
                detail={newsStatusLabel === "loading"
                  ? "Waiting on the live news provider."
                  : "The news card only shows provider-backed headlines now; no authored fallback feed is rendered."}
              />
            )}
          </Card>
          <Card style={{ padding: "6px 10px" }}>
            <CardTitle right={<span style={{ fontSize: fs(7), color: calendarStatusLabel === "earnings · live" ? T.accent : T.textDim, fontFamily: T.mono }}>{calendarStatusLabel}</span>}>Calendar</CardTitle>
            {calendarItems.length ? calendarItems.map((ev, i) => { const tc = ev.type === "fomc" || ev.type === "cpi" ? T.amber : ev.type === "earnings" ? T.green : ev.type === "holiday" ? T.red : T.accent; return (
              <div key={ev.id} style={{ display: "flex", alignItems: "center", gap: sp(4), padding: sp("3px 0"), borderBottom: i < calendarItems.length - 1 ? `1px solid ${T.border}06` : "none" }}>
                <div style={{ width: dim(2), height: dim(16), borderRadius: dim(1), background: tc, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: fs(10), fontWeight: 600, fontFamily: T.sans, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ev.label}</div><div style={{ fontSize: fs(8), color: T.textMuted, fontFamily: T.mono }}>{ev.date}</div></div>
              </div>);}) : (
                <DataUnavailableState
                  title="No live calendar data"
                  detail={calendarStatusLabel === "loading"
                    ? "Waiting on the earnings calendar provider."
                    : researchConfigured
                      ? "The calendar is empty because no live entries were returned for the current window."
                      : "Research calendar access is not configured for this environment."}
                />
              )}
          </Card>
          <Card style={{ display: "flex", flexDirection: "column", padding: "6px 10px" }}>
            <CardTitle right={<Badge color={T.purple}>AI</Badge>}>Analysis</CardTitle>
            <div style={{ flex: 1, fontSize: fs(10), fontFamily: T.sans, color: T.textSec, lineHeight: 1.5, padding: sp("5px 8px"), background: T.bg0, borderRadius: dim(4), border: `1px solid ${T.border}` }}>
              <span style={{ color: volatilityProxy?.pct <= 0 ? T.green : T.amber }}>▸</span> {volatilityProxy?.label || "Volatility"} proxy {volatilityProxy?.pct >= 0 ? "firming" : "easing"} at {volatilityProxy?.price?.toFixed?.(2) || "—"}; flow is strongest in {analysisLeader?.sym || "—"} and weakest in {analysisLaggard?.sym || "—"}.{"\n\n"}
              <span style={{ color: breadth.advancePct >= 55 ? T.green : T.amber }}>▸</span> Tracked breadth is {breadth.advancers}/{breadth.total} green with {breadth.positive5dPct.toFixed(0)}% of names positive over 5 sessions.{"\n\n"}
              <span style={{ color: T.accent }}>▸</span> Treasury proxies are led by {ratesSummary.leader?.sym || "—"} and lagged by {ratesSummary.laggard?.sym || "—"}; keep the tape read anchored to live ETF proxies until direct index and futures entitlements are enabled.
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

  // Esc to close (same UX as drawer)
  useEffect(() => {
    const onKey = e => { if (e.key === "Escape") onBack(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onBack]);

  if (!evt) return null;
  const history = genContractPrintHistory(evt);
  const isCall = evt.cp === "C";

  const lastPrice = history.optPath[history.optPath.length - 1];
  const firstPrice = history.optPath[0];
  const dayChange = lastPrice - firstPrice;
  const dayChangePct = (dayChange / firstPrice) * 100;
  const changeColor = dayChange >= 0 ? T.green : T.red;

  const voi = evt.vol / evt.oi;
  const voiColor = voi > 5 ? T.red : voi > 2 ? T.amber : T.textDim;
  const voiFlag = voi > 5 ? "🔥" : voi > 2 ? "⚠" : "";
  const askPct = history.askPct;
  const bidPct = history.bidPct;
  const buyPressure = askPct;
  const verdict = buyPressure >= 70 ? "AGGRESSIVE BUYING"
    : buyPressure >= 55 ? "BUY PRESSURE"
    : buyPressure >= 45 ? "BALANCED"
    : buyPressure >= 30 ? "SELL PRESSURE"
    : "AGGRESSIVE SELLING";
  const verdictColor = buyPressure >= 55 ? T.green : buyPressure >= 45 ? T.amber : T.red;

  const maxBarVol = Math.max(...history.bins.map(b => b.ask + b.bid + b.mid), 1);
  const minPrice = Math.min(...history.optPath);
  const maxPrice = Math.max(...history.optPath);

  // Helpers to keep the stats grid compact + consistent
  const Stat = ({ label, value, color, bg }) => (
    <div style={{ display: "flex", alignItems: "center", gap: sp(3), padding: sp("3px 6px"), background: bg || T.bg3, borderRadius: dim(3) }}>
      <span style={{ color: T.textMuted, fontSize: fs(9), fontFamily: T.mono }}>{label}</span>
      <span style={{ color: color || T.text, fontWeight: 700, marginLeft: "auto", fontSize: fs(11), fontFamily: T.mono }}>{value}</span>
    </div>
  );

  return (
    <div style={{ animation: "fadeIn 0.15s ease-out" }}>
      {/* ── HEADER: back button · title · price · actions ── */}
      <div style={{
        display: "flex", alignItems: "center", gap: sp(8),
        padding: sp("8px 12px"), marginBottom: sp(6),
        background: T.bg2, border: `1px solid ${T.border}`, borderRadius: dim(6),
      }}>
        <button
          onClick={onBack}
          title="Back to flow (Esc)"
          style={{
            display: "inline-flex", alignItems: "center", gap: sp(4),
            padding: sp("5px 10px"), background: "transparent",
            border: `1px solid ${T.border}`, borderRadius: dim(4),
            color: T.textSec, fontSize: fs(10), fontWeight: 600, fontFamily: T.sans,
            cursor: "pointer", flexShrink: 0,
          }}
          onMouseEnter={e => { e.currentTarget.style.background = T.bg3; e.currentTarget.style.color = T.text; }}
          onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = T.textSec; }}
        >
          <span style={{ fontSize: fs(12) }}>←</span> Back to flow
        </button>
        <div style={{ width: dim(1), height: dim(22), background: T.border, flexShrink: 0 }} />
        <div style={{ display: "flex", alignItems: "baseline", gap: sp(6), minWidth: 0 }}>
          {evt.golden && <span style={{ color: T.amber, fontSize: fs(14) }}>★</span>}
          <span style={{ fontSize: fs(16), fontWeight: 800, fontFamily: T.display, color: T.text, letterSpacing: "-0.01em", whiteSpace: "nowrap" }}>
            {evt.ticker} {evt.strike} {isCall ? "Call" : "Put"}
          </span>
          <span style={{ fontSize: fs(10), fontFamily: T.mono, color: T.textDim, whiteSpace: "nowrap" }}>Exp {formatExpirationLabel(evt.expirationDate)}</span>
          <span style={{ fontSize: fs(10), fontFamily: T.mono, color: evt.dte <= 1 ? T.red : evt.dte <= 7 ? T.amber : T.textDim, fontWeight: 600 }}>{evt.dte}DTE</span>
          <span style={{ fontSize: fs(10), fontFamily: T.mono, color: evt.type === "SWEEP" ? T.amber : evt.type === "BLOCK" ? T.accent : T.purple, fontWeight: 700, padding: sp("1px 6px"), background: T.bg3, borderRadius: dim(2) }}>
            {evt.type}
          </span>
        </div>
        <span style={{ flex: 1 }} />
        <div style={{ display: "flex", alignItems: "baseline", gap: sp(4), flexShrink: 0 }}>
          <span style={{ fontSize: fs(18), fontWeight: 800, fontFamily: T.mono, color: T.text }}>${lastPrice.toFixed(2)}</span>
          <span style={{ fontSize: fs(10), fontFamily: T.mono, fontWeight: 600, color: changeColor }}>
            {dayChange >= 0 ? "▲" : "▼"} {dayChange >= 0 ? "+" : ""}${dayChange.toFixed(2)} ({dayChange >= 0 ? "+" : ""}{dayChangePct.toFixed(1)}%)
          </span>
        </div>
        <div style={{ width: dim(1), height: dim(22), background: T.border, flexShrink: 0 }} />
        <button
          onClick={() => onJumpToTrade && onJumpToTrade(evt)}
          style={{
            padding: sp("5px 10px"), background: T.accent, color: "#fff",
            border: "none", borderRadius: dim(4), cursor: "pointer",
            fontSize: fs(10), fontWeight: 700, fontFamily: T.sans, flexShrink: 0,
          }}
        >Open in Trade</button>
        <button
          onClick={() => {
            const next = !alertSet;
            setAlertSet(next);
            toast.push({
              kind: next ? "success" : "info",
              title: next ? "Alert set" : "Alert removed",
              body: next
                ? `${evt.ticker} ${evt.strike}${evt.cp} · Notify on next big print (>$100K)`
                : `${evt.ticker} ${evt.strike}${evt.cp} · No longer watching this contract`,
            });
          }}
          style={{
            padding: sp("5px 10px"),
            background: alertSet ? `${T.amber}20` : "transparent",
            color: alertSet ? T.amber : T.textSec,
            border: `1px solid ${alertSet ? T.amber : T.border}`,
            borderRadius: dim(4), cursor: "pointer",
            fontSize: fs(10), fontWeight: 600, fontFamily: T.sans, flexShrink: 0,
          }}
        >🔔 {alertSet ? "Alert active" : "Set alert"}</button>
      </div>

      {/* ── BODY: 2-column grid (stats/read/prints | chart) ── */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 420px) minmax(0, 1fr)", gap: sp(6) }}>

        {/* LEFT: stats + smart money read + print history */}
        <div style={{ display: "flex", flexDirection: "column", gap: sp(6), minWidth: 0 }}>
          {/* Stats grid — 3×3 */}
          <Card style={{ padding: sp(8) }}>
            <div style={{ fontSize: fs(10), fontWeight: 700, fontFamily: T.display, color: T.textSec, letterSpacing: "0.04em", marginBottom: sp(4) }}>CONTRACT STATS</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: sp(2) }}>
              <Stat label="Ask" value={`${(history.askVol / 1000).toFixed(1)}K`} color={T.green} />
              <Stat label="Bid" value={`${(history.bidVol / 1000).toFixed(2)}K`} color={T.red} />
              <Stat label="Mid" value={history.midVol} color={T.textSec} />
              <Stat label="Vol" value={`${(evt.vol / 1000).toFixed(1)}K`} />
              <Stat label="OI" value={`${(evt.oi / 1000).toFixed(1)}K`} />
              <Stat label="V/OI" value={`${voiFlag} ${voi.toFixed(1)}×`} color={voiColor} />
              <Stat label="Prem" value={`$${(evt.premium / 1e6).toFixed(2)}M`} color={T.amber} />
              <Stat label="IV" value={`${(evt.iv * 100).toFixed(1)}%`} color={T.cyan} />
              <Stat label="Type" value={evt.type} color={evt.type === "SWEEP" ? T.amber : evt.type === "BLOCK" ? T.accent : T.purple} />
            </div>
          </Card>

          {/* Smart Money Read */}
          <Card style={{ padding: sp(8) }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: sp(3) }}>
              <span style={{ fontSize: fs(10), fontWeight: 700, fontFamily: T.display, color: T.textSec, letterSpacing: "0.04em" }}>SMART MONEY READ</span>
              <span style={{ fontSize: fs(12), fontWeight: 800, fontFamily: T.mono, color: verdictColor, letterSpacing: "0.04em" }}>{verdict}</span>
            </div>
            <div style={{ display: "flex", height: dim(8), borderRadius: dim(2), overflow: "hidden", background: T.bg3, marginBottom: sp(2) }}>
              <div style={{ width: `${askPct}%`, background: T.green, opacity: 0.9 }} />
              <div style={{ width: `${history.midPct}%`, background: T.textMuted, opacity: 0.6 }} />
              <div style={{ width: `${bidPct}%`, background: T.red, opacity: 0.9 }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: fs(9), fontFamily: T.mono }}>
              <span style={{ color: T.green, fontWeight: 600 }}>Ask {askPct.toFixed(1)}%</span>
              <span style={{ color: T.textMuted }}>Mid {history.midPct.toFixed(1)}%</span>
              <span style={{ color: T.red, fontWeight: 600 }}>Bid {bidPct.toFixed(1)}%</span>
            </div>
          </Card>

          {/* Print History — always visible, scrollable */}
          <Card style={{ padding: 0, display: "flex", flexDirection: "column", flex: 1 }}>
            <div style={{ padding: sp("5px 10px"), borderBottom: `1px solid ${T.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: fs(10), fontWeight: 700, fontFamily: T.display, color: T.textSec, letterSpacing: "0.04em" }}>PRINT HISTORY</span>
              <span style={{ fontSize: fs(9), color: T.textDim, fontFamily: T.mono }}>{history.prints.length} prints today</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "60px 44px 60px 60px 1fr", gap: sp(4), padding: sp("3px 10px"), borderBottom: `1px solid ${T.border}`, fontSize: fs(8), color: T.textMuted, letterSpacing: "0.06em", fontWeight: 600 }}>
              <span>TIME</span>
              <span>HIT</span>
              <span style={{ textAlign: "right" }}>SIZE</span>
              <span style={{ textAlign: "right" }}>PRICE</span>
              <span style={{ textAlign: "right" }}>PREMIUM</span>
            </div>
            <div style={{ maxHeight: dim(210), overflowY: "auto", padding: sp("0 10px") }}>
              {history.prints.slice().reverse().map(p => {
                const hitColor = p.hitSide === "ASK" ? T.green : p.hitSide === "BID" ? T.red : T.textMuted;
                return (
                  <div key={p.id} style={{ display: "grid", gridTemplateColumns: "60px 44px 60px 60px 1fr", gap: sp(4), padding: sp("2px 0"), fontSize: fs(9), fontFamily: T.mono, borderBottom: `1px solid ${T.border}08` }}>
                    <span style={{ color: T.textDim }}>{p.time}</span>
                    <span style={{ color: hitColor, fontWeight: 700 }}>{p.hitSide}</span>
                    <span style={{ color: T.textSec, textAlign: "right" }}>{p.size.toLocaleString()}</span>
                    <span style={{ color: T.text, textAlign: "right" }}>${p.price.toFixed(2)}</span>
                    <span style={{ color: p.premium > 100000 ? T.amber : T.textSec, fontWeight: p.premium > 100000 ? 700 : 400, textAlign: "right" }}>
                      {p.premium >= 1e6 ? `$${(p.premium/1e6).toFixed(2)}M` : `$${(p.premium/1000).toFixed(0)}K`}
                    </span>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>

        {/* RIGHT: intraday chart */}
        <Card style={{ padding: sp(10), display: "flex", flexDirection: "column", minWidth: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: sp(5) }}>
            <span style={{ fontSize: fs(10), fontWeight: 700, fontFamily: T.display, color: T.textSec, letterSpacing: "0.04em" }}>INTRADAY ACTIVITY</span>
            <div style={{ display: "flex", gap: sp(10), fontSize: fs(9), fontFamily: T.mono, color: T.textDim }}>
              <span><span style={{ color: T.amber }}>━</span> price</span>
              <span><span style={{ color: T.green }}>▮</span> ask</span>
              <span><span style={{ color: T.red }}>▮</span> bid</span>
              <span><span style={{ color: T.textMuted }}>▮</span> mid</span>
            </div>
          </div>
          <div style={{ flex: 1, minHeight: dim(420) }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={history.bins} margin={{ top: 4, right: 40, bottom: 18, left: 40 }}>
                <XAxis
                  dataKey="time"
                  tick={{ fontSize: fs(9), fill: T.textMuted, fontFamily: T.mono }}
                  axisLine={{ stroke: T.border }}
                  tickLine={false}
                  interval={11}
                />
                <YAxis
                  yAxisId="vol"
                  orientation="left"
                  tick={{ fontSize: fs(9), fill: T.textMuted, fontFamily: T.mono }}
                  axisLine={false} tickLine={false}
                  domain={[0, maxBarVol * 1.15]}
                  tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(0)}K` : v}
                />
                <YAxis
                  yAxisId="price"
                  orientation="right"
                  tick={{ fontSize: fs(9), fill: T.amber, fontFamily: T.mono, fontWeight: 600 }}
                  axisLine={false} tickLine={false}
                  domain={[minPrice * 0.95, maxPrice * 1.05]}
                  tickFormatter={v => v.toFixed(2)}
                />
                <Tooltip
                  contentStyle={{ background: T.bg2, border: `1px solid ${T.border}`, borderRadius: dim(4), fontSize: fs(9), fontFamily: T.mono }}
                  formatter={(v, name) => {
                    if (name === "optPrice") return [`$${v.toFixed(2)}`, "Price"];
                    if (name === "ask") return [v >= 1000 ? `${(v/1000).toFixed(1)}K` : v, "At ask"];
                    if (name === "bid") return [v >= 1000 ? `${(v/1000).toFixed(1)}K` : v, "At bid"];
                    if (name === "mid") return [v, "At mid"];
                    return [v, name];
                  }}
                />
                <Bar yAxisId="vol" dataKey="ask" stackId="v" fill={T.green} opacity={0.85} maxBarSize={8} isAnimationActive={false} />
                <Bar yAxisId="vol" dataKey="bid" stackId="v" fill={T.red} opacity={0.85} maxBarSize={8} isAnimationActive={false} />
                <Bar yAxisId="vol" dataKey="mid" stackId="v" fill={T.textMuted} opacity={0.6} maxBarSize={8} isAnimationActive={false} />
                <Line
                  yAxisId="price"
                  type="monotone"
                  dataKey="optPrice"
                  stroke={T.amber}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>
    </div>
  );
};

const FlowScreen = ({ onJumpToTrade, symbols = [] }) => {
  // ── Saved scans persisted in localStorage ──
  const [savedScans, setSavedScans] = useState(_initialState.flowSavedScans || []);
  const [activeScanId, setActiveScanId] = useState(null);
  useEffect(() => { persistState({ flowSavedScans: savedScans }); }, [savedScans]);

  const [filter, setFilter] = useState("all");
  const [minPrem, setMinPrem] = useState(0);
  const [sortBy, setSortBy] = useState("time");
  const [selectedEvt, setSelectedEvt] = useState(null);  // currently inspected contract
  const {
    hasLiveFlow,
    flowStatus,
    flowEvents,
    flowTide,
    tickerFlow,
    flowClock,
    sectorFlow,
    dteBuckets,
    marketOrderFlow,
  } = useLiveMarketFlow(symbols);

  // ── CLUSTER DETECTION ──
  // Group prints by (ticker + strike + cp). Any group with 2+ prints = cluster.
  // We surface cluster size + total premium on each row that's part of a cluster.
  const clusters = useMemo(() => {
    const map = {};
    for (const e of flowEvents) {
      const key = e.optionTicker || `${e.ticker}_${e.strike}_${e.cp}_${formatExpirationLabel(e.expirationDate)}`;
      if (!map[key]) map[key] = { count: 0, totalPrem: 0, ids: [], firstTime: e.time, lastTime: e.time };
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
    const key = e.optionTicker || `${e.ticker}_${e.strike}_${e.cp}_${formatExpirationLabel(e.expirationDate)}`;
    const c = clusters[key];
    return c && c.count >= 2 ? c : null;
  };

  // ── TOP CONTRACTS BY VOLUME, per ticker ──
  // For each ticker, group FLOW_EVENTS by (strike + cp), sum volume + premium, pick top 3.
  // Clicking a contract chip opens the Contract Detail Drawer for the biggest print in that group.
  const topContractsByTicker = useMemo(() => {
    const byTicker = {};
    for (const e of flowEvents) {
      if (!byTicker[e.ticker]) byTicker[e.ticker] = {};
      const key = e.optionTicker || `${e.strike}_${e.cp}_${formatExpirationLabel(e.expirationDate)}`;
      if (!byTicker[e.ticker][key]) {
        byTicker[e.ticker][key] = {
          strike: e.strike, cp: e.cp, dte: e.dte,
          vol: 0, premium: 0, count: 0, biggestEvt: e,
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
  const totalCallPrem = flowEvents.filter(e => e.cp === "C").reduce((a, e) => a + e.premium, 0);
  const totalPutPrem = flowEvents.filter(e => e.cp === "P").reduce((a, e) => a + e.premium, 0);
  const netPrem = totalCallPrem - totalPutPrem;
  const goldenCount = flowEvents.filter(e => e.golden).length;
  const blockCount = flowEvents.filter(e => e.type === "BLOCK").length;
  const sweepCount = flowEvents.filter(e => e.type === "SWEEP").length;
  const zeroDteCount = flowEvents.filter(e => e.dte <= 1).length;
  const zeroDtePrem = flowEvents.filter(e => e.dte <= 1).reduce((a, e) => a + e.premium, 0);
  const cpRatio = totalCallPrem ? (totalPutPrem / totalCallPrem) : 0;
  const mostActive = [...tickerFlow].sort((a, b) => (b.calls + b.puts) - (a.calls + a.puts))[0] || { sym: "—", calls: 0, puts: 0 };

  // ── SMART MONEY COMPASS ──
  // Institutional bias = net premium from XL trades (>$250K) on calls vs puts.
  // Score range -100 (max bearish) to +100 (max bullish).
  const xlTrades = flowEvents.filter(e => e.premium >= 250000);
  const xlCallPrem = xlTrades.filter(e => e.cp === "C" && e.side === "BUY").reduce((s, e) => s + e.premium, 0)
                    - xlTrades.filter(e => e.cp === "C" && e.side === "SELL").reduce((s, e) => s + e.premium, 0);
  const xlPutPrem = xlTrades.filter(e => e.cp === "P" && e.side === "BUY").reduce((s, e) => s + e.premium, 0)
                   - xlTrades.filter(e => e.cp === "P" && e.side === "SELL").reduce((s, e) => s + e.premium, 0);
  const xlNet = xlCallPrem - xlPutPrem;
  const xlTotalAbs = Math.abs(xlCallPrem) + Math.abs(xlPutPrem) || 1;
  const compassScore = Math.round((xlNet / xlTotalAbs) * 100); // -100 to +100
  const compassVerdict = compassScore >= 50 ? "BULLISH" : compassScore >= 20 ? "LEAN BULL"
    : compassScore >= -20 ? "NEUTRAL" : compassScore >= -50 ? "LEAN BEAR" : "BEARISH";
  const compassColor = compassScore >= 20 ? T.green : compassScore >= -20 ? T.amber : T.red;

  // Filter + sort
  let filtered = flowEvents.filter(e => {
    if (filter === "calls") return e.cp === "C";
    if (filter === "puts") return e.cp === "P";
    if (filter === "golden") return e.golden;
    if (filter === "sweep") return e.type === "SWEEP";
    if (filter === "block") return e.type === "BLOCK";
    if (filter === "cluster") return clusterFor(e) !== null;  // new: clusters-only filter
    return true;
  }).filter(e => e.premium >= minPrem);
  if (sortBy === "premium") filtered = [...filtered].sort((a, b) => b.premium - a.premium);
  else if (sortBy === "score") filtered = [...filtered].sort((a, b) => b.score - a.score);

  const maxTickerPrem = Math.max(1, ...tickerFlow.map(t => t.calls + t.puts));

  if (!flowEvents.length) {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", position: "relative" }}>
        <div style={{ flex: 1, overflowY: "auto", padding: sp(8), display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: sp("2px 2px 0"), fontSize: fs(8), fontFamily: T.mono, color: T.textDim }}>
            <span>Live options flow only</span>
            <span style={{ color: flowStatus === "loading" ? T.accent : T.textMuted }}>{flowStatus}</span>
          </div>
          <Card style={{ padding: sp(10), minHeight: dim(220), display: "flex", alignItems: "center", justifyContent: "center" }}>
            <DataUnavailableState
              title="No live options flow"
              detail={flowStatus === "loading"
                ? "Waiting on current options flow snapshots for the tracked symbols."
                : "The flow workspace no longer renders synthetic sweeps or blocks. It will populate when the live provider returns actual prints."}
            />
          </Card>
        </div>
      </div>
    );
  }

  // ── SAVED SCAN HELPERS ──
  const saveCurrentScan = () => {
    const name = prompt("Name this scan:", filter === "golden" ? "★ Golden plays" : filter === "block" ? "Block trades" : `${filter} ≥${(minPrem/1000)|0}K`);
    if (!name) return;
    const newScan = { id: Date.now(), name, filter, minPrem, sortBy };
    setSavedScans(s => [...s, newScan].slice(-8));  // cap at 8
    setActiveScanId(newScan.id);
  };
  const loadScan = (scan) => {
    setFilter(scan.filter); setMinPrem(scan.minPrem); setSortBy(scan.sortBy);
    setActiveScanId(scan.id);
  };
  const deleteScan = (id) => {
    setSavedScans(s => s.filter(x => x.id !== id));
    if (activeScanId === id) setActiveScanId(null);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", position: "relative" }}>
      <div style={{ flex: 1, overflowY: "auto", padding: sp(8), display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: sp("2px 2px 0"), fontSize: fs(8), fontFamily: T.mono, color: T.textDim }}>
          <span>{hasLiveFlow ? "Massive snapshot-derived options activity" : "Live options flow only"}</span>
          <span style={{ color: hasLiveFlow ? T.accent : T.textMuted }}>{hasLiveFlow ? "provider-backed" : flowStatus}</span>
        </div>

        {/* ── ROW 1: KPI Bar ── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6 }}>
          {[
            { label: "TOTAL PREMIUM", value: fmtM(totalCallPrem + totalPutPrem), sub: `${flowEvents.length} prints`, color: T.text },
            { label: "NET PREMIUM", value: (netPrem >= 0 ? "+" : "") + fmtM(Math.abs(netPrem)), sub: cpRatio < 1 ? "Bullish" : "Bearish", color: netPrem >= 0 ? T.green : T.red },
            { label: "P/C RATIO", value: cpRatio.toFixed(2), sub: cpRatio < 0.7 ? "Greed" : cpRatio < 1 ? "Neutral" : "Fear", color: cpRatio < 0.7 ? T.green : cpRatio < 1 ? T.amber : T.red },
            { label: "★ GOLDEN SWEEPS", value: goldenCount, sub: "High conv.", color: T.amber },
            { label: "⚡ 0DTE", value: zeroDteCount, sub: fmtM(zeroDtePrem), color: T.cyan },
            { label: "MOST ACTIVE", value: mostActive.sym, sub: fmtM(mostActive.calls + mostActive.puts), color: T.purple },
          ].map((k, i) => (
            <Card key={i} style={{ padding: "5px 9px" }}>
              <div style={{ fontSize: fs(7), fontWeight: 600, color: T.textDim, letterSpacing: "0.06em", fontVariant: "all-small-caps", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", lineHeight: 1 }}>{k.label}</div>
              <div style={{ fontSize: fs(18), fontWeight: 800, fontFamily: T.mono, color: k.color, marginTop: sp(2), lineHeight: 1 }}>{k.value}</div>
              <div style={{ fontSize: fs(8), color: T.textDim, fontFamily: T.sans, marginTop: sp(1), lineHeight: 1 }}>{k.sub}</div>
            </Card>
          ))}
          {/* ── SMART MONEY COMPASS ── institutional bias gauge from XL trades */}
          <Card style={{ padding: "5px 9px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: fs(7), fontWeight: 600, color: T.textDim, letterSpacing: "0.06em", fontVariant: "all-small-caps", whiteSpace: "nowrap", lineHeight: 1 }}>SMART MONEY</span>
              <span style={{ fontSize: fs(7), color: T.textDim, fontFamily: T.mono }}>{xlTrades.length} XL</span>
            </div>
            {/* Bias gauge: half-circle with needle pointing to institutional direction */}
            <div style={{ position: "relative", width: "100%", height: dim(28), marginTop: sp(2) }}>
              <svg width="100%" height="100%" viewBox="0 0 100 36" preserveAspectRatio="xMidYMid meet">
                {/* Track segments: red (bearish), amber (neutral), green (bullish) */}
                <path d="M 8 30 A 28 28 0 0 1 36 6" fill="none" stroke={T.red} strokeWidth="3.5" opacity="0.65" />
                <path d="M 36 6 A 28 28 0 0 1 64 6" fill="none" stroke={T.amber} strokeWidth="3.5" opacity="0.65" />
                <path d="M 64 6 A 28 28 0 0 1 92 30" fill="none" stroke={T.green} strokeWidth="3.5" opacity="0.65" />
                {/* Needle: angle in degrees, -90° (left/bearish) to +90° (right/bullish) */}
                {(() => {
                  const angle = (compassScore / 100) * 90; // -90 to +90
                  const rad = (angle - 90) * Math.PI / 180;
                  const cx = 50, cy = 30, len = 22;
                  const x2 = cx + len * Math.cos(rad);
                  const y2 = cy + len * Math.sin(rad);
                  return (
                    <>
                      <line x1={cx} y1={cy} x2={x2} y2={y2} stroke={compassColor} strokeWidth="2" strokeLinecap="round" />
                      <circle cx={cx} cy={cy} r="2.2" fill={compassColor} />
                    </>
                  );
                })()}
              </svg>
            </div>
            <div style={{ fontSize: fs(11), fontWeight: 800, fontFamily: T.display, color: compassColor, marginTop: sp(1), letterSpacing: "0.04em" }}>{compassVerdict}</div>
            <div style={{ fontSize: fs(8), color: T.textDim, fontFamily: T.mono, marginTop: 1 }}>{compassScore >= 0 ? "+" : ""}{compassScore} bias</div>
          </Card>
        </div>

        {/* ── ROW 2: Premium Tide + Ticker Flow Leaderboard ── */}
        <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 6 }}>
          {/* Premium Tide Chart */}
          <div style={{ background: T.bg2, border: `1px solid ${T.border}`, borderRadius: dim(6), padding: sp("8px 10px"), overflow: "hidden" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <span style={{ fontSize: fs(10), fontWeight: 700, fontFamily: T.display, color: T.textSec }}>Premium Tide · Intraday</span>
              <div style={{ display: "flex", gap: sp(8), fontSize: fs(9), fontFamily: T.mono }}>
                <span style={{ color: T.green }}>■ Calls {fmtM(totalCallPrem)}</span>
                <span style={{ color: T.red }}>■ Puts {fmtM(totalPutPrem)}</span>
                <span style={{ color: T.accent, fontWeight: 700 }}>Net {netPrem >= 0 ? "+" : ""}{fmtM(Math.abs(netPrem))}</span>
              </div>
            </div>
            <div style={{ height: dim(200), width: "100%" }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={flowTide}>
                  <XAxis dataKey="time" tick={{ fontSize: fs(9), fill: T.textMuted }} />
                  <YAxis tick={{ fontSize: fs(9), fill: T.textMuted }} tickFormatter={v => `${(v/1e6).toFixed(1)}M`} />
                  <Tooltip contentStyle={{ background: T.bg4, border: `1px solid ${T.border}`, borderRadius: dim(6), fontSize: fs(10), fontFamily: T.mono }}
                    formatter={(v) => `${v >= 0 ? "+" : ""}$${(v/1e6).toFixed(2)}M`} />
                  <ReferenceLine y={0} stroke={T.textMuted} strokeDasharray="2 2" />
                  <Area type="monotone" dataKey="cumNet" stroke={T.accent} strokeWidth={2} fill={T.accent} fillOpacity={0.4} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Ticker Flow Leaderboard with top contracts per ticker */}
          <Card style={{ padding: "8px 10px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <span style={{ fontSize: fs(10), fontWeight: 700, fontFamily: T.display, color: T.textSec }}>Top Tickers by Flow</span>
              <span style={{ fontSize: fs(8), color: T.textDim, fontFamily: T.mono }}>Top 3 contracts · click to inspect</span>
            </div>
            {tickerFlow.map(t => {
              const total = t.calls + t.puts;
              const net = t.calls - t.puts;
              const callPct = (t.calls / total) * 100;
              const barW = (total / maxTickerPrem) * 100;
              const topContracts = topContractsByTicker[t.sym] || [];
              return (
                <div key={t.sym} style={{ marginBottom: sp(6), paddingBottom: sp(4), borderBottom: `1px solid ${T.border}30` }}>
                  {/* Ticker row: symbol + net premium */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: fs(9), fontFamily: T.mono, marginBottom: sp(1) }}>
                    <span style={{ fontWeight: 700, color: T.text }}>{t.sym}</span>
                    <span style={{ color: net >= 0 ? T.green : T.red, fontWeight: 600 }}>
                      {net >= 0 ? "+" : "-"}{fmtM(Math.abs(net))}
                    </span>
                  </div>
                  {/* Call/put ratio bar */}
                  <div style={{ display: "flex", height: dim(8), borderRadius: dim(2), overflow: "hidden", background: T.bg3, width: `${barW}%`, marginBottom: sp(3) }}>
                    <div style={{ width: `${callPct}%`, background: T.green, height: "100%" }} />
                    <div style={{ flex: 1, background: T.red, height: "100%" }} />
                  </div>
                  {/* Top 3 contracts by volume */}
                  {topContracts.length > 0 && (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: sp(3) }}>
                      {topContracts.map((c, i) => {
                        const cpColor = c.cp === "C" ? T.green : T.red;
                        const volStr = c.vol >= 1000 ? `${(c.vol/1000).toFixed(1)}K` : `${c.vol}`;
                        return (
                          <div
                            key={i}
                            onClick={() => setSelectedEvt(prev => prev && prev.id === c.biggestEvt.id ? null : c.biggestEvt)}
                            title={`${t.sym} ${c.strike}${c.cp} · ${c.count} print${c.count === 1 ? "" : "s"} · ${fmtM(c.premium)} premium · ${volStr} vol`}
                            style={{
                              display: "flex", alignItems: "center", gap: sp(4),
                              padding: sp("4px 6px"),
                              background: `${cpColor}08`,
                              border: `1px solid ${cpColor}30`,
                              borderLeft: `2px solid ${cpColor}`,
                              borderRadius: dim(2),
                              cursor: "pointer",
                              transition: "background 0.1s, transform 0.1s",
                            }}
                            onMouseEnter={e => { e.currentTarget.style.background = `${cpColor}16`; e.currentTarget.style.transform = "translateY(-1px)"; }}
                            onMouseLeave={e => { e.currentTarget.style.background = `${cpColor}08`; e.currentTarget.style.transform = "translateY(0)"; }}
                          >
                            <span style={{ fontSize: fs(10), fontWeight: 800, fontFamily: T.mono, color: cpColor, lineHeight: 1 }}>
                              {c.cp}{c.strike}
                            </span>
                            <div style={{ flex: 1, display: "flex", justifyContent: "space-between", fontSize: fs(8), fontFamily: T.mono, color: T.textDim, lineHeight: 1 }}>
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
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
          {/* Flow Clock */}
          <div style={{ background: T.bg2, border: `1px solid ${T.border}`, borderRadius: dim(6), padding: "6px 10px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <span style={{ fontSize: fs(10), fontWeight: 700, fontFamily: T.display, color: T.textSec }}>Flow Clock</span>
              <span style={{ fontSize: fs(8), color: T.textDim, fontFamily: T.mono }}>Activity by time</span>
            </div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: sp(2), height: dim(72), padding: "0 2px" }}>
              {flowClock.map((bucket, i) => {
                const maxCount = Math.max(...flowClock.map(b => b.count), 1);
                const heightPct = (bucket.count / maxCount) * 100;
                const color = bucket.prem > 1500000 ? T.amber : bucket.prem > 1000000 ? T.accent : T.textDim;
                return (
                  <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end", height: "100%" }}>
                    <div style={{ height: `${heightPct}%`, background: color, borderRadius: "2px 2px 0 0", minHeight: 2, opacity: 0.85 }} />
                  </div>
                );
              })}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: fs(7), color: T.textMuted, fontFamily: T.mono, marginTop: sp(2), padding: "0 2px" }}>
              <span>9:30</span><span>12:00</span><span>16:00</span>
            </div>
            <div style={{ marginTop: sp(2), padding: sp("3px 6px"), background: T.bg3, borderRadius: dim(3), fontSize: fs(8), fontFamily: T.mono, color: T.textDim, display: "flex", justifyContent: "space-between" }}>
              <span>Peak: <span style={{ color: T.amber, fontWeight: 600 }}>12:30 ET</span></span>
              <span>Avg: <span style={{ color: T.textSec, fontWeight: 600 }}>21 / 30min</span></span>
            </div>
          </div>

          {/* Order Flow Distribution — moved from Market tab where it was cramped */}
          <div style={{ background: T.bg2, border: `1px solid ${T.border}`, borderRadius: dim(6), padding: "6px 10px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <span style={{ fontSize: fs(10), fontWeight: 700, fontFamily: T.display, color: T.textSec }}>Order Flow</span>
              <span style={{ fontSize: fs(8), color: T.textDim, fontFamily: T.mono }}>$M · by trade size</span>
            </div>
            {(() => {
              const buy = marketOrderFlow.buyXL + marketOrderFlow.buyL + marketOrderFlow.buyM + marketOrderFlow.buyS;
              const sell = marketOrderFlow.sellXL + marketOrderFlow.sellL + marketOrderFlow.sellM + marketOrderFlow.sellS;
              const buyPct = (buy / (buy + sell)) * 100;
              const max = Math.max(marketOrderFlow.buyXL, marketOrderFlow.buyL, marketOrderFlow.buyM, marketOrderFlow.buyS, marketOrderFlow.sellXL, marketOrderFlow.sellL, marketOrderFlow.sellM, marketOrderFlow.sellS, 1);
              return (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: sp(8), marginBottom: sp(2) }}>
                    <OrderFlowDonut flow={marketOrderFlow} size={dim(64)} thickness={dim(10)} />
                    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: sp(2) }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontFamily: T.mono, fontSize: fs(10) }}>
                        <span style={{ color: T.green, fontWeight: 700 }}>${buy.toFixed(0)}M</span>
                        <span style={{ color: T.red, fontWeight: 700 }}>${sell.toFixed(0)}M</span>
                      </div>
                      <div style={{ display: "flex", height: dim(4), borderRadius: dim(2), overflow: "hidden", background: T.bg3 }}>
                        <div style={{ width: `${buyPct}%`, background: T.green, opacity: 0.85 }} />
                        <div style={{ width: `${100 - buyPct}%`, background: T.red, opacity: 0.85 }} />
                      </div>
                      <div style={{ fontSize: fs(8), color: T.textDim, fontFamily: T.mono }}>{buyPct.toFixed(1)}% buy · <span style={{ color: buy >= sell ? T.green : T.red, fontWeight: 600 }}>{buy >= sell ? "BULLISH" : "BEARISH"}</span></div>
                    </div>
                  </div>
                  <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: sp(2) }}>
                    <SizeBucketRow label="XL" buy={marketOrderFlow.buyXL} sell={marketOrderFlow.sellXL} maxValue={max} />
                    <SizeBucketRow label="L"  buy={marketOrderFlow.buyL}  sell={marketOrderFlow.sellL}  maxValue={max} />
                    <SizeBucketRow label="M"  buy={marketOrderFlow.buyM}  sell={marketOrderFlow.sellM}  maxValue={max} />
                    <SizeBucketRow label="S"  buy={marketOrderFlow.buyS}  sell={marketOrderFlow.sellS}  maxValue={max} />
                  </div>
                </>
              );
            })()}
          </div>

          {/* DTE Buckets */}
          <div style={{ background: T.bg2, border: `1px solid ${T.border}`, borderRadius: dim(6), padding: "6px 10px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <span style={{ fontSize: fs(10), fontWeight: 700, fontFamily: T.display, color: T.textSec }}>Expiration Buckets</span>
              <span style={{ fontSize: fs(8), color: T.textDim, fontFamily: T.mono }}>C vs P premium</span>
            </div>
            <div>
              {dteBuckets.map((b, i) => {
                const total = b.calls + b.puts;
                const callPct = (b.calls / total) * 100;
                const maxTotal = Math.max(1, ...dteBuckets.map(x => x.calls + x.puts));
                const barWidth = (total / maxTotal) * 100;
                return (
                  <div key={i} style={{ marginBottom: 2 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: fs(8), fontFamily: T.mono, marginBottom: 1 }}>
                      <span style={{ color: T.textSec, fontWeight: 600 }}>
                        {b.bucket === "0DTE" && <span style={{ color: T.amber, marginRight: 3 }}>⚡</span>}
                        {b.bucket}
                      </span>
                      <span style={{ color: T.textDim }}>{b.count} prints · {fmtM(total)}</span>
                    </div>
                    <div style={{ display: "flex", height: dim(7), borderRadius: dim(2), overflow: "hidden", background: T.bg3, width: `${barWidth}%` }}>
                      <div style={{ width: `${callPct}%`, background: T.green, opacity: 0.85 }} />
                      <div style={{ flex: 1, background: T.red, opacity: 0.85 }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* ── ROW 2C: Top Trades Spotlight (hidden when contract detail is up) ── */}
        {!selectedEvt && (
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: sp(6), marginBottom: sp(4), padding: "0 2px" }}>
            <span style={{ fontSize: fs(10), fontWeight: 700, fontFamily: T.display, color: T.textSec, letterSpacing: "0.02em" }}>Top Trades Today</span>
            <div style={{ flex: 1, height: dim(1), background: T.border }} />
            <span style={{ fontSize: fs(8), color: T.textDim, fontFamily: T.mono }}>sorted by premium</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
            {[...flowEvents].sort((a, b) => b.premium - a.premium).slice(0, 4).map(evt => {
              const sideColor = evt.side === "BUY" ? T.green : evt.side === "SELL" ? T.red : T.textDim;
              const cpColor = evt.cp === "C" ? T.green : T.red;
              const typeColor = evt.type === "SWEEP" ? T.amber : evt.type === "BLOCK" ? T.accent : T.purple;
              const scoreColor = evt.score >= 80 ? T.amber : evt.score >= 60 ? T.green : T.textDim;
              const context = evt.golden ? "Golden sweep · High conviction"
                : evt.type === "BLOCK" ? "Institutional block · Off-exchange"
                : evt.type === "SWEEP" ? "Aggressive multi-exchange sweep"
                : evt.type === "SPLIT" ? "Split fill · Multiple prices"
                : "Multi-leg strategy";
              return (
                <div
                  key={evt.id}
                  onClick={() => setSelectedEvt(prev => prev && prev.id === evt.id ? null : evt)}
                  style={{
                    background: T.bg2, border: `1px solid ${evt.golden ? T.amber : T.border}`,
                    borderRadius: dim(6), padding: sp("6px 10px"),
                    borderLeft: `3px solid ${evt.golden ? T.amber : cpColor}`,
                    position: "relative", cursor: "pointer", transition: "transform 0.1s, box-shadow 0.1s",
                  }}
                  onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-1px)"; e.currentTarget.style.boxShadow = `0 4px 12px ${T.bg0}80`; }}
                  onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "none"; }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 3 }}>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        {evt.golden && <span style={{ color: T.amber, fontSize: fs(11) }}>★</span>}
                        <span style={{ fontSize: fs(14), fontWeight: 800, fontFamily: T.mono, color: T.text }}>{evt.ticker}</span>
                        <span style={{ fontSize: fs(11), fontWeight: 700, fontFamily: T.mono, color: cpColor }}>{evt.cp}{evt.strike}</span>
                      </div>
                      <div style={{ fontSize: fs(8), color: T.textDim, fontFamily: T.mono, marginTop: 1 }}>exp {evt.dte}d · IV {(evt.iv * 100).toFixed(1)}%</div>
                    </div>
                    <Badge color={scoreColor}>{evt.score}</Badge>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: sp(4), marginBottom: 3, flexWrap: "wrap" }}>
                    <span style={{ fontSize: fs(18), fontWeight: 800, fontFamily: T.mono, color: evt.premium > 400000 ? T.amber : T.text }}>
                      {evt.premium >= 1e6 ? `$${(evt.premium/1e6).toFixed(2)}M` : `$${(evt.premium/1e3).toFixed(0)}K`}
                    </span>
                    <Badge color={sideColor}>{evt.side}</Badge>
                    <Badge color={typeColor}>{evt.type}</Badge>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: fs(7), color: T.textDim, fontFamily: T.mono, paddingTop: sp(3), borderTop: `1px solid ${T.border}08` }}>
                    <span>{evt.time} ET</span>
                    <span>Vol {evt.vol.toLocaleString()} / OI {evt.oi.toLocaleString()}</span>
                  </div>
                  <div style={{ fontSize: fs(7), color: T.textMuted, fontFamily: T.sans, fontStyle: "italic", marginTop: 2 }}>{context}</div>
                </div>
              );
            })}
          </div>
        </div>
        )}

        {/* ── ROW 3a: Saved Scans bar (only renders if user has saved any) ── */}
        {savedScans.length > 0 && (
          <div style={{ display: "flex", gap: sp(4), alignItems: "center", flexWrap: "wrap", padding: "2px 0" }}>
            <span style={{ fontSize: fs(8), fontWeight: 700, color: T.textMuted, letterSpacing: "0.08em", marginRight: 2 }}>SAVED</span>
            {savedScans.map(scan => (
              <div key={scan.id} style={{
                display: "inline-flex", alignItems: "center", gap: sp(3),
                padding: sp("3px 6px 3px 8px"), borderRadius: dim(3),
                background: activeScanId === scan.id ? `${T.accent}20` : T.bg2,
                border: `1px solid ${activeScanId === scan.id ? T.accent : T.border}`,
                cursor: "pointer",
              }}
              onClick={() => loadScan(scan)}
              >
                <span style={{ fontSize: fs(9), fontWeight: 600, color: activeScanId === scan.id ? T.accent : T.textSec, fontFamily: T.sans }}>{scan.name}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); deleteScan(scan.id); }}
                  title="Delete scan"
                  style={{ background: "transparent", border: "none", color: T.textMuted, cursor: "pointer", fontSize: fs(11), padding: 0, lineHeight: 1 }}
                >×</button>
              </div>
            ))}
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: fs(8), color: T.textDim, fontFamily: T.mono }}>{savedScans.length} of 8</span>
          </div>
        )}

        {/* ── ROW 3: Filter Bar ── */}
        <div style={{ display: "flex", gap: sp(4), alignItems: "center", flexWrap: "wrap", padding: "2px 0" }}>
          <span style={{ fontSize: fs(7), fontWeight: 600, color: T.textDim, letterSpacing: "0.06em", fontVariant: "all-small-caps" }}>Type</span>
          {[["all","All"],["calls","Calls"],["puts","Puts"],["golden","★ Golden"],["sweep","Sweep"],["block","Block"],["cluster","🔁 Cluster"]].map(([k,l]) => (
            <Pill key={k} active={filter === k} onClick={() => { setFilter(k); setActiveScanId(null); }} color={k === "golden" ? T.amber : k === "cluster" ? T.cyan : undefined}>{l}</Pill>
          ))}
          <div style={{ width: dim(1), height: dim(16), background: T.border, margin: "0 2px" }} />
          <span style={{ fontSize: fs(7), fontWeight: 600, color: T.textDim, letterSpacing: "0.06em", fontVariant: "all-small-caps" }}>Min $</span>
          {[[0,"All"],[50000,"$50K"],[100000,"$100K"],[250000,"$250K"]].map(([v,l]) => (
            <Pill key={v} active={minPrem === v} onClick={() => { setMinPrem(v); setActiveScanId(null); }}>{l}</Pill>
          ))}
          <div style={{ width: dim(1), height: dim(16), background: T.border, margin: "0 2px" }} />
          <span style={{ fontSize: fs(7), fontWeight: 600, color: T.textDim, letterSpacing: "0.06em", fontVariant: "all-small-caps" }}>Sort</span>
          {[["time","Time"],["premium","Premium"],["score","Score"]].map(([k,l]) => (
            <Pill key={k} active={sortBy === k} onClick={() => { setSortBy(k); setActiveScanId(null); }}>{l}</Pill>
          ))}
          <div style={{ width: dim(1), height: dim(16), background: T.border, margin: "0 2px" }} />
          <button
            onClick={saveCurrentScan}
            title="Save current filter as a named scan"
            style={{
              padding: sp("3px 7px"), fontSize: fs(10), fontWeight: 600, fontFamily: T.sans,
              background: "transparent", color: T.accent, border: `1px solid ${T.accent}`,
              borderRadius: dim(3), cursor: "pointer",
            }}
          >+ Save</button>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: fs(9), color: T.textDim, fontFamily: T.mono }}>{filtered.length} / {flowEvents.length}</span>
        </div>

        {/* ── ROW 4: Flow Tape (default) or Contract Detail (when a contract is selected) ── */}
        {selectedEvt ? (
          <ContractDetailInline
            evt={selectedEvt}
            onBack={() => setSelectedEvt(null)}
            onJumpToTrade={(evt) => { setSelectedEvt(null); onJumpToTrade && onJumpToTrade(evt); }}
          />
        ) : (
        <Card noPad style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 300 }}>
          <div style={{
            display: "grid", gridTemplateColumns: "48px 40px 40px 60px 130px 52px 72px 56px 56px 48px 52px 42px",
            padding: sp("6px 10px"), fontSize: fs(8), fontWeight: 700, color: T.textMuted,
            letterSpacing: "0.08em", borderBottom: `1px solid ${T.border}`, gap: sp(3), flexShrink: 0,
          }}>
            <span>TIME</span><span>SIDE</span><span>TYPE</span><span>TICK</span><span>CONTRACT</span>
            <span style={{ textAlign: "right" }}>DTE</span>
            <span style={{ textAlign: "right" }}>PREMIUM</span>
            <span style={{ textAlign: "right" }}>VOL</span>
            <span style={{ textAlign: "right" }}>OI</span>
            <span style={{ textAlign: "right" }}>V/OI</span>
            <span style={{ textAlign: "right" }}>IV</span>
            <span style={{ textAlign: "center" }}>SCORE</span>
          </div>

          <div style={{ flex: 1, overflowY: "auto" }}>
            {filtered.map(evt => {
              const sideColor = evt.side === "BUY" ? T.green : evt.side === "SELL" ? T.red : T.textDim;
              const cpColor = evt.cp === "C" ? T.green : T.red;
              const premStr = evt.premium >= 1e6 ? `$${(evt.premium/1e6).toFixed(2)}M` : `$${(evt.premium/1e3).toFixed(0)}K`;
              const voi = evt.vol / evt.oi;
              const scoreColor = evt.score >= 80 ? T.amber : evt.score >= 60 ? T.green : T.textDim;
              const typeColor = evt.type === "SWEEP" ? T.amber : evt.type === "BLOCK" ? T.accent : T.purple;
              return (
                <div key={evt.id}
                onClick={() => setSelectedEvt(prev => prev && prev.id === evt.id ? null : evt)}
                style={{
                  display: "grid", gridTemplateColumns: "48px 40px 40px 60px 130px 52px 72px 56px 56px 48px 52px 42px",
                  padding: sp("5px 10px"), fontSize: fs(10), fontFamily: T.mono, gap: sp(3), alignItems: "center",
                  borderBottom: `1px solid ${T.border}08`,
                  background: evt.golden ? `${T.amber}10` : "transparent",
                  borderLeft: evt.golden ? `2px solid ${T.amber}` : "2px solid transparent",
                  cursor: "pointer", transition: "background 0.1s",
                }}
                onMouseEnter={e => e.currentTarget.style.background = evt.golden ? `${T.amber}18` : T.bg3}
                onMouseLeave={e => e.currentTarget.style.background = evt.golden ? `${T.amber}10` : "transparent"}>
                  <span style={{ color: T.textDim }}>{evt.time}</span>
                  <Badge color={sideColor}>{evt.side}</Badge>
                  <Badge color={typeColor}>{evt.type}</Badge>
                  <span style={{ fontWeight: 700, color: T.text, display: "flex", alignItems: "center", gap: 3 }}>
                    {evt.golden && <span style={{ color: T.amber, fontSize: fs(10) }}>★</span>}
                    {evt.ticker}
                  </span>
                  <span style={{ color: T.textSec, display: "flex", alignItems: "center", gap: sp(3) }}>
                    <span style={{ color: cpColor, fontWeight: 600, marginRight: 2 }}>{evt.cp}</span>
                    {evt.strike} <span style={{ color: T.textDim }}>{formatExpirationLabel(evt.expirationDate)}</span>
                    {(() => {
                      const c = clusterFor(evt);
                      if (!c) return null;
                      return (
                        <span title={`${c.count} prints on this contract today · total $${(c.totalPrem/1e6).toFixed(2)}M`}
                          style={{
                            display: "inline-flex", alignItems: "center", gap: 1,
                            padding: sp("0px 4px"), borderRadius: dim(2),
                            background: `${T.cyan}20`, border: `1px solid ${T.cyan}50`,
                            color: T.cyan, fontWeight: 700, fontSize: fs(8),
                            fontFamily: T.mono, marginLeft: sp(2),
                          }}>🔁 {c.count}×</span>
                      );
                    })()}
                  </span>
                  <span style={{ textAlign: "right", color: T.textDim }}>{evt.dte}d</span>
                  <span style={{ textAlign: "right", fontWeight: 700, color: evt.premium > 250000 ? T.amber : evt.premium > 100000 ? T.text : T.textSec }}>{premStr}</span>
                  <span style={{ textAlign: "right", color: T.textSec }}>{evt.vol.toLocaleString()}</span>
                  <span style={{ textAlign: "right", color: T.textDim }}>{evt.oi.toLocaleString()}</span>
                  <span style={{ textAlign: "right", color: voi > 1 ? T.amber : T.textDim, fontWeight: voi > 1 ? 600 : 400 }}>{voi.toFixed(2)}</span>
                  <span style={{ textAlign: "right", color: T.textDim }}>{(evt.iv * 100).toFixed(1)}%</span>
                  <span style={{ textAlign: "center" }}><Badge color={scoreColor}>{evt.score}</Badge></span>
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
  { v: "1m",  bars: 78, tag: "1m" },
  { v: "5m",  bars: 78, tag: "5m" },
  { v: "15m", bars: 60, tag: "15m" },
  { v: "1h",  bars: 40, tag: "1h" },
];

// Custom SVG candlestick chart (Recharts has no native candle component).
// Renders OHLC candles with wicks, Y-axis price labels, day-open ref line,
// flow markers as vertical dashed lines, optional drawing layer (horizontal levels),
// and a crosshair with price label on hover.
const CandleChart = ({ bars, markers, drawings, onAddDrawing, drawMode, height }) => {
  const w = 800;
  const H = height || 240;
  const padL = 38, padR = 8, padT = 6, padB = 16;
  const chartW = w - padL - padR;
  const chartH = H - padT - padB;

  const lo = Math.min(...bars.map(b => b.l));
  const hi = Math.max(...bars.map(b => b.h));
  const range = hi - lo;
  const pad = range * 0.05;
  const yMin = lo - pad, yMax = hi + pad;
  const yScale = p => padT + chartH - ((p - yMin) / (yMax - yMin)) * chartH;
  const xScale = i => padL + (i / (bars.length - 1)) * chartW;
  const candleW = Math.max(2, (chartW / bars.length) * 0.7);

  const [hover, setHover] = useState(null);
  const svgRef = useRef(null);

  const handleMouseMove = (e) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const sx = ((e.clientX - rect.left) / rect.width) * w;
    const sy = ((e.clientY - rect.top) / rect.height) * H;
    if (sx < padL || sx > w - padR) { setHover(null); return; }
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
        style={{ width: "100%", height: "100%", display: "block", cursor: drawMode ? "crosshair" : "default" }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
      >
        {/* Y-axis grid + labels */}
        {yTicks.flatMap((p, i) => [
          <line key={`yg${i}`} x1={padL} y1={yScale(p)} x2={w - padR} y2={yScale(p)} stroke={T.border} strokeWidth={0.5} strokeOpacity={0.5} />,
          <text key={`yt${i}`} x={padL - 4} y={yScale(p) + 3} fill={T.textMuted} fontSize={9} fontFamily={T.mono} textAnchor="end">{p.toFixed(2)}</text>
        ])}
        {/* Day open ref line */}
        <line x1={padL} y1={yScale(dayOpen)} x2={w - padR} y2={yScale(dayOpen)} stroke={T.textMuted} strokeWidth={0.5} strokeDasharray="2 2" />
        {/* Flow markers (vertical) */}
        {(markers || []).map((m, i) => (
          <line
            key={`mk${i}`}
            x1={xScale(m.barIdx)} y1={padT}
            x2={xScale(m.barIdx)} y2={padT + chartH}
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
            <line key={`cw${i}`} x1={x} y1={yScale(b.h)} x2={x} y2={yScale(b.l)} stroke={c} strokeWidth={1} />,
            <rect
              key={`cb${i}`}
              x={x - candleW / 2} y={bodyTop}
              width={candleW} height={Math.max(1, bodyBot - bodyTop)}
              fill={c} stroke={c} strokeWidth={0.5}
            />
          ];
        })}
        {/* Drawings (horizontal levels) */}
        {(drawings || []).map((d, i) => d.type === "horizontal" ? (
          <line
            key={`dr${i}`}
            x1={padL} y1={yScale(d.price)}
            x2={w - padR} y2={yScale(d.price)}
            stroke={T.amber} strokeWidth={1.2} strokeDasharray="5 3"
          />
        ) : null)}
        {/* Crosshair */}
        {hover && [
          <line key="chx" x1={hover.sx} y1={padT} x2={hover.sx} y2={padT + chartH} stroke={T.textSec} strokeWidth={0.5} strokeDasharray="3 3" />,
          <line key="chy" x1={padL} y1={hover.sy} x2={w - padR} y2={hover.sy} stroke={T.textSec} strokeWidth={0.5} strokeDasharray="3 3" />,
          <rect key="chr" x={w - padR - 50} y={hover.sy - 8} width={48} height={16} fill={T.bg4} stroke={T.border} />,
          <text key="cht" x={w - padR - 4} y={hover.sy + 3} fill={T.text} fontSize={9} fontFamily={T.mono} textAnchor="end" fontWeight={600}>{hover.price.toFixed(2)}</text>
        ]}
      </svg>
      {/* OHLCV tooltip */}
      {hover && bars[hover.idx] && (
        <div style={{
          position: "absolute", top: 4, left: padL + 4,
          background: `${T.bg4}ee`, border: `1px solid ${T.border}`, borderRadius: dim(3),
          padding: sp("3px 8px"), fontSize: fs(9), fontFamily: T.mono, color: T.textSec,
          pointerEvents: "none", display: "flex", gap: sp(6),
        }}>
          <span>O <span style={{ color: T.text }}>{bars[hover.idx].o.toFixed(2)}</span></span>
          <span>H <span style={{ color: T.green }}>{bars[hover.idx].h.toFixed(2)}</span></span>
          <span>L <span style={{ color: T.red }}>{bars[hover.idx].l.toFixed(2)}</span></span>
          <span>C <span style={{ color: T.text, fontWeight: 600 }}>{bars[hover.idx].c.toFixed(2)}</span></span>
        </div>
      )}
    </div>
  );
};


const TradeOptionChart = ({ bars, color, contract, holding, timeframe = "5m", sourceLabel = "no live chart data" }) => {
  const chartModel = useMemo(
    () => buildResearchChartModel({
      bars,
      timeframe,
      selectedIndicators: [],
    }),
    [bars, timeframe],
  );
  const referenceLines = useMemo(
    () => (
      Number.isFinite(holding?.entry)
        ? [{
            price: holding.entry,
            color: T.amber,
            title: "ENTRY",
            lineWidth: 2,
            axisLabelVisible: true,
          }]
        : []
    ),
    [holding],
  );
  const lastPrice = bars[bars.length - 1]?.c ?? bars[bars.length - 1]?.p ?? null;

  return (
    <div style={{ height: "100%", width: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: fs(8), fontFamily: T.mono, color: T.textMuted, padding: "2px 6px 0" }}>
        <span>{contract}</span>
        {holding && <span style={{ fontSize: fs(7), padding: sp("1px 4px"), borderRadius: dim(2), background: `${T.amber}20`, color: T.amber, border: `1px solid ${T.amber}40`, fontWeight: 700, letterSpacing: "0.05em" }}>★ HOLDING</span>}
        <span style={{ display: "flex", alignItems: "center", gap: sp(6) }}>
          <span style={{ color: T.textDim }}>{sourceLabel}</span>
          <span style={{ color, fontWeight: 600 }}>{typeof lastPrice === "number" ? `$${lastPrice.toFixed(2)}` : "—"}</span>
        </span>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <ResearchChartSurface
          theme={T}
          themeKey={CURRENT_THEME}
          model={chartModel}
          referenceLines={referenceLines}
        />
      </div>
    </div>
  );
};

const TradeOptionsChain = ({ chain, selected, onSelect, heldStrikes }) => {
  const scrollRef = useRef(null);
  const gridTemplateColumns = "48px 48px 52px 48px 56px 60px 60px 68px 72px 68px 60px 60px 56px 48px 52px 48px 48px";
  const chainWindowKey = `${chain.length}:${chain[0]?.k ?? "na"}:${chain[chain.length - 1]?.k ?? "na"}`;

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return undefined;

    const frame = requestAnimationFrame(() => {
      node.scrollLeft = Math.max(0, (node.scrollWidth - node.clientWidth) / 2);
    });

    return () => cancelAnimationFrame(frame);
  }, [chainWindowKey]);

  const formatGreek = (value) => (value == null || Number.isNaN(value) ? "—" : value.toFixed(3));
  const formatIv = (value) => (value == null || Number.isNaN(value) ? "—" : `${(value * 100).toFixed(1)}%`);
  const formatPrice = (value, held) => `${held ? "★ " : ""}${(value || 0).toFixed(2)}`;
  const formatVolume = (value, hot) => `${hot ? "⚡" : ""}${fmtCompactNumber(value || 0)}`;
  const columns = [
    { key: "cGamma", label: "Γ", side: "C", align: "right", color: T.purple, format: formatGreek },
    { key: "cTheta", label: "Θ", side: "C", align: "right", color: T.red, format: formatGreek },
    { key: "cVega", label: "V", side: "C", align: "right", color: T.cyan, format: formatGreek },
    { key: "cDelta", label: "Δ", side: "C", align: "right", color: T.textSec, format: (value) => (value == null ? "—" : value.toFixed(2)) },
    { key: "cIv", label: "IV", side: "C", align: "right", color: T.textDim, format: formatIv },
    { key: "cOi", label: "OI", side: "C", align: "right", color: T.textDim, format: (value) => fmtCompactNumber(value || 0) },
    { key: "cVol", label: "VOL", side: "C", align: "right", color: T.textDim, hot: true, format: (value, row) => formatVolume(value, row.cVol / Math.max(row.cOi, 1) > 0.5) },
    { key: "cPrem", label: "LAST", side: "C", align: "right", color: T.green, heldAware: true, format: (value, _row, held) => formatPrice(value, held) },
    { key: "k", label: "STRIKE", side: null, align: "center", strike: true, format: (value) => value },
    { key: "pPrem", label: "LAST", side: "P", align: "left", color: T.red, heldAware: true, format: (value, _row, held) => formatPrice(value, held) },
    { key: "pVol", label: "VOL", side: "P", align: "left", color: T.textDim, hot: true, format: (value, row) => formatVolume(value, row.pVol / Math.max(row.pOi, 1) > 0.5) },
    { key: "pOi", label: "OI", side: "P", align: "left", color: T.textDim, format: (value) => fmtCompactNumber(value || 0) },
    { key: "pIv", label: "IV", side: "P", align: "left", color: T.textDim, format: formatIv },
    { key: "pDelta", label: "Δ", side: "P", align: "left", color: T.textSec, format: (value) => (value == null ? "—" : value.toFixed(2)) },
    { key: "pVega", label: "V", side: "P", align: "left", color: T.cyan, format: formatGreek },
    { key: "pTheta", label: "Θ", side: "P", align: "left", color: T.red, format: formatGreek },
    { key: "pGamma", label: "Γ", side: "P", align: "left", color: T.purple, format: formatGreek },
  ];

  return (
    <div ref={scrollRef} style={{ height: "100%", overflow: "auto", fontSize: fs(9), fontFamily: T.mono, touchAction: "pan-x pan-y" }}>
      <div style={{ minWidth: 980 }}>
        <div style={{ display: "grid", gridTemplateColumns, gap: sp(2), padding: sp("3px 6px"), borderBottom: `1px solid ${T.border}`, position: "sticky", top: 0, background: T.bg2, zIndex: 1 }}>
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
          <div key={row.k} style={{ display: "grid", gridTemplateColumns, gap: sp(2), padding: sp("2px 6px"), borderBottom: `1px solid ${T.border}10`, background: row.isAtm ? `${T.accent}08` : "transparent" }}>
            {columns.map((column) => {
              if (column.strike) {
                return (
                  <span key={column.key} style={{ color: row.isAtm ? T.accent : T.text, fontWeight: 700, textAlign: "center" }}>
                    {column.format(row[column.key], row, false)}
                  </span>
                );
              }

              const isSelected = selected && selected.strike === row.k && selected.cp === column.side;
              const held = Boolean(heldStrikes && heldStrikes.find((item) => item.strike === row.k && item.cp === column.side));
              const background = isSelected
                ? `${column.side === "C" ? T.green : T.red}25`
                : held && column.heldAware
                  ? `${T.amber}18`
                  : "transparent";
              const border = held && column.heldAware ? `1px solid ${T.amber}60` : "1px solid transparent";
              const value = row[column.key];

              return (
                <span
                  key={column.key}
                  onClick={() => onSelect(row.k, column.side)}
                  style={{
                    color: column.hot
                      ? ((column.side === "C" ? row.cVol / Math.max(row.cOi, 1) : row.pVol / Math.max(row.pOi, 1)) > 0.5 ? T.amber : column.color)
                      : column.color,
                    fontWeight: column.key.endsWith("Prem") || column.hot ? 600 : 500,
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
const PayoffDiagram = ({ optType, strike, premium, qty, currentPrice, side }) => {
  const isCall = optType === "C";
  const isLong = side === "BUY";
  const debit = premium * qty * 100;

  // P&L at expiration for any underlying price S
  const pnl = (S) => {
    const intrinsic = isCall ? Math.max(0, S - strike) : Math.max(0, strike - S);
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
  const yMax = Math.max(...points.map(p => p.p));
  const yMin = Math.min(...points.map(p => p.p));
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
  const maxProfitUnlimited = (isLong && isCall) || (!isLong && !isCall && false); // selling put has capped loss but profit is the credit
  const maxLossUnlimited = !isLong && isCall; // selling naked call

  const visibleMaxProfit = Math.max(...points.map(p => p.p));
  const visibleMaxLoss = Math.min(...points.map(p => p.p));

  // SVG dimensions
  const W = 280, H = 120;
  const padL = 6, padR = 6, padT = 18, padB = 18;
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
  if (currentSeg.length > 0) segments.push({ sign: currentSign, points: currentSeg });

  // Tick prices for the x-axis: just current and strike (those are the anchors that matter)
  const fmtMoney = (v) => v >= 1000 ? `$${(v/1000).toFixed(1)}K` : `$${Math.round(v)}`;

  return (
    <div style={{ background: T.bg3, borderRadius: dim(3), padding: sp(4) }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: sp("0 4px 2px"), fontSize: fs(7), fontFamily: T.mono, color: T.textMuted, letterSpacing: "0.06em" }}>
        <span>P&L AT EXPIRATION</span>
        <span style={{ display: "flex", gap: sp(6) }}>
          <span><span style={{ color: T.accent }}>━</span> now ${currentPrice.toFixed(2)}</span>
          <span><span style={{ color: T.amber }}>┃</span> strike ${strike}</span>
        </span>
      </div>
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        {/* Zero P&L line */}
        <line x1={padL} x2={padL + innerW} y1={y0} y2={y0}
          stroke={T.textMuted} strokeWidth={0.5} strokeDasharray="2 2" opacity={0.5} />

        {/* Filled areas under each segment */}
        {segments.map((seg, i) => {
          if (seg.points.length < 2) return null;
          const fillColor = seg.sign === "+" ? T.green : T.red;
          const linePath = seg.points.map(p => `${xOf(p.s).toFixed(1)},${yOf(p.p).toFixed(1)}`).join(" L ");
          const firstX = xOf(seg.points[0].s).toFixed(1);
          const lastX = xOf(seg.points[seg.points.length - 1].s).toFixed(1);
          const fillD = `M ${firstX},${y0} L ${linePath} L ${lastX},${y0} Z`;
          return <path key={`fill-${i}`} d={fillD} fill={fillColor} fillOpacity={0.13} />;
        })}

        {/* Strike vertical line */}
        {strike >= xMin && strike <= xMax && (
          <line x1={xOf(strike)} x2={xOf(strike)} y1={padT} y2={padT + innerH}
            stroke={T.amber} strokeWidth={0.8} strokeDasharray="2 2" opacity={0.7} />
        )}

        {/* Breakeven vertical line */}
        {breakeven >= xMin && breakeven <= xMax && (
          <>
            <line x1={xOf(breakeven)} x2={xOf(breakeven)} y1={padT} y2={padT + innerH}
              stroke={T.textDim} strokeWidth={0.6} strokeDasharray="3 2" />
            <text x={xOf(breakeven)} y={padT - 4} fontSize={fs(8)} fontFamily={T.mono}
              fill={T.textDim} textAnchor="middle" fontWeight={600}>BE ${breakeven.toFixed(2)}</text>
          </>
        )}

        {/* Current price vertical line */}
        {currentPrice >= xMin && currentPrice <= xMax && (
          <line x1={xOf(currentPrice)} x2={xOf(currentPrice)} y1={padT} y2={padT + innerH}
            stroke={T.accent} strokeWidth={1.2} opacity={0.9} />
        )}

        {/* Curve segments */}
        {segments.map((seg, i) => {
          if (seg.points.length < 2) return null;
          const lineColor = seg.sign === "+" ? T.green : T.red;
          const lineD = "M " + seg.points.map(p => `${xOf(p.s).toFixed(1)},${yOf(p.p).toFixed(1)}`).join(" L ");
          return <path key={`line-${i}`} d={lineD} fill="none" stroke={lineColor} strokeWidth={1.8} strokeLinejoin="round" />;
        })}

        {/* Top right: max profit label */}
        <text x={W - padR - 2} y={padT - 2} fontSize={fs(8)} fontFamily={T.mono}
          fill={T.green} textAnchor="end" fontWeight={700}>
          {maxProfitUnlimited ? "Max +∞" : `Max +${fmtMoney(visibleMaxProfit)}`}
        </text>
        {/* Bottom right: max loss label */}
        <text x={W - padR - 2} y={H - 4} fontSize={fs(8)} fontFamily={T.mono}
          fill={T.red} textAnchor="end" fontWeight={700}>
          {maxLossUnlimited ? "Max −∞" : `Max ${fmtMoney(visibleMaxLoss)}`}
        </text>

        {/* X axis baseline */}
        <line x1={padL} x2={padL + innerW} y1={padT + innerH} y2={padT + innerH}
          stroke={T.border} strokeWidth={0.5} />
        {/* X axis ticks */}
        <text x={padL} y={H - 4} fontSize={fs(7)} fontFamily={T.mono} fill={T.textMuted}>${xMin.toFixed(0)}</text>
        <text x={padL + innerW} y={H - 4} fontSize={fs(7)} fontFamily={T.mono} fill={T.textMuted} textAnchor="end">${xMax.toFixed(0)}</text>
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
  executionConfigured,
}) => {
  const toast = useToast();
  const positions = usePositions();
  const queryClient = useQueryClient();
  const info = TRADE_TICKER_INFO[slot.ticker] || TRADE_TICKER_INFO.SPY;
  const row = chainRows.find(r => r.k === slot.strike);
  if (!row) {
    return (
      <div style={{ background: T.bg2, border: `1px solid ${T.border}`, borderRadius: dim(6), padding: sp("8px 10px"), display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ fontSize: fs(9), fontWeight: 700, color: T.textSec, fontFamily: T.display, letterSpacing: "0.08em", borderBottom: `1px solid ${T.border}`, paddingBottom: 4 }}>ORDER TICKET</div>
        <DataUnavailableState
          title="No live contract quote"
          detail="The order ticket only opens once the selected option contract has a live chain row with bid, ask, and greeks."
        />
      </div>
    );
  }
  const prem = row ? (slot.cp === "C" ? row.cPrem : row.pPrem) : 3.0;
  const bid = row ? (slot.cp === "C" ? row.cBid : row.pBid) : prem - 0.04;
  const ask = row ? (slot.cp === "C" ? row.cAsk : row.pAsk) : prem + 0.04;
  const spread = ask - bid;
  const spreadPct = prem > 0 ? (spread / prem) * 100 : 0;
  const delta = row ? Math.abs(slot.cp === "C" ? row.cDelta : row.pDelta) : 0.5;
  const contractColor = slot.cp === "C" ? T.green : T.red;
  const expInfo = expiration || {
    value: slot.exp,
    label: slot.exp,
    dte: daysToExpiration(slot.exp),
    actualDate: parseExpirationValue(slot.exp),
  };
  const selectedContractMeta = slot.cp === "C" ? row?.cContract : row?.pContract;
  const liveExecutionReady = Boolean(executionConfigured && accountId && selectedContractMeta && expInfo.actualDate);
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

  // ── CONTROLLED STATE ──
  const [side, setSide] = useState("BUY");
  const [orderType, setOrderType] = useState("LMT");     // LMT / MKT / STP
  const [tif, setTif] = useState("DAY");                 // DAY / GTC / IOC / FOK
  const [qty, setQty] = useState(3);
  const [limitPrice, setLimitPrice] = useState(prem);
  const [stopLoss, setStopLoss] = useState(+(prem * 0.65).toFixed(2));
  const [takeProfit, setTakeProfit] = useState(+(prem * 1.75).toFixed(2));

  // When the contract changes, reset prices (but not qty — user might want same size)
  useEffect(() => {
    setLimitPrice(prem);
    setStopLoss(+(prem * 0.65).toFixed(2));
    setTakeProfit(+(prem * 1.75).toFixed(2));
  }, [prem, slot.ticker, slot.strike, slot.cp]);

  const isLong = side === "BUY";
  const qtyNum = Number(qty) || 0;
  const fillPrice = orderType === "MKT" ? prem : (parseFloat(limitPrice) || prem);
  const cost = fillPrice * qtyNum * 100;
  const breakeven = slot.cp === "C" ? slot.strike + fillPrice : slot.strike - fillPrice;
  const beMovePct = ((breakeven - info.price) / info.price) * 100;
  const pop = Math.max(15, Math.min(75, (0.5 - Math.abs(delta - 0.5)) * 100 + 25));
  const slPct = fillPrice > 0 ? ((stopLoss - fillPrice) / fillPrice * 100) : -35;
  const tpPct = fillPrice > 0 ? ((takeProfit - fillPrice) / fillPrice * 100) : 75;

  const submitOrder = () => {
    if (qtyNum <= 0) {
      toast.push({ kind: "error", title: "Invalid quantity", body: "Enter a positive number of contracts." });
      return;
    }
    if (orderType !== "MKT" && (!Number.isFinite(fillPrice) || fillPrice <= 0)) {
      toast.push({ kind: "error", title: "Invalid limit", body: "Enter a positive limit price." });
      return;
    }

    if (executionConfigured && accountId && !liveExecutionReady) {
      toast.push({
        kind: "info",
        title: "Contract loading",
        body: "Wait for the live option chain to finish loading before submitting a broker order.",
      });
      return;
    }

    if (!executionConfigured || !accountId) {
      // IOC/FOK: simulate possible no-fill for realism in fallback mode only.
      if (tif === "FOK" && Math.abs(fillPrice - prem) > spread * 2) {
        toast.push({ kind: "warn", title: "Order canceled", body: `FOK not fillable at $${fillPrice.toFixed(2)} (mid $${prem.toFixed(2)}).` });
        return;
      }

      positions.addPosition({
        kind: "option",
        ticker: slot.ticker,
        strike: slot.strike,
        cp: slot.cp,
        exp: slot.exp,
        dte: expInfo.dte,
        side,
        qty: qtyNum,
        entry: fillPrice,
        stopLoss: Number.isFinite(+stopLoss) ? +stopLoss : null,
        takeProfit: Number.isFinite(+takeProfit) ? +takeProfit : null,
        orderType,
        tif,
      });
      toast.push({
        kind: "success",
        title: `${side === "BUY" ? "Opened" : "Shorted"} ${slot.ticker} ${slot.strike}${slot.cp}`,
        body: `${qtyNum} × $${fillPrice.toFixed(2)} · ${isLong ? "−" : "+"}$${cost.toFixed(0)} · ${orderType} ${tif}`,
      });
      return;
    }

    if (orderType === "STP") {
      toast.push({
        kind: "info",
        title: "Stop orders not wired",
        body: "The live ticket currently supports market and limit entry orders only.",
      });
      return;
    }

    placeOrderMutation.mutate({
      data: {
        accountId,
        mode: environment,
        symbol: slot.ticker,
        assetClass: "option",
        side: side.toLowerCase(),
        type: orderType === "MKT" ? "market" : "limit",
        quantity: qtyNum,
        limitPrice: orderType === "LMT" ? fillPrice : null,
        stopPrice: null,
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
      },
    });
  };

  return (
    <div style={{ background: T.bg2, border: `1px solid ${T.border}`, borderRadius: dim(6), padding: sp("8px 10px"), display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ fontSize: fs(9), fontWeight: 700, color: T.textSec, fontFamily: T.display, letterSpacing: "0.08em", borderBottom: `1px solid ${T.border}`, paddingBottom: 4 }}>ORDER TICKET</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
        <span style={{ fontSize: fs(13), fontWeight: 800, fontFamily: T.mono, color: T.text }}>{slot.ticker}</span>
        <span style={{ fontSize: fs(12), fontWeight: 700, fontFamily: T.mono, color: contractColor }}>{slot.strike}{slot.cp}</span>
        <span style={{ fontSize: fs(9), color: T.textDim, fontFamily: T.mono }}>{expInfo.label || slot.exp} · {expInfo.dte}d</span>
      </div>
      {/* Bid × Ask spread strip */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: sp(4), padding: sp("4px 6px"), background: T.bg3, borderRadius: dim(3), fontFamily: T.mono }}>
        <div>
          <div style={{ fontSize: fs(6), color: T.textMuted, letterSpacing: "0.08em" }}>BID</div>
          <div style={{ fontSize: fs(12), fontWeight: 700, color: T.red, lineHeight: 1 }}>${bid.toFixed(2)}</div>
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: fs(6), color: T.textMuted, letterSpacing: "0.08em" }}>MID</div>
          <div style={{ fontSize: fs(12), fontWeight: 700, color: T.text, lineHeight: 1 }}>${prem.toFixed(2)}</div>
          <div style={{ fontSize: fs(7), color: spreadPct > 3 ? T.amber : T.textDim }}>{spread.toFixed(2)} ({spreadPct.toFixed(1)}%)</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: fs(6), color: T.textMuted, letterSpacing: "0.08em" }}>ASK</div>
          <div style={{ fontSize: fs(12), fontWeight: 700, color: T.green, lineHeight: 1 }}>${ask.toFixed(2)}</div>
        </div>
      </div>
      {/* Side + Order type */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 3 }}>
        <div style={{ display: "flex", gap: 2 }}>
          <button onClick={() => setSide("BUY")} style={{ flex: 1, padding: sp("4px 0"), background: isLong ? `${T.green}20` : "transparent", border: `1px solid ${isLong ? T.green + "60" : T.border}`, borderRadius: dim(3), color: isLong ? T.green : T.textDim, fontSize: fs(10), fontFamily: T.sans, fontWeight: 700, cursor: "pointer" }}>BUY</button>
          <button onClick={() => setSide("SELL")} style={{ flex: 1, padding: sp("4px 0"), background: !isLong ? `${T.red}20` : "transparent", border: `1px solid ${!isLong ? T.red + "60" : T.border}`, borderRadius: dim(3), color: !isLong ? T.red : T.textDim, fontSize: fs(10), fontFamily: T.sans, fontWeight: !isLong ? 700 : 600, cursor: "pointer" }}>SELL</button>
        </div>
        <div style={{ display: "flex", gap: 2 }}>
          {["LMT", "MKT", "STP"].map(t => (
            <button
              key={t}
              onClick={() => setOrderType(t)}
              style={{ flex: 1, padding: sp("4px 0"), background: orderType === t ? T.accentDim : "transparent", border: `1px solid ${orderType === t ? T.accent : T.border}`, borderRadius: dim(3), color: orderType === t ? T.accent : T.textDim, fontSize: fs(9), fontFamily: T.mono, fontWeight: 600, cursor: "pointer" }}
            >{t}</button>
          ))}
        </div>
      </div>
      {/* QTY presets + input + LIMIT */}
      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr 1fr", gap: sp(4), alignItems: "end" }}>
        <div style={{ display: "flex", gap: 2 }}>
          {[1, 3, 5, 10].map(n => (
            <button
              key={n}
              onClick={() => setQty(n)}
              style={{ padding: sp("4px 7px"), background: qtyNum === n ? T.accentDim : "transparent", border: `1px solid ${qtyNum === n ? T.accent : T.border}`, borderRadius: dim(3), color: qtyNum === n ? T.accent : T.textDim, fontSize: fs(9), fontFamily: T.mono, fontWeight: 700, cursor: "pointer" }}
            >{n}</button>
          ))}
        </div>
        <div>
          <div style={{ fontSize: fs(6), color: T.textMuted, letterSpacing: "0.08em", marginBottom: 1 }}>QTY</div>
          <input
            type="number" min="1"
            value={qty}
            onChange={e => setQty(e.target.value === "" ? "" : Math.max(0, +e.target.value))}
            style={{ width: "100%", background: T.bg3, border: `1px solid ${T.border}`, borderRadius: dim(3), padding: sp("3px 6px"), color: T.text, fontSize: fs(11), fontFamily: T.mono, fontWeight: 600 }}
          />
        </div>
        <div>
          <div style={{ fontSize: fs(6), color: T.textMuted, letterSpacing: "0.08em", marginBottom: 1 }}>
            {orderType === "MKT" ? "MID" : "LIMIT"}
          </div>
          <input
            type="number" step="0.01"
            value={orderType === "MKT" ? prem.toFixed(2) : limitPrice}
            disabled={orderType === "MKT"}
            onChange={e => setLimitPrice(e.target.value)}
            style={{ width: "100%", background: orderType === "MKT" ? T.bg2 : T.bg3, border: `1px solid ${T.border}`, borderRadius: dim(3), padding: sp("3px 6px"), color: orderType === "MKT" ? T.textDim : T.text, fontSize: fs(11), fontFamily: T.mono, fontWeight: 600 }}
          />
        </div>
      </div>
      {/* SL / TP */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
        <div>
          <div style={{ fontSize: fs(6), color: T.textMuted, letterSpacing: "0.08em", marginBottom: sp(1), display: "flex", justifyContent: "space-between" }}>
            <span>STOP LOSS</span>
            <span style={{ color: T.red, fontWeight: 700 }}>{slPct >= 0 ? "+" : ""}{slPct.toFixed(0)}%</span>
          </div>
          <input
            type="number" step="0.01"
            value={stopLoss}
            onChange={e => setStopLoss(e.target.value)}
            style={{ width: "100%", background: T.bg3, border: `1px solid ${T.red}30`, borderRadius: dim(3), padding: sp("3px 6px"), color: T.red, fontSize: fs(11), fontFamily: T.mono, fontWeight: 600 }}
          />
        </div>
        <div>
          <div style={{ fontSize: fs(6), color: T.textMuted, letterSpacing: "0.08em", marginBottom: sp(1), display: "flex", justifyContent: "space-between" }}>
            <span>TAKE PROFIT</span>
            <span style={{ color: T.green, fontWeight: 700 }}>{tpPct >= 0 ? "+" : ""}{tpPct.toFixed(0)}%</span>
          </div>
          <input
            type="number" step="0.01"
            value={takeProfit}
            onChange={e => setTakeProfit(e.target.value)}
            style={{ width: "100%", background: T.bg3, border: `1px solid ${T.green}30`, borderRadius: dim(3), padding: sp("3px 6px"), color: T.green, fontSize: fs(11), fontFamily: T.mono, fontWeight: 600 }}
          />
        </div>
      </div>
      {/* TIF */}
      <div style={{ display: "flex", gap: 2 }}>
        {["DAY", "GTC", "IOC", "FOK"].map(t => (
          <button
            key={t}
            onClick={() => setTif(t)}
            style={{ flex: 1, padding: sp("3px 0"), background: tif === t ? T.accentDim : "transparent", border: `1px solid ${tif === t ? T.accent : T.border}`, borderRadius: dim(2), color: tif === t ? T.accent : T.textDim, fontSize: fs(8), fontFamily: T.mono, fontWeight: 600, cursor: "pointer" }}
          >{t}</button>
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
      <div style={{ display: "flex", justifyContent: "space-between", padding: sp("2px 4px"), fontSize: fs(8), fontFamily: T.mono }}>
        <span style={{ color: T.textMuted }}>BE <span style={{ color: T.text, fontWeight: 600 }}>${breakeven.toFixed(2)}</span> <span style={{ color: T.textDim }}>({beMovePct >= 0 ? "+" : ""}{beMovePct.toFixed(1)}%)</span></span>
        <span style={{ color: T.textMuted }}>{isLong ? "Risk" : "Credit"} <span style={{ color: isLong ? T.red : T.green, fontWeight: 600 }}>${cost.toFixed(0)}</span></span>
        <span style={{ color: T.textMuted }}>POP <span style={{ color: pop >= 50 ? T.green : pop >= 30 ? T.amber : T.red, fontWeight: 600 }}>{pop.toFixed(0)}%</span></span>
      </div>
      <button
        onClick={submitOrder}
        disabled={placeOrderMutation.isPending}
        style={{ marginTop: "auto", padding: sp("7px 0"), background: isLong ? T.green : T.red, border: "none", borderRadius: dim(4), color: "#fff", fontSize: fs(11), fontFamily: T.sans, fontWeight: 700, cursor: placeOrderMutation.isPending ? "wait" : "pointer", letterSpacing: "0.04em", opacity: placeOrderMutation.isPending ? 0.7 : 1 }}
      >
        {placeOrderMutation.isPending
          ? "SUBMITTING..."
          : `${side} ${qtyNum || 0} × $${fillPrice.toFixed(2)} · ${isLong ? "−" : "+"}$${cost.toFixed(0)}`}
      </button>
    </div>
  );
};

const TradeStrategyGreeksPanel = ({ slot, chainRows = [], onApplyStrategy }) => {
  const row = chainRows.find(r => r.k === slot.strike);
  if (!row) {
    return (
      <div style={{ background: T.bg2, border: `1px solid ${T.border}`, borderRadius: dim(6), padding: sp("8px 10px"), display: "flex", flexDirection: "column", gap: sp(6), overflow: "hidden" }}>
        <div style={{ fontSize: fs(9), fontWeight: 700, color: T.textSec, fontFamily: T.display, letterSpacing: "0.08em", borderBottom: `1px solid ${T.border}`, paddingBottom: sp(4) }}>STRATEGY</div>
        <DataUnavailableState
          title="No live greeks"
          detail="Strategy presets stay available after the selected contract resolves to a live option chain row with greeks."
        />
      </div>
    );
  }
  const delta = row ? (slot.cp === "C" ? row.cDelta : row.pDelta) : 0.5;
  const fallbackGreeks = deriveApproxGreeksFromDelta(delta);
  const gamma = row ? (slot.cp === "C" ? row.cGamma : row.pGamma) ?? fallbackGreeks.gamma : fallbackGreeks.gamma;
  const theta = row ? (slot.cp === "C" ? row.cTheta : row.pTheta) ?? fallbackGreeks.theta : fallbackGreeks.theta;
  const vega = row ? (slot.cp === "C" ? row.cVega : row.pVega) ?? fallbackGreeks.vega : fallbackGreeks.vega;
  const absDelta = Math.abs(delta);
  const qty = 3;

  const GreekBar = ({ label, value, color, max, desc }) => {
    const pct = Math.min(1, Math.abs(value) / max);
    return (
      <div style={{ display: "grid", gridTemplateColumns: "32px 1fr 64px", alignItems: "center", gap: sp(4), padding: "2px 0" }}>
        <span style={{ fontSize: fs(9), color: T.textSec, fontFamily: T.mono, fontWeight: 600 }}>{label}</span>
        <div style={{ position: "relative", height: dim(12), background: T.bg3, borderRadius: dim(2), overflow: "hidden" }}>
          <div style={{
            position: "absolute", left: value < 0 ? `${50 - pct * 50}%` : "50%",
            width: `${pct * 50}%`, height: "100%", background: color, opacity: 0.85, borderRadius: dim(1),
          }} />
          <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: dim(1), background: T.border }} />
          <span style={{
            position: "absolute", top: 0, bottom: 0,
            left: value < 0 ? `${Math.max(0, 50 - pct * 50 - 0.5)}%` : `${Math.min(95, 50 + pct * 50 + 1)}%`,
            transform: value < 0 ? "translateX(-100%)" : "none",
            fontSize: fs(8), fontFamily: T.mono, fontWeight: 700, color: T.text,
            display: "flex", alignItems: "center",
            paddingLeft: value < 0 ? 0 : 3, paddingRight: value < 0 ? 3 : 0,
          }}>{value.toFixed(3)}</span>
        </div>
        <span style={{ fontSize: fs(9), color: T.textDim, fontFamily: T.sans, fontStyle: "italic", textAlign: "right" }}>{desc}</span>
      </div>
    );
  };

  return (
    <div style={{ background: T.bg2, border: `1px solid ${T.border}`, borderRadius: dim(6), padding: sp("8px 10px"), display: "flex", flexDirection: "column", gap: sp(6), overflow: "hidden" }}>
      <div>
        <div style={{ fontSize: fs(9), fontWeight: 700, color: T.textSec, fontFamily: T.display, letterSpacing: "0.08em", borderBottom: `1px solid ${T.border}`, paddingBottom: sp(4), marginBottom: 5 }}>STRATEGY</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 3 }}>
          {TRADE_STRATEGIES.map(s => (
            <button key={s.id} onClick={e => { e.stopPropagation(); onApplyStrategy(s); }} style={{
              padding: sp("4px 6px"), background: "transparent", border: `1px solid ${s.color}40`,
              borderLeft: `3px solid ${s.color}`, borderRadius: dim(3), color: T.text,
              fontSize: fs(9), fontFamily: T.sans, fontWeight: 600, textAlign: "left", cursor: "pointer", lineHeight: 1.2,
            }}>
              <div style={{ color: s.color, fontWeight: 700 }}>{s.name}</div>
              <div style={{ color: T.textDim, fontSize: fs(8), marginTop: sp(1), fontStyle: "italic" }}>{s.desc}</div>
            </button>
          ))}
        </div>
      </div>
      <div>
        <div style={{ fontSize: fs(9), fontWeight: 700, color: T.textSec, fontFamily: T.display, letterSpacing: "0.08em", borderBottom: `1px solid ${T.border}`, paddingBottom: sp(4), marginBottom: sp(5), display: "flex", justifyContent: "space-between" }}>
          <span>GREEKS</span>
          <span style={{ fontSize: fs(7), color: T.textDim, fontWeight: 400 }}>PER CONTRACT</span>
        </div>
        <GreekBar label="Δ" value={delta}  color={T.accent} max={1.0}  desc={absDelta >= 0.5 ? "Strong" : absDelta >= 0.3 ? "Moderate" : "Weak"} />
        <GreekBar label="Γ" value={gamma}  color={T.purple} max={0.10} desc={gamma > 0.05 ? "High γ-risk" : "Moderate γ"} />
        <GreekBar label="Θ" value={theta}  color={T.red}    max={0.15} desc={`$${Math.abs(theta * 100).toFixed(0)}/day`} />
        <GreekBar label="V" value={vega}   color={T.cyan}   max={0.20} desc={`$${(vega * 100).toFixed(0)}/1% IV`} />
      </div>
      <div style={{ padding: sp("4px 6px"), background: T.bg3, borderRadius: 3 }}>
        <div style={{ fontSize: fs(6), color: T.textMuted, letterSpacing: "0.08em", marginBottom: 2 }}>POSITION × {qty}</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: sp(4), fontSize: fs(9), fontFamily: T.mono }}>
          <div><span style={{ color: T.textDim, fontSize: fs(7) }}>Δ </span><span style={{ color: T.accent, fontWeight: 700 }}>{(delta * qty).toFixed(2)}</span></div>
          <div><span style={{ color: T.textDim, fontSize: fs(7) }}>Γ </span><span style={{ color: T.purple, fontWeight: 700 }}>{(gamma * qty).toFixed(2)}</span></div>
          <div><span style={{ color: T.textDim, fontSize: fs(7) }}>Θ </span><span style={{ color: T.red, fontWeight: 700 }}>{(theta * qty).toFixed(2)}</span></div>
          <div><span style={{ color: T.textDim, fontSize: fs(7) }}>V </span><span style={{ color: T.cyan, fontWeight: 700 }}>{(vega * qty).toFixed(2)}</span></div>
        </div>
      </div>
    </div>
  );
};

const TradeL2Panel = ({ slot, chainRows = [], flowEvents = [] }) => {
  const info = TRADE_TICKER_INFO[slot.ticker] || TRADE_TICKER_INFO.SPY;
  const row = chainRows.find(r => r.k === slot.strike);
  if (!row) {
    return (
      <div style={{ background: T.bg2, border: `1px solid ${T.border}`, borderRadius: dim(6), padding: sp("8px 10px"), display: "flex", flexDirection: "column", gap: sp(4), overflow: "hidden" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: `1px solid ${T.border}`, paddingBottom: sp(4) }}>
          <div style={{ display: "flex", gap: sp(8), alignItems: "center" }}>
            <span style={{ fontSize: fs(9), fontWeight: 700, color: T.textSec, fontFamily: T.display, letterSpacing: "0.08em" }}>BOOK / FLOW / TAPE</span>
          </div>
          <span style={{ fontSize: fs(8), color: T.textDim, fontFamily: T.mono }}>waiting on live chain</span>
        </div>
        <DataUnavailableState
          title="No live contract market depth"
          detail="This panel no longer fabricates book or tape data. It unlocks once a live contract quote is available."
        />
      </div>
    );
  }
  const mid = row ? (slot.cp === "C" ? row.cPrem : row.pPrem) : 3.0;
  const bid = row ? (slot.cp === "C" ? row.cBid : row.pBid) : mid - 0.04;
  const ask = row ? (slot.cp === "C" ? row.cAsk : row.pAsk) : mid + 0.04;
  const spread = ask - bid;
  // Per-ticker order flow — bullishness mirrors the day's price change
  const tickerFlow = useMemo(
    () => buildMarketOrderFlowFromEvents(flowEvents),
    [flowEvents],
  );
  const contractColor = slot.cp === "C" ? T.green : T.red;
  const [tab, setTab] = useState("book");

  const TabBtn = ({ id, label }) => (
    <button
      onClick={() => setTab(id)}
      style={{
        background: "transparent", border: "none", padding: 0,
        fontSize: fs(9), fontWeight: 700, color: tab === id ? T.text : T.textMuted,
        fontFamily: T.display, letterSpacing: "0.08em", cursor: "pointer",
        borderBottom: tab === id ? `2px solid ${T.accent}` : "2px solid transparent",
        paddingBottom: sp(2),
      }}
    >{label}</button>
  );

  return (
    <div style={{ background: T.bg2, border: `1px solid ${T.border}`, borderRadius: dim(6), padding: sp("8px 10px"), display: "flex", flexDirection: "column", gap: sp(4), overflow: "hidden" }}>
      {/* Tabbed header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: `1px solid ${T.border}`, paddingBottom: sp(4) }}>
        <div style={{ display: "flex", gap: sp(8), alignItems: "center" }}>
          <TabBtn id="book" label="BOOK" />
          <TabBtn id="flow" label="FLOW" />
          <TabBtn id="tape" label="TAPE" />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: sp(8) }}>
          <span style={{ fontSize: fs(8), color: flowEvents.length ? T.accent : T.textDim, fontFamily: T.mono }}>{flowEvents.length ? "flow: Massive snapshot-derived" : "flow unavailable"}</span>
          <span style={{ fontSize: fs(9), fontFamily: T.mono, color: contractColor, fontWeight: 700 }}>{slot.strike}{slot.cp}</span>
          <span style={{ fontSize: fs(8), color: T.textDim, fontFamily: T.mono }}>${spread.toFixed(2)} sprd</span>
        </div>
      </div>

      {tab === "book" && (
        <DataUnavailableState
          title="Order book provider not wired"
          detail="Best bid and ask are live from the option chain, but depth-of-book levels are hidden until a real L2 feed is connected."
        />
      )}

      {/* FLOW tab — order flow distribution for this ticker */}
      {tab === "flow" && (
        flowEvents.length ? (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: sp(4), minHeight: 0, overflowY: "auto" }}>
          <div style={{ display: "flex", alignItems: "center", gap: sp(8), padding: sp("4px 0") }}>
            <OrderFlowDonut flow={tickerFlow} size={70} thickness={11} />
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: sp(2) }}>
              <div style={{ fontSize: fs(8), color: T.textMuted, letterSpacing: "0.08em" }}>{slot.ticker} BUY / SELL</div>
              <div style={{ display: "flex", justifyContent: "space-between", fontFamily: T.mono, fontSize: fs(10) }}>
                <span style={{ color: T.green, fontWeight: 700 }}>${(tickerFlow.buyXL + tickerFlow.buyL + tickerFlow.buyM + tickerFlow.buyS).toFixed(0)}M</span>
                <span style={{ color: T.red, fontWeight: 700 }}>${(tickerFlow.sellXL + tickerFlow.sellL + tickerFlow.sellM + tickerFlow.sellS).toFixed(0)}M</span>
              </div>
              {(() => {
                const buy = tickerFlow.buyXL + tickerFlow.buyL + tickerFlow.buyM + tickerFlow.buyS;
                const sell = tickerFlow.sellXL + tickerFlow.sellL + tickerFlow.sellM + tickerFlow.sellS;
                const buyPct = (buy / Math.max(buy + sell, 1)) * 100;
                return (
                  <>
                    <div style={{ display: "flex", height: dim(4), borderRadius: dim(2), overflow: "hidden", background: T.bg3 }}>
                      <div style={{ width: `${buyPct}%`, background: T.green, opacity: 0.85 }} />
                      <div style={{ width: `${100 - buyPct}%`, background: T.red, opacity: 0.85 }} />
                    </div>
                    <div style={{ fontSize: fs(8), color: T.textDim, fontFamily: T.mono }}>{buyPct.toFixed(1)}% buy</div>
                  </>
                );
              })()}
            </div>
          </div>
          <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: sp(3) }}>
            <div style={{ fontSize: fs(8), color: T.textMuted, letterSpacing: "0.08em", marginBottom: sp(2) }}>BY SIZE</div>
            {(() => {
              const max = Math.max(tickerFlow.buyXL, tickerFlow.buyL, tickerFlow.buyM, tickerFlow.buyS, tickerFlow.sellXL, tickerFlow.sellL, tickerFlow.sellM, tickerFlow.sellS);
              return (
                <>
                  <SizeBucketRow label="XL" buy={tickerFlow.buyXL} sell={tickerFlow.sellXL} maxValue={max} />
                  <SizeBucketRow label="L"  buy={tickerFlow.buyL}  sell={tickerFlow.sellL}  maxValue={max} />
                  <SizeBucketRow label="M"  buy={tickerFlow.buyM}  sell={tickerFlow.sellM}  maxValue={max} />
                  <SizeBucketRow label="S"  buy={tickerFlow.buyS}  sell={tickerFlow.sellS}  maxValue={max} />
                </>
              );
            })()}
          </div>
        </div>
        ) : (
          <DataUnavailableState
            title="No live flow tape"
            detail={`Spot flow for ${slot.ticker} is hidden until current prints are returned from the live provider.`}
          />
        )
      )}

      {/* TAPE tab — recent prints feed */}
      {tab === "tape" && (
        <DataUnavailableState
          title="Trade tape provider not wired"
          detail="Recent option prints for the selected contract are hidden until a real contract tape feed is connected."
        />
      )}
    </div>
  );
};


const TradePositionsPanel = ({ accountId, environment, executionConfigured, onLoadPosition }) => {
  const toast = useToast();
  const pos = usePositions();
  const [tab, setTab] = useState("open");
  const [seedClosed, setSeedClosed] = useState(new Set());  // ids of seed positions user closed
  const positionsQuery = useListPositions(
    { accountId, mode: environment },
    {
      query: {
        enabled: Boolean(executionConfigured && accountId),
        ...QUERY_DEFAULTS,
      },
    },
  );

  // Merge seeded OPEN_POSITIONS (for nice initial demo) with user's mock fills.
  // User fills from PositionsContext render on top.
  const openPositions = useMemo(() => {
    if (executionConfigured && accountId) {
      return (positionsQuery.data?.positions || []).map((position) => {
        const isOption = Boolean(position.optionContract);
        const expiration = isOption ? formatExpirationLabel(position.optionContract.expirationDate) : "EQUITY";
        const contract = isOption
          ? `${position.optionContract.strike} ${position.optionContract.right === "call" ? "C" : "P"} ${expiration}`
          : "EQUITY";

        return {
          _isUser: false,
          _isLive: true,
          _id: position.id,
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

    const userFills = pos.positions.map(p => {
      // Mark price drifts randomly from entry for demo purposes
      // Mirror the wider drift formula used in App-root alertingPositions calc.
      // Uses the random-hash portion of id so rapid-fire orders get different drift values.
      const seed = (p.id.charCodeAt(14) || 0) * 3 + (p.id.charCodeAt(16) || 0) * 11 + (p.id.charCodeAt(18) || 0);
      const driftPct = Math.sin(seed) * 0.6;
      const mark = +(p.entry * (1 + driftPct)).toFixed(2);
      const pnl = p.kind === "option"
        ? (mark - p.entry) * p.qty * 100 * (p.side === "BUY" ? 1 : -1)
        : (mark - p.entry) * p.qty * (p.side === "LONG" ? 1 : -1);
      const pct = ((mark - p.entry) / p.entry) * 100 * (p.side === "BUY" || p.side === "LONG" ? 1 : -1);
      return {
        _isUser: true, _id: p.id,
        ticker: p.ticker,
        side: p.kind === "option" ? (p.side === "BUY" ? "LONG" : "SHORT") : p.side,
        contract: p.kind === "option" ? `${p.strike} ${p.cp} ${p.exp}` : `${p.side} EQUITY`,
        qty: p.qty, entry: p.entry, mark,
        pnl, pct,
        sl: p.stopLoss ?? +(p.entry * 0.65).toFixed(2),
        tp: p.takeProfit ?? +(p.entry * 1.75).toFixed(2),
      };
    });
    const seeds = OPEN_POSITIONS
      .filter((_, i) => !seedClosed.has(i))
      .map((p, i) => ({ ...p, _isUser: false, _id: `seed_${i}`, _seedIdx: i }));
    return [...userFills, ...seeds];
  }, [accountId, executionConfigured, pos.positions, positionsQuery.data, seedClosed]);

  const totalOpenPnl = openPositions.reduce((a, p) => a + p.pnl, 0);
  const totalHistPnl = TRADE_HISTORY.reduce((a, p) => a + p.pnl, 0);
  const parseContract = str => { const parts = str.split(" "); return { strike: parseFloat(parts[0]), cp: parts[1], exp: parts[2] }; };

  const closeRow = (p) => {
    if (p._isLive) {
      toast.push({
        kind: "info",
        title: "Close-out not wired",
        body: "Live position close-out still needs a dedicated execution endpoint.",
      });
      return;
    }
    if (p._isUser) pos.closePosition(p._id);
    else setSeedClosed(prev => new Set([...prev, p._seedIdx]));
    toast.push({
      kind: p.pnl >= 0 ? "success" : "warn",
      title: "Position closed",
      body: `${p.ticker} ${p.contract} · ${p.pnl >= 0 ? "+" : ""}$${p.pnl.toFixed(0)} (${p.pct >= 0 ? "+" : ""}${p.pct.toFixed(1)}%)`,
    });
  };

  const handleCloseAll = () => {
    if (executionConfigured && accountId) {
      toast.push({ kind: "info", title: "Close-all not wired", body: "Live flattening still needs an execution endpoint." });
      return;
    }
    if (openPositions.length === 0) {
      toast.push({ kind: "info", title: "Nothing to close", body: "No open positions." });
      return;
    }
    pos.closeAll();
    setSeedClosed(new Set(OPEN_POSITIONS.map((_, i) => i)));
    toast.push({
      kind: totalOpenPnl >= 0 ? "success" : "warn",
      title: `Closed ${openPositions.length} position${openPositions.length === 1 ? "" : "s"}`,
      body: `Realized ${totalOpenPnl >= 0 ? "+" : ""}$${totalOpenPnl.toFixed(0)}`,
    });
  };

  const handleSetStops = () => {
    if (executionConfigured && accountId) {
      toast.push({ kind: "info", title: "Stop management not wired", body: "Live stop management needs a modify-order endpoint." });
      return;
    }
    if (openPositions.length === 0) {
      toast.push({ kind: "info", title: "No positions", body: "Nothing to protect." });
      return;
    }
    const userPositions = openPositions.filter(p => p._isUser);
    if (userPositions.length === 0) {
      toast.push({ kind: "info", title: "Seed demo positions", body: "Stops auto-apply to your own fills; seed rows are read-only." });
      return;
    }
    // Tightening stops: for each user position, move SL to 80% of entry and TP to 150% of entry
    userPositions.forEach(p => {
      pos.updateStops(p._id, {
        stopLoss: +(p.entry * 0.8).toFixed(2),
        takeProfit: +(p.entry * 1.5).toFixed(2),
      });
    });
    toast.push({
      kind: "success",
      title: "Stops applied",
      body: `Protected ${userPositions.length} position${userPositions.length === 1 ? "" : "s"} at SL −20% / TP +50%`,
    });
  };

  const handleRollAll = () => {
    if (executionConfigured && accountId) {
      toast.push({ kind: "info", title: "Roll workflow not wired", body: "Live roll logic still needs spread/order orchestration." });
      return;
    }
    const userPositions = pos.positions.filter(p => p.kind === "option");
    if (userPositions.length === 0) {
      toast.push({ kind: "info", title: "Nothing to roll", body: "No option positions." });
      return;
    }
    userPositions.forEach(p => pos.rollPosition(p.id));
    toast.push({
      kind: "success",
      title: `Rolled ${userPositions.length} position${userPositions.length === 1 ? "" : "s"}`,
      body: `Extended expiration to next cycle`,
    });
  };

  return (
    <div style={{ background: T.bg2, border: `1px solid ${T.border}`, borderRadius: dim(6), padding: sp("8px 10px"), display: "flex", flexDirection: "column", gap: sp(4), overflow: "hidden" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: `1px solid ${T.border}`, paddingBottom: 4, gap: sp(4) }}>
        <div style={{ display: "flex", gap: sp(5), alignItems: "center", minWidth: 0 }}>
          <button onClick={() => setTab("open")} style={{ background: "transparent", border: "none", padding: sp(0), fontSize: fs(9), fontWeight: 700, color: tab === "open" ? T.text : T.textMuted, fontFamily: T.display, letterSpacing: "0.04em", cursor: "pointer", borderBottom: tab === "open" ? `2px solid ${T.accent}` : "2px solid transparent", paddingBottom: 2, whiteSpace: "nowrap" }}>OPEN <span style={{ color: T.textMuted, fontWeight: 400 }}>{openPositions.length}</span></button>
          <button onClick={() => setTab("history")} style={{ background: "transparent", border: "none", padding: sp(0), fontSize: fs(9), fontWeight: 700, color: tab === "history" ? T.text : T.textMuted, fontFamily: T.display, letterSpacing: "0.04em", cursor: "pointer", borderBottom: tab === "history" ? `2px solid ${T.accent}` : "2px solid transparent", paddingBottom: 2, whiteSpace: "nowrap" }}>HIST <span style={{ color: T.textMuted, fontWeight: 400 }}>{TRADE_HISTORY.length}</span></button>
        </div>
        <span style={{ fontSize: fs(10), fontWeight: 700, fontFamily: T.mono, color: (tab === "open" ? totalOpenPnl : totalHistPnl) >= 0 ? T.green : T.red, whiteSpace: "nowrap" }}>
          {(tab === "open" ? totalOpenPnl : totalHistPnl) >= 0 ? "+" : ""}${(tab === "open" ? totalOpenPnl : totalHistPnl).toFixed(0)}
        </span>
      </div>
      {tab === "open" ? (
        <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, overflow: "auto" }}>
          {openPositions.length === 0 ? (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: T.textDim, fontSize: fs(10), fontFamily: T.sans, padding: sp(16) }}>No open positions</div>
          ) : (
          <>
          <div style={{ display: "grid", gridTemplateColumns: "34px 32px 78px 22px 48px 48px 44px 42px 18px", gap: sp(3), fontSize: fs(7), color: T.textMuted, letterSpacing: "0.08em", padding: "0 4px" }}>
            <span>TICK</span><span>SIDE</span><span>CONTRACT</span>
            <span style={{ textAlign: "right" }}>QTY</span>
            <span style={{ textAlign: "right" }}>ENTRY</span>
            <span style={{ textAlign: "right" }}>MARK</span>
            <span style={{ textAlign: "right" }}>P&L</span>
            <span style={{ textAlign: "right" }}>%</span>
            <span></span>
          </div>
          {openPositions.map((p) => {
            const isLoadable = p.contract && p.contract.match(/\d+\s[CP]\s/);
            return (
              <div
                key={p._id}
                onClick={() => {
                  if (isLoadable) {
                    const parsed = parseContract(p.contract);
                    onLoadPosition({ ticker: p.ticker, ...parsed });
                  }
                }}
                title={isLoadable ? `Click to load ${p.ticker} ${p.contract} into Order Ticket` : `${p.ticker} equity position`}
                style={{ display: "grid", gridTemplateColumns: "34px 32px 78px 22px 48px 48px 44px 42px 18px", gap: sp(3), padding: sp("3px 4px"), fontSize: fs(9), fontFamily: T.mono, borderBottom: `1px solid ${T.border}08`, cursor: isLoadable ? "pointer" : "default", alignItems: "center", transition: "background 0.1s", background: p._isUser ? `${T.accent}08` : "transparent" }}
                onMouseEnter={e => { if (isLoadable) e.currentTarget.style.background = T.bg3; }}
                onMouseLeave={e => e.currentTarget.style.background = p._isUser ? `${T.accent}08` : "transparent"}
              >
                <span style={{ fontWeight: 700, color: T.text }}>{p.ticker}</span>
                <span style={{ color: p.side === "LONG" ? T.green : T.red, fontWeight: 600, fontSize: fs(7), padding: sp("1px 4px"), background: p.side === "LONG" ? `${T.green}15` : `${T.red}15`, borderRadius: dim(2), border: `1px solid ${p.side === "LONG" ? T.green : T.red}30`, textAlign: "center", alignSelf: "center" }}>{p.side}</span>
                <span style={{ color: T.textSec, fontSize: fs(8) }}>{p.contract}</span>
                <span style={{ color: T.textDim, textAlign: "right" }}>{p.qty}</span>
                <span style={{ color: T.textDim, textAlign: "right" }}>${p.entry.toFixed(2)}</span>
                <span style={{ color: T.text, fontWeight: 600, textAlign: "right" }}>${p.mark.toFixed(2)}</span>
                <span style={{ color: p.pnl >= 0 ? T.green : T.red, fontWeight: 700, textAlign: "right" }}>{p.pnl >= 0 ? "+" : ""}${p.pnl.toFixed(0)}</span>
                <span style={{ color: p.pct >= 0 ? T.green : T.red, fontWeight: 600, textAlign: "right", fontSize: fs(8) }}>{p.pct >= 0 ? "+" : ""}{p.pct.toFixed(1)}%</span>
                <button
                  onClick={e => { e.stopPropagation(); closeRow(p); }}
                  title={p._isLive ? "Close-out endpoint not wired yet" : "Close position"}
                  disabled={Boolean(p._isLive)}
                  style={{ background: "transparent", border: `1px solid ${T.red}40`, color: T.red, fontSize: fs(9), fontFamily: T.mono, fontWeight: 700, borderRadius: dim(2), cursor: p._isLive ? "not-allowed" : "pointer", padding: sp("1px 0"), lineHeight: 1, opacity: p._isLive ? 0.45 : 1 }}
                >✕</button>
              </div>
            );
          })}
          </>
          )}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, overflow: "auto" }}>
          <div style={{ display: "grid", gridTemplateColumns: "36px 32px 84px 22px 46px 46px 50px 46px 38px", gap: sp(3), fontSize: fs(7), color: T.textMuted, letterSpacing: "0.08em", padding: "0 4px" }}>
            <span>TICK</span><span>SIDE</span><span>CONTRACT</span>
            <span style={{ textAlign: "right" }}>QTY</span>
            <span style={{ textAlign: "right" }}>ENTRY</span>
            <span style={{ textAlign: "right" }}>EXIT</span>
            <span style={{ textAlign: "right" }}>P&L</span>
            <span style={{ textAlign: "right" }}>%</span>
            <span style={{ textAlign: "right" }}>TIME</span>
          </div>
          {TRADE_HISTORY.map((t, i) => {
            const parsed = parseContract(t.contract);
            return (
              <div
                key={i}
                onClick={() => onLoadPosition({ ticker: t.ticker, ...parsed })}
                style={{ display: "grid", gridTemplateColumns: "36px 32px 84px 22px 46px 46px 50px 46px 38px", gap: sp(3), padding: sp("3px 4px"), fontSize: fs(9), fontFamily: T.mono, borderBottom: `1px solid ${T.border}08`, cursor: "pointer", alignItems: "center", transition: "background 0.1s" }}
                onMouseEnter={e => e.currentTarget.style.background = T.bg3}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}
              >
                <span style={{ fontWeight: 700, color: T.text }}>{t.ticker}</span>
                <span style={{ color: t.side === "LONG" ? T.green : T.red, fontWeight: 600, fontSize: fs(7), padding: sp("1px 4px"), background: t.side === "LONG" ? `${T.green}15` : `${T.red}15`, borderRadius: dim(2), border: `1px solid ${t.side === "LONG" ? T.green : T.red}30`, textAlign: "center", alignSelf: "center" }}>{t.side}</span>
                <span style={{ color: T.textSec, fontSize: fs(8) }}>{t.contract}</span>
                <span style={{ color: T.textDim, textAlign: "right" }}>{t.qty}</span>
                <span style={{ color: T.textDim, textAlign: "right" }}>${t.entry.toFixed(2)}</span>
                <span style={{ color: T.textSec, textAlign: "right" }}>${t.exit.toFixed(2)}</span>
                <span style={{ color: t.pnl >= 0 ? T.green : T.red, fontWeight: 700, textAlign: "right" }}>{t.pnl >= 0 ? "+" : ""}${t.pnl.toFixed(0)}</span>
                <span style={{ color: t.pct >= 0 ? T.green : T.red, fontWeight: 600, textAlign: "right", fontSize: fs(8) }}>{t.pct >= 0 ? "+" : ""}{t.pct.toFixed(1)}%</span>
                <span style={{ color: T.textDim, textAlign: "right", fontSize: fs(7) }}>{t.closed === "Today" ? t.time : t.closed}</span>
              </div>
            );
          })}
        </div>
      )}
      <div style={{ display: "flex", gap: sp(4), borderTop: `1px solid ${T.border}`, paddingTop: sp(5), marginTop: "auto" }}>
        <button
          onClick={handleCloseAll}
          style={{ flex: 1, padding: sp("4px 0"), background: "transparent", border: `1px solid ${T.red}40`, borderRadius: dim(3), color: T.red, fontSize: fs(9), fontFamily: T.sans, fontWeight: 600, cursor: "pointer" }}
        >Close All</button>
        <button
          onClick={handleSetStops}
          style={{ flex: 1, padding: sp("4px 0"), background: "transparent", border: `1px solid ${T.border}`, borderRadius: dim(3), color: T.textSec, fontSize: fs(9), fontFamily: T.sans, fontWeight: 600, cursor: "pointer" }}
        >Set Stops</button>
        <button
          onClick={handleRollAll}
          style={{ flex: 1, padding: sp("4px 0"), background: "transparent", border: `1px solid ${T.amber}40`, borderRadius: dim(3), color: T.amber, fontSize: fs(9), fontFamily: T.sans, fontWeight: 600, cursor: "pointer" }}
        >Roll</button>
      </div>
    </div>
  );
};

const TickerUniverseSearchPanel = ({ open, onSelectTicker, onClose }) => {
  const inputRef = useRef(null);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim());
  const searchEnabled = open && deferredQuery.length >= 1;
  const searchQuery = useSearchUniverseTickers(
    searchEnabled
      ? {
          search: deferredQuery,
          market: "stocks",
          active: true,
          limit: 12,
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
  const results = searchQuery.data?.results || [];

  useEffect(() => {
    if (!open) {
      setQuery("");
      return undefined;
    }

    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });

    return () => cancelAnimationFrame(frame);
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <div style={{ padding: sp("6px 6px 0"), background: T.bg1, borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
      <div style={{ background: T.bg2, border: `1px solid ${T.border}`, borderRadius: dim(6), padding: sp("8px 10px"), display: "flex", flexDirection: "column", gap: sp(6) }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: sp(8) }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
            <span style={{ fontSize: fs(10), fontWeight: 700, fontFamily: T.display, color: T.textSec, letterSpacing: "0.06em" }}>SEARCH UNIVERSE</span>
            <span style={{ fontSize: fs(8), color: T.textDim, fontFamily: T.mono }}>Massive reference tickers · active stocks</span>
          </div>
          <button
            onClick={onClose}
            style={{ background: "transparent", border: "none", color: T.textMuted, cursor: "pointer", fontSize: fs(12), lineHeight: 1, padding: 0 }}
            title="Close search"
          >
            ×
          </button>
        </div>
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
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
        <div style={{ minHeight: dim(150), maxHeight: dim(220), overflowY: "auto", border: `1px solid ${T.border}`, borderRadius: dim(4), background: T.bg1 }}>
          {!searchEnabled && (
            <div style={{ padding: sp("12px 10px"), fontSize: fs(10), color: T.textDim, fontFamily: T.sans }}>
              Type at least one character to search the ticker universe.
            </div>
          )}
          {searchEnabled && searchQuery.isPending && (
            <div style={{ padding: sp("12px 10px"), fontSize: fs(10), color: T.textDim, fontFamily: T.sans }}>
              Searching Massive universe…
            </div>
          )}
          {searchEnabled && !searchQuery.isPending && !results.length && (
            <div style={{ padding: sp("12px 10px"), fontSize: fs(10), color: T.textDim, fontFamily: T.sans }}>
              No active stock tickers matched "{deferredQuery}".
            </div>
          )}
          {results.map((result) => (
            <button
              key={result.ticker}
              onClick={() => onSelectTicker(result)}
              style={{
                width: "100%",
                display: "grid",
                gridTemplateColumns: "72px 1fr auto",
                gap: sp(8),
                alignItems: "center",
                padding: sp("9px 10px"),
                background: "transparent",
                border: "none",
                borderBottom: `1px solid ${T.border}20`,
                textAlign: "left",
                cursor: "pointer",
              }}
            >
              <span style={{ fontSize: fs(11), fontWeight: 700, fontFamily: T.mono, color: T.text }}>{result.ticker}</span>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: "block", fontSize: fs(10), color: T.textSec, fontFamily: T.sans, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{result.name}</span>
                <span style={{ display: "block", fontSize: fs(8), color: T.textDim, fontFamily: T.mono }}>
                  {[result.type, result.primaryExchange].filter(Boolean).join(" · ") || "stock"}
                </span>
              </span>
              <span style={{ fontSize: fs(8), color: T.textMuted, fontFamily: T.mono }}>{result.market.toUpperCase()}</span>
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
    <div style={{
      display: "flex", alignItems: "stretch", gap: sp(1), padding: sp("4px 6px 0"),
      background: T.bg1, borderBottom: `1px solid ${T.border}`, overflowX: "auto", flexShrink: 0,
    }}>
      {recent.map(ticker => {
        const info = TRADE_TICKER_INFO[ticker] || TRADE_TICKER_INFO.SPY;
        const pos = info.pct >= 0;
        const isActive = ticker === active;
        return (
          <div
            key={ticker}
            onClick={() => onSelect(ticker)}
            style={{
              display: "flex", alignItems: "center", gap: sp(5),
              padding: sp("4px 8px 5px"),
              background: isActive ? T.bg2 : "transparent",
              borderTop: isActive ? `2px solid ${T.accent}` : "2px solid transparent",
              borderLeft: `1px solid ${isActive ? T.border : "transparent"}`,
              borderRight: `1px solid ${isActive ? T.border : "transparent"}`,
              borderTopLeftRadius: dim(4), borderTopRightRadius: dim(4),
              cursor: "pointer", flexShrink: 0, position: "relative", top: 1,
            }}
          >
            <span style={{
              fontSize: fs(11), fontWeight: 700, fontFamily: T.mono,
              color: isActive ? T.text : T.textSec,
            }}>{ticker}</span>
            <span style={{
              fontSize: fs(9), fontFamily: T.mono, color: pos ? T.green : T.red, fontWeight: 600,
            }}>{pos ? "+" : ""}{info.pct.toFixed(2)}%</span>
            {recent.length > 1 && (
              <button
                onClick={e => { e.stopPropagation(); onClose && onClose(ticker); }}
                title="Close"
                style={{
                  background: "transparent", border: "none", color: T.textMuted, cursor: "pointer",
                  fontSize: fs(11), padding: 0, lineHeight: 1, marginLeft: sp(2),
                }}
              >×</button>
            )}
          </div>
        );
      })}
      <button
        onClick={onAddNew}
        title="Add ticker"
        style={{
          background: "transparent", border: "none", color: T.textDim, cursor: "pointer",
          fontSize: fs(13), padding: sp("3px 8px"), fontWeight: 600, lineHeight: 1,
        }}
      >+</button>
    </div>
  );
};

// ─── COMPACT TICKER HEADER ───
// One row showing ticker + price + key stats. Replaces the wide account strip on Trade tab.
const TradeTickerHeader = ({ ticker, chainRows = [], expiration, chainStatus = "empty" }) => {
  const info = TRADE_TICKER_INFO[ticker] || TRADE_TICKER_INFO.SPY;
  const pos = info.pct >= 0;
  const atmRow = chainRows.find(r => r.isAtm);
  const impMove = atmRow ? (atmRow.cPrem + atmRow.pPrem) * 0.85 : null;
  const impPct = impMove != null && info.price > 0 ? (impMove / info.price) * 100 : null;
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: sp(16),
      background: T.bg2, border: `1px solid ${T.border}`, borderRadius: dim(6),
      padding: sp("8px 14px"), flexShrink: 0,
    }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: sp(8) }}>
        <span style={{ fontSize: fs(20), fontWeight: 800, fontFamily: T.display, color: T.text, letterSpacing: "-0.02em" }}>{ticker}</span>
        <span style={{ fontSize: fs(11), color: T.textDim, fontFamily: T.sans }}>{info.name || ticker}</span>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: sp(8) }}>
        <span style={{ fontSize: fs(22), fontWeight: 700, fontFamily: T.mono, color: T.text }}>{info.price.toFixed(2)}</span>
        <span style={{ fontSize: fs(12), fontWeight: 600, fontFamily: T.mono, color: pos ? T.green : T.red }}>
          {pos ? "▲ +" : "▼ "}{info.chg.toFixed(2)}
        </span>
        <span style={{ fontSize: fs(12), fontWeight: 600, fontFamily: T.mono, color: pos ? T.green : T.red }}>
          ({pos ? "+" : ""}{info.pct.toFixed(2)}%)
        </span>
      </div>
      <span style={{ flex: 1 }} />
      <div style={{ display: "flex", gap: sp(14), fontSize: fs(10), fontFamily: T.mono }}>
        <div><span style={{ color: T.textMuted }}>VOL </span><span style={{ color: T.text, fontWeight: 600 }}>{fmtQuoteVolume(info.volume)}</span></div>
        <div><span style={{ color: T.textMuted }}>IV </span><span style={{ color: T.text, fontWeight: 600 }}>{(info.iv * 100).toFixed(1)}%</span></div>
        <div><span style={{ color: T.textMuted }}>IMP </span><span style={{ color: impMove != null ? T.cyan : T.textDim, fontWeight: 700 }}>{impMove != null ? `±$${impMove.toFixed(2)}` : "—"}</span> <span style={{ color: T.textDim }}>{impPct != null ? `(${impPct.toFixed(2)}%)` : ""}</span></div>
        <div><span style={{ color: T.textMuted }}>ATM </span><span style={{ color: T.accent, fontWeight: 600 }}>{Math.round(info.price / 5) * 5}</span></div>
        <div><span style={{ color: T.textMuted }}>CHAIN </span><span style={{ color: chainStatus === "live" ? T.accent : T.textDim, fontWeight: 600 }}>{chainStatus}</span></div>
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

const TradeEquityPanel = ({ ticker, flowEvents = [] }) => {
  const [tf, setTf] = useState("5m");
  const [drawings, setDrawings] = useState([]);
  const [drawMode, setDrawMode] = useState(null);
  const [selectedIndicators, setSelectedIndicators] = useState(["ema-21", "ema-55"]);
  const tfMeta = TRADE_TIMEFRAMES.find(x => x.v === tf) || TRADE_TIMEFRAMES[1];
  const barsQuery = useQuery({
    queryKey: ["trade-equity-bars", ticker, tf, tfMeta.bars],
    queryFn: () => getBarsRequest({
      symbol: ticker,
      timeframe: tf,
      limit: tfMeta.bars,
    }),
    ...QUERY_DEFAULTS,
  });
  const streamedSourceBars = useMassiveStreamedStockBars({
    symbol: ticker,
    timeframe: tf,
    bars: barsQuery.data?.bars,
    enabled: Boolean(ticker),
  });
  const bars = useMemo(
    () => buildTradeBarsFromApi(streamedSourceBars),
    [streamedSourceBars],
  );
  const barsStatus = bars.length
    ? "live"
    : barsQuery.isPending
      ? "loading"
      : barsQuery.isError
        ? "offline"
        : "empty";
  const markers = useMemo(
    () => (flowEvents.length ? buildTradeFlowMarkersFromEvents(flowEvents, bars.length) : []),
    [bars.length, flowEvents],
  );
  const chartMarkers = useMemo(
    () => markers.flatMap((marker, index) => {
      const targetBar = bars[marker?.barIdx];
      const rawTime = targetBar?.time;
      const time = typeof rawTime === "number"
        ? (rawTime > 1e12 ? Math.floor(rawTime / 1000) : Math.floor(rawTime))
        : null;
      if (!time) return [];

      const isCall = marker.cp === "C";
      return [{
        id: `trade-flow-${ticker}-${index}-${time}`,
        time,
        barIndex: marker.barIdx,
        position: isCall ? "belowBar" : "aboveBar",
        shape: isCall ? "arrowUp" : "arrowDown",
        color: marker.golden ? T.amber : isCall ? T.green : T.red,
        size: marker.golden ? 1.6 : marker.size === "lg" ? 1.25 : marker.size === "md" ? 1 : 0.8,
        text: marker.golden ? "G" : "",
      }];
    }),
    [bars, markers, ticker],
  );
  const chartModel = useMemo(
    () => buildResearchChartModel({
      bars,
      timeframe: tf,
      selectedIndicators,
      indicatorMarkers: chartMarkers,
    }),
    [bars, chartMarkers, selectedIndicators, tf],
  );
  const callFlows = markers.filter(m => m.cp === "C").length;
  const putFlows = markers.filter(m => m.cp === "P").length;
  const toggleIndicator = (indicatorId) => {
    setSelectedIndicators((current) => (
      current.includes(indicatorId)
        ? current.filter((value) => value !== indicatorId)
        : [...current, indicatorId]
    ));
  };

  return (
    <ResearchChartFrame
      dataTestId="trade-equity-chart"
      theme={T}
      themeKey={CURRENT_THEME}
      model={chartModel}
      drawings={drawings}
      drawMode={drawMode}
      onAddDrawing={(drawing) => setDrawings(prev => [...prev, drawing])}
      header={(
        <div style={{ display: "flex", alignItems: "center", padding: sp("6px 10px"), borderBottom: `1px solid ${T.border}`, gap: sp(8), flexShrink: 0 }}>
          <span style={{ fontSize: fs(10), fontWeight: 700, fontFamily: T.display, color: T.textSec, letterSpacing: "0.06em" }}>EQUITY</span>
          <div style={{ display: "flex", gap: sp(2) }}>
            {TRADE_TIMEFRAMES.map(t => (
              <button
                key={t.v}
                type="button"
                aria-pressed={t.v === tf}
                onClick={() => setTf(t.v)}
                style={{ padding: sp("2px 8px"), background: t.v === tf ? T.accentDim : "transparent", border: `1px solid ${t.v === tf ? T.accent : T.border}`, borderRadius: dim(3), color: t.v === tf ? T.accent : T.textDim, fontSize: fs(9), fontFamily: T.mono, fontWeight: 600, cursor: "pointer" }}
              >{t.tag}</button>
            ))}
          </div>
          <span style={{ flex: 1 }} />
          <div style={{ display: "flex", gap: sp(2) }}>
            <button
              type="button"
              aria-pressed={drawMode === "horizontal"}
              onClick={() => setDrawMode(drawMode === "horizontal" ? null : "horizontal")}
              title="Horizontal level"
              style={{ padding: sp("2px 8px"), background: drawMode === "horizontal" ? `${T.amber}25` : "transparent", border: `1px solid ${drawMode === "horizontal" ? T.amber : T.border}`, borderRadius: dim(3), color: drawMode === "horizontal" ? T.amber : T.textDim, fontSize: fs(9), fontFamily: T.mono, cursor: "pointer" }}
            >─ H</button>
            <button
              type="button"
              aria-pressed={drawMode === "vertical"}
              onClick={() => setDrawMode(drawMode === "vertical" ? null : "vertical")}
              title="Vertical marker"
              style={{ padding: sp("2px 8px"), background: drawMode === "vertical" ? `${T.amber}25` : "transparent", border: `1px solid ${drawMode === "vertical" ? T.amber : T.border}`, borderRadius: dim(3), color: drawMode === "vertical" ? T.amber : T.textDim, fontSize: fs(9), fontFamily: T.mono, cursor: "pointer" }}
            >│ V</button>
            <button
              type="button"
              aria-pressed={drawMode === "box"}
              onClick={() => setDrawMode(drawMode === "box" ? null : "box")}
              title="Range box"
              style={{ padding: sp("2px 8px"), background: drawMode === "box" ? `${T.amber}25` : "transparent", border: `1px solid ${drawMode === "box" ? T.amber : T.border}`, borderRadius: dim(3), color: drawMode === "box" ? T.amber : T.textDim, fontSize: fs(9), fontFamily: T.mono, cursor: "pointer" }}
            >□ B</button>
            <button
              type="button"
              aria-pressed="false"
              onClick={() => { setDrawings([]); setDrawMode(null); }}
              title="Clear drawings"
              style={{ padding: sp("2px 8px"), background: "transparent", border: `1px solid ${T.border}`, borderRadius: dim(3), color: T.textDim, fontSize: fs(9), fontFamily: T.mono, cursor: "pointer" }}
            >✕</button>
          </div>
          <span style={{ fontSize: fs(8), color: barsStatus === "live" ? T.accent : T.textDim, fontFamily: T.mono }}>
            {barsStatus === "live" ? `Massive ${tf}` : barsStatus}
          </span>
          <div style={{ fontSize: fs(9), fontFamily: T.mono, color: T.textMuted }}>
            <span style={{ color: T.green }}>C {callFlows}</span> · <span style={{ color: T.red }}>P {putFlows}</span> · <span style={{ color: T.amber }}>UOA amber</span>
          </div>
        </div>
      )}
      subHeader={(
        <div style={{ display: "flex", alignItems: "center", gap: sp(6), padding: sp("4px 10px"), borderBottom: `1px solid ${T.border}`, flexWrap: "wrap", flexShrink: 0 }}>
          <span style={{ fontSize: fs(8), color: T.textMuted, fontFamily: T.mono, letterSpacing: "0.06em" }}>STUDIES</span>
          {EQUITY_CHART_STUDIES.map((study) => {
            const active = selectedIndicators.includes(study.id);
            return (
              <button
                key={study.id}
                type="button"
                aria-pressed={active}
                onClick={() => toggleIndicator(study.id)}
                style={{
                  padding: sp("2px 7px"),
                  background: active ? T.accentDim : "transparent",
                  border: `1px solid ${active ? T.accent : T.border}`,
                  borderRadius: dim(3),
                  color: active ? T.accent : T.textDim,
                  fontSize: fs(8),
                  fontFamily: T.mono,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {study.label}
              </button>
            );
          })}
        </div>
      )}
    />
  );
};

// ─── FOCUSED OPTIONS CHAIN PANEL ───
// Taller chain panel. Header has expiration selector + implied move + ATM strike.
const TradeChainPanel = ({ ticker, contract, chainRows = [], expirations = [], onSelectContract, onChangeExp, chainStatus = "empty" }) => {
  const info = TRADE_TICKER_INFO[ticker] || TRADE_TICKER_INFO.SPY;
  const chain = chainRows;
  const expirationOptions = expirations.length ? expirations : [{ value: contract.exp, label: contract.exp, dte: daysToExpiration(contract.exp) }];
  const expInfo = expirationOptions.find(e => e.value === contract.exp) || expirationOptions[0] || { value: contract.exp, label: contract.exp, dte: daysToExpiration(contract.exp) };
  const heldForTicker = OPEN_POSITIONS.filter(p => p.ticker === ticker).map(p => {
    const parts = p.contract.split(" ");
    return { strike: parseInt(parts[0], 10), cp: parts[1], exp: parts[2] };
  }).filter(hp => hp.exp === contract.exp);

  return (
    <div style={{ background: T.bg2, border: `1px solid ${T.border}`, borderRadius: dim(6), display: "flex", flexDirection: "column", overflow: "hidden", height: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", padding: sp("6px 10px"), borderBottom: `1px solid ${T.border}`, gap: sp(8), flexShrink: 0 }}>
        <span style={{ fontSize: fs(10), fontWeight: 700, fontFamily: T.display, color: T.textSec, letterSpacing: "0.06em" }}>OPTIONS CHAIN</span>
        <select
          value={expInfo.value}
          onChange={e => onChangeExp(e.target.value)}
          style={{ background: T.bg3, border: `1px solid ${T.border}`, color: T.text, fontSize: fs(9), fontFamily: T.mono, fontWeight: 600, cursor: "pointer", padding: sp("2px 6px"), borderRadius: dim(3), outline: "none" }}
        >
          {expirationOptions.map(ex => <option key={ex.value} value={ex.value}>{ex.label} · {ex.dte}d</option>)}
        </select>
        <span style={{ fontSize: fs(9), color: expInfo.dte === 0 ? T.amber : T.textDim, fontFamily: T.mono, fontWeight: expInfo.dte === 0 ? 700 : 400 }}>{expInfo.dte}d</span>
        <span style={{ flex: 1 }} />
        {(() => {
          const atmRow = chain.find(r => r.isAtm);
          const impMove = atmRow ? (atmRow.cPrem + atmRow.pPrem) * 0.85 : null;
          const impPct = impMove != null && info.price > 0 ? (impMove / info.price) * 100 : null;
          return <span style={{ fontSize: fs(9), fontFamily: T.mono }}>IMP <span style={{ color: impMove != null ? T.cyan : T.textDim, fontWeight: 700 }}>{impMove != null ? `±$${impMove.toFixed(2)}` : "—"}</span> <span style={{ color: T.textDim }}>{impPct != null ? `(${impPct.toFixed(2)}%)` : ""}</span></span>;
        })()}
        <span style={{ fontSize: fs(9), fontFamily: T.mono }}>ATM <span style={{ color: T.accent, fontWeight: 700 }}>{Math.round(info.price / 5) * 5}</span></span>
        <span style={{ fontSize: fs(8), color: chainStatus === "live" ? T.accent : T.textDim, fontFamily: T.mono }}>{chainStatus === "live" ? "pan ↔ for Γ Θ V" : `chain ${chainStatus}`}</span>
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
const TradeContractDetailPanel = ({ ticker, contract, chainRows = [], chainStatus = "empty" }) => {
  const selectedRow = chainRows.find(r => r.k === contract.strike);
  const basePrem = selectedRow ? (contract.cp === "C" ? selectedRow.cPrem : selectedRow.pPrem) : null;
  const contractMeta = contract.cp === "C" ? selectedRow?.cContract : selectedRow?.pContract;
  const [tf, setTf] = useState("5m");
  const tfMeta = TRADE_TIMEFRAMES.find(x => x.v === tf) || TRADE_TIMEFRAMES[1];
  const optionBarsQuery = useQuery({
    queryKey: ["trade-option-bars", contractMeta?.ticker, tf, tfMeta.bars],
    queryFn: () => getBarsRequest({
      symbol: contractMeta.ticker,
      timeframe: tf,
      limit: tfMeta.bars,
    }),
    enabled: Boolean(contractMeta?.ticker),
    ...QUERY_DEFAULTS,
  });
  const optionDailyBarsQuery = useQuery({
    queryKey: ["trade-option-bars-daily", contractMeta?.ticker],
    queryFn: () => getBarsRequest({
      symbol: contractMeta.ticker,
      timeframe: "1d",
      limit: 60,
    }),
    enabled: Boolean(contractMeta?.ticker) && tf !== "1d",
    ...QUERY_DEFAULTS,
  });
  const liveIntradayBars = buildTradeBarsFromApi(optionBarsQuery.data?.bars);
  const liveDailyBars = buildTradeBarsFromApi(optionDailyBarsQuery.data?.bars);
  const optBars = useMemo(() => {
    if (liveIntradayBars.length) return liveIntradayBars;
    if (liveDailyBars.length) return liveDailyBars;
    return [];
  }, [liveDailyBars, liveIntradayBars]);
  const contractColor = contract.cp === "C" ? T.green : T.red;
  const contractStr = `${ticker} ${contract.strike}${contract.cp} ${contract.exp}`;
  const heldForTicker = OPEN_POSITIONS.filter(p => p.ticker === ticker).map(p => {
    const parts = p.contract.split(" ");
    return { strike: parseInt(parts[0], 10), cp: parts[1], exp: parts[2], entry: p.entry, pnl: p.pnl, pct: p.pct };
  });
  const activeHolding = heldForTicker.find(hp => hp.strike === contract.strike && hp.cp === contract.cp && hp.exp === contract.exp);
  const hasLiveIntradayBars = liveIntradayBars.length > 0;
  const hasLiveDailyBars = liveDailyBars.length > 0;
  const resolvedChartTimeframe = hasLiveIntradayBars ? tf : hasLiveDailyBars ? "1d" : tf;
  const sourceLabel = !contractMeta
    ? chainStatus === "loading"
      ? "waiting on live chain"
      : "no live contract selected"
    : hasLiveIntradayBars
      ? `Massive ${tf}`
      : hasLiveDailyBars
        ? "Massive 1d fallback"
        : optionBarsQuery.isPending || optionDailyBarsQuery.isPending
          ? `loading ${tf}`
          : optionBarsQuery.isError || optionDailyBarsQuery.isError
            ? "contract bars unavailable"
            : "no live contract bars";

  return (
    <div style={{ background: T.bg2, border: `1px solid ${T.border}`, borderRadius: dim(6), display: "flex", flexDirection: "column", overflow: "hidden", height: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", padding: sp("6px 10px"), borderBottom: `1px solid ${T.border}`, gap: sp(8), flexShrink: 0 }}>
        <span style={{ fontSize: fs(10), fontWeight: 700, fontFamily: T.display, color: T.textSec, letterSpacing: "0.06em" }}>CONTRACT</span>
        <span style={{ fontSize: fs(11), fontWeight: 700, fontFamily: T.mono, color: contractColor }}>{contract.strike}{contract.cp}</span>
        <span style={{ fontSize: fs(9), color: T.textDim, fontFamily: T.mono }}>{contract.exp}</span>
        <div style={{ display: "flex", gap: sp(2) }}>
          {TRADE_TIMEFRAMES.map(t => (
            <button
              key={t.v}
              onClick={() => setTf(t.v)}
              style={{ padding: sp("2px 7px"), background: t.v === tf ? T.accentDim : "transparent", border: `1px solid ${t.v === tf ? T.accent : T.border}`, borderRadius: dim(3), color: t.v === tf ? T.accent : T.textDim, fontSize: fs(8), fontFamily: T.mono, fontWeight: 600, cursor: "pointer" }}
            >{t.tag}</button>
          ))}
        </div>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: fs(8), color: hasLiveIntradayBars ? T.green : hasLiveDailyBars ? T.cyan : optionBarsQuery.isPending || optionDailyBarsQuery.isPending ? T.accent : T.textDim, fontFamily: T.mono }}>
          {hasLiveIntradayBars ? "live contract bars" : hasLiveDailyBars ? "daily contract fallback" : optionBarsQuery.isPending || optionDailyBarsQuery.isPending ? "loading contract bars" : "no live contract bars"}
        </span>
        {activeHolding && (
          <span style={{ padding: sp("2px 6px"), background: `${T.amber}18`, border: `1px solid ${T.amber}50`, borderRadius: dim(3), fontSize: fs(9), fontFamily: T.mono, fontWeight: 700, color: T.amber }}>★ HOLDING {activeHolding.qty || ""}</span>
        )}
        {activeHolding && (
          <span style={{ fontSize: fs(11), fontFamily: T.mono, fontWeight: 700, color: activeHolding.pnl >= 0 ? T.green : T.red }}>
            {activeHolding.pnl >= 0 ? "+" : ""}${activeHolding.pnl}
          </span>
        )}
        <span style={{ fontSize: fs(13), fontWeight: 700, fontFamily: T.mono, color: contractColor }}>{typeof basePrem === "number" ? `$${basePrem.toFixed(2)}` : "—"}</span>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <TradeOptionChart
          bars={optBars}
          color={contractColor}
          contract={contractStr}
          holding={activeHolding}
          timeframe={resolvedChartTimeframe}
          sourceLabel={sourceLabel}
        />
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
  const cx = size / 2, cy = size / 2;
  const r = size / 2 - 4;
  const innerR = r - thickness;

  // Colors: 0DTE bright, longer-dated darker
  const callShades = ["#34d399", "#10b981", "#059669", "#047857"];
  const putShades  = ["#fca5a5", "#f87171", "#ef4444", "#b91c1c"];

  // Build segments: all call buckets first (clockwise from top), then put buckets (counter-clockwise)
  const segs = [];
  data.forEach((b, i) => segs.push({ value: b.callPrem, color: callShades[i] }));
  data.slice().reverse().forEach((b, i) => segs.push({ value: b.putPrem, color: putShades[data.length - 1 - i] }));

  let cumAngle = -Math.PI / 2;
  const paths = segs.map((seg, i) => {
    const angle = (seg.value / total) * 2 * Math.PI;
    if (angle <= 0.001) return null;
    const startAngle = cumAngle;
    const endAngle = cumAngle + angle;
    cumAngle = endAngle;
    const x1 = cx + r * Math.cos(startAngle), y1 = cy + r * Math.sin(startAngle);
    const x2 = cx + r * Math.cos(endAngle),   y2 = cy + r * Math.sin(endAngle);
    const x3 = cx + innerR * Math.cos(endAngle),   y3 = cy + innerR * Math.sin(endAngle);
    const x4 = cx + innerR * Math.cos(startAngle), y4 = cy + innerR * Math.sin(startAngle);
    const largeArc = angle > Math.PI ? 1 : 0;
    const d = `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} L ${x3} ${y3} A ${innerR} ${innerR} 0 ${largeArc} 0 ${x4} ${y4} Z`;
    return <path key={i} d={d} fill={seg.color} stroke={T.bg2} strokeWidth={1} />;
  });

  const callPct = ((totalCall / total) * 100).toFixed(0);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {paths}
      <text x={cx} y={cy - 3} textAnchor="middle" fontSize={fs(7)} fill={T.textMuted} fontFamily={T.mono} letterSpacing="0.08em">C/P</text>
      <text x={cx} y={cy + fs(11)} textAnchor="middle" fontSize={fs(11)} fontWeight={700} fill={callPct >= 60 ? T.green : callPct <= 40 ? T.red : T.amber} fontFamily={T.mono}>{callPct}/{100 - callPct}</text>
    </svg>
  );
};

// Sub-component: Strike heatmap (vertical bars centered on ATM)
const StrikeHeatmap = ({ data, height = 130 }) => {
  const maxPrem = Math.max(...data.map(d => d.total)) || 1;
  const cellW = 100 / data.length;
  return (
    <div style={{ width: "100%", height, display: "flex", flexDirection: "column", gap: sp(2) }}>
      {/* Bars area — for each strike, two stacked bars (call top half, put bottom half) */}
      <div style={{ flex: 1, display: "flex", alignItems: "center", borderBottom: `1px solid ${T.border}`, position: "relative" }}>
        {/* ATM marker line */}
        {(() => {
          const atmIdx = data.findIndex(d => d.isATM);
          const atmLeft = (atmIdx + 0.5) * cellW;
          return (
            <div style={{ position: "absolute", left: `${atmLeft}%`, top: 0, bottom: 0, width: 1, background: T.accent, opacity: 0.6, zIndex: 1 }} />
          );
        })()}
        {data.map((d, i) => {
          const callH = (d.callPrem / maxPrem) * 50;
          const putH  = (d.putPrem  / maxPrem) * 50;
          const intensity = d.total / maxPrem;
          return (
            <div key={i} title={`${d.strike}: C $${d.callPrem}K / P $${d.putPrem}K`} style={{
              flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              height: "100%", gap: 1, position: "relative",
            }}>
              {/* Call bar grows up from middle */}
              <div style={{
                width: "75%", height: `${callH}%`,
                background: T.green, opacity: 0.4 + intensity * 0.55, borderRadius: `${dim(2)}px ${dim(2)}px 0 0`,
                marginTop: "auto",
              }} />
              {/* Put bar grows down from middle */}
              <div style={{
                width: "75%", height: `${putH}%`,
                background: T.red, opacity: 0.4 + intensity * 0.55, borderRadius: `0 0 ${dim(2)}px ${dim(2)}px`,
                marginBottom: "auto",
              }} />
            </div>
          );
        })}
      </div>
      {/* Strike labels along bottom — show every other to avoid crowding */}
      <div style={{ display: "flex", fontSize: fs(7), fontFamily: T.mono, color: T.textMuted }}>
        {data.map((d, i) => (
          <div key={i} style={{
            flex: 1, textAlign: "center",
            color: d.isATM ? T.accent : T.textMuted, fontWeight: d.isATM ? 700 : 400,
          }}>{(i % 2 === 0 || d.isATM) ? d.strike : ""}</div>
        ))}
      </div>
    </div>
  );
};

// Sub-component: Cumulative net premium flow timeline
const NetFlowTimeline = ({ data, height = 130 }) => {
  const maxAbs = Math.max(...data.map(d => Math.abs(d.cumNet))) || 1;
  const yMin = -maxAbs * 1.1, yMax = maxAbs * 1.1;
  const w = 320, h = height - 22; // reserve space for x-axis labels
  const padL = 30, padR = 4, padT = 4, padB = 0;
  const chartW = w - padL - padR;
  const chartH = h - padT - padB;
  const xScale = i => padL + (i / (data.length - 1)) * chartW;
  const yScale = v => padT + chartH - ((v - yMin) / (yMax - yMin)) * chartH;
  const zeroY = yScale(0);

  // Build path strings for above-zero (green) and below-zero (red) areas
  const cumNetVals = data.map(d => d.cumNet);
  const buildArea = (vals, sign) => {
    let path = `M ${padL} ${zeroY}`;
    vals.forEach((v, i) => {
      const y = sign > 0 ? Math.min(yScale(v), zeroY) : Math.max(yScale(v), zeroY);
      path += ` L ${xScale(i)} ${y}`;
    });
    path += ` L ${xScale(vals.length - 1)} ${zeroY} Z`;
    return path;
  };
  const linePath = data.map((d, i) => `${i === 0 ? "M" : "L"} ${xScale(i)} ${yScale(d.cumNet)}`).join(" ");
  const finalNet = data[data.length - 1].cumNet;

  return (
    <div style={{ width: "100%", height, display: "flex", flexDirection: "column" }}>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: "100%", flex: 1, overflow: "visible" }}>
        {/* Y-axis labels */}
        <text x={padL - 3} y={yScale(maxAbs) + 3} fontSize={fs(7)} fill={T.textMuted} fontFamily={T.mono} textAnchor="end">+{maxAbs.toFixed(0)}</text>
        <text x={padL - 3} y={zeroY + 3} fontSize={fs(7)} fill={T.textMuted} fontFamily={T.mono} textAnchor="end">0</text>
        <text x={padL - 3} y={yScale(-maxAbs) + 3} fontSize={fs(7)} fill={T.textMuted} fontFamily={T.mono} textAnchor="end">-{maxAbs.toFixed(0)}</text>
        {/* Zero line */}
        <line x1={padL} y1={zeroY} x2={w - padR} y2={zeroY} stroke={T.border} strokeWidth={0.5} />
        {/* Green area above zero */}
        <path d={buildArea(cumNetVals, 1)} fill={T.green} fillOpacity={0.25} />
        {/* Red area below zero */}
        <path d={buildArea(cumNetVals, -1)} fill={T.red} fillOpacity={0.25} />
        {/* Line on top */}
        <path d={linePath} fill="none" stroke={finalNet >= 0 ? T.green : T.red} strokeWidth={1.5} />
        {/* Final value dot */}
        <circle cx={xScale(data.length - 1)} cy={yScale(finalNet)} r={3} fill={finalNet >= 0 ? T.green : T.red} stroke={T.bg2} strokeWidth={1} />
      </svg>
      {/* Time axis labels (3 ticks: open, mid, close) */}
      <div style={{ display: "flex", justifyContent: "space-between", padding: sp("0 4px 0 24px"), fontSize: fs(7), fontFamily: T.mono, color: T.textMuted, marginTop: sp(2) }}>
        <span>9:30</span>
        <span>12:45</span>
        <span>16:00</span>
      </div>
    </div>
  );
};

const TradeOptionsFlowPanel = ({ ticker, flowEvents = [] }) => {
  const info = TRADE_TICKER_INFO[ticker] || TRADE_TICKER_INFO.SPY;
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

  if (!flowEvents.length || !dteData.length || !strikeData.length || !timelineData.length) {
    return (
      <div style={{ background: T.bg2, border: `1px solid ${T.border}`, borderRadius: dim(6), padding: sp("8px 10px"), display: "flex", flexDirection: "column", gap: sp(4), overflow: "hidden", height: "100%" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: `1px solid ${T.border}`, paddingBottom: sp(4) }}>
          <span style={{ fontSize: fs(10), fontWeight: 700, fontFamily: T.display, color: T.textSec, letterSpacing: "0.06em" }}>OPTIONS ORDER FLOW</span>
          <span style={{ fontSize: fs(9), color: T.textDim, fontFamily: T.mono }}>{ticker} · no live data</span>
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
    <div style={{ background: T.bg2, border: `1px solid ${T.border}`, borderRadius: dim(6), padding: sp("8px 10px"), display: "flex", flexDirection: "column", gap: sp(4), overflow: "hidden", height: "100%" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: `1px solid ${T.border}`, paddingBottom: sp(4) }}>
        <span style={{ fontSize: fs(10), fontWeight: 700, fontFamily: T.display, color: T.textSec, letterSpacing: "0.06em" }}>OPTIONS ORDER FLOW</span>
        <div style={{ display: "flex", gap: sp(8), fontSize: fs(9), fontFamily: T.mono }}>
          <span style={{ color: T.green, fontWeight: 600 }}>C ${(totalCall / 1000).toFixed(2)}M</span>
          <span style={{ color: T.red, fontWeight: 600 }}>P ${(totalPut / 1000).toFixed(2)}M</span>
          <span style={{ color: finalNet >= 0 ? T.green : T.red, fontWeight: 700 }}>NET {finalNet >= 0 ? "+" : ""}${(finalNet / 1000).toFixed(2)}M</span>
        </div>
        <span style={{ fontSize: fs(9), color: T.textDim, fontFamily: T.mono }}>{ticker} · today</span>
      </div>

      {/* 3 visualizations in a row */}
      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "auto 1fr 1fr", gap: sp(8), minHeight: 0 }}>
        {/* DTE Donut on left */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: sp(3), justifyContent: "space-between" }}>
          <div style={{ fontSize: fs(8), color: T.textMuted, letterSpacing: "0.08em", whiteSpace: "nowrap" }}>BY DTE</div>
          <DTEDonut data={dteData} size={dim(94)} thickness={dim(15)} />
          <div style={{ display: "flex", flexDirection: "column", gap: 1, fontSize: fs(8), fontFamily: T.mono, width: "100%" }}>
            {dteData.map((b, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "32px 1fr 1fr", gap: sp(3), alignItems: "center" }}>
                <span style={{ color: T.textMuted, fontWeight: 600 }}>{b.label}</span>
                <span style={{ color: T.green, textAlign: "right" }}>{b.callPrem.toFixed(0)}</span>
                <span style={{ color: T.red, textAlign: "right" }}>{b.putPrem.toFixed(0)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Strike Heatmap in middle */}
        <div style={{ display: "flex", flexDirection: "column", gap: sp(3), minWidth: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: fs(8), color: T.textMuted, letterSpacing: "0.08em", whiteSpace: "nowrap" }}>STRIKE · ATM</div>
            <div style={{ display: "flex", gap: sp(6), fontSize: fs(7), fontFamily: T.mono }}>
              <span style={{ color: T.green }}>▲ calls</span>
              <span style={{ color: T.red }}>▼ puts</span>
            </div>
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            <StrikeHeatmap data={strikeData} height={dim(130)} />
          </div>
        </div>

        {/* Timeline on right */}
        <div style={{ display: "flex", flexDirection: "column", gap: sp(3), minWidth: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: fs(8), color: T.textMuted, letterSpacing: "0.08em", whiteSpace: "nowrap" }}>NET · intraday</div>
            <span style={{ fontSize: fs(9), fontFamily: T.mono, color: finalNet >= 0 ? T.green : T.red, fontWeight: 700 }}>
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
      <div style={{ background: T.bg2, border: `1px solid ${T.border}`, borderRadius: dim(6), padding: sp("8px 10px"), display: "flex", flexDirection: "column", gap: sp(4), overflow: "hidden", height: "100%" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: `1px solid ${T.border}`, paddingBottom: sp(4) }}>
          <span style={{ fontSize: fs(10), fontWeight: 700, fontFamily: T.display, color: T.textSec, letterSpacing: "0.06em" }}>SPOT FLOW</span>
          <span style={{ fontSize: fs(9), color: T.textDim, fontFamily: T.mono }}>{ticker} · no live data</span>
        </div>
        <DataUnavailableState
          title="No live spot flow"
          detail={`This panel only renders API-backed buy and sell flow for ${ticker}.`}
        />
      </div>
    );
  }
  const totalBuy = tickerFlow.buyXL + tickerFlow.buyL + tickerFlow.buyM + tickerFlow.buyS;
  const totalSell = tickerFlow.sellXL + tickerFlow.sellL + tickerFlow.sellM + tickerFlow.sellS;
  const buyPct = ((totalBuy / Math.max(totalBuy + totalSell, 1)) * 100).toFixed(1);
  const max = Math.max(tickerFlow.buyXL, tickerFlow.buyL, tickerFlow.buyM, tickerFlow.buyS, tickerFlow.sellXL, tickerFlow.sellL, tickerFlow.sellM, tickerFlow.sellS);
  return (
    <div style={{ background: T.bg2, border: `1px solid ${T.border}`, borderRadius: dim(6), padding: sp("8px 10px"), display: "flex", flexDirection: "column", gap: sp(4), overflow: "hidden", height: "100%" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: `1px solid ${T.border}`, paddingBottom: sp(4) }}>
        <span style={{ fontSize: fs(10), fontWeight: 700, fontFamily: T.display, color: T.textSec, letterSpacing: "0.06em" }}>SPOT FLOW</span>
        <span style={{ fontSize: fs(9), color: T.textDim, fontFamily: T.mono }}>{ticker} · today</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: sp(8) }}>
        <OrderFlowDonut flow={tickerFlow} size={dim(78)} thickness={dim(12)} />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: sp(3) }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontFamily: T.mono, fontSize: fs(10) }}>
            <span style={{ color: T.green, fontWeight: 700 }}>${totalBuy.toFixed(0)}M</span>
            <span style={{ color: T.red, fontWeight: 700 }}>${totalSell.toFixed(0)}M</span>
          </div>
          <div style={{ display: "flex", height: dim(4), borderRadius: dim(2), overflow: "hidden", background: T.bg3 }}>
            <div style={{ width: `${buyPct}%`, background: T.green, opacity: 0.85 }} />
            <div style={{ width: `${100 - buyPct}%`, background: T.red, opacity: 0.85 }} />
          </div>
          <div style={{ fontSize: fs(9), color: T.textDim, fontFamily: T.mono }}>{buyPct}% buy · <span style={{ color: totalBuy >= totalSell ? T.green : T.red, fontWeight: 600 }}>{totalBuy >= totalSell ? "BULLISH" : "BEARISH"}</span></div>
        </div>
      </div>
      <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: sp(3) }}>
        <SizeBucketRow label="XL" buy={tickerFlow.buyXL} sell={tickerFlow.sellXL} maxValue={max} />
        <SizeBucketRow label="L"  buy={tickerFlow.buyL}  sell={tickerFlow.sellL}  maxValue={max} />
        <SizeBucketRow label="M"  buy={tickerFlow.buyM}  sell={tickerFlow.sellM}  maxValue={max} />
        <SizeBucketRow label="S"  buy={tickerFlow.buyS}  sell={tickerFlow.sellS}  maxValue={max} />
      </div>
    </div>
  );
};

const TradeScreen = ({ sym, symPing, environment, accountId, executionConfigured }) => {
  const toast = useToast();
  const queryClient = useQueryClient();
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
    return [initialTicker, "QQQ", "NVDA"].filter((t, i, a) => a.indexOf(t) === i);
  })();
  const initialContracts = (() => {
    const persistedContracts = _initialState.tradeContracts;
    return persistedContracts && typeof persistedContracts === "object" ? persistedContracts : {};
  })();
  const [activeTicker, setActiveTicker] = useState(initialTicker);
  const [recentTickers, setRecentTickers] = useState(initialRecent);
  const [contracts, setContracts] = useState(initialContracts);
  const [showUniverseSearch, setShowUniverseSearch] = useState(false);
  const activeTickerInfo = TRADE_TICKER_INFO[activeTicker] || TRADE_TICKER_INFO.SPY;
  const contract = contracts[activeTicker] || (() => {
    return { strike: Math.round(activeTickerInfo.price / 5) * 5, cp: "C", exp: "04/25" };
  })();
  const updateContract = (patch) => setContracts(c => ({ ...c, [activeTicker]: { ...contract, ...patch } }));
  const activeQuoteQuery = useGetQuoteSnapshots(
    { symbols: activeTicker },
    {
      query: {
        enabled: Boolean(activeTicker),
        staleTime: 10_000,
        refetchInterval: 10_000,
        retry: false,
      },
    },
  );
  const optionChainQuery = useQuery({
    queryKey: ["trade-option-chain", activeTicker],
    queryFn: () => getOptionChainRequest({ underlying: activeTicker }),
    ...QUERY_DEFAULTS,
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
        (left, right) => (left.actualDate?.getTime() ?? 0) - (right.actualDate?.getTime() ?? 0),
      );
    }

    return [];
  }, [optionChainQuery.data]);
  const chainRowsByExpiration = useMemo(() => {
    if (optionChainQuery.data?.contracts?.length) {
      const grouped = {};
      optionChainQuery.data.contracts.forEach((quote) => {
        const expiration = formatExpirationLabel(quote.contract?.expirationDate);
        if (!grouped[expiration]) grouped[expiration] = [];
        grouped[expiration].push(quote);
      });

      return Object.fromEntries(
        Object.entries(grouped).map(([expiration, quotes]) => [
          expiration,
          buildOptionChainRowsFromApi(quotes, activeTickerInfo.price, activeTickerInfo.iv),
        ]),
      );
    }

    return {};
  }, [optionChainQuery.data, activeTickerInfo.price, activeTickerInfo.iv]);
  const activeExpiration = expirationOptions.find(option => option.value === contract.exp) || expirationOptions[0] || {
    value: contract.exp,
    label: contract.exp,
    dte: daysToExpiration(contract.exp),
    actualDate: parseExpirationValue(contract.exp),
  };
  const activeChainRows = chainRowsByExpiration[activeExpiration.value] || chainRowsByExpiration[contract.exp] || [];
  const optionChainStatus = optionChainQuery.data?.contracts?.length
    ? "live"
    : optionChainQuery.isPending
      ? "loading"
      : optionChainQuery.isError
        ? "offline"
        : "empty";
  const tickerFlowQuery = useQuery({
    queryKey: ["trade-flow", activeTicker],
    queryFn: () => listFlowEventsRequest({ underlying: activeTicker, limit: 80 }),
    staleTime: 10_000,
    refetchInterval: 10_000,
    retry: false,
  });
  const tickerFlowEvents = useMemo(() => {
    const liveEvents = tickerFlowQuery.data?.events?.map(mapFlowEventToUi) || [];
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

  useMassiveStockAggregateStream({
    symbols: activeTicker ? [activeTicker] : [],
    enabled: Boolean(activeTicker),
    onAggregate: (aggregate) => {
      queryClient.invalidateQueries({ queryKey: ["trade-equity-bars", aggregate.symbol] });
      queryClient.invalidateQueries({ queryKey: ["/api/quotes/snapshot"] });
    },
  });

  // Persist trade state changes
  useEffect(() => { persistState({ tradeActiveTicker: activeTicker }); }, [activeTicker]);
  useEffect(() => { persistState({ tradeRecentTickers: recentTickers }); }, [recentTickers]);
  useEffect(() => { persistState({ tradeContracts: contracts }); }, [contracts]);

  useEffect(() => {
    const quote = activeQuoteQuery.data?.quotes?.find(item => item.symbol?.toUpperCase() === activeTicker);
    if (!quote) return;

    const tradeInfo = ensureTradeTickerInfo(activeTicker, activeTickerInfo.name || activeTicker);
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
    setRecentTickers(prev => prev.includes(normalized) ? prev : [...prev, normalized].slice(-8));
  };
  const closeTicker = (ticker) => {
    setRecentTickers(prev => {
      const filtered = prev.filter(t => t !== ticker);
      if (ticker === activeTicker && filtered.length > 0) setActiveTicker(filtered[0]);
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
        const info = TRADE_TICKER_INFO[symPing.sym] || TRADE_TICKER_INFO.SPY;
        const existing = current[symPing.sym] || {
          strike: Math.round(info.price / 5) * 5,
          cp: "C",
          exp: incoming.exp || "04/25",
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
    if (expirationOptions.some(option => option.value === contract.exp)) return;

    const nextExpiration = expirationOptions[0];
    const atmRow = (chainRowsByExpiration[nextExpiration.value] || []).find(row => row.isAtm);
    updateContract({
      exp: nextExpiration.value,
      strike: atmRow?.k ?? contract.strike,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTicker, expirationOptions, chainRowsByExpiration]);

  useEffect(() => {
    if (!activeChainRows.length) return;
    if (activeChainRows.some(row => row.k === contract.strike)) return;

    const atmRow = activeChainRows.find(row => row.isAtm) || activeChainRows[Math.floor(activeChainRows.length / 2)];
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
      if (dist < bestDist) { bestDist = dist; bestStrike = row.k; }
    }
    const targetExpiration = expirationOptions.length
      ? expirationOptions.reduce((closest, option) => (
        Math.abs(option.dte - strategy.dte) < Math.abs(closest.dte - strategy.dte) ? option : closest
      ), expirationOptions[0]).value
      : contract.exp;
    updateContract({ strike: bestStrike, cp: strategy.cp, exp: targetExpiration });
  };

  // Slot prop adapter for existing components that expect { ticker, strike, cp, exp }
  const slot = { ticker: activeTicker, ...contract };

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Tab strip */}
      <TickerTabStrip
        recent={recentTickers}
        active={activeTicker}
        onSelect={focusTicker}
        onClose={closeTicker}
        onAddNew={() => setShowUniverseSearch(open => !open)}
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
      <div style={{ flex: 1, padding: sp(6), display: "flex", flexDirection: "column", gap: sp(6), overflow: "auto" }}>
        {/* Compact ticker header */}
        <TradeTickerHeader ticker={activeTicker} chainRows={activeChainRows} expiration={activeExpiration} chainStatus={optionChainStatus} />
        {/* Top zone: Equity chart + Options chain side by side */}
        <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: sp(6), height: dim(340), flexShrink: 0 }}>
          <TradeEquityPanel ticker={activeTicker} flowEvents={tickerFlowEvents} />
          <TradeChainPanel
            ticker={activeTicker}
            contract={contract}
            chainRows={activeChainRows}
            expirations={expirationOptions}
            chainStatus={optionChainStatus}
            onSelectContract={(strike, cp) => updateContract({ strike, cp })}
            onChangeExp={(exp) => updateContract({ exp })}
          />
        </div>
        {/* Middle zone: Contract chart + Spot flow + Options flow */}
        <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1.5fr", gap: sp(6), height: dim(260), flexShrink: 0 }}>
          <TradeContractDetailPanel ticker={activeTicker} contract={contract} chainRows={activeChainRows} chainStatus={optionChainStatus} />
          <TradeSpotFlowPanel ticker={activeTicker} flowEvents={tickerFlowEvents} />
          <TradeOptionsFlowPanel ticker={activeTicker} flowEvents={tickerFlowEvents} />
        </div>
        {/* Bottom zone: Order ticket + Strategy/Greeks + L2/Tape/Flow tabs + Positions */}
        <div style={{ display: "grid", gridTemplateColumns: "minmax(260px, 1fr) minmax(280px, 1fr) minmax(280px, 1fr) minmax(360px, 1.4fr)", gap: sp(6), height: dim(290), flexShrink: 0 }}>
          <TradeOrderTicket
            slot={slot}
            chainRows={activeChainRows}
            expiration={activeExpiration}
            accountId={accountId}
            environment={environment}
            executionConfigured={executionConfigured}
          />
          <TradeStrategyGreeksPanel slot={slot} chainRows={activeChainRows} onApplyStrategy={applyStrategy} />
          <TradeL2Panel slot={slot} chainRows={activeChainRows} flowEvents={tickerFlowEvents} />
          <TradePositionsPanel
            accountId={accountId}
            environment={environment}
            executionConfigured={executionConfigured}
            onLoadPosition={({ ticker, strike, cp, exp }) => {
            focusTicker(ticker);
            setContracts(c => ({ ...c, [ticker]: { strike, cp, exp } }));
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
  { id: "ai", title: "The AI Trade", subtitle: "AI Infrastructure · Full Ecosystem", icon: "◆", accent: "#CDA24E" },
  { id: "aerospace_defense", title: "Aerospace & Defense", subtitle: "Primes · Electronics · Drones · Space", icon: "✈", accent: "#556b2f", meta: true },
  { id: "nuclear", title: "Nuclear Renaissance", subtitle: "Utilities · SMR · Fuel Cycle", icon: "☢", accent: "#2a9a70" },
  { id: "space", title: "Space & Orbital", subtitle: "Launch · Satellites · EO/SAR", icon: "★", accent: "#4872d8" },
  { id: "robotics", title: "Robotics & Automation", subtitle: "Humanoid · Industrial · Logistics", icon: "⬡", accent: "#d86840" },
  { id: "quantum", title: "Quantum Computing", subtitle: "Hardware · Software · PQC", icon: "⚛", accent: "#8e44ad" },
];

const ResearchScreen = ({ onJumpToTrade }) => <PhotonicsObservatory onJumpToTrade={onJumpToTrade} />;

// ═══════════════════════════════════════════════════════════════════
// SCREEN: ALGO (EDGE Algorithm Config)
// ═══════════════════════════════════════════════════════════════════

const AlgoScreen = () => (
  <div style={{ padding: sp(12), display: "flex", flexDirection: "column", gap: sp(10), height: "100%", overflowY: "auto" }}>
    {/* EDGE Pipeline Status */}
    <div style={{ background: T.bg2, border: `1px solid ${T.border}`, borderRadius: dim(6), padding: "12px 14px" }}>
      <div style={{ fontSize: fs(12), fontWeight: 700, fontFamily: T.display, color: T.text, marginBottom: 10 }}>EDGE Pipeline</div>
      <div style={{ display: "flex", gap: 8 }}>
        {[
          { label: "RayAlgo", status: "active", detail: "BOS long · conf 0.78" },
          { label: "RF Calibrator", status: "advisory", detail: "P(win) = 0.64" },
          { label: "Entry Gate", status: "pass", detail: "Edge: 1.32×" },
          { label: "Exit Governor", status: "monitoring", detail: "Trail L1 active" },
          { label: "Risk Warden", status: "clear", detail: "2/4 positions" },
        ].map(m => {
          const sc = m.status === "active" || m.status === "pass" || m.status === "clear" ? T.green
            : m.status === "advisory" ? T.amber : T.accent;
          return (
            <div key={m.label} style={{
              flex: 1, padding: sp("10px 12px"), borderRadius: dim(6),
              background: T.bg0, border: `1px solid ${T.border}`,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: sp(4), marginBottom: 4 }}>
                <div style={{ width: dim(6), height: dim(6), borderRadius: "50%", background: sc }} />
                <span style={{ fontSize: fs(10), fontWeight: 700, fontFamily: T.sans, color: T.text }}>{m.label}</span>
              </div>
              <div style={{ fontSize: fs(9), color: T.textDim, fontFamily: T.mono }}>{m.detail}</div>
            </div>
          );
        })}
      </div>
    </div>

    {/* Signal Feed */}
    <div style={{ background: T.bg2, border: `1px solid ${T.border}`, borderRadius: dim(6), padding: sp("12px 14px"), flex: 1 }}>
      <div style={{ fontSize: fs(12), fontWeight: 700, fontFamily: T.display, color: T.text, marginBottom: 8 }}>Recent Signals</div>
      {[
        { time: "14:35", type: "BOS", dir: "long", conf: 0.78, regime: "trending", action: "FULL", color: T.green },
        { time: "13:52", type: "CHoCH", dir: "short", conf: 0.62, regime: "trending", action: "REDUCED", color: T.amber },
        { time: "12:18", type: "BOS", dir: "long", conf: 0.45, regime: "neutral", action: "SKIP", color: T.red },
        { time: "11:03", type: "BOS", dir: "long", conf: 0.83, regime: "trending", action: "FULL", color: T.green },
        { time: "10:22", type: "CHoCH", dir: "short", conf: 0.71, regime: "choppy", action: "SKIP", color: T.red },
      ].map((s, i) => (
        <div key={i} style={{
          display: "grid", gridTemplateColumns: "50px 50px 50px 60px 70px 70px",
          padding: sp("6px 0"), borderBottom: `1px solid ${T.border}08`,
          fontSize: fs(10), fontFamily: T.mono, gap: sp(4), alignItems: "center",
        }}>
          <span style={{ color: T.textDim }}>{s.time}</span>
          <Badge color={s.type === "BOS" ? T.accent : T.purple}>{s.type}</Badge>
          <span style={{ color: s.dir === "long" ? T.green : T.red, fontWeight: 600 }}>{s.dir.toUpperCase()}</span>
          <span style={{ color: T.textSec }}>conf {s.conf.toFixed(2)}</span>
          <span style={{ color: T.textDim }}>{s.regime}</span>
          <Badge color={s.color}>{s.action}</Badge>
        </div>
      ))}
    </div>
  </div>
);

// ═══════════════════════════════════════════════════════════════════
// SCREEN: BACKTEST
// ═══════════════════════════════════════════════════════════════════

const BacktestScreen = () => {
  const r = rng(123);
  let eq = 25000;
  const eqData = Array.from({ length: 60 }, (_, i) => {
    eq += (r() - 0.42) * 300;
    return { day: i, equity: +eq.toFixed(0) };
  });

  return (
    <div style={{ padding: sp(12), display: "flex", flexDirection: "column", gap: sp(10), height: "100%", overflowY: "auto" }}>
      {/* Summary Stats */}
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: sp(8),
      }}>
        {[
          { label: "Net P&L", value: `+$${(eq - 25000).toFixed(0)}`, color: T.green },
          { label: "Win Rate", value: "61.4%", color: T.green },
          { label: "Profit Factor", value: "1.82", color: T.green },
          { label: "Sharpe", value: "1.24", color: T.accent },
          { label: "Max DD", value: "-8.3%", color: T.red },
          { label: "Trades", value: "87", color: T.text },
        ].map(s => (
          <div key={s.label} style={{
            background: T.bg2, border: `1px solid ${T.border}`, borderRadius: dim(6), padding: sp("10px 12px"),
          }}>
            <div style={{ fontSize: fs(9), color: T.textMuted, fontFamily: T.sans, fontWeight: 600 }}>{s.label}</div>
            <div style={{ fontSize: fs(18), fontWeight: 700, fontFamily: T.mono, color: s.color, marginTop: 2 }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Equity Curve */}
      <div style={{
        flex: 1, background: T.bg2, border: `1px solid ${T.border}`, borderRadius: dim(6),
        padding: sp("10px 12px"), minHeight: 220,
      }}>
        <div style={{ fontSize: fs(12), fontWeight: 700, fontFamily: T.display, color: T.text, marginBottom: 6 }}>Equity Curve</div>
        <ResponsiveContainer width="100%" height="90%">
          <AreaChart data={eqData} margin={{ top: 4, right: 4, bottom: 0, left: 10 }}>
            <XAxis dataKey="day" tick={{ fontSize: fs(8), fill: T.textMuted }} />
            <YAxis tick={{ fontSize: fs(8), fill: T.textMuted }} tickFormatter={v => `$${(v / 1000).toFixed(0)}K`} />
            <Tooltip contentStyle={{ background: T.bg4, border: `1px solid ${T.border}`, borderRadius: dim(6), fontSize: fs(10), fontFamily: T.mono }} />
            <ReferenceLine y={25000} stroke={T.textMuted} strokeDasharray="3 3" strokeWidth={0.5} label={{ value: "Start", position: "right", fill: T.textMuted, fontSize: fs(8) }} />
            <Area dataKey="equity" fill={`${T.green}10`} stroke={T.green} strokeWidth={1.5} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
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
    <div style={{
      position: "fixed", bottom: dim(20), right: dim(20), zIndex: 200,
      display: "flex", flexDirection: "column", gap: sp(6), pointerEvents: "none",
    }}>
      {toasts.map(t => {
        const kindColor = t.kind === "success" ? T.green : t.kind === "error" ? T.red : t.kind === "warn" ? T.amber : T.accent;
        const kindIcon = t.kind === "success" ? "✓" : t.kind === "error" ? "✕" : t.kind === "warn" ? "⚠" : "ⓘ";
        return (
          <div key={t.id}
            onClick={() => onDismiss && onDismiss(t.id)}
            title="Click to dismiss"
            style={{
              background: T.bg2, border: `1px solid ${kindColor}`, borderLeft: `3px solid ${kindColor}`,
              borderRadius: dim(4), padding: sp("8px 12px"), minWidth: dim(260), maxWidth: dim(340),
              boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
              animation: t.leaving ? "toastSlideOut 0.2s ease-in forwards" : "toastSlideIn 0.22s ease-out",
              pointerEvents: "auto", cursor: "pointer",
              transition: "transform 0.1s, background 0.1s",
            }}
            onMouseEnter={e => { e.currentTarget.style.background = T.bg3; e.currentTarget.style.transform = "translateX(-2px)"; }}
            onMouseLeave={e => { e.currentTarget.style.background = T.bg2; e.currentTarget.style.transform = "translateX(0)"; }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", gap: sp(8) }}>
              <span style={{ fontSize: fs(14), color: kindColor, fontWeight: 700, lineHeight: 1, marginTop: 1 }}>{kindIcon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: fs(11), fontWeight: 700, color: T.text, marginBottom: t.body ? sp(2) : 0 }}>{t.title}</div>
                {t.body && <div style={{ fontSize: fs(10), color: T.textSec, fontFamily: T.mono, lineHeight: 1.4 }}>{t.body}</div>}
              </div>
              <span style={{ fontSize: fs(11), color: T.textMuted, fontWeight: 600, opacity: 0.6, marginLeft: sp(4), marginTop: 1 }}>✕</span>
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(_initialState.sidebarCollapsed || false);
  const [theme, setTheme] = useState(_initialState.theme || "dark");
  const [scale, setScaleState] = useState(_initialState.scale || "m");
  // Pending sym hand-off to Trade tab — bumped each time a watchlist item is clicked
  // so TradeScreen can react even when the same sym is clicked twice
  const [tradeSymPing, setTradeSymPing] = useState({ sym: _initialState.sym || "SPY", n: 0, contract: null });

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
    return watchlistsQuery.data.watchlists.find(w => w.isDefault) || watchlistsQuery.data.watchlists[0];
  }, [watchlistsQuery.data]);
  const watchlistSymbols = useMemo(() => {
    const apiSymbols = defaultWatchlist?.items?.map(item => item.symbol?.toUpperCase()).filter(Boolean) || [];
    const fallback = WATCHLIST.map(item => item.sym);
    const unique = [...new Set(apiSymbols.length ? apiSymbols : fallback)];
    return unique.length ? unique : ["SPY"];
  }, [defaultWatchlist]);
  const quoteSymbols = useMemo(() => {
    return [...new Set([...watchlistSymbols, ...MARKET_SNAPSHOT_SYMBOLS, sym].filter(Boolean))];
  }, [sym, watchlistSymbols]);
  const sparklineSymbols = useMemo(() => {
    const indexSymbols = INDICES.map(item => item.sym);
    return [...new Set([...watchlistSymbols, ...indexSymbols].filter(Boolean))];
  }, [watchlistSymbols]);
  const streamedMarketSymbols = useMemo(
    () => [...new Set([...quoteSymbols, ...sparklineSymbols].map(normalizeTickerSymbol).filter(Boolean))],
    [quoteSymbols, sparklineSymbols],
  );
  const quotesQuery = useGetQuoteSnapshots(
    { symbols: quoteSymbols.join(",") },
    {
      query: {
        staleTime: 10_000,
        refetchInterval: 10_000,
        retry: false,
      },
    },
  );
  const sparklineQuery = useQuery({
    queryKey: ["market-sparklines", sparklineSymbols],
    enabled: sparklineSymbols.length > 0,
    queryFn: async () => {
      const results = await Promise.allSettled(
        sparklineSymbols.map((symbol) => getBarsRequest({
          symbol,
          timeframe: "15m",
          limit: 24,
        })),
      );

      return Object.fromEntries(
        results.map((result, index) => [
          sparklineSymbols[index],
          result.status === "fulfilled" ? (result.value.bars || []) : [],
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
        MARKET_PERFORMANCE_SYMBOLS.map((symbol) => getBarsRequest({
          symbol,
          timeframe: "1d",
          limit: 6,
        })),
      );

      return Object.fromEntries(
        results.map((result, index) => {
          const bars = result.status === "fulfilled" ? (result.value.bars || []) : [];
          const baselineBar = bars.length > 5 ? bars[bars.length - 6] : bars[0];
          return [MARKET_PERFORMANCE_SYMBOLS[index], baselineBar?.close ?? null];
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
        enabled: Boolean(sessionQuery.data?.configured?.ibkr),
        staleTime: 15_000,
        refetchInterval: 15_000,
        retry: false,
      },
    },
  );

  useMassiveStockAggregateStream({
    symbols: streamedMarketSymbols,
    enabled: streamedMarketSymbols.length > 0,
    onAggregate: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/quotes/snapshot"] });
      queryClient.invalidateQueries({ queryKey: ["market-sparklines"] });
    },
  });

  // ── TOAST SYSTEM ──
  const [toasts, setToasts] = useState([]);
  const toastIdRef = useRef(0);
  const timeoutMapRef = useRef({});  // tracks outer auto-dismiss timeout per toast, so manual dismiss can cancel it
  const dismissToast = useCallback((id) => {
    const timers = timeoutMapRef.current[id];
    if (timers) { clearTimeout(timers.dismiss); clearTimeout(timers.remove); delete timeoutMapRef.current[id]; }
    setToasts(prev => prev.map(t => t.id === id ? { ...t, leaving: true } : t));
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 220);
  }, []);
  const pushToast = useCallback(({ title, body, kind = "info", duration = 3500 }) => {
    const id = ++toastIdRef.current;
    setToasts(prev => [...prev, { id, title, body, kind, leaving: false }]);
    const dismissTimer = setTimeout(() => {
      setToasts(prev => prev.map(t => t.id === id ? { ...t, leaving: true } : t));
      const removeTimer = setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 220);
      timeoutMapRef.current[id] = { ...(timeoutMapRef.current[id] || {}), remove: removeTimer };
    }, duration);
    timeoutMapRef.current[id] = { dismiss: dismissTimer };
  }, []);
  const toastValue = useMemo(() => ({ push: pushToast, toasts }), [pushToast, toasts]);

  // ── MOCK POSITIONS ──
  // Loaded from session-only memory (NOT persisted — fresh session each refresh for safety)
  const [positions, setPositions] = useState([]);
  const [, setMarketDataVersion] = useState(0);
  const addPosition = useCallback((pos) => {
    setPositions(prev => [{ ...pos, id: `pos_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, openedAt: Date.now() }, ...prev]);
  }, []);
  const closePosition = useCallback((id) => {
    setPositions(prev => prev.filter(p => p.id !== id));
  }, []);
  const closeAllPositions = useCallback(() => {
    setPositions([]);
  }, []);
  const updateStops = useCallback((id, stops) => {
    setPositions(prev => prev.map(p => p.id === id ? { ...p, ...stops } : p));
  }, []);
  const rollPosition = useCallback((id) => {
    setPositions(prev => prev.map(p => p.id === id ? { ...p, rolledAt: Date.now(), exp: p.exp === "04/25" ? "05/16" : "06/20" } : p));
  }, []);
  const positionsValue = useMemo(() => ({
    positions, addPosition, closePosition, closeAll: closeAllPositions, updateStops, rollPosition,
  }), [positions, addPosition, closePosition, closeAllPositions, updateStops, rollPosition]);

  useEffect(() => {
    syncRuntimeMarketData(watchlistSymbols, defaultWatchlist?.items, quotesQuery.data?.quotes, {
      sparklineBarsBySymbol: sparklineQuery.data,
      performanceBaselineBySymbol: marketPerformanceQuery.data,
    });
    setMarketDataVersion(version => version + 1);
  }, [watchlistSymbols, defaultWatchlist, quotesQuery.data, sparklineQuery.data, marketPerformanceQuery.data]);

  useEffect(() => {
    if (screen === "trade") return;
    if (!watchlistSymbols.length || watchlistSymbols.includes(sym)) return;

    const nextSym = watchlistSymbols[0];
    setSym(nextSym);
    setTradeSymPing(prev => ({ sym: nextSym, n: prev.n + 1 }));
  }, [screen, watchlistSymbols, sym]);

  // ── POSITION ALERTS ──
  // Mirror the mock-drift logic used by TradePositionsPanel. A position "alerts" when its
  // P&L % crosses ±threshold. This drives the Trade tab pulse + badge.
  // Drift formula pulls from the random-hash portion of the id (indices 14-18) so rapid-fire
  // orders get genuinely different drift values rather than correlated Date.now() digits.
  const alertingPositions = useMemo(() => {
    const alerts = [];
    positions.forEach(p => {
      const seed = (p.id.charCodeAt(14) || 0) * 3 + (p.id.charCodeAt(16) || 0) * 11 + (p.id.charCodeAt(18) || 0);
      const driftPct = Math.sin(seed) * 0.6;  // ±60% max
      const mark = +(p.entry * (1 + driftPct)).toFixed(2);
      const sign = (p.side === "BUY" || p.side === "LONG") ? 1 : -1;
      const pct = ((mark - p.entry) / p.entry) * 100 * sign;
      if (pct >= 50) alerts.push({ id: p.id, pct, kind: "profit" });
      else if (pct <= -25) alerts.push({ id: p.id, pct, kind: "loss" });
    });
    return alerts;
  }, [positions]);
  const winAlerts = alertingPositions.filter(a => a.kind === "profit").length;
  const lossAlerts = alertingPositions.filter(a => a.kind === "loss").length;
  const totalAlerts = winAlerts + lossAlerts;
  const environment = sessionQuery.data?.environment || "paper";
  const primaryAccount = accountsQuery.data?.accounts?.[0] || null;
  const primaryStatusTicker = WATCHLIST[0] || DEFAULT_WATCHLIST_BY_SYMBOL.SPY;
  const volatilityStatusTicker = MACRO_TICKERS.find(item => item.sym === "VIXY") || MACRO_TICKERS[0];

  // Persist state changes (debounced via useEffect — fires after each commit)
  useEffect(() => { persistState({ screen }); }, [screen]);
  useEffect(() => { persistState({ sym }); }, [sym]);
  useEffect(() => { persistState({ sidebarCollapsed }); }, [sidebarCollapsed]);
  useEffect(() => { persistState({ theme }); }, [theme]);
  useEffect(() => { persistState({ scale }); }, [scale]);

  // Toggle theme: flip module-level CURRENT_THEME so the T proxy resolves to the new palette,
  // then update React state to force the entire tree to re-render and re-read T.foo
  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    CURRENT_THEME = next;
    setTheme(next);
  };

  // Set scale: flip module-level CURRENT_SCALE so all fs/sp/dim helpers re-evaluate
  // on the next render cascade
  const setScale = (next) => {
    CURRENT_SCALE = next;
    setScaleState(next);
  };

  // Watchlist sync: clicking a sidebar item updates sym AND signals Trade tab
  // to load it into the active slot
  const handleSelectSymbol = (newSym) => {
    setSym(newSym);
    setTradeSymPing(prev => ({ sym: newSym, n: prev.n + 1, contract: null }));
  };

  // Jump to Trade tab from Flow drawer with a contract preloaded
  const handleJumpToTradeFromFlow = (evt) => {
    const ticker = evt.ticker?.toUpperCase?.() || evt.ticker;
    if (!ticker) return;

    ensureTradeTickerInfo(ticker, ticker);
    setSym(ticker);
    setTradeSymPing(prev => ({
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
    setTradeSymPing(prev => ({ sym: normalized, n: prev.n + 1, contract: null }));
    setScreen("trade");
  };

  const renderScreen = () => {
    switch (screen) {
      case "market": return <MarketScreen sym={sym} onSymClick={handleSelectSymbol} symbols={watchlistSymbols} researchConfigured={Boolean(sessionQuery.data?.configured?.research)} />;
      case "flow": return <FlowScreen symbols={watchlistSymbols} onJumpToTrade={handleJumpToTradeFromFlow} />;
      case "trade": return <TradeScreen sym={sym} symPing={tradeSymPing} environment={environment} accountId={primaryAccount?.id || null} executionConfigured={Boolean(sessionQuery.data?.configured?.ibkr && primaryAccount?.id)} />;
      case "research": return <ResearchScreen onJumpToTrade={handleJumpToTradeFromResearch} />;
      case "algo": return <AlgoScreen />;
      case "backtest": return <BacktestScreen />;
      default: return <MarketScreen sym={sym} onSymClick={handleSelectSymbol} symbols={watchlistSymbols} researchConfigured={Boolean(sessionQuery.data?.configured?.research)} />;
    }
  };

  return (
    <ThemeContext.Provider value={{ theme, toggle: toggleTheme }}>
    <ToastContext.Provider value={toastValue}>
    <PositionsContext.Provider value={positionsValue}>
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: T.bg0, color: T.text, fontFamily: T.sans }}>
      <style>{FONT_CSS}</style>
      <ToastStack toasts={toasts} onDismiss={dismissToast} />

      {/* ══════ TOP ANCHOR BAR ══════ */}
      <div style={{
        display: "flex", alignItems: "center", height: dim(40), padding: sp("0 12px"),
        background: T.bg1, borderBottom: `1px solid ${T.border}`, flexShrink: 0,
      }}>
        {/* Brand */}
        <div style={{ display: "flex", alignItems: "center", gap: sp(8), marginRight: 16 }}>
          <div style={{
            width: dim(22), height: dim(22), borderRadius: dim(5),
            background: `linear-gradient(135deg, ${T.accent}, ${T.purple})`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: fs(11), fontWeight: 800, color: "#fff",
          }}>R</div>
          <span style={{ fontSize: fs(13), fontWeight: 700, fontFamily: T.display, color: T.text, letterSpacing: "-0.02em" }}>RayAlgo</span>
        </div>

        {/* Screen Tabs */}
        <div style={{ display: "flex", gap: 1 }}>
          {SCREENS.map(s => {
            const isTradeTab = s.id === "trade";
            const hasAlerts = isTradeTab && totalAlerts > 0;
            // Pulse loss-colored if losses dominate, otherwise profit-colored
            const alertColor = lossAlerts > winAlerts ? T.red : T.amber;
            const pulseAnim = hasAlerts
              ? (lossAlerts > winAlerts ? "pulseAlertLoss 1.8s ease-in-out infinite" : "pulseAlert 1.8s ease-in-out infinite")
              : "none";
            return (
              <button key={s.id} onClick={() => setScreen(s.id)} style={{
                padding: sp("6px 14px"), fontSize: fs(11), fontWeight: 600, fontFamily: T.sans,
                background: screen === s.id ? T.bg3 : "transparent",
                border: "none", borderRadius: dim(4), cursor: "pointer",
                color: screen === s.id ? T.text : T.textDim,
                transition: "all 0.15s",
                borderBottom: screen === s.id ? `2px solid ${T.accent}` : "2px solid transparent",
                animation: pulseAnim,
                position: "relative",
              }}
              onMouseEnter={e => { if (screen !== s.id) e.currentTarget.style.color = T.textSec; }}
              onMouseLeave={e => { if (screen !== s.id) e.currentTarget.style.color = T.textDim; }}
              title={hasAlerts ? `${totalAlerts} position${totalAlerts === 1 ? "" : "s"} at alert threshold (${winAlerts} win · ${lossAlerts} loss)` : undefined}
              >
                <span style={{ marginRight: sp(4), fontSize: fs(10) }}>{s.icon}</span>
                {s.label}
                {hasAlerts && (
                  <span style={{
                    marginLeft: sp(4),
                    padding: sp("1px 5px"),
                    borderRadius: dim(8),
                    background: alertColor,
                    color: "#fff",
                    fontSize: fs(8),
                    fontWeight: 800,
                    fontFamily: T.mono,
                    letterSpacing: "0.04em",
                    verticalAlign: "middle",
                  }}>
                    ⚡ {totalAlerts}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <span style={{ flex: 1 }} />

        {/* Scale Picker — XS / S / M / L / XL */}
        <div style={{ display: "flex", gap: 1, marginRight: sp(8), background: T.bg2, border: `1px solid ${T.border}`, borderRadius: dim(4), padding: sp(2) }}>
          {["xs", "s", "m", "l", "xl"].map(s => (
            <button
              key={s}
              onClick={() => setScale(s)}
              title={`Text size: ${s.toUpperCase()}`}
              style={{
                background: scale === s ? T.accent : "transparent",
                border: "none", borderRadius: dim(3),
                color: scale === s ? "#fff" : T.textDim, cursor: "pointer",
                padding: sp("3px 7px"), fontSize: fs(9), fontFamily: T.mono, fontWeight: 700,
                lineHeight: 1, letterSpacing: "0.04em", minWidth: dim(22),
              }}
            >{s.toUpperCase()}</button>
          ))}
        </div>

        {/* Theme Toggle */}
        <button
          onClick={toggleTheme}
          title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          style={{
            background: T.bg2, border: `1px solid ${T.border}`, borderRadius: dim(4),
            color: T.textSec, cursor: "pointer", padding: sp("4px 8px"),
            fontSize: fs(13), lineHeight: 1, marginRight: sp(12),
          }}
        >{theme === "dark" ? "☼" : "☾"}</button>

        {/* Account Summary */}
        <div style={{ display: "flex", gap: sp(16), alignItems: "center" }}>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: fs(8), color: T.textMuted, fontWeight: 600, letterSpacing: "0.1em" }}>NET LIQ</div>
            <div style={{ fontSize: fs(13), fontFamily: T.mono, fontWeight: 700, color: T.text }}>
              {primaryAccount ? fmtCompactCurrency(primaryAccount.netLiquidation) : "—"}
            </div>
          </div>
          <div style={{ width: dim(1), height: dim(22), background: T.border }} />
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: fs(8), color: T.textMuted, fontWeight: 600, letterSpacing: "0.1em" }}>BUY PWR</div>
            <div style={{ fontSize: fs(13), fontFamily: T.mono, fontWeight: 700, color: T.green }}>
              {primaryAccount ? fmtCompactCurrency(primaryAccount.buyingPower) : "—"}
            </div>
          </div>
        </div>
      </div>

      {/* ══════ MAIN CONTENT (3 columns) ══════ */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Left: Watchlist */}
        <div style={{ width: sidebarCollapsed ? 40 : 200, transition: "width 0.2s", flexShrink: 0, overflow: "hidden" }}>
          {sidebarCollapsed ? (
            <div style={{
              height: "100%", background: T.bg1, borderRight: `1px solid ${T.border}`,
              display: "flex", flexDirection: "column", alignItems: "center", paddingTop: sp(8),
            }}>
              <button onClick={() => setSidebarCollapsed(false)} style={{
                width: dim(28), height: dim(28), border: "none", borderRadius: dim(4),
                background: T.bg2, color: T.textDim, cursor: "pointer", fontSize: fs(12),
              }}>☰</button>
            </div>
          ) : (
            <div style={{ position: "relative", height: "100%" }}>
              <button onClick={() => setSidebarCollapsed(true)} style={{
                position: "absolute", top: 8, right: 6, zIndex: 2,
                width: dim(18), height: dim(18), border: "none", borderRadius: dim(3),
                background: T.bg3, color: T.textDim, cursor: "pointer", fontSize: fs(9),
              }}>◂</button>
              <Watchlist items={WATCHLIST} selected={sym} onSelect={handleSelectSymbol} />
            </div>
          )}
        </div>

        {/* Center: Active Screen */}
        <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          {renderScreen()}
        </div>

        {/* Right: Context Panel (hidden on Research — full-width canvas) */}
        {screen !== "research" && <ContextPanel screen={screen} sym={sym} watchlist={WATCHLIST} />}
      </div>

      {/* ══════ STATUS BAR ══════ */}
      <div style={{
        display: "flex", alignItems: "center", height: dim(24), padding: sp("0 12px"),
        background: T.bg1, borderTop: `1px solid ${T.border}`, flexShrink: 0,
        fontSize: fs(9), fontFamily: T.mono, gap: sp(12),
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <div style={{ width: dim(6), height: dim(6), borderRadius: "50%", background: environment === "live" ? T.red : T.green }} />
          <span style={{ color: environment === "live" ? T.red : T.green, fontWeight: 600 }}>{environment.toUpperCase()}</span>
        </div>
        <span style={{ color: T.textMuted }}>
          {primaryStatusTicker?.sym || "SPY"} {primaryStatusTicker?.price?.toFixed?.(2) || "—"} {primaryStatusTicker?.chg >= 0 ? "+" : ""}{primaryStatusTicker?.pct?.toFixed?.(2) || "0.00"}%
        </span>
        <span style={{ color: sessionQuery.data?.configured?.polygon ? T.green : T.red }}>
          MD {sessionQuery.data?.configured?.polygon ? "READY" : "OFFLINE"}
        </span>
        <span style={{ color: sessionQuery.data?.configured?.ibkr ? T.green : T.red }}>
          IBKR {sessionQuery.data?.configured?.ibkr ? "READY" : "OFFLINE"}
        </span>
        <span style={{ color: sessionQuery.data?.configured?.research ? T.green : T.red }}>
          RSCH {sessionQuery.data?.configured?.research ? "READY" : "OFFLINE"}
        </span>
        <span style={{ color: T.textMuted }}>
          {volatilityStatusTicker?.sym || "VIXY"} {typeof volatilityStatusTicker?.price === "number" ? volatilityStatusTicker.price.toFixed(2) : "—"}
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ color: T.textMuted }}>
          {new Date().toLocaleTimeString("en-US", { hour12: false, timeZone: "America/New_York" })} ET
        </span>
        <span style={{ color: T.textMuted }}>v0.1.0</span>
      </div>
    </div>
    </PositionsContext.Provider>
    </ToastContext.Provider>
    </ThemeContext.Provider>
  );
}
