#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { chromium } = require("playwright");

const NAV_TABS = [
  "Market Dashboard",
  "Backtest Dashboard",
  "TradingView",
  "Positions & Accounts",
];

function parseArg(name, fallback = null) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((value) => value.startsWith(prefix));
  if (!hit) return fallback;
  return hit.slice(prefix.length).trim();
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function slug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

async function captureUrl({ page, url, outDir, fullPage }) {
  const hostSlug = slug(new URL(url).host);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppSettle(page);

  const landingFile = path.join(outDir, `${hostSlug}-landing.png`);
  await page.screenshot({ path: landingFile, fullPage });
  console.log(`saved ${landingFile}`);

  for (const tab of NAV_TABS) {
    const tabSlug = slug(tab);
    const target = page.getByRole("button", { name: tab, exact: true }).first();
    if ((await target.count()) > 0) {
      await target.click({ timeout: 12000 });
      await waitForAppSettle(page);
      const file = path.join(outDir, `${hostSlug}-${tabSlug}.png`);
      await page.screenshot({ path: file, fullPage });
      console.log(`saved ${file}`);
    }
  }
}

async function waitForAppSettle(page) {
  await page.waitForTimeout(900);
  const loading = page.locator("text=/Loading\\s/i");
  try {
    await loading.first().waitFor({ state: "hidden", timeout: 7000 });
  } catch {
    // Some views keep loading indicators longer or do not render one at all.
  }
  await page.waitForTimeout(900);
}

async function main() {
  const outDir = parseArg("out", "output/playwright");
  const fullPage = !hasFlag("viewport-only");
  const urlsArg = parseArg("urls", "http://127.0.0.1:5000");
  const includeDevDomain = hasFlag("include-dev-domain");
  const includeProd = hasFlag("include-prod");
  const prodUrl = parseArg("prod-url", process.env.APP_PROD_URL || process.env.PROD_URL || "");
  const headed = hasFlag("headed");
  const width = Number(parseArg("width", "1440"));
  const height = Number(parseArg("height", "2200"));

  const urls = urlsArg
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (includeDevDomain && process.env.REPLIT_DEV_DOMAIN) {
    urls.push(`https://${process.env.REPLIT_DEV_DOMAIN}`);
  }
  if (includeProd && prodUrl) {
    urls.push(prodUrl);
  }

  if (!urls.length) {
    throw new Error("No URLs provided. Use --urls=http://127.0.0.1:5000");
  }

  fs.mkdirSync(outDir, { recursive: true });

  const executablePath = execSync("which chromium", { encoding: "utf8" }).trim();
  const browser = await chromium.launch({
    executablePath,
    headless: !headed,
    args: ["--no-sandbox"],
  });

  try {
    for (const url of urls) {
      const page = await browser.newPage({ viewport: { width, height } });
      await captureUrl({ page, url, outDir, fullPage });
      await page.close();
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
