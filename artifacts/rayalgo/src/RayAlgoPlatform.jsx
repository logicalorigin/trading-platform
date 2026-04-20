import { useState, useEffect, useRef, useCallback, useMemo, createContext, useContext } from "react";
import { Line, AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ReferenceLine, ComposedChart } from "recharts";
import * as d3 from "d3";

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
  { sym: "VIX", name: "CBOE VIX Index", price: 16.82, chg: -0.34, pct: -1.98, spark: genSparkline(4, 48, 17, 0.15) },
  { sym: "AAPL", name: "Apple Inc", price: 228.34, chg: +3.12, pct: +1.38, spark: genSparkline(5, 48, 228, 1.5) },
  { sym: "MSFT", name: "Microsoft Corp", price: 441.67, chg: -1.23, pct: -0.28, spark: genSparkline(6, 48, 441, 2.0) },
  { sym: "NVDA", name: "NVIDIA Corp", price: 135.89, chg: +4.56, pct: +3.47, spark: genSparkline(7, 48, 136, 3.0) },
  { sym: "AMZN", name: "Amazon.com", price: 198.45, chg: +0.89, pct: +0.45, spark: genSparkline(8, 48, 198, 1.2) },
  { sym: "META", name: "Meta Platforms", price: 612.30, chg: -5.67, pct: -0.92, spark: genSparkline(9, 48, 612, 3.5) },
  { sym: "TSLA", name: "Tesla Inc", price: 248.91, chg: +7.23, pct: +2.99, spark: genSparkline(10, 48, 249, 4.0) },
  { sym: "DXY", name: "US Dollar Index", price: 103.47, chg: +0.12, pct: +0.12, spark: genSparkline(11, 48, 103, 0.2) },
  { sym: "TNX", name: "10Y Treasury", price: 4.287, chg: +0.031, pct: +0.73, spark: genSparkline(12, 48, 4.3, 0.02) },
];

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
  QQQ:  { name: "Invesco QQQ",        price: 498.23, chg: -2.15, pct: -0.43, iv: 0.192, barSeed: 101, chainSeed: 201, optSeed: 301 },
  NVDA: { name: "NVIDIA Corp",        price: 135.89, chg: +4.56, pct: +3.47, iv: 0.412, barSeed: 102, chainSeed: 202, optSeed: 302 },
  TSLA: { name: "Tesla Inc",          price: 248.91, chg: +7.23, pct: +2.99, iv: 0.488, barSeed: 103, chainSeed: 203, optSeed: 303 },
  AAPL: { name: "Apple Inc",          price: 228.34, chg: +3.12, pct: +1.38, iv: 0.221, barSeed: 104, chainSeed: 204, optSeed: 304 },
  META: { name: "Meta Platforms",     price: 612.30, chg: -5.67, pct: -0.92, iv: 0.285, barSeed: 105, chainSeed: 205, optSeed: 305 },
  AMZN: { name: "Amazon.com",         price: 198.45, chg: +0.89, pct: +0.45, iv: 0.248, barSeed: 106, chainSeed: 206, optSeed: 306 },
  MSFT: { name: "Microsoft Corp",     price: 441.67, chg: -1.24, pct: -0.28, iv: 0.204, barSeed: 107, chainSeed: 207, optSeed: 307 },
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
      pPrem: +pPrem.toFixed(2),
      pBid: +(pPrem - pSpread / 2).toFixed(2),
      pAsk: +(pPrem + pSpread / 2).toFixed(2),
      pVol: Math.round(r() * 2500),
      pOi: Math.round(500 + r() * 12000),
      pIv: +(baseIv + Math.abs(moneyness) * 0.15 + r() * 0.02).toFixed(3),
      pDelta: +(-(1 - callDelta)).toFixed(2),
      isAtm: Math.abs(k - basePrice) < 2.5,
    });
  }
  return strikes;
};

