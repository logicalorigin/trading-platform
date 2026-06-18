import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./screenRegistry.jsx", import.meta.url),
  "utf8",
);

test("cold-chunk loading branch renders a layout skeleton, not a lone spinner", () => {
  // Progressive-rendering fix: while a screen's code chunk is still downloading,
  // the registry must show a data-free layout skeleton (page shape) instead of a
  // lone centered <LoadingSpinner>, so navigating to a not-yet-loaded screen
  // shows UI immediately rather than a bare spinner after a rebuild.
  assert.match(
    source,
    /import ScreenLoadingSkeleton from "\.\.\/\.\.\/components\/platform\/ScreenLoadingSkeleton\.jsx"/,
  );
  assert.match(source, /<ScreenLoadingSkeleton label=\{label\} \/>/);
  // The lone-spinner loading UX (and its now-unused import) must be gone.
  assert.doesNotMatch(source, /<LoadingSpinner size=\{22\} \/>/);
  assert.doesNotMatch(source, /import \{ LoadingSpinner \}/);
  // The loading branch keeps its testid/role contract used by boot + QA.
  assert.match(source, /data-testid=\{`screen-loading-\$\{screenId\}`\}/);
});

test("algo is covered by the background screen preload sweep", () => {
  // algo was absent from SCREEN_MODULE_PRELOAD_ORDER, so on follower tabs / before
  // the leader-gated priority pass it was never warmed → permanently cold chunk.
  const start = source.indexOf("export const SCREEN_MODULE_PRELOAD_ORDER");
  const end = source.indexOf("]", start);
  const block = source.slice(start, end);
  assert.notEqual(start, -1);
  assert.match(block, /"algo"/, "algo must be in the preload order");
});
