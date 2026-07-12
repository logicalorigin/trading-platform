import assert from "node:assert/strict";
import test from "node:test";
import React, { act, startTransition, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";

import { useListMotionKeys } from "./motion.jsx";

test("abandoned renders do not consume new list-motion keys", async () => {
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

  const suspended = new Promise(() => {});
  const initialItems = [{ id: "a" }];
  const nextItems = [...initialItems, { id: "b" }];
  let committedKeys = [];
  let commitCount = 0;
  let suspendedRenderRan = false;

  function Probe({ items, shouldSuspend }) {
    const keys = useListMotionKeys(items);
    if (shouldSuspend) {
      suspendedRenderRan = true;
      throw suspended;
    }
    useLayoutEffect(() => {
      committedKeys = keys;
      commitCount += 1;
    }, [keys]);
    return null;
  }

  const root = createRoot(container);
  const render = (items, shouldSuspend = false) =>
    React.createElement(
      React.Suspense,
      { fallback: null },
      React.createElement(Probe, { items, shouldSuspend }),
    );

  try {
    await act(async () => root.render(render(initialItems)));
    assert.deepEqual(committedKeys, [{ key: "a", isNew: true }]);

    await act(async () => {
      startTransition(() => root.render(render(nextItems, true)));
      await Promise.resolve();
    });
    assert.equal(suspendedRenderRan, true);
    assert.equal(commitCount, 1);

    await act(async () => root.render(render(nextItems)));
    assert.deepEqual(committedKeys, [
      { key: "a", isNew: false },
      { key: "b", isNew: true },
    ]);
  } finally {
    await act(async () => root.unmount());
    previousGlobals.forEach(([name, descriptor]) => {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    });
  }
});
