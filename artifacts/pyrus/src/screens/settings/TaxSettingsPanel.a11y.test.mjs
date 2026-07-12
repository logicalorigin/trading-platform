import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./TaxSettingsPanel.jsx", import.meta.url), "utf8");

test("tax status rails use non-interactive status primitives", () => {
  assert.doesNotMatch(source, /<Pill\b/);
  assert.match(source, /<StatusPill\b/);
  assert.doesNotMatch(source, /<StatusPill\b[^>]*\btone=/);
});
