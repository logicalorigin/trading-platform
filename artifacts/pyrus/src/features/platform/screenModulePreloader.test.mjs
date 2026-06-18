import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./screenModulePreloader.js", import.meta.url),
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
