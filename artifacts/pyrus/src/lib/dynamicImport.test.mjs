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

test("reload recovery rejects and reloads at most once for the same failing module", { timeout: 2_000 }, async () => {
  const { retryDynamicImport } = await import("./dynamicImport.ts");
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const nativeSetTimeout = globalThis.setTimeout;
  const storage = new Map();
  let reloadCount = 0;
  const failure = new Error("Failed to fetch dynamically imported module");

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: {
        reload: () => {
          reloadCount += 1;
        },
      },
      sessionStorage: {
        getItem: (key) => storage.get(key) ?? null,
        removeItem: (key) => storage.delete(key),
        setItem: (key, value) => storage.set(key, value),
      },
    },
  });
  globalThis.setTimeout = (callback, delay, ...args) =>
    nativeSetTimeout(callback, delay === 10_000 ? 0 : delay, ...args);

  try {
    const load = () => Promise.reject(failure);
    const options = {
      label: "reload-once-behavior",
      retries: 0,
      retryDelayMs: 0,
      timeoutMs: 100,
    };
    await assert.rejects(
      retryDynamicImport(load, options),
      (error) => error === failure,
    );
    await assert.rejects(
      retryDynamicImport(load, options),
      (error) => error === failure,
    );
    assert.equal(reloadCount, 1);
  } finally {
    globalThis.setTimeout = nativeSetTimeout;
    if (previousWindow) {
      Object.defineProperty(globalThis, "window", previousWindow);
    } else {
      delete globalThis.window;
    }
  }
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

test("a stuck singleton import can be replaced before retrying", async () => {
  const { retryDynamicImport } = await import("./dynamicImport.ts");
  let cachedImport = null;
  let importCallCount = 0;

  const startImport = () => {
    importCallCount += 1;
    if (importCallCount === 1) {
      return new Promise(() => {});
    }
    return Promise.resolve({ default: "loaded" });
  };

  const singletonLoader = () => {
    cachedImport ??= startImport();
    return cachedImport;
  };

  const mod = await retryDynamicImport(singletonLoader, {
    label: "singleton-chunk",
    retries: 1,
    retryDelayMs: 0,
    reloadOnFailure: false,
    timeoutMs: 30,
    onAttemptFailure: ({ willRetry }) => {
      if (willRetry) {
        cachedImport = null;
      }
    },
  });

  assert.deepEqual(mod, { default: "loaded" });
  assert.equal(importCallCount, 2);
});

test("retry attempts surface progress detail context", async () => {
  const { retryDynamicImport } = await import("./dynamicImport.ts");
  const retryDetails = [];
  let callCount = 0;

  const mod = await retryDynamicImport(
    () => {
      callCount += 1;
      if (callCount === 1) {
        return Promise.reject(
          new Error("Failed to fetch dynamically imported module"),
        );
      }
      return Promise.resolve({ default: "loaded" });
    },
    {
      label: "detail-chunk",
      retries: 4,
      retryDelayMs: 0,
      reloadOnFailure: false,
      timeoutMs: 100,
      onRetry: ({ attempt, maxAttempts }) => {
        retryDetails.push(`retrying (attempt ${attempt}/${maxAttempts})`);
      },
    },
  );

  assert.deepEqual(mod, { default: "loaded" });
  assert.deepEqual(retryDetails, ["retrying (attempt 2/5)"]);
});

test("preload timeout failures remain observable while preserving the non-throwing contract", async () => {
  const { preloadDynamicImport } = await import("./dynamicImport.ts");
  let cachedImport = new Promise(() => {});
  const failures = [];

  const result = await preloadDynamicImport(() => cachedImport, {
    label: "preload-chunk",
    retries: 0,
    reloadOnFailure: false,
    timeoutMs: 30,
    onAttemptFailure: ({ label, attempt, maxAttempts, willRetry, error }) => {
      failures.push({
        label,
        attempt,
        maxAttempts,
        willRetry,
        retryableTimeout: /timed out/.test(String(error?.message)),
      });
      cachedImport = null;
    },
  });

  assert.equal(result, undefined);
  assert.equal(cachedImport, null);
  assert.deepEqual(failures, [
    {
      label: "preload-chunk",
      attempt: 1,
      maxAttempts: 1,
      willRetry: false,
      retryableTimeout: true,
    },
  ]);
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
