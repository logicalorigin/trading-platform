import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Source-assertion regression for the cold-launch preload-contention fix.
// .tsx/.jsx are not executed by `node --test`, so we assert on source like the
// sibling screenModulePreloader / dynamicImport regression tests.
// Run: npx tsx --test src/app/AppContent.preloadContention.test.mjs

const appContentSource = readFileSync(
  new URL("./AppContent.tsx", import.meta.url),
  "utf8",
);
const platformAppSource = readFileSync(
  new URL("../features/platform/PlatformApp.jsx", import.meta.url),
  "utf8",
);

test("AppContent no longer eagerly preloads non-initial priority screens during the boot window", () => {
  // Regression: a duplicate, UNGATED priority preload (account/signals/trade via
  // requestIdleCallback({ timeout: 2_000 })) ran at module-load time. During boot
  // the main thread is saturated, so requestIdleCallback never finds idle and the
  // 2s timeout FORCE-fired the preload mid-boot, dumping extra screen chunks into
  // the same connection pool + main thread as the initial screen's first paint and
  // its data fetches. PlatformApp's operationalCodePreloadReady-gated sweep is now
  // the single owner of non-initial priority warming.
  assert.doesNotMatch(
    appContentSource,
    /scheduleIdlePreload/,
    "the ungated boot-window idle-preload scheduler must be gone",
  );
  assert.doesNotMatch(
    appContentSource,
    /preloadPriorityPlatformScreenModules/,
    "the duplicate priority-screen preload helper must be gone",
  );
  assert.doesNotMatch(
    appContentSource,
    /PRIORITY_PLATFORM_SCREEN_IDS/,
    "the orphaned priority-screen id list must be removed",
  );
});

test("AppContent still preloads the two first-paint chunks (initial screen + workspace)", () => {
  assert.match(
    appContentSource,
    /preloadInitialPlatformScreenModule\(initialScreen\)/,
    "the initial-screen chunk must still be preloaded for first paint",
  );
  assert.match(
    appContentSource,
    /preloadDynamicImport\(loadPlatformApp/,
    "the workspace (PlatformApp) chunk must still be preloaded for first paint",
  );
});

test("PlatformApp's gated priority sweep preserves the account/signals/trade warm coverage", () => {
  // The non-initial priority warm that AppContent used to do (gated only by a 2s
  // idle timeout) now flows entirely through PlatformApp's
  // operationalCodePreloadReady-gated sweep, so the same screens are still warmed,
  // just after first paint instead of during the boot window.
  const match = platformAppSource.match(
    /PRIORITY_SCREEN_MODULE_PRELOAD_ORDER\s*=\s*\[([^\]]*)\]/,
  );
  assert.ok(match, "PRIORITY_SCREEN_MODULE_PRELOAD_ORDER must be defined");
  const ids = match[1];
  // All four screens that either path used to warm (AppContent: account/signals/
  // trade; PlatformApp: account/signals/algo) must remain in the single gated
  // sweep so the union coverage is preserved, just sequenced after first paint.
  for (const screenId of ["account", "signals", "trade", "algo"]) {
    assert.match(
      ids,
      new RegExp(`"${screenId}"`),
      `gated priority sweep must include "${screenId}" so its warm coverage is preserved`,
    );
  }
});

test("the gated priority sweep actually consumes the order behind operationalCodePreloadReady", () => {
  // Guards against a regression where the constant survives but the sweep that
  // warms it is deleted/broken (the constant alone would not warm anything).
  assert.match(
    platformAppSource,
    /PRIORITY_SCREEN_MODULE_PRELOAD_ORDER\.filter/,
    "the priority sweep must iterate PRIORITY_SCREEN_MODULE_PRELOAD_ORDER",
  );
  // operationalCodePreloadReady is the first-paint + leader-independent gate that
  // keeps the (now sole) priority warm from racing first paint.
  assert.match(
    platformAppSource,
    /operationalCodePreloadReady/,
    "the priority sweep must remain gated on operationalCodePreloadReady",
  );
});
