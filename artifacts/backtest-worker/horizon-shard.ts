// Phase 2 (sharded): read pre-fetched ticker JSONs, compute pooled forward-return
// sufficient stats per (interval, horizon). Writes one JSON of {n,sum,sumsq,wins} per cell.
//   SHARD_TICKERS=AAPL,MSFT SHARD_ID=0 node --import tsx horizon-shard.ts
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { DEFAULT_PYRUS_SIGNALS_SIGNAL_SETTINGS } from "@workspace/pyrus-signals-core";
import { computeDirectionEvents } from "./src/pattern-discovery";

const BARS_DIR = process.env.BARS_DIR!;
const POOLED_DIR = process.env.POOLED_DIR!;
const SHARD_ID = process.env.SHARD_ID!;
const TICKERS = process.env.SHARD_TICKERS!.split(",").map((s) => s.trim()).filter(Boolean);
const STUDY_FROM_MS = new Date("2026-02-14T00:00:00Z").getTime();
const INTERVALS = ["1m", "2m", "5m", "15m", "1h"];
const GRID = Array.from({ length: 19 }, (_, i) => i + 2);
const K = 6;
const minutesOf = (tf: string) => ({ "1m": 1, "2m": 2, "5m": 5, "15m": 15, "1h": 60 })[tf]!;

type Bar = { t: number; o: number; h: number; l: number; c: number; v: number };
function aggregate(bars: Bar[], m: number): Bar[] {
  if (m === 1) return bars;
  const ms = m * 60_000; const bk = new Map<number, Bar>();
  for (const b of bars) {
    const k = Math.floor(b.t / ms) * ms; const e = bk.get(k);
    if (!e) bk.set(k, { t: k, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v });
    else { e.h = Math.max(e.h, b.h); e.l = Math.min(e.l, b.l); e.c = b.c; e.v += b.v; }
  }
  return [...bk.values()].sort((a, b) => a.t - b.t);
}

type Cell = { n: number; sum: number; sumsq: number; wins: number };
const acc: Record<string, Cell> = {};
for (const tf of INTERVALS) for (const h of GRID) acc[`${tf}|${h}`] = { n: 0, sum: 0, sumsq: 0, wins: 0 };

for (const symbol of TICKERS) {
  let raw: number[][];
  try { raw = JSON.parse(readFileSync(`${BARS_DIR}/${symbol}.json`, "utf8")); }
  catch { console.error(`  ${symbol}: no file`); continue; }
  if (!raw.length) { console.error(`  ${symbol}: empty`); continue; }
  const bars1m: Bar[] = raw.map((r) => ({ t: r[0], o: r[1], h: r[2], l: r[3], c: r[4], v: r[5] }));
  for (const tf of INTERVALS) {
    const tfBars = aggregate(bars1m, minutesOf(tf));
    const idxByTime = new Map<number, number>(); tfBars.forEach((b, i) => idxByTime.set(b.t, i));
    const bc = tfBars.map((b) => ({ startsAt: new Date(b.t), open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v }));
    for (const h of GRID) {
      const events = computeDirectionEvents(bc, { ...DEFAULT_PYRUS_SIGNALS_SIGNAL_SETTINGS, timeHorizon: h, bosConfirmation: "wicks", chochAtrBuffer: 0 });
      const cell = acc[`${tf}|${h}`];
      for (const ev of events) {
        if (ev.timeMs < STUDY_FROM_MS) continue;
        const idx = idxByTime.get(ev.timeMs); if (idx == null) continue;
        const j = idx + K; if (j >= tfBars.length) continue;
        const r = ((tfBars[j].c - tfBars[idx].c) / tfBars[idx].c) * (ev.direction === "buy" ? 1 : -1) * 100;
        cell.n++; cell.sum += r; cell.sumsq += r * r; if (r > 0) cell.wins++;
      }
    }
  }
  console.error(`  shard ${SHARD_ID}: ${symbol} done (${bars1m.length} bars)`);
}
mkdirSync(POOLED_DIR, { recursive: true });
writeFileSync(`${POOLED_DIR}/${SHARD_ID}.json`, JSON.stringify(acc));
console.error(`shard ${SHARD_ID} WROTE ${POOLED_DIR}/${SHARD_ID}.json`);
