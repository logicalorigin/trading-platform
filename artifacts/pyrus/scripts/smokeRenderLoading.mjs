#!/usr/bin/env node

import { chromium } from "@playwright/test";
import { ensurePatchedPlaywrightChromium } from "./preparePlaywrightChromium.mjs";

const DEFAULT_PORT = "18747";
const STORAGE_KEY = "pyrus:state:v1";
const MATRIX_TIMEFRAMES = ["2m", "5m", "15m"];

const port =
  process.env.PYRUS_RENDER_SMOKE_PORT ||
  process.env.PLAYWRIGHT_PORT ||
  process.env.PORT ||
  DEFAULT_PORT;
const baseUrl =
  process.env.PYRUS_RENDER_SMOKE_URL || `http://127.0.0.1:${port}/`;
const timeoutMs = Math.max(
  5_000,
  Number.parseInt(process.env.PYRUS_RENDER_SMOKE_TIMEOUT_MS || "20000", 10) ||
    20_000,
);

function nowIso() {
  return new Date().toISOString();
}

function matrixResponse() {
  const now = nowIso();
  return {
    profile: {
      id: "render-smoke-profile",
      environment: "paper",
      enabled: false,
      watchlistId: null,
      timeframe: "5m",
      pyrusSignalsSettings: {},
      freshWindowBars: 0,
      pollIntervalSeconds: 60,
      maxSymbols: 0,
      evaluationConcurrency: 0,
      lastEvaluatedAt: null,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    },
    states: [],
    evaluatedAt: now,
    timeframes: MATRIX_TIMEFRAMES,
    truncated: false,
    skippedSymbols: [],
    cacheStatus: "hit",
    refreshing: false,
    coverage: {
      requestedSymbols: 0,
      evaluatedSymbols: 0,
      pendingSymbols: 0,
      totalSymbols: 0,
      timeframes: MATRIX_TIMEFRAMES.length,
      taskCount: 0,
      sourceStrategy: "hybrid_1m_5m",
      sourceRequestCount: 0,
      hydratedSymbols: 0,
      missingSymbols: 0,
      estimatedFullCycleMs: null,
      cacheStatus: "hit",
      durationMs: 0,
      skippedSymbols: 0,
      truncated: false,
    },
  };
}

async function assertExistingApp() {
  const healthUrl = new URL("/api/healthz", baseUrl).toString();
  const response = await fetch(healthUrl, {
    signal: AbortSignal.timeout(Math.min(3_000, timeoutMs)),
  });
  if (!response.ok) {
    throw new Error(
      `Existing PYRUS app is not healthy at ${healthUrl}: HTTP ${response.status}`,
    );
  }
}

async function main() {
  await assertExistingApp();

  const executablePath = await ensurePatchedPlaywrightChromium();
  const browser = await chromium.launch({
    executablePath,
    headless: true,
  });

  const pageErrors = [];
  const consoleErrors = [];
  const requestFailures = [];

  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();

    page.on("pageerror", (error) => {
      pageErrors.push(error.message || String(error));
    });
    page.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push(message.text());
      }
    });
    page.on("requestfailed", (request) => {
      const failureText = request.failure()?.errorText || "";
      if (!/ERR_ABORTED|net::ERR_FAILED/.test(failureText)) {
        requestFailures.push(`${request.method()} ${request.url()} ${failureText}`);
      }
    });

    await page.addInitScript(
      ({ storageKey }) => {
        window.__PYRUS_PERF_WARMUP_OVERRIDES__ = {
          disableOperationalCodePreload: true,
          disableHiddenScreenWarmMount: true,
          disableBackgroundDataWarmup: true,
          disableResearchWorkspacePreload: true,
        };

        try {
          const current = JSON.parse(window.localStorage.getItem(storageKey) || "{}");
          window.localStorage.setItem(
            storageKey,
            JSON.stringify({
              ...current,
              screen: "market",
              sym: "SPY",
            }),
          );
        } catch {
          window.localStorage.setItem(
            storageKey,
            JSON.stringify({ screen: "market", sym: "SPY" }),
          );
        }

        class SmokeEventSource extends EventTarget {
          static CONNECTING = 0;
          static OPEN = 1;
          static CLOSED = 2;

          constructor(url) {
            super();
            this.url = String(url);
            this.readyState = SmokeEventSource.CLOSED;
            window.setTimeout(() => {
              if (typeof this.onerror === "function") {
                this.onerror(new Event("error"));
              }
              this.dispatchEvent(new Event("error"));
            }, 0);
          }

          close() {
            this.readyState = SmokeEventSource.CLOSED;
          }
        }

        window.EventSource = SmokeEventSource;
      },
      { storageKey: STORAGE_KEY },
    );

    await page.route("**/api/signal-monitor/matrix", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(matrixResponse()),
      }),
    );
    await page.route("**/api/diagnostics/client-events", (route) =>
      route.fulfill({ status: 204 }),
    );
    await page.route("**/api/diagnostics/client-metrics", (route) =>
      route.fulfill({ status: 204 }),
    );
    await page.route("**/api/streams/**", (route) =>
      route.fulfill({ status: 204 }),
    );

    const startedAt = Date.now();
    await page.goto(baseUrl, {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs,
    });
    await page.waitForSelector('[data-testid="platform-screen-stack"]', {
      state: "attached",
      timeout: timeoutMs,
    });
    await page.waitForSelector('[data-testid="market-workspace"]', {
      state: "attached",
      timeout: timeoutMs,
    });

    const summary = await page.evaluate(() => {
      const text = document.body?.innerText || "";
      return {
        title: document.title,
        bootLoaderPresent: Boolean(
          document.querySelector('[data-testid="pyrus-boot-loader"]'),
        ),
        appFallbackPresent: Boolean(
          document.querySelector('[data-testid="app-loading-fallback"]'),
        ),
        platformScreenStackPresent: Boolean(
          document.querySelector('[data-testid="platform-screen-stack"]'),
        ),
        marketWorkspacePresent: Boolean(
          document.querySelector('[data-testid="market-workspace"]'),
        ),
        bodyTextLength: text.length,
        warmup: window.__PYRUS_PERF_WARMUP_SNAPSHOT__ || null,
      };
    });

    const result = {
      ok: true,
      url: baseUrl,
      durationMs: Date.now() - startedAt,
      pageErrors,
      consoleErrors,
      requestFailures,
      summary,
    };

    if (
      pageErrors.length ||
      consoleErrors.length ||
      !summary.platformScreenStackPresent ||
      !summary.marketWorkspacePresent ||
      summary.bodyTextLength < 100
    ) {
      result.ok = false;
    }

    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) {
      process.exitCode = 1;
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        url: baseUrl,
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    ),
  );
  process.exit(1);
});
