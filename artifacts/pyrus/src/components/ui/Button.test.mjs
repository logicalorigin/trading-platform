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

test("loading spinner motion honors OS and app reduced-motion preferences", () => {
  const markup = renderToStaticMarkup(
    React.createElement(Button, { loading: true }, "Saving"),
  );

  assert.match(markup, /class="ra-btn-spinner"/);
  assert.doesNotMatch(markup, /style="[^"]*animation:/);
  assert.match(
    appCss,
    /\.ra-btn-spinner\s*\{\s*animation: pyrusBtnSpin 720ms linear infinite;/,
  );
  assert.match(
    appCss,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.ra-btn-spinner\s*\{\s*animation: none;/,
  );
  assert.match(
    appCss,
    /html\[data-pyrus-reduced-motion="on"\] \.ra-btn[\s\S]*?html\[data-pyrus-reduced-motion="on"\] \.ra-btn-spinner\s*\{\s*animation: none;/,
  );
});

test("standard data-testid props survive the compatibility alias", () => {
  const standardMarkup = renderToStaticMarkup(
    React.createElement(Button, { "data-testid": "standard-id" }, "Run"),
  );
  const aliasMarkup = renderToStaticMarkup(
    React.createElement(Button, { dataTestId: "alias-id" }, "Run"),
  );

  assert.match(standardMarkup, /data-testid="standard-id"/);
  assert.match(aliasMarkup, /data-testid="alias-id"/);
});
