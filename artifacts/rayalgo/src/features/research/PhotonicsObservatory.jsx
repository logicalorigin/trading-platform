import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { AI_VERTICALS, BRAND, FMP_REVERSE } from "./data/researchSymbols";
import { FONT_WEIGHTS, RADII, T, fs, sp } from "../../lib/uiTokens.jsx";
import {
  getResearchRuntimeData,
  prefetchResearchThemeDataset,
  useResearchRuntimeData,
} from "./data/runtime";
import { CalendarView } from "./components/ResearchCalendarView";
import { Logo } from "./components/ResearchLogo";
import { SettingsPanel } from "./components/ResearchSettingsPanel";
import { ThemeSwitcher } from "./components/ResearchThemeSwitcher";
import {
  backgroundPrefetchFundamentals,
  fetchFinancials,
  fetchFund,
  fetchHist,
  fetchQuotes,
  fetchResearchStatus,
  fetchSECFilings,
  fetchTranscript,
  fetchTranscriptList,
} from "./lib/researchApi";
import { useIbkrQuoteSnapshotStream } from "../platform/live-streams";
import { useRuntimeWorkloadFlag } from "../platform/workloadStats";
import { useUserPreferences } from "../preferences/useUserPreferences";
import {
  formatAppDateForPreferences,
  formatAppTimeForPreferences,
} from "../../lib/timeZone";
import { chartTooltipContentStyle } from "../../lib/tooltipStyles";
import * as d3 from "d3";
import { BarChart, Bar, LineChart, Line, AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ReferenceLine, ScatterChart, Scatter, ZAxis, LabelList } from "recharts";
import { AppTooltip } from "@/components/ui/tooltip";


let {
  AI_MACRO,
  COMPANIES,
  EDGES,
  THEMES,
  THEME_ORDER,
  VX,
  themeMatchesCompany,
  resolveCompanyVertical,
} = getResearchRuntimeData();

function applyResearchRuntimeData(data) {
  AI_MACRO = data.AI_MACRO;
  COMPANIES = data.COMPANIES;
  EDGES = data.EDGES;
  THEMES = data.THEMES;
  THEME_ORDER = data.THEME_ORDER;
  VX = data.VX;
  themeMatchesCompany = data.themeMatchesCompany;
  resolveCompanyVertical = data.resolveCompanyVertical;
}

/* ═══════════════════════════════════════════════════════════════════════════
   ╔══════════════════════════════════════════════════════════════════════╗
   ║                         CODE SECTION                                  ║
   ║  Everything below is React components, data fetchers, and logic.     ║
   ║  You should not need to edit below unless changing behavior.         ║
   ╚══════════════════════════════════════════════════════════════════════╝
   ═══════════════════════════════════════════════════════════════════════════ */

// ───── SHARED STYLE CONSTANTS (module-level; used across multiple components) ─────
const FALLBACK_THEME = {
  id: "ai",
  title: "Platform Research",
  subtitle: "Hydrating Research Dataset",
  accent: T.accent,
  icon: "◆",
  verticals: AI_VERTICALS,
  macro: [],
  available: true,
};

// Standard "card" container used by MarketSummary rows, Detail subsections, etc.
const STYLE_CARD = {
  background: T.bg1,
  border: "1px solid rgba(0,0,0,.06)",
  borderRadius: RADII.md,
  boxShadow: "0 1px 3px rgba(0,0,0,.03)",
};

// Uppercase section label: "Price history", "Supply chain", etc.
const STYLE_LABEL = {
  fontSize: fs(11),
  fontWeight: FONT_WEIGHTS.regular,
  color: T.textMuted,
  letterSpacing: 1.5,
  textTransform: "uppercase",
  marginBottom: sp(5),
};

// Dimmer variant used in MarketSummary row headers
const STYLE_LABEL_DIM = { ...STYLE_LABEL, color: T.textDim, marginBottom: sp(6) };

// Visual divider between Detail sections
const STYLE_SECTION = {
  borderTop: "1px solid rgba(0,0,0,.06)",
  paddingTop: sp(10),
  marginTop: sp(10),
};

// Deprecated aliases kept so scatter-reference sections that haven't been refactored yet still work.
const fmtMC = n => {
  if (n == null) return "\u2014";
  if (Math.abs(n) >= 1e6) return "$" + (n / 1e6).toFixed(1) + "T";
  if (Math.abs(n) >= 1e3) return "$" + (n / 1e3).toFixed(0) + "B";
  return "$" + n + "M";
};

const fmtFS = n => {
  if (n == null || isNaN(n)) return "\u2014";
  const abs = Math.abs(Math.round(n));
  const str = abs.toLocaleString("en-US");
  return n < 0 ? "(" + str + ")" : str;
};

const fmtPct = n => (n > 0 ? "+" : "") + n.toFixed(1) + "%";

const isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value);

function resolveResearchPrice(co, live = null) {
  if (isFiniteNumber(live?.price)) return live.price;
  if (isFiniteNumber(live?.mc) && isFiniteNumber(live?.sharesOut) && live.sharesOut > 0) {
    return live.mc / live.sharesOut;
  }
  if (isFiniteNumber(co?.mc) && isFiniteNumber(co?.dc?.sh) && co.dc.sh > 0) {
    return co.mc / co.dc.sh;
  }
  return null;
}

function fmtPrice(value) {
  if (!isFiniteNumber(value)) return "—";
  if (value >= 1000) return Math.round(value).toLocaleString();
  if (value >= 100) return value.toFixed(0);
  return value.toFixed(2);
}

function getLatestSeriesEntry(values = []) {
  return values.length ? values[values.length - 1] : null;
}

function clampNumber(value, min, max) {
  if (!isFiniteNumber(value)) return null;
  return Math.min(max, Math.max(min, value));
}

function getReportedSeries(fd, values = []) {
  const years = Array.isArray(fd?.years) ? fd.years : [];
  const points = values
    .map((value, index) => ({ label: years[index], value }))
    .filter(({ value }) => isFiniteNumber(value));
  const reported = points.filter(({ label }) => {
    const normalized = String(label || "").toUpperCase();
    return normalized !== "TTM" && !normalized.endsWith("E");
  });
  const series = reported.length >= 2 ? reported : points;
  return series.map(({ value }) => value);
}

function computeAnnualizedGrowth(values = []) {
  const series = values.filter(value => isFiniteNumber(value) && value > 0);
  if (series.length < 2) return null;
  const start = series[0];
  const end = series[series.length - 1];
  const periods = series.length - 1;
  if (start <= 0 || end <= 0 || periods <= 0) return null;
  return +(((Math.pow(end / start, 1 / periods) - 1) * 100)).toFixed(1);
}

function deriveGrowthRateFromFinancials(fd) {
  const revenueGrowth = computeAnnualizedGrowth(getReportedSeries(fd, fd?.revs || []));
  const fcfGrowth = computeAnnualizedGrowth(
    getReportedSeries(fd, (fd?.cfData || []).map(entry => entry?.fcf)),
  );
  return clampNumber(
    isFiniteNumber(fcfGrowth) ? fcfGrowth : revenueGrowth,
    -10,
    45,
  );
}

function deriveValuationBaseCase(co, fd, live = null) {
  const fallback = co?.dc || {};
  const latestCashFlow = getLatestSeriesEntry(fd?.cfData || []);
  const marketCap = isFiniteNumber(live?.mc) ? live.mc : (isFiniteNumber(co?.mc) ? co.mc : null);
  const price = resolveResearchPrice(co, live);
  const hasLiveShares = isFiniteNumber(live?.sharesOut) && live.sharesOut > 0;
  const hasDerivedShares = !hasLiveShares && isFiniteNumber(marketCap) && isFiniteNumber(price) && price > 0;
  const shares = hasLiveShares
    ? live.sharesOut
    : hasDerivedShares
      ? +(marketCap / price).toFixed(1)
      : fallback.sh;
  const growthRate = deriveGrowthRateFromFinancials(fd);

  return {
    f: isFiniteNumber(latestCashFlow?.fcf) ? latestCashFlow.fcf : fallback.f,
    gr: isFiniteNumber(growthRate) ? growthRate : fallback.gr,
    w: fallback.w,
    tg: fallback.tg,
    sh: shares,
    price,
    marketCap,
    hasLiveFcf: isFiniteNumber(latestCashFlow?.fcf),
    hasLiveGrowth: isFiniteNumber(growthRate),
    hasLiveShares: hasLiveShares || hasDerivedShares,
  };
}

/* ════════════════════════ FINANCIAL DATA GENERATOR ════════════════════════ */
function genFinancials(co, scenarioAdj = null) {
  const years = ["2022", "2023", "2024", "2025", "2026E"];
  const baseRev = co.r;
  const gm = co.g / 100;
  const rgs = co.fin.rg;

  // Build revenue series working backwards from current
  const revs = [0, 0, 0, 0, baseRev];
  if (scenarioAdj && scenarioAdj.revPct) {
    revs[4] = baseRev * (1 + scenarioAdj.revPct / 100);
  }
  for (let i = 3; i >= 0; i--) {
    revs[i] = Math.round(revs[i + 1] / (1 + (rgs[i + 1] || 5) / 100));
  }

  // Sector-appropriate ratios
  const isCompute = co.v === "compute";
  const isHyper = co.v === "hyperscaler";
  const rdPct = isCompute ? 0.22 : isHyper ? 0.15 : co.v === "photonics" ? 0.18 : 0.12;
  const sgaPct = isHyper ? 0.08 : 0.13;

  // Adjusted GM for scenario
  const adjGM = scenarioAdj && scenarioAdj.gmAdj ? gm + scenarioAdj.gmAdj / 10000 : gm;

  // Income Statement per year
  const makeIS = (rev, useAdj) => {
    const thisGM = useAdj ? adjGM : gm;
    const cogs = Math.round(rev * (1 - thisGM));
    const grossProfit = rev - cogs;
    const rd = Math.round(rev * rdPct);
    const sga = Math.round(rev * sgaPct);
    const da = Math.round(rev * 0.05);
    const opIncome = grossProfit - rd - sga - da;
    const intExp = Math.round(Math.max(0, rev * (co.dc.f < 0 ? 0.025 : 0.008)));
    const otherInc = Math.round(rev * 0.003);
    const preTax = opIncome - intExp + otherInc;
    const tax = Math.round(preTax > 0 ? preTax * 0.19 : 0);
    const netIncome = preTax - tax;
    return { rev, cogs, grossProfit, rd, sga, da, totalOpex: rd + sga + da, opIncome, intExp, otherInc, preTax, tax, netIncome, eps: +(netIncome / (co.dc.sh || 1)).toFixed(2) };
  };

  // Balance Sheet per year
  const makeBS = (rev) => {
    const cash = Math.round(rev * 0.18);
    const sti = Math.round(rev * 0.12);
    const recv = Math.round(rev * 0.16);
    const invFG = Math.round(rev * 0.04);
    const invWIP = Math.round(rev * 0.035);
    const invRM = Math.round(rev * 0.025);
    const inv = invFG + invWIP + invRM;
    const prepaid = Math.round(rev * 0.03);
    const cashSTI = cash + sti;
    const ca = cashSTI + recv + inv + prepaid;
    const ppe = Math.round(rev * 0.30);
    const gw = Math.round(rev * 0.18);
    const otherLT = Math.round(rev * 0.08);
    const ta = ca + ppe + gw + otherLT;
    const ap = Math.round(rev * 0.06);
    const stDebt = Math.round(rev * 0.04);
    const accrued = Math.round(rev * 0.05);
    const cl = ap + stDebt + accrued;
    const ltDebt = Math.round(co.mc * 0.04);
    const otherLTL = Math.round(rev * 0.06);
    const tl = cl + ltDebt + otherLTL;
    const equity = ta - tl;
    return { cash, sti, cashSTI, recv, invFG, invWIP, invRM, inv, prepaid, ca, ppe, gw, otherLT, ta, ap, stDebt, accrued, cl, ltDebt, otherLTL, tl, equity, tlse: ta };
  };

  const isData = revs.map((rev, i) => makeIS(rev, i === 4));
  const bsData = revs.map(rev => makeBS(rev));

  // Cash Flow Statement per year (uses BS deltas)
  const makeCF = (i) => {
    const is = isData[i], bs = bsData[i];
    const prevBS = i > 0 ? bsData[i - 1] : null;
    const sbc = Math.round(is.rev * (isCompute || isHyper ? 0.04 : 0.025));
    const dAR = prevBS ? bs.recv - prevBS.recv : 0;
    const dInv = prevBS ? bs.inv - prevBS.inv : 0;
    const dAP = prevBS ? bs.ap - prevBS.ap : 0;
    const dAccr = prevBS ? bs.accrued - prevBS.accrued : 0;
    const wcImpact = -dAR - dInv + dAP + dAccr;
    const cfo = is.netIncome + is.da + sbc + wcImpact;
    const capex = prevBS ? (bs.ppe - prevBS.ppe) + is.da : Math.round(is.rev * 0.08);
    const cfi = -capex;
    const divPaid = co.fin.div ? -Math.round(co.fin.div * (co.dc.sh || 0)) : 0;
    const buybacks = is.netIncome > 0 ? -Math.round(is.rev * 0.035) : 0;
    const debtChg = prevBS ? bs.ltDebt - prevBS.ltDebt : 0;
    const cff = divPaid + buybacks + debtChg;
    const fcf = cfo - capex;
    const netCashChg = cfo + cfi + cff;
    return { netIncome: is.netIncome, da: is.da, sbc, dAR: -dAR, dInv: -dInv, dAP, dAccr, wcImpact, cfo, capex: -capex, cfi, divPaid, buybacks, debtChg, cff, fcf, netCashChg };
  };
  const cfData = revs.map((_, i) => makeCF(i));

  // Key Ratios per year
  const ratiosData = revs.map((rev, i) => {
    const is = isData[i], bs = bsData[i], cf = cfData[i];
    const nopat = is.opIncome * 0.79;
    const investedCap = bs.equity + bs.ltDebt;
    const ebitda = is.opIncome + is.da;
    return {
      roic: investedCap > 0 && nopat > 0 ? +(nopat / investedCap * 100).toFixed(1) : null,
      fcfMargin: rev > 0 ? +(cf.fcf / rev * 100).toFixed(1) : null,
      fcfYield: i === 4 && co.mc > 0 ? +(cf.fcf / co.mc * 100).toFixed(1) : null,
      debtEbitda: ebitda > 0 ? +(bs.ltDebt / ebitda).toFixed(1) : null,
      netDebt: bs.ltDebt - bs.cashSTI,
      currentRatio: bs.cl > 0 ? +(bs.ca / bs.cl).toFixed(2) : null,
      rdIntensity: rev > 0 ? +(is.rd / rev * 100).toFixed(1) : null,
      capexIntensity: rev > 0 ? +(Math.abs(cf.capex) / rev * 100).toFixed(1) : null,
      gmPct: rev > 0 ? +(is.grossProfit / rev * 100).toFixed(1) : null,
      opmPct: rev > 0 ? +(is.opIncome / rev * 100).toFixed(1) : null,
      netMargin: rev > 0 ? +(is.netIncome / rev * 100).toFixed(1) : null,
      runwayQtrs: is.netIncome < 0 && bs.cashSTI > 0 ? +(bs.cashSTI / (Math.abs(is.netIncome) / 4)).toFixed(1) : null,
    };
  });

  // Quarterly EPS (12 quarters) — seeded per ticker
  let epsSeed = 0;
  for (let i = 0; i < co.t.length; i++) epsSeed = ((epsSeed << 5) - epsSeed + co.t.charCodeAt(i)) | 0;
  const epsRand = () => { epsSeed = (epsSeed * 16807 + 0) % 2147483647; return (epsSeed & 0x7fffffff) / 2147483647; };
  const qEPS = [];
  for (let i = 0; i < 12; i++) {
    const yr = 2023 + Math.floor(i / 4);
    const qtr = (i % 4) + 1;
    const annualEPS = isData[Math.min(4, yr - 2022)]?.eps || 0;
    const qBase = annualEPS / 4;
    const estimate = +(qBase * (0.94 + epsRand() * 0.08)).toFixed(2);
    const actual = +(qBase * (0.92 + epsRand() * 0.18)).toFixed(2);
    const beat = actual >= estimate;
    qEPS.push({ label: "Q" + qtr + " '" + String(yr).slice(2), actual, estimate, beat, diff: +(actual - estimate).toFixed(2) });
  }

  // Annual earnings + estimates
  const annualEarnings = years.map((y, i) => ({
    year: y,
    earnings: isData[i].netIncome,
    isEstimate: i >= 4,
  }));

  return { years, revs, isData, bsData, cfData, ratiosData, qEPS, annualEarnings };
}

/* ════════════════════════ SPARKLINE COMPONENT ════════════════════════ */
function Sparkline({ values, width = 52, height = 16 }) {
  if (!values || values.length < 2) return null;
  const normalized = values.map(v => isFiniteNumber(v) ? v : null);
  const finite = normalized.filter(isFiniteNumber);
  if (finite.length < 2) return null;
  let lastSeen = finite[0];
  const plotted = normalized.map(v => {
    if (isFiniteNumber(v)) lastSeen = v;
    return lastSeen;
  });
  const mn = Math.min(...plotted);
  const mx = Math.max(...plotted);
  const rng = mx - mn || 1;
  const pts = plotted.map((v, i) =>
    `${(i / (values.length - 1)) * width},${height - 2 - ((v - mn) / rng) * (height - 4)}`
  ).join(" ");
  const trend = finite[finite.length - 1] > finite[0];
  const color = trend ? T.green : T.red;
  return (
    <svg width={width} height={height} style={{ display: "inline-block", verticalAlign: "middle" }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ════════════════════════ RANGE BAR (for day/52wk ranges) ════════════════════════ */
function RangeBar({ low, high, current, color }) {
  if (![low, high, current].every(isFiniteNumber) || high <= low) {
    return <div style={{ fontSize: fs(10), color: T.textMuted }}>Live range unavailable</div>;
  }
  const pct = ((current - low) / (high - low || 1)) * 100;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: fs(10) }}>
      <span style={{ color: T.textDim, minWidth: 50, textAlign: "right" }}>${low.toFixed(2)}</span>
      <div style={{ flex: 1, height: 4, background: "rgba(0,0,0,.06)", borderRadius: RADII.xs, position: "relative" }}>
        <div style={{ position: "absolute", left: 0, top: 0, height: 4, width: pct + "%", background: color, borderRadius: RADII.xs, opacity: 0.5 }} />
        <div style={{ position: "absolute", left: `calc(${pct}% - 4px)`, top: -2, width: 8, height: 8, borderRadius: "50%", background: color, border: "1.5px solid #ffffff" }} />
      </div>
      <span style={{ color: T.textDim, minWidth: 50 }}>${high.toFixed(2)}</span>
    </div>
  );
}

/* ════════════════════════ SNAPSHOT TAB ════════════════════════ */

/* ════════════════════════ FINANCIALS TAB ════════════════════════ */
const IS_TEMPLATE = [
  { k: "rev", l: "Revenue", d: 0, bold: true },
  { k: "cogs", l: "Cost of revenue", d: 0 },
  { k: "grossProfit", l: "Gross profit", d: 0, bold: true, expandable: true },
  { k: "rd", l: "Research & development", d: 1, parent: "grossProfit" },
  { k: "sga", l: "Selling, general & admin", d: 1, parent: "grossProfit" },
  { k: "da", l: "Depreciation & amortization", d: 1, parent: "grossProfit" },
  { k: "totalOpex", l: "Total operating expenses", d: 1, parent: "grossProfit", bold: true },
  { k: "opIncome", l: "Operating income", d: 0, bold: true, expandable: true },
  { k: "intExp", l: "Interest expense", d: 1, parent: "opIncome" },
  { k: "otherInc", l: "Other income", d: 1, parent: "opIncome" },
  { k: "preTax", l: "Pre-tax income", d: 0, bold: true },
  { k: "tax", l: "Income tax provision", d: 0 },
  { k: "netIncome", l: "Net income", d: 0, bold: true },
  { k: "eps", l: "EPS (basic)", d: 0 },
];

const BS_TEMPLATE = [
  { k: "ca", l: "Total current assets", d: 0, bold: true, expandable: true },
  { k: "cashSTI", l: "Cash and short term inv", d: 1, parent: "ca", expandable: true },
  { k: "cash", l: "Cash & equivalents", d: 2, parent: "cashSTI" },
  { k: "sti", l: "Short term investments", d: 2, parent: "cashSTI" },
  { k: "recv", l: "Total receivables, net", d: 1, parent: "ca" },
  { k: "inv", l: "Total inventory", d: 1, parent: "ca", expandable: true },
  { k: "invFG", l: "Invent. - finished goods", d: 2, parent: "inv" },
  { k: "invWIP", l: "Invent. - work in progress", d: 2, parent: "inv" },
  { k: "invRM", l: "Invent. - raw materials", d: 2, parent: "inv" },
  { k: "prepaid", l: "Prepaid expenses", d: 1, parent: "ca" },
  { k: "ta", l: "Total assets", d: 0, bold: true, expandable: true },
  { k: "ppe", l: "Property/plant/equip, net", d: 1, parent: "ta" },
  { k: "gw", l: "Goodwill & intangibles", d: 1, parent: "ta" },
  { k: "otherLT", l: "Other long-term assets", d: 1, parent: "ta" },
  { k: "cl", l: "Total current liabilities", d: 0, bold: true, expandable: true },
  { k: "ap", l: "Accounts payable", d: 1, parent: "cl" },
  { k: "stDebt", l: "Short term debt", d: 1, parent: "cl" },
  { k: "accrued", l: "Accrued expenses", d: 1, parent: "cl" },
  { k: "ltDebt", l: "Long-term debt", d: 0 },
  { k: "tl", l: "Total liabilities", d: 0, bold: true },
  { k: "equity", l: "Total equity", d: 0, bold: true },
  { k: "tlse", l: "Total liabilities & equity", d: 0, bold: true },
];

function FinancialsTab({ co, color, fd, scenarioAdj }) {
  const [subTab, setSubTab] = useState("is");
  const [expanded, setExpanded] = useState(new Set(["grossProfit", "ca", "ta"]));

  const fallbackBaseFD = useMemo(() => genFinancials(co, null), [co.t]);
  const fallbackAdjustedFD = useMemo(() => genFinancials(co, scenarioAdj), [co.t, scenarioAdj]);
  const activeFD = fd || (scenarioAdj ? fallbackAdjustedFD : fallbackBaseFD);
  const baseFD = fd || fallbackBaseFD;
  const hasAdj = !fd && scenarioAdj && (scenarioAdj.revPct || scenarioAdj.gmAdj);

  const toggle = (k) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(k) ? next.delete(k) : next.add(k);
      return next;
    });
  };

  const template = subTab === "is" ? IS_TEMPLATE : BS_TEMPLATE;
  const dataArr = subTab === "is" ? activeFD.isData : activeFD.bsData;
  const baseDataArr = subTab === "is" ? baseFD.isData : baseFD.bsData;
  const lastValueIndex = Math.max(0, dataArr.length - 1);

  // Check visibility: row is visible if all ancestor parents are expanded
  const isVisible = (row) => {
    if (!row.parent) return true;
    // Walk up parent chain
    let current = row;
    while (current.parent) {
      if (!expanded.has(current.parent)) return false;
      current = template.find(r => r.k === current.parent) || {};
    }
    return true;
  };

  const visibleRows = template.filter(isVisible);

  return (
    <div>
      {/* Scenario banner */}
      {hasAdj && (
        <div style={{
          background: "rgba(205,162,78,.08)", border: "1px solid rgba(205,162,78,.2)",
          borderRadius: RADII.sm, padding: sp("6px 10px"), marginBottom: sp(10), fontSize: fs(12), color: T.amber, display: "flex", alignItems: "center", gap: 6,
        }}>
          <span style={{ fontSize: fs(12) }}>!</span>
	          Scenario adjustment applied: {scenarioAdj.revPct ? "Rev " + (scenarioAdj.revPct > 0 ? "+" : "") + scenarioAdj.revPct + "%" : ""} {scenarioAdj.gmAdj ? "GM " + (scenarioAdj.gmAdj > 0 ? "+" : "") + scenarioAdj.gmAdj + "bps" : ""}
	          <span style={{ fontSize: fs(12), marginLeft: "auto", color: T.textDim }}>{baseFD.years[lastValueIndex] || "Latest"} column adjusted</span>
	        </div>
	      )}

      {/* Sub-tabs + Period toggle */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: sp(8), borderBottom: "1px solid rgba(0,0,0,.035)" }}>
        <div style={{ display: "flex", gap: 0 }}>
          {[["is", "Income Statement"], ["bs", "Balance Sheet"], ["cf", "Cash Flow"]].map(([id, lb]) => (
            <button key={id} onClick={() => setSubTab(id)} style={{
              background: "none", border: "none",
              borderBottom: subTab === id ? "2px solid " + color : "2px solid transparent",
              padding: sp("5px 12px"), color: subTab === id ? color : T.textSec,
              fontSize: fs(10), fontWeight: FONT_WEIGHTS.regular, cursor: "pointer",
            }}>{lb}</button>
          ))}
        </div>

      </div>

      {subTab === "cf" ? (
        <CashFlowTable fd={activeFD} color={color} />
      ) : (
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: sp("5px 6px"), fontSize: fs(11), color: T.textMuted, letterSpacing: 1, minWidth: 160 }}>
                Item
              </th>
              {activeFD.years.map(y => (
                <th key={y} style={{ textAlign: "right", padding: sp("5px 8px"), fontSize: fs(11), color: y.includes("E") ? color : T.textSec }}>
                  {y}
                </th>
              ))}
              <th style={{ textAlign: "center", padding: sp("5px 4px"), fontSize: fs(10), color: T.textMuted, minWidth: 56 }}>
                5-yr trend
              </th>
            </tr>
          </thead>
          <tbody>
	            {visibleRows.map((row, idx) => {
	              const values = dataArr.map(d => d[row.k]);
	              const baseValues = baseDataArr.map(d => d[row.k]);
	              const isEPS = row.k === "eps";
	              const isAdjusted = hasAdj && values[lastValueIndex] !== baseValues[lastValueIndex];

              return (
                <tr
                  key={row.k}
                  onClick={row.expandable ? () => toggle(row.k) : undefined}
                  style={{
                    cursor: row.expandable ? "pointer" : "default",
                    background: idx % 2 === 0 ? "rgba(0,0,0,.012)" : "transparent",
                    borderBottom: "1px solid rgba(0,0,0,.03)",
                  }}
                >
                  <td style={{
                    padding: sp("5px 6px 5px ") + (10 + row.d * 18) + "px",
                    fontSize: fs(11),
                    color: row.bold ? T.text : T.textSec,
                    fontWeight: FONT_WEIGHTS.regular,
                    whiteSpace: "nowrap",
                  }}>
                    {row.expandable && (
                      <span style={{ display: "inline-block", width: 14, fontSize: fs(11), color: T.textDim, transition: "transform 0.15s" }}>
                        {expanded.has(row.k) ? "\u25BC" : "\u25B6"}
                      </span>
                    )}
                    {!row.expandable && row.d > 0 && <span style={{ display: "inline-block", width: 14 }} />}
                    {row.l}
                  </td>
                  {values.map((v, i) => (
                    <td key={i} style={{
                      padding: sp("5px 8px"), textAlign: "right", fontSize: fs(10),
                      color: v < 0 ? T.red : (isAdjusted && i === 4 ? T.amber : T.textSec),
                      fontWeight: FONT_WEIGHTS.regular,
                    }}>
                      {isEPS ? (v < 0 ? "(" + Math.abs(v).toFixed(2) + ")" : v.toFixed(2)) : fmtFS(v)}
                    </td>
                  ))}
                  <td style={{ padding: sp("5px 4px"), textAlign: "center" }}>
                    <Sparkline values={values} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      )}
    </div>
  );
}

