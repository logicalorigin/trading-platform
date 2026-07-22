import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./AccountScreen.jsx", import.meta.url),
  "utf8",
);

test("tax center is the final account screen section", () => {
  const taxIndex = source.indexOf('testId="account-deferred-tax"');
  assert.ok(taxIndex >= 0, "Missing deferred Tax Center section");

  for (const marker of [
    "<PositionsPanel",
    'testId="account-deferred-today"',
    'testId="account-deferred-trading-analysis"',
    'testId="account-deferred-orders"',
    'testId="account-deferred-support"',
  ]) {
    const sectionIndex = source.indexOf(marker);
    assert.ok(sectionIndex >= 0, `Missing account section: ${marker}`);
    assert.ok(sectionIndex < taxIndex, `${marker} must render before Tax Center`);
  }
});
