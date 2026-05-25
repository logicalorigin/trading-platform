import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import test from "node:test";
import express from "express";
import {
  createMarketingRouter,
  MARKETING_DASHBOARD_NEXT_TOKEN_ENV,
  MARKETING_DASHBOARD_TOKEN_ENV,
  type MarketingRouterDependencies,
} from "./marketing";
import type {
  MarketingShadowDashboardInput,
  MarketingShadowDashboardPayload,
} from "../services/marketing-shadow-dashboard";

function fixturePayload(
  overrides: Partial<MarketingShadowDashboardPayload["status"]> = {},
): MarketingShadowDashboardPayload {
  return {
    status: {
      mode: "paper",
      source: "shadow-ledger",
      label: "Shadow / paper trading",
      asOf: "2026-05-22T20:55:00.000Z",
      generatedAt: "2026-05-22T20:55:02.000Z",
      lastAccountUpdateAt: "2026-05-22T20:55:00.000Z",
      lastAlgoUpdateAt: "2026-05-22T20:54:41.000Z",
      degraded: false,
      stale: false,
      reason: null,
      warnings: [],
      ...overrides,
    },
    account: {
      summary: {
        currency: "USD",
        netLiquidation: 46842.73,
        cash: 29814.52,
        buyingPower: 29814.52,
        dayPnl: 214.38,
        dayPnlPercent: 0.46,
        totalPnl: 6842.73,
        totalPnlPercent: 17.11,
      },
      equityHistory: [{ t: "2026-05-22T20:55:00.000Z", nav: 46842.73 }],
      positions: [],
      closedTrades: [],
      orders: { working: [], history: [] },
      risk: {} as never,
      allocation: {} as never,
      tradeStats: {
        count: 0,
        winners: 0,
        losers: 0,
        winRate: null,
        realizedPnl: 0,
        commissions: 0,
      },
    },
    algo: {
      deployment: null,
      readiness: null,
      kpis: null,
      pipelineStages: [],
      attentionItems: [],
      signals: [],
      candidates: [],
      activePositions: [],
      events: [],
    },
  };
}

async function withServer<T>(
  env: Record<string, string | undefined>,
  run: (baseUrl: string) => Promise<T>,
  options: {
    fetchSnapshot?: (
      input: MarketingShadowDashboardInput,
    ) => Promise<MarketingShadowDashboardPayload>;
    subscribeSnapshots?: MarketingRouterDependencies["subscribeSnapshots"];
    heartbeatMs?: number;
  } = {},
): Promise<T> {
  const app = express();
  app.use(
    createMarketingRouter({
      env,
      fetchSnapshot: options.fetchSnapshot ?? (async () => fixturePayload()),
      subscribeSnapshots: options.subscribeSnapshots,
      heartbeatMs: options.heartbeatMs,
    }),
  );
  const server: Server = createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    return await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
}

test("marketing dashboard route is disabled when no token is configured", async () => {
  await withServer({}, async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/marketing/shadow-dashboard/snapshot`,
    );

    assert.equal(response.status, 404);
  });
});

test("marketing dashboard snapshot requires primary or next bearer token", async () => {
  const env = {
    [MARKETING_DASHBOARD_TOKEN_ENV]: "primary-token",
    [MARKETING_DASHBOARD_NEXT_TOKEN_ENV]: "next-token",
  };

  await withServer(env, async (baseUrl) => {
    const missing = await fetch(
      `${baseUrl}/marketing/shadow-dashboard/snapshot`,
    );
    assert.equal(missing.status, 401);

    const bad = await fetch(`${baseUrl}/marketing/shadow-dashboard/snapshot`, {
      headers: { authorization: "Bearer wrong-token" },
    });
    assert.equal(bad.status, 401);

    const primary = await fetch(
      `${baseUrl}/marketing/shadow-dashboard/snapshot?equityRange=YTD&eventLimit=25`,
      { headers: { authorization: "Bearer primary-token" } },
    );
    assert.equal(primary.status, 200);
    const primaryPayload = (await primary.json()) as MarketingShadowDashboardPayload;
    assert.equal(primaryPayload.status.label, "Shadow / paper trading");

    const next = await fetch(`${baseUrl}/marketing/shadow-dashboard/snapshot`, {
      headers: { authorization: "Bearer next-token" },
    });
    assert.equal(next.status, 200);
  });
});

test("marketing dashboard stream emits snapshot ready and heartbeat events", async () => {
  const env = {
    [MARKETING_DASHBOARD_TOKEN_ENV]: "stream-token",
  };
  let unsubscribed = false;
  await withServer(
    env,
    async (baseUrl) => {
      const controller = new AbortController();
      const response = await fetch(
        `${baseUrl}/marketing/shadow-dashboard/stream`,
        {
          headers: { authorization: "Bearer stream-token" },
          signal: controller.signal,
        },
      );
      assert.equal(response.status, 200);
      assert.ok(response.body);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let output = "";
      const deadline = Date.now() + 1_000;
      while (
        Date.now() < deadline &&
        !(
          output.includes("event: snapshot") &&
          output.includes("event: ready") &&
          output.includes(": ping")
        )
      ) {
        const read = await reader.read();
        if (read.done) {
          break;
        }
        output += decoder.decode(read.value);
      }
      await reader.cancel();
      controller.abort();
      reader.releaseLock();

      assert.match(output, /event: snapshot/);
      assert.match(output, /event: ready/);
      assert.match(output, /: ping/);
    },
    {
      heartbeatMs: 10,
      subscribeSnapshots: ((
        _input: MarketingShadowDashboardInput,
        onSnapshot: (payload: MarketingShadowDashboardPayload) => void,
      ) => {
        const timer = setTimeout(() => {
          onSnapshot(fixturePayload({ generatedAt: "2026-05-22T20:55:04.000Z" }));
        }, 20);
        return () => {
          clearTimeout(timer);
          unsubscribed = true;
        };
      }) as never,
    },
  );

  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(unsubscribed, true);
});
