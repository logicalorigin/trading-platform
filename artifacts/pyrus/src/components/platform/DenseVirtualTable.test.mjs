import assert from "node:assert/strict";
import test from "node:test";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";

import {
  DenseVirtualTable,
  areDenseVirtualRowsEqual,
  buildAccessibleTableRowProps,
  useDenseVirtualRows,
} from "./DenseVirtualTable.jsx";

test("retained row objects skip equivalent virtual-row rendering", () => {
  const original = { id: "signal-AAPL", symbol: "AAPL" };
  const columns = [{ id: "symbol" }];
  const getCellProps = () => ({});
  const getRowProps = () => ({});
  const base = {
    columns,
    getCellProps,
    getRowProps,
    gridTemplateColumns: "100px",
    row: { id: original.id, original },
    rowIndex: 3,
    rowTestId: "signals-table-row",
    size: 56,
    start: 168,
    virtualIndex: 3,
  };

  assert.equal(
    areDenseVirtualRowsEqual(base, {
      ...base,
      row: { id: original.id, original },
    }),
    true,
  );
  assert.equal(
    areDenseVirtualRowsEqual(base, {
      ...base,
      row: { id: original.id, original: { ...original } },
    }),
    false,
  );
  assert.equal(areDenseVirtualRowsEqual(base, { ...base, rowIndex: 4 }), false);
  assert.equal(
    areDenseVirtualRowsEqual(base, { ...base, columns: [...columns] }),
    false,
  );
});

test("clickable rows receive one keyboard activation path without hijacking nested controls", () => {
  let activations = 0;
  const rowProps = buildAccessibleTableRowProps(
    { onClick: () => (activations += 1) },
    { rowId: "row-a", rowIndex: 2 },
  );
  assert.equal(rowProps.role, "row");
  assert.equal(rowProps.tabIndex, 0);
  assert.equal(rowProps["aria-rowindex"], 4);

  const rowTarget = {};
  let prevented = false;
  rowProps.onKeyDown({
    key: "Enter",
    currentTarget: rowTarget,
    target: rowTarget,
    defaultPrevented: false,
    preventDefault() {
      prevented = true;
      this.defaultPrevented = true;
    },
  });
  assert.equal(prevented, true);
  assert.equal(activations, 1);

  rowProps.onKeyDown({
    key: " ",
    currentTarget: rowTarget,
    target: { closest: () => ({ tagName: "BUTTON" }) },
    defaultPrevented: false,
    preventDefault() {
      throw new Error("nested controls must retain their own activation");
    },
  });
  assert.equal(activations, 1);
});

test("explicit row keyboard behavior wins over the shared activation fallback", () => {
  let activations = 0;
  const rowProps = buildAccessibleTableRowProps(
    {
      role: "button",
      tabIndex: -1,
      onClick: () => (activations += 1),
      onKeyDown: (event) => event.preventDefault(),
    },
    { rowId: "row-b", rowIndex: 0 },
  );
  const event = {
    key: "Enter",
    currentTarget: {},
    target: null,
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
  };
  event.target = event.currentTarget;
  rowProps.onKeyDown(event);
  assert.equal(rowProps.role, "button");
  assert.equal(rowProps.tabIndex, -1);
  assert.equal(activations, 0);
});

test("empty tables preserve ordered headers and expose the shared semantic state row", () => {
  const originalReact = Object.getOwnPropertyDescriptor(globalThis, "React");
  Object.defineProperty(globalThis, "React", {
    configurable: true,
    value: React,
  });
  let markup;
  try {
    markup = renderToStaticMarkup(
      React.createElement(DenseVirtualTable, {
        ariaLabel: "Fixture positions",
        columnOrder: ["pnl", "symbol"],
        columns: [
          { id: "symbol", header: "Symbol", cell: () => null },
          {
            id: "pnl",
            header: "P&L",
            cell: () => null,
            meta: { align: "right" },
          },
        ],
        data: [],
        emptyState: React.createElement("span", null, "No positions"),
        emptyStateLabel: "No position rows",
      }),
    );
  } finally {
    if (originalReact) {
      Object.defineProperty(globalThis, "React", originalReact);
    } else {
      delete globalThis.React;
    }
  }

  assert.match(markup, /role="table"/);
  assert.match(markup, /aria-label="Fixture positions"/);
  assert.match(markup, /aria-rowcount="1"/);
  assert.match(markup, /aria-colcount="2"/);
  assert.match(markup, /font-variant-numeric:tabular-nums/);
  assert.match(markup, /role="rowgroup"/);
  assert.match(markup, /role="row"/);
  assert.match(markup, /role="cell"/);
  assert.match(markup, /aria-colspan="2"/);
  assert.match(markup, /aria-label="No position rows"/);
  assert.match(markup, /position:sticky/);
  assert.ok(markup.indexOf("P&amp;L") < markup.indexOf("Symbol"));
});

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
