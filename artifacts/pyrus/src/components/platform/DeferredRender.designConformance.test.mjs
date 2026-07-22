import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import DeferredRender from "./DeferredRender.jsx";

const source = readFileSync(new URL("./DeferredRender.jsx", import.meta.url), "utf8");

test("deferred content stays unmounted until it nears the viewport", () => {
  const previousReact = globalThis.React;
  globalThis.React = React;
  const markup = renderToStaticMarkup(
    React.createElement(
      DeferredRender,
      { minHeight: 320, testId: "deferred-probe" },
      React.createElement("span", null, "hidden work"),
    ),
  );
  globalThis.React = previousReact;

  assert.match(markup, /data-deferred-render="pending"/);
  assert.match(markup, /min-height:320px/);
  assert.doesNotMatch(markup, /hidden work/);
  assert.match(source, /new window\.IntersectionObserver/);
});

test("activated deferred content releases its placeholder minimum height", () => {
  assert.match(source, /style=\{activated \? undefined : \{ minHeight \}\}/);
  assert.match(source, /activated \? children/);
});
