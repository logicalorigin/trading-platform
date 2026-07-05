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

test("a never-settling import rejects after the timeout as a retryable error", async () => {
  // A chunk request stuck PENDING (saturated connection pool, hung dev
  // transform) settles neither frameReady nor loadError, stranding the boot
  // first-screen task at 62% forever. The timeout race must convert the stall
  // into a rejection that the retry/reload machinery recognizes as retryable.
  const { retryDynamicImport, isRetryableDynamicImportError } = await import(
    "./dynamicImport.ts"
  );
  const neverSettles = () => new Promise(() => {});
  const started = Date.now();
  await assert.rejects(
    retryDynamicImport(neverSettles, {
      label: "stalled-chunk",
      retries: 0,
      reloadOnFailure: false,
      timeoutMs: 50,
    }),
    (error) => {
      assert.match(String(error?.message), /timed out/);
      assert.equal(isRetryableDynamicImportError(error), true);
      return true;
    },
  );
  assert.ok(Date.now() - started < 5_000, "must reject promptly, not hang");
});

test("the timeout race is applied to every loader attempt", () => {
  assert.match(
    source,
    /await raceWithTimeout\(loader\(\), timeoutMs, label\)/,
    "loader attempts must be raced against the stall timeout",
  );
  assert.match(
    source,
    /const DEFAULT_DYNAMIC_IMPORT_TIMEOUT_MS = 25_000;/,
    "a generous default stall timeout must be defined",
  );
});
