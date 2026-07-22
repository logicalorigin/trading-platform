import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const marketSource = readFileSync(
  new URL("../../screens/MarketDemoScreen.jsx", import.meta.url),
  "utf8",
);

test("Market calendar activity uses attention tone", () => {
  assert.match(
    marketSource,
    /<span style=\{\{ color: CSS_COLOR\.amber,[^}]*\}\}>\s*\{event\.date\}/,
  );
});

test("Market headline sentiment uses directional blue/red semantics", () => {
  assert.match(
    marketSource,
    /const sentimentTone = \(sentiment\) => \{[\s\S]*?toneForDirectionalIntent\(/,
  );
  assert.doesNotMatch(
    marketSource,
    /toneForFinancialDelta\(mapNewsSentimentToScore\(sentiment\)\)/,
  );
});
