import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./PositionsPanel.jsx", import.meta.url), "utf8");

test("account position actions omit dead focus and protective-stop workflows", () => {
  assert.doesNotMatch(source, /id: "focus"/);
  assert.doesNotMatch(source, /id: "adjust"/);
  assert.doesNotMatch(source, /PositionProtectionEditor/);
  assert.doesNotMatch(source, /\busePlaceOrder\b/);
  assert.doesNotMatch(source, /\busePreviewOrder\b/);
  assert.doesNotMatch(source, /\buseReplaceOrder\b/);
  assert.doesNotMatch(source, /\bhandleEditProtection\b/);
  assert.doesNotMatch(source, /\bhandleSubmitStop\b/);
  assert.doesNotMatch(source, /POSITION_MANAGEMENT_UNAVAILABLE_REASON/);
});

test("account Quick Trade omits the unavailable broker roll placeholder", () => {
  assert.doesNotMatch(source, /id: "roll"/);
  assert.doesNotMatch(
    source,
    /Roll workflow is disabled until a broker-safe multi-leg order flow exists\./,
  );
});

test("account Close position routes only to the prepared review ticket", () => {
  assert.match(source, /buildIbkrCloseReviewIntent/);
  assert.match(
    source,
    /closeReviewIntent: closeReview\.intent/,
  );
  assert.match(source, /label: "Close position"/);
  assert.match(
    source,
    /Review an account-bound DAY limit order before anything is submitted/,
  );
  assert.doesNotMatch(source, /const handleClosePosition = useCallback/);
  assert.doesNotMatch(source, /buildCloseOrderRequest/);
});
