import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./screenModulePreloader.js", import.meta.url),
  "utf8",
);
const registrySource = readFileSync(
  new URL("./screenRegistry.jsx", import.meta.url),
  "utf8",
);

test("a chunk that resolves without a default export throws instead of stranding the spinner", () => {
  // Latent stuck-spinner gap: the resolve handler used to silently skip setting
  // the component when `mod.default` was missing (`if (mod?.default) { ... }`),
  // leaving the registry spinner up with neither a component nor a .catch/Retry.
  // It must now throw so the shared failure path deletes the cache entry, settles
  // the boot task, and surfaces the screen error + Retry UI.
  assert.match(
    source,
    /if \(!mod\?\.default\)\s*\{[\s\S]*?throw new Error\(\s*`Screen module "\$\{screenId\}" resolved without a default export\.`/,
    "resolve handler must throw on a missing default export",
  );
  assert.doesNotMatch(
    source,
    /if \(mod\?\.default\)\s*\{\s*SCREEN_MODULE_COMPONENTS\.set\(screenId, mod\.default\);\s*\}/,
    "the silent skip-on-missing-default branch must be gone",
  );
});

test("opportunistic screen preloads observe discarded failures without hiding them from awaiters", () => {
  assert.match(
    source,
    /export const preloadScreenModule = \(screenId\) => \{[\s\S]*?const preload = loadScreenModule\(screenId,[\s\S]*?void preload\.catch\(\(\) => undefined\);[\s\S]*?return preload;[\s\S]*?\};/,
    "fire-and-forget intent needs a rejection observer while awaiters retain the original promise contract",
  );
});

test("visible loads keep one module label and can upgrade a pending intent preload", () => {
  assert.match(
    registrySource,
    /loadScreenModule\(screenId\)\s*\.then/,
    "the visible loader must reuse the screen module's stable reload-guard label",
  );
  assert.doesNotMatch(
    registrySource,
    /loadScreenModule\(screenId, \{ label \}\)/,
    "UI copy must not become the dynamic-import identity",
  );
  assert.match(
    source,
    /if \(existing\) \{[\s\S]*?if \(reloadOnFailure && !existing\.reloadOnFailure\) \{[\s\S]*?return existing\.promise\.catch\(\(\) =>[\s\S]*?loadScreenModule\(screenId, \{ label, reloadOnFailure \}\),?[\s\S]*?\);[\s\S]*?\}[\s\S]*?return existing\.promise;/,
    "a visible load must retry with reload recovery after a weaker preload fails",
  );
});

test("failed screen loads evict the cached promise before Retry runs", () => {
  const failureBlock = source.match(
    /\.catch\(\(error\) => \{[\s\S]*?throw error;\s*\}\);/,
  )?.[0];
  assert.ok(failureBlock, "missing screen-load failure path");
  assert.match(failureBlock, /SCREEN_MODULE_PRELOADS\.delete\(screenId\);/);
});
