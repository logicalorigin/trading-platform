import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./DeferredRender.jsx", import.meta.url), "utf8");

test("mounted deferred content does not retain a placeholder minimum height", () => {
  assert.match(source, /Render children eagerly/);
  assert.doesNotMatch(source, /style=\{\{\s*minHeight/);
});
