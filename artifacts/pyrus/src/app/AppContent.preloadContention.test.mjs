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
const screenModulePreloaderSource = readFileSync(
  new URL("../features/platform/screenModulePreloader.js", import.meta.url),
  "utf8",
);
const screenRegistrySource = readFileSync(
  new URL("../features/platform/screenRegistry.jsx", import.meta.url),
  "utf8",
);
const appHeaderSource = readFileSync(
  new URL("../features/platform/AppHeader.jsx", import.meta.url),
  "utf8",
);
const headerBroadcastSource = readFileSync(
  new URL(
    "../features/platform/HeaderBroadcastScrollerStack.jsx",
    import.meta.url,
  ),
  "utf8",
);
const platformShellSource = readFileSync(
  new URL("../features/platform/PlatformShell.jsx", import.meta.url),
  "utf8",
);
const platformScreenRouterSource = readFileSync(
  new URL("../features/platform/PlatformScreenRouter.jsx", import.meta.url),
  "utf8",
);
const mobileMoreSheetSource = readFileSync(
  new URL("../features/platform/MobileMoreSheet.jsx", import.meta.url),
  "utf8",
);
const multiChartGridSource = readFileSync(
  new URL("../features/market/MultiChartGrid.jsx", import.meta.url),
  "utf8",
);
const marketDemoScreenSource = readFileSync(
  new URL("../screens/MarketDemoScreen.jsx", import.meta.url),
  "utf8",
);
const researchChartSurfaceSource = readFileSync(
  new URL("../features/charting/ResearchChartSurface.tsx", import.meta.url),
  "utf8",
);
const viteConfigSource = readFileSync(
  new URL("../../vite.config.ts", import.meta.url),
  "utf8",
);
const indexCssSource = readFileSync(
  new URL("../index.css", import.meta.url),
  "utf8",
);
const algoScreenSource = readFileSync(
  new URL("../screens/AlgoScreen.jsx", import.meta.url),
  "utf8",
);
const algoRouteScreenSource = readFileSync(
  new URL("../screens/AlgoRouteScreen.jsx", import.meta.url),
  "utf8",
);
const accountRouteScreenSource = readFileSync(
  new URL("../screens/AccountRouteScreen.jsx", import.meta.url),
  "utf8",
);
const deferredRouteScreenSource = readFileSync(
  new URL("../screens/DeferredRouteScreen.jsx", import.meta.url),
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
    /const screenCodePreloadReady = Boolean\(\s*AUTOMATIC_BACKGROUND_SCREEN_PRELOAD_ENABLED[\s\S]*?operationalCodePreloadReady[\s\S]*?activeScreenBackgroundAllowed[\s\S]*?\);/,
    "the background screen-code sweep must be gated by AUTOMATIC_BACKGROUND_SCREEN_PRELOAD_ENABLED",
  );
  assert.doesNotMatch(
    platformAppSource,
    /memoryAllowsBackgroundWarmup/,
    "memory telemetry must not silently block code or data warmup",
  );
  assert.match(
    platformAppSource,
    /const hiddenScreenWarmMountAllowed = Boolean\(\s*AUTOMATIC_BACKGROUND_SCREEN_PRELOAD_ENABLED[\s\S]*?hiddenScreenPreloadPolicy\.mountScreens[\s\S]*?disableHiddenScreenWarmMount[\s\S]*?\);/,
    "hidden warm mounting must be gated by AUTOMATIC_BACKGROUND_SCREEN_PRELOAD_ENABLED",
  );
});

