/**
 * Offline replay verification: would SELL entries fire under the FIXED code?
 *
 * Replays 2026-07-02 afternoon (hard sell-off names) through the exact
 * production paths:
 *   1. evaluateSignalMonitorMatrixStateFromCompletedBars (matrix cell trend)
 *      per frame 1m/2m/5m  -> the values getTrendDirectionsForSymbol would
 *      serve the live entry gate on Monday.
 *   2. evaluateSignalOptionsEntryGate with those directions + a sell candidate
 *      (deployment config: frames [1m,2m,5m], requiredCount=3).
 * Contrast: OLD unguarded rule (regime[last] ?? trend[last], bullish seed) and
 * the observed pre-fix production lanes ([_, buy, buy]).
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
const CUTOFF = new Date("2026-07-02T19:30:00Z"); // 15:30 ET, mid sell-off
const EVALUATED_AT = new Date("2026-07-02T19:31:00Z");
const DECLINERS = ["AXTX", "GLWG", "AAOG", "AAOX", "MVLL", "VICR", "RGC", "UCTT", "ACLS", "ARQQ"];
const GAINERS = ["TSLQ", "SLS", "GPC"];

type Row = { starts_at: Date; open: string; high: string; low: string; close: string; volume: string };

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
    open: Number(r.open),
    high: Number(r.high),
    low: Number(r.low),
    close: Number(r.close),
    volume: Number(r.volume),
  }));
}

// Aggregate 1m rows to 2m bars aligned on even-2-minute boundaries (mirrors
// production timeframe aggregation semantics: OHLC rollup, summed volume).
function aggregateTo2m(rows: Row[]): Row[] {
  const out: Row[] = [];
  let bucket: Row | null = null;
  let bucketKey = -1;
  for (const r of rows) {
    const t = new Date(r.starts_at).getTime();
    const key = Math.floor(t / 120_000);
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

function oldRuleDirection(bars: Row[], settingsRaw: Record<string, unknown>): string {
  // Pre-fix rule: trust regimeDirection[last] ?? trendDirection[last] with no
  // warmup guard (arrays are seeded bullish = 1).
  const settings = resolvePyrusSignalsSignalSettings(settingsRaw);
  const chartBars = bars.map((r) => ({
    time: Math.floor(new Date(r.starts_at).getTime() / 1000),
    o: Number(r.open), h: Number(r.high), l: Number(r.low), c: Number(r.close), v: Number(r.volume),
  }));
  const ev = evaluatePyrusSignalsSignals({ chartBars, settings } as Parameters<typeof evaluatePyrusSignalsSignals>[0]);
  const last = chartBars.length - 1;
  const raw = (ev.regimeDirection?.[last] ?? ev.trendDirection?.[last]) as number | undefined;
  const dir = raw == null || raw === 0 ? null : raw > 0 ? 1 : -1;
  return `${dir === 1 ? "bullish" : dir === -1 ? "bearish" : "null"}${ev.trendBasisComputable ? "" : " (UNWARMED-SEED)"}`;
}

async function main() {
  const profRes = await db.execute(sql`
    select id, environment, timeframe, pyrus_signals_settings, fresh_window_bars
    from signal_monitor_profiles where id = ${SHADOW_PROFILE_ID}
  `);
  const prow = profRes.rows[0] as Record<string, unknown>;
  const profile = {
    id: prow.id,
    environment: prow.environment,
    timeframe: prow.timeframe,
    pyrusSignalsSettings: prow.pyrus_signals_settings,
    freshWindowBars: prow.fresh_window_bars,
  } as unknown as Parameters<typeof evaluateSignalMonitorMatrixStateFromCompletedBars>[0]["profile"];
  const settingsRaw = prow.pyrus_signals_settings as Record<string, unknown>;

  const execProfile = resolveSignalOptionsExecutionProfile({
    entryGate: {
      mtfAlignment: { enabled: true, requiredCount: 3, timeframes: ["1m", "2m", "5m"] },
    },
  });

  const header = ["symbol", "kind", "1m(new/old)", "2m(new/old)", "5m(new/old)", "statuses", "SELL gate", "BUY gate"];
  const lines: string[][] = [header];

  for (const symbol of [...DECLINERS.map(s => [s, "DECLINER"] as const), ...GAINERS.map(s => [s, "GAINER"] as const)]) {
    const [sym, kind] = symbol;
    const oneMin = await loadBars(sym, "1m", 480);
    const fiveMin = await loadBars(sym, "5m", 240);
    const frames: Record<string, Row[]> = {
      "1m": oneMin.slice(-240),
      "2m": aggregateTo2m(oneMin).slice(-240),
      "5m": fiveMin,
    };
    const dirs: Record<string, "buy" | "sell" | null> = {};
    const cells: string[] = [];
    const statuses: string[] = [];
    for (const tf of ["1m", "2m", "5m"] as const) {
      const rows = frames[tf];
      if (!rows.length) { dirs[tf] = null; cells.push("nobars"); statuses.push("-"); continue; }
      const state = evaluateSignalMonitorMatrixStateFromCompletedBars({
        profile, symbol: sym, timeframe: tf, evaluatedAt: EVALUATED_AT,
        completedBars: toSnapshot(rows) as never,
      });
      const snap = (state as { indicatorSnapshot?: { trendDirection?: string | null } }).indicatorSnapshot;
      const newTrend = snap?.trendDirection ?? null;
      const status = (state as { status?: string }).status ?? "?";
      // production gate mapping: trendDirection only when status === "ok"
      dirs[tf] = status === "ok" ? (newTrend === "bullish" ? "buy" : newTrend === "bearish" ? "sell" : null) : null;
      cells.push(`${newTrend ?? "null"} / ${oldRuleDirection(rows, settingsRaw)}`);
      statuses.push(`${tf}:${status}`);
    }

    const mkCandidate = (direction: "buy" | "sell") => ({
      id: `replay-${sym}`, symbol: sym, direction,
      optionRight: direction === "sell" ? "put" : "call",
      signal: { filterState: { mtfDirections: [0, 0, 0], adx: 30 } },
    }) as unknown as Parameters<typeof evaluateSignalOptionsEntryGate>[0]["candidate"];

    const gate = (direction: "buy" | "sell") => {
      const g = evaluateSignalOptionsEntryGate({
        candidate: mkCandidate(direction),
        profile: execProfile,
        mtfTimeframeDirections: { "1m": dirs["1m"], "2m": dirs["2m"], "5m": dirs["5m"] },
        mtfTimeframes: ["1m", "2m", "5m"],
      });
      return g.ok ? "PASS" : `blocked(${g.reason})`;
    };

    lines.push([sym, kind, cells[0], cells[1], cells[2], statuses.join(" "), gate("sell"), gate("buy")]);
  }

  const widths = header.map((_, i) => Math.max(...lines.map((l) => l[i].length)));
  for (const l of lines) {
    console.log(l.map((c, i) => c.padEnd(widths[i] + 2)).join(""));
  }

  // Observed pre-fix production lanes for contrast: [null, buy, buy]
  const prefixGate = evaluateSignalOptionsEntryGate({
    candidate: { id: "x", symbol: "ANY", direction: "sell", optionRight: "put", signal: { filterState: { mtfDirections: [0, 0, 0], adx: 30 } } } as never,
    profile: execProfile,
    mtfTimeframeDirections: { "1m": null, "2m": "buy", "5m": "buy" },
    mtfTimeframes: ["1m", "2m", "5m"],
  });
  console.log(`\nPre-fix observed lanes [null,buy,buy] -> SELL gate: ${prefixGate.ok ? "PASS" : `blocked(${prefixGate.reason})`} (production reality July 2)`);
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
