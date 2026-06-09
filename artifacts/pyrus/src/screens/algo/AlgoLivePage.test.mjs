import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveAttentionSeverity,
  resolveHeaderScanWave,
} from "./AlgoLivePage.jsx";

test("algo header does not show warning for info-only options session pause", () => {
  const attentionSeverity = resolveAttentionSeverity([
    {
      severity: "info",
      summary: "Options session is closed.",
      detail: "Options strategy execution is outside the regular options session.",
    },
  ]);

  const wave = resolveHeaderScanWave({
    deploymentEnabled: true,
    signalScanReady: false,
    attentionSeverity,
  });

  assert.equal(attentionSeverity, "info");
  assert.equal(wave.badgeLabel, "paused");
  assert.notEqual(wave.badgeLabel, "warning");
  assert.notEqual(wave.status, "offline");
});

test("algo header still shows warning for warning-level scan blockers", () => {
  const wave = resolveHeaderScanWave({
    deploymentEnabled: true,
    signalScanReady: false,
    attentionSeverity: "warning",
  });

  assert.equal(wave.badgeLabel, "warning");
  assert.equal(wave.status, "offline");
});
