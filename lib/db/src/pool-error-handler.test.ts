// Run:
//   pnpm --filter @workspace/db exec tsx --test --test-force-exit src/pool-error-handler.test.ts
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import {
  __resetPostgresPoolErrorHandlerForTests,
  attachPostgresClientErrorHandler,
  attachPostgresPoolErrorHandler,
  type PostgresClientErrorReport,
  type PostgresPoolErrorReport,
} from "./pool-error-handler";

const describeRuntime = () => ({
  configured: true,
  source: "test",
  host: "test",
  database: "test",
  helium: false,
});

test("checked-out client error is captured instead of crashing the process", () => {
  __resetPostgresPoolErrorHandlerForTests();
  const pool = new EventEmitter();
  const reports: PostgresPoolErrorReport[] = [];
  attachPostgresPoolErrorHandler(pool as never, {
    reporter: (report) => reports.push(report),
    describeRuntime: describeRuntime as never,
  });

  // Pool hands out a client; the server later terminates it while checked out
  // (idle_in_transaction_session_timeout). The client emits "error" directly.
  const client = new EventEmitter();
  pool.emit("connect", client);
  pool.emit("acquire", client);
  assert.equal(client.listenerCount("error"), 1);

  // Without the connect-time listener this emit would throw ERR_UNHANDLED_ERROR.
  client.emit(
    "error",
    Object.assign(
      new Error("terminating connection due to idle-in-transaction timeout"),
      { code: "57P01" },
    ),
  );
  assert.equal(reports.length, 1);
  assert.equal(reports[0].event, "postgres-pool-error");
});

test("per-client listener attaches once per client", () => {
  __resetPostgresPoolErrorHandlerForTests();
  const pool = new EventEmitter();
  attachPostgresPoolErrorHandler(pool as never, {
    reporter: () => {},
    describeRuntime: describeRuntime as never,
  });
  const client = new EventEmitter();
  pool.emit("connect", client);
  pool.emit("connect", client);
  assert.equal(client.listenerCount("error"), 1);
});

test("pool-level error path still reports (idle-client errors)", () => {
  __resetPostgresPoolErrorHandlerForTests();
  const pool = new EventEmitter();
  const reports: PostgresPoolErrorReport[] = [];
  attachPostgresPoolErrorHandler(pool as never, {
    reporter: (report) => reports.push(report),
    describeRuntime: describeRuntime as never,
  });
  pool.emit("error", new Error("idle client error"), {});
  assert.equal(reports.length, 1);
});

test("pool reports do not echo a credential-shaped client database", () => {
  __resetPostgresPoolErrorHandlerForTests();
  const pool = new EventEmitter();
  const reports: PostgresPoolErrorReport[] = [];
  const secret = "pool-client-database-secret";
  attachPostgresPoolErrorHandler(pool as never, {
    reporter: (report) => reports.push(report),
    describeRuntime: describeRuntime as never,
  });

  pool.emit("error", new Error("idle client error"), {
    processID: 1,
    database: `postgres://alice:${secret}@fallback.invalid/pyrus`,
  });

  assert.equal("database" in reports[0]!.client, false);
  assert.equal(JSON.stringify(reports).includes(secret), false);
});

test("idle-client errors report only through the pool-level path", () => {
  __resetPostgresPoolErrorHandlerForTests();
  const pool = new EventEmitter();
  const reports: PostgresPoolErrorReport[] = [];
  attachPostgresPoolErrorHandler(pool as never, {
    reporter: (report) => reports.push(report),
    describeRuntime: describeRuntime as never,
  });
  const client = new EventEmitter();
  const error = new Error("idle client error");
  pool.emit("connect", client);
  pool.emit("acquire", client);
  pool.emit("release", undefined, client);

  client.emit("error", error);
  pool.emit("error", error, client);

  assert.equal(reports.length, 1);
});

test("client reports reject credential-shaped and oversized contexts", () => {
  for (const context of [
    "password=reporter-context-secret",
    "x".repeat(4_097),
  ]) {
    const client = new EventEmitter();
    const reports: PostgresClientErrorReport[] = [];
    const detach = attachPostgresClientErrorHandler(client, {
      context,
      reporter: (report) => reports.push(report),
      describeRuntime: describeRuntime as never,
    });

    client.emit("error", new Error("synthetic client error"));

    assert.equal(reports.length, 1);
    assert.equal(reports[0]!.context, null);
    assert.equal(JSON.stringify(reports).includes(context), false);
    detach();
  }
});
