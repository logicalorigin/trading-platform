#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdir, rm, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distEntry = resolve(rootDir, "artifacts/ibkr-bridge/dist/index.mjs");
const bundlePath = resolve(
  rootDir,
  "artifacts/ibgateway-bridge-windows-current.tar.gz",
);

async function assertFile(path, label) {
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size <= 0) {
      throw new Error(`${label} is empty or not a file: ${path}`);
    }
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(
        `${label} was not found. Build @workspace/ibkr-bridge first. ${error.message}`,
      );
    }
    throw error;
  }
}

await assertFile(distEntry, "IBKR bridge bundle entrypoint");
await mkdir(resolve(rootDir, "artifacts"), { recursive: true });
await rm(bundlePath, { force: true });

const tar = spawnSync(
  "tar",
  ["-czf", bundlePath, "artifacts/ibkr-bridge/dist"],
  {
    cwd: rootDir,
    stdio: "inherit",
  },
);

if (tar.error) {
  throw tar.error;
}

if (tar.status !== 0) {
  throw new Error(`tar exited with status ${tar.status ?? "unknown"}`);
}

await assertFile(bundlePath, "IBKR bridge bundle");
const bundleInfo = await stat(bundlePath);
console.log(
  `Packaged IBKR bridge bundle at ${bundlePath} (${bundleInfo.size} bytes).`,
);
