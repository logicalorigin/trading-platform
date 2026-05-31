import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import {
  __resetPostgresPoolErrorHandlerForTests,
  attachPostgresPoolErrorHandler,
  type PostgresPoolErrorReport,
} from "./pool-error-handler";

class FakePool extends EventEmitter {}

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
