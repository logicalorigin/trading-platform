import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createBootBoundaryRecorder,
  resolveFlightRecorderDir,
} from "./flightRecorder.mjs";

function boot(btime) {
  return {
    btime,
    bootedAt: new Date(btime * 1_000).toISOString(),
    bootId: `btime:${btime}`,
  };
}

function lines(filePath) {
  try {
    return readFileSync(filePath, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map(JSON.parse);
  } catch {
    return [];
  }
}

test("records one incident when the Replit guest boot identity changes", (t) => {
  const recorderDir = mkdtempSync(
    path.join(os.tmpdir(), "pyrus-boot-recorder-"),
  );
  t.after(() => rmSync(recorderDir, { recursive: true, force: true }));
  let currentBoot = boot(1_000);
  let nowMs = 2_000_000;
  const recorder = createBootBoundaryRecorder({
    recorderDir,
    readBoot: () => currentBoot,
    now: () => new Date(nowMs),
    env: { REPLIT_CLUSTER: "fixture-cluster", SECRET_TOKEN: "never-write-me" },
  });

  assert.equal(recorder.record().incident, null);
  assert.equal(recorder.record().incident, null);

  currentBoot = boot(1_100);
  nowMs += 1_000;
  const incident = recorder.record().incident;
  assert.equal(incident.classification, "container-replaced");
  assert.equal(incident.boundaryAt, currentBoot.bootedAt);
  assert.equal(incident.hostTrigger, "unknown");
  assert.equal(incident.previousBoot.bootId, "btime:1000");
  assert.equal(incident.currentBoot.bootId, "btime:1100");

  assert.equal(recorder.record().incident, null);
  assert.equal(lines(path.join(recorderDir, "incidents.jsonl")).length, 1);
  const marker = JSON.parse(
    readFileSync(path.join(recorderDir, "current.json"), "utf8"),
  );
  assert.equal(marker.boot.bootId, "btime:1100");
  assert.equal(marker.replit.env.REPLIT_CLUSTER, "fixture-cluster");
  assert.doesNotMatch(JSON.stringify(marker), /never-write-me/);
});

test("an overlapping outgoing VM cannot rewind the newer boot marker", (t) => {
  const recorderDir = mkdtempSync(
    path.join(os.tmpdir(), "pyrus-overlap-recorder-"),
  );
  t.after(() => rmSync(recorderDir, { recursive: true, force: true }));
  const outgoing = createBootBoundaryRecorder({
    recorderDir,
    readBoot: () => boot(1_000),
  });
  const incoming = createBootBoundaryRecorder({
    recorderDir,
    readBoot: () => boot(1_100),
  });

  outgoing.record();
  incoming.record();
  assert.equal(outgoing.record().superseded, true);

  const marker = JSON.parse(
    readFileSync(path.join(recorderDir, "current.json"), "utf8"),
  );
  assert.equal(marker.boot.bootId, "btime:1100");
  assert.equal(lines(path.join(recorderDir, "incidents.jsonl")).length, 1);
});

test("resets claimed coverage after a stale heartbeat gap", (t) => {
  const recorderDir = mkdtempSync(
    path.join(os.tmpdir(), "pyrus-coverage-gap-recorder-"),
  );
  t.after(() => rmSync(recorderDir, { recursive: true, force: true }));
  let nowMs = Date.parse("2026-07-23T04:00:00.000Z");
  const recorder = createBootBoundaryRecorder({
    recorderDir,
    readBoot: () => boot(1_000),
    now: () => new Date(nowMs),
  });

  recorder.record();
  nowMs += 91_000;
  recorder.record();

  const marker = JSON.parse(
    readFileSync(path.join(recorderDir, "current.json"), "utf8"),
  );
  assert.equal(marker.coverageStartedAt, "2026-07-23T04:01:31.000Z");
});

test("quarantines a corrupt marker and records the resulting coverage gap", (t) => {
  const recorderDir = mkdtempSync(
    path.join(os.tmpdir(), "pyrus-corrupt-recorder-"),
  );
  t.after(() => rmSync(recorderDir, { recursive: true, force: true }));
  writeFileSync(path.join(recorderDir, "current.json"), "{truncated");
  const recorder = createBootBoundaryRecorder({
    recorderDir,
    readBoot: () => boot(1_000),
    now: () => new Date("2026-07-23T04:00:00.000Z"),
  });

  assert.equal(recorder.record().recoveredCorruptMarker, true);
  assert.equal(
    lines(path.join(recorderDir, "incidents.jsonl"))[0]?.classification,
    "recorder-coverage-gap",
  );
  assert.ok(
    readdirSync(recorderDir).some((name) =>
      name.startsWith("current.corrupt."),
    ),
  );
  assert.equal(
    JSON.parse(readFileSync(path.join(recorderDir, "current.json"))).boot
      .bootId,
    "btime:1000",
  );
});

test("quarantines a structurally valid marker from the future", (t) => {
  const recorderDir = mkdtempSync(
    path.join(os.tmpdir(), "pyrus-future-recorder-"),
  );
  t.after(() => rmSync(recorderDir, { recursive: true, force: true }));
  writeFileSync(
    path.join(recorderDir, "current.json"),
    JSON.stringify({
      schemaVersion: 1,
      coverageStartedAt: "2099-01-01T00:00:00.000Z",
      updatedAt: "2099-01-01T00:00:00.000Z",
      boot: boot(4_071_004_800),
    }),
  );
  const recorder = createBootBoundaryRecorder({
    recorderDir,
    readBoot: () => boot(1_000),
    now: () => new Date("2026-07-23T04:00:00.000Z"),
  });

  assert.equal(recorder.record().recoveredCorruptMarker, true);
  assert.equal(
    lines(path.join(recorderDir, "incidents.jsonl"))[0]?.classification,
    "recorder-coverage-gap",
  );
  assert.equal(
    JSON.parse(readFileSync(path.join(recorderDir, "current.json"))).boot
      .bootId,
    "btime:1000",
  );
});

test("a bogus future marker filename cannot disable the current guest", (t) => {
  const recorderDir = mkdtempSync(
    path.join(os.tmpdir(), "pyrus-poison-marker-recorder-"),
  );
  t.after(() => rmSync(recorderDir, { recursive: true, force: true }));
  const markersDir = path.join(recorderDir, "boot-markers");
  mkdirSync(markersDir, { recursive: true });
  writeFileSync(
    path.join(markersDir, "btime-9007199254740991.json"),
    "{broken",
  );
  writeFileSync(
    path.join(markersDir, "btime-4071004800.json"),
    JSON.stringify({
      schemaVersion: 2,
      coverageStartedAt: "2099-01-01T00:00:00.000Z",
      updatedAt: "2099-01-01T00:00:00.000Z",
      boot: boot(4_071_004_800),
    }),
  );
  const recorder = createBootBoundaryRecorder({
    recorderDir,
    readBoot: () => boot(1_000),
    now: () => new Date("2026-07-23T04:00:00.000Z"),
  });

  const result = recorder.record();

  assert.equal(result.superseded, undefined);
  assert.equal(result.recoveredCorruptMarker, true);
  assert.equal(
    JSON.parse(readFileSync(path.join(recorderDir, "current.json"))).boot
      .bootId,
    "btime:1000",
  );
  assert.ok(
    readdirSync(markersDir).some((name) =>
      name.startsWith(
        "btime-9007199254740991.corrupt.2026_07_23T04_00_00_000Z.",
      ),
    ),
  );
  assert.ok(
    readdirSync(markersDir).some((name) =>
      name.startsWith("btime-4071004800.corrupt.2026_07_23T04_00_00_000Z."),
    ),
  );
});

test("a marker filename must agree with its recorded boot time", (t) => {
  const recorderDir = mkdtempSync(
    path.join(os.tmpdir(), "pyrus-mismatched-marker-recorder-"),
  );
  t.after(() => rmSync(recorderDir, { recursive: true, force: true }));
  const markersDir = path.join(recorderDir, "boot-markers");
  mkdirSync(markersDir, { recursive: true });
  writeFileSync(
    path.join(markersDir, "btime-2000.json"),
    JSON.stringify({
      schemaVersion: 2,
      coverageStartedAt: "1970-01-01T00:16:40.000Z",
      updatedAt: "2026-07-23T04:00:00.000Z",
      boot: boot(1_000),
    }),
  );
  const recorder = createBootBoundaryRecorder({
    recorderDir,
    readBoot: () => boot(1_100),
    now: () => new Date("2026-07-23T04:00:00.000Z"),
  });

  const result = recorder.record();

  assert.equal(result.superseded, undefined);
  assert.equal(result.recoveredCorruptMarker, true);
  assert.equal(
    JSON.parse(readFileSync(path.join(recorderDir, "current.json"))).boot
      .bootId,
    "btime:1100",
  );
});

test("migrates a legacy marker without discarding its prior boot identity", (t) => {
  const recorderDir = mkdtempSync(
    path.join(os.tmpdir(), "pyrus-legacy-recorder-"),
  );
  t.after(() => rmSync(recorderDir, { recursive: true, force: true }));
  writeFileSync(
    path.join(recorderDir, "current.json"),
    JSON.stringify({
      schemaVersion: 1,
      updatedAt: new Date(1_900_000).toISOString(),
      boot: boot(1_000),
    }),
  );
  const recorder = createBootBoundaryRecorder({
    recorderDir,
    readBoot: () => boot(1_100),
    now: () => new Date(2_000_000),
  });

  const result = recorder.record();

  assert.equal(result.coverageGap.classification, "recorder-coverage-gap");
  assert.equal(result.incident.classification, "container-replaced");
  assert.equal(result.incident.previousBoot.bootId, "btime:1000");
  assert.equal(
    JSON.parse(readFileSync(path.join(recorderDir, "current.json")))
      .schemaVersion,
    2,
  );
});

test("a torn incident tail cannot consume the next replacement event", (t) => {
  const recorderDir = mkdtempSync(
    path.join(os.tmpdir(), "pyrus-torn-incident-recorder-"),
  );
  t.after(() => rmSync(recorderDir, { recursive: true, force: true }));
  const outgoing = createBootBoundaryRecorder({
    recorderDir,
    readBoot: () => boot(1_000),
  });
  outgoing.record();
  writeFileSync(path.join(recorderDir, "incidents.jsonl"), '{"torn":');
  const incoming = createBootBoundaryRecorder({
    recorderDir,
    readBoot: () => boot(1_100),
  });

  incoming.record();

  const retained = readFileSync(
    path.join(recorderDir, "incidents.jsonl"),
    "utf8",
  )
    .trim()
    .split("\n");
  assert.equal(retained[0], '{"torn":');
  assert.equal(
    JSON.parse(retained.at(-1)).classification,
    "container-replaced",
  );
});

test("uses the configured recorder directory without persisting its name", () => {
  assert.equal(
    resolveFlightRecorderDir("/repo", {
      PYRUS_FLIGHT_RECORDER_DIR: "../private-recorder",
    }),
    path.resolve("../private-recorder"),
  );
  assert.equal(
    resolveFlightRecorderDir("/repo", {}),
    "/repo/.pyrus-runtime/flight-recorder",
  );
});
