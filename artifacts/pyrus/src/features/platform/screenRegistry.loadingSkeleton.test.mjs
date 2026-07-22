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
  assert.match(
    source,
    /const loadingLabel = label\.replace\(\/Screen\$\/, ""\);/,
  );
  assert.match(source, /<NeuralLoader/);
  assert.match(source, /label=\{`Loading \$\{loadingLabel\}`\}/);
  assert.match(source, /variant="workspace"/);
  // The loading branch keeps its testid/role contract used by boot + QA.
  assert.match(source, /testId=\{`screen-loading-\$\{screenId\}`\}/);
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

test("preloaded screens render synchronously when immediate navigation activates them", () => {
  assert.match(
    source,
    /const ResolvedScreenComponent =\s*ScreenComponent \|\| getPreloadedScreenComponent\(screenId\)/,
  );
  assert.match(source, /return ResolvedScreenComponent \?/);
  assert.match(source, /<ResolvedScreenComponent \{\.\.\.props\} \/>/);
});

test("route-load failures use the shared touch-safe action and user-facing copy", () => {
  assert.match(source, /import \{ Button \} from "\.\.\/\.\.\/components\/ui\/Button\.jsx";/);
  assert.match(source, /dataTestId=\{`screen-load-retry-\$\{screenId\}`\}/);
  assert.match(source, /\{loadingLabel\} could not load/);
  assert.match(source, /Retry to load this workspace again\./);
});
