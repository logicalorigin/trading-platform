import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { AppTooltip } from "./tooltip.tsx";

test("disabled button tooltips remain keyboard reachable", () => {
  const markup = renderToStaticMarkup(
    React.createElement(
      AppTooltip,
      { content: "Coming soon" },
      React.createElement("button", { disabled: true }, "Future theme"),
    ),
  );

  assert.match(markup, /class="ra-tooltip-disabled-trigger"/);
  assert.match(markup, /tabindex="0"/);
  assert.match(markup, /<button disabled="">Future theme<\/button>/);
});

test("wrapped disabled button tooltips remain keyboard reachable", () => {
  const markup = renderToStaticMarkup(
    React.createElement(
      AppTooltip,
      { content: "Enable Pyrus Signals first" },
      React.createElement(
        React.Fragment,
        null,
        React.createElement("button", { disabled: true }, "Pyrus Signals"),
      ),
    ),
  );

  assert.match(markup, /^<span[^>]*class="ra-tooltip-disabled-trigger"/);
  assert.match(markup, /^<span[^>]*tabindex="0"/);
});

test("disabled tooltip wrappers do not freeze responsive button height", () => {
  const markup = renderToStaticMarkup(
    React.createElement(
      AppTooltip,
      { content: "Unavailable" },
      React.createElement(
        "button",
        {
          className: "ra-touch-target-y",
          disabled: true,
          style: { height: 24, width: "100%" },
        },
        "1m",
      ),
    ),
  );
  const wrapper = markup.match(/^<span[^>]*>/)?.[0] || "";

  assert.match(wrapper, /width:100%/);
  assert.doesNotMatch(wrapper, /height:24px/);
});
