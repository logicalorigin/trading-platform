/**
 * Attribution replay: on real 2026-07-02 afternoon bars, how many SELL entries
 * would the entry gate admit under each of four configs:
 *   trend rule   in {OLD bullish-seed, NEW trendBasisComputable-guarded}
 *   requiredCount in {2, 3}
 *
 * Purpose: split the zero-sells drought between (a) the trend-basis bug that
 * marked the book false-bullish and (b) the strict unanimous (reqCount=3) gate
 * on a matrix that skews bullish. Deterministic; no waiting for Monday's market.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import {
  evaluatePyrusSignalsSignals,
  resolvePyrusSignalsSignalSettings,
} from "@workspace/pyrus-signals-core";
import { evaluateSignalMonitorMatrixStateFromCompletedBars } from "./signal-monitor";
import { __signalOptionsAutomationInternalsForTests } from "./signal-options-automation";
import { resolveSignalOptionsExecutionProfile } from "@workspace/backtest-core";

const { evaluateSignalOptionsEntryGate } = __signalOptionsAutomationInternalsForTests;

const SHADOW_PROFILE_ID = "a5721cf5-16e1-4221-81d1-f2064e997d98";
const CUTOFF = new Date("2026-07-02T19:55:00Z"); // 15:55 ET, near close of the sell-off

type Row = { starts_at: Date; open: string; high: string; low: string; close: string; volume: string };
type Dir = "buy" | "sell" | null;

async function loadBars(symbol: string, timeframe: string, limit: number): Promise<Row[]> {
  const res = await db.execute(sql`
    select starts_at, open, high, low, close, volume
    from bar_cache
    where symbol = ${symbol} and timeframe = ${timeframe} and source = 'massive-history'
      and starts_at <= ${CUTOFF}
    order by starts_at desc
    limit ${limit}
  `);
  return (res.rows as unknown as Row[]).reverse();
}

function toSnapshot(rows: Row[]) {
  return rows.map((r) => ({
    timestamp: new Date(r.starts_at),
    open: Number(r.open), high: Number(r.high), low: Number(r.low),
    close: Number(r.close), volume: Number(r.volume),
  }));
}

function aggregateTo2m(rows: Row[]): Row[] {
  const out: Row[] = [];
  let bucket: Row | null = null;
  let bucketKey = -1;
  for (const r of rows) {
    const key = Math.floor(new Date(r.starts_at).getTime() / 120_000);
    if (key !== bucketKey) {
      if (bucket) out.push(bucket);
      bucketKey = key;
      bucket = { ...r, starts_at: new Date(key * 120_000) as unknown as Date };
    } else if (bucket) {
      bucket.high = String(Math.max(Number(bucket.high), Number(r.high)));
      bucket.low = String(Math.min(Number(bucket.low), Number(r.low)));
      bucket.close = r.close;
      bucket.volume = String(Number(bucket.volume) + Number(r.volume));
    }
  }
  if (bucket) out.push(bucket);
  return out;
}

function oldRuleDir(bars: Row[], settingsRaw: Record<string, unknown>): { dir: Dir; warmed: boolean } {
  // Pre-fix rule: regimeDirection[last] ?? trendDirection[last], NO warmup guard
  // (arrays seeded bullish = 1). Mirrors production before the trendBasisComputable fix.
  const settings = resolvePyrusSignalsSignalSettings(settingsRaw);
  const chartBars = bars.map((r) => ({
    time: Math.floor(new Date(r.starts_at).getTime() / 1000),
    o: Number(r.open), h: Number(r.high), l: Number(r.low), c: Number(r.close), v: Number(r.volume),
  }));
  const ev = evaluatePyrusSignalsSignals({ chartBars, settings } as Parameters<typeof evaluatePyrusSignalsSignals>[0]);
  const last = chartBars.length - 1;
  const raw = (ev.regimeDirection?.[last] ?? ev.trendDirection?.[last]) as number | undefined;
  const dir: Dir = raw == null || raw === 0 ? null : raw > 0 ? "buy" : "sell";
  return { dir, warmed: Boolean(ev.trendBasisComputable) };
}

function gatePass(execProfile: unknown, dirs: Record<string, Dir>): boolean {
  const g = evaluateSignalOptionsEntryGate({
    candidate: {
      id: "x", symbol: "X", direction: "sell", optionRight: "put",
      signal: { filterState: { mtfDirections: [0, 0, 0], adx: 30 } },
    } as never,
    profile: execProfile as never,
    mtfTimeframeDirections: { "1m": dirs["1m"], "2m": dirs["2m"], "5m": dirs["5m"] },
    mtfTimeframes: ["1m", "2m", "5m"],
  });
  return Boolean(g.ok);
}

async function main() {
  const profRes = await db.execute(sql`
    select id, environment, timeframe, pyrus_signals_settings, fresh_window_bars
    from signal_monitor_profiles where id = ${SHADOW_PROFILE_ID}
  `);
  const prow = profRes.rows[0] as Record<string, unknown>;
  const profile = {
    id: prow.id, environment: prow.environment, timeframe: prow.timeframe,
    pyrusSignalsSettings: prow.pyrus_signals_settings, freshWindowBars: prow.fresh_window_bars,
  } as unknown as Parameters<typeof evaluateSignalMonitorMatrixStateFromCompletedBars>[0]["profile"];
  const settingsRaw = prow.pyrus_signals_settings as Record<string, unknown>;

  const profReq2 = resolveSignalOptionsExecutionProfile({
    entryGate: { mtfAlignment: { enabled: true, requiredCount: 2, timeframes: ["1m", "2m", "5m"] } },
  });
  const profReq3 = resolveSignalOptionsExecutionProfile({
    entryGate: { mtfAlignment: { enabled: true, requiredCount: 3, timeframes: ["1m", "2m", "5m"] } },
  });

  // Real biggest July-2 afternoon decliners (>=60 1m bars), computed from bar_cache.
  const declRes = await db.execute(sql`
    with day as (
      select symbol, count(*) as bars,
             (array_agg(close order by starts_at))[1] as first_close,
             (array_agg(close order by starts_at desc))[1] as last_close
      from bar_cache
      where timeframe='1m' and source='massive-history'
        and starts_at >= '2026-07-02T17:00:00Z' and starts_at <= '2026-07-02T20:00:00Z'
      group by symbol having count(*) >= 60
    )
    select symbol, round(((last_close::numeric - first_close::numeric)/nullif(first_close::numeric,0))*100, 2) as pct
    from day order by pct asc limit 40
  `);
  const decliners = (declRes.rows as Array<{ symbol: string; pct: string }>);

  const tally = {
    oldReq3: 0, oldReq2: 0, newReq3: 0, newReq2: 0,
    total: 0, flippedBullishToBearish: 0, unwarmedOldBullish: 0,
  };
  const rows: string[][] = [["symbol", "pct", "NEW 1m/2m/5m", "OLD 1m/2m/5m", "SELL new-r3", "new-r2", "old-r3", "old-r2"]];

  for (const { symbol, pct } of decliners) {
    const oneMin = await loadBars(symbol, "1m", 480);
    const fiveMin = await loadBars(symbol, "5m", 240);
    if (oneMin.length < 60) continue;
    const frames: Record<string, Row[]> = {
      "1m": oneMin.slice(-240),
      "2m": aggregateTo2m(oneMin).slice(-240),
      "5m": fiveMin,
    };
    const newDirs: Record<string, Dir> = {};
    const oldDirs: Record<string, Dir> = {};
    const newCells: string[] = [];
    const oldCells: string[] = [];
    for (const tf of ["1m", "2m", "5m"] as const) {
      const barsTf = frames[tf];
      if (!barsTf.length) { newDirs[tf] = null; oldDirs[tf] = null; newCells.push("-"); oldCells.push("-"); continue; }
      const state = evaluateSignalMonitorMatrixStateFromCompletedBars({
        profile, symbol, timeframe: tf, evaluatedAt: CUTOFF, completedBars: toSnapshot(barsTf) as never,
      });
      const snap = (state as { indicatorSnapshot?: { trendDirection?: string | null } }).indicatorSnapshot;
      const status = (state as { status?: string }).status ?? "?";
      const nt = snap?.trendDirection ?? null;
      newDirs[tf] = status === "ok" ? (nt === "bullish" ? "buy" : nt === "bearish" ? "sell" : null) : null;
      newCells.push(nt === "bullish" ? "B" : nt === "bearish" ? "S" : status !== "ok" ? `x(${status})` : "0");

      const old = oldRuleDir(barsTf, settingsRaw);
      oldDirs[tf] = old.dir;
      oldCells.push(`${old.dir === "buy" ? "B" : old.dir === "sell" ? "S" : "0"}${old.warmed ? "" : "~"}`);
      if (!old.warmed && old.dir === "buy") tally.unwarmedOldBullish++;
      if (old.dir === "buy" && newDirs[tf] === "sell") tally.flippedBullishToBearish++;
    }
    tally.total++;
    const nr3 = gatePass(profReq3, newDirs), nr2 = gatePass(profReq2, newDirs);
    const or3 = gatePass(profReq3, oldDirs), or2 = gatePass(profReq2, oldDirs);
    if (nr3) tally.newReq3++; if (nr2) tally.newReq2++; if (or3) tally.oldReq3++; if (or2) tally.oldReq2++;
    rows.push([symbol, pct, newCells.join(""), oldCells.join(""),
      nr3 ? "PASS" : "-", nr2 ? "PASS" : "-", or3 ? "PASS" : "-", or2 ? "PASS" : "-"]);
  }

  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => (r[i] ?? "").length)));
  for (const r of rows) console.log(r.map((c, i) => (c ?? "").padEnd(widths[i] + 2)).join(""));
  console.log("\nLegend: B=bullish S=bearish 0=null/flat ~=unwarmed-seed x=non-ok-status");
  console.log(`\n=== SELL-gate PASS tally over ${tally.total} real July-2 decliners ===`);
  console.log(`  OLD trend rule:  requiredCount=3 -> ${tally.oldReq3}    requiredCount=2 -> ${tally.oldReq2}`);
  console.log(`  NEW trend rule:  requiredCount=3 -> ${tally.newReq3}    requiredCount=2 -> ${tally.newReq2}`);
  console.log(`  frames flipped false-bullish(old) -> bearish(new): ${tally.flippedBullishToBearish}`);
  console.log(`  frames old-rule bullish from UNWARMED seed: ${tally.unwarmedOldBullish}`);
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
