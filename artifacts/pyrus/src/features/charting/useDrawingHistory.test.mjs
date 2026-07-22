import assert from "node:assert/strict";
import test from "node:test";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

import { useDrawingHistory } from "./useDrawingHistory.ts";

const installReactDom = () => {
  const globalNames = [
    "cancelAnimationFrame",
    "document",
    "HTMLIFrameElement",
    "IS_REACT_ACT_ENVIRONMENT",
    "requestAnimationFrame",
    "window",
  ];
  const previousGlobals = globalNames.map((name) => [
    name,
    Object.getOwnPropertyDescriptor(globalThis, name),
  ]);
  const noop = () => {};
  const document = {
    activeElement: null,
    addEventListener: noop,
    defaultView: globalThis,
    nodeType: 9,
    removeEventListener: noop,
  };
  const container = {
    addEventListener: noop,
    firstChild: null,
    lastChild: null,
    nodeType: 1,
    ownerDocument: document,
    parentNode: null,
    removeEventListener: noop,
    tagName: "DIV",
  };
  document.documentElement = container;
  globalThis.cancelAnimationFrame = noop;
  globalThis.document = document;
  globalThis.HTMLIFrameElement = class {};
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.requestAnimationFrame = () => 1;
  globalThis.window = globalThis;

  return {
    container,
    restore: () => {
      previousGlobals.forEach(([name, descriptor]) => {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete globalThis[name];
      });
    },
  };
};

test("drawing history skips no-op undo entries and bounds inactive scopes", async () => {
  const { container, restore } = installReactDom();
  let latest;

  function Harness({ scopeKey, initialDrawings = [] }) {
    latest = useDrawingHistory(initialDrawings, scopeKey);
    return null;
  }

  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(React.createElement(Harness, { scopeKey: "scope-0" })),
    );

    await act(async () => latest.clearDrawings());
    assert.equal(latest.canUndo, false);

    await act(async () => latest.addDrawing("original"));
    await act(async () =>
      latest.setDrawings((current) => [...current]),
    );
    await act(async () => latest.undo());
    assert.deepEqual(latest.drawings, []);

    await act(async () => latest.addDrawing("original"));
    for (let index = 1; index <= 101; index += 1) {
      await act(async () =>
        root.render(
          React.createElement(Harness, { scopeKey: `scope-${index}` }),
        ),
      );
    }
    await act(async () =>
      root.render(React.createElement(Harness, { scopeKey: "scope-0" })),
    );
    assert.deepEqual(latest.drawings, []);

    await act(async () =>
      root.render(
        React.createElement(Harness, {
          scopeKey: "seeded-scope",
          initialDrawings: ["seed"],
        }),
      ),
    );
    assert.deepEqual(latest.drawings, ["seed"]);
  } finally {
    await act(async () => root.unmount());
    restore();
  }
});
