import assert from "node:assert/strict";
import test from "node:test";

import * as brokerPopup from "./brokerPopup.js";

const { openBrokerPopup } = brokerPopup;

function withWindow(value, callback) {
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    writable: true,
    value,
  });
  try {
    return callback();
  } finally {
    if (original) {
      Object.defineProperty(globalThis, "window", original);
    } else {
      delete globalThis.window;
    }
  }
}

test("broker popup is isolated before it navigates and retains the parent proxy", () => {
  const events = [];
  let opener = {};
  const popup = {
    get opener() {
      events.push("read opener");
      return opener;
    },
    set opener(value) {
      events.push(["set opener", value]);
      opener = value;
    },
    location: {
      replace(url) {
        events.push(["navigate", url, opener]);
      },
    },
    close() {
      events.push("close");
    },
  };

  const result = withWindow(
    {
      screenLeft: 100,
      screenTop: 50,
      outerWidth: 1280,
      outerHeight: 900,
      open(url, target, features) {
        events.push(["open", url, target, features]);
        return popup;
      },
    },
    () =>
      openBrokerPopup(
        "https://broker.example/oauth",
        "robinhood-oauth",
      ),
  );

  assert.equal(result, popup);
  assert.deepEqual(events, [
    [
      "open",
      "",
      "_blank",
      "popup=yes,width=480,height=760,left=500,top=120",
    ],
    ["set opener", null],
    "read opener",
    ["navigate", "https://broker.example/oauth", null],
  ]);
});

test("broker popup returns null when the browser blocks it", () => {
  const result = withWindow(
    {
      screenLeft: 0,
      screenTop: 0,
      outerWidth: 480,
      outerHeight: 760,
      open() {
        return null;
      },
    },
    () => openBrokerPopup("https://broker.example/oauth", "schwab-oauth"),
  );

  assert.equal(result, null);
});

test("broker popup closes without navigating when opener isolation cannot be verified", () => {
  let closeCalled = false;
  let navigateCalled = false;
  const retainedOpener = {};
  const popup = {
    get opener() {
      return retainedOpener;
    },
    set opener(_value) {},
    location: {
      replace() {
        navigateCalled = true;
      },
    },
    close() {
      closeCalled = true;
    },
  };

  const result = withWindow(
    {
      screenLeft: 0,
      screenTop: 0,
      outerWidth: 480,
      outerHeight: 760,
      open() {
        return popup;
      },
    },
    () => openBrokerPopup("https://broker.example/oauth", "snaptrade-portal"),
  );

  assert.equal(result, null);
  assert.equal(navigateCalled, false);
  assert.equal(closeCalled, true);
});

test("broker popup closes best-effort when remote navigation fails", () => {
  let opener = {};
  let closeAttempts = 0;
  const popup = {
    get opener() {
      return opener;
    },
    set opener(value) {
      opener = value;
    },
    location: {
      replace() {
        throw new Error("navigation failed");
      },
    },
    close() {
      closeAttempts += 1;
      throw new Error("close failed");
    },
  };

  const result = withWindow(
    {
      screenLeft: 0,
      screenTop: 0,
      outerWidth: 480,
      outerHeight: 760,
      open() {
        return popup;
      },
    },
    () => openBrokerPopup("https://broker.example/oauth", "snaptrade-portal"),
  );

  assert.equal(result, null);
  assert.equal(closeAttempts, 1);
});

test("broker popup helper owns the complete popup watcher lifecycle", () => {
  assert.equal(typeof brokerPopup.watchBrokerPopup, "function");
});

test("broker popup watcher closes an expired popup before releasing its flow", () => {
  let tick;
  let cleared = null;
  let closeCalls = 0;
  let onCloseCalls = 0;
  const pollRef = { current: null };

  withWindow(
    {
      location: { origin: "https://pyrus.example" },
      setInterval(callback) {
        tick = callback;
        return 17;
      },
      clearInterval(id) {
        cleared = id;
      },
    },
    () => {
      brokerPopup.watchBrokerPopup({
        popup: {
          closed: false,
          close() {
            closeCalls += 1;
          },
        },
        pollRef,
        timeoutMs: -1,
        onClose() {
          onCloseCalls += 1;
        },
      });
      tick();
    },
  );

  assert.equal(cleared, 17);
  assert.equal(pollRef.current, null);
  assert.equal(closeCalls, 1);
  assert.equal(onCloseCalls, 1);
});

test("broker popup watcher accepts only an exact same-origin callback", () => {
  let tick;
  const outcomes = [];
  const location = {
    href: "https://pyrus.example.attacker.invalid/?robinhood=connected",
  };

  withWindow(
    {
      location: { origin: "https://pyrus.example" },
      setInterval(callback) {
        tick = callback;
        return 23;
      },
      clearInterval() {},
    },
    () => {
      brokerPopup.watchBrokerPopup({
        popup: { closed: false, location, close() {} },
        pollRef: { current: null },
        originParamKey: "robinhood",
        onResult(outcome) {
          outcomes.push(outcome);
        },
      });
      tick();
      assert.deepEqual(outcomes, []);

      location.href = "https://pyrus.example/?robinhood=connected";
      tick();
    },
  );

  assert.deepEqual(outcomes, ["connected"]);
});
