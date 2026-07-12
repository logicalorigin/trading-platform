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
