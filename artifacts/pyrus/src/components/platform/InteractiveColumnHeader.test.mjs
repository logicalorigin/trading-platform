import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ColumnHeaderCell } from "./InteractiveColumnHeader.jsx";

const source = readFileSync(
  new URL("./InteractiveColumnHeader.jsx", import.meta.url),
  "utf8",
);

test("whole-header dragging isolates nested sort-button keyboard activation", () => {
  assert.match(
    source,
    /import\s*\{[^}]*\buseCombinedRefs\b[^}]*\}\s*from\s*"@dnd-kit\/utilities";/s,
  );
  assert.match(
    source,
    /const\s+sortableRef\s*=\s*useCombinedRefs\(\s*setNodeRef,\s*setActivatorNodeRef\s*,?\s*\);/,
  );
  assert.match(source, /ref=\{sortableRef\}/);

  const originalReact = Object.getOwnPropertyDescriptor(globalThis, "React");
  Object.defineProperty(globalThis, "React", {
    configurable: true,
    value: React,
  });
  let markup;
  try {
    markup = renderToStaticMarkup(
      React.createElement(ColumnHeaderCell, {
        dragAttributes: {
          "aria-pressed": true,
          role: "button",
          tabIndex: 0,
        },
        label: "Price",
        reorderable: true,
      }),
    );
  } finally {
    if (originalReact) Object.defineProperty(globalThis, "React", originalReact);
    else delete globalThis.React;
  }
  assert.match(markup, /role="columnheader"/);
  assert.match(markup, /tabindex="0"/);
  assert.doesNotMatch(markup, /aria-pressed=/);
});
