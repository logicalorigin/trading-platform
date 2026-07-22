import assert from "node:assert/strict";
import test from "node:test";

import {
  ORDER_BLOTTER_CANCELLATION_AVAILABLE,
  ORDER_BLOTTER_CANCELLATION_UNAVAILABLE_REASON,
  CLOSE_REVIEW_QUOTE_FUTURE_TOLERANCE_MS,
  CLOSE_REVIEW_QUOTE_MAX_AGE_MS,
  buildIbkrCloseReviewIntent,
  getIbkrCloseReviewIntentIssue,
  getIbkrCloseReviewPositionIssue,
  isCloseReviewQuoteTimestampCurrent,
} from "./positionOrderActions.js";

test("generic broker blotters fail closed when lifecycle ownership is unknown", () => {
  assert.equal(ORDER_BLOTTER_CANCELLATION_AVAILABLE, false);
  assert.match(
    ORDER_BLOTTER_CANCELLATION_UNAVAILABLE_REASON,
    /cannot verify that the broker order belongs to PYRUS's prepared lifecycle/,
  );
});

test("buildIbkrCloseReviewIntent binds a long equity close to one live IBKR account", () => {
  const result = buildIbkrCloseReviewIntent({
    accountId: "ibkr-acct-1",
    provider: "ibkr",
    position: {
      id: "position-aapl",
      symbol: "AAPL",
      positionType: "stock",
      quantity: 25,
      quote: { updatedAt: "2026-07-15T11:30:00.000Z" },
    },
  });

  assert.deepEqual(result, {
    intent: {
      kind: "ibkr_position_close_review",
      provider: "ibkr",
      accountId: "ibkr-acct-1",
      executionMode: "live",
      positionId: "position-aapl",
      symbol: "AAPL",
      assetClass: "equity",
      observedQuantity: 25,
      quantity: 25,
      side: "SELL",
      orderType: "LMT",
      timeInForce: "DAY",
      optionContract: null,
      sourceSnapshotAt: "2026-07-15T11:30:00.000Z",
    },
    reason: null,
  });
});

test("buildIbkrCloseReviewIntent preserves exact long-option sell-to-close identity", () => {
  const result = buildIbkrCloseReviewIntent({
    accountId: "ibkr-acct-1",
    provider: "IBKR",
    position: {
      id: "position-aapl-call",
      symbol: "AAPL  260918C00150000",
      marketDataSymbol: "AAPL",
      positionType: "option",
      quantity: 2,
      optionContract: {
        ticker: "AAPL  260918C00150000",
        underlying: "AAPL",
        expirationDate: "2026-09-18",
        strike: 150,
        right: "call",
        multiplier: 100,
        sharesPerContract: 100,
        providerContractId: "700001",
      },
      optionQuote: { updatedAt: "2026-07-15T11:31:00.000Z" },
    },
  });

  assert.equal(result.reason, null);
  assert.deepEqual(result.intent, {
    kind: "ibkr_position_close_review",
    provider: "ibkr",
    accountId: "ibkr-acct-1",
    executionMode: "live",
    positionId: "position-aapl-call",
    symbol: "AAPL",
    assetClass: "option",
    observedQuantity: 2,
    quantity: 2,
    side: "SELL",
    orderType: "LMT",
    timeInForce: "DAY",
    optionAction: "sell_to_close",
    positionEffect: "close",
    strategyIntent: "sell_to_close",
    optionContract: {
      ticker: "AAPL  260918C00150000",
      underlying: "AAPL",
      expirationDate: "2026-09-18",
      strike: 150,
      right: "call",
      multiplier: 100,
      sharesPerContract: 100,
      providerContractId: "700001",
    },
    sourceSnapshotAt: "2026-07-15T11:31:00.000Z",
  });
});

test("close-review quotes require a recent, non-future timestamp", () => {
  const now = Date.parse("2026-07-15T18:00:00.000Z");

  assert.equal(
    isCloseReviewQuoteTimestampCurrent({
      timestamp: now - CLOSE_REVIEW_QUOTE_MAX_AGE_MS,
      now,
    }),
    true,
  );
  assert.equal(
    isCloseReviewQuoteTimestampCurrent({
      timestamp: now - CLOSE_REVIEW_QUOTE_MAX_AGE_MS - 1,
      now,
    }),
    false,
  );
  assert.equal(
    isCloseReviewQuoteTimestampCurrent({
      timestamp: new Date(
        now + CLOSE_REVIEW_QUOTE_FUTURE_TOLERANCE_MS + 1,
      ).toISOString(),
      now,
    }),
    false,
  );
  assert.equal(
    isCloseReviewQuoteTimestampCurrent({ timestamp: null, now }),
    false,
  );
});

