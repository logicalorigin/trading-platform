import assert from "node:assert/strict";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { after, mock, test } from "node:test";

import express from "express";

const happyPathPayload = {
  events: [{ id: "tax-event-1" }],
  sourceFreshness: "shadow_ledger_current",
  basisConfidence: "shadow_simulation",
};

let listAccountTaxEventsImpl: (accountId: string) => Promise<unknown> =
  async () => happyPathPayload;

const inertService = async () => ({});

mock.module(new URL("../services/tax-planning.ts", import.meta.url).href, {
  namedExports: {
    createTaxOrderPreflight: inertService,
    getAccountTaxOverview: inertService,
    getTaxOverview: inertService,
    getTaxProfileSnapshot: inertService,
    getTaxReserveSnapshot: inertService,
    getTaxStateRulesStatus: inertService,
    listAccountReconciliationIssues: inertService,
    listAccountTaxEvents: (accountId: string) =>
      listAccountTaxEventsImpl(accountId),
    listAccountTaxLots: inertService,
    listAccountWashWindows: inertService,
    planTaxReserve: inertService,
    previewTaxReserveAction: inertService,
    submitTaxReserveAction: inertService,
    updateTaxProfileSnapshot: inertService,
  },
});

mock.module(new URL("./auth.ts", import.meta.url).href, {
  namedExports: {
    requireUserCsrf: async () => undefined,
  },
});

const { default: taxRouter } = await import("./tax");

after(() => {
  mock.reset();
});

async function withServer<T>(fn: (baseUrl: string) => Promise<T>): Promise<T> {
  const app = express();
  app.use(taxRouter);
  app.use(
    (
      _error: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      res.status(500).json({ status: 500 });
    },
  );
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  try {
    return await fn(`http://127.0.0.1:${address.port}`);
  } finally {
    server.close();
    await once(server, "close");
  }
}

test("tax events route leaves the happy response unchanged", async () => {
  await withServer(async (baseUrl) => {
    listAccountTaxEventsImpl = async (accountId) => {
      assert.equal(accountId, "shadow");
      return happyPathPayload;
    };

    const response = await fetch(`${baseUrl}/accounts/shadow/tax/events`);

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("retry-after"), null);
    assert.deepEqual(await response.json(), happyPathPayload);
  });
});

test("tax events route has no detached response-budget race", async () => {
  const source = await readFile(new URL("./tax.ts", import.meta.url), "utf8");

  assert.doesNotMatch(source, /Promise\.race/);
  assert.doesNotMatch(source, /listAccountTaxEventsWithinRouteBudget/);
});

test("tax events route reports retryable database pressure as unavailable", async () => {
  await withServer(async (baseUrl) => {
    for (const [error, reason] of [
      [
        Object.assign(
          new Error("canceling statement due to statement timeout"),
          { code: "57014" },
        ),
        "statement_timeout",
      ],
      [
        new Error("timeout exceeded when trying to connect"),
        "pool_acquire_timeout",
      ],
    ] as const) {
      listAccountTaxEventsImpl = async () => {
        throw error;
      };

      const response = await fetch(`${baseUrl}/accounts/shadow/tax/events`);
      const body = (await response.json()) as Record<string, unknown>;

      assert.equal(response.status, 503);
      assert.equal(
        response.headers.get("content-type"),
        "application/problem+json; charset=utf-8",
      );
      assert.equal(response.headers.get("retry-after"), "15");
      assert.equal(response.headers.get("x-pyrus-admission-action"), "shed");
      assert.deepEqual(body, {
        type: "https://pyrus.local/problems/tax-events-unavailable",
        title: "Tax events temporarily unavailable",
        status: 503,
        detail: "Tax events could not be loaded because the database is temporarily unavailable.",
        code: "tax_events_unavailable",
        retryable: true,
        reason,
      });
      assert.equal("events" in body, false);
    }

    listAccountTaxEventsImpl = async () => {
      throw new TypeError("tax event invariant failed");
    };
    const hardFailure = await fetch(
      `${baseUrl}/accounts/shadow/tax/events`,
    );
    assert.equal(hardFailure.status, 500);
    assert.equal(hardFailure.headers.get("retry-after"), null);
  });
});
