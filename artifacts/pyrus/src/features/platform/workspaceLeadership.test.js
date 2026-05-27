import assert from "node:assert/strict";
import test from "node:test";
import { createWorkspaceLeadershipStore } from "./workspaceLeadership.js";

const createMemoryStorage = () => {
  const values = new Map();
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
};

const createDocumentRef = (visibilityState = "visible") => ({
  visibilityState,
  addEventListener() {},
  removeEventListener() {},
});

const createWindowRef = () => ({
  addEventListener() {},
  removeEventListener() {},
  setInterval() {
    return 0;
  },
  clearInterval() {},
});

test("workspace leadership elects one visible leader", () => {
  let nowMs = 1_000;
  const storage = createMemoryStorage();
  const documentRef = createDocumentRef("visible");
  const windowRef = createWindowRef();
  const first = createWorkspaceLeadershipStore({
    instanceId: "first",
    storage,
    documentRef,
    windowRef,
    now: () => nowMs,
  });
  const second = createWorkspaceLeadershipStore({
    instanceId: "second",
    storage,
    documentRef,
    windowRef,
    now: () => nowMs,
  });

  first.start();
  second.start();

  assert.equal(first.getSnapshot().isLeader, true);
  assert.equal(second.getSnapshot().isLeader, false);
  assert.equal(second.getSnapshot().leaderId, "first");

  first.stop();
  nowMs += 10;
  second.evaluateLeadership();

  assert.equal(second.getSnapshot().isLeader, true);
  assert.equal(second.getSnapshot().leaderId, "second");
  second.stop();
});

test("workspace leadership allows takeover after stale heartbeat", () => {
  let nowMs = 1_000;
  const storage = createMemoryStorage();
  const documentRef = createDocumentRef("visible");
  const windowRef = createWindowRef();
  const first = createWorkspaceLeadershipStore({
    instanceId: "first",
    storage,
    documentRef,
    windowRef,
    now: () => nowMs,
    staleMs: 2_000,
  });
  const second = createWorkspaceLeadershipStore({
    instanceId: "second",
    storage,
    documentRef,
    windowRef,
    now: () => nowMs,
    staleMs: 2_000,
  });

  first.start();
  nowMs += 2_001;
  second.start();

  assert.equal(second.getSnapshot().isLeader, true);
  assert.equal(second.getSnapshot().leaderId, "second");

  first.stop();
  second.stop();
});

test("visible workspace takes over hidden standby leader", () => {
  let nowMs = 1_000;
  const storage = createMemoryStorage();
  const hiddenDocument = createDocumentRef("hidden");
  const visibleDocument = createDocumentRef("visible");
  const windowRef = createWindowRef();
  const hidden = createWorkspaceLeadershipStore({
    instanceId: "hidden",
    storage,
    documentRef: hiddenDocument,
    windowRef,
    now: () => nowMs,
  });
  const visible = createWorkspaceLeadershipStore({
    instanceId: "visible",
    storage,
    documentRef: visibleDocument,
    windowRef,
    now: () => nowMs,
  });

  hidden.start();
  assert.equal(hidden.getSnapshot().isLeader, true);
  assert.equal(hidden.getSnapshot().visible, false);

  visible.start();
  assert.equal(visible.getSnapshot().isLeader, true);
  assert.equal(visible.getSnapshot().leaderId, "visible");

  hidden.evaluateLeadership();
  assert.equal(hidden.getSnapshot().isLeader, false);
  assert.equal(hidden.getSnapshot().reason, "page-hidden");

  hidden.stop();
  visible.stop();
});
