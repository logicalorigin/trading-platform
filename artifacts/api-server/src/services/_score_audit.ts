// TEMP audit: does the entry-quality score predict a signal's realized directional move?
// Read-only. Computes the signal-intrinsic score (MTF alignment + ADX trend; liquidity/riskFit
// at constant defaults, since they don't exist for a raw monitor signal) per persisted shadow
// signal, joins the realized forward return from bar_cache, and reports calibration + correlation.
// Delete after.
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { buildSignalForwardReturnDataset, type BacktestBar } from "@workspace/backtest-core";

const ENV = "shadow";
const TF = process.env.AUDIT_TF || "15m";
const HORIZON = Number(process.env.AUDIT_HORIZON || 8);
const SINCE_DAYS = 90;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// Mirror of the scorer's signal-intrinsic components (algoHelpers/classifySignalOptionsEntryQuality).
function scoreOf(mtfDirections: number[], adx: number | null, direction: "buy" | "sell") {
  const dirSign = direction === "buy" ? 1 : -1;
  const matches = mtfDirections.filter((d) => d === dirSign).length;
  const frames = Math.max(1, mtfDirections.length);
  const mtfAlignment = mtfDirections.length ? (matches / frames) * 25 : 8;
  const trendStrength = adx == null ? 7.5 : clamp(adx / 25, 0, 1) * 15;
  const liquidity = 12; // default (no contract historically)
  const riskFit = 5; // default (no orderPlan historically)
  const raw = mtfAlignment + trendStrength + liquidity + riskFit;
  return { score: raw * (100 / 70), mtfAlignment, trendStrength };
}

const pearson = (xs: number[], ys: number[]) => {
  const n = xs.length;
  if (n < 2) return NaN;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  return sxx === 0 || syy === 0 ? NaN : sxy / Math.sqrt(sxx * syy);
};

async function loadSignals() {
  const since = new Date(Date.now() - SINCE_DAYS * 86400000);
  const r = await db.execute(sql`
    select event_key, symbol, direction, signal_at, payload->'filterState' as filter_state
    from signal_monitor_events
    where environment = ${ENV} and timeframe = ${TF} and signal_at >= ${since}
      and payload->'filterState' ? 'mtfDirections'
    order by signal_at asc
  `);
  return (r.rows as Array<Record<string, unknown>>)
    .map((row) => {
      const dir = String(row.direction || "").toLowerCase();
      const direction = dir === "buy" ? "buy" : dir === "sell" ? "sell" : null;
      const fs = (row.filter_state || {}) as Record<string, unknown>;
      const mtf = Array.isArray(fs.mtfDirections) ? fs.mtfDirections.map(Number).filter(Number.isFinite) : [];
      const adx = Number.isFinite(Number(fs.adx)) ? Number(fs.adx) : null;
      const at = row.signal_at instanceof Date ? row.signal_at : new Date(String(row.signal_at));
      return direction ? { eventKey: String(row.event_key), symbol: String(row.symbol).toUpperCase(), direction, signalAt: at, mtf, adx } : null;
    })
    .filter(Boolean) as Array<{ eventKey: string; symbol: string; direction: "buy" | "sell"; signalAt: Date; mtf: number[]; adx: number | null }>;
}

async function loadBars(symbol: string, from: Date): Promise<BacktestBar[]> {
  const r = await db.execute(sql`
    select starts_at, open, high, low, close, volume from bar_cache
    where symbol = ${symbol} and timeframe = ${TF} and source = 'massive-history' and starts_at >= ${from}
    order by starts_at asc limit 12000
  `);
  return (r.rows as Array<Record<string, unknown>>).map((x) => ({
    startsAt: x.starts_at instanceof Date ? x.starts_at : new Date(String(x.starts_at)),
    open: Number(x.open), high: Number(x.high), low: Number(x.low), close: Number(x.close), volume: Number(x.volume),
  }));
}

async function main() {
  const signals = await loadSignals();
  const symbols = [...new Set(signals.map((s) => s.symbol))];
  const earliest = signals.length ? new Date(Math.min(...signals.map((s) => s.signalAt.getTime())) - 86400000) : new Date();

  // realized forward return per signal via buildSignalForwardReturnDataset, per symbol
  const realizedByKey = new Map<string, number>();
  for (const symbol of symbols) {
    const bars = await loadBars(symbol, earliest);
    if (!bars.length) continue;
    const symSignals = signals.filter((s) => s.symbol === symbol);
    const ds = buildSignalForwardReturnDataset({
      signals: symSignals.map((s) => ({
        signalId: s.eventKey,
        signalAt: s.signalAt,
        symbol,
        direction: s.direction === "buy" ? "long" : "short",
        score: 1, sourceStrategy: "audit", sourceProfile: ENV, sourceTimeframe: TF,
      })),
      barsBySymbol: { [symbol]: bars },
      horizonsBars: [HORIZON],
    });
    for (const rowD of ds.rows) {
      const w = rowD.windows.find((x) => x.horizonBars === HORIZON);
      if (w && w.status === "complete" && w.realizedReturnPercent != null) {
        realizedByKey.set(rowD.signalId, w.realizedReturnPercent);
      }
    }
  }

  const rows = signals
    .map((s) => {
      const realized = realizedByKey.get(s.eventKey);
      if (realized == null) return null;
      const { score, mtfAlignment, trendStrength } = scoreOf(s.mtf, s.adx, s.direction);
      return { score, mtfAlignment, trendStrength, realized, direction: s.direction };
    })
    .filter(Boolean) as Array<{ score: number; mtfAlignment: number; trendStrength: number; realized: number; direction: string }>;

  if (!rows.length) { console.log("no matured signals"); process.exit(0); }

  const scores = rows.map((r) => r.score);
  const rets = rows.map((r) => r.realized);
  console.log(`TF=${TF} horizon=${HORIZON}  signals(matured)=${rows.length}  scoreRange=[${Math.min(...scores).toFixed(1)}, ${Math.max(...scores).toFixed(1)}]`);
  console.log(`corr(score, realizedReturn)        = ${pearson(scores, rets).toFixed(3)}`);
  console.log(`corr(mtfAlignment, realizedReturn) = ${pearson(rows.map((r) => r.mtfAlignment), rets).toFixed(3)}`);
  console.log(`corr(trendStrength/adx, realized)  = ${pearson(rows.map((r) => r.trendStrength), rets).toFixed(3)}`);

  // Calibration: quintiles by score -> avg realized + win rate. Monotonic up = score works.
  const sorted = [...rows].sort((a, b) => a.score - b.score);
  const B = 5;
  console.log(`\nscore quintile | n | avgScore | avgRealized% | winRate% (realized>0)`);
  for (let b = 0; b < B; b++) {
    const slice = sorted.slice(Math.floor((b * sorted.length) / B), Math.floor(((b + 1) * sorted.length) / B));
    if (!slice.length) continue;
    const avgS = slice.reduce((a, r) => a + r.score, 0) / slice.length;
    const avgR = slice.reduce((a, r) => a + r.realized, 0) / slice.length;
    const win = (slice.filter((r) => r.realized > 0).length / slice.length) * 100;
    console.log(`  Q${b + 1}            | ${slice.length} | ${avgS.toFixed(1)} | ${avgR.toFixed(3)} | ${win.toFixed(1)}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
