import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readLocalSource = (filename) =>
  readFileSync(new URL(filename, import.meta.url), "utf8");

test("header status cluster does not reference an unbound React namespace", () => {
  const source = readLocalSource("./HeaderStatusCluster.jsx");

  assert.doesNotMatch(source, /\bReact\./);
});

test("detach only waits on a Windows desktop shutdown when the gateway is connected", () => {
  // Regression: detaching an already-off bridge must settle immediately. If the
  // remote-shutdown wait is queued unconditionally, the "Desktop" step animates
  // for 35s on a job no desktop will claim, which reads as "stuck detaching".
  const source = readLocalSource("./HeaderStatusCluster.jsx");

  assert.match(
    source,
    /action\.queueRemoteShutdown === true && gatewayConnectedForBridge/,
  );
});

test("every detach/clear request is bounded by the detach timeout so a stalled connection can't hang the control", () => {
  // Regression: the clear-state "Detach bridge" path awaited platformJsonRequest
  // with no timeout (timeoutMs:0 => no AbortController), so a stalled request
  // (e.g. queued behind live SSE streams, or any transport latency) left the
  // detach control animating forever. The bridge/detach call plus both
  // bridgeOverride.clear calls must each pass a bounded timeout.
  const source = readLocalSource("./HeaderStatusCluster.jsx");

  const boundedRequests =
    source.match(/timeoutMs: IBKR_BRIDGE_DETACH_TIMEOUT_MS/g) ?? [];
  assert.ok(
    boundedRequests.length >= 3,
    `expected the 3 detach/clear fetches to be bounded by the constant; found ${boundedRequests.length}`,
  );
});

test("detach timeout is generous and a timeout is treated as proceeding, not a hard failure", () => {
  // The previous 15s budget was too tight: the clear competes with live SSE
  // streams on the event loop, so a slow-but-successful detach was being cut off
  // and surfaced as "Detach failed". The clear is idempotent and the teardown is
  // already underway, so a timeout must fall through to the settle path (the
  // state refresh confirms reality) instead of throwing into the error branch.
  const source = readLocalSource("./HeaderStatusCluster.jsx");

  assert.match(source, /const IBKR_BRIDGE_DETACH_TIMEOUT_MS = 40_000;/);
  // A request_timeout is swallowed into detachTimedOut; any other error rethrows.
  assert.match(
    source,
    /if \(error\?\.code !== "request_timeout"\) \{\s*throw error;\s*\}\s*detachTimedOut = true;/,
  );
  // The user is told the detach is proceeding/verifying, not that it failed.
  assert.match(source, /detach requested; verifying connection state/i);
});

test("update-only broker launch keeps activation visible until helper reports result", () => {
  const source = readLocalSource("./HeaderStatusCluster.jsx");
  const updateOnlyBranch = source.match(
    /if \(!credentialsReady\) \{(?<body>[\s\S]*?)return \{ clearPassword: true \};\n      \}/,
  )?.groups?.body;

  assert.ok(updateOnlyBranch, "expected the update-only launch branch");
  assert.doesNotMatch(updateOnlyBranch, /clearBridgeLaunchSessionState\(\)/);
  assert.match(updateOnlyBranch, /launchResult\.useRemoteDesktopLaunch/);
  assert.match(
    updateOnlyBranch,
    /Helper update request queued for the Windows desktop/,
  );
  assert.match(
    updateOnlyBranch,
    /Waiting for the helper to report the update result/,
  );
});

test("broker launcher request preserves the known-good unbounded launch wait", () => {
  const source = readLocalSource("./HeaderStatusCluster.jsx");
  const launchRequest = source.match(
    /payload = await platformJsonRequest\(\s+useRemoteDesktopLaunch[\s\S]*?signal: requestController\?\.signal,\s+timeoutMs: (?<timeout>\d+),/,
  );

  assert.ok(launchRequest, "expected the broker launcher request");
  assert.equal(launchRequest.groups.timeout, "0");
});

test("credential key wait starts before direct protocol launch can interrupt browser continuation", () => {
  const source = readLocalSource("./HeaderStatusCluster.jsx");

  assert.match(
    source,
    /const IBKR_LOGIN_HANDOFF_REQUEST_WAIT_MS = 25_000;/,
  );
  assert.match(
    source,
    /const pendingCredentialDelivery = startCredentialDelivery\(payload\);[\s\S]*?const launched = useRemoteDesktopLaunch/,
  );
});

test("broker credential form polls DOM values so browser autofill enables launch", () => {
  const source = readLocalSource("./HeaderStatusCluster.jsx");

  assert.match(source, /const IBKR_CREDENTIAL_AUTOFILL_SYNC_MS = 250;/);
  assert.match(
    source,
    /window\.setInterval\(\s+syncCredentialsReady,\s+IBKR_CREDENTIAL_AUTOFILL_SYNC_MS,\s+\)/,
  );
  assert.match(source, /syncCredentialsReady\(\);\s+const syncTimerId/);
});

test("broker launch does not show opening-helper before backend activation exists", () => {
  const source = readLocalSource("./HeaderStatusCluster.jsx");
  const preRequestBlock = source.match(
    /setBridgeLauncherNotice\(\s+initialUseRemoteDesktopLaunch[\s\S]*?const payload = await platformJsonRequest/,
  )?.[0];

  assert.ok(preRequestBlock, "expected launch pre-request block");
  assert.doesNotMatch(preRequestBlock, /appendBridgeActivationProgress/);
  assert.match(
    source,
    /const launched = useRemoteDesktopLaunch[\s\S]*?if \(!launched\)[\s\S]*?setBridgeActivationActive\(true\);[\s\S]*?appendBridgeActivationProgress\({[\s\S]*?step: useRemoteDesktopLaunch/,
  );
});
