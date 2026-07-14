import assert from "node:assert/strict";
import test from "node:test";

import type { IbkrRuntimeConfig } from "../../lib/runtime";
import { IbkrClient } from "./client";

const config = (): IbkrRuntimeConfig => ({
  baseUrl: "http://127.0.0.1:15000/v1/api",
  bearerToken: null,
  cookie: null,
  defaultAccountId: null,
  extOperator: null,
  extraHeaders: {},
  username: null,
  password: null,
  allowInsecureTls: true,
  paperAccountOnly: false,
});

test("IBKR trade executions normalize documented B and S sides", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async (input) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("/iserver/auth/status")) {
      return Response.json({
        authenticated: true,
        connected: true,
        established: true,
        isPaper: false,
        competing: false,
        accounts: ["U1234567"],
        selectedAccount: "U1234567",
      });
    }
    if (path.endsWith("/iserver/accounts")) {
      return Response.json({
        accounts: ["U1234567"],
        selectedAccount: "U1234567",
        isPaper: false,
      });
    }
    if (path.endsWith("/iserver/account/trades")) {
      return Response.json([
        {
          execution_id: "sell-execution",
          account: "U1234567",
          symbol: "AAPL",
          side: "S",
          size: 2,
          price: "4.50",
          sec_type: "OPT",
          conid: 700001,
          conidEx: "700001@SMART",
          order_ref: "option-sell-intent",
          trade_time_r: 1_721_000_001_000,
        },
        {
          execution_id: "buy-execution",
          account: "U1234567",
          symbol: "AAPL",
          side: "B",
          size: 1,
          price: "210.00",
          sec_type: "STK",
          conid: 265598,
          conidEx: "265598",
          order_ref: "equity-buy-intent",
          trade_time_r: 1_721_000_000_000,
        },
      ]);
    }
    throw new Error(`unexpected IBKR request: ${path}`);
  }) as typeof fetch;

  try {
    const executions = await new IbkrClient(config()).listExecutions({
      accountId: "U1234567",
      mode: "live",
      days: 1,
    });

    assert.equal(
      executions.find((execution) => execution.id === "sell-execution")?.side,
      "sell",
    );
    assert.equal(
      executions.find((execution) => execution.id === "sell-execution")
        ?.providerContractId,
      "700001",
    );
    assert.equal(
      executions.find((execution) => execution.id === "buy-execution")?.side,
      "buy",
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});
