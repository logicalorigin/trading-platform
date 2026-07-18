import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./BottomSheet.jsx", import.meta.url), "utf8");

test("bottom sheet supports an accessible description and caller-owned close label", () => {
  assert.match(source, /\bdescription\b/);
  assert.match(source, /\bdescriptionId\b/);
  assert.match(source, /<Dialog\.Description/);
  assert.match(source, /closeLabel = null/);
  assert.match(source, /aria-label=\{closeLabel \|\| `Close \$\{title\}`\}/);
});

test("bottom sheet can focus caller-selected content while preserving focus restoration", () => {
  assert.match(source, /\binitialFocusRef\b/);
  assert.match(source, /event\.preventDefault\(\)/);
  assert.match(source, /initialFocusRef\.current\?\.focus\?\.\(\)/);
  assert.match(source, /restoreFocusRef\.current\?\.focus\?\.\(\)/);
});
