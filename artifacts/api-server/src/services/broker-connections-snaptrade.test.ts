import assert from "node:assert/strict";
import test from "node:test";

import { brokerConnectionsTable, usersTable } from "@workspace/db";
import { withTestDb } from "@workspace/db/testing";
import { listBrokerConnections } from "./platform";

test("listBrokerConnections returns only the user's persisted brokerages", async () => {
  await withTestDb(async ({ db }) => {
    const [user, otherUser] = await db
      .insert(usersTable)
      .values([
        {
          email: "broker-connections-owner@example.com",
          passwordHash: "unused-hash",
          role: "member",
        },
        {
          email: "broker-connections-other@example.com",
          passwordHash: "unused-hash",
          role: "member",
        },
      ])
      .returning({ id: usersTable.id });
    assert.ok(user);
    assert.ok(otherUser);
    const [row] = await db
      .insert(brokerConnectionsTable)
      .values({
        appUserId: user.id,
        name: "snaptrade:etrade-connection",
        connectionType: "broker",
        brokerProvider: "snaptrade",
        mode: "live",
        status: "connected",
        capabilities: [
          "accounts",
          "positions",
          "snaptrade",
          "snaptrade-brokerage:ETRADE",
          "orders",
          "executions",
          "execution-ready",
        ],
      })
      .returning({ id: brokerConnectionsTable.id });
    assert.ok(row);

    // A disabled connection persists as status "disconnected" and must be excluded.
    await db.insert(brokerConnectionsTable).values({
      appUserId: user.id,
      name: "snaptrade:disabled-connection",
      connectionType: "broker",
      brokerProvider: "snaptrade",
      mode: "live",
      status: "disconnected",
      capabilities: ["snaptrade", "snaptrade-brokerage:ALPACA", "read-only"],
    });
    const persistedRows = await db
      .insert(brokerConnectionsTable)
      .values([
        {
          appUserId: otherUser.id,
          name: "snaptrade:other-user",
          connectionType: "broker",
          brokerProvider: "snaptrade",
          mode: "live",
          status: "connected",
          capabilities: ["snaptrade", "snaptrade-brokerage:ALPACA"],
        },
        {
          appUserId: user.id,
          name: "robinhood:owner",
          connectionType: "broker",
          brokerProvider: "robinhood",
          mode: "live",
          status: "connected",
          capabilities: ["robinhood", "accounts"],
        },
        {
          appUserId: otherUser.id,
          name: "robinhood:other-user",
          connectionType: "broker",
          brokerProvider: "robinhood",
          mode: "live",
          status: "connected",
          capabilities: ["robinhood", "accounts"],
        },
      ])
      .returning({
        appUserId: brokerConnectionsTable.appUserId,
        brokerProvider: brokerConnectionsTable.brokerProvider,
        id: brokerConnectionsTable.id,
      });
    const ownerRobinhood = persistedRows.find(
      (persisted) =>
        persisted.appUserId === user.id &&
        persisted.brokerProvider === "robinhood",
    );
    assert.ok(ownerRobinhood);

    const { connections } = await listBrokerConnections(user.id);
    const snaptrade = connections.filter(
      (connection) => connection.provider === "snaptrade",
    );
    const robinhood = connections.filter(
      (connection) => connection.provider === "robinhood",
    );

    assert.equal(snaptrade.length, 1);
    assert.equal(snaptrade[0]?.id, row.id);
    assert.equal(snaptrade[0]?.status, "connected");
    assert.equal(snaptrade[0]?.brokerageSlug, "ETRADE");
    assert.equal(snaptrade[0]?.mode, "live");
    assert.equal(robinhood.length, 1);
    assert.equal(robinhood[0]?.id, ownerRobinhood.id);
    assert.equal(robinhood[0]?.name, "Robinhood Agentic");

    // Client Portal is the retained live IBKR connection; the retired desktop
    // transport and paper-only catalog entry must not reappear.
    assert.ok(
      connections.some((connection) => connection.provider === "massive"),
    );
    const ibkr = connections.filter(
      (connection) => connection.provider === "ibkr",
    );
    assert.deepEqual(
      ibkr.map((connection) => connection.id),
      ["ibkr-live"],
    );
    assert.equal(ibkr[0]?.name, "Interactive Brokers Client Portal");
    assert.equal(ibkr[0]?.mode, "live");
    assert.ok(ibkr[0]?.capabilities.includes("live-trading"));
    assert.ok(!ibkr[0]?.capabilities.includes("paper-trading"));
  });
});

test("listBrokerConnections degrades to the hardcoded list on a DB error", async () => {
  await withTestDb(async ({ client, db }) => {
    const [user] = await db
      .insert(usersTable)
      .values({
        email: "broker-connections-db-error@example.com",
        passwordHash: "unused-hash",
        role: "member",
      })
      .returning({ id: usersTable.id });
    assert.ok(user);
    // Force a real read failure: the SnapTrade query targets a missing relation.
    await client.exec("DROP TABLE broker_connections CASCADE");

    const { connections } = await listBrokerConnections(user.id);

    assert.ok(
      connections.some((connection) => connection.provider === "massive"),
    );
    assert.ok(connections.some((connection) => connection.provider === "ibkr"));
    assert.ok(
      !connections.some((connection) => connection.provider === "snaptrade"),
    );
  });
});
