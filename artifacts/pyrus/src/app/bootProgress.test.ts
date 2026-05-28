import assert from "node:assert/strict";
import test from "node:test";
import {
  BOOT_SCREEN_MODULE_PRELOAD_TASK_IDS,
  completeBootProgressTask,
  failBootProgressTask,
  getBootProgressSnapshot,
  resetBootProgressForTests,
  skipBootProgressTasks,
  startBootProgressTask,
} from "./bootProgress";

test.afterEach(() => {
  resetBootProgressForTests();
});

test("boot progress derives percent from settled startup task weights", () => {
  resetBootProgressForTests();

  startBootProgressTask("static-html");
  completeBootProgressTask("static-html");
  assert.equal(getBootProgressSnapshot().percent, 3);

  startBootProgressTask("workspace-route-chunk", {
    detail: "Loading workspace",
  });
  assert.equal(getBootProgressSnapshot().label, "Loading workspace");

  completeBootProgressTask("workspace-route-chunk", {
    detail: "Workspace loaded",
  });
  assert.equal(getBootProgressSnapshot().percent, 13);
});

test("failed and skipped startup tasks settle progress with diagnostics", () => {
  resetBootProgressForTests();

  startBootProgressTask("accounts");
  failBootProgressTask("accounts", new Error("account API unavailable"), {
    detail: "Accounts unavailable",
  });
  skipBootProgressTasks(
    BOOT_SCREEN_MODULE_PRELOAD_TASK_IDS,
    "Screen preload gate did not open during startup",
  );

  const snapshot = getBootProgressSnapshot();
  assert.equal(snapshot.percent, 31);
  assert.equal(snapshot.failedCount, 1);
  assert.equal(snapshot.skippedCount, 4);
  assert.equal(
    snapshot.tasks.find((task) => task.id === "accounts")?.error,
    "account API unavailable",
  );
});

test("boot progress reaches 100 after every blocking task settles", () => {
  resetBootProgressForTests();

  for (const task of getBootProgressSnapshot().tasks) {
    if (!task.blocking) {
      startBootProgressTask(task.id);
      continue;
    }
    completeBootProgressTask(task.id);
  }

  const snapshot = getBootProgressSnapshot();
  assert.equal(snapshot.percent, 100);
  assert.equal(snapshot.complete, true);
  assert.equal(snapshot.settledBlockingTaskCount, snapshot.totalBlockingTaskCount);
  assert.ok(snapshot.activeTaskIds.includes("signal-state"));
});
