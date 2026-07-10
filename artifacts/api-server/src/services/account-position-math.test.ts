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

test("combined long and short percentages divide summed PnL by summed absolute bases", () => {
  const longBasis = positionPnlBasis(1_200, 200);
  const shortBasis = positionPnlBasis(-800, 200);
  assert.equal(longBasis, 1_000);
  assert.equal(shortBasis, 1_000);
  assert.equal(positionPnlPercent(400, (longBasis ?? 0) + (shortBasis ?? 0)), 20);
});
