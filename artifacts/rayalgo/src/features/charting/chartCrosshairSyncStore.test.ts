import assert from "node:assert/strict";
import test from "node:test";
import {
  getCrosshairSyncSubscriberCount,
  publishCrosshairSync,
  resetCrosshairSyncStoreForTests,
  subscribeCrosshairSync,
  type CrosshairSyncEvent,
} from "./chartCrosshairSyncStore";

test("subscribers receive move events from peers in the same group", () => {
  resetCrosshairSyncStoreForTests();
  const received: CrosshairSyncEvent[] = [];
  const unsubscribe = subscribeCrosshairSync("group-a", "sub-b", (event) => {
    received.push(event);
  });

  publishCrosshairSync({
    kind: "move",
    groupId: "group-a",
    sourceId: "sub-a",
    time: 1_700_000_000,
  });

  assert.equal(received.length, 1);
  assert.deepEqual(received[0], {
    kind: "move",
    groupId: "group-a",
    sourceId: "sub-a",
    time: 1_700_000_000,
  });

  unsubscribe();
});

test("the publishing subscriber does not receive its own event", () => {
  resetCrosshairSyncStoreForTests();
  const received: CrosshairSyncEvent[] = [];
  subscribeCrosshairSync("group-a", "sub-a", (event) => {
    received.push(event);
  });

  publishCrosshairSync({
    kind: "move",
    groupId: "group-a",
    sourceId: "sub-a",
    time: 1_700_000_000,
  });

  assert.equal(received.length, 0);
});

test("events do not cross group boundaries", () => {
  resetCrosshairSyncStoreForTests();
  const receivedA: CrosshairSyncEvent[] = [];
  const receivedB: CrosshairSyncEvent[] = [];
  subscribeCrosshairSync("group-a", "sub-a-1", (event) => {
    receivedA.push(event);
  });
  subscribeCrosshairSync("group-b", "sub-b-1", (event) => {
    receivedB.push(event);
  });

  publishCrosshairSync({
    kind: "move",
    groupId: "group-b",
    sourceId: "sub-b-2",
    time: 42,
  });

  assert.equal(receivedA.length, 0);
  assert.equal(receivedB.length, 1);
});

test("multiple peers in a group all receive the event", () => {
  resetCrosshairSyncStoreForTests();
  const received: string[] = [];
  subscribeCrosshairSync("group-a", "sub-b", () => {
    received.push("b");
  });
  subscribeCrosshairSync("group-a", "sub-c", () => {
    received.push("c");
  });
  subscribeCrosshairSync("group-a", "sub-d", () => {
    received.push("d");
  });

  publishCrosshairSync({
    kind: "move",
    groupId: "group-a",
    sourceId: "sub-a",
    time: 7,
  });

  assert.deepEqual(received.sort(), ["b", "c", "d"]);
});

test("unsubscribe removes the handler and cleans up empty groups", () => {
  resetCrosshairSyncStoreForTests();
  const unsubscribe = subscribeCrosshairSync("group-a", "sub-a", () => {});
  assert.equal(getCrosshairSyncSubscriberCount("group-a"), 1);
  unsubscribe();
  assert.equal(getCrosshairSyncSubscriberCount("group-a"), 0);
});

test("clear events are forwarded the same way as move events", () => {
  resetCrosshairSyncStoreForTests();
  const received: CrosshairSyncEvent[] = [];
  subscribeCrosshairSync("group-a", "sub-b", (event) => {
    received.push(event);
  });

  publishCrosshairSync({
    kind: "clear",
    groupId: "group-a",
    sourceId: "sub-a",
  });

  assert.equal(received.length, 1);
  assert.equal(received[0].kind, "clear");
});
