import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./TradeForensics.jsx", import.meta.url), "utf8");

test("trade forensics bars identify themselves as active account requests", () => {
  assert.match(source, /buildBarsRequestOptions/);
  assert.match(source, /BARS_REQUEST_PRIORITY\.active/);
  assert.match(
    source,
    /request:\s*buildBarsRequestOptions\([\s\S]*BARS_REQUEST_PRIORITY\.active[\s\S]*"account-trade-forensics"[\s\S]*\)/,
  );
});
