import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./TradeScreen.jsx", import.meta.url), "utf8");

test("trade quote hydration carries native option identity metadata", () => {
  const start = source.indexOf("const heldContracts = useMemo");
  const block = source.slice(start, start + 2_000);

  assert.notEqual(start, -1);
  assert.match(block, /providerSecurityType:\s*position\.providerSecurityType/);
});
