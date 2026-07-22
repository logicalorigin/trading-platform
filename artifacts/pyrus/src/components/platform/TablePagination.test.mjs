import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  PaginationFooter,
  getPageCount,
  getPaginationState,
  paginateRows,
} from "./TablePagination.jsx";

test("pagination math clamps invalid input and preserves the final partial page", () => {
  assert.equal(getPageCount(0, 25), 1);
  assert.equal(getPageCount(51, 10), 6);
  assert.deepEqual(getPaginationState(51, 10, 99), {
    canNext: false,
    canPrevious: true,
    end: 51,
    pageCount: 6,
    pageSize: 10,
    safePage: 5,
    start: 51,
    total: 51,
  });
  assert.deepEqual(paginateRows(["a", "b", "c"], 99, 2), {
    endIndex: 3,
    pageCount: 2,
    pageRows: ["c"],
    pageSize: 2,
    safePage: 1,
    startIndex: 2,
    total: 3,
  });
});

test("pagination footer is a named navigation with one polite range announcement", () => {
  const originalReact = Object.getOwnPropertyDescriptor(globalThis, "React");
  Object.defineProperty(globalThis, "React", {
    configurable: true,
    value: React,
  });
  let markup;
  try {
    markup = renderToStaticMarkup(
      React.createElement(PaginationFooter, {
        label: "Trades",
        onPageChange: () => {},
        page: 0,
        pageSize: 25,
        total: 51,
      }),
    );
  } finally {
    if (originalReact) {
      Object.defineProperty(globalThis, "React", originalReact);
    } else {
      delete globalThis.React;
    }
  }

  assert.match(markup, /role="navigation"/);
  assert.match(markup, /aria-label="Trades pagination"/);
  assert.match(markup, /aria-live="polite"/);
  assert.match(markup, /aria-atomic="true"/);
  assert.match(markup, /aria-label="Previous Trades page"/);
  assert.match(markup, /aria-label="Next Trades page"/);
  assert.match(markup, /Trades 1-25 of 51/);
});
