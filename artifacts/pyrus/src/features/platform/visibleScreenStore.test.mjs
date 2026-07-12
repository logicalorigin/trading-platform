import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React, { act, useLayoutEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import {
  createVisibleScreenStore,
  useVisibleScreenNavigation,
} from "./visibleScreenStore.js";

const visibleScreenStoreSource = readFileSync(
  new URL("./visibleScreenStore.js", import.meta.url),
  "utf8",
);

test("post-paint canonical handoff cannot remain transition-starved", () => {
  assert.doesNotMatch(visibleScreenStoreSource, /startTransition/);
  assert.match(
    visibleScreenStoreSource,
    /const commit = \(\) => \{[\s\S]*?setScreen\(screenId\);[\s\S]*?\};/,
  );
});

test("visible-screen store publishes only real screen changes", () => {
  const store = createVisibleScreenStore("market");
  const snapshots = [];
  const unsubscribe = store.subscribe(() => {
    snapshots.push(store.getSnapshot());
  });

  store.setScreen("market");
  store.setScreen("algo");
  store.setScreen("algo");
  unsubscribe();
  store.setScreen("account");

  assert.equal(store.getSnapshot(), "account");
  assert.deepEqual(snapshots, ["algo"]);
});

test("visible navigation paints before canonical work, coalesces, and resynchronizes", async () => {
  const globalNames = [
    "cancelAnimationFrame",
    "document",
    "HTMLIFrameElement",
    "IS_REACT_ACT_ENVIRONMENT",
    "requestAnimationFrame",
    "window",
  ];
  const previousGlobals = globalNames.map((name) => [
    name,
    Object.getOwnPropertyDescriptor(globalThis, name),
  ]);
  const noop = () => {};
  const document = {
    activeElement: null,
    addEventListener: noop,
    defaultView: globalThis,
    nodeType: 9,
    removeEventListener: noop,
  };
  const container = {
    addEventListener: noop,
    firstChild: null,
    lastChild: null,
    nodeType: 1,
    ownerDocument: document,
    parentNode: null,
    removeEventListener: noop,
    tagName: "DIV",
  };
  document.documentElement = container;
  let nextAnimationFrameId = 1;
  const animationFrames = new Map();
  globalThis.requestAnimationFrame = (callback) => {
    const frameId = nextAnimationFrameId;
    nextAnimationFrameId += 1;
    animationFrames.set(frameId, callback);
    return frameId;
  };
  globalThis.cancelAnimationFrame = (frameId) => {
    animationFrames.delete(frameId);
  };
  globalThis.document = document;
  globalThis.HTMLIFrameElement = class {};
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.window = globalThis;

  const events = [];
  const layoutSnapshots = [];
  const canonicalTasks = [];
  let nextCanonicalTaskId = 1;
  let latest;
  const captureCanonicalTasks = (callback) => {
    const originalSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = (task, delay = 0, ...args) => {
      assert.equal(delay, 0, "canonical handoff must use a zero-delay task");
      const taskId = nextCanonicalTaskId;
      nextCanonicalTaskId += 1;
      canonicalTasks.push({ taskId, run: () => task(...args) });
      return taskId;
    };
    try {
      return callback();
    } finally {
      globalThis.setTimeout = originalSetTimeout;
    }
  };
  const runAnimationFrames = async () => {
    await act(async () => {
      const callbacks = Array.from(animationFrames.values());
      animationFrames.clear();
      captureCanonicalTasks(() =>
        callbacks.forEach((callback) => callback(0)),
      );
    });
  };
  const flushCanonicalTasks = async () => {
    await act(async () => {
      const tasks = canonicalTasks.splice(0);
      tasks.forEach(({ run }) => run());
    });
  };
  const flushCanonicalHandoff = async () => {
    await runAnimationFrames();
    await flushCanonicalTasks();
  };
  function Harness() {
    const [canonicalScreen, setCanonicalScreen] = useState("market");
    const navigation = useVisibleScreenNavigation({
      activeScreen: canonicalScreen,
      markScreenSwitch: (screenId, source) =>
        events.push(`mark:${screenId}:${source}`),
      preloadScreen: (screenId) => events.push(`preload:${screenId}`),
      setScreen: (screenId) => {
        events.push(`canonical:${screenId}`);
        setCanonicalScreen(screenId);
      },
    });
    useLayoutEffect(() => {
      layoutSnapshots.push([
        canonicalScreen,
        navigation.visibleScreenStore.getSnapshot(),
      ]);
    }, [canonicalScreen, navigation.visibleScreenStore]);
    latest = { canonicalScreen, setCanonicalScreen, ...navigation };
    return null;
  }

  const root = createRoot(container);
  let unsubscribe = noop;
  try {
    await act(async () => root.render(React.createElement(Harness)));
    unsubscribe = latest.visibleScreenStore.subscribe(() => {
      events.push(`visible:${latest.visibleScreenStore.getSnapshot()}`);
    });

    events.length = 0;
    await act(async () => {
      latest.handleSetScreen("account");
      latest.handleSetScreen("account");
    });
    assert.deepEqual(events, [
      "preload:account",
      "mark:account:navigation",
      "visible:account",
    ]);
    assert.equal(latest.canonicalScreen, "market");
    await flushCanonicalHandoff();
    assert.deepEqual(events, [
      "preload:account",
      "mark:account:navigation",
      "visible:account",
      "canonical:account",
    ]);
    assert.equal(latest.canonicalScreen, "account");

    events.length = 0;
    layoutSnapshots.length = 0;
    await act(async () => latest.setCanonicalScreen("research"));
    assert.deepEqual(events, [
      "visible:research",
      "mark:research:programmatic",
    ]);
    assert.deepEqual(layoutSnapshots, [["research", "research"]]);

    events.length = 0;
    await act(async () => {
      latest.handleSetScreen("account");
      latest.handleSetScreen("research");
      latest.handleSetScreen("algo");
    });
    assert.deepEqual(
      events.filter((event) => /^(visible|canonical):/.test(event)),
      [
        "visible:account",
        "visible:research",
        "visible:algo",
      ],
    );
    assert.equal(latest.visibleScreenStore.getSnapshot(), "algo");
    assert.equal(latest.canonicalScreen, "research");
    await flushCanonicalHandoff();
    assert.deepEqual(
      events.filter((event) => /^(visible|canonical):/.test(event)),
      [
        "visible:account",
        "visible:research",
        "visible:algo",
        "canonical:algo",
      ],
    );
    assert.equal(latest.canonicalScreen, "algo");

    events.length = 0;
    await act(async () => latest.handleSetScreen("account"));
    await runAnimationFrames();
    await act(async () => latest.setCanonicalScreen("trade"));
    assert.deepEqual(events, [
      "preload:account",
      "mark:account:navigation",
      "visible:account",
      "visible:trade",
      "mark:trade:programmatic",
    ]);
    await flushCanonicalTasks();
    assert.equal(latest.canonicalScreen, "trade");
    assert.equal(latest.visibleScreenStore.getSnapshot(), "trade");
    assert.doesNotMatch(events.join("\n"), /canonical:account/);

    document.visibilityState = "hidden";
    events.length = 0;
    await act(async () => {
      captureCanonicalTasks(() => {
        latest.handleSetScreen("account");
        latest.handleSetScreen("algo");
      });
    });
    assert.deepEqual(
      events.filter((event) => /^(visible|canonical):/.test(event)),
      ["visible:account", "visible:algo"],
    );
    assert.equal(latest.canonicalScreen, "trade");
    await flushCanonicalTasks();
    assert.deepEqual(
      events.filter((event) => /^(visible|canonical):/.test(event)),
      ["visible:account", "visible:algo", "canonical:algo"],
    );
    assert.equal(latest.canonicalScreen, "algo");
  } finally {
    unsubscribe();
    await act(async () => root.unmount());
    previousGlobals.forEach(([name, descriptor]) => {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    });
  }
});
