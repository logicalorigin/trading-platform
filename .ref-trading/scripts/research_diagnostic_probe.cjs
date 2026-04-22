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

async function main() {
  const url = parseArg("url", "http://127.0.0.1:4174");
  const outDir = parseArg("out", "output/playwright/research-diagnostic");
  const waitMs = Number(parseArg("wait-ms", "6000")) || 6000;
  fs.mkdirSync(outDir, { recursive: true });

  const executablePath = execSync("which chromium", { encoding: "utf8" }).trim();
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ["--no-sandbox"],
  });

  const pageErrors = [];
  const consoleErrors = [];
  const consoleWarnings = [];

  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 2200 } });
    console.error("[diagnostic] page-created");
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
    console.error("[diagnostic] init-script-set");
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

    console.error("[diagnostic] goto-start");
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    console.error("[diagnostic] goto-done");
    await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
    console.error("[diagnostic] reload-done");
    await page.waitForTimeout(waitMs);
    console.error("[diagnostic] wait-done");

    const bodyText = await page.locator("body").innerText().catch(() => "");
    console.error("[diagnostic] body-read");
    const bodyExcerpt = String(bodyText || "").trim().replace(/\s+/g, " ").slice(0, 3000);
    const screenshotPath = path.join(outDir, "diagnostic.png");
    let screenshotError = null;
    try {
      await page.screenshot({ path: screenshotPath, fullPage: false, timeout: 10000 });
    } catch (error) {
      screenshotError = String(error?.message || error);
    }
    console.error("[diagnostic] screenshot-attempted");
    const visibleButtons = await page.locator("button").evaluateAll((nodes) => (
      nodes
        .map((node) => ({
          text: String(node.innerText || "").trim().replace(/\s+/g, " "),
          visible: Boolean(node.offsetParent),
        }))
        .filter((entry) => entry.visible && entry.text)
        .map((entry) => entry.text)
    )).catch(() => []);
    console.error("[diagnostic] buttons-read");

    console.log(JSON.stringify({
      url,
      title: await page.title(),
      bodyExcerpt,
      visibleButtons,
      screenshotError,
      pageErrors,
      consoleErrors,
      consoleWarnings,
      screenshotPath,
    }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
