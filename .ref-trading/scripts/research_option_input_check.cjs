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

async function buttonIsActive(page, label) {
  return page.evaluate((buttonLabel) => {
    const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const button = Array.from(document.querySelectorAll("button"))
      .find((node) => normalize(node.innerText) === buttonLabel && node.offsetParent);
    if (!button) {
      return null;
    }
    const style = window.getComputedStyle(button);
    return style.backgroundColor !== "rgba(0, 0, 0, 0)" && style.backgroundColor !== "transparent";
  }, label);
}

async function ensureButtonState(page, label, shouldBeActive) {
  const isActive = await buttonIsActive(page, label);
  if (isActive == null) {
    throw new Error(`Button not found: ${label}`);
  }
  if (isActive !== shouldBeActive) {
    await clickButton(page, label);
  }
}

async function setSliderByLabel(page, label, targetValue) {
  const result = await page.evaluate(({ sliderLabel, nextValue }) => {
    const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
    const labels = Array.from(document.querySelectorAll("span"));
    const labelNode = labels.find((node) => normalize(node.textContent).startsWith(normalize(sliderLabel)));
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
  const loadingLabel = "Preparing Massive replay dataset for the current signal set...";
  const startedAt = Date.now();
  let stableChecks = 0;
  while (Date.now() - startedAt < timeoutMs) {
    const bodyText = normalizeText(await page.locator("body").innerText().catch(() => ""));
    const loadingVisible = bodyText.includes(loadingLabel);
    if (!loadingVisible) {
      stableChecks += 1;
      if (stableChecks >= 2) {
        await page.waitForTimeout(750);
        return;
      }
    } else {
      stableChecks = 0;
    }
    await page.waitForTimeout(1000);
  }
  throw new Error("Timed out waiting for Massive replay to settle.");
}

async function readOutcomePanel(page) {
  return page.evaluate(() => {
    const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const allNodes = Array.from(document.querySelectorAll("*"));
    const heading = allNodes.find((node) => normalize(node.textContent) === "Outcome KPIs");
    if (!heading) {
      return null;
    }
    let root = heading;
    while (root && root.tagName !== "BODY" && root.querySelectorAll("table").length < 1) {
      root = root.parentElement;
    }
    if (!root || root.tagName === "BODY") {
      return null;
    }
    const tables = Array.from(root.querySelectorAll("table"));
    const rowsFromTable = (table) => {
      if (!table) {
        return {};
      }
      return Array.from(table.querySelectorAll("tr")).reduce((accumulator, row) => {
        const cells = row.querySelectorAll("td");
        if (cells.length < 2) {
          return accumulator;
        }
        const label = normalize(cells[0].innerText);
        const value = normalize(cells[1].innerText);
        if (label) {
          accumulator[label] = value;
        }
        return accumulator;
      }, {});
    };
    return {
      metrics: rowsFromTable(tables[0]),
      selectedTradeImpact: rowsFromTable(tables[1]),
      placeholderVisible: normalize(root.innerText).includes("Select a completed trade to inspect the resolved contract, thresholds, and fill components."),
    };
  });
}

async function captureState(page, label) {
  const panel = await readOutcomePanel(page);
  if (!panel) {
    throw new Error("Outcome panel was not found.");
  }
  return {
    label,
    metrics: panel.metrics,
    selectedTradeImpact: panel.selectedTradeImpact,
    placeholderVisible: panel.placeholderVisible,
  };
}

function parseInteger(value) {
  const match = String(value || "").match(/-?\d+/);
  return match ? Number(match[0]) : null;
}

function parseMoney(value) {
  const normalized = String(value || "").replace(/,/g, "");
  const match = normalized.match(/-?\$?(\d+(?:\.\d+)?)/);
  if (!match) {
    return null;
  }
  const numeric = Number(match[1]);
  return normalized.includes("-") ? -numeric : numeric;
}

async function ensureTradeScenario(page) {
  await clickButton(page, "all");
  await setSliderByLabel(page, "Min Signal", 0.3);
  await ensureButtonState(page, "Puts", true);
  await ensureButtonState(page, "No Bear", false);
  await waitForReplaySettled(page);

  const strategyOrder = ["RayGun", "Momentum", "Sweep", "VWAP-X", "EMA Stack", "BB Squeeze"];
  for (const strategy of strategyOrder) {
    await clickButton(page, strategy);
    await waitForReplaySettled(page);
    const snapshot = await captureState(page, `strategy:${strategy}`);
    const trades = parseInteger(snapshot.metrics?.Trades);
    if ((trades || 0) > 0 && !snapshot.placeholderVisible) {
      return {
        strategy,
        snapshot,
      };
    }
  }
  throw new Error("Could not produce a non-empty trade scenario for option input testing.");
}

function summarizeDelta(baseline, variant) {
  const baselineImpact = baseline.selectedTradeImpact || {};
  const variantImpact = variant.selectedTradeImpact || {};
  const baselineMetrics = baseline.metrics || {};
  const variantMetrics = variant.metrics || {};
  return {
    entryAt: {
      baseline: baselineImpact["Entry At"] || null,
      variant: variantImpact["Entry At"] || null,
    },
    contract: {
      baseline: baselineMetrics.Contract || null,
      variant: variantMetrics.Contract || null,
    },
    actualDte: {
      baseline: baselineMetrics.DTE || baselineImpact["Actual DTE"] || null,
      variant: variantMetrics.DTE || variantImpact["Actual DTE"] || null,
    },
    strikeTool: {
      baseline: baselineImpact["Strike Tool"] || null,
      variant: variantImpact["Strike Tool"] || null,
    },
    entryFill: {
      baseline: baselineImpact["Entry Fill"] || null,
      variant: variantImpact["Entry Fill"] || null,
    },
    entrySlip: {
      baseline: baselineImpact["Entry Slip"] || null,
      variant: variantImpact["Entry Slip"] || null,
    },
    exitAt: {
      baseline: baselineImpact["Exit At"] || null,
      variant: variantImpact["Exit At"] || null,
    },
    exitTrigger: {
      baseline: baselineImpact["Exit Trigger"] || null,
      variant: variantImpact["Exit Trigger"] || null,
    },
    exitFill: {
      baseline: baselineImpact["Exit Fill"] || null,
      variant: variantImpact["Exit Fill"] || null,
    },
    netPnl: {
      baseline: baselineMetrics["Net P&L"] || null,
      variant: variantMetrics["Net P&L"] || null,
    },
    avgBars: {
      baseline: baselineMetrics["Avg Bars"] || null,
      variant: variantMetrics["Avg Bars"] || null,
    },
  };
}

async function main() {
  const url = parseArg("url", "http://127.0.0.1:4174");
  const outDir = parseArg("out", "output/playwright/research-option-input-check");
  fs.mkdirSync(outDir, { recursive: true });

  const executablePath = execSync("which chromium", { encoding: "utf8" }).trim();
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ["--no-sandbox"],
  });

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

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(5000);

    const scenario = await ensureTradeScenario(page);
    const baseline = await captureState(page, "baseline");

    await setSliderByLabel(page, "Target DTE", 0);
    await waitForReplaySettled(page);
    const dteVariant = await captureState(page, "dte-0");

    await setSliderByLabel(page, "Target DTE", 5);
    await waitForReplaySettled(page);

    await setSliderByLabel(page, "Strike Ladder", 5);
    await waitForReplaySettled(page);
    const strikeVariant = await captureState(page, "strike-5");

    await setSliderByLabel(page, "Strike Ladder", 0);
    await waitForReplaySettled(page);

    await setSliderByLabel(page, "Spread", 500);
    await waitForReplaySettled(page);
    const spreadVariant = await captureState(page, "spread-500");

    await setSliderByLabel(page, "Spread", 150);
    await waitForReplaySettled(page);

    await setSliderByLabel(page, "Stop Loss", 0.05);
    await waitForReplaySettled(page);
    const stopVariant = await captureState(page, "stop-loss-5");

    const screenshotPath = path.join(outDir, "option-input-check.png");
    await page.screenshot({ path: screenshotPath, fullPage: false, timeout: 10000 });

    const result = {
      url,
      scenarioStrategy: scenario.strategy,
      baseline,
      tests: {
        dte: summarizeDelta(baseline, dteVariant),
        strike: summarizeDelta(baseline, strikeVariant),
        spread: summarizeDelta(baseline, spreadVariant),
        stopLoss: summarizeDelta(baseline, stopVariant),
      },
      quickChecks: {
        dteChangedActualDte: normalizeText(baseline.selectedTradeImpact?.["Actual DTE"]) !== normalizeText(dteVariant.selectedTradeImpact?.["Actual DTE"])
          || normalizeText(baseline.metrics?.Contract) !== normalizeText(dteVariant.metrics?.Contract),
        strikeChangedContractOrTool: normalizeText(baseline.metrics?.Contract) !== normalizeText(strikeVariant.metrics?.Contract)
          || normalizeText(baseline.selectedTradeImpact?.["Strike Tool"]) !== normalizeText(strikeVariant.selectedTradeImpact?.["Strike Tool"]),
        spreadChangedSlippageOrPnl: normalizeText(baseline.selectedTradeImpact?.["Entry Slip"]) !== normalizeText(spreadVariant.selectedTradeImpact?.["Entry Slip"])
          || normalizeText(baseline.metrics?.["Net P&L"]) !== normalizeText(spreadVariant.metrics?.["Net P&L"]),
        stopLossChangedExitOrPnl: normalizeText(baseline.selectedTradeImpact?.["Exit At"]) !== normalizeText(stopVariant.selectedTradeImpact?.["Exit At"])
          || normalizeText(baseline.selectedTradeImpact?.["Exit Trigger"]) !== normalizeText(stopVariant.selectedTradeImpact?.["Exit Trigger"])
          || normalizeText(baseline.metrics?.["Net P&L"]) !== normalizeText(stopVariant.metrics?.["Net P&L"]),
      },
      screenshotPath,
    };

    fs.writeFileSync(path.join(outDir, "result.json"), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
