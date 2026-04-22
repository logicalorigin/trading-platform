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

function nowIso() {
  return new Date().toISOString();
}

function isObservedBacktestResponse(url = "") {
  return url.includes("/api/backtest/") || url.includes("/api/research/backtests");
}

function resolveRunLaunchResponse(responses = [], clickedAt = null) {
  const clickedAtMs = Date.parse(String(clickedAt || ""));
  const launchResponses = (Array.isArray(responses) ? responses : []).filter((entry) => {
    if (!entry?.url || String(entry.method || "").toUpperCase() !== "POST") {
      return false;
    }
    const entryAtMs = Date.parse(String(entry.at || ""));
    if (Number.isFinite(clickedAtMs) && Number.isFinite(entryAtMs) && entryAtMs < clickedAtMs) {
      return false;
    }
    return entry.url.includes("/api/backtest/options/massive/run/stream")
      || entry.url.includes("/api/research/backtests/jobs");
  });
  return launchResponses[0] || null;
}

async function readBodyText(page, limit = 8000) {
  const bodyText = normalizeText(await page.locator("body").innerText().catch(() => ""));
  return bodyText.slice(0, limit);
}

async function captureCheckpoint(page, label, checkpoints, limit = 2000) {
  const bodyText = await readBodyText(page, limit);
  checkpoints.push({
    label,
    at: nowIso(),
    bodyExcerpt: bodyText,
  });
  return bodyText;
}

async function waitForRunCompletion(page, timeoutMs) {
  const startedAt = Date.now();
  let sawRunningState = false;
  while (Date.now() - startedAt < timeoutMs) {
    const runVisible = await page.getByRole("button", { name: "Run Backtest", exact: true }).first().isVisible().catch(() => false);
    const queueVisible = await page.getByRole("button", { name: "Queue Rerun", exact: true }).first().isVisible().catch(() => false);
    const queuedVisible = await page.getByRole("button", { name: "Rerun Queued", exact: true }).first().isVisible().catch(() => false);
    const saveEnabled = await page.getByRole("button", { name: "Save Run", exact: true }).first().isEnabled().catch(() => false);
    if (queueVisible || queuedVisible) {
      sawRunningState = true;
    }
    if ((sawRunningState || saveEnabled) && runVisible && !queueVisible && !queuedVisible) {
      return {
        settled: true,
        reason: saveEnabled ? "save_enabled" : "run_button_restored",
      };
    }
    await page.waitForTimeout(1000);
  }
  return {
    settled: false,
    reason: "timeout",
  };
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

async function waitForBacktestSurface(page, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const bodyText = normalizeText(await page.locator("body").innerText().catch(() => ""));
    const hasFatal = bodyText.includes("FATAL DIAGNOSTICS");
    const readyForRun = !bodyText.includes("Loading market bars...")
      && !bodyText.includes("Chart under load")
      && bodyText.includes("Run Backtest");
    if (hasFatal || readyForRun) {
      return {
        hasFatal,
        bodyText,
      };
    }
    await page.waitForTimeout(1000);
  }
  return {
    hasFatal: false,
    bodyText: normalizeText(await page.locator("body").innerText().catch(() => "")),
  };
}

