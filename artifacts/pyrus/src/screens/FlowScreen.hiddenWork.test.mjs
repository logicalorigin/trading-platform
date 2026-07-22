import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./FlowScreen.jsx", import.meta.url), "utf8");

test("the retained Flow screen releases scanner runtime subscriptions while hidden", () => {
  assert.match(
    source,
    /const flowScannerStatusProps = \{\s*enabled: Boolean\(isVisible && flowScannerEnabled\),/,
  );
});
