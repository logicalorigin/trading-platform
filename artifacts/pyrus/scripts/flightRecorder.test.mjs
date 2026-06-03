import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  classifyPreviousRun,
  createFlightRecorder,
  readReplitRuntimeSnapshot,
} from "./flightRecorder.mjs";

function previousRun(overrides = {}) {
  return {
    updatedAt: "2026-05-28T15:00:00.000Z",
    boot: { bootId: "btime:100", bootedAt: "2026-05-28T14:00:00.000Z" },
    supervisor: { pid: 1234 },
    lastEvent: { event: "heartbeat" },
    ...overrides,
  };
}

test("classifies clean, child-exit, replacement, and pressure restarts", () => {
  assert.equal(classifyPreviousRun(null).classification, "none");

  const clean = classifyPreviousRun(
    previousRun({
      lastEvent: { event: "supervisor-shutdown-complete", status: 0 },
    }),
    [],
    { bootId: "btime:100" },
  );
  assert.equal(clean.classification, "clean-restart");
  assert.equal(clean.shouldPersist, false);

  const apiExit = classifyPreviousRun(
    previousRun({
      lastEvent: {
        event: "child-exit",
        childName: "API",
        code: 1,
        signal: null,
      },
    }),
    [],
    { bootId: "btime:100" },
  );
  assert.equal(apiExit.classification, "api-child-exit");
  assert.equal(apiExit.severity, "critical");
  assert.match(apiExit.evidence.join(" "), /api-exit:code=1/);

  const replacedUnderPressure = classifyPreviousRun(
    previousRun({
      processes: { api: { rssMb: 1800 } },
      apiPressure: { level: "critical" },
      cgroup: { memory: { events: { oom_kill: 1 } } },
    }),
    [],
    { bootId: "btime:200" },
    {
      dbToken: { issuedAt: "2026-06-03T12:53:31.000Z" },
      runtimeFiles: { pid1Flags: { mtimeIso: "2026-06-03T12:53:31.000Z" } },
    },
  );
  assert.equal(replacedUnderPressure.classification, "container-replaced");
  assert.equal(replacedUnderPressure.severity, "critical");
  assert.match(replacedUnderPressure.evidence.join(" "), /replit-db-token-issued/);
  assert.match(replacedUnderPressure.evidence.join(" "), /replit-pid1-flags-mtime/);
  assert.deepEqual(replacedUnderPressure.contributingReasons, [
    "suspected-resource-pressure",
  ]);

  const sameContainerPressure = classifyPreviousRun(
    previousRun({
      processes: { api: { cpuPercent: 92 } },
      apiRuntime: { eventLoopP95Ms: 1500 },
    }),
    [],
    { bootId: "btime:100" },
  );
  assert.equal(sameContainerPressure.classification, "suspected-resource-pressure");
  assert.equal(sameContainerPressure.confidence, "medium");
});

test("flight recorder writes sanitized current state and persisted incidents", () => {
  const recorderDir = mkdtempSync(path.join(tmpdir(), "pyrus-flight-recorder-"));
  const recorder = createFlightRecorder({
    repoRoot: path.dirname(recorderDir),
    recorderDir,
    env: {
      NODE_ENV: "test",
      DATABASE_URL: "postgres://secret",
      PYRUS_API_PORT: "8080",
    },
  });

  const state = recorder.writeHeartbeat({
    phase: "running",
    lockAcquired: true,
    apiPid: process.pid,
    webPid: process.pid,
    children: [{ pid: process.pid, killed: false }],
  });
  assert.equal(state.lifecycle.phase, "running");
  assert.equal(state.env.NODE_ENV, "test");
  assert.equal(state.env.PYRUS_API_PORT, "8080");
  assert.equal(Object.hasOwn(state.env, "DATABASE_URL"), false);
  assert.equal(existsSync(recorder.currentPath), true);

  recorder.appendEvent("child-exit", {
    childName: "API",
    childPid: process.pid,
    code: 1,
    signal: null,
  });

  const incident = recorder.classifyAndPersistPreviousRun();
  assert.equal(incident.classification, "api-child-exit");
  assert.equal(existsSync(recorder.incidentsPath), true);

  const incidents = readFileSync(recorder.incidentsPath, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(incidents.length, 1);
  assert.equal(incidents[0].classification, "api-child-exit");
});

test("Replit runtime snapshot records only safe runtime evidence", () => {
  const snapshot = readReplitRuntimeSnapshot({
    REPLIT_CLUSTER: "riker",
    REPLIT_SESSION: "session-123",
    REPLIT_DB_URL: "https://kv.replit.com/v0/not-a-secret-in-test",
    REPLIT_AUTH_TOKEN: "secret",
  });

  assert.equal(snapshot.env.REPLIT_CLUSTER, "riker");
  assert.equal(snapshot.env.REPLIT_SESSION, "session-123");
  assert.equal(Object.hasOwn(snapshot.env, "REPLIT_AUTH_TOKEN"), false);
  assert.equal(snapshot.dbToken, null);
  assert.equal(typeof snapshot.runtimeFiles, "object");
});
