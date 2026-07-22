import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, test } from "node:test";

import {
  __resetDiagnosticsStreamForTests,
  subscribeDiagnosticsStream,
} from "./diagnosticsStream.js";

const originalWindow = globalThis.window;

afterEach(() => {
  __resetDiagnosticsStreamForTests();
  if (originalWindow === undefined) {
    delete globalThis.window;
  } else {
    globalThis.window = originalWindow;
  }
});

test("diagnostics subscribers share one EventSource and replay its latest snapshot", () => {
  const sources = [];
  class FakeEventSource {
    listeners = new Map();
    closed = false;

    constructor(url) {
      this.url = url;
      sources.push(this);
    }

    addEventListener(type, listener) {
      this.listeners.set(type, listener);
    }

    emit(type, payload) {
      this.listeners.get(type)?.({ data: JSON.stringify(payload) });
    }

    fail() {
      this.onerror?.();
    }

    close() {
      this.closed = true;
    }
  }
  globalThis.window = { EventSource: FakeEventSource };

  const firstMessages = [];
  const unsubscribeFirst = subscribeDiagnosticsStream((message) => {
    firstMessages.push(message);
  });
  assert.equal(sources.length, 1);
  assert.equal(sources[0].url, "/api/diagnostics/stream");

  sources[0].emit("ready", { at: "2026-07-16T00:00:00.000Z" });
  sources[0].emit("snapshot", { timestamp: "snapshot-1" });

  const secondMessages = [];
  const unsubscribeSecond = subscribeDiagnosticsStream((message) => {
    secondMessages.push(message);
  });

  assert.equal(sources.length, 1, "subscribers must share one transport");
  assert.deepEqual(
    secondMessages,
    [
      { type: "ready", payload: { at: "2026-07-16T00:00:00.000Z" } },
      { type: "snapshot", payload: { timestamp: "snapshot-1" } },
    ],
    "a late subscriber must receive the authoritative cached snapshot",
  );
  let unsubscribeThrowingSubscriber;
  assert.doesNotThrow(() => {
    unsubscribeThrowingSubscriber = subscribeDiagnosticsStream(() => {
      throw new Error("consumer failed");
    });
  }, "one consumer must not break the shared transport");
  unsubscribeThrowingSubscriber();

  unsubscribeFirst();
  assert.equal(sources[0].closed, false);
  unsubscribeSecond();
  assert.equal(sources[0].closed, true, "the last subscriber closes the stream");
  assert.deepEqual(firstMessages, secondMessages);
});

test("a failed diagnostics connection never replays stale readiness to late subscribers", () => {
  const sources = [];
  class FakeEventSource {
    listeners = new Map();
    constructor() {
      sources.push(this);
    }
    addEventListener(type, listener) {
      this.listeners.set(type, listener);
    }
    emit(type, payload) {
      this.listeners.get(type)?.({ data: JSON.stringify(payload) });
    }
    close() {}
    fail() {
      this.onerror?.();
    }
  }
  globalThis.window = { EventSource: FakeEventSource };

  const first = [];
  const unsubscribeFirst = subscribeDiagnosticsStream((message) => first.push(message));
  sources[0].emit("ready", { at: "old-ready" });
  sources[0].emit("snapshot", { timestamp: "old-snapshot" });
  sources[0].fail();

  const late = [];
  const unsubscribeLate = subscribeDiagnosticsStream((message) => late.push(message));
  assert.deepEqual(late, [], "connection loss must invalidate cached stream state");
  assert.equal(first.at(-1)?.type, "error");

  unsubscribeLate();
  unsubscribeFirst();
});

test("diagnostics consumers use the shared stream transport", () => {
  const monitorSource = readFileSync(
    new URL("./useMemoryPressureSignal.js", import.meta.url),
    "utf8",
  );
  const screenSource = readFileSync(
    new URL("../../screens/DiagnosticsScreen.jsx", import.meta.url),
    "utf8",
  );

  for (const source of [monitorSource, screenSource]) {
    assert.match(source, /subscribeDiagnosticsStream/);
    assert.doesNotMatch(source, /new (?:window\.)?EventSource\(/);
  }
});

test("the always-on memory monitor opens admin diagnostics only for admins", () => {
  const monitorSource = readFileSync(
    new URL("./useMemoryPressureSignal.js", import.meta.url),
    "utf8",
  );
  const appSource = readFileSync(
    new URL("./PlatformApp.jsx", import.meta.url),
    "utf8",
  );

  assert.match(
    monitorSource,
    /useMemoryPressureMonitor = \(\{\s*serverDiagnosticsEnabled = false,?\s*\} = \{\}\)/,
  );
  assert.match(
    monitorSource,
    /if \(\s*!serverDiagnosticsEnabled \|\|\s*safeQaMode/,
  );
  assert.match(
    monitorSource,
    /const streamDiagnosticsAvailable =\s*serverDiagnosticsEnabled &&/,
  );
  assert.match(
    appSource,
    /useMemoryPressureMonitor\(\{\s*serverDiagnosticsEnabled: authSession\.isAdmin,?\s*\}\)/,
  );
});
