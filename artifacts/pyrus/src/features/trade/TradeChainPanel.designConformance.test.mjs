import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./TradeChainPanel.jsx", import.meta.url), "utf8");

test("option-chain header controls wrap within narrow desktop panels", () => {
  const start = source.indexOf('data-testid="trade-chain-header-controls"');
  assert.notEqual(start, -1);
  const headerControls = source.slice(start, start + 500);

  assert.match(headerControls, /flexWrap: "wrap"/);
  assert.match(headerControls, /minWidth: 0/);
});
