import assert from "node:assert/strict";
import test from "node:test";

import { GetOptionQuoteSnapshotsResponse } from "./generated/api.ts";

test("option quote responses accept unknown day change without a prior close", () => {
  const result = GetOptionQuoteSnapshotsResponse.safeParse({
    underlying: "DOCU",
    quotes: [
      {
        symbol: "O:DOCU260717C00090000",
        price: 1.25,
        bid: 1.2,
        ask: 1.3,
        bidSize: 10,
        askSize: 12,
        change: null,
        changePercent: null,
        open: null,
        high: null,
        low: null,
        prevClose: null,
        volume: null,
        providerContractId: "O:DOCU260717C00090000",
        source: "massive",
        transport: "massive_websocket",
        delayed: false,
        updatedAt: "2026-07-16T14:45:00.000Z",
      },
    ],
    transport: "massive_websocket",
    delayed: false,
    fallbackUsed: false,
  });

  assert.equal(result.success, true, result.success ? undefined : result.error.message);
});
