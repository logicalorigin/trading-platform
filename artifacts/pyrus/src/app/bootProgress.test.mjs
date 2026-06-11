import assert from "node:assert/strict";
import test from "node:test";

import {
  completeBootProgressTask,
  getBootProgressSnapshot,
  reclassifyBootBlocking,
  resetBootProgressForTests,
} from "./bootProgress.ts";
import {
  resolveBootBlockingTaskIds,
} from "../features/platform/bootPolicy.js";

const sortedBlockingIds = () =>
  getBootProgressSnapshot()
    .tasks
    .filter((task) => task.blocking)
    .map((task) => task.id)
    .sort();

const completeTasks = (taskIds) => {
  for (const taskId of taskIds) {
    completeBootProgressTask(taskId);
  }
};

test("runtime boot classification lets Market complete without watchlists", () => {
  resetBootProgressForTests();
  reclassifyBootBlocking(resolveBootBlockingTaskIds("market"));

  assert.deepEqual(sortedBlockingIds(), [
    "app-content-chunk",
    "first-screen",
    "react-root",
    "session",
    "static-html",
    "workspace-route-chunk",
  ]);

  completeTasks([
    "static-html",
    "react-root",
    "app-content-chunk",
    "workspace-route-chunk",
    "session",
    "first-screen",
  ]);

  assert.equal(getBootProgressSnapshot().complete, true);
});

test("runtime boot classification restores account blockers for Account", () => {
  resetBootProgressForTests();
  reclassifyBootBlocking(resolveBootBlockingTaskIds("account"));

  assert.deepEqual(sortedBlockingIds(), [
    "accounts",
    "app-content-chunk",
    "first-screen",
    "react-root",
    "session",
    "static-html",
    "workspace-route-chunk",
  ]);

  completeTasks([
    "static-html",
    "react-root",
    "app-content-chunk",
    "workspace-route-chunk",
    "session",
    "first-screen",
  ]);
  assert.equal(getBootProgressSnapshot().complete, false);

  completeBootProgressTask("accounts");
  assert.equal(getBootProgressSnapshot().complete, true);
});

test("runtime boot classification restores account and signal profile blockers for Algo", () => {
  resetBootProgressForTests();
  reclassifyBootBlocking(resolveBootBlockingTaskIds("algo"));

  assert.deepEqual(sortedBlockingIds(), [
    "accounts",
    "app-content-chunk",
    "first-screen",
    "react-root",
    "session",
    "signal-profile",
    "static-html",
    "workspace-route-chunk",
  ]);
});

test("reset restores the static boot task defaults", () => {
  resetBootProgressForTests();
  reclassifyBootBlocking(resolveBootBlockingTaskIds("market"));
  resetBootProgressForTests();

  assert.deepEqual(sortedBlockingIds(), [
    "app-content-chunk",
    "first-screen",
    "react-root",
    "session",
    "static-html",
    "watchlists",
    "workspace-route-chunk",
  ]);
});
