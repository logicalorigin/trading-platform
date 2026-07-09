import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./MarketDemoScreen.jsx", import.meta.url),
  "utf8",
);

test("the retained market screen stops its clock while hidden", () => {
  assert.match(
    source,
    /<RegimeTopBar[^>]*live=\{isVisible && !safeQaMode\} \/>/,
  );
  assert.match(
    source,
    /if \(!live\) return undefined;\s+setNow\(new Date\(\)\);\s+const id = setInterval/,
  );
});
