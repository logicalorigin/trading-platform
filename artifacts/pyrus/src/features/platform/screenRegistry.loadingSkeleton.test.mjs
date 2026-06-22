import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./screenRegistry.jsx", import.meta.url),
  "utf8",
);

test("cold-chunk loading branch renders a compact status, not fake screen chrome", () => {
  // A cold screen chunk should not paint a fake page-shaped skeleton. That made
  // slow imports look like broken empty screens and hid real stuck-loader bugs.
  assert.doesNotMatch(source, /ScreenLoadingSkeleton/);
  assert.doesNotMatch(source, /<LoadingSpinner size=\{22\} \/>/);
  assert.doesNotMatch(source, /import \{ LoadingSpinner \}/);
  assert.match(source, /const loadingLabel = label\.replace\(\/Screen\$\/, ""\);/);
  assert.match(source, /<span>\{`Loading \$\{loadingLabel\}`\}<\/span>/);
  // The loading branch keeps its testid/role contract used by boot + QA.
  assert.match(source, /data-testid=\{`screen-loading-\$\{screenId\}`\}/);
  assert.match(source, /role="status"/);
});

test("algo stays listed for explicit/manual screen preloading", () => {
  // Keep the registry order complete for explicit preloads and hover/click paths,
  // even though automatic background screen sweeps are disabled.
  const start = source.indexOf("export const SCREEN_MODULE_PRELOAD_ORDER");
  const end = source.indexOf("]", start);
  const block = source.slice(start, end);
  assert.notEqual(start, -1);
  assert.match(block, /"algo"/, "algo must be in the preload order");
});
