import assert from "node:assert/strict";
import { test } from "node:test";

import {
  __refreshOptionsFlowWatchlistSymbolsForTests,
  __setOptionsFlowWatchlistSnapshotLoaderForTests,
  getOptionsFlowLaneSourceSymbols,
} from "./platform";

test("Massive watchlist coverage recovers after a transient database failure", async () => {
  let attempts = 0;
  const restore = __setOptionsFlowWatchlistSnapshotLoaderForTests(async () => {
    attempts += 1;
    if (attempts === 1) {
      throw new Error("database temporarily unavailable");
    }
    return {
      watchlists: [
        {
          items: [{ symbol: "RECOVER" }],
        },
      ],
    } as never;
  });

  try {
    await __refreshOptionsFlowWatchlistSymbolsForTests();
    await __refreshOptionsFlowWatchlistSymbolsForTests();

    assert.equal(attempts, 2);
    assert.ok(
      getOptionsFlowLaneSourceSymbols().candidateWatchlistSymbols.includes(
        "RECOVER",
      ),
    );
  } finally {
    restore();
  }
});
