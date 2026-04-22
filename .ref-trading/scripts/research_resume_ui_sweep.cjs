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

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

async function clickButton(page, label) {
  const button = page.getByRole("button", { name: label, exact: true }).first();
  await button.waitFor({ state: "visible", timeout: 20000 });
  try {
    await button.click({ timeout: 20000, force: true });
  } catch {
    await page.evaluate((buttonLabel) => {
      const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
      const node = Array.from(document.querySelectorAll("button"))
        .find((candidate) => normalize(candidate.innerText) === buttonLabel && candidate.offsetParent);
      if (!node) {
        throw new Error(`Button not found for DOM click: ${buttonLabel}`);
      }
      node.click();
    }, label);
  }
}

async function setSliderByLabel(page, label, targetValue) {
  const result = await page.evaluate(({ sliderLabel, nextValue }) => {
    const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
    const labels = Array.from(document.querySelectorAll("span"));
    const labelNode = labels.find((node) => normalize(node.textContent) === normalize(sliderLabel));
    if (!labelNode) {
      return { ok: false, reason: "label_not_found" };
    }
    const sliderRoot = labelNode.closest("div")?.parentElement;
    const input = sliderRoot?.querySelector('input[type="range"]');
    if (!input) {
      return { ok: false, reason: "range_not_found" };
    }
    input.value = String(nextValue);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true, value: input.value };
  }, { sliderLabel: label, nextValue: targetValue });
  if (!result?.ok) {
    throw new Error(`Failed to set slider ${label}: ${result?.reason || "unknown"}`);
  }
}

async function waitForReplaySettled(page, timeoutMs = 180000) {
  const startedAt = Date.now();
  let sawRunningState = false;
  while (Date.now() - startedAt < timeoutMs) {
    const runVisible = await page.getByRole("button", { name: "Run Backtest", exact: true }).first().isVisible().catch(() => false);
    const queueVisible = await page.getByRole("button", { name: "Queue Rerun", exact: true }).first().isVisible().catch(() => false);
    const queuedVisible = await page.getByRole("button", { name: "Rerun Queued", exact: true }).first().isVisible().catch(() => false);
    if (queueVisible || queuedVisible) {
      sawRunningState = true;
    }
    if (sawRunningState && runVisible && !queueVisible && !queuedVisible) {
      await page.waitForTimeout(750);
      return "settled";
    }
    await page.waitForTimeout(1000);
  }
  throw new Error("Timed out waiting for Massive replay to settle.");
}

async function diagnosticsVisible(page) {
  return (await page.locator('[data-crash-diagnostics="true"]').count()) > 0;
}

async function readCrashReport(page) {
  if ((await diagnosticsVisible(page)) === false) {
    return null;
  }
  return normalizeText(
    await page.locator('[data-crash-diagnostics="true"]').innerText().catch(() => ""),
  );
}

async function readChartDebug(page) {
  return await page.evaluate(() => window.__researchChartDebug || null).catch(() => null);
}

async function recordCheckpoint(page, checkpoints, action) {
  const debug = await readChartDebug(page);
  const entry = {
    action,
    diagnosticsVisible: await diagnosticsVisible(page),
    crashReport: await readCrashReport(page),
    selectedTradeId: debug?.selectedTradeId || null,
    rangeOwner: debug?.rangeOwner || null,
    rangePresetKey: debug?.rangePresetKey || null,
  };
  checkpoints.push(entry);
  if (entry.diagnosticsVisible) {
    throw new Error(`Diagnostics page became visible after ${action}`);
  }
}

async function waitForReplayResponse(page, timeoutMs = 120000) {
  return await page
    .waitForResponse((response) => response.url().includes("/api/backtest/options/massive/run/stream"), { timeout: timeoutMs })
    .catch(() => null);
}

