import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const positionsPanelSource = readFileSync(
  new URL("./TradePositionsPanel.jsx", import.meta.url),
  "utf8",
);
const tradeScreenSource = readFileSync(
  new URL("../../screens/TradeScreen.jsx", import.meta.url),
  "utf8",
);

test("trade positions panel requests complete enrichment without blocking quote hydration", () => {
  assert.match(
    positionsPanelSource,
    /useGetAccountPositions\([\s\S]*?\{ mode: (?:brokerAccountMode|environment), liveQuotes: false, detail: "full" \}/,
  );
  assert.doesNotMatch(positionsPanelSource, /useListPositions/);
});

test("trade screen requests the lightweight position shape without blocking quote hydration", () => {
  assert.match(
    tradeScreenSource,
    /useGetAccountPositions\([\s\S]*?\{ mode: (?:tradeBrokerAccountMode|environment), liveQuotes: false, detail: "fast" \}/,
  );
  assert.doesNotMatch(tradeScreenSource, /useListPositions/);
});
