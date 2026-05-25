#!/usr/bin/env node

import { spawn } from "node:child_process";
import { ensurePatchedPlaywrightChromium } from "./preparePlaywrightChromium.mjs";

const playwrightArgs = process.argv.slice(2);
const executablePath = await ensurePatchedPlaywrightChromium();

const child = spawn(
  "pnpm",
  ["exec", "playwright", "test", ...playwrightArgs],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      PLAYWRIGHT_CHROMIUM_EXECUTABLE: executablePath,
    },
  },
);

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
