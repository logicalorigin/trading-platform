import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  fetchMarketingShadowDashboardSnapshot,
  MARKETING_SHADOW_DASHBOARD_DEFAULT_EVENT_LIMIT,
  MARKETING_SHADOW_DASHBOARD_LABEL,
  MARKETING_SHADOW_DASHBOARD_MAX_EVENT_LIMIT,
  normalizeMarketingShadowDashboardInput,
  type MarketingShadowDashboardDependencies,
} from "./marketing-shadow-dashboard";

test("marketing shadow dashboard normalizes range and event limits", () => {
  assert.deepEqual(normalizeMarketingShadowDashboardInput({}), {
    equityRange: "ALL",
    eventLimit: MARKETING_SHADOW_DASHBOARD_DEFAULT_EVENT_LIMIT,
  });
  assert.deepEqual(
    normalizeMarketingShadowDashboardInput({
      equityRange: "ytd",
      eventLimit: "250",
    }),
    {
      equityRange: "YTD",
      eventLimit: MARKETING_SHADOW_DASHBOARD_MAX_EVENT_LIMIT,
    },
  );
  assert.deepEqual(
    normalizeMarketingShadowDashboardInput({
      equityRange: "bad",
      eventLimit: "-4",
    }),
    {
      equityRange: "ALL",
      eventLimit: 1,
    },
  );
});

test("marketing shadow dashboard composes exact shadow account and algo fields", async () => {
  let equityRange = "";
  let eventLimit = 0;
  const deps: Partial<MarketingShadowDashboardDependencies> = {
    now: () => new Date("2026-05-22T20:55:02.000Z"),
    getSummary: async () =>
      ({
        accountId: "shadow",
        mode: "paper",
        currency: "USD",
        updatedAt: new Date("2026-05-22T20:55:00.000Z"),
        metrics: {
          netLiquidation: { value: 46842.73 },
          totalCash: { value: 29814.52 },
          buyingPower: { value: 29814.52 },
          dayPnl: { value: 214.38 },
          dayPnlPercent: { value: 0.46 },
          totalPnl: { value: 6842.73 },
          totalPnlPercent: { value: 17.11 },
        },
      }) as never,
    getEquityHistory: async (input) => {
      equityRange = input.range ?? "";
      return {
        accountId: "shadow",
        range: input.range,
        currency: "USD",
        asOf: new Date("2026-05-22T20:55:00.000Z"),
        latestSnapshotAt: new Date("2026-05-22T20:55:00.000Z"),
        isStale: false,
        points: [
          {
            timestamp: new Date("2026-05-21T20:00:00.000Z"),
            netLiquidation: 46628.35,
          },
          {
            timestamp: new Date("2026-05-22T20:55:00.000Z"),
            netLiquidation: 46842.73,
          },
        ],
      } as never;
    },
    getPositions: async () =>
      ({
        accountId: "shadow",
        positions: [{ id: "pos-1", symbol: "NVDA", marketValue: 1024 }],
        updatedAt: new Date("2026-05-22T20:55:00.000Z"),
      }) as never,
    getClosedTrades: async () =>
      ({
        accountId: "shadow",
        trades: [
          { id: "t1", symbol: "AMD", realizedPnl: 124, commissions: 1.35 },
          { id: "t2", symbol: "TSLA", realizedPnl: -54, commissions: 1.35 },
        ],
        summary: {
          count: 2,
          winners: 1,
          losers: 1,
          realizedPnl: 70,
          commissions: 2.7,
        },
        updatedAt: new Date("2026-05-22T20:54:00.000Z"),
      }) as never,
    getOrders: async (input) =>
      ({
        tab: input?.tab,
        orders:
          input?.tab === "history"
            ? [{ id: "order-1", symbol: "AMD", status: "filled" }]
            : [],
        updatedAt: new Date("2026-05-22T20:54:00.000Z"),
      }) as never,
    getAllocation: async () =>
      ({
        accountId: "shadow",
        buckets: [{ label: "Options", value: 1024 }],
        updatedAt: new Date("2026-05-22T20:54:00.000Z"),
      }) as never,
    getRisk: async (input) => {
      assert.ok(input?.positionsResponse);
      assert.ok(input?.closedTrades);
      return {
        accountId: "shadow",
        degraded: false,
        updatedAt: new Date("2026-05-22T20:54:00.000Z"),
      } as never;
    },
    listDeployments: async () =>
      ({
        deployments: [
          {
            id: "deploy-1",
            name: "Signal Options Paper",
            enabled: true,
            mode: "paper",
            lastEvaluatedAt: new Date("2026-05-22T20:54:41.000Z"),
            lastSignalAt: new Date("2026-05-22T20:49:11.000Z"),
          },
        ],
      }) as never,
    getCockpit: async () =>
      ({
        readiness: { ready: true, reason: null },
        kpis: { todayPnl: 214.38, openPositions: 1 },
        pipelineStages: [{ id: "scan", count: 48 }],
        attentionItems: [],
        signals: [{ symbol: "NVDA", fresh: true }],
        candidates: [{ symbol: "NVDA", actionStatus: "shadow_filled" }],
        activePositions: [{ symbol: "NVDA", quantity: 2 }],
        generatedAt: "2026-05-22T20:54:41.000Z",
      }) as never,
    listEvents: async (input) => {
      eventLimit = input.limit ?? 0;
      return {
        events: [
          {
            id: "event-1",
            deploymentId: "deploy-1",
            providerAccountId: "DU1234567",
            algoRunId: "run-1",
            symbol: "NVDA",
            eventType: "signal_options_shadow_entry",
            summary: "Opened NVDA candidate",
            payload: {
              providerAccountId: "DU1234567",
              debug: { detail: true },
              stage: "filled",
            },
            occurredAt: new Date("2026-05-22T20:50:00.000Z"),
            createdAt: new Date("2026-05-22T20:50:00.000Z"),
            updatedAt: new Date("2026-05-22T20:50:00.000Z"),
          },
        ],
      } as never;
    },
  };

  const payload = await fetchMarketingShadowDashboardSnapshot(
    { equityRange: "YTD", eventLimit: 77 },
    deps,
  );

  assert.equal(equityRange, "YTD");
  assert.equal(eventLimit, 77);
  assert.equal(payload.status.mode, "paper");
  assert.equal(payload.status.source, "shadow-ledger");
  assert.equal(payload.status.label, MARKETING_SHADOW_DASHBOARD_LABEL);
  assert.equal(payload.status.asOf, "2026-05-22T20:55:00.000Z");
  assert.equal(payload.status.degraded, false);
  assert.equal(payload.status.stale, false);
  assert.equal(payload.account.summary.currency, "USD");
  assert.equal(payload.account.summary.netLiquidation, 46842.73);
  assert.deepEqual(payload.account.equityHistory, [
    { t: "2026-05-21T20:00:00.000Z", nav: 46628.35 },
    { t: "2026-05-22T20:55:00.000Z", nav: 46842.73 },
  ]);
  assert.deepEqual(payload.account.tradeStats, {
    count: 2,
    winners: 1,
    losers: 1,
    winRate: 50,
    realizedPnl: 70,
    commissions: 2.7,
  });
  assert.equal(payload.algo.deployment?.id, "deploy-1");
  assert.equal(payload.algo.kpis?.todayPnl, 214.38);
  assert.deepEqual(payload.algo.events[0]?.payload, { stage: "filled" });
});

