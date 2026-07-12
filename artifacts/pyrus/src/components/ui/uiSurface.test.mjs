import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (relativePath) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

const appProviders = read("../../app/AppProviders.tsx");
const card = read("./card.tsx");
const dropdown = read("./dropdown-menu.tsx");
const popover = read("./popover.tsx");
const tooltip = read("./tooltip.tsx");

test("shared UI modules expose only primitives with current consumers", () => {
  for (const deadName of ["CardAction", "CardFooter"]) {
    assert.doesNotMatch(card, new RegExp(`\\b${deadName}\\b`));
  }
  for (const deadName of [
    "DropdownMenuGroup",
    "DropdownMenuPortal",
    "DropdownMenuSub",
    "DropdownMenuSubTrigger",
    "DropdownMenuSubContent",
    "DropdownMenuShortcut",
  ]) {
    assert.doesNotMatch(dropdown, new RegExp(`\\b${deadName}\\b`));
  }
  assert.doesNotMatch(popover, /\bPopoverAnchor\b/);
});

test("menus do not claim unsupported Tailwind animation utilities", () => {
  const unsupportedMotion =
    /(?:animate|fade|zoom)-(?:in|out)(?:-\d+)?|slide-in-from-(?:top|right|bottom|left)-\d+/;
  assert.doesNotMatch(dropdown, unsupportedMotion);
  assert.doesNotMatch(popover, unsupportedMotion);
});

test("the custom tooltip has no inert Radix provider surface", () => {
  assert.doesNotMatch(appProviders, /TooltipProvider/);
  assert.doesNotMatch(tooltip, /@radix-ui\/react-tooltip/);
  for (const deadName of [
    "TooltipProvider",
    "TooltipTrigger",
    "TooltipContent",
    "TooltipPortal",
  ]) {
    assert.doesNotMatch(tooltip, new RegExp(`\\b${deadName}\\b`));
  }
});
