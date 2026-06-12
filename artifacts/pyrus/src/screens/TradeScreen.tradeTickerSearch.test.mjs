import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readLocalSource = (filename) =>
  readFileSync(new URL(filename, import.meta.url), "utf8");

const tradeScreenSource = readLocalSource("./TradeScreen.jsx");
const chartFrameSource = readFileSync(
  new URL("../features/charting/ResearchChartFrame.tsx", import.meta.url),
  "utf8",
);

test("trade equity ticker search content is memoized by open state", () => {
  assert.match(
    tradeScreenSource,
    /const equityTickerSearchOpen =\s*tradeTickerSearchAnchor === "equity";/,
  );
  assert.match(
    tradeScreenSource,
    /const equityTickerSearchContent = useMemo\(\s*\(\) =>\s*renderTradeTickerSearch\(equityTickerSearchOpen\),/s,
  );
  assert.match(
    tradeScreenSource,
    /searchOpen=\{equityTickerSearchOpen\}/,
  );
  assert.match(
    tradeScreenSource,
    /searchContent=\{equityTickerSearchContent\}/,
  );
});

test("chart symbol search trigger is isolated from live quote header churn", () => {
  assert.match(
    chartFrameSource,
    /const palette = useMemo\(\(\) => getPanelPalette\(theme\), \[theme\]\);/,
  );
  assert.match(
    chartFrameSource,
    /const ChartSymbolSearchTrigger = memo\(function ChartSymbolSearchTrigger/,
  );
  assert.match(
    chartFrameSource,
    /<ChartSymbolSearchTrigger\s+theme=\{theme\}\s+palette=\{palette\}/,
  );
});
