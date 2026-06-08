import assert from "node:assert/strict";
import test from "node:test";

import { sortSignalsRows } from "./signalsRowModel.js";

const row = (symbol, universeRank) => ({
  symbol,
  universeRank,
  statusWeight: 0,
  direction: "",
  activityMs: 0,
});

test("Signals rows sort by universe rank", () => {
  const rows = [
    row("MSFT", 3),
    row("AAPL", 1),
    row("NVDA", 2),
  ];

  assert.deepEqual(
    sortSignalsRows(rows, { sortKey: "rank", direction: "asc" }).map(
      (item) => item.symbol,
    ),
    ["AAPL", "NVDA", "MSFT"],
  );
  assert.deepEqual(
    sortSignalsRows(rows, { sortKey: "rank", direction: "desc" }).map(
      (item) => item.symbol,
    ),
    ["MSFT", "NVDA", "AAPL"],
  );
});
