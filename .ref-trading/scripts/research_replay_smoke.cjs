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

async function waitForResearchReady(page) {
  await Promise.all([
    page.getByText("Data & Replay", { exact: true }).waitFor({ state: "visible", timeout: 20000 }),
    page.getByText("Outcome KPIs", { exact: true }).waitFor({ state: "visible", timeout: 20000 }),
    page.getByText("Selected Option Chart", { exact: true }).waitFor({ state: "visible", timeout: 20000 }),
  ]);
}

async function waitForReplayResult(page) {
  const loading = page.getByText("Preparing Massive replay dataset for the current signal set...", { exact: true });
  try {
    await loading.waitFor({ state: "visible", timeout: 10000 });
  } catch {
    // The run can complete quickly enough that the loading state is skipped.
  }

  const datasetSummary = page.locator("text=/resolved .* skipped .* contracts cached/i").first();
  const replayError = page.locator("text=/Massive replay credentials are required|Failed to build Massive replay dataset/i").first();
  const renderFailure = page.locator("text=This page failed to render.").first();

  await Promise.race([
    datasetSummary.waitFor({ state: "visible", timeout: 40000 }).catch(() => null),
    replayError.waitFor({ state: "visible", timeout: 40000 }).catch(() => null),
    renderFailure.waitFor({ state: "visible", timeout: 40000 }).catch(() => null),
  ]);

  return {
    datasetSummary: (await datasetSummary.count()) > 0 ? await datasetSummary.textContent() : null,
    replayError: (await replayError.count()) > 0 ? await replayError.textContent() : null,
    renderFailed: (await renderFailure.count()) > 0,
  };
}

async function main() {
  const url = parseArg("url", "http://127.0.0.1:5001");
  const outDir = parseArg("out", "output/playwright/research-replay");
  const executablePath = execSync("which chromium", { encoding: "utf8" }).trim();
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ["--no-sandbox"],
  });

  const pageErrors = [];
  const consoleErrors = [];

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
      }
    });

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(1200);
    await waitForResearchReady(page);

    await page.getByRole("button", { name: "Replay", exact: true }).click({ timeout: 10000 });
    const replayState = await waitForReplayResult(page);

    const screenshotPath = path.join(outDir, "research-replay-smoke.png");
    await page.screenshot({ path: screenshotPath, fullPage: true });

    const title = await page.title();
    const renderFailed = (await page.locator("text=This page failed to render.").count()) > 0;
    const workbenchVisible = (await page.locator("text=Outcome KPIs").count()) > 0
      && (await page.locator("text=Selected Option Chart").count()) > 0;
    const renderFailureDetails = renderFailed
      ? await page.getByText("This page failed to render.", { exact: true })
        .evaluate((node) => node.parentElement?.innerText || "")
        .catch(() => null)
      : null;

    console.log(JSON.stringify({
      url,
      title,
      renderFailed,
      workbenchVisible,
      renderFailureDetails,
      replayState,
      pageErrors,
      consoleErrors,
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
