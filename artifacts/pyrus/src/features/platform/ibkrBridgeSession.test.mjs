import assert from "node:assert/strict";
import test, { after } from "node:test";

import {
  closeIbkrProtocolLauncher,
  navigateIbkrProtocolLauncher,
  openIbkrProtocolLauncher,
  shouldUseRemoteIbkrLaunchBrowser,
} from "./ibkrBridgeSession.js";

const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  "navigator",
);
const originalWindowDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  "window",
);

after(() => {
  if (originalNavigatorDescriptor) {
    Object.defineProperty(globalThis, "navigator", originalNavigatorDescriptor);
  } else {
    delete globalThis.navigator;
  }
  if (originalWindowDescriptor) {
    Object.defineProperty(globalThis, "window", originalWindowDescriptor);
  } else {
    delete globalThis.window;
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

function installFakeWindow() {
  const appended = [];
  const timers = [];
  const parent = {
    appendChild(node) {
      appended.push(node);
      node.parentNode = parent;
      return node;
    },
  };
  const document = {
    body: parent,
    documentElement: parent,
    createElement(tagName) {
      return {
        attributes: {},
        removed: false,
        src: "",
        style: {},
        tagName: String(tagName).toUpperCase(),
        remove() {
          this.removed = true;
        },
        setAttribute(name, value) {
          this.attributes[name] = value;
        },
      };
    },
  };
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      document,
      location: {
        assign() {
          throw new Error("main page navigation should not be used");
        },
      },
      setTimeout(callback, delay) {
        timers.push({ callback, delay });
        return timers.length;
      },
    },
  });
  return { appended, timers };
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

test("Windows browsers use direct protocol when the paired desktop agent needs an update", () => {
  setNavigatorPlatform("Win32");

  assert.equal(
    shouldUseRemoteIbkrLaunchBrowser({
      desktopAgentCompatible: false,
      desktopAgentOnline: true,
      desktopAgentRegistered: true,
      desktopAgentUpgradeRequired: true,
    }),
    false,
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

test("direct protocol launch uses an iframe so credential delivery can continue", () => {
  const { appended, timers } = installFakeWindow();
  const launcher = openIbkrProtocolLauncher();

  assert.equal(appended.length, 1);
  assert.equal(launcher.tagName, "IFRAME");
  assert.equal(launcher.attributes["aria-hidden"], "true");

  const launched = navigateIbkrProtocolLauncher(
    launcher,
    "pyrus-ibkr://launch?activationId=test",
  );

  assert.equal(launched, true);
  assert.equal(launcher.src, "pyrus-ibkr://launch?activationId=test");
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, 5_000);

  timers[0].callback();
  assert.equal(launcher.removed, true);
});

test("direct protocol launch rejects non-Pyrus URLs and cleans up the iframe", () => {
  installFakeWindow();
  const launcher = openIbkrProtocolLauncher();

  assert.equal(navigateIbkrProtocolLauncher(launcher, "https://example.test"), false);
  assert.equal(launcher.removed, true);

  closeIbkrProtocolLauncher(launcher);
});
