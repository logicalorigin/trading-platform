import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readLocalSource = (filename) =>
  readFileSync(new URL(filename, import.meta.url), "utf8");

test("Settings Data & Broker tab uses the SnapTrade connect panel", () => {
  const source = readLocalSource("../SettingsScreen.jsx");

  assert.match(source, /from "\.\/settings\/SnapTradeConnectPanel\.jsx";/);
  assert.match(source, /<SnapTradeConnectPanel\s+enabled=\{dataBrokerTabActive\}/);

  const dataBrokerBlock = /activeTab === "Data & Broker"[\s\S]*?\)\}/.exec(source)?.[0] ?? "";
  assert.doesNotMatch(dataBrokerBlock, /<IbkrLaneArchitecturePanel/);
});

test("SnapTrade connect panel keeps portal launch admin gated and trade-if-available", () => {
  const source = readLocalSource("./SnapTradeConnectPanel.jsx");

  assert.match(source, /canManageSnapTradeConnections\(authSession\.user\)/);
  // Connect is card-native: launchPortal takes the card's brokerage slug
  // (defaulting to the selected one) and builds the portal body from it.
  assert.match(source, /launchPortal = async \(targetBroker = selectedBroker\)/);
  assert.match(source, /buildSnapTradeConnectionPortalBody\(targetBroker\)/);
  assert.match(source, /readiness\?\.clientInfo\?\.reachable === true/);
  assert.match(source, /readiness\?\.configured === true/);
  assert.doesNotMatch(source, /readiness\?\.credentials\?\.configured/);
  assert.match(source, /useSyncSnapTradeBrokerageConnections/);
  assert.match(source, /useGetSnapTradeAccountPortfolio/);
  assert.match(source, /useListSnapTradeBrokerages/);
  assert.match(source, /buildSnapTradeBrokerChoices\(brokeragesQuery\.data\?\.brokerages\)/);
  assert.match(source, /writeSnapTradeExecutionAccountState/);
  assert.match(source, /getListAccountsQueryKey/);
  assert.match(source, /executionReady === true/);
  assert.match(source, /executionBlockers/);
  assert.match(source, /label="Selected execution"/);
  assert.match(source, /openBrokerPopup\(portal\.redirectUri, "snaptrade-portal"\)/);
  assert.match(source, /showConnectHandoff\(\{\s*brokerKey: targetBroker,[\s\S]*url: portal\.redirectUri,[\s\S]*expiresAt: portal\.expiresAt,/);
  assert.match(source, /x-csrf-token/);
  // Actions live on each broker card (docs/plans/broker-connection-ux-plan.md).
  assert.match(source, /label: "Sync now"/);
  assert.match(source, /cardActionsFor/);
  assert.match(source, /deriveBrokerCardPhase/);
  assert.match(source, /successFlashKeys/);
  assert.match(source, />\s*Load Portfolio\s*</);
  assert.match(source, /aria-label="SnapTrade portfolio account"/);
  assert.match(source, /aria-label="SnapTrade portfolio positions"/);
});

test("SnapTrade connect panel exposes copy-link and QR handoff for broker launches", () => {
  const source = readLocalSource("./SnapTradeConnectPanel.jsx");

  assert.match(source, /buildBrokerConnectQrDataUri/);
  assert.match(source, /copyBrokerConnectLaunchUrl\(connectHandoff\.url\)/);
  assert.match(source, /copyStatus === "copied" \? "Copied" : "Copy link"/);
  assert.match(source, /broker connect QR code/);
  assert.match(source, /On a phone or when popups are\s+blocked/);
  assert.match(source, />\s*Open login\s*</);

  assert.match(source, /url: start\.authorizationUrl,[\s\S]*expiresAt: start\.expiresAt,/);
  assert.match(source, /brokerKey: ROBINHOOD_BROKER_CHOICE\.value,[\s\S]*url: start\.authorizationUrl,/);
  assert.match(source, /brokerKey: SCHWAB_BROKER_CHOICE\.value,[\s\S]*url: start\.authorizationUrl,/);
  assert.match(source, /brokerKey: IBKR_PORTAL_BROKER_CHOICE\.value,[\s\S]*url: loginPath,/);
  assert.match(source, /clearConnectHandoff\(ROBINHOOD_BROKER_CHOICE\.value\)/);
  assert.match(source, /clearConnectHandoff\(SCHWAB_BROKER_CHOICE\.value\)/);
  assert.match(source, /clearConnectHandoff\(IBKR_PORTAL_BROKER_CHOICE\.value\)/);
});

test("IBKR keeps mobile provisioning in the active tab and reserves popups only on desktop", () => {
  const source = readLocalSource("./SnapTradeConnectPanel.jsx");
  const connectBlock =
    /const connectIbkrPortal = async \(\) => \{[\s\S]*?\n  \};/.exec(source)?.[0] ?? "";

  assert.match(source, /isMobileIbkrLaunchBrowser/);
  assert.match(connectBlock, /const mobileLaunch = isMobileIbkrLaunchBrowser\(\)/);
  assert.match(
    connectBlock,
    /mobileLaunch\s*\?\s*null\s*:\s*openBrokerPopup\("about:blank", "ibkr-portal-login"\)/,
  );
  assert.match(connectBlock, /const loginUrl = new URL\(loginPath, window\.location\.origin\)\.href/);
  assert.match(connectBlock, /if \(mobileLaunch\) \{\s*window\.location\.assign\(loginUrl\);\s*return;/);
  assert.match(connectBlock, /popup\.location\.replace\(loginUrl\)/);
});

test("broker picker hydrates connected edges from server truth on load, unioned with sync freshness", () => {
  const source = readLocalSource("./SnapTradeConnectPanel.jsx");

  // Server-truth query drives connected state on initial page load.
  assert.match(source, /useListBrokerConnections/);
  assert.match(source, /brokerConnectionsQuery\s*=\s*useListBrokerConnections/);
  assert.match(
    source,
    /serverBrokerConnections\s*=\s*brokerConnectionsQuery\.data\?\.connections/,
  );

  // Filters to connected SnapTrade rows and keys off brokerageSlug.
  const memoBlock =
    /connectedBrokerSlugs\s*=\s*useMemo\(\(\)\s*=>\s*\{[\s\S]*?\},\s*\[[\s\S]*?\]\);/.exec(
      source,
    )?.[0] ?? "";
  assert.match(memoBlock, /connection\?\.provider === "snaptrade"/);
  assert.match(memoBlock, /connection\?\.status === "connected"/);
  assert.match(memoBlock, /connection\.brokerageSlug\.trim\(\)\.toUpperCase\(\)/);

  // The lastSync-derived slugs remain as a freshness overlay (union, not replace).
  assert.match(memoBlock, /of serverBrokerConnections/);
  assert.match(memoBlock, /of syncedConnections/);
  assert.match(memoBlock, /\[serverBrokerConnections, syncedConnections\]/);
});
