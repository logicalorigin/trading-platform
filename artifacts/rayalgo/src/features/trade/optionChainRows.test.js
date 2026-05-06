import assert from "node:assert/strict";
import test from "node:test";
import {
  buildOptionChainRowsFromApi,
  patchOptionChainRowWithQuoteGetter,
} from "./optionChainRows.js";

const optionContract = (right) => ({
  ticker: `SPY-20260515-${right === "call" ? "C" : "P"}500`,
  underlying: "SPY",
  expirationDate: "2026-05-15T00:00:00.000Z",
  strike: 500,
  right,
  multiplier: 100,
  sharesPerContract: 100,
  providerContractId: `${right}-500`,
});

test("buildOptionChainRowsFromApi renders last available metadata quote fields", () => {
  const rows = buildOptionChainRowsFromApi(
    [
      {
        contract: optionContract("call"),
        bid: 1.2,
        ask: 1.4,
        last: 1.3,
        mark: 1.35,
        volume: 120,
        openInterest: 340,
        impliedVolatility: 0.24,
        delta: 0.51,
        gamma: 0.02,
        theta: -0.03,
        vega: 0.1,
        quoteFreshness: "metadata",
        quoteUpdatedAt: null,
      },
    ],
    501,
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.cBid, 1.2);
  assert.equal(rows[0]?.cAsk, 1.4);
  assert.equal(rows[0]?.cPrem, 1.35);
  assert.equal(rows[0]?.cVol, 120);
  assert.equal(rows[0]?.cOi, 340);
  assert.equal(rows[0]?.cIv, 0.24);
  assert.equal(rows[0]?.cDelta, 0.51);
  assert.equal(rows[0]?.cFreshness, "metadata");
});

test("buildOptionChainRowsFromApi suppresses unavailable quote fields", () => {
  const rows = buildOptionChainRowsFromApi(
    [
      {
        contract: optionContract("put"),
        bid: 1.2,
        ask: 1.4,
        last: 1.3,
        mark: 1.35,
        quoteFreshness: "unavailable",
      },
    ],
    501,
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.pBid, null);
  assert.equal(rows[0]?.pAsk, null);
  assert.equal(rows[0]?.pPrem, null);
  assert.equal(rows[0]?.pFreshness, "unavailable");
});

test("buildOptionChainRowsFromApi suppresses zero price placeholders", () => {
  const rows = buildOptionChainRowsFromApi(
    [
      {
        contract: optionContract("call"),
        bid: 0,
        ask: 0,
        last: 1.25,
        mark: 0,
        volume: 0,
        openInterest: 20,
        quoteFreshness: "delayed_frozen",
      },
      {
        contract: optionContract("put"),
        bid: 0,
        ask: 0,
        last: 0,
        mark: 0,
        quoteFreshness: "metadata",
      },
    ],
    501,
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.cBid, null);
  assert.equal(rows[0]?.cAsk, null);
  assert.equal(rows[0]?.cPrem, 1.25);
  assert.equal(rows[0]?.cOi, 20);
  assert.equal(rows[0]?.pBid, null);
  assert.equal(rows[0]?.pAsk, null);
  assert.equal(rows[0]?.pPrem, null);
});

test("patchOptionChainRowWithQuoteGetter applies live quote snapshots without rebuilding the chain", () => {
  const [row] = buildOptionChainRowsFromApi(
    [
      {
        contract: optionContract("call"),
        bid: 1,
        ask: 1.2,
        last: 1.1,
        mark: 1.1,
        quoteFreshness: "metadata",
      },
    ],
    501,
  );

  const patched = patchOptionChainRowWithQuoteGetter(row, (providerContractId) =>
    providerContractId === "call-500"
      ? {
          bid: 1.5,
          ask: 1.7,
          price: 1.55,
          volume: 25,
          openInterest: 80,
          freshness: "live",
          dataUpdatedAt: "2026-05-06T14:30:00.000Z",
        }
      : null,
  );

  assert.equal(patched.cBid, 1.5);
  assert.equal(patched.cAsk, 1.7);
  assert.equal(patched.cPrem, 1.6);
  assert.equal(patched.cVol, 25);
  assert.equal(patched.cOi, 80);
  assert.equal(patched.cFreshness, "live");
  assert.equal(patched.cQuoteUpdatedAt, "2026-05-06T14:30:00.000Z");
});
