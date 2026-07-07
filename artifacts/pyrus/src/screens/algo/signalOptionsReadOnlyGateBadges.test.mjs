import assert from "node:assert/strict";
import test from "node:test";

import { buildSignalOptionsReadOnlyGateBadges } from "./algoHelpers.js";

test("read-only gate badges show greek selector disabled without mtf pattern", () => {
  const badges = buildSignalOptionsReadOnlyGateBadges({
    optionSelection: {
      greekSelector: {
        enabled: false,
        mode: "off",
        minScore: 0,
        maxCandidates: 24,
        requireLiveGreeks: true,
        fallbackToLegacy: true,
      },
    },
    entryGate: {
      mtfPattern: {
        enabled: false,
        pattern: { "1m": "buy" },
      },
    },
  });

  assert.deepEqual(badges, [
    {
      id: "greek-selector-enabled",
      group: "greekSelector",
      label: "Greek selector",
      value: "OFF",
      active: false,
    },
  ]);
});

test("read-only gate badges expand greek selector details when enabled", () => {
  const badges = buildSignalOptionsReadOnlyGateBadges({
    optionSelection: {
      greekSelector: {
        enabled: true,
        mode: "score",
        minScore: 67.891,
        maxCandidates: 12,
        requireLiveGreeks: false,
        fallbackToLegacy: true,
      },
    },
  });

  assert.deepEqual(
    badges.map((badge) => [badge.id, badge.label, badge.value, badge.active]),
    [
      ["greek-selector-enabled", "Greek selector", "ON", true],
      ["greek-selector-mode", "Mode", "Score", true],
      ["greek-selector-min-score", "Min score", "67.89", true],
      ["greek-selector-max-candidates", "Max candidates", "12", true],
      ["greek-selector-live-greeks", "Live Greeks", "OFF", true],
      ["greek-selector-legacy-fallback", "Legacy fallback", "ON", true],
    ],
  );
});

test("read-only gate badges show active mtf pattern gate in timeframe order", () => {
  const badges = buildSignalOptionsReadOnlyGateBadges({
    optionSelection: {
      greekSelector: { enabled: false },
    },
    entryGate: {
      mtfPattern: {
        enabled: true,
        pattern: {
          "15m": "buy",
          "1m": "sell",
          "2m": "sell",
          "5m": "sell",
          ignored: "flat",
        },
      },
    },
  });

  assert.deepEqual(badges.at(-1), {
    id: "mtf-pattern-gate-active",
    group: "mtfPattern",
    label: "MTF pattern gate active",
    value: "1m Sell / 2m Sell / 5m Sell / 15m Buy",
    active: true,
    critical: true,
  });
});
