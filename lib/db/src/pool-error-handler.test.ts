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

class FakePool extends EventEmitter {}
class FakeClient extends EventEmitter {
  processID = 456;
  database = "heliumdb";
}

test.afterEach(() => {
  __resetPostgresPoolErrorHandlerForTests();
});

test("pool error handler attaches once per pool", () => {
  const pool = new FakePool();
  const firstAttach = attachPostgresPoolErrorHandler(pool);
  const secondAttach = attachPostgresPoolErrorHandler(pool);

  assert.equal(firstAttach, true);
  assert.equal(secondAttach, false);
  assert.equal(pool.listenerCount("error"), 1);
});

test("pool error handler reports transient errors without throwing", () => {
  const pool = new FakePool();
  const reports: PostgresPoolErrorReport[] = [];
  attachPostgresPoolErrorHandler(pool, {
    reporter: (report) => {
      reports.push(report);
    },
  });

  assert.doesNotThrow(() => {
    pool.emit("error", new Error("Connection terminated unexpectedly"), {
      processID: 123,
      database: "heliumdb",
    });
  });

  assert.equal(reports.length, 1);
  assert.equal(reports[0]?.event, "postgres-pool-error");
  assert.equal(reports[0]?.transient, true);
  assert.equal(reports[0]?.error.message, "Connection terminated unexpectedly");
  assert.equal(reports[0]?.client.processID, 123);
  assert.equal(reports[0]?.client.database, "heliumdb");
  assert.equal("url" in reports[0]!.database, false);
});

test("pool error handler reports non-transient errors without throwing", () => {
  const pool = new FakePool();
  const reports: PostgresPoolErrorReport[] = [];
  attachPostgresPoolErrorHandler(pool, {
    reporter: (report) => {
      reports.push(report);
    },
  });

  assert.doesNotThrow(() => {
    pool.emit("error", new Error("Unexpected application bug"));
  });

  assert.equal(reports.length, 1);
  assert.equal(reports[0]?.transient, false);
});

test("pool error handler swallows reporter failures", () => {
  const pool = new FakePool();
  attachPostgresPoolErrorHandler(pool, {
    reporter: () => {
      throw new Error("reporter unavailable");
    },
  });

  assert.doesNotThrow(() => {
    pool.emit("error", new Error("Connection terminated unexpectedly"));
  });
});

test("client error handler reports checked-out client errors without throwing", () => {
  const client = new FakeClient();
  const reports: PostgresClientErrorReport[] = [];
  let observedError: Error | null = null;
  const detach = attachPostgresClientErrorHandler(client, {
    context: "test-lock",
    onError: (error) => {
      observedError = error;
    },
    reporter: (report) => {
      reports.push(report);
    },
  });
  const error = Object.assign(
    new Error("terminating connection due to administrator command"),
    { code: "57P01" },
  );

  assert.doesNotThrow(() => {
    client.emit("error", error);
  });

  assert.equal(observedError, error);
  assert.equal(reports.length, 1);
  assert.equal(reports[0]?.event, "postgres-client-error");
  assert.equal(reports[0]?.transient, true);
  assert.equal(reports[0]?.context, "test-lock");
  assert.equal(reports[0]?.client.processID, 456);
  assert.equal(reports[0]?.client.database, "heliumdb");

  detach();
  assert.equal(client.listenerCount("error"), 0);
});
