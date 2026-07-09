// Run:
//   pnpm --filter @workspace/db exec tsx --test --test-force-exit src/pool-error-handler.test.ts
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import {
  __resetPostgresPoolErrorHandlerForTests,
  attachPostgresPoolErrorHandler,
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
