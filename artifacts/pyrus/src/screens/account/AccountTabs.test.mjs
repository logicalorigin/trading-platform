import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  accountDayPnlValue,
  accountTabLabel,
  brokerBrandForAccount,
  providerLabel,
} from "./AccountTabs.jsx";
import { maskAccountId } from "./accountUtils.jsx";

const readLocalSource = (filename) =>
  readFileSync(new URL(filename, import.meta.url), "utf8");

test("providerLabel labels strictly by the wire provider enum, never leaking it raw", () => {
  assert.equal(providerLabel({ provider: "ibkr" }), "IBKR");
  // Every SnapTrade-linked account (incl. E*TRADE) carries provider 'snaptrade';
  // the brokerage name isn't in the normalized wire shape, so label by provider.
  assert.equal(providerLabel({ provider: "snaptrade" }), "SnapTrade");
  assert.equal(providerLabel({ provider: "SnapTrade" }), "SnapTrade");
  // Direct-OAuth brokers carry their own provider enum and get a branded label
  // (previously fell through to the neutral 'Brokerage' fallback).
  assert.equal(providerLabel({ provider: "robinhood" }), "Robinhood");
  assert.equal(providerLabel({ provider: "schwab" }), "Schwab");
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
  assert.equal(
    accountTabLabel({
      displayName: "E*Trade Individual RETIREMENT ROTH IRA",
      providerAccountId: "snaptrade:abc",
    }),
    "RETIREMENT ROTH IRA",
  );
  assert.equal(
    accountTabLabel({
      displayName: "IBKR Individual",
      providerAccountId: "U7654321",
    }),
    "IBKR Individual",
    "Raw account-id safety wins over display-name cleanup when cleanup would be empty.",
  );
});

test("accountDayPnlValue reads day pnl fields used by account-list rows", () => {
  assert.equal(accountDayPnlValue({ dayPnl: -71.15 }), -71.15);
  assert.equal(accountDayPnlValue({ todayPnl: 12.5 }), 12.5);
  assert.equal(accountDayPnlValue({ dayPnl: null, pnlToday: 0 }), 0);
  assert.equal(accountDayPnlValue({}), null);
});

test("brokerBrandForAccount derives visible broker marks without trusting raw provider ids", () => {
  assert.equal(
    brokerBrandForAccount({
      provider: "snaptrade",
      displayName: "E*Trade RETIREMENT ROTH IRA",
    }).label,
    "E*TRADE",
  );
  assert.equal(
    brokerBrandForAccount({
      provider: "snaptrade",
      displayName: "Interactive Brokers Individual",
    }).label,
    "IBKR",
  );
  assert.equal(brokerBrandForAccount({ provider: "ibkr" }).label, "IBKR");
  assert.equal(
    brokerBrandForAccount({ provider: "robinhood" }).label,
    "Robinhood",
  );
  assert.equal(brokerBrandForAccount({ provider: "schwab" }).label, "Schwab");
  assert.equal(
    brokerBrandForAccount({ provider: "unknownBroker" }).label,
    "Brokerage",
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

test("AccountTabs masks account identifiers and wraps instead of horizontally scrolling", () => {
  const source = readLocalSource("./AccountTabs.jsx");

  // Account identifiers must be masked, never rendered in full.
  assert.match(source, /maskAccountId\(account\?\.providerAccountId\)/);
  // Many accounts should form multiple rows instead of hiding behind a
  // horizontal scroller.
  assert.match(source, /flexWrap: "wrap"/);
  assert.match(source, /overflowX: "visible"/);
  assert.doesNotMatch(source, /overflowX: "auto"/);
  assert.match(source, /role="tab"/);
});

test("AccountTabs renders broker marks with NLV and day P&L, not provider/source captions", () => {
  const source = readLocalSource("./AccountTabs.jsx");

  assert.match(source, /formatAccountMoney\(nav, currency, true, maskValues\)/);
  assert.match(source, /formatAccountSignedMoney\(dayPnl, currency, true, maskValues\)/);
  assert.match(source, /NLV/);
  assert.match(source, /Day/);
  assert.doesNotMatch(source, /caption=\{brand\.label\}/);
  assert.doesNotMatch(source, /caption=\{`\$\{providerLabel\(account\)\}/);
});
