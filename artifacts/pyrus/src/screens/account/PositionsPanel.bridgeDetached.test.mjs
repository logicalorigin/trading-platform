import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Source-assertion regression (jsx is not tsc-covered) for the detached-bridge
// positions relabel. Run: npx tsx --test src/screens/account/PositionsPanel.bridgeDetached.test.mjs

const source = readFileSync(
  new URL("./PositionsPanel.jsx", import.meta.url),
  "utf8",
);

test("a detached IBKR bridge is labeled 'Broker not connected', not an empty portfolio", () => {
  // Regression: when IBKR is configured but the bridge is detached, the positions
  // query is disabled (fetchStatus idle), so the empty state used to fall through
  // to the generic "No open positions" copy and mislabel a detached bridge as an
  // empty portfolio. It must now surface the real reason.
  assert.match(
    source,
    /positionsBridgeDetached\s*=\s*Boolean\(\s*brokerConfigured\s*&&\s*!brokerAuthenticated\s*\)/,
    "the detached condition (configured but not authenticated) must drive the empty-state copy",
  );
  assert.match(
    source,
    /"Broker not connected"/,
    "a detached bridge must title the positions empty state 'Broker not connected'",
  );
  assert.match(
    source,
    /The IBKR bridge is detached, so live positions can't be loaded/,
    "the detached empty-state body must explain the bridge is detached + prompt reconnect",
  );
});
