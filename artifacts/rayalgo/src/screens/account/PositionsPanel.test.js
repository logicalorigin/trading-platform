import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./PositionsPanel.jsx", import.meta.url), "utf8");

test("positions panel does not key nested order rows directly by broker order id", () => {
  assert.match(source, /positionOpenOrderKey/);
  assert.match(source, /positionSourceAttributionKey/);
  assert.doesNotMatch(source, /key=\{order\.id\}/);
});

test("positions source filters are views within the shadow ledger", () => {
  assert.match(source, /label: "All Sources"/);
  assert.match(source, /label: "Watchlist BT"/);
  assert.doesNotMatch(source, /label: "Options BT"/);
  assert.doesNotMatch(source, /label: "Live Ledger"/);
});

test("positions panel maps option assets to option market identity", () => {
  assert.match(source, /normalized === "options"/);
  assert.match(source, /return "options"/);
});

test("positions panel surfaces option contract and market detail in rows", () => {
  assert.match(source, /const optionInlineDetail/);
  assert.match(source, /optionContractLabel\(contract\)/);
  assert.match(source, /const formatOptionExpiryLabel/);
  assert.match(source, /parsed\.getUTCFullYear\(\)/);
  assert.match(source, /Opt \$\{quoteBidAsk\}/);
  assert.match(source, /U bid\/ask/);
  assert.match(source, /formatTimestampDetail/);
});

test("positions panel overlays live option quotes onto displayed rows and totals", () => {
  assert.match(source, /useIbkrOptionQuoteStream/);
  assert.match(source, /useStoredOptionQuoteSnapshotVersion/);
  assert.match(source, /getStoredOptionQuoteSnapshot/);
  assert.match(source, /applyLiveOptionQuoteToRow/);
  assert.match(source, /buildDisplayTotals/);
  assert.match(source, /displayTotals\.netExposure/);
});
