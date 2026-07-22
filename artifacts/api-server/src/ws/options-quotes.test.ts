import assert from "node:assert/strict";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { connect as connectTcp, type AddressInfo } from "node:net";
import test from "node:test";
import { WebSocket } from "ws";

import { db, usersTable } from "@workspace/db";
import { withTestDb } from "@workspace/db/testing";
import { createAuthSession } from "../services/auth";
import {
  __optionQuoteWsInternalsForTests,
  attachOptionQuoteWebSocket,
} from "./options-quotes";

type UpgradeResult =
  | { opened: true; socket: WebSocket }
  | { opened: false; statusCode: number };

async function connect(
  url: string,
  headers: Record<string, string> = {},
): Promise<UpgradeResult> {
  const socket = new WebSocket(url, { headers });
  return new Promise((resolve, reject) => {
    socket.once("open", () => resolve({ opened: true, socket }));
    socket.once("unexpected-response", (_request, response) => {
      response.resume();
      resolve({ opened: false, statusCode: response.statusCode ?? 0 });
    });
    socket.once("error", reject);
  });
}

async function rawUpgrade(port: number, requestTarget: string): Promise<string> {
  const socket = connectTcp(port, "127.0.0.1");
  socket.setEncoding("utf8");
  await once(socket, "connect");
  const response = new Promise<string>((resolve, reject) => {
    socket.once("data", resolve);
    socket.once("error", reject);
  });
  socket.write(
    `GET ${requestTarget} HTTP/1.1\r\n` +
      `Host: 127.0.0.1:${port}\r\n` +
      "Connection: Upgrade\r\n" +
      "Upgrade: websocket\r\n\r\n",
  );
  const firstChunk = await response;
  socket.destroy();
  return firstChunk;
}

test("option quote websocket requires a same-origin authenticated session", async () => {
  await withTestDb(async () => {
    const [user] = await db
      .insert(usersTable)
      .values({ email: "option-quotes@example.test", role: "member" })
      .returning();
    const session = await createAuthSession({ userId: user!.id });
    const server = createServer();
    attachOptionQuoteWebSocket(server);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;
    const url = `ws://127.0.0.1:${port}/api/ws/options/quotes`;
    const origin = `http://127.0.0.1:${port}`;
    const cookie = `pyrus_session=${session.sessionToken}`;

    try {
      const anonymous = await connect(url, { origin });
      if (anonymous.opened) anonymous.socket.terminate();
      assert.equal(anonymous.opened, false);
      if (!anonymous.opened) assert.equal(anonymous.statusCode, 401);

      const crossOrigin = await connect(url, {
        cookie,
        origin: "https://attacker.example",
      });
      if (crossOrigin.opened) crossOrigin.socket.terminate();
      assert.equal(crossOrigin.opened, false);
      if (!crossOrigin.opened) assert.equal(crossOrigin.statusCode, 403);

      const trustedProxyOrigin = "https://preview.example";
      const trustedProxy = await connect(url, {
        cookie,
        origin: trustedProxyOrigin,
        "x-forwarded-host": new URL(trustedProxyOrigin).host,
      });
      assert.equal(trustedProxy.opened, true);
      if (trustedProxy.opened) trustedProxy.socket.close();

      const authenticated = await connect(url, { cookie, origin });
      assert.equal(authenticated.opened, true);
      if (authenticated.opened) authenticated.socket.close();
    } finally {
      server.close();
      await once(server, "close");
    }
  });
});

test("option quote websocket has bounded connection, message, and demand defaults", () => {
  assert.equal(
    __optionQuoteWsInternalsForTests.maxSubscriptionsPerConnection,
    1_024,
  );
  assert.equal(__optionQuoteWsInternalsForTests.maxConnectionsPerUser, 4);
  assert.equal(__optionQuoteWsInternalsForTests.maxMessageBytes, 128 * 1_024);
  assert.equal(__optionQuoteWsInternalsForTests.subscribeMessageBurst, 10);
});

test("option quote websocket heartbeats publish per-contract coverage degradation", () => {
  const coverage =
    __optionQuoteWsInternalsForTests.buildOptionQuoteCoverageStatus({
      quotes: [
        {
          providerContractId: "O:STALE260821C00000500",
          freshness: "stale",
        },
        {
          providerContractId: "O:LIVE260821C00000500",
          freshness: "live",
        },
      ],
      debug: {
        returnedCount: 2,
        missingProviderContractIds: ["O:MISSING260821C00000500"],
      },
    });
  assert.deepEqual(coverage, {
    returnedCount: 2,
    missingProviderContractIds: ["O:MISSING260821C00000500"],
    staleProviderContractIds: ["O:STALE260821C00000500"],
  });

  const source = readFileSync(new URL("./options-quotes.ts", import.meta.url), "utf8");
  const heartbeat = source.match(
    /const heartbeatTimer = setInterval\(\(\) => \{[\s\S]*?\n    }, HEARTBEAT_INTERVAL_MS\);/,
  )?.[0];
  assert.ok(heartbeat, "Missing option quote heartbeat");
  assert.match(heartbeat, /readOptionQuoteDemandSnapshotPayload/);
  assert.match(heartbeat, /buildOptionQuoteCoverageStatus/);
});

