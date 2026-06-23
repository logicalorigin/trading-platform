// TEMP verification — real-data buy/sell breakout. Delete after.
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { resolvePyrusSignalsSignalSettings, type PyrusSignalsBar } from "@workspace/pyrus-signals-core";
import { computeSignalQualityKpis, type SignalQualityMtfConfig } from "./signal-quality-kpis";

const SYMBOLS = ["RKLB","TSLA","COIN","RBLX","DIA","AAPL","SQQQ","META","GOOGL","CRWV","ALAB","SPY","TQQQ","AMZN","HOOD","VXX","VIXY","TLT","USO","COHR","PLTR","IEF","UUP","VRT","NVDA","MSFT","SMCI","GLD","CRDO","LITE"];

async function loadBars(symbol: string, tf: string): Promise<PyrusSignalsBar[]> {
  const from = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const r = await db.execute(sql`select starts_at,open,high,low,close,volume from bar_cache where symbol=${symbol} and timeframe=${tf} and source='massive-history' and starts_at >= ${from} order by starts_at desc limit 720`);
  return (r.rows as Array<Record<string, unknown>>).map((x) => {
    const t = x.starts_at instanceof Date ? x.starts_at : new Date(String(x.starts_at));
    return { time: Math.floor(t.getTime() / 1000), ts: t.toISOString(), o: Number(x.open), h: Number(x.high), l: Number(x.low), c: Number(x.close), v: Number(x.volume) };
  }).sort((a, b) => a.time - b.time);
}

async function main() {
  const settings = resolvePyrusSignalsSignalSettings({ timeHorizon: 14, bosConfirmation: "close", chochAtrBuffer: 1, chochBodyExpansionAtr: 1, chochVolumeGate: 1 });
  const mtf: SignalQualityMtfConfig = { enabled: true, requiredCount: 2, timeframes: ["2m", "5m"] };
  const barsBySymbol: Record<string, PyrusSignalsBar[]> = {};
  for (const s of SYMBOLS) { const b = await loadBars(s, "15m"); if (b.length) barsBySymbol[s] = b; }
  const k = computeSignalQualityKpis({ settings, barsBySymbol, horizonBars: 14, mtf, sourceTimeframe: "15m" });
  const fmt = (m: { signalCount: number; avgDirectionalMovePercent: number; correctnessPercent: number; expectancyPercent: number; avgMfePercent: number; avgMaePercent: number }) =>
    `n=${m.signalCount} move=${m.avgDirectionalMovePercent.toFixed(2)}% correct=${m.correctnessPercent.toFixed(0)}% exp=${m.expectancyPercent.toFixed(2)}% mfe/mae=${m.avgMfePercent.toFixed(1)}/${m.avgMaePercent.toFixed(1)}`;
  console.log("OVERALL:", fmt(k));
  console.log("BUY   :", fmt(k.byDirection.buy));
  console.log("SELL  :", fmt(k.byDirection.sell));
  console.log("partition ok:", k.byDirection.buy.signalCount + k.byDirection.sell.signalCount === k.signalCount);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
