import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const shellSource = readFileSync(
  new URL("./PlatformShell.jsx", import.meta.url),
  "utf8",
);

test("the fifth mobile navigation destination remains a stable More control", () => {
  assert.match(
    shellSource,
    /const MOBILE_PRIMARY_SCREEN_IDS = \["market", "signals", "trade", "account"\];/,
    "phone navigation must keep exactly four primary destinations",
  );
  assert.match(
    shellSource,
    /gridTemplateColumns: "repeat\(5, minmax\(0, 1fr\)\)",/,
    "the four primary destinations and More must share five stable columns",
  );
  assert.match(
    shellSource,
    /const MoreIcon = Ellipsis;/,
    "secondary routes must not replace the user's stable More icon",
  );
  assert.match(
    shellSource,
    /const moreLabel = "More";/,
    "secondary routes must not rename the stable More destination",
  );
  assert.match(
    shellSource,
    /data-testid="mobile-bottom-nav-more"[\s\S]{0,240}aria-current=\{[\s\S]{0,180}!MOBILE_PRIMARY_SCREEN_SET\.has\(activeScreen\)/,
    "More should still communicate which secondary route family is active",
  );
});

test("tablet watchlist uses a temporary drawer without changing the persisted desktop preference", () => {
  assert.doesNotMatch(
    shellSource,
    /mobileAutoCollapseRef/,
    "phone layout must not track an automatic persisted-rail collapse",
  );
  assert.match(
    shellSource,
    /const sidebarWidth = isTablet \|\| sidebarCollapsed\s*\? 40\s*: resolvedWatchlistSidebarWidth;/,
    "tablet should reserve only the collapsed rail while desktop keeps its preference",
  );
  assert.match(
    shellSource,
    /collapsed=\{isTablet \|\| sidebarCollapsed\}/,
  );
  assert.match(
    shellSource,
    /onExpand=\{\(\) => \{\s*if \(isTablet\) \{\s*setMobileWatchlistOpen\(true\);\s*return;\s*\}\s*setSidebarCollapsed\(false\);\s*\}\}/,
  );
  assert.match(
    shellSource,
    /<MobileWatchlistDrawer\s+open=\{auxiliaryDrawerViewport && mobileWatchlistOpen\}/,
  );
});

test("semantic viewport changes close every shell drawer", () => {
  const responsiveCleanupEffect = shellSource.match(
    /useEffect\(\(\) => \{\s*setMobileMoreOpen\(false\);\s*setMobileActivityOpen\(false\);\s*setMobileWatchlistOpen\(false\);\s*setMobilePulseOpen\(false\);\s*setNotificationsOpen\(false\);\s*setMobileBloombergMounted\(false\);\s*\}, \[isPhone, isTablet\]\);/,
  )?.[0];
  assert.ok(
    responsiveCleanupEffect,
    "phone/tablet/desktop class changes should close every drawer before reallocating chrome",
  );
  assert.doesNotMatch(
    responsiveCleanupEffect,
    /setSidebarCollapsed|setActivitySidebarCollapsed/,
    "responsive cleanup must not rewrite persisted desktop rail preferences",
  );
});

test("phone, tablet, and desktop keep the primary workspace dominant", () => {
  assert.match(
    shellSource,
    /data-layout=\{isPhone \? "phone" : isNarrow \? "tablet" : "desktop"\}/,
  );
  assert.match(
    shellSource,
    /style=\{\{ flex: 1, display: "flex", overflow: "hidden", minWidth: 0 \}\}/,
    "the workspace row must absorb available width without document overflow",
  );
  assert.match(
    shellSource,
    /\{!isPhone \? \(\s*<FrameSidebar[\s\S]*?collapsed=\{isTablet \|\| sidebarCollapsed\}/,
    "phone removes the watchlist rail while tablet keeps only its launcher",
  );
  assert.match(
    shellSource,
    /\{!isPhone && \(isTablet \|\| activeScreen !== "algo"\) \? \(\s*<FrameSidebar[\s\S]*?collapsed=\{isTablet \|\| activitySidebarCollapsed\}/,
    "phone removes the Algo rail while tablet keeps only its launcher",
  );
  assert.match(
    shellSource,
    /\{isPhone \? \(\s*<MobileBottomNav[\s\S]*?\) : \(\s*<div\s+data-testid="platform-bottom-status"/,
    "phone owns bottom navigation while tablet and desktop retain the compact status footer",
  );
});

test("the Algo route owns its monitor without a duplicate shell rail", () => {
  assert.match(
    shellSource,
    /\{!isPhone && \(isTablet \|\| activeScreen !== "algo"\) \? \(\s*<FrameSidebar[\s\S]*?testId="platform-activity-sidebar"/,
    "the global activity rail must yield to the Algo route on desktop without removing the tablet launcher",
  );
});
