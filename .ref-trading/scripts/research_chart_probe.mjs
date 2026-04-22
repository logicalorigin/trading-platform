import { chromium } from "playwright";
import { execSync } from "child_process";

const executablePath = execSync("which chromium", { encoding: "utf8" }).trim();
const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
const consoleMessages = [];
const pageErrors = [];

page.on("console", (msg) => {
  const entry = { type: msg.type(), text: msg.text() };
  consoleMessages.push(entry);
  console.log(`[console:${entry.type}]`, entry.text);
});

page.on("pageerror", (err) => {
  const row = {
    name: err?.name || "Error",
    message: err?.message || String(err),
    stack: err?.stack || null,
  };
  pageErrors.push(row);
  console.log("[pageerror]", JSON.stringify(row));
});

async function settle(ms = 1500) {
  await page.waitForTimeout(ms);
}

async function resolveSpotChartTarget(currentPage) {
  const explicitHost = currentPage.locator('[data-research-chart-host="spot"]').first();
  if (await explicitHost.count()) {
    return explicitHost;
  }

  const intervalButtons = currentPage.locator("button").filter({ hasText: /^INTERVAL / });
  const chartButtonCount = await intervalButtons.count();
  for (let index = 0; index < chartButtonCount; index += 1) {
    const button = intervalButtons.nth(index);
    const box = await button.boundingBox().catch(() => null);
    if (!box || box.top < 0) {
      continue;
    }
    const target = currentPage.locator("canvas").evaluateAll((nodes, top) => {
      const candidates = nodes
        .map((node, nodeIndex) => {
          const rect = node.getBoundingClientRect();
          return {
            nodeIndex,
            top: rect.top,
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
      return currentPage.locator("canvas").nth(canvasIndex);
    }
  }

  const fallbackCanvas = currentPage.locator("canvas").evaluateAll((nodes) => {
    const candidates = nodes
      .map((node, nodeIndex) => {
        const rect = node.getBoundingClientRect();
        return {
          nodeIndex,
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
  return fallbackIndex != null ? currentPage.locator("canvas").nth(fallbackIndex) : null;
}

async function showCrash(label) {
  const crash = await page.evaluate(() => window.__lastCrashDiagnostics || null).catch(() => null);
  console.log("CRASH_CHECK", label, JSON.stringify(crash));
  return crash;
}

await page.goto("http://127.0.0.1:5000", {
  waitUntil: "domcontentloaded",
  timeout: 120000,
});
await settle(1500);
await page.evaluate(() => {
  window.__RESEARCH_CHART_TRACE_ENABLED = true;
});

const researchButton = page.getByRole("button", { name: "Research", exact: true });
if (await researchButton.count()) {
  await researchButton.click();
  await settle(3000);
}

const backtestButton = page.getByRole("button", { name: "Backtest", exact: true });
if (await backtestButton.count()) {
  await backtestButton.click();
  await settle(3000);
}

await page.screenshot({ path: "/tmp/research_probe_initial.png" });
const storedHistorySummary = await page.evaluate(async () => {
  if (!window.storage?.get) {
    return { available: false };
  }
  const response = await window.storage.get("spy-engine-research-history-v1");
  if (!response?.value) {
    return { available: true, hasValue: false };
  }
  try {
    const parsed = JSON.parse(response.value);
    return {
      available: true,
      hasValue: true,
      runHistory: Array.isArray(parsed?.runHistory) ? parsed.runHistory.length : 0,
      optimizerHistory: Array.isArray(parsed?.optimizerHistory) ? parsed.optimizerHistory.length : 0,
      savedSessions: Array.isArray(parsed?.savedSessions) ? parsed.savedSessions.length : 0,
    };
  } catch (error) {
    return {
      available: true,
      hasValue: true,
      parseError: error?.message || String(error),
    };
  }
});
console.log("STORED_HISTORY_SUMMARY", JSON.stringify(storedHistorySummary));
console.log("BUTTONS", JSON.stringify(
  await page.locator("button").evaluateAll((nodes) => nodes.map((node, index) => ({
    index,
    text: (node.innerText || "").trim(),
    title: node.getAttribute("title"),
    aria: node.getAttribute("aria-label"),
  })).filter((entry) => entry.text || entry.title || entry.aria).slice(0, 240)),
));
console.log("BODY_HEAD", (await page.locator("body").innerText()).slice(0, 4000));
await showCrash("after-nav");

const historyButton = page.getByRole("button", { name: /^history$/i }).last();
await historyButton.click({ timeout: 20000 });
await settle(1500);

const loadStateButtons = page.getByRole("button", { name: /load state/i });
const loadStateCount = await loadStateButtons.count();
console.log("LOAD_STATE_COUNT", loadStateCount);
if (loadStateCount > 0) {
  await loadStateButtons.first().click({ timeout: 20000 });
  await settle(6000);
  console.log("POST_LOAD_BODY_HEAD", (await page.locator("body").innerText()).slice(0, 5000));
  await showCrash("after-load-state");
}

const logButton = page.getByRole("button", { name: /^log$/i }).last();
await logButton.click({ timeout: 20000 });
await settle(1000);

console.log("POST_LOG_BODY_HEAD", (await page.locator("body").innerText()).slice(0, 5000));

const rows = page.locator("tbody tr");
const rowCount = await rows.count();
console.log("ROW_COUNT", rowCount);
if (!rowCount) {
  throw new Error("No trade rows found in Log tab");
}

const rowSummaries = await rows.evaluateAll((nodes) => nodes.slice(0, 10).map((node, index) => ({
  index,
  text: (node.innerText || "").trim().slice(0, 240),
  buttons: Array.from(node.querySelectorAll("button")).map((button) => (button.innerText || "").trim()).filter(Boolean),
})));
console.log("ROW_SUMMARIES", JSON.stringify(rowSummaries));

let clickedRow = false;
for (let index = 0; index < Math.min(rowCount, 10); index += 1) {
  const row = rows.nth(index);
  if (!(await row.isVisible().catch(() => false))) {
    continue;
  }
  const firstButton = row.locator("button").first();
  if (await firstButton.count().catch(() => 0)) {
    try {
      await firstButton.click({ timeout: 4000 });
      clickedRow = true;
      console.log("CLICKED_ROW_BUTTON", index);
      break;
    } catch (error) {
      console.log("ROW_BUTTON_CLICK_FAILED", index, error?.message || String(error));
    }
  }
  try {
    await row.click({ timeout: 4000 });
    clickedRow = true;
    console.log("CLICKED_ROW", index);
    break;
  } catch (error) {
    console.log("ROW_CLICK_FAILED", index, error?.message || String(error));
  }
}
if (!clickedRow) {
  throw new Error("Unable to click any visible trade row");
}
await settle(6000);

const optionPanelText = await page.locator("body").innerText();
console.log("POST_SELECT_BODY_HEAD", optionPanelText.slice(0, 2500));
await page.screenshot({ path: "/tmp/research_probe_after_select.png" });
const crashAfterSelect = await showCrash("after-select");
await settle(15000);
const crashAfterSelectIdle = await showCrash("after-select-idle");

const spotHost = await resolveSpotChartTarget(page);
if (!spotHost) {
  throw new Error("Unable to resolve a spot chart target");
}
await spotHost.scrollIntoViewIfNeeded();
const box = await spotHost.boundingBox();
console.log("SPOT_BOX", JSON.stringify(box));
if (box) {
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.5);
  for (let i = 0; i < 10; i += 1) {
    await page.mouse.wheel(0, -900);
    await page.waitForTimeout(250);
  }
}

await settle(6000);
await settle(15000);
await page.screenshot({ path: "/tmp/research_probe_after_zoom.png" });
const crashAfterZoom = await showCrash("after-zoom");
const chartTrace = await page.evaluate(() => {
  const traceByKey = window.__researchChartTraceByKey || {};
  const entries = Object.entries(traceByKey).map(([key, events]) => {
    const normalizedEvents = Array.isArray(events) ? events : [];
    const overlayUpdates = normalizedEvents.filter((event) => event?.event === "overlay-payload-update");
    const emptyOverlayUpdates = overlayUpdates.filter((event) => Number(event?.windowCount) === 0 && Number(event?.zoneCount) === 0).length;
    const fullOverlayUpdates = overlayUpdates.filter((event) => Number(event?.windowCount) > 0 || Number(event?.zoneCount) > 0).length;
    return {
      key,
      totalEvents: normalizedEvents.length,
      applyRenderWindowCount: normalizedEvents.filter((event) => event?.event === "apply-render-window").length,
      visibleRangeChangeCount: normalizedEvents.filter((event) => event?.event === "visible-range-change").length,
      emptyOverlayUpdates,
      fullOverlayUpdates,
      lastEvents: normalizedEvents.slice(-8).map((event) => ({
        event: event?.event,
        ts: event?.ts,
        source: event?.source || null,
        owner: event?.owner || null,
        windowCount: event?.windowCount ?? null,
        zoneCount: event?.zoneCount ?? null,
      })),
    };
  });
  return {
    keys: entries.map((entry) => entry.key),
    byKey: entries,
    viewportTrace: Array.isArray(window.__researchViewportLinkTrace) ? window.__researchViewportLinkTrace.slice(-20) : [],
    chartDebug: window.__researchChartDebug || null,
  };
}).catch(() => ({ keys: [], byKey: [], viewportTrace: [], chartDebug: null }));

console.log("RESULT", JSON.stringify({
  crashAfterSelect,
  crashAfterSelectIdle,
  crashAfterZoom,
  chartTrace,
  pageErrors,
  consoleMessages: consoleMessages.slice(-80),
}, null, 2));

await browser.close();
