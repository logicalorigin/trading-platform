import assert from "node:assert/strict";
import test from "node:test";

import {
  isAlertToastKind,
  normalizeToastKind,
  orderToastsForDisplay,
} from "./toastModel.js";

test("toast kinds normalize before determining announcement urgency", () => {
  assert.equal(normalizeToastKind("danger"), "error");
  assert.equal(normalizeToastKind("warning"), "warn");
  assert.equal(normalizeToastKind("unknown"), "info");
  assert.equal(isAlertToastKind("danger"), true);
  assert.equal(isAlertToastKind("warn"), false);
});

test("visible toasts are capped and ordered by urgency then recency", () => {
  const ordered = orderToastsForDisplay(
    [
      { id: 1, kind: "info", title: "old info" },
      { id: 2, kind: "error", title: "old error" },
      { id: 3, kind: "success", title: "success" },
      { id: 4, kind: "warn", title: "warning" },
      { id: 5, kind: "error", title: "new error" },
    ],
    3,
  );

  assert.deepEqual(
    ordered.map((toast) => toast.title),
    ["new error", "old error", "warning"],
  );
});

test("invalid caps are normalized without mutating the caller array", () => {
  const input = [
    { id: "a", kind: "info", title: "first" },
    { id: "b", kind: "info", title: "second" },
  ];

  assert.deepEqual(orderToastsForDisplay(input, 0), []);
  assert.deepEqual(
    orderToastsForDisplay(input, 99).map((toast) => toast.title),
    ["first", "second"],
  );
  assert.deepEqual(input.map((toast) => toast.title), ["first", "second"]);
});
