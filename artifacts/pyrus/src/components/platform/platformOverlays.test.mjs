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
