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

test("a disabled primary action remains focusable and opens its visible reason", () => {
  assert.doesNotMatch(source, /disabled=\{primaryDisabled\}/);
  assert.match(source, /aria-disabled=\{primaryDisabled \|\| undefined\}/);
  assert.match(
    source,
    /aria-label=\{disabledActionLabel\(primaryAction\) \|\| primaryTooltip\}/,
  );
  assert.match(
    source,
    /runAction\(primaryAction, event, revealPrimaryDisabledReason\)/,
  );
  assert.match(source, /if \(action\?\.disabled\) setOpen\(true\)/);
});

test("touch selection reveals a visible unavailable-action status", () => {
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

test("Quick Trade trigger and management controls keep mobile touch floors", () => {
  assert.match(
    source,
    /className="ra-touch-target-y"[\s\S]*?height: dim\(24\)/,
  );
  assert.match(
    source,
    /aria-label=\{disabledActionLabel\(primaryAction\) \|\| primaryTooltip\}[\s\S]*?className="ra-touch-target-y"/,
  );
  assert.match(
    source,
    /aria-label=\{`More actions for \$\{symbol \|\| "position"\}`\}[\s\S]*?className="ra-touch-target"/,
  );
  assert.match(
    source,
    /<DropdownMenuItem[\s\S]*?className="ra-touch-target-y"[\s\S]*?ManagementActionItem/,
  );
});

test("the split action keeps keyboard focus visible outside its rounded frame", () => {
  assert.match(
    source,
    /className="ra-touch-target-y"[\s\S]*?overflow: "visible"/,
  );
  assert.match(
    source,
    /width: dim\(50\)[\s\S]*?borderRadius: `\$\{dim\(RADII\.xs\)\}px 0 0 \$\{dim\(RADII\.xs\)\}px`/,
  );
  assert.match(
    source,
    /aria-label=\{`More actions[\s\S]*?borderRadius: `0 \$\{dim\(RADII\.xs\)\}px \$\{dim\(RADII\.xs\)\}px 0`/,
  );
});
