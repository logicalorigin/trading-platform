import assert from "node:assert/strict";
import test from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { CSS_COLOR } from "../../lib/uiTokens.jsx";
import {
  BrokerAccountCard,
  BrokerAccountIdentity,
  brokerAccountTone,
} from "./BrokerAccountCardPresentation.jsx";

test("broker account cards share the compact selected presentation", () => {
  const tone = brokerAccountTone("robinhood");
  const html = renderToStaticMarkup(
    createElement(
      BrokerAccountCard,
      {
        "data-testid": "shared-account-card",
        selected: true,
        tone,
      },
      createElement(BrokerAccountIdentity, {
        provider: "robinhood",
        eyebrow: "Robinhood",
        label: "Agentic",
        detail: "Technically ready",
        selected: true,
        tone,
      }),
    ),
  );

  assert.equal(tone, CSS_COLOR.green);
  assert.match(html, /data-testid="shared-account-card"/u);
  assert.match(html, /border-radius:4px/u);
  assert.match(html, /box-shadow:inset 2px 0 0 var\(--ra-green-500\)/u);
  assert.match(
    html,
    /background:color-mix\(in srgb, var\(--ra-green-500\) 7%, transparent\)/u,
  );
  assert.match(html, /width="32" height="32"/u);
  assert.match(html, />Robinhood</u);
  assert.match(html, />Agentic</u);
  assert.match(html, />Technically ready</u);
  assert.match(html, /text-transform:uppercase/u);
});

test("broker account identity preserves the Account phone scale", () => {
  const html = renderToStaticMarkup(
    createElement(BrokerAccountIdentity, {
      provider: "ibkr",
      eyebrow: "IBKR",
      label: "Retirement",
      isPhone: true,
    }),
  );

  assert.match(html, /width="28" height="28"/u);
  assert.match(html, /font-size:11px/u);
});

test("broker account card errors override the selection border and disabled rows dim", () => {
  const html = renderToStaticMarkup(
    createElement(BrokerAccountCard, {
      invalid: true,
      disabled: true,
      selected: true,
      tone: CSS_COLOR.green,
    }),
  );

  assert.match(
    html,
    /border:1px solid color-mix\(in srgb, var\(--ra-red-500\) 62%, transparent\)/u,
  );
  assert.match(html, /opacity:0\.68/u);
});