test("option quote websocket rejects a malformed upgrade target without throwing", async () => {
  const server = createServer();
  attachOptionQuoteWebSocket(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;

  try {
    assert.match(await rawUpgrade(port, "http://["), /^HTTP\/1\.1 400 /);
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("option quote websocket enforces and releases the per-user connection ceiling", async () => {
  await withTestDb(async () => {
    const [user] = await db
      .insert(usersTable)
      .values({ email: "option-quotes-cap@example.test", role: "member" })
      .returning();
    const session = await createAuthSession({ userId: user!.id });
    const server = createServer();
    attachOptionQuoteWebSocket(server);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;
    const url = `ws://127.0.0.1:${port}/api/ws/options/quotes`;
    const headers = {
      cookie: `pyrus_session=${session.sessionToken}`,
      origin: `http://127.0.0.1:${port}`,
    };
    const sockets: WebSocket[] = [];

    try {
      for (let index = 0; index < 4; index += 1) {
        const result = await connect(url, headers);
        assert.equal(result.opened, true);
        if (result.opened) sockets.push(result.socket);
      }

      const rejected = await connect(url, headers);
      if (rejected.opened) rejected.socket.terminate();
      assert.equal(rejected.opened, false);
      if (!rejected.opened) assert.equal(rejected.statusCode, 429);

      const released = sockets.pop()!;
      const closed = once(released, "close");
      released.close();
      await closed;

      const replacement = await connect(url, headers);
      assert.equal(replacement.opened, true);
      if (replacement.opened) sockets.push(replacement.socket);
    } finally {
      await Promise.all(
        sockets.map(async (socket) => {
          if (socket.readyState === WebSocket.CLOSED) return;
          const closed = once(socket, "close");
          socket.close();
          await closed;
        }),
      );
      server.close();
      await once(server, "close");
    }
  });
});

test("option quote websocket rejects demand above its hard subscription ceiling", async () => {
  await withTestDb(async () => {
    const [user] = await db
      .insert(usersTable)
      .values({ email: "option-quotes-demand@example.test", role: "member" })
      .returning();
    const session = await createAuthSession({ userId: user!.id });
    const server = createServer();
    attachOptionQuoteWebSocket(server);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;
    const result = await connect(
      `ws://127.0.0.1:${port}/api/ws/options/quotes`,
      {
        cookie: `pyrus_session=${session.sessionToken}`,
        origin: `http://127.0.0.1:${port}`,
      },
    );

    try {
      assert.equal(result.opened, true);
      if (!result.opened) return;
      const response = new Promise<unknown>((resolve) => {
        result.socket.once("message", (raw) => {
          resolve(JSON.parse(raw.toString()));
        });
      });
      result.socket.send(
        JSON.stringify({
          type: "subscribe",
          providerContractIds: Array.from(
            { length: 1_025 },
            (_, index) => `synthetic-${index}`,
          ),
        }),
      );
      assert.deepEqual(await response, {
        type: "error",
        error:
          "Option quote subscription requested 1025 contracts, above the ceiling of 1024.",
      });
    } finally {
      if (result.opened && result.socket.readyState !== WebSocket.CLOSED) {
        const closed = once(result.socket, "close");
        result.socket.close();
        await closed;
      }
      server.close();
      await once(server, "close");
    }
  });
});

test("option quote websocket closes a connection that churns subscriptions", async () => {
  await withTestDb(async () => {
    const [user] = await db
      .insert(usersTable)
      .values({ email: "option-quotes-churn@example.test", role: "member" })
      .returning();
    const session = await createAuthSession({ userId: user!.id });
    const server = createServer();
    attachOptionQuoteWebSocket(server);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;
    const result = await connect(
      `ws://127.0.0.1:${port}/api/ws/options/quotes`,
      {
        cookie: `pyrus_session=${session.sessionToken}`,
        origin: `http://127.0.0.1:${port}`,
      },
    );

    try {
      assert.equal(result.opened, true);
      if (!result.opened) return;
      const closed = once(result.socket, "close");
      for (let index = 0; index < 11; index += 1) {
        result.socket.send(JSON.stringify({ type: "invalid" }));
      }
      const [code, reason] = await closed;
      assert.equal(code, 1008);
      assert.equal(reason.toString(), "Option quote subscription rate exceeded.");
    } finally {
      if (result.opened && result.socket.readyState !== WebSocket.CLOSED) {
        result.socket.terminate();
      }
      server.close();
      await once(server, "close");
    }
  });
});

test("option quote websocket queue normalizes OPRA subscription ids before exact filtering", () => {
  const state = __optionQuoteWsInternalsForTests.createOptionQuoteQueueState();

  __optionQuoteWsInternalsForTests.resetOptionQuoteQueueSubscription(state, [
    "SPY260717C00500000",
  ]);
  __optionQuoteWsInternalsForTests.enqueueCurrentOptionQuotes(state, {
    quotes: [
      {
        providerContractId: "O:SPY260717C00500000",
        bid: 1.2,
        ask: 1.25,
      },
    ],
  });

  assert.deepEqual(
    __optionQuoteWsInternalsForTests.getPendingProviderContractIds(state),
    ["O:SPY260717C00500000"],
  );
});

test("option quote websocket demand owners are isolated per connection", () => {
  const requestedOwner = "account-position-option-quotes:U123:2-contracts";
  const first = __optionQuoteWsInternalsForTests.optionQuoteDemandOwnerForConnection(
    requestedOwner,
    1,
  );
  const second = __optionQuoteWsInternalsForTests.optionQuoteDemandOwnerForConnection(
    requestedOwner,
    2,
  );

  assert.notEqual(first, second);
  assert.match(first, /^account-position-option-quotes:U123:2-contracts:ws-1$/);
  assert.match(second, /^account-position-option-quotes:U123:2-contracts:ws-2$/);
});
