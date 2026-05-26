import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";

import {
  resolveToastVisuals,
  ToastStack,
} from "./ToastStack.jsx";
import {
  normalizeToastKind,
  TOAST_OVERLAY_Z_INDEX,
} from "./toastModel.js";
import { TooltipProvider } from "../../components/ui/tooltip";

const sampleToasts = [
  { id: 1, title: "Saved", body: "Preferences updated", kind: "success" },
  { id: 2, title: "Careful", body: "Review settings", kind: "warning" },
  { id: 3, title: "Failed", body: "Order rejected", kind: "critical" },
];

test("ToastStack renders visible toasts above app overlays", () => {
  const markup = renderToStaticMarkup(
    React.createElement(
      TooltipProvider,
      null,
      React.createElement(ToastStack, {
        toasts: sampleToasts,
        onDismiss: () => {},
        bottomOffset: 76,
      }),
    ),
  );

  assert.match(markup, /data-testid="toast-stack"/);
  assert.match(markup, /aria-live="polite"/);
  assert.match(markup, /data-testid="toast-item"/);
  assert.match(markup, /data-toast-kind="success"/);
  assert.match(markup, /data-toast-kind="warn"/);
  assert.match(markup, /data-toast-kind="error"/);
  assert.ok(TOAST_OVERLAY_Z_INDEX > 10020);
});

test("ToastStack wires dismiss handlers and alert roles", () => {
  const dismissed = [];
  const stack = ToastStack({
    toasts: sampleToasts,
    onDismiss: (id) => dismissed.push(id),
  });
  const toastTooltips = React.Children.toArray(stack.props.children);
  const firstToastItem = toastTooltips[0].props.children;
  const warningToastItem = toastTooltips[1].props.children;
  const errorToastItem = toastTooltips[2].props.children;

  assert.equal(stack.props.style.zIndex, TOAST_OVERLAY_Z_INDEX);
  assert.equal(stack.props["data-testid"], "toast-stack");
  assert.equal(firstToastItem.props["data-testid"], "toast-item");
  assert.equal(firstToastItem.props.role, "status");
  assert.equal(warningToastItem.props.role, "status");
  assert.equal(errorToastItem.props.role, "alert");

  firstToastItem.props.onClick();
  assert.deepEqual(dismissed, [1]);
});

test("toast kind aliases resolve to stable render treatments", () => {
  assert.equal(normalizeToastKind("warning"), "warn");
  assert.equal(normalizeToastKind("warn"), "warn");
  assert.equal(normalizeToastKind("critical"), "error");
  assert.equal(normalizeToastKind("danger"), "error");
  assert.equal(normalizeToastKind("unknown"), "info");
  assert.equal(resolveToastVisuals("warning").kind, "warn");
  assert.equal(resolveToastVisuals("critical").kind, "error");
});

test("platform toast plumbing captures, renders, and preserves algo event pushes", () => {
  const appSource = readFileSync(new URL("./PlatformApp.jsx", import.meta.url), "utf8");
  const shellSource = readFileSync(new URL("./PlatformShell.jsx", import.meta.url), "utf8");
  const drawerSource = readFileSync(new URL("./NotificationsDrawer.jsx", import.meta.url), "utf8");

  assert.match(appSource, /import \{ normalizeToastKind \} from "\.\/toastModel\.js"/);
  assert.match(appSource, /const normalizedKind = normalizeToastKind\(kind\)/);
  assert.match(appSource, /captureToast\(\{ title, body, kind: normalizedKind \}\)/);
  assert.match(appSource, /kind: normalizedKind/);
  assert.match(shellSource, /import \{ ToastStack \} from "\.\/ToastStack\.jsx"/);
  assert.match(shellSource, /<ToastStack[\s\S]*toasts=\{toasts\}[\s\S]*onDismiss=\{onDismissToast\}/);
  assert.match(shellSource, /toast\.push\(toastSpec\)/);
  assert.match(drawerSource, /const kind = normalizeToastKind\(toast\.kind\)/);
});
