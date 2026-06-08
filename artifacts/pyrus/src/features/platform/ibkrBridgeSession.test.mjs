import assert from "node:assert/strict";
import test, { after } from "node:test";

import { shouldUseRemoteIbkrLaunchBrowser } from "./ibkrBridgeSession.js";

const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  "navigator",
);

after(() => {
  if (originalNavigatorDescriptor) {
    Object.defineProperty(globalThis, "navigator", originalNavigatorDescriptor);
  } else {
    delete globalThis.navigator;
  }
});

function setNavigatorPlatform(platform) {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      platform,
      userAgent: platform.includes("Win") ? "Mozilla/5.0 Windows" : "Mozilla/5.0",
      userAgentData: { platform },
    },
  });
}

test("Windows browsers use direct protocol when no desktop agent is online", () => {
  setNavigatorPlatform("Win32");

  assert.equal(
    shouldUseRemoteIbkrLaunchBrowser({
      desktopAgentOnline: false,
    }),
    false,
  );
});

test("Windows browsers still use direct protocol when the paired desktop is stale", () => {
  setNavigatorPlatform("Win32");

  assert.equal(
    shouldUseRemoteIbkrLaunchBrowser({
      desktopAgentOnline: false,
      desktopAgentRegistered: true,
    }),
    false,
  );
});

test("Windows browsers queue remote launch when the paired desktop agent is online", () => {
  setNavigatorPlatform("Win32");

  assert.equal(
    shouldUseRemoteIbkrLaunchBrowser({
      desktopAgentOnline: true,
      desktopAgentRegistered: true,
    }),
    true,
  );
});

test("non-Windows browsers use remote launch", () => {
  setNavigatorPlatform("MacIntel");

  assert.equal(
    shouldUseRemoteIbkrLaunchBrowser({
      desktopAgentOnline: false,
      desktopAgentRegistered: false,
    }),
    true,
  );
});
