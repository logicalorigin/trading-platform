import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./TradeL2Panel.jsx", import.meta.url), "utf8");

test("Trade L2 broker executions require configured and authenticated broker runtime", () => {
  const marker = "const brokerExecutionEnabled = Boolean(";
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, "Expected brokerExecutionEnabled guard");
  const body = source.slice(start, source.indexOf(");", start) + 2);

  assert.match(body, /isVisible/);
  assert.match(body, /brokerConfigured/);
  assert.match(body, /brokerAuthenticated/);
  assert.match(body, /selectedContractMeta\?\.providerContractId/);
  assert.match(body, /!streamingPaused/);
  assert.doesNotMatch(source, /trade-market-depth/);
  assert.match(source, /Option depth unavailable/);
});
