import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  AccountTabs,
  accountAggregateMetrics,
  accountDayPnlValue,
  accountSummaryMetrics,
  accountTabLabel,
  brokerBrandForAccount,
  deploymentAccountStatusLabel,
  deploymentAccountSummary,
  linkedDeploymentsForAccount,
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
  assert.equal(accountDayPnlValue({ dayPnl: null }), null);
  assert.equal(accountDayPnlValue({ dayPnl: "  " }), null);
  assert.equal(accountDayPnlValue({}), null);
});

test("accountAggregateMetrics only presents complete same-currency totals", () => {
  assert.deepEqual(
    accountAggregateMetrics([
      { netLiquidation: 100, dayPnl: 5, currency: "USD" },
      { netLiquidation: 200, dayPnl: -2, currency: "USD" },
    ]),
    {
      currency: "USD",
      nav: 300,
      dayPnl: 3,
      dayPnlPercent: (3 / 297) * 100,
    },
  );

  const partial = accountAggregateMetrics([
    { netLiquidation: 100, dayPnl: 5, currency: "USD" },
    { netLiquidation: null, dayPnl: null, currency: "USD" },
  ]);
  assert.equal(partial.nav, null);
  assert.equal(partial.dayPnl, null);
  assert.equal(partial.dayPnlPercent, null);

  const mixedCurrency = accountAggregateMetrics([
    { netLiquidation: 100, dayPnl: 5, currency: "USD" },
    { netLiquidation: 200, dayPnl: 4, currency: "CAD" },
  ]);
  assert.equal(mixedCurrency.nav, null);
  assert.equal(mixedCurrency.dayPnl, null);
  assert.equal(mixedCurrency.dayPnlPercent, null);

  const missingCurrency = accountAggregateMetrics([
    { netLiquidation: 100, dayPnl: 5, currency: "USD" },
    { netLiquidation: 200, dayPnl: 4, currency: null },
  ]);
  assert.equal(missingCurrency.currency, null);
  assert.equal(missingCurrency.nav, null);
  assert.equal(missingCurrency.dayPnl, null);
  assert.equal(missingCurrency.dayPnlPercent, null);

  const allMissingCurrency = accountAggregateMetrics([
    { netLiquidation: 100, dayPnl: 5 },
    { netLiquidation: 200, dayPnl: 4, currency: " " },
  ]);
  assert.equal(allMissingCurrency.currency, null);
  assert.equal(allMissingCurrency.nav, null);
  assert.equal(allMissingCurrency.dayPnl, null);
  assert.equal(allMissingCurrency.dayPnlPercent, null);

  assert.deepEqual(accountAggregateMetrics([]), {
    currency: "USD",
    nav: null,
    dayPnl: null,
    dayPnlPercent: null,
  });
});

test("accountSummaryMetrics reads the same NLV and day fields used by broker cards", () => {
  assert.deepEqual(
    accountSummaryMetrics({
      currency: "USD",
      metrics: {
        netLiquidation: { value: 50_000 },
        dayPnl: { value: -540.25 },
        dayPnlPercent: { value: -1.07 },
      },
    }),
    {
      currency: "USD",
      nav: 50_000,
      dayPnl: -540.25,
      dayPnlPercent: -1.07,
    },
  );

  assert.deepEqual(accountSummaryMetrics({ metrics: {} }), {
    currency: null,
    nav: null,
    dayPnl: null,
    dayPnlPercent: null,
  });
  assert.deepEqual(
    accountSummaryMetrics({
      metrics: {
        netLiquidation: { value: 50_000 },
        dayPnl: { value: 100 },
        dayPnlPercent: { value: 0.2 },
      },
    }),
    {
      currency: null,
      nav: null,
      dayPnl: null,
      dayPnlPercent: null,
    },
  );
});

