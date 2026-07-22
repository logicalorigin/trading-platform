import assert from "node:assert/strict";
import test from "node:test";

import type {
  BrokerPositionSnapshot,
  QuoteSnapshot,
} from "../providers/ibkr/client";
import {
  buildPositionMarketHydration,
  positionPnlBasis,
  positionPnlPercent,
  positionSignedNotional,
} from "./account-position-model";

const quote = (overrides: Partial<QuoteSnapshot>): QuoteSnapshot =>
  ({
    symbol: "XYZ",
    price: 12,
    bid: 11.9,
    ask: 12.1,
    prevClose: 10,
    change: 1.5,
    changePercent: 15,
    updatedAt: new Date("2026-07-10T15:00:00.000Z"),
    ...overrides,
  }) as QuoteSnapshot;

const position = (
  assetClass: "equity" | "option",
  quantity: number,
): BrokerPositionSnapshot => ({
  id: `${assetClass}:${quantity}`,
  accountId: "DU123",
  symbol: "XYZ",
  assetClass,
  quantity,
  averagePrice: 8,
  marketPrice: 8,
  marketValue: 8 * quantity * (assetClass === "option" ? 100 : 1),
  unrealizedPnl: 0,
  unrealizedPnlPercent: 0,
  optionContract:
    assetClass === "option"
      ? {
          ticker: "XYZ260717C00010000",
          underlying: "XYZ",
          expirationDate: new Date("2026-07-17T00:00:00.000Z"),
          strike: 10,
          right: "call",
          multiplier: 100,
          sharesPerContract: 100,
          providerContractId: "12345",
        }
      : null,
});

for (const assetClass of ["equity", "option"] as const) {
  for (const quantity of [2, -2]) {
    test(`${assetClass} ${quantity > 0 ? "long" : "short"} applies multiplier and signed quantity to every position metric`, () => {
      const multiplier = assetClass === "option" ? 100 : 1;
      const hydrated = buildPositionMarketHydration(
        position(assetClass, quantity),
        quote({}),
        {
          openedAt: "2026-07-09T14:30:00.000Z",
          now: "2026-07-10T15:00:00.000Z",
        },
      );

      assert.equal(hydrated.mark, 12);
      assert.equal(hydrated.marketValue, 12 * quantity * multiplier);
      assert.equal(hydrated.unrealizedPnl, 4 * quantity * multiplier);
      assert.equal(hydrated.unrealizedPnlPercent, 50 * Math.sign(quantity));
      // prevClose is authoritative. The intentionally inconsistent quote.change (1.5)
      // must not replace current mark (12) minus prior close (10).
      assert.equal(hydrated.dayChange, 2 * quantity * multiplier);
      assert.equal(hydrated.dayChangePercent, 20 * Math.sign(quantity));
    });
  }
}

test("nonzero quote change infers a prior close when the provider omits prevClose", () => {
  const hydrated = buildPositionMarketHydration(
    position("equity", -2),
    quote({ prevClose: null, change: 2, changePercent: 20 }),
    {
      openedAt: "2026-07-09T14:30:00.000Z",
      now: "2026-07-10T15:00:00.000Z",
    },
  );

  assert.equal(hydrated.dayChange, -4);
  assert.equal(hydrated.dayChangePercent, -20);
});

test("zero broker valuation is not replaced with purchase cost", () => {
  const zeroPricedPosition = {
    ...position("equity", 950),
    averagePrice: 0.2896,
    marketPrice: 0,
    marketValue: 0,
    unrealizedPnl: -275.12,
    unrealizedPnlPercent: -100,
  };

  assert.equal(positionSignedNotional(zeroPricedPosition), 0);
  assert.equal(
    buildPositionMarketHydration(zeroPricedPosition, null).marketValue,
    0,
  );
});

test("zero market value uses a real broker mark before purchase cost", () => {
  const markedPosition = {
    ...position("equity", 2),
    averagePrice: 8,
    marketPrice: 12,
    marketValue: 0,
  };

  assert.equal(positionSignedNotional(markedPosition), 24);
});

test("Robinhood option valuation cannot be overwritten by an unrelated external contract quote", () => {
  const robinhoodOption = {
    ...position("option", 2),
    providerSecurityType: "robinhood_option",
    averagePrice: 2.5,
    marketPrice: 3,
    marketValue: 600,
    unrealizedPnl: 100,
    unrealizedPnlPercent: 20,
  };

  const hydrated = buildPositionMarketHydration(
    robinhoodOption,
    quote({ price: 9, bid: 8.9, ask: 9.1 }),
  );

  assert.equal(hydrated.mark, 3);
  assert.equal(hydrated.marketValue, 600);
  assert.equal(hydrated.unrealizedPnl, 100);
  assert.equal(hydrated.unrealizedPnlPercent, 20);
  assert.equal(hydrated.source, "IBKR_POSITIONS");
});

test("option valuation cannot fall below live intrinsic value", () => {
  const aapCall = {
    ...position("option", 7),
    symbol: "AAP",
    averagePrice: 1.94,
    marketPrice: 3.9,
    marketValue: 2_730,
    unrealizedPnl: 1_372,
    optionContract: {
      ticker: "O:AAP260724C00051000",
      underlying: "AAP",
      expirationDate: new Date("2026-07-24T00:00:00.000Z"),
      strike: 51,
      right: "call" as const,
      multiplier: 100,
      sharesPerContract: 100,
      providerContractId: "O:AAP260724C00051000",
    },
  };

  const hydrated = buildPositionMarketHydration(
    aapCall,
    quote({
      symbol: "AAP",
      price: 3.9,
      bid: 3,
      ask: 4.8,
      underlyingPrice: 55.48,
    }),
  );

  assert.ok(Math.abs((hydrated.mark ?? 0) - 4.48) < 1e-9);
  assert.ok(Math.abs(hydrated.marketValue - 3_136) < 1e-9);
  assert.ok(Math.abs(hydrated.unrealizedPnl - 1_778) < 1e-9);
});

test("combined long and short percentages divide summed PnL by summed absolute bases", () => {
  const longBasis = positionPnlBasis(1_200, 200);
  const shortBasis = positionPnlBasis(-800, 200);
  assert.equal(longBasis, 1_000);
  assert.equal(shortBasis, 1_000);
  assert.equal(positionPnlPercent(400, (longBasis ?? 0) + (shortBasis ?? 0)), 20);
});
