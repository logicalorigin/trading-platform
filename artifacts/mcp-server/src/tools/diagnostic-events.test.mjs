import assert from "node:assert/strict";
import test from "node:test";

import { drizzle } from "drizzle-orm/node-postgres";
import { diagnosticEventsTable } from "@workspace/db/schema";
import {
  buildDiagnosticEventsQuery,
  diagnosticEventsTool,
  handleListDiagnosticEvents,
} from "./diagnostic-events.ts";

const from = new Date("2026-07-08T12:00:00.000Z");
const to = new Date("2026-07-09T12:00:00.000Z");
const eventRow = {
  id: "7ddaf8a1-6fd7-4c99-aa2c-e8eb0ca0f497",
  incidentKey: "api:test-warning",
  subsystem: "api",
  category: "request-pressure",
  code: null,
  severity: "warning",
  status: "open",
  message: "Test warning",
  firstSeenAt: new Date("2026-07-09T10:00:00.000Z"),
  lastSeenAt: new Date("2026-07-09T11:00:00.000Z"),
  eventCount: 3,
  dimensions: { route: "/api/test" },
  raw: { p95Ms: 1200 },
  createdAt: new Date("2026-07-09T10:00:00.000Z"),
  updatedAt: new Date("2026-07-09T11:00:00.000Z"),
};

test("preserves the historical MCP input contract", () => {
  assert.deepEqual(Object.keys(diagnosticEventsTool.inputShape), [
    "subsystem",
    "severity",
    "from",
    "to",
  ]);
});

test("builds a parameterized, newest-first diagnostic event query", () => {
  const database = drizzle.mock({ schema: { diagnosticEventsTable } });
  const query = buildDiagnosticEventsQuery(database, {
    from,
    to,
    subsystem: "api",
    severity: "warning",
    limit: 200,
  }).toSQL();

  assert.match(query.sql, /from "diagnostic_events"/u);
  assert.match(query.sql, /"last_seen_at" >= \$1/u);
  assert.match(query.sql, /"last_seen_at" <= \$2/u);
  assert.match(query.sql, /"subsystem" = \$3/u);
  assert.match(query.sql, /"severity" = \$4/u);
  assert.match(query.sql, /order by "diagnostic_events"\."last_seen_at" desc/u);
  assert.match(query.sql, /limit \$5/u);
  assert.deepEqual(query.params, [
    from.toISOString(),
    to.toISOString(),
    "api",
    "warning",
    200,
  ]);
});

test("handler maps DB rows to the HTTP result shape", async () => {
  let receivedInput;
  const result = await handleListDiagnosticEvents(
    {
      subsystem: " api ",
      severity: "warning",
      from: from.toISOString(),
      to: to.toISOString(),
    },
    async (input) => {
      receivedInput = input;
      return [eventRow];
    },
    async () => "normal",
  );

  assert.deepEqual(receivedInput, {
    from,
    to,
    subsystem: "api",
    severity: "warning",
    limit: 200,
  });
  assert.equal(result.isError, undefined);
  assert.deepEqual(JSON.parse(result.content[0].text), {
    from: from.toISOString(),
    to: to.toISOString(),
    events: [
      {
        id: "7ddaf8a1-6fd7-4c99-aa2c-e8eb0ca0f497",
        incidentKey: "api:test-warning",
        subsystem: "api",
        category: "request-pressure",
        code: null,
        severity: "warning",
        status: "open",
        message: "Test warning",
        firstSeenAt: "2026-07-09T10:00:00.000Z",
        lastSeenAt: "2026-07-09T11:00:00.000Z",
        eventCount: 3,
        dimensions: { route: "/api/test" },
        raw: { p95Ms: 1200 },
      },
    ],
    limits: {
      requestedLimit: 200,
      appliedLimit: 200,
      maxLimit: 1000,
      absoluteMaxLimit: 1000,
      pressureLevel: "normal",
      pressureLimited: false,
    },
  });
});

test("handler applies the API raw suppression and size cap", async () => {
  const result = await handleListDiagnosticEvents(
    { from: from.toISOString(), to: to.toISOString() },
    async () => [
      { ...eventRow, id: "info-event", severity: "info", raw: { secret: true } },
      { ...eventRow, id: "warning-event", raw: { detail: "x".repeat(2_001) } },
    ],
    async () => "normal",
  );
  const { events } = JSON.parse(result.content[0].text);

  assert.deepEqual(events[0].raw, {});
  assert.equal(events[1].raw.detail, `${"x".repeat(2_000)}...`);
});

test("handler preserves the API high-pressure event cap", async () => {
  let appliedLimit;
  const result = await handleListDiagnosticEvents(
    { from: from.toISOString(), to: to.toISOString() },
    async (input) => {
      appliedLimit = input.limit;
      return [];
    },
    async () => "high",
  );

  assert.equal(appliedLimit, 150);
  assert.deepEqual(JSON.parse(result.content[0].text).limits, {
    requestedLimit: 200,
    appliedLimit: 150,
    maxLimit: 150,
    absoluteMaxLimit: 1000,
    pressureLevel: "high",
    pressureLimited: true,
  });
});

test("handler returns a structured DB-unreachable error without a stack", async () => {
  const result = await handleListDiagnosticEvents(
    {},
    async () => {
      const error = new Error("connect ECONNREFUSED secret-host:5432");
      error.stack = "Error: connect ECONNREFUSED\n    at secret/path.ts:42";
      throw error;
    },
    async () => "normal",
  );

  assert.equal(result.isError, true);
  assert.equal(result.content[0].text, "list_diagnostic_events failed: DB unreachable.");
  assert.ok(!result.content[0].text.includes("secret"));
  assert.ok(!result.content[0].text.includes("\n"));
});