// Option price intraday bars
const genOptionPriceBars = (basePremium, seed) => {
  const r = rng(seed);
  let p = basePremium;
  return Array.from({ length: 78 }, (_, i) => {
    const chg = (r() - 0.48) * p * 0.02;
    p = Math.max(0.05, p + chg);
    return { t: i, p: +p.toFixed(2) };
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

// Quote detail data
const QUOTE = {
  open: 580.54, prevClose: 580.54, high: 583.92, low: 579.81,
  volume: "29.8M", avgVolume: "42.1M", wk52High: 613.23, wk52Low: 498.67,
  iv: "18.4%", openInt: "3.18M", pcRatio: 0.79,
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

const Badge = ({ children, color = T.textDim }) => (
  <span style={{
    display: "inline-block", padding: sp("1px 6px"), borderRadius: dim(3),
    fontSize: fs(9), fontWeight: 700, fontFamily: T.mono, letterSpacing: "0.04em",
    background: `${color}18`, color, border: `1px solid ${color}30`,
  }}>{children}</span>
);

const MiniSparkline = ({ data, color, width = 60, height = 20 }) => {
  if (!data || data.length < 2) return null;
  const vals = data.map(d => d.v);
  const min = Math.min(...vals), max = Math.max(...vals);
  const range = max - min || 1;
  const points = data.map((d, i) =>
    `${(i / (data.length - 1)) * width},${height - ((d.v - min) / range) * height}`
  ).join(" ");
  return (
    <svg width={width} height={height} style={{ display: "block" }}>
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
};


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
          <span style={{ color: T.green }}>Calls $4.2M</span>
          <span style={{ color: T.red }}>Puts $2.8M</span>
          <span style={{ color: T.accent, fontWeight: 700 }}>+$1.4M</span>
        </div>
        <div style={{ display: "flex", height: dim(4), borderRadius: dim(2), marginTop: sp(3), overflow: "hidden" }}>
          <div style={{ width: "60%", background: T.green }} /><div style={{ width: "40%", background: T.red }} />
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
          <MiniSparkline data={w.spark} color={pos ? T.green : T.red} width={50} height={16} />
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
        {[["Open",QUOTE.open],["Prev Close",QUOTE.prevClose],["High",QUOTE.high],["Low",QUOTE.low],["Volume",QUOTE.volume],["52W High",QUOTE.wk52High],["52W Low",QUOTE.wk52Low],["Impl. Vol",QUOTE.iv],["P/C Ratio",QUOTE.pcRatio]].map(([l,v]) => (
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
  { sym: "VIX", price: 16.82, chg: -0.34, pct: -1.98 },
  { sym: "TNX", price: 4.287, chg: +0.031, pct: +0.73, label: "10Y Yield" },
  { sym: "DXY", price: 103.47, chg: +0.12, pct: +0.12, label: "Dollar" },
  { sym: "GC=F", price: 3284.50, chg: +18.40, pct: +0.56, label: "Gold" },
  { sym: "CL=F", price: 63.12, chg: -0.88, pct: -1.37, label: "Crude" },
];

const YIELD_CURVE = [
  { term: "1M", rate: 5.33 }, { term: "3M", rate: 5.22 }, { term: "6M", rate: 5.08 },
  { term: "1Y", rate: 4.78 }, { term: "2Y", rate: 4.62 }, { term: "5Y", rate: 4.21 },
  { term: "10Y", rate: 4.29 }, { term: "20Y", rate: 4.50 }, { term: "30Y", rate: 4.51 },
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
    { sym: "BRK-B", cap: 880, d1: +0.75, d5: +1.2 }, { sym: "JPM", cap: 620, d1: +1.34, d5: +2.8 },
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
  const tickerScores = useMemo(() => {
    const info = TRADE_TICKER_INFO[sym] || TRADE_TICKER_INFO.SPY;
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
    };
    const t = tilt[sym] || { vol: 0, trend: 0, breadth: 0, mom: 0 };
    // Also nudge based on the ticker's day performance (green day lifts trend/mom)
    const dayNudge = Math.round(info.pct * 2); // e.g. +3% day adds 6 points
    // Build condition cards with recomputed scores
    return COND.map(c => {
      const key = c.key === "trend" ? "trend" : c.key === "breadth" ? "breadth" : c.key === "mom" ? "mom" : "vol";
      const delta = t[key] || 0;
      const perfAdjust = (key === "trend" || key === "mom") ? dayNudge : 0;
      const score = Math.max(10, Math.min(95, c.score + delta + perfAdjust));
      // Dynamically recolor based on the score rather than carrying the static color
      const color = score >= 75 ? T.green : score >= 55 ? T.amber : T.red;
      return { ...c, score, color };
    });
  }, [sym]);

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

// ─── MINI CHART CELL ───
// Single chart cell for the multi-chart grid. Compact: ticker header, candles, volume strip.
const MiniChartCell = ({ ticker, onFocus, isActive }) => {
  const w = WATCHLIST.find(x => x.sym === ticker) || WATCHLIST[0];
  const pos = w.chg >= 0;
  const [tf, setTf] = useState("5m");
  // Different bar counts for different timeframes (more bars on shorter TFs feels more "live")
  const tfBars = { "1m": 120, "5m": 78, "15m": 52, "1h": 39, "1D": 60 }[tf] || 78;
  const bars = useMemo(() => {
    const seed = ticker.charCodeAt(0) * 7 + (ticker.charCodeAt(1) || 0) + tfBars;
    return genBars(seed, tfBars, w.price);
  }, [ticker, tf]);

  return (
    <div
      onClick={() => onFocus && onFocus(ticker)}
      style={{
        background: T.bg2, border: `1px solid ${isActive ? T.accent : T.border}`, borderRadius: dim(6),
        display: "flex", flexDirection: "column", overflow: "hidden", cursor: "pointer",
        transition: "border-color 0.15s",
      }}
    >
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", gap: sp(6),
        padding: sp("4px 8px"), borderBottom: `1px solid ${T.border}`,
      }}>
        <span style={{ fontSize: fs(11), fontWeight: 800, fontFamily: T.mono, color: T.text, letterSpacing: "-0.01em" }}>{w.sym}</span>
        <span style={{ fontSize: fs(11), fontWeight: 700, fontFamily: T.mono, color: T.text }}>
          {w.price < 10 ? w.price.toFixed(3) : w.price.toFixed(2)}
        </span>
        <span style={{ fontSize: fs(9), fontFamily: T.mono, fontWeight: 600, color: pos ? T.green : T.red }}>
          {pos ? "+" : ""}{w.pct.toFixed(2)}%
        </span>
        <span style={{ flex: 1 }} />
        {/* Timeframe pills */}
        <div style={{ display: "flex", gap: 1 }}>
          {["1m", "5m", "15m", "1h", "1D"].map(t => (
            <button
              key={t}
              onClick={e => { e.stopPropagation(); setTf(t); }}
              style={{
                padding: sp("1px 5px"), fontSize: fs(8), fontFamily: T.mono, fontWeight: 600,
                background: t === tf ? T.accentDim : "transparent",
                border: "none", borderRadius: dim(2), cursor: "pointer",
                color: t === tf ? T.accent : T.textMuted, lineHeight: 1.1,
              }}
            >{t}</button>
          ))}
        </div>
      </div>
      {/* Chart body */}
      <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={bars} margin={{ top: 4, right: 4, bottom: 0, left: -28 }}>
            <XAxis dataKey="time" tick={false} axisLine={false} />
            <YAxis domain={["auto", "auto"]} tick={{ fontSize: fs(7), fill: T.textMuted }} axisLine={false} width={28} />
            <Area dataKey="c" fill={pos ? `${T.green}10` : `${T.red}10`} stroke={pos ? T.green : T.red} strokeWidth={1.2} dot={false} isAnimationActive={false} />
            <ReferenceLine y={bars[0]?.o} stroke={T.textMuted} strokeDasharray="2 2" strokeWidth={0.5} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {/* Volume strip with UOA overlay */}
      <div style={{ height: dim(20), flexShrink: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={bars.map(b => ({ ...b, vNormal: b.v * (1 - (b.uoa || 0)), vUoa: b.v * (b.uoa || 0) }))}
            margin={{ top: 0, right: 4, bottom: 0, left: -28 }}
          >
            <XAxis dataKey="time" hide />
            <YAxis tick={false} axisLine={false} width={28} />
            <Bar dataKey="vNormal" stackId="vol" isAnimationActive={false}>
              {bars.map((b, i) => (
                <Cell key={i} fill={b.c >= b.o ? `${T.green}40` : `${T.red}40`} />
              ))}
            </Bar>
            <Bar dataKey="vUoa" stackId="vol" radius={[1, 1, 0, 0]} fill={T.amber} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

// ─── MULTI CHART GRID ───
// Configurable grid of mini chart cells. Layout selector + auto-pulled tickers from watchlist.
const MULTI_CHART_LAYOUTS = {
  "1x1": { cols: 1, rows: 1, count: 1 },
  "2x2": { cols: 2, rows: 2, count: 4 },
  "2x3": { cols: 3, rows: 2, count: 6 },
  "3x3": { cols: 3, rows: 3, count: 9 },
};

const MultiChartGrid = ({ activeSym, onSymClick }) => {
  const [layout, setLayout] = useState(_initialState.marketGridLayout || "2x3");
  useEffect(() => { persistState({ marketGridLayout: layout }); }, [layout]);

  const cfg = MULTI_CHART_LAYOUTS[layout] || MULTI_CHART_LAYOUTS["2x3"];
  // Auto-pull top N tickers from watchlist, putting active sym first
  const tickers = useMemo(() => {
    const all = WATCHLIST.map(w => w.sym);
    const ordered = [activeSym, ...all.filter(s => s !== activeSym)];
    return ordered.slice(0, cfg.count);
  }, [activeSym, cfg.count]);

  const cellHeight = layout === "1x1" ? dim(360) : layout === "2x2" ? dim(190) : layout === "2x3" ? dim(180) : dim(140);

  return (
    <Card noPad style={{ flexShrink: 0, overflow: "visible" }}>
      {/* Header with layout selector */}
      <div style={{ padding: sp("6px 10px"), borderBottom: `1px solid ${T.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: sp(8) }}>
          <span style={{ fontSize: fs(10), fontWeight: 700, fontFamily: T.display, color: T.textSec, letterSpacing: "0.04em" }}>CHARTS</span>
          <span style={{ fontSize: fs(9), color: T.textMuted, fontFamily: T.mono }}>auto · top {cfg.count} from watchlist</span>
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
        {tickers.map(ticker => (
          <MiniChartCell
            key={ticker}
            ticker={ticker}
            isActive={ticker === activeSym}
            onFocus={onSymClick}
          />
        ))}
      </div>
    </Card>
  );
};


const MarketScreen = ({ sym, onSymClick }) => {
  const [sectorTf, setSectorTf] = useState("1d");

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* ── TICKER RIBBON ── */}
      <div style={{ display: "flex", alignItems: "center", height: dim(26), padding: sp("0 10px"), borderBottom: `1px solid ${T.border}`, gap: sp(10), overflow: "hidden", flexShrink: 0, background: `linear-gradient(to right, ${T.bg1}, ${T.bg2})` }}>
        {MACRO_TICKERS.map(m => {
          const pos = m.chg >= 0;
          return (<div key={m.sym} style={{ display: "flex", alignItems: "center", gap: sp(4), flexShrink: 0 }}>
            <span style={{ fontSize: fs(8), fontWeight: 700, fontFamily: T.mono, color: T.textSec }}>{m.label || m.sym}</span>
            <span style={{ fontSize: fs(9), fontFamily: T.mono, fontWeight: 600, color: T.text }}>{m.price >= 100 ? m.price.toFixed(2) : m.price.toFixed(3)}</span>
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
            const p = idx.chg >= 0;
            const totalPrem = idx.callPrem + idx.putPrem;
            const callPct = (idx.callPrem / totalPrem) * 100;
            const putPct = 100 - callPct;
            const flowDir = idx.callPrem - idx.putPrem;
            return (<Card key={idx.sym} style={{ padding: "5px 8px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontSize: fs(10), fontWeight: 700, fontFamily: T.mono, color: T.text }}>{idx.sym}</div>
                <MiniSparkline data={idx.spark} color={p ? T.green : T.red} width={44} height={16} />
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: sp(5), marginTop: sp(2) }}>
                <span style={{ fontSize: fs(14), fontWeight: 700, fontFamily: T.mono, color: T.text, lineHeight: 1 }}>{idx.price.toFixed(2)}</span>
                <span style={{ fontSize: fs(8), fontFamily: T.mono, fontWeight: 600, color: p ? T.green : T.red, lineHeight: 1 }}>{p?"▲":"▼"} {p?"+":""}{idx.pct.toFixed(2)}%</span>
              </div>
              {/* Net premium flow bar */}
              <div style={{ marginTop: sp(3), paddingTop: sp(3), borderTop: `1px solid ${T.border}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: fs(7), fontFamily: T.mono, marginBottom: sp(2) }}>
                  <span style={{ color: T.green, fontWeight: 600 }}>C ${idx.callPrem.toFixed(1)}M</span>
                  <span style={{ color: flowDir >= 0 ? T.green : T.red, fontWeight: 700 }}>{flowDir >= 0 ? "+" : ""}${flowDir.toFixed(1)}M</span>
                  <span style={{ color: T.red, fontWeight: 600 }}>P ${idx.putPrem.toFixed(1)}M</span>
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
              <span style={{ fontSize: fs(18), fontWeight: 800, fontFamily: T.mono, color: T.text }}>0.79</span>
              <span style={{ fontSize: fs(8), fontFamily: T.mono, color: T.green }}>▼ 0.03</span><span style={{ fontSize: fs(7), color: T.textMuted }}>avg 0.85</span>
            </div>
            <div style={{ display: "flex", height: dim(6), borderRadius: dim(3), overflow: "hidden", marginBottom: 4 }}>
              <div style={{ flex: 1, background: `linear-gradient(to right, ${T.red}, ${T.amber})` }} />
              <div style={{ flex: 1, background: `linear-gradient(to right, ${T.amber}, ${T.green})` }} />
            </div>
            <div style={{ position: "relative", height: dim(5), marginTop: -3 }}><div style={{ position: "absolute", left: "62%", transform: "translateX(-50%)", borderLeft: "3px solid transparent", borderRight: "3px solid transparent", borderBottom: `4px solid ${T.text}` }} /></div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: sp(3), fontSize: fs(8), fontFamily: T.mono }}>
              <span style={{ color: T.textMuted }}>Eq <span style={{ color: T.textSec }}>0.64</span></span><span style={{ color: T.textMuted }}>Idx <span style={{ color: T.textSec }}>1.12</span></span><span style={{ color: T.textMuted }}>Tot <span style={{ color: T.textSec }}>0.79</span></span>
            </div>
          </Card>
          <Card style={{ padding: "5px 10px" }}>
            <CardTitle>Yield Curve</CardTitle>
            <div style={{ height: 72 }}>
              <ResponsiveContainer width="100%" height="100%"><ComposedChart data={YIELD_CURVE} margin={{ top:2,right:2,bottom:0,left:-12 }}>
                <XAxis dataKey="term" tick={{ fontSize: fs(6), fill: T.textMuted }} /><YAxis domain={[3.8,5.5]} tick={{ fontSize: fs(6), fill: T.textMuted }} />
                <Area dataKey="rate" fill={`${T.amber}10`} stroke={T.amber} strokeWidth={1.5} dot={{ r: 1.5, fill: T.amber }} />
              </ComposedChart></ResponsiveContainer>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: fs(7), fontFamily: T.mono }}><span style={{ color: T.textMuted }}>2s10s <span style={{ color: T.red }}>-0.33%</span></span><span style={{ color: T.textMuted }}>Fed <span style={{ color: T.textSec }}>4.25-4.50%</span></span></div>
          </Card>
          <Card style={{ padding: "5px 10px" }}>
            <CardTitle>Breadth</CardTitle>
            <div style={{ display: "flex", alignItems: "center", gap: sp(4), marginBottom: 3 }}>
              <span style={{ fontSize: fs(10), fontFamily: T.mono, fontWeight: 800, color: T.green }}>4,518</span>
              <div style={{ flex: 1, display: "flex", height: dim(7), borderRadius: dim(3), overflow: "hidden" }}><div style={{ width: "73.8%", background: T.green }} /><div style={{ width: "26.2%", background: T.red }} /></div>
              <span style={{ fontSize: fs(10), fontFamily: T.mono, fontWeight: 800, color: T.red }}>1,605</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: sp(1), fontSize: fs(7), fontFamily: T.mono }}>
              {[[">20d","62%",T.amber],[">50d","58%",T.amber],[">200d","64%",T.green],["McCl.","+18.4",T.green],["NH","124",T.green],["NL","38",T.red]].map(([l,v,c],i)=>(
                <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: sp("1px 3px"), background: i%2===0?`${T.bg3}40`:"transparent", borderRadius: 2 }}><span style={{ color: T.textDim }}>{l}</span><span style={{ color: c, fontWeight: 600 }}>{v}</span></div>
              ))}
            </div>
          </Card>
        </div>

        {/* ── ROW 4.5: Sector Flow (full width, horizontal layout) — sector rotation read ── */}
        <Card style={{ padding: "8px 12px", flexShrink: 0 }}>
          <CardTitle right={<span style={{ fontSize: fs(8), color: T.textMuted, fontFamily: T.mono }}>net option premium · today · sector rotation</span>}>Sector Flow</CardTitle>
          {(() => {
            const absMax = Math.max(...SECTOR_FLOW.map(x => Math.abs(x.calls - x.puts)));
            // Sort by net flow magnitude — strongest signals first
            const sorted = [...SECTOR_FLOW].map(s => ({ ...s, net: s.calls - s.puts })).sort((a, b) => b.net - a.net);
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
          })()}
        </Card>

        {/* ── ROW 5: News + Calendar + AI ── */}
        <div style={{ display: "grid", gridTemplateColumns: "1.4fr 0.7fr 1fr", gap: 6 }}>
          <Card style={{ padding: "6px 10px" }}>
            <CardTitle right={<span style={{ fontSize: fs(7), color: T.accent, cursor: "pointer" }}>All →</span>}>News</CardTitle>
            {NEWS.map((n,i)=>(<div key={i} style={{ display: "flex", gap: sp(5), padding: sp("3px 0"), alignItems: "flex-start", borderBottom: i<NEWS.length-1?`1px solid ${T.border}06`:"none", cursor: "pointer" }}
              onMouseEnter={e=>e.currentTarget.style.background=T.bg3} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
              <Badge color={T.accent}>{n.tag}</Badge>
              <div style={{ width: dim(4), height: dim(4), borderRadius: "50%", background: n.s===1?T.green:n.s===-1?T.red:T.textDim, marginTop: sp(4), flexShrink: 0 }} />
              <span style={{ flex: 1, fontSize: fs(10), color: T.textSec, fontFamily: T.sans, lineHeight: 1.4 }}>{n.text}</span>
              <span style={{ fontSize: fs(8), color: T.textMuted, fontFamily: T.mono }}>{n.time}</span>
            </div>))}
          </Card>
          <Card style={{ padding: "6px 10px" }}>
            <CardTitle>Calendar</CardTitle>
            {EVENTS.map((ev,i)=>{const tc=ev.type==="fomc"||ev.type==="cpi"?T.amber:ev.type==="earnings"?T.green:ev.type==="holiday"?T.red:T.accent; return (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: sp(4), padding: sp("3px 0"), borderBottom: i<EVENTS.length-1?`1px solid ${T.border}06`:"none" }}>
                <div style={{ width: dim(2), height: dim(16), borderRadius: dim(1), background: tc, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: fs(10), fontWeight: 600, fontFamily: T.sans, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ev.label}</div><div style={{ fontSize: fs(8), color: T.textMuted, fontFamily: T.mono }}>{ev.date}</div></div>
              </div>);})}
          </Card>
          <Card style={{ display: "flex", flexDirection: "column", padding: "6px 10px" }}>
            <CardTitle right={<Badge color={T.purple}>AI</Badge>}>Analysis</CardTitle>
            <div style={{ flex: 1, fontSize: fs(10), fontFamily: T.sans, color: T.textSec, lineHeight: 1.5, padding: sp("5px 8px"), background: T.bg0, borderRadius: dim(4), border: `1px solid ${T.border}` }}>
              <span style={{ color: T.green }}>▸</span> Moderate — VIX 22nd %ile supports entries. Defensive rotation (XLU, XLC) signals late-cycle.{"\n\n"}
              <span style={{ color: T.amber }}>▸</span> FOMC 19d — halve new sizing. 2s10s -33bp precedes vol expansion.{"\n\n"}
              <span style={{ color: T.accent }}>▸</span> Favor existing winners. Trend intact (3 HH/HL), participation 41% below threshold.
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
          <span style={{ fontSize: fs(10), fontFamily: T.mono, color: T.textDim, whiteSpace: "nowrap" }}>Exp 04/25</span>
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

const FlowScreen = ({ onJumpToTrade }) => {
  // ── Saved scans persisted in localStorage ──
  const [savedScans, setSavedScans] = useState(_initialState.flowSavedScans || []);
  const [activeScanId, setActiveScanId] = useState(null);
  useEffect(() => { persistState({ flowSavedScans: savedScans }); }, [savedScans]);

  const [filter, setFilter] = useState("all");
  const [minPrem, setMinPrem] = useState(0);
  const [sortBy, setSortBy] = useState("time");
  const [selectedEvt, setSelectedEvt] = useState(null);  // currently inspected contract

  // ── CLUSTER DETECTION ──
  // Group prints by (ticker + strike + cp). Any group with 2+ prints = cluster.
  // We surface cluster size + total premium on each row that's part of a cluster.
  const clusters = useMemo(() => {
    const map = {};
    for (const e of FLOW_EVENTS) {
      const key = `${e.ticker}_${e.strike}_${e.cp}`;
      if (!map[key]) map[key] = { count: 0, totalPrem: 0, ids: [], firstTime: e.time, lastTime: e.time };
      map[key].count += 1;
      map[key].totalPrem += e.premium;
      map[key].ids.push(e.id);
      if (e.time < map[key].firstTime) map[key].firstTime = e.time;
      if (e.time > map[key].lastTime) map[key].lastTime = e.time;
    }
    return map;
  }, []);
  // Build per-event lookup for fast row rendering
  const clusterFor = (e) => {
    const c = clusters[`${e.ticker}_${e.strike}_${e.cp}`];
    return c && c.count >= 2 ? c : null;
  };

  // ── TOP CONTRACTS BY VOLUME, per ticker ──
  // For each ticker, group FLOW_EVENTS by (strike + cp), sum volume + premium, pick top 3.
  // Clicking a contract chip opens the Contract Detail Drawer for the biggest print in that group.
  const topContractsByTicker = useMemo(() => {
    const byTicker = {};
    for (const e of FLOW_EVENTS) {
      if (!byTicker[e.ticker]) byTicker[e.ticker] = {};
      const key = `${e.strike}_${e.cp}`;
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
  }, []);

  // Aggregate stats
  const totalCallPrem = FLOW_EVENTS.filter(e => e.cp === "C").reduce((a, e) => a + e.premium, 0);
  const totalPutPrem = FLOW_EVENTS.filter(e => e.cp === "P").reduce((a, e) => a + e.premium, 0);
  const netPrem = totalCallPrem - totalPutPrem;
  const goldenCount = FLOW_EVENTS.filter(e => e.golden).length;
  const blockCount = FLOW_EVENTS.filter(e => e.type === "BLOCK").length;
  const sweepCount = FLOW_EVENTS.filter(e => e.type === "SWEEP").length;
  const zeroDteCount = FLOW_EVENTS.filter(e => e.dte <= 1).length;
  const zeroDtePrem = FLOW_EVENTS.filter(e => e.dte <= 1).reduce((a, e) => a + e.premium, 0);
  const cpRatio = totalPutPrem / totalCallPrem;
  const mostActive = [...TICKER_FLOW].sort((a, b) => (b.calls + b.puts) - (a.calls + a.puts))[0];

  // ── SMART MONEY COMPASS ──
  // Institutional bias = net premium from XL trades (>$250K) on calls vs puts.
  // Score range -100 (max bearish) to +100 (max bullish).
  const xlTrades = FLOW_EVENTS.filter(e => e.premium >= 250000);
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
  let filtered = FLOW_EVENTS.filter(e => {
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

  const maxTickerPrem = Math.max(...TICKER_FLOW.map(t => t.calls + t.puts));

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

        {/* ── ROW 1: KPI Bar ── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6 }}>
          {[
            { label: "TOTAL PREMIUM", value: fmtM(totalCallPrem + totalPutPrem), sub: `${FLOW_EVENTS.length} prints`, color: T.text },
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
                <AreaChart data={FLOW_TIDE}>
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
            {TICKER_FLOW.map(t => {
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
              {FLOW_CLOCK.map((bucket, i) => {
                const maxCount = Math.max(...FLOW_CLOCK.map(b => b.count));
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
              const buy = MARKET_ORDER_FLOW.buyXL + MARKET_ORDER_FLOW.buyL + MARKET_ORDER_FLOW.buyM + MARKET_ORDER_FLOW.buyS;
              const sell = MARKET_ORDER_FLOW.sellXL + MARKET_ORDER_FLOW.sellL + MARKET_ORDER_FLOW.sellM + MARKET_ORDER_FLOW.sellS;
              const buyPct = (buy / (buy + sell)) * 100;
              const max = Math.max(MARKET_ORDER_FLOW.buyXL, MARKET_ORDER_FLOW.buyL, MARKET_ORDER_FLOW.buyM, MARKET_ORDER_FLOW.buyS, MARKET_ORDER_FLOW.sellXL, MARKET_ORDER_FLOW.sellL, MARKET_ORDER_FLOW.sellM, MARKET_ORDER_FLOW.sellS);
              return (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: sp(8), marginBottom: sp(2) }}>
                    <OrderFlowDonut flow={MARKET_ORDER_FLOW} size={dim(64)} thickness={dim(10)} />
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
                    <SizeBucketRow label="XL" buy={MARKET_ORDER_FLOW.buyXL} sell={MARKET_ORDER_FLOW.sellXL} maxValue={max} />
                    <SizeBucketRow label="L"  buy={MARKET_ORDER_FLOW.buyL}  sell={MARKET_ORDER_FLOW.sellL}  maxValue={max} />
                    <SizeBucketRow label="M"  buy={MARKET_ORDER_FLOW.buyM}  sell={MARKET_ORDER_FLOW.sellM}  maxValue={max} />
                    <SizeBucketRow label="S"  buy={MARKET_ORDER_FLOW.buyS}  sell={MARKET_ORDER_FLOW.sellS}  maxValue={max} />
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
              {DTE_BUCKETS.map((b, i) => {
                const total = b.calls + b.puts;
                const callPct = (b.calls / total) * 100;
                const maxTotal = Math.max(...DTE_BUCKETS.map(x => x.calls + x.puts));
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
            {[...FLOW_EVENTS].sort((a, b) => b.premium - a.premium).slice(0, 4).map(evt => {
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
          <span style={{ fontSize: fs(9), color: T.textDim, fontFamily: T.mono }}>{filtered.length} / {FLOW_EVENTS.length}</span>
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
                    {evt.strike} <span style={{ color: T.textDim }}>04/25</span>
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


const TradeOptionChart = ({ bars, color, contract, holding }) => (
  <div style={{ height: "100%", width: "100%", display: "flex", flexDirection: "column" }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: fs(8), fontFamily: T.mono, color: T.textMuted, padding: "2px 6px 0" }}>
      <span>{contract}</span>
      {holding && <span style={{ fontSize: fs(7), padding: sp("1px 4px"), borderRadius: dim(2), background: `${T.amber}20`, color: T.amber, border: `1px solid ${T.amber}40`, fontWeight: 700, letterSpacing: "0.05em" }}>★ HOLDING</span>}
      <span style={{ color, fontWeight: 600 }}>${bars[bars.length - 1]?.p.toFixed(2)}</span>
    </div>
    <div style={{ flex: 1, minHeight: 0 }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={bars} margin={{ top: 2, right: 2, bottom: 2, left: -30 }}>
          <XAxis dataKey="t" hide />
          <YAxis domain={["auto", "auto"]} tick={{ fontSize: fs(7), fill: T.textMuted }} tickCount={3} />
          <ReferenceLine y={bars[0]?.p} stroke={T.textMuted} strokeDasharray="2 2" strokeWidth={0.5} />
          {holding && <ReferenceLine y={holding.entry} stroke={T.amber} strokeDasharray="4 2" strokeWidth={1.2} label={{ value: `entry $${holding.entry.toFixed(2)}`, position: "insideBottomLeft", fill: T.amber, fontSize: fs(7), fontFamily: T.mono }} />}
          <Area type="linear" dataKey="p" stroke={color} strokeWidth={2} fill={color} fillOpacity={0.35} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  </div>
);

const TradeOptionsChain = ({ chain, selected, onSelect, heldStrikes }) => (
  <div style={{ height: "100%", overflow: "auto", fontSize: fs(9), fontFamily: T.mono }}>
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 46px 1fr 1fr 1fr", gap: sp(2), padding: sp("3px 6px"), borderBottom: `1px solid ${T.border}`, position: "sticky", top: 0, background: T.bg2, zIndex: 1 }}>
      <span style={{ color: T.textMuted, fontSize: fs(7), textAlign: "right", letterSpacing: "0.06em" }}>Δ</span>
      <span style={{ color: T.textMuted, fontSize: fs(7), textAlign: "right", letterSpacing: "0.06em" }}>VOL</span>
      <span style={{ color: T.textMuted, fontSize: fs(7), textAlign: "right", letterSpacing: "0.06em" }}>LAST</span>
      <span style={{ color: T.textMuted, fontSize: fs(7), textAlign: "center", letterSpacing: "0.06em", fontWeight: 700 }}>STRIKE</span>
      <span style={{ color: T.textMuted, fontSize: fs(7), textAlign: "left", letterSpacing: "0.06em" }}>LAST</span>
      <span style={{ color: T.textMuted, fontSize: fs(7), textAlign: "left", letterSpacing: "0.06em" }}>VOL</span>
      <span style={{ color: T.textMuted, fontSize: fs(7), textAlign: "left", letterSpacing: "0.06em" }}>Δ</span>
    </div>
    {chain.map(row => {
      const cSelected = selected && selected.strike === row.k && selected.cp === "C";
      const pSelected = selected && selected.strike === row.k && selected.cp === "P";
      const cHot = row.cVol / row.cOi > 0.5;
      const pHot = row.pVol / row.pOi > 0.5;
      const cHeld = heldStrikes && heldStrikes.find(x => x.strike === row.k && x.cp === "C");
      const pHeld = heldStrikes && heldStrikes.find(x => x.strike === row.k && x.cp === "P");
      return (
        <div key={row.k} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 46px 1fr 1fr 1fr", gap: sp(2), padding: sp("2px 6px"), borderBottom: `1px solid ${T.border}10`, background: row.isAtm ? `${T.accent}08` : "transparent" }}>
          <span onClick={() => onSelect(row.k, "C")} style={{ color: T.textSec, textAlign: "right", cursor: "pointer", padding: sp("0 2px"), background: cSelected ? `${T.green}25` : "transparent", borderRadius: 2 }}>{row.cDelta.toFixed(2)}</span>
          <span onClick={() => onSelect(row.k, "C")} style={{ color: cHot ? T.amber : T.textDim, fontWeight: cHot ? 700 : 400, textAlign: "right", cursor: "pointer", padding: sp("0 2px"), background: cSelected ? `${T.green}25` : "transparent", borderRadius: 2 }}>
            {cHot ? "⚡" : ""}{row.cVol >= 1000 ? `${(row.cVol / 1000).toFixed(1)}K` : row.cVol}
          </span>
          <span onClick={() => onSelect(row.k, "C")} style={{ color: T.green, fontWeight: 600, textAlign: "right", cursor: "pointer", padding: sp("0 2px"), background: cSelected ? `${T.green}25` : cHeld ? `${T.amber}18` : "transparent", borderRadius: dim(2), border: cHeld ? `1px solid ${T.amber}60` : "1px solid transparent" }}>
            {cHeld ? "★ " : ""}{row.cPrem.toFixed(2)}
          </span>
          <span style={{ color: row.isAtm ? T.accent : T.text, fontWeight: 700, textAlign: "center" }}>{row.k}</span>
          <span onClick={() => onSelect(row.k, "P")} style={{ color: T.red, fontWeight: 600, textAlign: "left", cursor: "pointer", padding: sp("0 2px"), background: pSelected ? `${T.red}25` : pHeld ? `${T.amber}18` : "transparent", borderRadius: dim(2), border: pHeld ? `1px solid ${T.amber}60` : "1px solid transparent" }}>
            {pHeld ? "★ " : ""}{row.pPrem.toFixed(2)}
          </span>
          <span onClick={() => onSelect(row.k, "P")} style={{ color: pHot ? T.amber : T.textDim, fontWeight: pHot ? 700 : 400, textAlign: "left", cursor: "pointer", padding: sp("0 2px"), background: pSelected ? `${T.red}25` : "transparent", borderRadius: 2 }}>
            {pHot ? "⚡" : ""}{row.pVol >= 1000 ? `${(row.pVol / 1000).toFixed(1)}K` : row.pVol}
          </span>
          <span onClick={() => onSelect(row.k, "P")} style={{ color: T.textSec, textAlign: "left", cursor: "pointer", padding: sp("0 2px"), background: pSelected ? `${T.red}25` : "transparent", borderRadius: 2 }}>{row.pDelta.toFixed(2)}</span>
        </div>
      );
    })}
  </div>
);


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

const TradeOrderTicket = ({ slot }) => {
  const toast = useToast();
  const positions = usePositions();
  const info = TRADE_TICKER_INFO[slot.ticker] || TRADE_TICKER_INFO.SPY;
  const chain = useMemo(() => genOptionsChain(info.price, info.iv, info.chainSeed), [slot.ticker]);
  const row = chain.find(r => r.k === slot.strike);
  const prem = row ? (slot.cp === "C" ? row.cPrem : row.pPrem) : 3.0;
  const bid = row ? (slot.cp === "C" ? row.cBid : row.pBid) : prem - 0.04;
  const ask = row ? (slot.cp === "C" ? row.cAsk : row.pAsk) : prem + 0.04;
  const spread = ask - bid;
  const spreadPct = (spread / prem) * 100;
  const delta = row ? Math.abs(slot.cp === "C" ? row.cDelta : row.pDelta) : 0.5;
  const contractColor = slot.cp === "C" ? T.green : T.red;
  const expInfo = EXPIRATIONS.find(e => e.v === slot.exp) || EXPIRATIONS[2];

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
  const maxLoss = cost;
  const breakeven = slot.cp === "C" ? slot.strike + fillPrice : slot.strike - fillPrice;
  const beMovePct = ((breakeven - info.price) / info.price) * 100;
  const pop = Math.max(15, Math.min(75, (0.5 - Math.abs(delta - 0.5)) * 100 + 25));
  const slPct = fillPrice > 0 ? ((stopLoss - fillPrice) / fillPrice * 100) : -35;
  const tpPct = fillPrice > 0 ? ((takeProfit - fillPrice) / fillPrice * 100) : 75;

  const submitOrder = () => {
    if (qtyNum <= 0) { toast.push({ kind: "error", title: "Invalid quantity", body: "Enter a positive number of contracts." }); return; }
    if (orderType !== "MKT" && (!Number.isFinite(fillPrice) || fillPrice <= 0)) {
      toast.push({ kind: "error", title: "Invalid limit", body: "Enter a positive limit price." }); return;
    }
    // IOC/FOK: simulate possible no-fill for realism
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
      orderType, tif,
    });
    toast.push({
      kind: "success",
      title: `${side === "BUY" ? "Opened" : "Shorted"} ${slot.ticker} ${slot.strike}${slot.cp}`,
      body: `${qtyNum} × $${fillPrice.toFixed(2)} · ${isLong ? "−" : "+"}$${cost.toFixed(0)} · ${orderType} ${tif}`,
    });
  };

  return (
    <div style={{ background: T.bg2, border: `1px solid ${T.border}`, borderRadius: dim(6), padding: sp("8px 10px"), display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ fontSize: fs(9), fontWeight: 700, color: T.textSec, fontFamily: T.display, letterSpacing: "0.08em", borderBottom: `1px solid ${T.border}`, paddingBottom: 4 }}>ORDER TICKET</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
        <span style={{ fontSize: fs(13), fontWeight: 800, fontFamily: T.mono, color: T.text }}>{slot.ticker}</span>
        <span style={{ fontSize: fs(12), fontWeight: 700, fontFamily: T.mono, color: contractColor }}>{slot.strike}{slot.cp}</span>
        <span style={{ fontSize: fs(9), color: T.textDim, fontFamily: T.mono }}>{slot.exp} · {expInfo.dte}d</span>
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
        style={{ marginTop: "auto", padding: sp("7px 0"), background: isLong ? T.green : T.red, border: "none", borderRadius: dim(4), color: "#fff", fontSize: fs(11), fontFamily: T.sans, fontWeight: 700, cursor: "pointer", letterSpacing: "0.04em" }}
      >
        {side} {qtyNum || 0} × ${fillPrice.toFixed(2)} · {isLong ? "−" : "+"}${cost.toFixed(0)}
      </button>
    </div>
  );
};

const TradeStrategyGreeksPanel = ({ slot, onApplyStrategy }) => {
  const info = TRADE_TICKER_INFO[slot.ticker] || TRADE_TICKER_INFO.SPY;
  const chain = useMemo(() => genOptionsChain(info.price, info.iv, info.chainSeed), [slot.ticker]);
  const row = chain.find(r => r.k === slot.strike);
  const delta = row ? (slot.cp === "C" ? row.cDelta : row.pDelta) : 0.5;
  const absDelta = Math.abs(delta);
  const gamma = +(0.08 - Math.abs(absDelta - 0.5) * 0.12).toFixed(3);
  const theta = -+(0.06 + Math.abs(absDelta - 0.5) * 0.05).toFixed(3);
  const vega = +(0.15 - Math.abs(absDelta - 0.5) * 0.08).toFixed(3);
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

const TradeL2Panel = ({ slot }) => {
  const info = TRADE_TICKER_INFO[slot.ticker] || TRADE_TICKER_INFO.SPY;
  const chain = useMemo(() => genOptionsChain(info.price, info.iv, info.chainSeed), [slot.ticker]);
  const row = chain.find(r => r.k === slot.strike);
  const mid = row ? (slot.cp === "C" ? row.cPrem : row.pPrem) : 3.0;
  const bid = row ? (slot.cp === "C" ? row.cBid : row.pBid) : mid - 0.04;
  const ask = row ? (slot.cp === "C" ? row.cAsk : row.pAsk) : mid + 0.04;
  const spread = ask - bid;
  const book = useMemo(() => genL2Book(mid, spread, info.chainSeed + slot.strike), [slot.ticker, slot.strike, slot.cp]);
  const tape = useMemo(() => genTradeTape(mid, info.chainSeed + slot.strike + 1000), [slot.ticker, slot.strike, slot.cp]);
  // Per-ticker order flow — bullishness mirrors the day's price change
  const tickerFlow = useMemo(() => genTickerFlow(info.chainSeed + 5000, info.pct >= 0 ? 0.58 : 0.42), [slot.ticker]);
  const maxSize = Math.max(...book.bids.map(b => b.size), ...book.asks.map(a => a.size));
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
        <span style={{ fontSize: fs(9), fontFamily: T.mono, color: contractColor, fontWeight: 700 }}>{slot.strike}{slot.cp}</span>
        <span style={{ fontSize: fs(8), color: T.textDim, fontFamily: T.mono }}>${spread.toFixed(2)} sprd</span>
      </div>

      {/* BOOK tab — Dynamic L2 with depth bars behind prices, buy/sell pressure header */}
      {tab === "book" && (() => {
        const totalBidSize = book.bids.reduce((s, b) => s + b.size, 0);
        const totalAskSize = book.asks.reduce((s, a) => s + a.size, 0);
        const buyPct = (totalBidSize / (totalBidSize + totalAskSize)) * 100;
        const sellPct = 100 - buyPct;
        const buyDominant = buyPct >= 50;
        const levels = Math.min(book.bids.length, book.asks.length, 7);
        return (
          <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, fontFamily: T.mono }}>
            {/* Buy/Sell pressure header */}
            <div style={{ marginBottom: sp(4) }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: fs(8), letterSpacing: "0.06em", marginBottom: sp(2) }}>
                <span style={{ color: T.green, fontWeight: 700 }}>BUY</span>
                <span style={{ color: buyDominant ? T.green : T.red, fontWeight: 700, fontSize: fs(10) }}>
                  {buyPct.toFixed(2)}%
                </span>
                <span style={{ color: T.red, fontWeight: 700 }}>SELL</span>
              </div>
              <div style={{ display: "flex", height: dim(5), borderRadius: dim(2), overflow: "hidden", background: T.bg3 }}>
                <div style={{ width: `${buyPct}%`, background: T.green, opacity: 0.85 }} />
                <div style={{ width: `${sellPct}%`, background: T.red, opacity: 0.85 }} />
              </div>
            </div>
            {/* Column header */}
            <div style={{
              display: "grid", gridTemplateColumns: "44px 1fr 24px 1fr 44px",
              gap: sp(4), padding: sp("3px 4px"), color: T.textMuted, fontSize: fs(7),
              letterSpacing: "0.08em", borderBottom: `1px solid ${T.border}`,
            }}>
              <span style={{ textAlign: "left" }}>SHARES</span>
              <span style={{ textAlign: "right", color: T.green, fontWeight: 700 }}>BID</span>
              <span style={{ textAlign: "center", padding: sp("1px 4px"), background: T.bg3, borderRadius: dim(2), color: T.textSec, fontWeight: 700 }}>{levels}</span>
              <span style={{ textAlign: "left", color: T.red, fontWeight: 700 }}>ASK</span>
              <span style={{ textAlign: "right" }}>SHARES</span>
            </div>
            {/* Rows */}
            {Array.from({ length: levels }).map((_, i) => {
              const b = book.bids[i];
              const a = book.asks[i];
              const bidBarPct = (b.size / maxSize) * 100;
              const askBarPct = (a.size / maxSize) * 100;
              return (
                <div key={i} style={{
                  display: "grid", gridTemplateColumns: "44px 1fr 24px 1fr 44px",
                  gap: sp(4), padding: sp("2px 4px"), alignItems: "center",
                  borderBottom: `1px solid ${T.border}10`,
                  fontSize: fs(10),
                }}>
                  {/* Left: bid shares */}
                  <span style={{ color: T.textSec, fontWeight: 600, textAlign: "left" }}>{b.size}</span>
                  {/* Bid price with depth bar growing right-to-left */}
                  <div style={{ position: "relative", textAlign: "right" }}>
                    <div style={{
                      position: "absolute", right: 0, top: -1, bottom: -1,
                      width: `${bidBarPct}%`, background: `${T.green}28`,
                      borderRadius: dim(2),
                    }} />
                    <span style={{ position: "relative", color: T.green, fontWeight: 700, paddingRight: sp(3) }}>
                      {b.price.toFixed(2)}
                    </span>
                  </div>
                  {/* Level number */}
                  <span style={{ textAlign: "center", color: T.textMuted, fontSize: fs(8), fontWeight: 600 }}>{i + 1}</span>
                  {/* Ask price with depth bar growing left-to-right */}
                  <div style={{ position: "relative", textAlign: "left" }}>
                    <div style={{
                      position: "absolute", left: 0, top: -1, bottom: -1,
                      width: `${askBarPct}%`, background: `${T.red}28`,
                      borderRadius: dim(2),
                    }} />
                    <span style={{ position: "relative", color: T.red, fontWeight: 700, paddingLeft: sp(3) }}>
                      {a.price.toFixed(2)}
                    </span>
                  </div>
                  {/* Right: ask shares */}
                  <span style={{ color: T.textSec, fontWeight: 600, textAlign: "right" }}>{a.size}</span>
                </div>
              );
            })}
            {/* Footer with totals */}
            <div style={{
              display: "grid", gridTemplateColumns: "1fr 24px 1fr",
              gap: sp(4), padding: sp("3px 4px"), marginTop: sp(2),
              borderTop: `1px solid ${T.border}`, fontSize: fs(8), color: T.textDim,
            }}>
              <span style={{ textAlign: "left" }}>Σ <span style={{ color: T.green, fontWeight: 600 }}>{totalBidSize}</span></span>
              <span></span>
              <span style={{ textAlign: "right" }}><span style={{ color: T.red, fontWeight: 600 }}>{totalAskSize}</span> Σ</span>
            </div>
          </div>
        );
      })()}

      {/* FLOW tab — order flow distribution for this ticker */}
      {tab === "flow" && (
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
                const buyPct = (buy / (buy + sell)) * 100;
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
      )}

      {/* TAPE tab — recent prints feed */}
      {tab === "tape" && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div style={{ display: "grid", gridTemplateColumns: "60px 1fr 1fr 22px", gap: sp(4), padding: sp("1px 4px"), color: T.textMuted, fontSize: fs(7), letterSpacing: "0.08em" }}>
            <span>TIME</span>
            <span style={{ textAlign: "right" }}>PRICE</span>
            <span style={{ textAlign: "right" }}>SIZE</span>
            <span style={{ textAlign: "center" }}>SIDE</span>
          </div>
          <div style={{ flex: 1, overflow: "auto", fontFamily: T.mono, fontSize: fs(9) }}>
            {tape.map((t, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "60px 1fr 1fr 22px", gap: sp(4), padding: sp("2px 4px"), borderBottom: `1px solid ${T.border}10`, background: t.size > 30 ? `${t.side === "B" ? T.green : T.red}08` : "transparent" }}>
                <span style={{ color: T.textDim, fontSize: fs(8) }}>{t.time}</span>
                <span style={{ color: t.side === "B" ? T.green : T.red, fontWeight: 600, textAlign: "right" }}>${t.price.toFixed(2)}</span>
                <span style={{ color: t.size > 30 ? T.text : T.textSec, fontWeight: t.size > 30 ? 700 : 400, textAlign: "right" }}>×{t.size}</span>
                <span style={{ color: t.side === "B" ? T.green : T.red, fontSize: fs(8), textAlign: "center", fontWeight: 700 }}>{t.side}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};


const TradePositionsPanel = ({ onLoadPosition }) => {
  const toast = useToast();
  const pos = usePositions();
  const [tab, setTab] = useState("open");
  const [seedClosed, setSeedClosed] = useState(new Set());  // ids of seed positions user closed

  // Merge seeded OPEN_POSITIONS (for nice initial demo) with user's mock fills.
  // User fills from PositionsContext render on top.
  const openPositions = useMemo(() => {
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
  }, [pos.positions, seedClosed]);

  const totalOpenPnl = openPositions.reduce((a, p) => a + p.pnl, 0);
  const totalHistPnl = TRADE_HISTORY.reduce((a, p) => a + p.pnl, 0);
  const parseContract = str => { const parts = str.split(" "); return { strike: parseInt(parts[0], 10), cp: parts[1], exp: parts[2] }; };

  const closeRow = (p) => {
    if (p._isUser) pos.closePosition(p._id);
    else setSeedClosed(prev => new Set([...prev, p._seedIdx]));
    toast.push({
      kind: p.pnl >= 0 ? "success" : "warn",
      title: "Position closed",
      body: `${p.ticker} ${p.contract} · ${p.pnl >= 0 ? "+" : ""}$${p.pnl.toFixed(0)} (${p.pct >= 0 ? "+" : ""}${p.pct.toFixed(1)}%)`,
    });
  };

  const handleCloseAll = () => {
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
                  title="Close position"
                  style={{ background: "transparent", border: `1px solid ${T.red}40`, color: T.red, fontSize: fs(9), fontFamily: T.mono, fontWeight: 700, borderRadius: dim(2), cursor: "pointer", padding: sp("1px 0"), lineHeight: 1 }}
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
const TradeTickerHeader = ({ ticker }) => {
  const info = TRADE_TICKER_INFO[ticker] || TRADE_TICKER_INFO.SPY;
  const pos = info.pct >= 0;
  const chain = useMemo(() => genOptionsChain(info.price, info.iv, info.chainSeed), [ticker]);
  const atmRow = chain.find(r => r.isAtm);
  const impMove = atmRow ? (atmRow.cPrem + atmRow.pPrem) * 0.85 : 0;
  const impPct = (impMove / info.price) * 100;
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
        <div><span style={{ color: T.textMuted }}>VOL </span><span style={{ color: T.text, fontWeight: 600 }}>29.8M</span></div>
        <div><span style={{ color: T.textMuted }}>IV </span><span style={{ color: T.text, fontWeight: 600 }}>{(info.iv * 100).toFixed(1)}%</span></div>
        <div><span style={{ color: T.textMuted }}>IMP </span><span style={{ color: T.cyan, fontWeight: 700 }}>±${impMove.toFixed(2)}</span> <span style={{ color: T.textDim }}>({impPct.toFixed(2)}%)</span></div>
        <div><span style={{ color: T.textMuted }}>ATM </span><span style={{ color: T.accent, fontWeight: 600 }}>{Math.round(info.price / 5) * 5}</span></div>
      </div>
    </div>
  );
};

// ─── FOCUSED EQUITY CHART PANEL ───
// Big equity chart with full controls: timeframes, drawing tools, candles, crosshair, flow markers.
// Always large (no expand toggle needed in single-ticker mode).
const TradeEquityPanel = ({ ticker }) => {
  const info = TRADE_TICKER_INFO[ticker] || TRADE_TICKER_INFO.SPY;
  const [tf, setTf] = useState("5m");
  const [drawings, setDrawings] = useState([]);
  const [drawMode, setDrawMode] = useState(null);
  const tfMeta = TRADE_TIMEFRAMES.find(x => x.v === tf) || TRADE_TIMEFRAMES[1];
  const bars = useMemo(() => genTradeBars(info.barSeed + tfMeta.bars, info.price), [ticker, tf]);
  const markers = TRADE_FLOW_MARKERS[ticker] || [];
  const callFlows = markers.filter(m => m.cp === "C").length;
  const putFlows = markers.filter(m => m.cp === "P").length;

  return (
    <div style={{ background: T.bg2, border: `1px solid ${T.border}`, borderRadius: dim(6), display: "flex", flexDirection: "column", overflow: "hidden", height: "100%" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", padding: sp("6px 10px"), borderBottom: `1px solid ${T.border}`, gap: sp(8), flexShrink: 0 }}>
        <span style={{ fontSize: fs(10), fontWeight: 700, fontFamily: T.display, color: T.textSec, letterSpacing: "0.06em" }}>EQUITY</span>
        <div style={{ display: "flex", gap: sp(2) }}>
          {TRADE_TIMEFRAMES.map(t => (
            <button
              key={t.v}
              onClick={() => setTf(t.v)}
              style={{ padding: sp("2px 8px"), background: t.v === tf ? T.accentDim : "transparent", border: `1px solid ${t.v === tf ? T.accent : T.border}`, borderRadius: dim(3), color: t.v === tf ? T.accent : T.textDim, fontSize: fs(9), fontFamily: T.mono, fontWeight: 600, cursor: "pointer" }}
            >{t.tag}</button>
          ))}
        </div>
        <span style={{ flex: 1 }} />
        <div style={{ display: "flex", gap: sp(2) }}>
          <button
            onClick={() => setDrawMode(drawMode === "horizontal" ? null : "horizontal")}
            title="Horizontal level"
            style={{ padding: sp("2px 8px"), background: drawMode === "horizontal" ? `${T.amber}25` : "transparent", border: `1px solid ${drawMode === "horizontal" ? T.amber : T.border}`, borderRadius: dim(3), color: drawMode === "horizontal" ? T.amber : T.textDim, fontSize: fs(9), fontFamily: T.mono, cursor: "pointer" }}
          >─ H</button>
          <button
            onClick={() => { setDrawings([]); setDrawMode(null); }}
            title="Clear drawings"
            style={{ padding: sp("2px 8px"), background: "transparent", border: `1px solid ${T.border}`, borderRadius: dim(3), color: T.textDim, fontSize: fs(9), fontFamily: T.mono, cursor: "pointer" }}
          >✕</button>
        </div>
        <div style={{ fontSize: fs(9), fontFamily: T.mono, color: T.textMuted }}>
          <span style={{ color: T.green }}>C {callFlows}</span> · <span style={{ color: T.red }}>P {putFlows}</span>
        </div>
      </div>
      {/* Chart body */}
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <div style={{ flex: 1, minHeight: 0 }}>
          <CandleChart bars={bars} markers={markers} drawings={drawings} drawMode={drawMode} onAddDrawing={d => setDrawings(prev => [...prev, d])} />
        </div>
        <div style={{ height: dim(48), flexShrink: 0, position: "relative" }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={bars.map(b => ({ ...b, vNormal: b.v * (1 - (b.uoa || 0)), vUoa: b.v * (b.uoa || 0) }))}
              margin={{ top: 0, right: 8, bottom: 0, left: -30 }}
            >
              <XAxis dataKey="t" hide />
              <YAxis tick={{ fontSize: fs(7), fill: T.textMuted }} axisLine={false} />
              {/* Normal volume — colored by candle direction */}
              <Bar dataKey="vNormal" stackId="vol" isAnimationActive={false}>
                {bars.map((b, i) => (
                  <Cell key={i} fill={b.c >= b.o ? `${T.green}50` : `${T.red}50`} />
                ))}
              </Bar>
              {/* Unusual options activity overlay — amber on top */}
              <Bar dataKey="vUoa" stackId="vol" radius={[1, 1, 0, 0]} fill={T.amber} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
          {/* UOA legend */}
          <div style={{ position: "absolute", top: 2, right: 12, fontSize: fs(7), fontFamily: T.mono, color: T.textMuted, display: "flex", alignItems: "center", gap: sp(3), pointerEvents: "none" }}>
            <span style={{ display: "inline-block", width: dim(6), height: dim(6), background: T.amber, borderRadius: 1 }} />
            <span>UOA</span>
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── FOCUSED OPTIONS CHAIN PANEL ───
// Taller chain panel. Header has expiration selector + implied move + ATM strike.
const TradeChainPanel = ({ ticker, contract, onSelectContract, onChangeExp }) => {
  const info = TRADE_TICKER_INFO[ticker] || TRADE_TICKER_INFO.SPY;
  const chain = useMemo(() => genOptionsChain(info.price, info.iv, info.chainSeed), [ticker]);
  const expInfo = EXPIRATIONS.find(e => e.v === contract.exp) || EXPIRATIONS[2];
  const heldForTicker = OPEN_POSITIONS.filter(p => p.ticker === ticker).map(p => {
    const parts = p.contract.split(" ");
    return { strike: parseInt(parts[0], 10), cp: parts[1], exp: parts[2] };
  }).filter(hp => hp.exp === contract.exp);

  return (
    <div style={{ background: T.bg2, border: `1px solid ${T.border}`, borderRadius: dim(6), display: "flex", flexDirection: "column", overflow: "hidden", height: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", padding: sp("6px 10px"), borderBottom: `1px solid ${T.border}`, gap: sp(8), flexShrink: 0 }}>
        <span style={{ fontSize: fs(10), fontWeight: 700, fontFamily: T.display, color: T.textSec, letterSpacing: "0.06em" }}>OPTIONS CHAIN</span>
        <select
          value={contract.exp}
          onChange={e => onChangeExp(e.target.value)}
          style={{ background: T.bg3, border: `1px solid ${T.border}`, color: T.text, fontSize: fs(9), fontFamily: T.mono, fontWeight: 600, cursor: "pointer", padding: sp("2px 6px"), borderRadius: dim(3), outline: "none" }}
        >
          {EXPIRATIONS.map(ex => <option key={ex.v} value={ex.v}>{ex.v} · {ex.tag}</option>)}
        </select>
        <span style={{ fontSize: fs(9), color: expInfo.dte === 0 ? T.amber : T.textDim, fontFamily: T.mono, fontWeight: expInfo.dte === 0 ? 700 : 400 }}>{expInfo.dte}d</span>
        <span style={{ flex: 1 }} />
        {(() => {
          const atmRow = chain.find(r => r.isAtm);
          const impMove = atmRow ? (atmRow.cPrem + atmRow.pPrem) * 0.85 : 0;
          const impPct = (impMove / info.price) * 100;
          return <span style={{ fontSize: fs(9), fontFamily: T.mono }}>IMP <span style={{ color: T.cyan, fontWeight: 700 }}>±${impMove.toFixed(2)}</span> <span style={{ color: T.textDim }}>({impPct.toFixed(2)}%)</span></span>;
        })()}
        <span style={{ fontSize: fs(9), fontFamily: T.mono }}>ATM <span style={{ color: T.accent, fontWeight: 700 }}>{Math.round(info.price / 5) * 5}</span></span>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
        <TradeOptionsChain
          chain={chain}
          selected={{ strike: contract.strike, cp: contract.cp }}
          onSelect={(k, cp) => onSelectContract(k, cp)}
          heldStrikes={heldForTicker}
        />
      </div>
    </div>
  );
};

// ─── FOCUSED CONTRACT DETAIL PANEL ───
// Selected contract chart with entry line + HOLDING badge.
const TradeContractDetailPanel = ({ ticker, contract }) => {
  const info = TRADE_TICKER_INFO[ticker] || TRADE_TICKER_INFO.SPY;
  const chain = useMemo(() => genOptionsChain(info.price, info.iv, info.chainSeed), [ticker]);
  const selectedRow = chain.find(r => r.k === contract.strike);
  const basePrem = selectedRow ? (contract.cp === "C" ? selectedRow.cPrem : selectedRow.pPrem) : 3.0;
  const optBars = useMemo(
    () => genOptionPriceBars(basePrem, info.optSeed + contract.strike + (contract.cp === "C" ? 0 : 1000)),
    [ticker, contract.strike, contract.cp, contract.exp]
  );
  const contractColor = contract.cp === "C" ? T.green : T.red;
  const contractStr = `${ticker} ${contract.strike}${contract.cp} ${contract.exp}`;
  const heldForTicker = OPEN_POSITIONS.filter(p => p.ticker === ticker).map(p => {
    const parts = p.contract.split(" ");
    return { strike: parseInt(parts[0], 10), cp: parts[1], exp: parts[2], entry: p.entry, pnl: p.pnl, pct: p.pct };
  });
  const activeHolding = heldForTicker.find(hp => hp.strike === contract.strike && hp.cp === contract.cp && hp.exp === contract.exp);

  return (
    <div style={{ background: T.bg2, border: `1px solid ${T.border}`, borderRadius: dim(6), display: "flex", flexDirection: "column", overflow: "hidden", height: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", padding: sp("6px 10px"), borderBottom: `1px solid ${T.border}`, gap: sp(8), flexShrink: 0 }}>
        <span style={{ fontSize: fs(10), fontWeight: 700, fontFamily: T.display, color: T.textSec, letterSpacing: "0.06em" }}>CONTRACT</span>
        <span style={{ fontSize: fs(11), fontWeight: 700, fontFamily: T.mono, color: contractColor }}>{contract.strike}{contract.cp}</span>
        <span style={{ fontSize: fs(9), color: T.textDim, fontFamily: T.mono }}>{contract.exp}</span>
        <span style={{ flex: 1 }} />
        {activeHolding && (
          <span style={{ padding: sp("2px 6px"), background: `${T.amber}18`, border: `1px solid ${T.amber}50`, borderRadius: dim(3), fontSize: fs(9), fontFamily: T.mono, fontWeight: 700, color: T.amber }}>★ HOLDING {activeHolding.qty || ""}</span>
        )}
        {activeHolding && (
          <span style={{ fontSize: fs(11), fontFamily: T.mono, fontWeight: 700, color: activeHolding.pnl >= 0 ? T.green : T.red }}>
            {activeHolding.pnl >= 0 ? "+" : ""}${activeHolding.pnl}
          </span>
        )}
        <span style={{ fontSize: fs(13), fontWeight: 700, fontFamily: T.mono, color: contractColor }}>${basePrem.toFixed(2)}</span>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <TradeOptionChart bars={optBars} color={contractColor} contract={contractStr} holding={activeHolding} />
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

const TradeOptionsFlowPanel = ({ ticker }) => {
  const info = TRADE_TICKER_INFO[ticker] || TRADE_TICKER_INFO.SPY;
  const bullish = info.pct >= 0 ? 0.58 : 0.42;
  const dteData = useMemo(() => genOptionsFlowByDTE(info.chainSeed + 8000, bullish), [ticker]);
  const strikeData = useMemo(() => genOptionsFlowByStrike(info.chainSeed + 9000, info.price), [ticker]);
  const timelineData = useMemo(() => genOptionsFlowTimeline(info.chainSeed + 10000, bullish), [ticker]);

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
const TradeSpotFlowPanel = ({ ticker }) => {
  const info = TRADE_TICKER_INFO[ticker] || TRADE_TICKER_INFO.SPY;
  const tickerFlow = useMemo(() => genTickerFlow(info.chainSeed + 5000, info.pct >= 0 ? 0.58 : 0.42), [ticker]);
  const totalBuy = tickerFlow.buyXL + tickerFlow.buyL + tickerFlow.buyM + tickerFlow.buyS;
  const totalSell = tickerFlow.sellXL + tickerFlow.sellL + tickerFlow.sellM + tickerFlow.sellS;
  const buyPct = ((totalBuy / (totalBuy + totalSell)) * 100).toFixed(1);
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

const TradeScreen = ({ sym, symPing }) => {
  // Initialize from persisted state, falling back to sym prop or sensible defaults
  const initialTicker = (() => {
    const persistedActive = _initialState.tradeActiveTicker;
    if (persistedActive && TRADE_TICKER_INFO[persistedActive]) return persistedActive;
    if (sym && TRADE_TICKER_INFO[sym]) return sym;
    return "SPY";
  })();
  const initialRecent = (() => {
    const persistedRecent = _initialState.tradeRecentTickers;
    if (Array.isArray(persistedRecent) && persistedRecent.length > 0) {
      // Filter out any tickers no longer in TRADE_TICKER_INFO
      const valid = persistedRecent.filter(t => TRADE_TICKER_INFO[t]);
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
  const contract = contracts[activeTicker] || (() => {
    const info = TRADE_TICKER_INFO[activeTicker] || TRADE_TICKER_INFO.SPY;
    return { strike: Math.round(info.price / 5) * 5, cp: "C", exp: "04/25" };
  })();
  const updateContract = (patch) => setContracts(c => ({ ...c, [activeTicker]: { ...contract, ...patch } }));

  // Persist trade state changes
  useEffect(() => { persistState({ tradeActiveTicker: activeTicker }); }, [activeTicker]);
  useEffect(() => { persistState({ tradeRecentTickers: recentTickers }); }, [recentTickers]);
  useEffect(() => { persistState({ tradeContracts: contracts }); }, [contracts]);

  // Helper: focus a ticker, and add to recent strip if not present
  const focusTicker = (ticker) => {
    if (!TRADE_TICKER_INFO[ticker]) return;
    setActiveTicker(ticker);
    setRecentTickers(prev => prev.includes(ticker) ? prev : [...prev, ticker].slice(-8));
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
    if (!TRADE_TICKER_INFO[symPing.sym]) return;
    focusTicker(symPing.sym);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symPing && symPing.n]);

  // Strategy → pick a strike near the desired delta on the active ticker's chain
  const applyStrategy = (strategy) => {
    const info = TRADE_TICKER_INFO[activeTicker] || TRADE_TICKER_INFO.SPY;
    const chain = genOptionsChain(info.price, info.iv, info.chainSeed);
    let bestStrike = chain[0].k;
    let bestDist = Infinity;
    for (const row of chain) {
      const d = Math.abs(strategy.cp === "C" ? row.cDelta : row.pDelta);
      const dist = Math.abs(d - strategy.deltaTarget);
      if (dist < bestDist) { bestDist = dist; bestStrike = row.k; }
    }
    const targetExp = strategy.dte === 0 ? "04/18" : strategy.dte <= 7 ? "04/25" : "05/02";
    updateContract({ strike: bestStrike, cp: strategy.cp, exp: targetExp });
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
        onAddNew={() => {
          const all = Object.keys(TRADE_TICKER_INFO);
          const next = all.find(t => !recentTickers.includes(t));
          if (next) focusTicker(next);
        }}
      />
      {/* Main workspace */}
      <div style={{ flex: 1, padding: sp(6), display: "flex", flexDirection: "column", gap: sp(6), overflow: "auto" }}>
        {/* Compact ticker header */}
        <TradeTickerHeader ticker={activeTicker} />
        {/* Top zone: Equity chart + Options chain side by side */}
        <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: sp(6), height: dim(340), flexShrink: 0 }}>
          <TradeEquityPanel ticker={activeTicker} />
          <TradeChainPanel
            ticker={activeTicker}
            contract={contract}
            onSelectContract={(strike, cp) => updateContract({ strike, cp })}
            onChangeExp={(exp) => updateContract({ exp })}
          />
        </div>
        {/* Middle zone: Contract chart + Spot flow + Options flow */}
        <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1.5fr", gap: sp(6), height: dim(260), flexShrink: 0 }}>
          <TradeContractDetailPanel ticker={activeTicker} contract={contract} />
          <TradeSpotFlowPanel ticker={activeTicker} />
          <TradeOptionsFlowPanel ticker={activeTicker} />
        </div>
        {/* Bottom zone: Order ticket + Strategy/Greeks + L2/Tape/Flow tabs + Positions */}
        <div style={{ display: "grid", gridTemplateColumns: "minmax(260px, 1fr) minmax(280px, 1fr) minmax(280px, 1fr) minmax(360px, 1.4fr)", gap: sp(6), height: dim(290), flexShrink: 0 }}>
          <TradeOrderTicket slot={slot} />
          <TradeStrategyGreeksPanel slot={slot} onApplyStrategy={applyStrategy} />
          <TradeL2Panel slot={slot} />
          <TradePositionsPanel onLoadPosition={({ ticker, strike, cp, exp }) => {
            focusTicker(ticker);
            setContracts(c => ({ ...c, [ticker]: { strike, cp, exp } }));
          }} />
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

const ResearchScreen = ({ onJumpToTrade }) => {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", background: T.bg0 }}>
      {/* ── HEADER ── */}
      <div style={{
        padding: sp("10px 16px"),
        borderBottom: `1px solid ${T.border}`,
        display: "flex", alignItems: "center", gap: sp(10),
        background: T.bg1, flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: sp(8) }}>
          <span style={{ fontSize: fs(16), fontFamily: T.display, fontWeight: 700, color: T.text, letterSpacing: "-0.01em" }}>
            Emerging Themes
          </span>
          <span style={{ fontSize: fs(10), color: T.textDim, fontFamily: T.sans, fontVariant: "all-small-caps", letterSpacing: "0.06em" }}>
            Research · thematic equity analysis
          </span>
        </div>
        <span style={{ flex: 1 }} />
        <span style={{
          fontSize: fs(8), padding: sp("2px 6px"), borderRadius: dim(3),
          background: `${T.amber}15`, color: T.amber,
          fontFamily: T.mono, fontVariant: "all-small-caps", letterSpacing: "0.08em", fontWeight: 700,
        }}>
          ◇ Preview · content pending
        </span>
      </div>

      {/* ── BODY ── scrollable placeholder that previews the integration plan */}
      <div style={{ flex: 1, overflowY: "auto", padding: sp(16) }}>
        <div style={{ maxWidth: dim(1000), margin: "0 auto", display: "flex", flexDirection: "column", gap: sp(14) }}>

          {/* Intro card */}
          <div style={{
            background: T.bg2, border: `1px solid ${T.border}`, borderRadius: dim(6),
            padding: sp("14px 18px"),
          }}>
            <div style={{ fontSize: fs(11), fontVariant: "all-small-caps", letterSpacing: "0.08em", color: T.textDim, fontWeight: 600, marginBottom: sp(6) }}>
              About this tab
            </div>
            <div style={{ fontSize: fs(12), color: T.textSec, lineHeight: 1.6, fontFamily: T.sans }}>
              The <strong style={{ color: T.text }}>Photonics Dashboard</strong> — a thematic equity research
              tool covering AI infrastructure, aerospace & defense, nuclear, space, robotics, and quantum computing —
              will live here. It drops into this scaffolded tab with its force-directed supply-chain graph,
              comparative financials, macro sensitivity matrix, and earnings calendar.
            </div>
            <div style={{ fontSize: fs(11), color: T.textDim, lineHeight: 1.5, fontFamily: T.sans, marginTop: sp(6) }}>
              Cross-navigation is already wired: clicking any ticker in the research graph will be able to
              launch the Trade tab with that symbol preloaded. Watchlist integration and shared theme
              state will follow.
            </div>
          </div>

          {/* Planned themes preview */}
          <div>
            <div style={{ fontSize: fs(11), fontVariant: "all-small-caps", letterSpacing: "0.08em", color: T.textDim, fontWeight: 600, marginBottom: sp(8) }}>
              Planned themes · 6 editorial packs
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: sp(8) }}>
              {RESEARCH_THEMES_PLANNED.map(t => (
                <div key={t.id} style={{
                  background: T.bg2, border: `1px solid ${T.border}`,
                  borderLeft: `3px solid ${t.accent}`,
                  borderRadius: dim(6), padding: sp("10px 12px"),
                  opacity: 0.75,
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: sp(5), marginBottom: sp(3) }}>
                    <span style={{ fontSize: fs(13), color: t.accent }}>{t.icon}</span>
                    <span style={{ fontSize: fs(12), fontFamily: T.display, fontWeight: 700, color: T.text }}>{t.title}</span>
                    {t.meta && (
                      <span style={{
                        fontSize: fs(7), padding: sp("1px 4px"), borderRadius: dim(2),
                        background: `${T.textMuted}20`, color: T.textMuted,
                        fontFamily: T.mono, fontWeight: 700, letterSpacing: "0.04em",
                      }}>META</span>
                    )}
                  </div>
                  <div style={{ fontSize: fs(10), color: T.textDim, fontFamily: T.sans, lineHeight: 1.4 }}>
                    {t.subtitle}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Integration checklist */}
          <div style={{
            background: T.bg2, border: `1px solid ${T.border}`, borderRadius: dim(6),
            padding: sp("14px 18px"),
          }}>
            <div style={{ fontSize: fs(11), fontVariant: "all-small-caps", letterSpacing: "0.08em", color: T.textDim, fontWeight: 600, marginBottom: sp(8) }}>
              Integration status
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: sp(4) }}>
              {[
                ["Tab slot in navigation", true],
                ["Screen routing wired", true],
                ["Right rail suppression when active", true],
                ["Cross-nav hook to Trade tab", true],
                ["Theme tokens available (T, fs, dim, sp)", true],
                ["Photonics component imported", false],
                ["COMPANIES data ported", false],
                ["Light → dark theme adaptation", false],
                ["Watchlist ↔ Research linking", false],
              ].map(([label, done]) => (
                <div key={label} style={{
                  display: "flex", alignItems: "center", gap: sp(8),
                  fontSize: fs(11), fontFamily: T.mono,
                  color: done ? T.green : T.textDim,
                }}>
                  <span style={{ fontSize: fs(11), width: dim(14) }}>{done ? "✓" : "○"}</span>
                  <span>{label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Cross-nav smoke test */}
          <div style={{
            background: T.bg2, border: `1px dashed ${T.border}`, borderRadius: dim(6),
            padding: sp("14px 18px"),
          }}>
            <div style={{ fontSize: fs(11), fontVariant: "all-small-caps", letterSpacing: "0.08em", color: T.textDim, fontWeight: 600, marginBottom: sp(6) }}>
              Cross-nav smoke test
            </div>
            <div style={{ fontSize: fs(11), color: T.textDim, fontFamily: T.sans, marginBottom: sp(8), lineHeight: 1.4 }}>
              Verify the Research → Trade jump works before Photonics ships. Click any ticker to open its Trade tab.
            </div>
            <div style={{ display: "flex", gap: sp(6), flexWrap: "wrap" }}>
              {["SPY", "QQQ", "NVDA", "AAPL", "AMD"].map(t => (
                <button
                  key={t}
                  onClick={() => onJumpToTrade && onJumpToTrade(t)}
                  style={{
                    padding: sp("5px 10px"), fontSize: fs(11), fontFamily: T.mono,
                    fontWeight: 700, background: "transparent",
                    color: T.accent, border: `1px solid ${T.accent}60`,
                    borderRadius: dim(4), cursor: "pointer",
                    transition: "all 0.15s",
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.background = `${T.accent}15`;
                    e.currentTarget.style.borderColor = T.accent;
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.background = "transparent";
                    e.currentTarget.style.borderColor = `${T.accent}60`;
                  }}
                >{t} →</button>
              ))}
            </div>
          </div>

          {/* Data source notes */}
          <div style={{ fontSize: fs(10), color: T.textMuted, fontFamily: T.sans, textAlign: "center", padding: sp(8), lineHeight: 1.5 }}>
            Photonics Dashboard uses <span style={{ fontFamily: T.mono, color: T.textDim }}>api.financialmodelingprep.com</span> for
            live quotes, fundamentals, historical prices, and earnings calendar. API key handling will move to platform settings during integration.
          </div>

        </div>
      </div>
    </div>
  );
};

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
  const [screen, setScreen] = useState(_initialState.screen || "market");
  const [sym, setSym] = useState(_initialState.sym || "SPY");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(_initialState.sidebarCollapsed || false);
  const [theme, setTheme] = useState(_initialState.theme || "dark");
  const [scale, setScaleState] = useState(_initialState.scale || "m");
  // Pending sym hand-off to Trade tab — bumped each time a watchlist item is clicked
  // so TradeScreen can react even when the same sym is clicked twice
  const [tradeSymPing, setTradeSymPing] = useState({ sym: _initialState.sym || "SPY", n: 0 });

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
    setTradeSymPing(prev => ({ sym: newSym, n: prev.n + 1 }));
  };

  // Jump to Trade tab from Flow drawer with a contract preloaded
  const handleJumpToTradeFromFlow = (evt) => {
    if (TRADE_TICKER_INFO[evt.ticker]) {
      setSym(evt.ticker);
      setTradeSymPing(prev => ({ sym: evt.ticker, n: prev.n + 1 }));
    }
    setScreen("trade");
  };

  // Jump to Trade tab from Research with a ticker preloaded.
  // Research passes a plain ticker string rather than a flow event.
  const handleJumpToTradeFromResearch = (ticker) => {
    if (TRADE_TICKER_INFO[ticker]) {
      setSym(ticker);
      setTradeSymPing(prev => ({ sym: ticker, n: prev.n + 1 }));
    }
    setScreen("trade");
  };

  const renderScreen = () => {
    switch (screen) {
      case "market": return <MarketScreen sym={sym} onSymClick={handleSelectSymbol} />;
      case "flow": return <FlowScreen onJumpToTrade={handleJumpToTradeFromFlow} />;
      case "trade": return <TradeScreen sym={sym} symPing={tradeSymPing} />;
      case "research": return <ResearchScreen onJumpToTrade={handleJumpToTradeFromResearch} />;
      case "algo": return <AlgoScreen />;
      case "backtest": return <BacktestScreen />;
      default: return <MarketScreen sym={sym} onSymClick={handleSelectSymbol} />;
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
            <div style={{ fontSize: fs(13), fontFamily: T.mono, fontWeight: 700, color: T.text }}>$28,432</div>
          </div>
          <div style={{ width: dim(1), height: dim(22), background: T.border }} />
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: fs(8), color: T.textMuted, fontWeight: 600, letterSpacing: "0.1em" }}>DAILY P&L</div>
            <div style={{ fontSize: fs(13), fontFamily: T.mono, fontWeight: 700, color: T.green }}>+$342</div>
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
          <div style={{ width: dim(6), height: dim(6), borderRadius: "50%", background: T.green }} />
          <span style={{ color: T.green, fontWeight: 600 }}>PAPER</span>
        </div>
        <span style={{ color: T.textMuted }}>SPY {WATCHLIST[0].price} {WATCHLIST[0].chg >= 0 ? "+" : ""}{WATCHLIST[0].pct}%</span>
        <span style={{ color: T.textMuted }}>VIX {WATCHLIST[3].price}</span>
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
