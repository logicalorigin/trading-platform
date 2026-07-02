// Standalone (untracked) probe: best timeHorizon per interval, live-UI baseline, 90-day SPY.
//
// For each interval we generate THAT interval's own buy/sell signal events at each candidate
// timeHorizon (holding the rest at the live charts/signals default: BOS wicks, CHoCH 0), then
// measure the forward, direction-adjusted return after every signal over k interval-bars.
// "Best" = highest |t-stat| of the per-signal return distribution (with a sample-size floor).
//
//   node --import tsx horizon-90d-probe.ts
import { pool } from "@workspace/db";
import { DEFAULT_PYRUS_SIGNALS_SIGNAL_SETTINGS } from "@workspace/pyrus-signals-core";
import { computeDirectionEvents } from "./src/pattern-discovery";

const SYMBOL = "SPY";
const LOAD_FROM = "2026-01-10T00:00:00Z"; // warmup before the study window
const STUDY_FROM = new Date("2026-02-14T00:00:00Z"); // ~90 calendar days before last bar
const INTERVALS = ["1m", "2m", "5m", "15m", "1h"];
const GRID = Array.from({ length: 19 }, (_, i) => i + 2); // 2,3,4,...,20
const FWD = [3, 6, 12]; // forward measurement, in interval-bars
const PRIMARY_K = 6;
const MIN_N = 15;

const minutesOf = (tf: string) => ({ "1m": 1, "2m": 2, "5m": 5, "15m": 15, "1h": 60 })[tf]!;

type Bar = { t: number; o: number; h: number; l: number; c: number; v: number };

async function load1m(symbol: string): Promise<Bar[]> {
  const { rows } = await pool.query(
    `select b.starts_at, b.open, b.high, b.low, b.close, b.volume
       from historical_bars b
       join historical_bar_datasets ds on ds.id = b.dataset_id
      where ds.symbol = $1 and ds.timeframe = '1m' and b.starts_at >= $2
      order by b.starts_at asc`,
    [symbol, LOAD_FROM],
  );
  const seen = new Set<number>();
  const out: Bar[] = [];
  for (const r of rows) {
    const t = new Date(r.starts_at).getTime();
    if (seen.has(t)) continue;
    seen.add(t);
    out.push({ t, o: +r.open, h: +r.high, l: +r.low, c: +r.close, v: +r.volume });
  }
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
    else {
      e.h = Math.max(e.h, b.h);
      e.l = Math.min(e.l, b.l);
      e.c = b.c;
      e.v += b.v;
    }
  }
  return [...buckets.values()].sort((a, b) => a.t - b.t);
}

function stats(xs: number[]) {
  const n = xs.length;
  if (n === 0) return { n: 0, mean: 0, win: 0, std: 0, t: 0 };
  const mean = xs.reduce((s, x) => s + x, 0) / n;
  const win = (xs.filter((x) => x > 0).length / n) * 100;
  const variance = xs.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, n - 1);
  const std = Math.sqrt(variance);
  const t = std > 1e-12 ? mean / (std / Math.sqrt(n)) : 0;
  return { n, mean, win, std, t };
}

type Row = {
  interval: string;
  h: number;
  signals: number;
  byK: Record<number, ReturnType<typeof stats>>;
};

async function main() {
  const bars1m = (await load1m(SYMBOL)).filter((b) => b.c > 0);
  const studyMs = STUDY_FROM.getTime();
  const results: Row[] = [];

  for (const tf of INTERVALS) {
    const tfBars = aggregate(bars1m, minutesOf(tf));
    for (const h of GRID) {
      const settings = {
        ...DEFAULT_PYRUS_SIGNALS_SIGNAL_SETTINGS,
        timeHorizon: h,
        bosConfirmation: "wicks" as const,
        chochAtrBuffer: 0,
      };
      // BacktestBar shape: { startsAt: Date, open, high, low, close, volume }
      const events = computeDirectionEvents(
        tfBars.map((b) => ({
          startsAt: new Date(b.t),
          open: b.o,
          high: b.h,
          low: b.l,
          close: b.c,
          volume: b.v,
        })),
        settings,
      );
      const idxByTime = new Map<number, number>();
      tfBars.forEach((b, i) => idxByTime.set(b.t, i));
      const retsByK: Record<number, number[]> = Object.fromEntries(FWD.map((k) => [k, []]));
      let signals = 0;
      for (const ev of events) {
        if (ev.timeMs < studyMs) continue;
        // events carry the interval bar's own time; map directly
        const idx = idxByTime.has(ev.timeMs) ? idxByTime.get(ev.timeMs)! : -1;
        if (idx < 0) continue;
        signals++;
        const entry = tfBars[idx].c;
        for (const k of FWD) {
          const j = idx + k;
          if (j >= tfBars.length) continue;
          const raw = (tfBars[j].c - entry) / entry;
          const dir = ev.direction === "buy" ? 1 : -1;
          retsByK[k].push(dir * raw * 100);
        }
      }
      results.push({
        interval: tf,
        h,
        signals,
        byK: Object.fromEntries(FWD.map((k) => [k, stats(retsByK[k])])),
      });
    }
  }

  // report
  console.log(`\n# Best timeHorizon per interval — ${SYMBOL}, 90-day window`);
  console.log(`study from ${STUDY_FROM.toISOString()} | live-UI base (BOS wicks, CHoCH 0) | primary k=${PRIMARY_K} bars\n`);
  for (const tf of INTERVALS) {
    const rows = results.filter((r) => r.interval === tf);
    console.log(`\n## ${tf}`);
    console.log("  H   signals    n   meanRet%(k6)  win%(k6)  t(k6)   meanRet%(k3)  meanRet%(k12)");
    for (const r of rows) {
      const p = r.byK[PRIMARY_K];
      const k3 = r.byK[3];
      const k12 = r.byK[12];
      const star = r.h === 8 ? "*" : " ";
      console.log(
        `${star} ${String(r.h).padStart(2)}  ${String(r.signals).padStart(6)}  ${String(p.n).padStart(4)}  ${p.mean.toFixed(4).padStart(11)}  ${p.win.toFixed(1).padStart(7)}  ${p.t.toFixed(2).padStart(6)}  ${k3.mean.toFixed(4).padStart(11)}  ${k12.mean.toFixed(4).padStart(11)}`,
      );
    }
    // pick best by |t| at primary k with sample floor
    const elig = rows.filter((r) => r.byK[PRIMARY_K].n >= MIN_N);
    const best = (elig.length ? elig : rows).slice().sort(
      (a, b) => Math.abs(b.byK[PRIMARY_K].t) - Math.abs(a.byK[PRIMARY_K].t),
    )[0];
    const base = rows.find((r) => r.h === 8)!;
    console.log(
      `  -> BEST H=${best.h} (t=${best.byK[PRIMARY_K].t.toFixed(2)}, mean=${best.byK[PRIMARY_K].mean.toFixed(4)}%, n=${best.byK[PRIMARY_K].n})` +
        `  vs default H=8 (t=${base.byK[PRIMARY_K].t.toFixed(2)}, mean=${base.byK[PRIMARY_K].mean.toFixed(4)}%, n=${base.byK[PRIMARY_K].n})`,
    );
  }
  console.log("\nDONE");
  await pool.end();
}

main().catch(async (e) => {
  console.error("PROBE FAILED:", e);
  await pool.end();
  process.exit(1);
});