async function main() {
  const url = parseArg("url", "http://127.0.0.1:5000");
  const outDir = parseArg("out", "output/playwright/research-run-backtest");
  const preWaitMs = Math.max(0, Number(parseArg("pre-wait-ms", "0")) || 0);
  const surfaceTimeoutMs = Math.max(1000, Number(parseArg("surface-timeout-ms", "120000")) || 120000);
  const responseTimeoutMs = Math.max(1000, Number(parseArg("response-timeout-ms", "120000")) || 120000);
  const settleMs = Math.max(0, Number(parseArg("settle-ms", "10000")) || 10000);
  const requestedMaxTotalMs = Math.max(5000, Number(parseArg("max-total-ms", "180000")) || 180000);
  const maxTotalMs = Math.max(
    requestedMaxTotalMs,
    30000 + preWaitMs + surfaceTimeoutMs + responseTimeoutMs + settleMs,
  );

  fs.mkdirSync(outDir, { recursive: true });
  const executablePath = resolveChromiumExecutablePath();

  const browser = await chromium.launch({
    executablePath: executablePath || undefined,
    headless: true,
    args: ["--no-sandbox"],
  });

  const page = await browser.newPage({ viewport: { width: 1440, height: 2200 } });
  const pageErrors = [];
  const consoleErrors = [];
  const responses = [];
  const checkpoints = [];
  const result = {
    url,
    executablePath,
    startedAt: nowIso(),
    status: "running",
    stage: "init",
    runClickResult: null,
    runResponse: null,
    runCompletion: null,
    responses,
    beforeHasLoading: false,
    beforeExcerpt: "",
    afterExcerpt: "",
    pageErrors,
    consoleErrors,
    checkpoints,
    screenshotPath: path.join(outDir, "research-run-backtest.png"),
    error: null,
  };
  let watchdogTimedOut = false;
  const watchdogId = setTimeout(() => {
    watchdogTimedOut = true;
    page.close().catch(() => {});
  }, maxTotalMs);

  page.on("pageerror", (error) => {
    pageErrors.push(String(error?.message || error));
  });
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  page.on("response", (response) => {
    const responseUrl = response.url();
    if (isObservedBacktestResponse(responseUrl)) {
      responses.push({
        at: nowIso(),
        url: responseUrl,
        method: response.request().method(),
        status: response.status(),
      });
    }
  });

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

  try {
    result.stage = "goto";
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await captureCheckpoint(page, "after-goto", checkpoints);
    result.stage = "reload";
    await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
    if (preWaitMs > 0) {
      await page.waitForTimeout(preWaitMs);
    }
    await captureCheckpoint(page, "after-reload", checkpoints);

    result.stage = "surface-wait";
    const surfaceState = await waitForBacktestSurface(page, surfaceTimeoutMs);
    const beforeText = surfaceState.bodyText;
    const runButton = page.getByRole("button", { name: "Run Backtest", exact: true });
    const runButtonVisible = await runButton.isVisible().catch(() => false);
    checkpoints.push({
      label: "surface-ready",
      at: nowIso(),
      hasFatal: surfaceState.hasFatal,
      runButtonVisible,
      bodyExcerpt: beforeText.slice(0, 2000),
    });

    let runResponse = null;
    if (runButtonVisible && !surfaceState.hasFatal) {
      result.stage = "run-click";
      await runButton.click({ timeout: 10000, force: true });
      result.runClickResult = { clicked: true, at: nowIso() };
      await captureCheckpoint(page, "after-run-click", checkpoints);
      result.stage = "run-settle";
      result.runCompletion = await waitForRunCompletion(page, responseTimeoutMs);
      await captureCheckpoint(page, "after-run-settle", checkpoints);
      if (!result.runCompletion?.settled) {
        throw new Error(`Backtest UI did not settle within ${responseTimeoutMs}ms after clicking Run Backtest.`);
      }
      if (settleMs > 0) {
        await page.waitForTimeout(settleMs);
      }
    } else {
      result.runClickResult = {
        clicked: false,
        reason: surfaceState.hasFatal ? "fatal_diagnostics" : "run_button_unavailable",
      };
    }

    const afterText = normalizeText(await page.locator("body").innerText().catch(() => ""));
    runResponse = resolveRunLaunchResponse(responses, result.runClickResult?.at || null);
    result.runResponse = runResponse
      ? {
          url: runResponse.url,
          method: runResponse.method,
          status: runResponse.status,
          ok: runResponse.status >= 200 && runResponse.status < 300,
        }
      : null;
    result.beforeHasLoading = beforeText.includes("Loading market bars...") || beforeText.includes("Chart under load");
    result.beforeExcerpt = beforeText.slice(0, 4000);
    result.afterExcerpt = afterText.slice(0, 8000);
    result.status = "ok";
    result.stage = "done";
  } catch (error) {
    result.status = "error";
    result.error = watchdogTimedOut
      ? `Smoke watchdog exceeded ${maxTotalMs}ms.\n${error?.stack || String(error)}`
      : (error?.stack || String(error));
  } finally {
    clearTimeout(watchdogId);
    try {
      await page.screenshot({ path: result.screenshotPath, fullPage: true });
    } catch {
      result.screenshotPath = null;
    }
    result.finishedAt = nowIso();
    const resultPath = path.join(outDir, "result.json");
    fs.writeFileSync(resultPath, JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ ...result, resultPath }, null, 2));
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
