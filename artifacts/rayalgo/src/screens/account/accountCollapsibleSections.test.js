import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./accountUtils.jsx", import.meta.url), "utf8");

test("useCollapsibleSections persists open state to localStorage under a namespaced key", () => {
  assert.match(source, /export const useCollapsibleSections\b/);
  assert.match(source, /COLLAPSIBLE_STORAGE_PREFIX\s*=\s*"pyrus:account:"/);
  assert.match(source, /LEGACY_COLLAPSIBLE_STORAGE_PREFIX\s*=\s*"rayalgo:account:"/);
  assert.match(source, /localStorage\.setItem/);
  assert.match(source, /localStorage\.getItem/);
});

test("useCollapsibleSections falls back to the supplied defaults when no override is stored", () => {
  assert.match(source, /key in overrides \? overrides\[key\] : defaults\[key\] \?\? true/);
});

test("SectionHeader exposes a toggleable interactive variant when onToggle is provided", () => {
  assert.match(source, /export const SectionHeader\s*=\s*\(\{\s*title,\s*rightSlot,\s*onToggle,\s*expanded\s*\}\)\s*=>/);
  assert.match(source, /aria-expanded=\{expanded\}/);
});
