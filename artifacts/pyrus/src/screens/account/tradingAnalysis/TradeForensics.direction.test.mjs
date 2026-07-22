import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./TradeForensics.jsx", import.meta.url),
  "utf8",
);

test("trade forensics keeps unknown direction visually neutral", () => {
  assert.match(source, /const tradeDirection =/);
  assert.match(
    source,
    /tradeDirection === "unknown"\s*\? CSS_COLOR\.textDim/,
  );
});