test("marketing shadow dashboard handles no active/default algo deployment", async () => {
  const deps: Partial<MarketingShadowDashboardDependencies> = {
    now: () => new Date("2026-05-22T20:55:02.000Z"),
    getSummary: async () =>
      ({
        currency: "USD",
        updatedAt: new Date("2026-05-22T20:55:00.000Z"),
        metrics: {
          netLiquidation: { value: 40000 },
          totalCash: { value: 40000 },
          buyingPower: { value: 40000 },
          dayPnl: { value: 0 },
          dayPnlPercent: { value: 0 },
          totalPnl: { value: 0 },
          totalPnlPercent: { value: 0 },
        },
      }) as never,
    getEquityHistory: async () =>
      ({
        asOf: new Date("2026-05-22T20:55:00.000Z"),
        latestSnapshotAt: new Date("2026-05-22T20:55:00.000Z"),
        isStale: false,
        points: [],
      }) as never,
    getPositions: async () => ({ positions: [], updatedAt: new Date() }) as never,
    getClosedTrades: async () =>
      ({ trades: [], summary: {}, updatedAt: new Date() }) as never,
    getOrders: async () => ({ orders: [], updatedAt: new Date() }) as never,
    getAllocation: async () => ({ updatedAt: new Date() }) as never,
    getRisk: async () => ({ updatedAt: new Date() }) as never,
    listDeployments: async () => ({ deployments: [] }) as never,
    getCockpit: async () => {
      throw new Error("cockpit should not be fetched without a deployment");
    },
    listEvents: async () => {
      throw new Error("events should not be fetched without a deployment");
    },
  };

  const payload = await fetchMarketingShadowDashboardSnapshot({}, deps);

  assert.equal(payload.algo.deployment, null);
  assert.equal(payload.algo.readiness, null);
  assert.deepEqual(payload.algo.events, []);
});

test("marketing feed stays read-only and avoids trading mutation imports", () => {
  const serviceSource = readFileSync(
    new URL("./marketing-shadow-dashboard.ts", import.meta.url),
    "utf8",
  );
  const routeSource = readFileSync(
    new URL("../routes/marketing.ts", import.meta.url),
    "utf8",
  );
  const combined = `${serviceSource}\n${routeSource}`;

  assert.doesNotMatch(combined, /placeShadowOrder|previewShadowOrder/);
  assert.doesNotMatch(combined, /cancelAccountOrder|placeOrder|replaceOrder/);
  assert.doesNotMatch(combined, /setAlgoDeploymentEnabled/);
  assert.doesNotMatch(combined, /runSignalOptionsShadowScan/);
  assert.doesNotMatch(combined, /runSignalOptionsShadowBackfill/);
  assert.doesNotMatch(combined, /updateSignalOptionsExecutionProfile/);
  assert.doesNotMatch(combined, /updateAlgoDeploymentStrategySettings/);
});
