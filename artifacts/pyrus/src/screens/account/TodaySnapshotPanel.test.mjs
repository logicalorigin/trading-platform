import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const todaySource = readFileSync(
  new URL("./TodaySnapshotPanel.jsx", import.meta.url),
  "utf8",
);
const positionsSource = readFileSync(
  new URL("./PositionsPanel.jsx", import.meta.url),
  "utf8",
);

test("Today live quotes are owned only by the visible heatmap", () => {
  assert.match(
    todaySource,
    /enabled:\s*liveOptionQuotesEnabled\s*&&\s*tab === "heatmap"/,
  );
  assert.match(
    positionsSource,
    /useRuntimeTickerSnapshots\(\s*enabled && registerMarketDataSymbols\s*\? positionUnderlyingSymbols\s*:\s*\[\]/,
  );
  assert.doesNotMatch(positionsSource, /usePositionQuoteSnapshots/);
  assert.match(
    positionsSource,
    /useRuntimeTickerSnapshots\(\s*liveOptionQuotesEnabled\s*\?\s*positionSparklineSymbols\s*:\s*\[\],?\s*\)/,
  );
});
