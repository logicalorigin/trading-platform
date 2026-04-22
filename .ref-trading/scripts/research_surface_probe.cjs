#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { chromium } = require("playwright");

function parseArg(name, fallback = null) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((value) => value.startsWith(prefix));
  if (!hit) return fallback;
  return hit.slice(prefix.length).trim();
}

async function clickVisibleButton(page, label) {
  const escapedLabel = String(label || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const locator = page.locator("button").filter({ hasText: new RegExp(`^${escapedLabel}$`) });
  const candidate = locator.last();
  try {
    await candidate.waitFor({ state: "visible", timeout: 10000 });
    await candidate.click({ timeout: 10000 });
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const url = parseArg("url", "http://127.0.0.1:5001");
  const outDir = parseArg("out", "output/playwright/research-surface-probe");
  const waitMs = Number(parseArg("wait-ms", "2500")) || 2500;
  const timeframe = parseArg("timeframe", "");
  const range = parseArg("range", "");
  const executablePath = execSync("which chromium", { encoding: "utf8" }).trim();
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ["--no-sandbox"],
  });

  const pageErrors = [];
  const consoleErrors = [];
  const consoleWarnings = [];
  let timeframeClicked = false;
  let rangeClicked = false;

  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 2200 } });
    await page.addInitScript(() => {
      window.localStorage.setItem("spy-options-app-session-v1", JSON.stringify({
        activeTab: "backtest",
        activeMode: "research",
        lastSurfaceByMode: {
          workspace: "workspace",
          research: "backtest",
          accounts: "positions",
        },
        savedAt: new Date().toISOString(),
      }));
    });
    page.on("pageerror", (error) => {
      pageErrors.push(String(error?.message || error));
    });
    page.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push(message.text());
      } else if (message.type() === "warning") {
        consoleWarnings.push(message.text());
      }
    });

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
    let workbenchVisible = false;
    try {
      await Promise.all([
        page.getByText("Data & Replay", { exact: true }).waitFor({ state: "visible", timeout: 30000 }),
        page.getByText("Outcome KPIs", { exact: true }).waitFor({ state: "visible", timeout: 30000 }),
        page.getByText("Selected Option Chart", { exact: true }).waitFor({ state: "visible", timeout: 30000 }),
      ]);
      workbenchVisible = true;
    } catch {
      workbenchVisible = false;
    }
    if (timeframe) {
      timeframeClicked = await clickVisibleButton(page, timeframe).catch(() => false);
      await page.waitForTimeout(1200);
    }
    if (range) {
      rangeClicked = await clickVisibleButton(page, range).catch(() => false);
      await page.waitForTimeout(1200);
    }
    await page.waitForTimeout(waitMs);

    const screenshotPath = path.join(outDir, "research-surface-probe.png");
    await page.screenshot({ path: screenshotPath, fullPage: true });

    const noChartDataCount = await page.getByText("No chart data.", { exact: true }).count();
    const renderFailed = (await page.getByText("This page failed to render.", { exact: true }).count()) > 0;
    const title = await page.title();
    const bodyText = await page.locator("body").innerText().catch(() => "");
    const bodyExcerpt = String(bodyText || "").trim().replace(/\s+/g, " ").slice(0, 1200);
    const chartDebug = await page.evaluate(() => window.__researchChartDebug || null).catch(() => null);
    const visibleButtons = await page.locator("button").evaluateAll((nodes) => (
      nodes
        .map((node) => ({
          text: String(node.innerText || "").trim().replace(/\s+/g, " "),
          visible: Boolean(node.offsetParent),
        }))
        .filter((entry) => entry.visible && entry.text)
        .map((entry) => entry.text)
    )).catch(() => []);

    console.log(JSON.stringify({
      url,
      title,
      timeframe,
      range,
      timeframeClicked,
      rangeClicked,
      workbenchVisible,
      noChartDataVisible: noChartDataCount > 0,
      renderFailed,
      bodyExcerpt,
      chartDebug,
      visibleButtons,
      pageErrors,
      consoleErrors,
      consoleWarnings,
      screenshotPath,
    }, null, 2));

    if (renderFailed || pageErrors.length) {
      process.exitCode = 1;
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
