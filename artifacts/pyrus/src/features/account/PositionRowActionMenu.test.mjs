import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./PositionRowActionMenu.jsx", import.meta.url),
  "utf8",
);

test("disabled menu actions remain focusable and expose their reason", () => {
  assert.doesNotMatch(source, /disabled=\{action\.disabled\}/);
  assert.match(source, /aria-disabled=\{action\.disabled \|\| undefined\}/);
  assert.match(source, /aria-label=\{disabledActionLabel\(action\)\}/);
  assert.match(source, /onFocus=\{\(\) => revealDisabledReason\(action\)\}/);
});

test("selection reveals a visible unavailable-action status and closing clears it", () => {
  assert.match(
    source,
    /runAction\(action, event, revealDisabledReason\)/,
  );
  assert.match(
    source,
    /onPointerDown=\{\(\) => revealDisabledReason\(action\)\}/,
  );
  assert.match(source, /role="status"/);
  assert.match(source, /aria-live="polite"/);
  assert.match(source, /data-testid=\{`\$\{testId\}-disabled-reason`\}/);
  assert.match(source, /onOpenChange=\{handleOpenChange\}/);
  assert.match(source, /if \(!nextOpen\) setDisabledReason\(null\)/);
});
