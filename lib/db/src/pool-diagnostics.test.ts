import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import pg from "pg";

import {
  setDbAdmissionDiagnosticsSource,
  type DbAdmissionDiagnostics,
} from "./admission";
import type { PostgresPoolDiagnosticEvent } from "./index";

type FakeQueryResult = { rows: Array<{ sql: string }> };

class FakePoolClient extends EventEmitter {
  release(): void {}

  query(...args: unknown[]): unknown {
    const sql = typeof args[0] === "string" ? args[0] : "unknown";
    const result: FakeQueryResult = { rows: [{ sql }] };
    const lastArg = args[args.length - 1];
    if (typeof lastArg === "function") {
      setTimeout(() => lastArg(null, result), 5);
      return undefined;
    }
    return new Promise<FakeQueryResult>((resolve) => {
      setTimeout(() => resolve(result), 5);
    });
  }
}

const poolPrototype = pg.Pool.prototype as unknown as {
  connect: (...args: unknown[]) => unknown;
};
const originalConnect = poolPrototype.connect;
const previousDatabaseUrl = process.env["DATABASE_URL"];
process.env["DATABASE_URL"] =
  previousDatabaseUrl ?? "postgresql://test:test@127.0.0.1:5432/test";
poolPrototype.connect = () => Promise.resolve(new FakePoolClient());

const dbModule = await (async () => {
  try {
    return await import("./index");
  } finally {
    poolPrototype.connect = originalConnect;
    if (previousDatabaseUrl === undefined) {
      delete process.env["DATABASE_URL"];
    } else {
      process.env["DATABASE_URL"] = previousDatabaseUrl;
    }
  }
})();

const {
  getPoolStats,
  pool,
  runWithPostgresDiagnosticContext,
  setPostgresPoolDiagnosticListener,
} = dbModule;

async function captureSlowQueryEvents(
  run: () => Promise<unknown>,
): Promise<PostgresPoolDiagnosticEvent[]> {
  const previousThreshold = process.env["DB_QUERY_SLOW_DIAGNOSTIC_MS"];
  const events: PostgresPoolDiagnosticEvent[] = [];
  process.env["DB_QUERY_SLOW_DIAGNOSTIC_MS"] = "1";
  setPostgresPoolDiagnosticListener((event) => events.push(event));
  try {
    await run();
    return events.filter((event) => event.type === "query");
  } finally {
    setPostgresPoolDiagnosticListener(null);
    if (previousThreshold === undefined) {
      delete process.env["DB_QUERY_SLOW_DIAGNOSTIC_MS"];
    } else {
      process.env["DB_QUERY_SLOW_DIAGNOSTIC_MS"] = previousThreshold;
    }
  }
}

test("pool.query emits one canonical outer query with inner execution duration", async () => {
  const events = await captureSlowQueryEvents(() =>
    runWithPostgresDiagnosticContext(
      { route: "GET /outer", workloadFamily: "outer-query" },
      () => pool.query("select ordinary_pool_query"),
    ),
  );

  assert.deepEqual(
    events.map((event) => event.source),
    ["pool"],
  );
  assert.equal(events[0]?.context?.route, "GET /outer");
  assert.equal(typeof events[0]?.executionDurationMs, "number");
  assert.ok(
    events[0]!.durationMs >= events[0]!.executionDurationMs!,
    "end-to-end duration must include client execution",
  );
});

test("checked-out client queries remain canonical", async () => {
  const client = await pool.connect();
  try {
    const events = await captureSlowQueryEvents(() =>
      runWithPostgresDiagnosticContext(
        { route: "GET /explicit", workloadFamily: "explicit-client" },
        () => client.query("select explicit_client_query"),
      ),
    );

    assert.equal(events.length, 1);
    assert.equal(events[0]?.source, "client");
    assert.equal(events[0]?.sql, "select explicit_client_query");
    assert.equal(events[0]?.context?.route, "GET /explicit");
  } finally {
    client.release();
  }
});

test("pool stats separate raw and admission waiting without changing waiting", () => {
  const admission: DbAdmissionDiagnostics = {
    interactive: {
      queued: 2,
      inFlight: 0,
      admittedTotal: 0,
      maxWaitMs: 0,
      recentWaitMsP95: 0,
    },
    bulk: {
      queued: 3,
      inFlight: 0,
      admittedTotal: 0,
      maxWaitMs: 0,
      recentWaitMsP95: 0,
    },
    background: {
      queued: 5,
      inFlight: 0,
      admittedTotal: 0,
      maxWaitMs: 0,
      recentWaitMsP95: 0,
    },
  };
  const waitingDescriptor = Object.getOwnPropertyDescriptor(pool, "waitingCount");
  Object.defineProperty(pool, "waitingCount", {
    configurable: true,
    value: 4,
  });
  setDbAdmissionDiagnosticsSource(() => admission);

  try {
    const stats = getPoolStats();
    assert.equal(stats.waiting, 4);
    assert.equal(stats.rawPoolWaiting, 4);
    assert.equal(stats.admissionWaiting, 10);
    assert.equal(stats.totalWaiting, 14);
    assert.equal(stats.admission, admission);
  } finally {
    setDbAdmissionDiagnosticsSource(null);
    if (waitingDescriptor) {
      Object.defineProperty(pool, "waitingCount", waitingDescriptor);
    } else {
      Reflect.deleteProperty(pool, "waitingCount");
    }
  }
});
