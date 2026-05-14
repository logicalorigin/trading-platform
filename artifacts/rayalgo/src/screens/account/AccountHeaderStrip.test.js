import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./AccountHeaderStrip.jsx", import.meta.url), "utf8");

test("account switcher supports pointer outside close and escape close", () => {
  assert.match(source, /addEventListener\("pointerdown", handlePointerDown\)/);
  assert.match(source, /addEventListener\("keydown", handleKeyDown\)/);
  assert.match(source, /event\.key === "Escape"/);
  assert.doesNotMatch(source, /addEventListener\("mousedown"/);
});
