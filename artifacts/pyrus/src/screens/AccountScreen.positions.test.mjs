import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./AccountScreen.jsx", import.meta.url), "utf8");

test("positions source selector is wired to live state, not pinned to all", () => {
  assert.match(
    source,
    /const \[sourceFilter, setSourceFilter\] = useState\(/,
    "Missing sourceFilter state in AccountScreen",
  );

  const positionsPanel = source.match(/<PositionsPanel[\s\S]*?\/>/)?.[0];
  assert.ok(positionsPanel, "Missing PositionsPanel render");
  // The selector must receive the live state + change handler so it can filter.
  assert.match(positionsPanel, /sourceFilter=\{sourceFilter\}/);
  assert.match(positionsPanel, /onSourceFilterChange=\{setSourceFilter\}/);
  // It must NOT be hardcoded to "all" (the original inert bug).
  assert.doesNotMatch(positionsPanel, /sourceFilter="all"/);
});

test("account positions trading actions use broker-safe account context", () => {
  assert.match(source, /const positionManagementAccountId = shadowMode \? null : selectedAccountId;/);
  assert.match(source, /const positionManagementGatewayReady = Boolean\(!shadowMode && gatewayTradingReady\);/);
  assert.match(
    source,
    /const positionManagementGatewayMessage = shadowMode\s*\?\s*"Shadow positions cannot be managed with live broker orders\."\s*:\s*gatewayTradingMessage;/,
  );

  const positionsPanel = source.match(
    /<PositionsPanel[\s\S]*?\/>/,
  )?.[0] ?? "";

  assert.match(positionsPanel, /accountId=\{positionManagementAccountId\}/);
  assert.match(positionsPanel, /environment=\{modeParams\.mode\}/);
  assert.match(positionsPanel, /gatewayTradingReady=\{positionManagementGatewayReady\}/);
  assert.match(positionsPanel, /gatewayTradingMessage=\{positionManagementGatewayMessage\}/);
});
