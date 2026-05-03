import { gzipSync } from "node:zlib";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const maxKb = Number(process.env.BUNDLE_AUDIT_MAX_KB ?? 350);
const distDir = resolve(import.meta.dirname, "../dist/public");
const assetsDir = resolve(distDir, "assets");
const indexHtmlPath = resolve(distDir, "index.html");

if (!existsSync(assetsDir)) {
  throw new Error(`Build assets not found at ${assetsDir}. Run the Vite build first.`);
}

const formatKb = (bytes) => `${(bytes / 1024).toFixed(1).padStart(7)} KiB`;
const jsAssets = readdirSync(assetsDir)
  .filter((fileName) => fileName.endsWith(".js"))
  .map((fileName) => {
    const path = resolve(assetsDir, fileName);
    const source = readFileSync(path);
    return {
      fileName,
      size: statSync(path).size,
      gzipSize: gzipSync(source).length,
    };
  })
  .sort((left, right) => right.size - left.size);

const overBudget = jsAssets.filter((asset) => asset.size / 1024 > maxKb);

console.log(`JS chunk budget: ${maxKb} KiB minified`);
console.log("");
console.log("Largest JS chunks:");
for (const asset of jsAssets.slice(0, 30)) {
  const marker = asset.size / 1024 > maxKb ? "  OVER" : "";
  console.log(
    `${formatKb(asset.size)} min  ${formatKb(asset.gzipSize)} gzip  ${asset.fileName}${marker}`,
  );
}

console.log("");
console.log("Entry modulepreloads:");
if (existsSync(indexHtmlPath)) {
  const indexHtml = readFileSync(indexHtmlPath, "utf8");
  const preloads =
    indexHtml.match(/<link rel="modulepreload"[^>]+>/g) ?? [];
  if (preloads.length) {
    preloads.forEach((preload) => console.log(preload));
  } else {
    console.log("(none)");
  }
} else {
  console.log(`index.html not found at ${indexHtmlPath}`);
}

if (overBudget.length) {
  console.error("");
  console.error(
    `Bundle audit failed: ${overBudget.length} JS chunk(s) exceed ${maxKb} KiB.`,
  );
  process.exitCode = 1;
}
