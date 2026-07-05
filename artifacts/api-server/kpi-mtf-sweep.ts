// Fast exec×mtf combination ranking via the signal-quality KPI engine (equity forward
// returns per MTF gate — NO option pricing). Mirrors signal-quality-kpis-service:
// loads base bars per exec frame, then scores every MTF gate with computeSignalQualityKpis.
import { pool } from "@workspace/db";
import { DEFAULT_PYRUS_SIGNALS_SIGNAL_SETTINGS } from "@workspace/pyrus-signals-core";
import { computeSignalQualityKpis } from "./src/services/signal-quality-kpis";
import { writeFileSync } from "node:fs";

// First 30 of the deployment universe (MAX_SYMBOLS=30 in the live service).
const SYMBOLS = [
  "SPY","NVDA","DIA","AAPL","MSFT","TSLA","TQQQ","SQQQ","AMZN","PLTR",
  "COIN","HOOD","RBLX","RKLB","SMCI","VXX","VIXY","TLT","IEF","UUP",
  "GLD","USO","META","GOOGL","CRWV","VRT","ALAB","CRDO","COHR","LITE",
];
// Distinct exec frames (1m collapses to 5m via previewTimeframeFor, so omit it).
const EXECS = ["2m", "5m", "15m", "1h"] as const;
// Live-UI baseline for everything EXCEPT timeHorizon, which is set per-exec to Track 1's
// optimal (best forward-return t-stat per interval) so we synthesize both studies.
const BASE_SETTINGS = {
  ...DEFAULT_PYRUS_SIGNALS_SIGNAL_SETTINGS,
  bosConfirmation: "wicks" as const,
  chochAtrBuffer: 0,
};
// Track 1 best timeHorizon per interval (horizon-result.md): 2m→4, 5m→19, 15m→8, 1h→2.
const EXEC_HORIZON: Record<string, number> = { "2m": 4, "5m": 19, "15m": 8, "1h": 2 };
const FROM = new Date("2026-04-21T00:00:00Z"); // ~6-week window (robust sample, bounded mtf-aggregation cost)
const LIMIT = 3000;

// The 13-gate catalog (mirrors buildMtfEntryGateVariants in the sweep tool).
const MTF: Array<{ id: string; enabled: boolean; timeframes: string[]; requiredCount: number }> = [
  { id: "no-mtf", enabled: false, timeframes: ["1m","2m","5m","15m","1h"], requiredCount: 1 },
  { id: "five-q1", enabled: true, timeframes: ["1m","2m","5m","15m","1h"], requiredCount: 1 },
  { id: "five-q2", enabled: true, timeframes: ["1m","2m","5m","15m","1h"], requiredCount: 2 },
  { id: "scalp-q2", enabled: true, timeframes: ["1m","2m","5m"], requiredCount: 2 },
  { id: "intraday-q2", enabled: true, timeframes: ["5m","15m","1h"], requiredCount: 2 },
  { id: "mixed-fast-hour-q2", enabled: true, timeframes: ["1m","5m","1h"], requiredCount: 2 },
  { id: "six-q2", enabled: true, timeframes: ["1m","2m","5m","15m","1h","1d"], requiredCount: 2 },
  { id: "six-q3", enabled: true, timeframes: ["1m","2m","5m","15m","1h","1d"], requiredCount: 3 },
  { id: "higher-q2", enabled: true, timeframes: ["15m","1h","1d"], requiredCount: 2 },
  { id: "higher-q3", enabled: true, timeframes: ["15m","1h","1d"], requiredCount: 3 },
  { id: "swing-q2", enabled: true, timeframes: ["5m","15m","1h","1d"], requiredCount: 2 },
  { id: "fast-daily-q2", enabled: true, timeframes: ["1m","5m","1h","1d"], requiredCount: 2 },
  { id: "hour-daily-q2", enabled: true, timeframes: ["1h","1d"], requiredCount: 2 },
];

type Bar = { time: number; o: number; h: number; l: number; c: number; v: number };

async function loadBars(symbol: string, timeframe: string): Promise<Bar[]> {
  const { rows } = await pool.query(
    `select starts_at, open, high, low, close, volume
       from bar_cache
      where symbol=$1 and timeframe=$2 and source='massive-history' and starts_at >= $3
      order by starts_at asc limit $4`,
    [symbol, timeframe, FROM, LIMIT],
  );
  return rows.map((r: any) => ({
    time: Math.floor(new Date(r.starts_at).getTime() / 1000),
    o: +r.open, h: +r.high, l: +r.low, c: +r.close, v: +r.volume,
  }));
}

type Row = {
  exec: string; mtf: string; signalCount: number; correctness: number;
  expectancy: number; payoff: number; mfe: number; mae: number; filtered: number;
};