/* ════════════════════════ VALUATION TAB ════════════════════════ */
function ValuationTab({ co, color, fd, live, scenarioAdj, onScenarioChange }) {
  const [ov, setOv] = useState({});
  const [scen, setScen] = useState("");
  const [aiR, setAiR] = useState(null);
  const [loading, setLoading] = useState(false);
  const [dragState, setDragState] = useState({});

  const dcfBase = useMemo(
    () => deriveValuationBaseCase(co, fd, live),
    [co, fd, live?.mc, live?.price, live?.sharesOut],
  );
  const dcfInputs = {
    f: dcfBase.f,
    gr: dcfBase.gr,
    w: dcfBase.w,
    tg: dcfBase.tg,
    sh: dcfBase.sh,
    ...ov,
  };
  const baseFcf = isFiniteNumber(dcfBase.f) ? dcfBase.f : 0;
  const baseGrowth = isFiniteNumber(dcfBase.gr) ? dcfBase.gr : 0;
  const fcfRange = Math.max(250, Math.abs(baseFcf));
  const growthRange = Math.max(10, Math.abs(baseGrowth));
  const price = isFiniteNumber(dcfBase.price)
    ? dcfBase.price
    : (isFiniteNumber(dcfBase.marketCap) && isFiniteNumber(dcfInputs.sh) && dcfInputs.sh > 0)
      ? dcfBase.marketCap / dcfInputs.sh
      : null;
  const liveBaseNotes = [
    dcfBase.hasLiveFcf ? "FCF from fetched statements" : null,
    dcfBase.hasLiveGrowth ? "growth from reported trend" : null,
    dcfBase.hasLiveShares ? "share count from live pricing" : null,
  ].filter(Boolean);

  useEffect(() => {
    setOv({});
    setScen("");
    setAiR(null);
    setLoading(false);
    setDragState({});
  }, [co.t]);

  const dcfVal = useMemo(() => {
    const { f, gr, w, tg, sh } = dcfInputs;
    if (
      !isFiniteNumber(f) ||
      !isFiniteNumber(gr) ||
      !isFiniteNumber(w) ||
      !isFiniteNumber(tg) ||
      !isFiniteNumber(sh) ||
      sh <= 0 ||
      w <= tg
    ) {
      return 0;
    }
    let p = f, tot = 0;
    for (let y = 1; y <= 10; y++) {
      p *= 1 + (gr * Math.pow(0.9, y - 1)) / 100;
      tot += p / Math.pow(1 + w / 100, y);
    }
    const tv = (p * (1 + tg / 100)) / ((w - tg) / 100);
    return (tot + tv / Math.pow(1 + w / 100, 10)) / sh;
  }, [dcfInputs]);

  const upside = dcfVal > 0 && isFiniteNumber(price) && price > 0 ? ((dcfVal - price) / price * 100) : null;

  const SliderRow = ({ label, field, min, max, step, unit = "" }) => {
    const committed = dcfInputs[field];
    const display = dragState[field] ?? committed;
    return (
      <div style={{ marginBottom: sp(4) }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: sp(1) }}>
          <span style={{ fontSize: fs(10), color: T.textDim }}>{label}</span>
          <span style={{ fontSize: fs(10), color, fontWeight: FONT_WEIGHTS.regular }}>{display?.toFixed(1)}{unit}</span>
        </div>
        <input type="range" min={min} max={max} step={step} value={display || 0}
          onChange={e => setDragState(prev => ({ ...prev, [field]: parseFloat(e.target.value) }))}
          onPointerUp={e => { setOv(prev => ({ ...prev, [field]: parseFloat(e.target.value) })); setDragState(prev => { const n = {...prev}; delete n[field]; return n; }); }}
          onTouchEnd={e => { const v = dragState[field]; if (v != null) { setOv(prev => ({ ...prev, [field]: v })); setDragState(prev => { const n = {...prev}; delete n[field]; return n; }); } }}
          style={{ width: "100%", accentColor: color, height: 2 }}
        />
      </div>
    );
  };

  const runScenario = async () => {
    if (!scen.trim()) return;
    setLoading(true);
    setAiR({
      impact: "neutral",
      reasoning: "Browser-side model calls were removed. Wire a server-side AI provider into the API layer to restore scenario analysis.",
      valPct: "\u2014",
      confidence: "low",
    });
    setLoading(false);
  };

  return (
      <div>
        {/* DCF Model */}
        <div style={{ background: T.bg1, border: "1px solid rgba(0,0,0,.06)", borderRadius: RADII.md, padding: sp(10), marginBottom: sp(10), boxShadow: "0 1px 3px rgba(0,0,0,.03)" }}>
          <div style={{ fontSize: fs(11), fontWeight: FONT_WEIGHTS.regular, color, marginBottom: sp(6), letterSpacing: 1 }}>
            DISCOUNTED CASH FLOW MODEL
          </div>
          <div style={{ fontSize: fs(10), color: T.textDim, marginBottom: sp(8), lineHeight: 1.5 }}>
            {liveBaseNotes.length
              ? `${liveBaseNotes.join(" · ")}. WACC and terminal growth remain model assumptions.`
              : "Base case currently falls back to the authored model assumptions for this company."}
          </div>
        <SliderRow label="Base Free Cash Flow ($M)" field="f" min={-fcfRange * 2} max={fcfRange * 3} step={Math.max(1, fcfRange / 50)} unit="M" />
        <SliderRow label="FCF Growth Rate" field="gr" min={Math.min(-10, -growthRange)} max={Math.max(50, growthRange * 2)} step={1} unit="%" />
        <SliderRow label="Weighted Avg Cost of Capital" field="w" min={5} max={25} step={0.5} unit="%" />
        <SliderRow label="Terminal Growth Rate" field="tg" min={0} max={5} step={0.25} unit="%" />

        <div style={{ display: "flex", gap: 6, marginTop: sp(8) }}>
          {[
            ["DCF Intrinsic", dcfVal > 0 ? fmtPrice(dcfVal) : "NEGATIVE", dcfVal > 0 ? T.green : T.red],
            ["Current Price", fmtPrice(price), T.text],
            ["Implied Upside", upside != null ? (upside > 0 ? "+" : "") + upside.toFixed(0) + "%" : "\u2014", upside > 0 ? T.green : T.red],
          ].map(([label, value, clr]) => (
            <div key={label} style={{ flex: 1, background: "rgba(0,0,0,.01)", borderRadius: RADII.sm, padding: sp("4px 4px"), textAlign: "center", border: "1px solid rgba(0,0,0,.04)" }}>
              <div style={{ fontSize: fs(10), color: T.textDim, textTransform: "uppercase", letterSpacing: 1 }}>{label}</div>
              <div style={{ fontSize: fs(14), fontWeight: FONT_WEIGHTS.regular, color: clr, marginTop: sp(1) }}>{value}</div>
            </div>
          ))}
        </div>
        <button onClick={() => setOv({})} style={{
          marginTop: sp(5), width: "100%", background: T.bg1, border: "1px solid rgba(0,0,0,.08)",
          borderRadius: RADII.xs, padding: sp(3), color: T.textDim, fontSize: fs(11), cursor: "pointer",
        }}>RESET TO BASE CASE</button>
      </div>

      {/* What-If Scenario Engine */}
      <div style={{ background: T.bg1, border: "1px solid rgba(0,0,0,.06)", borderRadius: RADII.md, padding: sp(14), boxShadow: "0 1px 3px rgba(0,0,0,.03)" }}>
        <div style={{ fontSize: fs(10), fontWeight: FONT_WEIGHTS.regular, color, marginBottom: sp(8), letterSpacing: 1 }}>
          WHAT-IF SCENARIO ENGINE
        </div>
        <div style={{ fontSize: fs(10), color: T.textDim, marginBottom: sp(5), lineHeight: 1.4 }}>
          This panel is reserved for a server-side scenario engine. The direct browser LLM call was removed so model credentials stay out of the client.
        </div>
        <textarea value={scen} onChange={e => setScen(e.target.value)}
          placeholder={"e.g. 'US imposes 50% tariff on all semiconductor imports from China'\nor '" + co.nm + "'s largest customer switches to a competitor'"}
          style={{
            width: "100%", background: "rgba(0,0,0,.035)", border: "1px solid rgba(0,0,0,.10)",
            borderRadius: RADII.sm, padding: sp(7), color: T.textSec, fontSize: fs(11),
            resize: "vertical", minHeight: 42, boxSizing: "border-box", lineHeight: 1.5,
          }}
        />
        <button onClick={runScenario} disabled={loading || !scen.trim()} style={{
          marginTop: sp(6), width: "100%", background: loading ? T.text : color, border: "none",
          borderRadius: RADII.sm, padding: sp("5px 0"), color: loading ? T.textSec : T.bg1,
          fontSize: fs(11), fontWeight: FONT_WEIGHTS.regular, cursor: loading ? "wait" : "pointer", letterSpacing: 0.5,
        }}>
          {loading ? "CHECKING..." : "SCENARIO AI STATUS"}
        </button>

        {aiR && (
          <div style={{
            marginTop: sp(6),
            background: aiR.impact === "positive" ? "rgba(26,138,92,.08)" : aiR.impact === "negative" ? "rgba(196,64,64,.08)" : "rgba(205,162,78,.08)",
            borderRadius: RADII.md,
            padding: sp(10),
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: sp(5) }}>
              <span style={{
                fontSize: fs(11), padding: sp("2px 6px"), borderRadius: RADII.xs, fontWeight: FONT_WEIGHTS.regular, textTransform: "uppercase",
                background: aiR.impact === "positive" ? "rgba(72,200,156,.15)" : aiR.impact === "negative" ? "rgba(216,104,104,.15)" : "rgba(205,162,78,.15)",
                color: aiR.impact === "positive" ? T.green : aiR.impact === "negative" ? T.red : T.accent,
              }}>
                {aiR.impact || "unknown"}
              </span>
              <span style={{ fontSize: fs(11), color: T.textDim }}>
                Confidence: {aiR.confidence}
              </span>
            </div>

            <div style={{ display: "flex", gap: 6, marginBottom: sp(8) }}>
              {[
                ["Revenue Impact", aiR.revPct ? (aiR.revPct > 0 ? "+" : "") + aiR.revPct + "%" : aiR.revEffect || "\u2014"],
                ["Margin Impact", aiR.gmBps ? (aiR.gmBps > 0 ? "+" : "") + aiR.gmBps + " bps" : "\u2014"],
                ["Valuation", aiR.valPct || "\u2014"],
              ].map(([l, v]) => (
                <div key={l} style={{ flex: 1, background: "rgba(0,0,0,.01)", borderRadius: RADII.xs, padding: sp("3px 5px"), border: "1px solid rgba(0,0,0,.04)" }}>
                  <div style={{ fontSize: fs(10), color: T.textDim, textTransform: "uppercase", letterSpacing: 1 }}>{l}</div>
                  <div style={{ fontSize: fs(12), fontWeight: FONT_WEIGHTS.regular, color: T.text, marginTop: sp(2) }}>{v}</div>
                </div>
              ))}
            </div>

            <div style={{ fontSize: fs(10.5), color: T.textSec, lineHeight: 1.6 }}>
              {aiR.reasoning}
            </div>

            {(aiR.revPct || aiR.gmBps) && (
              <div style={{ marginTop: sp(8), fontSize: fs(11), color: T.amber }}>
                \u2192 Adjustments applied to Financials tab (2026E column)
              </div>
            )}
          </div>
        )}

        {scenarioAdj && (scenarioAdj.revPct || scenarioAdj.gmAdj) && (
          <button onClick={() => onScenarioChange(null)} style={{
            marginTop: sp(8), width: "100%", background: "rgba(205,162,78,.08)",
            border: "1px solid rgba(205,162,78,.2)", borderRadius: RADII.xs, padding: sp(5),
            color: T.amber, fontSize: fs(11), cursor: "pointer",
          }}>CLEAR SCENARIO ADJUSTMENTS</button>
        )}
      </div>
    </div>
  );
}

/* ════════════════════════ DETAIL HELPERS & UTILITIES ════════════════════════ */

// Color shading for stacked bars
function shade(hex, i) {
  if (!hex) return T.textDim;
  const c = hex.replace("#", "");
  const r = parseInt(c.slice(0, 2), 16), g = parseInt(c.slice(2, 4), 16), b = parseInt(c.slice(4, 6), 16);
  const f = Math.max(0.45, 1 - i * 0.16);
  return `rgb(${Math.round(r * f)},${Math.round(g * f)},${Math.round(b * f)})`;
}

// Find peer companies: same sub-layer first, then same vertical, sorted by MC proximity
function getPeers(co, n = 4) {
  const same = COMPANIES.filter(c => c.v === co.v && c.s === co.s && c.t !== co.t);
  const vertical = COMPANIES.filter(c => c.v === co.v && c.s !== co.s && c.t !== co.t);
  same.sort((a, b) => Math.abs(Math.log((a.mc || 1) / (co.mc || 1))) - Math.abs(Math.log((b.mc || 1) / (co.mc || 1))));
  vertical.sort((a, b) => Math.abs(Math.log((a.mc || 1) / (co.mc || 1))) - Math.abs(Math.log((b.mc || 1) / (co.mc || 1))));
  return [...same, ...vertical].slice(0, n);
}

