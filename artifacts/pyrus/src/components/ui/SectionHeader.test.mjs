import assert from "node:assert/strict";
import test from "node:test";

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { SectionHeader } from "./SectionHeader.jsx";

test("SectionHeader exposes its title as an in-screen heading", () => {
  const previousReact = globalThis.React;
  globalThis.React = React;
  let markup;
  try {
    markup = renderToStaticMarkup(
      React.createElement(SectionHeader, { title: "Diagnostics" }),
    );
  } finally {
    globalThis.React = previousReact;
  }

  assert.match(markup, /<h2[^>]*>Diagnostics<\/h2>/);
});
