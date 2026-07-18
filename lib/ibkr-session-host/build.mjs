import { copyFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const packageDir = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(packageDir, "dist");

await rm(distDir, { recursive: true, force: true });
await build({
  entryPoints: {
    density: path.join(packageDir, "src/density.ts"),
    index: path.join(packageDir, "src/index.ts"),
  },
  platform: "node",
  bundle: true,
  format: "esm",
  outExtension: { ".js": ".mjs" },
  outdir: distDir,
  logLevel: "info",
  sourcemap: "linked",
});
await copyFile(
  path.join(packageDir, "src", "chromium-seccomp.json"),
  path.join(distDir, "chromium-seccomp.json"),
);
