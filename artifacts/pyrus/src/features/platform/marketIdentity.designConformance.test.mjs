import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./marketIdentity.jsx", import.meta.url), "utf8");

test("compact market marks shorten their text fallback instead of clipping it", () => {
  assert.match(source, /size <= 14 \? identity\.fallbackText\.slice\(0, 1\)/);
});
