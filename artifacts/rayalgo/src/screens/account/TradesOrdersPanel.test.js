import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getAccountOrderId } from "./TradesOrdersPanel.jsx";

const source = readFileSync(new URL("./TradesOrdersPanel.jsx", import.meta.url), "utf8");

test("account order ids stay distinct when broker order ids are missing", () => {
  const first = getAccountOrderId({
    accountId: "shadow",
    symbol: "PLTR",
    side: "buy",
    type: "LMT",
    placedAt: "2026-05-13T14:30:00.000Z",
    quantity: 1,
    status: "working",
  });
  const second = getAccountOrderId({
    accountId: "shadow",
    symbol: "PLTR",
    side: "buy",
    type: "LMT",
    placedAt: "2026-05-13T14:31:00.000Z",
    quantity: 1,
    status: "working",
  });

  assert.notEqual(first, second);
  assert.match(first, /^shadow:PLTR:buy:LMT:/);
});

test("orders and trades source filters are views within the shadow ledger", () => {
  assert.match(source, /label: "All Sources"/);
  assert.match(source, /label: "Options BT"/);
  assert.match(source, /label: "Watchlist BT"/);
  assert.doesNotMatch(source, /label: "Live Ledger"/);
});

test("orders and trades panel maps option assets to option market identity", () => {
  assert.match(source, /normalized === "options"/);
  assert.match(source, /return "options"/);
});
