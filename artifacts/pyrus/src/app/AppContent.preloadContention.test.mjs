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
const appSource = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
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

test("root app only preloads the lightweight app shell before auth is known", () => {
  assert.match(
    appSource,
    /preloadDynamicImport\(loadAppContent/,
    "the app shell chunk should still be preloaded",
  );
  assert.doesNotMatch(
    appSource,
    /PlatformApp-warm|features\/platform\/PlatformApp|preloadScreenModule|readInitialPlatformScreen/,
    "the root app must not preload workspace/screen chunks before auth resolves",
  );
});

test("normal workspace preloading is gated behind signed-in auth state", () => {
  assert.doesNotMatch(
    appContentSource,
    /if \(typeof window !== "undefined"\) \{\s*preloadInitialAppContentRoute\(\);\s*\}/,
    "normal workspace preloading must not run at AppContent module load",
  );
  assert.match(
    appContentSource,
    /function AuthenticatedWorkspacePreloader/,
    "workspace preloading should live in a component that can read auth state",
  );
  assert.match(
    appContentSource,
    /const \{\s*signedIn,\s*isLoading[\s\S]*?\} = useAuthSession\(\);/,
    "workspace preloading must read the canonical auth session",
  );
  assert.match(
    appContentSource,
    /if \([^)]*isLoading[\s\S]*?!signedIn[\s\S]*?\) \{/,
    "workspace preloading must return while auth is loading or signed out",
  );
  assert.match(
    appContentSource,
    /preloadInitialWorkspaceRoute\(\);/,
    "signed-in users should still warm the workspace route",
  );
});

test("PlatformApp keeps broad background screen preloading disabled", () => {
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

test("navigation-critical Account and Algo modules warm sequentially after first paint", () => {
  assert.match(
    platformAppSource,
    /const NAVIGATION_CRITICAL_SCREEN_MODULE_PRELOAD_ORDER = \[\s*"account",\s*"algo",\s*\];/,
    "only the two cold routes named by the visual regression should receive automatic code warmup",
  );
  assert.match(
    platformAppSource,
    /const navigationCriticalScreenCodePreloadReady = Boolean\(\s*operationalCodePreloadReady &&\s*memoryAllowsBackgroundWarmup,\s*\);/,
    "critical route code must wait until the first screen has painted and startup protection has lifted",
  );
  const priorityEffect = platformAppSource.match(
    /const runNavigationCriticalScreenPreload = async \(\) => \{[\s\S]*?void runNavigationCriticalScreenPreload\(\);/,
  )?.[0];
  assert.ok(priorityEffect, "missing navigation-critical preload effect");
  assert.match(priorityEffect, /for \(const screenId of preloadOrder\)/);
  assert.match(priorityEffect, /await preloadScreenModule\(screenId\)/);
  assert.doesNotMatch(
    priorityEffect,
    /Promise\.all(?:Settled)?/,
    "critical route chunks must not contend through a parallel sweep",
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

test("PlatformApp clears matrix rows after a terminal stream failure", () => {
  assert.match(
    platformAppSource,
    /const handleSignalMatrixTransportError = useCallback\([\s\S]*setSignalMatrixTransportErrored\(errored\);[\s\S]*if \(!errored\) \{[\s\S]*return;[\s\S]*\}[\s\S]*signalMatrixStatesRef\.current = EMPTY_SIGNAL_MONITOR_STATES;[\s\S]*setSignalMatrixSnapshot\(\(current\) =>[\s\S]*states: EMPTY_SIGNAL_MONITOR_STATES/,
  );
  assert.match(
    platformAppSource,
    /onTransportError: handleSignalMatrixTransportError/,
  );
});

test("PlatformApp never substitutes prior profile or event history after errors", () => {
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
  });
  [profileBlock, eventsBlock].forEach((block) => {
    assert.doesNotMatch(
      block,
      /placeholderData:\s*\(previousData\) => previousData/,
    );
  });
  assert.match(
    platformAppSource,
    /const signalMonitorProfile = signalMonitorProfileQuery\.isError\s*\? null\s*:\s*signalMonitorProfileQuery\.data \|\| null;/,
  );
  assert.match(
    platformAppSource,
    /const signalMonitorEvents = signalMonitorEventsQuery\.isError\s*\? EMPTY_SIGNAL_MONITOR_EVENTS\s*:\s*signalMonitorEventsQuery\.data\?\.events \|\| EMPTY_SIGNAL_MONITOR_EVENTS;/,
  );
});

test("signal monitor event history pauses during blocking API mutations", () => {
  assert.match(
    platformAppSource,
    /if \(!criticalApiMutationPaused\) \{[\s\S]*?return;[\s\S]*?\}[\s\S]*?queryClient\.cancelQueries\(\{[\s\S]*?queryKey: getListSignalMonitorEventsQueryKey\(\),[\s\S]*?\}\);/,
    "blocking mutations must cancel in-flight signal event history pagination",
  );
  assert.match(
    platformAppSource,
    /const signalMonitorEventsReady = Boolean\(\s*signalMonitorDisplayReady &&\s*screen !== "trade" &&\s*!criticalApiMutationPaused,\s*\);/,
    "signal event history must recover while Algo is visible and stay paused for Trade or blocking API mutations",
  );
});
