#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);

if (!args.length) {
  console.error("Usage: node scripts/run-market-data-worker.mjs <cargo args...>");
  process.exit(2);
}

const hasCommand = (command) =>
  spawnSync("sh", ["-c", `command -v ${command} >/dev/null 2>&1`], {
    stdio: "ignore",
  }).status === 0;

const shellQuote = (value) => `'${String(value).replace(/'/g, "'\\''")}'`;

let result;
if (hasCommand("cargo")) {
  result = spawnSync("cargo", args, { stdio: "inherit" });
} else if (hasCommand("nix-shell")) {
  result = spawnSync(
    "nix-shell",
    [
      "-p",
      "cargo",
      "rustc",
      "rustfmt",
      "pkg-config",
      "openssl",
      "--run",
      ["cargo", ...args].map(shellQuote).join(" "),
    ],
    { stdio: "inherit" },
  );
} else {
  console.error("Neither cargo nor nix-shell is available.");
  process.exit(127);
}

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
