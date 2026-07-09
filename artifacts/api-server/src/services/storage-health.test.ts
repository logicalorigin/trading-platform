import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";

import {
  __resetStorageHealthForTests,
  __setStorageHealthProbeForTests,
  refreshStorageHealthSnapshot,
} from "./storage-health";

const priorDatabaseUrl = process.env["DATABASE_URL"];

before(() => {
  // refreshStorageHealthSnapshot short-circuits unless a DB connection is
  // "configured"; give it a parseable URL so the probe path runs.
  process.env["DATABASE_URL"] = "postgres://u:p@localhost:5432/testdb";
});

after(() => {
  if (priorDatabaseUrl === undefined) {
    delete process.env["DATABASE_URL"];
  } else {
    process.env["DATABASE_URL"] = priorDatabaseUrl;
  }
});

afterEach(() => {
  __resetStorageHealthForTests();
});

test("refreshStorageHealthSnapshot decomposes probe timing into laneWait/acquire/exec", async () => {
  __resetStorageHealthForTests();
  __setStorageHealthProbeForTests(async () => ({
    laneWaitMs: 5,
    acquireMs: 7,
    execMs: 11,
  }));

  const snapshot = await refreshStorageHealthSnapshot();

  assert.equal(snapshot.status, "ok");
  assert.equal(snapshot.laneWaitMs, 5);
  assert.equal(snapshot.acquireMs, 7);
  assert.equal(snapshot.execMs, 11);
  // pingMs stays the end-to-end total for backward compatibility.
  assert.equal(typeof snapshot.pingMs, "number");
});

test("a timing-less probe leaves components null but still records total pingMs", async () => {
  __resetStorageHealthForTests();
  __setStorageHealthProbeForTests(async () => {});

  const snapshot = await refreshStorageHealthSnapshot();

  assert.equal(snapshot.status, "ok");
  assert.equal(snapshot.laneWaitMs, null);
  assert.equal(snapshot.acquireMs, null);
  assert.equal(snapshot.execMs, null);
  assert.equal(typeof snapshot.pingMs, "number");
});

test("a failed probe reports total pingMs with null components", async () => {
  __resetStorageHealthForTests();
  __setStorageHealthProbeForTests(async () => {
    throw new Error("boom");
  });

  const snapshot = await refreshStorageHealthSnapshot();

  assert.equal(snapshot.reachable, false);
  assert.equal(snapshot.laneWaitMs, null);
  assert.equal(snapshot.acquireMs, null);
  assert.equal(snapshot.execMs, null);
  assert.equal(typeof snapshot.pingMs, "number");
});
