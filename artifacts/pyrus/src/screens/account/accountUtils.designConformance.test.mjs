import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./accountUtils.jsx", import.meta.url), "utf8");

test("account badges and stat tiles use platform primitives", () => {
  assert.match(source, /import \{ Badge, SegmentedControl, Skeleton \}/);
  assert.match(source, /export const Pill[\s\S]*<Badge/);
  assert.doesNotMatch(source, /export const StatTile/);
  assert.doesNotMatch(source, /const toneValueMap/);
});
