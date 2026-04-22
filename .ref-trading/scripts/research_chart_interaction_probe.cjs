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

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

const verbose = hasFlag("verbose");

function logStep(...args) {
  if (verbose) {
    console.error("[probe]", ...args);
  }
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function resolveChromiumExecutablePath() {
  const explicitPath = String(process.env.CHROMIUM_EXECUTABLE_PATH || "").trim();
  if (explicitPath) {
    return explicitPath;
  }
  try {
    const systemPath = execSync("which chromium", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return systemPath || null;
  } catch {
    return null;
  }
}

async function waitForWorkbench(page) {
  logStep("open workbench");
  await page.goto(parseArg("url", "http://127.0.0.1:5000"), {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(2500);

  const researchButton = page.getByRole("button", { name: "Research", exact: true });
  if (await researchButton.count()) {
    await researchButton.click();
    await page.waitForTimeout(2500);
  }

  const backtestButton = page.getByRole("button", { name: "Backtest", exact: true });
  if (await backtestButton.count()) {
    await backtestButton.click();
    await page.waitForTimeout(3000);
  }
}

async function maybeLoadHistorySetup(page) {
  if (!hasFlag("load-history")) {
    return;
  }
  logStep("load history setup");

  const historyButton = page.getByRole("button", { name: "History", exact: true }).last();
  if (await historyButton.count()) {
    await historyButton.click({ force: true, timeout: 20000 });
    await page.waitForTimeout(1200);
  }

  const loadSetupButtons = page.getByRole("button", { name: /load setup/i });
  if (await loadSetupButtons.count()) {
    await loadSetupButtons.first().click({ force: true, timeout: 20000 });
  }

  await page.waitForFunction(
    () => /INTERVAL/.test(document.body.innerText) && !/Loading Backtest/.test(document.body.innerText),
    {},
    { timeout: 120000 },
  );
  await page.waitForTimeout(2500);
}

async function waitForChartUiReady(page, timeoutMs = 120000) {
  logStep("wait for chart ui");
  await page.waitForFunction(() => {
    const bodyText = String(document.body?.innerText || "");
    const hasIntervalControls = /INTERVAL/.test(bodyText);
    const loadingBacktest = /Loading Backtest/.test(bodyText);
    const loadingMarketBars = /Loading market bars/.test(bodyText);
    const hasVisibleCanvas = Array.from(document.querySelectorAll("canvas")).some((node) => {
      const rect = node.getBoundingClientRect();
      return rect.width > 120 && rect.height > 120;
    });
    return hasIntervalControls && !loadingBacktest && (!loadingMarketBars || hasVisibleCanvas);
  }, {}, { timeout: timeoutMs });
  await page.waitForTimeout(2000);
}

async function maybeSelectLogTrade(page) {
  if (!hasFlag("select-log-trade")) {
    return null;
  }
  logStep("select log trade");

  const logButton = page.getByRole("button", { name: "Trades", exact: true }).last();
  if (await logButton.count()) {
    await logButton.click({ force: true, timeout: 20000 });
    await page.waitForTimeout(1200);
  }

  const firstTradeRow = page.locator("table tbody tr").first();
  await firstTradeRow.waitFor({ state: "visible", timeout: 30000 });
  const tradeIdCell = firstTradeRow.locator("td").nth(1);
  const selectedTradeId = (await tradeIdCell.innerText().catch(() => "")).trim() || null;
  await firstTradeRow.click({ force: true, timeout: 20000 });

  logStep("waiting for selected trade debug state", selectedTradeId);
  await page.waitForFunction(() => {
    const byKey = window.__researchChartDebugByKey || {};
    return Object.values(byKey).some((entry) => Boolean(entry?.selectedTradeId));
  }, {}, { timeout: 30000 });
  await page.waitForTimeout(2200);
  logStep("selected trade ready", selectedTradeId);

  return selectedTradeId;
}

async function resolveChartTargetFromIntervalButton(page, chartKind) {
  const intervalButtons = page.locator("button").filter({ hasText: /^INTERVAL / });
  const count = await intervalButtons.count();
  if (!count) {
    return null;
  }
  const index = chartKind === "option" ? Math.max(0, count - 1) : 0;
  const button = intervalButtons.nth(index);
  const box = await button.boundingBox().catch(() => null);
  if (!box) {
    return null;
  }
  const canvasIndex = await page.locator("canvas").evaluateAll((nodes, options) => {
    const referenceBox = options?.referenceBox || {};
    const targetKind = options?.chartKind === "option" ? "option" : "spot";
    const candidates = nodes
      .map((node, nodeIndex) => {
        const rect = node.getBoundingClientRect();
        return {
          nodeIndex,
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
          area: rect.width * rect.height,
        };
      })
      .filter((entry) => {
        if (entry.width <= 120 || entry.height <= 120) {
          return false;
        }
        const verticallyAligned = entry.top >= referenceBox.top - 140;
        const horizontallyAligned = targetKind === "option"
          ? entry.left >= referenceBox.left - 180
          : entry.left <= referenceBox.left + 180;
        return verticallyAligned && horizontallyAligned;
      })
      .sort((left, right) => right.area - left.area);
    return candidates[0]?.nodeIndex ?? null;
  }, { referenceBox: box, chartKind }).catch(() => null);
  return canvasIndex != null ? page.locator("canvas").nth(canvasIndex) : null;
}

async function resolveChartTarget(page, chartKind = "spot") {
  const normalizedKind = String(chartKind || "spot").trim().toLowerCase() === "option"
    ? "option"
    : "spot";
  const intervalTarget = await resolveChartTargetFromIntervalButton(page, normalizedKind);
  if (intervalTarget) {
    return intervalTarget;
  }

  const sideCanvasIndex = await page.locator("canvas").evaluateAll((nodes, targetKind) => {
    const midpoint = window.innerWidth * 0.5;
    const candidates = nodes
      .map((node, nodeIndex) => {
        const rect = node.getBoundingClientRect();
        return {
          nodeIndex,
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
          area: rect.width * rect.height,
        };
      })
      .filter((entry) => {
        if (entry.width <= 120 || entry.height <= 120) {
          return false;
        }
        return targetKind === "option"
          ? entry.left >= midpoint - 120
          : entry.left <= midpoint;
      })
      .sort((left, right) => right.area - left.area);
    return candidates[0]?.nodeIndex ?? null;
  }, normalizedKind).catch(() => null);
  if (sideCanvasIndex != null) {
    return page.locator("canvas").nth(sideCanvasIndex);
  }

  if (normalizedKind === "option") {
    return null;
  }

  const explicitHost = page.locator('[data-research-chart-host="spot"]').first();
  if (await explicitHost.count()) {
    return explicitHost;
  }

  const candidateScrollPositions = [0, 700, 1300, 1900, 2500];
  for (const scrollTop of candidateScrollPositions) {
    await page.evaluate((nextTop) => window.scrollTo(0, nextTop), scrollTop);
    await page.waitForTimeout(700);
    const visibleCanvasIndex = await page.evaluate(() => {
      const candidates = Array.from(document.querySelectorAll("canvas"))
        .map((node, nodeIndex) => {
          const rect = node.getBoundingClientRect();
          return {
            nodeIndex,
            width: rect.width,
            height: rect.height,
            top: rect.top,
            bottom: rect.bottom,
            area: rect.width * rect.height,
          };
        })
        .filter((entry) => entry.width > 120 && entry.height > 120 && entry.bottom > 0 && entry.top < window.innerHeight)
        .sort((left, right) => right.area - left.area);
      return candidates[0]?.nodeIndex ?? null;
    }).catch(() => null);
    if (visibleCanvasIndex != null) {
      return page.locator("canvas").nth(visibleCanvasIndex);
    }
  }

  const intervalButtons = page.locator("button").filter({ hasText: /^INTERVAL / });
  const chartButtonCount = await intervalButtons.count();
  for (let index = 0; index < chartButtonCount; index += 1) {
    const button = intervalButtons.nth(index);
    const box = await button.boundingBox().catch(() => null);
    if (!box || box.top < 200) {
      continue;
    }
    const target = page.locator("canvas").evaluateAll((nodes, top) => {
      const candidates = nodes
        .map((node, nodeIndex) => {
          const rect = node.getBoundingClientRect();
          return {
            nodeIndex,
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
            area: rect.width * rect.height,
          };
        })
        .filter((entry) => entry.width > 120 && entry.height > 120 && entry.top >= top - 120);
      candidates.sort((left, right) => right.area - left.area);
      return candidates[0]?.nodeIndex ?? null;
    }, box.top);
    const canvasIndex = await target.catch(() => null);
    if (canvasIndex != null) {
      return page.locator("canvas").nth(canvasIndex);
    }
  }

  const fallbackCanvas = page.locator("canvas").evaluateAll((nodes) => {
    const candidates = nodes
      .map((node, nodeIndex) => {
        const rect = node.getBoundingClientRect();
        return {
          nodeIndex,
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
          area: rect.width * rect.height,
        };
      })
      .filter((entry) => entry.width > 120 && entry.height > 120);
    candidates.sort((left, right) => right.area - left.area);
    return candidates[0]?.nodeIndex ?? null;
  });
  const fallbackIndex = await fallbackCanvas.catch(() => null);
  return fallbackIndex != null ? page.locator("canvas").nth(fallbackIndex) : null;
}

async function captureState(page, label) {
  return page.evaluate((stateLabel) => {
    const byKey = window.__researchChartDebugByKey || {};
    const traceByKey = window.__researchChartTraceByKey || {};
    const viewportTrace = window.__researchViewportLinkTrace || [];
    const buttons = Array.from(document.querySelectorAll("button"))
      .map((button) => {
        const text = String(button.innerText || "").trim().replace(/\s+/g, " ");
        if (!text.includes("INTERVAL") && !text.includes("WINDOW")) {
          return null;
        }
        const rect = button.getBoundingClientRect();
        return {
          text,
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
        };
      })
      .filter(Boolean);
    const canvases = Array.from(document.querySelectorAll("canvas"))
      .map((node, index) => {
        const rect = node.getBoundingClientRect();
        return {
          index,
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
          area: rect.width * rect.height,
        };
      })
      .filter((entry) => entry.width > 50 && entry.height > 50);
    return {
      label: stateLabel,
      at: Date.now(),
      byKey,
      traceTailByKey: Object.fromEntries(
        Object.entries(traceByKey).map(([key, entries]) => [key, Array.isArray(entries) ? entries.slice(-12) : []]),
      ),
      viewportTraceTail: Array.isArray(viewportTrace) ? viewportTrace.slice(-20) : [],
      buttons,
      canvases,
    };
  }, label);
}

async function main() {
  const url = parseArg("url", "http://127.0.0.1:5000");
  const outDir = parseArg("out", "output/playwright/research-chart-interaction-probe");
  const chartKind = String(parseArg("chart", "spot")).trim().toLowerCase() === "option"
    ? "option"
    : "spot";
  const settleMs = Number(parseArg("settle-ms", "3500")) || 3500;
  const holdMs = Number(parseArg("hold-ms", "6000")) || 6000;
  const dragPixels = Number(parseArg("drag-px", "260")) || 260;
  const dragDirection = String(parseArg("drag-direction", "newer")).trim().toLowerCase() === "older"
    ? "older"
    : "newer";
  const dragRepeats = Math.max(1, Number(parseArg("drag-repeats", "1")) || 1);
  const wheelDeltaY = Number(parseArg("wheel-delta-y", "-700")) || -700;
  const skipWheel = hasFlag("skip-wheel");
  const skipDrag = hasFlag("skip-drag");
  const skipTarget = hasFlag("skip-target");
  ensureDir(outDir);

  const browser = await chromium.launch({
    executablePath: resolveChromiumExecutablePath() || chromium.executablePath(),
    headless: true,
    args: ["--no-sandbox"],
  });

  try {
    const page = await browser.newPage({ viewport: { width: 1478, height: 818 } });
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

    await waitForWorkbench(page);
    await maybeLoadHistorySetup(page);
    await waitForChartUiReady(page);
    const selectedTradeId = await maybeSelectLogTrade(page);
    await page.waitForTimeout(settleMs);
    logStep("post-setup settle complete", { chartKind, selectedTradeId });

    if (skipTarget) {
      const afterSelectionOnly = await captureState(page, "after-selection");
      await page.screenshot({ path: path.join(outDir, "after-selection.png"), fullPage: true });
      console.log(JSON.stringify({
        url,
        chartKind,
        selectedTradeId,
        input: {
          settleMs,
          holdMs,
          dragPixels,
          dragDirection,
          dragRepeats,
          wheelDeltaY,
          skipWheel,
          skipDrag,
          skipTarget,
        },
        snapshots: [afterSelectionOnly],
        screenshotPaths: {
          afterSelection: path.join(outDir, "after-selection.png"),
        },
      }, null, 2));
      return;
    }

    let target = null;
    let targetBox = null;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      logStep("resolve chart target attempt", attempt + 1, chartKind);
      target = await resolveChartTarget(page, chartKind);
      if (!target) {
        break;
      }
      try {
        await target.scrollIntoViewIfNeeded();
        targetBox = await target.boundingBox();
      } catch {
        targetBox = null;
      }
      if (targetBox) {
        break;
      }
      await page.waitForTimeout(1000);
    }
    if (!target || !targetBox) {
      throw new Error(`Unable to resolve a stable ${chartKind} chart target.`);
    }
    logStep("resolved chart target", targetBox);

    const centerX = targetBox.x + Math.round(targetBox.width * 0.55);
    const centerY = targetBox.y + Math.round(targetBox.height * 0.45);
    const newerStartX = targetBox.x + Math.round(targetBox.width * 0.72);
    const startY = targetBox.y + Math.round(targetBox.height * 0.55);
    const newerEndX = Math.max(targetBox.x + 40, newerStartX - dragPixels);
    const olderStartX = targetBox.x + Math.round(targetBox.width * 0.28);
    const olderEndX = Math.min(targetBox.x + targetBox.width - 40, olderStartX + dragPixels);
    const startX = dragDirection === "older" ? olderStartX : newerStartX;
    const endX = dragDirection === "older" ? olderEndX : newerEndX;

    const selectedState = await captureState(page, "after-selection");
    await page.screenshot({ path: path.join(outDir, "after-selection.png"), fullPage: true });
    logStep("captured after-selection");

    if (!skipWheel) {
      await page.mouse.move(centerX, centerY);
      await page.mouse.wheel(0, wheelDeltaY);
      await page.waitForTimeout(1200);
      logStep("completed wheel");
    }

    const afterWheelState = await captureState(page, "after-wheel");
    await page.screenshot({ path: path.join(outDir, "after-wheel.png"), fullPage: true });

    if (!skipDrag) {
      for (let index = 0; index < dragRepeats; index += 1) {
        await page.mouse.move(startX, startY);
        await page.mouse.down();
        await page.mouse.move(endX, startY, { steps: 18 });
        await page.mouse.up();
        await page.waitForTimeout(1400);
        logStep("completed drag", index + 1);
      }
    }

    const afterDragState = await captureState(page, "after-drag");
    await page.screenshot({ path: path.join(outDir, "after-drag.png"), fullPage: true });

    await page.waitForTimeout(holdMs);
    logStep("completed hold");
    const afterHoldState = await captureState(page, "after-hold");
    await page.screenshot({ path: path.join(outDir, "after-hold.png"), fullPage: true });

    console.log(JSON.stringify({
      url,
      chartKind,
      selectedTradeId,
      targetBox,
      input: {
        settleMs,
        holdMs,
        dragPixels,
        dragDirection,
        dragRepeats,
        wheelDeltaY,
        skipWheel,
        skipDrag,
      },
      snapshots: [
        selectedState,
        afterWheelState,
        afterDragState,
        afterHoldState,
      ],
      screenshotPaths: {
        afterSelection: path.join(outDir, "after-selection.png"),
        afterWheel: path.join(outDir, "after-wheel.png"),
        afterDrag: path.join(outDir, "after-drag.png"),
        afterHold: path.join(outDir, "after-hold.png"),
      },
    }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
