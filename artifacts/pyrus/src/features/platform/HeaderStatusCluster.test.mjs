import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const readLocalSource = (filename) =>
  readFileSync(new URL(filename, import.meta.url), "utf8");

const readButtonOpeningTag = (source, marker) => {
  const markerOffset = source.indexOf(marker);
  assert.notEqual(markerOffset, -1, marker);
  const buttonStart = source.lastIndexOf("<button", markerOffset);
  const buttonEnd = source.indexOf(">", markerOffset);
  assert.ok(buttonStart >= 0 && buttonEnd > markerOffset, marker);
  return source.slice(buttonStart, buttonEnd + 1);
};

test("header status cluster does not reference an unbound React namespace", () => {
  const source = readLocalSource("./HeaderStatusCluster.jsx");

  assert.doesNotMatch(source, /\bReact\./);
});

test("header status cluster does not call retired IBKR desktop bridge APIs", () => {
  const source = readLocalSource("./HeaderStatusCluster.jsx");

  assert.doesNotMatch(source, /\/api\/ibkr\/activation/);
  assert.doesNotMatch(source, /\/api\/ibkr\/desktop/);
  assert.doesNotMatch(source, /\/api\/ibkr\/bridge/);
  assert.doesNotMatch(source, /\/api\/ibkr\/remote-/);
  assert.doesNotMatch(source, /ibkr\.bridgeOverride\.clear/);
});

test("header status cluster renders SnapTrade broker status instead of retired IB Gateway controls", () => {
  const source = readLocalSource("./HeaderStatusCluster.jsx");

  assert.match(source, /HeaderSnapTradeBrokerStatus/);
  assert.match(
    source,
    /<HeaderSnapTradeBrokerStatus[\s\S]*surfaceStyle=\{surfaceStyle\}/,
  );
  assert.doesNotMatch(source, /SHOW_RETIRED_IBKR_GATEWAY_HEADER_UI/);
  assert.doesNotMatch(source, /HeaderIbkrCredentialForm/);
  assert.doesNotMatch(source, /Open IB Gateway connection details/);
  assert.doesNotMatch(source, /IBKR username/);
  assert.doesNotMatch(source, /IBKR password/);
  assert.doesNotMatch(source, /Launch with credentials/);
  assert.doesNotMatch(source, /HeaderIbkrConnectionSummaryMemo/);
  assert.doesNotMatch(source, /HeaderIbkrAdvancedDetailsMemo/);
  assert.doesNotMatch(source, /HeaderIbkrOperationStepperMemo/);
});

test("header bundle contains no retired desktop bridge launcher implementation", () => {
  const source = readLocalSource("./HeaderStatusCluster.jsx");

  assert.doesNotMatch(source, /IBKR_BRIDGE_/);
  assert.doesNotMatch(source, /desktopAgent/);
  assert.doesNotMatch(source, /managementToken/);
  assert.doesNotMatch(source, /encryptIbkrLoginEnvelope/);
  assert.doesNotMatch(source, /ibkrBridgeSession/);
  assert.doesNotMatch(source, /legacy IBKR desktop bridge/i);
});

test("retired desktop bridge launcher modules are absent", () => {
  const retiredModules = [
    "./ibkrBridgeLaunchFeedback.js",
    "./ibkrBridgeSession.js",
    "./ibkrConnectionCredentialActionModel.js",
    "./ibkrConnectionInsightModel.js",
    "./ibkrConnectionOperationStepperModel.js",
    "./ibkrConnectionSnapshot.js",
    "./ibkrLoginHandoffErrorModel.js",
    "./ibkrPopoverModel.js",
  ];

  for (const filename of retiredModules) {
    assert.equal(existsSync(new URL(filename, import.meta.url)), false, filename);
  }
});

test("IBKR connection presentation names only the Client Portal path", () => {
  const runtimeModel = readLocalSource("./clientPortalRuntimeModel.js");
  const statusModel = readLocalSource("./IbkrConnectionStatus.jsx");
  const platformApp = readLocalSource("./PlatformApp.jsx");
  const algoScreen = readLocalSource("../../screens/AlgoScreen.jsx");
  const diagnosticsScreen = readLocalSource("../../screens/DiagnosticsScreen.jsx");
  const source = `${runtimeModel}\n${statusModel}\n${platformApp}\n${algoScreen}\n${diagnosticsScreen}`;

  assert.doesNotMatch(source, /desktopAgent|runtimeOverride/);
  assert.doesNotMatch(source, /ibkrBridge|bridgeRuntimeModel/);
  assert.doesNotMatch(source, /Windows desktop helper/i);
  assert.doesNotMatch(source, /(?:Bridge|Gateway) tunnel/i);
  assert.doesNotMatch(source, /Legacy Broker Runtime|Bridge URL|Bridge token/i);
  assert.match(platformApp, /useGetIbkrPortalReadiness/);
  assert.match(platformApp, /resolveClientPortalTradingReadiness/);
  assert.match(source, /Client Portal/);
});

