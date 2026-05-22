import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import {
  __resetIbkrLanePolicyForTests,
  getIbkrLanePolicySnapshot,
  resolveIbkrLaneSymbols,
  updateIbkrLanePolicy,
} from "./ibkr-lane-policy";

const policyFile = join(tmpdir(), `rayalgo-lane-policy-${process.pid}.json`);

test.beforeEach(() => {
  process.env["RAYALGO_IBKR_LANE_POLICY_FILE"] = policyFile;
  if (existsSync(policyFile)) {
    rmSync(policyFile, { force: true });
  }
  __resetIbkrLanePolicyForTests();
});

test.afterEach(() => {
  delete process.env["RAYALGO_IBKR_LANE_POLICY_FILE"];
  if (existsSync(policyFile)) {
    rmSync(policyFile, { force: true });
  }
  __resetIbkrLanePolicyForTests();
});

test("lane policy resolves sources, manual symbols, exclusions, and capacity", () => {
  updateIbkrLanePolicy({
    "flow-scanner": {
      sources: {
        "built-in": true,
        "flow-universe": true,
        manual: true,
        watchlists: false,
      },
      manualSymbols: "spy, aapl",
      excludedSymbols: "tsla",
      maxSymbols: 3,
      priority: ["manual", "flow-universe", "built-in"],
    },
  });

  const resolution = resolveIbkrLaneSymbols("flow-scanner", {
    "built-in": ["MSFT", "NVDA"],
    "flow-universe": ["TSLA", "META", "AAPL"],
    watchlists: ["QQQ"],
  });

  assert.deepEqual(resolution.admittedSymbols, ["AAPL", "SPY", "META"]);
  assert.deepEqual(
    resolution.droppedSymbols.map((entry) => [entry.symbol, entry.reason]),
    [
      ["TSLA", "excluded"],
      ["MSFT", "capacity"],
      ["NVDA", "capacity"],
    ],
  );
  assert.equal(resolution.sourceCounts.manual, 2);
  assert.equal(resolution.sourceCounts["flow-universe"], 3);
  assert.equal(resolution.sourceCounts.watchlists, 0);
});

test("default flow scanner policy includes watchlists ahead of the broader universe", () => {
  const resolution = resolveIbkrLaneSymbols("flow-scanner", {
    "built-in": ["MSFT"],
    "flow-universe": ["NVDA"],
    watchlists: ["AAPL"],
  });

  assert.equal(resolution.maxSymbols, 600);
  assert.deepEqual(resolution.admittedSymbols.slice(0, 3), [
    "AAPL",
    "NVDA",
    "MSFT",
  ]);
  assert.equal(resolution.sourceCounts.watchlists, 1);
});

test("persisted legacy flow scanner defaults are migrated to the current defaults", () => {
  writeFileSync(
    policyFile,
    JSON.stringify({
      version: 1,
      updatedAt: null,
      lanes: {
        "flow-scanner": {
          enabled: true,
          sources: {
            "built-in": true,
            watchlists: false,
            "flow-universe": true,
            manual: true,
            system: false,
          },
          manualSymbols: [],
          excludedSymbols: [],
          maxSymbols: 500,
          priority: [
            "manual",
            "flow-universe",
            "built-in",
            "watchlists",
            "system",
          ],
        },
      },
    }),
  );

  const snapshot = getIbkrLanePolicySnapshot();
  assert.equal(snapshot.policy.lanes["flow-scanner"].sources.watchlists, true);
  assert.equal(snapshot.policy.lanes["flow-scanner"].maxSymbols, 600);
  assert.deepEqual(snapshot.policy.lanes["flow-scanner"].priority, [
    "manual",
    "watchlists",
    "flow-universe",
    "built-in",
    "system",
  ]);

  const persisted = JSON.parse(readFileSync(policyFile, "utf8"));
  assert.equal(persisted.lanes["flow-scanner"].sources.watchlists, true);
  assert.equal(persisted.lanes["flow-scanner"].maxSymbols, 600);
});

test("disabled lane reports all desired symbols as dropped", () => {
  updateIbkrLanePolicy({
    "equity-live-quotes": {
      enabled: false,
      sources: {
        manual: true,
        watchlists: true,
      },
      manualSymbols: ["SPY"],
    },
  });

  const resolution = resolveIbkrLaneSymbols("equity-live-quotes", {
    watchlists: ["AAPL"],
  });

  assert.deepEqual(resolution.admittedSymbols, []);
  assert.deepEqual(
    resolution.droppedSymbols.map((entry) => [entry.symbol, entry.reason]),
    [
      ["SPY", "disabled"],
      ["AAPL", "disabled"],
    ],
  );
});
