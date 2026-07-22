import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  resolveTradeL2QuoteState,
  resolveTradeL2TapeState,
} from "./tradeL2PanelState.js";

const source = readFileSync(new URL("./TradeL2Panel.jsx", import.meta.url), "utf8");
const tradeScreenSource = readFileSync(
  new URL("../../screens/TradeScreen.jsx", import.meta.url),
  "utf8",
);

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
  assert.match(
    source,
    /normalizeBrokerExecutionsPayload\(JSON\.parse\(event\.data\)\)/,
  );
  assert.doesNotMatch(source, /trade-market-depth/);
  assert.match(source, /Option depth unavailable/);
});

test("Trade L2 receives only a directly selected IBKR account", () => {
  assert.match(
    tradeScreenSource,
    /const selectedIbkrAccountId =[\s\S]*?accountProvider[\s\S]*?=== "ibkr"[\s\S]*?\? accountId[\s\S]*?: null/,
  );
  assert.match(
    tradeScreenSource,
    /<MemoTradeL2Panel[\s\S]*?accountId=\{selectedIbkrAccountId\}/,
  );
  assert.match(source, /loadingEndpoint=\{[\s\S]*?"\/api\/executions"/);
  assert.doesNotMatch(source, /\/api\/ibkr\/executions/);
});

test("Trade L2 never invents a spread for missing or partial quotes", () => {
  assert.deepEqual(resolveTradeL2QuoteState(), {
    kind: "unavailable",
    spread: null,
  });
  assert.deepEqual(
    resolveTradeL2QuoteState({
      row: { cBid: 2.4, cAsk: null },
      cp: "C",
    }),
    {
      kind: "partial",
      spread: null,
    },
  );
  assert.deepEqual(
    resolveTradeL2QuoteState({
      row: { pBid: 7.2, pAsk: 7.5 },
      cp: "P",
    }),
    {
      kind: "ready",
      spread: 0.3,
    },
  );
});

test("Trade L2 distinguishes broker fill loading, error, stale, and empty states", () => {
  const readyGate = {
    hasContractRow: true,
    brokerConfigured: true,
    brokerAuthenticated: true,
    accountId: "U123",
    providerContractId: "700001",
  };

  assert.equal(
    resolveTradeL2TapeState({ ...readyGate, isPending: true }).kind,
    "loading",
  );
  assert.equal(
    resolveTradeL2TapeState({ ...readyGate, isError: true }).kind,
    "error",
  );
  assert.deepEqual(
    resolveTradeL2TapeState({
      ...readyGate,
      isError: true,
      executions: [{ id: "fill-1" }],
    }),
    {
      kind: "stale",
      showRows: true,
      notice: "Showing last broker fills · refresh failed",
    },
  );
  assert.equal(resolveTradeL2TapeState(readyGate).kind, "empty");
  assert.deepEqual(
    resolveTradeL2TapeState({
      ...readyGate,
      isFetching: true,
      executions: [{ id: "fill-1" }],
    }),
    {
      kind: "refreshing",
      showRows: true,
      notice: "Refreshing broker fills",
    },
  );
});
