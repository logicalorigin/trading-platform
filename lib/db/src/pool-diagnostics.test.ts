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

let fakeQueryError: Error | null = null;

class FakePoolClient extends EventEmitter {
  release(): void {}

  query(...args: unknown[]): unknown {
    const sql = typeof args[0] === "string" ? args[0] : "unknown";
    const result: FakeQueryResult = { rows: [{ sql }] };
    const error = fakeQueryError;
    const lastArg = args[args.length - 1];
    if (typeof lastArg === "function") {
      setTimeout(() => lastArg(error, result), 5);
      return undefined;
    }
    return new Promise<FakeQueryResult>((resolve, reject) => {
      setTimeout(() => (error ? reject(error) : resolve(result)), 5);
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
  runInDbLane,
  runWithDbAdmissionSignal,
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
    runInDbLane("background", () =>
      runWithPostgresDiagnosticContext(
        { route: "GET /outer", workloadFamily: "outer-query" },
        () => pool.query("select ordinary_pool_query"),
      ),
    ),
  );

  assert.deepEqual(
    events.map((event) => event.source),
    ["pool"],
  );
  assert.equal(events[0]?.context?.route, "GET /outer");
  assert.equal(events[0]?.lane, "background");
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
    assert.equal(events[0]?.sql, null);
    assert.equal(events[0]?.context?.route, "GET /explicit");
  } finally {
    client.release();
  }
});

test("every shared-pool connect path is admission-accounted", async () => {
  const before = getPoolStats().admission?.interactive.admittedTotal ?? 0;

  const client = await pool.connect();
  client.release();
  await pool.query("select scheduler_accounted_pool_query");

  const after = getPoolStats().admission?.interactive.admittedTotal ?? 0;
  assert.equal(after - before, 2);
});

test("request cancellation is not reported as a database failure", async () => {
  const controller = new AbortController();
  const events: PostgresPoolDiagnosticEvent[] = [];
  const canceledBefore =
    getPoolStats().admission?.interactive.canceledTotal ?? 0;
  controller.abort();
  setPostgresPoolDiagnosticListener((event) => events.push(event));

  try {
    await assert.rejects(
      runWithDbAdmissionSignal(controller.signal, () =>
        pool.query("select canceled_request_query"),
      ),
      (error: unknown) =>
        error instanceof Error && error.name === "AbortError",
    );
    assert.deepEqual(events, []);
    assert.equal(
      getPoolStats().admission?.interactive.canceledTotal,
      canceledBefore + 1,
    );
  } finally {
    setPostgresPoolDiagnosticListener(null);
  }
});

test("callback-form shared connect and query are admission-accounted", async () => {
  const before = getPoolStats().admission?.interactive.admittedTotal ?? 0;

  await new Promise<void>((resolve, reject) => {
    pool.connect((error, client, release) => {
      if (error || !client) {
        reject(error ?? new Error("Pool callback returned no client."));
        return;
      }
      release();
      resolve();
    });
  });
  await new Promise<void>((resolve, reject) => {
    pool.query(
      "select scheduler_accounted_callback_query",
      (error: Error | null | undefined) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      },
    );
  });

  const after = getPoolStats().admission?.interactive.admittedTotal ?? 0;
  assert.equal(after - before, 2);
});

test("failed query diagnostics redact connection credentials", async () => {
  const previousThreshold = process.env["DB_QUERY_SLOW_DIAGNOSTIC_MS"];
  const events: PostgresPoolDiagnosticEvent[] = [];
  const secret = "postgresql://diagnostic-user:diagnostic-pass@db.example/app";
  fakeQueryError = new Error(`connect failed for ${secret}`);
  process.env["DB_QUERY_SLOW_DIAGNOSTIC_MS"] = "1";
  setPostgresPoolDiagnosticListener((event) => events.push(event));

  try {
    await assert.rejects(pool.query("select failed_pool_query"));
    const queryEvents = events.filter((event) => event.type === "query");
    assert.equal(queryEvents.length, 1);
    assert.equal(queryEvents[0]?.error, "Database operation failed");
    assert.doesNotMatch(JSON.stringify(queryEvents), /diagnostic-pass/);
  } finally {
    fakeQueryError = null;
    setPostgresPoolDiagnosticListener(null);
    if (previousThreshold === undefined) {
      delete process.env["DB_QUERY_SLOW_DIAGNOSTIC_MS"];
    } else {
      process.env["DB_QUERY_SLOW_DIAGNOSTIC_MS"] = previousThreshold;
    }
  }
});

test("pool diagnostics never project raw SQL", async () => {
  const secret = "sql-diagnostic-secret";
  const direct = await captureSlowQueryEvents(() =>
    pool.query(`select 'postgres://diagnostic-user:${secret}@db.example/app'`),
  );
  const truncatedUserinfo = await captureSlowQueryEvents(() =>
    pool.query(`select 'diagnostic-user:${secret.repeat(40)}@db.example'`),
  );
  const opaqueLiteral = await captureSlowQueryEvents(() =>
    pool.query(
      `insert into oauth_tokens(access_token) values ('sk_live_${secret}')`,
    ),
  );

  assert.equal(direct[0]?.sql, null);
  assert.equal(truncatedUserinfo[0]?.sql, null);
  assert.equal(opaqueLiteral[0]?.sql, null);
  assert.equal(
    JSON.stringify([direct, truncatedUserinfo, opaqueLiteral]).includes(secret),
    false,
  );
});

