import assert from "node:assert/strict";
import test from "node:test";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

import { useDenseVirtualRows } from "./DenseVirtualTable.jsx";

test("remeasures rows when their same-count layout changes", async () => {
  const globalNames = [
    "document",
    "HTMLIFrameElement",
    "IS_REACT_ACT_ENVIRONMENT",
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
  globalThis.document = document;
  globalThis.HTMLIFrameElement = class {};
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.window = globalThis;

  let latest;
  function Probe({ layoutKey, sizes }) {
    latest = useDenseVirtualRows({
      count: sizes.length,
      estimateSize: (index) => sizes[index],
      layoutKey,
      rowHeight: 56,
    });
    return null;
  }

  const root = createRoot(container);
  const render = async (layoutKey, sizes) => {
    await act(async () => {
      root.render(React.createElement(Probe, { layoutKey, sizes }));
    });
  };
  const measurements = () =>
    latest.virtualizer
      .getMeasurements()
      .map(({ index, size, start }) => [index, start, size]);

  try {
    await render("detail:1:650", [56, 650, 56, 56]);
    assert.deepEqual(measurements(), [
      [0, 0, 56],
      [1, 56, 650],
      [2, 706, 56],
      [3, 762, 56],
    ]);

    await render("detail:2:650", [56, 56, 650, 56]);
    assert.deepEqual(measurements(), [
      [0, 0, 56],
      [1, 56, 56],
      [2, 112, 650],
      [3, 762, 56],
    ]);
  } finally {
    await act(async () => root.unmount());
    previousGlobals.forEach(([name, descriptor]) => {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    });
  }
});
