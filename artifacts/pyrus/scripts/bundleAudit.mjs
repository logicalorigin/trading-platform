import { gzipSync } from "node:zlib";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const maxKb = Number(process.env.BUNDLE_AUDIT_MAX_KB ?? 350);
if (!Number.isFinite(maxKb) || maxKb <= 0) {
  throw new Error("BUNDLE_AUDIT_MAX_KB must be a positive finite number.");
}
const distDir = resolve(import.meta.dirname, "../dist/public");
const assetsDir = resolve(distDir, "assets");
const indexHtmlPath = resolve(distDir, "index.html");
const forbiddenEntryImports = [
  "feature-charting-surface",
  "vendor-lightweight-charts",
  "pyrus-signals-core",
];

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
if (!jsAssets.length) {
  throw new Error(`Bundle audit found no JavaScript assets in ${assetsDir}.`);
}

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
let entrySource = "";
if (!existsSync(indexHtmlPath)) {
  throw new Error(`Bundle audit index.html not found at ${indexHtmlPath}.`);
}
const indexHtml = readFileSync(indexHtmlPath, "utf8");
const preloads = indexHtml.match(/<link rel="modulepreload"[^>]+>/g) ?? [];
if (preloads.length) {
  preloads.forEach((preload) => console.log(preload));
} else {
  console.log("(none)");
}
const entryScriptTag = (indexHtml.match(/<script\b[^>]*>/gi) ?? []).find((tag) =>
  /\btype=["']module["']/i.test(tag) && /\bsrc=["'][^"']+["']/i.test(tag),
);
const entryScriptSrc = entryScriptTag?.match(/\bsrc=["']([^"']+)["']/i)?.[1];
const entryFileName = entryScriptSrc?.split(/[?#]/, 1)[0].split("/").pop();
if (!entryFileName) {
  throw new Error("Bundle audit could not find the entry module in index.html.");
}
const entryPath = resolve(assetsDir, entryFileName);
if (!existsSync(entryPath)) {
  throw new Error(`Bundle audit entry module not found at ${entryPath}.`);
}
entrySource = readFileSync(entryPath, "utf8");
if (!entrySource.trim()) {
  throw new Error(`Bundle audit entry module is empty at ${entryPath}.`);
}

console.log("");
console.log("Entry deferred chunk guard:");
const forbiddenEntryImportHits = forbiddenEntryImports.filter((pattern) =>
  entrySource.includes(pattern),
);
if (forbiddenEntryImportHits.length) {
  console.error(
    `Entry chunk statically imports deferred chunks: ${forbiddenEntryImportHits.join(", ")}.`,
  );
  process.exitCode = 1;
} else {
  console.log("ok");
}

if (overBudget.length) {
  console.error("");
  console.error(
    `Bundle audit failed: ${overBudget.length} JS chunk(s) exceed ${maxKb} KiB.`,
  );
  process.exitCode = 1;
}
