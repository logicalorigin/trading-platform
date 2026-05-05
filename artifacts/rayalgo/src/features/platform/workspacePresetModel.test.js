import assert from "node:assert/strict";
import test from "node:test";
import {
  buildWorkspacePresetStoragePatch,
  captureWorkspacePresetSnapshot,
  normalizeWorkspacePresetSnapshot,
  normalizeWorkspacePresetsState,
  restoreWorkspacePresetDefaults,
  switchWorkspacePreset,
} from "./workspacePresetModel.js";

test("workspace preset state infers active preset and captures managed workspace settings", () => {
  const state = normalizeWorkspacePresetsState(
    null,
    {
      screen: "flow",
      sidebarCollapsed: false,
      linkedWorkspace: { activeGroup: "B" },
      workspaceState: {
        flowActivePresetId: "sweeps",
        flowColumnsOpen: true,
        flowVisibleColumns: ["side", "premium", "premium", "bogus"],
        marketGridLayout: "3x3",
      },
    },
  );

  assert.equal(state.activePresetId, "flow_review");
  assert.equal(state.presets.flow_review.screen, "flow");
  assert.equal(state.presets.flow_review.sidebarCollapsed, false);
  assert.equal(state.presets.flow_review.activeLinkedGroup, "B");
  assert.equal(state.presets.flow_review.flowActivePresetId, "sweeps");
  assert.deepEqual(state.presets.flow_review.flowVisibleColumns, [
    "side",
    "premium",
  ]);
  assert.equal(state.presets.flow_review.marketGridLayout, "3x3");
});

test("workspace preset snapshot keeps preset screen targets deterministic", () => {
  const snapshot = normalizeWorkspacePresetSnapshot("market_monitor", {
    screen: "trade",
    marketGridLayout: "9x9",
    marketGridSoloSlotIndex: 99,
    flowRowsPerPage: 999,
    accountSection: "paper",
    activeLinkedGroup: "Z",
  });

  assert.equal(snapshot.screen, "market");
  assert.equal(snapshot.marketGridLayout, "2x3");
  assert.equal(snapshot.marketGridSoloSlotIndex, 8);
  assert.equal(snapshot.flowRowsPerPage, 40);
  assert.equal(snapshot.accountSection, "real");
  assert.equal(snapshot.activeLinkedGroup, "A");
});

test("switching presets saves the current preset and restores the target snapshot", () => {
  const current = captureWorkspacePresetSnapshot(
    {
      sidebarCollapsed: false,
      linkedWorkspace: { activeGroup: "A" },
      workspaceState: {
        marketGridLayout: "3x3",
        flowColumnsOpen: false,
        accountSection: "real",
      },
    },
    "market_monitor",
  );
  const initial = normalizeWorkspacePresetsState({
    activePresetId: "market_monitor",
    presets: {
      flow_review: {
        sidebarCollapsed: true,
        flowActivePresetId: "blocks",
        flowColumnsOpen: true,
        activeLinkedGroup: "B",
      },
    },
  });
  const switched = switchWorkspacePreset(initial, "flow_review", current);

  assert.equal(switched.state.activePresetId, "flow_review");
  assert.equal(switched.state.presets.market_monitor.marketGridLayout, "3x3");
  assert.equal(switched.snapshot.screen, "flow");
  assert.equal(switched.snapshot.sidebarCollapsed, true);
  assert.equal(switched.snapshot.flowActivePresetId, "blocks");
  assert.equal(switched.snapshot.activeLinkedGroup, "B");
});

test("restoring preset defaults drops saved state and emits a complete storage patch", () => {
  const initial = normalizeWorkspacePresetsState({
    activePresetId: "risk_review",
    presets: {
      risk_review: {
        sidebarCollapsed: false,
        accountSection: "shadow",
        accountOrderTab: "history",
        tradePositionsTab: "history",
        activeLinkedGroup: "B",
      },
    },
  });
  const restored = restoreWorkspacePresetDefaults(initial, "risk_review");
  const patch = buildWorkspacePresetStoragePatch(restored.snapshot);

  assert.equal(restored.state.activePresetId, "risk_review");
  assert.equal(restored.state.presets.risk_review, undefined);
  assert.equal(restored.snapshot.screen, "account");
  assert.equal(restored.snapshot.accountSection, "real");
  assert.equal(restored.snapshot.accountOrderTab, "working");
  assert.equal(restored.snapshot.tradePositionsTab, "orders");
  assert.equal(restored.snapshot.activeLinkedGroup, "C");
  assert.equal(patch.screen, "account");
  assert.equal(patch.sidebarCollapsed, true);
  assert.equal(patch.flowRowsPerPage, 40);
  assert.deepEqual(patch.flowVisibleColumns, [
    "side",
    "execution",
    "type",
    "fill",
    "bidAsk",
    "premium",
    "size",
    "oi",
    "ratio",
    "dte",
    "iv",
    "spot",
    "score",
  ]);
});
