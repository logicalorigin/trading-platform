// Pooled per-interval timeHorizon scan across many tickers, 90-day window.
// Fetches 1m bars per ticker per day from the live API (massive-history), filters each
// response to the requested day (drops live tail), aggregates to each interval, then for
// every horizon 2..20 measures forward direction-adjusted return after each signal, POOLED
// across all tickers. "Best" = highest positive t-stat at k=6 interval-bars (with sample floor).
//
//   PYRUS_TICKERS=SPY,QQQ node --import tsx horizon-50tickers.ts
import { DEFAULT_PYRUS_SIGNALS_SIGNAL_SETTINGS } from "@workspace/pyrus-signals-core";
import { computeDirectionEvents } from "./src/pattern-discovery";

const API = "http://127.0.0.1:8080/api/bars";
const DEFAULT_TICKERS = [
  "SPY","QQQ","IWM","DIA","AAPL","MSFT","NVDA","AMZN","GOOGL","META",
  "TSLA","AMD","NFLX","AVGO","JPM","BAC","WFC","GS","MS","V",
  "MA","XOM","CVX","JNJ","UNH","LLY","PFE","KO","PEP","WMT",
  "COST","HD","DIS","CSCO","INTC","ORCL","CRM","ADBE","QCOM","TXN",
  "MU","BA","CAT","GE","F","GM","T","VZ","PLTR","COIN",
];
const TICKERS = (process.env.PYRUS_TICKERS ?? DEFAULT_TICKERS.join(","))
  .split(",").map((s) => s.trim()).filter(Boolean);

const LOAD_FROM = "2026-01-12"; // warmup before study window
const STUDY_FROM_MS = new Date("2026-02-14T00:00:00Z").getTime();
const END = "2026-05-15";
const INTERVALS = ["1m", "2m", "5m", "15m", "1h"];
const GRID = Array.from({ length: 19 }, (_, i) => i + 2); // 2..20
const K = 6; // forward bars
const MIN_N = 30;
const FETCH_CONC = 10;

const minutesOf = (tf: string) => ({ "1m": 1, "2m": 2, "5m": 5, "15m": 15, "1h": 60 })[tf]!;
type Bar = { t: number; o: number; h: number; l: number; c: number; v: number };

function weekdays(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(from + "T00:00:00Z");
  const end = new Date(to + "T00:00:00Z");
  while (d <= end) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

async function fetchDay(symbol: string, day: string): Promise<Bar[]> {
  const url = `${API}?symbol=${symbol}&timeframe=1m&from=${day}T13:30:00Z&to=${day}T20:00:00Z&limit=50000&allowHistoricalSynthesis=true&allowStudyFallback=true`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(String(r.status));
      const j = (await r.json()) as { bars?: any[] };
      return (j.bars ?? [])
        .filter((b) => typeof b.timestamp === "string" && b.timestamp.slice(0, 10) === day)
        .map((b) => ({
          t: new Date(b.timestamp).getTime(),
          o: +b.open, h: +b.high, l: +b.low, c: +b.close, v: +b.volume,
        }))
        .filter((b) => b.c > 0);
    } catch {
      await new Promise((res) => setTimeout(res, 300 * (attempt + 1)));
    }
  }
  return [];
}

async function pool<T, R>(items: T[], conc: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(conc, items.length) }, worker));
  return out;
}

function aggregate(bars: Bar[], minutes: number): Bar[] {
  if (minutes === 1) return bars;
  const ms = minutes * 60_000;
  const buckets = new Map<number, Bar>();
  for (const b of bars) {
    const k = Math.floor(b.t / ms) * ms;
    const e = buckets.get(k);
    if (!e) buckets.set(k, { t: k, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v });
    else { e.h = Math.max(e.h, b.h); e.l = Math.min(e.l, b.l); e.c = b.c; e.v += b.v; }
  }
  return [...buckets.values()].sort((a, b) => a.t - b.t);
}

function stats(xs: number[]) {
  const n = xs.length;
  if (n === 0) return { n: 0, mean: 0, win: 0, t: 0 };
  const mean = xs.reduce((s, x) => s + x, 0) / n;
  const win = (xs.filter((x) => x > 0).length / n) * 100;
  const v = xs.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, n - 1);
  const std = Math.sqrt(v);
  const t = std > 1e-12 ? mean / (std / Math.sqrt(n)) : 0;
  return { n, mean, win, t };
}

