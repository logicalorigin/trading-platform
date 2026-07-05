import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { accountTabLabel, providerLabel } from "./AccountTabs.jsx";
import { maskAccountId } from "./accountUtils.jsx";

const readLocalSource = (filename) =>
  readFileSync(new URL(filename, import.meta.url), "utf8");

test("providerLabel labels strictly by the wire provider enum, never leaking it raw", () => {
  assert.equal(providerLabel({ provider: "ibkr" }), "IBKR");
  // Every SnapTrade-linked account (incl. E*TRADE) carries provider 'snaptrade';
  // the brokerage name isn't in the normalized wire shape, so label by provider.
  assert.equal(providerLabel({ provider: "snaptrade" }), "SnapTrade");
  assert.equal(providerLabel({ provider: "SnapTrade" }), "SnapTrade");
  // Unknown/missing provider falls back to a neutral word, never the raw enum.
  assert.equal(providerLabel({ provider: "webull" }), "Brokerage");
  assert.equal(providerLabel(undefined), "Brokerage");
});

test("accountTabLabel prefers the display name but never renders a raw account number", () => {
  // A friendly nickname passes through untouched.
  assert.equal(
    accountTabLabel({ displayName: "Roth IRA", providerAccountId: "U1234567" }),
    "Roth IRA",
  );
  // A displayName that IS the raw account id is masked instead.
  assert.equal(
    accountTabLabel({ displayName: "U1234567", providerAccountId: "U1234567" }),
    maskAccountId("U1234567"),
  );
  // A displayName that embeds the raw id is masked too.
  assert.equal(
    accountTabLabel({
      displayName: "IBKR U1234567",
      providerAccountId: "U1234567",
    }),
    maskAccountId("U1234567"),
  );
  // No display name falls back to the masked id.
  assert.equal(
    accountTabLabel({ providerAccountId: "U1234567" }),
    maskAccountId("U1234567"),
  );
});

test("maskAccountId shows only the last four characters", () => {
  assert.equal(maskAccountId("U1234567"), "••••4567");
  assert.equal(maskAccountId("42"), "••••42");
  assert.equal(maskAccountId(""), "—");
  assert.equal(maskAccountId(null), "—");
});

test("AccountTabs frames the account rows with leading All and trailing Shadow tabs", () => {
  const source = readLocalSource("./AccountTabs.jsx");

  assert.match(source, /role="tablist"/);
  assert.match(source, /const ALL_TAB_ID = "all"/);
  assert.match(source, /const SHADOW_TAB_ID = "shadow"/);
  // The All aggregate tab renders before the per-account map, Shadow after it.
  const allIndex = source.indexOf('id={ALL_TAB_ID}');
  const mapIndex = source.indexOf('grouped.map');
  const shadowIndex = source.indexOf('id={SHADOW_TAB_ID}');
  assert.ok(allIndex >= 0 && mapIndex >= 0 && shadowIndex >= 0);
  assert.ok(allIndex < mapIndex, "All tab must render before the account tabs");
  assert.ok(mapIndex < shadowIndex, "Shadow tab must render after the account tabs");
});

test("AccountTabs masks account identifiers and horizontally scrolls like the algo tabs", () => {
  const source = readLocalSource("./AccountTabs.jsx");

  // Account identifiers must be masked, never rendered in full.
  assert.match(source, /maskAccountId\(account\?\.providerAccountId\)/);
  // Mirror the AlgoDeploymentTabs overflow pattern for many-account overflow.
  assert.match(source, /overflowX: "auto"/);
  assert.match(source, /role="tab"/);
});
