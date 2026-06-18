import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./dynamicImport.ts", import.meta.url),
  "utf8",
);

test("reload branch rejects after a bounded grace window instead of hanging forever", () => {
  // Root cause of the stuck loader spinner: the reload branch used to return a
  // forever-pending promise (`new Promise(() => {})`). Any loader gated on it —
  // the per-screen registry spinner and the root-chunk Suspense fallback — could
  // then never lift when window.location.reload() failed to navigate (sandboxed
  // view, throttled/backgrounded tab, a reload that re-failed).
  assert.doesNotMatch(
    source,
    /return new Promise\(\(\) => \{\}\);/,
    "reload path must not return a non-settling promise",
  );
  assert.match(
    source,
    /const RELOAD_NAVIGATION_GRACE_MS = 10_000;/,
    "a bounded reload grace window must be defined",
  );
  assert.match(
    source,
    /setTimeout\(\(\) => reject\(lastError\), RELOAD_NAVIGATION_GRACE_MS\)/,
    "the reload branch must reject with the original error after the grace window",
  );
});

test("the one-time reload guard and terminal throw remain intact", () => {
  // The grace-reject must not weaken the per-label guard that prevents reload
  // loops: once a reload is spent, a recurring retryable failure must throw so
  // callers surface the error UI rather than reloading again.
  assert.match(source, /maybeReloadOnceForDynamicImport\(label\)/);
  assert.match(source, /\n {2}throw lastError;\n/);
});

test("dynamic import reload guard uses the current storage key once", () => {
  assert.doesNotMatch(
    source,
    /LEGACY_DYNAMIC_IMPORT_RELOAD_KEY_PREFIX/,
    "Expected dynamic import reload guard to avoid same-value legacy prefixes",
  );
  assert.equal(
    source.match(/window\.sessionStorage\.getItem\(key\)/g)?.length,
    1,
    "Expected dynamic import reload guard to check the current key once",
  );
});