test("pool diagnostics sanitize request-derived context", async () => {
  const secret = "context-diagnostic-pass";
  const events = await captureSlowQueryEvents(() =>
    runWithPostgresDiagnosticContext(
      {
        requestId: `${"r".repeat(500)}%`,
        route: "GET /safe",
        requestFamily: `context-user:${secret.repeat(20)}@db.example`,
        requestOrigin: `safe/password: ${secret}`,
        clientRole: "flow-screen",
      },
      () => pool.query("select sanitized_context_query"),
    ),
  );

  assert.equal(events[0]?.context?.requestId, null);
  assert.equal(events[0]?.context?.requestFamily, null);
  assert.equal(events[0]?.context?.requestOrigin, null);
  assert.equal(events[0]?.context?.clientRole, "flow-screen");
  assert.equal(JSON.stringify(events).includes(secret), false);
});

test("pool diagnostics sanitize prepared-query names", async () => {
  const secret = "prepared-query-secret";
  const unsafe = await captureSlowQueryEvents(() =>
    pool.query({
      text: "select unsafe_prepared_query_name",
      name: `dbPassword=${secret}`,
    }),
  );
  const overlong = await captureSlowQueryEvents(() =>
    pool.query({
      text: "select overlong_prepared_query_name",
      name: "q".repeat(121),
    }),
  );
  const safe = await captureSlowQueryEvents(() =>
    pool.query({
      text: "select safe_prepared_query_name",
      name: "safe-prepared-query",
    }),
  );

  assert.equal(unsafe[0]?.queryName, null);
  assert.equal(JSON.stringify(unsafe).includes(secret), false);
  assert.equal(overlong[0]?.queryName, null);
  assert.equal(safe[0]?.queryName, "safe-prepared-query");
});

test("pool diagnostics do not inspect raw SQL", async () => {
  const originalReplace = String.prototype.replace;
  let observedInputLength: number | null = null;
  String.prototype.replace = function (
    this: string,
    searchValue: string | RegExp,
    replaceValue: string | ((substring: string, ...args: unknown[]) => string),
  ): string {
    const input = String(this);
    if (input.startsWith("select bounded_diagnostic_sql")) {
      observedInputLength = input.length;
    }
    return Reflect.apply(originalReplace, input, [
      searchValue,
      replaceValue,
    ]) as string;
  } as typeof String.prototype.replace;

  try {
    const events = await captureSlowQueryEvents(() =>
      pool.query(`select bounded_diagnostic_sql ${"x ".repeat(10_000)}`),
    );
    assert.equal(events.length, 1);
    assert.equal(events[0]?.sql, null);
  } finally {
    String.prototype.replace = originalReplace;
  }

  assert.equal(observedInputLength, null);
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
  const waitingDescriptor = Object.getOwnPropertyDescriptor(
    pool,
    "waitingCount",
  );
  const totalDescriptor = Object.getOwnPropertyDescriptor(pool, "totalCount");
  const idleDescriptor = Object.getOwnPropertyDescriptor(pool, "idleCount");
  Object.defineProperty(pool, "waitingCount", {
    configurable: true,
    value: 4,
  });
  Object.defineProperty(pool, "totalCount", {
    configurable: true,
    value: 1,
  });
  Object.defineProperty(pool, "idleCount", {
    configurable: true,
    value: 1,
  });
  setDbAdmissionDiagnosticsSource(() => admission);

  try {
    const stats = getPoolStats();
    assert.equal(stats.waiting, 4);
    assert.equal(stats.rawPoolWaiting, 4);
    assert.equal(stats.admissionWaiting, 10);
    assert.equal(stats.totalWaiting, 14);
    assert.equal(stats.admissionBacklog, true);
    assert.equal(stats.appPoolSaturated, false);
    assert.equal(stats.admission, admission);

    Object.defineProperty(pool, "waitingCount", {
      configurable: true,
      value: 0,
    });
    Object.defineProperty(pool, "totalCount", {
      configurable: true,
      value: stats.max,
    });
    Object.defineProperty(pool, "idleCount", {
      configurable: true,
      value: 0,
    });

    const saturatedStats = getPoolStats();
    assert.equal(saturatedStats.rawPoolWaiting, 0);
    assert.equal(saturatedStats.admissionBacklog, true);
    assert.equal(saturatedStats.appPoolSaturated, true);
  } finally {
    setDbAdmissionDiagnosticsSource(null);
    if (waitingDescriptor) {
      Object.defineProperty(pool, "waitingCount", waitingDescriptor);
    } else {
      Reflect.deleteProperty(pool, "waitingCount");
    }
    if (totalDescriptor) {
      Object.defineProperty(pool, "totalCount", totalDescriptor);
    } else {
      Reflect.deleteProperty(pool, "totalCount");
    }
    if (idleDescriptor) {
      Object.defineProperty(pool, "idleCount", idleDescriptor);
    } else {
      Reflect.deleteProperty(pool, "idleCount");
    }
  }
});
