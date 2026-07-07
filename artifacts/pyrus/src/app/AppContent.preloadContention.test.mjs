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
  // its data fetches. Non-initial screens should now load on the user's navigation
  // path instead of through automatic background warming.
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

test("PlatformApp does not automatically background-preload cold screen modules", () => {
  // Normal-mode browser evidence showed the post-first-paint priority sweep
  // competing with the screen the user clicked. The import should happen on the
  // user's navigation path, not as an automatic account/signals/trade/algo sweep.
  assert.match(
    platformAppSource,
    /const AUTOMATIC_BACKGROUND_SCREEN_PRELOAD_ENABLED = false;/,
    "automatic background screen module preloading must stay disabled",
  );
  assert.match(
    platformAppSource,
    /const screenCodePreloadReady = Boolean\(\s*AUTOMATIC_BACKGROUND_SCREEN_PRELOAD_ENABLED[\s\S]*?operationalCodePreloadReady[\s\S]*?activeScreenBackgroundAllowed[\s\S]*?memoryAllowsBackgroundWarmup[\s\S]*?\);/,
    "the background screen-code sweep must be gated by AUTOMATIC_BACKGROUND_SCREEN_PRELOAD_ENABLED",
  );
  assert.match(
    platformAppSource,
    /const hiddenScreenWarmMountAllowed = Boolean\(\s*AUTOMATIC_BACKGROUND_SCREEN_PRELOAD_ENABLED[\s\S]*?hiddenScreenPreloadPolicy\.mountScreens[\s\S]*?disableHiddenScreenWarmMount[\s\S]*?\);/,
    "hidden warm mounting must be gated by AUTOMATIC_BACKGROUND_SCREEN_PRELOAD_ENABLED",
  );
});

test("the priority sweep can only run behind the background screen-code gate", () => {
  assert.match(
    platformAppSource,
    /PRIORITY_SCREEN_MODULE_PRELOAD_ORDER\.filter/,
    "the priority sweep must iterate PRIORITY_SCREEN_MODULE_PRELOAD_ORDER",
  );
  assert.match(
    platformAppSource,
    /if \(\s*!screenCodePreloadReady[\s\S]*?priorityScreenCodePreloadStartedRef\.current[\s\S]*?priorityScreenCodePreloadCompleteRef\.current[\s\S]*?\) \{/,
    "the priority sweep must be blocked when screenCodePreloadReady is false",
  );
});

test("long-lived signal matrix stream pauses while cold screen code is loading", () => {
  assert.match(
    platformAppSource,
    /const signalMatrixStreamReady = shouldRunSignalMatrixStream\(\{[\s\S]*?profileUniverse: signalMatrixStreamUsesProfileUniverse,[\s\S]*?universeSymbolCount: signalMatrixUniverseSymbols\.length,[\s\S]*?screen,[\s\S]*?foregroundReady: signalMatrixRequestActive,[\s\S]*?backgroundAllowed: activeScreenBackgroundDataAllowed,[\s\S]*?screenWarmupPhase,[\s\S]*?startupProtectionActive,[\s\S]*?criticalApiMutationPaused,[\s\S]*?\}\);/,
    "the matrix EventSource must require active-screen background readiness",
  );
  assert.match(
    platformAppSource,
    /useSignalMonitorMatrixStream\(\{[\s\S]*?enabled: signalMatrixStreamReady,/,
    "useSignalMonitorMatrixStream must consume signalMatrixStreamReady",
  );
});

test("PlatformApp tags signal matrix stream states by bootstrap vs delta source", () => {
  assert.match(
    platformAppSource,
    /const handleSignalMatrixStreamStates = useCallback\(\s*\(incomingStates, kind, payload = null\) => \{/,
    "stream state handler must receive the stream event kind",
  );
  assert.match(
    platformAppSource,
    /kind === "bootstrap" \? "stream-bootstrap" : "stream-delta"/,
    "bootstrap and state-delta payloads must be tagged before merge",
  );
  assert.match(
    platformAppSource,
    /displayHydrationSource: hydrationSource/,
    "stream states must carry displayHydrationSource into the matrix merge",
  );
  assert.match(
    platformAppSource,
    /onStates: handleSignalMatrixStreamStates/,
    "the matrix stream hook must pass event kind into the tagging handler",
  );
});

test("PlatformApp applies signal matrix stream frames as non-urgent React work", () => {
  assert.match(
    platformAppSource,
    /import \{[\s\S]*startTransition,[\s\S]*\} from "react";/,
    "large bootstrap/delta frames should use React transition scheduling",
  );
  assert.match(
    platformAppSource,
    /startTransition\(\(\) => setSignalMatrixSnapshot\(\(current\) => \{/,
    "matrix stream state commits must be wrapped in startTransition",
  );
});

test("PlatformApp signal monitor queries retain stale data and retry pressure sheds", () => {
  const profileBlock =
    platformAppSource.match(
      /const signalMonitorProfileQuery = useGetSignalMonitorProfile\([\s\S]*?\n  \);/,
    )?.[0] || "";
  const eventsBlock =
    platformAppSource.match(
      /const signalMonitorEventsQuery = useQuery\(\{[\s\S]*?\n  \}\);/,
    )?.[0] || "";

  [profileBlock, eventsBlock].forEach((block) => {
    assert.match(block, /retry:\s*retryUnlessTimeout\(2\)/);
    assert.match(block, /retryDelay:\s*QUERY_DEFAULTS\.retryDelay/);
    assert.match(block, /placeholderData:\s*\(previousData\) => previousData/);
  });
});

test("signal monitor event history pauses during blocking API mutations", () => {
  assert.match(
    platformAppSource,
    /if \(!criticalApiMutationPaused\) \{[\s\S]*?return;[\s\S]*?\}[\s\S]*?queryClient\.cancelQueries\(\{[\s\S]*?queryKey: getListSignalMonitorEventsQueryKey\(\),[\s\S]*?\}\);/,
    "blocking mutations must cancel in-flight signal event history pagination",
  );
  assert.match(
    platformAppSource,
    /const signalMonitorEventsReady = Boolean\(\s*signalMonitorDisplayReady &&\s*screen !== "algo" &&\s*screen !== "trade" &&\s*!criticalApiMutationPaused,\s*\);/,
    "signal event history must not run on Algo/Trade or restart during blocking API mutations",
  );
});
