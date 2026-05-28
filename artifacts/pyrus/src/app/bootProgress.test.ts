import assert from "node:assert/strict";
import test from "node:test";
import {
  BOOT_SCREEN_MODULE_PRELOAD_TASK_IDS,
  completeBootProgressTask,
  failBootProgressTask,
  getBootProgressSnapshot,
  reclassifyBootBlocking,
  resetBootProgressForTests,
  skipBootProgressTasks,
  startBootProgressTask,
  type BootProgressTaskId,
} from "./bootProgress";

const BOOT_INFRA_TASK_IDS = [
  "static-html",
  "react-root",
  "app-content-chunk",
  "workspace-route-chunk",
  "first-screen",
] as const satisfies readonly BootProgressTaskId[];

const completeTaskIds = (taskIds: readonly BootProgressTaskId[]) => {
  for (const taskId of taskIds) {
    completeBootProgressTask(taskId);
  }
};

test.afterEach(() => {
  resetBootProgressForTests();
});

test("boot progress derives percent from settled startup task weights", () => {
  resetBootProgressForTests();

  startBootProgressTask("static-html");
  completeBootProgressTask("static-html");
  assert.equal(getBootProgressSnapshot().percent, 5);

  startBootProgressTask("workspace-route-chunk", {
    detail: "Loading workspace",
  });
  assert.equal(getBootProgressSnapshot().label, "Loading workspace");

  completeBootProgressTask("workspace-route-chunk", {
    detail: "Workspace loaded",
  });
  assert.equal(getBootProgressSnapshot().percent, 22);
});

test("failed and skipped secondary startup tasks do not gate progress", () => {
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
  assert.equal(snapshot.percent, 0);
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

test("boot blocking reclassification updates live task snapshots", () => {
  resetBootProgressForTests();

  completeBootProgressTask("static-html");
  const before = getBootProgressSnapshot();

  reclassifyBootBlocking([
    ...BOOT_INFRA_TASK_IDS,
    "session",
    "accounts",
  ]);

  const snapshot = getBootProgressSnapshot();
  assert.equal(snapshot.percent, before.percent);
  assert.equal(snapshot.tasks.find((task) => task.id === "accounts")?.blocking, true);
  assert.equal(snapshot.tasks.find((task) => task.id === "watchlists")?.blocking, false);
  assert.equal(snapshot.tasks.find((task) => task.id === "signal-profile")?.blocking, false);
});

test("boot blocking reset restores static defaults", () => {
  resetBootProgressForTests();

  reclassifyBootBlocking([
    ...BOOT_INFRA_TASK_IDS,
    "session",
    "accounts",
  ]);
  resetBootProgressForTests();

  const snapshot = getBootProgressSnapshot();
  assert.equal(snapshot.tasks.find((task) => task.id === "accounts")?.blocking, false);
  assert.equal(snapshot.tasks.find((task) => task.id === "watchlists")?.blocking, true);
  assert.equal(snapshot.tasks.find((task) => task.id === "signal-profile")?.blocking, false);
});

test("market boot completes without watchlists, accounts, signal profile, or hidden screen preloads", () => {
  resetBootProgressForTests();

  reclassifyBootBlocking([
    ...BOOT_INFRA_TASK_IDS,
    "session",
  ]);
  ["watchlists", "accounts", "signal-profile", ...BOOT_SCREEN_MODULE_PRELOAD_TASK_IDS].forEach(
    (taskId) => startBootProgressTask(taskId),
  );

  completeTaskIds([
    ...BOOT_INFRA_TASK_IDS,
    "session",
  ]);

  const snapshot = getBootProgressSnapshot();
  assert.equal(snapshot.complete, true);
  assert.equal(snapshot.percent, 100);
  assert.equal(snapshot.tasks.find((task) => task.id === "watchlists")?.status, "active");
  assert.equal(snapshot.tasks.find((task) => task.id === "accounts")?.status, "active");
  assert.equal(
    snapshot.tasks.find((task) => task.id === "signal-profile")?.status,
    "active",
  );
});

test("algo boot keeps accounts and signal profile blocking", () => {
  resetBootProgressForTests();

  reclassifyBootBlocking([
    ...BOOT_INFRA_TASK_IDS,
    "session",
    "accounts",
    "signal-profile",
  ]);

  completeTaskIds([
    ...BOOT_INFRA_TASK_IDS,
    "session",
    "accounts",
  ]);

  assert.equal(getBootProgressSnapshot().complete, false);

  completeBootProgressTask("signal-profile");

  const snapshot = getBootProgressSnapshot();
  assert.equal(snapshot.complete, true);
  assert.equal(snapshot.percent, 100);
});
