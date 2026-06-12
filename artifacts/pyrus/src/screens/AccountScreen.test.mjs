import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readLocalSource = (filename) =>
  readFileSync(new URL(filename, import.meta.url), "utf8");

test("shadow account mode does not prewarm real account streams when broker routes are unavailable", () => {
  const source = readLocalSource("./AccountScreen.jsx");

  assert.match(source, /const realAccountRoutesAvailable = Boolean\(/);
  assert.match(
    source,
    /const inactiveAccountSection = shadowMode\s*\?\s*realAccountRoutesAvailable\s*\?\s*"real"\s*:\s*null\s*:\s*"shadow";/s,
  );
  assert.match(
    source,
    /const inactiveAccountPageRequest = useMemo\(\s*\(\) =>\s*inactiveAccountSection\s*\?\s*getAccountSectionRequest\(inactiveAccountSection\)\s*:\s*null/s,
  );
  assert.match(source, /if \(!accountQueriesEnabled \|\| !section\)/);
  assert.match(
    source,
    /const inactiveAccountPrewarmEnabled = Boolean\(\s*isVisible &&\s*accountQueriesEnabled &&\s*inactiveAccountSection &&/s,
  );
});

test("account first-screen readiness exposes the frame before account data settles", () => {
  const source = readLocalSource("./AccountScreen.jsx");

  assert.match(
    source,
    /primaryReady: Boolean\(isVisible\),/,
  );
  assert.match(
    source,
    /derivedReady: Boolean\(isVisible && accountDerivedReady\),/,
  );
  assert.doesNotMatch(
    source,
    /primaryReady: Boolean\(isVisible && accountPrimaryReady\),/,
  );
});

test("account day PnL prefers live position row day changes over summary fallback", () => {
  const source = readLocalSource("./AccountScreen.jsx");
  const start = source.indexOf("const livePositionsDayPnlMetric =");
  const end = source.indexOf("const livePositionsNetLiquidation", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const block = source.slice(start, end);
  assert.match(
    block,
    /const totalDayPnl = hasDayChange \? openPositionsDayPnl : fallbackValue;/,
  );
  assert.doesNotMatch(block, /const totalDayPnl = fallbackValue \?\? openPositionsDayPnl;/);
});
