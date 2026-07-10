import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
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

      const authenticated = await connect(url, { cookie, origin });
      assert.equal(authenticated.opened, true);
      if (authenticated.opened) authenticated.socket.close();
    } finally {
      server.close();
      await once(server, "close");
    }
  });
});

test("option quote websocket has a bounded default subscription ceiling", () => {
  assert.equal(
    __optionQuoteWsInternalsForTests.maxSubscriptionsPerConnection,
    1_024,
  );
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
