import assert from "node:assert/strict";
import test from "node:test";
import type { PlaceOrderInput } from "@workspace/ibkr-contracts";

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

const order: PlaceOrderInput = {
  accountId: "U1234567",
  mode: "live",
  confirm: true,
  clientOrderId: "intent-warning-1",
  symbol: "AAPL",
  assetClass: "equity",
  side: "buy",
  type: "limit",
  quantity: 1,
  limitPrice: 100,
  stopPrice: null,
  timeInForce: "day",
  optionContract: null,
};

test("IBKR warning replies require explicit continuation and are never auto-confirmed", async () => {
  const previousFetch = globalThis.fetch;
  let replyRequests = 0;
  globalThis.fetch = (async (input) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("/iserver/accounts")) {
      return Response.json({ accounts: ["U1234567"] });
    }
    if (path.endsWith("/iserver/secdef/search")) {
      return Response.json([
        {
          symbol: "AAPL",
          conid: 265598,
          description: "NASDAQ",
        },
      ]);
    }
    if (path.endsWith("/iserver/account/U1234567/orders")) {
      return Response.json([
        {
          id: "reply-1",
          message: ["Review this order warning."],
        },
      ]);
    }
    if (path.endsWith("/iserver/reply/reply-1")) {
      replyRequests += 1;
      return Response.json([
        { order_id: "order-1", order_status: "Submitted" },
      ]);
    }
    throw new Error(`unexpected IBKR request: ${path}`);
  }) as typeof fetch;

  try {
    const client = new IbkrClient(config());
    await assert.rejects(client.placeOrder(order), (error: unknown) => {
      assert.equal(
        (error as { code?: string }).code,
        "ibkr_order_warning_confirmation_required",
      );
      const data = (
        error as {
          data?: {
            replyId?: unknown;
            messages?: unknown;
            requestEpoch?: unknown;
          };
        }
      ).data;
      assert.equal(data?.replyId, "reply-1");
      assert.deepEqual(data?.messages, ["Review this order warning."]);
      assert.equal(data?.requestEpoch, client.getCurrentRequestEpoch());
      return true;
    });
    assert.equal(replyRequests, 0);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("explicit IBKR reply continuation sends only the chosen decision", async () => {
  const previousFetch = globalThis.fetch;
  const requests: Array<{ path: string; body: unknown }> = [];
  globalThis.fetch = (async (input, init) => {
    const path = new URL(String(input)).pathname;
    requests.push({
      path,
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    if (path.endsWith("/iserver/reply/reply-decline")) {
      return Response.json({ status: "discarded" });
    }
    if (path.endsWith("/iserver/reply/reply-accept")) {
      return Response.json([
        {
          id: "reply-next",
          message: ["Review the next warning."],
        },
      ]);
    }
    throw new Error(`unexpected IBKR request: ${path}`);
  }) as typeof fetch;

  try {
    const client = new IbkrClient(config());
    assert.deepEqual(
      await client.replyOrderWarning({
        replyId: "reply-decline",
        confirmed: false,
        expectedRequestEpoch: client.getCurrentRequestEpoch(),
      }),
      { kind: "declined" },
    );
    const nextWarning = await client.replyOrderWarning({
      replyId: "reply-accept",
      confirmed: true,
      expectedRequestEpoch: client.getCurrentRequestEpoch(),
    });
    assert.deepEqual(nextWarning, {
      kind: "warning",
      replyId: "reply-next",
      messages: ["Review the next warning."],
      requestEpoch: client.getCurrentRequestEpoch(),
    });
    assert.deepEqual(requests, [
      {
        path: "/v1/api/iserver/reply/reply-decline",
        body: { confirmed: false },
      },
      {
        path: "/v1/api/iserver/reply/reply-accept",
        body: { confirmed: true },
      },
    ]);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("IBKR decline replies require an unambiguous discarded acknowledgement", async () => {
  const previousFetch = globalThis.fetch;
  const responses: Record<string, unknown> = {
    malformed: {},
    error: { error: "Decline failed" },
    order: { order_id: "order-1" },
    warning: { id: "reply-next" },
    mixed: { status: "discarded", error: "Conflicting result" },
  };
  globalThis.fetch = (async (input) => {
    const replyId = new URL(String(input)).pathname.split("/").at(-1) ?? "";
    return Response.json(responses[replyId]);
  }) as typeof fetch;

  try {
    const client = new IbkrClient(config());
    for (const replyId of Object.keys(responses)) {
      await assert.rejects(
        client.replyOrderWarning({
          replyId,
          confirmed: false,
          expectedRequestEpoch: client.getCurrentRequestEpoch(),
        }),
        (error: unknown) => {
          assert.equal(
            (error as { code?: string }).code,
            "ibkr_ambiguous_order_ack",
          );
          return true;
        },
      );
    }
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("IBKR request epochs are shared by base URL across client instances", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    Response.json({ status: "discarded" })) as typeof fetch;

  try {
    const firstClient = new IbkrClient(config());
    const secondClient = new IbkrClient(config());
    const startingEpoch = firstClient.getCurrentRequestEpoch();

    const firstReply = firstClient.replyOrderWarning({
      replyId: "first",
      confirmed: false,
      expectedRequestEpoch: startingEpoch,
    });
    await firstReply;
    assert.equal(firstClient.getCurrentRequestEpoch(), startingEpoch + 1);
    assert.equal(secondClient.getCurrentRequestEpoch(), startingEpoch + 1);

    await secondClient.replyOrderWarning({
      replyId: "second",
      confirmed: false,
      expectedRequestEpoch: secondClient.getCurrentRequestEpoch(),
    });
    assert.equal(firstClient.getCurrentRequestEpoch(), startingEpoch + 2);
    assert.equal(secondClient.getCurrentRequestEpoch(), startingEpoch + 2);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("IBKR warning reply rechecks its epoch after waiting for a request permit", async () => {
  const previousFetch = globalThis.fetch;
  const previousRequestsPerSecond = process.env["IBKR_REQUESTS_PER_SECOND"];
  let replyFetched = false;
  globalThis.fetch = (async (input) => {
    const path = new URL(String(input)).pathname;
    if (path.includes("/iserver/reply/")) replyFetched = true;
    return Response.json(
      path.includes("/iserver/reply/") ? { status: "discarded" } : {},
    );
  }) as typeof fetch;

  try {
    process.env["IBKR_REQUESTS_PER_SECOND"] = "1";
    const scopedConfig = {
      ...config(),
      baseUrl: "http://127.0.0.1:15002/v1/api",
    };
    const throttledClient = new IbkrClient(scopedConfig);
    const interleavingClient = new IbkrClient(scopedConfig);
    await throttledClient.tickleSession();
    const expectedRequestEpoch = throttledClient.getCurrentRequestEpoch();

    const reply = throttledClient.replyOrderWarning({
      replyId: "must-not-send",
      confirmed: false,
      expectedRequestEpoch,
    });
    await interleavingClient.tickleSession();
    await assert.rejects(reply, (error: unknown) => {
      assert.equal(
        (error as { code?: string }).code,
        "ibkr_order_reply_epoch_changed",
      );
      return true;
    });
    assert.equal(replyFetched, false);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousRequestsPerSecond === undefined) {
      delete process.env["IBKR_REQUESTS_PER_SECOND"];
    } else {
      process.env["IBKR_REQUESTS_PER_SECOND"] = previousRequestsPerSecond;
    }
  }
});

test("IBKR warning reply rejects a stale epoch before any HTTP request", async () => {
  const previousFetch = globalThis.fetch;
  let fetched = false;
  globalThis.fetch = (async () => {
    fetched = true;
    return Response.json({ status: "discarded" });
  }) as typeof fetch;

  try {
    const client = new IbkrClient(config());
    const currentEpoch = client.getCurrentRequestEpoch();
    await assert.rejects(
      client.replyOrderWarning({
        replyId: "stale",
        confirmed: false,
        expectedRequestEpoch: currentEpoch + 1,
      }),
      (error: unknown) => {
        assert.equal(
          (error as { code?: string }).code,
          "ibkr_order_reply_epoch_changed",
        );
        return true;
      },
    );
    assert.equal(fetched, false);
    assert.equal(client.getCurrentRequestEpoch(), currentEpoch);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("IBKR object acknowledgement errors fail closed as broker rejection", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async (input) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("/iserver/accounts")) {
      return Response.json({ accounts: ["U1234567"], isPaper: false });
    }
    if (path.endsWith("/iserver/secdef/search")) {
      return Response.json([
        { symbol: "AAPL", conid: 265598, description: "NASDAQ" },
      ]);
    }
    if (path.endsWith("/iserver/account/U1234567/orders")) {
      return Response.json({ error: "Invalid order price fields" });
    }
    throw new Error(`unexpected IBKR request: ${path}`);
  }) as typeof fetch;

  try {
    await assert.rejects(
      new IbkrClient(config()).placeOrder(order),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, "ibkr_order_rejected");
        return true;
      },
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("IBKR mixed order acknowledgement and error requires reconciliation", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async (input) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("/iserver/accounts")) {
      return Response.json({ accounts: ["U1234567"], isPaper: false });
    }
    if (path.endsWith("/iserver/secdef/search")) {
      return Response.json([
        { symbol: "AAPL", conid: 265598, description: "NASDAQ" },
      ]);
    }
    if (path.endsWith("/iserver/account/U1234567/orders")) {
      return Response.json({
        order_id: "order-1",
        order_status: "Submitted",
        error: "Broker also reported an error",
      });
    }
    throw new Error(`unexpected IBKR request: ${path}`);
  }) as typeof fetch;

  try {
    await assert.rejects(
      new IbkrClient(config()).placeOrder(order),
      (error: unknown) => {
        assert.equal(
          (error as { code?: string }).code,
          "ibkr_ambiguous_order_ack",
        );
        return true;
      },
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("IBKR mixed warning acknowledgement and error requires reconciliation", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async (input) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("/iserver/accounts")) {
      return Response.json({ accounts: ["U1234567"], isPaper: false });
    }
    if (path.endsWith("/iserver/secdef/search")) {
      return Response.json([
        { symbol: "AAPL", conid: 265598, description: "NASDAQ" },
      ]);
    }
    if (path.endsWith("/iserver/account/U1234567/orders")) {
      return Response.json({
        id: "reply-1",
        message: ["Review this order warning."],
        error: "Broker also reported an error",
      });
    }
    throw new Error(`unexpected IBKR request: ${path}`);
  }) as typeof fetch;

  try {
    await assert.rejects(
      new IbkrClient(config()).placeOrder(order),
      (error: unknown) => {
        assert.equal(
          (error as { code?: string }).code,
          "ibkr_ambiguous_order_ack",
        );
        return true;
      },
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("IBKR initial order acknowledgement cardinality is fail-closed", async () => {
  const previousFetch = globalThis.fetch;
  const payloads: unknown[] = [
    [{ order_id: "order-1" }, { order_id: "order-2" }],
    [{ id: "reply-1" }, { id: "reply-2" }],
    [{ order_id: "order-1" }, { id: "reply-1" }],
    [{ order_id: "order-1" }, { unrecognized: "outcome" }],
    [{ id: "reply-1" }, { unrecognized: "outcome" }],
  ];
  let payloadIndex = 0;
  globalThis.fetch = (async (input) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("/iserver/accounts")) {
      return Response.json({ accounts: ["U1234567"], isPaper: false });
    }
    if (path.endsWith("/iserver/secdef/search")) {
      return Response.json([
        { symbol: "AAPL", conid: 265598, description: "NASDAQ" },
      ]);
    }
    if (path.endsWith("/iserver/account/U1234567/orders")) {
      return Response.json(payloads[payloadIndex++]);
    }
    throw new Error(`unexpected IBKR request: ${path}`);
  }) as typeof fetch;

  try {
    for (const _payload of payloads) {
      await assert.rejects(
        new IbkrClient(config()).placeOrder(order),
        (error: unknown) => {
          assert.equal(
            (error as { code?: string }).code,
            "ibkr_ambiguous_order_ack",
          );
          return true;
        },
      );
    }
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("IBKR mixed reply acknowledgement and error requires reconciliation", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async (input) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("/iserver/reply/reply-mixed")) {
      return Response.json([
        {
          order_id: "order-1",
          order_status: "Submitted",
          error: "Broker also reported an error",
        },
      ]);
    }
    throw new Error(`unexpected IBKR request: ${path}`);
  }) as typeof fetch;

  try {
    await assert.rejects(
      (() => {
        const client = new IbkrClient(config());
        return client.replyOrderWarning({
        replyId: "reply-mixed",
        confirmed: true,
          expectedRequestEpoch: client.getCurrentRequestEpoch(),
        });
      })(),
      (error: unknown) => {
        assert.equal(
          (error as { code?: string }).code,
          "ibkr_ambiguous_order_ack",
        );
        return true;
      },
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("IBKR mixed next-warning reply and error requires reconciliation", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async (input) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("/iserver/reply/reply-mixed-warning")) {
      return Response.json([
        {
          id: "reply-next",
          message: ["Review the next warning."],
          error: "Broker also reported an error",
        },
      ]);
    }
    throw new Error(`unexpected IBKR request: ${path}`);
  }) as typeof fetch;

  try {
    await assert.rejects(
      (() => {
        const client = new IbkrClient(config());
        return client.replyOrderWarning({
        replyId: "reply-mixed-warning",
        confirmed: true,
          expectedRequestEpoch: client.getCurrentRequestEpoch(),
        });
      })(),
      (error: unknown) => {
        assert.equal(
          (error as { code?: string }).code,
          "ibkr_ambiguous_order_ack",
        );
        return true;
      },
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("IBKR continued reply acknowledgement cardinality is fail-closed", async () => {
  const previousFetch = globalThis.fetch;
  const payloads: Record<string, unknown> = {
    orders: [{ order_id: "order-1" }, { order_id: "order-2" }],
    warnings: [{ id: "reply-1" }, { id: "reply-2" }],
    combined: [{ order_id: "order-1" }, { id: "reply-1" }],
    orderAndUnknown: [
      { order_id: "order-1" },
      { unrecognized: "outcome" },
    ],
    warningAndUnknown: [
      { id: "reply-1" },
      { unrecognized: "outcome" },
    ],
  };
  globalThis.fetch = (async (input) => {
    const replyId = new URL(String(input)).pathname.split("/").at(-1) ?? "";
    return Response.json(payloads[replyId]);
  }) as typeof fetch;

  try {
    const client = new IbkrClient(config());
    for (const replyId of Object.keys(payloads)) {
      await assert.rejects(
        client.replyOrderWarning({
          replyId,
          confirmed: true,
          expectedRequestEpoch: client.getCurrentRequestEpoch(),
        }),
        (error: unknown) => {
          assert.equal(
            (error as { code?: string }).code,
            "ibkr_ambiguous_order_ack",
          );
          return true;
        },
      );
    }
  } finally {
    globalThis.fetch = previousFetch;
  }
});
