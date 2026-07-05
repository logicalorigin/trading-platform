import { defineConfig } from "@playwright/test";

/**
 * Headless browser config for the pyrus e2e specs (e.g. `browser:waterfall`).
 *
 * On Replit we point Playwright at the Chromium that the Replit Nix Playwright
 * module provides (`REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE`); the matching shared
 * libraries are declared in `replit.nix`. This means `playwright test` runs in
 * the Replit container with NO `playwright install` / `install-deps` step and
 * survives container rebuilds.
 *
 * Off Replit (CI, local) the env var is unset and Playwright falls back to its
 * own downloaded browser — run `pnpm exec playwright install chromium` once.
 */
const executablePath = process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined;

export default defineConfig({
  testDir: "./e2e",
  use: {
    launchOptions: {
      executablePath,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    },
  },
});
