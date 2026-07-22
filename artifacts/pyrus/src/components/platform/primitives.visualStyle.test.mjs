import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const primitives = readFileSync(new URL("./primitives.jsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../../index.css", import.meta.url), "utf8");
const dataState = primitives.slice(
  primitives.indexOf("export const DataUnavailableState"),
  primitives.indexOf("/**\n * Icon"),
);
const surfacePanel = primitives.slice(
  primitives.indexOf("export const SurfacePanel"),
  primitives.indexOf("export const ThresholdHistogram"),
);

test("shared panels do not stack entrance animations under the screen transition", () => {
  assert.doesNotMatch(dataState, /ra-panel-enter/);
  assert.doesNotMatch(surfacePanel, /className=\{className \|\| "ra-panel-enter"\}/);
  assert.doesNotMatch(css, /\.ra-panel-enter \{[\s\S]{0,180}will-change:/);
});

test("neutral unavailable states are unframed while semantic states retain emphasis", () => {
  assert.match(dataState, /const neutral = variant === "neutral";/);
  assert.match(dataState, /background: neutral \? "transparent" : accentBg/);
  assert.match(dataState, /border: neutral \? "none" : `1px solid \$\{accentBorder\}`/);
  assert.doesNotMatch(dataState, /1px dashed/);
});

test("hover lift is fine-pointer only and press feedback is explicit", () => {
  assert.match(
    css,
    /@media \(hover: hover\) and \(pointer: fine\) \{[\s\S]{0,240}\.ra-interactive:hover/,
  );
  assert.match(css, /\.ra-press-feedback:active/);
  assert.match(
    css,
    /html\[data-pyrus-reduced-motion="on"\] \.ra-interactive:active/,
  );
  assert.doesNotMatch(css, /\n\.ra-interactive:hover \{/);
});