test("cold Account transforms warm in Vite while the lightweight Algo route ships with the registry", () => {
  assert.doesNotMatch(platformAppSource, /NAVIGATION_CRITICAL_SCREEN_MODULE_PRELOAD_ORDER/);
  assert.doesNotMatch(platformAppSource, /runNavigationCriticalScreenPreload/);
  const viteWarmup = viteConfigSource.match(
    /warmup:\s*\{\s*clientFiles:\s*\[[\s\S]*?\]\s*,?\s*\}/,
  )?.[0];
  assert.ok(viteWarmup, "missing Vite client transform warmup");
  assert.match(viteWarmup, /\.\/src\/screens\/AccountScreen\.jsx/);
  assert.doesNotMatch(viteWarmup, /Algo(?:Route)?Screen\.jsx/);
  assert.match(
    appHeaderSource,
    /onFocus=\{\(\) => handleScreenIntent\(screen\.id\)\}[\s\S]*?onPointerEnter=\{\(\) => handleScreenIntent\(screen\.id\)\}[\s\S]*?onPointerDown=\{\(\) => handleScreenIntent\(screen\.id\)\}/,
    "screen intent should still resolve the registry-owned route shell before navigation",
  );
  assert.match(
    platformShellSource,
    /useVisibleScreenNavigation\(\{[\s\S]*?preloadScreen: preloadScreenModule,[\s\S]*?setScreen,[\s\S]*?\}\)/,
    "the click path must use the behavior-tested visible-screen coordinator",
  );
});

test("signed-in dev workspaces leave heavy route evaluation to the mounted route shells", () => {
  assert.doesNotMatch(
    appContentSource,
    /DEV_NAVIGATION_SCREEN_MODULE_PATHS|preloadNavigationScreenModuleResources|link\.rel = "modulepreload"/,
    "browser modulepreload must not compete with the lightweight route shells",
  );
  assert.match(
    appContentSource,
    /function AuthenticatedWorkspacePreloader[\s\S]*?preloadInitialWorkspaceRoute\(\);/,
    "authenticated users should still preload the initial workspace route",
  );
});

test("shared chart numeric helpers stay in charting runtime instead of creating a chunk cycle", () => {
  const chartingRuntimeRule = viteConfigSource.match(
    /if \(\s*normalizedId\.includes\("\/src\/features\/charting\/activeChartBarStore"\)[\s\S]*?return "charting-runtime";\s*\}/,
  )?.[0];

  assert.ok(chartingRuntimeRule, "missing charting-runtime manual chunk rule");
  assert.match(
    chartingRuntimeRule,
    /\/src\/features\/charting\/utils\/numeric/,
    "the shared numeric helper must not be assigned to a feature chunk that charting-runtime imports",
  );
});

