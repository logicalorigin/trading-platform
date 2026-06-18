import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./AlgoScreen.jsx", import.meta.url), "utf8");

test("Algo STA display does not use the legacy Signal Monitor profile poll as a source gate", () => {
  assert.doesNotMatch(source, /useGetSignalMonitorProfile/);
  assert.doesNotMatch(source, /signalMonitorProfile\?\.enabled\s*===\s*false/);
  assert.doesNotMatch(source, /Signal Monitor is paused/);
  assert.doesNotMatch(source, /showing cached signals/);
});

test("Algo STA display reads the profile bundled with live signal state", () => {
  assert.match(
    source,
    /const signalMonitorProfile = signalMonitorState\?\.profile \|\| null;/,
  );
  assert.match(source, /signal matrix current/);
});
