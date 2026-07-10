import { copyFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const packageDir = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(packageDir, "dist");

await rm(distDir, { recursive: true, force: true });
await build({
  entryPoints: [path.join(packageDir, "src/index.ts")],
  platform: "node",
  bundle: true,
  format: "esm",
  outfile: path.join(distDir, "index.mjs"),
  logLevel: "info",
  sourcemap: "linked",
});
await copyFile(
  path.join(packageDir, "src", "chromium-seccomp.json"),
  path.join(distDir, "chromium-seccomp.json"),
);
