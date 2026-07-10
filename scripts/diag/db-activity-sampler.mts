import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
const q = async (t: string) => (await db.execute(sql.raw(t))).rows as any[];
const norm = (s: string) => s.replace(/\s+/g, " ").replace(/\$\d+/g, "$N").replace(/= ANY \([^)]*\)/gi, "= ANY($N)").trim().slice(0, 160);
const shapeCount = new Map<string, number>(); const waitCount = new Map<string, number>();
let samples = 0;
const SAMPLES = Number(process.env.SAMPLES || 500), IVAL = Number(process.env.IVAL_MS || 150);
for (let i = 0; i < SAMPLES; i++) {
  try {
    const rows = await q(`SELECT query, wait_event_type wet, wait_event we FROM pg_stat_activity
      WHERE datname=current_database() AND state='active' AND pid<>pg_backend_pid()
        AND query !~* '^(SET|SHOW|BEGIN|COMMIT|SELECT query, wait_event)'`);
    samples++;
    for (const r of rows) {
      const k = norm((r as any).query || "");
      if (k) shapeCount.set(k, (shapeCount.get(k) || 0) + 1);
      const w = ((r as any).wet || "cpu") + ":" + ((r as any).we || "-");
      waitCount.set(w, (waitCount.get(w) || 0) + 1);
    }
  } catch {}
  await new Promise((r) => setTimeout(r, IVAL));
}
console.log(`\n=== DB active-query sampling: ${samples} samples over ~${Math.round(samples*IVAL/1000)}s ===`);
console.log("\n--- TOP query shapes by active-sample count (N+1 / hot / slow) ---");
for (const [k, c] of [...shapeCount.entries()].sort((a,b)=>b[1]-a[1]).slice(0, 20)) console.log(String(c).padStart(4) + "  " + k);
console.log("\n--- wait events (where DB time goes) ---");
for (const [k, c] of [...waitCount.entries()].sort((a,b)=>b[1]-a[1]).slice(0, 12)) console.log(String(c).padStart(4) + "  " + k);
process.exit(0);
