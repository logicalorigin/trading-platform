import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readLocalSource = (filename) =>
  readFileSync(new URL(filename, import.meta.url), "utf8");

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
});

test("retired bridge submit/deactivate paths clear local UI state without backend bridge calls", () => {
  const source = readLocalSource("./HeaderStatusCluster.jsx");

  assert.match(source, /legacy IBKR desktop bridge has been retired/i);
  assert.match(source, /clearBridgeLaunchSessionState\(\)/);
  assert.match(source, /clearIbkrBridgeSessionValues\(\)/);
  assert.doesNotMatch(source, /openIbkrProtocolLauncher\(/);
  assert.doesNotMatch(source, /navigateIbkrProtocolLauncher\(/);
  assert.doesNotMatch(source, /closeIbkrProtocolLauncher\(/);
});

test("header status cluster renders the account session control", () => {
  const source = readLocalSource("./HeaderStatusCluster.jsx");

  assert.match(source, /HeaderSessionStatus/);
  assert.match(
    source,
    /<HeaderSessionStatus[\s\S]*surfaceStyle=\{surfaceStyle\}/,
  );
});

test("header session control uses the documented auth endpoints", () => {
  const source = readLocalSource("./HeaderSessionStatus.jsx");

  assert.match(source, /\/api\/auth\/login/);
  assert.match(source, /\/api\/auth\/bootstrap/);
  assert.match(source, /\/api\/auth\/logout/);
  assert.match(source, /x-csrf-token/);
  assert.match(source, /invalidateQueries\(/);
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
