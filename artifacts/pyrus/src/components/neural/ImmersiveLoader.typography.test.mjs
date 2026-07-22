import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const indexCss = readFileSync(new URL("../../index.css", import.meta.url), "utf8");
const indexHtml = readFileSync(new URL("../../../index.html", import.meta.url), "utf8");

const rule = (source, selector) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "u"));
  assert.ok(match, `Missing ${selector} rule`);
  return match[1];
};

test("immersive loader keeps prose in sans and numeric progress in the data font", () => {
  const progress = rule(indexCss, ".brand-loader-progress");
  const percent = rule(indexCss, ".brand-loader-progress-percent");

  assert.match(progress, /font-family:\s*var\(--ra-font-sans,/u);
  assert.match(percent, /font-family:\s*var\(--ra-font-data,/u);
  assert.match(percent, /font-variant-numeric:\s*tabular-nums;/u);
});

test("pre-React loader nominates the canonical Sans face before app CSS loads", () => {
  const bootLoader = rule(indexHtml, ".pyrus-boot-loader");

  assert.match(
    bootLoader,
    /font-family:\s*"IBM Plex Sans",\s*system-ui,\s*-apple-system,\s*BlinkMacSystemFont,\s*"Segoe UI",\s*sans-serif;/u,
  );
});
