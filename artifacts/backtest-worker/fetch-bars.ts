// Phase 1: fetch 1m bars per ticker per day from the live API (massive-history),
// filter each response to the requested day, write compact JSON per ticker.
// Resumable: skips tickers whose JSON already exists. conc 6 + priority header (429-safe).
//   node --import tsx fetch-bars.ts
import { mkdirSync, existsSync, writeFileSync } from "node:fs";

const API = "http://127.0.0.1:8080/api/bars";
const OUT = process.env.BARS_DIR!;
const TICKERS = process.env.PYRUS_TICKERS!.split(",").map((s) => s.trim()).filter(Boolean);
const FROM = "2026-01-12";
const TO = "2026-05-15";
const CONC = 6;
const HEADERS = { "x-pyrus-fetch-priority": "high", "x-pyrus-request-family": "backtest" };

function weekdays(a: string, b: string): string[] {
  const out: string[] = []; const d = new Date(a + "T00:00:00Z"); const e = new Date(b + "T00:00:00Z");
  while (d <= e) { const w = d.getUTCDay(); if (w !== 0 && w !== 6) out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); }
  return out;
}
async function fetchDay(symbol: string, day: string): Promise<number[][]> {
  const url = `${API}?symbol=${symbol}&timeframe=1m&from=${day}T13:30:00Z&to=${day}T20:00:00Z&limit=50000&allowHistoricalSynthesis=true&allowStudyFallback=true`;
  for (let a = 0; a < 5; a++) {
    try {
      const r = await fetch(url, { headers: HEADERS });
      if (r.status === 429) { await new Promise((s) => setTimeout(s, 500 * (a + 1))); continue; }
      if (!r.ok) { await new Promise((s) => setTimeout(s, 300 * (a + 1))); continue; }
      const j = (await r.json()) as { bars?: any[] };
      return (j.bars ?? [])
        .filter((b) => typeof b.timestamp === "string" && b.timestamp.slice(0, 10) === day && +b.close > 0)
        .map((b) => [new Date(b.timestamp).getTime(), +b.open, +b.high, +b.low, +b.close, +b.volume]);
    } catch { await new Promise((s) => setTimeout(s, 400 * (a + 1))); }
  }
  return [];
}
async function pool<T, R>(items: T[], conc: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(conc, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}
async function main() {
  mkdirSync(OUT, { recursive: true });
  const days = weekdays(FROM, TO);
  for (const symbol of TICKERS) {
    const path = `${OUT}/${symbol}.json`;
    if (existsSync(path)) { console.error(`skip ${symbol} (exists)`); continue; }
    const t0 = Date.now();
    const dayBars = await pool(days, CONC, (d) => fetchDay(symbol, d));
    const bars = dayBars.flat().sort((a, b) => a[0] - b[0]);
    writeFileSync(path, JSON.stringify(bars));
    console.error(`${symbol}: ${bars.length} 1m bars in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  console.error("FETCH DONE");
}
main().catch((e) => { console.error("FETCH FAILED:", e); process.exit(1); });
