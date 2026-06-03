import { chromium } from "@playwright/test";

const DEFAULT_URL = "http://127.0.0.1:18747/?pyrusQa=safe";
const STORAGE_KEY = "pyrus:state:v1";
const MARKET_TIME_ZONE = "America/New_York";
const LOOKBACK_MS = 36 * 60 * 60 * 1000;
const LOOKAHEAD_MS = 5 * 60 * 1000;
const PAGE_SIZE = 1000;

const targetUrl = process.env.PYRUS_QA_URL || DEFAULT_URL;
const headless = process.env.PYRUS_QA_HEADLESS !== "0";

const marketDateKey = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: MARKET_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return [byType.year, byType.month, byType.day].filter(Boolean).join("-");
};

const buildEventsUrl = (baseUrl, cursor = null) => {
  const now = Date.now();
  const url = new URL("/api/signal-monitor/events", baseUrl);
  url.searchParams.set("environment", "paper");
  url.searchParams.set("limit", String(PAGE_SIZE));
  url.searchParams.set("from", new Date(now - LOOKBACK_MS).toISOString());
  url.searchParams.set("to", new Date(now + LOOKAHEAD_MS).toISOString());
  if (cursor) {
    url.searchParams.set("cursor", cursor);
  }
  return url;
};

const fetchExpectedSameDayEventCount = async (baseUrl) => {
  const events = [];
  const seenCursors = new Set();
  let cursor = null;

  do {
    const response = await fetch(buildEventsUrl(baseUrl, cursor));
    if (!response.ok) {
      throw new Error(`Signal Monitor events request failed: ${response.status}`);
    }
    const page = await response.json();
    events.push(...(Array.isArray(page.events) ? page.events : []));
    if (!page.hasMore || !page.nextCursor) {
      break;
    }
    if (seenCursors.has(page.nextCursor)) {
      throw new Error("Signal Monitor events cursor repeated.");
    }
    seenCursors.add(page.nextCursor);
    cursor = page.nextCursor;
  } while (true);

  const todayKey = marketDateKey(new Date());
  return events.filter((event) => marketDateKey(event.signalAt) === todayKey).length;
};

const parseVisibleStaTotal = async (page) => {
  const table = page.locator('[data-testid="algo-operations-signal-table"]');
  const pagination = page.locator('[data-testid="algo-signals-pagination"]');
  const paginationText = (await pagination.count())
    ? await pagination.first().innerText()
    : "";
  const tableText = await table.innerText();
  const paginationMatch = paginationText.match(/\bof\s+(\d+)\b/);
  const statusMatch = tableText.match(/\bAll\s+\d+\s+of\s+(\d+)\s+signals\b/i);
  return {
    renderedRows: await page.locator('[data-testid^="algo-signal-row-"]').count(),
    total: Number(paginationMatch?.[1] ?? statusMatch?.[1] ?? 0),
    paginationText,
    tableText,
  };
};

const browser = await chromium.launch({ headless });
const context = await browser.newContext();
await context.addInitScript(({ key }) => {
  window.localStorage.setItem(key, JSON.stringify({ screen: "algo" }));
}, { key: STORAGE_KEY });

try {
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  const expectedSameDayEvents = await fetchExpectedSameDayEventCount(targetUrl);
  await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="algo-screen"]');
  await page.waitForSelector('[data-testid="algo-operations-signal-table"]');
  await page.waitForFunction(() => {
    const table = document.querySelector('[data-testid="algo-operations-signal-table"]');
    return Boolean(table?.textContent?.match(/\b(All|Current|History)\b/));
  });

  const visible = await parseVisibleStaTotal(page);
  if (expectedSameDayEvents > 20 && visible.total <= 20) {
    throw new Error(
      `STA expected a paginated same-day history but rendered ${visible.total} total rows. API same-day events: ${expectedSameDayEvents}.`,
    );
  }
  if (expectedSameDayEvents > 500 && visible.total <= 500) {
    throw new Error(
      `STA appears capped at ${visible.total} rows while API same-day events exceed 500 (${expectedSameDayEvents}).`,
    );
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        targetUrl,
        expectedSameDayEvents,
        visibleTotal: visible.total,
        renderedRows: visible.renderedRows,
        paginationText: visible.paginationText,
      },
      null,
      2,
    ),
  );
} finally {
  await context.close();
  await browser.close();
}
