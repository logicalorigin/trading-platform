// Throwaway visual QA: real admin session -> Settings Data & Broker -> screenshot. Delete after use.
import { readFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const SCRATCH =
  "/tmp/claude-1000/-home-runner-workspace/62589e95-88e5-4984-bbac-2de7c228c971/scratchpad";
const { sessionToken } = JSON.parse(readFileSync(`${SCRATCH}/qa-session.json`, "utf8"));

const browser = await chromium.launch({
  executablePath: process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
});
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
await context.addCookies([
  {
    name: "pyrus_session",
    value: sessionToken,
    url: "http://127.0.0.1:18747/",
  },
]);
const page = await context.newPage();
const errors = [];
const apiStatuses = [];
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
page.on("response", (response) => {
  const url = response.url();
  if (url.includes("/api/")) {
    apiStatuses.push(`${response.status()} ${new URL(url).pathname}`);
  }
});
page.on("requestfailed", (request) => {
  if (request.url().includes("/api/")) {
    apiStatuses.push(`FAILED ${new URL(request.url()).pathname} ${request.failure()?.errorText}`);
  }
});
await page.goto("http://127.0.0.1:18747/?screen=settings", { waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="platform-screen-stack"]', { timeout: 60_000 });
await page
  .waitForSelector('[data-testid="pyrus-boot-progress-overlay"]', { state: "hidden", timeout: 60_000 })
  .catch(() => {});
await page.click('[data-testid="settings-tab-data-broker"]');
await page.waitForSelector("text=SnapTrade Brokerage", { timeout: 20_000 });
await page.waitForTimeout(25_000); // let the boot request storm drain (client timeout is 20s)
// Retry the live list after boot: the panel Refresh button refetches readiness + brokerages.
const refreshButton = page
  .locator('button:has-text("Refresh")')
  .first();
await refreshButton.click().catch(() => {});
await page
  .waitForSelector('button[aria-pressed] img', { timeout: 30_000 })
  .catch(() => {});
const probe = await page.evaluate(async () => {
  const tab = document.querySelector('[data-testid="settings-tab-data-broker"]');
  const auth = await fetch("/api/auth/session", { headers: { Accept: "application/json" } });
  const authBody = await auth.json().catch(() => null);
  const brokerages = await fetch("/api/broker-execution/snaptrade/brokerages", {
    headers: { Accept: "application/json" },
  });
  const brokeragesBody = await brokerages.json().catch(() => null);
  return {
    tabPressed: tab?.getAttribute("aria-pressed"),
    authStatus: auth.status,
    authRole: authBody?.user?.role ?? null,
    brokeragesStatus: brokerages.status,
    brokerageCount: brokeragesBody?.brokerages?.length ?? null,
  };
});
console.log(JSON.stringify({ probe }));
const panel = page.locator("text=Broker target");
await panel.scrollIntoViewIfNeeded().catch(() => {});
await page.screenshot({ path: `${SCRATCH}/live-broker-chooser.png`, fullPage: false });
console.log(JSON.stringify({ errors, apiStatuses }));
await browser.close();
