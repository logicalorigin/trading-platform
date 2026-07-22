import assert from "node:assert/strict";
import test from "node:test";

import {
  buildNotificationLastReadStorageKey,
  captureToast,
  getNotificationSnapshot,
  markNotificationsRead,
  setNotificationUser,
} from "./notificationStore.js";

test("notification history and read state stay isolated by immutable user id", () => {
  setNotificationUser("user-a");
  assert.equal(
    captureToast({
      userId: "user-a",
      title: "A only",
      kind: "info",
    }),
    true,
  );
  const userAReadAt = Date.now() + 1;
  assert.equal(markNotificationsRead("user-a", userAReadAt), true);

  setNotificationUser("user-b");
  assert.deepEqual(getNotificationSnapshot().toasts, []);
  assert.equal(getNotificationSnapshot().lastReadAt, 0);
  assert.equal(
    captureToast({
      userId: "user-a",
      title: "Late detached capture",
      kind: "warn",
    }),
    false,
  );
  assert.equal(
    captureToast({
      userId: "user-b",
      title: "B only",
      kind: "success",
    }),
    true,
  );
  assert.deepEqual(
    getNotificationSnapshot().toasts.map((toast) => toast.title),
    ["B only"],
  );

  setNotificationUser("user-a");
  assert.deepEqual(
    getNotificationSnapshot().toasts.map((toast) => toast.title),
    ["A only"],
  );
  assert.equal(getNotificationSnapshot().lastReadAt, userAReadAt);

  setNotificationUser(null);
  assert.deepEqual(getNotificationSnapshot().toasts, []);
  assert.equal(
    captureToast({ userId: "user-a", title: "After logout" }),
    false,
  );
});

test("notification read persistence keys cannot collide across users", () => {
  assert.notEqual(
    buildNotificationLastReadStorageKey("user/a"),
    buildNotificationLastReadStorageKey("user?b"),
  );
  assert.match(
    buildNotificationLastReadStorageKey("user/a"),
    /^pyrus\.notifications\.lastReadAt\.v2\./,
  );
});

test("notification history preserves sanitized broker activity badges", () => {
  setNotificationUser("broker-user");
  assert.equal(
    captureToast({
      userId: "broker-user",
      title: "Accounts applied",
      kind: "success",
      brokers: ["robinhood", "unknown-provider", "robinhood"],
    }),
    true,
  );

  assert.deepEqual(getNotificationSnapshot().toasts[0].brokers, [
    { provider: "robinhood", label: "Robinhood" },
    { provider: "brokerage", label: "Brokerage" },
  ]);
});
