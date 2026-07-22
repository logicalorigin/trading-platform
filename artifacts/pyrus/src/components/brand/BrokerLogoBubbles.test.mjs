import assert from "node:assert/strict";
import test from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { BrokerLogoBubbles } from "./BrokerLogoBubbles.jsx";
import {
  brokerActivityLabel,
  normalizeBrokerActivityBadges,
} from "./brokerLogoBubblesModel.js";

test("broker activity badges deduplicate providers and report visual overflow", () => {
  const badges = normalizeBrokerActivityBadges(
    [
      "robinhood",
      { provider: "schwab", label: "Charles Schwab" },
      "robinhood",
      "shadow",
      "ibkr",
    ],
    3,
  );

  assert.deepEqual(badges.visible, [
    { provider: "robinhood", label: "Robinhood" },
    { provider: "schwab", label: "Charles Schwab" },
    { provider: "shadow", label: "Shadow" },
  ]);
  assert.equal(badges.overflow, 1);
  assert.equal(
    badges.accessibleLabel,
    "Brokers: Robinhood, Charles Schwab, Shadow, IBKR",
  );
});

test("broker activity labels never expose raw unknown provider identifiers", () => {
  assert.equal(brokerActivityLabel("robinhood"), "Robinhood");
  assert.equal(brokerActivityLabel("shadow"), "Shadow");
  assert.equal(brokerActivityLabel("some-secret-upstream-id"), "Brokerage");
});

test("broker bubbles expose one screen-reader label and hide decorative logos", () => {
  const previousReact = globalThis.React;
  globalThis.React = React;
  try {
    const html = renderToStaticMarkup(
      createElement(BrokerLogoBubbles, {
        brokers: ["robinhood", "schwab", "shadow", "ibkr"],
        maxVisible: 3,
      }),
    );
    assert.match(
      html,
      /aria-label="Brokers: Robinhood, Schwab, Shadow, IBKR"/,
    );
    assert.match(html, />\+1<\/span>/);
    assert.equal((html.match(/data-testid="broker-logo-bubbles"/g) || []).length, 1);
  } finally {
    globalThis.React = previousReact;
  }
});