test("linkedDeploymentsForAccount follows durable targets and keeps non-running links", () => {
  const deployments = [
    {
      id: "running",
      name: "Running",
      enabled: true,
      targets: [
        {
          accountType: "broker",
          accountId: "account-a",
          providerAccountId: "provider-a",
          lifecycle: "active",
          allocationPercent: 25,
          hardCeilingPercent: 60,
        },
      ],
    },
    {
      id: "paused",
      name: "Paused",
      enabled: false,
      targets: [
        {
          accountType: "broker",
          accountId: "account-a",
          lifecycle: "active",
          allocationPercent: 10,
          hardCeilingPercent: 60,
        },
      ],
    },
    {
      id: "draining",
      name: "Draining",
      enabled: false,
      targets: [
        {
          accountType: "broker",
          accountId: "account-a",
          lifecycle: "draining",
          allocationPercent: 5,
          hardCeilingPercent: 60,
        },
      ],
    },
    {
      id: "detached",
      name: "Detached",
      enabled: false,
      targets: [
        {
          accountType: "broker",
          accountId: "account-a",
          lifecycle: "detached",
          allocationPercent: 5,
          hardCeilingPercent: 60,
        },
      ],
    },
    {
      id: "other",
      name: "Other",
      enabled: true,
      targets: [
        {
          accountType: "broker",
          accountId: "account-b",
          lifecycle: "active",
          allocationPercent: 25,
          hardCeilingPercent: 60,
        },
      ],
    },
  ];

  assert.deepEqual(
    linkedDeploymentsForAccount(deployments, {
      accountType: "broker",
      accountId: "account-a",
      providerAccountId: "provider-a",
    }).map((deployment) => deployment.id),
    ["running", "paused", "draining"],
  );
  assert.deepEqual(linkedDeploymentsForAccount(deployments, {}), []);
});