async function main() {
  await pool.query("set statement_timeout='120s'");
  const rows: Row[] = [];
  for (const exec of EXECS) {
    const base = exec === "1m" ? "5m" : exec;
    process.stderr.write(`[exec ${exec}] loading ${SYMBOLS.length} symbols @ ${base} ...\n`);
    const barsBySymbol: Record<string, Bar[]> = {};
    let totalBars = 0;
    for (const s of SYMBOLS) {
      try {
        const b = await loadBars(s, base);
        if (b.length) { barsBySymbol[s] = b; totalBars += b.length; }
      } catch (e) { process.stderr.write(`  ${s}: ${(e as Error).message}\n`); }
    }
    const H = EXEC_HORIZON[exec] ?? 8;
    const settings = { ...BASE_SETTINGS, signalTimeframe: exec, timeHorizon: H } as any;
    process.stderr.write(`[exec ${exec}] loaded ${Object.keys(barsBySymbol).length} syms / ${totalBars} bars; H=${H}; scoring ${MTF.length} gates\n`);
    for (const m of MTF) {
      const k = computeSignalQualityKpis({
        settings,
        barsBySymbol: barsBySymbol as any,
        horizonBars: H,
        mtf: { enabled: m.enabled, requiredCount: m.requiredCount, timeframes: m.timeframes },
        sourceTimeframe: base,
      });
      rows.push({
        exec, mtf: m.id, signalCount: k.signalCount, correctness: k.correctnessPercent,
        expectancy: k.expectancyPercent, payoff: k.payoffRatio, mfe: k.avgMfePercent,
        mae: k.avgMaePercent, filtered: k.mtfFilteredOutCount,
      });
    }
  }
  await pool.end();

  const fmt = (n: number, d = 2) => (Number.isFinite(n) ? n.toFixed(d) : "—");
  const execs = [...new Set(rows.map((r) => r.exec))];
  const gates = [...new Set(rows.map((r) => r.mtf))];
  const L: string[] = [];
  L.push(`# exec×mtf signal-quality ranking — per-exec optimal horizon (Track1 ∘ Track2)`);
  L.push(`30 liquid syms | BOS wicks, CHoCH 0 | timeHorizon per exec: 2m→4, 5m→19, 15m→8, 1h→2 | window from ${FROM.toISOString().slice(0,10)}\n`);
  // Matrix: expectancy% by exec × gate
  L.push(`### Expectancy % — exec (rows) × MTF gate (cols)`);
  L.push(`| exec \\ gate | ${gates.join(" | ")} |`);
  L.push(`|---|${gates.map(() => "---:").join("|")}|`);
  for (const e of execs) {
    L.push(`| **${e}** | ` + gates.map((g) => {
      const c = rows.find((r) => r.exec === e && r.mtf === g);
      return c ? fmt(c.expectancy, 3) : "—";
    }).join(" | ") + " |");
  }
  // Global ranking
  const ranked = [...rows].filter((r) => r.signalCount >= 20)
    .sort((a, b) => b.expectancy - a.expectancy);
  L.push(`\n### Top combinations by expectancy % (signalCount ≥ 20)`);
  L.push(`| # | exec | gate | expectancy% | correctness% | payoff | signals | filteredOut |`);
  L.push(`|---:|---|---|---:|---:|---:|---:|---:|`);
  ranked.slice(0, 25).forEach((r, i) => {
    L.push(`| ${i+1} | ${r.exec} | ${r.mtf} | ${fmt(r.expectancy,3)} | ${fmt(r.correctness,1)} | ${fmt(r.payoff)} | ${r.signalCount} | ${r.filtered} |`);
  });
  // Best gate per exec
  L.push(`\n### Best gate per exec`);
  L.push(`| exec | best gate | expectancy% | correctness% | signals |`);
  L.push(`|---|---|---:|---:|---:|`);
  for (const e of execs) {
    const b = ranked.filter((r) => r.exec === e)[0];
    L.push(`| ${e} | ${b?.mtf ?? "—"} | ${b ? fmt(b.expectancy,3) : "—"} | ${b ? fmt(b.correctness,1) : "—"} | ${b?.signalCount ?? "—"} |`);
  }
  const md = L.join("\n");
  const OUT = "/home/runner/workspace/artifacts/backtest-worker/mtf-kpi-result-optH.md";
  writeFileSync(OUT, md + "\n");
  console.log(md);
  console.log(`\n[kpi-sweep] wrote ${OUT} | ${rows.length} combos`);
}
main().catch((e) => { console.error(e?.stack ?? e?.message ?? e); process.exit(1); });
