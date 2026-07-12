import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { Button } from "./Button.jsx";

const appCss = readFileSync(new URL("../../index.css", import.meta.url), "utf8");

test("shared button styles are emitted once by the app stylesheet", () => {
  const markup = renderToStaticMarkup(
    React.createElement(
      React.Fragment,
      null,
      React.createElement(Button, null, "First"),
      React.createElement(Button, null, "Second"),
    ),
  );

  assert.doesNotMatch(markup, /<style>/);
  assert.equal(appCss.match(/@keyframes pyrusBtnSpin/g)?.length, 1);
  assert.equal(
    appCss.match(/\.ra-btn\s*\{\s*background: var\(--ra-btn-bg\)/g)?.length,
    1,
  );
});