test("Algo has one route loading gate for its mandatory live page", () => {
  assert.match(
    screenModulePreloaderSource,
    /import AccountRouteScreen from "\.\.\/\.\.\/screens\/AccountRouteScreen\.jsx"/,
  );
  assert.match(
    screenModulePreloaderSource,
    /account:\s*\(\) => Promise\.resolve\(\{ default: AccountRouteScreen \}\)/,
  );
  assert.match(
    screenModulePreloaderSource,
    /import AlgoRouteScreen from "\.\.\/\.\.\/screens\/AlgoRouteScreen\.jsx"/,
  );
  assert.match(
    screenModulePreloaderSource,
    /algo:\s*\(\) => Promise\.resolve\(\{ default: AlgoRouteScreen \}\)/,
    "pointer intent must not dynamically evaluate even the lightweight Algo route",
  );
  assert.match(
    deferredRouteScreenSource,
    /const scheduleLoad = \(\) => \{[\s\S]*?window\.setTimeout\(\(\) => \{[\s\S]*?loadImplementation\(\)\.then/,
    "heavy screen imports should run in a task after their route shells commit",
  );
  assert.match(
    deferredRouteScreenSource,
    /document\.visibilityState === "hidden"[\s\S]*?scheduleLoad\(\);[\s\S]*?window\.requestAnimationFrame\(scheduleLoad\)/,
    "visible routes should cross a rendering opportunity before implementation evaluation",
  );
  assert.match(
    deferredRouteScreenSource,
    /const implementationVisible =\s*props\.isHostVisible \?\? props\.isVisible;[\s\S]*?if \(Implementation \|\| implementationVisible === false\) \{\s*return undefined;\s*\}/,
    "the visible route shell should start implementation work without activating its data gates",
  );
  assert.match(
    deferredRouteScreenSource,
    /\}, \[Implementation, implementationVisible\]\);/,
    "host visibility changes must clean up scheduled or in-flight route work",
  );
  assert.match(
    screenRegistrySource,
    /const implementationVisible =\s*props\?\.isHostVisible \?\? props\?\.isVisible;[\s\S]*?if \(\s*ResolvedScreenComponent \|\|\s*loadError \|\|\s*implementationVisible === false\s*\)/,
    "a cold urgent host must resolve its lightweight registry route before canonical data activation",
  );
  assert.match(
    screenRegistrySource,
    /if \(!ResolvedScreenComponent \|\| props\?\.isVisible === false\) \{/,
    "screen readiness must remain gated by canonical data visibility",
  );
  assert.match(
    algoRouteScreenSource,
    /loadModule: \(\) => import\("\.\/AlgoScreen\.jsx"\)/,
  );
  assert.match(
    accountRouteScreenSource,
    /loadModule: \(\) => import\("\.\/AccountScreen\.jsx"\)/,
  );
  assert.match(
    deferredRouteScreenSource,
    /if \(loadError\) \{\s*throw loadError;/,
    "route import failures should reach the existing screen error boundary",
  );
  assert.match(
    deferredRouteScreenSource,
    /retryDynamicImport\(loadModule,\s*\{\s*label:\s*moduleLabel,?\s*\}\)/,
    "visible route imports must preserve one-time stale-chunk reload recovery",
  );
  assert.match(
    deferredRouteScreenSource,
    /let loadedImplementation = null;[\s\S]*?useState\(\s*\(\) => loadedImplementation,?\s*\)/,
    "resolved implementations should remount without another deferred load turn",
  );
  const cachedImplementationLoader = deferredRouteScreenSource.match(
    /const loadImplementation = \(\) => \{[\s\S]*?return moduleImport;\s*\};/,
  )?.[0];
  assert.ok(cachedImplementationLoader, "missing deferred implementation loader");
  assert.doesNotMatch(
    cachedImplementationLoader,
    /preloadScreenModules|loadedImplementation\s*=/,
    "a route abandoned while hidden must not start nested warmups or publish its implementation",
  );
  const visibleImplementationSuccess = deferredRouteScreenSource.match(
    /loadImplementation\(\)\.then\(\s*\(mod\) => \{([\s\S]*?)\n\s*\},\s*\(error\) => \{/,
  )?.[1];
  assert.ok(visibleImplementationSuccess, "missing visible implementation success path");
  assert.match(
    visibleImplementationSuccess,
    /if \(!cancelled\) \{[\s\S]*?try \{[\s\S]*?const nestedPreload = mod\.preloadScreenModules\?\.\(\);[\s\S]*?void nestedPreload\?\.catch\?\.\(\(\) => undefined\);[\s\S]*?\} catch \{[\s\S]*?\}[\s\S]*?setImplementation\(\(\) => mod\.default\);/,
    "only a still-visible heavy route should restore its opportunistic nested warmup",
  );
  assert.match(
    visibleImplementationSuccess,
    /if \(!cancelled\) \{[\s\S]*?loadedImplementation = mod\.default;[\s\S]*?setImplementation\(\(\) => mod\.default\);/,
    "only a still-visible route should publish the resolved implementation cache",
  );
  assert.doesNotMatch(
    visibleImplementationSuccess,
    /\bawait\b|async\s*\(mod\)/,
    "nested warmup must not delay the visible implementation",
  );
  assert.match(
    deferredRouteScreenSource,
    /onReadinessChange\?\.\(\{\s*frameReady: true,\s*contentReady: true,\s*primaryReady: false,\s*derivedReady: false,\s*backgroundAllowed: false,\s*error: normalizedError,\s*\}\)/,
    "implementation import failures must reach the platform readiness snapshot",
  );
  assert.match(
    deferredRouteScreenSource,
    /onReadinessChange\?\.\(\{\s*frameReady: true,\s*contentReady: false,\s*primaryReady: false,\s*derivedReady: false,\s*backgroundAllowed: false,\s*error: null,\s*\}\)/,
    "a successful retry must clear stale route-import readiness errors",
  );
  for (const routeSource of [algoRouteScreenSource, accountRouteScreenSource]) {
    assert.doesNotMatch(
      routeSource,
      /preloadScreenModules/,
      "lightweight route modules must not eagerly preload their implementations",
    );
  }
  assert.match(algoRouteScreenSource, /loadingText: "Loading algo workspace"/);
  assert.match(
    accountRouteScreenSource,
    /loadingText: "Loading account workspace"/,
  );
  assert.doesNotMatch(deferredRouteScreenSource, /height:\s*"100%"/);
  assert.match(
    algoScreenSource,
    /import \{ AlgoLivePage \} from "\.\/algo\/AlgoLivePage";/,
    "the mandatory Algo content should resolve with the route implementation",
  );
  assert.doesNotMatch(
    algoScreenSource,
    /retryDynamicImport\(\s*\(\) => import\("\.\/algo\/AlgoLivePage"\)/,
    "Algo must not start a second main-page chunk gate after its route loads",
  );
  assert.doesNotMatch(
    algoScreenSource,
    /<Suspense fallback=\{<AlgoLivePageLoadingStatus \/>\}>[\s\S]*?<LazyAlgoLivePage/,
    "Algo must not replace the resolved route with a second workspace loader",
  );
  assert.doesNotMatch(algoScreenSource, /algo-live-page-loading/);
  assert.match(algoScreenSource, /<AlgoLivePage\b/);
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

test("Market progressive chart hydration is non-urgent React work", () => {
  assert.match(
    multiChartGridSource,
    /import \{[\s\S]*startTransition,[\s\S]*\} from "react";/,
    "progressive chart mounts should use React transition scheduling",
  );
  assert.match(
    multiChartGridSource,
    /startTransition\(\(\) => \{\s*setHydrationSlotLimit\(\(current\) =>\s*Math\.max\(current, nextSlotLimit\),?\s*\);\s*\}\);/,
    "each delayed chart mount must remain interruptible by navigation",
  );
});

test("Market flow history only hydrates chart slots that can render it", () => {
  assert.match(
    multiChartGridSource,
    /const streamedSymbols = useMemo\([\s\S]*?visibleSlotEntries\s*\.slice\(0, effectiveHydrationSlotLimit\)\s*\.map/,
    "live chart flow must use the same hydrated-slot boundary",
  );
  const requestBlock = multiChartGridSource.match(
    /const historicalChartFlowRequests = useMemo\(\(\) => \{[\s\S]*?\n  \}, \[[\s\S]*?\]\);/,
  )?.[0];
  assert.ok(requestBlock, "missing Market chart-flow request builder");
  assert.match(
    requestBlock,
    /visibleSlotEntries\s*\.slice\(0, effectiveHydrationSlotLimit\)\s*\.forEach/,
    "fallback chart slots must not fetch and process history before hydration",
  );
  assert.match(requestBlock, /effectiveHydrationSlotLimit/);
});

test("Market flow history reads user preferences once per mapping pass", () => {
  assert.match(
    multiChartGridSource,
    /const historicalChartFlowMappedRef = useRef\(new WeakMap\(\)\);/,
  );
  const historyMappingBlock = multiChartGridSource.match(
    /const historicalChartFlowEvents = useMemo\(\(\) => \{[\s\S]*?\n  \}, \[historicalChartFlowQueries, historicalChartFlowRequests\]\);/,
  )?.[0];
  assert.ok(historyMappingBlock, "missing historical Market flow mapper");
  assert.match(historyMappingBlock, /const userPreferences = readCachedUserPreferences\(\);/);
  assert.match(
    historyMappingBlock,
    /const preferenceTimeKey = JSON\.stringify\(userPreferences\.time\);/,
  );
  assert.match(
    historyMappingBlock,
    /mapFlowEventToUi\(event, userPreferences\)/,
    "mapping 1,000-event histories must not reread cached preferences per event",
  );
  assert.match(
    historyMappingBlock,
    /historicalChartFlowMappedRef\.current\.get\(rawEvents\)/,
  );
  assert.match(
    historyMappingBlock,
    /historicalChartFlowMappedRef\.current\.set\(rawEvents,/,
    "unchanged query payloads must reuse their mapped history",
  );
});

test("Market flow history maps cold payloads off the renderer thread", () => {
  assert.match(
    multiChartGridSource,
    /export const mapMarketChartFlowEvents = async \(\s*events,\s*userPreferences,\s*getWorkerApi = getAnalyticsWorkerApi,\s*\) =>/,
  );
  assert.match(
    multiChartGridSource,
    /Promise\.race\(\[[\s\S]*?workerApi\.mapFlowEventsToUi\([\s\S]*?window\.setTimeout\([\s\S]*?MARKET_CHART_FLOW_WORKER_FALLBACK_MS/,
    "a stalled worker must fall back instead of stranding the history query",
  );
  assert.match(
    multiChartGridSource,
    /const response = await listFlowEventsRequest\([\s\S]*?mappedEvents: await mapMarketChartFlowEvents\(rawEvents, userPreferences\)/,
  );
  assert.match(
    multiChartGridSource,
    /query\.data\?\.mappedPreferenceTimeKey === preferenceTimeKey\s*\? query\.data\?\.mappedEvents/,
  );
});

test("platform chrome does not subscribe to unused runtime freshness snapshots", () => {
  assert.doesNotMatch(platformAppSource, /useRuntimeControlSnapshot/);
  assert.doesNotMatch(platformAppSource, /footerApiSourceRuntime/);
  assert.doesNotMatch(headerBroadcastSource, /useRuntimeControlSnapshot/);
  assert.match(
    headerBroadcastSource,
    /const broadScanRuntimeActive = broadScanOwnerActive;/,
    "header scanner status should use its existing scanner-control subscription",
  );
  for (const source of [platformAppSource, platformShellSource, mobileMoreSheetSource]) {
    assert.doesNotMatch(source, /apiSourcePressureSnapshot/);
  }
  for (const source of [platformShellSource, mobileMoreSheetSource]) {
    assert.doesNotMatch(source, /memoryPressureSignal/);
  }
});

test("hidden Account and Algo tabs do not poll an unavailable broker account list", () => {
  assert.match(
    platformAppSource,
    /const accountScreenAccountsQueryEnabled = Boolean\(\s*sessionQuery\.data &&\s*!safeQaMode &&\s*\(screen === "account" \|\| screen === "algo"\),?\s*\);/,
    "the shared Account/Algo live account list must stay idle on Market and unrelated screens",
  );
});

test("screen handoffs do not unmount and remount the previous retained screen", () => {
  assert.match(
    platformShellSource,
    /const preservePreviousScreenDuringHandoff =\s*previousActiveScreenRef\.current === id &&\s*previousActiveScreenRef\.current !== activeScreen;/,
    "the render before the retention effect must preserve the prior screen",
  );
  assert.match(
    platformShellSource,
    /mountedScreens\[id\] &&\s*\(preservePreviousScreenDuringHandoff \|\|\s*retainedInactiveScreens\.includes\(id\)/,
  );
  assert.match(
    platformShellSource,
    /const shouldRender =\s*active \|\|\s*\(mountedScreens\[id\] &&\s*\(preservePreviousScreenDuringHandoff \|\|/,
    "the active host must not wait for mounted-screen bookkeeping effects",
  );
  assert.doesNotMatch(platformShellSource, /setRetainedInactiveScreens/);
  assert.match(
    platformShellSource,
    /const retainedInactiveScreens = [\s\S]*?nextRetainedScreens\.slice\(\s*0,\s*MAX_RETAINED_INACTIVE_SCREENS,?\s*\);/,
    "the current navigation render must enforce the retention limit",
  );
  assert.match(
    platformShellSource,
    /retainedInactiveScreensRef\.current = retainedInactiveScreens;/,
  );
  assert.match(
    platformShellSource,
    /const previousScreenRetained = screenCanRetainInactive\(previousScreen\);[\s\S]*?if \(previousScreenRetained\) \{\s*return undefined;\s*\}[\s\S]*?setDeferredInactiveScreens/,
    "retainable screens must not schedule a second shell render during handoff",
  );
});

test("screen navigation uses the behavior-tested visible-screen coordinator", () => {
  assert.match(
    platformShellSource,
    /const \{ handleSetScreen, visibleScreenStore \} = useVisibleScreenNavigation\(\{[\s\S]*?activeScreen,[\s\S]*?markScreenSwitch: markScreenSwitchStart,[\s\S]*?preloadScreen: preloadScreenModule,[\s\S]*?setScreen,[\s\S]*?\}\);/,
    "PlatformShell must wire canonical navigation into the tested coordinator",
  );
  assert.match(
    platformShellSource,
    /<PlatformScreenStack\s*visibleScreenStore=\{visibleScreenStore\}/,
  );
});

test("the closed mobile More sheet stays out of urgent screen publication", () => {
  assert.doesNotMatch(mobileMoreSheetSource, /useVisibleScreen/);
  const mobileMoreSheetBlock = platformShellSource.match(
    /<MobileMoreSheet[\s\S]*?\/>/,
  )?.[0];
  assert.ok(mobileMoreSheetBlock, "missing mobile More sheet");
  assert.match(
    mobileMoreSheetBlock,
    /activeScreen=\{activeScreen\}/,
    "the always-mounted sheet can follow canonical state after the urgent host commits",
  );
  assert.doesNotMatch(mobileMoreSheetBlock, /visibleScreenStore/);

  for (const componentName of ["AppHeader", "MobileBottomNav"]) {
    const componentBlock = platformShellSource.match(
      new RegExp(`<${componentName}[\\s\\S]*?\\/>`),
    )?.[0];
    assert.ok(componentBlock, `missing ${componentName}`);
    assert.match(
      componentBlock,
      /visibleScreenStore=\{visibleScreenStore\}/,
      `${componentName} must keep immediate navigation feedback`,
    );
  }
});

test("screen entrance motion never hides an active host", () => {
  const transitionHostBlock = platformShellSource.match(
    /const ScreenTransitionHost = \([\s\S]*?\n\};/,
  )?.[0];
  assert.ok(transitionHostBlock, "missing screen transition host");
  assert.doesNotMatch(transitionHostBlock, /activationToken|setActivationToken/);
  assert.match(
    transitionHostBlock,
    /className=\{active \? "ra-screen-enter" : undefined\}/,
  );
  const screenEntranceCss = indexCssSource.match(
    /@keyframes raScreenEnter \{[\s\S]*?\.ra-screen-enter \{[\s\S]*?\}/,
  )?.[0];
  assert.ok(screenEntranceCss, "missing screen entrance animation");
  assert.doesNotMatch(screenEntranceCss, /opacity:\s*0/);
  assert.match(screenEntranceCss, /transform:\s*translateY\(4px\)/);
});

test("Market deactivation cannot block an urgent screen activation", () => {
  assert.match(
    platformShellSource,
    /<ScreenTransitionHost[\s\S]*?active=\{active\}[\s\S]*?\{renderScreenById\(id, activeScreen\)\}/,
    "the urgent host identity should reach deferred route shells without changing retained data visibility",
  );
  assert.match(
    platformAppSource,
    /const renderScreenById = useCallback\(\s*\(screenId, visibleScreen\) => \([\s\S]*?screen=\{screen\}[\s\S]*?hostScreen=\{visibleScreen\}/,
    "route shells should receive urgent host visibility while data gates follow the canonical post-paint handoff",
  );
  assert.match(
    platformScreenRouterSource,
    /hostScreen = screen[\s\S]*?const accountHostVisible = hostScreen === "account";[\s\S]*?const algoHostVisible = hostScreen === "algo";[\s\S]*?<MemoAccountScreen[\s\S]*?isHostVisible=\{accountHostVisible\}[\s\S]*?<MemoAlgoScreen[\s\S]*?isHostVisible=\{algoHostVisible\}/,
    "only Account and Algo route-shell imports should start from urgent host visibility",
  );
  assert.match(
    platformScreenRouterSource,
    /const marketDataActive = screen === "market";/,
    "Market work should deactivate directly in the canonical handoff without another deferred pass",
  );
  assert.doesNotMatch(platformScreenRouterSource, /useDeferredValue/);
  assert.match(
    multiChartGridSource,
    /const renderedSlotEntries = !isVisible\s*\? \[\]\s*:\s*phoneGrid\s*\? visibleSlotEntries\.slice\(0, 1\)\s*:\s*visibleSlotEntries;/,
    "retained Market layout state must not keep hidden chart surfaces rendering",
  );
});

test("Market summary refreshes do not reconcile the chart grid", () => {
  assert.match(
    marketDemoScreenSource,
    /const MemoMultiChartGrid = memo\(MultiChartGrid\);/,
  );
  assert.match(
    marketDemoScreenSource,
    /const handleSelectSymbol = useCallback\(\(nextSymbol\) => \{[\s\S]*?onSymClick\?\.\(nextSymbol\);[\s\S]*?\}, \[onSymClick\]\);/,
  );
  assert.match(marketDemoScreenSource, /<MemoMultiChartGrid\s/);
  assert.doesNotMatch(marketDemoScreenSource, /<MultiChartGrid\s/);
});

test("Market flow-volume rendering yields between overlay fibers", () => {
  assert.match(
    researchChartSurfaceSource,
    /const FlowVolumeOverlayNode = memo\(function FlowVolumeOverlayNode/,
    "each flow-volume overlay should own a memoized React fiber",
  );
  assert.match(
    researchChartSurfaceSource,
    /flowVolumeOverlays\.map\(\(overlay\) =>\s*\(\s*<FlowVolumeOverlayNode/,
    "the chart surface should delegate overlay work instead of building every node inline",
  );
  assert.doesNotMatch(
    researchChartSurfaceSource,
    /flowVolumeOverlays\.map\(\(overlay\) => \{\s*const toneColor/,
    "the parent render must not restore the unyieldable overlay loop",
  );
});

test("PlatformApp clears matrix rows after a terminal stream failure", () => {
  const transportErrorHandler =
    platformAppSource.match(
      /const handleSignalMatrixTransportError = useCallback\([\s\S]*?\n  \}, \[\]\);/,
    )?.[0] || "";

  assert.match(
    transportErrorHandler,
    /const handleSignalMatrixTransportError = useCallback\([\s\S]*setSignalMatrixTransportErrored\(errored\);[\s\S]*if \(!errored\) \{[\s\S]*return;[\s\S]*\}[\s\S]*signalMatrixStatesRef\.current = EMPTY_SIGNAL_MONITOR_STATES;[\s\S]*setSignalMatrixSnapshot\(\(current\) =>[\s\S]*states: EMPTY_SIGNAL_MONITOR_STATES/,
  );
  assert.doesNotMatch(
    transportErrorHandler,
    /signalHeaderPublishedStatesRef\.current = EMPTY_SIGNAL_MONITOR_STATES|setSignalHeaderPublishedStates\(EMPTY_SIGNAL_MONITOR_STATES\)/,
    "a transient matrix transport failure must not blank and then refill the independently published header tape",
  );
  assert.match(
    platformAppSource,
    /onTransportError: handleSignalMatrixTransportError/,
  );
});

test("Header broadcast pills keep stable React identity when live data reorders", () => {
  assert.match(
    headerBroadcastSource,
    /key=\{`\$\{item\.id\}-\$\{duplicate \? "duplicate" : "original"\}`\}/,
  );
  assert.doesNotMatch(
    headerBroadcastSource,
    /key=\{`\$\{item\.id\}-\$\{index\}`\}/,
    "array position must never decide a live header pill's identity",
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
