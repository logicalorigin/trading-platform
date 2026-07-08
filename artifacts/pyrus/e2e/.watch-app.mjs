// Continuous app watcher: visits screens headlessly, dumps rendered text,
// counts anomaly markers, diffs vs previous cycle, appends a digest line.
// Anomalies -> anomaly-digest.txt (checked by orchestrator on every wake).
import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync, appendFileSync, existsSync } from "node:fs";

const SP = "/tmp/claude-1000/-home-runner-workspace/fccb627d-8452-4d5f-8c32-0c59dd098930/scratchpad";
const SCREENS = ["signals", "algo", "account", "market", "diagnostics"];
const MARKERS = [
  [/resolving/gi, "resolving"],
  [/\bloading\b/gi, "loading"],
  [/\berror\b/gi, "error"],
  [/unavailable/gi, "unavailable"],
  [/\bstale\b/gi, "stale"],
  [/NaN|undefined|Invalid Date|\[object Object\]/g, "badvalue"],
  [/SIGNALS (OFF|ERROR|UNAVAILABLE)/g, "signals-down"],
];
const storage = JSON.parse(readFileSync(`${SP}/qa-storage-state.json`, "utf8"));
const prevPath = `${SP}/watch-prev.json`;
const prev = existsSync(prevPath) ? JSON.parse(readFileSync(prevPath, "utf8")) : {};
const browser = await chromium.launch({ executablePath: process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
const ctx = await browser.newContext({ storageState: storage, viewport: { width: 1440, height: 900 } });
const now = new Date().toISOString();
const out = {};
for (const s of SCREENS) {
  const page = await ctx.newPage();
  const counts = {};
  try {
    await page.goto(`https://${process.env.REPLIT_DEV_DOMAIN}/?screen=${s}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(30000); // SSE app; no networkidle
    const text = await page.evaluate(() => document.body.innerText);
    for (const [re, name] of MARKERS) counts[name] = (text.match(re) || []).length;
    counts._chars = text.length;
    // frozen-screen heuristic: identical text hash as last cycle
    let hash = 0; for (let i = 0; i < text.length; i++) { hash = (hash * 31 + text.charCodeAt(i)) | 0; }
    counts._hash = hash;
    if (prev[s] && prev[s]._hash === hash) counts._frozen = 1;
  } catch (e) {
    counts._err = String(e).slice(0, 120);
  }
  out[s] = counts;
  await page.close();
}
await browser.close();
writeFileSync(prevPath, JSON.stringify(out));
const alerts = [];
for (const [s, c] of Object.entries(out)) {
  if (c._err) alerts.push(`${s}: LOAD-FAIL ${c._err}`);
  else {
    if (c.resolving > 3) alerts.push(`${s}: ${c.resolving} rows stuck resolving`);
    if (c.badvalue > 0) alerts.push(`${s}: ${c.badvalue} NaN/undefined values`);
    if (c["signals-down"] > 0) alerts.push(`${s}: signals status down`);
    if (c._frozen) alerts.push(`${s}: screen text FROZEN since last cycle`);
    if (c._chars < 500) alerts.push(`${s}: near-empty render (${c._chars} chars)`);
    if (c.loading > 6) alerts.push(`${s}: ${c.loading} loading placeholders`);
  }
}
appendFileSync(`${SP}/anomaly-digest.txt`, `${now} ${alerts.length ? "ALERT " + alerts.join(" | ") : "ok " + SCREENS.map((s) => s + ":" + (out[s]._chars || 0)).join(" ")}\n`);
console.log(alerts.length ? "ALERTS: " + alerts.join(" | ") : "ok");