// Minimal SVG sparkline — shows price trend from an array of {price} points.
// Auto-colors green/red based on net change. No axes, no labels — pure shape.
function PriceSparkline({ data, width = 80, height = 22, strokeWidth = 1 }) {
  if (!data || data.length < 2) {
    return <span style={{ color: T.textMuted, fontSize: fs(10) }}>—</span>;
  }
  // Downsample to ~50 points max for performance/readability
  const stride = Math.max(1, Math.ceil(data.length / 50));
  const sampled = [];
  for (let i = 0; i < data.length; i += stride) sampled.push(data[i]);
  // Always include last point for accurate endpoint
  if (sampled[sampled.length - 1] !== data[data.length - 1]) sampled.push(data[data.length - 1]);

  const prices = sampled.map(d => d.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || max * 0.01 || 1;
  const pad = 1;
  const points = prices.map((p, i) => {
    const x = (i / (prices.length - 1)) * (width - pad * 2) + pad;
    const y = height - pad - ((p - min) / range) * (height - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");

  const start = prices[0];
  const end = prices[prices.length - 1];
  const ret = start > 0 ? (end - start) / start * 100 : 0;
  const color = ret >= 0 ? T.green : T.red;
  const fillColor = ret >= 0 ? "rgba(26,138,92,.1)" : "rgba(196,64,64,.1)";

  // Fill path: same shape but closed to baseline
  const fillPoints = points + ` ${(width - pad).toFixed(1)},${(height - pad).toFixed(1)} ${pad.toFixed(1)},${(height - pad).toFixed(1)}`;

  return (
    <svg width={width} height={height} style={{ display: "block", overflow: "visible" }} aria-label={`sparkline ${ret >= 0 ? "+" : ""}${ret.toFixed(1)}%`}>
      <polygon points={fillPoints} fill={fillColor} stroke="none" />
      <polyline points={points} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={(width - pad).toFixed(1)} cy={(height - pad - ((end - min) / range) * (height - pad * 2)).toFixed(1)} r="1.5" fill={color} />
    </svg>
  );
}

// Horizontal stacked bar with legend (used for segments, geo, customers)
function StackedBar({ data, color, height = 18 }) {
  if (!data || data.length === 0) return null;
  const total = data.reduce((a, x) => a + (x[1] || 0), 0);
  if (total === 0) return null;
  return (
    <div>
      <div style={{ display: "flex", height, borderRadius: RADII.xs, overflow: "hidden", border: "1px solid rgba(0,0,0,.05)" }}>
        {data.map(([label, val], i) => {
          const pct = val / total * 100;
          return (
            <AppTooltip key={label + i} content={`${label}: ${pct.toFixed(1)}%`}><div key={label + i} style={{
              width: pct + "%", background: shade(color, i),
              display: "flex", alignItems: "center", justifyContent: "center",
              borderRight: i < data.length - 1 ? "1px solid rgba(255,255,255,.4)" : "none",
            }}>
              {pct > 10 && <span style={{ fontSize: fs(9), color: T.onAccent, fontWeight: FONT_WEIGHTS.regular, letterSpacing: 0.3 }}>{Math.round(pct)}%</span>}
            </div></AppTooltip>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: sp(5), flexWrap: "wrap" }}>
        {data.map(([label, val], i) => (
          <span key={label + i} style={{ fontSize: fs(10), color: T.textSec, display: "inline-flex", alignItems: "center", gap: 3 }}>
            <span style={{ width: 8, height: 8, background: shade(color, i), borderRadius: 1, display: "inline-block" }} />
            {label} <span style={{ color: T.textDim }}>{(val / total * 100).toFixed(0)}%</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// Mini sparkline for trend data (percentages over time)
function TrendSpark({ values, color, width = 80, height = 22, suffix = "%" }) {
  if (!values || values.length < 2 || values.every(v => v == null)) return <span style={{ color: T.textMuted, fontSize: fs(10) }}>—</span>;
  const normalized = values.map(v => isFiniteNumber(v) ? v : null);
  const finite = normalized.filter(isFiniteNumber);
  if (finite.length < 2) return <span style={{ color: T.textMuted, fontSize: fs(10) }}>—</span>;
  let lastSeen = finite[0];
  const clean = normalized.map(v => {
    if (isFiniteNumber(v)) lastSeen = v;
    return lastSeen;
  });
  const mn = Math.min(...clean, 0), mx = Math.max(...clean, 1);
  const rng = mx - mn || 1;
  const pts = clean.map((v, i) => [(i / (clean.length - 1)) * width, height - 4 - ((v - mn) / rng) * (height - 8)]);
  const path = "M" + pts.map(p => p[0] + "," + p[1]).join(" L");
  const area = path + ` L${pts[pts.length - 1][0]},${height} L0,${height} Z`;
  const last = finite[finite.length - 1];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <svg width={width} height={height} style={{ display: "block" }}>
        <path d={area} fill={color} fillOpacity={0.15} />
        <path d={path} fill="none" stroke={color} strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r={2.2} fill={color} />
      </svg>
      <span style={{ fontSize: fs(11), color: T.text, fontWeight: FONT_WEIGHTS.regular }}>{last != null ? last.toFixed(1) + suffix : "—"}</span>
    </span>
  );
}

// Peer comparison row with distribution dot marker per metric
function PeerGrid({ co, color, onSelect }) {
  const peers = getPeers(co, 4);
  if (peers.length === 0) return null;
  const allCos = [co, ...peers];
  const metrics = [
    { k: "mc", l: "Mkt Cap", fmt: v => fmtMC(v) },
    { k: "r", l: "Revenue", fmt: v => fmtMC(v) },
    { k: "g", l: "GM", fmt: v => v + "%" },
    { k: "pe", l: "P/E", fmt: v => v ? v.toFixed(0) + "x" : "—" },
    { k: "gr", l: "Growth", fmt: v => (v > 0 ? "+" : "") + v + "%" },
  ];
  const getV = (c, k) => k === "gr" ? (c.fin?.rg?.[4] || 0) : c[k];
  return (
    <div style={{ background: T.bg1, border: "1px solid rgba(0,0,0,.06)", borderRadius: RADII.md, overflow: "hidden" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ background: "rgba(0,0,0,.018)", borderBottom: "1px solid rgba(0,0,0,.06)" }}>
            <th style={{ textAlign: "left", padding: sp("5px 8px"), fontSize: fs(10), color: T.textMuted, fontWeight: FONT_WEIGHTS.regular, letterSpacing: 1, textTransform: "uppercase" }}>Peer</th>
            {metrics.map(m => <th key={m.k} style={{ textAlign: "right", padding: sp("5px 8px"), fontSize: fs(10), color: T.textMuted, fontWeight: FONT_WEIGHTS.regular, letterSpacing: 1, textTransform: "uppercase" }}>{m.l}</th>)}
          </tr>
        </thead>
        <tbody>
          {allCos.map((c, ci) => {
            const isSelf = c.t === co.t;
            return (
              <tr key={c.t} onClick={() => !isSelf && onSelect && onSelect(c.t)}
                style={{ cursor: isSelf ? "default" : "pointer", borderBottom: ci < allCos.length - 1 ? "1px solid rgba(0,0,0,.04)" : "none", background: isSelf ? "rgba(205,162,78,.06)" : "transparent" }}
                onMouseEnter={e => { if (!isSelf) e.currentTarget.style.background = "rgba(0,0,0,.022)"; }}
                onMouseLeave={e => { if (!isSelf) e.currentTarget.style.background = "transparent"; }}>
                <td style={{ padding: sp("5px 8px"), fontSize: fs(11) }}>
                  <Logo ticker={c.t} size={12} style={{ marginRight: sp(4) }} />
                  <span style={{ color: isSelf ? color : T.text, fontWeight: FONT_WEIGHTS.regular}}>{c.t}</span>
                  <span style={{ color: T.textMuted, marginLeft: sp(4), fontSize: fs(10) }}>{c.s}</span>
                </td>
                {metrics.map(m => {
                  const v = getV(c, m.k);
                  const vals = allCos.map(x => getV(x, m.k)).filter(x => x != null);
                  const mn = Math.min(...vals), mx = Math.max(...vals), rng = mx - mn || 1;
                  const pos = v != null ? ((v - mn) / rng) : null;
                  return (
                    <td key={m.k} style={{ padding: sp("5px 8px"), textAlign: "right", fontSize: fs(11), color: T.text, fontWeight: FONT_WEIGHTS.regular}}>
                      <span>{m.fmt(v)}</span>
                      {pos != null && <span style={{ display: "inline-block", width: 32, height: 3, background: "rgba(0,0,0,.06)", borderRadius: RADII.xs, marginLeft: sp(6), position: "relative", verticalAlign: "middle" }}>
                        <span style={{ position: "absolute", left: `calc(${pos * 100}% - 2px)`, top: -1, width: 5, height: 5, borderRadius: "50%", background: isSelf ? color : T.textDim }} />
                      </span>}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Key Ratios strip — 4 columns, compact tile grid
function KeyRatios({ ratios, co, color }) {
  const latest = getLatestSeriesEntry(ratios) || {};
  const prior = ratios.length > 1 ? ratios[ratios.length - 2] || {} : {};
  const trend = (k, invert) => {
    const cur = latest[k], prv = prior[k];
    if (cur == null || prv == null) return null;
    const up = cur > prv;
    return { dir: up ? "up" : "down", good: invert ? !up : up, delta: cur - prv };
  };
  const rows = [
    { k: "roic", l: "ROIC", fmt: v => v != null ? v + "%" : "—", invert: false, tip: "Return on Invested Capital" },
    { k: "fcfMargin", l: "FCF Margin", fmt: v => v != null ? v + "%" : "—", invert: false, tip: "Free Cash Flow ÷ Revenue" },
    { k: "fcfYield", l: "FCF Yield", fmt: v => v != null ? v + "%" : "—", invert: false, tip: "Free Cash Flow ÷ Market Cap" },
    { k: "debtEbitda", l: "Debt / EBITDA", fmt: v => v != null ? v + "x" : "—", invert: true, tip: "Leverage multiple" },
    { k: "currentRatio", l: "Current Ratio", fmt: v => v != null ? v + "x" : "—", invert: false, tip: "Current Assets ÷ Current Liabilities" },
    { k: "rdIntensity", l: "R&D Intensity", fmt: v => v != null ? v + "%" : "—", invert: false, tip: "R&D ÷ Revenue" },
    { k: "capexIntensity", l: "Capex Intensity", fmt: v => v != null ? v + "%" : "—", invert: true, tip: "Capex ÷ Revenue" },
    { k: "netMargin", l: "Net Margin", fmt: v => v != null ? v + "%" : "—", invert: false, tip: "Net Income ÷ Revenue" },
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 4 }}>
      {rows.map(r => {
        const t = trend(r.k, r.invert);
        const trendValues = ratios.map(x => x[r.k]);
        return (
          <AppTooltip key={r.k} content={r.tip}><div key={r.k} style={{ background: T.bg1, border: "1px solid rgba(0,0,0,.06)", borderRadius: RADII.sm, padding: sp("5px 7px") }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: sp(2) }}>
              <span style={{ fontSize: fs(9), color: T.textDim, textTransform: "uppercase", letterSpacing: 1, fontWeight: FONT_WEIGHTS.regular }}>{r.l}</span>
              {t && <span style={{ fontSize: fs(9), color: t.good ? T.green : T.red, fontWeight: FONT_WEIGHTS.regular }}>{t.dir === "up" ? "▲" : "▼"}</span>}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: fs(13), fontWeight: FONT_WEIGHTS.regular, color: T.text }}>{r.fmt(latest[r.k])}</span>
              <TrendSpark values={trendValues} color={color} width={40} height={16} suffix="" />
            </div>
          </div></AppTooltip>
        );
      })}
    </div>
  );
}

// Operations strip — schema-tolerant display of company metadata
function OpsStrip({ co, color }) {
  const ops = co.ops || {};
  const own = co.own || {};
  const items = [
    ["HQ", ops.hq],
    ["Founded", ops.fd],
    ["Employees", ops.emp ? ops.emp.toLocaleString() : null],
    ["Process node", ops.node],
    ["Fab / Manufacturing", Array.isArray(ops.mfg) ? ops.mfg.join(", ") : ops.mfg],
    ["Backlog", ops.bl ? (ops.bl.label ? ops.bl.label + ": " : "") + "$" + ops.bl.val + (ops.bl.unit || "M") : null],
    ["Next earnings", ops.ne],
    ["Insider own.", own.insider != null ? own.insider + "%" : null],
    ["Institutional", own.institutional != null ? own.institutional + "%" : null],
  ].filter(x => x[1] != null);
  if (items.length === 0) return (
    <div style={{ padding: sp("10px 12px"), background: "rgba(0,0,0,.015)", border: "1px dashed rgba(0,0,0,.08)", borderRadius: RADII.sm, textAlign: "center" }}>
      <span style={{ fontSize: fs(10), color: T.textMuted, fontStyle: "italic" }}>Operations data pending</span>
    </div>
  );
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
      {items.map(([l, v]) => (
        <div key={l} style={{ background: T.bg1, border: "1px solid rgba(0,0,0,.05)", borderRadius: RADII.sm, padding: sp("4px 7px") }}>
          <div style={{ fontSize: fs(9), color: T.textMuted, textTransform: "uppercase", letterSpacing: 1, fontWeight: FONT_WEIGHTS.regular, marginBottom: sp(1) }}>{l}</div>
          <div style={{ fontSize: fs(11), color: T.text, fontWeight: FONT_WEIGHTS.regular }}>{v}</div>
        </div>
      ))}
    </div>
  );
}

function DataNotReported({ label }) {
  return (
    <div style={{ padding: sp("10px 12px"), background: "rgba(0,0,0,.018)", border: "1px solid rgba(0,0,0,.05)", borderRadius: RADII.sm }}>
      <span style={{ fontSize: fs(10), color: T.textDim, fontWeight: FONT_WEIGHTS.regular, letterSpacing: 1, textTransform: "uppercase" }}>Not reported</span>
      <span style={{ display: "block", marginTop: sp(3), fontSize: fs(11), color: T.textDim, lineHeight: 1.45 }}>{label}</span>
    </div>
  );
}

/* ════════════════════════ CASH FLOW TABLE ════════════════════════ */
const CF_TEMPLATE = [
  { k: "netIncome", l: "Net income", d: 0, bold: true },
  { k: "da", l: "+ Depreciation & amortization", d: 1 },
  { k: "sbc", l: "+ Stock-based compensation", d: 1 },
  { k: "wcImpact", l: "+ Change in working capital", d: 1 },
  { k: "cfo", l: "Cash from operations", d: 0, bold: true },
  { k: "capex", l: "Capital expenditures", d: 1 },
  { k: "cfi", l: "Cash from investing", d: 0, bold: true },
  { k: "divPaid", l: "Dividends paid", d: 1 },
  { k: "buybacks", l: "Share repurchases", d: 1 },
  { k: "debtChg", l: "Net debt issuance", d: 1 },
  { k: "cff", l: "Cash from financing", d: 0, bold: true },
  { k: "fcf", l: "Free cash flow", d: 0, bold: true },
];

function CashFlowTable({ fd, color }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left", padding: sp("5px 6px"), fontSize: fs(11), color: T.textMuted, letterSpacing: 1, minWidth: 180 }}>Item</th>
            {fd.years.map(y => <th key={y} style={{ textAlign: "right", padding: sp("5px 8px"), fontSize: fs(11), color: y.includes("E") ? color : T.textSec }}>{y}</th>)}
            <th style={{ textAlign: "center", padding: sp("5px 4px"), fontSize: fs(10), color: T.textMuted }}>trend</th>
          </tr>
        </thead>
        <tbody>
          {CF_TEMPLATE.map((row, idx) => {
            const values = fd.cfData.map(d => d[row.k]);
            return (
              <tr key={row.k} style={{ background: idx % 2 === 0 ? "rgba(0,0,0,.012)" : "transparent", borderBottom: "1px solid rgba(0,0,0,.03)" }}>
                <td style={{ padding: sp("5px 6px 5px ") + (10 + row.d * 14) + "px", fontSize: fs(11), color: row.bold ? T.text : T.textSec, fontWeight: FONT_WEIGHTS.regular, whiteSpace: "nowrap" }}>{row.l}</td>
                {values.map((v, i) => (
                  <td key={i} style={{ padding: sp("5px 8px"), textAlign: "right", fontSize: fs(10), color: v < 0 ? T.red : T.textSec, fontWeight: FONT_WEIGHTS.regular}}>
                    {fmtFS(v)}
                  </td>
                ))}
                <td style={{ padding: sp("5px 4px"), textAlign: "center" }}><Sparkline values={values} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ════════════════════════ PRICE CHART ════════════════════════ */
function PriceChart({ co, vc, price, wkLow, wkHigh }) {
  const { preferences: userPreferences } = useUserPreferences();
  const [pricePeriod, setPricePeriod] = useState("3M");
  const [liveHist, setLiveHist] = useState(null);
  const [histStatus, setHistStatus] = useState("idle"); // idle | loading | live | error | nodata
  const [histInterval, setHistInterval] = useState("daily"); // "15min" | "1hour" | "daily"
  const [histSourceLabel, setHistSourceLabel] = useState("IBKR");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchHist(co.t, pricePeriod).then(r => {
      if (cancelled) return;
      setLoading(false);
      if (r.status === "live" && r.hist) {
        setLiveHist(r.hist);
        setHistStatus("live");
        setHistInterval(r.interval || "daily");
        setHistSourceLabel(r.sourceLabel || "IBKR");
      } else {
        setLiveHist(null);
        setHistStatus(r.status);
        setHistInterval("daily");
        setHistSourceLabel("IBKR");
      }
    });
    return () => { cancelled = true; };
  }, [co.t, pricePeriod]);

  const priceHistory = useMemo(() => {
    let base;
    let isLive = false;
    if (liveHist && liveHist.length > 0) {
      base = liveHist;
      isLive = true;
    } else {
      base = [];
    }
    const today = new Date();
    const isIntraday = histInterval === "15min" || histInterval === "1hour";
    const enriched = base.map((d, i) => {
      let label = d.date, full = d.fullDate, iso = d.isoDT;
      if (!full) {
        const dt = new Date(today);
        dt.setDate(dt.getDate() - Math.round((base.length - 1 - i) * 7 / 5));
        full = dt.toISOString().slice(0, 10);
        iso = full + "T16:00:00";
      }
      const dt = iso ? new Date(iso) : new Date(full);
      // Smarter label formatting based on period
      if (pricePeriod === "5Y") label = dt.getFullYear().toString();
      else if (pricePeriod === "1Y" || pricePeriod === "YTD" || pricePeriod === "6M") {
        label = formatAppDateForPreferences(dt, userPreferences, { month: "short" }, "");
      }
      else if (pricePeriod === "3M") label = (dt.getMonth() + 1) + "/" + dt.getDate();
      else if (pricePeriod === "1M") {
        // Intraday 1-hour bars — show date for first bar of each day
        if (i === 0 || base[i-1]?.fullDate !== d.fullDate) label = (dt.getMonth() + 1) + "/" + dt.getDate();
        else label = "";
      } else if (pricePeriod === "1W") {
        // Intraday 15-min bars — show weekday for first bar of each day
        if (i === 0 || base[i-1]?.fullDate !== d.fullDate) {
          label = formatAppDateForPreferences(dt, userPreferences, { weekday: "short" }, "");
        }
        else label = "";
      } else label = (dt.getMonth() + 1) + "/" + dt.getDate();
      return { ...d, date: label, fullDate: full, isoDT: iso };
    });
    // Pin the final bar to the current live price when the historical close is stale
    if (isLive && enriched.length > 0 && isFiniteNumber(price) && price > 0) {
      const last = enriched[enriched.length - 1];
      const todayISO = new Date().toISOString().slice(0, 10);
      if (!isIntraday && last.fullDate !== todayISO) {
        // Append a live-quote bar dated today
        enriched.push({ date: "now", fullDate: todayISO, isoDT: todayISO + "T16:00:00", price: +price.toFixed(2) });
      } else {
        // Same-day; replace last close with current quote for intraday accuracy
        enriched[enriched.length - 1] = { ...last, price: +price.toFixed(2) };
      }
    }
    return enriched;
  }, [histInterval, liveHist, price, pricePeriod, userPreferences]);

  const startPrice = priceHistory[0]?.price ?? price ?? null;
  const endPrice = priceHistory[priceHistory.length - 1]?.price ?? price ?? null;
  const periodReturn =
    priceHistory.length > 1 && isFiniteNumber(startPrice) && isFiniteNumber(endPrice) && startPrice > 0
      ? ((endPrice - startPrice) / startPrice) * 100
      : null;
  const retColor = periodReturn >= 0 ? T.green : T.red;

  // Show 52-week ref lines only when period is long enough to be visually meaningful
  const showRefs = ["6M", "YTD", "1Y", "5Y"].includes(pricePeriod);
  const gradId = "priceGrad_" + co.t;

  // Compute a padded Y-axis domain so chart doesn't hug data edges.
  // Uses 3-5% padding around actual price range (larger range for volatile periods).
  const priceDomain = useMemo(() => {
    if (!priceHistory.length) return ["auto", "auto"];
    let min = Infinity, max = -Infinity;
    for (const d of priceHistory) {
      if (d.price < min) min = d.price;
      if (d.price > max) max = d.price;
    }
    // For short periods (intraday) use tight 2% pad; longer periods get 5%
    const padPct = pricePeriod === "1W" ? 0.02 : pricePeriod === "1M" ? 0.03 : 0.05;
    const range = max - min;
    const pad = Math.max(range * padPct, max * 0.005); // min pad = 0.5% of price
    return [Math.max(0, min - pad), max + pad];
  }, [priceHistory, pricePeriod]);

  // Precise tick placement — aim for ~6 labels with human-readable spacing
  const tickCount = pricePeriod === "5Y" ? 6 : pricePeriod === "1Y" ? 12 : 6;
  const tickInterval = priceHistory.length > 0 ? Math.max(1, Math.floor(priceHistory.length / tickCount)) : 1;

  const CustomTooltip = ({ active, payload }) => {
    if (!active || !payload || !payload[0]) return null;
    const d = payload[0].payload;
    const chg =
      isFiniteNumber(startPrice) && startPrice > 0
        ? ((d.price - startPrice) / startPrice) * 100
        : 0;
    const chgColor = chg >= 0 ? T.green : T.red;
    const isIntraday = histInterval === "15min" || histInterval === "1hour";
    const dt = d.isoDT ? new Date(d.isoDT) : d.fullDate ? new Date(d.fullDate) : null;
    const dateLabel = dt
      ? (isIntraday
          ? `${formatAppDateForPreferences(dt, userPreferences, { weekday: "short", month: "short", day: "numeric" }, "")}  ${formatAppTimeForPreferences(dt, userPreferences, { hour: "numeric", minute: "2-digit" }, "")}`
          : formatAppDateForPreferences(dt, userPreferences, { weekday: "short", month: "short", day: "numeric", year: "numeric" }, ""))
      : d.date;
    const priceStr = d.price >= 1000 ? d.price.toFixed(0) : d.price.toFixed(2);
    return (
      <div style={{ ...chartTooltipContentStyle, padding: sp("6px 10px") }}>
        <div style={{ fontSize: fs(10), color: "var(--ra-tooltip-muted)", marginBottom: sp(2) }}>{dateLabel}</div>
        <div style={{ fontSize: fs(14), fontWeight: FONT_WEIGHTS.regular, color: "var(--ra-tooltip-text)", fontVariantNumeric: "tabular-nums" }}>{priceStr}</div>
        <div style={{ fontSize: fs(10), color: chgColor, fontWeight: FONT_WEIGHTS.regular, marginTop: sp(1), fontVariantNumeric: "tabular-nums" }}>
          {chg >= 0 ? "+" : ""}{chg.toFixed(2)}% vs {pricePeriod} start
        </div>
      </div>
    );
  };

  const periods = ["1W", "1M", "3M", "6M", "YTD", "1Y", "5Y"];

  return (
    <div style={{ background: T.bg1, border: "1px solid rgba(0,0,0,.06)", borderRadius: RADII.md, padding: sp("12px 14px"), boxShadow: "0 1px 3px rgba(0,0,0,.03)" }}>
      {/* Header: label left, period selector right */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: sp(8) }}>
        <div style={{ fontSize: fs(11), fontWeight: FONT_WEIGHTS.regular, color: T.textMuted, letterSpacing: 1.5, textTransform: "uppercase" }}>Price history</div>
        <div style={{ display: "flex", gap: 1, background: "rgba(0,0,0,.03)", borderRadius: RADII.sm, padding: sp(2) }}>
          {periods.map(p => (
            <button key={p} onClick={() => setPricePeriod(p)} style={{
              background: pricePeriod === p ? T.bg1 : "transparent",
              border: "none", borderRadius: RADII.xs, padding: sp("2px 8px"), fontSize: fs(10),
              color: pricePeriod === p ? vc.c : T.textDim, cursor: "pointer", fontWeight: FONT_WEIGHTS.regular, letterSpacing: 0.3,
              boxShadow: pricePeriod === p ? "0 1px 2px rgba(0,0,0,.08)" : "none",
            }}>{p}</button>
          ))}
        </div>
      </div>

      {/* Price summary row */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 14, marginBottom: sp(10) }}>
        <span style={{ fontSize: fs(26), fontWeight: FONT_WEIGHTS.regular, color: T.text, letterSpacing: -0.5, fontVariantNumeric: "tabular-nums" }}>
          {fmtPrice(endPrice)}
        </span>
        {isFiniteNumber(periodReturn) ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: sp("3px 10px"), borderRadius: RADII.lg, background: periodReturn >= 0 ? "rgba(26,138,92,.1)" : "rgba(196,64,64,.1)", fontSize: fs(12), fontWeight: FONT_WEIGHTS.regular, color: retColor, fontVariantNumeric: "tabular-nums" }}>
            <span>{periodReturn >= 0 ? "▲" : "▼"}</span>
            <span>{periodReturn >= 0 ? "+" : ""}{periodReturn.toFixed(2)}%</span>
            <span style={{ fontSize: fs(10), fontWeight: FONT_WEIGHTS.regular, opacity: 0.7, marginLeft: sp(2) }}>over {pricePeriod}</span>
          </span>
        ) : (
          <span style={{ fontSize: fs(10), color: T.textMuted }}>Return unavailable</span>
        )}
        {/* Data status pill — shows interval (15m/1h/D) for live intraday */}
        {(() => {
          const intervalLabel = histInterval === "15min" ? " · 15M" : histInterval === "1hour" ? " · 1H" : histInterval === "daily" ? " · DAILY" : "";
          const pill = loading ? { label: "LOADING", bg: "rgba(184,134,11,.1)", fg: T.amber, dot: T.amber }
            : histStatus === "live" ? { label: `${histSourceLabel}${intervalLabel}`, bg: "rgba(26,138,92,.1)", fg: T.green, dot: T.green, pulse: true }
            : histStatus === "error" ? { label: "BROKER UNAVAILABLE", bg: "rgba(196,64,64,.08)", fg: T.red, dot: T.red }
            : histStatus === "nodata" ? { label: "NO BROKER DATA", bg: "rgba(0,0,0,.04)", fg: T.textDim, dot: T.textDim }
            : { label: "WAITING", bg: "rgba(0,0,0,.04)", fg: T.textDim, dot: T.textMuted };
          return (
            <AppTooltip content={histStatus === "live" ? `${histSourceLabel} ${histInterval} price history via broker connectivity` : "Broker history is unavailable for this symbol and period."}><span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: sp("2px 8px"), borderRadius: RADII.md, background: pill.bg, fontSize: fs(9), fontWeight: FONT_WEIGHTS.regular, color: pill.fg, letterSpacing: 0.5 }}>
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: pill.dot, animation: pill.pulse ? "researchObservatoryPulse 1.8s ease-in-out infinite" : "none" }} />
              {pill.label}
            </span></AppTooltip>
          );
        })()}
        <span style={{ marginLeft: "auto", fontSize: fs(10), color: T.textDim, fontVariantNumeric: "tabular-nums" }}>
          {isFiniteNumber(wkLow) && isFiniteNumber(wkHigh)
            ? <>52w range: <span style={{ color: T.textSec, fontWeight: FONT_WEIGHTS.regular }}>{wkLow.toFixed(2)}</span> – <span style={{ color: T.textSec, fontWeight: FONT_WEIGHTS.regular }}>{wkHigh.toFixed(2)}</span></>
            : "52w range unavailable"}
        </span>
      </div>

      {/* Chart body */}
      <div style={{ position: "relative", height: 240 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={priceHistory} margin={{ top: 8, right: showRefs ? 42 : 8, bottom: 4, left: -2 }}>
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={vc.c} stopOpacity={0.28} />
                <stop offset="100%" stopColor={vc.c} stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="date" tick={{ fontSize: fs(10), fill: T.textDim }} axisLine={false} tickLine={false} interval={tickInterval} minTickGap={8} />
            <YAxis
              tick={{ fontSize: fs(10), fill: T.textMuted, fontVariantNumeric: "tabular-nums" }}
              axisLine={false} tickLine={false}
              domain={priceDomain}
              tickCount={6}
              tickFormatter={v => {
                if (v >= 1000) return Math.round(v).toLocaleString();
                if (v >= 100) return v.toFixed(0);
                if (v >= 10) return v.toFixed(1);
                return v.toFixed(2);
              }}
              width={52}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ stroke: vc.c, strokeWidth: 1, strokeDasharray: "3 3", strokeOpacity: 0.5 }} />
            {showRefs && isFiniteNumber(wkHigh) && (
              <ReferenceLine y={wkHigh} stroke={T.textDim} strokeDasharray="4 4" strokeOpacity={0.5}
                label={{ value: "52w hi " + wkHigh.toFixed(0), position: "right", fill: T.textDim, fontSize: fs(9) }} />
            )}
            {showRefs && isFiniteNumber(wkLow) && (
              <ReferenceLine y={wkLow} stroke={T.textDim} strokeDasharray="4 4" strokeOpacity={0.5}
                label={{ value: "52w lo " + wkLow.toFixed(0), position: "right", fill: T.textDim, fontSize: fs(9) }} />
            )}
            {/* Linear interpolation — more faithful to actual price action than monotone smoothing */}
            <Area type="linear" dataKey="price" stroke={vc.c} strokeWidth={1.6} fill={"url(#" + gradId + ")"} dot={false} activeDot={{ r: 4, fill: vc.c, stroke: T.bg1, strokeWidth: 2 }} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
        {!loading && priceHistory.length === 0 ? (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
            <div style={{ padding: sp("10px 12px"), borderRadius: RADII.md, border: "1px solid rgba(0,0,0,.08)", background: "rgba(255,255,255,.92)", boxShadow: "0 6px 20px rgba(0,0,0,.06)", textAlign: "center" }}>
              <div style={{ fontSize: fs(11), fontWeight: FONT_WEIGHTS.regular, color: T.textSec, letterSpacing: 0.4 }}>Broker chart unavailable</div>
              <div style={{ marginTop: sp(4), fontSize: fs(10), color: T.textDim }}>No broker bars returned for {co.t} over {pricePeriod}.</div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ════════════════════════ CATALYST CALENDAR ════════════════════════ */
// Full-screen view — shows upcoming earnings across all tickers in our universe.
// Fetches FMP earnings calendar for next 90 days on mount, cross-references with COMPANIES,
// groups by date, and renders clickable rows.


function PeerTable({ co, liveData, liveHist = {}, apiKey, onSelect, accent }) {
  const [fundData, setFundData] = useState({}); // { ticker: fundCache.data | null | "loading" }

  // Build peer list: focal + up-to-7 from cp. Separate in-universe vs pvt vs unknown.
  const peerTickers = useMemo(() => {
    const raw = (co.cp || []).slice(0, 8);
    const peers = raw.map(str => {
      // Match "(pvt)" marker anywhere
      const isPvt = /\(pvt\)|\(private\)/i.test(str);
      // Strip parenthetical, trim
      const rawTicker = str.replace(/\(.*?\)/g, "").trim();
      const inUniverse = COMPANIES.find(c => c.t === rawTicker);
      return { raw: str, ticker: rawTicker, isPvt, inUniverse };
    });
    return [{ raw: co.t, ticker: co.t, isPvt: false, inUniverse: co, focal: true }, ...peers];
  }, [co.t, co.cp]);

  // Trigger lazy fetch for focal + in-universe peers on mount / co change
  useEffect(() => {
    if (!apiKey) return;
    const toFetch = peerTickers
      .filter(p => p.inUniverse && !p.isPvt)
      .map(p => p.ticker);
    toFetch.forEach(t => {
      setFundData(prev => prev[t] !== undefined ? prev : { ...prev, [t]: "loading" });
      const shares = liveData[t]?.sharesOut;
      fetchFund(t, apiKey, shares).then(data => {
        setFundData(prev => ({ ...prev, [t]: data }));
      });
    });
  }, [co.t, apiKey]);

  const fmt = {
    mc: n => n == null ? "—" : n >= 1e6 ? "$" + (n / 1e6).toFixed(1) + "T" : n >= 1e3 ? "$" + (n / 1e3).toFixed(0) + "B" : "$" + n + "M",
    pe: n => (n == null || isNaN(n)) ? "—" : n < 0 ? "n/m" : n.toFixed(1),
    rev: n => n == null ? "—" : n >= 1e3 ? "$" + (n / 1e3).toFixed(1) + "B" : "$" + n + "M",
    pct: n => n == null ? "—" : (n >= 0 ? "+" : "") + n.toFixed(1) + "%",
    beta: n => (n == null || isNaN(n)) ? "—" : n.toFixed(2),
  };

  // Compute row data — live > fundCache > authored fallback
  const rows = peerTickers.map(p => {
    if (p.isPvt) {
      return { ...p, label: p.ticker || p.raw, mc: null, pe: null, rev: null, gm: null, beta: null, off52: null, status: "pvt" };
    }
    if (!p.inUniverse) {
      return { ...p, label: p.ticker || p.raw, mc: null, pe: null, rev: null, gm: null, beta: null, off52: null, status: "unknown" };
    }
    const c = p.inUniverse;
    const live = liveData[c.t] || {};
    const fund = fundData[c.t];
    const mc = live.mc != null ? live.mc : c.mc;
    const pe = live.pe != null ? live.pe : c.pe;
    const price = live.price;
    const yrHigh = live.yearHigh;
    const off52 = (price != null && yrHigh) ? ((price - yrHigh) / yrHigh) * 100 : null;
    const rev = fund && fund !== "loading" && fund.revenueTTM != null ? fund.revenueTTM : c.r;
    const gm = fund && fund !== "loading" && fund.grossMarginTTM != null ? fund.grossMarginTTM : c.g;
    const beta = fund && fund !== "loading" && fund.beta != null ? fund.beta : c.fin?.beta;
    const isLoading = fund === "loading";
    return {
      ...p, label: c.t, name: c.nm, cc: c.cc,
      mc, pe, rev, gm, beta, off52, isLoading,
      status: "ok",
      liveFields: { mc: live.mc != null, pe: live.pe != null, off52: off52 != null },
      ttmFields: { rev: fund && fund !== "loading" && fund.revenueTTM != null, gm: fund && fund !== "loading" && fund.grossMarginTTM != null, beta: fund && fund !== "loading" && fund.beta != null },
    };
  });
  const thStyle = { textAlign: "right", padding: sp("6px 7px"), fontSize: fs(9), color: T.textMuted, fontWeight: FONT_WEIGHTS.regular, letterSpacing: 1, textTransform: "uppercase" };
  const thLeft = { ...thStyle, textAlign: "left" };
  const cellBase = { padding: sp("7px 7px"), fontSize: fs(11), color: T.text, textAlign: "right", whiteSpace: "nowrap" };

  // Live-data indicator — tiny dot that signals the cell is sourced from live API (not authored fallback)
  const Dot = ({ live }) => (
    <AppTooltip content={live ? "Live" : "Authored fallback"}><span style={{ display: "inline-block", width: 4, height: 4, borderRadius: RADII.xs, background: live ? T.green : "rgba(0,0,0,.12)", marginLeft: sp(4), verticalAlign: "middle" }} /></AppTooltip>
  );

  return (
    <div style={{ background: T.bg1, border: "1px solid rgba(0,0,0,.06)", borderRadius: RADII.md, overflow: "hidden" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ background: "rgba(0,0,0,.018)", borderBottom: "1px solid rgba(0,0,0,.06)" }}>
            <th style={thLeft}>Peer</th>
            <th style={thStyle}>Mkt Cap</th>
            <th style={thStyle}>P/E</th>
            <th style={thStyle}>Rev TTM</th>
            <th style={thStyle}>GM %</th>
            <th style={thStyle}>Beta</th>
            <th style={thStyle}>Off 52w-Hi</th>
            <th style={{ ...thStyle, textAlign: "center" }}>1M trend</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const clickable = !r.focal && r.status === "ok";
            const rowBg = r.focal ? `${accent}12` : (i % 2 ? "rgba(0,0,0,.012)" : "transparent");
            const rowStyle = {
              borderBottom: i < rows.length - 1 ? "1px solid rgba(0,0,0,.04)" : "none",
              background: rowBg,
              cursor: clickable ? "pointer" : "default",
              opacity: r.status === "ok" ? 1 : 0.55,
              transition: "background .12s",
            };
            const leftCell = { ...cellBase, textAlign: "left", fontWeight: FONT_WEIGHTS.regular, color: r.focal ? T.text : T.text };
            return (
              <tr key={r.ticker + "-" + i} style={rowStyle}
                  onClick={() => { if (clickable) onSelect(r.ticker); }}
                  onMouseEnter={e => { if (clickable) e.currentTarget.style.background = `${accent}20`; }}
                  onMouseLeave={e => { e.currentTarget.style.background = rowBg; }}>
                <td style={leftCell}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    {r.status === "ok" && <Logo ticker={r.ticker} size={14} />}
                    <span style={{ fontSize: fs(11), fontWeight: FONT_WEIGHTS.regular}}>
                      {r.cc ? r.cc + " " : ""}{r.label}
                    </span>
                    {r.focal && <span style={{ fontSize: fs(9), padding: sp("1px 5px"), background: accent, color: T.onAccent, borderRadius: RADII.xs, letterSpacing: .5, fontWeight: FONT_WEIGHTS.regular }}>FOCAL</span>}
                    {r.status === "pvt" && <span style={{ fontSize: fs(9), color: T.textDim, fontStyle: "italic" }}>(private)</span>}
                    {r.status === "unknown" && <span style={{ fontSize: fs(9), color: T.textDim, fontStyle: "italic" }}>(not covered)</span>}
                  </span>
                  {r.name && <div style={{ fontSize: fs(9), color: T.textDim, marginTop: sp(1), fontWeight: FONT_WEIGHTS.regular }}>{r.name.length > 32 ? r.name.slice(0, 32) + "…" : r.name}</div>}
                </td>
                <td style={cellBase}>
                  {fmt.mc(r.mc)}
                  {r.status === "ok" && <Dot live={r.liveFields?.mc} />}
                </td>
                <td style={cellBase}>
                  {fmt.pe(r.pe)}
                  {r.status === "ok" && <Dot live={r.liveFields?.pe} />}
                </td>
                <td style={cellBase}>
                  {r.isLoading ? <span style={{ color: T.textMuted }}>…</span> : fmt.rev(r.rev)}
                  {r.status === "ok" && !r.isLoading && <Dot live={r.ttmFields?.rev} />}
                </td>
                <td style={cellBase}>
                  {r.isLoading ? <span style={{ color: T.textMuted }}>…</span> : (r.gm == null ? "—" : r.gm.toFixed(0) + "%")}
                  {r.status === "ok" && !r.isLoading && <Dot live={r.ttmFields?.gm} />}
                </td>
                <td style={cellBase}>
                  {r.isLoading ? <span style={{ color: T.textMuted }}>…</span> : fmt.beta(r.beta)}
                  {r.status === "ok" && !r.isLoading && <Dot live={r.ttmFields?.beta} />}
                </td>
                <td style={{ ...cellBase, color: r.off52 != null && r.off52 < -20 ? T.red : r.off52 != null && r.off52 > -5 ? T.green : T.text }}>
                  {fmt.pct(r.off52)}
                  {r.status === "ok" && <Dot live={r.liveFields?.off52} />}
                </td>
                <td style={{ padding: sp("4px 8px"), textAlign: "center", verticalAlign: "middle" }}>
                  {r.status === "ok" ? (
                    liveHist[r.ticker] && liveHist[r.ticker].length >= 2 ? (
                      <PriceSparkline data={liveHist[r.ticker]} width={72} height={22} />
                    ) : (
                      <span style={{ color: T.textMuted, fontSize: fs(9) }}>loading…</span>
                    )
                  ) : <span style={{ color: T.textMuted, fontSize: fs(10) }}>—</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div style={{ padding: sp("5px 8px"), fontSize: fs(9), color: T.textMuted, background: "rgba(0,0,0,.01)", borderTop: "1px solid rgba(0,0,0,.04)", letterSpacing: .3 }}>
        <span style={{ display: "inline-block", width: 4, height: 4, borderRadius: RADII.xs, background: T.green, marginRight: sp(4), verticalAlign: "middle" }} />
        Live dots = platform or research APIs · Click a peer row to switch focus · TTM = trailing twelve months · Private/uncovered names shown without metrics
      </div>
    </div>
  );
}

/* ════════════════════════ FILINGS + TRANSCRIPTS TAB ════════════════════════ */
// Shows recent SEC filings (10-K, 10-Q, 8-K, S-1, DEF 14A, etc.) + latest earnings transcript
// for the focal company. Filings list is clickable → opens the SEC EDGAR link in a new tab.
// Transcript defaults to most-recent quarter but has a dropdown to jump to historical calls.

function FilingsTab({ co, apiKey }) {
  const [filings, setFilings] = useState(null); // null = loading, [] = empty, [...] = loaded
  const [transcriptList, setTranscriptList] = useState(null); // [[year, quarter, date], ...]
  const [selectedQY, setSelectedQY] = useState(null); // [quarter, year] or null for latest
  const [transcript, setTranscript] = useState(null); // {symbol, quarter, year, date, content, ...} or null
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [transcriptExpanded, setTranscriptExpanded] = useState(false);
  const [filingTypeFilter, setFilingTypeFilter] = useState("all"); // "all" | "10K" | "10Q" | "8K" | "other"
  // Fetch filings + transcript list on mount
  useEffect(() => {
    if (!apiKey) { setFilings([]); setTranscriptList([]); return; }
    setFilings(null);
    setTranscript(null);
    setTranscriptList(null);
    setSelectedQY(null);
    fetchSECFilings(co.t, apiKey).then(data => setFilings(data || []));
    fetchTranscriptList(co.t, apiKey).then(data => setTranscriptList(data || []));
    // Auto-fetch latest transcript
    setTranscriptLoading(true);
    fetchTranscript(co.t, apiKey).then(data => {
      setTranscript(data);
      setTranscriptLoading(false);
    });
  }, [co.t, apiKey]);

  // Fetch specific transcript when user picks a quarter
  const loadTranscript = (quarter, year) => {
    setTranscriptLoading(true);
    setTranscript(null);
    setSelectedQY([quarter, year]);
    setTranscriptExpanded(false);
    fetchTranscript(co.t, apiKey, quarter, year).then(data => {
      setTranscript(data);
      setTranscriptLoading(false);
    });
  };

  // Normalize filing type → category
  const filingCategory = (type) => {
    if (!type) return "other";
    const t = type.toUpperCase();
    if (t.includes("10-K") || t === "10K") return "10K";
    if (t.includes("10-Q") || t === "10Q") return "10Q";
    if (t.includes("8-K") || t === "8K") return "8K";
    return "other";
  };

  const filteredFilings = useMemo(() => {
    if (!filings) return [];
    if (filingTypeFilter === "all") return filings;
    return filings.filter(f => filingCategory(f.type) === filingTypeFilter);
  }, [filings, filingTypeFilter]);

  // Badge color per filing category
  const typeBadge = (type) => {
    const cat = filingCategory(type);
    if (cat === "10K") return { bg: "rgba(196,64,64,.12)", fg: T.red };
    if (cat === "10Q") return { bg: "rgba(94,148,232,.12)", fg: T.blue };
    if (cat === "8K") return { bg: "rgba(184,134,11,.12)", fg: T.amber };
    return { bg: "rgba(0,0,0,.04)", fg: T.textDim };
  };

  const fmtDate = (iso) => {
    if (!iso) return "";
    try {
      const d = new Date(iso);
      const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
      return months[d.getMonth()] + " " + d.getDate() + ", " + d.getFullYear();
    } catch(e) { return iso; }
  };

  // Split transcript content into prepared remarks vs Q&A if possible
  const transcriptSections = useMemo(() => {
    if (!transcript?.content) return null;
    const content = transcript.content;
    // Heuristic: look for common Q&A markers
    const qaMarkers = [
      /\b(Question-and-Answer Session|Q\s*&\s*A|QUESTIONS AND ANSWERS|Operator:.*Our first question)/i,
    ];
    let splitIdx = -1;
    for (const re of qaMarkers) {
      const m = re.exec(content);
      if (m && m.index > 1000) { splitIdx = m.index; break; }
    }
    if (splitIdx > 0) {
      return {
        prepared: content.slice(0, splitIdx).trim(),
        qa: content.slice(splitIdx).trim(),
      };
    }
    return { prepared: content, qa: null };
  }, [transcript]);

  return (
    <>
      {/* ══════════════════ SEC FILINGS ══════════════════ */}
      <div style={{ marginBottom: sp(16) }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: sp(5) }}>
          <div style={STYLE_LABEL}>SEC Filings · Recent</div>
          <div style={{ display: "inline-flex", gap: 2, background: "rgba(0,0,0,.03)", borderRadius: RADII.sm, padding: sp(2) }}>
            {[["all", "All"], ["10K", "10-K"], ["10Q", "10-Q"], ["8K", "8-K"], ["other", "Other"]].map(([k, lb]) => (
              <button key={k} onClick={() => setFilingTypeFilter(k)} style={{
                background: filingTypeFilter === k ? T.bg1 : "transparent",
                border: "none", borderRadius: RADII.xs, padding: sp("3px 8px"),
                fontSize: fs(10), fontWeight: FONT_WEIGHTS.regular,
                color: filingTypeFilter === k ? T.text : T.textDim, cursor: "pointer",
                boxShadow: filingTypeFilter === k ? "0 1px 2px rgba(0,0,0,.06)" : "none",
              }}>{lb}</button>
            ))}
          </div>
        </div>

        {!apiKey && (
          <div style={{ padding: sp("20px 12px"), background: T.bg1, border: "1px solid rgba(0,0,0,.06)", borderRadius: RADII.md, textAlign: "center", color: T.textDim, fontSize: fs(11) }}>
            Add FMP API key in settings to load SEC filings
          </div>
        )}
        {apiKey && filings === null && (
          <div style={{ padding: sp("20px 12px"), background: T.bg1, border: "1px solid rgba(0,0,0,.06)", borderRadius: RADII.md, textAlign: "center", color: T.amber, fontSize: fs(11) }}>
            ⌛ Loading filings…
          </div>
        )}
        {apiKey && filings && filings.length === 0 && (
          <div style={{ padding: sp("20px 12px"), background: T.bg1, border: "1px solid rgba(0,0,0,.06)", borderRadius: RADII.md, textAlign: "center", color: T.textDim, fontSize: fs(11) }}>
            No filings data returned for {co.t} {co.cc?.includes("🇺🇸") ? "" : "(foreign issuer — SEC filings may be limited)"}
          </div>
        )}
        {apiKey && filteredFilings.length > 0 && (
          <div style={{ background: T.bg1, border: "1px solid rgba(0,0,0,.06)", borderRadius: RADII.md, overflow: "hidden", maxHeight: 280, overflowY: "auto" }}>
            {filteredFilings.map((f, i) => {
              const badge = typeBadge(f.type);
              return (
                <a key={f.fillingDate + "-" + i} href={f.finalLink || f.link} target="_blank" rel="noopener noreferrer"
                   style={{
                     display: "grid", gridTemplateColumns: "60px 95px 1fr auto",
                     gap: 10, alignItems: "center",
                     padding: sp("7px 10px"),
                     borderBottom: i < filteredFilings.length - 1 ? "1px solid rgba(0,0,0,.04)" : "none",
                     background: i % 2 ? "rgba(0,0,0,.008)" : "transparent",
                     textDecoration: "none", color: "inherit", cursor: "pointer",
                     transition: "background .12s",
                   }}
                   onMouseEnter={e => e.currentTarget.style.background = "rgba(205,162,78,.06)"}
                   onMouseLeave={e => e.currentTarget.style.background = i % 2 ? "rgba(0,0,0,.008)" : "transparent"}>
                  <span style={{ display: "inline-block", padding: sp("2px 5px"), borderRadius: RADII.xs, background: badge.bg, color: badge.fg, fontSize: fs(9), fontWeight: FONT_WEIGHTS.regular, letterSpacing: .3, textAlign: "center" }}>{f.type}</span>
                  <span style={{ fontSize: fs(10), color: T.textDim }}>{fmtDate(f.fillingDate || f.filingDate)}</span>
                  <span style={{ fontSize: fs(11), color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {f.type?.includes("10-K") ? "Annual Report" :
                     f.type?.includes("10-Q") ? "Quarterly Report" :
                     f.type?.includes("8-K") ? "Current Report" :
                     f.type?.includes("DEF 14A") ? "Proxy Statement" :
                     f.type?.includes("S-1") ? "Registration Statement" :
                     f.type || "Filing"}
                  </span>
                  <span style={{ fontSize: fs(14), color: T.textMuted }}>↗</span>
                </a>
              );
            })}
          </div>
        )}
      </div>

      {/* ══════════════════ EARNINGS TRANSCRIPT ══════════════════ */}
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: sp(5) }}>
          <div style={STYLE_LABEL}>Earnings Call Transcript</div>
          {transcriptList && transcriptList.length > 0 && (
            <select
              value={selectedQY ? `${selectedQY[0]}-${selectedQY[1]}` : "latest"}
              onChange={e => {
                if (e.target.value === "latest") {
                  setSelectedQY(null);
                  setTranscriptLoading(true);
                  setTranscript(null);
                  setTranscriptExpanded(false);
                  fetchTranscript(co.t, apiKey).then(data => {
                    setTranscript(data);
                    setTranscriptLoading(false);
                  });
                } else {
                  const [q, y] = e.target.value.split("-").map(Number);
                  loadTranscript(q, y);
                }
              }}
              style={{ fontSize: fs(10), padding: sp("3px 6px"), border: "1px solid rgba(0,0,0,.1)", borderRadius: RADII.xs, background: T.bg1, color: T.textSec, cursor: "pointer" }}
            >
              <option value="latest">Latest</option>
              {transcriptList.slice(0, 20).map((entry, i) => {
                // Entry shape: [year, quarter, date] OR {year, quarter, date}
                const year = Array.isArray(entry) ? entry[0] : entry.year;
                const quarter = Array.isArray(entry) ? entry[1] : entry.quarter;
                const date = Array.isArray(entry) ? entry[2] : entry.date;
                return <option key={i} value={`${quarter}-${year}`}>Q{quarter} {year} ({fmtDate(date)})</option>;
              })}
            </select>
          )}
        </div>

        {!apiKey && (
          <div style={{ padding: sp("20px 12px"), background: T.bg1, border: "1px solid rgba(0,0,0,.06)", borderRadius: RADII.md, textAlign: "center", color: T.textDim, fontSize: fs(11) }}>
            Add FMP API key to load transcripts
          </div>
        )}
        {apiKey && transcriptLoading && (
          <div style={{ padding: sp("20px 12px"), background: T.bg1, border: "1px solid rgba(0,0,0,.06)", borderRadius: RADII.md, textAlign: "center", color: T.amber, fontSize: fs(11) }}>
            ⌛ Loading transcript…
          </div>
        )}
        {apiKey && !transcriptLoading && !transcript && (
          <div style={{ padding: sp("20px 12px"), background: T.bg1, border: "1px solid rgba(0,0,0,.06)", borderRadius: RADII.md, textAlign: "center", color: T.textDim, fontSize: fs(11) }}>
            No transcript available for {co.t}
          </div>
        )}
        {transcript && (
          <div style={{ background: T.bg1, border: "1px solid rgba(0,0,0,.06)", borderRadius: RADII.md, overflow: "hidden" }}>
            {/* Header */}
            <div style={{ padding: sp("8px 12px"), borderBottom: "1px solid rgba(0,0,0,.06)", background: "rgba(0,0,0,.018)" }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontSize: fs(13), fontWeight: FONT_WEIGHTS.regular, color: T.text }}>Q{transcript.quarter} {transcript.year}</span>
                <span style={{ fontSize: fs(11), color: T.textDim }}>{fmtDate(transcript.date)}</span>
                <span style={{ fontSize: fs(10), color: T.textMuted, marginLeft: "auto" }}>
                  {transcript.content ? (transcript.content.length / 1000).toFixed(1) + "k chars" : ""}
                </span>
              </div>
            </div>

            {/* Body */}
            <div style={{ padding: sp("10px 12px"), fontSize: fs(12), color: T.text, lineHeight: 1.55, maxHeight: transcriptExpanded ? "70vh" : 260, overflowY: "auto", whiteSpace: "pre-wrap" }}>
              {transcriptSections?.prepared && (
                <>
                  <div style={{ fontSize: fs(10), color: T.textMuted, fontWeight: FONT_WEIGHTS.regular, letterSpacing: .5, textTransform: "uppercase", marginBottom: sp(6) }}>Prepared Remarks</div>
                  <div>{transcriptExpanded ? transcriptSections.prepared : transcriptSections.prepared.slice(0, 2200) + (transcriptSections.prepared.length > 2200 ? "…" : "")}</div>
                </>
              )}
              {transcriptExpanded && transcriptSections?.qa && (
                <>
                  <div style={{ fontSize: fs(10), color: T.textMuted, fontWeight: FONT_WEIGHTS.regular, letterSpacing: .5, textTransform: "uppercase", marginTop: sp(14), marginBottom: sp(6), borderTop: "1px solid rgba(0,0,0,.06)", paddingTop: sp(10) }}>Q&A Session</div>
                  <div>{transcriptSections.qa}</div>
                </>
              )}
            </div>

            {/* Expand/collapse footer */}
            <div style={{ padding: sp("6px 10px"), borderTop: "1px solid rgba(0,0,0,.06)", background: "rgba(0,0,0,.012)", textAlign: "center" }}>
              <button onClick={() => setTranscriptExpanded(!transcriptExpanded)} style={{
                background: "none", border: "none", padding: sp("2px 8px"),
                fontSize: fs(10), color: T.textDim, cursor: "pointer", fontWeight: FONT_WEIGHTS.regular, letterSpacing: .3,
              }}>
                {transcriptExpanded ? "▲ Collapse" : transcriptSections?.qa ? "▼ Expand full transcript (incl. Q&A)" : "▼ Expand full transcript"}
              </button>
            </div>
          </div>
        )}
        <div style={{ fontSize: fs(9), color: T.textMuted, marginTop: sp(6), textAlign: "right" }}>
          Transcripts & filings via FMP · Click any filing to open on SEC EDGAR
        </div>
      </div>
    </>
  );
}

/* ════════════════════════ MARKDOWN EXPORT ════════════════════════ */
// Generates a memo-ready markdown dump of everything we know about a company.
// Pulls from authored schema fields + live liveData/focalFund + module-level fundCache.
// Designed for research-analyst workflow: "read the dashboard, copy the company, paste into notes."

function companyToMarkdown(co, { live, focalFund, fd, price, dailyPct, wkLow, wkHigh }) {
  if (!co) return "";
  const vc = VX[co.v];
  const derivedGrowth = deriveGrowthRateFromFinancials(fd);
  const eff = {
    mc: live?.mc ?? co.mc,
    pe: live?.pe ?? co.pe,
    rev: focalFund?.revenueTTM ?? co.r,
    gm: focalFund?.grossMarginTTM ?? co.g,
    beta: focalFund?.beta ?? co.fin?.beta,
    eps: live?.eps ?? co.fin?.eps,
  };
  const liveTag = (isLive) => isLive ? " · live" : " · authored";
  const fmtMCLocal = n => {
    if (n == null) return "—";
    if (Math.abs(n) >= 1e6) return "$" + (n / 1e6).toFixed(1) + "T";
    if (Math.abs(n) >= 1e3) return "$" + (n / 1e3).toFixed(0) + "B";
    return "$" + n + "M";
  };
  const lines = [];

  // ── TITLE + HEADLINE ──
  lines.push(`# ${co.cc || ""} ${co.t} — ${co.nm}`);
  lines.push(`**${vc.n} · ${co.s}** · Price \`${price?.toFixed(2) || "—"}\` (${dailyPct >= 0 ? "+" : ""}${dailyPct?.toFixed(2) || "0"}%)`);
  lines.push("");

  // ── ONE-LINER DESCRIPTION ──
  if (co.d) {
    lines.push(`> ${co.d}`);
    lines.push("");
  }
  if (co.pr) {
    lines.push(`**Flagship product:** ${co.pr}`);
    lines.push("");
  }

  // ── KEY METRICS TABLE ──
  lines.push(`## Key Metrics`);
  lines.push(``);
  lines.push(`| Metric | Value | Source |`);
  lines.push(`|---|---|---|`);
  lines.push(`| Market Cap | ${fmtMCLocal(eff.mc)} | ${live?.mc != null ? "live" : "authored"} |`);
  lines.push(`| P/E (TTM) | ${eff.pe ? eff.pe.toFixed(1) + "x" : "—"} | ${live?.pe != null ? "live" : "authored"} |`);
  lines.push(`| Revenue TTM | ${fmtMCLocal(eff.rev)} | ${focalFund?.revenueTTM != null ? "live" : "authored"} |`);
  lines.push(`| Gross Margin | ${eff.gm != null ? Math.round(eff.gm) + "%" : "—"} | ${focalFund?.grossMarginTTM != null ? "live" : "authored"} |`);
  if (focalFund?.netMarginTTM != null) lines.push(`| Net Margin | ${focalFund.netMarginTTM.toFixed(1)}% | live |`);
  if (focalFund?.operMarginTTM != null) lines.push(`| Operating Margin | ${focalFund.operMarginTTM.toFixed(1)}% | live |`);
  if (focalFund?.roeTTM != null) lines.push(`| ROE | ${focalFund.roeTTM.toFixed(1)}% | live |`);
  if (focalFund?.evToEBITDA != null) lines.push(`| EV / EBITDA | ${focalFund.evToEBITDA.toFixed(1)}x | live |`);
  if (focalFund?.priceToSales != null) lines.push(`| P / Sales | ${focalFund.priceToSales.toFixed(2)}x | live |`);
  if (focalFund?.debtToEquity != null) lines.push(`| Debt / Equity | ${focalFund.debtToEquity.toFixed(2)} | live |`);
  lines.push(`| Beta | ${eff.beta != null ? eff.beta.toFixed(2) : "—"} | ${focalFund?.beta != null ? "live" : "authored"} |`);
  lines.push(`| EPS (TTM) | ${eff.eps != null ? "$" + eff.eps.toFixed(2) : "—"} | ${live?.eps != null ? "live" : "authored"} |`);
  if (isFiniteNumber(derivedGrowth)) {
    lines.push(`| Revenue Growth | ${(derivedGrowth > 0 ? "+" : "") + derivedGrowth.toFixed(1)}% | live-derived |`);
  } else if (co.fin?.rg?.[4] != null) {
    lines.push(`| Revenue Growth | ${(co.fin.rg[4] > 0 ? "+" : "") + co.fin.rg[4]}% | authored |`);
  }
  if (co.fin?.div) lines.push(`| Dividend | $${co.fin.div.toFixed(2)} | authored |`);
  if (wkLow != null && wkHigh != null) lines.push(`| 52W Range | $${wkLow.toFixed(2)} – $${wkHigh.toFixed(2)} | live |`);
  lines.push("");

  // ── SEGMENTS ──
  if (co.rs && co.rs.length) {
    lines.push(`## Revenue Segmentation`);
    lines.push(``);
    co.rs.forEach(([name, pct]) => { lines.push(`- **${name}:** ${pct}%`); });
    lines.push("");
  }

  // ── GEOGRAPHY ──
  if (co.geo && co.geo.length) {
    lines.push(`## Geographic Mix`);
    lines.push(``);
    co.geo.forEach(([name, pct]) => { lines.push(`- **${name}:** ${pct}%`); });
    lines.push("");
  }

  // ── TOP CUSTOMERS ──
  if (co.tc && co.tc.length) {
    lines.push(`## Top Customers`);
    lines.push(``);
    co.tc.forEach(([name, pct]) => { lines.push(`- **${name}:** ${pct}%`); });
    lines.push("");
  }

  // ── PRODUCT PORTFOLIO ──
  if (co.pl && co.pl.length) {
    lines.push(`## Product Portfolio`);
    lines.push(``);
    co.pl.forEach(p => {
      lines.push(`### ${p.name}${p.pos ? ` _(${p.pos})_` : ""}`);
      if (p.desc) lines.push(p.desc);
      lines.push("");
    });
  }

  // ── COMPETITORS ──
  if (co.cp && co.cp.length) {
    lines.push(`## Competitive Landscape`);
    lines.push(``);
    co.cp.forEach(c => { lines.push(`- ${c}`); });
    lines.push("");
  }

  // ── SUPPLY CHAIN ──
  const sup = EDGES.filter(([, t]) => t === co.t).map(([s, l]) => ({ t: s, l }));
  const cust = EDGES.filter(([s]) => s === co.t).map(([, t, l]) => ({ t, l }));
  if (sup.length || cust.length) {
    lines.push(`## Supply Chain`);
    lines.push(``);
    if (sup.length) {
      lines.push(`**Suppliers:** ${sup.map(s => `$${s.t}${s.l ? ` (${s.l})` : ""}`).join(", ")}`);
      lines.push("");
    }
    if (cust.length) {
      lines.push(`**Customers:** ${cust.map(c => `$${c.t}${c.l ? ` (${c.l})` : ""}`).join(", ")}`);
      lines.push("");
    }
  }

  // ── RISKS ──
  if (co.ri && co.ri.length) {
    lines.push(`## Risks`);
    lines.push(``);
    co.ri.forEach(r => { lines.push(`- ${r}`); });
    lines.push("");
  }

  // ── CATALYSTS ──
  if (co.ca && co.ca.length) {
    lines.push(`## Catalysts`);
    lines.push(``);
    co.ca.forEach(c => { lines.push(`- ${c}`); });
    lines.push("");
  }

  // ── OPERATIONS ──
  if (co.ops) {
    lines.push(`## Operations`);
    lines.push(``);
    if (co.ops.hq) lines.push(`- **Headquarters:** ${co.ops.hq}`);
    if (co.ops.fd) lines.push(`- **Founded:** ${co.ops.fd}`);
    if (co.ops.emp) lines.push(`- **Employees:** ${co.ops.emp.toLocaleString()}`);
    if (co.ops.mfg && co.ops.mfg.length) lines.push(`- **Facilities:** ${co.ops.mfg.join(", ")}`);
    if (co.ops.bl) lines.push(`- **${co.ops.bl.label}:** $${co.ops.bl.val}${co.ops.bl.unit}`);
    if (co.ops.ne) lines.push(`- **Next Earnings:** ${co.ops.ne}`);
    lines.push("");
  }

  // ── OWNERSHIP ──
  if (co.own) {
    lines.push(`## Ownership`);
    lines.push(``);
    if (co.own.insider != null) lines.push(`- **Insider:** ${co.own.insider}%`);
    if (co.own.institutional != null) lines.push(`- **Institutional:** ${co.own.institutional}%`);
    lines.push("");
  }

  // ── THEME TAGS ──
  if (co.themes && co.themes.length) {
    lines.push(`## Investment Themes`);
    lines.push(``);
    lines.push(co.themes.map(t => `\`${t}\``).join(" · "));
    lines.push("");
  }

  // ── FOOTER ──
  lines.push(`---`);
  const now = new Date();
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const datestr = `${months[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()}`;
  lines.push(`*Exported ${datestr} · Pricing via broker market data and research snapshots · Segment/operations data per most recent company filings*`);

  return lines.join("\n");
}

/* ════════════════════════ DETAIL PANEL (ORCHESTRATOR) ════════════════════════ */
/* ──────── Detail tab: OVERVIEW ──────── */
function OverviewTab({ co, vc, price, apiKey, wkLow, wkHigh, live, focalFund, dayLow, dayHigh, sup, cust, fd, onSelect }) {
  const valuationBase = useMemo(
    () => deriveValuationBaseCase(co, fd, live),
    [co, fd, live?.mc, live?.price, live?.sharesOut],
  );

  return (
    <>
        {/* ── PRICE CHART (full width, prominent) ── */}
        <div style={{ marginBottom: sp(12) }}>
          <PriceChart co={co} vc={vc} price={price} apiKey={apiKey} wkLow={wkLow} wkHigh={wkHigh} />
        </div>

        {/* ── KEY STATS (live TTM when available) ── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 0, marginBottom: sp(10) }}>
          {[
            ["Mkt Cap", fmtMC(live?.mc || co.mc), live?.mc != null],
            ["P/E (TTM)", (live?.pe || co.pe) ? (live?.pe || co.pe).toFixed(1) + "x" : "—", live?.pe != null],
            ["Beta", (focalFund?.beta != null ? focalFund.beta : (co.fin?.beta != null ? co.fin.beta : NaN)).toFixed ? (focalFund?.beta != null ? focalFund.beta : co.fin.beta).toFixed(2) : "—", focalFund?.beta != null],
            ["Revenue TTM", fmtMC(focalFund?.revenueTTM != null ? focalFund.revenueTTM : co.r), focalFund?.revenueTTM != null],
            ["Gross Margin", (focalFund?.grossMarginTTM != null ? focalFund.grossMarginTTM.toFixed(0) + "%" : (co.g != null ? co.g + "%" : "—")), focalFund?.grossMarginTTM != null],
            ["EPS (TTM)", "$" + (live?.eps != null ? live.eps : (co.fin?.eps || 0)).toFixed(2), live?.eps != null],
            ["Growth", (isFiniteNumber(valuationBase.gr) ? ((valuationBase.gr > 0 ? "+" : "") + valuationBase.gr.toFixed(1) + "%") : "—"), valuationBase.hasLiveGrowth],
            ["Dividend", co.fin?.div ? "$" + co.fin.div.toFixed(2) : "—", false],
            ["Shares", (isFiniteNumber(valuationBase.sh) ? valuationBase.sh.toFixed(0) + "M" : "—"), valuationBase.hasLiveShares],
          ].map(([l, v, isLive], i) => (
            <div key={l} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: sp("3px 8px"), background: Math.floor(i / 3) % 2 === 0 ? "rgba(0,0,0,.01)" : "transparent", borderBottom: "1px solid rgba(0,0,0,.025)" }}>
              <span style={{ fontSize: fs(11), color: T.textDim }}>{l}</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <span style={{ fontSize: fs(11), color: T.text, fontWeight: FONT_WEIGHTS.regular }}>{v}</span>
                {isLive && <AppTooltip content="Live from FMP"><span style={{ display: "inline-block", width: 4, height: 4, borderRadius: RADII.xs, background: T.green }} /></AppTooltip>}
              </span>
            </div>
          ))}
        </div>

        {/* ── RANGE BARS ── */}
        <div style={{ marginBottom: sp(10) }}>
          <div style={{ fontSize: fs(11), color: T.textMuted, marginBottom: sp(2) }}>Day Range</div>
          <RangeBar low={dayLow} high={dayHigh} current={price} color={vc.c} />
          <div style={{ fontSize: fs(11), color: T.textMuted, marginBottom: sp(2), marginTop: sp(5) }}>52 Week Range</div>
          <RangeBar low={wkLow} high={wkHigh} current={price} color={vc.c} />
        </div>

        {/* ── DESCRIPTION + PRODUCT ── */}
        <div style={STYLE_SECTION}>
          <p style={{ fontSize: fs(13), color: T.textSec, lineHeight: 1.7, margin: "0 0 8px" }}>{co.d}</p>
          <div style={{ background: vc.bg, borderRadius: RADII.md, padding: sp("6px 10px"), fontSize: fs(11), color: T.textSec }}>{co.pr}</div>
        </div>

        {/* ── SUPPLY CHAIN + RISKS/CATALYSTS ── */}
        <div style={{ ...STYLE_SECTION, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <div>
            <div style={STYLE_LABEL}>Supply chain</div>
            <div style={{ marginBottom: sp(8) }}>
              <div style={{ fontSize: fs(10), color: T.textMuted, marginBottom: sp(3) }}>SUPPLIERS → ({sup.length})</div>
              {sup.length > 0 ? sup.map(sx => (
                <div key={sx.t + sx.l} onClick={() => onSelect && onSelect(sx.t)} style={{ fontSize: fs(11), color: T.textDim, padding: sp("2px 0"), cursor: "pointer", borderRadius: RADII.xs }}
                  onMouseEnter={e => e.currentTarget.style.background = "rgba(0,0,0,.03)"}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                  <Logo ticker={sx.t} size={12} style={{ marginRight: sp(3) }} /><span style={{ color: VX[(COMPANIES.find(c => c.t === sx.t) || COMPANIES[0]).v].c }}>${sx.t}</span>
                  <span style={{ color: T.textMuted, marginLeft: sp(4) }}>{sx.l}</span>
                </div>
              )) : <div style={{ fontSize: fs(11), color: T.textMuted }}>{"—"}</div>}
            </div>
            <div>
              <div style={{ fontSize: fs(10), color: T.textMuted, marginBottom: sp(3) }}>→ CUSTOMERS ({cust.length})</div>
              {cust.length > 0 ? cust.map(cx => (
                <div key={cx.t + cx.l} onClick={() => onSelect && onSelect(cx.t)} style={{ fontSize: fs(11), color: T.textDim, padding: sp("2px 0"), cursor: "pointer", borderRadius: RADII.xs }}
                  onMouseEnter={e => e.currentTarget.style.background = "rgba(0,0,0,.03)"}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                  <Logo ticker={cx.t} size={12} style={{ marginRight: sp(3) }} /><span style={{ color: VX[(COMPANIES.find(c => c.t === cx.t) || COMPANIES[0]).v].c }}>${cx.t}</span>
                  <span style={{ color: T.textMuted, marginLeft: sp(4) }}>{cx.l}</span>
                </div>
              )) : <div style={{ fontSize: fs(11), color: T.textMuted }}>End buyer</div>}
            </div>
          </div>
          <div>
            <div style={{ background: "rgba(196,64,64,.03)", borderRadius: RADII.sm, padding: sp(7), marginBottom: sp(6) }}>
              <div style={{ fontSize: fs(10), color: T.red, letterSpacing: 1.5, marginBottom: sp(4) }}>RISKS</div>
              {co.ri.map((r, i) => <div key={i} style={{ fontSize: fs(11), color: T.textDim, marginBottom: sp(2), paddingLeft: sp(12), lineHeight: 1.5 }}>{r}</div>)}
            </div>
            <div style={{ background: "rgba(26,138,92,.03)", borderRadius: RADII.sm, padding: sp(7) }}>
              <div style={{ fontSize: fs(10), color: T.green, letterSpacing: 1.5, marginBottom: sp(4) }}>CATALYSTS</div>
              {co.ca.map((c, i) => <div key={i} style={{ fontSize: fs(11), color: T.textDim, marginBottom: sp(2), paddingLeft: sp(12), lineHeight: 1.5 }}>{c}</div>)}
            </div>
          </div>
        </div>

        {/* ── ANNUAL REVENUE ── */}
        <div style={STYLE_SECTION}>
          <div style={STYLE_LABEL}>Annual Revenue</div>
          <ResponsiveContainer width="100%" height={75}>
            <BarChart data={fd.years.map((y, i) => ({ year: y, rev: fd.revs[i] }))} margin={{ top: 5, right: 5, bottom: 5, left: -10 }}>
              <XAxis dataKey="year" tick={{ fontSize: fs(10), fill: T.textDim }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: fs(11), fill: T.textMuted }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={chartTooltipContentStyle} formatter={(v) => [fmtMC(v), "Revenue"]} />
              <Bar dataKey="rev" fill={vc.c} radius={[4, 4, 0, 0]} barSize={28} fillOpacity={0.7}>
                {fd.years.map((y, i) => <Cell key={i} fill={y.includes("E") ? vc.c + "88" : vc.c} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* ── OPERATIONS (schema-tolerant) ── */}
        <div style={STYLE_SECTION}>
          <div style={STYLE_LABEL}>Operations snapshot</div>
          <OpsStrip co={co} color={vc.c} />
        </div>
    </>
  );
}

/* ──────── Detail tab: BUSINESS ──────── */
function BusinessTab({ co, vc, live, sup, cust, onSelect, liveData, liveHist, apiKey }) {
  return (
    <>
          {/* Revenue Segments */}
          <div style={{ marginBottom: sp(14) }}>
            <div style={STYLE_LABEL}>Revenue segments</div>
            {co.rs && co.rs.length > 0 ? (
              <StackedBar data={co.rs} color={vc.c} height={22} />
            ) : (
              <DataNotReported label="Revenue mix by product line or business unit is not available for this company." />
            )}
          </div>

          {/* Geographic Mix */}
          <div style={{ marginBottom: sp(14) }}>
            <div style={STYLE_LABEL}>Geographic mix</div>
            {co.geo && co.geo.length > 0 ? (
              <StackedBar data={co.geo} color={vc.c} height={22} />
            ) : (
              <DataNotReported label="Geographic revenue mix is not available for this company." />
            )}
          </div>

          {/* Top Customers */}
          <div style={{ marginBottom: sp(14) }}>
            <div style={STYLE_LABEL}>Customer concentration</div>
            {co.tc && co.tc.length > 0 ? (
              <div style={{ background: T.bg1, border: "1px solid rgba(0,0,0,.06)", borderRadius: RADII.md, padding: sp(10) }}>
                <StackedBar data={co.tc.map(([n, p]) => [n, p])} color={vc.c} height={20} />
                <div style={{ marginTop: sp(8), paddingTop: sp(8), borderTop: "1px solid rgba(0,0,0,.04)" }}>
                  {co.tc.map(([n, p]) => (
                    <div key={n} style={{ display: "flex", justifyContent: "space-between", padding: sp("2px 0"), fontSize: fs(11) }}>
                      <span style={{ color: T.textSec, fontWeight: FONT_WEIGHTS.regular }}>{n}</span>
                      <span style={{ color: T.text, fontWeight: FONT_WEIGHTS.regular }}>{p}%</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <DataNotReported label="Named customer concentration is not available for this company." />
            )}
          </div>

          {/* Product Lines */}
          <div style={{ marginBottom: sp(14) }}>
            <div style={STYLE_LABEL}>Product portfolio</div>
            {co.pl && co.pl.length > 0 ? (
              <div style={{ background: T.bg1, border: "1px solid rgba(0,0,0,.06)", borderRadius: RADII.md, overflow: "hidden" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ background: "rgba(0,0,0,.018)", borderBottom: "1px solid rgba(0,0,0,.06)" }}>
                      <th style={{ textAlign: "left", padding: sp("5px 8px"), fontSize: fs(10), color: T.textMuted, fontWeight: FONT_WEIGHTS.regular, letterSpacing: 1, textTransform: "uppercase" }}>Product</th>
                      <th style={{ textAlign: "left", padding: sp("5px 8px"), fontSize: fs(10), color: T.textMuted, fontWeight: FONT_WEIGHTS.regular, letterSpacing: 1, textTransform: "uppercase" }}>Description</th>
                      <th style={{ textAlign: "right", padding: sp("5px 8px"), fontSize: fs(10), color: T.textMuted, fontWeight: FONT_WEIGHTS.regular, letterSpacing: 1, textTransform: "uppercase" }}>Position</th>
                    </tr>
                  </thead>
                  <tbody>
                    {co.pl.map((p, i) => (
                      <tr key={i} style={{ borderBottom: i < co.pl.length - 1 ? "1px solid rgba(0,0,0,.04)" : "none" }}>
                        <td style={{ padding: sp("5px 8px"), fontSize: fs(11), color: T.text, fontWeight: FONT_WEIGHTS.regular }}>{p.name}</td>
                        <td style={{ padding: sp("5px 8px"), fontSize: fs(11), color: T.textSec }}>{p.desc}</td>
                        <td style={{ padding: sp("5px 8px"), fontSize: fs(11), color: vc.c, textAlign: "right", fontWeight: FONT_WEIGHTS.regular }}>{p.pos || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div style={{ background: vc.bg, borderRadius: RADII.md, padding: sp("8px 12px"), fontSize: fs(11), color: T.textSec }}>{co.pr}</div>
            )}
          </div>

          {/* Peer comparison */}
          <div style={{ marginBottom: sp(14) }}>
            <div style={STYLE_LABEL}>Peer comparison</div>
            <PeerGrid co={co} color={vc.c} onSelect={onSelect} />
            <div style={{ fontSize: fs(10), color: T.textMuted, marginTop: sp(4), fontStyle: "italic" }}>
              Peers selected by closest market cap within same sub-layer and vertical. Dot shows rank in peer set.
            </div>
          </div>

          {/* Supply chain detail */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: sp(14) }}>
            <div>
              <div style={STYLE_LABEL}>Suppliers ({sup.length})</div>
              <div style={{ background: T.bg1, border: "1px solid rgba(0,0,0,.06)", borderRadius: RADII.sm, padding: sp(8), minHeight: 60 }}>
                {sup.length > 0 ? sup.map(sx => {
                  const sCo = COMPANIES.find(c => c.t === sx.t);
                  return (
                    <div key={sx.t + sx.l} onClick={() => onSelect && onSelect(sx.t)} style={{ display: "flex", alignItems: "center", gap: 5, padding: sp("3px 4px"), cursor: "pointer", borderRadius: RADII.xs, fontSize: fs(11) }}
                      onMouseEnter={e => e.currentTarget.style.background = "rgba(0,0,0,.03)"}
                      onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                      <Logo ticker={sx.t} size={14} />
                      <span style={{ color: sCo ? VX[sCo.v].c : T.textDim, fontWeight: FONT_WEIGHTS.regular }}>{sx.t}</span>
                      <span style={{ color: T.textMuted, marginLeft: "auto", fontSize: fs(10) }}>{sx.l}</span>
                    </div>
                  );
                }) : <div style={{ fontSize: fs(11), color: T.textMuted, padding: sp(4) }}>End of chain</div>}
              </div>
            </div>
            <div>
              <div style={STYLE_LABEL}>Customers ({cust.length})</div>
              <div style={{ background: T.bg1, border: "1px solid rgba(0,0,0,.06)", borderRadius: RADII.sm, padding: sp(8), minHeight: 60 }}>
                {cust.length > 0 ? cust.map(cx => {
                  const cCo = COMPANIES.find(c => c.t === cx.t);
                  return (
                    <div key={cx.t + cx.l} onClick={() => onSelect && onSelect(cx.t)} style={{ display: "flex", alignItems: "center", gap: 5, padding: sp("3px 4px"), cursor: "pointer", borderRadius: RADII.xs, fontSize: fs(11) }}
                      onMouseEnter={e => e.currentTarget.style.background = "rgba(0,0,0,.03)"}
                      onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                      <Logo ticker={cx.t} size={14} />
                      <span style={{ color: cCo ? VX[cCo.v].c : T.textDim, fontWeight: FONT_WEIGHTS.regular }}>{cx.t}</span>
                      <span style={{ color: T.textMuted, marginLeft: "auto", fontSize: fs(10) }}>{cx.l}</span>
                    </div>
                  );
                }) : <div style={{ fontSize: fs(11), color: T.textMuted, padding: sp(4) }}>End buyer</div>}
              </div>
            </div>
          </div>

          {/* Peer comparison table */}
          <div style={{ marginBottom: sp(4) }}>
            <div style={STYLE_LABEL}>Peer comparison · live fundamentals</div>
            {co.cp && co.cp.length > 0 ? (
              <PeerTable co={co} liveData={liveData} liveHist={liveHist} apiKey={apiKey} onSelect={onSelect} accent={vc.c} />
            ) : (
              <DataNotReported label="Named direct competitors are not available for this company." />
            )}
          </div>
    </>
  );
}

/* ──────── Detail tab: FINANCIALS ──────── */
function DetailFinancialsTab({ co, vc, fd, scenarioAdj }) {
  const latestRatio = getLatestSeriesEntry(fd?.ratiosData || []);
  return (
    <>
          {/* Quarterly EPS: beats vs estimates */}
          <div style={{ marginBottom: sp(12) }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: sp(4) }}>
              <div style={STYLE_LABEL}>Quarterly EPS · actual vs estimate</div>
              <div style={{ display: "flex", gap: 10, fontSize: fs(10), color: T.textDim }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                  <span style={{ width: 8, height: 8, background: T.bg3, borderRadius: 1 }} />Estimate
                </span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                  <span style={{ width: 8, height: 8, background: T.green, borderRadius: 1 }} />Beat
                </span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                  <span style={{ width: 8, height: 8, background: T.red, borderRadius: 1 }} />Miss
                </span>
              </div>
            </div>
            <div style={{ background: T.bg1, border: "1px solid rgba(0,0,0,.06)", borderRadius: RADII.md, padding: sp("8px 10px") }}>
	              <ResponsiveContainer width="100%" height={140}>
	                <BarChart data={fd.qEPS} margin={{ top: 6, right: 8, bottom: 5, left: -10 }}>
	                  <XAxis dataKey="label" tick={{ fontSize: fs(10), fill: T.textDim }} axisLine={false} tickLine={false} />
	                  <YAxis tick={{ fontSize: fs(10), fill: T.textMuted }} axisLine={false} tickLine={false} tickFormatter={v => "$" + v.toFixed(2)} width={40} />
	                  <Tooltip contentStyle={chartTooltipContentStyle}
	                    formatter={(v, name) => [isFiniteNumber(v) ? "$" + v.toFixed(2) : "—", name]} />
	                  <Bar dataKey="estimate" fill={T.bg3} radius={[2, 2, 0, 0]} barSize={10} name="Est" />
	                  <Bar dataKey="actual" radius={[2, 2, 0, 0]} barSize={10} name="Actual">
	                    {fd.qEPS.map((e, i) => <Cell key={i} fill={e.beat == null ? T.textDim : e.beat ? T.green : T.red} />)}
	                  </Bar>
	                  <ReferenceLine y={0} stroke={T.textMuted} />
	                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Key Ratios Strip */}
          <div style={STYLE_SECTION}>
            <div style={STYLE_LABEL}>Key ratios · 5-year trend</div>
            <KeyRatios ratios={fd.ratiosData} co={co} color={vc.c} />
          </div>

          {/* Financial Statements (IS / BS / CF) */}
	          <div style={STYLE_SECTION}>
	            <div style={STYLE_LABEL}>Financial statements</div>
	            <FinancialsTab co={co} color={vc.c} fd={fd} scenarioAdj={scenarioAdj} />
	          </div>

          {/* Investment & intensity trends */}
          <div style={STYLE_SECTION}>
            <div style={STYLE_LABEL}>Investment intensity</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div style={{ background: T.bg1, border: "1px solid rgba(0,0,0,.06)", borderRadius: RADII.md, padding: sp(10) }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: sp(4) }}>
                  <span style={{ fontSize: fs(10), color: T.textDim, textTransform: "uppercase", letterSpacing: 1, fontWeight: FONT_WEIGHTS.regular }}>R&D ÷ Revenue</span>
                  <TrendSpark values={fd.ratiosData.map(r => r.rdIntensity)} color={vc.c} width={120} height={30} />
                </div>
                <div style={{ fontSize: fs(10), color: T.textMuted }}>
                  {co.v === "compute" ? "High R&D intensity is expected — tech leadership requires it" :
                   co.v === "photonics" ? "Photonics R&D reflects process and device innovation" :
                   co.v === "hyperscaler" ? "Hyperscaler R&D funds both software and silicon" : "Steady R&D reinvestment sustains margin"}
                </div>
              </div>
              <div style={{ background: T.bg1, border: "1px solid rgba(0,0,0,.06)", borderRadius: RADII.md, padding: sp(10) }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: sp(4) }}>
                  <span style={{ fontSize: fs(10), color: T.textDim, textTransform: "uppercase", letterSpacing: 1, fontWeight: FONT_WEIGHTS.regular }}>Capex ÷ Revenue</span>
                  <TrendSpark values={fd.ratiosData.map(r => r.capexIntensity)} color={vc.c} width={120} height={30} />
                </div>
                <div style={{ fontSize: fs(10), color: T.textMuted }}>
                  {co.v === "hyperscaler" ? "AI buildout cycle drives sustained elevated capex" :
                   co.v === "dcInfra" ? "Capital-intensive DC infrastructure by design" :
                   co.v === "memory" || co.s === "Foundry" ? "Fab capex cycles drive margin volatility" : "Typical asset-light model"}
                </div>
              </div>
            </div>
          </div>

          {/* Cash runway for unprofitable */}
	          {latestRatio?.runwayQtrs != null && (
	            <div style={STYLE_SECTION}>
	              <div style={STYLE_LABEL}>Cash runway</div>
	              <div style={{ background: latestRatio.runwayQtrs < 4 ? "rgba(196,64,64,.04)" : latestRatio.runwayQtrs < 8 ? "rgba(184,134,11,.04)" : "rgba(26,138,92,.04)",
	                border: "1px solid " + (latestRatio.runwayQtrs < 4 ? "rgba(196,64,64,.15)" : latestRatio.runwayQtrs < 8 ? "rgba(184,134,11,.15)" : "rgba(26,138,92,.15)"),
	                borderRadius: RADII.sm, padding: sp("8px 12px"), display: "flex", alignItems: "center", gap: 10 }}>
	                <div>
	                  <div style={{ fontSize: fs(20), fontWeight: FONT_WEIGHTS.regular, color: latestRatio.runwayQtrs < 4 ? T.red : latestRatio.runwayQtrs < 8 ? T.amber : T.green }}>
	                    {latestRatio.runwayQtrs}<span style={{ fontSize: fs(11), marginLeft: sp(3) }}>quarters</span>
	                  </div>
	                  <div style={{ fontSize: fs(10), color: T.textDim }}>Implied runway at current burn rate</div>
	                </div>
	                <div style={{ fontSize: fs(11), color: T.textSec, flex: 1 }}>
	                  {latestRatio.runwayQtrs < 4 ? "Short runway — capital raise or profitability inflection needed near-term." :
	                   latestRatio.runwayQtrs < 8 ? "Manageable runway but dilution risk over medium-term if burn continues." :
	                   "Comfortable runway supports operational execution through the cycle."}
	                </div>
	              </div>
            </div>
          )}
    </>
  );
}

function Detail({ co, onClose, onSelect, liveData = {}, liveHist = {}, apiKey, onJumpToTrade }) {
  const { preferences: userPreferences } = useUserPreferences();
  const [scenarioAdj, setScenarioAdj] = useState(null);
  const [detailTab, setDetailTab] = useState("overview");
  const [focalFund, setFocalFund] = useState(null); // live TTM fundamentals for focal co
  const [focalFinancials, setFocalFinancials] = useState(null);
  const [copyStatus, setCopyStatus] = useState(null); // null | "copied" | "error"
  if (!co) return null;
  const vc = VX[co.v];
  const live = liveData[co.t];
  const price = resolveResearchPrice(co, live);
  const dailyChg = isFiniteNumber(live?.change) ? live.change : null;
  const dailyPct = isFiniteNumber(live?.changePct) ? live.changePct : null;
  const dayLow = isFiniteNumber(live?.dayLow) ? live.dayLow : null;
  const dayHigh = isFiniteNumber(live?.dayHigh) ? live.dayHigh : null;
  const wkLow = isFiniteNumber(live?.yearLow) ? live.yearLow : null;
  const wkHigh = isFiniteNumber(live?.yearHigh) ? live.yearHigh : null;
  const bid = isFiniteNumber(live?.bid) ? live.bid : null;
  const ask = isFiniteNumber(live?.ask) ? live.ask : null;

  // Lazy fetch live TTM fundamentals for focal company on mount / co change.
  // Results get used in both the Overview key-stats grid and the PeerTable.
  useEffect(() => {
    setFocalFund(null);
    if (!apiKey) return;
    const shares = liveData[co.t]?.sharesOut;
    fetchFund(co.t, apiKey, shares).then(data => setFocalFund(data));
  }, [co.t, apiKey]);

  useEffect(() => {
    let cancelled = false;
    setFocalFinancials(null);
    fetchFinancials(co.t).then((data) => {
      if (!cancelled) {
        setFocalFinancials(data);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [co.t]);

  const sup = EDGES.filter(([, t]) => t === co.t).map(([s, l]) => ({ t: s, l }));
  const cust = EDGES.filter(([s]) => s === co.t).map(([, t, l]) => ({ t, l }));

  const fd = useMemo(() => {
    const base = focalFinancials || genFinancials(co);
    const latestMarketCap = isFiniteNumber(live?.mc) ? live.mc : (isFiniteNumber(co?.mc) ? co.mc : null);
    const latestCashFlow = getLatestSeriesEntry(base?.cfData || []);
    const latestRatio = getLatestSeriesEntry(base?.ratiosData || []);

    if (
      !base ||
      !latestRatio ||
      latestRatio.fcfYield != null ||
      latestCashFlow?.fcf == null ||
      latestMarketCap == null ||
      latestMarketCap <= 0
    ) {
      return base;
    }

    const ratiosData = base.ratiosData.map((entry, index) =>
      index === base.ratiosData.length - 1
        ? { ...entry, fcfYield: +((latestCashFlow.fcf / latestMarketCap) * 100).toFixed(1) }
        : entry,
    );

    return { ...base, ratiosData };
  }, [co, focalFinancials, live?.mc]);
  return (
    <div style={{ background: T.bg1, borderRadius: RADII.lg, border: "1px solid rgba(0,0,0,.06)", overflow: "hidden", animation: "slideUp 0.3s ease", boxShadow: "0 4px 16px rgba(0,0,0,.06), 0 1px 3px rgba(0,0,0,.04)" }}>
      {/* ── HEADER ── */}
      <div style={{ padding: sp("12px 16px 10px"), background: "linear-gradient(to bottom, rgba(0,0,0,.01), transparent)", borderBottom: "1px solid rgba(0,0,0,.05)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: fs(11), color: T.textDim }}>{vc.n} &middot; {co.s}</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: sp(3) }}>
              <Logo ticker={co.t} size={22} style={{ marginRight: sp(6) }} /><span style={{ fontSize: fs(22), color: T.text }}>{co.cc} {co.t}</span>
              <span style={{ fontSize: fs(13), color: T.textDim }}>{co.nm}</span>
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: sp(4) }}>
              <span style={{ fontSize: fs(20), fontWeight: FONT_WEIGHTS.regular, color: T.text }}>{fmtPrice(price)}</span>
              <span style={{ fontSize: fs(12), color: isFiniteNumber(dailyChg) && dailyChg >= 0 ? T.green : T.red }}>
                {isFiniteNumber(dailyChg) && isFiniteNumber(dailyPct)
                  ? `${dailyChg >= 0 ? "+" : ""}${dailyChg.toFixed(2)} (${dailyPct >= 0 ? "+" : ""}${dailyPct.toFixed(2)}%)`
                  : "—"}
              </span>
            </div>
            {(bid != null || ask != null) ? (
              <div style={{ fontSize: fs(10), color: T.textMuted, marginTop: sp(2) }}>
                {bid != null ? `Bid ${bid.toFixed(2)}` : "Bid —"} &nbsp;&middot;&nbsp; {ask != null ? `Ask ${ask.toFixed(2)}` : "Ask —"}
              </div>
            ) : null}
          </div>

          {/* Export actions */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
            <AppTooltip content="Open this symbol on the Trade tab"><button
              onClick={() => onJumpToTrade && onJumpToTrade(co.t)}
              style={{
                background: T.bg1,
                border: "1px solid rgba(0,0,0,.08)",
                borderRadius: RADII.sm,
                padding: sp("4px 10px"),
                fontSize: fs(11),
                fontWeight: FONT_WEIGHTS.regular,
                color: T.text,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
              }}
            >
              <span>↗</span>
              <span>Open in Trade</span>
            </button></AppTooltip>
            <AppTooltip content="Copy this company as memo-ready markdown"><button
              onClick={() => {
                const md = companyToMarkdown(co, { live, focalFund, fd, price, dailyPct, wkLow, wkHigh });
                if (navigator.clipboard && navigator.clipboard.writeText) {
                  navigator.clipboard.writeText(md).then(
                    () => { setCopyStatus("copied"); setTimeout(() => setCopyStatus(null), 2000); },
                    () => { setCopyStatus("error"); setTimeout(() => setCopyStatus(null), 2000); }
                  );
                } else {
                  // Fallback: temporary textarea
                  try {
                    const ta = document.createElement("textarea");
                    ta.value = md;
                    ta.style.position = "fixed";
                    ta.style.top = "-9999px";
                    document.body.appendChild(ta);
                    ta.select();
                    document.execCommand("copy");
                    document.body.removeChild(ta);
                    setCopyStatus("copied");
                    setTimeout(() => setCopyStatus(null), 2000);
                  } catch(e) {
                    setCopyStatus("error");
                    setTimeout(() => setCopyStatus(null), 2000);
                  }
                }
              }}
              style={{
                background: copyStatus === "copied" ? "rgba(26,138,92,.12)" : copyStatus === "error" ? "rgba(196,64,64,.12)" : T.bg1,
                border: `1px solid ${copyStatus === "copied" ? "rgba(26,138,92,.35)" : copyStatus === "error" ? "rgba(196,64,64,.35)" : "rgba(0,0,0,.08)"}`,
                borderRadius: RADII.sm, padding: sp("4px 10px"),
                fontSize: fs(11), fontWeight: FONT_WEIGHTS.regular,
                color: copyStatus === "copied" ? T.green : copyStatus === "error" ? T.red : T.textSec,
                cursor: "pointer",
                display: "inline-flex", alignItems: "center", gap: 5,
                transition: "all .2s ease",
              }}
            >
              {copyStatus === "copied" ? (
                <><span>✓</span><span>Copied markdown</span></>
              ) : copyStatus === "error" ? (
                <><span>✕</span><span>Copy failed</span></>
              ) : (
                <><span>📋</span><span>Copy as Markdown</span></>
              )}
            </button></AppTooltip>
          </div>

        </div>
      </div>

      <div style={{ padding: sp("10px 14px 14px"), maxHeight: "70vh", overflowY: "auto" }}>
        {/* ── TAB BAR ── */}
        <div style={{ display: "flex", gap: 0, borderBottom: "1px solid rgba(0,0,0,.06)", marginBottom: sp(10), marginTop: -2 }}>
          {[["overview", "Overview"], ["business", "Business"], ["financials", "Financials"], ["valuation", "Valuation"], ["filings", "📄 Filings"]].map(([id, lb]) => (
            <button key={id} onClick={() => setDetailTab(id)} style={{
              background: "none", border: "none",
              borderBottom: detailTab === id ? "2px solid " + vc.c : "2px solid transparent",
              padding: sp("6px 14px"), color: detailTab === id ? vc.c : T.textDim,
              fontSize: fs(11), fontWeight: FONT_WEIGHTS.regular, cursor: "pointer", letterSpacing: 0.3,
            }}>{lb}</button>
          ))}
        </div>

        {detailTab === "overview" && <OverviewTab co={co} vc={vc} price={price} apiKey={apiKey} wkLow={wkLow} wkHigh={wkHigh} live={live} focalFund={focalFund} dayLow={dayLow} dayHigh={dayHigh} sup={sup} cust={cust} fd={fd} onSelect={onSelect} />}

        {/* ╔══════════════════════ BUSINESS TAB ══════════════════════╗ */}
        {detailTab === "business" && <BusinessTab co={co} vc={vc} live={live} sup={sup} cust={cust} onSelect={onSelect} liveData={liveData} liveHist={liveHist} apiKey={apiKey} />}

        {/* ╔══════════════════════ FINANCIALS TAB ══════════════════════╗ */}
        {detailTab === "financials" && <DetailFinancialsTab co={co} vc={vc} fd={fd} scenarioAdj={scenarioAdj} />}

	        {/* ╔══════════════════════ VALUATION TAB ══════════════════════╗ */}
	        {detailTab === "valuation" && <>
	          <ValuationTab co={co} color={vc.c} fd={fd} live={live} scenarioAdj={scenarioAdj} onScenarioChange={setScenarioAdj} />
	        </>}

        {detailTab === "filings" && <FilingsTab co={co} apiKey={apiKey} />}

        {/* ── BACK TO GRAPH (always visible) ── */}
        <div style={{ borderTop: "1px solid rgba(0,0,0,.06)", marginTop: sp(16), paddingTop: sp(12), textAlign: "center" }}>
          <button onClick={onClose} style={{
            background: T.bg1, border: "1px solid rgba(0,0,0,.08)", borderRadius: RADII.md,
            padding: sp("6px 20px"), boxShadow: "0 1px 3px rgba(0,0,0,.04)", color: T.textDim, fontSize: fs(10), cursor: "pointer", fontWeight: FONT_WEIGHTS.regular,
          }}>Back to graph</button>
        </div>
      </div>
    </div>
  );
}

/* ═════════════════ VALUE STREAM SANKEY ═════════════════ */
// Extracted from MarketSummary Row 6 — the largest sub-block in the dashboard.
// Owns its own sankeyExp (focused flow) + sankeyHover state.
function ValueStreamSankey({ theme, onSelect, liveData = {} }) {
  const [sankeyExp, setSankeyExp] = useState(null);
  const [sankeyHover, setSankeyHover] = useState(null);
  return (
    <>
      {/* ═══ ROW 6: VALUE STREAM ═══ */}
      <div style={{ marginBottom: sp(14) }}>
        <div style={STYLE_LABEL_DIM}>Value stream — hover to preview, click to explore</div>
        <div style={{ ...STYLE_CARD, padding: sp("6px 2px"), overflowX: "auto" }}>
          {(() => {
            const focused = sankeyExp;
            const setFocused = setSankeyExp;
            const hoverTicker = sankeyHover, setHoverTicker = setSankeyHover;

            const stages = theme?.sankey || AI_SANKEY_STAGES;

            const groupMap = {}, edgeCountCache = {};
            stages.forEach(st => st.groups.forEach(g => {
              g.rev = g.tickers.reduce((a, t) => a + (COMPANIES.find(c => c.t === t)?.r || 0), 0);
              g.tickers.forEach(t => { if (!groupMap[t]) groupMap[t] = g.id; });
            }));
            // Initial revenue-sort; will be re-sorted by destination barycenter after positions settle
            EDGES.forEach(([s]) => { edgeCountCache[s] = (edgeCountCache[s] || 0) + 1; });

            // Build company flows, aggregating duplicate edges and filtering backward flows
            const stageOf = {};
            stages.forEach((st, si) => st.groups.forEach(g => { stageOf[g.id] = si; }));
            const cfMap = {};
            EDGES.forEach(([s, t]) => {
              const sg = groupMap[s], tg = groupMap[t];
              if (sg && tg && sg !== tg && stageOf[tg] > stageOf[sg]) { // forward only
                const rev = COMPANIES.find(c => c.t === s)?.r || 100;
                const srcGrp = stages.flatMap(st => st.groups).find(g => g.tickers.includes(s));
                const k = s + ">" + sg + ">" + tg;
                const v = Math.max(80, Math.round(rev / (edgeCountCache[s] || 1)));
                if (!cfMap[k]) cfMap[k] = { from: sg, to: tg, ticker: s, value: 0, color: srcGrp?.bc || T.textDim };
                cfMap[k].value += v;
              }
            });
            const companyFlows = Object.values(cfMap);

            const pairMap = {};
            companyFlows.forEach(f => {
              const key = f.from + ">" + f.to;
              if (!pairMap[key]) pairMap[key] = { from: f.from, to: f.to, cos: {}, total: 0 };
              if (!pairMap[key].cos[f.ticker]) pairMap[key].cos[f.ticker] = { value: 0, color: f.color };
              pairMap[key].cos[f.ticker].value += f.value;
              pairMap[key].total += f.value;
            });
            const groupFlows = Object.values(pairMap).filter(f => f.total > 0);

            // Expanded layout - more vertical space
            const W = 840, H = 680, nodeW = 20;
            const colX = [10, 138, 266, 394, 522, 650, 778];
            const allGroups = stages.flatMap(s => s.groups);
            const maxRev = Math.max(...allGroups.map(g => g.rev), 1);
            const scaleH = (rev) => Math.max(12, Math.pow(rev / maxRev, 0.28) * 130);

            // Initial positions - center vertically
            const TOP_PAD = 34; // space for stage headers
            const BOT_PAD = 14; // bottom padding
            // Express lane constants - bisects the diagram horizontally
            const LANE_CENTER = H / 2;
            const LANE_HEIGHT = 140; // wide lane, no visible boundary
            const LANE_TOP = LANE_CENTER - LANE_HEIGHT / 2;
            const LANE_BOTTOM = LANE_CENTER + LANE_HEIGHT / 2;
            const ABOVE_ZONE_BOTTOM = LANE_TOP - 4; // small gap above lane
            const BELOW_ZONE_TOP = LANE_BOTTOM + 4;  // small gap below lane
            // Initial positions - side-aware (above/below zones with lane in middle)
            stages.forEach((st, si) => {
              st.groups.forEach(g => { g.h = scaleH(g.rev); g.cx = colX[si]; g.srcOff = 0; g.dstOff = 0; });
              const above = st.groups.filter(g => g.side === "above");
              const below = st.groups.filter(g => g.side === "below");
              const aboveTotalH = above.reduce((a, g) => a + g.h + 10, -10);
              const aboveZoneH = ABOVE_ZONE_BOTTOM - TOP_PAD;
              let y = TOP_PAD + Math.max(0, (aboveZoneH - aboveTotalH) / 2);
              above.forEach(g => { g.y = y; y += g.h + 10; });
              const belowTotalH = below.reduce((a, g) => a + g.h + 10, -10);
              const belowZoneH = (H - BOT_PAD) - BELOW_ZONE_TOP;
              y = BELOW_ZONE_TOP + Math.max(0, (belowZoneH - belowTotalH) / 2);
              below.forEach(g => { g.y = y; y += g.h + 10; });
            });

            // Exhaustive crossing minimization - try all column orderings
            const applyOrder = (stage) => {
              const above = stage.groups.filter(g => g.side === "above");
              const below = stage.groups.filter(g => g.side === "below");
              const aboveTotalH = above.reduce((a, g) => a + g.h + 10, -10);
              const aboveZoneH = ABOVE_ZONE_BOTTOM - TOP_PAD;
              let y = TOP_PAD + Math.max(0, (aboveZoneH - aboveTotalH) / 2);
              above.forEach(g => { g.y = y; y += g.h + 10; });
              const belowTotalH = below.reduce((a, g) => a + g.h + 10, -10);
              const belowZoneH = (H - BOT_PAD) - BELOW_ZONE_TOP;
              y = BELOW_ZONE_TOP + Math.max(0, (belowZoneH - belowTotalH) / 2);
              below.forEach(g => { g.y = y; y += g.h + 10; });
            };

            // Count weighted crossings in the entire diagram
            const countCrossings = () => {
              let crossings = 0;
              for (let i = 0; i < groupFlows.length; i++) {
                for (let j = i + 1; j < groupFlows.length; j++) {
                  const a = groupFlows[i], b = groupFlows[j];
                  const sA = allGroups.find(g => g.id === a.from);
                  const sB = allGroups.find(g => g.id === b.from);
                  const dA = allGroups.find(g => g.id === a.to);
                  const dB = allGroups.find(g => g.id === b.to);
                  if (!sA || !sB || !dA || !dB) continue;
                  // Two flows cross if their sources are in same column
                  // and destinations in same column, with opposite orderings
                  if (sA.cx !== sB.cx || dA.cx !== dB.cx) continue;
                  if (sA.cx === dA.cx) continue; // no crossing possible if same column
                  const syA = sA.y, syB = sB.y, dyA = dA.y, dyB = dB.y;
                  if ((syA < syB && dyA > dyB) || (syA > syB && dyA < dyB)) {
                    crossings += Math.sqrt(a.total * b.total);
                  }
                }
              }
              return crossings;
            };

            // Permutation helper
            const permute = (arr) => {
              if (arr.length <= 1) return [arr.slice()];
              const result = [];
              for (let i = 0; i < arr.length; i++) {
                const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
                for (const p of permute(rest)) result.push([arr[i], ...p]);
              }
              return result;
            };

            // Exhaustive search per (column, side) - permute only within each side
            for (let pass = 0; pass < 3; pass++) {
              let improved = false;
              for (let si = 0; si < stages.length; si++) {
                const st = stages[si];
                ["above", "below"].forEach(side => {
                  const sideGroups = st.groups.filter(g => g.side === side);
                  const otherGroups = st.groups.filter(g => g.side !== side);
                  if (sideGroups.length <= 1) return;
                  let bestSide = sideGroups.slice();
                  let bestCrossings = countCrossings();
                  for (const perm of permute(sideGroups)) {
                    // Reassemble st.groups keeping other-side order intact
                    st.groups = [...otherGroups, ...perm];
                    applyOrder(st);
                    const c2 = countCrossings();
                    if (c2 < bestCrossings) { bestCrossings = c2; bestSide = perm.slice(); improved = true; }
                  }
                  st.groups = [...otherGroups, ...bestSide];
                  applyOrder(st);
                });
              }
              if (!improved) break;
            }

            // Express highway is a fixed horizontal band at LANE_TOP..LANE_BOTTOM
            // Individual flow "lanes" are allocated within this band

            // Re-sort tickers within each group by destination barycenter for cleaner fan-out
            // Each ticker's vertical position in its group matches its outflow's center of gravity
            allGroups.forEach(g => {
              const bcMap = {};
              g.tickers.forEach(t => {
                const outs = companyFlows.filter(f => f.ticker === t);
                let wy = 0, wt = 0;
                outs.forEach(f => {
                  const dg = allGroups.find(gg => gg.id === f.to);
                  if (dg) { wy += (dg.y + dg.h/2) * f.value; wt += f.value; }
                });
                bcMap[t] = wt > 0 ? wy/wt : (COMPANIES.find(c => c.t === t)?.r || 0) * -1; // revenue desc as fallback
              });
              g.tickers = g.tickers.slice().sort((a, b) => bcMap[a] - bcMap[b]);
            });

            // COMPANY-PRIORITY LAYOUT: each company has a fixed slice in its source node.
            // All outflows from that company exit from that slice. Lanes stay together.

            // Step 1: Compute per-company outflows (value × count) and per-company inflows
            const coOutflow = {}; // ticker → total outgoing value
            const coInflow = {};  // ticker → total incoming value (for destination grouping)
            companyFlows.forEach(f => {
              coOutflow[f.ticker] = (coOutflow[f.ticker] || 0) + f.value;
            });

            // Step 2: Allocate each company a vertical slice within its group's node
            // based on outflow share. Slices are ordered by ticker index (stable).
            // Store company slice positions (source side = outflow, dest side = inflow)
            const coSrcY = {}; // ticker → y position at source node (top of slice)
            const coSrcH = {}; // ticker → height of source slice
            allGroups.forEach(g => {
              const gOutflow = g.tickers.reduce((a, t) => a + (coOutflow[t] || 0), 0);
              if (gOutflow === 0) return;
              // Order companies by ticker position (stable, consistent)
              const ordered = g.tickers.filter(t => coOutflow[t] > 0);
              let y = g.y;
              ordered.forEach(t => {
                const h = (coOutflow[t] / gOutflow) * g.h;
                coSrcY[t] = y;
                coSrcH[t] = h;
                y += h;
              });
            });

            // Step 3: For incoming flows at destination groups, accumulate per (source-group, ticker)
            // Position: each group inflow is positioned by source-group Y, and within a source-group
            // by ticker order.
            // Sort inflow allocation: first by source group y, then by ticker index within source
            const dstSlices = {}; // groupId → list of {ticker, fromGroup, height, y}
            allGroups.forEach(g => { dstSlices[g.id] = []; });

            // Total incoming per destination group
            groupFlows.forEach(gf => {
              const srcGrp = allGroups.find(g => g.id === gf.from);
              if (!srcGrp) return;
              const ordered = srcGrp.tickers.filter(t => gf.cos[t]);
              ordered.forEach(t => {
                dstSlices[gf.to].push({
                  ticker: t, fromGroup: gf.from,
                  srcY: srcGrp.y, srcIdx: srcGrp.tickers.indexOf(t),
                  value: gf.cos[t].value,
                });
              });
            });

            // Sort destination slices by source group Y, then ticker index (stable)
            Object.keys(dstSlices).forEach(gid => {
              dstSlices[gid].sort((a, b) => a.srcY - b.srcY || a.srcIdx - b.srcIdx);
            });

            // Allocate destination Y positions
            const flowDstY = {}; // "ticker>fromGroup>toGroup" → {y, h} at destination
            allGroups.forEach(g => {
              const slices = dstSlices[g.id];
              const totalInflow = slices.reduce((a, s) => a + s.value, 0);
              if (totalInflow === 0) return;
              let y = g.y;
              slices.forEach(s => {
                const h = (s.value / totalInflow) * g.h;
                flowDstY[s.ticker + ">" + s.fromGroup + ">" + g.id] = { y, h };
                y += h;
              });
            });

            // Step 4: For source slices, sub-divide each company's slice by destination order
            // Each company's outgoing flows are stacked within its slice, ordered by destination Y
            const flowSrcY = {}; // "ticker>fromGroup>toGroup" → {y, h} at source
            allGroups.forEach(g => {
              g.tickers.forEach(t => {
                if (!coOutflow[t]) return;
                // Get all outflows from this company
                const outs = companyFlows.filter(f => f.ticker === t && f.from === g.id);
                // Sort by destination Y
                outs.sort((a, b) => {
                  const dA = allGroups.find(gg => gg.id === a.to);
                  const dB = allGroups.find(gg => gg.id === b.to);
                  return (dA?.y || 0) - (dB?.y || 0);
                });
                let y = coSrcY[t];
                outs.forEach(f => {
                  const h = (f.value / coOutflow[t]) * coSrcH[t];
                  flowSrcY[t + ">" + f.from + ">" + f.to] = { y, h };
                  y += h;
                });
              });
            });

            // Step 5: Build ribbons - lane is only for CROSS-SIDE flows (those that actually need to traverse the middle)
            const allRibbons = [];

            // Classify: lane flows cross the middle (src.side !== dst.side). Same-side flows, even if long,
            // use natural curves and stay in their own zone (no unnecessary detour through middle).
            const laneFlows = [];
            const normalFlows = [];
            companyFlows.forEach(f => {
              const sg = allGroups.find(g => g.id === f.from);
              const dg = allGroups.find(g => g.id === f.to);
              if (!sg || !dg) return;
              const gap = stageOf[f.to] - stageOf[f.from];
              if (sg.side !== dg.side && gap >= 2) laneFlows.push(f);
              else normalFlows.push(f);
            });

            // Sort lane flows for clean stacking: by direction (up/down), then source x, then source y
            laneFlows.sort((a, b) => {
              const sa = allGroups.find(g => g.id === a.from);
              const sb = allGroups.find(g => g.id === b.from);
              const da = allGroups.find(g => g.id === a.to);
              const db = allGroups.find(g => g.id === b.to);
              // Flows going down (above→below) stack first; then up (below→above)
              const dirA = sa.side === "above" ? 0 : 1;
              const dirB = sb.side === "above" ? 0 : 1;
              if (dirA !== dirB) return dirA - dirB;
              return (sa.cx - sb.cx) || (sa.y - sb.y) || (da.cx - db.cx) || (da.y - db.y);
            });

            // Allocate lane y-positions within the wide invisible band
            const LANE_INNER_PAD = 2;
            const LANE_USABLE_H = LANE_HEIGHT - 2 * LANE_INNER_PAD;
            const totalLaneH = laneFlows.reduce((sum, f) => {
              const srcPos = flowSrcY[f.ticker + ">" + f.from + ">" + f.to];
              return sum + (srcPos?.h || 1);
            }, 0);
            const laneScale = totalLaneH > LANE_USABLE_H ? LANE_USABLE_H / totalLaneH : 1;
            let laneOffset = LANE_TOP + LANE_INNER_PAD + Math.max(0, (LANE_USABLE_H - totalLaneH * laneScale) / 2);
            const laneYMap = {};
            laneFlows.forEach(f => {
              const srcPos = flowSrcY[f.ticker + ">" + f.from + ">" + f.to];
              const scaledH = Math.max(1.5, (srcPos?.h || 1) * laneScale);
              const key = f.ticker + ">" + f.from + ">" + f.to;
              laneYMap[key] = { y: laneOffset, h: scaledH };
              laneOffset += scaledH + 0.5;
            });

            // Build ribbons
            companyFlows.forEach(f => {
              const src = allGroups.find(g => g.id === f.from);
              const dst = allGroups.find(g => g.id === f.to);
              if (!src || !dst) return;
              const key = f.ticker + ">" + f.from + ">" + f.to;
              const srcPos = flowSrcY[key];
              const dstPos = flowDstY[key];
              if (!srcPos || !dstPos) return;
              const sY = srcPos.y, bH = srcPos.h, dY = dstPos.y, dH = dstPos.h;
              const sx = src.cx + nodeW, dx = dst.cx, gap = dx - sx;
              const lanePos = laneYMap[key]; // null if not a lane flow
              const isLane = !!lanePos;
              let d;

              if (isLane) {
                // Cross-side flow: two smooth cubics meeting at the lane waypoint.
                // Control points are placed so the tangents at the join are horizontal,
                // making the join invisibly smooth. No rigid L segment.
                const laneY = lanePos.y, laneH = lanePos.h;
                const midX = sx + gap * 0.5;
                const f1 = 0.45; // control point fraction
                // Top edge: source → (midX, laneY) → destination
                // Bottom edge: source+bH → (midX, laneY+laneH) → destination+dH
                d = `M${sx},${sY}
                     C${sx+gap*f1},${sY} ${sx+gap*f1},${laneY} ${midX},${laneY}
                     C${dx-gap*f1},${laneY} ${dx-gap*f1},${dY} ${dx},${dY}
                     L${dx},${dY+dH}
                     C${dx-gap*f1},${dY+dH} ${dx-gap*f1},${laneY+laneH} ${midX},${laneY+laneH}
                     C${sx+gap*f1},${laneY+laneH} ${sx+gap*f1},${sY+bH} ${sx},${sY+bH} Z`;
              } else if (Math.abs(gap) < 15) {
                d = `M${sx},${sY} C${sx+40},${sY} ${sx+40},${dY} ${dx},${dY} L${dx},${dY+dH} C${sx+40},${dY+dH} ${sx+40},${sY+bH} ${sx},${sY+bH} Z`;
              } else if (gap < 0) {
                const ag = Math.abs(gap);
                d = `M${sx},${sY} C${sx-ag*0.3},${sY} ${dx+ag*0.3},${dY} ${dx},${dY} L${dx},${dY+dH} C${dx+ag*0.3},${dY+dH} ${sx-ag*0.3},${sY+bH} ${sx},${sY+bH} Z`;
              } else {
                // Natural bezier — works for short AND long same-side flows.
                // Slightly looser curvature for long flows to avoid pinching.
                const cv = gap > 400 ? 0.32 : gap > 250 ? 0.36 : gap > 150 ? 0.40 : 0.42;
                d = `M${sx},${sY} C${sx+gap*cv},${sY} ${dx-gap*cv},${dY} ${dx},${dY} L${dx},${dY+dH} C${dx-gap*cv},${dY+dH} ${sx+gap*cv},${sY+bH} ${sx},${sY+bH} Z`;
              }
              allRibbons.push({ d, color: f.color, ticker: f.ticker, from: f.from, to: f.to, value: f.value, bH, midX: (sx+dx)/2, midY: isLane ? LANE_CENTER : (sY+dY)/2, isExpress: isLane });
            });

            // State
            const isGrpMode = focused && focused.startsWith("g:");
            const focGrpId = isGrpMode ? focused.slice(2) : null;
            const focGrp = focGrpId ? allGroups.find(g => g.id === focGrpId) : null;
            const active = (isGrpMode ? null : focused) || hoverTicker;
            const activeCo = active ? COMPANIES.find(c => c.t === active) : null;
            const activeBrand = active ? (BRAND[active] || [T.textDim])[0] : null;
            const anyFocus = active || focGrpId;

            // Total rev per stage for percentage calc
            const stageRevs = stages.map(st => st.groups.reduce((a, g) => a + g.rev, 0));

            return (
              <div style={{ position: "relative" }}>
                {(focused || focGrpId) && (
                  <button onClick={() => { setFocused(null); setHoverTicker(null); }} style={{
                    position: "absolute", top: 4, right: 6, zIndex: 5, background: T.bg1,
                    border: "1px solid rgba(0,0,0,.1)", borderRadius: RADII.sm, padding: sp("3px 10px"),
                    fontSize: fs(10), color: T.textSec, cursor: "pointer",
                    boxShadow: "0 2px 8px rgba(0,0,0,.08)", fontWeight: FONT_WEIGHTS.regular,
                  }}>✕ Back</button>
                )}

                <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block", minWidth: 540 }}
                  onClick={() => { setFocused(null); setHoverTicker(null); }}>
                  <defs>
                    <filter id="nodeShadow" x="-50%" y="-50%" width="200%" height="200%">
                      <feDropShadow dx="0" dy="1" stdDeviation="1.5" floodOpacity="0.15" />
                    </filter>
                  </defs>

                  {/* Ribbons */}
                  {allRibbons.map((r, i) => {
                    const isAct = active && r.ticker === active;
                    const isGrpHit = focGrpId && (r.from === focGrpId || r.to === focGrpId);
                    const lit = isAct || isGrpHit;
                    const op = anyFocus ? (lit ? 0.6 : 0.02) : Math.min(0.45, 0.22 + r.bH * 0.016);
                    return (
                      <path key={i} d={r.d} fill={r.color} fillOpacity={op}
                        stroke={r.color} strokeWidth={lit ? 0.8 : 0} strokeOpacity={0.3}
                        style={{ cursor: "pointer", transition: "fill-opacity 0.3s ease" }}
                        onMouseEnter={() => { if (!focused && !focGrpId) setHoverTicker(r.ticker); }}
                        onMouseLeave={() => { if (!focused) setHoverTicker(null); }}
                        onClick={e => { e.stopPropagation(); setFocused(focused === r.ticker ? null : r.ticker); }}>
                        <title>{r.ticker}: {allGroups.find(g=>g.id===r.from)?.label} → {allGroups.find(g=>g.id===r.to)?.label} — {fmtMC(r.value)}</title>
                      </path>
                    );
                  })}

                  {/* Solid node bars + labels */}
                  {allGroups.map(g => {
                    const gHasActive = active && g.tickers.includes(active);
                    const isGrpFocus = focGrpId === g.id;
                    const stageIdx = stages.findIndex(st => st.groups.some(gg => gg.id === g.id));
                    const stageTotal = stageRevs[stageIdx] || 1;
                    const pct = (g.rev / stageTotal * 100).toFixed(0);
                    const dimmed = anyFocus && !gHasActive && !isGrpFocus;
                    return (
                      <g key={g.id} style={{ cursor: "pointer" }}
                        onClick={e => { e.stopPropagation(); setFocused(isGrpFocus ? null : "g:" + g.id); }}>
                        {/* Solid colored bar */}
                        <rect x={g.cx} y={g.y} width={nodeW} height={g.h} rx={3}
                          filter={dimmed ? "none" : "url(#nodeShadow)"}
                          fill={g.bc} fillOpacity={dimmed ? 0.15 : 0.92}
                          stroke={isGrpFocus ? T.text : gHasActive ? activeBrand : "rgba(0,0,0,.08)"}
                          strokeWidth={isGrpFocus || gHasActive ? 1.5 : 0.5}
                          style={{ transition: "fill-opacity 0.3s ease" }} />
                        {/* Two-line external label with percentage */}
                        {(() => {
                          const isRight = stageIdx < 6;
                          const lx = isRight ? g.cx + nodeW + 7 : g.cx - 7;
                          const anchor = isRight ? "start" : "end";
                          return (
                            <g opacity={dimmed ? 0.15 : 1} style={{ transition: "opacity 0.3s ease", pointerEvents: "none" }}>
                              <text x={lx} y={g.y + g.h / 2 - 4} fontSize={fs(11)} textAnchor={anchor}
                                fontFamily={T.display} fill={T.text} fontWeight={FONT_WEIGHTS.regular}
                                dominantBaseline="middle">{g.label}</text>
                              <text x={lx} y={g.y + g.h / 2 + 9} fontSize={9.5} textAnchor={anchor}
                                fontFamily={T.display} dominantBaseline="middle">
                                <tspan fill={T.text} fontWeight={FONT_WEIGHTS.regular}>{pct}%</tspan>
                                <tspan fill={T.textDim}> · {fmtMC(g.rev)}</tspan>
                              </text>
                            </g>
                          );
                        })()}
                      </g>
                    );
                  })}

                  {/* Revenue labels on major flows */}
                  {!anyFocus && (() => {
                    const pt = {};
                    allRibbons.forEach(r => {
                      const k = r.from + ">" + r.to;
                      if (!pt[k]) pt[k] = { total: 0, mx: 0, my: 999, n: 0 };
                      pt[k].total += r.value; pt[k].mx += r.midX; pt[k].n++;
                      pt[k].my = Math.min(pt[k].my, r.midY);
                    });
                    return Object.values(pt).map(p => ({ ...p, mx: p.mx / p.n }))
                      .sort((a, b) => b.total - a.total).slice(0, 5)
                      .map((p, i) => (
                        <text key={"fl"+i} x={p.mx} y={p.my - 5} textAnchor="middle"
                          fontSize={fs(9)} fill={T.textMuted} fontWeight={FONT_WEIGHTS.regular} fontFamily={T.display}
                          style={{ pointerEvents: "none" }}>{fmtMC(p.total)}</text>
                      ));
                  })()}

                  {/* Stage headers at TOP - clean, uppercase, tracked */}
                  {stages.map((st, i) => {
                    const isRight = i === 6;
                    const isLeft = i === 0;
                    const cx = colX[i] + nodeW / 2;
                    const stageColor = st.groups[0]?.bc || T.textDim;
                    return (
                      <g key={"hdr"+i}>
                        {/* Subtle accent dot */}
                        <circle cx={cx} cy={14} r={2.5} fill={stageColor} fillOpacity={0.8} />
                        {/* Stage label */}
                        <text x={cx} y={27}
                          textAnchor={isLeft ? "start" : isRight ? "end" : "middle"}
                          fontSize={9.5} fill={T.textDim} fontWeight={FONT_WEIGHTS.regular}
                          fontFamily={T.display}
                          style={{ letterSpacing: "0.08em", textTransform: "uppercase" }}>
                          {isLeft ? (
                            <tspan x={colX[i]}>{st.label.toUpperCase()}</tspan>
                          ) : isRight ? (
                            <tspan x={colX[i] + nodeW}>{st.label.toUpperCase()}</tspan>
                          ) : st.label.toUpperCase()}
                        </text>
                      </g>
                    );
                  })}
                  {/* Thin divider line beneath stage headers */}
                  <line x1={4} x2={W - 4} y1={32} y2={32} stroke={T.border} strokeWidth={1} />
                </svg>

                {/* Hover tooltip */}
                {hoverTicker && !focused && (() => {
                  const co = COMPANIES.find(c => c.t === hoverTicker);
                  if (!co) return null;
                  const price = resolveResearchPrice(co, liveData[hoverTicker]);
                  const rr = allRibbons.filter(r => r.ticker === hoverTicker);
                  const ax = rr.length ? rr.reduce((a, r) => a + r.midX, 0) / rr.length : W / 2;
                  const ay = rr.length ? Math.min(...rr.map(r => r.midY)) : H / 2;
                  return (
                    <div style={{
                      position: "absolute", left: Math.min(Math.max(8, ax/W*100), 72)+"%",
                      top: Math.max(0, ay/H*100 - 8)+"%",
                      ...chartTooltipContentStyle,
                      border: "1px solid var(--ra-tooltip-border)",
                      padding: sp("5px 8px"), pointerEvents: "none",
                      display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap",
                    }}>
                      <Logo ticker={hoverTicker} size={20} />
                      <div>
                        <div style={{ fontSize: fs(11), fontWeight: FONT_WEIGHTS.regular, color: "var(--ra-tooltip-text)" }}>{co.cc} {hoverTicker}</div>
                        <div style={{ fontSize: fs(10), color: "var(--ra-tooltip-muted)" }}>{fmtPrice(price)} · {fmtMC(co.r)} rev</div>
                      </div>
                    </div>
                  );
                })()}

                {/* Group card */}
                {focGrp && (() => {
                  const gCos = focGrp.tickers.map(t => COMPANIES.find(co => co.t === t)).filter(Boolean).sort((a, b) => b.r - a.r);
                  const inT = groupFlows.filter(f => f.to === focGrpId).reduce((a, f) => a + f.total, 0);
                  const outT = groupFlows.filter(f => f.from === focGrpId).reduce((a, f) => a + f.total, 0);
                  return (
                    <div style={{ position: "absolute", bottom: 20, left: "50%", transform: "translateX(-50%)",
                      background: T.bg1, border: "1px solid rgba(0,0,0,.1)", borderRadius: RADII.md,
                      padding: sp("10px 14px"), minWidth: 320, maxWidth: 480,
                      boxShadow: "0 8px 32px rgba(0,0,0,.14)", zIndex: 10 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: sp(6), paddingBottom: sp(6), borderBottom: "2px solid " + focGrp.bc }}>
                        <span style={{ fontSize: fs(14), fontWeight: FONT_WEIGHTS.regular }}>{focGrp.label}</span>
                        <span style={{ fontSize: fs(12), color: T.textDim }}>{focGrp.tickers.length} cos · {fmtMC(focGrp.rev)}</span>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4, marginBottom: sp(6) }}>
                        {[["INFLOWS", inT], ["GROUP REV", focGrp.rev], ["OUTFLOWS", outT]].map(([l, v]) => (
                          <div key={l} style={{ textAlign: "center", padding: sp(3), background: "rgba(0,0,0,.015)", borderRadius: RADII.xs }}>
                            <div style={{ fontSize: fs(9), color: T.textMuted, fontWeight: FONT_WEIGHTS.regular }}>{l}</div>
                            <div style={{ fontSize: fs(12), fontWeight: FONT_WEIGHTS.regular }}>{fmtMC(v)}</div>
                          </div>
                        ))}
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 4 }}>
                        {gCos.map(co => {
                          const price = resolveResearchPrice(co, liveData[co.t]);
                          const pct = focGrp.rev > 0 ? (co.r / focGrp.rev * 100).toFixed(0) : 0;
                          return (
                            <div key={co.t} onClick={e => { e.stopPropagation(); setFocused(co.t); }}
                              style={{ display: "flex", alignItems: "center", gap: 4, padding: sp("4px 6px"), cursor: "pointer", borderRadius: RADII.sm, border: "1px solid rgba(0,0,0,.04)" }}
                              onMouseEnter={e => e.currentTarget.style.background = "rgba(0,0,0,.02)"}
                              onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                              <Logo ticker={co.t} size={18} />
                              <div>
                                <div style={{ fontSize: fs(11), fontWeight: FONT_WEIGHTS.regular }}>{co.t} <span style={{ fontWeight: FONT_WEIGHTS.regular, color: T.textDim, fontSize: fs(10) }}>{pct}%</span></div>
                                <div style={{ fontSize: fs(10), color: T.textDim }}>{fmtPrice(price)}</div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}

                {/* Company card */}
                {!isGrpMode && focused && activeCo && (() => {
                  const price = resolveResearchPrice(activeCo, liveData[focused]);
                  const vc = VX[activeCo.v];
                  const suppliers = EDGES.filter(([, t]) => t === focused).map(([s, l]) => ({ t: s, l }));
                  const customers = EDGES.filter(([s]) => s === focused).map(([, t, l]) => ({ t, l }));
                  return (
                    <div style={{ position: "absolute", bottom: 20, left: "50%", transform: "translateX(-50%)",
                      background: T.bg1, border: "1px solid rgba(0,0,0,.1)", borderRadius: RADII.md,
                      padding: sp("10px 14px"), minWidth: 320, maxWidth: 440,
                      boxShadow: "0 8px 32px rgba(0,0,0,.14)", zIndex: 10 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: sp(6) }}>
                        <Logo ticker={focused} size={28} />
                        <div>
                          <div style={{ fontSize: fs(14), fontWeight: FONT_WEIGHTS.regular }}>{activeCo.cc} {focused} <span style={{ fontWeight: FONT_WEIGHTS.regular, color: T.textDim, fontSize: fs(12) }}>{activeCo.nm}</span></div>
                          <div style={{ fontSize: fs(11), color: vc.c }}>{vc.n} · {activeCo.s}</div>
                        </div>
                        <div style={{ marginLeft: "auto", textAlign: "right" }}>
                          <div style={{ fontSize: fs(16), fontWeight: FONT_WEIGHTS.regular }}>{fmtPrice(price)}</div>
                          <div style={{ fontSize: fs(10), color: T.textDim }}>{fmtMC(activeCo.r)} rev</div>
                        </div>
                      </div>
                      <div style={{ fontSize: fs(11), color: T.textSec, lineHeight: 1.4, padding: sp("4px 0"), borderTop: "1px solid rgba(0,0,0,.05)", fontStyle: "italic" }}>{activeCo.pr}</div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 3, padding: sp("5px 0"), borderBottom: "1px solid rgba(0,0,0,.05)" }}>
                        {[["MC", fmtMC(activeCo.mc)], ["P/E", activeCo.pe ? activeCo.pe + "x" : "—"], ["GM", activeCo.g + "%"], ["Growth", (activeCo.fin?.rg?.[4] > 0 ? "+" : "") + (activeCo.fin?.rg?.[4] || 0) + "%"]].map(([l, v]) => (
                          <div key={l} style={{ textAlign: "center" }}>
                            <div style={{ fontSize: fs(9), color: T.textMuted, fontWeight: FONT_WEIGHTS.regular }}>{l}</div>
                            <div style={{ fontSize: fs(11), fontWeight: FONT_WEIGHTS.regular }}>{v}</div>
                          </div>
                        ))}
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: sp(4) }}>
                        {[["SUPPLIERS", suppliers], ["CUSTOMERS", customers]].map(([label, list]) => (
                          <div key={label}>
                            <div style={{ fontSize: fs(10), fontWeight: FONT_WEIGHTS.regular, color: T.textMuted, marginBottom: sp(2) }}>{label} ({list.length})</div>
                            {list.slice(0, 5).map(s => (
                              <div key={s.t + s.l} onClick={e => { e.stopPropagation(); setFocused(s.t); }}
                                style={{ fontSize: fs(10), color: T.textSec, padding: sp("2px 0"), cursor: "pointer", display: "flex", gap: 3, alignItems: "center" }}
                                onMouseEnter={e => e.currentTarget.style.background = "rgba(0,0,0,.03)"}
                                onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                                <Logo ticker={s.t} size={12} /><span style={{ fontWeight: FONT_WEIGHTS.regular }}>{s.t}</span><span style={{ color: T.textMuted, fontSize: fs(9) }}>{s.l}</span>
                              </div>
                            ))}
                            {list.length > 5 && <div style={{ fontSize: fs(9), color: T.textMuted }}>+{list.length - 5} more</div>}
                          </div>
                        ))}
                      </div>
                      <button onClick={e => { e.stopPropagation(); onSelect && onSelect(focused); setFocused(null); }}
                        style={{ marginTop: sp(8), width: "100%", background: vc.c, border: "none", borderRadius: RADII.sm, padding: sp("6px 0"),
                          color: T.onAccent, fontSize: fs(11), fontWeight: FONT_WEIGHTS.regular, cursor: "pointer" }}>
                        View full analysis →
                      </button>
                    </div>
                  );
                })()}
              </div>
            );
          })()}
        </div>
      </div>

    </>
  );
}

function MarketSummary({ onFilterVertical, onSelect, theme, liveData = {}, liveFund = {} }) {
  const lbl = { fontSize: fs(11), fontWeight: FONT_WEIGHTS.regular, color: T.textDim, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: sp(6) };
  const card = { background: T.bg1, border: "1px solid rgba(0,0,0,.06)", borderRadius: RADII.md, boxShadow: "0 1px 3px rgba(0,0,0,.03)" };

  const themeVerticals = theme?.verticals || AI_VERTICALS;
  const themeCos = COMPANIES.filter(c => themeMatchesCompany(theme || THEMES.ai, c));
  const macroAxes = theme?.macro || AI_MACRO;
  const primaryMacroKey = macroAxes[Math.min(2, macroAxes.length - 1)]?.k || "ai";
  const primaryMacroName = macroAxes[Math.min(2, macroAxes.length - 1)]?.n || "AI Capex";

  // Prefer live values from FMP quote/fund endpoints; fall back to authored
  const effMC = (c) => liveData[c.t]?.mc ?? c.mc;
  const effRev = (c) => liveFund[c.t]?.revenueTTM ?? c.r;
  const effGM = (c) => liveFund[c.t]?.grossMarginTTM ?? c.g;
  const effPE = (c) => liveData[c.t]?.pe ?? c.pe;

  const totalMC = themeCos.reduce((a, c) => a + effMC(c), 0);
  const totalRev = themeCos.reduce((a, c) => a + (effRev(c) || 0), 0);
  const profitable = themeCos.filter(c => effPE(c) != null && effPE(c) > 0);
  const medPE = profitable.length ? profitable.map(c => effPE(c)).sort((a, b) => a - b)[Math.floor(profitable.length / 2)] : 0;
  const avgMacro = themeCos.length ? (themeCos.reduce((a, c) => a + (c.ms?.[primaryMacroKey] || 0), 0) / themeCos.length * 100).toFixed(0) : 0;

  const verts = Object.entries(themeVerticals).map(([k, v]) => {
    const cs = themeCos.filter(c => resolveCompanyVertical(c, theme) === k);
    const mc = cs.reduce((a, c) => a + effMC(c), 0);
    const rev = cs.reduce((a, c) => a + (effRev(c) || 0), 0);
    const gm = cs.length ? +(cs.reduce((a, c) => a + (effGM(c) || 0), 0) / cs.length).toFixed(1) : 0;
    return { k, name: v.n, color: v.c, count: cs.length, mc, rev, gm, cos: cs };
  }).sort((a, b) => b.mc - a.mc);

  // Supply chain density
  const vKeys = Object.keys(VX);
  const density = {};
  vKeys.forEach(a => vKeys.forEach(b => { density[a + ">" + b] = 0; }));
  EDGES.forEach(([s, t]) => {
    const sv = COMPANIES.find(c => c.t === s)?.v;
    const tv = COMPANIES.find(c => c.t === t)?.v;
    if (sv && tv) density[sv + ">" + tv]++;
  });
  const maxD = Math.max(...Object.values(density), 1);

  // Scatter data
  const scatterData = COMPANIES.filter(c => effPE(c) != null && effPE(c) < 200).map(c => ({
    name: c.t,
    cc: c.cc,
    pe: effPE(c),
    growth: c.fin?.rg?.[4] || 0,
    mc: effMC(c),
    color: VX[c.v].c,
    v: VX[c.v].n,
  }));

  // Sorted companies for treemap
  const sorted = [...COMPANIES].sort((a, b) => effMC(b) - effMC(a));

  // Profitability data sorted
  const profData = [...verts].sort((a, b) => a.gm - b.gm);

  const mcDonut = verts.map(v => ({ name: v.name, value: v.mc, color: v.color, pct: (v.mc / totalMC * 100) }));
  const revDonut = verts.map(v => ({ name: v.name, value: v.rev, color: v.color, pct: (v.rev / totalRev * 100) }));

  return (
    <div style={{ marginTop: sp(12) }}>
      {/* ═══ ROW 1: HEADLINE METRICS ═══ */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, marginBottom: sp(14) }}>
        {[
          ["Total Market Cap", fmtMC(totalMC), T.text, T.green],
          ["Combined Revenue", fmtMC(totalRev), T.text, T.blue],
          ["Median P/E", medPE.toFixed(1) + "x", T.text, T.amber],
          ["Avg " + primaryMacroName, avgMacro + "%", T.amber, theme?.accent || T.accent],
        ].map(([label, value, color, accent]) => (
          <div key={label} style={{ ...card, padding: sp("7px 10px") }}>
            <div style={{ fontSize: fs(10), color: T.textDim, textTransform: "uppercase", letterSpacing: 1.2, marginBottom: sp(3) }}>{label}</div>
            <div style={{ fontSize: fs(18), fontWeight: FONT_WEIGHTS.regular, color }}>{value}</div>
            <div style={{ height: 2, borderRadius: 1, background: accent, opacity: 0.3, marginTop: sp(4) }} />
          </div>
        ))}
      </div>

      {/* ═══ ROW 2: ECOSYSTEM HEATMAP ═══ */}
      <div style={{ marginBottom: sp(14) }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: sp(6) }}>
          <div style={lbl}>Ecosystem heatmap</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: fs(10), color: T.red }}>\u25C0 Declining</span>
            <div style={{ display: "flex", gap: 1 }}>
              {[-30,-15,0,15,30,60,100].map(g => (
                <div key={g} style={{ width: 10, height: 6, borderRadius: 1,
                  background: g < 0 ? `rgba(196,64,64,${0.3 + Math.abs(g)/60})` : g === 0 ? "rgba(0,0,0,.1)" : `rgba(26,138,92,${0.2 + g/150})`,
                }} />
              ))}
            </div>
            <span style={{ fontSize: fs(10), color: T.green }}>Growing \u25B6</span>
          </div>
        </div>
        <div style={{ background: T.text, borderRadius: RADII.md, padding: sp(6), overflow: "hidden" }}>
          {verts.map(v => {
            const cosSorted = [...v.cos].sort((a, b) => b.mc - a.mc);
            return (
              <div key={v.k} style={{ marginBottom: sp(2) }}>
                <div style={{ display: "flex", gap: 1.5, height: 38 }}>
                  {/* Vertical label cell */}
                  <div onClick={() => onFilterVertical && onFilterVertical(v.k)}
                    style={{ width: 56, flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "flex-end",
                      justifyContent: "center", padding: sp("0 5px"), cursor: "pointer", borderRadius: RADII.xs,
                      background: v.color + "15", borderRight: "2px solid " + v.color }}>
                    <span style={{ fontSize: fs(11), fontWeight: FONT_WEIGHTS.regular, color: v.color, lineHeight: 1.2 }}>{v.name}</span>
                    <span style={{ fontSize: fs(10), color: "rgba(255,255,255,.3)" }}>{v.count} cos</span>
                  </div>
                  {/* Company cells */}
                  {cosSorted.map(c => {
                    const pct = Math.max(1.5, (c.mc / v.mc) * 100);
                    const gr = c.fin?.rg?.[4] || 0;
                    const price = resolveResearchPrice(c, liveData[c.t]);
                    // Diverging color: red for negative, green for positive growth
                    const bg = gr < -10 ? `rgba(196,64,64,${Math.min(0.9, 0.4 + Math.abs(gr)/80)})`
                      : gr < 0 ? `rgba(196,64,64,${0.25 + Math.abs(gr)/40})`
                      : gr < 10 ? `rgba(255,255,255,${0.06 + gr/100})`
                      : gr < 40 ? `rgba(26,138,92,${0.15 + gr/120})`
                      : `rgba(26,138,92,${Math.min(0.85, 0.3 + gr/150)})`;
                    const textColor = gr < -5 ? "#EDB7B5" : gr < 10 ? "rgba(255,255,255,.6)" : gr < 40 ? "#9FD8B5" : "#6BC498";
                    const br = BRAND[c.t] || [v.color, c.t.slice(0,2)];
                    return (
                      <div key={c.t} onClick={() => onSelect && onSelect(c.t)}
                        style={{
                          flex: `${pct} 0 0`, minWidth: 22, background: bg,
                          borderRadius: RADII.xs, display: "flex", flexDirection: "column",
                          justifyContent: "center", padding: sp("0 3px"), cursor: "pointer",
                          overflow: "hidden", transition: "all 0.12s", position: "relative",
                        }}
                        onMouseEnter={e => { e.currentTarget.style.outline = "1.5px solid " + v.color; e.currentTarget.style.zIndex = "5"; e.currentTarget.style.transform = "scale(1.03)"; }}
                        onMouseLeave={e => { e.currentTarget.style.outline = "none"; e.currentTarget.style.zIndex = "0"; e.currentTarget.style.transform = "none"; }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
                          <span style={{ fontSize: fs(10), fontWeight: FONT_WEIGHTS.regular, color: T.onAccent, textShadow: "0 1px 3px rgba(0,0,0,.5)", letterSpacing: 0.3 }}>{c.t}</span>
                          {pct > 12 && <span style={{ fontSize: fs(10), color: textColor, marginLeft: "auto" }}>{gr > 0 ? "+" : ""}{gr}%</span>}
                        </div>
                        {pct > 6 && (
                          <span style={{ fontSize: fs(11), color: "rgba(255,255,255,.55)", marginTop: sp(1) }}>
                            {fmtPrice(price)}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ═══ ROW 3: INTERACTIVE SVG DONUTS ═══ */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: sp(14) }}>
        {[["Market Cap Share", mcDonut, totalMC], ["Revenue Share", revDonut, totalRev]].map(([title, data, total]) => {
          // SVG arc builder
          const R = 42, r = 24, cx = 48, cy = 48;
          let cumAngle = -Math.PI / 2;
          const arcs = data.map(d => {
            const angle = (d.value / total) * Math.PI * 2;
            const start = cumAngle;
            cumAngle += angle;
            const end = cumAngle;
            const large = angle > Math.PI ? 1 : 0;
            const x1 = cx + R * Math.cos(start), y1 = cy + R * Math.sin(start);
            const x2 = cx + R * Math.cos(end), y2 = cy + R * Math.sin(end);
            const x3 = cx + r * Math.cos(end), y3 = cy + r * Math.sin(end);
            const x4 = cx + r * Math.cos(start), y4 = cy + r * Math.sin(start);
            const path = `M${x1},${y1} A${R},${R} 0 ${large},1 ${x2},${y2} L${x3},${y3} A${r},${r} 0 ${large},0 ${x4},${y4} Z`;
            return { ...d, path };
          });
          return (
            <div key={title} style={{ ...card, padding: sp(10) }}>
              <div style={{ ...lbl, marginBottom: sp(6) }}>{title}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <svg width={96} height={96} viewBox="0 0 96 96" style={{ flexShrink: 0 }}>
                  {arcs.map(d => (
                    <path key={d.name} d={d.path} fill={d.color} fillOpacity={0.7} stroke={T.bg1} strokeWidth={1.5}
                      style={{ cursor: "pointer", transition: "fill-opacity 0.15s" }}
                      onClick={() => onFilterVertical && onFilterVertical(verts.find(v => v.name === d.name)?.k)}
                      onMouseEnter={e => e.target.setAttribute("fill-opacity", "1")}
                      onMouseLeave={e => e.target.setAttribute("fill-opacity", "0.7")} />
                  ))}
                  <circle cx={cx} cy={cy} r={r - 2} fill={T.bg1} />
                  <text x={cx} y={cy + 1} textAnchor="middle" dominantBaseline="middle" fontSize={fs(10)} fontWeight={FONT_WEIGHTS.regular} fill={T.text} fontFamily={T.display}>{fmtMC(total)}</text>
                </svg>
                <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1 }}>
                  {data.map(d => (
                    <div key={d.name} onClick={() => onFilterVertical && onFilterVertical(verts.find(v => v.name === d.name)?.k)}
                      style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer", padding: sp("1px 0"), borderRadius: RADII.xs }}
                      onMouseEnter={e => e.currentTarget.style.background = "rgba(0,0,0,.03)"}
                      onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: d.color, flexShrink: 0 }} />
                      <span style={{ fontSize: fs(10), color: T.textSec, flex: 1 }}>{d.name}</span>
                      <span style={{ fontSize: fs(10), color: T.text, fontWeight: FONT_WEIGHTS.regular }}>{d.pct.toFixed(1)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* ═══ ROW 4: VERTICAL FINANCIAL COMPARISON ═══ */}
      <div style={{ marginBottom: sp(14) }}>
        <div style={lbl}>Vertical comparison</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
          {[...verts].sort((a, b) => b.mc - a.mc).slice(0, 4).map(v => {
            const topCos = [...v.cos].sort((a, b) => b.mc - a.mc).slice(0, 4);
            const avgGr = v.cos.length ? Math.round(v.cos.reduce((a, c) => a + (c.fin?.rg?.[4] || 0), 0) / v.cos.length) : 0;
            return (
              <div key={v.k} onClick={() => onFilterVertical && onFilterVertical(v.k)}
                style={{ ...card, padding: sp(8), cursor: "pointer", transition: "border-color 0.15s" }}
                onMouseEnter={e => e.currentTarget.style.borderColor = v.color + "44"}
                onMouseLeave={e => e.currentTarget.style.borderColor = "rgba(0,0,0,.05)"}>
                <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: sp(6) }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: v.color }} />
                  <span style={{ fontSize: fs(11), fontWeight: FONT_WEIGHTS.regular, color: v.color }}>{v.name}</span>
                  <span style={{ fontSize: fs(10), color: T.textMuted, marginLeft: "auto" }}>{v.count}</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2, marginBottom: sp(6) }}>
                  {[["GM", v.gm + "%"], ["Growth", (avgGr > 0 ? "+" : "") + avgGr + "%"], ["MC", fmtMC(v.mc)], ["Rev", fmtMC(v.rev)]].map(([l, val]) => (
                    <div key={l} style={{ background: "rgba(0,0,0,.018)", borderRadius: RADII.xs, padding: sp("2px 4px") }}>
                      <div style={{ fontSize: fs(10), color: T.textDim, textTransform: "uppercase" }}>{l}</div>
                      <div style={{ fontSize: fs(11), fontWeight: FONT_WEIGHTS.regular, color: T.text }}>{val}</div>
                    </div>
                  ))}
                </div>
                <div style={{ borderTop: "1px solid rgba(0,0,0,.04)", paddingTop: sp(4) }}>
                  {topCos.map(c => (
                    <div key={c.t} onClick={e => { e.stopPropagation(); onSelect && onSelect(c.t); }}
                      style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: sp("1px 0"), cursor: "pointer" }}>
                      <span style={{ fontSize: fs(11), color: T.textSec }}><Logo ticker={c.t} size={10} style={{ marginRight: sp(2) }} />{c.t}</span>
                      <span style={{ fontSize: fs(11), color: T.textDim }}>{fmtMC(c.mc)}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, marginTop: sp(6) }}>
          {[...verts].sort((a, b) => b.mc - a.mc).slice(4).map(v => {
            const avgGr = v.cos.length ? Math.round(v.cos.reduce((a, c) => a + (c.fin?.rg?.[4] || 0), 0) / v.cos.length) : 0;
            return (
              <div key={v.k} onClick={() => onFilterVertical && onFilterVertical(v.k)}
                style={{ ...card, padding: sp(6), cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}
                onMouseEnter={e => e.currentTarget.style.borderColor = v.color + "44"}
                onMouseLeave={e => e.currentTarget.style.borderColor = "rgba(0,0,0,.05)"}>
                <span style={{ width: 5, height: 5, borderRadius: "50%", background: v.color, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: fs(10), fontWeight: FONT_WEIGHTS.regular, color: v.color }}>{v.name}</div>
                  <div style={{ fontSize: fs(11), color: T.textDim }}>{v.count} cos &middot; {v.gm}% GM &middot; {avgGr > 0 ? "+" : ""}{avgGr}%</div>
                </div>
                <span style={{ fontSize: fs(11), fontWeight: FONT_WEIGHTS.regular, color: T.text }}>{fmtMC(v.mc)}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ═══ ROW 5: VALUATION SCATTER ═══ */}
      <div style={{ marginBottom: sp(14) }}>
        <div style={lbl}>Valuation spectrum: P/E vs growth</div>
        <div style={{ ...card, padding: sp("8px 4px") }}>
          <ResponsiveContainer width="100%" height={200}>
            <ScatterChart margin={{ top: 14, right: 16, bottom: 8, left: 0 }}>
              <XAxis type="number" dataKey="pe" name="P/E" tick={{ fontSize: fs(10), fill: T.textDim }} axisLine={false} tickLine={false}
                label={{ value: "P/E Ratio", position: "bottom", fontSize: fs(10), fill: T.textMuted, offset: -2 }} />
              <YAxis type="number" dataKey="growth" name="Growth" tick={{ fontSize: fs(10), fill: T.textDim }} axisLine={false} tickLine={false}
                label={{ value: "Rev Growth %", angle: -90, position: "insideLeft", fontSize: fs(10), fill: T.textMuted, offset: 10 }} />
              <ZAxis type="number" dataKey="mc" range={[30, 500]} />
              <Tooltip cursor={false} content={({ payload }) => {
                if (!payload?.[0]) return null;
                const d = payload[0].payload;
                return (
                  <div style={{ ...chartTooltipContentStyle, padding: sp("5px 7px"), fontSize: fs(10) }}>
                    <div style={{ fontWeight: FONT_WEIGHTS.regular, color: d.color, display: "flex", alignItems: "center", gap: 4 }}>
                      <Logo ticker={d.name} size={14} />{d.cc} ${d.name} <span style={{ fontWeight: FONT_WEIGHTS.regular, color: "var(--ra-tooltip-muted)", fontSize: fs(10) }}>{d.v}</span>
                    </div>
                    <div style={{ color: "var(--ra-tooltip-text)" }}>P/E: {d.pe}x &middot; Growth: {d.growth > 0 ? "+" : ""}{d.growth}% &middot; {fmtMC(d.mc)}</div>
                  </div>
                );
              }} />
              <Scatter data={scatterData}>
                {scatterData.map((d, i) => <Cell key={i} fill={d.color} fillOpacity={0.6} stroke={d.color} strokeWidth={0.5} />)}
                <LabelList dataKey="name" position="top" style={{ fontSize: fs(11), fontWeight: FONT_WEIGHTS.regular, fill: T.textDim }} offset={6} />
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ═══ ROW 6: VALUE STREAM ═══ */}
      <ValueStreamSankey theme={theme} onSelect={onSelect} liveData={liveData} />
      {/* ═══ ROW 7: MACRO EXPOSURE ═══ */}
      <div>
        <div style={lbl}>Macro exposure by vertical</div>
        <div style={{ ...card, padding: sp(8), overflowX: "auto" }}>
          <div style={{ display: "grid", gridTemplateColumns: "100px repeat(" + macroAxes.length + ", 1fr)", gap: 2 }}>
            <div />
            {macroAxes.map(m => <div key={m.k} style={{ padding: sp("3px 0"), textAlign: "center", fontSize: fs(10), color: T.textDim, fontWeight: FONT_WEIGHTS.regular, textTransform: "uppercase" }}>{m.n}</div>)}
            {verts.map(v => [
              <div key={v.k + "n"} onClick={() => onFilterVertical && onFilterVertical(v.k)}
                style={{ padding: sp("3px 4px"), fontSize: fs(10), color: v.color, fontWeight: FONT_WEIGHTS.regular, display: "flex", alignItems: "center", cursor: "pointer", borderRadius: RADII.xs }}
                onMouseEnter={e => e.currentTarget.style.background = "rgba(0,0,0,.04)"}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                <span style={{ width: 5, height: 5, borderRadius: "50%", background: v.color, marginRight: sp(4), flexShrink: 0 }} />
                {v.name} <span style={{ color: T.textMuted, marginLeft: sp(3), fontWeight: FONT_WEIGHTS.regular }}>({v.count})</span>
              </div>,
              ...macroAxes.map(m => {
                const mk = m.k;
                const val = v.count ? Math.round(v.cos.reduce((a, c) => a + (c.ms?.[mk] || 0), 0) / v.count * 100) : 0;
                const bg = val > 70 ? "rgba(196,64,64," + (val/180) + ")" : val > 40 ? "rgba(184,134,11," + (val/220) + ")" : "rgba(26,138,92," + (val/280) + ")";
                return <div key={v.k + mk} style={{ background: bg, borderRadius: RADII.xs, padding: sp("3px 0"), textAlign: "center", fontSize: fs(10), color: val > 50 ? T.bg1 : T.textSec, fontWeight: FONT_WEIGHTS.regular }}>{val}</div>;
              }),
            ])}
          </div>
        </div>
      </div>
    </div>
  );
}

// AI theme — sankey value stream stages (extracted from the previous hard-coded
// version inside MarketSummary, now per-theme so other themes can ship their own).

// Defense theme — sankey value stream

// Nuclear theme — sankey value stream

// Drones theme — sankey

// Space theme — sankey

// Robotics theme — sankey

// Quantum theme — sankey

// Biotech GLP-1 theme — sankey

// Batteries theme — sankey

// Uranium theme — sankey

// Crypto theme — sankey

// Curated 6-theme view. Other themes (defense/drones/uranium/batteries/biotech/crypto
// + physical_ai/ai_stack/energy_transition metas) remain in THEMES for data integrity
// and for aerospace_defense meta's constituent lookup, but aren't shown in the switcher.

/* ════════════════════════ FORCE GRAPH ════════════════════════ */
/* ═════════════════ GRAPH HELPERS ═════════════════ */
// Auto-layout fallback for meta-themes with empty POS — grids by vertical
// so nodes don't pile at canvas center and explode outward.
function computeAutoPos(cos, theme, W, H) {
  const vGroups = {};
  cos.forEach(c => {
    const v = resolveCompanyVertical(c, theme);
    (vGroups[v] = vGroups[v] || []).push(c.t);
  });
  const vKeys = Object.keys(theme?.verticals || {}).filter(k => vGroups[k]);
  const rowH = vKeys.length ? (H - 40) / vKeys.length : 60;
  const autoPos = {};
  vKeys.forEach((vk, row) => {
    const y = 40 + row * rowH + rowH / 2;
    const tickers = vGroups[vk] || [];
    const cols = Math.min(tickers.length, Math.max(4, Math.ceil(Math.sqrt(tickers.length * 2))));
    const colW = (W - 80) / Math.max(cols, 1);
    tickers.forEach((t, i) => {
      const col = i % cols;
      const rowOff = Math.floor(i / cols) * 22;
      autoPos[t] = [60 + col * colW + colW / 2, y - rowOff];
    });
  });
  return autoPos;
}

// Top-right toolbar: color mode toggles + reset button.
// Separated from Graph so the color mode / reset UI is easier to locate and edit.
function GraphToolbar({ colorMode, setColorMode, nodesRef, simRef }) {
  const modes = [["vertical","Vertical"],["pe","P/E"],["growth","Growth"],["ai","AI Exp"]];
  return (
    <div style={{ position: "absolute", top: 5, right: 8, display: "flex", gap: 2, zIndex: 2, alignItems: "center" }}>
      <span style={{ fontSize: fs(10), color: T.textMuted, marginRight: sp(2), lineHeight: "18px" }}>Color:</span>
      {modes.map(([id, lb]) => (
        <button key={id} onClick={(e) => { e.stopPropagation(); setColorMode(id); }} style={{
          background: colorMode === id ? "rgba(0,0,0,.07)" : "transparent",
          border: "none", borderRadius: RADII.xs, padding: sp("1px 4px"), fontSize: fs(10), cursor: "pointer",
          color: colorMode === id ? T.text : T.textMuted, fontWeight: FONT_WEIGHTS.regular,
        }}>{lb}</button>
      ))}
      <AppTooltip content="Unpin all nodes and reset to authored layout"><button
        onClick={(e) => {
          e.stopPropagation();
          // Unpin all dragged nodes and re-settle
          nodesRef.current.forEach(n => { n.fx = null; n.fy = null; });
          if (simRef.current) {
            simRef.current.alpha(0.5).restart();
            setTimeout(() => simRef.current && simRef.current.alphaTarget(0), 100);
          }
        }}
        style={{
          background: "transparent", border: "1px solid rgba(0,0,0,.08)", borderRadius: RADII.xs,
          padding: sp("1px 6px"), fontSize: fs(10), cursor: "pointer", marginLeft: sp(6),
          color: T.textDim, fontWeight: FONT_WEIGHTS.regular,
        }}>⟲ Reset</button></AppTooltip>
    </div>
  );
}

function Graph({ cos, sel, onSel, vFilter, searchQuery, theme, liveData = {}, liveFund = {} }) {
  const POS = theme?.positions || AI_POSITIONS;
  const ZONES = theme?.zoneLabels || AI_ZONE_LABELS;
  const ref = useRef();
  const gRef = useRef();
  const tipRef = useRef();
  const nodesRef = useRef([]);
  const simRef = useRef(null);
  const [colorMode, setColorMode] = useState("vertical");
  const [zoneHl, setZoneHl] = useState(null);
  const [hovered, setHovered] = useState(null);
  const zoomLock = useRef(false);
  const W = 680, H = 390;
  const tSet = useMemo(() => new Set(cos.map(c => c.t)), [cos]);

  const peScale = useMemo(() => d3.scaleLinear().domain([8, 40, 180]).range([T.green, T.amber, T.red]).clamp(true), []);
  const grScale = useMemo(() => d3.scaleLinear().domain([-10, 25, 100]).range([T.red, T.amber, T.green]).clamp(true), []);
  const aiScale = useMemo(() => d3.scaleLinear().domain([0.3, 0.65, 1]).range([T.textDim, T.amber, T.red]).clamp(true), []);

  const getColor = useCallback((d) => {
    if (colorMode === "pe") return d.pe ? peScale(d.pe) : T.textMuted;
    if (colorMode === "growth") return grScale(d.fin?.rg?.[4] || 0);
    if (colorMode === "ai") return aiScale(d.ms?.ai || 0.5);
    return VX[d.v].c;
  }, [colorMode]);

  useEffect(() => {
    if (!ref.current) return;
    const svg = d3.select(ref.current);
    svg.selectAll("*").remove();
    const g = svg.append("g");
    gRef.current = g;

    // SVG filter for selected node glow
    const defs = g.append("defs");
    defs.append("filter").attr("id", "glow").attr("x", "-50%").attr("y", "-50%").attr("width", "200%").attr("height", "200%")
      .append("feDropShadow").attr("dx", 0).attr("dy", 0).attr("stdDeviation", 3).attr("flood-color", T.accent).attr("flood-opacity", 0.6);

    // Zone labels
    ZONES.forEach(([x, y, label], zi) => {
      g.append("line").attr("x1", 0).attr("x2", W).attr("y1", y - 6).attr("y2", y - 6)
        .attr("stroke", T.border).attr("stroke-width", 0.4).attr("stroke-dasharray", "2,5").attr("class", "zone-line");
      const zg = g.append("g").attr("class", "zone-label").attr("cursor", "pointer")
        .on("click", (e) => { e.stopPropagation(); setZoneHl(prev => prev === zi ? null : zi); });
      zg.append("rect").attr("x", 0).attr("y", y - 4).attr("width", 120).attr("height", 18).attr("fill", "transparent");
      zg.append("text").attr("x", x).attr("y", y + 4).text(label)
        .attr("fill", T.textMuted).attr("font-size", fs(10)).attr("font-family", T.display).attr("class", "zone-text");
    });

    // Auto-layout fallback for meta-themes (empty POS) — see computeAutoPos helper above
    const autoPos = computeAutoPos(cos, theme, W, H);

    const nodes = cos.map(c => {
      // Prefer curated positions, fall back to auto-layout grid (meta-themes), then center
      const p = POS[c.t] || autoPos[c.t];
      // Prefer live market cap from FMP quote; fall back to authored
      const effMC = liveData[c.t]?.mc ?? c.mc;
      // Preserve live revenue (TTM) + authored revenue separately — d.r conflicts with d3 radius
      const liveRev = liveFund[c.t]?.revenueTTM ?? null;
      const effRev = liveRev ?? c.r;
      const effGM = liveFund[c.t]?.grossMarginTTM ?? c.g;
      const effPE = liveData[c.t]?.pe ?? c.pe;
      return { ...c,
        r: Math.max(9, Math.min(22, Math.sqrt(effMC / 800))),
        _rev: effRev, _revIsLive: liveRev != null,
        _mc: effMC, _mcIsLive: liveData[c.t]?.mc != null,
        _gm: effGM, _gmIsLive: liveFund[c.t]?.grossMarginTTM != null,
        _pe: effPE,
        targetX: p ? p[0] : W/2, targetY: p ? p[1] : H/2,
        x: p ? p[0] + (Math.random()-.5)*8 : W/2 + (Math.random()-.5)*40,
        y: p ? p[1] + (Math.random()-.5)*8 : H/2 + (Math.random()-.5)*40 };
    });
    const links = EDGES.filter(([s, t]) => tSet.has(s) && tSet.has(t)).map(([s, t, l]) => ({ source: s, target: t, label: l }));

    // Stiffer, faster-settling simulation that stays calm during interaction.
    // Key changes from default:
    //  - velocityDecay 0.65 (default 0.4) → more damping, less oscillation
    //  - alphaDecay 0.05 (default 0.0228) → converges in ~90 ticks vs 300
    //  - charge -10 (was -15) → less repulsion cascade
    //  - position strength 0.4/0.5 (was 0.25/0.35) → stronger anchor to target
    const sim = d3.forceSimulation(nodes)
      .velocityDecay(0.65)
      .alphaDecay(0.05)
      .force("link", d3.forceLink(links).id(d => d.t).distance(30).strength(0.03))
      .force("charge", d3.forceManyBody().strength(-10).distanceMax(80))
      .force("collision", d3.forceCollide().radius(d => d.r + 3).strength(0.9))
      .force("x", d3.forceX(d => d.targetX).strength(0.4))
      .force("y", d3.forceY(d => d.targetY).strength(0.5));
    simRef.current = sim;
    nodesRef.current = nodes;

    // Edges with curved paths
    const link = g.append("g").selectAll("path").data(links).join("path")
      .attr("stroke", T.borderLight).attr("stroke-width", 0.6)
      .attr("stroke-dasharray", "3,3")
      .attr("stroke-opacity", 0.5)
      .attr("fill", "none")
      .style("animation", "edgeFlow 1.5s linear infinite");

    // Edge product labels (hidden until hover/select)
    const edgeLabels = g.append("g").selectAll("text").data(links).join("text")
      .attr("class", "edge-label")
      .text(d => d.label || "")
      .attr("fill", "transparent")
      .attr("font-size", fs(8))
      .attr("font-family", T.display)
      .attr("text-anchor", "middle")
      .attr("pointer-events", "none");

    const node = g.append("g").selectAll("g").data(nodes).join("g").attr("cursor", "pointer");

    // Profitability ring (outer)
    node.append("circle")
      .attr("r", d => d.r + 2)
      .attr("fill", "none")
      .attr("stroke", d => d.pe != null && d.pe > 0 ? T.green : d.fin?.eps > 0 ? T.green : T.red)
      .attr("stroke-width", 1)
      .attr("stroke-opacity", 0.35)
      .attr("class", "profit-ring");

    // Main circle: white bg + colored ring
    node.append("circle")
      .attr("r", d => d.r)
      .attr("fill", T.bg1)
      .attr("fill-opacity", 1)
      .attr("stroke", d => getColor(d))
      .attr("stroke-width", 1.5)
      .attr("class", "main-circle");

    // Branded initial circle (inside node - moves with simulation, zero lag)
    node.append("circle")
      .attr("r", d => Math.max(5, d.r * 0.7))
      .attr("fill", d => (BRAND[d.t] || [T.textDim])[0])
      .attr("class", "brand-circle");

    // Brand initial text
    node.append("text")
      .text(d => (BRAND[d.t] || ["", d.t.slice(0,2)])[1])
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "central")
      .attr("fill", T.bg1)
      .attr("font-size", d => Math.max(5, Math.min(9, d.r * 0.55)))
      .attr("font-weight", FONT_WEIGHTS.regular)
      .attr("font-family", T.display)
      .attr("pointer-events", "none")
      .attr("class", "brand-text");

    // Ticker label (pushed below bubble for all sizes)
    node.append("text")
      .text(d => d.t)
      .attr("text-anchor", "middle")
      .attr("dy", d => d.r + 9)
      .attr("fill", T.textDim)
      .attr("font-size", d => Math.max(8, Math.min(10, d.r * 0.6)))
      .attr("font-family", T.display).attr("font-weight", FONT_WEIGHTS.regular);

    // Data sub-label (market cap for large, P/E for medium)
    node.filter(d => d.r >= 13).append("text")
      .text(d => d.r >= 16 ? fmtMC(d._mc) : (d._pe ? d._pe + "x" : ""))
      .attr("text-anchor", "middle")
      .attr("dy", d => d.r + 17)
      .attr("fill", T.textMuted)
      .attr("font-size", fs(7))
      .attr("font-family", T.display);

    // Hover tooltip + connection highlighting
    node.on("mouseenter", (e, d) => {
      if (zoomLock.current) return;
      setHovered(d.t);
      const tip = tipRef.current;
      if (!tip) return;
      const vc = VX[d.v];
      const br = BRAND[d.t] || [T.textDim, d.t.slice(0,2)];
      const tipPrice = resolveResearchPrice(d, liveData[d.t]);
      // Green dot for live-sourced fields, gray for authored fallback
      const dot = (isLive) => `<span style="display:inline-block;width:4px;height:4px;border-radius:2px;background:${isLive ? '#1a8a5c' : 'rgba(0,0,0,.12)'};margin-left:4px;vertical-align:middle"></span>`;
      tip.innerHTML = `<div style="display:flex;align-items:center;gap:5px;margin-bottom:2px;"><span style="display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:3px;background:${br[0]};color:${T.onAccent};font-size:10px;font-weight: ${FONT_WEIGHTS.regular};font-family:${T.display};">${br[1]}</span><span style="font-weight: ${FONT_WEIGHTS.regular};color:${vc.c};font-size:14px;">${d.cc || ""} $${d.t}</span><span style="font-weight: ${FONT_WEIGHTS.regular};color:${T.text};font-size:14px;margin-left:auto;font-family:${T.display};">${fmtPrice(tipPrice)}</span></div>` +
        `<div style="color:${T.textSec};font-size:12px;margin:3px 0 5px">${d.nm} &middot; ${vc.n}</div>` +
        `<div style="display:grid;grid-template-columns:1fr 1fr;gap:3px 14px;font-size:12px;">` +
        `<span style="color:${T.textDim}">Mkt Cap</span><span style="color:${T.text};font-weight: ${FONT_WEIGHTS.regular}">${fmtMC(d._mc)}${dot(d._mcIsLive)}</span>` +
        `<span style="color:${T.textDim}">Revenue ${d._revIsLive ? 'TTM' : ''}</span><span style="color:${T.text};font-weight: ${FONT_WEIGHTS.regular}">${fmtMC(d._rev)}${dot(d._revIsLive)}</span>` +
        `<span style="color:${T.textDim}">GM</span><span style="color:${T.text};font-weight: ${FONT_WEIGHTS.regular}">${d._gm != null ? Math.round(d._gm) + '%' : '\u2014'}${dot(d._gmIsLive)}</span>` +
        `<span style="color:${T.textDim}">P/E</span><span style="color:${T.text};font-weight: ${FONT_WEIGHTS.regular}">${d._pe ? Number(d._pe).toFixed(1) + 'x' : '\u2014'}</span>` +
        `<span style="color:${T.textDim}">Growth</span><span style="color:${T.text};font-weight: ${FONT_WEIGHTS.regular}">${d.fin?.rg?.[4] ? '+' + d.fin.rg[4] + '%' : '\u2014'}</span>` +
        `</div>` +
        `<div style="color:${T.textSec};font-size:11px;margin-top:5px;border-top:1px solid rgba(0,0,0,.06);padding-top:4px;font-style:italic">${d.pr}</div>`;
      tip.style.display = "block";
    })
    .on("mousemove", (e, d) => {
      const tip = tipRef.current;
      if (!tip) return;
      const rect = ref.current.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const tw = tip.offsetWidth;
      const th = tip.offsetHeight;
      const cw = rect.width;
      const ch = rect.height;
      // Find avg position of connected nodes to avoid them
      const connNodes = nodes.filter(n => EDGES.some(([s,t]) => (s===d.t&&t===n.t)||(t===d.t&&s===n.t)));
      const scaleX = cw / W, scaleY = ch / H;
      let avgCX = mx, avgCY = my;
      if (connNodes.length > 0) {
        avgCX = connNodes.reduce((a,n) => a + n.x * scaleX, 0) / connNodes.length;
        avgCY = connNodes.reduce((a,n) => a + n.y * scaleY, 0) / connNodes.length;
      }
      // Place tooltip on opposite side from connections
      let tx = avgCX < mx ? mx - tw - 16 : mx + 16;
      let ty = avgCY < my ? my - th - 8 : my + 8;
      // Clamp to viewport
      if (tx + tw > cw - 4) tx = cw - tw - 4;
      if (tx < 4) tx = 4;
      if (ty + th > ch - 4) ty = ch - th - 4;
      if (ty < 4) ty = 4;
      tip.style.left = tx + "px";
      tip.style.top = ty + "px";
    })
    .on("mouseleave", () => {
      setHovered(null);
      if (tipRef.current) tipRef.current.style.display = "none";
    });

    node.on("click", (e, d) => { e.stopPropagation(); if (tipRef.current) tipRef.current.style.display = "none"; onSel(sel === d.t ? null : d.t); });

    node.call(d3.drag()
      .on("start", (e, d) => {
        // Lower alpha reheat (0.1 vs 0.3) so other nodes barely disturb
        if (!e.active) sim.alphaTarget(0.1).restart();
        d.fx = d.x; d.fy = d.y;
      })
      .on("drag", (e, d) => { d.fx = e.x; d.fy = e.y; })
      .on("end", (e, d) => {
        if (!e.active) sim.alphaTarget(0);
        // Keep node pinned where user dropped it — stops the post-drop drift.
        // Double-click releases (see dblclick handler below).
        // Also auto-release after 4s if user doesn't interact further.
      }));

    // Double-click any node to release its pin and let it float back toward zone
    node.on("dblclick", (e, d) => {
      e.stopPropagation();
      d.fx = null; d.fy = null;
      sim.alphaTarget(0.1).restart();
      setTimeout(() => sim.alphaTarget(0), 600);
    });

    let tickCount = 0;
    sim.on("tick", () => {
      link.attr("d", d => {
        const dx = d.target.x - d.source.x, dy = d.target.y - d.source.y;
        const cx = (d.source.x + d.target.x) / 2 + dy * 0.15;
        const cy = (d.source.y + d.target.y) / 2 - dx * 0.15;
        return `M${d.source.x},${d.source.y} Q${cx},${cy} ${d.target.x},${d.target.y}`;
      });
      edgeLabels.attr("x", d => (d.source.x + d.target.x) / 2)
        .attr("y", d => (d.source.y + d.target.y) / 2 - 3);
      node.attr("transform", d => `translate(${d.x},${d.y})`);
      tickCount++;

    });

    svg.on("click", () => { onSel(null); setZoneHl(null); });
    return () => sim.stop();
  }, [cos, tSet, getColor, liveData, liveFund]);

  // Selection + hover + zone highlight + search highlight
  useEffect(() => {
    if (!ref.current || !gRef.current) return;
    const svg = d3.select(ref.current);
    const g = gRef.current;
    const selCo = COMPANIES.find(c => c.t === sel);
    const hovCo = COMPANIES.find(c => c.t === hovered);
    const active = sel || hovered; // whichever is set
    const activeCo = selCo || hovCo;
    const ac = activeCo ? VX[activeCo.v].c : T.textMuted;
    const isClick = !!sel; // stronger effect for clicks
    const sq = (searchQuery || "").toLowerCase();
    const zoneYs = ZONES.map(z => z[1]);

    const isConn = (ticker) => EDGES.some(([s, t]) => (s === active && t === ticker) || (t === active && s === ticker));

    // Edge labels - show for active connections
    svg.selectAll(".edge-label").transition().duration(200)
      .attr("fill", d => {
        if (!d || !d.source) return "transparent";
        const hit = (d.source.t === active || d.target.t === active);
        return hit ? T.textSec : "transparent";
      });

    // Edges
    svg.selectAll("path[stroke-dasharray]").transition().duration(200)
      .attr("stroke", d => {
        if (!d || !d.source) return T.borderLight;
        if (d.source.t === active || d.target.t === active) return ac;
        if (hovered && !sel && (d.source.t === hovered || d.target.t === hovered)) return ac;
        return T.borderLight;
      })
      .attr("stroke-width", d => {
        if (!d || !d.source) return 0.6;
        const hit = (d.source.t === active || d.target.t === active);
        if (hit) return 1.6;
        return active ? 0.3 : 0.6;
      })
      .attr("stroke-opacity", d => {
        if (!d || !d.source) return 0.5;
        const hit = (d.source.t === active || d.target.t === active);
        if (hit) return 0.85;
        return active ? 0.2 : 0.5;
      });

    // Main circles

    svg.selectAll(".main-circle").transition().duration(200)
      .attr("fill", T.bg1)
      .attr("fill-opacity", d => {
        const matchesSearch = sq && (d.t.toLowerCase().includes(sq) || d.nm.toLowerCase().includes(sq));
        const inZone = zoneHl === null || (POS[d.t] && Math.abs(POS[d.t][1] - zoneYs[zoneHl]) < 35);
        if (matchesSearch) return 1;
        if (!active && zoneHl === null) return 1;
        if (d.t === active) return 1;
        if (active) return isConn(d.t) ? 1 : 0.15;
        return inZone ? 1 : 0.15;
      })
      .attr("stroke", d => {
        const matchesSearch = sq && (d.t.toLowerCase().includes(sq) || d.nm.toLowerCase().includes(sq));
        if (matchesSearch) return T.text;
        if (d.t === active) return T.text;
        if (active && isConn(d.t)) return getColor(d);
        return getColor(d);
      })
      .attr("stroke-width", d => {
        const matchesSearch = sq && (d.t.toLowerCase().includes(sq) || d.nm.toLowerCase().includes(sq));
        if (matchesSearch) return 2.5;
        if (d.t === active) return 3;
        if (active && isConn(d.t)) return 2;
        return 1.5;
      })
      .attr("filter", d => d.t === active ? "url(#glow)" : "none");

    // Brand circles - dim non-connected
    svg.selectAll(".brand-circle").transition().duration(200)
      .attr("fill-opacity", d => {
        if (!active && zoneHl === null) return 1;
        if (d.t === active) return 1;
        if (active) return isConn(d.t) ? 1 : 0.12;
        const inZone = zoneHl === null || (POS[d.t] && Math.abs(POS[d.t][1] - zoneYs[zoneHl]) < 35);
        return inZone ? 1 : 0.15;
      });
    svg.selectAll(".brand-text").transition().duration(200)
      .attr("fill-opacity", d => {
        if (!active && zoneHl === null) return 1;
        if (d.t === active) return 1;
        if (active) return isConn(d.t) ? 1 : 0.12;
        const inZone = zoneHl === null || (POS[d.t] && Math.abs(POS[d.t][1] - zoneYs[zoneHl]) < 35);
        return inZone ? 1 : 0.15;
      });

    // Profit rings
    svg.selectAll(".profit-ring").transition().duration(200)
      .attr("stroke-opacity", d => {
        if (!active && zoneHl === null) return 0.35;
        if (d.t === active) return 0.7;
        if (active) return isConn(d.t) ? 0.5 : 0.1;
        const inZone = zoneHl === null || (POS[d.t] && Math.abs(POS[d.t][1] - zoneYs[zoneHl]) < 35);
        return inZone ? 0.4 : 0.1;
      });

    // Zone labels
    svg.selectAll(".zone-text").attr("fill", (d, i) => zoneHl === i ? T.text : T.textMuted)
      .attr("font-weight", FONT_WEIGHTS.regular)
      .attr("font-size", (d, i) => zoneHl === i ? 12 : 10);

    // Zoom: only on click or zone select (NOT hover)
    if (sel && selCo) {
      const allNodes = svg.selectAll(".main-circle").data();
      const conn = new Set([sel]);
      EDGES.forEach(([s, t]) => { if (s === sel) conn.add(t); if (t === sel) conn.add(s); });
      const cluster = allNodes.filter(d => conn.has(d.t) && d.x != null);
      if (cluster.length > 0) {
        const pad = 40;
        const minX = Math.min(...cluster.map(d => d.x - d.r)) - pad;
        const maxX = Math.max(...cluster.map(d => d.x + d.r)) + pad;
        const minY = Math.min(...cluster.map(d => d.y - d.r)) - pad;
        const maxY = Math.max(...cluster.map(d => d.y + d.r)) + pad;
        const scale = Math.min(W / (maxX - minX), H / (maxY - minY), 2.2);
        const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
        const txVal = W/2 - cx*scale, tyVal = H/2 - cy*scale;
        zoomLock.current = true;
        g.transition().duration(600).ease(d3.easeCubicOut)
          .attr("transform", `translate(${txVal},${tyVal}) scale(${scale})`)
          .on("end", () => { zoomLock.current = false; });
      }
    } else if (zoneHl !== null) {
      const zy = zoneYs[zoneHl];
      const zoneNodes = svg.selectAll(".main-circle").data().filter(d => POS[d.t] && Math.abs(POS[d.t][1] - zy) < 30);
      if (zoneNodes.length > 0) {
        const pad = 30;
        const minX = Math.min(...zoneNodes.map(d => d.x - d.r)) - pad;
        const maxX = Math.max(...zoneNodes.map(d => d.x + d.r)) + pad;
        const scale = Math.min(W / (maxX - minX), 2);
        const cx = (minX + maxX) / 2;
        const txVal2 = W/2 - cx*scale, tyVal2 = H/2 - zy*scale;
        zoomLock.current = true;
        g.transition().duration(500).ease(d3.easeCubicOut)
          .attr("transform", `translate(${txVal2},${tyVal2}) scale(${scale})`)
          .on("end", () => { zoomLock.current = false; });
      }
    } else if (!hovered) {
      zoomLock.current = true;
      g.transition().duration(500).ease(d3.easeCubicOut).attr("transform", "")
        .on("end", () => { zoomLock.current = false; });
    }
  }, [sel, hovered, zoneHl, searchQuery, getColor]);

  return (
    <div style={{ position: "relative", background: T.bg1, borderRadius: RADII.md, overflow: "hidden", border: "1px solid rgba(0,0,0,.06)", boxShadow: "0 2px 8px rgba(0,0,0,.04)" }}>
      <GraphToolbar colorMode={colorMode} setColorMode={setColorMode} nodesRef={nodesRef} simRef={simRef} />
      <svg ref={ref} width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }} />

      {/* Hover tooltip */}
      <div ref={tipRef} style={{
        ...chartTooltipContentStyle,
        display: "none", position: "absolute",
        padding: sp("10px 12px"), pointerEvents: "none", zIndex: 10,
        maxWidth: 220, minWidth: 160,
      }} />
      {/* Legend */}
      <div style={{ position: "absolute", bottom: 4, left: 8, display: "flex", gap: 5, flexWrap: "wrap" }}>
        {Object.entries(theme?.verticals || AI_VERTICALS).map(([k, v]) => (
          <span key={k} style={{ fontSize: fs(10), color: !vFilter || vFilter === k ? v.c : T.textMuted }}>
            <span style={{ display: "inline-block", width: 4, height: 4, borderRadius: "50%", background: v.c, marginRight: sp(2), opacity: !vFilter || vFilter === k ? 1 : 0.2 }} />
            {v.n}
          </span>
        ))}
        {colorMode !== "vertical" && (
          <span style={{ fontSize: fs(10), color: T.textMuted, marginLeft: sp(4) }}>
            | ring = {"\u{1F7E2}"} profitable {"\u{1F534}"} unprofitable
          </span>
        )}
      </div>
    </div>
  );
}

/* ════════════════════════ COMPS + HEATMAP ════════════════════════ */
function Comps({ cos, sel, onSel }) {
  const [sortKey, setSortKey] = useState("mc");
  const [sortDir, setSortDir] = useState(-1);
  const toggleSort = (key) => { if (sortKey === key) setSortDir(d => d * -1); else { setSortKey(key); setSortDir(-1); } };
  const cols = [
    { k: "t", l: "Ticker", w: null },
    { k: "cc", l: "\u{1F30D}", w: 24 },
    { k: "v", l: "Sector", w: null },
    { k: "mc", l: "Mkt Cap", w: null },
    { k: "r", l: "Revenue", w: null },
    { k: "g", l: "GM%", w: null },
    { k: "pe", l: "P/E", w: null },
    { k: "gr", l: "Growth", w: null },
    { k: "ai", l: "AI Exp", w: null },
  ];
  const getVal = (c, k) => k === "gr" ? (c.fin?.rg?.[4] || 0) : k === "ai" ? (c.ms?.ai || 0) : k === "t" ? c.t : k === "cc" ? (c.cc || "") : c[k] ?? -Infinity;
  const sorted = [...cos].sort((a, b) => {
    const av = getVal(a, sortKey), bv = getVal(b, sortKey);
    if (typeof av === "string") return sortDir * av.localeCompare(bv);
    return sortDir * ((av || 0) - (bv || 0));
  });
  return (
    <div style={{ overflowX: "auto" }}>
      <div style={{ fontSize: fs(11), color: T.textMuted, marginBottom: sp(4) }}>{cos.length} companies &middot; sorted by {cols.find(c => c.k === sortKey)?.l}</div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: fs(10), background: T.bg1, borderRadius: RADII.md }}>
        <thead><tr>
          {cols.map(col => (
            <th key={col.k} onClick={() => toggleSort(col.k)} style={{ textAlign: "left", padding: sp("4px 4px"), borderBottom: "1px solid rgba(0,0,0,.08)", color: sortKey === col.k ? T.text : T.textMuted, fontSize: fs(10), textTransform: "uppercase", letterSpacing: 1, cursor: "pointer", whiteSpace: "nowrap", width: col.w || "auto" }}>
              {col.l}{sortKey === col.k ? (sortDir > 0 ? " \u25B2" : " \u25BC") : ""}
            </th>
          ))}
        </tr></thead>
        <tbody>{sorted.map(c => {
          const vc = VX[c.v];
          const gr = c.fin?.rg?.[4] || 0;
          return (
            <tr key={c.t} onClick={() => onSel(c.t)} style={{ cursor: "pointer", background: c.t === sel ? "rgba(0,0,0,.05)" : "transparent", borderBottom: "1px solid rgba(0,0,0,.02)", transition: "background 0.1s" }}
              onMouseEnter={e => { if (c.t !== sel) e.currentTarget.style.background = "rgba(0,0,0,.025)"; }}
              onMouseLeave={e => { if (c.t !== sel) e.currentTarget.style.background = "transparent"; }}>
              <td style={{ padding: sp("3px 4px"), color: c.t === sel ? vc.c : T.text, fontWeight: FONT_WEIGHTS.regular }}><Logo ticker={c.t} size={14} style={{ marginRight: sp(4) }} />${c.t}</td>
              <td style={{ padding: sp("3px 2px"), fontSize: fs(11) }}>{c.cc}</td>
              <td style={{ padding: sp("3px 4px") }}><span style={{ fontSize: fs(10), color: vc.c, background: vc.bg, padding: sp("1px 4px"), borderRadius: RADII.xs }}>{vc.n}</span></td>
              <td style={{ padding: sp("3px 4px"), color: T.textSec }}>{fmtMC(c.mc)}</td>
              <td style={{ padding: sp("3px 4px"), color: T.textSec }}>{fmtMC(c.r)}</td>
              <td style={{ padding: sp("3px 4px"), color: T.textSec }}>{c.g}%</td>
              <td style={{ padding: sp("3px 4px"), color: T.textSec }}>{c.pe ? c.pe + "x" : "\u2014"}</td>
              <td style={{ padding: sp("3px 4px"), color: gr > 30 ? T.green : gr < 0 ? T.red : T.textSec }}>{gr > 0 ? "+" : ""}{gr}%</td>
              <td style={{ padding: sp("3px 4px"), color: T.textSec }}>{(c.ms?.ai * 100 || 0).toFixed(0)}%</td>
            </tr>
          );
        })}</tbody>
      </table>
    </div>
  );
}

function Heatmap({ cos, sel, onSel, onFilterVertical, theme }) {
  const macroAxes = theme?.macro || AI_MACRO;
  const macroKeys = macroAxes.map(m => m.k);
  const macroNames = Object.fromEntries(macroAxes.map(m => [m.k, m.n]));
  const themeVerticals = theme?.verticals || AI_VERTICALS;

  // By-vertical summary
  const vertSummary = Object.entries(themeVerticals).map(([k, v]) => {
    const vcos = cos.filter(c => resolveCompanyVertical(c, theme) === k);
    const n = vcos.length || 1;
    const avgs = {};
    macroKeys.forEach(mk => { avgs[mk] = Math.round(vcos.reduce((a, c) => a + (c.ms?.[mk] || 0), 0) / n * 100); });
    return { k, name: v.n, color: v.c, count: vcos.length, ...avgs };
  }).filter(v => v.count > 0);

  // Most exposed companies per macro factor
  const topExposed = macroKeys.map(mk => {
    const top = [...cos].sort((a, b) => (b.ms?.[mk] || 0) - (a.ms?.[mk] || 0)).slice(0, 5);
    return { mk, name: macroNames[mk], companies: top };
  });

  const cellBg = (val) => val > 70 ? `rgba(196,64,64,${val / 180})` : val > 40 ? `rgba(184,134,11,${val / 220})` : `rgba(26,138,92,${val / 280})`;

  return (
    <div>
      {/* Vertical-level heatmap */}
      <div style={{ fontSize: fs(11), fontWeight: FONT_WEIGHTS.regular, color: T.textDim, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: sp(5) }}>
        Macro sensitivity by vertical
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "110px repeat(" + macroKeys.length + ", 1fr)", gap: 2, marginBottom: sp(16) }}>
        <div />
        {macroKeys.map(mk => <div key={mk} style={{ padding: sp("3px 0"), textAlign: "center", fontSize: fs(10), color: T.textDim, fontWeight: FONT_WEIGHTS.regular, textTransform: "uppercase" }}>{macroNames[mk]}</div>)}
        {vertSummary.map(v => [
          <div key={v.k + "n"} style={{ padding: sp("3px 4px"), fontSize: fs(11), color: v.color, fontWeight: FONT_WEIGHTS.regular, display: "flex", alignItems: "center" }}>
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: v.color, marginRight: sp(4), flexShrink: 0 }} />
            {v.name} <span style={{ color: T.textMuted, marginLeft: sp(3), fontWeight: FONT_WEIGHTS.regular }}>({v.count})</span>
          </div>,
          ...macroKeys.map(mk => (
            <div key={v.k + mk} style={{ background: cellBg(v[mk]), borderRadius: RADII.xs, padding: sp("3px 0"), textAlign: "center", fontSize: fs(10), color: v[mk] > 50 ? T.bg1 : T.textSec, fontWeight: FONT_WEIGHTS.regular }}>
              {v[mk]}
            </div>
          )),
        ])}
      </div>

      {/* Most exposed companies per factor */}
      <div style={{ fontSize: fs(11), fontWeight: FONT_WEIGHTS.regular, color: T.textDim, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: sp(5) }}>
        Most exposed companies
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(" + Math.min(4, macroKeys.length) + ", 1fr)", gap: 8 }}>
        {topExposed.map(({ mk, name, companies }) => (
          <div key={mk} style={{ background: T.bg1, border: "1px solid rgba(0,0,0,.05)", borderRadius: RADII.md, padding: sp(7) }}>
            <div style={{ fontSize: fs(11), fontWeight: FONT_WEIGHTS.regular, color: T.textDim, marginBottom: sp(4) }}>{name}</div>
            {companies.map(c => {
              const vc = VX[c.v] || { c: T.textDim };
              const val = Math.round((c.ms?.[mk] || 0) * 100);
              return (
                <div key={c.t} onClick={() => onSel(c.t)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: sp("2px 0"), cursor: "pointer", borderBottom: "1px solid rgba(0,0,0,.02)" }}>
                  <Logo ticker={c.t} size={11} style={{ marginRight: sp(2) }} /><span style={{ fontSize: fs(11), fontWeight: FONT_WEIGHTS.regular, color: c.t === sel ? vc.c : T.textSec }}>{c.cc} ${c.t}</span>
                  <span style={{ fontSize: fs(11), color: val > 70 ? T.red : val > 40 ? T.amber : T.green, fontWeight: FONT_WEIGHTS.regular }}>{val}</span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ════════════════════════ MAIN APP ════════════════════════ */
/* ═════════════════ DASHBOARD SUB-COMPONENTS ═════════════════ */
// Extracted from PhotonicsObservatory for readability.

function ResearchLoadingState({ theme }) {
  return (
    <div className="ra-panel-enter" style={{ animation: "fadeIn 0.2s ease", maxWidth: 760, margin: "24px auto 0" }}>
      <style>
        {"@keyframes researchWorkspaceSpin { to { transform: rotate(360deg); } }"}
      </style>
      <div style={{
        background: T.bg1,
        border: "1px solid rgba(0,0,0,.06)",
        borderRadius: RADII.md,
        boxShadow: "0 2px 10px rgba(0,0,0,.04)",
        overflow: "hidden",
      }}>
        <div style={{
          padding: sp("18px 20px 14px"),
          borderBottom: "1px solid rgba(0,0,0,.05)",
          background: `linear-gradient(180deg, ${theme.accent}10 0%, rgba(255,255,255,.96) 100%)`,
        }}>
          <div style={{ fontSize: fs(11), color: theme.accent, letterSpacing: 3, textTransform: "uppercase", fontWeight: FONT_WEIGHTS.regular }}>
            Research
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: sp(4) }}>
            <span
              data-testid="loading-spinner"
              role="status"
              aria-label="Loading"
              className="ra-status-pulse"
              style={{
                width: 20,
                height: 20,
                borderRadius: "50%",
                border: "2px solid rgba(0,0,0,.08)",
                borderTopColor: theme.accent,
                animation: "researchWorkspaceSpin 820ms linear infinite",
                flexShrink: 0,
              }}
            />
            <div style={{ fontFamily: T.display, fontSize: fs(28), color: T.text }}>
              Loading research workspace
            </div>
          </div>
          <div style={{ fontSize: fs(12), color: T.textSec, marginTop: sp(6), lineHeight: 1.6, maxWidth: 520 }}>
            The curated universe, graph relationships, and thesis metadata are being loaded into the platform shell. Live market data wiring stays available while the authored research dataset hydrates.
          </div>
        </div>

        <div style={{ padding: sp(20) }}>
          <div style={{ display: "grid", gridTemplateColumns: "1.2fr .8fr", gap: 12 }}>
            {[0, 1].map((column) => (
              <div key={column} style={{ display: "grid", gap: 10 }}>
                {[0, 1, 2].map((row) => (
                  <div
                    key={row}
                    style={{
                      height: column === 0 && row === 0 ? 180 : 84,
                      borderRadius: RADII.md,
                      border: "1px solid rgba(0,0,0,.05)",
                      background: "linear-gradient(90deg, rgba(0,0,0,.025) 0%, rgba(0,0,0,.055) 50%, rgba(0,0,0,.025) 100%)",
                      backgroundSize: "220px 100%",
                      animation: "shimmer 1.6s linear infinite",
                    }}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PhotonicsObservatory({
  onJumpToTrade,
  isVisible = false,
}) {
  const [themeId, setThemeId] = useState("ai");
  const {
    data: researchData,
    metaReady: researchMetaReady,
    ready: researchDataReady,
  } = useResearchRuntimeData(themeId);
  const [sel, setSel] = useState(null);
  const [vf, setVf] = useState(null);
  const [sf, setSf] = useState(null);
  const [view, setView] = useState("graph");
  const [q, setQ] = useState("");
  const apiKey = "__platform__";
  const [liveData, setLiveData] = useState({});
  const [liveFund, setLiveFund] = useState({}); // {[ticker]: {revenueTTM, grossMarginTTM, beta, ...}} — populated by background prefetch
  const [liveHist, setLiveHist] = useState({}); // {[ticker]: [{price, fullDate, ...}, ...]} — 1-hour bars ~30 days, populated by backgroundPrefetchHist
  const [dataStatus, setDataStatus] = useState("static");
  const [prefetchProgress, setPrefetchProgress] = useState({ done: 0, total: 0, active: false });
  const [histPrefetchProgress, setHistPrefetchProgress] = useState({ done: 0, total: 0, active: false });
  const [researchStatus, setResearchStatus] = useState({ configured: false, provider: null });
  const [showSettings, setShowSettings] = useState(false);
  const graphRef = useRef();
  const detailRef = useRef();
  useRuntimeWorkloadFlag("research:stream", isVisible, {
    kind: "stream",
    label: "Research live quotes",
    detail: "theme",
    priority: 5,
  });
  useRuntimeWorkloadFlag("research:refresh", isVisible, {
    kind: "poll",
    label: "Research refresh",
    detail: "300s",
    priority: 7,
  });

  if (researchDataReady) {
    applyResearchRuntimeData(researchData);
  }

  const activeCompanies = researchData.COMPANIES || [];
  const activeEdges = researchData.EDGES || [];
  const themeMap = researchData.THEMES || THEMES;
  const themeOrder = researchData.THEME_ORDER || THEME_ORDER;
  const verticalMap = researchData.VX || VX;
  const currentTheme = themeMap[themeId] || themeMap.ai || FALLBACK_THEME;

  // Reset per-theme state when switching themes
  useEffect(() => {
    setVf(null);
    setSf(null);
    setSel(null);
    setQ("");
    setDataStatus("static");
    setPrefetchProgress({ done: 0, total: 0, active: false });
    setHistPrefetchProgress({ done: 0, total: 0, active: false });
  }, [themeId]);

  // Auto-scroll to detail on select, back to graph on deselect
  const prevSel = useRef(null);
  useEffect(() => {
    if (sel && !prevSel.current && detailRef.current) {
      setTimeout(() => detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 350);
    }
    if (!sel && prevSel.current && graphRef.current) {
      setTimeout(() => graphRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
    }
    prevSel.current = sel;
  }, [sel]);

  useEffect(() => {
    fetchResearchStatus().then(status => {
      setResearchStatus(status || { configured: false, provider: null });
    });
  }, []);

  const themeUniverse = useMemo(() => activeCompanies, [activeCompanies]);
  const streamedThemeTickers = useMemo(
    () => themeUniverse.map((company) => company.t).filter(Boolean),
    [themeUniverse],
  );
  const handleStreamedQuotes = useCallback((quotes) => {
    if (!Array.isArray(quotes) || quotes.length === 0) {
      return;
    }

    setLiveData((current) => {
      let changed = false;
      const next = { ...current };

      quotes.forEach((quote) => {
        const ticker = FMP_REVERSE[quote.symbol] || quote.symbol;
        if (!ticker) {
          return;
        }

        const currentEntry = current[ticker] || {};
        const nextEntry = {
          ...currentEntry,
          price: quote.price,
          bid: quote.bid,
          ask: quote.ask,
          change: quote.change,
          changePct: quote.changePercent,
          dayLow: quote.low,
          dayHigh: quote.high,
        };

        if (
          currentEntry.price !== nextEntry.price ||
          currentEntry.bid !== nextEntry.bid ||
          currentEntry.ask !== nextEntry.ask ||
          currentEntry.change !== nextEntry.change ||
          currentEntry.changePct !== nextEntry.changePct ||
          currentEntry.dayLow !== nextEntry.dayLow ||
          currentEntry.dayHigh !== nextEntry.dayHigh
        ) {
          next[ticker] = nextEntry;
          changed = true;
        }
      });

      return changed ? next : current;
    });
    setDataStatus((current) =>
      current === "static" || current === "loading" || current === "error"
        ? "live"
        : current,
    );
  }, []);
  useIbkrQuoteSnapshotStream({
    symbols: streamedThemeTickers,
    enabled: Boolean(
      isVisible && apiKey && researchDataReady && streamedThemeTickers.length,
    ),
    onQuotes: handleStreamedQuotes,
  });

  useEffect(() => {
    if (!researchStatus.configured || dataStatus !== "live" || !themeUniverse.length) return;

    const pendingTickers = themeUniverse
      .map((company) => company.t)
      .filter((ticker) => !Object.prototype.hasOwnProperty.call(liveFund, ticker));

    if (!pendingTickers.length) return;

    let cancelled = false;
    setPrefetchProgress({ done: 0, total: pendingTickers.length, active: true });

    backgroundPrefetchFundamentals(pendingTickers, ({ done, total }) => {
      if (cancelled) return;
      setPrefetchProgress({ done, total, active: done < total });
    }).then((prefetched) => {
      if (cancelled || !prefetched) return;
      setLiveFund((prev) => ({ ...prev, ...prefetched }));
      setPrefetchProgress({ done: pendingTickers.length, total: pendingTickers.length, active: false });
    });

    return () => {
      cancelled = true;
    };
  }, [dataStatus, liveFund, researchStatus.configured, themeUniverse]);

  const cos = useMemo(() => {
    let list = themeUniverse;
    if (vf) list = list.filter(c => resolveCompanyVertical(c, currentTheme) === vf);
    if (sf) list = list.filter(c => c.s === sf);
    if (q) {
      const s = q.toLowerCase();
      list = list.filter(c => c.t.toLowerCase().includes(s) || c.nm.toLowerCase().includes(s));
    }
    // Include directly connected nodes from other verticals to preserve edges
    if (vf || sf || q) {
      const tickers = new Set(list.map(c => c.t));
      const neighbors = new Set();
      activeEdges.forEach(([s, t]) => {
        if (tickers.has(s) && !tickers.has(t)) neighbors.add(t);
        if (tickers.has(t) && !tickers.has(s)) neighbors.add(s);
      });
      const neighborCos = themeUniverse.filter(c => neighbors.has(c.t) && !tickers.has(c.t));
      list = [...list, ...neighborCos];
    }
    return list;
  }, [activeEdges, currentTheme, q, sf, themeUniverse, vf]);

  // Clear orphaned selection when filters exclude the selected company
  useEffect(() => {
    if (sel && vf && !cos.find(c => c.t === sel)) setSel(null);
  }, [vf, sf, cos]);

  const refreshData = useCallback(async (force = false) => {
    if (!researchDataReady || !themeUniverse.length) {
      setDataStatus("static");
      return;
    }

    const tickers = themeUniverse.map((company) => company.t);
    const currentThemeLiveCount = tickers.filter((ticker) =>
      Object.prototype.hasOwnProperty.call(liveData, ticker),
    ).length;
    const pendingTickers = force
      ? tickers
      : tickers.filter((ticker) => !Object.prototype.hasOwnProperty.call(liveData, ticker));

    if (!pendingTickers.length) {
      setDataStatus(currentThemeLiveCount > 0 ? "live" : "static");
      return;
    }

    if (currentThemeLiveCount === 0) {
      setDataStatus("loading");
    }

    try {
      const quotes = await fetchQuotes(pendingTickers);
      const mergedThemeLiveCount = tickers.filter((ticker) =>
        Object.prototype.hasOwnProperty.call(liveData, ticker)
          || Object.prototype.hasOwnProperty.call(quotes, ticker),
      ).length;

      setLiveData((prev) => ({ ...prev, ...quotes }));

      setDataStatus(mergedThemeLiveCount > 0 ? "live" : "error");
      setHistPrefetchProgress((prev) => prev);
    } catch (e) {
      setDataStatus(currentThemeLiveCount > 0 ? "live" : "error");
    }
  }, [liveData, researchDataReady, themeUniverse]);

  useEffect(() => {
    if (isVisible && apiKey && researchDataReady) {
      void refreshData(false);
    }
  }, [apiKey, isVisible, refreshData, researchDataReady]);

  useEffect(() => {
    if (!isVisible || !apiKey || !researchDataReady) return undefined;
    const timer = window.setInterval(() => {
      void refreshData(true);
    }, 300_000);
    return () => window.clearInterval(timer);
  }, [apiKey, isVisible, refreshData, researchDataReady]);

  useEffect(() => {
    if (!researchMetaReady || !researchDataReady) return undefined;
    const prefetchIds = themeOrder.filter((candidateThemeId) =>
      candidateThemeId !== themeId && themeMap[candidateThemeId]?.available,
    );
    const timer = window.setTimeout(() => {
      prefetchIds.forEach((candidateThemeId) => {
        prefetchResearchThemeDataset(candidateThemeId);
      });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [researchDataReady, researchMetaReady, themeId, themeMap, themeOrder]);

  const selCo = activeCompanies.find(c => c.t === sel);
  const subs = vf ? (currentTheme.verticals[vf]?.subs || []) : [];

  return (
    <div data-testid="research-screen" className="photonics-research-root" style={{ background: T.bg1, height: "100%", minHeight: 0, overflowY: "auto", color: T.text, backgroundImage: "radial-gradient(circle at 20% 50%, rgba(205,162,78,.02) 0%, transparent 50%), radial-gradient(circle at 80% 20%, rgba(94,148,232,.015) 0%, transparent 50%)" }}>
      <style>{`
        .photonics-research-root, .photonics-research-root * { box-sizing: border-box; margin: 0; padding: sp(0); }
        .photonics-research-root { font-family: var(--ra-font-sans); }
        .photonics-research-root button,
        .photonics-research-root input,
        .photonics-research-root textarea,
        .photonics-research-root select,
        .photonics-research-root table,
        .photonics-research-root div,
        .photonics-research-root span,
        .photonics-research-root p,
        .photonics-research-root h2,
        .photonics-research-root h3,
        .photonics-research-root h4,
        .photonics-research-root h5,
        .photonics-research-root h6 { font-family: inherit; }
        .photonics-research-root ::-webkit-scrollbar { width: 4px; height: 4px; }
        .photonics-research-root ::-webkit-scrollbar-track { background: transparent; }
        .photonics-research-root ::-webkit-scrollbar-thumb { background: rgba(205,162,78,.15); border-radius: 4px; }
        .photonics-research-root ::-webkit-scrollbar-thumb:hover { background: rgba(205,162,78,.3); }
        .photonics-research-root input[type=range] { -webkit-appearance: none; background: rgba(0,0,0,.06); border-radius: 3px; height: 3px; }
        .photonics-research-root input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; width: 14px; height: 14px; border-radius: 50%; background: #fff; cursor: pointer; box-shadow: 0 1px 4px rgba(0,0,0,.15); border: 2px solid rgba(205,162,78,.4); }
        .photonics-research-root input[type=range]::-webkit-slider-thumb:hover { border-color: rgba(205,162,78,.8); }
        .photonics-research-root button { transition: transform 0.12s ease, border-color 0.12s ease, background-color 0.12s ease, box-shadow 0.12s ease; }
        .photonics-research-root button:hover { transform: translateY(-1px); }
        .photonics-research-root button:active { transform: scale(0.97); }
        .photonics-research-root button:focus-visible { outline: 2px solid rgba(205,162,78,.45); outline-offset: 2px; }
        .photonics-research-root ::selection { background: rgba(205,162,78,.15); color: #111; }
        @keyframes slideUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes edgeFlow { to { stroke-dashoffset: -12; } }
        @keyframes shimmer { from { background-position: -200px 0; } to { background-position: 200px 0; } }
        @keyframes researchObservatoryPulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.4; transform: scale(0.85); } }
      `}</style>

      {/* Header */}
      <div style={{ padding: sp("14px 14px 0"), position: "relative" }}>
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 200, background: `radial-gradient(ellipse at 30% -30%, ${currentTheme.accent}14 0%, transparent 55%), radial-gradient(ellipse at 90% 20%, rgba(94,148,232,.03) 0%, transparent 40%)`, pointerEvents: "none" }} />

        {researchMetaReady ? (
          <ThemeSwitcher themeId={themeId} setThemeId={setThemeId} themes={themeMap} themeOrder={themeOrder} />
        ) : (
          <div style={{ position: "relative", marginBottom: sp(14), paddingBottom: sp(10), borderBottom: "1px solid rgba(0,0,0,.05)" }}>
            <div style={{ fontSize: fs(9), color: T.textMuted, letterSpacing: 2, textTransform: "uppercase", fontWeight: FONT_WEIGHTS.regular, marginBottom: sp(6) }}>
              Investment Thesis
            </div>
            <div style={{ fontSize: fs(11), color: T.textDim }}>Loading curated research themes…</div>
          </div>
        )}

        <div style={{ position: "relative", display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: sp(8) }}>
          <div>
            <div style={{ fontSize: fs(11), color: currentTheme.accent, letterSpacing: 5, textTransform: "uppercase", fontWeight: FONT_WEIGHTS.regular }}>
              {currentTheme.subtitle}
            </div>
            <h1 style={{ fontFamily: T.display, fontSize: fs(28), fontWeight: FONT_WEIGHTS.regular, color: T.text, letterSpacing: 0, lineHeight: 1.05, marginTop: sp(2) }}>
              {currentTheme.title}
            </h1>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: fs(18), fontWeight: FONT_WEIGHTS.regular, color: currentTheme.accent }}>
              {researchDataReady ? fmtMC(themeUniverse.reduce((a, c) => a + c.mc, 0)) : "…"}
            </div>
            <div style={{ fontSize: fs(11), color: T.textMuted }}>
              {researchDataReady
                ? `${themeUniverse.length} cos / ${activeEdges.length} links`
                : "Loading universe…"}
              <span style={{ fontSize: fs(10), padding: sp("1px 5px"), borderRadius: RADII.xs, fontWeight: FONT_WEIGHTS.regular, marginLeft: sp(4),
                background: dataStatus === "live" ? "rgba(26,138,92,.1)" : dataStatus === "loading" ? "rgba(184,134,11,.1)" : "rgba(0,0,0,.04)",
                color: dataStatus === "live" ? T.green : dataStatus === "loading" ? T.amber : T.textMuted,
              }}>{dataStatus === "live" ? "\u25CF LIVE" : dataStatus === "loading" ? "LOADING..." : "STATIC"}</span>
              {prefetchProgress.total > 0 && (
                <AppTooltip content={prefetchProgress.active
                    ? `Prefetching TTM fundamentals: ${prefetchProgress.done}/${prefetchProgress.total} done`
                    : `Fundamentals prefetch complete: ${prefetchProgress.done} companies refreshed`}><span
                  style={{
                    fontSize: fs(10), padding: sp("1px 5px"), borderRadius: RADII.xs, fontWeight: FONT_WEIGHTS.regular, marginLeft: sp(4),
                    background: prefetchProgress.active ? "rgba(94,148,232,.12)" : "rgba(26,138,92,.08)",
                    color: prefetchProgress.active ? T.blue : T.green,
                }}>
                  {prefetchProgress.active
                    ? `\u29BF ${prefetchProgress.done}/${prefetchProgress.total}`
                    : `\u2713 ${prefetchProgress.done} TTM`}
                </span></AppTooltip>
              )}
              {histPrefetchProgress.total > 0 && (
                <AppTooltip content={histPrefetchProgress.active
                    ? `Prefetching intraday 1-hour bars: ${histPrefetchProgress.done}/${histPrefetchProgress.total} done`
                    : `Intraday history prefetch complete: ${histPrefetchProgress.done} companies with 1H bars cached`}><span
                  style={{
                    fontSize: fs(10), padding: sp("1px 5px"), borderRadius: RADII.xs, fontWeight: FONT_WEIGHTS.regular, marginLeft: sp(4),
                    background: histPrefetchProgress.active ? "rgba(142,68,173,.12)" : "rgba(26,138,92,.08)",
                    color: histPrefetchProgress.active ? T.purple : T.green,
                }}>
                  {histPrefetchProgress.active
                    ? `\u29BF ${histPrefetchProgress.done}/${histPrefetchProgress.total} 1H`
                    : `\u2713 ${histPrefetchProgress.done} 1H`}
                </span></AppTooltip>
              )}
              <button onClick={() => setShowSettings(s => !s)} style={{ background: T.bg1, border: "1px solid rgba(0,0,0,.06)", borderRadius: RADII.sm, padding: sp("1px 6px"), fontSize: fs(11), cursor: "pointer", color: T.textDim, marginLeft: sp(2) }}>\u2699</button>
            </div>
          </div>
        </div>

        {showSettings && (
          <SettingsPanel refreshData={() => void refreshData(true)} dataStatus={dataStatus} liveData={liveData} researchStatus={researchStatus} />
        )}

        <div style={{ position: "relative", marginBottom: sp(8) }}>
          <input data-testid="research-search-input" type="text" value={q} onChange={e => setQ(e.target.value)}
            disabled={!researchDataReady}
            onKeyDown={e => { if (e.key === "Enter" && cos.length === 1) { setSel(cos[0].t); setQ(""); } if (e.key === "Escape") { setQ(""); setSel(null); } }}
            placeholder={researchDataReady ? "Search ticker or company..." : "Loading ticker universe..."}
            style={{ width: "100%", background: T.bg1, border: "1px solid rgba(0,0,0,.08)", borderRadius: RADII.md, padding: sp("6px 10px"), color: T.text, fontSize: fs(11), outline: "none", boxShadow: "0 1px 3px rgba(0,0,0,.04)", opacity: researchDataReady ? 1 : 0.65, cursor: researchDataReady ? "text" : "wait" }}
          />
          {q && <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: fs(11), color: T.textMuted }}>{cos.length} match{cos.length !== 1 ? "es" : ""}</span>
            <button onClick={() => setQ("")} style={{ background: "rgba(0,0,0,.06)", border: "none", borderRadius: "50%", width: 16, height: 16, cursor: "pointer", color: T.textDim, fontSize: fs(10), display: "flex", alignItems: "center", justifyContent: "center", padding: sp(0), lineHeight: 1 }}>✕</button>
          </span>}
        </div>

        {/* Vertical filter pills */}
        {researchMetaReady && (
        <div style={{ display: "flex", gap: 3, flexWrap: "wrap", marginBottom: sp(4) }}>
          <button onClick={() => { setVf(null); setSf(null); }} style={{ background: !vf ? T.bg1 : "transparent", border: !vf ? "1px solid rgba(0,0,0,.1)" : "1px solid transparent", borderRadius: RADII.sm, padding: sp("3px 8px"), fontSize: fs(11), color: !vf ? T.text : T.textDim, cursor: "pointer", fontWeight: FONT_WEIGHTS.regular, boxShadow: !vf ? "0 1px 3px rgba(0,0,0,.06)" : "none" }}>ALL</button>
          {Object.entries(currentTheme.verticals).map(([k, v]) => (
            <button key={k} onClick={() => { setVf(vf === k ? null : k); setSf(null); }} style={{ background: vf === k ? T.bg1 : "transparent", border: vf === k ? `1px solid ${v.c}44` : "1px solid transparent", borderRadius: RADII.sm, padding: sp("3px 8px"), fontSize: fs(11), boxShadow: vf === k ? `0 1px 4px ${v.c}18` : "none", color: vf === k ? v.c : T.textSec, cursor: "pointer", fontWeight: FONT_WEIGHTS.regular, transition: "all 0.15s" }}>
              {v.n}
            </button>
          ))}
        </div>
        )}

        {/* Sub-layer pills */}
        {subs.length > 0 && (
          <div style={{ display: "flex", gap: 3, flexWrap: "wrap", marginBottom: sp(4), animation: "fadeIn 0.2s ease" }}>
            <button onClick={() => setSf(null)} style={{ background: !sf ? "rgba(0,0,0,.06)" : "rgba(0,0,0,.03)", border: "none", borderRadius: RADII.xs, padding: sp("3px 7px"), fontSize: fs(10), color: !sf ? T.textMuted : T.text, cursor: "pointer" }}>All layers</button>
            {subs.map(s => (
              <button key={s} onClick={() => setSf(sf === s ? null : s)} style={{ background: sf === s ? currentTheme.verticals[vf]?.bg : "rgba(0,0,0,.03)", border: sf === s ? `1px solid ${currentTheme.verticals[vf]?.c}22` : "1px solid transparent", borderRadius: RADII.xs, padding: sp("3px 7px"), fontSize: fs(10), color: sf === s ? currentTheme.verticals[vf]?.c : T.textSec, cursor: "pointer" }}>
                {s}
              </button>
            ))}
          </div>
        )}

        {/* View tabs */}
        {researchMetaReady && (
        <div style={{ display: "flex", gap: 0, borderBottom: "1px solid rgba(0,0,0,.06)", marginTop: sp(8) }}>
          {[["graph", "Graph"], ["comps", "Comps"], ["macro", "Macro"], ["calendar", "📅 Calendar"]].map(([id, lb]) => (
            <button key={id} data-testid={`research-view-${id}`} onClick={() => setView(id)} style={{ background: "none", border: "none", borderBottom: view === id ? "2px solid #CDA24E" : "2px solid transparent", padding: sp("6px 12px"), color: view === id ? T.text : T.textDim, fontSize: fs(10), fontWeight: FONT_WEIGHTS.regular, cursor: "pointer", letterSpacing: 0.3 }}>
              {lb}
            </button>
          ))}
        </div>
        )}
      </div>

      {/* Content */}
      <div style={{ padding: sp("10px 14px 64px") }}>
        {!researchDataReady ? (
          <ResearchLoadingState theme={currentTheme} />
        ) : view === "calendar" ? (
          <CalendarView
            cos={activeCompanies}
            liveData={liveData}
            apiKey={apiKey}
            themes={themeMap}
            vx={verticalMap}
            onSelect={(ticker) => {
              // Switch to a theme containing this company, then set selection + switch view to graph
              const co = activeCompanies.find(c => c.t === ticker);
              if (co && co.themes && co.themes.length) {
                // Prefer a theme that's in the curated switcher, else any available theme
                const visibleTheme = co.themes.find(tid => themeOrder.includes(tid) && themeMap[tid]?.available);
                const availableTheme = visibleTheme || co.themes.find(tid => themeMap[tid]?.available) || co.themes[0];
                setThemeId(availableTheme);
              }
              setSel(ticker);
              setView("graph");
            }}
          />
        ) : themeUniverse.length === 0 ? (
          <div style={{ animation: "fadeIn 0.3s ease", maxWidth: 560, margin: "60px auto", textAlign: "center" }}>
            <div style={{ fontSize: fs(48), color: currentTheme.accent, marginBottom: sp(12), opacity: 0.4 }}>{currentTheme.icon}</div>
            <h2 style={{ fontFamily: T.display, fontSize: fs(26), fontWeight: FONT_WEIGHTS.regular, color: T.text, marginBottom: sp(8), letterSpacing: -0.5 }}>
              {currentTheme.title}
            </h2>
            <div style={{ fontSize: fs(12), color: T.textDim, lineHeight: 1.6, marginBottom: sp(18) }}>
              {currentTheme.subtitle}
            </div>
            <div style={{ fontSize: fs(12), color: T.textSec, lineHeight: 1.6, maxWidth: 420, margin: "0 auto 18px" }}>
              No covered companies are available for this thesis in the current research dataset.
            </div>
            <div style={{ marginTop: sp(16) }}>
              <button onClick={() => setThemeId("ai")} style={{
                background: T.bg1, border: "1px solid rgba(0,0,0,.1)", borderRadius: RADII.md,
                padding: sp("6px 18px"), fontSize: fs(11), color: T.textSec, cursor: "pointer", fontWeight: FONT_WEIGHTS.regular,
              }}>← Back to AI Trade</button>
            </div>
          </div>
        ) : (<>
        {view === "graph" && (
          <div className="ra-panel-enter" style={{ animation: "fadeIn 0.3s ease" }}>
            <div ref={graphRef}><Graph cos={cos} sel={sel} onSel={setSel} vFilter={vf} searchQuery={q} theme={currentTheme} liveData={liveData} liveFund={liveFund} /></div>
            {selCo ? (
              <div ref={detailRef}>
                {/* Selected company indicator bar */}
                <div style={{
                  marginTop: sp(10), marginBottom: sp(8), padding: sp("7px 12px"),
                  background: T.bg1, borderRadius: RADII.md, border: "1px solid rgba(0,0,0,.06)",
                  boxShadow: "0 2px 8px rgba(0,0,0,.04)",
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  animation: "fadeIn 0.2s ease",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <Logo ticker={selCo.t} size={20} />
                    <span style={{ fontSize: fs(11), fontWeight: FONT_WEIGHTS.regular, color: VX[selCo.v].c }}>{selCo.cc} {selCo.t}</span>
                    <span style={{ fontSize: fs(11), color: T.textDim }}>{selCo.nm}</span>
                    <span style={{ fontSize: fs(11), color: T.textMuted }}>&middot; {VX[selCo.v].n}</span>
                  </div>
                  <button onClick={() => setSel(null)} style={{
                    background: T.bg1, border: "1px solid rgba(0,0,0,.08)", borderRadius: RADII.sm,
                    padding: sp("3px 8px"), fontSize: fs(11), color: T.textDim, cursor: "pointer",
                  }}>✕ Close</button>
                </div>
                <Detail co={selCo} onClose={() => setSel(null)} onSelect={setSel} liveData={liveData} liveHist={liveHist} apiKey={apiKey} onJumpToTrade={onJumpToTrade} />
              </div>
            ) : (
              <MarketSummary onFilterVertical={setVf} onSelect={setSel} theme={currentTheme} liveData={liveData} liveFund={liveFund} />
            )}
          </div>
        )}

        {view === "comps" && (
          <div className="ra-panel-enter" style={{ animation: "fadeIn 0.3s ease" }}>
            <Comps cos={cos} sel={sel} onSel={setSel} />
            {selCo && <div ref={detailRef} style={{ marginTop: sp(12) }}><Detail co={selCo} onClose={() => setSel(null)} onSelect={setSel} liveData={liveData} liveHist={liveHist} apiKey={apiKey} onJumpToTrade={onJumpToTrade} /></div>}
          </div>
        )}

        {view === "macro" && (
          <div className="ra-panel-enter" style={{ animation: "fadeIn 0.3s ease" }}>
            <Heatmap cos={cos} sel={sel} onSel={setSel} onFilterVertical={setVf} theme={currentTheme} />
            {selCo && <div ref={detailRef} style={{ marginTop: sp(12) }}><Detail co={selCo} onClose={() => setSel(null)} onSelect={setSel} liveData={liveData} liveHist={liveHist} apiKey={apiKey} onJumpToTrade={onJumpToTrade} /></div>}
          </div>
        )}
        </>)}
      </div>
    </div>
  );
}
