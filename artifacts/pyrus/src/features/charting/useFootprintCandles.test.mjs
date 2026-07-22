import assert from "node:assert/strict";
import test from "node:test";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

import { useFootprintCandles } from "./useFootprintCandles.ts";

const installReactDom = () => {
  const globalNames = [
    "cancelAnimationFrame",
    "CustomEvent",
    "document",
    "fetch",
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
  globalThis.CustomEvent = class {
    constructor(type, options) {
      this.type = type;
      this.detail = options?.detail;
    }
  };
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

const responseFor = (symbol) =>
  new Response(
    JSON.stringify({
      symbol,
      candles: [{ time: "2026-07-20T14:30:00.000Z" }],
    }),
    {
      status: 200,
      headers: { "content-type": "application/json" },
    },
  );

test("footprint requests clear stale data, ignore aborted responses, and ignore display-only changes", async () => {
  const { container, restore } = installReactDom();
  const requests = [];
  globalThis.fetch = (input, init) =>
    new Promise((resolve) => {
      requests.push({
        init,
        resolve,
        url: typeof input === "string" ? input : input.url,
      });
    });

  const visibleRange = {
    from: new Date("2026-07-20T14:30:00.000Z"),
    to: new Date("2026-07-20T15:30:00.000Z"),
  };
  let latest;

  function Harness({ displayMode, symbol }) {
    latest = useFootprintCandles({
      context: {
        symbol,
        assetClass: "equity",
        timeframe: "1m",
      },
      visibleRange,
      enabled: true,
      displayMode,
      ticksPerRow: 1,
      imbalancePercent: 300,
    });
    return null;
  }

  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        React.createElement(Harness, {
          displayMode: "split",
          symbol: "AAPL",
        }),
      ),
    );
    assert.equal(latest.state, "loading");
    assert.equal(latest.data, null);

    await act(async () =>
      new Promise((resolve) => setTimeout(resolve, 240)),
    );
    assert.equal(requests.length, 1);

    await act(async () =>
      root.render(
        React.createElement(Harness, {
          displayMode: "split",
          symbol: "MSFT",
        }),
      ),
    );
    assert.equal(latest.state, "loading");
    assert.equal(latest.data, null);

    await act(async () => {
      requests[0].resolve(responseFor("AAPL"));
      await new Promise((resolve) => setImmediate(resolve));
    });
    assert.equal(latest.state, "loading");
    assert.equal(latest.data, null);

    await act(async () =>
      new Promise((resolve) => setTimeout(resolve, 240)),
    );
    assert.equal(requests.length, 2);
    assert.match(requests[1].url, /symbol=MSFT/);
    assert.doesNotMatch(requests[1].url, /=null(?:&|$)/);

    await act(async () => {
      requests[1].resolve(responseFor("MSFT"));
      await new Promise((resolve) => setImmediate(resolve));
    });
    assert.equal(latest.state, "ready");
    assert.equal(latest.data.symbol, "MSFT");

    await act(async () =>
      root.render(
        React.createElement(Harness, {
          displayMode: "delta",
          symbol: "MSFT",
        }),
      ),
    );
    await act(async () =>
      new Promise((resolve) => setTimeout(resolve, 240)),
    );
    assert.equal(requests.length, 2);
  } finally {
    await act(async () => root.unmount());
    restore();
  }
});