async function main() {
  const days = weekdays(LOAD_FROM, END);
  console.error(`tickers=${TICKERS.length} days=${days.length} (fetch ~${TICKERS.length * days.length} reqs)`);

  // pooled returns per interval/horizon
  const pooled: Record<string, Record<number, number[]>> = {};
  for (const tf of INTERVALS) { pooled[tf] = {}; for (const h of GRID) pooled[tf][h] = []; }

  let done = 0;
  for (const symbol of TICKERS) {
    const dayBars = await pool(days, FETCH_CONC, (d) => fetchDay(symbol, d));
    const bars1m = dayBars.flat().sort((a, b) => a.t - b.t);
    if (bars1m.length === 0) { console.error(`  ${symbol}: NO DATA`); continue; }
    for (const tf of INTERVALS) {
      const tfBars = aggregate(bars1m, minutesOf(tf));
      const idxByTime = new Map<number, number>();
      tfBars.forEach((b, i) => idxByTime.set(b.t, i));
      const bcBars = tfBars.map((b) => ({
        startsAt: new Date(b.t), open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v,
      }));
      for (const h of GRID) {
        const settings = {
          ...DEFAULT_PYRUS_SIGNALS_SIGNAL_SETTINGS,
          timeHorizon: h, bosConfirmation: "wicks" as const, chochAtrBuffer: 0,
        };
        const events = computeDirectionEvents(bcBars, settings);
        for (const ev of events) {
          if (ev.timeMs < STUDY_FROM_MS) continue;
          const idx = idxByTime.get(ev.timeMs);
          if (idx == null) continue;
          const j = idx + K;
          if (j >= tfBars.length) continue;
          const entry = tfBars[idx].c;
          const raw = (tfBars[j].c - entry) / entry;
          pooled[tf][h].push((ev.direction === "buy" ? 1 : -1) * raw * 100);
        }
      }
    }
    done++;
    console.error(`  [${done}/${TICKERS.length}] ${symbol}: ${bars1m.length} 1m bars`);
  }

  // report
  const lines: string[] = [];
  lines.push(`# Pooled best timeHorizon per interval — ${TICKERS.length} tickers, 90-day window`);
  lines.push(`study from 2026-02-14 .. ${END} | live-UI base (BOS wicks, CHoCH 0) | k=${K} bars | t-stat\n`);
  lines.push("| Horizon | " + INTERVALS.join(" | ") + " |");
  lines.push("|---:|" + INTERVALS.map(() => "---:").join("|") + "|");
  const best: Record<string, { h: number; t: number; mean: number; n: number }> = {};
  const cell: Record<string, Record<number, ReturnType<typeof stats>>> = {};
  for (const tf of INTERVALS) cell[tf] = {};
  for (const h of GRID) {
    const row = [String(h)];
    for (const tf of INTERVALS) {
      const s = stats(pooled[tf][h]); cell[tf][h] = s;
      row.push(s.n ? s.t.toFixed(2) : "—");
      if (s.n >= MIN_N && (!best[tf] || s.t > best[tf].t)) best[tf] = { h, t: s.t, mean: s.mean, n: s.n };
    }
    lines.push("| " + (h === 8 ? "**8**" : String(h)) + " | " + row.slice(1).join(" | ") + " |");
  }
  lines.push("\n## Best horizon per interval (max positive t, n>=" + MIN_N + ")\n");
  lines.push("| Interval | Best H | t(k6) | mean% | n | H=8 t | H=8 mean% | H=8 n |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|---:|");
  for (const tf of INTERVALS) {
    const b = best[tf]; const d = cell[tf][8];
    lines.push(`| ${tf} | ${b ? b.h : "—"} | ${b ? b.t.toFixed(2) : "—"} | ${b ? b.mean.toFixed(4) : "—"} | ${b ? b.n : 0} | ${d.t.toFixed(2)} | ${d.mean.toFixed(4)} | ${d.n} |`);
  }
  console.log(lines.join("\n"));
  console.log("\nDONE");
}
main().catch((e) => { console.error("FAILED:", e); process.exit(1); });
