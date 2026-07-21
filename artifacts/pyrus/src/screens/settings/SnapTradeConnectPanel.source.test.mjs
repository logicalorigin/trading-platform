import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readLocalSource = (filename) =>
  readFileSync(new URL(filename, import.meta.url), "utf8");

test("Settings Data & Broker tab uses the SnapTrade connect panel", () => {
  const source = readLocalSource("../SettingsScreen.jsx");

  assert.match(source, /from "\.\/settings\/SnapTradeConnectPanel\.jsx";/);
  assert.match(
    source,
    /<SnapTradeConnectPanel\s+enabled=\{dataBrokerTabActive\}/,
  );

  const dataBrokerBlock =
    /activeTab === "Data & Broker"[\s\S]*?\)\}/.exec(source)?.[0] ?? "";
  assert.doesNotMatch(dataBrokerBlock, /<IbkrLaneArchitecturePanel/);
});

test("SnapTrade connect panel uses user connection authority and trade-if-available", () => {
  const source = readLocalSource("./SnapTradeConnectPanel.jsx");
  const ibkrModelSource = readLocalSource("./ibkrPortalConnectModel.js");

  assert.match(source, /canManageSnapTradeConnections\(authSession\)/);
  assert.doesNotMatch(
    ibkrModelSource,
    /canManageIbkrPortalConnections|role\s*===/,
  );
  // Connect is card-native: launchPortal takes the card's brokerage slug
  // (defaulting to the selected one) and builds the portal body from it.
  assert.match(
    source,
    /launchPortal = async \(targetBroker = selectedBroker\)/,
  );
  assert.match(source, /buildSnapTradeConnectionPortalBody\(targetBroker\)/);
  assert.match(source, /readiness\?\.clientInfo\?\.reachable === true/);
  assert.match(source, /readiness\?\.configured === true/);
  assert.doesNotMatch(source, /readiness\?\.credentials\?\.configured/);
  assert.match(source, /useSyncSnapTradeBrokerageConnections/);
  assert.match(source, /useGetSnapTradeAccountPortfolio/);
  assert.match(source, /useListSnapTradeBrokerages/);
  assert.match(
    source,
    /buildSnapTradeBrokerChoices\(brokeragesQuery\.data\?\.brokerages\)/,
  );
  assert.match(source, /writeSnapTradeExecutionAccountState/);
  assert.match(source, /getListAccountsQueryKey/);
  assert.match(source, /executionReady === true/);
  assert.match(source, /executionBlockers/);
  assert.match(source, /label="Selected execution"/);
  assert.match(
    source,
    /openBrokerPopup\(portal\.redirectUri, "snaptrade-portal"\)/,
  );
  assert.match(
    source,
    /showConnectHandoff\(\{\s*brokerKey: targetBroker,[\s\S]*url: portal\.redirectUri,[\s\S]*expiresAt: portal\.expiresAt,/,
  );
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

test("broker cards use a group with one native selection control and sibling actions", () => {
  const source = readLocalSource("./SnapTradeConnectPanel.jsx");
  const cardBlock =
    /function BrokerChoiceButton[\s\S]*?\n}\n\nexport function SnapTradeConnectPanel/.exec(
      source,
    )?.[0] ?? "";

  assert.match(cardBlock, /role="group"/);
  assert.match(
    cardBlock,
    /<button[\s\S]*?type="button"[\s\S]*?aria-pressed=\{selected\}/,
  );
  assert.doesNotMatch(cardBlock, /role="button"/);
  assert.ok(
    cardBlock.indexOf("</button>") < cardBlock.indexOf("{actions.length"),
  );
});

test("broker lifecycle motion honors both reduced-motion channels", () => {
  const appSource = readLocalSource(
    "../../features/platform/PlatformApp.jsx",
  );

  assert.match(
    appSource,
    /@media \(prefers-reduced-motion: reduce\)\{\[data-broker-ring\]/,
  );
  assert.match(
    appSource,
    /html\[data-pyrus-reduced-motion="on"\]\s+\[data-broker-ring\]/,
  );
});

test("SnapTrade connect panel exposes copy-link and QR handoff for broker launches", () => {
  const source = readLocalSource("./SnapTradeConnectPanel.jsx");

  assert.match(source, /buildBrokerConnectQrDataUri/);
  assert.match(source, /copyBrokerConnectLaunchUrl\(connectHandoff\.url\)/);
  assert.match(source, /copyStatus === "copied" \? "Copied" : "Copy link"/);
  assert.match(source, /broker connect QR code/);
  assert.match(source, /On a phone or when popups are\s+blocked/);
  assert.match(source, />\s*Open login\s*</);

  assert.match(
    source,
    /url: start\.authorizationUrl,[\s\S]*expiresAt: start\.expiresAt,/,
  );
  assert.match(
    source,
    /brokerKey: ROBINHOOD_BROKER_CHOICE\.value,[\s\S]*url: start\.authorizationUrl,/,
  );
  assert.match(
    source,
    /brokerKey: SCHWAB_BROKER_CHOICE\.value,[\s\S]*url: start\.authorizationUrl,/,
  );
  assert.doesNotMatch(
    source,
    /brokerKey: IBKR_PORTAL_BROKER_CHOICE\.value,[\s\S]*url: loginPath,/,
  );
  assert.match(source, /clearConnectHandoff\(ROBINHOOD_BROKER_CHOICE\.value\)/);
  assert.match(source, /clearConnectHandoff\(SCHWAB_BROKER_CHOICE\.value\)/);
  assert.match(
    source,
    /clearConnectHandoff\(IBKR_PORTAL_BROKER_CHOICE\.value\)/,
  );
});

test("IBKR keeps the capsule-local login inside a persistent sandboxed modal", () => {
  const source = readLocalSource("./SnapTradeConnectPanel.jsx");
  const styles = readLocalSource("../../index.css");
  const viteSource = readLocalSource("../../../vite.config.ts");
  const dialogBlock =
    /function IbkrPortalProgress[\s\S]*?\n}\n\n\/\/ Watches a broker auth popup/.exec(
      source,
    )?.[0] ?? "";
  const connectBlock =
    /const connectIbkrPortal = async \(\) => \{[\s\S]*?\n  \};/.exec(
      source,
    )?.[0] ?? "";

  assert.match(
    source,
    /function IbkrPortalLoginDialog\(\{[\s\S]*?open[\s\S]*?readiness[\s\S]*?returnFocusRef[\s\S]*?\}\)/,
  );
  assert.match(dialogBlock, /const dialogRef = useRef\(null\)/);
  assert.match(dialogBlock, /const wasOpenRef = useRef\(false\)/);
  assert.match(dialogBlock, /<dialog/);
  assert.match(dialogBlock, /className="ibkr-portal-dialog"/);
  assert.match(dialogBlock, /ref=\{dialogRef\}/);
  assert.match(dialogBlock, /aria-labelledby="ibkr-portal-login-title"/);
  assert.match(dialogBlock, /dialog\.showModal\(\)/);
  assert.match(dialogBlock, /dialog\.close\(\)/);
  assert.match(
    dialogBlock,
    /onCancel=\{\(event\) => \{\s*event\.preventDefault\(\);\s*onClose\(\);/,
  );
  assert.doesNotMatch(dialogBlock, /<Dialog\./);
  assert.doesNotMatch(source, /import \{ Dialog \} from "radix-ui"/);
  assert.match(
    styles,
    /\.ibkr-portal-dialog::backdrop\s*\{\s*background: transparent;/,
  );
  assert.match(source, /<iframe/);
  assert.match(
    source,
    /sandbox="allow-same-origin allow-scripts"/,
  );
  assert.doesNotMatch(source, /sandbox="[^"]*allow-popups/);
  assert.match(source, /const ibkrAttemptRef = useRef\(0\)/);
  assert.match(source, /const ibkrConnectBusyRef = useRef\(false\)/);
  assert.match(source, /const ibkrRestartBusyRef = useRef\(false\)/);
  assert.match(
    source,
    /const \[ibkrStatusUnavailable, setIbkrStatusUnavailable\] = useState\(false\)/,
  );
  assert.match(
    dialogBlock,
    /const showViewer = Boolean\(url && progress\.showLoginViewer\)/,
  );
  assert.match(dialogBlock, /buildIbkrPortalProgressModel/);
  assert.match(dialogBlock, /role="status"/);
  assert.match(dialogBlock, /aria-live="polite"/);
  assert.doesNotMatch(dialogBlock, /role="alert"/);
  assert.match(dialogBlock, /Connection status unavailable — retrying/);
  assert.match(dialogBlock, /<ol/);
  assert.match(dialogBlock, /aria-current=/);
  assert.match(dialogBlock, /background: cssColorMix\(CSS_COLOR\.bg0, 82\)/);
  assert.match(dialogBlock, /env\(safe-area-inset-top, 0px\)/);
  assert.match(dialogBlock, /env\(safe-area-inset-right, 0px\)/);
  assert.match(dialogBlock, /env\(safe-area-inset-bottom, 0px\)/);
  assert.match(dialogBlock, /env\(safe-area-inset-left, 0px\)/);
  assert.match(dialogBlock, /width: "100%"/);
  assert.match(dialogBlock, /height: showViewer \? "100%" : "auto"/);
  assert.match(dialogBlock, /maxWidth: dim\(showViewer \? 960 : 640\)/);
  assert.match(dialogBlock, /maxHeight: dim\(800\)/);
  assert.match(dialogBlock, /boxShadow: ELEVATION\.lg/);
  assert.match(
    dialogBlock,
    /restoreIbkrPortalFocus\(returnFocusRef\?\.current\)/,
  );
  assert.doesNotMatch(dialogBlock, /onOpenAutoFocus|onCloseAutoFocus|restoreFocusRef/);
  assert.match(dialogBlock, /<h2[\s\S]*?id="ibkr-portal-login-title"/);
  assert.match(source, /import \{ BrokerLogo \} from "\.\.\/\.\.\/components\/brand\/brokerLogos";/);
  assert.match(
    dialogBlock,
    /<BrokerLogo provider="ibkr" size=\{32\} \/>/,
  );
  assert.match(dialogBlock, /aria-label="Hide IBKR Client Portal window"/);
  assert.match(dialogBlock, />\s*Disconnect\s*</);
  assert.match(dialogBlock, /progress\.showVerificationRecovery/);
  assert.match(dialogBlock, /onRestart=\{onRestart\}/);
  assert.doesNotMatch(dialogBlock, /onEscapeKeyDown/);
  assert.doesNotMatch(
    dialogBlock,
    /width: "100dvw"|height: "100dvh"|maxWidth: "none"|transform: "translate/,
  );
  assert.match(source, /ibkrPortalConnectMutation\.isPending/);
  assert.match(
    connectBlock,
    /startIbkrPortalConnectWithRecovery\(\{\s*start: \(\) => ibkrPortalConnectMutation\.mutateAsync\(\),\s*readStatus: getIbkrPortalStatus,\s*\}\)/,
  );
  assert.match(
    connectBlock,
    /loginUrl = new URL\(loginPath, window\.location\.origin\)\.href/,
  );
  assert.match(
    connectBlock,
    /new URL\(loginUrl\)\.origin !== window\.location\.origin/,
  );
  assert.match(connectBlock, /setIbkrLoginUrl\(loginUrl\)/);
  assert.match(connectBlock, /const attempt = \+\+ibkrAttemptRef\.current/);
  assert.match(connectBlock, /attempt !== ibkrAttemptRef\.current/);
  assert.match(
    connectBlock,
    /if \(attempt !== ibkrAttemptRef\.current\) return;/,
  );
  assert.doesNotMatch(
    connectBlock,
    /if \(attempt !== ibkrAttemptRef\.current\) \{[\s\S]*?ibkrPortalDisconnectMutation/,
  );
  assert.match(connectBlock, /window\.setTimeout/);
  assert.match(
    connectBlock,
    /status = await getIbkrPortalStatus\(\);[\s\S]*?\}\s*catch\s*\{[\s\S]*?\n\s*\}\n\s*if \(attempt !== ibkrAttemptRef\.current\) return;/,
  );
  assert.match(
    connectBlock,
    /status = await getIbkrPortalStatus\(\);\s*\} catch \{\s*if \(attempt === ibkrAttemptRef\.current\) \{\s*setIbkrStatusUnavailable\(true\);\s*ibkrPollRef\.current = window\.setTimeout\(poll, 3000\);/,
  );
  assert.match(
    connectBlock,
    /if \(attempt !== ibkrAttemptRef\.current\) return;\s*setIbkrStatusUnavailable\(false\);\s*queryClient\.setQueryData/,
  );
  assert.match(
    connectBlock,
    /hasIbkrPortalLoginTimedOut\(startedAt, Date\.now\(\)\)/,
  );
  assert.match(connectBlock, /"IBKR connection attempt timed out\."/);
  assert.doesNotMatch(connectBlock, /IBKR Client Portal login timed out/);
  assert.doesNotMatch(
    connectBlock,
    /window\.location\.assign|openBrokerPopup|popup\./,
  );
  const closeBlock =
    /const closeIbkrPortalDialog = \(\) => \{[\s\S]*?\n  \};/.exec(
      source,
    )?.[0] ?? "";
  assert.match(closeBlock, /setIbkrDialogOpen\(false\)/);
  assert.doesNotMatch(closeBlock, /ibkrAttemptRef/);
  assert.doesNotMatch(closeBlock, /setIbkrLoginUrl/);
  assert.doesNotMatch(closeBlock, /stopIbkrPortalPoll/);
  assert.doesNotMatch(closeBlock, /clearConnectHandoff/);
  assert.doesNotMatch(closeBlock, /ibkrPortalDisconnectMutation/);
  const disconnectBlock =
    /const disconnectIbkrPortal = async \([^)]*\) => \{[\s\S]*?\n  \};/.exec(
      source,
    )?.[0] ?? "";
  assert.match(
    disconnectBlock,
    /ibkrPortalDisconnectMutation[\s\S]*?\.mutateAsync\(\)/,
  );
  assert.equal(
    source.match(/ibkrPortalDisconnectMutation[\s\S]{0,120}?\.mutateAsync\(\)/g)
      ?.length,
    1,
  );
  const restartBlock =
    /const restartIbkrPortal = async \(\) => \{[\s\S]*?\n  \};/.exec(source)
      ?.[0] ?? "";
  assert.match(restartBlock, /ibkrRestartBusyRef\.current/);
  assert.match(restartBlock, /await disconnectIbkrPortal\(\)/);
  assert.match(restartBlock, /await connectIbkrPortal\(\)/);
  assert.doesNotMatch(
    connectBlock,
    /hasIbkrPortalLoginTimedOut[\s\S]{0,180}?closeIbkrPortalDialog\(\)/,
  );
  assert.match(viteSource, /"\/api\/broker-execution\/ibkr-portal\/client"/);
  assert.match(
    viteSource,
    /const pathname = url\.split\("\?", 1\)\[0\] \|\| url/,
  );
  assert.match(
    viteSource,
    /req\.headers\["x-forwarded-host"\] = req\.headers\.host/,
  );
  assert.match(
    source,
    /const \[ibkrDialogOpen, setIbkrDialogOpen\] = useState\(false\)/,
  );
  assert.match(
    source,
    /<IbkrPortalLoginDialog[\s\S]*?open=\{ibkrDialogOpen\}[\s\S]*?connecting=\{ibkrConnecting\}[\s\S]*?readiness=\{/,
  );
  assert.match(source, /statusUnavailable=\{ibkrStatusUnavailable\}/);
  assert.match(
    source,
    /isIbkrPortal[\s\S]*?<StatusRow[\s\S]*?label="Trading accounts"/,
  );
  assert.match(
    source,
    /queryClient\.setQueryData\(\s*getGetIbkrPortalReadinessQueryKey\(\),\s*status,\s*\)/,
  );
  assert.doesNotMatch(source, /ibkrPortalPollReadiness/);
  assert.match(
    connectBlock,
    /isTerminalIbkrPortalConnectStatus\(status\)[\s\S]*?setIbkrDialogOpen\(false\)/,
  );
  assert.match(source, /const ibkrReturnFocusRef = useRef\(null\)/);
  assert.match(source, /ref=\{focusRef\}/);
  assert.match(
    source,
    /focusRef=\{[\s\S]*?choice\.value === IBKR_PORTAL_BROKER_CHOICE\.value[\s\S]*?ibkrReturnFocusRef[\s\S]*?undefined[\s\S]*?\}/,
  );
  assert.match(
    source,
    /<IbkrPortalLoginDialog[\s\S]*?returnFocusRef=\{ibkrReturnFocusRef\}/,
  );
  assert.match(
    source,
    /<IbkrPortalLoginDialog[\s\S]*?onRestart=\{\(\) => void restartIbkrPortal\(\)\}/,
  );
  assert.match(
    source,
    /href=\{IBKR_OFFICIAL_CLIENT_PORTAL_URL\}[\s\S]*?target="_blank"[\s\S]*?rel="noreferrer noopener"/,
  );
  assert.match(
    source,
    /href=\{IBKR_OFFICIAL_CLIENT_SERVICES_URL\}[\s\S]*?target="_blank"[\s\S]*?rel="noreferrer noopener"/,
  );
  assert.match(source, /IBKR Client Services/);
  assert.match(
    source,
    /A separate account verification task[\s\S]*?may be\s+one cause/,
  );
  assert.match(source, /log out of IBKR[\s\S]*?Restart connection/);
  assert.match(
    source,
    /never asks for or receives your IBKR password, 2FA code, or\s+verification token/,
  );
  assert.match(source, /const ibkrPortalAttemptActive = Boolean\(/);
  assert.match(source, /label: "View status"/);
  assert.match(source, /setIbkrDialogOpen\(true\)/);
  const activeAttemptActions =
    /if \(ibkrPortalAttemptActive\) \{[\s\S]*?\n      \}/.exec(source)?.[0] ?? "";
  assert.match(activeAttemptActions, /label: "Disconnect"/);
  assert.match(activeAttemptActions, /disconnectIbkrPortal\(\)/);
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
  assert.match(
    memoBlock,
    /connection\.brokerageSlug\.trim\(\)\.toUpperCase\(\)/,
  );

  // The lastSync-derived slugs remain as a freshness overlay (union, not replace).
  assert.match(memoBlock, /of serverBrokerConnections/);
  assert.match(memoBlock, /of syncedConnections/);
  assert.match(memoBlock, /\[serverBrokerConnections, syncedConnections\]/);
});
