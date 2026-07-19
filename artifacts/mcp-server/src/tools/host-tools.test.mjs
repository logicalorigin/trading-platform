import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { config } from "../config.ts";
import { readFlightRecorder } from "../host/flight-recorder.ts";
import { diagnosticEventsTool } from "./diagnostic-events.ts";
import { hostTools } from "./host-tools.ts";

test("host tools expose only live runtime authorities", () => {
  assert.deepEqual(
    hostTools.map((tool) => tool.name),
    ["get_flight_recorder", "get_port_bindings", "check_healthz"],
  );
});

test("flight recorder exposes only API state and preserves pressure consumption", async () => {
  const recorderDir = await mkdtemp(path.join(os.tmpdir(), "pyrus-mcp-host-tools-"));
  const originalRecorderDir = config.flightRecorderDir;
  const retiredMarker = "retired-supervisor-state";
  const apiCurrent = {
    updatedAt: "2026-07-19T12:00:00.000Z",
    apiPressure: { resourceLevel: "high" },
  };

  await writeFile(
    path.join(recorderDir, "api-current.json"),
    JSON.stringify(apiCurrent),
  );
  await writeFile(
    path.join(recorderDir, "current.json"),
    JSON.stringify({ marker: retiredMarker }),
  );
  await writeFile(
    path.join(recorderDir, "incidents.jsonl"),
    `${JSON.stringify({ marker: retiredMarker })}\n`,
  );
  config.flightRecorderDir = recorderDir;

  try {
    const pressureResult = await diagnosticEventsTool.run(
      {},
      async () => [],
    );
    assert.equal(
      JSON.parse(pressureResult.content[0].text).limits.pressureLevel,
      "high",
    );

    const snapshot = await readFlightRecorder();
    assert.deepEqual(snapshot, {
      recorderDir,
      apiCurrent,
      present: { apiCurrent: true },
    });
    assert.doesNotMatch(JSON.stringify(snapshot), new RegExp(retiredMarker));
  } finally {
    config.flightRecorderDir = originalRecorderDir;
    await rm(recorderDir, { recursive: true, force: true });
  }
});
