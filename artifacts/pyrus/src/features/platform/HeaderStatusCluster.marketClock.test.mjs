import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { resolveUsEquityMarketStatus } from "@workspace/market-calendar";
import { buildMarketClockState } from "./HeaderStatusCluster.jsx";

const source = readFileSync(
  new URL("./HeaderStatusCluster.jsx", import.meta.url),
  "utf8",
);

const marketClockAt = (at) => {
  const marketStatus = resolveUsEquityMarketStatus(at);
  const marketClock = buildMarketClockState(Date.parse(at));
  assert.equal(marketClock.phase, marketStatus.session.key);
  return {
    phase: marketClock.phase,
    timerLabel: marketClock.timerLabel,
  };
};

test("header market clock delegates session authority to the shared market calendar", () => {
  assert.match(
    source,
    /import\s*\{[^}]*\bresolveUsEquityMarketStatus\b[^}]*\}\s*from "@workspace\/market-calendar";/,
  );
  assert.match(source, /resolveUsEquityMarketStatus\(/);
});

test("header market clock skips a full holiday and honors the early close", () => {
  assert.deepEqual(marketClockAt("2026-07-03T12:00:00-04:00"), {
    phase: "closed",
    timerLabel: "2d 08:00:00",
  });
  assert.deepEqual(marketClockAt("2026-11-27T12:59:00-05:00"), {
    phase: "rth",
    timerLabel: "00:01:00",
  });
  assert.deepEqual(marketClockAt("2026-11-27T13:00:00-05:00"), {
    phase: "after",
    timerLabel: "04:00:00",
  });
});

test("header market clock changes phase at every ordinary session boundary", () => {
  for (const [at, phase, timerLabel] of [
    ["2026-06-10T03:49:59-04:00", "overnight", "00:00:01"],
    ["2026-06-10T03:50:00-04:00", "closed", "00:10:00"],
    ["2026-06-10T04:00:00-04:00", "pre", "05:30:00"],
    ["2026-06-10T09:29:59-04:00", "pre", "00:00:01"],
    ["2026-06-10T09:30:00-04:00", "rth", "06:30:00"],
    ["2026-06-10T15:59:59-04:00", "rth", "00:00:01"],
    ["2026-06-10T16:00:00-04:00", "after", "04:00:00"],
    ["2026-06-10T19:59:59-04:00", "after", "00:00:01"],
    ["2026-06-10T20:00:00-04:00", "overnight", "07:50:00"],
  ]) {
    assert.deepEqual(marketClockAt(at), { phase, timerLabel }, at);
  }
});

test("Friday midnight remains the overnight session", () => {
  assert.deepEqual(marketClockAt("2026-06-12T00:00:00-04:00"), {
    phase: "overnight",
    timerLabel: "03:50:00",
  });
});