test("header status cluster renders the account session control", () => {
  const source = readLocalSource("./HeaderStatusCluster.jsx");

  assert.match(source, /HeaderSessionStatus/);
  assert.match(
    source,
    /<HeaderSessionStatus[\s\S]*surfaceStyle=\{surfaceStyle\}/,
  );
});

test("header trust surfaces precede clock and theme decoration without retired broker toasts", () => {
  const source = readLocalSource("./HeaderStatusCluster.jsx");
  const renderStart = source.lastIndexOf("return (");
  const renderSource = source.slice(renderStart);

  assert.ok(
    renderSource.indexOf("<HeaderSessionStatus") <
      renderSource.indexOf("<HeaderSnapTradeBrokerStatus"),
  );
  assert.ok(
    renderSource.indexOf("<HeaderSnapTradeBrokerStatus") <
      renderSource.indexOf("<HeaderMarketClock"),
  );
  assert.ok(
    renderSource.indexOf("<HeaderMarketClock") <
      renderSource.indexOf("onToggleTheme"),
  );
  assert.doesNotMatch(source, /useToast/);
  assert.doesNotMatch(source, /IBKR broker (?:connected|disconnected)/);
});

test("header session control uses the documented auth endpoints", () => {
  const source = readLocalSource("./HeaderSessionStatus.jsx");

  assert.match(source, /\/api\/auth\/login/);
  assert.match(source, /\/api\/auth\/bootstrap/);
  assert.match(source, /\/api\/auth\/logout/);
  assert.match(source, /x-csrf-token/);
  assert.match(source, /authSession\.adoptSession\(session\)/);
  assert.match(source, /"current-password"/);
  assert.match(source, /"new-password"/);
  assert.doesNotMatch(source, /console\.(log|warn|error)/);
});

test("SnapTrade header broker control reads readiness fields that exist in the API schema", () => {
  const source = readLocalSource("./HeaderSnapTradeBrokerStatus.jsx");

  assert.match(source, /readiness\?\.configured === true/);
  assert.doesNotMatch(source, /readiness\?\.credentials\?\.configured/);
});

test("SnapTrade header broker control uses the documented connection portal flow", () => {
  const source = readLocalSource("./HeaderSnapTradeBrokerStatus.jsx");

  assert.match(source, /useRegisterSnapTradeCurrentUser/);
  assert.match(source, /useGenerateSnapTradeConnectionPortal/);
  assert.match(source, /useSyncSnapTradeBrokerageConnections/);
  assert.match(source, /buildSnapTradeConnectionPortalBody\(selectedBroker\)/);
  assert.match(source, /portal\.redirectUri/);
  assert.match(source, /writeSnapTradeExecutionAccountState/);
  assert.doesNotMatch(source, /IB Gateway/);
  assert.doesNotMatch(source, /Bridge URL/);
  assert.doesNotMatch(source, /IBKR username/);
  assert.doesNotMatch(source, /IBKR password/);
  assert.doesNotMatch(source, /Launch with credentials/);
});

test("header icon-only popover controls expose explicit accessible names", () => {
  const sessionSource = readLocalSource("./HeaderSessionStatus.jsx");
  const brokerSource = readLocalSource("./HeaderSnapTradeBrokerStatus.jsx");

  assert.match(
    readButtonOpeningTag(sessionSource, "onClick={() => setOpen(false)}"),
    /aria-label="Close account session"/,
  );
  assert.match(
    readButtonOpeningTag(brokerSource, "onClick={refresh}"),
    /aria-label="Refresh broker connection"/,
  );
  assert.match(
    readButtonOpeningTag(brokerSource, "onClick={() => setOpen(false)}"),
    /aria-label="Close broker connection"/,
  );
});

test("header popovers leave modal focus semantics to the Radix BottomSheet", () => {
  const sessionSource = readLocalSource("./HeaderSessionStatus.jsx");
  const brokerSource = readLocalSource("./HeaderSnapTradeBrokerStatus.jsx");
  const bottomSheetSource = readLocalSource(
    "../../components/platform/BottomSheet.jsx",
  );

  assert.doesNotMatch(sessionSource, /\baria-modal\b/);
  assert.doesNotMatch(brokerSource, /\baria-modal\b/);
  assert.doesNotMatch(sessionSource, /event\.key === "Tab"/);
  assert.doesNotMatch(brokerSource, /event\.key === "Tab"/);
  assert.match(bottomSheetSource, /import \{ Dialog \} from "radix-ui"/);
  assert.match(bottomSheetSource, /<Dialog\.Content/);
  assert.match(bottomSheetSource, /onOpenAutoFocus=/);
  assert.match(bottomSheetSource, /onCloseAutoFocus=/);
});
