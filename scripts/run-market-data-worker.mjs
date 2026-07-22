#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  runMarketDataWorker,
  safeMarketDataDisplay,
} from "./market-data-worker-lifecycle.mjs";

export {
  assertFileIdentity,
  captureExecutableIdentity,
  captureFileIdentity,
  commandIsAvailable,
  resolveCommandExecutable,
  resolveMarketDataWorkerCommand,
  runMarketDataWorker,
} from "./market-data-worker-lifecycle.mjs";

async function main(args = process.argv.slice(2)) {
  try {
    const outcome = await runMarketDataWorker(args);
    if (outcome.wrapperSignal) {
      process.kill(process.pid, outcome.wrapperSignal);
      return;
    }
    process.exitCode = outcome.code;
  } catch (error) {
    console.error(safeMarketDataDisplay(error?.message || error));
    process.exitCode = Number.isSafeInteger(error?.exitCode)
      ? error.exitCode
      : 1;
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  void main();
}
