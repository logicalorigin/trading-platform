import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGreekPositionDiagnostics,
  greekPositionDiagnosticsReadyGate,
  renderGreekPositionDiagnosticsMarkdown,
  type GreekPositionDiagnosticsInput,
} from "./signal-options-greek-position-diagnostics";

function sampleInput(
  overrides: Partial<GreekPositionDiagnosticsInput> = {},
): GreekPositionDiagnosticsInput {
  return {
    generatedAt: "2026-06-02T14:35:00.000Z",
    deployment: {
      id: "deployment-1",
      name: "Pyrus Signals Options Shadow Paper",
      enabled: true,
      updatedAt: "2026-06-01T20:41:09.923Z",
    },
    profile: {
      greekPositionManagementEnabled: true,
      wireGreekTrailEnabled: false,
    },
    activePositions: [
      {
        symbol: "HOOD",
        lastMarkedAt: "2026-06-02T14:34:00.000Z",
        lastMarkPrice: 3.4,
        stopPrice: 3,
        greekManagement: {
          available: true,
          enforcing: false,
          recommendation: "tighten",
          reasons: ["delta_decay", "theta_burden"],
          fresh: true,
          ageMs: 3000,
          currentDelta: 0.42,
          entryDelta: 0.61,
          deltaImprovement: -0.19,
          currentGamma: 0.03,
          currentTheta: -0.34,
          thetaBurdenPct: 9.1,
        },
      },
      {
        symbol: "DIA",
        lastMarkedAt: "2026-06-02T14:34:10.000Z",
        lastMarkPrice: 5.1,
        stopPrice: 3.16,
        greekManagement: null,
      },
    ],
    recentEvents: {
      total: 12,
      marks: 2,
      marksWithGreekManagement: 1,
      latestMarkAt: "2026-06-02T14:34:10.000Z",
      latestEventAt: "2026-06-02T14:34:10.000Z",
    },
    ...overrides,
  };
}

test("Greek position diagnostics summarizes pending and populated positions", () => {
  const diagnostics = buildGreekPositionDiagnostics(sampleInput());

  assert.equal(diagnostics.status, "partial");
  assert.equal(diagnostics.summary.activePositions, 2);
  assert.equal(diagnostics.summary.positionsWithGreekManagement, 1);
  assert.equal(diagnostics.summary.freshGreekPositions, 1);
  assert.deepEqual(diagnostics.summary.recommendations, {
    tighten: 1,
  });
  assert.equal(diagnostics.positions[0]?.recommendation, "tighten");
  assert.equal(diagnostics.positions[1]?.recommendation, "missing");
});

test("Greek position diagnostics reports disabled and pending states", () => {
  assert.equal(
    buildGreekPositionDiagnostics(
      sampleInput({
        profile: {
          greekPositionManagementEnabled: false,
          wireGreekTrailEnabled: false,
        },
      }),
    ).status,
    "disabled",
  );
  assert.equal(
    buildGreekPositionDiagnostics(
      sampleInput({
        activePositions: sampleInput().activePositions.map((position) => ({
          ...position,
          greekManagement: null,
        })),
      }),
    ).status,
    "pending_marks",
  );
});

test("Greek position diagnostics markdown includes recommendation evidence", () => {
  const markdown = renderGreekPositionDiagnosticsMarkdown(
    buildGreekPositionDiagnostics(sampleInput()),
  );

  assert.match(markdown, /# Signal Options Greek Position Diagnostics/);
  assert.match(markdown, /\| Status \| partial \|/);
  assert.match(markdown, /\| HOOD \| tighten \| true \| false \|/);
  assert.match(markdown, /delta_decay, theta_burden/);
});

test("Greek position diagnostics ready gate requires every active position to have diagnostics", () => {
  const readyInput = sampleInput({
    activePositions: sampleInput().activePositions.map((position) => ({
      ...position,
      greekManagement:
        position.greekManagement ?? {
          available: true,
          enforcing: false,
          recommendation: "hold",
          fresh: true,
          reasons: [],
        },
    })),
  });
  const ready = buildGreekPositionDiagnostics(readyInput);
  const partial = buildGreekPositionDiagnostics(sampleInput());
  const disabled = buildGreekPositionDiagnostics(
    sampleInput({
      profile: {
        greekPositionManagementEnabled: false,
        wireGreekTrailEnabled: false,
      },
    }),
  );

  assert.deepEqual(greekPositionDiagnosticsReadyGate(ready), {
    passed: true,
    reason: "ready",
  });
  assert.deepEqual(greekPositionDiagnosticsReadyGate(partial), {
    passed: false,
    reason: "some_active_positions_missing_greek_management",
  });
  assert.deepEqual(greekPositionDiagnosticsReadyGate(disabled), {
    passed: false,
    reason: "greek_position_diagnostics_disabled",
  });
});
