import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./AccountScreen.jsx", import.meta.url), "utf8");

test("broker account cards use viewport phone semantics instead of the narrow center pane", () => {
  const tabsBlock = /<AccountTabs[\s\S]*?\/>/.exec(source)?.[0] ?? "";

  assert.match(
    source,
    /const accountIsPhone = viewport\.flags\.isPhone \|\| accountElementFlags\.isPhone;/,
    "the rest of AccountScreen should remain container-aware",
  );
  assert.match(
    tabsBlock,
    /accountIsPhone=\{viewport\.flags\.isPhone\}/,
    "tablet and mid-size viewports must keep the authored 232–248px card tracks",
  );
  assert.doesNotMatch(tabsBlock, /accountIsPhone=\{accountIsPhone\}/);
});
