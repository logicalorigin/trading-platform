import assert from "node:assert/strict";
import test from "node:test";

import {
  formatCollapsedTicketFreshness,
  formatCollapsedTicketToggleLabel,
  resolveCollapsedTicketInstrument,
} from "./TradeTicketCollapsedBar.jsx";

test("collapsed ticket stays neutral until a provider contract is resolved", () => {
  assert.equal(
    resolveCollapsedTicketInstrument({
      ticker: "SPY",
      contract: { exp: "2026-07-14", strike: 750, cp: "C" },
      chainRows: [],
    }),
    null,
  );
});

test("collapsed ticket resolves a complete option instrument from the chain", () => {
  const instrument = resolveCollapsedTicketInstrument({
    ticker: "SPY",
    contract: { exp: "2026-07-14", strike: 750, cp: "C" },
    chainRows: [
      {
        k: 750,
        cFreshness: "live",
        cContract: { providerContractId: "SPY-20260714-C-750" },
      },
    ],
  });

  assert.deepEqual(instrument, {
    label: "SPY 07/14 750C",
    shortLabel: "SPY 750C",
    providerContractId: "SPY-20260714-C-750",
    rowFreshness: "live",
  });
});

test("collapsed ticket freshness always names status and timestamp state", () => {
  assert.equal(
    formatCollapsedTicketFreshness(
      { freshness: "delayed_frozen", updatedAt: null },
      "metadata",
    ),
    "delayed frozen · time unknown",
  );

  const providerTimestamp = formatCollapsedTicketFreshness(
    {
      freshness: "live",
      dataUpdatedAt: new Date().toISOString(),
      updatedAt: null,
    },
    "metadata",
  );
  assert.doesNotMatch(providerTimestamp, /time unknown/);
});

test("collapsed ticket never renders a zero option premium", async () => {
  const { resolveCollapsedTicketPrice } = await import(
    "./TradeTicketCollapsedBar.jsx"
  );
  assert.equal(typeof resolveCollapsedTicketPrice, "function");
  assert.equal(resolveCollapsedTicketPrice({ price: 0, bid: 0, ask: 0 }), null);
  assert.equal(resolveCollapsedTicketPrice({ price: 0, bid: 1, ask: 1.4 }), 1.2);
});

test("fallback ticket toggle names its ticker and expanded state", () => {
  assert.equal(
    formatCollapsedTicketToggleLabel({ ticker: "AAPL", expanded: false }),
    "Open AAPL order ticket",
  );
  assert.equal(
    formatCollapsedTicketToggleLabel({ ticker: "AAPL", expanded: true }),
    "Collapse AAPL order ticket",
  );
});
