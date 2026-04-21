import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.PLAYWRIGHT_PORT || 18747);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: true,
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
      },
    },
  ],
  webServer: {
    command: `PORT=${port} BASE_PATH=/ pnpm dev`,
    url: baseURL,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
