// Phase 3: merge shard sufficient-stats, compute t/mean/win, print grid + best-per-interval.
//   node --import tsx horizon-merge.ts
import { readFileSync, readdirSync } from "node:fs";
const POOLED_DIR = process.env.POOLED_DIR!;
const INTERVALS = ["1m", "2m", "5m", "15m", "1h"];
const GRID = Array.from({ length: 19 }, (_, i) => i + 2);
const MIN_N = 50;

type Cell = { n: number; sum: number; sumsq: number; wins: number };
const merged: Record<string, Cell> = {};
for (const tf of INTERVALS) for (const h of GRID) merged[`${tf}|${h}`] = { n: 0, sum: 0, sumsq: 0, wins: 0 };

let shards = 0;
for (const f of readdirSync(POOLED_DIR)) {
  if (!f.endsWith(".json")) continue;
  shards++;
  const obj = JSON.parse(readFileSync(`${POOLED_DIR}/${f}`, "utf8")) as Record<string, Cell>;
  for (const k of Object.keys(obj)) {
    const m = merged[k]; const c = obj[k];
    m.n += c.n; m.sum += c.sum; m.sumsq += c.sumsq; m.wins += c.wins;
  }
}
function stat(c: Cell) {
  if (c.n === 0) return { n: 0, mean: 0, win: 0, t: 0 };
  const mean = c.sum / c.n;
  const varc = (c.sumsq - (c.sum * c.sum) / c.n) / Math.max(1, c.n - 1);
  const std = Math.sqrt(Math.max(0, varc));
  const t = std > 1e-12 ? mean / (std / Math.sqrt(c.n)) : 0;
  return { n: c.n, mean, win: (c.wins / c.n) * 100, t };
}

const L: string[] = [];
L.push(`# Pooled best timeHorizon per interval — ${shards} shards merged`);
L.push(`study from 2026-02-14 .. 2026-05-15 | live-UI base (BOS wicks, CHoCH 0) | k=6 bars\n`);
L.push("### Grid — t-stat (k=6) by horizon × interval");
L.push("| Horizon | " + INTERVALS.join(" | ") + " |");
L.push("|---:|" + INTERVALS.map(() => "---:").join("|") + "|");
const best: Record<string, { h: number; t: number; mean: number; n: number }> = {};
const cells: Record<string, Record<number, ReturnType<typeof stat>>> = {};
for (const tf of INTERVALS) cells[tf] = {};
for (const h of GRID) {
  const row: string[] = [];
  for (const tf of INTERVALS) {
    const s = stat(merged[`${tf}|${h}`]); cells[tf][h] = s;
    row.push(s.n ? s.t.toFixed(2) : "—");
    if (s.n >= MIN_N && (!best[tf] || s.t > best[tf].t)) best[tf] = { h, t: s.t, mean: s.mean, n: s.n };
  }
  L.push("| " + (h === 8 ? "**8**" : String(h)) + " | " + row.join(" | ") + " |");
}
L.push("\n### Best horizon per interval (max positive t-stat, n≥" + MIN_N + ")");
L.push("| Interval | Best H | t(k6) | mean% | n | H=8 t | H=8 mean% | H=8 n |");
L.push("|---|---:|---:|---:|---:|---:|---:|---:|");
for (const tf of INTERVALS) {
  const b = best[tf]; const d = cells[tf][8];
  L.push(`| ${tf} | ${b ? b.h : "—"} | ${b ? b.t.toFixed(2) : "—"} | ${b ? b.mean.toFixed(4) : "—"} | ${b ? b.n : 0} | ${d.t.toFixed(2)} | ${d.mean.toFixed(4)} | ${d.n} |`);
}
L.push("\n### Best horizon per interval — simple answer");
L.push("| Interval | Best Time Horizon |");
L.push("|---|---:|");
for (const tf of INTERVALS) L.push(`| ${tf} | ${best[tf] ? best[tf].h : "—"} |`);
console.log(L.join("\n"));
