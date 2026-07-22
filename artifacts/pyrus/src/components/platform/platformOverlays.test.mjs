import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readSource = (relativePath) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

test("modal overlays delegate focus, dismissal, and scroll locking to Radix Dialog", () => {
  for (const relativePath of [
    "./BottomSheet.jsx",
    "./Drawer.jsx",
    "../ui/ConfirmDialog.jsx",
  ]) {
    const source = readSource(relativePath);
    assert.match(source, /import \{ Dialog \} from "radix-ui"/);
    assert.match(source, /<Dialog\.Content/);
    assert.match(source, /onOpenAutoFocus=/);
    assert.match(source, /onCloseAutoFocus=/);
    assert.doesNotMatch(source, /document\.body\.style\.overflow/);
    assert.doesNotMatch(source, /addEventListener\(["']keydown["']/);
  }
});

test("collapsed docked-sheet content is inert until expanded", () => {
  const source = readSource("./DockedSheet.jsx");
  assert.match(source, /aria-hidden=\{expanded \? undefined : "true"\}/);
  assert.match(source, /inert=\{!expanded\}/);
});

test("command palette delegates topmost dismissal and focus containment to Radix Dialog", () => {
  const source = readSource("../../features/platform/CommandPalette.jsx");

  assert.match(source, /import \{ Dialog \} from "radix-ui"/);
  assert.match(source, /<Dialog\.Content/);
  assert.match(source, /onOpenAutoFocus=/);
  assert.match(source, /onCloseAutoFocus=/);
  assert.match(source, /restoreFocusRef\.current\?\.focus\?\.\(\)/);
  assert.match(source, /<Dialog\.Close asChild>/);
  assert.match(source, /width: dim\(44\)/);
  assert.match(source, /height: dim\(44\)/);
  assert.doesNotMatch(source, /createPortal/);
  assert.doesNotMatch(source, /event\.key === "Escape"/);
});

test("command palette handles result navigation only from its search input", () => {
  const source = readSource("../../features/platform/CommandPalette.jsx");
  const contentStart = source.indexOf("<Dialog.Content");
  const inputStart = source.indexOf("<input", contentStart);
  const inputEnd = source.indexOf("/>", inputStart);
  const contentOpening = source.slice(contentStart, inputStart);
  const inputOpening = source.slice(inputStart, inputEnd);

  assert.ok(contentStart >= 0 && inputStart >= 0 && inputEnd >= 0);
  assert.doesNotMatch(contentOpening, /onKeyDown=\{handleKeyDown\}/);
  assert.match(inputOpening, /onKeyDown=\{handleKeyDown\}/);
});

test("modal, tooltip, and toast layers use one deterministic overlay stack", () => {
  const layerSource = readSource("./overlayLayers.js");
  const drawerSource = readSource("./Drawer.jsx");
  const sheetSource = readSource("./BottomSheet.jsx");
  const confirmSource = readSource("../ui/ConfirmDialog.jsx");
  const commandSource = readSource("../../features/platform/CommandPalette.jsx");
  const tooltipSource = readSource("../ui/tooltip.tsx");
  const toastSource = readSource("../../features/platform/toastModel.js");

  assert.match(layerSource, /drawer: 12_000/);
  assert.match(layerSource, /bottomSheet: 12_100/);
  assert.match(layerSource, /dialog: 12_200/);
  assert.match(layerSource, /commandPalette: 12_300/);
  assert.match(layerSource, /tooltip: 12_400/);
  assert.match(layerSource, /toast: 12_500/);
  assert.match(drawerSource, /zIndex: OVERLAY_LAYER\.drawer/);
  assert.match(sheetSource, /zIndex: OVERLAY_LAYER\.bottomSheet/);
  assert.match(confirmSource, /zIndex: OVERLAY_LAYER\.dialog/);
  assert.match(commandSource, /zIndex: OVERLAY_LAYER\.commandPalette/);
  assert.match(tooltipSource, /zIndex: OVERLAY_LAYER\.tooltip/);
  assert.match(
    toastSource,
    /TOAST_OVERLAY_Z_INDEX = OVERLAY_LAYER\.toast/,
  );
});

test("toast entrance and exit motion honor both reduced-motion controls", () => {
  const toastSource = readSource("../../features/platform/ToastStack.jsx");
  const cssSource = readSource("../../index.css");

  assert.match(toastSource, /className="ra-h-toast ra-toast-item"/);
  assert.match(
    cssSource,
    /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.ra-toast-item[\s\S]*?animation: none !important;/,
  );
  assert.match(
    cssSource,
    /html\[data-pyrus-reduced-motion="on"\] \.ra-toast-item[\s\S]*?animation: none !important;/,
  );
});

test("notifications reuse the shared Drawer contract without nested controls", () => {
  const source = readSource("../../features/platform/NotificationsDrawer.jsx");
  const shellSource = readSource("../../features/platform/PlatformShell.jsx");

  assert.match(
    source,
    /import \{ Drawer \} from "\.\.\/\.\.\/components\/platform\/Drawer\.jsx"/,
  );
  assert.match(source, /<Drawer/);
  assert.match(shellSource, /userId=\{notificationUserId\}/);
  assert.match(source, /markNotificationsRead\(userId\)/);
  assert.doesNotMatch(source, /createPortal/);
  assert.doesNotMatch(source, /document\.addEventListener\("keydown"/);
  assert.doesNotMatch(source, /\bonAction\b|\bactionLabel\b/);
});