test("buildIbkrCloseReviewIntent fails closed outside the supported first slice", () => {
  const base = {
    accountId: "ibkr-acct-1",
    provider: "ibkr",
    position: { symbol: "AAPL", positionType: "stock", quantity: 4 },
  };

  assert.match(
    buildIbkrCloseReviewIntent({ ...base, provider: "snaptrade" }).reason,
    /direct IBKR account/i,
  );
  assert.match(
    buildIbkrCloseReviewIntent({ ...base, accountId: "combined" }).reason,
    /specific IBKR account/i,
  );
  assert.match(
    buildIbkrCloseReviewIntent({
      ...base,
      position: { ...base.position, quantity: 1.5 },
    }).reason,
    /whole-share/i,
  );
  assert.match(
    buildIbkrCloseReviewIntent({
      ...base,
      position: { ...base.position, quantity: -4 },
    }).reason,
    /short-equity/i,
  );
  assert.match(
    buildIbkrCloseReviewIntent({
      ...base,
      position: {
        symbol: "AAPL  260918C00150000",
        positionType: "option",
        quantity: -1,
        optionContract: {
          underlying: "AAPL",
          expirationDate: "2026-09-18",
          strike: 150,
          right: "call",
          multiplier: 100,
          sharesPerContract: 100,
        },
      },
    }).reason,
    /short-option/i,
  );
  assert.match(
    buildIbkrCloseReviewIntent({
      ...base,
      position: {
        symbol: "AAPL",
        positionType: "option",
        quantity: 1,
        optionContract: { strike: 150, right: "call" },
      },
    }).reason,
    /exact contract identity/i,
  );
  assert.match(
    buildIbkrCloseReviewIntent({
      ...base,
      position: {
        symbol: "AAPL  260918C00150000",
        marketDataSymbol: "AAPL",
        positionType: "option",
        quantity: 1,
        optionContract: {
          ticker: "AAPL  260918C00150000",
          underlying: "AAPL",
          expirationDate: "2026-09-18",
          strike: 150,
          right: "call",
          multiplier: 100,
          sharesPerContract: 100,
        },
      },
    }).reason,
    /exact contract identity/i,
  );
});

test("close-review handoffs fail validation when execution semantics are altered", () => {
  const { intent } = buildIbkrCloseReviewIntent({
    accountId: "ibkr-acct-1",
    provider: "ibkr",
    position: {
      id: "position-aapl",
      symbol: "AAPL",
      positionType: "stock",
      quantity: 4,
    },
  });

  assert.equal(getIbkrCloseReviewIntentIssue(intent), null);
  assert.match(
    getIbkrCloseReviewIntentIssue({ ...intent, side: "BUY" }),
    /invalid or incomplete/i,
  );
  assert.match(
    getIbkrCloseReviewIntentIssue({ ...intent, accountId: "combined" }),
    /invalid or incomplete/i,
  );
  assert.match(
    getIbkrCloseReviewIntentIssue({
      ...intent,
      assetClass: "option",
      optionAction: "sell_to_close",
      positionEffect: "close",
      strategyIntent: "sell_to_close",
      optionContract: { underlying: "AAPL" },
    }),
    /exact option contract/i,
  );
});

test("close-review inventory must still contain the exact source position and quantity", () => {
  const position = {
    id: "position-aapl",
    symbol: "AAPL",
    positionType: "stock",
    quantity: 4,
  };
  const { intent } = buildIbkrCloseReviewIntent({
    accountId: "ibkr-acct-1",
    provider: "ibkr",
    position,
  });

  assert.equal(
    getIbkrCloseReviewPositionIssue({
      intent,
      positions: [position],
      contextReady: true,
    }),
    null,
  );
  assert.match(
    getIbkrCloseReviewPositionIssue({
      intent,
      positions: [{ ...position, quantity: 3 }],
      contextReady: true,
    }),
    /position quantity changed/i,
  );
  assert.match(
    getIbkrCloseReviewPositionIssue({
      intent,
      positions: [],
      contextReady: true,
    }),
    /position is no longer open/i,
  );
  assert.match(
    getIbkrCloseReviewPositionIssue({
      intent,
      positions: [position],
      contextReady: false,
    }),
    /fresh live position inventory/i,
  );
});
