import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.PLAYWRIGHT_PORT || 18747);
const baseURL = `http://127.0.0.1:${port}`;
const runningInReplit =
  Boolean(process.env.REPL_ID) ||
  Boolean(process.env.REPLIT_DEV_DOMAIN) ||
  process.env.REPLIT_MODE === "workflow";
const disableWebServer =
  process.env.PYRUS_PLAYWRIGHT_NO_WEB_SERVER === "1" ||
  (runningInReplit && process.env.PYRUS_PLAYWRIGHT_ALLOW_WEB_SERVER !== "1");
const chromiumExecutablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?.trim() ||
  process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE?.trim();
const workers = Number(process.env.PLAYWRIGHT_WORKERS || 1);

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: true,
  workers: Number.isFinite(workers) && workers > 0 ? workers : 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        ...(chromiumExecutablePath
          ? {
              launchOptions: {
                executablePath: chromiumExecutablePath,
              },
            }
          : {}),
      },
    },
  ],
  ...(disableWebServer
    ? {}
    : {
        webServer: {
          command: `PORT=${port} BASE_PATH=/ pnpm dev`,
          url: baseURL,
          reuseExistingServer: true,
          timeout: 120_000,
        },
      }),
});
