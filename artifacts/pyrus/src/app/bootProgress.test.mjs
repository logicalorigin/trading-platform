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

const FRAME_TASK_IDS = [
  "app-content-chunk",
  "react-root",
  "static-html",
  "workspace-route-chunk",
];

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

test("boot overlay completes once the frame chunks load — no data gate", () => {
  resetBootProgressForTests();
  reclassifyBootBlocking(resolveBootBlockingTaskIds("market"));

  assert.deepEqual(sortedBlockingIds(), FRAME_TASK_IDS);

  completeTasks([
    "static-html",
    "react-root",
    "app-content-chunk",
    "workspace-route-chunk",
  ]);

  // session / watchlists / first-screen are NOT required to dismiss the overlay.
  assert.equal(getBootProgressSnapshot().complete, true);
});

test("no screen adds a data blocker to the overlay", () => {
  for (const screenId of ["market", "account", "algo", "flow", "signals"]) {
    resetBootProgressForTests();
    reclassifyBootBlocking(resolveBootBlockingTaskIds(screenId));
    assert.deepEqual(sortedBlockingIds(), FRAME_TASK_IDS);
  }
});

test("reset defaults block only on the frame chunks", () => {
  resetBootProgressForTests();
  reclassifyBootBlocking(resolveBootBlockingTaskIds("market"));
  resetBootProgressForTests();

  assert.deepEqual(sortedBlockingIds(), FRAME_TASK_IDS);
});