async function main() {
  const url = parseArg("url", "http://127.0.0.1:5001");
  const outDir = parseArg("out", "output/playwright/research-resume-ui-sweep");
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
  const replayResponses = [];
  const checkpoints = [];

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
    await page.waitForTimeout(5000);
    await page.getByRole("button", { name: /Run Backtest|Queue Rerun|Rerun Queued/ }).first().waitFor({ state: "visible", timeout: 60000 }).catch(() => null);
    await recordCheckpoint(page, checkpoints, "initial");

    await clickButton(page, "Analysis");
    await page.waitForTimeout(1200);
    await recordCheckpoint(page, checkpoints, "tab:Analysis");

    await clickButton(page, "Trades");
    await page.waitForTimeout(1200);
    const firstRow = page.locator("tbody tr").first();
    await firstRow.waitFor({ state: "visible", timeout: 20000 });
    await firstRow.click({ timeout: 20000 });
    await page.waitForTimeout(1500);
    await page
      .waitForFunction(() => Boolean(window.__researchChartDebug?.selectedTradeId), {}, { timeout: 20000 })
      .catch(() => null);
    await recordCheckpoint(page, checkpoints, "log:select-first-trade");

    await clickButton(page, "Analysis");
    await page.waitForTimeout(1200);
    await recordCheckpoint(page, checkpoints, "tab:Analysis:after-trade-select");

    for (const [label, value] of [["DTE", 0], ["Min Sig", 0.7], ["Stop Loss", 0.05], ["Spread", 500]]) {
      await setSliderByLabel(page, label, value);
      replayResponses.push({
        action: `slider:${label}:${value}`,
        responseUrl: null,
        status: null,
        settleState: "deferred_until_manual_run",
      });
      await recordCheckpoint(page, checkpoints, `slider:${label}:${value}`);
    }

    const manualRunResponse = waitForReplayResponse(page);
    await clickButton(page, "Run Backtest");
    const replayResponse = await manualRunResponse;
    const replaySettleState = await waitForReplaySettled(page).catch((error) => String(error?.message || error));
    replayResponses.push({
      action: "run:manual-backtest",
      responseUrl: replayResponse?.url() || null,
      status: typeof replayResponse?.status === "function" ? replayResponse.status() : null,
      settleState: replaySettleState,
    });
    await recordCheckpoint(page, checkpoints, "run:manual-backtest");

    await clickButton(page, "P&L");
    await page.waitForTimeout(1200);
    await recordCheckpoint(page, checkpoints, "tab:P&L");

    await page.setViewportSize({ width: 1260, height: 1800 });
    await page.waitForTimeout(1200);
    await recordCheckpoint(page, checkpoints, "viewport:1260x1800");

    await page.setViewportSize({ width: 1440, height: 2200 });
    await page.waitForTimeout(1200);
    await recordCheckpoint(page, checkpoints, "viewport:1440x2200");

    const separator = page.getByRole("separator", { name: "Resize lower output panel" });
    await separator.waitFor({ state: "visible", timeout: 20000 });
    const box = await separator.boundingBox();
    if (!box) {
      throw new Error("Could not resolve output-panel separator bounds.");
    }
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 120, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(1200);
    await recordCheckpoint(page, checkpoints, "separator:drag-down");

    await page.mouse.wheel(0, 900);
    await page.waitForTimeout(1200);
    await recordCheckpoint(page, checkpoints, "page:wheel");

    const screenshotPath = path.join(outDir, "ui-sweep.png");
    await page.screenshot({ path: screenshotPath, fullPage: true });

    const finalBodyText = normalizeText(await page.locator("body").innerText().catch(() => ""));
    const finalDebug = await readChartDebug(page);
    const executionDetailsVisible = (await page.getByText("Execution details", { exact: true }).count()) > 0;
    const selectionPropagated = Boolean(
      finalDebug?.selectedTradeId
      && finalDebug?.activeTradeSelectionId
      && finalDebug?.selectedTradeOverlayVisible,
    );

    const result = {
      url,
      executablePath,
      checkpoints,
      replayResponses,
      executionDetailsVisible,
      selectionPropagated,
      finalDebug,
      pageErrors,
      consoleErrors,
      consoleWarnings,
      bodyExcerpt: finalBodyText.slice(0, 2000),
      screenshotPath,
    };

    const resultPath = path.join(outDir, "result.json");
    fs.writeFileSync(resultPath, JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ resultPath, ...result }, null, 2));

    const missingReplayResponses = replayResponses.filter((entry) => entry.status !== 200);
    if (pageErrors.length || missingReplayResponses.length || selectionPropagated === false) {
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
