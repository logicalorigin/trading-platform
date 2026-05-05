import assert from "node:assert/strict";
import test from "node:test";
import {
  applyLinkedWorkspaceBroadcast,
  getLinkedWorkspacePanelsForGroup,
  normalizeLinkedWorkspaceState,
  resolveLinkedWorkspacePanelContext,
  setLinkedWorkspaceActiveGroup,
  setLinkedWorkspacePanelGroup,
} from "./linkedWorkspaceModel.js";

test("linked workspace state normalizes groups and default panel links", () => {
  const state = normalizeLinkedWorkspaceState(
    {
      activeGroup: "Z",
      groups: {
        A: { symbol: "nvda", timeframe: "1H", updatedAt: "2026-05-05T12:00:00Z" },
        B: { symbol: "", timeframe: "" },
      },
      panels: {
        flow: null,
        account: "C",
        research: "Z",
      },
    },
    { symbol: "SPY", timeframe: "15m" },
  );

  assert.equal(state.activeGroup, "A");
  assert.equal(state.groups.A.symbol, "NVDA");
  assert.equal(state.groups.A.timeframe, "1h");
  assert.equal(state.groups.B.symbol, "SPY");
  assert.equal(state.groups.B.timeframe, "15m");
  assert.equal(state.panels.market, "A");
  assert.equal(state.panels.trade, "A");
  assert.equal(state.panels.flow, null);
  assert.equal(state.panels.account, "C");
  assert.equal(state.panels.research, "A");
});

test("broadcast updates the active group context and records sequence", () => {
  const initial = normalizeLinkedWorkspaceState(null, {
    symbol: "SPY",
    timeframe: "15m",
  });
  const state = applyLinkedWorkspaceBroadcast(initial, {
    sourcePanel: "watchlist",
    symbol: "aapl",
    timeframe: "5m",
    updatedAt: "2026-05-05T14:30:00Z",
  });

  assert.equal(state.activeGroup, "A");
  assert.equal(state.groups.A.symbol, "AAPL");
  assert.equal(state.groups.A.timeframe, "5m");
  assert.deepEqual(state.lastBroadcast, {
    sourcePanel: "watchlist",
    groupId: "A",
    symbol: "AAPL",
    timeframe: "5m",
    sequence: 1,
    updatedAt: "2026-05-05T14:30:00Z",
  });
});

test("panel context follows linked group but unlinked panels keep local fallback", () => {
  const initial = normalizeLinkedWorkspaceState(
    {
      panels: {
        trade: null,
        market: "A",
      },
    },
    { symbol: "SPY", timeframe: "15m" },
  );
  const state = applyLinkedWorkspaceBroadcast(initial, {
    sourcePanel: "market",
    symbol: "MSFT",
    timeframe: "1h",
    updatedAt: "2026-05-05T15:00:00Z",
  });

  assert.deepEqual(
    resolveLinkedWorkspacePanelContext(state, "market", {
      symbol: "QQQ",
      timeframe: "5m",
    }),
    {
      linked: true,
      groupId: "A",
      symbol: "MSFT",
      timeframe: "1h",
      updatedAt: "2026-05-05T15:00:00Z",
      broadcastSequence: 1,
    },
  );
  assert.deepEqual(
    resolveLinkedWorkspacePanelContext(state, "trade", {
      symbol: "QQQ",
      timeframe: "5m",
    }),
    {
      linked: false,
      groupId: null,
      symbol: "QQQ",
      timeframe: "5m",
    },
  );
});

test("panel links can move across A/B/C groups and report affected panels", () => {
  const initial = normalizeLinkedWorkspaceState(null, {
    symbol: "SPY",
    timeframe: "15m",
  });
  const linked = setLinkedWorkspacePanelGroup(initial, "flow", "B");
  const active = setLinkedWorkspaceActiveGroup(linked, "B");
  const state = applyLinkedWorkspaceBroadcast(active, {
    sourcePanel: "flow",
    symbol: "TSLA",
    updatedAt: "2026-05-05T16:00:00Z",
  });

  assert.equal(state.activeGroup, "B");
  assert.equal(state.groups.B.symbol, "TSLA");
  assert.equal(state.groups.A.symbol, "SPY");
  assert.deepEqual(getLinkedWorkspacePanelsForGroup(state, "B"), ["flow"]);
  assert.deepEqual(getLinkedWorkspacePanelsForGroup(state, "A"), [
    "market",
    "trade",
    "account",
    "research",
  ]);
});
