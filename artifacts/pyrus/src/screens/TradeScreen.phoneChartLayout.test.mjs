import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./TradeScreen.jsx", import.meta.url), "utf8");

test("Trade phone Chart uses a presentation-only Spot or Contract canvas", () => {
  assert.match(
    source,
    /const \[activeTradePhoneChart, setActiveTradePhoneChart\] = useState\("spot"\);/,
  );
  assert.match(
    source,
    /ariaLabel="Phone chart"[\s\S]*value=\{activeTradePhoneChart\}[\s\S]*onChange=\{setActiveTradePhoneChart\}[\s\S]*value: "spot", label: "Spot"[\s\S]*value: "contract", label: "Contract"/,
  );
  assert.match(source, /data-testid="trade-phone-chart-canvas"/);
  assert.match(
    source,
    /visibility:\s*activeTradePhoneChart === "spot" \? "visible" : "hidden"/,
  );
  assert.match(
    source,
    /visibility:\s*activeTradePhoneChart === "contract"\s*\? "visible"\s*: "hidden"/,
  );
  assert.doesNotMatch(
    source,
    /onChange=\{\(side\) =>|onChange=\{expandTicketWithSide\}/,
  );
});

test("Trade narrow top and bottom third panels span both grid columns", () => {
  assert.match(
    source,
    /const tradeNarrowFullSpanStyle = \{\s*display: "grid",\s*gridColumn: tradeIsNarrow \? "1 \/ -1" : "auto",\s*minWidth: 0,\s*\};/,
  );
  assert.match(
    source,
    /<div style=\{tradeNarrowFullSpanStyle\}>\s*\{renderTradePanels \? \(\s*chainPanel/,
  );
  assert.match(
    source,
    /<div style=\{tradeNarrowFullSpanStyle\}>\s*\{renderTradePanels \? \(\s*positionsPanel/,
  );
});

test("Trade phone and tablet chart navigation uses the shared touch floor", () => {
  const phoneTabs = source.slice(
    source.indexOf('data-testid="trade-mobile-tabs"'),
    source.indexOf('data-testid="trade-phone-chart-canvas"'),
  );
  assert.match(phoneTabs, /className="ra-touch-target-y"/);
  assert.match(
    source,
    /data-testid="trade-chart-sync-timeframe"[\s\S]{0,160}className="ra-touch-target-y"/,
  );
  assert.match(
    source,
    /data-testid="trade-chart-sync-crosshair"[\s\S]{0,160}className="ra-touch-target-y"/,
  );
  assert.match(
    source,
    /onClick=\{\(\) => setPhoneL2DrawerOpen\(true\)\}\s+className="ra-touch-target-y"/,
  );
});
