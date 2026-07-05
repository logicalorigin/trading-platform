import assert from "node:assert/strict";
import test from "node:test";

import { brokerConnectionsTable } from "@workspace/db";
import { withTestDb } from "@workspace/db/testing";
import { listBrokerConnections } from "./platform";

test("listBrokerConnections appends persisted connected SnapTrade brokerages", async () => {
  await withTestDb(async ({ db }) => {
    const [row] = await db
      .insert(brokerConnectionsTable)
      .values({
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
      name: "snaptrade:disabled-connection",
      connectionType: "broker",
      brokerProvider: "snaptrade",
      mode: "live",
      status: "disconnected",
      capabilities: ["snaptrade", "snaptrade-brokerage:ALPACA", "read-only"],
    });

    const { connections } = await listBrokerConnections();
    const snaptrade = connections.filter(
      (connection) => connection.provider === "snaptrade",
    );

    assert.equal(snaptrade.length, 1);
    assert.equal(snaptrade[0]?.id, row.id);
    assert.equal(snaptrade[0]?.status, "connected");
    assert.equal(snaptrade[0]?.brokerageSlug, "ETRADE");
    assert.equal(snaptrade[0]?.mode, "live");

    // The hardcoded massive + IBKR entries remain intact alongside it.
    assert.ok(
      connections.some((connection) => connection.provider === "massive"),
    );
    assert.ok(connections.some((connection) => connection.provider === "ibkr"));
  });
});

test("listBrokerConnections degrades to the hardcoded list on a DB error", async () => {
  await withTestDb(async ({ client }) => {
    // Force a real read failure: the SnapTrade query targets a missing relation.
    await client.exec("DROP TABLE broker_connections CASCADE");

    const { connections } = await listBrokerConnections();

    assert.ok(
      connections.some((connection) => connection.provider === "massive"),
    );
    assert.ok(connections.some((connection) => connection.provider === "ibkr"));
    assert.ok(
      !connections.some((connection) => connection.provider === "snaptrade"),
    );
  });
});
