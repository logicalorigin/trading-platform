import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildTreemapItems } from "./PositionTreemapPanel.jsx";

test("treemap cost basis uses the first positive contract multiplier", () => {
  const [item] = buildTreemapItems([
    {
      id: "adjusted-option",
      symbol: "ADJ",
      averageCost: 100,
      quantity: 1,
      marketValue: 5_100,
      unrealizedPnl: 100,
      optionContract: { multiplier: -100, sharesPerContract: 50 },
    },
  ]);

  assert.equal(item.unrealizedPnlPercent, 2);
});

test("treemap does not invent standard option economics", () => {
  const rows = [
    {
      id: "missing-option-economics",
      symbol: "MISS",
      assetClass: "option",
      averageCost: 100,
      quantity: 1,
      marketValue: 5_100,
      unrealizedPnl: 100,
      optionContract: {},
    },
    {
      id: "invalid-option-economics",
      symbol: "BAD",
      assetClass: "option",
      averageCost: 100,
      quantity: 1,
      marketValue: 5_100,
      unrealizedPnl: 100,
      optionContract: {
        multiplier: -100,
        standardDeliverableVerified: true,
      },
    },
    {
      id: "verified-standard-option",
      symbol: "STD",
      assetClass: "option",
      averageCost: 50,
      quantity: 1,
      marketValue: 10_100,
      unrealizedPnl: 100,
      optionContract: { standardDeliverableVerified: true },
    },
    {
      id: "equity",
      symbol: "STK",
      assetClass: "equity",
      averageCost: 100,
      quantity: 1,
      marketValue: 110,
      unrealizedPnl: 10,
    },
  ];
  const items = new Map(buildTreemapItems(rows).map((item) => [item.id, item]));

  assert.equal(items.get("missing-option-economics")?.unrealizedPnlPercent, 2);
  assert.equal(items.get("invalid-option-economics")?.unrealizedPnlPercent, 2);
  assert.equal(items.get("verified-standard-option")?.unrealizedPnlPercent, 1);
  assert.equal(items.get("equity")?.unrealizedPnlPercent, 10);
});

test("treemap excludes provider rows whose authoritative money is unavailable", () => {
  assert.deepEqual(
    buildTreemapItems([
      {
        id: "snaptrade:mixed:SHOP",
        accountId: "snaptrade:mixed",
        symbol: "SHOP",
        marketValue: 240,
        brokerMarketValue: null,
      },
    ]),
    [],
  );
});

test("treemap prefers complete provider money over conflicting derived average cost", () => {
  const [item] = buildTreemapItems([
    {
      id: "provider-basis",
      symbol: "BASIS",
      assetClass: "equity",
      quantity: 1,
      averageCost: 50,
      marketValue: 110,
      unrealizedPnl: 10,
    },
  ]);

  assert.equal(item.unrealizedPnlPercent, 10);
});

test("position treemap exposes a concise accessible chart description", () => {
  const source = readFileSync(
    new URL("./PositionTreemapPanel.jsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /role="img"/);
  assert.match(source, /aria-label=\{`Position treemap sized by absolute market value/);
});
