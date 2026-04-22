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

function roundRect(rect) {
  if (!rect) return null;
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
}

async function main() {
  const url = parseArg("url", "http://127.0.0.1:4174");
  const outDir = parseArg("out", "output/playwright/research-option-panel-probe");
  const waitMs = Number(parseArg("wait-ms", "5000")) || 5000;
  const executablePath = process.env.CHROMIUM_PATH || execSync("which chromium", { encoding: "utf8" }).trim();
  fs.mkdirSync(outDir, { recursive: true });

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
    await page.waitForTimeout(waitMs);

    const debug = await page.evaluate(() => ({
      title: document.title,
      bodyExcerpt: (document.body?.innerText || "").trim().replace(/\s+/g, " ").slice(0, 1200),
      hasDataReplay: Boolean([...document.querySelectorAll("*")].find((node) => (node.textContent || "").includes("Data & Replay"))),
      hasOutcomeKpis: Boolean([...document.querySelectorAll("*")].find((node) => (node.textContent || "").includes("Outcome KPIs"))),
      hasOptionReplay: Boolean([...document.querySelectorAll("*")].find((node) => (node.textContent || "").includes("Option Replay"))),
      hasSelectedOptionChart: Boolean([...document.querySelectorAll("*")].find((node) => (node.textContent || "").includes("Selected Option Chart"))),
      labelMatches: [...document.querySelectorAll("*")]
        .map((node) => ({
          text: (node.innerText || "").trim().replace(/\s+/g, " "),
        }))
        .filter((entry) => entry.text && (entry.text.includes("Option Replay") || entry.text.includes("Selected Option Chart")))
        .slice(0, 12),
      panelCandidates: [...document.querySelectorAll("div")]
        .map((node) => {
          const rect = node.getBoundingClientRect();
          const cs = getComputedStyle(node);
          return {
            text: (node.innerText || "").trim().replace(/\s+/g, " ").slice(0, 160),
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            borderTopWidth: cs.borderTopWidth,
            borderRadius: cs.borderRadius,
            boxShadow: cs.boxShadow,
            overflow: cs.overflow,
          };
        })
        .filter((entry) => entry.width > 320 && entry.height > 180 && (parseFloat(entry.borderTopWidth || "0") > 0 || entry.boxShadow !== "none"))
        .sort((a, b) => a.y - b.y || a.x - b.x)
        .slice(0, 20),
    }));

    const details = await page.evaluate(() => {
      const labels = ["OPTION REPLAY", "SELECTED OPTION CHART"];
      const panel = [...document.querySelectorAll("div")].find((node) => {
        const rect = node.getBoundingClientRect();
        const cs = getComputedStyle(node);
        const text = (node.innerText || "").trim().replace(/\s+/g, " ").toUpperCase();
        return (
          rect.width > 360
          && rect.height > 220
          && (parseFloat(cs.borderTopWidth || "0") > 0 || cs.boxShadow !== "none")
          && (cs.overflow === "hidden" || cs.display === "flex")
          && labels.some((label) => text.includes(label))
        );
      });

      if (!panel) {
        return { found: false };
      }

      const header = panel.children?.[0] || null;
      const viewport = panel.children?.[1] || null;

      return {
        found: true,
        panelRect: roundRect(panel.getBoundingClientRect()),
        headerRect: roundRect(header?.getBoundingClientRect?.() || null),
        viewportRect: roundRect(viewport?.getBoundingClientRect?.() || null),
        headerRatio: header && panel ? Number((header.getBoundingClientRect().height / Math.max(panel.getBoundingClientRect().height, 1)).toFixed(3)) : null,
        labelText: (panel.innerText || "").trim().replace(/\s+/g, " ").slice(0, 200),
      };

      function roundRect(rect) {
        if (!rect) return null;
        return {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
      }
    });

    const fullScreenshotPath = path.join(outDir, "research-surface-full.png");
    await page.screenshot({ path: fullScreenshotPath, fullPage: true });

    let panelScreenshotPath = null;
    if (details?.found && details.panelRect) {
      panelScreenshotPath = path.join(outDir, "research-option-panel.png");
      await page.screenshot({
        path: panelScreenshotPath,
        clip: {
          x: details.panelRect.x,
          y: details.panelRect.y,
          width: details.panelRect.width,
          height: details.panelRect.height,
        },
      });
    }

    console.log(JSON.stringify({
      url,
      executablePath,
      waitMs,
      debug,
      details,
      fullScreenshotPath,
      panelScreenshotPath,
    }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
