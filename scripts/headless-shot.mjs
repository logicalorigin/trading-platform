#!/usr/bin/env node
/**
 * Repo-native headless browser helper.
 *
 * Drives Chromium via the already-installed `@playwright/test`, pointed at the
 * Chromium binary Replit provides through its Nix Playwright module
 * (`REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE`). The required shared libraries are
 * declared in `replit.nix`, so this works in the Replit container with NO
 * `playwright install` / `install-deps` step and survives container rebuilds.
 *
 * Outside Replit (CI, local) the env var is unset and Playwright falls back to
 * its own downloaded browser — run `pnpm exec playwright install chromium` once.
 *
 * Usage:
 *   node scripts/headless-shot.mjs <url> [options]
 *
 * Options:
 *   --out <path>        Screenshot output path (default: ./.headless-shots/shot-<ts>.png)
 *   --wait <ms>         Fixed settle wait after load (default: 6000). The platform
 *                       holds open SSE streams, so `networkidle` never fires — use a
 *                       fixed wait or --wait-for.
 *   --wait-for <css>    Wait for a selector to appear instead of the fixed wait.
 *   --viewport <WxH>    Viewport size (default: 1440x900).
 *   --full              Capture the full scrollable page (default: viewport only).
 *   --match <substr>    Repeatable. Count network request paths containing <substr>
 *                       and report them (handy for "one call, not per-row" checks).
 *   --json              Print a machine-readable JSON summary instead of prose.
 *   --fail-on-console   Exit 1 if any console errors were logged.
 *
 * Examples:
 *   node scripts/headless-shot.mjs "https://$REPLIT_DEV_DOMAIN/?screen=market-demo" --out /tmp/demo.png
 *   node scripts/headless-shot.mjs http://127.0.0.1:18747/ --wait-for '[data-testid="market-demo-screen"]' --json
 */
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const argv = process.argv.slice(2);
const positional = [];
const opts = { wait: 6000, viewport: "1440x900", out: null, waitFor: null, full: false, json: false, failOnConsole: false, match: [] };
for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i];
  if (arg === "--out") opts.out = argv[++i];
  else if (arg === "--wait") opts.wait = Number(argv[++i]);
  else if (arg === "--wait-for") opts.waitFor = argv[++i];
  else if (arg === "--viewport") opts.viewport = argv[++i];
  else if (arg === "--match") opts.match.push(argv[++i]);
  else if (arg === "--full") opts.full = true;
  else if (arg === "--json") opts.json = true;
  else if (arg === "--fail-on-console") opts.failOnConsole = true;
  else positional.push(arg);
}

const url = positional[0];
if (!url) {
  console.error("Usage: node scripts/headless-shot.mjs <url> [--out path] [--wait ms] [--wait-for css] [--viewport WxH] [--full] [--match substr] [--json] [--fail-on-console]");
  process.exit(2);
}

const [vw, vh] = opts.viewport.split("x").map((n) => Number(n) || 0);
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const out = opts.out || path.resolve(".headless-shots", `shot-${stamp}.png`);
await mkdir(path.dirname(out), { recursive: true });

const executablePath = process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined;

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

const result = { url, executablePath: executablePath || "(playwright default)", screenshot: out };
try {
  const page = await browser.newPage({ viewport: { width: vw || 1440, height: vh || 900 } });
  const consoleErrors = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text().slice(0, 300));
  });
  const failedRequests = [];
  page.on("requestfailed", (r) => failedRequests.push(`${r.method()} ${r.url()} (${r.failure()?.errorText || "failed"})`));
  const matchCounts = Object.fromEntries(opts.match.map((m) => [m, []]));
  if (opts.match.length) {
    page.on("request", (r) => {
      const p = r.url().replace(/^https?:\/\/[^/]+/, "");
      for (const m of opts.match) if (p.includes(m)) matchCounts[m].push(p);
    });
  }

  const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  result.status = response?.status() ?? null;
  if (opts.waitFor) {
    await page.waitForSelector(opts.waitFor, { timeout: Math.max(opts.wait, 15000) }).catch(() => {
      result.waitForMissed = opts.waitFor;
    });
  } else {
    await page.waitForTimeout(opts.wait);
  }
  await page.screenshot({ path: out, fullPage: opts.full });
  result.title = await page.title().catch(() => null);
  result.consoleErrorCount = consoleErrors.length;
  result.consoleErrors = consoleErrors.slice(0, 10);
  result.failedRequests = failedRequests.slice(0, 10);
  if (opts.match.length) {
    result.matches = Object.fromEntries(
      opts.match.map((m) => [m, { count: matchCounts[m].length, sample: [...new Set(matchCounts[m])].slice(0, 12) }]),
    );
  }
  result.ok = true;
} catch (error) {
  result.ok = false;
  result.error = String(error?.message || error);
} finally {
  await browser.close();
}

if (opts.json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`${result.ok ? "OK" : "FAILED"}  ${url}  -> HTTP ${result.status ?? "?"}`);
  console.log(`  title: ${result.title ?? "(none)"}`);
  console.log(`  chromium: ${result.executablePath}`);
  console.log(`  screenshot: ${result.screenshot}`);
  if (result.waitForMissed) console.log(`  WARN: selector never appeared: ${result.waitForMissed}`);
  console.log(`  console errors: ${result.consoleErrorCount ?? 0}`);
  for (const e of result.consoleErrors || []) console.log(`    - ${e}`);
  if (result.matches) for (const [m, info] of Object.entries(result.matches)) console.log(`  match "${m}": ${info.count}  ${JSON.stringify(info.sample)}`);
  if (result.error) console.log(`  error: ${result.error}`);
}

process.exit(result.ok && !(opts.failOnConsole && result.consoleErrorCount > 0) ? 0 : 1);