test("deployment account labels distinguish lifecycle and include both allowance scopes", () => {
  assert.equal(
    deploymentAccountStatusLabel({ archivedAt: "2026-07-21T00:00:00Z" }),
    "Archived",
  );
  assert.equal(deploymentAccountStatusLabel({ isDraft: true }), "Draft");
  assert.equal(
    deploymentAccountStatusLabel({ linkedTarget: { lifecycle: "draining" } }),
    "Draining",
  );
  assert.equal(
    deploymentAccountStatusLabel({
      linkedTarget: { lifecycle: "manual_takeover" },
    }),
    "Manual takeover",
  );
  assert.equal(deploymentAccountStatusLabel({ enabled: true }), "Running");
  assert.equal(deploymentAccountStatusLabel({ enabled: false }), "Paused");
  assert.equal(
    deploymentAccountSummary({
      name: "Signal Options",
      enabled: false,
      linkedTarget: {
        lifecycle: "active",
        allowance: { unit: "usd", value: 3_000 },
        totalAlgoAllowance: { unit: "percent", value: 60 },
      },
    }),
    "Signal Options · Paused · $3,000 allowance · 60% shared total",
  );
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
    brokerBrandForAccount({
      provider: "snaptrade",
      displayName: "Alpaca Paper",
    }).label,
    "Alpaca",
  );
  assert.equal(
    brokerBrandForAccount({
      provider: "snaptrade",
      displayName: "Webull Individual",
    }).label,
    "Webull",
  );
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

test("AccountTabs frames the account rows with leading All and trailing Shadow choices", () => {
  const source = readLocalSource("./AccountTabs.jsx");

  assert.match(source, /role="group"/);
  assert.match(source, /const ALL_TAB_ID = "all"/);
  assert.match(source, /const SHADOW_TAB_ID = "shadow"/);
  // The All aggregate tab renders before the per-account map, Shadow after it.
  const allIndex = source.indexOf("id={ALL_TAB_ID}");
  const mapIndex = source.indexOf("grouped.map");
  const shadowIndex = source.indexOf("id={SHADOW_TAB_ID}");
  assert.ok(allIndex >= 0 && mapIndex >= 0 && shadowIndex >= 0);
  assert.ok(allIndex < mapIndex, "All tab must render before the account tabs");
  assert.ok(
    mapIndex < shadowIndex,
    "Shadow tab must render after the account tabs",
  );
});

test("AccountTabs masks account identifiers and grids instead of horizontally scrolling", () => {
  const source = readLocalSource("./AccountTabs.jsx");

  // Account identifiers must be masked, never rendered in full.
  assert.match(source, /maskAccountId\(account\?\.providerAccountId\)/);
  // Many accounts should form responsive grid rows instead of hiding behind a
  // horizontal scroller.
  assert.match(source, /display: "grid"/);
  assert.match(source, /gridTemplateColumns:/);
  assert.match(source, /overflowX: "visible"/);
  assert.doesNotMatch(source, /overflowX: "auto"/);
  assert.match(source, /aria-pressed=\{active\}/);
  assert.doesNotMatch(source, /role="tab"|role="tablist"|aria-selected=/);
});

test("AccountTabs keeps current values available for compact aggregate cards", () => {
  const source = readLocalSource("./AccountTabs.jsx");

  assert.match(
    source,
    /formatAccountMoney\(nav, currency, false, maskValues\)/,
  );
  assert.match(
    source,
    /formatAccountSignedMoney\(dayPnl, currency, true, maskValues\)/,
  );
  assert.match(source, /NLV/);
  assert.match(source, /Day/);
  assert.doesNotMatch(source, /caption=\{brand\.label\}/);
  assert.doesNotMatch(source, /caption=\{`\$\{providerLabel\(account\)\}/);
});

test("Shadow stacks NLV and day change in the top-right metric column", () => {
  const previousReact = globalThis.React;
  globalThis.React = React;
  try {
    const html = renderToStaticMarkup(
      createElement(AccountTabs, {
        accounts: [],
        shadowSummary: {
          currency: "USD",
          metrics: {
            netLiquidation: { value: 50_000 },
            dayPnl: { value: -540.25 },
            dayPnlPercent: { value: -1.07 },
          },
        },
      }),
    );
    const metricsStyle =
      /data-testid="account-tab-shadow-metrics" style="([^"]*)"/u.exec(
        html,
      )?.[1] ?? "";

    assert.match(html, /data-testid="account-tab-shadow-metrics"/);
    assert.match(metricsStyle, /grid-column:3/u);
    assert.match(metricsStyle, /grid-row:1/u);
    assert.match(metricsStyle, /justify-items:end/u);
    assert.doesNotMatch(metricsStyle, /border-top|grid-template-columns/u);
    assert.match(html, />NLV</);
    assert.match(html, />Day</);
    assert.match(html, /\$50,000/);
    assert.doesNotMatch(html, /\$50\.0K/);
    assert.match(html, /540/);
    assert.ok(
      html.indexOf(">NLV<") < html.indexOf(">Day<"),
      "Day change must render directly below NLV.",
    );
  } finally {
    globalThis.React = previousReact;
  }
});

test("a broker card with unknown currency withholds monetary metrics", () => {
  const previousReact = globalThis.React;
  globalThis.React = React;
  try {
    const html = renderToStaticMarkup(
      createElement(AccountTabs, {
        accounts: [
          {
            id: "unknown-currency",
            providerAccountId: "U0000001",
            provider: "ibkr",
            displayName: "Unknown Currency",
            netLiquidation: 10_000,
            dayPnl: 250,
            dayPnlPercent: 2.5,
          },
        ],
      }),
    );
    const card =
      /<button[^>]*data-testid="account-tab-unknown-currency"[^>]*>([\s\S]*?)<\/button>/u.exec(
        html,
      )?.[1] ?? "";

    assert.doesNotMatch(card, />NLV</u);
    assert.doesNotMatch(card, />Day</u);
    assert.doesNotMatch(card, /\$10,000|\$250/u);
    assert.doesNotMatch(html, /\$10,000|\$250/u);
  } finally {
    globalThis.React = previousReact;
  }
});

test("collapsed live-account cards keep identity compact without losing masked labels", () => {
  const previousReact = globalThis.React;
  globalThis.React = React;
  try {
    const html = renderToStaticMarkup(
      createElement(AccountTabs, {
        accounts: [
          {
            id: "masked-label",
            providerAccountId: "U1234567",
            provider: "ibkr",
            currency: "USD",
          },
          {
            id: "named-label",
            providerAccountId: "U7654321",
            provider: "ibkr",
            displayName: "Roth IRA",
            currency: "USD",
          },
        ],
      }),
    );
    const maskedCard =
      /<button[^>]*data-testid="account-tab-masked-label"[^>]*>([\s\S]*?)<\/button>/u.exec(
        html,
      );
    const namedCard =
      /<button[^>]*data-testid="account-tab-named-label"[^>]*>([\s\S]*?)<\/button>/u.exec(
        html,
      );
    const namedIdentityLinesStyle =
      /data-testid="account-tab-named-label-identity-lines" style="([^"]*)"/u.exec(
        html,
      )?.[1] ?? "";
    const visibleMaskedText = (maskedCard?.[1] ?? "").replace(/<[^>]*>/gu, "");
    const visibleNamedText = (namedCard?.[1] ?? "").replace(/<[^>]*>/gu, "");

    assert.equal(visibleMaskedText.match(/••••4567/gu)?.length, 1);
    assert.match(visibleNamedText, /Roth IRA/u);
    assert.doesNotMatch(visibleNamedText, /••••4321/u);
    assert.match(namedIdentityLinesStyle, /display:grid/u);
    assert.doesNotMatch(
      namedIdentityLinesStyle,
      /display:flex|justify-content:space-between/u,
    );
    assert.match(maskedCard?.[0] ?? "", /aria-label="••••4567 ••••4567"/u);
    assert.match(maskedCard?.[0] ?? "", /title="••••4567 ••••4567"/u);
  } finally {
    globalThis.React = previousReact;
  }
});

test("live account cards own sibling expand controls while All and Shadow remain compact", () => {
  const previousReact = globalThis.React;
  globalThis.React = React;
  try {
    const html = renderToStaticMarkup(
      createElement(AccountTabs, {
        accounts: [
          {
            id: "account-a",
            providerAccountId: "provider-a",
            provider: "ibkr",
            displayName: "Primary",
            currency: "USD",
          },
          {
            id: "account-b",
            providerAccountId: "provider-b",
            provider: "snaptrade",
            displayName: "Retirement",
            currency: "USD",
          },
        ],
      }),
    );

    assert.match(
      html,
      /data-testid="account-tab-account-a-expand"[^>]*aria-expanded="false"/u,
    );
    assert.match(
      html,
      /data-testid="account-tab-account-b-expand"[^>]*aria-expanded="false"/u,
    );
    assert.doesNotMatch(html, /data-testid="account-tab-all-expand"/u);
    assert.doesNotMatch(html, /data-testid="account-tab-shadow-expand"/u);
    assert.match(
      html,
      /data-testid="account-tab-account-a"[^>]*aria-pressed="false"/u,
    );
    assert.match(
      html,
      /data-testid="account-tab-account-a-expand"[^>]*type="button"/u,
    );
  } finally {
    globalThis.React = previousReact;
  }
});

test("live account cards expose target status and caps without an edit control", () => {
  const previousReact = globalThis.React;
  globalThis.React = React;
  try {
    const html = renderToStaticMarkup(
      createElement(AccountTabs, {
        accounts: [
          {
            id: "account-a",
            providerAccountId: "provider-a",
            provider: "robinhood",
            displayName: "Agentic",
            currency: "USD",
          },
        ],
        deployments: [
          {
            id: "deployment-a",
            name: "Signal Options",
            enabled: false,
            isDraft: false,
            archivedAt: null,
            targets: [
              {
                accountType: "broker",
                accountId: "account-a",
                providerAccountId: "provider-a",
                lifecycle: "active",
                allowance: { unit: "usd", value: 3_000 },
                totalAlgoAllowance: { unit: "percent", value: 60 },
              },
            ],
          },
        ],
        deploymentInventoryState: "ready",
      }),
    );

    assert.match(html, /data-testid="account-tab-account-a-deployments"/u);
    assert.match(html, />Deployments</u);
    assert.match(
      html,
      /Signal Options · Paused · \$3,000 allowance · 60% shared total/u,
    );
    assert.match(html, /Linked deployments: Signal Options/u);
    assert.doesNotMatch(html, /Active algos|Edit deployment/u);
  } finally {
    globalThis.React = previousReact;
  }
});

test("compact calendar toggles and panels avoid incomplete tab and focus contracts", () => {
  const returnsSource = readLocalSource("./AccountReturnsPanel.jsx");
  const utilsSource = readLocalSource("./accountUtils.jsx");

  assert.match(returnsSource, /role="group"\s+aria-label="Calendar view"/);
  assert.match(returnsSource, /aria-pressed=\{active\}/);
  assert.doesNotMatch(returnsSource, /role="tab"|role="tablist"/);
  const panel = utilsSource.slice(utilsSource.indexOf("export const Panel"));
  assert.doesNotMatch(panel, /tabIndex=\{0\}/);
});

test("AccountTabs uses smaller collapsed tracks and gives expanded cards two tracks", () => {
  const source = readLocalSource("./AccountTabs.jsx");

  assert.match(source, /gridTemplateColumns:/);
  assert.match(source, /\? "minmax\(0, 1fr\)"/);
  assert.doesNotMatch(source, /repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(source, /repeat\(auto-fill, minmax\(196px, 220px\)\)/);
  assert.match(source, /gridColumn: expanded && !accountIsPhone \? "span 2"/);
  assert.match(source, /minHeight: dim\(44\)/);
  assert.doesNotMatch(source, /minHeight: dim\(accountIsPhone \? 68 : 72\)/);
  assert.match(source, /alignItems: "start"/);
  assert.match(source, /justifyContent: accountIsPhone \? "stretch" : "start"/);
  assert.match(source, /<BrokerAccountIdentity/);
  assert.match(source, /isPhone=\{accountIsPhone\}/);
  assert.doesNotMatch(source, /background: shadowMark/);
  assert.doesNotMatch(source, /size=\{dim\(\s*shadowMark/);
  assert.doesNotMatch(source, /0 6px 18px/);
  assert.match(source, /eyebrow=\{brand\.label\}/);
  assert.match(source, /detail=\{maskedId\}/);
  assert.match(source, /detail="Internal ledger"/);
  assert.match(source, /showMetrics/);
  assert.match(source, /AccountCardPerformanceDisclosure/);
  assert.doesNotMatch(source, /compact=/);
});
