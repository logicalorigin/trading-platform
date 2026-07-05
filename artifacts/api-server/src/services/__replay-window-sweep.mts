/**
 * Window-size sweep: prove the zero-sells mechanism. basisLength=80, so
 * trendBasisComputable turns true only at >= 85 bars. Below that the OLD rule
 * falls back to the bullish seed (marks fallers bullish -> book-wide bullish ->
 * sells blocked); the NEW rule returns null (non-confirming, no false-buy).
 * Both converge to the true bearish trend once the basis warms.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import {
  evaluatePyrusSignalsSignals,
  resolvePyrusSignalsSignalSettings,
} from "@workspace/pyrus-signals-core";
import { evaluateSignalMonitorMatrixStateFromCompletedBars } from "./signal-monitor";

const SHADOW_PROFILE_ID = "a5721cf5-16e1-4221-81d1-f2064e997d98";
const CUTOFF = new Date("2026-07-02T19:55:00Z");
const SYMS = ["VICR", "CODX", "RGC", "STEX", "TROO", "ELTX"];
const WINDOWS = [40, 60, 80, 90, 120, 200, 240];

type Row = { starts_at: Date; open: string; high: string; low: string; close: string; volume: string };

async function loadBars(symbol: string): Promise<Row[]> {
  const res = await db.execute(sql`
    select starts_at, open, high, low, close, volume from bar_cache
    where symbol = ${symbol} and timeframe = '1m' and source = 'massive-history' and starts_at <= ${CUTOFF}
    order by starts_at desc limit 240`);
  return (res.rows as unknown as Row[]).reverse();
}
function toSnapshot(rows: Row[]) {
  return rows.map((r) => ({
    timestamp: new Date(r.starts_at), open: Number(r.open), high: Number(r.high),
    low: Number(r.low), close: Number(r.close), volume: Number(r.volume),
  }));
}
function oldRule(rows: Row[], settingsRaw: Record<string, unknown>) {
  const settings = resolvePyrusSignalsSignalSettings(settingsRaw);
  const chartBars = rows.map((r) => ({
    time: Math.floor(new Date(r.starts_at).getTime() / 1000),
    o: Number(r.open), h: Number(r.high), l: Number(r.low), c: Number(r.close), v: Number(r.volume),
  }));
  const ev = evaluatePyrusSignalsSignals({ chartBars, settings } as Parameters<typeof evaluatePyrusSignalsSignals>[0]);
  const last = chartBars.length - 1;
  const raw = (ev.regimeDirection?.[last] ?? ev.trendDirection?.[last]) as number | undefined;
  const dir = raw == null || raw === 0 ? "0" : raw > 0 ? "B" : "S";
  return { dir, warmed: Boolean(ev.trendBasisComputable) };
}

async function main() {
  const profRes = await db.execute(sql`
    select id, environment, timeframe, pyrus_signals_settings, fresh_window_bars
    from signal_monitor_profiles where id = ${SHADOW_PROFILE_ID}`);
  const prow = profRes.rows[0] as Record<string, unknown>;
  const profile = {
    id: prow.id, environment: prow.environment, timeframe: prow.timeframe,
    pyrusSignalsSettings: prow.pyrus_signals_settings, freshWindowBars: prow.fresh_window_bars,
  } as unknown as Parameters<typeof evaluateSignalMonitorMatrixStateFromCompletedBars>[0]["profile"];
  const settingsRaw = prow.pyrus_signals_settings as Record<string, unknown>;

  console.log("Each cell: NEW|OLD  (B=bullish S=bearish 0=null ~=basis-unwarmed)   basisLength=80 -> warms at >=85 bars\n");
  const header = ["symbol", ...WINDOWS.map((w) => `w=${w}`)];
  const rows: string[][] = [header];
  for (const sym of SYMS) {
    const all = await loadBars(sym);
    const cells = [sym];
    for (const w of WINDOWS) {
      const slice = all.slice(-w);
      if (slice.length < 5) { cells.push("-"); continue; }
      const state = evaluateSignalMonitorMatrixStateFromCompletedBars({
        profile, symbol: sym, timeframe: "1m", evaluatedAt: CUTOFF, completedBars: toSnapshot(slice) as never,
      });
      const snap = (state as { indicatorSnapshot?: { trendDirection?: string | null } }).indicatorSnapshot;
      const nt = snap?.trendDirection ?? null;
      const newC = nt === "bullish" ? "B" : nt === "bearish" ? "S" : "0";
      const old = oldRule(slice, settingsRaw);
      cells.push(`${newC}|${old.dir}${old.warmed ? "" : "~"}`);
    }
    rows.push(cells);
  }
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => (r[i] ?? "").length)));
  for (const r of rows) console.log(r.map((c, i) => (c ?? "").padEnd(widths[i] + 2)).join(""));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
