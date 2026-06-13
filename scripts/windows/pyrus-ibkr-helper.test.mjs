import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const helperPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "pyrus-ibkr-helper.ps1",
);
const helperSource = readFileSync(helperPath, "utf8");

const sectionBetween = (start, end) => {
  const startIndex = helperSource.indexOf(start);
  assert.notEqual(startIndex, -1, `missing ${start}`);
  const endIndex = helperSource.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `missing ${end}`);
  return helperSource.slice(startIndex, endIndex);
};

test("desktop agent launch claim does not long-poll", () => {
  const claimJob = sectionBetween(
    "function Claim-DesktopAgentLaunchJob",
    "function Complete-DesktopAgentJob",
  );

  assert.doesNotMatch(claimJob, /waitMs\s*=/);
  assert.match(claimJob, /\/api\/ibkr\/desktop\/jobs\/claim/);
  assert.match(claimJob, /-TimeoutSec\s+5\b/);
});

test("remote desktop launch runs off the claim loop in a separate process", () => {
  const launchProcess = sectionBetween(
    "function Start-BridgeLaunchProcess",
    "function Test-DesktopAgentProcessRunning",
  );

  // The launch must NOT run inline on the agent claim loop — that blocked the loop
  // for the whole launch, so a cancel/shutdown job could not be claimed mid-launch
  // and heartbeats were missed. It is spawned as a separate process instead.
  assert.match(launchProcess, /Start-Process/);
  assert.match(launchProcess, /'-LaunchUrl', \$LaunchUrl/);
  assert.doesNotMatch(launchProcess, /Invoke-BridgeLaunch\s+-RawLaunchUrl\s+\$LaunchUrl/);
  // The spawned child still reports launch failures via the script top-level catch.
  assert.match(helperSource, /function Invoke-BridgeLaunch\(\[string\]\$RawLaunchUrl\)/);
  assert.match(helperSource, /Send-BridgeProgress\s+-Status\s+'error'\s+-Step\s+'error'/);
});

test("desktop agent claims before heartbeat so queued jobs are not delayed", () => {
  const loop = sectionBetween(
    "Register once up front",
    "Start-Sleep -Seconds $sleepSeconds",
  );
  const claimIdx = loop.indexOf("Claim-DesktopAgentLaunchJob");
  const heartbeatIdx = loop.indexOf("Send-DesktopAgentHeartbeat");
  assert.notEqual(claimIdx, -1, "claim present in loop");
  assert.notEqual(heartbeatIdx, -1, "heartbeat present in loop");
  assert.ok(
    claimIdx < heartbeatIdx,
    "claim must run before heartbeat so a freshly queued job is picked up immediately",
  );
});

test("gateway process start immediately enters window detection", () => {
  const credentialTyping = sectionBetween(
    "function Invoke-IBGatewayCredentialTyping",
    "function Start-IBGatewayWithIbc",
  );
  const processStartedIndex = credentialTyping.indexOf("gateway_process_started");
  assert.notEqual(processStartedIndex, -1);
  const afterProcessStarted = credentialTyping.slice(processStartedIndex, processStartedIndex + 360);

  assert.doesNotMatch(afterProcessStarted, /Start-Sleep/);
  assert.match(afterProcessStarted, /Assert-ActivationNotCanceled/);
});
